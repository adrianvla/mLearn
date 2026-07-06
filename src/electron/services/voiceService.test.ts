import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTempDir } from '../../../test/helpers/tempDir';
import type { TempDir } from '../../../test/helpers/tempDir';

const handleHandlers = new Map<string, (...args: unknown[]) => unknown>();
const onHandlers = new Map<string, (...args: unknown[]) => void>();

let mockUserDataPath = '/tmp/voice-test';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handleHandlers.set(channel, handler);
    }),
    on: vi.fn((channel: string, handler: (...args: unknown[]) => void) => {
      onHandlers.set(channel, handler);
    }),
    removeHandler: vi.fn(),
  },
  app: {
    get getPath() {
      return (_name: string) => mockUserDataPath;
    },
    isPackaged: false,
    on: vi.fn(),
  },
}));

type WsEventCallback = (...args: unknown[]) => void;

class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;

  url: string;
  readyState: number;
  private _listeners = new Map<string, WsEventCallback[]>();
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
    this._emit('close');
  });

  constructor(url: string) {
    this.url = url;
    this.readyState = MockWebSocket.OPEN;
    lastCreatedWebSocket = this;
  }

  on(event: string, cb: WsEventCallback) {
    const list = this._listeners.get(event) ?? [];
    list.push(cb);
    this._listeners.set(event, list);
  }

  _emit(event: string, ...args: unknown[]) {
    for (const cb of this._listeners.get(event) ?? []) {
      cb(...args);
    }
  }
}

let lastCreatedWebSocket: MockWebSocket | null = null;

vi.mock('ws', () => ({ default: MockWebSocket }));

const httpGetFn = vi.fn();
const httpRequestFn = vi.fn();
vi.mock('http', () => ({
  get: (...args: unknown[]) => httpGetFn(...args),
  request: (...args: unknown[]) => httpRequestFn(...args),
}));

const httpsRequestFn = vi.fn();
vi.mock('https', () => ({
  request: (...args: unknown[]) => httpsRequestFn(...args),
}));

const existsSyncFn = vi.fn();
const readFileSyncFn = vi.fn();
const writeFileSyncFn = vi.fn();
const mkdirSyncFn = vi.fn();
const copyFileSyncFn = vi.fn();
const unlinkSyncFn = vi.fn();

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: (...args: unknown[]) => existsSyncFn(...args),
    readFileSync: (...args: unknown[]) => readFileSyncFn(...args),
    writeFileSync: (...args: unknown[]) => writeFileSyncFn(...args),
    mkdirSync: (...args: unknown[]) => mkdirSyncFn(...args),
    copyFileSync: (...args: unknown[]) => copyFileSyncFn(...args),
    unlinkSync: (...args: unknown[]) => unlinkSyncFn(...args),
  };
});

let mockQuitToken: string | null = null;
vi.mock('./pythonBackend', () => ({
  getQuitToken: () => mockQuitToken,
  readResourceFile: (...segments: string[]) => {
    const path = segments.join('/');
    if (path.includes('pip_requirements')) {
      return JSON.stringify({ voice: ['faster-whisper'], 'qwen3-tts': ['qwen3-tts-package'] });
    }
    return '';
  },
}));

type SpawnEventCallback = (...args: unknown[]) => void;

class MockChildProcess {
  stdout = { on: vi.fn() };
  stderr = { on: vi.fn() };
  private _listeners = new Map<string, SpawnEventCallback[]>();

  on(event: string, cb: SpawnEventCallback) {
    const list = this._listeners.get(event) ?? [];
    list.push(cb);
    this._listeners.set(event, list);
    return this;
  }

  _emit(event: string, ...args: unknown[]) {
    for (const cb of this._listeners.get(event) ?? []) cb(...args);
  }
}

const spawnFn = vi.fn();
vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => spawnFn(...args),
}));

vi.mock('../utils/platform', () => ({
  getAppPath: vi.fn(() => '/app'),
  getResourcePath: vi.fn(() => '/resources'),
  getPipExecutablePath: vi.fn(() => '/env/bin/pip'),
  getPythonExecutablePath: vi.fn(() => '/env/bin/python'),
  getBundledDistElectronPath: vi.fn((...segments: string[]) => ['/dist-electron', ...segments].join('/')),
  isWindows: false,
}));

const loadSettingsFn = vi.fn();
vi.mock('./settings', () => ({
  loadSettings: (...args: unknown[]) => loadSettingsFn(...args),
}));

async function flushMicrotasks(depth = 20) {
  for (let i = 0; i < depth; i++) {
    await Promise.resolve();
  }
}

function createSender(destroyed = false) {
  return { send: vi.fn(), isDestroyed: vi.fn(() => destroyed), id: 1 };
}

function createFakeEvent(opts?: { destroyed?: boolean }) {
  return { sender: createSender(opts?.destroyed ?? false) };
}

function makeFakeResponse(
  statusCode: number,
  _payload: Buffer | string,
  headers: Record<string, string> = {},
) {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  return {
    statusCode,
    headers,
    resume: vi.fn(),
    destroy: vi.fn(),
    on(event: string, cb: (...args: unknown[]) => void) {
      const list = listeners.get(event) ?? [];
      list.push(cb);
      listeners.set(event, list);
      return this;
    },
    _emit(event: string, ...args: unknown[]) {
      for (const cb of listeners.get(event) ?? []) cb(...args);
    },
  };
}

function makeJsonHttpGetMock(payload: object) {
  return (_url: string, cb: (res: ReturnType<typeof makeFakeResponse>) => void) => {
    const body = JSON.stringify(payload);
    const fakeRes = makeFakeResponse(200, Buffer.from(body));
    cb(fakeRes);
    Promise.resolve().then(() => {
      fakeRes._emit('data', body);
      fakeRes._emit('end');
    });
    return { on: vi.fn() };
  };
}

function makeJsonHttpRequestMock(payload: object, extraHeaders: Record<string, string> = {}) {
  return (_opts: unknown, cb: (res: ReturnType<typeof makeFakeResponse>) => void) => {
    const body = JSON.stringify(payload);
    const fakeRes = makeFakeResponse(200, Buffer.from(body), extraHeaders);
    cb(fakeRes);
    return {
      write: vi.fn(),
      end: vi.fn(() => {
        Promise.resolve().then(() => {
          fakeRes._emit('data', Buffer.from(body));
          fakeRes._emit('end');
        });
      }),
      on: vi.fn(),
    };
  };
}

function buildMinimalWavBuffer(pcmByteCount: number): Buffer {
  const buf = Buffer.alloc(44 + pcmByteCount);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + pcmByteCount, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(24000, 24);
  buf.writeUInt32LE(48000, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(pcmByteCount, 40);
  return buf;
}

let mod: typeof import('./voiceService');
let tempDir: TempDir;

beforeEach(async () => {
  tempDir = createTempDir('voice-test-');
  mockUserDataPath = tempDir.tmpDir;

  vi.resetModules();
  handleHandlers.clear();
  onHandlers.clear();
  vi.clearAllMocks();
  lastCreatedWebSocket = null;
  mockQuitToken = 'test-token';

  existsSyncFn.mockReturnValue(false);
  readFileSyncFn.mockReturnValue('[]');

  mod = await import('./voiceService');
});

afterEach(() => {
  vi.useRealTimers();
  tempDir.cleanup();
});

describe('loadSamplesManifest', () => {
  it('returns empty array when manifest file does not exist', () => {
    existsSyncFn.mockReturnValue(false);
    expect(mod.loadSamplesManifest()).toEqual([]);
  });

  it('parses and returns samples when manifest exists', () => {
    const samples = [{ id: 'abc', name: 'Test', filename: 'abc.wav', createdAt: 1000 }];
    existsSyncFn.mockReturnValue(true);
    readFileSyncFn.mockReturnValue(JSON.stringify(samples));
    expect(mod.loadSamplesManifest()).toEqual(samples);
  });

  it('returns empty array when manifest JSON is invalid', () => {
    existsSyncFn.mockReturnValue(true);
    readFileSyncFn.mockReturnValue('NOT_JSON{{{');
    expect(mod.loadSamplesManifest()).toEqual([]);
  });
});

describe('getVoiceSamplePath', () => {
  it('returns path combining userData voice-samples dir with sample filename', () => {
    const sample = { id: 'abc', name: 'Test', filename: 'abc.wav', createdAt: 1000 };
    const result = mod.getVoiceSamplePath(sample);
    expect(result).toContain('voice-samples');
    expect(result).toContain('abc.wav');
  });

  it('returns different paths for different sample filenames', () => {
    const a = { id: '1', name: 'A', filename: 'a.mp3', createdAt: 1 };
    const b = { id: '2', name: 'B', filename: 'b.ogg', createdAt: 2 };
    expect(mod.getVoiceSamplePath(a)).not.toBe(mod.getVoiceSamplePath(b));
  });
});

describe('setupVoiceIPC — IPC handler registration', () => {
  it('registers VOICE_MODEL_STATUS handle handler', () => {
    mod.setupVoiceIPC();
    expect(handleHandlers.has('voice-model-status')).toBe(true);
  });

  it('registers VOICE_MODEL_DOWNLOAD on handler', () => {
    mod.setupVoiceIPC();
    expect(onHandlers.has('voice-model-download')).toBe(true);
  });

  it('registers VOICE_START_SESSION on handler', () => {
    mod.setupVoiceIPC();
    expect(onHandlers.has('voice-start-session')).toBe(true);
  });

  it('registers VOICE_STOP_SESSION on handler', () => {
    mod.setupVoiceIPC();
    expect(onHandlers.has('voice-stop-session')).toBe(true);
  });

  it('registers VOICE_AUDIO_CHUNK on handler', () => {
    mod.setupVoiceIPC();
    expect(onHandlers.has('voice-audio-chunk')).toBe(true);
  });

  it('registers VOICE_FLUSH on handler', () => {
    mod.setupVoiceIPC();
    expect(onHandlers.has('voice-flush')).toBe(true);
  });

  it('registers VOICE_UPDATE_SILENCE_THRESHOLD on handler', () => {
    mod.setupVoiceIPC();
    expect(onHandlers.has('voice-update-silence-threshold')).toBe(true);
  });

  it('registers VOICE_TTS_GENERATE on handler', () => {
    mod.setupVoiceIPC();
    expect(onHandlers.has('voice-tts-generate')).toBe(true);
  });

  it('registers VOICE_TTS_STOP on handler', () => {
    mod.setupVoiceIPC();
    expect(onHandlers.has('voice-tts-stop')).toBe(true);
  });

  it('registers VOICE_SAMPLE_LIST handle handler', () => {
    mod.setupVoiceIPC();
    expect(handleHandlers.has('voice-sample-list')).toBe(true);
  });

  it('registers VOICE_SAMPLE_UPLOAD handle handler', () => {
    mod.setupVoiceIPC();
    expect(handleHandlers.has('voice-sample-upload')).toBe(true);
  });

  it('registers VOICE_SAMPLE_DELETE handle handler', () => {
    mod.setupVoiceIPC();
    expect(handleHandlers.has('voice-sample-delete')).toBe(true);
  });

  it('registers VOICE_SAMPLE_RENAME handle handler', () => {
    mod.setupVoiceIPC();
    expect(handleHandlers.has('voice-sample-rename')).toBe(true);
  });

  it('registers VOICE_SAMPLE_TRANSCRIBE handle handler', () => {
    mod.setupVoiceIPC();
    expect(handleHandlers.has('voice-sample-transcribe')).toBe(true);
  });

  it('registers VOICE_SAMPLE_GET_PATH handle handler', () => {
    mod.setupVoiceIPC();
    expect(handleHandlers.has('voice-sample-get-path')).toBe(true);
  });
});

describe('VOICE_MODEL_STATUS handler', () => {
  it('returns sttDownloaded and ttsDownloaded true when API reports downloaded', async () => {
    mod.setupVoiceIPC();
    httpGetFn.mockImplementation(
      makeJsonHttpGetMock({ downloaded: true, downloading: false, progress: 1 }),
    );
    const result = await handleHandlers.get('voice-model-status')?.({}, 'en') as {
      sttDownloaded: boolean; ttsDownloaded: boolean; vadDownloaded: boolean;
    };
    expect(result.sttDownloaded).toBe(true);
    expect(result.ttsDownloaded).toBe(true);
    expect(result.vadDownloaded).toBe(true);
  });

  it('checks TTS model status for the requested language', async () => {
    mod.setupVoiceIPC();
    httpGetFn.mockImplementation(
      makeJsonHttpGetMock({ downloaded: true, downloading: false, progress: 1 }),
    );

    await handleHandlers.get('voice-model-status')?.({}, 'ja');

    expect(httpGetFn).toHaveBeenCalledWith(
      expect.stringContaining('/voice/tts/status?language=ja'),
      expect.any(Function),
    );
  });

  it('returns error field when HTTP request fails', async () => {
    mod.setupVoiceIPC();
    httpGetFn.mockImplementation((_url: string, _cb: unknown) => ({
      on(_event: string, cb: (err: Error) => void) {
        if (_event === 'error') Promise.resolve().then(() => cb(new Error('connection refused')));
        return this;
      },
    }));
    const result = await handleHandlers.get('voice-model-status')?.({}, 'en') as { error: string };
    expect(result.error).toContain('connection refused');
  });

  it('defaults sttDownloaded and ttsDownloaded to false when API fails', async () => {
    mod.setupVoiceIPC();
    httpGetFn.mockImplementation((_url: string, _cb: unknown) => ({
      on(_evt: string, cb: (e: Error) => void) {
        if (_evt === 'error') Promise.resolve().then(() => cb(new Error('fail')));
        return this;
      },
    }));
    const result = await handleHandlers.get('voice-model-status')?.({}, 'en') as {
      sttDownloaded: boolean; ttsDownloaded: boolean;
    };
    expect(result.sttDownloaded).toBe(false);
    expect(result.ttsDownloaded).toBe(false);
  });
});

describe('VOICE_START_SESSION and VOICE_STOP_SESSION', () => {
  it('creates a WebSocket when startSession is called', () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    onHandlers.get('voice-start-session')?.(event, 'en', 'vad', 1.5);
    expect(lastCreatedWebSocket).not.toBeNull();
  });

  it('includes language and silence threshold in the WebSocket URL', () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    onHandlers.get('voice-start-session')?.(event, 'ja', 'vad', 2.0);
    expect(lastCreatedWebSocket?.url).toContain('language=ja');
    expect(lastCreatedWebSocket?.url).toContain('silence=2');
  });

  it('includes quit token in WebSocket URL when available', () => {
    mockQuitToken = 'abc123def456';
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    onHandlers.get('voice-start-session')?.(event, 'en', 'vad', 1.5);
    expect(lastCreatedWebSocket?.url).toContain('token=abc123def456');
    mockQuitToken = null;
  });

  it('waits for quit token and connects when it becomes available', () => {
    vi.useFakeTimers();
    mockQuitToken = null;
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    onHandlers.get('voice-start-session')?.(event, 'en', 'vad', 1.5);
    expect(lastCreatedWebSocket).toBeNull();

    mockQuitToken = 'delayed-token';
    vi.advanceTimersByTime(100);
    expect(lastCreatedWebSocket).not.toBeNull();
    expect(lastCreatedWebSocket?.url).toContain('token=delayed-token');
    vi.useRealTimers();
  });

  it('sends VOICE_SESSION_ERROR when quit token does not arrive within timeout', () => {
    vi.useFakeTimers();
    mockQuitToken = null;
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    onHandlers.get('voice-start-session')?.(event, 'en', 'vad', 1.5);
    vi.advanceTimersByTime(5100);
    expect(lastCreatedWebSocket).toBeNull();
    expect(event.sender.send).toHaveBeenCalledWith(
      'voice-session-error',
      expect.objectContaining({
        error: 'Voice backend is not ready. Please wait a moment and try again.',
      }),
    );
    vi.useRealTimers();
  });

  it('closes the WebSocket when stopSession is called', () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    onHandlers.get('voice-start-session')?.(event, 'en', 'vad', 1.5);
    const ws = lastCreatedWebSocket;
    onHandlers.get('voice-stop-session')?.(event);
    expect(ws?.close).toHaveBeenCalled();
  });

  it('closes previous WebSocket when a new session is started', () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    onHandlers.get('voice-start-session')?.(event, 'en', 'vad', 1.5);
    const firstWs = lastCreatedWebSocket;
    onHandlers.get('voice-start-session')?.(event, 'ja', 'vad', 1.5);
    expect(firstWs?.close).toHaveBeenCalled();
  });

  it('sends VOICE_SESSION_READY to sender when WS receives ready message', () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    onHandlers.get('voice-start-session')?.(event, 'en', 'vad', 1.5);
    lastCreatedWebSocket?._emit('message', JSON.stringify({ type: 'ready' }));
    expect(event.sender.send).toHaveBeenCalledWith('voice-session-ready', { ready: true });
  });

  it('sends VOICE_STT_RESULT to sender when WS receives stt message', () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    onHandlers.get('voice-start-session')?.(event, 'en', 'vad', 1.5);
    lastCreatedWebSocket?._emit('message', JSON.stringify({ type: 'stt', text: 'hello world', isFinal: true }));
    expect(event.sender.send).toHaveBeenCalledWith('voice-stt-result', {
      text: 'hello world',
      isFinal: true,
      isPartial: false,
    });
  });

  it('sends VOICE_VAD_EVENT to sender when WS receives vad message', () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    onHandlers.get('voice-start-session')?.(event, 'en', 'vad', 1.5);
    lastCreatedWebSocket?._emit('message', JSON.stringify({ type: 'vad', event: 'speech_start' }));
    expect(event.sender.send).toHaveBeenCalledWith('voice-vad-event', { type: 'speech_start' });
  });

  it('sends VOICE_SESSION_ERROR to sender when WS receives error message', () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    onHandlers.get('voice-start-session')?.(event, 'en', 'vad', 1.5);
    lastCreatedWebSocket?._emit('message', JSON.stringify({ type: 'error', message: 'backend crashed' }));
    expect(event.sender.send).toHaveBeenCalledWith('voice-session-error', { error: 'backend crashed' });
  });

  it('sends VOICE_SESSION_ERROR to sender on WebSocket error event', () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    onHandlers.get('voice-start-session')?.(event, 'en', 'vad', 1.5);
    lastCreatedWebSocket?._emit('error', new Error('ECONNREFUSED'));
    expect(event.sender.send).toHaveBeenCalledWith(
      'voice-session-error',
      expect.objectContaining({ error: 'ECONNREFUSED' }),
    );
  });

  it('uses default silence threshold of 1.5 when not provided', () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    onHandlers.get('voice-start-session')?.(event, 'en', 'vad');
    expect(lastCreatedWebSocket?.url).toContain('silence=1.5');
  });
});

describe('VOICE_AUDIO_CHUNK handler', () => {
  it('sends audio buffer over WebSocket when session is active', () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    onHandlers.get('voice-start-session')?.(event, 'en', 'vad', 1.5);
    onHandlers.get('voice-audio-chunk')?.({}, new Float32Array([0.1, 0.2, 0.3]));
    expect(lastCreatedWebSocket?.send).toHaveBeenCalled();
  });

  it('does not send audio when WebSocket readyState is not OPEN', () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    onHandlers.get('voice-start-session')?.(event, 'en', 'vad', 1.5);
    if (lastCreatedWebSocket) lastCreatedWebSocket.readyState = MockWebSocket.CLOSED;
    onHandlers.get('voice-audio-chunk')?.({}, new Float32Array([0.5]));
    expect(lastCreatedWebSocket?.send).not.toHaveBeenCalled();
  });
});

describe('VOICE_FLUSH handler', () => {
  it('sends flush JSON message over WebSocket when session is active', () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    onHandlers.get('voice-start-session')?.(event, 'en', 'vad', 1.5);
    onHandlers.get('voice-flush')?.({});
    expect(lastCreatedWebSocket?.send).toHaveBeenCalledWith(JSON.stringify({ type: 'flush' }));
  });

  it('does not throw when flush is called with no active session', () => {
    mod.setupVoiceIPC();
    expect(() => onHandlers.get('voice-flush')?.({}) ).not.toThrow();
  });
});

describe('VOICE_UPDATE_SILENCE_THRESHOLD handler', () => {
  it('sends silence_threshold message with new value over WebSocket', () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    onHandlers.get('voice-start-session')?.(event, 'en', 'vad', 1.5);
    onHandlers.get('voice-update-silence-threshold')?.({}, 2.5);
    expect(lastCreatedWebSocket?.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'silence_threshold', value: 2.5 }),
    );
  });
});

describe('VOICE_TTS_STOP handler', () => {
  it('sends VOICE_TTS_STATUS with generating:false when stopped', () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    onHandlers.get('voice-tts-stop')?.(event);
    expect(event.sender.send).toHaveBeenCalledWith('voice-tts-status', { generating: false, playing: false });
  });

  it('closes the active local TTS WebSocket and ignores late audio frames', async () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();

    httpGetFn.mockImplementation(makeJsonHttpGetMock({ loaded: true }));
    existsSyncFn.mockReturnValue(false);
    readFileSyncFn.mockReturnValue('[]');

    onHandlers.get('voice-tts-generate')?.(event, 'Stop me', 'en', 1.0, undefined, 'qwen3');
    await flushMicrotasks();
    const ws = lastCreatedWebSocket;
    ws?._emit('open');

    onHandlers.get('voice-tts-stop')?.(event);

    expect(ws?.close).toHaveBeenCalled();

    ws?._emit('message', JSON.stringify({
      type: 'audio',
      sampleRate: 24000,
      sampleCount: 1,
      byteLength: 4,
      encoding: 'f32le',
    }));
    ws?._emit('message', Buffer.from(new Float32Array([0.5]).buffer), true);
    await flushMicrotasks();

    const audioCalls = event.sender.send.mock.calls.filter((c) => c[0] === 'voice-tts-audio');
    expect(audioCalls).toHaveLength(0);
  });
});

describe('VOICE_SAMPLE_LIST handler', () => {
  it('returns empty array when no samples exist', () => {
    mod.setupVoiceIPC();
    existsSyncFn.mockReturnValue(false);
    readFileSyncFn.mockReturnValue('[]');
    expect(handleHandlers.get('voice-sample-list')?.({}) ).toEqual([]);
  });

  it('returns only samples whose audio files exist on disk', () => {
    mod.setupVoiceIPC();
    const samples = [
      { id: 'a', name: 'A', filename: 'a.wav', createdAt: 1 },
      { id: 'b', name: 'B', filename: 'b.wav', createdAt: 2 },
    ];
    existsSyncFn.mockImplementation((p: string) => {
      if ((p as string).endsWith('voice-samples.json')) return true;
      return (p as string).includes('a.wav');
    });
    readFileSyncFn.mockReturnValue(JSON.stringify(samples));

    const result = handleHandlers.get('voice-sample-list')?.({}) as typeof samples;
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a');
  });

  it('persists a cleaned manifest when orphaned samples are pruned', () => {
    mod.setupVoiceIPC();
    const samples = [
      { id: 'a', name: 'A', filename: 'a.wav', createdAt: 1 },
      { id: 'b', name: 'B', filename: 'b.wav', createdAt: 2 },
    ];
    existsSyncFn.mockImplementation((p: string) => {
      if ((p as string).endsWith('voice-samples.json')) return true;
      return (p as string).includes('a.wav');
    });
    readFileSyncFn.mockReturnValue(JSON.stringify(samples));

    handleHandlers.get('voice-sample-list')?.({});
    expect(writeFileSyncFn).toHaveBeenCalled();
  });
});

describe('VOICE_SAMPLE_UPLOAD handler', () => {
  it('copies source file and returns a VoiceSample with correct fields', async () => {
    mod.setupVoiceIPC();
    existsSyncFn.mockReturnValue(false);
    readFileSyncFn.mockReturnValue('[]');

    const result = await handleHandlers.get('voice-sample-upload')?.({}, '/tmp/recording.wav', 'My Voice') as {
      id: string; name: string; filename: string; createdAt: number;
    };
    expect(result.name).toBe('My Voice');
    expect(result.filename).toMatch(/\.wav$/);
    expect(result.id).toBeTruthy();
    expect(typeof result.createdAt).toBe('number');
    expect(copyFileSyncFn).toHaveBeenCalledWith('/tmp/recording.wav', expect.stringContaining('.wav'));
  });

  it('persists the new sample to the manifest after upload', async () => {
    mod.setupVoiceIPC();
    existsSyncFn.mockReturnValue(true);
    readFileSyncFn.mockReturnValue('[]');

    await handleHandlers.get('voice-sample-upload')?.({}, '/tmp/voice.mp3', 'Voice');
    expect(writeFileSyncFn).toHaveBeenCalled();
    const written = JSON.parse(writeFileSyncFn.mock.calls[0][1] as string);
    expect(written).toHaveLength(1);
  });

  it('preserves existing samples in the manifest when uploading a new one', async () => {
    mod.setupVoiceIPC();
    const existing = [{ id: 'x', name: 'X', filename: 'x.wav', createdAt: 1 }];
    existsSyncFn.mockReturnValue(true);
    readFileSyncFn.mockReturnValue(JSON.stringify(existing));

    await handleHandlers.get('voice-sample-upload')?.({}, '/tmp/new.wav', 'New');
    const written = JSON.parse(writeFileSyncFn.mock.calls[0][1] as string);
    expect(written).toHaveLength(2);
  });
});

describe('VOICE_SAMPLE_DELETE handler', () => {
  it('returns false when the sample id does not exist in the manifest', () => {
    mod.setupVoiceIPC();
    existsSyncFn.mockImplementation((p: string) => (p as string).endsWith('.json'));
    readFileSyncFn.mockReturnValue('[]');
    expect(handleHandlers.get('voice-sample-delete')?.({}, 'nonexistent')).toBe(false);
  });

  it('deletes the audio file and removes sample from the manifest', () => {
    mod.setupVoiceIPC();
    const samples = [{ id: 'del1', name: 'Del', filename: 'del1.wav', createdAt: 1 }];
    existsSyncFn.mockReturnValue(true);
    readFileSyncFn.mockReturnValue(JSON.stringify(samples));

    const result = handleHandlers.get('voice-sample-delete')?.({}, 'del1');
    expect(result).toBe(true);
    expect(unlinkSyncFn).toHaveBeenCalled();
    const written = JSON.parse(writeFileSyncFn.mock.calls[0][1] as string);
    expect(written).toHaveLength(0);
  });

  it('skips unlinkSync when audio file does not exist on disk', () => {
    mod.setupVoiceIPC();
    const samples = [{ id: 'del2', name: 'Del2', filename: 'del2.wav', createdAt: 1 }];
    existsSyncFn.mockImplementation((p: string) => (p as string).endsWith('.json'));
    readFileSyncFn.mockReturnValue(JSON.stringify(samples));

    const result = handleHandlers.get('voice-sample-delete')?.({}, 'del2');
    expect(result).toBe(true);
    expect(unlinkSyncFn).not.toHaveBeenCalled();
  });
});

describe('VOICE_SAMPLE_RENAME handler', () => {
  it('returns false when sample id does not exist', () => {
    mod.setupVoiceIPC();
    existsSyncFn.mockReturnValue(false);
    readFileSyncFn.mockReturnValue('[]');
    expect(handleHandlers.get('voice-sample-rename')?.({}, 'missing', 'New Name')).toBe(false);
  });

  it('updates sample name and saves updated manifest', () => {
    mod.setupVoiceIPC();
    const samples = [{ id: 'r1', name: 'Old Name', filename: 'r1.wav', createdAt: 1 }];
    existsSyncFn.mockReturnValue(true);
    readFileSyncFn.mockReturnValue(JSON.stringify(samples));

    const result = handleHandlers.get('voice-sample-rename')?.({}, 'r1', 'New Name');
    expect(result).toBe(true);
    const written = JSON.parse(writeFileSyncFn.mock.calls[0][1] as string);
    expect(written[0].name).toBe('New Name');
  });
});

describe('VOICE_SAMPLE_TRANSCRIBE handler', () => {
  it('throws when sample id is not found in the manifest', async () => {
    mod.setupVoiceIPC();
    existsSyncFn.mockReturnValue(false);
    readFileSyncFn.mockReturnValue('[]');
    await expect(handleHandlers.get('voice-sample-transcribe')?.({}, 'missing')).rejects.toThrow('Voice sample not found');
  });

  it('posts selected language to transcribe API and returns text and language', async () => {
    mod.setupVoiceIPC();
    const samples = [{ id: 'tr1', name: 'Test', filename: 'tr1.wav', createdAt: 1 }];
    existsSyncFn.mockReturnValue(true);
    readFileSyncFn.mockReturnValue(JSON.stringify(samples));
    const writtenChunks: string[] = [];
    httpRequestFn.mockImplementation((_opts: unknown, cb: (res: ReturnType<typeof makeFakeResponse>) => void) => {
      const body = JSON.stringify({ text: 'hello there', language: 'fa' });
      const fakeRes = makeFakeResponse(200, Buffer.from(body));
      cb(fakeRes);
      return {
        write: vi.fn((chunk: string | Buffer) => writtenChunks.push(chunk.toString())),
        end: vi.fn(() => {
          Promise.resolve().then(() => {
            fakeRes._emit('data', Buffer.from(body));
            fakeRes._emit('end');
          });
        }),
        on: vi.fn(),
      };
    });

    const result = await handleHandlers.get('voice-sample-transcribe')?.({}, 'tr1', 'fa') as {
      text: string; language: string;
    };
    expect(result.text).toBe('hello there');
    expect(result.language).toBe('fa');
    expect(JSON.parse(writtenChunks.join(''))).toMatchObject({ language: 'fa' });
  });

  it('throws when transcription response contains a detail error', async () => {
    mod.setupVoiceIPC();
    const samples = [{ id: 'tr2', name: 'Test', filename: 'tr2.wav', createdAt: 1 }];
    existsSyncFn.mockReturnValue(true);
    readFileSyncFn.mockReturnValue(JSON.stringify(samples));
    httpRequestFn.mockImplementation(makeJsonHttpRequestMock({ detail: 'STT model not loaded' }));
    await expect(handleHandlers.get('voice-sample-transcribe')?.({}, 'tr2')).rejects.toThrow('STT model not loaded');
  });

  it('saves transcript to a sidecar txt file after successful transcription', async () => {
    mod.setupVoiceIPC();
    const samples = [{ id: 'tr3', name: 'Test', filename: 'tr3.wav', createdAt: 1 }];
    existsSyncFn.mockReturnValue(true);
    readFileSyncFn.mockReturnValue(JSON.stringify(samples));
    httpRequestFn.mockImplementation(makeJsonHttpRequestMock({ text: 'saved transcript', language: 'en' }));

    await handleHandlers.get('voice-sample-transcribe')?.({}, 'tr3');
    const txtWrite = writeFileSyncFn.mock.calls.find((c) => (c[0] as string).endsWith('.txt'));
    expect(txtWrite).toBeDefined();
    expect(txtWrite?.[1]).toBe('saved transcript');
  });
});

describe('VOICE_SAMPLE_GET_PATH handler', () => {
  it('returns null when sample id is not found', async () => {
    mod.setupVoiceIPC();
    existsSyncFn.mockReturnValue(false);
    readFileSyncFn.mockReturnValue('[]');
    expect(await handleHandlers.get('voice-sample-get-path')?.({}, 'notexist')).toBeNull();
  });

  it('returns null when audio file does not exist on disk', async () => {
    mod.setupVoiceIPC();
    const samples = [{ id: 'gp1', name: 'GP', filename: 'gp1.wav', createdAt: 1 }];
    existsSyncFn.mockImplementation((p: string) => (p as string).endsWith('.json'));
    readFileSyncFn.mockReturnValue(JSON.stringify(samples));
    expect(await handleHandlers.get('voice-sample-get-path')?.({}, 'gp1')).toBeNull();
  });

  it('returns a base64 data URL when the audio file exists', async () => {
    mod.setupVoiceIPC();
    const samples = [{ id: 'gp2', name: 'GP2', filename: 'gp2.wav', createdAt: 1 }];
    existsSyncFn.mockReturnValue(true);
    readFileSyncFn.mockImplementation((p: string) => {
      if ((p as string).endsWith('.json')) return JSON.stringify(samples);
      return Buffer.from([0x52, 0x49, 0x46, 0x46]);
    });
    const result = await handleHandlers.get('voice-sample-get-path')?.({}, 'gp2') as string;
    expect(result).toMatch(/^data:audio\//);
    expect(result).toContain(';base64,');
  });

  it('uses audio/mpeg MIME type for mp3 files', async () => {
    mod.setupVoiceIPC();
    const samples = [{ id: 'mp3s', name: 'MP3', filename: 'mp3s.mp3', createdAt: 1 }];
    existsSyncFn.mockReturnValue(true);
    readFileSyncFn.mockImplementation((p: string) => {
      if ((p as string).endsWith('.json')) return JSON.stringify(samples);
      return Buffer.from([0xff, 0xfb]);
    });
    const result = await handleHandlers.get('voice-sample-get-path')?.({}, 'mp3s') as string;
    expect(result).toContain('audio/mpeg');
  });
});

describe('VOICE_MODEL_DOWNLOAD handler', () => {
  it('emits initial downloading progress with progress value 0', async () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();

    httpGetFn.mockImplementation((_url: string, _cb: unknown) => ({
      on: (_evt: string, cb: (e: Error) => void) => {
        if (_evt === 'error') Promise.resolve().then(() => cb(new Error('not running')));
        return { on: vi.fn() };
      },
    }));

    await onHandlers.get('voice-model-download')?.(event, 'en');

    const firstCall = event.sender.send.mock.calls[0];
    expect(firstCall[0]).toBe('voice-model-download-progress');
    expect(firstCall[1]).toMatchObject({ downloading: true, progress: 0 });
  });

  it('emits error progress when pip install process exits with non-zero code', async () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();

    httpGetFn.mockImplementation(makeJsonHttpGetMock({ downloaded: false, downloading: false, progress: 0 }));
    readFileSyncFn.mockImplementation((p: string) => {
      if ((p as string).includes('pip_requirements')) return JSON.stringify({ voice: ['faster-whisper'] });
      return '[]';
    });
    existsSyncFn.mockReturnValue(true);

    const mockChildProcess = new MockChildProcess();
    spawnFn.mockReturnValue(mockChildProcess);

    const handlerPromise = onHandlers.get('voice-model-download')?.(event, 'en');

    await flushMicrotasks();

    mockChildProcess._emit('close', 1);
    await handlerPromise;

    const errorCall = event.sender.send.mock.calls.find((c) => c[1]?.error === 'voice-packages-install-failed');
    expect(errorCall).toBeTruthy();
  });

  it('emits multiple progress updates when pip install succeeds and model download runs', async () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();

    let httpGetCallCount = 0;
    httpGetFn.mockImplementation((_url: string, cb: (res: ReturnType<typeof makeFakeResponse>) => void) => {
      httpGetCallCount++;
      const downloaded = httpGetCallCount > 2;
      const body = JSON.stringify({ downloaded, downloading: false, progress: 1 });
      const fakeRes = makeFakeResponse(200, Buffer.from(body));
      cb(fakeRes);
      Promise.resolve().then(() => {
        fakeRes._emit('data', body);
        fakeRes._emit('end');
      });
      return { on: vi.fn() };
    });

    readFileSyncFn.mockImplementation((p: string) => {
      if ((p as string).includes('pip_requirements')) return JSON.stringify({ voice: ['faster-whisper'] });
      return '[]';
    });
    existsSyncFn.mockReturnValue(true);

    const mockChildProcess = new MockChildProcess();
    spawnFn.mockReturnValue(mockChildProcess);

    httpRequestFn.mockImplementation(makeJsonHttpRequestMock({}));

    const handlerPromise = onHandlers.get('voice-model-download')?.(event, 'en');

    await flushMicrotasks();

    mockChildProcess._emit('close', 0);
    await handlerPromise;

    const progressCalls = event.sender.send.mock.calls.filter((c) => c[0] === 'voice-model-download-progress');
    expect(progressCalls.length).toBeGreaterThan(1);
  });

  it('installs Qwen3 dependency group when the requested TTS engine is Qwen3', async () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();

    httpGetFn.mockImplementation((url: string, cb: (res: ReturnType<typeof makeFakeResponse>) => void) => {
      const isTtsStatus = url.includes('/voice/tts/status');
      const body = JSON.stringify({
        downloaded: false,
        loaded: false,
        downloading: false,
        progress: 0,
        modelName: isTtsStatus ? 'Qwen3-TTS-12Hz-0.6B-MLX' : 'openai/whisper-small',
      });
      const fakeRes = makeFakeResponse(200, Buffer.from(body));
      cb(fakeRes);
      Promise.resolve().then(() => {
        fakeRes._emit('data', body);
        fakeRes._emit('end');
      });
      return { on: vi.fn() };
    });

    readFileSyncFn.mockImplementation((p: string) => {
      if ((p as string).includes('pip_requirements')) {
        return JSON.stringify({ voice: ['faster-whisper'], 'qwen3-tts': ['mlx-audio'] });
      }
      return '[]';
    });
    existsSyncFn.mockReturnValue(true);

    const mockChildProcess = new MockChildProcess();
    spawnFn.mockReturnValue(mockChildProcess);

    const handlerPromise = onHandlers.get('voice-model-download')?.(event, 'fa');
    await flushMicrotasks();
    mockChildProcess._emit('close', 1);
    await handlerPromise;

    expect(spawnFn).toHaveBeenCalledWith(
      '/env/bin/pip',
      expect.arrayContaining(['install', 'faster-whisper', 'qwen3-tts-package']),
      expect.any(Object),
    );
  });

  it('downloads TTS models for the requested language', async () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();

    httpGetFn.mockImplementation(makeJsonHttpGetMock({ downloaded: true, downloading: false, progress: 1 }));
    httpRequestFn.mockImplementation(makeJsonHttpRequestMock({ success: true }));

    await onHandlers.get('voice-model-download')?.(event, 'ja');

    expect(httpRequestFn).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringContaining('/voice/models/download?language=ja'),
      }),
      expect.any(Function),
    );
  });

  it('polls Python model status while model download is still running', async () => {
    vi.useFakeTimers();
    mod.setupVoiceIPC();
    const event = createFakeEvent();

    let httpGetCallCount = 0;
    httpGetFn.mockImplementation((_url: string, cb: (res: ReturnType<typeof makeFakeResponse>) => void) => {
      httpGetCallCount++;
      const isPoll = httpGetCallCount > 2 && httpGetCallCount <= 4;
      const body = JSON.stringify({
        downloaded: true,
        downloading: isPoll,
        progress: isPoll ? 0.4 : 1,
      });
      const fakeRes = makeFakeResponse(200, Buffer.from(body));
      cb(fakeRes);
      Promise.resolve().then(() => {
        fakeRes._emit('data', body);
        fakeRes._emit('end');
      });
      return { on: vi.fn() };
    });

    httpRequestFn.mockImplementation((_opts: unknown, cb: (res: ReturnType<typeof makeFakeResponse>) => void) => {
      const body = JSON.stringify({ success: true });
      const fakeRes = makeFakeResponse(200, Buffer.from(body));
      cb(fakeRes);
      return {
        write: vi.fn(),
        end: vi.fn(() => {
          setTimeout(() => {
            fakeRes._emit('data', Buffer.from(body));
            fakeRes._emit('end');
          }, 1500);
        }),
        on: vi.fn(),
      };
    });

    const handlerPromise = onHandlers.get('voice-model-download')?.(event, 'en');
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(1000);
    await flushMicrotasks();

    expect(event.sender.send).toHaveBeenCalledWith(
      'voice-model-download-progress',
      expect.objectContaining({
        downloading: true,
        progress: 0.7,
      }),
    );

    await vi.advanceTimersByTimeAsync(500);
    await handlerPromise;
  });
});

describe('VOICE_TTS_GENERATE handler — local TTS', () => {
  it('opens the local TTS stream websocket and sends the generation payload', async () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();

    httpGetFn.mockImplementation(makeJsonHttpGetMock({ loaded: true, downloading: false, progress: 1 }));
    existsSyncFn.mockReturnValue(false);
    readFileSyncFn.mockReturnValue('[]');

    onHandlers.get('voice-tts-generate')?.(event, 'Hello', 'en', 1.25, undefined, 'qwen3');
    await flushMicrotasks();
    lastCreatedWebSocket?._emit('open');

    expect(lastCreatedWebSocket?.url).toContain('/voice/tts/stream');
    expect(lastCreatedWebSocket?.send).toHaveBeenCalledWith(JSON.stringify({
      text: 'Hello',
      language: 'en',
      speed: 1.25,
      provider: 'qwen3',
    }));
  });

  it('checks TTS loading status for the requested speech language', async () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();

    httpGetFn.mockImplementation(makeJsonHttpGetMock({ loaded: true, downloading: false, progress: 1 }));

    onHandlers.get('voice-tts-generate')?.(event, 'こんにちは', 'ja', 1.0, undefined, 'qwen3');
    await new Promise((r) => setTimeout(r, 50));

    expect(httpGetFn).toHaveBeenCalledWith(
      expect.stringContaining('/voice/tts/status?language=ja'),
      expect.any(Function),
    );
  });

  it('sends VOICE_TTS_AUDIO with binary PCM samples and sampleRate after successful TTS response', async () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();

    httpGetFn.mockImplementation(makeJsonHttpGetMock({ loaded: true }));
    existsSyncFn.mockReturnValue(false);
    readFileSyncFn.mockReturnValue('[]');

    onHandlers.get('voice-tts-generate')?.(event, 'Test audio', 'en', 1.0, undefined, 'qwen3');
    await flushMicrotasks();
    lastCreatedWebSocket?._emit('open');
    lastCreatedWebSocket?._emit('message', JSON.stringify({
      type: 'audio',
      sampleRate: 24000,
      sentenceIndex: 0,
      sentenceText: 'Test audio',
      totalSentences: 1,
      chunkIndex: 0,
      sampleCount: 4,
      byteLength: 16,
      encoding: 'f32le',
    }));
    lastCreatedWebSocket?._emit('message', Buffer.from(new Float32Array([0, 0.5, -0.5, 1]).buffer), true);
    await new Promise((r) => setTimeout(r, 50));

    const audioCalls = event.sender.send.mock.calls.filter((c) => c[0] === 'voice-tts-audio');
    expect(audioCalls.length).toBeGreaterThanOrEqual(1);
    expect(audioCalls[0][1]).toMatchObject({
      sampleRate: 24000,
      sentenceIndex: 0,
      sentenceText: 'Test audio',
      totalSentences: 1,
      sampleCount: 4,
    });
    expect(Array.from(audioCalls[0][1].samples)).toEqual([0, 0.5, -0.5, 1]);
  });

  it('transcribes a selected Qwen3 voice sample before starting the local TTS stream when transcript is missing', async () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    const samples = [{ id: 'sample-1', name: 'Clone', filename: 'sample-1.wav', createdAt: 1 }];
    const writtenRequests: string[] = [];

    httpGetFn.mockImplementation(makeJsonHttpGetMock({ loaded: true }));
    existsSyncFn.mockImplementation((p: string) => {
      const path = String(p);
      if (path.endsWith('voice-samples.json')) return true;
      if (path.endsWith('sample-1.wav')) return true;
      if (path.endsWith('sample-1.txt')) return false;
      return false;
    });
    readFileSyncFn.mockImplementation((p: string) => {
      if (String(p).endsWith('voice-samples.json')) return JSON.stringify(samples);
      return '';
    });
    httpRequestFn.mockImplementation((_opts: unknown, cb: (res: ReturnType<typeof makeFakeResponse>) => void) => {
      const body = JSON.stringify({ text: 'reference transcript', language: 'en' });
      const fakeRes = makeFakeResponse(200, Buffer.from(body));
      cb(fakeRes);
      return {
        write: vi.fn((chunk: string | Buffer) => writtenRequests.push(chunk.toString())),
        end: vi.fn(() => {
          Promise.resolve().then(() => {
            fakeRes._emit('data', Buffer.from(body));
            fakeRes._emit('end');
          });
        }),
        on: vi.fn(),
      };
    });

    onHandlers.get('voice-tts-generate')?.(event, 'Speak with clone', 'en', 1.0, 'sample-1', 'qwen3');
    await flushMicrotasks();
    lastCreatedWebSocket?._emit('open');

    expect(JSON.parse(writtenRequests.join(''))).toMatchObject({
      language: 'en',
      voiceSamplePath: expect.stringContaining('sample-1.wav'),
    });
    expect(writeFileSyncFn.mock.calls).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          expect.stringContaining('sample-1.txt'),
          'reference transcript',
          'utf-8',
        ]),
      ]),
    );
    expect(lastCreatedWebSocket?.send).toHaveBeenCalledWith(expect.stringContaining('"voiceSamplePath"'));
  });
});

describe('VOICE_TTS_GENERATE handler — removed cloud TTS stream', () => {
  it('does not call the online streaming service when cloud provider is specified', async () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();

    onHandlers.get('voice-tts-generate')?.(event, 'Hello cloud', 'en', 1.0, undefined, 'cloud');
    await flushMicrotasks();

    expect(httpRequestFn).not.toHaveBeenCalled();
    expect(httpsRequestFn).not.toHaveBeenCalled();
    expect(lastCreatedWebSocket).toBeNull();

    const statusCalls = event.sender.send.mock.calls.filter((c) => c[0] === 'voice-tts-status');
    expect(statusCalls.at(-1)?.[1]).toMatchObject({ generating: false, playing: false });
  });
});
