import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { downloadFileWithProgress, DownloadError, isNetworkError } from './downloadManager';

const mockHttpsGet = vi.fn();
const mockHttpGet = vi.fn();

vi.mock('https', () => ({
  default: { get: (...args: unknown[]) => mockHttpsGet(...args) },
  get: (...args: unknown[]) => mockHttpsGet(...args),
}));
vi.mock('http', () => ({
  default: { get: (...args: unknown[]) => mockHttpGet(...args) },
  get: (...args: unknown[]) => mockHttpGet(...args),
}));

const flushIo = async (): Promise<void> => {
  for (let turn = 0; turn < 5; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

type HeaderRecorder = { headers: Record<string, string> | undefined };

interface ServeOptions {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
  /** Drop the connection after the headers once `partialBody` was written. */
  failMidStream?: { emit: 'aborted' | 'error'; partialBody: string; error?: Error };
}

function serveSuccess(
  options: ServeOptions,
  opts: { headers?: Record<string, string> } | undefined,
  callback: (res: unknown) => void,
  recorder?: HeaderRecorder,
): void {
  if (recorder) recorder.headers = opts?.headers;
  const handlers: Record<string, Array<(a?: unknown) => void>> = {};
  const res = {
    statusCode: options.statusCode,
    headers: options.headers ?? {},
    on: (event: string, cb: (a?: unknown) => void) => {
      (handlers[event] ||= []).push(cb);
    },
    resume: vi.fn(),
    pipe: (stream: { write: (chunk: Buffer) => boolean; end: () => void }) => {
      if (options.failMidStream) {
        const { emit, partialBody, error } = options.failMidStream;
        const chunk = Buffer.from(partialBody);
        handlers['data']?.forEach((cb) => cb(chunk));
        stream.write(chunk);
        handlers[emit]?.forEach((cb) => cb(error ?? new Error('aborted')));
        return;
      }
      const chunk = Buffer.from(options.body ?? '');
      handlers['data']?.forEach((cb) => cb(chunk));
      stream.write(chunk);
      stream.end();
    },
  };
  queueMicrotask(() => callback(res));
}

function failingRequest(error: Error): { on: ReturnType<typeof vi.fn> } {
  return {
    on: vi.fn((event: string, cb: (e: Error) => void) => {
      if (event === 'error') queueMicrotask(() => cb(error));
    }),
  };
}

/** Serve one response (success or mid-stream abort) for every request. */
function httpsServes(options: ServeOptions, recorder?: HeaderRecorder): void {
  mockHttpsGet.mockImplementation((_url: string, opts: { headers?: Record<string, string> }, callback: (res: unknown) => void) => {
    serveSuccess(options, opts, callback, recorder);
    return { on: vi.fn() };
  });
}

/** Fail every request at the transport level with the given error. */
function httpsFails(error: Error): void {
  mockHttpsGet.mockImplementation(() => failingRequest(error));
}

/** Fail the next `count` requests, then serve a successful body. */
function httpsFailsThenServes(error: Error, count: number, body: string, recorder?: HeaderRecorder): void {
  let attempts = 0;
  mockHttpsGet.mockImplementation((_url: string, opts: { headers?: Record<string, string> }, callback: (res: unknown) => void) => {
    attempts += 1;
    if (attempts <= count) return failingRequest(error);
    serveSuccess({ statusCode: 200, headers: { 'content-length': String(body.length) }, body }, opts, callback, recorder);
    return { on: vi.fn() };
  });
}

describe('downloadManager', () => {
  let destDir: string;
  let destPath: string;

  beforeEach(() => {
    destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mlearn-download-'));
    destPath = path.join(destDir, 'runtime.tar.gz');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    fs.rmSync(destDir, { recursive: true, force: true });
  });

  describe('isNetworkError', () => {
    it('classifies node system codes as network errors', () => {
      expect(isNetworkError(Object.assign(new Error('getaddrinfo failed'), { code: 'ENOTFOUND' }))).toBe(true);
      expect(isNetworkError(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))).toBe(true);
      expect(isNetworkError(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))).toBe(true);
      expect(isNetworkError(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }))).toBe(true);
    });

    it('classifies Chromium net:: errors and outage messages as network errors', () => {
      expect(isNetworkError(new Error('net::ERR_INTERNET_DISCONNECTED'))).toBe(true);
      expect(isNetworkError(new Error('Connection reset by peer'))).toBe(true);
      expect(isNetworkError(new Error('Host timed out'))).toBe(true);
    });

    it('does not tag permanent http failures as network errors', () => {
      expect(isNetworkError(new Error('HTTP 403'))).toBe(false);
      expect(isNetworkError(new Error('Too many redirects'))).toBe(false);
      expect(isNetworkError(null)).toBe(false);
    });
  });

  it('writes the file atomically and reports full progress', async () => {
    httpsServes({ statusCode: 200, headers: { 'content-length': '7' }, body: 'archive' });
    const progress: number[] = [];

    await downloadFileWithProgress('https://example.com/runtime.tar.gz', destPath, (p) => progress.push(p.progress));

    expect(fs.readFileSync(destPath, 'utf-8')).toBe('archive');
    expect(fs.existsSync(`${destPath}.downloading`)).toBe(false);
    expect(progress.at(-1)).toBe(1);
  });

  it('retries network failures with backoff and succeeds on a later attempt', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const networkError = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    const recorder: HeaderRecorder = { headers: undefined };
    httpsFailsThenServes(networkError, 2, 'archive', recorder);

    const promise = downloadFileWithProgress('https://example.com/runtime.tar.gz', destPath);
    // Attempt 1 fails immediately, sleeps 500ms; attempt 2 sleeps 1000ms.
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1000);
    await flushIo();
    await promise;

    expect(mockHttpsGet.mock.calls.length).toBe(3);
    expect(fs.readFileSync(destPath, 'utf-8')).toBe('archive');
  });

  it('surfaces the network classification when every attempt fails', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    httpsFails(Object.assign(new Error('dns failure'), { code: 'ENOTFOUND' }));

    const promise = downloadFileWithProgress('https://example.com/runtime.tar.gz', destPath);
    const assertion = expect(promise).rejects.toSatisfy((error: unknown) => (
      error instanceof DownloadError && error.network && /dns failure/.test(error.message)
    ));
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1000);
    await flushIo();
    await assertion;
    expect(mockHttpsGet.mock.calls.length).toBe(3);
  });

  it('does not retry permanent HTTP failures', async () => {
    httpsServes({ statusCode: 403, headers: {}, body: '' });

    const promise = downloadFileWithProgress('https://example.com/runtime.tar.gz', destPath);
    await expect(promise).rejects.toSatisfy((error: unknown) => (
      error instanceof DownloadError && !error.network && /HTTP 403/.test(error.message)
    ));
    await flushIo();
    expect(mockHttpsGet.mock.calls.length).toBe(1);
    expect(fs.existsSync(destPath)).toBe(false);
  });

  it('resumes a partial download via a Range request', async () => {
    fs.writeFileSync(`${destPath}.downloading`, 'abc');
    const recorder: HeaderRecorder = { headers: undefined };
    httpsServes(
      { statusCode: 206, headers: { 'content-range': 'bytes 3-8/8' }, body: 'defgh' },
      recorder,
    );

    await downloadFileWithProgress('https://example.com/runtime.tar.gz', destPath);

    expect(recorder.headers?.Range).toBe('bytes=3-');
    expect(fs.readFileSync(destPath, 'utf-8')).toBe('abcdefgh');
  });

  it('restarts from scratch when the server ignores the Range header', async () => {
    fs.writeFileSync(`${destPath}.downloading`, 'stale');
    const recorder: HeaderRecorder = { headers: undefined };
    httpsServes(
      { statusCode: 200, headers: { 'content-length': '7' }, body: 'archive' },
      recorder,
    );

    await downloadFileWithProgress('https://example.com/runtime.tar.gz', destPath);

    expect(recorder.headers?.Range).toBe('bytes=5-');
    expect(fs.readFileSync(destPath, 'utf-8')).toBe('archive');
  });

  it('discards the partial file and restarts on 416', async () => {
    fs.writeFileSync(`${destPath}.downloading`, 'stale');
    let call = 0;
    mockHttpsGet.mockImplementation((_url: string, opts: { headers?: Record<string, string> }, callback: (res: unknown) => void) => {
      call += 1;
      if (call === 1) {
        const res = { statusCode: 416, headers: {}, on: vi.fn(), resume: vi.fn(), pipe: vi.fn() };
        queueMicrotask(() => callback(res));
        return { on: vi.fn() };
      }
      httpsServes({ statusCode: 200, headers: { 'content-length': '7' }, body: 'archive' });
      expect(opts?.headers?.Range).toBeUndefined();
      return mockHttpsGet(_url, opts, callback);
    });

    await downloadFileWithProgress('https://example.com/runtime.tar.gz', destPath);

    expect(call).toBe(2);
    expect(fs.readFileSync(destPath, 'utf-8')).toBe('archive');
    expect(fs.existsSync(`${destPath}.downloading`)).toBe(false);
  });

  it('rejects with a network-classified error after repeated mid-stream aborts and resumes partial bytes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let attempts = 0;
    const rangeHeaders: Array<string | undefined> = [];
    mockHttpsGet.mockImplementation((_url: string, opts: { headers?: Record<string, string> }, callback: (res: unknown) => void) => {
      attempts += 1;
      rangeHeaders.push(opts?.headers?.Range);
      serveSuccess(
        {
          statusCode: attempts === 1 ? 200 : 206,
          headers: attempts === 1 ? {} : { 'content-range': 'bytes 3-6/6' },
          failMidStream: { emit: 'aborted', partialBody: 'abc' },
        },
        opts,
        callback,
      );
      return { on: vi.fn() };
    });

    const promise = downloadFileWithProgress('https://example.com/runtime.tar.gz', destPath);
    const assertion = expect(promise).rejects.toSatisfy((error: unknown) => (
      error instanceof DownloadError && error.network && /aborted/.test(error.message)
    ));
    // Real turns let each attempt's partial bytes flush to disk before the
    // faked backoff fires the next attempt.
    await flushIo();
    await vi.advanceTimersByTimeAsync(500);
    await flushIo();
    await vi.advanceTimersByTimeAsync(1000);
    await flushIo();
    await assertion;

    expect(attempts).toBe(3);
    // Each retry resumes from the bytes already on disk (3, then 6).
    expect(rangeHeaders[1]).toBe('bytes=3-');
    expect(rangeHeaders[2]).toBe('bytes=6-');
  });


  it('recovers from a mid-stream abort by resuming on the next attempt', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let attempts = 0;
    const rangeHeaders: Array<string | undefined> = [];
    mockHttpsGet.mockImplementation((_url: string, opts: { headers?: Record<string, string> }, callback: (res: unknown) => void) => {
      attempts += 1;
      rangeHeaders.push(opts?.headers?.Range);
      if (attempts === 1) {
        serveSuccess(
          { statusCode: 200, headers: {}, failMidStream: { emit: 'aborted', partialBody: 'abc' } },
          opts,
          callback,
        );
        return { on: vi.fn() };
      }
      serveSuccess(
        { statusCode: 206, headers: { 'content-range': 'bytes 3-7/7' }, body: 'defg' },
        opts,
        callback,
      );
      return { on: vi.fn() };
    });

    const promise = downloadFileWithProgress('https://example.com/runtime.tar.gz', destPath);
    await flushIo();
    await vi.advanceTimersByTimeAsync(500);
    await flushIo();
    await promise;

    expect(attempts).toBe(2);
    expect(rangeHeaders[1]).toBe('bytes=3-');
    expect(fs.readFileSync(destPath, 'utf-8')).toBe('abcdefg');
    expect(fs.existsSync(`${destPath}.downloading`)).toBe(false);
  });
});
