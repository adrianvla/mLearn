
/**
 * Reusable file download utility with progress reporting, redirect handling,
 * network-error classification, retry with exponential backoff, HTTP Range
 * resume of partial downloads, and atomic writes (temp file → rename).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger('electron.downloadManager');

export interface DownloadProgress {
  downloadedBytes: number;
  expectedBytes: number;
  progress: number;
}

export type ProgressCallback = (progress: DownloadProgress) => void;

/**
 * Download failure carrying a `network` flag that marks transport-level
 * outages (DNS, timeout, connection reset, ...) as opposed to permanent
 * errors (HTTP 4xx, bad URL). Consumers use it to decide between a retry
 * and surfacing a network error to the user.
 */
export class DownloadError extends Error {
  readonly network: boolean;

  constructor(message: string, options?: { network?: boolean }) {
    super(message);
    this.name = 'DownloadError';
    this.network = options?.network ?? false;
  }
}

// Node system codes and Chromium (net::ERR_*) names that indicate an outage
// rather than a permanent failure.
const NETWORK_ERROR_CODES: Readonly<Record<string, true>> = {
  ENOTFOUND: true,
  EAI_AGAIN: true,
  ECONNRESET: true,
  ETIMEDOUT: true,
  ECONNREFUSED: true,
  ECONNABORTED: true,
  EPIPE: true,
  EHOSTUNREACH: true,
  ENETUNREACH: true,
};

const NETWORK_MESSAGE_PATTERN = /net::ERR_[A-Z_]+|\b(?:timed? ?out|temporary failure|connection (?:reset|refused|closed|aborted)|socket hang up|network)\b/i;

export function isNetworkError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as NodeJS.ErrnoException & { network?: boolean };
  if (typeof err.network === 'boolean') return err.network;
  if (err.code && NETWORK_ERROR_CODES[err.code] === true) return true;
  return NETWORK_MESSAGE_PATTERN.test(String(err.message ?? ''));
}

function classifyError(error: unknown): DownloadError {
  const message = error instanceof Error ? error.message : String(error);
  return new DownloadError(message, { network: isNetworkError(error) });
}

const MAX_DOWNLOAD_ATTEMPTS = 3;
const RETRY_BACKOFF_BASE_MS = 500;

function sleep(ms: number): Promise<void> {
  let wake: () => void = () => {};
  const promise = new Promise<void>((resolve) => { wake = resolve; });
  setTimeout(wake, ms);
  return promise;
}

/**
 * Download a file from a URL to a destination path with progress reporting.
 * Handles HTTP redirects (up to 5), retries network failures up to three
 * attempts with exponential backoff, resumes a partial temp file via an HTTP
 * Range request when the server supports it, and renames atomically on
 * completion.
 */
export function downloadFileWithProgress(
  url: string,
  destPath: string,
  onProgress?: ProgressCallback
): Promise<void> {
  const destDir = path.dirname(destPath);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  // Stable partial-file name so a retried or app-restarted download can
  // resume from the bytes already on disk instead of starting over.
  const tempPath = `${destPath}.downloading`;

  const attempt = (attemptIndex: number): Promise<void> =>
    downloadOnce(url, tempPath, destPath, onProgress).catch((error) => {
      const classified = classifyError(error);
      if (attemptIndex < MAX_DOWNLOAD_ATTEMPTS && classified.network) {
        const delay = RETRY_BACKOFF_BASE_MS * attemptIndex;
        log.warn(`Download attempt ${attemptIndex}/${MAX_DOWNLOAD_ATTEMPTS} failed (${classified.message}); retrying in ${delay}ms`);
        return sleep(delay).then(() => attempt(attemptIndex + 1));
      }
      throw classified;
    });

  return attempt(1);
}

function downloadOnce(
  url: string,
  tempPath: string,
  destPath: string,
  onProgress?: ProgressCallback
): Promise<void> {
  let resolveDownload: () => void = () => {};
  let rejectDownload: (error: DownloadError) => void = () => {};
  const promise = new Promise<void>((resolve, reject) => { resolveDownload = resolve; rejectDownload = reject; });
  const reject2 = (error: unknown): void => { rejectDownload(classifyError(error)); };

  let resumeFrom = 0;
  try {
    if (fs.existsSync(tempPath)) resumeFrom = fs.statSync(tempPath).size;
  } catch (e) {
    log.warn('Could not stat partial download; starting fresh', e);
    resumeFrom = 0;
  }

  let downloadedBytes = resumeFrom;
  let expectedBytes = 0;

  // Single-settlement guard shared by the success path and every failure path
  // (transport errors, mid-stream aborts after the response headers, file
  // errors) so a dropped connection can never leave the promise pending and
  // can never double-settle. End-after-abort is a no-op.
  let settled = false;
  let activeRequest: http.ClientRequest | null = null;
  let activeFileStream: fs.WriteStream | null = null;
  const settleFailure = (error: unknown): void => {
    if (settled) return;
    settled = true;
    try { activeRequest?.destroy(); } catch { /* already torn down */ }
    const stream = activeFileStream;
    if (!stream || stream.destroyed || stream.writableEnded) {
      // Nothing buffered (or already closed) — reject immediately.
      reject2(error);
      return;
    }
    // end() (not destroy()) flushes buffered partial bytes to disk for the
    // next attempt's Range resume. Hold the reject until 'close' so the fd is
    // released BEFORE the retry opens the partial file — otherwise the next
    // attempt can interleave writes with this stream and corrupt the resume.
    stream.once('close', () => reject2(error));
    stream.end();
  };

  const settleSuccess = (): void => {
    if (settled) return;
    settled = true;
    resolveDownload();
  };

  const emitProgress = () => {
    onProgress?.({
      downloadedBytes,
      expectedBytes,
      progress: expectedBytes > 0 ? downloadedBytes / expectedBytes : 0,
    });
  };

  const doRequest = (reqUrl: string, redirectCount = 0) => {
    if (redirectCount > 5) {
      settleFailure(new Error('Too many redirects'));
      return;
    }

    const headers: http.OutgoingHttpHeaders = {};
    if (resumeFrom > 0) headers.Range = `bytes=${resumeFrom}-`;

    const protocol = reqUrl.startsWith('https') ? https : http;
    const req = protocol.get(reqUrl, { headers }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        doRequest(res.headers.location, redirectCount + 1);
        return;
      }

      const status = res.statusCode ?? 0;

      if (status === 416) {
        // Range not satisfiable — the partial file is stale or already
        // complete. Discard it and restart cleanly.
        res.resume();
        try { fs.unlinkSync(tempPath); } catch (e) {
          log.error('Failed to unlink stale partial download', e);
        }
        resumeFrom = 0;
        downloadedBytes = 0;
        doRequest(reqUrl, redirectCount);
        return;
      }

      if (status !== 200 && status !== 206) {
        res.resume();
        settleFailure(new Error(`HTTP ${status}`));
        return;
      }

      if (status === 206) {
        const contentRange = res.headers['content-range'];
        const total = contentRange ? Number(contentRange.split('/')[1]) : NaN;
        expectedBytes = Number.isFinite(total) ? total : 0;
      } else {
        // Server ignored the Range header — restart from scratch.
        if (resumeFrom > 0) {
          log.info('Server ignored Range header; restarting download from scratch');
          resumeFrom = 0;
          downloadedBytes = 0;
        }
        expectedBytes = parseInt(res.headers['content-length'] || '0', 10);
      }
      emitProgress();

      const fileStream = fs.createWriteStream(tempPath, { flags: resumeFrom > 0 ? 'a' : 'w' });
      activeFileStream = fileStream;
      let lastEmit = 0;

      res.on('aborted', () => {
        // Connection dropped after the response headers — retryable outage.
        settleFailure(new DownloadError('Connection aborted mid-download', { network: true }));
      });

      res.on('error', (err: Error) => {
        settleFailure(err);
      });

      res.on('data', (chunk: Buffer) => {
        downloadedBytes += chunk.length;
        if (expectedBytes > 0) {
          // Throttle progress updates to ~500ms
          const now = Date.now();
          if (now - lastEmit > 500) {
            lastEmit = now;
            emitProgress();
          }
        }
      });

      res.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close(() => {
          // A failure-path end() also triggers finish; never promote a
          // partial file to the destination.
          if (settled) return;
          try {
            fs.renameSync(tempPath, destPath);
            emitProgress();
            settleSuccess();
          } catch (err) {
            settleFailure(err);
          }
        });
      });

      fileStream.on('error', (err) => {
        res.resume();
        // Keep the partial file so a later attempt can resume.
        settleFailure(err);
      });
    });

    activeRequest = req;
    req.on('error', (err) => {
      settleFailure(err);
    });
  };

  doRequest(url);
  return promise;
}
