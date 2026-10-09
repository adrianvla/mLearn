import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { createTempDir } from '../../../test/helpers/tempDir';
import type { TempDir } from '../../../test/helpers/tempDir';
import type { VoiceModelStatus } from '../../shared/types';

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
  headers?: Record<string, string>;
  readyState: number;
  private _listeners = new Map<string, WsEventCallback[]>();
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
    this._emit('close');
  });

  constructor(url: string, options?: { headers?: Record<string, string> }) {
    this.url = url;
    this.headers = options?.headers;
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
let mockQuitTokenAvailableCallback: ((token: string) => void) | null = null;
let mockPipRequirements: Record<string, string[]> = {
  voice: ['faster-whisper'],
  'qwen3-tts': ['qwen3-tts-package'],
};
vi.mock('./pythonBackend', () => ({
  getQuitToken: () => mockQuitToken,
  onQuitTokenAvailable: (callback: (token: string) => void) => {
    if (mockQuitToken) {
      queueMicrotask(() => callback(mockQuitToken!));
      return () => undefined;
    }
    mockQuitTokenAvailableCallback = callback;
    return () => {
      if (mockQuitTokenAvailableCallback === callback) {
        mockQuitTokenAvailableCallback = null;
      }
    };
  },
  readResourceFile: (...segments: string[]) => {
    const path = segments.join('/');
    if (path.includes('pip_requirements')) {
      return JSON.stringify(mockPipRequirements);
    }
    return '';
  },
}));

type SpawnEventCallback = (...args: unknown[]) => void;

class MockChildProcess {
  stdout = { on: vi.fn() };
  stderr = { on: vi.fn() };
  kill = vi.fn();
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
const execFileFn = vi.fn();
vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => execFileFn(...args),
  spawn: (...args: unknown[]) => spawnFn(...args),
}));

const platformFlags = vi.hoisted(() => ({ isLinux: false, isMac: false, isWindows: false }));

vi.mock('../utils/platform', () => ({
  getAppPath: vi.fn(() => '/app'),
  getResourcePath: vi.fn(() => '/resources'),
  getPipExecutablePath: vi.fn(() => '/env/bin/pip'),
  getPythonExecutablePath: vi.fn(() => '/env/bin/python'),
  getBundledDistElectronPath: vi.fn((...segments: string[]) => ['/dist-electron', ...segments].join('/')),
  get isLinux() {
    return platformFlags.isLinux;
  },
  get isMac() {
    return platformFlags.isMac;
  },
  get isWindows() {
    return platformFlags.isWindows;
  },
}));

const loadSettingsFn = vi.fn();
vi.mock('./settings', () => ({
  loadLangData: vi.fn(() => ({ en: { language: 'en', runtime: { tts: { macosVoice: 'Package Voice', espeakVoice: 'en', windowsVoice: 'Package Voice' } } } })),
  loadSettings: (...args: unknown[]) => loadSettingsFn(...args),
}));

async function flushMicrotasks(depth = 20) {
  for (let i = 0; i < depth; i++) {
    await Promise.resolve();
  }
}

function createSender(destroyed = false) {
  const listeners = new Map<string, () => void>();
  return { send: vi.fn(), isDestroyed: vi.fn(() => destroyed), id: 1,
    once: vi.fn((event: string, callback: () => void) => { listeners.set(event, callback); }),
    removeListener: vi.fn((event: string, callback: () => void) => { if (listeners.get(event) === callback) listeners.delete(event); }),
    destroy: () => { destroyed = true; listeners.get('destroyed')?.(); },
  };
}

function createFakeEvent(opts?: { destroyed?: boolean }) {
  return { sender: createSender(opts?.destroyed ?? false) };
}

interface FakeResponse {
  statusCode: number;
  headers: Record<string, string>;
  resume: Mock;
  destroy: Mock;
  on(event: string, cb: (...args: unknown[]) => void): unknown;
  _emit(event: string, ...args: unknown[]): void;
}

function makeFakeResponse(
  statusCode: number,
  _payload: Buffer | string,
  headers: Record<string, string> = {},
): FakeResponse {
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

/** GET mock that answers /voice/stt/status and /voice/tts/status separately. */
function mockStatusEndpoint(sttStatus: Record<string, unknown>, ttsStatus: Record<string, unknown>): void {
  httpGetFn.mockImplementation((opts: { path?: string } | string, cb: (res: FakeResponse) => void) => {
    const urlPath = typeof opts === 'string' ? opts : (opts.path ?? '');
    const payload = urlPath.includes('/voice/stt/status')
      ? sttStatus
      : urlPath.includes('/voice/tts/status')
        ? ttsStatus
        : { downloaded: true, downloading: false, progress: 1 };
    const body = JSON.stringify(payload);
    const fakeRes = makeFakeResponse(200, Buffer.from(body));
    cb(fakeRes);
    Promise.resolve().then(() => {
      fakeRes._emit('data', body);
      fakeRes._emit('end');
    });
    return { on: vi.fn() };
  });
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
  mockQuitTokenAvailableCallback = null;
  platformFlags.isLinux = false;
  platformFlags.isMac = false;
  platformFlags.isWindows = false;

  existsSyncFn.mockReturnValue(false);
  readFileSyncFn.mockReturnValue('[]');

  mockPipRequirements = { voice: ['faster-whisper'], 'qwen3-tts': ['qwen3-tts-package'] };

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

  it('reports the backend-selected TTS model instead of an unrelated hardcoded provider', async () => {
    mod.setupVoiceIPC();
    mockStatusEndpoint({ downloaded: true, modelName: 'configured-stt' },
      { downloaded: true, modelName: 'Qwen3-TTS-installed', engine: 'qwen3' });
    const result = await handleHandlers.get('voice-model-status')?.({}, 'test-language');
    expect(result).toMatchObject({ sttModelName: 'configured-stt', ttsModelName: 'Qwen3-TTS-installed' });
  });

  it('checks TTS model status for the requested language', async () => {
    mod.setupVoiceIPC();
    httpGetFn.mockImplementation(
      makeJsonHttpGetMock({ downloaded: true, downloading: false, progress: 1 }),
    );

    await handleHandlers.get('voice-model-status')?.({}, 'ja');

    expect(httpGetFn).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining('/voice/tts/status?language=ja') }),
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

describe('VOICE_MODEL_STATUS — device/cpuWarning relay', () => {
  it('attaches device cpu and cpuWarning when the backend TTS status reports device cpu', async () => {
    mod.setupVoiceIPC();
    mockStatusEndpoint(
      { downloaded: true, downloading: false, progress: 1, device: 'cpu' },
      { downloaded: true, downloading: false, progress: 1, device: 'cpu' },
    );
    const result = await handleHandlers.get('voice-model-status')?.({}, 'en') as {
      device?: string; cpuWarning?: boolean;
    };
    expect(result.device).toBe('cpu');
    expect(result.cpuWarning).toBe(true);
  });

  it('warns when only STT runs on cpu (tts cuda + stt cpu) while device stays cuda', async () => {
    mod.setupVoiceIPC();
    mockStatusEndpoint(
      { downloaded: true, downloading: false, progress: 1, device: 'cpu' },
      { downloaded: true, downloading: false, progress: 1, device: 'cuda' },
    );
    const result = await handleHandlers.get('voice-model-status')?.({}, 'en') as {
      device?: string; cpuWarning?: boolean;
    };
    expect(result.device).toBe('cuda');
    expect(result.cpuWarning).toBe(true);
  });

  it('warns and reports cpu device when TTS runs on cpu (tts cpu + stt cuda)', async () => {
    mod.setupVoiceIPC();
    mockStatusEndpoint(
      { downloaded: true, downloading: false, progress: 1, device: 'cuda' },
      { downloaded: true, downloading: false, progress: 1, device: 'cpu' },
    );
    const result = await handleHandlers.get('voice-model-status')?.({}, 'en') as {
      device?: string; cpuWarning?: boolean;
    };
    expect(result.device).toBe('cpu');
    expect(result.cpuWarning).toBe(true);
  });

  it('does not warn when both models run on cuda', async () => {
    mod.setupVoiceIPC();
    mockStatusEndpoint(
      { downloaded: true, downloading: false, progress: 1, device: 'cuda' },
      { downloaded: true, downloading: false, progress: 1, device: 'cuda' },
    );
    const result = await handleHandlers.get('voice-model-status')?.({}, 'en') as {
      device?: string; cpuWarning?: boolean;
    };
    expect(result.device).toBe('cuda');
    expect(result.cpuWarning).toBeUndefined();
  });

  it('warns from an stt-only cpu device when tts does not report a device', async () => {
    mod.setupVoiceIPC();
    mockStatusEndpoint(
      { downloaded: true, downloading: false, progress: 1, device: 'cpu' },
      { downloaded: true, downloading: false, progress: 1 },
    );
    const result = await handleHandlers.get('voice-model-status')?.({}, 'en') as {
      device?: string; cpuWarning?: boolean;
    };
    expect(result.device).toBe('cpu');
    expect(result.cpuWarning).toBe(true);
  });

  it('relays non-cpu device without setting cpuWarning', async () => {
    mod.setupVoiceIPC();
    mockStatusEndpoint(
      { downloaded: true, downloading: false, progress: 1, device: 'mps' },
      { downloaded: true, downloading: false, progress: 1, device: 'cuda' },
    );
    const result = await handleHandlers.get('voice-model-status')?.({}, 'en') as {
      device?: string; cpuWarning?: boolean;
    };
    expect(result.device).toBe('cuda');
    expect(result.cpuWarning).toBeUndefined();
  });

  it('omits device and cpuWarning when the backend does not report a device', async () => {
    mod.setupVoiceIPC();
    mockStatusEndpoint(
      { downloaded: true, downloading: false, progress: 1 },
      { downloaded: true, downloading: false, progress: 1 },
    );
    const result = await handleHandlers.get('voice-model-status')?.({}, 'en') as {
      device?: string; cpuWarning?: boolean;
    };
    expect(result.device).toBeUndefined();
    expect(result.cpuWarning).toBeUndefined();
  });
});

describe('VOICE_TTS_GENERATE — realtime TTS status cpuWarning relay', () => {
  it('attaches cpuWarning to the TTS status when the backend reports device cpu', async () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    httpGetFn.mockImplementation(makeJsonHttpGetMock({ loaded: true, device: 'cpu' }));

    onHandlers.get('voice-tts-generate')?.(event, 'Hello', 'en', 1.0, undefined, 'qwen3');
    await flushMicrotasks();

    expect(event.sender.send).toHaveBeenCalledWith('voice-tts-status', {
      generating: true,
      playing: false,
      modelLoading: false,
      device: 'cpu',
      cpuWarning: true,
    });
  });

  it('omits cpuWarning when the backend does not report device cpu', async () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    httpGetFn.mockImplementation(makeJsonHttpGetMock({ loaded: true }));

    onHandlers.get('voice-tts-generate')?.(event, 'Hello', 'en', 1.0, undefined, 'qwen3');
    await flushMicrotasks();

    expect(event.sender.send).toHaveBeenCalledWith('voice-tts-status', {
      generating: true,
      playing: false,
      modelLoading: false,
    });
  });

  it('warns in initial and poll sends when only STT runs on cpu (tts cuda + stt cpu)', async () => {
    vi.useFakeTimers();
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    mockStatusEndpoint(
      { loaded: true, device: 'cpu' },
      { loaded: false, downloading: true, progress: 0.5, device: 'cuda' },
    );

    onHandlers.get('voice-tts-generate')?.(event, 'Hello', 'en', 1.0, undefined, 'qwen3');
    await vi.advanceTimersByTimeAsync(2100);

    const sends = event.sender.send.mock.calls.filter((c) => c[0] === 'voice-tts-status');
    expect(sends[0]?.[1]).toMatchObject({ modelLoading: true, device: 'cuda', cpuWarning: true });
    const pollSend = sends.find((c) => c[1] && 'downloadProgress' in c[1]);
    expect(pollSend?.[1]).toMatchObject({ downloadProgress: 0.5, device: 'cuda', cpuWarning: true });
  });

  it('warns with cpu device during active generation when tts runs on cpu (tts cpu + stt cuda)', async () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    mockStatusEndpoint(
      { loaded: true, device: 'cuda' },
      { loaded: true, device: 'cpu' },
    );

    onHandlers.get('voice-tts-generate')?.(event, 'Hello', 'en', 1.0, undefined, 'qwen3');
    await flushMicrotasks();

    expect(event.sender.send).toHaveBeenCalledWith('voice-tts-status', {
      generating: true,
      playing: false,
      modelLoading: false,
      device: 'cpu',
      cpuWarning: true,
    });
  });

  it('omits cpuWarning during active generation when both models run on cuda', async () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    mockStatusEndpoint(
      { loaded: true, device: 'cuda' },
      { loaded: true, device: 'cuda' },
    );

    onHandlers.get('voice-tts-generate')?.(event, 'Hello', 'en', 1.0, undefined, 'qwen3');
    await flushMicrotasks();

    expect(event.sender.send).toHaveBeenCalledWith('voice-tts-status', {
      generating: true,
      playing: false,
      modelLoading: false,
      device: 'cuda',
    });
  });
});

describe('VOICE_START_SESSION and VOICE_STOP_SESSION', () => {
  it('tags microphone readiness, progress, VAD, STT and failure with the exact stream request', () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    const request = { sessionId: 'call', requestId: 'microphone-a' };
    onHandlers.get('voice-start-session')?.(event, 'en', 'vad', 1.5, 'qwen3', request);
    const socket = lastCreatedWebSocket!;
    socket._emit('message', JSON.stringify({ type: 'ready' }));
    socket._emit('message', JSON.stringify({ type: 'vad', event: 'speech_start' }));
    socket._emit('message', JSON.stringify({ type: 'stt', text: 'Current learner speech', isFinal: true }));
    socket._emit('error', new Error('Stream failed'));
    for (const channel of ['voice-session-status', 'voice-session-ready', 'voice-vad-event', 'voice-stt-result', 'voice-session-error']) {
      expect(event.sender.send).toHaveBeenCalledWith(channel, expect.objectContaining(request));
    }
  });

  it('rejects foreign, obsolete and uncorrelated microphone commands without touching the current stream', () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent(), outsider = createFakeEvent();
    const request = { sessionId: 'call', requestId: 'current-stream' };
    onHandlers.get('voice-start-session')?.(event, 'en', 'vad', 1.5, undefined, request);
    const socket = lastCreatedWebSocket!;
    for (const [sender, scope] of [[outsider, request], [event, { ...request, requestId: 'old-stream' }], [event, undefined]] as const) {
      onHandlers.get('voice-audio-chunk')?.(sender, new Float32Array([0.2]), scope);
      onHandlers.get('voice-flush')?.(sender, scope);
      onHandlers.get('voice-update-silence-threshold')?.(sender, 2.0, scope);
      onHandlers.get('voice-tts-state')?.(sender, true, scope);
      onHandlers.get('voice-stop-session')?.(sender, scope);
    }
    expect(socket.send).not.toHaveBeenCalled(); expect(socket.close).not.toHaveBeenCalled();
    onHandlers.get('voice-audio-chunk')?.(event, new Float32Array([0.2]), request);
    onHandlers.get('voice-flush')?.(event, request);
    expect(socket.send).toHaveBeenCalledTimes(2);
    onHandlers.get('voice-stop-session')?.(event, request);
    expect(socket.close).toHaveBeenCalledOnce();
  });

  it.each(['waiting', 'connected'])('retires a %s microphone owner when its window is destroyed', (phase) => {
    if (phase === 'waiting') mockQuitToken = null;
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    const request = { sessionId: 'call', requestId: 'microphone' };
    onHandlers.get('voice-start-session')?.(event, 'en', 'vad', 1.5, undefined, request);
    const socket = lastCreatedWebSocket, tokenCallback = mockQuitTokenAvailableCallback;
    event.sender.destroy();
    if (socket) expect(socket.close).toHaveBeenCalledOnce();
    tokenCallback?.('late-token');
    expect(lastCreatedWebSocket).toBe(socket);
  });
  it('creates a WebSocket when startSession is called', () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    onHandlers.get('voice-start-session')?.(event, 'en', 'vad', 1.5);
    expect(lastCreatedWebSocket).not.toBeNull();
  });

  it('includes language, silence threshold, and TTS provider in the WebSocket URL', () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    onHandlers.get('voice-start-session')?.(event, 'ja', 'vad', 2.0, 'qwen3');
    expect(lastCreatedWebSocket?.url).toContain('language=ja');
    expect(lastCreatedWebSocket?.url).toContain('silence=2');
    expect(lastCreatedWebSocket?.url).toContain('tts_provider=qwen3');
  });

  it('includes quit token in WebSocket headers when available', () => {
    mockQuitToken = 'abc123def456';
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    onHandlers.get('voice-start-session')?.(event, 'en', 'vad', 1.5);
    expect(lastCreatedWebSocket?.headers?.Authorization).toBe('Bearer abc123def456');
    mockQuitToken = null;
  });

  it('waits for quit token and connects when it becomes available', () => {
    mockQuitToken = null;
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    onHandlers.get('voice-start-session')?.(event, 'en', 'vad', 1.5);
    expect(lastCreatedWebSocket).toBeNull();
    expect(event.sender.send).toHaveBeenCalledWith('voice-session-status', {
      stage: 'backend',
      message: 'Waiting for local Python backend…',
      progress: 0.01,
    });

    mockQuitToken = 'delayed-token';
    mockQuitTokenAvailableCallback?.('delayed-token');
    expect(lastCreatedWebSocket).not.toBeNull();
    expect(lastCreatedWebSocket?.headers?.Authorization).toBe('Bearer delayed-token');
    expect(event.sender.send).toHaveBeenCalledWith('voice-session-status', {
      stage: 'websocket',
      message: 'Opening local voice stream…',
      progress: 0.02,
    });
  });

  it('does not replace a repeated owned start request', () => {
    mod.setupVoiceIPC(); const event = createFakeEvent(); const identity = { sessionId: 'call', requestId: 'microphone' };
    onHandlers.get('voice-start-session')?.(event, 'en', 'vad', 1.5, 'system', identity);
    const socket = lastCreatedWebSocket!; event.sender.send.mockClear();
    onHandlers.get('voice-start-session')?.(event, 'en', 'vad', 1.5, 'system', { ...identity });
    expect(lastCreatedWebSocket).toBe(socket); expect(socket.close).not.toHaveBeenCalled();
    expect(event.sender.send).not.toHaveBeenCalled();
  });

  it.each([
    'not-json', 'null', '[]',
    JSON.stringify({ type: 'stt', text: 12, isFinal: true }),
    JSON.stringify({ type: 'stt', text: 'hi', isFinal: 'true' }),
    JSON.stringify({ type: 'stt', text: 'hi', isFinal: true, isPartial: true }),
    JSON.stringify({ type: 'vad', event: 'not-speech' }),
    JSON.stringify({ type: 'loading', stage: 'stt', message: 'Loading', progress: 2 }),
  ])('ends its owned stream on malformed backend events (%s)', (packet) => {
    mod.setupVoiceIPC(); const event = createFakeEvent(); const identity = { sessionId: 'call', requestId: 'microphone' };
    onHandlers.get('voice-start-session')?.(event, 'en', 'vad', 1.5, 'system', identity);
    const socket = lastCreatedWebSocket!; event.sender.send.mockClear();
    socket._emit('message', packet);
    socket._emit('message', JSON.stringify({ type: 'stt', text: 'late', isFinal: true }));
    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(event.sender.send).toHaveBeenCalledExactlyOnceWith('voice-session-error', {
      ...identity, error: expect.stringContaining('Invalid voice stream'),
    });
  });

  it('keeps waiting without sending a session error while Python has not emitted a quit token', () => {
    mockQuitToken = null;
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    onHandlers.get('voice-start-session')?.(event, 'en', 'vad', 1.5);
    expect(lastCreatedWebSocket).toBeNull();
    expect(event.sender.send).toHaveBeenCalledWith('voice-session-status', {
      stage: 'backend',
      message: 'Waiting for local Python backend…',
      progress: 0.01,
    });
    expect(event.sender.send).not.toHaveBeenCalledWith(
      'voice-session-error',
      expect.anything(),
    );
  });

  it.each(['replace', 'stop'] as const)('ignores a queued backend token after session %s', (action) => {
    mockQuitToken = null;
    mod.setupVoiceIPC();
    const oldEvent = createFakeEvent();
    onHandlers.get('voice-start-session')?.(oldEvent, 'en', 'vad', 1.5);
    const delayedCallback = mockQuitTokenAvailableCallback!;
    oldEvent.sender.send.mockClear();
    let replacement: typeof lastCreatedWebSocket = null;
    if (action === 'replace') {
      mockQuitToken = 'current-token';
      onHandlers.get('voice-start-session')?.(createFakeEvent(), 'de', 'vad', 1.5);
      replacement = lastCreatedWebSocket;
    } else {
      onHandlers.get('voice-stop-session')?.(oldEvent);
    }

    if (action === 'replace') {
      expect(oldEvent.sender.send).toHaveBeenCalledWith('voice-session-error', expect.objectContaining({ error: expect.stringContaining('another voice session') }));
      oldEvent.sender.send.mockClear();
    }
    // A callback already queued by the backend can run after unsubscription.
    delayedCallback('late-token');
    expect(lastCreatedWebSocket).toBe(replacement);
    expect(oldEvent.sender.send).not.toHaveBeenCalled();
    expect(mockQuitTokenAvailableCallback).toBeNull();
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
    lastCreatedWebSocket?._emit('open');
    expect(event.sender.send).toHaveBeenCalledWith('voice-session-status', {
      stage: 'websocket',
      message: 'Connected to local voice stream…',
      progress: 0.03,
    });
    lastCreatedWebSocket?._emit('message', JSON.stringify({ type: 'ready' }));
    expect(event.sender.send).toHaveBeenCalledWith('voice-session-ready', { ready: true });
  });

  it('sends VOICE_SESSION_STATUS to sender when WS receives loading message', () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    onHandlers.get('voice-start-session')?.(event, 'en', 'vad', 1.5);
    lastCreatedWebSocket?._emit('message', JSON.stringify({
      type: 'loading',
      stage: 'tts',
      message: 'Loading Qwen3-TTS model…',
      progress: 0.42,
      modelName: 'Qwen3-TTS',
    }));

    expect(event.sender.send).toHaveBeenCalledWith('voice-session-status', {
      stage: 'tts',
      message: 'Loading Qwen3-TTS model…',
      progress: 0.42,
      modelName: 'Qwen3-TTS',
    });
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
    lastCreatedWebSocket?._emit('message', JSON.stringify({
      type: 'vad',
      event: 'speech_start',
      reason: 'probability-above-start-threshold',
      speechProb: 0.82,
      threshold: 0.5,
      silenceSeconds: 0,
      silenceThreshold: 1.5,
      speechSeconds: 0,
      chunkSeconds: 0.032,
    }));
    expect(event.sender.send).toHaveBeenCalledWith('voice-vad-event', {
      type: 'speech-start',
      reason: 'probability-above-start-threshold',
      speechProb: 0.82,
      threshold: 0.5,
      silenceSeconds: 0,
      silenceThreshold: 1.5,
      speechSeconds: 0,
      chunkSeconds: 0.032,
    });
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

  it('ignores late callbacks from a replaced voice socket and preserves its successor audio queue', () => {
    mod.setupVoiceIPC();
    const first = createFakeEvent(), second = createFakeEvent();
    onHandlers.get('voice-start-session')?.(first, 'en', 'vad', 1.5);
    const oldSocket = lastCreatedWebSocket!;
    onHandlers.get('voice-start-session')?.(second, 'en', 'vad', 1.5);
    const currentSocket = lastCreatedWebSocket!;
    currentSocket.readyState = 0;
    first.sender.send.mockClear(); second.sender.send.mockClear();
    onHandlers.get('voice-audio-chunk')?.(second, new Float32Array([0.2]));
    oldSocket._emit('open');
    oldSocket._emit('message', JSON.stringify({ type: 'ready' }));
    oldSocket._emit('message', JSON.stringify({ type: 'stt', text: 'obsolete', isFinal: true }));
    oldSocket._emit('error', new Error('obsolete failure'));
    oldSocket._emit('close');
    expect(first.sender.send).not.toHaveBeenCalled();
    expect(second.sender.send).not.toHaveBeenCalled();
    expect(oldSocket.send).not.toHaveBeenCalled();
    currentSocket.readyState = MockWebSocket.OPEN;
    currentSocket._emit('open');
    expect(currentSocket.send).toHaveBeenCalledOnce();
    currentSocket._emit('message', JSON.stringify({ type: 'stt', text: 'current', isFinal: true }));
    expect(second.sender.send).toHaveBeenCalledWith('voice-stt-result', expect.objectContaining({ text: 'current' }));
  });

  it('reports unexpected clean socket closure once and ignores intentional shutdown', () => {
    mod.setupVoiceIPC();
    const first = createFakeEvent();
    onHandlers.get('voice-start-session')?.(first, 'en', 'vad', 1.5);
    first.sender.send.mockClear();
    const socket = lastCreatedWebSocket!;
    socket._emit('close'); socket._emit('close');
    expect(first.sender.send.mock.calls.filter(call => call[0] === 'voice-session-error')).toHaveLength(1);
    const second = createFakeEvent();
    onHandlers.get('voice-start-session')?.(second, 'en', 'vad', 1.5);
    second.sender.send.mockClear();
    onHandlers.get('voice-stop-session')?.(second);
    expect(second.sender.send).not.toHaveBeenCalled();
  });

  it.each(['legacy', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'])('starts a microphone with admitted generation %s', generation => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    const request = { sessionId: 'admitted-call', requestId: 'admitted-microphone', generation };
    onHandlers.get('voice-start-session')?.(event, 'en', 'vad', 1.5, undefined, request);
    expect(lastCreatedWebSocket?.url).toContain(`generation=${generation}`);
    lastCreatedWebSocket!._emit('message', JSON.stringify({ type: 'ready' }));
    expect(event.sender.send).toHaveBeenCalledWith('voice-session-ready', expect.objectContaining({ generation }));
    onHandlers.get('voice-stop-session')?.(event, request);
  });

  it('uses default silence threshold of 0.8 when not provided', () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    onHandlers.get('voice-start-session')?.(event, 'en', 'vad');
    expect(lastCreatedWebSocket?.url).toContain('silence=0.8');
  });
});

describe('VOICE_AUDIO_CHUNK handler', () => {
  it('sends audio buffer over WebSocket when session is active', () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    onHandlers.get('voice-start-session')?.(event, 'en', 'vad', 1.5);
    onHandlers.get('voice-audio-chunk')?.(event, new Float32Array([0.1, 0.2, 0.3]));
    expect(lastCreatedWebSocket?.send).toHaveBeenCalled();
  });

  it('does not send audio when WebSocket readyState is not OPEN', () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    onHandlers.get('voice-start-session')?.(event, 'en', 'vad', 1.5);
    if (lastCreatedWebSocket) lastCreatedWebSocket.readyState = MockWebSocket.CLOSED;
    onHandlers.get('voice-audio-chunk')?.(event, new Float32Array([0.5]));
    expect(lastCreatedWebSocket?.send).not.toHaveBeenCalled();
  });
});

describe('VOICE_FLUSH handler', () => {
  it('sends flush JSON message over WebSocket when session is active', () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    onHandlers.get('voice-start-session')?.(event, 'en', 'vad', 1.5);
    onHandlers.get('voice-flush')?.(event);
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
    onHandlers.get('voice-update-silence-threshold')?.(event, 2.5);
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
  it.each(['deleted', 'cancelled', 'newer-transcript'])('does not write a delayed transcript when the sample was %s', async (change) => {
    const sample = { id: 'transcribe-a', name: 'Original', filename: 'a.wav', createdAt: 1 };
    let manifest = [sample];
    existsSyncFn.mockImplementation((p: string) => p.endsWith('.json'));
    readFileSyncFn.mockImplementation(() => JSON.stringify(manifest));
    let release: (() => void) | undefined;
    httpRequestFn.mockImplementation((_opts: unknown, cb: (res: FakeResponse) => void) => {
      const response = makeFakeResponse(200, Buffer.from('{"text":"obsolete transcript"}')); cb(response);
      return { write: vi.fn(), end: () => { release = () => { response._emit('data', Buffer.from('{"text":"obsolete transcript"}')); response._emit('end'); }; }, on: vi.fn() };
    });
    const controller = new AbortController();
    const pending = mod.ensureVoiceSampleTranscript(sample, [sample], 'en', false, controller.signal);
    if (change === 'deleted') manifest = [];
    if (change === 'cancelled') controller.abort();
    if (change === 'newer-transcript') manifest = [{ ...sample, transcript: 'newer transcript' } as typeof sample];
    release!();
    await expect(pending).rejects.toThrow();
    expect(writeFileSyncFn).not.toHaveBeenCalled();
  });

  it('merges a delayed transcription into the current manifest without losing rename or unrelated upload', async () => {
    const sample = { id: 'transcribe-a', name: 'Original', filename: 'a.wav', createdAt: 1 };
    let manifest = [sample];
    existsSyncFn.mockImplementation((p: string) => p.endsWith('.json'));
    readFileSyncFn.mockImplementation(() => JSON.stringify(manifest));
    let release: (() => void) | undefined;
    httpRequestFn.mockImplementation((_opts: unknown, cb: (res: FakeResponse) => void) => {
      const response = makeFakeResponse(200, Buffer.from('{"text":"current transcript"}')); cb(response);
      return { write: vi.fn(), end: () => { release = () => { response._emit('data', Buffer.from('{"text":"current transcript"}')); response._emit('end'); }; }, on: vi.fn() };
    });
    const pending = mod.ensureVoiceSampleTranscript(sample, [sample], 'en');
    manifest = [{ ...sample, name: 'Renamed' }, { id: 'new-upload', name: 'New upload', filename: 'b.wav', createdAt: 2 }];
    release!(); await pending;
    const updated = JSON.parse(writeFileSyncFn.mock.calls.find(call => (call[0] as string).endsWith('.json'))![1]);
    expect(updated).toEqual([{ ...manifest[0], transcript: 'current transcript' }, manifest[1]]);
  });

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

    httpGetFn.mockImplementation((opts: { path?: string } | string, cb: (res: ReturnType<typeof makeFakeResponse>) => void) => {
      const urlPath = typeof opts === 'string' ? opts : (opts.path ?? '');
      const isTtsStatus = urlPath.includes('/voice/tts/status');
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
    mockChildProcess._emit('close', 0);
    await flushMicrotasks();
    mockChildProcess._emit('close', 0);
    await handlerPromise;

    const pipArgs = spawnFn.mock.calls
      .filter((c) => c[0] === '/env/bin/pip')
      .flatMap((c) => c[1] as string[]);
    expect(pipArgs).toEqual(expect.arrayContaining(['install', 'faster-whisper']));
    if (IS_APPLE_SILICON_RUNTIME) {
      // Per-group pip spawns: the qwen3 engine group is its own call.
      expect(pipArgs).toContain('qwen3-tts-package');
    }
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
  it('does not report completion after silently truncating a system-voice phrase', async () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    execFileFn.mockReturnValue({ kill: vi.fn() });
    const phrase = 'A'.repeat(500) + ' The entire approved ending must be spoken.';
    onHandlers.get('voice-tts-generate')?.(event, phrase, 'en', 1, undefined, 'system');
    expect((execFileFn.mock.calls[0][1] as string[]).join(' ')).toContain(phrase);
  });

  it('reports a missing assigned voice sample instead of silently using a different voice', async () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    httpGetFn.mockImplementation(makeJsonHttpGetMock({ loaded: true }));
    existsSyncFn.mockReturnValue(false);
    const request = { sessionId: 'call-a', requestId: 'phrase-a', actorId: 'actor-a' };
    onHandlers.get('voice-tts-generate')?.(event, 'A phrase', 'en', 1, 'missing-assigned-sample', 'qwen3', undefined, request);
    await flushMicrotasks();
    expect(lastCreatedWebSocket).toBeNull();
    expect(event.sender.send).toHaveBeenCalledWith('voice-tts-status', expect.objectContaining({ ...request, generating: false, error: expect.stringContaining('sample') }));
  });

  it.each(['qwen3', 'system'])('cancels owned %s work when its renderer is destroyed', async (provider) => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    httpGetFn.mockImplementation(makeJsonHttpGetMock({ loaded: true }));
    const kill = vi.fn(); execFileFn.mockReturnValue({ kill });
    onHandlers.get('voice-tts-generate')?.(event, 'A phrase', 'en', 1, undefined, provider, undefined, { sessionId: 'call-a', requestId: 'phrase-a' });
    await flushMicrotasks();
    const socket = lastCreatedWebSocket;
    event.sender.destroy();
    if (provider === 'system') expect(kill).toHaveBeenCalledWith('SIGKILL');
    else {
      expect(socket!.close).toHaveBeenCalled();
      socket!._emit('open');
      expect(socket!.send).not.toHaveBeenCalled();
    }
  });

  it('reports a disconnected stream as failure rather than successful delivery', async () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    httpGetFn.mockImplementation(makeJsonHttpGetMock({ loaded: true }));
    const request = { sessionId: 'call-a', requestId: 'phrase-a' };
    onHandlers.get('voice-tts-generate')?.(event, 'A phrase', 'en', 1, undefined, 'qwen3', undefined, request);
    await flushMicrotasks(); event.sender.send.mockClear();
    lastCreatedWebSocket!._emit('close'); await flushMicrotasks();
    expect(event.sender.send).toHaveBeenCalledExactlyOnceWith('voice-tts-status', expect.objectContaining({ ...request, generating: false, error: expect.stringContaining('disconnected') }));
  });

  it.each(['truncated-binary', 'sample-count', 'empty', 'invalid-samples', 'invalid-rate', 'unfinished-frame', 'json-byte-length', 'sample-offset'])('fails owned malformed PCM instead of claiming a completed phrase (%s)', async (failure) => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    httpGetFn.mockImplementation(makeJsonHttpGetMock({ loaded: true }));
    const request = { sessionId: 'audio-call', requestId: 'audio-phrase' };
    onHandlers.get('voice-tts-generate')?.(event, 'A phrase', 'en', 1, undefined, 'qwen3', undefined, request);
    await flushMicrotasks();
    const socket = lastCreatedWebSocket!;
    event.sender.send.mockClear();
    if (failure === 'truncated-binary' || failure === 'sample-count' || failure === 'unfinished-frame') {
      socket._emit('message', JSON.stringify({ type: 'audio', sampleRate: 24000, sampleCount: 4,
        byteLength: failure === 'sample-count' ? 4 : 16 }));
      if (failure !== 'unfinished-frame') socket._emit('message', Buffer.from(new Float32Array([0.5]).buffer), true);
    } else socket._emit('message', JSON.stringify({ type: 'audio', sampleRate: failure === 'invalid-rate' ? 0 : 24000,
      ...(failure === 'json-byte-length' ? { byteLength: 16 } : {}), ...(failure === 'sample-offset' ? { sampleOffset: 1 } : {}),
      samples: failure === 'empty' ? [] : failure === 'invalid-samples' ? [null] : [0.5] }));
    socket._emit('message', JSON.stringify({ type: 'done' })); socket._emit('close');
    await flushMicrotasks();
    expect(event.sender.send.mock.calls.filter(([channel]) => channel === 'voice-tts-audio')).toEqual([]);
    const statuses = event.sender.send.mock.calls.filter(([channel]) => channel === 'voice-tts-status');
    expect(statuses).toEqual([['voice-tts-status', expect.objectContaining({ ...request, generating: false, error: expect.stringContaining('audio') })]]);
  });

  it('sends one terminal result and cannot revive a completed request with late stream events', async () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    httpGetFn.mockImplementation(makeJsonHttpGetMock({ loaded: true }));
    const request = { sessionId: 'current-call', requestId: 'current-phrase' };
    onHandlers.get('voice-tts-generate')?.(event, 'A phrase', 'en', 1, undefined, 'qwen3', undefined, request);
    await flushMicrotasks();
    const socket = lastCreatedWebSocket!;
    event.sender.send.mockClear();
    socket._emit('message', JSON.stringify({ type: 'error', message: 'Synthesis failed' }));
    await flushMicrotasks();
    expect(event.sender.send).toHaveBeenCalledTimes(1);
    expect(event.sender.send).toHaveBeenCalledWith('voice-tts-status', expect.objectContaining({ ...request, generating: false, error: 'Synthesis failed' }));
    event.sender.send.mockClear();
    socket._emit('message', JSON.stringify({ type: 'status', generating: true }));
    socket._emit('message', JSON.stringify({ type: 'audio', samples: [1], sampleRate: 24000 }));
    expect(event.sender.send).not.toHaveBeenCalled();
  });

  it('cannot let a replaced system process finish or stop its successor', async () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    const completions: Array<(error?: Error) => void> = [];
    const children: Array<{ kill: ReturnType<typeof vi.fn> }> = [];
    execFileFn.mockImplementation((_command, _args, callback) => {
      completions.push(callback as (error?: Error) => void);
      const child = { kill: vi.fn() }; children.push(child); return child;
    });
    const a = { sessionId: 'system-call', requestId: 'old-system' };
    const b = { sessionId: 'system-call', requestId: 'new-system' };
    onHandlers.get('voice-tts-generate')?.(event, 'Earlier speech', 'en', 1, undefined, 'system', undefined, a);
    onHandlers.get('voice-tts-generate')?.(event, 'Current speech', 'en', 1, undefined, 'system', undefined, b);
    event.sender.send.mockClear();
    completions[0](Object.assign(new Error('cancelled'), { code: 'ENOENT' }));
    await flushMicrotasks();
    expect(execFileFn).toHaveBeenCalledTimes(2);
    expect(event.sender.send).not.toHaveBeenCalled();
    onHandlers.get('voice-tts-stop')?.(event, a);
    expect(children[1].kill).not.toHaveBeenCalled();
    completions[1]();
    expect(event.sender.send).toHaveBeenCalledWith('voice-tts-status', expect.objectContaining({ ...b, generating: false }));
  });

  it('rejects malformed identities before cancelling a valid current request', async () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    httpGetFn.mockImplementation(makeJsonHttpGetMock({ loaded: true }));
    const currentIdentity = { sessionId: 'current-call', requestId: 'current-phrase' };
    onHandlers.get('voice-tts-generate')?.(event, 'Current phrase', 'en', 1, undefined, 'qwen3', undefined, currentIdentity);
    await flushMicrotasks();
    const current = lastCreatedWebSocket!;
    current.close.mockClear(); event.sender.send.mockClear();
    onHandlers.get('voice-tts-generate')?.(event, 'Malformed replacement', 'en', 1, undefined, 'qwen3', undefined, { sessionId: '', requestId: 42 });
    await flushMicrotasks();
    expect(current.close).not.toHaveBeenCalled();
    current._emit('message', JSON.stringify({ type: 'audio', sampleRate: 24000, samples: [0.25] }));
    expect(event.sender.send).toHaveBeenCalledWith('voice-tts-audio', expect.objectContaining(currentIdentity));
  });

  it('echoes the request identity and ignores every late event from a replaced TTS stream', async () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    httpGetFn.mockImplementation(makeJsonHttpGetMock({ loaded: true }));
    const a = { sessionId: 'call-a', utteranceId: 'utterance-a', actorId: 'person-a', requestId: 'phrase-a' };
    const b = { sessionId: 'call-b', utteranceId: 'utterance-b', actorId: 'person-b', requestId: 'phrase-b' };
    onHandlers.get('voice-tts-generate')?.(event, 'Earlier phrase', 'en', 1, undefined, 'qwen3', undefined, a);
    await flushMicrotasks();
    const old = lastCreatedWebSocket!;
    onHandlers.get('voice-tts-generate')?.(event, 'Current phrase', 'en', 1, undefined, 'qwen3', undefined, b);
    await flushMicrotasks();
    expect(event.sender.send).toHaveBeenCalledWith('voice-tts-status', expect.objectContaining({ ...a, generating: false, error: expect.any(String) }));
    expect(event.sender.send).toHaveBeenCalledWith('voice-tts-status', expect.objectContaining({ ...b, generating: true }));
    event.sender.send.mockClear();
    old._emit('message', JSON.stringify({ type: 'status', generating: false }));
    old._emit('message', JSON.stringify({ type: 'audio', sampleRate: 24000, samples: [0.5] }));
    old._emit('message', JSON.stringify({ type: 'done' }));
    await flushMicrotasks();
    expect(event.sender.send).not.toHaveBeenCalled();
    const current = lastCreatedWebSocket!;
    current._emit('message', JSON.stringify({ type: 'audio', sampleRate: 24000, samples: [0.25] }));
    expect(event.sender.send).toHaveBeenCalledWith('voice-tts-audio', expect.objectContaining(b));
  });

  it('does not stop a newer request or another sender when an old owner tears down', async () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    httpGetFn.mockImplementation(makeJsonHttpGetMock({ loaded: true }));
    const request = { sessionId: 'current-call', requestId: 'current-phrase' };
    onHandlers.get('voice-tts-generate')?.(event, 'Current phrase', 'en', 1, undefined, 'qwen3', undefined, request);
    await flushMicrotasks();
    const current = lastCreatedWebSocket!;
    current.close.mockClear(); event.sender.send.mockClear();
    onHandlers.get('voice-tts-stop')?.(event, { sessionId: 'old-call', requestId: 'old-phrase' });
    onHandlers.get('voice-tts-stop')?.(createFakeEvent(), request);
    expect(current.close).not.toHaveBeenCalled();
    expect(event.sender.send).not.toHaveBeenCalled();
    onHandlers.get('voice-tts-stop')?.(event, request);
    expect(current.close).toHaveBeenCalled();
    expect(event.sender.send).toHaveBeenCalledWith('voice-tts-status', { ...request, generating: false, playing: false });
  });

  it('cannot resurrect replaced TTS while its model status preflight is pending', async () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    const release: Array<() => void> = [];
    const deferredStatus = (_opts: unknown, cb: (res: FakeResponse) => void) => {
      const response = makeFakeResponse(200, Buffer.from('{"loaded":true}'));
      cb(response);
      release.push(() => { response._emit('data', '{"loaded":true}'); response._emit('end'); });
      return { on: vi.fn() };
    };
    httpGetFn.mockImplementation(makeJsonHttpGetMock({ loaded: true }))
      .mockImplementationOnce(deferredStatus).mockImplementationOnce(deferredStatus);
    onHandlers.get('voice-tts-generate')?.(event, 'Old preflight', 'en', 1, undefined, 'qwen3');
    onHandlers.get('voice-tts-generate')?.(event, 'Current phrase', 'en', 1, undefined, 'qwen3');
    await flushMicrotasks();
    const current = lastCreatedWebSocket;
    event.sender.send.mockClear();
    release.forEach(done => done());
    await flushMicrotasks();
    expect(lastCreatedWebSocket).toBe(current);
    expect(event.sender.send).not.toHaveBeenCalled();
  });

  it('uses killable system TTS when provider is system', async () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    const kill = vi.fn();
    let complete: (() => void) | undefined;
    execFileFn.mockImplementation((_command, _args, callback) => {
      complete = callback as () => void;
      return { kill };
    });

    onHandlers.get('voice-tts-generate')?.(event, 'System voice', 'en', 1.0, undefined, 'system');
    await flushMicrotasks();

    expect(execFileFn).toHaveBeenCalledWith('powershell', expect.any(Array), expect.any(Function));
    expect(event.sender.send).toHaveBeenCalledWith('voice-tts-status', { generating: true, playing: true });

    onHandlers.get('voice-tts-stop')?.(event);

    expect(kill).toHaveBeenCalledWith('SIGKILL');
    expect(event.sender.send).toHaveBeenCalledWith('voice-tts-status', { generating: false, playing: false });

    complete?.();
  });

  it.each(['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'legacy'])('carries an admitted variant and generation %s through TTS ownership and the actual stream payload', async generation => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    httpGetFn.mockImplementation(makeJsonHttpGetMock({ loaded: true, downloading: false, progress: 1 }));
    existsSyncFn.mockReturnValue(false); readFileSyncFn.mockReturnValue('[]');
    const request = { sessionId: 'variant-call', requestId: 'variant-utterance', variant: 'future-register', generation };
    onHandlers.get('voice-tts-generate')?.(event, 'Source phrase', 'future', 1, undefined, 'qwen3', undefined, request);
    await flushMicrotasks();
    expect(lastCreatedWebSocket).not.toBeNull();
    lastCreatedWebSocket!._emit('open');
    expect(JSON.parse(lastCreatedWebSocket!.send.mock.calls[0][0])).toMatchObject({ language: 'future', variant: 'future-register', generation: request.generation });
    onHandlers.get('voice-tts-stop')?.(event, request);
  });

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
      variant: null,
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
      expect.objectContaining({ path: expect.stringContaining('/voice/tts/status?language=ja') }),
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

  it('forwards local TTS stream errors to the renderer status channel', async () => {
    mod.setupVoiceIPC();
    const event = createFakeEvent();

    httpGetFn.mockImplementation(makeJsonHttpGetMock({ loaded: true }));
    existsSyncFn.mockReturnValue(false);
    readFileSyncFn.mockReturnValue('[]');

    onHandlers.get('voice-tts-generate')?.(event, 'Test error', 'en', 1.0, undefined, 'qwen3');
    await flushMicrotasks();
    lastCreatedWebSocket?._emit('open');
    lastCreatedWebSocket?._emit('message', JSON.stringify({
      type: 'error',
      message: 'There is no Stream(gpu, 0) in current thread.',
    }));
    await flushMicrotasks();

    expect(event.sender.send).toHaveBeenCalledWith('voice-tts-status', {
      generating: false,
      playing: false,
      error: 'There is no Stream(gpu, 0) in current thread.',
    });
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

describe('System TTS language capability admission', () => {
  it('does not speak using an unrelated OS default when package voice is absent', async () => {
    platformFlags.isMac = true;
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    onHandlers.get('voice-tts-generate')?.(event, 'Source content', 'future-package', 1.0, undefined, 'system');
    await flushMicrotasks();
    expect(execFileFn).not.toHaveBeenCalled();
    expect(event.sender.send).toHaveBeenCalledWith('voice-tts-status', expect.objectContaining({
      generating: false, playing: false, error: expect.stringContaining('System TTS voice'),
    }));
  });
});

describe('generateSystemTTS — Linux espeak-ng probe', () => {
  function enoentError(binary: string): Error {
    const err = new Error(`spawn ${binary} ENOENT`);
    (err as NodeJS.ErrnoException).code = 'ENOENT';
    return err;
  }

  function collectExecFileCallbacks(): Array<(err: Error | null) => void> {
    const callbacks: Array<(err: Error | null) => void> = [];
    execFileFn.mockImplementation((_command: string, _args: string[], cb: (err: Error | null) => void) => {
      callbacks.push(cb);
      return { kill: vi.fn() };
    });
    return callbacks;
  }

  it('falls back from espeak-ng to espeak when espeak-ng is missing', async () => {
    platformFlags.isLinux = true;
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    const callbacks = collectExecFileCallbacks();

    onHandlers.get('voice-tts-generate')?.(event, 'Hello linux', 'en', 1.0, undefined, 'system');
    await flushMicrotasks();

    expect(execFileFn).toHaveBeenNthCalledWith(1, 'espeak-ng', expect.any(Array), expect.any(Function));
    callbacks[0]?.(enoentError('espeak-ng'));
    await flushMicrotasks();

    expect(execFileFn).toHaveBeenNthCalledWith(2, 'espeak', expect.any(Array), expect.any(Function));
    callbacks[1]?.(null);
    await flushMicrotasks();

    expect(event.sender.send).toHaveBeenCalledWith('voice-tts-status', { generating: false, playing: false });
    expect(event.sender.send).not.toHaveBeenCalledWith(
      'voice-tts-status',
      expect.objectContaining({ error: expect.anything() }),
    );
  });

  it('emits a user-visible TTS status error when neither espeak-ng nor espeak exists', async () => {
    platformFlags.isLinux = true;
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    const callbacks = collectExecFileCallbacks();

    onHandlers.get('voice-tts-generate')?.(event, 'Hello linux', 'en', 1.0, undefined, 'system');
    await flushMicrotasks();

    callbacks[0]?.(enoentError('espeak-ng'));
    await flushMicrotasks();
    callbacks[1]?.(enoentError('espeak'));
    await flushMicrotasks();

    expect(execFileFn).toHaveBeenCalledTimes(2);
    const errorStatus = event.sender.send.mock.calls.find(
      (c) => c[0] === 'voice-tts-status' && c[1] && typeof c[1] === 'object' && 'error' in c[1],
    );
    expect(errorStatus).toBeTruthy();
    expect(errorStatus?.[1]).toMatchObject({ generating: false, playing: false });
    expect(String((errorStatus?.[1] as { error: string }).error)).toContain('espeak-ng');
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

// Wave 1: MLX STT conditional install & dynamic STT model name.
// installVoicePackages/isAppleSilicon/DEFAULT_STT_MODEL_NAME are
// module-internal — tests exercise them via VOICE_MODEL_DOWNLOAD and
// VOICE_MODEL_STATUS handlers plus the exported resolveVoiceInstallGroupNames
// matrix. Platform assertions use the real process.platform/process.arch
// (never mocked).

const IS_APPLE_SILICON_RUNTIME = process.platform === 'darwin' && process.arch === 'arm64';
const EXPECTED_DEFAULT_STT_MODEL = IS_APPLE_SILICON_RUNTIME
  ? 'mlx-community/whisper-large-v3-turbo-asr-fp16'
  : 'openai/whisper-small';

describe('MLX STT conditional install — loadMlxSttPackages via VOICE_MODEL_DOWNLOAD', () => {
  it('reads mlx-stt group from pip_requirements.json and includes it in spawn args on Apple Silicon', async () => {
    mockPipRequirements = {
      voice: ['faster-whisper'],
      'mlx-stt': ['sentencepiece>=0.2.0'],
    };
    mod.setupVoiceIPC();
    const event = createFakeEvent();

    httpGetFn.mockImplementation((_url: string, _cb: unknown) => ({
      on: (_evt: string, cb: (e: Error) => void) => {
        if (_evt === 'error') Promise.resolve().then(() => cb(new Error('backend not running')));
        return { on: vi.fn() };
      },
    }));

    const mockChildProcess = new MockChildProcess();
    spawnFn.mockReturnValue(mockChildProcess);

    const handlerPromise = onHandlers.get('voice-model-download')?.(event, 'en');
    await flushMicrotasks();
    mockChildProcess._emit('close', 0);
    await flushMicrotasks();
    mockChildProcess._emit('close', 0);
    await handlerPromise;

    const pipArgs = spawnFn.mock.calls
      .filter((c) => c[0] === '/env/bin/pip')
      .flatMap((c) => c[1] as string[]);

    if (IS_APPLE_SILICON_RUNTIME) {
      expect(pipArgs).toContain('sentencepiece>=0.2.0');
    } else {
      expect(pipArgs).not.toContain('sentencepiece>=0.2.0');
    }
  });

  it('returns empty array (omits mlx-stt packages) when the mlx-stt key is missing', async () => {
    mockPipRequirements = {
      voice: ['faster-whisper'],
    };
    mod.setupVoiceIPC();
    const event = createFakeEvent();

    httpGetFn.mockImplementation((_url: string, _cb: unknown) => ({
      on: (_evt: string, cb: (e: Error) => void) => {
        if (_evt === 'error') Promise.resolve().then(() => cb(new Error('backend not running')));
        return { on: vi.fn() };
      },
    }));

    const mockChildProcess = new MockChildProcess();
    spawnFn.mockReturnValue(mockChildProcess);

    const handlerPromise = onHandlers.get('voice-model-download')?.(event, 'en');
    await flushMicrotasks();
    mockChildProcess._emit('close', 1);
    await handlerPromise;

    const spawnCall = spawnFn.mock.calls.find((c) => (c[0] as string) === '/env/bin/pip');
    expect(spawnCall).toBeTruthy();
    const spawnArgs = spawnCall?.[1] as string[];
    expect(spawnArgs).not.toContain('sentencepiece>=0.2.0');
  });
});

describe('installVoicePackages — includeMlxStt flag controls mlx-stt inclusion', () => {
  it('includes mlx-stt packages when includeMlxStt evaluates true (Apple Silicon), excludes otherwise', async () => {
    mockPipRequirements = {
      voice: ['faster-whisper'],
      'mlx-stt': ['sentencepiece>=0.2.0'],
    };
    mod.setupVoiceIPC();
    const event = createFakeEvent();

    httpGetFn.mockImplementation((_url: string, _cb: unknown) => ({
      on: (_evt: string, cb: (e: Error) => void) => {
        if (_evt === 'error') Promise.resolve().then(() => cb(new Error('backend not running')));
        return { on: vi.fn() };
      },
    }));

    const mockChildProcess = new MockChildProcess();
    spawnFn.mockReturnValue(mockChildProcess);

    const handlerPromise = onHandlers.get('voice-model-download')?.(event, 'en');
    await flushMicrotasks();
    mockChildProcess._emit('close', 0);
    await flushMicrotasks();
    mockChildProcess._emit('close', 0);
    await handlerPromise;

    const pipArgs = spawnFn.mock.calls
      .filter((c) => c[0] === '/env/bin/pip')
      .flatMap((c) => c[1] as string[]);

    if (IS_APPLE_SILICON_RUNTIME) {
      expect(pipArgs).toEqual(expect.arrayContaining(['install', 'faster-whisper', 'sentencepiece>=0.2.0']));
    } else {
      expect(pipArgs).toEqual(expect.arrayContaining(['install', 'faster-whisper']));
      expect(pipArgs).not.toContain('sentencepiece>=0.2.0');
    }
  });
});

describe('resolveVoiceInstallGroupNames — platform package group matrix', () => {
  it('Apple Silicon: voice + qwen3-tts + mlx-stt, never torch or windows groups', () => {
    expect(mod.resolveVoiceInstallGroupNames(true, false, true, true)).toEqual(['voice', 'qwen3-tts', 'mlx-stt']);
    expect(mod.resolveVoiceInstallGroupNames(true, true, true, true)).toEqual(['voice', 'qwen3-tts', 'mlx-stt']);
    expect(mod.resolveVoiceInstallGroupNames(true, false, true, false)).toEqual(['voice', 'qwen3-tts']);
    expect(mod.resolveVoiceInstallGroupNames(true, false, false, true)).toEqual(['voice', 'mlx-stt']);
    expect(mod.resolveVoiceInstallGroupNames(true, false, false, false)).toEqual(['voice']);
  });

  it('Windows: voice-windows + qwen3-tts-torch, never mlx or qwen3-tts groups', () => {
    expect(mod.resolveVoiceInstallGroupNames(false, true, true, true)).toEqual(['voice-windows', 'qwen3-tts-torch']);
    expect(mod.resolveVoiceInstallGroupNames(false, true, true, false)).toEqual(['voice-windows', 'qwen3-tts-torch']);
    expect(mod.resolveVoiceInstallGroupNames(false, true, false, false)).toEqual(['voice-windows']);
  });

  it('Linux: voice + qwen3-tts-torch, never mlx or windows groups', () => {
    expect(mod.resolveVoiceInstallGroupNames(false, false, true, true)).toEqual(['voice', 'qwen3-tts-torch']);
    expect(mod.resolveVoiceInstallGroupNames(false, false, false, false)).toEqual(['voice']);
  });
});

describe('buildPipArgs — Windows CUDA extra index', () => {
  const packages = ['torch==2.10.0+cu128'];
  const cudaIndexArgs = ['--extra-index-url', 'https://download.pytorch.org/whl/cu128'];

  it('posix: plain install args, never an extra index', () => {
    expect(mod.buildPipArgs(false, 'voice', packages)).toEqual(['install', ...packages]);
    expect(mod.buildPipArgs(false, 'voice-windows', packages)).toEqual(['install', ...packages]);
    expect(mod.buildPipArgs(false, 'qwen3-tts-torch', packages)).toEqual(['install', ...packages]);
  });

  it('windows: -m pip via python; CUDA index only for CUDA-bearing groups', () => {
    expect(mod.buildPipArgs(true, 'voice', packages)).toEqual(['-m', 'pip', 'install', ...packages]);
    expect(mod.buildPipArgs(true, 'core', packages)).toEqual(['-m', 'pip', 'install', ...packages]);
    expect(mod.buildPipArgs(true, 'qwen3-tts', packages)).toEqual(['-m', 'pip', 'install', ...packages]);
    expect(mod.buildPipArgs(true, 'voice-windows', packages)).toEqual(['-m', 'pip', 'install', ...packages, ...cudaIndexArgs]);
    expect(mod.buildPipArgs(true, 'qwen3-tts-torch', packages)).toEqual(['-m', 'pip', 'install', ...packages, ...cudaIndexArgs]);
  });
});

describe('VOICE_MODEL_DOWNLOAD — platform-correct package groups', () => {
  function mockBackendStatuses(ttsModelName: string): void {
    httpGetFn.mockImplementation((opts: { path?: string } | string, cb: (res: FakeResponse) => void) => {
      const urlPath = typeof opts === 'string' ? opts : (opts.path ?? '');
      const isTtsStatus = urlPath.includes('/voice/tts/status');
      const body = JSON.stringify({
        downloaded: false,
        downloading: false,
        progress: 0,
        modelName: isTtsStatus ? ttsModelName : 'openai/whisper-small',
      });
      const fakeRes = makeFakeResponse(200, Buffer.from(body));
      cb(fakeRes);
      Promise.resolve().then(() => {
        fakeRes._emit('data', body);
        fakeRes._emit('end');
      });
      return { on: vi.fn() };
    });
  }

  async function runDownloadWithPackages(packages: Record<string, string[]>, ttsModelName: string): Promise<void> {
    mockPipRequirements = packages;
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    mockBackendStatuses(ttsModelName);
    const mockChildProcess = new MockChildProcess();
    spawnFn.mockReturnValue(mockChildProcess);
    const handlerPromise = onHandlers.get('voice-model-download')?.(event, 'en');
    // Settle every per-group pip spawn in sequence; the same mock child is
    // reused, and extra close events on an already-resolved group are no-ops.
    for (let i = 0; i < 5; i++) {
      await flushMicrotasks();
      mockChildProcess._emit('close', 0);
    }
    await handlerPromise;
  }

  function pipSpawnArgs(): string[] {
    return spawnFn.mock.calls
      .filter((c) => c[0] === '/env/bin/pip')
      .flatMap((c) => c[1] as string[]);
  }

  it('torch TTS engine installs mlx groups on Apple Silicon and the torch group elsewhere', async () => {
    await runDownloadWithPackages({
      voice: ['faster-whisper'],
      'voice-windows': ['win-voice-pkg'],
      'qwen3-tts': ['mlx-audio'],
      'qwen3-tts-torch': ['torch-tts-dep'],
      'mlx-stt': ['sentencepiece>=0.2.0'],
    }, 'Qwen3-TTS-12Hz-1.7B-Torch');

    const pipArgs = pipSpawnArgs();
    expect(pipArgs).toContain('install');
    expect(pipArgs).toContain('faster-whisper');
    if (IS_APPLE_SILICON_RUNTIME) {
      expect(pipArgs).toEqual(expect.arrayContaining(['mlx-audio', 'sentencepiece>=0.2.0']));
      expect(pipArgs).not.toContain('torch-tts-dep');
    } else {
      expect(pipArgs).toEqual(expect.arrayContaining(['torch-tts-dep']));
      expect(pipArgs).not.toContain('mlx-audio');
      expect(pipArgs).not.toContain('sentencepiece>=0.2.0');
    }
    expect(pipArgs).not.toContain('win-voice-pkg');
    expect(pipSpawnArgs()).not.toContain('--extra-index-url');
  });

  it('detects the torch qwen3 model name via the Qwen3 prefix and installs the qwen3 engine group', async () => {
    await runDownloadWithPackages({
      voice: ['faster-whisper'],
      'qwen3-tts': ['mlx-only-marker'],
      'qwen3-tts-torch': ['torch-only-marker'],
    }, 'Qwen3-TTS-12Hz-1.7B-Torch');

    const pipArgs = pipSpawnArgs();
    const qwen3GroupInstalled = pipArgs.includes('mlx-only-marker') || pipArgs.includes('torch-only-marker');
    expect(qwen3GroupInstalled).toBe(true);
  });

  it('does not install qwen3 groups for lowercase qwen3 model names (prefix match is case-sensitive)', async () => {
    await runDownloadWithPackages({
      voice: ['faster-whisper'],
      'qwen3-tts': ['mlx-only-marker'],
      'qwen3-tts-torch': ['torch-only-marker'],
    }, 'openai-qwen3-tts-mini');

    const pipArgs = pipSpawnArgs();
    expect(pipArgs).toContain('faster-whisper');
    expect(pipArgs).not.toContain('mlx-only-marker');
    expect(pipArgs).not.toContain('torch-only-marker');
  });
});

describe('VOICE_MODEL_DOWNLOAD — pip close(null) semantics', () => {
  function mockBackendOffline(): void {
    httpGetFn.mockImplementation((_url: string, _cb: unknown) => ({
      on: (_evt: string, cb: (e: Error) => void) => {
        if (_evt === 'error') Promise.resolve().then(() => cb(new Error('backend not running')));
        return { on: vi.fn() };
      },
    }));
  }

  it('treats close(null) without a cancel as an unexpected failure', async () => {
    mockBackendOffline();
    mockPipRequirements = { voice: ['faster-whisper'] };
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    const mockChildProcess = new MockChildProcess();
    spawnFn.mockReturnValue(mockChildProcess);

    const handlerPromise = onHandlers.get('voice-model-download')?.(event, 'en');
    await flushMicrotasks();
    mockChildProcess._emit('close', null);
    await handlerPromise;

    const errorCall = event.sender.send.mock.calls.find((c) => c[1]?.error === 'voice-packages-install-failed');
    expect(errorCall).toBeTruthy();
  });

  it('treats close(null) after cancelVoicePackageInstall as an intentional abort', async () => {
    mockBackendOffline();
    mockPipRequirements = { voice: ['faster-whisper'] };
    mod.setupVoiceIPC();
    const event = createFakeEvent();
    const mockChildProcess = new MockChildProcess();
    spawnFn.mockReturnValue(mockChildProcess);

    const handlerPromise = onHandlers.get('voice-model-download')?.(event, 'en');
    await flushMicrotasks();

    mod.cancelVoicePackageInstall();
    expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGKILL');

    mockChildProcess._emit('close', null);
    await handlerPromise;
  });
});

describe('checkModelStatus — dynamic STT model name and engine propagation', () => {
  it('propagates engine and dynamic modelName from the backend STT status response', async () => {
    mod.setupVoiceIPC();
    httpGetFn.mockImplementation((opts: { path?: string } | string, cb: (res: ReturnType<typeof makeFakeResponse>) => void) => {
      const urlPath = typeof opts === 'string' ? opts : (opts.path ?? '');
      const isSttStatus = urlPath.includes('/voice/stt/status');
      const isTtsStatus = urlPath.includes('/voice/tts/status');
      const payload = isSttStatus
        ? {
            downloaded: true,
            downloading: false,
            progress: 1,
            modelName: 'mlx-community/whisper-large-v3-turbo-asr-fp16',
            engine: 'mlx',
          }
        : isTtsStatus
          ? { downloaded: true, downloading: false, progress: 1, modelName: 'Kokoro-82M' }
          : { downloaded: true, downloading: false, progress: 1 };
      const body = JSON.stringify(payload);
      const fakeRes = makeFakeResponse(200, Buffer.from(body));
      cb(fakeRes);
      Promise.resolve().then(() => {
        fakeRes._emit('data', body);
        fakeRes._emit('end');
      });
      return { on: vi.fn() };
    });

    const result = (await handleHandlers.get('voice-model-status')?.({}, 'en')) as VoiceModelStatus;
    expect(result.sttModelName).toBe('mlx-community/whisper-large-v3-turbo-asr-fp16');
    expect(result.sttEngine).toBe('mlx');
  });

  it('does not set sttEngine when the backend omits the engine field', async () => {
    mod.setupVoiceIPC();
    httpGetFn.mockImplementation((opts: { path?: string } | string, cb: (res: ReturnType<typeof makeFakeResponse>) => void) => {
      const urlPath = typeof opts === 'string' ? opts : (opts.path ?? '');
      const payload = urlPath.includes('/voice/stt/status')
        ? { downloaded: true, downloading: false, progress: 1, modelName: 'openai/whisper-small' }
        : { downloaded: true, downloading: false, progress: 1 };
      const body = JSON.stringify(payload);
      const fakeRes = makeFakeResponse(200, Buffer.from(body));
      cb(fakeRes);
      Promise.resolve().then(() => {
        fakeRes._emit('data', body);
        fakeRes._emit('end');
      });
      return { on: vi.fn() };
    });

    const result = (await handleHandlers.get('voice-model-status')?.({}, 'en')) as VoiceModelStatus;
    expect(result.sttModelName).toBe('openai/whisper-small');
    expect(result.sttEngine).toBeUndefined();
  });

  it('falls back to platform-aware DEFAULT_STT_MODEL_NAME on fetch error', async () => {
    mod.setupVoiceIPC();
    httpGetFn.mockImplementation((_url: string, _cb: unknown) => ({
      on: (_evt: string, cb: (e: Error) => void) => {
        if (_evt === 'error') Promise.resolve().then(() => cb(new Error('connection refused')));
        return { on: vi.fn() };
      },
    }));

    const result = (await handleHandlers.get('voice-model-status')?.({}, 'en')) as VoiceModelStatus;
    expect(result.sttModelName).toBe(EXPECTED_DEFAULT_STT_MODEL);
    expect(result.sttModelName).not.toBe('');
    expect(result.error).toBeTruthy();
  });
});

describe('VoiceModelStatus type — sttEngine field', () => {
  it('accepts sttEngine field at the type level (compiles and round-trips)', () => {
    const status: VoiceModelStatus = {
      sttDownloaded: true,
      ttsDownloaded: false,
      vadDownloaded: true,
      downloading: false,
      progress: 1,
      sttModelName: 'mlx-community/whisper-large-v3-turbo-asr-fp16',
      ttsModelName: 'Kokoro-82M',
      sttEngine: 'mlx',
    };
    expect(status.sttEngine).toBe('mlx');
    expect(status.sttModelName).toBe('mlx-community/whisper-large-v3-turbo-asr-fp16');
  });

  it('allows VoiceModelStatus without sttEngine (optional field)', () => {
    const status: VoiceModelStatus = {
      sttDownloaded: false,
      ttsDownloaded: false,
      vadDownloaded: true,
      downloading: false,
      progress: 0,
    };
    expect(status.sttEngine).toBeUndefined();
  });
});
