import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTempDir, type TempDir } from '../../../test/helpers/tempDir';
import path from 'path';
import fs from 'fs';
import type { ClientRequest } from 'http';

const mockIpcHandlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mockIpcHandlers.set(channel, handler);
    }),
    removeHandler: vi.fn(),
  },
  protocol: {
    handle: vi.fn(),
    registerSchemesAsPrivileged: vi.fn(),
  },
  net: {
    fetch: vi.fn(),
  },
}));

vi.mock('http', () => ({
  default: { request: vi.fn() },
}));

vi.mock('https', () => ({
  default: { request: vi.fn() },
}));

vi.mock('./voiceService', () => ({
  loadSamplesManifest: vi.fn(() => []),
  getVoiceSamplePath: vi.fn(() => '/tmp/sample.wav'),
}));

let tempDir: TempDir;

vi.mock('../utils/platform', () => ({
  getUserDataPath: vi.fn(() => tempDir?.tmpDir || '/tmp/test'),
  getAppPath: vi.fn(() => tempDir?.tmpDir || '/tmp/test'),
  getResourcePath: vi.fn(() => tempDir?.tmpDir || '/tmp/test'),
}));

type ReqCallback = (...args: unknown[]) => void;

interface FakeRes {
  statusCode: number;
  on: (event: string, cb: ReqCallback) => FakeRes;
  resume: () => void;
  _fire: (event: string, ...args: unknown[]) => void;
}

interface FakeReq {
  write: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  on: (event: string, cb: ReqCallback) => FakeReq;
  _fire: (event: string, ...args: unknown[]) => void;
}

function makeFakeRes(statusCode: number): FakeRes {
  const cbs: Record<string, ReqCallback[]> = {};
  const res: FakeRes = {
    statusCode,
    on(event, cb) { (cbs[event] ??= []).push(cb); return res; },
    resume() {},
    _fire(event, ...args) { (cbs[event] ?? []).forEach(cb => cb(...args)); },
  };
  return res;
}

function makeFakeReq(): FakeReq {
  const cbs: Record<string, ReqCallback[]> = {};
  const req: FakeReq = {
    write: vi.fn(),
    end: vi.fn(),
    destroy: vi.fn(),
    on(event, cb) { (cbs[event] ??= []).push(cb); return req; },
    _fire(event, ...args) { (cbs[event] ?? []).forEach(cb => cb(...args)); },
  };
  return req;
}

describe('flashcardTtsStorage', () => {
  let registerFlashcardAudioScheme: () => void;
  let setupFlashcardAudioProtocol: () => void;
  let setupFlashcardTtsIPC: () => void;

  beforeEach(async () => {
    tempDir = createTempDir('mlearn-tts-test-');
    mockIpcHandlers.clear();

    vi.resetModules();

    const electronMod = await import('electron');
    vi.mocked(electronMod.protocol.handle).mockReset();
    vi.mocked(electronMod.protocol.registerSchemesAsPrivileged).mockReset();
    vi.mocked(electronMod.net.fetch).mockReset();

    vi.resetModules();

    const mod = await import('./flashcardTtsStorage');
    registerFlashcardAudioScheme = mod.registerFlashcardAudioScheme;
    setupFlashcardAudioProtocol = mod.setupFlashcardAudioProtocol;
    setupFlashcardTtsIPC = mod.setupFlashcardTtsIPC;
  });

  afterEach(() => {
    tempDir.cleanup();
  });

  describe('registerFlashcardAudioScheme', () => {
    it('calls protocol.registerSchemesAsPrivileged with flashcard-audio scheme', async () => {
      const { protocol } = await import('electron');

      registerFlashcardAudioScheme();

      expect(protocol.registerSchemesAsPrivileged).toHaveBeenCalledWith([
        expect.objectContaining({
          scheme: 'flashcard-audio',
          privileges: expect.objectContaining({
            secure: true,
            supportFetchAPI: true,
            stream: true,
          }),
        }),
      ]);
    });

    it('includes bypassCSP and standard privileges', async () => {
      const { protocol } = await import('electron');

      registerFlashcardAudioScheme();

      const call = vi.mocked(protocol.registerSchemesAsPrivileged).mock.calls[0][0];
      expect(call[0].privileges).toMatchObject({ bypassCSP: true, standard: false });
    });
  });

  describe('setupFlashcardAudioProtocol', () => {
    it('registers a protocol handler for the flashcard-audio scheme', async () => {
      const { protocol } = await import('electron');

      setupFlashcardAudioProtocol();

      expect(protocol.handle).toHaveBeenCalledWith('flashcard-audio', expect.any(Function));
    });

    it('protocol handler fetches file URL from audio directory', async () => {
      const { protocol, net } = await import('electron');
      vi.mocked(net.fetch).mockResolvedValue(new Response('audio-bytes'));

      setupFlashcardAudioProtocol();

      const handler = vi.mocked(protocol.handle).mock.calls[0][1] as unknown as
        (req: { url: string; headers: Record<string, string> }) => Promise<unknown>;
      await handler({ url: 'flashcard-audio://card-123-word.ogg', headers: {} });

      expect(net.fetch).toHaveBeenCalledWith(
        expect.stringContaining('card-123-word.ogg'),
        expect.objectContaining({ headers: {} }),
      );
    });

    it('protocol handler strips query string from filename', async () => {
      const { protocol, net } = await import('electron');
      vi.mocked(net.fetch).mockResolvedValue(new Response(''));

      setupFlashcardAudioProtocol();

      const handler = vi.mocked(protocol.handle).mock.calls[0][1] as unknown as
        (req: { url: string; headers: Record<string, string> }) => Promise<unknown>;
      await handler({ url: 'flashcard-audio://card-qs-word.ogg?t=9999', headers: {} });

      const calledUrl = vi.mocked(net.fetch).mock.calls[0][0] as string;
      expect(calledUrl).toContain('card-qs-word.ogg');
      expect(calledUrl).not.toContain('?t=9999');
    });

    it('protocol handler maps filename to flashcard-audio subdirectory', async () => {
      const { protocol, net } = await import('electron');
      vi.mocked(net.fetch).mockResolvedValue(new Response(''));

      setupFlashcardAudioProtocol();

      const handler = vi.mocked(protocol.handle).mock.calls[0][1] as unknown as
        (req: { url: string; headers: Record<string, string> }) => Promise<unknown>;
      await handler({ url: 'flashcard-audio://abc-word.ogg', headers: {} });

      const calledUrl = vi.mocked(net.fetch).mock.calls[0][0] as string;
      expect(calledUrl).toContain('flashcard-audio');
      expect(calledUrl).toContain('abc-word.ogg');
    });
  });

  describe('setupFlashcardTtsIPC', () => {
    it('registers handlers for all TTS IPC channels', async () => {
      const { ipcMain } = await import('electron');

      setupFlashcardTtsIPC();

      expect(ipcMain.handle).toHaveBeenCalledWith('flashcard-tts-get', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith('flashcard-tts-generate', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith('flashcard-tts-batch-generate', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith('flashcard-tts-get-meta', expect.any(Function));
    });
  });

  describe('FLASHCARD_TTS_GET handler', () => {
    beforeEach(() => {
      setupFlashcardTtsIPC();
    });

    it('returns null when audio file does not exist', async () => {
      const handler = mockIpcHandlers.get('flashcard-tts-get');
      const result = await handler!({}, 'card-missing', 'word');
      expect(result).toBeNull();
    });

    it('returns protocol URL for a valid audio file', async () => {
      const audioDir = path.join(tempDir.tmpDir, 'flashcard-audio');
      fs.mkdirSync(audioDir, { recursive: true });
      fs.writeFileSync(path.join(audioDir, 'card-valid-word.ogg'), Buffer.alloc(200, 0x42));

      const handler = mockIpcHandlers.get('flashcard-tts-get');
      const result = await handler!({}, 'card-valid', 'word');
      expect(result).toBe('flashcard-audio://card-valid-word.ogg');
    });

    it('removes and returns null for a corrupt (too small) audio file', async () => {
      const audioDir = path.join(tempDir.tmpDir, 'flashcard-audio');
      fs.mkdirSync(audioDir, { recursive: true });
      const filePath = path.join(audioDir, 'card-tiny-word.ogg');
      fs.writeFileSync(filePath, Buffer.alloc(50, 0x01));

      const handler = mockIpcHandlers.get('flashcard-tts-get');
      const result = await handler!({}, 'card-tiny', 'word');

      expect(result).toBeNull();
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it('returns protocol URL for example field audio file', async () => {
      const audioDir = path.join(tempDir.tmpDir, 'flashcard-audio');
      fs.mkdirSync(audioDir, { recursive: true });
      fs.writeFileSync(path.join(audioDir, 'card-ex-example.ogg'), Buffer.alloc(200, 0x42));

      const handler = mockIpcHandlers.get('flashcard-tts-get');
      const result = await handler!({}, 'card-ex', 'example');
      expect(result).toBe('flashcard-audio://card-ex-example.ogg');
    });

    it('returns null for example when only word file exists', async () => {
      const audioDir = path.join(tempDir.tmpDir, 'flashcard-audio');
      fs.mkdirSync(audioDir, { recursive: true });
      fs.writeFileSync(path.join(audioDir, 'card-fields-word.ogg'), Buffer.alloc(200, 0x42));

      const handler = mockIpcHandlers.get('flashcard-tts-get');

      const wordResult = await handler!({}, 'card-fields', 'word');
      expect(wordResult).toBe('flashcard-audio://card-fields-word.ogg');

      const exampleResult = await handler!({}, 'card-fields', 'example');
      expect(exampleResult).toBeNull();
    });
  });

  describe('FLASHCARD_TTS_GET_META handler', () => {
    beforeEach(() => {
      setupFlashcardTtsIPC();
    });

    it('returns null when meta file does not exist', async () => {
      const handler = mockIpcHandlers.get('flashcard-tts-get-meta');
      const result = await handler!({}, 'card-no-meta', 'word');
      expect(result).toBeNull();
    });

    it('returns parsed metadata when meta file exists', async () => {
      const audioDir = path.join(tempDir.tmpDir, 'flashcard-audio');
      fs.mkdirSync(audioDir, { recursive: true });
      const meta = { provider: 'kokoro', generatedAt: '2024-01-01T00:00:00.000Z', language: 'ja' };
      fs.writeFileSync(path.join(audioDir, 'card-meta-word.meta.json'), JSON.stringify(meta));

      const handler = mockIpcHandlers.get('flashcard-tts-get-meta');
      const result = await handler!({}, 'card-meta', 'word');

      expect(result).toEqual(meta);
    });

    it('returns null for corrupt meta JSON', async () => {
      const audioDir = path.join(tempDir.tmpDir, 'flashcard-audio');
      fs.mkdirSync(audioDir, { recursive: true });
      fs.writeFileSync(path.join(audioDir, 'card-bad-meta-word.meta.json'), 'not json {{{');

      const handler = mockIpcHandlers.get('flashcard-tts-get-meta');
      const result = await handler!({}, 'card-bad-meta', 'word');
      expect(result).toBeNull();
    });

    it('returns metadata for example field', async () => {
      const audioDir = path.join(tempDir.tmpDir, 'flashcard-audio');
      fs.mkdirSync(audioDir, { recursive: true });
      const meta = { provider: 'qwen3', generatedAt: '2024-06-01T00:00:00.000Z', language: 'de' };
      fs.writeFileSync(path.join(audioDir, 'card-ex-meta-example.meta.json'), JSON.stringify(meta));

      const handler = mockIpcHandlers.get('flashcard-tts-get-meta');
      const result = await handler!({}, 'card-ex-meta', 'example');
      expect(result).toEqual(meta);
    });
  });

  describe('FLASHCARD_TTS_GENERATE handler — local provider', () => {
    it('returns null for empty text', async () => {
      setupFlashcardTtsIPC();
      const handler = mockIpcHandlers.get('flashcard-tts-generate');
      const result = await handler!({}, 'card-empty', '', 'ja', 'word', 'kokoro');
      expect(result).toBeNull();
    });

    it('returns null for dash text', async () => {
      setupFlashcardTtsIPC();
      const handler = mockIpcHandlers.get('flashcard-tts-generate');
      const result = await handler!({}, 'card-dash', '-', 'ja', 'word', 'kokoro');
      expect(result).toBeNull();
    });

    it('generates TTS via local backend and returns protocol URL', async () => {
      const audioData = Buffer.alloc(500, 0x7f);
      const fakeRes = makeFakeRes(200);
      const fakeReq = makeFakeReq();

      const { default: httpMod } = await import('http');
      vi.mocked(httpMod.request).mockImplementation((_opts: unknown, cb: unknown) => {
        (cb as (res: FakeRes) => void)(fakeRes);
        return fakeReq as unknown as ClientRequest;
      });

      setupFlashcardTtsIPC();

      const generatePromise = (mockIpcHandlers.get('flashcard-tts-generate') as (...args: unknown[]) => Promise<unknown>)(
        {}, 'card-local', 'hello', 'en', 'word', 'kokoro'
      );

      await new Promise(r => setTimeout(r, 5));
      fakeRes._fire('data', audioData);
      fakeRes._fire('end');

      const result = await generatePromise;
      expect(result).toBe('flashcard-audio://card-local-word.ogg');

      const filePath = path.join(tempDir.tmpDir, 'flashcard-audio', 'card-local-word.ogg');
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('returns null when local backend returns non-200 status', async () => {
      vi.useFakeTimers();

      const { default: httpMod } = await import('http');
      vi.mocked(httpMod.request).mockImplementation((_opts: unknown, cb: unknown) => {
        const fakeRes = makeFakeRes(500);
        const fakeReq = makeFakeReq();
        (cb as (res: FakeRes) => void)(fakeRes);
        setTimeout(() => {
          fakeRes._fire('data', Buffer.from('error body'));
          fakeRes._fire('end');
        }, 0);
        return fakeReq as unknown as ClientRequest;
      });

      setupFlashcardTtsIPC();

      const generatePromise = (mockIpcHandlers.get('flashcard-tts-generate') as (...args: unknown[]) => Promise<unknown>)(
        {}, 'card-fail', 'hello', 'en', 'word', 'kokoro'
      );

      await vi.runAllTimersAsync();

      vi.useRealTimers();
      const result = await generatePromise;
      expect(result).toBeNull();
    });

    it('returns null when local backend request fires an error event', async () => {
      vi.useFakeTimers();

      const { default: httpMod } = await import('http');
      vi.mocked(httpMod.request).mockImplementation((_opts: unknown, _cb: unknown) => {
        const fakeReq = makeFakeReq();
        setTimeout(() => {
          fakeReq._fire('error', new Error('ECONNREFUSED'));
        }, 0);
        return fakeReq as unknown as ClientRequest;
      });

      setupFlashcardTtsIPC();

      const generatePromise = (mockIpcHandlers.get('flashcard-tts-generate') as (...args: unknown[]) => Promise<unknown>)(
        {}, 'card-error', 'hello', 'en', 'word', 'kokoro'
      );

      await vi.runAllTimersAsync();

      vi.useRealTimers();
      const result = await generatePromise;
      expect(result).toBeNull();
    });

    it('returns null when backend returns empty response body', async () => {
      vi.useFakeTimers();

      const { default: httpMod } = await import('http');
      vi.mocked(httpMod.request).mockImplementation((_opts: unknown, cb: unknown) => {
        const fakeRes = makeFakeRes(200);
        const fakeReq = makeFakeReq();
        (cb as (res: FakeRes) => void)(fakeRes);
        setTimeout(() => {
          fakeRes._fire('end');
        }, 0);
        return fakeReq as unknown as ClientRequest;
      });

      setupFlashcardTtsIPC();

      const generatePromise = (mockIpcHandlers.get('flashcard-tts-generate') as (...args: unknown[]) => Promise<unknown>)(
        {}, 'card-empty-body', 'hello', 'en', 'word', 'kokoro'
      );

      await vi.runAllTimersAsync();

      vi.useRealTimers();
      const result = await generatePromise;
      expect(result).toBeNull();
    });

    it('writes metadata sidecar file after successful generation', async () => {
      const audioData = Buffer.alloc(500, 0x7f);
      const fakeRes = makeFakeRes(200);
      const fakeReq = makeFakeReq();

      const { default: httpMod } = await import('http');
      vi.mocked(httpMod.request).mockImplementation((_opts: unknown, cb: unknown) => {
        (cb as (res: FakeRes) => void)(fakeRes);
        return fakeReq as unknown as ClientRequest;
      });

      setupFlashcardTtsIPC();

      const generatePromise = (mockIpcHandlers.get('flashcard-tts-generate') as (...args: unknown[]) => Promise<unknown>)(
        {}, 'card-meta-check', 'hello', 'ja', 'word', 'kokoro'
      );

      await new Promise(r => setTimeout(r, 5));
      fakeRes._fire('data', audioData);
      fakeRes._fire('end');

      await generatePromise;

      const audioDir = path.join(tempDir.tmpDir, 'flashcard-audio');
      const metaPath = path.join(audioDir, 'card-meta-check-word.meta.json');
      expect(fs.existsSync(metaPath)).toBe(true);
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      expect(meta.provider).toBe('kokoro');
      expect(meta.language).toBe('ja');
      expect(meta.generatedAt).toBeDefined();
    });

    it('creates flashcard-audio directory if not present', async () => {
      const audioData = Buffer.alloc(500, 0x7f);
      const fakeRes = makeFakeRes(200);
      const fakeReq = makeFakeReq();

      const { default: httpMod } = await import('http');
      vi.mocked(httpMod.request).mockImplementation((_opts: unknown, cb: unknown) => {
        (cb as (res: FakeRes) => void)(fakeRes);
        return fakeReq as unknown as ClientRequest;
      });

      setupFlashcardTtsIPC();

      const audioDir = path.join(tempDir.tmpDir, 'flashcard-audio');
      expect(fs.existsSync(audioDir)).toBe(false);

      const generatePromise = (mockIpcHandlers.get('flashcard-tts-generate') as (...args: unknown[]) => Promise<unknown>)(
        {}, 'card-newdir', 'hello', 'en', 'word', 'kokoro'
      );

      await new Promise(r => setTimeout(r, 5));
      fakeRes._fire('data', audioData);
      fakeRes._fire('end');

      await generatePromise;

      expect(fs.existsSync(audioDir)).toBe(true);
    });
  });

  describe('FLASHCARD_TTS_GENERATE handler — cloud provider', () => {
    it('falls through to local generation when cloud provider has no auth token', async () => {
      vi.useFakeTimers();

      const { default: httpMod } = await import('http');
      vi.mocked(httpMod.request).mockImplementation((_opts: unknown, cb: unknown) => {
        const fakeRes = makeFakeRes(200);
        const fakeReq = makeFakeReq();
        (cb as (res: FakeRes) => void)(fakeRes);
        setTimeout(() => {
          fakeRes._fire('end');
        }, 0);
        return fakeReq as unknown as ClientRequest;
      });

      setupFlashcardTtsIPC();

      const generatePromise = (mockIpcHandlers.get('flashcard-tts-generate') as (...args: unknown[]) => Promise<unknown>)(
        {}, 'card-cloud-noauth', 'hello', 'en', 'word', 'cloud', undefined, undefined
      );

      await vi.runAllTimersAsync();
      vi.useRealTimers();

      const result = await generatePromise;
      expect(result).toBeNull();
    });
  });

  describe('FLASHCARD_TTS_BATCH_GENERATE handler', () => {
    beforeEach(() => {
      setupFlashcardTtsIPC();
    });

    it('returns empty object when given no items', async () => {
      const handler = mockIpcHandlers.get('flashcard-tts-batch-generate');
      const result = await handler!({}, [], 'ja', 'kokoro');
      expect(result).toEqual({});
    });

    it('skips items with empty text', async () => {
      const handler = mockIpcHandlers.get('flashcard-tts-batch-generate');
      const items = [{ cardId: 'card-a', text: '', field: 'word' }];
      const result = await handler!({}, items, 'ja', 'kokoro');
      expect(result).toEqual({});
    });

    it('skips items with dash text', async () => {
      const handler = mockIpcHandlers.get('flashcard-tts-batch-generate');
      const items = [{ cardId: 'card-b', text: '-', field: 'word' }];
      const result = await handler!({}, items, 'ja', 'kokoro');
      expect(result).toEqual({});
    });

    it('generates audio for multiple items and returns results map', async () => {
      const audioData = Buffer.alloc(500, 0x7f);
      const fakeRes1 = makeFakeRes(200);
      const fakeReq1 = makeFakeReq();
      const fakeRes2 = makeFakeRes(200);
      const fakeReq2 = makeFakeReq();

      let callCount = 0;
      const { default: httpMod } = await import('http');
      vi.mocked(httpMod.request).mockImplementation((_opts: unknown, cb: unknown) => {
        callCount++;
        const res = callCount === 1 ? fakeRes1 : fakeRes2;
        const req = callCount === 1 ? fakeReq1 : fakeReq2;
        (cb as (res: FakeRes) => void)(res);
        return req as unknown as ClientRequest;
      });

      const handler = mockIpcHandlers.get('flashcard-tts-batch-generate');
      const items = [
        { cardId: 'batch-a', text: 'hello', field: 'word' },
        { cardId: 'batch-b', text: 'world', field: 'example' },
      ];

      const batchPromise = (handler as (...args: unknown[]) => Promise<Record<string, string>>)(
        {}, items, 'en', 'kokoro'
      );

      await new Promise(r => setTimeout(r, 5));
      fakeRes1._fire('data', audioData);
      fakeRes1._fire('end');
      await new Promise(r => setTimeout(r, 5));
      fakeRes2._fire('data', audioData);
      fakeRes2._fire('end');

      const result = await batchPromise;
      expect(result['batch-a-word']).toBe('flashcard-audio://batch-a-word.ogg');
      expect(result['batch-b-example']).toBe('flashcard-audio://batch-b-example.ogg');
    });
  });

  describe('voice sample resolution', () => {
    it('passes voiceSamplePath to local backend when voiceSampleId matches a sample', async () => {
      const audioData = Buffer.alloc(500, 0x7f);
      const fakeRes = makeFakeRes(200);
      const fakeReq = makeFakeReq();

      vi.doMock('./voiceService', () => ({
        loadSamplesManifest: vi.fn(() => [
          { id: 'sample-1', name: 'Test Voice', filename: 'test.wav', createdAt: 0 },
        ]),
        getVoiceSamplePath: vi.fn(() => '/tmp/test.wav'),
      }));

      vi.doMock('http', () => ({
        default: {
          request: vi.fn((_opts: unknown, cb: unknown) => {
            (cb as (res: FakeRes) => void)(fakeRes);
            return fakeReq as unknown as ClientRequest;
          }),
        },
      }));

      vi.resetModules();
      const freshMod = await import('./flashcardTtsStorage');
      mockIpcHandlers.clear();
      freshMod.setupFlashcardTtsIPC();

      const generatePromise = (mockIpcHandlers.get('flashcard-tts-generate') as (...args: unknown[]) => Promise<unknown>)(
        {}, 'card-sample', 'hello', 'en', 'word', 'kokoro', 'sample-1'
      );

      await new Promise(r => setTimeout(r, 5));
      fakeRes._fire('data', audioData);
      fakeRes._fire('end');

      const result = await generatePromise;
      expect(result).toBe('flashcard-audio://card-sample-word.ogg');

      const writtenPayload = JSON.parse(fakeReq.write.mock.calls[0][0] as string);
      expect(writtenPayload.voiceSamplePath).toBe('/tmp/test.wav');
    });

    it('does not include voiceSamplePath when voiceSampleId does not match any sample', async () => {
      const audioData = Buffer.alloc(500, 0x7f);
      const fakeRes = makeFakeRes(200);
      const fakeReq = makeFakeReq();

      vi.doMock('./voiceService', () => ({
        loadSamplesManifest: vi.fn(() => []),
        getVoiceSamplePath: vi.fn(() => '/tmp/sample.wav'),
      }));

      vi.doMock('http', () => ({
        default: {
          request: vi.fn((_opts: unknown, cb: unknown) => {
            (cb as (res: FakeRes) => void)(fakeRes);
            return fakeReq as unknown as ClientRequest;
          }),
        },
      }));

      vi.resetModules();
      const freshMod = await import('./flashcardTtsStorage');
      mockIpcHandlers.clear();
      freshMod.setupFlashcardTtsIPC();

      const generatePromise = (mockIpcHandlers.get('flashcard-tts-generate') as (...args: unknown[]) => Promise<unknown>)(
        {}, 'card-no-sample', 'hello', 'en', 'word', 'kokoro', 'nonexistent-sample'
      );

      await new Promise(r => setTimeout(r, 5));
      fakeRes._fire('data', audioData);
      fakeRes._fire('end');

      await generatePromise;

      const writtenPayload = JSON.parse(fakeReq.write.mock.calls[0][0] as string);
      expect(writtenPayload.voiceSamplePath).toBeUndefined();
    });
  });
});
