import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter, Readable } from 'stream';
import * as path from 'path';
import { createTempDir, type TempDir } from '../../../test/helpers/tempDir';

vi.mock('https', () => ({
  get: vi.fn(),
}));

vi.mock('http', () => ({
  get: vi.fn(),
}));

let mockCreateWriteStream: ((...args: unknown[]) => unknown) | null = null;

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    default: {
      ...actual,
      createWriteStream: (...args: Parameters<typeof actual.createWriteStream>) => {
        if (mockCreateWriteStream) return mockCreateWriteStream(...args);
        return actual.createWriteStream(...args);
      },
    },
    createWriteStream: (...args: Parameters<typeof actual.createWriteStream>) => {
      if (mockCreateWriteStream) return mockCreateWriteStream(...args);
      return actual.createWriteStream(...args);
    },
  };
});

import * as httpsModule from 'https';
import * as httpModule from 'http';
import * as fs from 'fs';
import { downloadFileWithProgress } from './downloadManager';

type MockResponse = Readable & {
  statusCode: number;
  headers: Record<string, string>;
};

function createMockResponse(
  statusCode: number,
  headers: Record<string, string> = {},
  data: Buffer[] = [],
): MockResponse {
  const readable = new Readable({ read() {} }) as MockResponse;
  readable.statusCode = statusCode;
  readable.headers = headers;
  process.nextTick(() => {
    for (const chunk of data) {
      readable.push(chunk);
    }
    readable.push(null);
  });
  return readable;
}

function createMockRequest(): EventEmitter {
  return new EventEmitter();
}

describe('downloadFileWithProgress', () => {
  let tempDir: TempDir;
  let httpsGet: ReturnType<typeof vi.fn>;
  let httpGet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tempDir = createTempDir('mlearn-download-test-');
    httpsGet = vi.mocked(httpsModule.get) as ReturnType<typeof vi.fn>;
    httpGet = vi.mocked(httpModule.get) as ReturnType<typeof vi.fn>;
    mockCreateWriteStream = null;
  });

  afterEach(() => {
    mockCreateWriteStream = null;
    tempDir.cleanup();
  });

  describe('successful downloads', () => {
    it('downloads a file via https and writes to destination', async () => {
      const destPath = path.join(tempDir.tmpDir, 'file.tar.gz');
      const content = Buffer.from('hello world');

      httpsGet.mockImplementation((_url: string, callback: (res: unknown) => void) => {
        const res = createMockResponse(200, { 'content-length': String(content.length) }, [content]);
        callback(res);
        return createMockRequest();
      });

      await downloadFileWithProgress('https://example.com/file.tar.gz', destPath);

      expect(fs.existsSync(destPath)).toBe(true);
      expect(fs.readFileSync(destPath)).toEqual(content);
    });

    it('downloads a file via http for http:// URLs', async () => {
      const destPath = path.join(tempDir.tmpDir, 'file.bin');
      const content = Buffer.from('binary data');

      httpGet.mockImplementation((_url: string, callback: (res: unknown) => void) => {
        const res = createMockResponse(200, { 'content-length': String(content.length) }, [content]);
        callback(res);
        return createMockRequest();
      });

      await downloadFileWithProgress('http://example.com/file.bin', destPath);

      expect(fs.existsSync(destPath)).toBe(true);
      expect(fs.readFileSync(destPath)).toEqual(content);
    });

    it('creates destination directory if it does not exist', async () => {
      const subDir = path.join(tempDir.tmpDir, 'nested', 'deep');
      const destPath = path.join(subDir, 'file.tar.gz');
      const content = Buffer.from('data');

      httpsGet.mockImplementation((_url: string, callback: (res: unknown) => void) => {
        const res = createMockResponse(200, { 'content-length': '4' }, [content]);
        callback(res);
        return createMockRequest();
      });

      await downloadFileWithProgress('https://example.com/file.tar.gz', destPath);

      expect(fs.existsSync(subDir)).toBe(true);
      expect(fs.existsSync(destPath)).toBe(true);
    });

    it('removes temp file and renames to final destination atomically', async () => {
      const destPath = path.join(tempDir.tmpDir, 'output.tar.gz');
      const tempPath = destPath + '.downloading';
      const content = Buffer.from('data');

      httpsGet.mockImplementation((_url: string, callback: (res: unknown) => void) => {
        const res = createMockResponse(200, {}, [content]);
        callback(res);
        return createMockRequest();
      });

      await downloadFileWithProgress('https://example.com/file.tar.gz', destPath);

      expect(fs.existsSync(tempPath)).toBe(false);
      expect(fs.existsSync(destPath)).toBe(true);
    });

    it('resolves without onProgress if no callback provided', async () => {
      const destPath = path.join(tempDir.tmpDir, 'file.tar.gz');
      const content = Buffer.from('data');

      httpsGet.mockImplementation((_url: string, callback: (res: unknown) => void) => {
        const res = createMockResponse(200, {}, [content]);
        callback(res);
        return createMockRequest();
      });

      await expect(
        downloadFileWithProgress('https://example.com/file.tar.gz', destPath),
      ).resolves.toBeUndefined();
    });
  });

  describe('progress callback', () => {
    it('calls onProgress with initial 0 progress before data arrives', async () => {
      const destPath = path.join(tempDir.tmpDir, 'file.tar.gz');
      const content = Buffer.from('hello world');
      const progressCalls: Array<{ downloadedBytes: number; expectedBytes: number; progress: number }> = [];

      httpsGet.mockImplementation((_url: string, callback: (res: unknown) => void) => {
        const res = createMockResponse(200, { 'content-length': String(content.length) }, [content]);
        callback(res);
        return createMockRequest();
      });

      await downloadFileWithProgress('https://example.com/file.tar.gz', destPath, (p) => {
        progressCalls.push({ ...p });
      });

      expect(progressCalls.length).toBeGreaterThanOrEqual(1);
      expect(progressCalls[0].downloadedBytes).toBe(0);
      expect(progressCalls[0].expectedBytes).toBe(content.length);
      expect(progressCalls[0].progress).toBe(0);
    });

    it('calls onProgress with progress 1 at completion', async () => {
      const destPath = path.join(tempDir.tmpDir, 'file.tar.gz');
      const content = Buffer.from('hello world');
      const progressCalls: Array<{ downloadedBytes: number; expectedBytes: number; progress: number }> = [];

      httpsGet.mockImplementation((_url: string, callback: (res: unknown) => void) => {
        const res = createMockResponse(200, { 'content-length': String(content.length) }, [content]);
        callback(res);
        return createMockRequest();
      });

      await downloadFileWithProgress('https://example.com/file.tar.gz', destPath, (p) => {
        progressCalls.push({ ...p });
      });

      const last = progressCalls[progressCalls.length - 1];
      expect(last.downloadedBytes).toBe(content.length);
      expect(last.expectedBytes).toBe(content.length);
      expect(last.progress).toBe(1);
    });

    it('reports progress 0 when content-length is missing', async () => {
      const destPath = path.join(tempDir.tmpDir, 'file.tar.gz');
      const content = Buffer.from('hello');
      const progressCalls: Array<{ progress: number }> = [];

      httpsGet.mockImplementation((_url: string, callback: (res: unknown) => void) => {
        const res = createMockResponse(200, {}, [content]);
        callback(res);
        return createMockRequest();
      });

      await downloadFileWithProgress('https://example.com/file.tar.gz', destPath, (p) => {
        progressCalls.push({ progress: p.progress });
      });

      const initialCall = progressCalls[0];
      expect(initialCall.progress).toBe(0);
    });
  });

  describe('redirect handling', () => {
    it('follows a single 301 redirect', async () => {
      const destPath = path.join(tempDir.tmpDir, 'file.tar.gz');
      const content = Buffer.from('redirected content');
      let callCount = 0;

      httpsGet.mockImplementation((_url: string, callback: (res: unknown) => void) => {
        callCount++;
        if (callCount === 1) {
          const res = createMockResponse(301, { location: 'https://example.com/redirected' });
          callback(res);
        } else {
          const res = createMockResponse(200, {}, [content]);
          callback(res);
        }
        return createMockRequest();
      });

      await downloadFileWithProgress('https://example.com/file.tar.gz', destPath);

      expect(callCount).toBe(2);
      expect(fs.existsSync(destPath)).toBe(true);
      expect(fs.readFileSync(destPath)).toEqual(content);
    });

    it('follows 302 redirect', async () => {
      const destPath = path.join(tempDir.tmpDir, 'file.tar.gz');
      const content = Buffer.from('data');
      let callCount = 0;

      httpsGet.mockImplementation((_url: string, callback: (res: unknown) => void) => {
        callCount++;
        if (callCount === 1) {
          const res = createMockResponse(302, { location: 'https://cdn.example.com/file.tar.gz' });
          callback(res);
        } else {
          const res = createMockResponse(200, {}, [content]);
          callback(res);
        }
        return createMockRequest();
      });

      await downloadFileWithProgress('https://example.com/file.tar.gz', destPath);
      expect(callCount).toBe(2);
    });

    it('follows 307 redirect', async () => {
      const destPath = path.join(tempDir.tmpDir, 'file.tar.gz');
      const content = Buffer.from('data');
      let callCount = 0;

      httpsGet.mockImplementation((_url: string, callback: (res: unknown) => void) => {
        callCount++;
        if (callCount === 1) {
          const res = createMockResponse(307, { location: 'https://cdn.example.com/file.tar.gz' });
          callback(res);
        } else {
          const res = createMockResponse(200, {}, [content]);
          callback(res);
        }
        return createMockRequest();
      });

      await downloadFileWithProgress('https://example.com/file.tar.gz', destPath);
      expect(callCount).toBe(2);
    });

    it('follows 308 redirect', async () => {
      const destPath = path.join(tempDir.tmpDir, 'file.tar.gz');
      const content = Buffer.from('data');
      let callCount = 0;

      httpsGet.mockImplementation((_url: string, callback: (res: unknown) => void) => {
        callCount++;
        if (callCount === 1) {
          const res = createMockResponse(308, { location: 'https://cdn.example.com/file.tar.gz' });
          callback(res);
        } else {
          const res = createMockResponse(200, {}, [content]);
          callback(res);
        }
        return createMockRequest();
      });

      await downloadFileWithProgress('https://example.com/file.tar.gz', destPath);
      expect(callCount).toBe(2);
    });

    it('rejects with "Too many redirects" after 5 redirects', async () => {
      const destPath = path.join(tempDir.tmpDir, 'file.tar.gz');

      httpsGet.mockImplementation((_url: string, callback: (res: unknown) => void) => {
        const res = createMockResponse(301, { location: 'https://example.com/redirect' });
        callback(res);
        return createMockRequest();
      });

      await expect(
        downloadFileWithProgress('https://example.com/file.tar.gz', destPath),
      ).rejects.toThrow('Too many redirects');
    });

    it('uses http module when redirect target is http://', async () => {
      const destPath = path.join(tempDir.tmpDir, 'file.tar.gz');
      const content = Buffer.from('data');

      httpsGet.mockImplementation((_url: string, callback: (res: unknown) => void) => {
        const res = createMockResponse(302, { location: 'http://cdn.example.com/file.tar.gz' });
        callback(res);
        return createMockRequest();
      });

      httpGet.mockImplementation((_url: string, callback: (res: unknown) => void) => {
        const res = createMockResponse(200, {}, [content]);
        callback(res);
        return createMockRequest();
      });

      await downloadFileWithProgress('https://example.com/file.tar.gz', destPath);

      expect(httpGet).toHaveBeenCalledWith('http://cdn.example.com/file.tar.gz', expect.any(Function));
    });
  });

  describe('HTTP error codes', () => {
    it('rejects with HTTP 404 error', async () => {
      const destPath = path.join(tempDir.tmpDir, 'file.tar.gz');

      httpsGet.mockImplementation((_url: string, callback: (res: unknown) => void) => {
        const res = createMockResponse(404);
        callback(res);
        return createMockRequest();
      });

      await expect(
        downloadFileWithProgress('https://example.com/file.tar.gz', destPath),
      ).rejects.toThrow('HTTP 404');
    });

    it('rejects with HTTP 500 error', async () => {
      const destPath = path.join(tempDir.tmpDir, 'file.tar.gz');

      httpsGet.mockImplementation((_url: string, callback: (res: unknown) => void) => {
        const res = createMockResponse(500);
        callback(res);
        return createMockRequest();
      });

      await expect(
        downloadFileWithProgress('https://example.com/file.tar.gz', destPath),
      ).rejects.toThrow('HTTP 500');
    });

    it('rejects with HTTP 403 error', async () => {
      const destPath = path.join(tempDir.tmpDir, 'file.tar.gz');

      httpsGet.mockImplementation((_url: string, callback: (res: unknown) => void) => {
        const res = createMockResponse(403);
        callback(res);
        return createMockRequest();
      });

      await expect(
        downloadFileWithProgress('https://example.com/file.tar.gz', destPath),
      ).rejects.toThrow('HTTP 403');
    });

    it('does not write a file when HTTP error occurs', async () => {
      const destPath = path.join(tempDir.tmpDir, 'file.tar.gz');

      httpsGet.mockImplementation((_url: string, callback: (res: unknown) => void) => {
        const res = createMockResponse(404);
        callback(res);
        return createMockRequest();
      });

      await expect(
        downloadFileWithProgress('https://example.com/file.tar.gz', destPath),
      ).rejects.toThrow();

      expect(fs.existsSync(destPath)).toBe(false);
    });
  });

  describe('network errors', () => {
    it('rejects when request emits an error event', async () => {
      const destPath = path.join(tempDir.tmpDir, 'file.tar.gz');
      const networkError = new Error('ECONNREFUSED');

      httpsGet.mockImplementation((_url: string, _callback: (res: unknown) => void) => {
        const req = new EventEmitter();
        process.nextTick(() => {
          req.emit('error', networkError);
        });
        return req;
      });

      await expect(
        downloadFileWithProgress('https://example.com/file.tar.gz', destPath),
      ).rejects.toThrow('ECONNREFUSED');
    });

    it('rejects on DNS failure', async () => {
      const destPath = path.join(tempDir.tmpDir, 'file.tar.gz');
      const dnsError = new Error('ENOTFOUND example.invalid');

      httpsGet.mockImplementation((_url: string, _callback: (res: unknown) => void) => {
        const req = new EventEmitter();
        process.nextTick(() => {
          req.emit('error', dnsError);
        });
        return req;
      });

      await expect(
        downloadFileWithProgress('https://example.invalid/file.tar.gz', destPath),
      ).rejects.toThrow('ENOTFOUND');
    });
  });

  describe('write errors', () => {
    it('rejects when write stream emits an error', async () => {
      const destPath = path.join(tempDir.tmpDir, 'file.tar.gz');
      const content = Buffer.from('hello');
      const writeError = new Error('ENOSPC: no space left on device');

      const onHandlers: Record<string, (...args: unknown[]) => void> = {};
      const fakeStream = Object.assign(new EventEmitter(), {
        write: vi.fn((_chunk: unknown, _enc: unknown, cb: () => void) => cb()),
        end: vi.fn(),
        close: vi.fn((cb: () => void) => cb()),
        destroy: vi.fn(),
        writable: true,
        on(event: string, handler: (...args: unknown[]) => void) {
          onHandlers[event] = handler;
          EventEmitter.prototype.on.call(this, event, handler);
          return this;
        },
      });

      mockCreateWriteStream = vi.fn(() => fakeStream);

      httpsGet.mockImplementation((_url: string, callback: (res: unknown) => void) => {
        const res = createMockResponse(200, { 'content-length': String(content.length) }, [content]);
        Object.defineProperty(res, 'pipe', {
          value: (_dest: unknown) => {
            process.nextTick(() => {
              if (onHandlers['error']) {
                onHandlers['error'](writeError);
              }
            });
            return _dest;
          },
          writable: true,
          configurable: true,
        });
        callback(res);
        return createMockRequest();
      });

      await expect(
        downloadFileWithProgress('https://example.com/file.tar.gz', destPath),
      ).rejects.toThrow('ENOSPC');

      expect(fs.existsSync(destPath)).toBe(false);
    });
  });

  describe('DownloadProgress interface', () => {
    it('emits progress objects with correct shape', async () => {
      const destPath = path.join(tempDir.tmpDir, 'file.tar.gz');
      const content = Buffer.from('data chunk');
      const receivedProgress: unknown[] = [];

      httpsGet.mockImplementation((_url: string, callback: (res: unknown) => void) => {
        const res = createMockResponse(200, { 'content-length': String(content.length) }, [content]);
        callback(res);
        return createMockRequest();
      });

      await downloadFileWithProgress('https://example.com/file.tar.gz', destPath, (p) => {
        receivedProgress.push(p);
      });

      expect(receivedProgress.length).toBeGreaterThan(0);
      for (const p of receivedProgress) {
        expect(p).toHaveProperty('downloadedBytes');
        expect(p).toHaveProperty('expectedBytes');
        expect(p).toHaveProperty('progress');
        expect(typeof (p as { progress: number }).progress).toBe('number');
        expect((p as { progress: number }).progress).toBeGreaterThanOrEqual(0);
        expect((p as { progress: number }).progress).toBeLessThanOrEqual(1);
      }
    });
  });
});
