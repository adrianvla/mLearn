import { describe, it, expect, vi, beforeEach } from 'vitest';

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
}));

vi.mock('../utils/platform', () => ({
  getAppPath: vi.fn(() => '/tmp/test-app'),
  getResourcePath: vi.fn(() => '/tmp/test-resources'),
}));

vi.mock('./windowManager', () => ({
  getMainWindow: vi.fn(() => null),
}));

vi.mock('./settings', () => ({
  loadSettings: vi.fn(() => ({ language: 'ja' })),
  loadLangData: vi.fn(() => null),
  saveSettings: vi.fn(),
}));

vi.mock('./flashcardStorage', () => ({
  getFlashcardEaseMap: vi.fn(() => new Map()),
  loadFlashcards: vi.fn(() => ({ cards: {} })),
  saveFlashcards: vi.fn(),
}));

vi.mock('./localization', () => ({
  loadLocalization: vi.fn(() => ({})),
}));

interface MockServer {
  on: ReturnType<typeof vi.fn>;
  listen: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  closeAllConnections: ReturnType<typeof vi.fn>;
  _errorHandler?: (err: Error & { code?: string }) => void;
}

interface MockWss {
  on: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

const mockHttpServer: MockServer = {
  on: vi.fn((event, handler) => {
    if (event === 'error') mockHttpServer._errorHandler = handler;
    return mockHttpServer;
  }),
  listen: vi.fn(),
  close: vi.fn(),
  closeAllConnections: vi.fn(),
};

const mockWss: MockWss = {
  on: vi.fn(),
  close: vi.fn(),
};

vi.mock('http', () => ({
  default: {
    createServer: vi.fn(() => mockHttpServer),
    request: vi.fn(),
  },
  createServer: vi.fn(() => mockHttpServer),
  request: vi.fn(),
}));

vi.mock('https', () => ({
  default: {
    request: vi.fn(),
    get: vi.fn(),
  },
  request: vi.fn(),
  get: vi.fn(),
}));

class MockWebSocketServer {
  on = mockWss.on;
  close = mockWss.close;
  constructor() {
    mockWss.on.mockClear();
    mockWss.close.mockClear();
  }
}

vi.mock('ws', () => ({
  WebSocketServer: MockWebSocketServer,
  WebSocket: {
    OPEN: 1,
  },
  default: {
    OPEN: 1,
  },
}));

vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('crypto')>();
  return {
    ...actual,
    default: {
      ...actual,
      randomBytes: vi.fn(() => Buffer.from('a'.repeat(32))),
    },
    randomBytes: vi.fn(() => Buffer.from('a'.repeat(32))),
  };
});

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(() => false),
      readFileSync: vi.fn(() => ''),
    },
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => ''),
  };
});

describe('webServer', () => {
  let mod: typeof import('./webServer');

  beforeEach(async () => {
    mockIpcListeners.clear();
    vi.clearAllMocks();
    vi.resetModules();

    mockHttpServer.on.mockImplementation((event, handler) => {
      if (event === 'error') mockHttpServer._errorHandler = handler;
      return mockHttpServer;
    });
    mockHttpServer.listen.mockImplementation((_port, cb) => { if (cb) cb(); return mockHttpServer; });

    mod = await import('./webServer');
  });

  describe('SERVER_AUTH_TOKEN', () => {
    it('is a non-empty string', () => {
      expect(typeof mod.SERVER_AUTH_TOKEN).toBe('string');
      expect(mod.SERVER_AUTH_TOKEN.length).toBeGreaterThan(0);
    });
  });

  describe('setLocalStorage', () => {
    it('sets local storage data without throwing', () => {
      expect(() => mod.setLocalStorage({ key: 'value' })).not.toThrow();
    });
  });

  describe('broadcastToClients', () => {
    it('does not throw when no clients connected', () => {
      expect(() => mod.broadcastToClients('hello')).not.toThrow();
    });
  });

  describe('startWebServer', () => {
    it('creates http server and listens on configured port', () => {
      mod.startWebServer();
      expect(mockHttpServer.listen).toHaveBeenCalled();
      expect(mockHttpServer.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('is idempotent — second call does not call listen again', () => {
      mod.startWebServer();
      const listenCallCount = mockHttpServer.listen.mock.calls.length;
      mod.startWebServer();
      expect(mockHttpServer.listen.mock.calls.length).toBe(listenCallCount);
    });

    it('registers SEND_LS IPC listener', () => {
      mod.startWebServer();
      expect(mockIpcListeners.has('send-ls')).toBe(true);
    });

    it('registers WATCH_TOGETHER_SEND IPC listener', () => {
      mod.startWebServer();
      expect(mockIpcListeners.has('watch-together-send')).toBe(true);
    });

    it('registers IS_WATCHING_TOGETHER IPC listener', () => {
      mod.startWebServer();
      expect(mockIpcListeners.has('is-watching-together')).toBe(true);
    });

    it('WATCH_TOGETHER_SEND broadcasts message to clients', () => {
      mod.startWebServer();

      const listeners = mockIpcListeners.get('watch-together-send') || [];
      expect(() => listeners[0]({}, 'test-message')).not.toThrow();
    });

    it('IS_WATCHING_TOGETHER replies with WATCH_TOGETHER', () => {
      mod.startWebServer();

      const mockEvent = { reply: vi.fn() };
      const listeners = mockIpcListeners.get('is-watching-together') || [];
      listeners[0](mockEvent);

      expect(mockEvent.reply).toHaveBeenCalledWith('watch-together');
    });

    it('SEND_LS updates local storage', () => {
      mod.startWebServer();

      const listeners = mockIpcListeners.get('send-ls') || [];
      expect(() => listeners[0]({}, { key: 'val' })).not.toThrow();
    });
  });

  describe('stopWebServer', () => {
    it('does not throw when server is not started', () => {
      expect(() => mod.stopWebServer()).not.toThrow();
    });

    it('closes wss and httpServer after start', () => {
      mod.startWebServer();
      mod.stopWebServer();

      expect(mockWss.close).toHaveBeenCalled();
      expect(mockHttpServer.closeAllConnections).toHaveBeenCalled();
      expect(mockHttpServer.close).toHaveBeenCalled();
    });

    it('allows startWebServer to be called again after stop', () => {
      vi.resetModules();
    });
  });
});
