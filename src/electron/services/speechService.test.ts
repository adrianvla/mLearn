import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockIpcListeners = new Map<string, ((...args: unknown[]) => void)[]>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn((channel: string, handler: (...args: unknown[]) => void) => {
      const existing = mockIpcListeners.get(channel) || [];
      existing.push(handler);
      mockIpcListeners.set(channel, existing);
    }),
    removeHandler: vi.fn(),
  },
  app: {
    getPath: vi.fn(() => '/tmp/test'),
    isPackaged: false,
    on: vi.fn(),
  },
}));

const mockExecFile = vi.fn();
const mockKill = vi.fn();

vi.mock('child_process', () => ({
  execFile: mockExecFile,
}));

let mockIsMac = false;
let mockIsLinux = false;

vi.mock('../utils/platform', () => ({
  get isMac() { return mockIsMac; },
  get isLinux() { return mockIsLinux; },
  isWindows: false,
  PLATFORM: 'linux',
  ARCHITECTURE: 'x64',
  getUserDataPath: vi.fn(() => '/tmp/test'),
  getAppPath: vi.fn(() => '/tmp/test'),
  getResourcePath: vi.fn(() => '/tmp/test'),
}));

let mod: typeof import('./speechService');

function createMockSender(destroyed = false) {
  return {
    send: vi.fn(),
    isDestroyed: vi.fn(() => destroyed),
    id: 1,
  };
}

function createMockProcess() {
  return {
    kill: mockKill,
    pid: 123,
  };
}

beforeEach(async () => {
  vi.resetModules();
  mockIpcListeners.clear();
  vi.clearAllMocks();
  mockIsMac = false;
  mockIsLinux = false;
  mod = await import('./speechService');
});

describe('setupSpeechIPC', () => {
  it('registers TTS_SPEAK listener', () => {
    mod.setupSpeechIPC();
    expect(mockIpcListeners.has('tts-speak')).toBe(true);
  });

  it('registers TTS_STOP listener', () => {
    mod.setupSpeechIPC();
    expect(mockIpcListeners.has('tts-stop')).toBe(true);
  });

  it('registers STT_START listener', () => {
    mod.setupSpeechIPC();
    expect(mockIpcListeners.has('stt-start')).toBe(true);
  });

  it('registers STT_STOP listener', () => {
    mod.setupSpeechIPC();
    expect(mockIpcListeners.has('stt-stop')).toBe(true);
  });
});

describe('TTS_SPEAK on macOS', () => {
  beforeEach(async () => {
    mockIsMac = true;
    mockIsLinux = false;
    vi.resetModules();
    mod = await import('./speechService');
    mod.setupSpeechIPC();
  });

  it('calls execFile with say command', () => {
    const fakeProcess = createMockProcess();
    mockExecFile.mockReturnValue(fakeProcess);
    const sender = createMockSender();
    const listeners = mockIpcListeners.get('tts-speak') || [];
    listeners[0]({ sender }, 'hello world', 'en');
    expect(mockExecFile).toHaveBeenCalledWith('say', expect.arrayContaining(['-v', 'Samantha', 'hello world']), expect.any(Function));
  });

  it('uses correct voice for Japanese', () => {
    const fakeProcess = createMockProcess();
    mockExecFile.mockReturnValue(fakeProcess);
    const sender = createMockSender();
    const listeners = mockIpcListeners.get('tts-speak') || [];
    listeners[0]({ sender }, 'こんにちは', 'ja');
    expect(mockExecFile).toHaveBeenCalledWith('say', expect.arrayContaining(['-v', 'Kyoko']), expect.any(Function));
  });

  it('uses correct voice for Chinese', () => {
    const fakeProcess = createMockProcess();
    mockExecFile.mockReturnValue(fakeProcess);
    const sender = createMockSender();
    const listeners = mockIpcListeners.get('tts-speak') || [];
    listeners[0]({ sender }, '你好', 'zh');
    expect(mockExecFile).toHaveBeenCalledWith('say', expect.arrayContaining(['-v', 'Ting-Ting']), expect.any(Function));
  });

  it('uses English voice for unknown language', () => {
    const fakeProcess = createMockProcess();
    mockExecFile.mockReturnValue(fakeProcess);
    const sender = createMockSender();
    const listeners = mockIpcListeners.get('tts-speak') || [];
    listeners[0]({ sender }, 'test', 'xyz');
    expect(mockExecFile).toHaveBeenCalledWith('say', expect.arrayContaining(['-v', 'Samantha']), expect.any(Function));
  });

  it('sends TTS_STATUS with speaking:true when starting', () => {
    const fakeProcess = createMockProcess();
    mockExecFile.mockReturnValue(fakeProcess);
    const sender = createMockSender();
    const listeners = mockIpcListeners.get('tts-speak') || [];
    listeners[0]({ sender }, 'hello', 'en');
    expect(sender.send).toHaveBeenCalledWith('tts-status', { speaking: true, progress: 0 });
  });

  it('does not call execFile for empty text', () => {
    const sender = createMockSender();
    const listeners = mockIpcListeners.get('tts-speak') || [];
    listeners[0]({ sender }, '   ', 'en');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('truncates text to 500 characters', () => {
    const fakeProcess = createMockProcess();
    mockExecFile.mockReturnValue(fakeProcess);
    const sender = createMockSender();
    const longText = 'a'.repeat(600);
    const listeners = mockIpcListeners.get('tts-speak') || [];
    listeners[0]({ sender }, longText, 'en');
    const callArgs = mockExecFile.mock.calls[0];
    const passedText = callArgs[1][2];
    expect(passedText.length).toBeLessThanOrEqual(500);
  });

  it('sends done status in callback when not destroyed', () => {
    const fakeProcess = createMockProcess();
    let capturedCallback: (() => void) | undefined;
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: () => void) => {
      capturedCallback = cb;
      return fakeProcess;
    });
    const sender = createMockSender();
    const listeners = mockIpcListeners.get('tts-speak') || [];
    listeners[0]({ sender }, 'hello', 'en');
    capturedCallback?.();
    expect(sender.send).toHaveBeenCalledWith('tts-status', { speaking: false, progress: 1 });
  });

  it('does not send done status when sender is destroyed', () => {
    const fakeProcess = createMockProcess();
    let capturedCallback: (() => void) | undefined;
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: () => void) => {
      capturedCallback = cb;
      return fakeProcess;
    });
    const sender = createMockSender(true);
    const listeners = mockIpcListeners.get('tts-speak') || [];
    listeners[0]({ sender }, 'hello', 'en');
    sender.send.mockClear();
    capturedCallback?.();
    expect(sender.send).not.toHaveBeenCalled();
  });
});

describe('TTS_SPEAK on Linux', () => {
  beforeEach(async () => {
    mockIsMac = false;
    mockIsLinux = true;
    vi.resetModules();
    mod = await import('./speechService');
    mod.setupSpeechIPC();
  });

  it('calls execFile with espeak command', () => {
    const fakeProcess = createMockProcess();
    mockExecFile.mockReturnValue(fakeProcess);
    const sender = createMockSender();
    const listeners = mockIpcListeners.get('tts-speak') || [];
    listeners[0]({ sender }, 'hello', 'en');
    expect(mockExecFile).toHaveBeenCalledWith('espeak', expect.arrayContaining(['-v', 'en', 'hello']), expect.any(Function));
  });

  it('passes language code directly to espeak', () => {
    const fakeProcess = createMockProcess();
    mockExecFile.mockReturnValue(fakeProcess);
    const sender = createMockSender();
    const listeners = mockIpcListeners.get('tts-speak') || [];
    listeners[0]({ sender }, 'test', 'de');
    expect(mockExecFile).toHaveBeenCalledWith('espeak', ['-v', 'de', 'test'], expect.any(Function));
  });
});

describe('TTS_SPEAK on Windows', () => {
  beforeEach(async () => {
    mockIsMac = false;
    mockIsLinux = false;
    vi.resetModules();
    mod = await import('./speechService');
    mod.setupSpeechIPC();
  });

  it('calls execFile with powershell command', () => {
    const fakeProcess = createMockProcess();
    mockExecFile.mockReturnValue(fakeProcess);
    const sender = createMockSender();
    const listeners = mockIpcListeners.get('tts-speak') || [];
    listeners[0]({ sender }, 'hello', 'en');
    expect(mockExecFile).toHaveBeenCalledWith('powershell', expect.arrayContaining(['-Command']), expect.any(Function));
  });

  it('escapes single quotes in PowerShell command', () => {
    const fakeProcess = createMockProcess();
    mockExecFile.mockReturnValue(fakeProcess);
    const sender = createMockSender();
    const listeners = mockIpcListeners.get('tts-speak') || [];
    listeners[0]({ sender }, "it's a test", 'en');
    const callArgs = mockExecFile.mock.calls[0];
    const psCommand = callArgs[1][1];
    expect(psCommand).toContain("''");
  });
});

describe('TTS_STOP', () => {
  beforeEach(() => {
    mod.setupSpeechIPC();
  });

  it('TTS_STOP listener kills active process', () => {
    mockIsMac = true;
    const fakeProcess = createMockProcess();
    mockExecFile.mockReturnValue(fakeProcess);
    const sender = createMockSender();
    const speakListeners = mockIpcListeners.get('tts-speak') || [];
    speakListeners[0]({ sender }, 'hello', 'en');

    const stopListeners = mockIpcListeners.get('tts-stop') || [];
    stopListeners[0]({});
    expect(mockKill).toHaveBeenCalled();
  });

  it('TTS_STOP does nothing when no process is running', () => {
    const stopListeners = mockIpcListeners.get('tts-stop') || [];
    expect(() => stopListeners[0]({})).not.toThrow();
  });
});

describe('newline replacement', () => {
  beforeEach(async () => {
    mockIsMac = true;
    mockIsLinux = false;
    vi.resetModules();
    mod = await import('./speechService');
    mod.setupSpeechIPC();
  });

  it('replaces newlines with spaces before passing to say', () => {
    const fakeProcess = createMockProcess();
    mockExecFile.mockReturnValue(fakeProcess);
    const sender = createMockSender();
    const listeners = mockIpcListeners.get('tts-speak') || [];
    listeners[0]({ sender }, 'line1\nline2', 'en');
    const callArgs = mockExecFile.mock.calls[0];
    const passedText = callArgs[1][2];
    expect(passedText).toBe('line1 line2');
  });
});
