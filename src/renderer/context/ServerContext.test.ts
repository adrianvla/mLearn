import { vi, describe, it, expect, beforeEach } from 'vitest';

let serverLoadCb: (msg: string) => void;
let serverStatusUpdateCb: (msg: string) => void;
let serverCriticalErrorCb: (msg: string) => void;
let installStartedCb: () => void;
let pythonSuccessCb: (success: boolean) => void;

const serverLoadCleanup = vi.fn();
const serverStatusUpdateCleanup = vi.fn();
const serverCriticalErrorCleanup = vi.fn();
const installStartedCleanup = vi.fn();
const pythonSuccessCleanup = vi.fn();

const mockBridge = {
  server: {
    isLoaded: vi.fn(),
    onServerLoad: vi.fn(),
    onServerStatusUpdate: vi.fn(),
    onServerCriticalError: vi.fn(),
    restartApp: vi.fn(),
    forceRestartApp: vi.fn(),
    restartBackend: vi.fn(),
  },
  installer: {
    onInstallStarted: vi.fn(),
    onPythonSuccess: vi.fn(),
  },
  kvStore: {
    kvGet: vi.fn(),
    kvSet: vi.fn(),
    kvSetBatch: vi.fn(),
    kvGetAll: vi.fn(),
  },
  generic: {
    sendLS: vi.fn(),
  },
};

function setupMockImplementations() {
  mockBridge.server.onServerLoad.mockImplementation((cb: (msg: string) => void) => {
    serverLoadCb = cb;
    return serverLoadCleanup;
  });
  mockBridge.server.onServerStatusUpdate.mockImplementation((cb: (msg: string) => void) => {
    serverStatusUpdateCb = cb;
    return serverStatusUpdateCleanup;
  });
  mockBridge.server.onServerCriticalError.mockImplementation((cb: (msg: string) => void) => {
    serverCriticalErrorCb = cb;
    return serverCriticalErrorCleanup;
  });
  mockBridge.installer.onInstallStarted.mockImplementation((cb: () => void) => {
    installStartedCb = cb;
    return installStartedCleanup;
  });
  mockBridge.installer.onPythonSuccess.mockImplementation((cb: (success: boolean) => void) => {
    pythonSuccessCb = cb;
    return pythonSuccessCleanup;
  });
  mockBridge.kvStore.kvGet.mockResolvedValue(null);
  mockBridge.kvStore.kvSet.mockResolvedValue(undefined);
  mockBridge.kvStore.kvSetBatch.mockResolvedValue(undefined);
  mockBridge.kvStore.kvGetAll.mockResolvedValue({});
}

vi.mock('../../shared/bridges', () => ({
  getBridge: () => mockBridge,
}));

vi.mock('../../shared/platform', () => ({
  isElectron: () => true,
}));

type ServerCtx = {
  status: () => string;
  statusMessage: () => string;
  isLoaded: () => boolean;
  isConnected: () => boolean;
  error: () => string | null;
  restart: () => void;
  forceRestart: () => void;
  restartBackend: () => void;
  resetToLoading: () => void;
};

async function mountProvider() {
  const { createRoot, createComponent } = await import('solid-js');
  const { ServerProvider, useServer } = await import('./ServerContext');
  let ctx!: ServerCtx;
  let dispose!: () => void;
  createRoot((d) => {
    dispose = d;
    createComponent(ServerProvider, {
      get children() {
        ctx = useServer();
        return null;
      },
    });
  });
  return { ctx, dispose };
}

describe('ServerContext - Electron mode', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setupMockImplementations();
  });

  it('useServer throws when used outside ServerProvider', async () => {
    const { createRoot } = await import('solid-js');
    const { useServer } = await import('./ServerContext');
    expect(() => {
      createRoot((dispose) => {
        try {
          useServer();
        } finally {
          dispose();
        }
      });
    }).toThrow('useServer must be used within a ServerProvider');
  });

  it('initial state: status=loading, statusMessage contains text, error=null, isLoaded=false', async () => {
    const { ctx, dispose } = await mountProvider();
    expect(ctx.status()).toBe('loading');
    expect(typeof ctx.statusMessage()).toBe('string');
    expect(ctx.statusMessage().length).toBeGreaterThan(0);
    expect(ctx.error()).toBeNull();
    expect(ctx.isLoaded()).toBe(false);
    dispose();
  });

  it('registers IPC listeners on mount in Electron mode', async () => {
    const { dispose } = await mountProvider();
    expect(mockBridge.server.onServerLoad).toHaveBeenCalledOnce();
    expect(mockBridge.server.onServerStatusUpdate).toHaveBeenCalledOnce();
    expect(mockBridge.server.onServerCriticalError).toHaveBeenCalledOnce();
    expect(mockBridge.installer.onInstallStarted).toHaveBeenCalledOnce();
    expect(mockBridge.installer.onPythonSuccess).toHaveBeenCalledOnce();
    expect(mockBridge.server.isLoaded).toHaveBeenCalledOnce();
    dispose();
  });

  it('server load callback: sets status=connected, clears error', async () => {
    const { ctx, dispose } = await mountProvider();
    serverLoadCb('Server ready');
    expect(ctx.status()).toBe('connected');
    expect(ctx.isLoaded()).toBe(true);
    expect(ctx.isConnected()).toBe(true);
    expect(ctx.error()).toBeNull();
    dispose();
  });

  it('server status update: updates statusMessage', async () => {
    const { ctx, dispose } = await mountProvider();
    serverStatusUpdateCb('Loading model...');
    expect(ctx.statusMessage()).toBe('Loading model...');
    dispose();
  });

  it('server status update with error keyword sets error', async () => {
    const { ctx, dispose } = await mountProvider();
    serverStatusUpdateCb('Connection error occurred');
    expect(ctx.statusMessage()).toBe('Connection error occurred');
    expect(ctx.error()).toBe('Connection error occurred');
    dispose();
  });

  it('server critical error: sets status=error, sets error message', async () => {
    const { ctx, dispose } = await mountProvider();
    serverCriticalErrorCb('Failed to start backend');
    expect(ctx.status()).toBe('error');
    expect(ctx.error()).toBe('Failed to start backend');
    dispose();
  });

  it('install started: sets status=installing', async () => {
    const { ctx, dispose } = await mountProvider();
    installStartedCb();
    expect(ctx.status()).toBe('installing');
    dispose();
  });

  it('python success=true: sets status=connected', async () => {
    const { ctx, dispose } = await mountProvider();
    pythonSuccessCb(true);
    expect(ctx.status()).toBe('connected');
    dispose();
  });

  it('python success=false: does not set status=connected', async () => {
    const { ctx, dispose } = await mountProvider();
    pythonSuccessCb(false);
    expect(ctx.status()).toBe('loading');
    dispose();
  });

  it('restart() calls bridge.server.restartApp', async () => {
    const { ctx, dispose } = await mountProvider();
    ctx.restart();
    expect(mockBridge.server.restartApp).toHaveBeenCalledOnce();
    dispose();
  });

  it('forceRestart() calls bridge.server.forceRestartApp', async () => {
    const { ctx, dispose } = await mountProvider();
    ctx.forceRestart();
    expect(mockBridge.server.forceRestartApp).toHaveBeenCalledOnce();
    dispose();
  });

  it('restartBackend() resets status to loading and calls bridge', async () => {
    const { ctx, dispose } = await mountProvider();
    serverLoadCb('Server ready');
    expect(ctx.status()).toBe('connected');
    ctx.restartBackend();
    expect(ctx.status()).toBe('loading');
    expect(ctx.statusMessage()).toBe('Restarting backend...');
    expect(ctx.error()).toBeNull();
    expect(mockBridge.server.restartBackend).toHaveBeenCalledOnce();
    dispose();
  });

  it('resetToLoading() resets status without calling bridge', async () => {
    const { ctx, dispose } = await mountProvider();
    serverLoadCb('Server ready');
    expect(ctx.status()).toBe('connected');
    ctx.resetToLoading();
    expect(ctx.status()).toBe('loading');
    expect(ctx.statusMessage()).toBe('Restarting backend...');
    expect(ctx.error()).toBeNull();
    expect(mockBridge.server.restartBackend).not.toHaveBeenCalled();
    dispose();
  });

  it('cleanup: all IPC cleanups called on dispose', async () => {
    const { dispose } = await mountProvider();
    dispose();
    expect(serverLoadCleanup).toHaveBeenCalledOnce();
    expect(serverStatusUpdateCleanup).toHaveBeenCalledOnce();
    expect(serverCriticalErrorCleanup).toHaveBeenCalledOnce();
    expect(installStartedCleanup).toHaveBeenCalledOnce();
    expect(pythonSuccessCleanup).toHaveBeenCalledOnce();
  });
});

describe('ServerContext - Non-Electron mode', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setupMockImplementations();
  });

  it('non-Electron mode: immediately sets status to connected', async () => {
    vi.doMock('../../shared/platform', () => ({
      isElectron: () => false,
    }));

    const { createRoot, createComponent } = await import('solid-js');
    const { ServerProvider, useServer } = await import('./ServerContext');
    let ctx!: ServerCtx;
    let dispose!: () => void;
    createRoot((d) => {
      dispose = d;
      createComponent(ServerProvider, {
        get children() {
          ctx = useServer();
          return null;
        },
      });
    });
    expect(ctx.status()).toBe('connected');
    expect(ctx.isLoaded()).toBe(true);
    dispose();
  });
});
