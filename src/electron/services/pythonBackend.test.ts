import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTempDir, type TempDir } from '../../../test/helpers/tempDir';
import path from 'path';
import fs from 'fs';

const mockIpcListeners = new Map<string, ((...args: unknown[]) => void)[]>();

vi.mock('electron', () => ({
  ipcMain: {
    on: vi.fn((channel: string, handler: (...args: unknown[]) => void) => {
      const existing = mockIpcListeners.get(channel) || [];
      existing.push(handler);
      mockIpcListeners.set(channel, existing);
    }),
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
  app: {
    getVersion: vi.fn(() => '1.0.0'),
  },
}));

const mockSpawn = vi.fn();
const mockExec = vi.fn();
const mockExecSync = vi.fn(() => '');

vi.mock('child_process', () => ({
  spawn: mockSpawn,
  exec: mockExec,
  execSync: mockExecSync,
  ChildProcess: class {},
}));

const mockTarExtract = vi.fn(() => Promise.resolve());
vi.mock('tar', () => ({
  x: mockTarExtract,
}));

vi.mock('../utils/platform', () => ({
  getResourcePath: vi.fn(() => '/tmp/test-resources'),
  getAppPath: vi.fn(() => '/tmp/test-resources'),
  getUserDataPath: vi.fn(() => '/tmp/test-userdata'),
  getPythonExecutablePath: vi.fn(() => '/tmp/test-resources/env/bin/python3'),
  getPipExecutablePath: vi.fn(() => '/tmp/test-resources/env/bin/pip'),
  getPythonDownloadUrl: vi.fn(() => 'https://example.com/python.tar.gz'),
  isWindows: false,
}));

const mockGetCurrentWindow = vi.fn();
const mockGetMainWindow = vi.fn();

vi.mock('./windowManager', () => ({
  getCurrentWindow: mockGetCurrentWindow,
  getMainWindow: mockGetMainWindow,
}));

vi.mock('./settings', () => ({
  loadSettings: vi.fn(() => ({
    ankiConnectUrl: 'http://127.0.0.1:8765',
    use_anki: true,
    language: 'ja',
    llmEnabled: true,
    ocrEnabled: true,
  })),
}));

type MockReqCallbacks = Record<string, ((...args: unknown[]) => void)[]>;

interface MockHttpReq {
  write: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  _callbacks: MockReqCallbacks;
}

interface MockHttpRes {
  statusCode: number;
  headers: Record<string, string>;
  on: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
  pipe: ReturnType<typeof vi.fn>;
  _callbacks: MockReqCallbacks;
}

function createMockHttpRes(statusCode: number): MockHttpRes {
  const callbacks: MockReqCallbacks = {};
  const res: MockHttpRes = {
    statusCode,
    headers: {},
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      callbacks[event] = callbacks[event] ?? [];
      callbacks[event].push(cb);
      return res;
    }),
    resume: vi.fn(),
    pipe: vi.fn(),
    _callbacks: callbacks,
  } as unknown as MockHttpRes;
  return res;
}

function createMockHttpReq(): MockHttpReq {
  const callbacks: MockReqCallbacks = {};
  const req: MockHttpReq = {
    write: vi.fn(),
    end: vi.fn(),
    destroy: vi.fn(),
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      callbacks[event] = callbacks[event] ?? [];
      callbacks[event].push(cb);
      return req;
    }),
    _callbacks: callbacks,
  } as unknown as MockHttpReq;
  return req;
}

const mockHttpRequest = vi.fn();
vi.mock('http', () => ({
  default: {
    request: mockHttpRequest,
  },
}));

const mockHttpsGet = vi.fn();
vi.mock('https', () => ({
  default: {
    get: mockHttpsGet,
  },
  get: mockHttpsGet,
}));

const mockWriteStream = {
  on: vi.fn(),
  destroy: vi.fn(),
  close: vi.fn(),
};
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    default: {
      ...actual,
      createWriteStream: vi.fn(() => mockWriteStream),
    },
    createWriteStream: vi.fn(() => mockWriteStream),
  };
});

describe('pythonBackend', () => {
  let mod: typeof import('./pythonBackend');
  let tempDir: TempDir;

  beforeEach(async () => {
    tempDir = createTempDir('mlearn-python-test-');
    mockIpcListeners.clear();
    vi.clearAllMocks();
    vi.resetModules();

    Object.defineProperty(process, 'resourcesPath', {
      value: '/tmp/test-resources',
      writable: true,
      configurable: true,
    });

    mockGetCurrentWindow.mockReturnValue(null);
    mockGetMainWindow.mockReturnValue(null);

    fs.mkdirSync('/tmp/test-userdata', { recursive: true });
    fs.writeFileSync('/tmp/test-userdata/python-version.txt', '1.0.0');

    mod = await import('./pythonBackend');
  });

  afterEach(() => {
    tempDir.cleanup();
  });

  describe('isServerLoaded', () => {
    it('returns false initially', () => {
      expect(mod.isServerLoaded()).toBe(false);
    });
  });

  describe('getPythonProcess', () => {
    it('returns null initially', () => {
      expect(mod.getPythonProcess()).toBeNull();
    });
  });

  describe('findPython', () => {
    it('returns false and sets waiting when python not found', async () => {
      const result = await mod.findPython();
      expect(result).toBe(false);
    });

    it('returns true when python exists under resourcesPath', async () => {
      const envBin = path.join(tempDir.tmpDir, 'env', 'bin');
      fs.mkdirSync(envBin, { recursive: true });
      fs.writeFileSync(path.join(envBin, 'python3'), '');

      Object.defineProperty(process, 'resourcesPath', {
        value: tempDir.tmpDir,
        writable: true,
        configurable: true,
      });

      const mockProcess = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (event === 'close') {
            handler(0);
          }
        }),
        kill: vi.fn(),
        killed: false,
      };
      mockSpawn.mockReturnValue(mockProcess);

      vi.resetModules();
      mod = await import('./pythonBackend');

      const result = await mod.findPython();
      expect(result).toBe(true);
    });

    it('sends INSTALLER_AWAITING_CHOICE when python not found', async () => {
      const mockWebContents = { send: vi.fn() };
      mockGetCurrentWindow.mockReturnValue({ webContents: mockWebContents });

      await mod.findPython();

      expect(mockWebContents.send).toHaveBeenCalledWith('installer-awaiting-choice');
    });
  });

  describe('startPythonInstall', () => {
    it('does nothing when install is already in progress', () => {
      const mockWebContents = { send: vi.fn() };
      mockGetCurrentWindow.mockReturnValue({ webContents: mockWebContents });

      mockHttpsGet.mockReturnValue(createMockHttpReq());

      mod.startPythonInstall({ includeLLM: true, includeOCR: true, includeVoice: true });
      const sendCount = mockWebContents.send.mock.calls.length;
      mod.startPythonInstall({ includeLLM: true, includeOCR: true, includeVoice: true });

      expect(mockWebContents.send.mock.calls.length).toBe(sendCount);
    });

    it('sends INSTALL_STARTED with options', async () => {
      const mockWebContents = { send: vi.fn() };
      mockGetCurrentWindow.mockReturnValue({ webContents: mockWebContents });

      mockHttpsGet.mockReturnValue(createMockHttpReq());

      const options = { includeLLM: false, includeOCR: true, includeVoice: false };
      await mod.startPythonInstall(options);

      expect(mockWebContents.send).toHaveBeenCalledWith('install-started', options);
    });

    it('initiates https download', async () => {
      const mockWebContents = { send: vi.fn() };
      mockGetCurrentWindow.mockReturnValue({ webContents: mockWebContents });

      mockHttpsGet.mockReturnValue(createMockHttpReq());

      await mod.startPythonInstall({ includeLLM: true, includeOCR: true, includeVoice: true });

      expect(mockHttpsGet).toHaveBeenCalled();
    });
  });

  describe('terminatePythonBackend', () => {
    it('does nothing when no process running', () => {
      expect(() => mod.terminatePythonBackend()).not.toThrow();
    });

    it('kills process when one is running', async () => {
      const envBin = path.join(tempDir.tmpDir, 'env', 'bin');
      fs.mkdirSync(envBin, { recursive: true });
      fs.writeFileSync(path.join(envBin, 'python3'), '');

      Object.defineProperty(process, 'resourcesPath', {
        value: tempDir.tmpDir,
        writable: true,
        configurable: true,
      });

      const backendMockProcess = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
        killed: false,
      };

      mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === '--version') {
          return {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn() },
            on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
              if (event === 'close') {
                handler(0);
              }
            }),
            kill: vi.fn(),
            killed: false,
          };
        }
        return backendMockProcess;
      });

      vi.resetModules();
      mod = await import('./pythonBackend');

      await mod.findPython();

      const mockHttpReq = createMockHttpReq();
      mockHttpRequest.mockImplementation((_opts: unknown, cb: (res: MockHttpRes) => void) => {
        const res = createMockHttpRes(200);
        cb(res);
        return mockHttpReq;
      });

      mod.terminatePythonBackend();

      expect(backendMockProcess.kill).toHaveBeenCalledWith('SIGINT');
    });
  });

  describe('restartPythonBackend', () => {
    it('does not throw when called without running process', () => {
      expect(() => mod.restartPythonBackend()).not.toThrow();
    });
  });

  describe('setupPythonBackendIPC', () => {
    it('registers all expected IPC channels', () => {
      mod.setupPythonBackendIPC();

      expect(mockIpcListeners.has('is-successful-install')).toBe(true);
      expect(mockIpcListeners.has('is-loaded')).toBe(true);
      expect(mockIpcListeners.has('start-install')).toBe(true);
      expect(mockIpcListeners.has('installer-state-request')).toBe(true);
      expect(mockIpcListeners.has('restart-backend')).toBe(true);
      expect(mockIpcListeners.has('restart-backend-anki-override')).toBe(true);
    });

    it('IS_SUCCESSFUL_INSTALL replies with pythonSuccessInstall status', () => {
      mod.setupPythonBackendIPC();

      const mockEvent = { reply: vi.fn() };
      const listeners = mockIpcListeners.get('is-successful-install') || [];
      listeners[0](mockEvent);

      expect(mockEvent.reply).toHaveBeenCalledWith('successful-install', false);
    });

    it('IS_LOADED does not send server-load when server is not loaded', () => {
      mod.setupPythonBackendIPC();

      const mockEvent = { reply: vi.fn(), sender: { send: vi.fn() } };
      const listeners = mockIpcListeners.get('is-loaded') || [];
      listeners[0](mockEvent);

      expect(mockEvent.reply).not.toHaveBeenCalledWith('server-load', expect.anything());
    });

    it('IS_LOADED replays buffered cache-loaded startup status once', async () => {
      const envBin = path.join(tempDir.tmpDir, 'env', 'bin');
      fs.mkdirSync(envBin, { recursive: true });
      fs.writeFileSync(path.join(envBin, 'python3'), '');

      Object.defineProperty(process, 'resourcesPath', {
        value: tempDir.tmpDir,
        writable: true,
        configurable: true,
      });

      let stdoutHandler: ((data: Buffer) => void) | null = null;
      const mockProcess = {
        stdout: {
          on: vi.fn((event: string, handler: (data: Buffer) => void) => {
            if (event === 'data') {
              stdoutHandler = handler;
            }
          }),
        },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (event === 'close') {
            handler(0);
          }
        }),
        kill: vi.fn(),
        killed: false,
      };
      mockSpawn.mockReturnValue(mockProcess);

      vi.resetModules();
      mod = await import('./pythonBackend');

      await mod.findPython();
      stdoutHandler!(Buffer.from('::STATUS::ANKI::123::Loaded from cache\n'));

      mod.setupPythonBackendIPC();

      const firstEvent = { reply: vi.fn(), sender: { send: vi.fn() } };
      const secondEvent = { reply: vi.fn(), sender: { send: vi.fn() } };
      const listeners = mockIpcListeners.get('is-loaded') || [];

      listeners[0](firstEvent);
      listeners[0](secondEvent);

      expect(firstEvent.sender.send).toHaveBeenCalledWith('server-status-update', 'Loaded from cache');
      expect(secondEvent.sender.send).not.toHaveBeenCalledWith('server-status-update', 'Loaded from cache');
    });

    it('INSTALLER_STATE_REQUEST replies with current installer state', () => {
      mod.setupPythonBackendIPC();

      const mockEvent = { reply: vi.fn() };
      const listeners = mockIpcListeners.get('installer-state-request') || [];
      listeners[0](mockEvent);

      expect(mockEvent.reply).toHaveBeenCalledWith(
        'installer-state',
        expect.objectContaining({
          waiting: expect.any(Boolean),
          inProgress: expect.any(Boolean),
          success: expect.any(Boolean),
        }),
      );
    });

    it('START_INSTALL triggers startPythonInstall with options', async () => {
      const mockWebContents = { send: vi.fn() };
      mockGetCurrentWindow.mockReturnValue({ webContents: mockWebContents });

      mockHttpsGet.mockReturnValue(createMockHttpReq());

      mod.setupPythonBackendIPC();

      const listeners = mockIpcListeners.get('start-install') || [];
      await listeners[0]({}, { includeLLM: false, includeOCR: true });

      expect(mockWebContents.send).toHaveBeenCalledWith(
        'install-started',
        expect.objectContaining({ includeLLM: false, includeOCR: true }),
      );
    });

    it('START_INSTALL uses defaults when rawOptions is null', async () => {
      const mockWebContents = { send: vi.fn() };
      mockGetCurrentWindow.mockReturnValue({ webContents: mockWebContents });

      mockHttpsGet.mockReturnValue(createMockHttpReq());

      mod.setupPythonBackendIPC();

      const listeners = mockIpcListeners.get('start-install') || [];
      await listeners[0]({}, null);

      expect(mockWebContents.send).toHaveBeenCalledWith(
        'install-started',
        expect.objectContaining({ includeLLM: true, includeOCR: true }),
      );
    });

    it('RESTART_BACKEND calls restartPythonBackend without throwing', () => {
      mod.setupPythonBackendIPC();

      const listeners = mockIpcListeners.get('restart-backend') || [];
      expect(() => listeners[0]({})).not.toThrow();
    });

    it('RESTART_BACKEND_ANKI_OVERRIDE sets anki override and restarts without throwing', () => {
      mod.setupPythonBackendIPC();

      const listeners = mockIpcListeners.get('restart-backend-anki-override') || [];
      expect(() => listeners[0]({}, true)).not.toThrow();
    });
  });
});
