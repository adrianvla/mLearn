
/**
 * Reusable file download utility with progress reporting, redirect handling,
 * and atomic writes (temp file → rename).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';

export interface DownloadProgress {
  downloadedBytes: number;
  expectedBytes: number;
  progress: number;
}

export type ProgressCallback = (progress: DownloadProgress) => void;

/**
 * Download a file from a URL to a destination path with progress reporting.
 * Handles HTTP redirects (up to 5), writes to a temp file first, then renames
 * atomically on completion.
 */
export function downloadFileWithProgress(
  url: string,
  destPath: string,
  onProgress?: ProgressCallback
): Promise<void> {
  return new Promise((resolve, reject) => {
    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    const tempPath = destPath + '.downloading';
    let downloadedBytes = 0;
    let expectedBytes = 0;

    const emitProgress = () => {
      onProgress?.({
        downloadedBytes,
        expectedBytes,
        progress: expectedBytes > 0 ? downloadedBytes / expectedBytes : 0,
      });
    };

    const doRequest = (reqUrl: string, redirectCount = 0) => {
      if (redirectCount > 5) {
        reject(new Error('Too many redirects'));
        return;
      }

      const protocol = reqUrl.startsWith('https') ? https : http;
      const req = protocol.get(reqUrl, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          doRequest(res.headers.location, redirectCount + 1);
          return;
        }

        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        expectedBytes = parseInt(res.headers['content-length'] || '0', 10);
        emitProgress();

        const fileStream = fs.createWriteStream(tempPath);
        let lastEmit = 0;

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
            fs.renameSync(tempPath, destPath);
            emitProgress();
            resolve();
          });
        });

        fileStream.on('error', (err) => {
          try { fs.unlinkSync(tempPath); } catch (e) {
            console.error(e);
          }
          reject(err);
        });
      });

      req.on('error', (err) => {
        reject(err);
      });
    };

    doRequest(url);
  });
}
