import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockIpcListeners = new Map<string, ((...args: unknown[]) => void)[]>();

const mockApp = {
  relaunch: vi.fn(),
  exit: vi.fn(),
  getPath: vi.fn(() => '/tmp/test'),
  isPackaged: false,
  on: vi.fn(),
};
const mockReloadIgnoringCache = vi.fn();
const mockGetAllWindows = vi.fn(() => [{
  isDestroyed: vi.fn(() => false),
  webContents: { reloadIgnoringCache: mockReloadIgnoringCache },
}]);

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
  app: mockApp,
  BrowserWindow: {
    getAllWindows: mockGetAllWindows,
  },
}));

const mockTerminatePythonBackend = vi.fn();
const mockIsServerLoaded = vi.fn(() => true);
const mockRestartPythonBackend = vi.fn();
const mockCreateMainWindow = vi.fn();

vi.mock('./pythonBackend', () => ({
  terminatePythonBackend: mockTerminatePythonBackend,
  isServerLoaded: mockIsServerLoaded,
  restartPythonBackend: mockRestartPythonBackend,
}));

vi.mock('./windowManager', () => ({
  createMainWindow: mockCreateMainWindow,
}));

let mod: typeof import('./processManager');

beforeEach(async () => {
  vi.resetModules();
  mockIpcListeners.clear();
  vi.clearAllMocks();
  mockApp.relaunch = vi.fn();
  mockApp.exit = vi.fn();
  mockIsServerLoaded.mockReturnValue(true);
  mod = await import('./processManager');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('restartApp', () => {
  it('calls terminatePythonBackend when server is loaded', () => {
    mockIsServerLoaded.mockReturnValue(true);
    mod.restartApp();
    expect(mockTerminatePythonBackend).toHaveBeenCalledOnce();
  });

  it('does nothing when server is not loaded', () => {
    mockIsServerLoaded.mockReturnValue(false);
    mod.restartApp();
    expect(mockTerminatePythonBackend).not.toHaveBeenCalled();
  });
});

describe('forceRestartApp', () => {
  it('restarts the runtime in place even when the server is not loaded', () => {
    mockIsServerLoaded.mockReturnValue(false);
    mod.forceRestartApp();
    expect(mockRestartPythonBackend).toHaveBeenCalledOnce();
    expect(mockReloadIgnoringCache).toHaveBeenCalledOnce();
    expect(mockTerminatePythonBackend).not.toHaveBeenCalled();
  });

  it('restarts packaged runtime settings without relaunching Electron', () => {
    vi.stubEnv('NODE_ENV', 'production');

    mod.forceRestartApp();

    expect(mockRestartPythonBackend).toHaveBeenCalledOnce();
    expect(mockReloadIgnoringCache).toHaveBeenCalledOnce();
    expect(mockTerminatePythonBackend).not.toHaveBeenCalled();
    expect(mockApp.relaunch).not.toHaveBeenCalled();
    expect(mockApp.exit).not.toHaveBeenCalled();
  });

  it('keeps the Vite process alive when applying a forced restart in development', () => {
    vi.stubEnv('NODE_ENV', 'development');

    mod.forceRestartApp();

    expect(mockRestartPythonBackend).toHaveBeenCalledOnce();
    expect(mockReloadIgnoringCache).toHaveBeenCalledOnce();
    expect(mockTerminatePythonBackend).not.toHaveBeenCalled();
    expect(mockApp.relaunch).not.toHaveBeenCalled();
    expect(mockApp.exit).not.toHaveBeenCalled();
  });
});

describe('setup completion', () => {
  it('opens the main window and restarts only the Python backend', () => {
    mod.setupKillHandlers();
    const listeners = mockIpcListeners.get('complete-initial-setup') || [];

    expect(listeners).toHaveLength(1);
    listeners[0]({});

    expect(mockRestartPythonBackend).toHaveBeenCalledOnce();
    expect(mockCreateMainWindow).toHaveBeenCalledOnce();
    expect(mockApp.relaunch).not.toHaveBeenCalled();
    expect(mockApp.exit).not.toHaveBeenCalled();
  });
});

describe('setupKillHandlers', () => {
  it('registers RESTART_APP IPC listener', () => {
    mod.setupKillHandlers();
    expect(mockIpcListeners.has('restart-app')).toBe(true);
  });

  it('registers RESTART_APP_FORCE IPC listener', () => {
    mod.setupKillHandlers();
    expect(mockIpcListeners.has('restart-app-force')).toBe(true);
  });

  it('RESTART_APP listener calls restartApp (terminates when loaded)', () => {
    mockIsServerLoaded.mockReturnValue(true);
    mod.setupKillHandlers();
    const listeners = mockIpcListeners.get('restart-app') || [];
    expect(listeners.length).toBeGreaterThan(0);
    listeners[0]({});
    expect(mockTerminatePythonBackend).toHaveBeenCalled();
  });

  it('RESTART_APP listener does nothing when server not loaded', () => {
    mockIsServerLoaded.mockReturnValue(false);
    mod.setupKillHandlers();
    const listeners = mockIpcListeners.get('restart-app') || [];
    listeners[0]({});
    expect(mockTerminatePythonBackend).not.toHaveBeenCalled();
  });

  it('RESTART_APP_FORCE listener reloads the runtime regardless of server state', () => {
    mockIsServerLoaded.mockReturnValue(false);
    mod.setupKillHandlers();
    const listeners = mockIpcListeners.get('restart-app-force') || [];
    expect(listeners.length).toBeGreaterThan(0);
    listeners[0]({});
    expect(mockRestartPythonBackend).toHaveBeenCalledOnce();
    expect(mockReloadIgnoringCache).toHaveBeenCalledOnce();
    expect(mockTerminatePythonBackend).not.toHaveBeenCalled();
  });
});
