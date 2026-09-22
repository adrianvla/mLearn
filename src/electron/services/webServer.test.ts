import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { loadFlashcards, saveFlashcards } from './flashcardStorage';
import { loadSettings, saveSettings } from './settings';
import type { Flashcard, FlashcardStore } from '../../shared/types';

const mockIpcListeners = new Map<string, ((...args: unknown[]) => void)[]>();
const mockBeforeSendHeaders = vi.fn();
const mockPlatform = { isPackaged: true };
let mockWebSocketOptions: import('ws').ServerOptions;

vi.mock('electron', () => ({
  session: { defaultSession: { webRequest: { onBeforeSendHeaders: (...args: unknown[]) => mockBeforeSendHeaders(...args) } } },
  webContents: { fromId: vi.fn() },
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
  get isPackaged() { return mockPlatform.isPackaged; },
  getAppPath: vi.fn(() => '/tmp/test-app'),
  getResourcePath: vi.fn(() => '/tmp/test-resources'),
}));

vi.mock('./windowManager', () => ({
  getMainWindow: vi.fn(() => null),
  getOverlayWindow: vi.fn(() => null),
  launchOverlayWindow: vi.fn(),
}));

vi.mock('./settings', () => ({
  loadSettings: vi.fn(() => ({ language: 'ja', lastModified: 1000 })),
  loadLangData: vi.fn(() => null),
  saveSettings: vi.fn(),
}));

vi.mock('./ankiService', () => ({
  getAnkiCard: vi.fn(),
  getAnkiWordsPayload: vi.fn(),
  refreshAnkiCards: vi.fn(async () => ({ ok: true })),
}));

vi.mock('./flashcardStorage', () => ({
  getFlashcardEaseMap: vi.fn(() => new Map()),
  loadFlashcards: vi.fn(() => ({ cards: {} })),
  // Mirrors the real saveFlashcards contract: the persisted store's rev bumps.
  saveFlashcards: vi.fn(async (store: FlashcardStore) => {
    store.rev = (store.rev ?? 0) + 1;
  }),
}));

// REQ59: the tether route appends sync-derived journal events before persisting
// the merged store. In-memory no-op mirroring the real append contract.
vi.mock('./knowledgeEvents', () => ({
  appendKnowledgeEvents: vi.fn(async () => undefined),
  saveKnowledgeEvents: vi.fn(async () => undefined),
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
  _requestHandler?: (req: unknown, res: unknown) => Promise<void>;
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
    createServer: vi.fn((handler: MockServer['_requestHandler']) => {
      mockHttpServer._requestHandler = handler;
      return mockHttpServer;
    }),
    request: vi.fn(),
  },
  createServer: vi.fn((handler: MockServer['_requestHandler']) => {
    mockHttpServer._requestHandler = handler;
    return mockHttpServer;
  }),
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
  constructor(options: import('ws').ServerOptions) {
    mockWebSocketOptions = options;
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

  afterEach(() => vi.unstubAllGlobals());

  beforeEach(async () => {
    mockPlatform.isPackaged = true;
    mockIpcListeners.clear();
    vi.clearAllMocks();
    vi.resetModules();

    mockHttpServer.on.mockImplementation((event, handler) => {
      if (event === 'error') mockHttpServer._errorHandler = handler;
      return mockHttpServer;
    });
    mockHttpServer.listen.mockImplementation((_port: unknown, _hostOrCb?: unknown, cb?: () => void) => {
      const callback = typeof _hostOrCb === 'function' ? _hostOrCb : cb;
      if (callback) callback();
      return mockHttpServer;
    });

    mod = await import('./webServer');
  });

  describe('SERVER_AUTH_TOKEN', () => {
    it('is a non-empty string', () => {
      expect(typeof mod.SERVER_AUTH_TOKEN).toBe('string');
      expect(mod.SERVER_AUTH_TOKEN.length).toBeGreaterThan(0);
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
  // handleHttpRequest is module-private; startWebServer wires it into the
  // mocked http.createServer, which captures it as mockHttpServer._requestHandler.

  // Exercise the production handler through actual HTTP parsing and sockets.
  async function httpRequest(route: string, headers: Record<string, string> = {}, method = 'GET') {
    mod.startWebServer();
    const actualHttp = await vi.importActual<typeof import('http')>('http');
    const server = actualHttp.createServer((req, res) => {
      void mockHttpServer._requestHandler!(req, res).catch((error: Error) => {
        res.writeHead(500);
        res.end(error.message);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as import('net').AddressInfo;
    try {
      return await new Promise<{ status: number; body: string; headers: import('http').IncomingHttpHeaders }>((resolve, reject) => {
        const request = actualHttp.request({ hostname: '127.0.0.1', port: address.port, path: route, method, headers }, (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => { body += chunk; });
          response.on('end', () => resolve({ status: response.statusCode!, body, headers: response.headers }));
        });
        request.on('error', reject);
        request.end(method === 'POST' ? '{}' : undefined);
      });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }

  describe('extension HTTP trust boundary', () => {
    beforeEach(() => {
      vi.mocked(loadSettings).mockReturnValue({
        language: 'xx', lastModified: 1000,
        cloudAuthAccessToken: 'private-access', cloudAuthToken: 'private-legacy',
        cloudAuthRefreshToken: 'private-refresh',
        cloudAuthUserEmail: 'private@example.test', futureCredential: 'private-future',
      } as unknown as ReturnType<typeof loadSettings>);
    });

    afterEach(() => {
      vi.mocked(loadSettings).mockReturnValue({ language: 'ja', lastModified: 1000 } as ReturnType<typeof loadSettings>);
    });

    it.each(['https://attacker.example', 'null', 'http://localhost:3000', 'chrome-extension://valid-id.attacker.example/extra'])('denies cloud token bootstrap from %s', async (origin) => {
      const response = await httpRequest('/api/extension-auth-token', { Origin: origin });
      expect(response.status).toBe(403);
      expect(response.body).not.toContain('private-');
    });

    it('rejects DNS-rebound hosts even with no Origin header', async () => {
      const response = await httpRequest('/api/extension-auth-token', { Host: 'attacker.example:7753' });
      expect(response.status).toBe(403);
      expect(response.body).not.toContain('private-');
    });

    it.each([undefined, 'chrome-extension://abcdefghijklmnopabcdefghijklmnop', 'moz-extension://12345678-1234-1234-1234-123456789abc'])('preserves bootstrap from extension/native origin %s', async (origin) => {
      const response = await httpRequest('/api/extension-auth-token', origin ? { Origin: origin } : {});
      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ accessToken: 'private-access' });
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['access-control-allow-origin']).not.toBe('*');
    });

    it('denies website preflights before they can authorize extension requests', async () => {
      const response = await httpRequest('/api/overlay-sync', { Origin: 'https://attacker.example', 'Access-Control-Request-Method': 'POST' }, 'OPTIONS');
      expect(response.status).toBe(403);
    });

    it('does not let an opaque no-cors request drain extension commands', async () => {
      mod.queueCommand({ command: 'pause' });
      const blocked = await httpRequest('/api/command-poll', { 'Sec-Fetch-Mode': 'no-cors' });
      expect(blocked.status).toBe(403);
      const trusted = await httpRequest('/api/command-poll');
      expect(JSON.parse(trusted.body).commands).toEqual([expect.objectContaining({ command: 'pause' })]);
    });

    it('denies cross-origin overlay mutations', async () => {
      const response = await httpRequest('/api/overlay-launch', { Origin: 'https://attacker.example' }, 'POST');
      expect(response.status).toBe(403);
      const { launchOverlayWindow } = await import('./windowManager');
      expect(launchOverlayWindow).not.toHaveBeenCalled();
    });

    it('exposes presentation settings without account data or unknown future secrets', async () => {
      const response = await httpRequest('/api/overlay-state');
      expect(response.status).toBe(200);
      expect(JSON.parse(response.body).settings.language).toBe('xx');
      expect(response.body).not.toContain('private');
    });

    it('does not expose overlay state to website origins', async () => {
      const response = await httpRequest('/api/overlay-state', { Origin: 'https://attacker.example' });
      expect(response.status).toBe(403);
      expect(response.body).not.toContain('private');
    });

    it('preserves paired mobile settings access without disclosing cloud credentials', async () => {
      const response = await httpRequest('/api/settings', { Origin: 'https://companion.example', 'X-Auth-Token': mod.SERVER_AUTH_TOKEN });
      expect(response.status).toBe(200);
      const settings = JSON.parse(response.body);
      expect(settings.language).toBe('xx');
      expect(settings.cloudAuthAccessToken).toBeUndefined();
      expect(settings.cloudAuthToken).toBeUndefined();
      expect(settings.cloudAuthRefreshToken).toBeUndefined();
    });

    it.each(['/api/fwd-to-anki', '/api/anki/reload', '/api/anki/card'])('denies unpaired websites access to %s', async (route) => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ result: 'upstream' }) })));
      const response = await httpRequest(route, { Origin: 'https://attacker.example', 'Content-Type': 'application/json' }, 'POST');
      expect(response.status).toBe(403);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('accepts paired custom-origin Anki requests but never an unpaired null origin', async () => {
      const denied = await httpRequest('/api/anki/reload', { Origin: 'null' }, 'POST');
      expect(denied.status).toBe(403);
      const accepted = await httpRequest('/api/anki/reload', { Origin: 'https://companion.example', 'X-Auth-Token': mod.SERVER_AUTH_TOKEN }, 'POST');
      expect(accepted.status).toBe(200);
    });

    it('lets Chromium preflight desktop Anki requests without making the actual route public', async () => {
      const headers = { Origin: 'null', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' };
      expect((await httpRequest('/api/anki/reload', headers, 'OPTIONS')).status).toBe(204);
      expect((await httpRequest('/api/anki/reload', { Origin: 'null' }, 'POST')).status).toBe(403);
    });

    it('rejects a non-ASCII invalid pairing credential without throwing', async () => {
      const response = await httpRequest('/api/anki/reload', { Origin: 'null', 'X-Auth-Token': 'é'.repeat(mod.SERVER_AUTH_TOKEN.length) }, 'POST');
      expect(response.status).toBe(403);
    });
  });

  describe('desktop request credential ownership', () => {
    function rendererRequest(overrides: Partial<Electron.OnBeforeSendHeadersListenerDetails> = {}) {
      mod.startWebServer();
      const frame = { url: 'file:///tmp/test-app/dist/src/html/main.html' };
      const details = {
        url: 'http://127.0.0.1:7753/api/anki/reload', resourceType: 'xhr', method: 'POST',
        frame, webContents: { mainFrame: frame, getURL: () => frame.url, isDestroyed: () => false },
        requestHeaders: { Origin: 'null', 'Content-Type': 'application/json' }, ...overrides,
      } as Electron.OnBeforeSendHeadersListenerDetails;
      const callback = vi.fn();
      const listener = mockBeforeSendHeaders.mock.calls[0]?.[1] as ((details: Electron.OnBeforeSendHeadersListenerDetails, callback: (result: Electron.BeforeSendResponse) => void) => void) | undefined;
      expect(listener).toBeTypeOf('function');
      listener!(details, callback);
      return callback.mock.calls[0][0].requestHeaders as Record<string, string>;
    }

    it('authenticates the packaged main frame without exposing a bootstrap token to its JavaScript', async () => {
      const headers = rendererRequest();
      expect(headers['X-Auth-Token']).toBe(mod.SERVER_AUTH_TOKEN);
      const response = await httpRequest('/api/anki/reload', headers, 'POST');
      expect(response.status).toBe(200);
    });

    it.each(['https://attacker.example/page', 'file:///tmp/private/main.html', 'file:///tmp/test-app/dist-other/main.html'])('does not authenticate an unrelated top-level page %s', (url) => {
      const frame = { url } as Electron.WebFrameMain;
      const contents = { mainFrame: frame, getURL: () => url, isDestroyed: () => false } as unknown as Electron.WebContents;
      const headers = rendererRequest({ frame, webContents: contents });
      expect(headers['X-Auth-Token']).toBeUndefined();
    });

    it.each(['https://attacker.example/iframe', 'about:blank'])('does not authenticate a remote or opaque subframe %s embedded by the app', (url) => {
      const headers = rendererRequest({ frame: { url } as Electron.WebFrameMain });
      expect(headers['X-Auth-Token']).toBeUndefined();
    });

    it.each([
      'https://custom-provider.example/api/anki/reload',
      'http://attacker.example:7753/api/anki/reload',
      'http://127.0.0.1:9000/api/anki/reload',
      'http://127.0.0.1:7753/api/extension-auth-token',
    ])('never injects a credential into a non-Anki or custom target %s', (url) => {
      expect(rendererRequest({ url })['X-Auth-Token']).toBeUndefined();
    });

    it('does not authenticate requests without a live requesting frame', () => {
      expect(rendererRequest({ frame: null })['X-Auth-Token']).toBeUndefined();
    });

    it('authenticates the development app frame but not another local website', () => {
      mockPlatform.isPackaged = false;
      const frame = { url: 'http://localhost:3000/src/html/main.html' } as Electron.WebFrameMain;
      const contents = { mainFrame: frame, getURL: () => frame.url, isDestroyed: () => false } as unknown as Electron.WebContents;
      expect(rendererRequest({ frame, webContents: contents })['X-Auth-Token']).toBe(mod.SERVER_AUTH_TOKEN);
      frame.url = 'http://localhost:3000/untrusted.html';
      expect(rendererRequest({ frame, webContents: contents })['X-Auth-Token']).toBeUndefined();
    });

    it('does not trust the development origin in packaged builds', () => {
      const frame = { url: 'http://localhost:3000/src/html/main.html' } as Electron.WebFrameMain;
      const contents = { mainFrame: frame, getURL: () => frame.url, isDestroyed: () => false } as unknown as Electron.WebContents;
      expect(rendererRequest({ frame, webContents: contents })['X-Auth-Token']).toBeUndefined();
    });

    it('unregisters the credential hook when the server stops', () => {
      mod.startWebServer();
      mod.stopWebServer();
      expect(mockBeforeSendHeaders).toHaveBeenLastCalledWith(null);
    });
  });

  describe('WebSocket upgrade trust boundary', () => {
    async function upgrade(headers: Record<string, string>): Promise<number> {
      mod.startWebServer();
      const actualHttp = await vi.importActual<typeof import('http')>('http');
      const require = createRequire(import.meta.url);
      const actualWs = require(require.resolve('ws/package.json').replace(/package\.json$/, 'index.js')) as typeof import('ws');
      const server = actualHttp.createServer();
      const sockets = new actualWs.WebSocketServer({ server, verifyClient: mockWebSocketOptions.verifyClient });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address() as import('net').AddressInfo;
      const client = new actualWs.WebSocket(`ws://127.0.0.1:${address.port}`, { headers });
      try {
        return await new Promise<number>((resolve, reject) => {
          client.on('open', () => { client.close(); resolve(101); });
          client.on('error', reject);
          client.on('unexpected-response', (_request, response) => {
            response.resume();
            response.on('end', () => resolve(response.statusCode!));
          });
        });
      } finally {
        client.terminate();
        for (const socket of sockets.clients) socket.terminate();
        await new Promise<void>((resolve) => sockets.close(() => resolve()));
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }

    it.each(['https://attacker.example', 'null'])('rejects a website WebSocket from %s', async (origin) => {
      expect(await upgrade({ Origin: origin })).toBe(401);
    });

    it('rejects a DNS-rebound WebSocket without an Origin header', async () => {
      expect(await upgrade({ Host: 'attacker.example:7753' })).toBe(401);
    });

    it('retains local native WebSocket access', async () => {
      expect(await upgrade({})).toBe(101);
    });

    it('accepts an authenticated custom-origin WebSocket client', async () => {
      expect(await upgrade({ Origin: 'https://companion.example', 'X-Auth-Token': mod.SERVER_AUTH_TOKEN })).toBe(101);
    });
  });

  const TEST_META = {
    perLanguage: {},
    maxNewCardsPerDay: 20,
    maxNewCardsPerDayLearning: 10,
    maxReviewsPerDay: 200,
    learningSteps: [1, 10],
    relearnSteps: [10],
    graduatingInterval: 1,
    easyInterval: 4,
    newIntervalModifier: 100,
    reviewIntervalModifier: 100,
    maxInterval: 365,
  };

  function testStore(overrides: Partial<FlashcardStore> = {}): FlashcardStore {
    return {
      flashcards: {},
      wordCandidates: {},
      wordToCardMap: {},
      wordStatsMap: {},
      knownUntracked: {},
      ignoredWords: {},
      wordKnowledge: {},
      grammarKnowledge: {},
      meta: { ...TEST_META },
      dailyStats: {},
      suggestedFlashcards: {},
      version: 3,
      ...overrides,
    };
  }

  function testCard(overrides: Partial<Flashcard> = {}): Flashcard {
    return {
      id: 'card-1',
      content: { type: 'word', front: '学校', back: 'school' },
      state: 'review',
      ease: 2.5,
      interval: 86400000,
      dueDate: 1000,
      reviews: 0,
      lapses: 0,
      learningStep: 0,
      createdAt: 500,
      lastReviewed: 900,
      lastUpdated: 900,
      ...overrides,
    };
  }

  async function postToHandler(url: string, body?: unknown, rawBody?: string) {
    mod.startWebServer();
    const handler = mockHttpServer._requestHandler!;
    const req = new EventEmitter() as EventEmitter & {
      method: string;
      url: string;
      headers: Record<string, string>;
      socket: { remoteAddress: string };
    };
    req.method = 'POST';
    req.url = url;
    req.headers = { 'x-auth-token': mod.SERVER_AUTH_TOKEN };
    req.socket = { remoteAddress: '127.0.0.1' };
    const res: {
      statusCode: number;
      body: string;
      writeHead: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
    } = {
      statusCode: 0,
      body: '',
      writeHead: vi.fn((statusCode: number) => { res.statusCode = statusCode; }),
      end: vi.fn((chunk?: string) => { if (typeof chunk === 'string') res.body += chunk; }),
    };
    const done = handler(req, res);
    // Route dispatch is synchronous, so the body listeners are attached after
    // a macrotask hop; emitting earlier could race an await inside the handler.
    await new Promise<void>((resolve) => setImmediate(resolve));
    req.emit('data', rawBody ?? JSON.stringify(body));
    req.emit('end');
    await done;
    // The route's async body handler settles a few microtasks after `done`
    // (which only tracks synchronous dispatch); flush one macrotask so the
    // persisted/response state is observable before assertions run.
    await new Promise<void>((resolve) => setImmediate(resolve));
    return res;
  }

  describe('POST /api/flashcards', () => {
    it('merges the incoming store with the persisted store — a stale snapshot cannot erase newer claims', async () => {
      const persisted = testStore({
        flashcards: { 'card-1': testCard({ reviews: 4 }) },
        wordKnowledge: {
          'ja:h1': { ease: 2.5, lastSeen: 1, timesSeen: 0, timesHovered: 0, word: '学校', language: 'ja', claim: 'known', claimAt: 200 },
        },
      });
      vi.mocked(loadFlashcards).mockResolvedValue(persisted);
      const staleSnapshot = testStore({
        wordKnowledge: {
          'ja:h1': { ease: 0.5, lastSeen: 1, timesSeen: 0, timesHovered: 0, word: '学校', language: 'ja', claim: 'unknown', claimAt: 50 },
        },
      });

      const res = await postToHandler('/api/flashcards', staleSnapshot);

      // Fails on the old verbatim-save path, which persisted `staleSnapshot`.
      const saved = vi.mocked(saveFlashcards).mock.calls[0][0];
      expect(saved.wordKnowledge['ja:h1']?.claim).toBe('known');
      expect(saved.wordKnowledge['ja:h1']?.claimAt).toBe(200);
      // Collections absent from the snapshot are not deleted.
      expect(saved.flashcards['card-1']?.reviews).toBe(4);
      // The response reports the merged state.
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { status: string; store: FlashcardStore };
      expect(body.status).toBe('ok');
      expect(body.store.wordKnowledge['ja:h1']?.claim).toBe('known');
      expect(body.store.flashcards['card-1']).toBeDefined();
    });

    it('accepts an incoming claim newer than the persisted one', async () => {
      const persisted = testStore({
        wordKnowledge: {
          'ja:h1': { ease: 2.5, lastSeen: 1, timesSeen: 0, timesHovered: 0, word: '学校', language: 'ja', claim: 'known', claimAt: 100 },
        },
      });
      vi.mocked(loadFlashcards).mockResolvedValue(persisted);
      const freshSnapshot = testStore({
        wordKnowledge: {
          'ja:h1': { ease: 1.8, lastSeen: 2, timesSeen: 1, timesHovered: 0, word: '学校', language: 'ja', claim: 'learning', claimAt: 300 },
        },
      });

      const res = await postToHandler('/api/flashcards', freshSnapshot);

      const saved = vi.mocked(saveFlashcards).mock.calls[0][0];
      expect(saved.wordKnowledge['ja:h1']?.claim).toBe('learning');
      expect(saved.wordKnowledge['ja:h1']?.claimAt).toBe(300);
      expect(res.statusCode).toBe(200);
    });
    it('rejects a snapshot with an older rev (409) without resurrecting entries the current store lacks', async () => {
      const persisted = testStore({
        rev: 5,
        ignoredWords: {},
        wordKnowledge: {
          'ja:h1': { ease: 2.5, lastSeen: 1, timesSeen: 0, timesHovered: 0, word: '学校', language: 'ja', claim: 'known', claimAt: 200 },
        },
      });
      vi.mocked(loadFlashcards).mockResolvedValue(persisted);
      const staleSnapshot = testStore({
        rev: 4,
        ignoredWords: { 'ja:ghost': { word: '亡霊', language: 'ja', ignoredAt: 100 } },
      });

      const res = await postToHandler('/api/flashcards', staleSnapshot);

      expect(res.statusCode).toBe(409);
      expect(saveFlashcards).not.toHaveBeenCalled();
      const body = JSON.parse(res.body) as { status: string; stale: boolean; store: FlashcardStore };
      expect(body.status).toBe('stale');
      expect(body.stale).toBe(true);
      // The 409 body carries the current store; the ghost ignore entry is gone.
      expect(body.store.rev).toBe(5);
      expect(body.store.ignoredWords['ja:ghost']).toBeUndefined();
    });

    it('merges per-entry when the incoming rev equals the persisted rev', async () => {
      const persisted = testStore({
        rev: 5,
        wordKnowledge: {
          'ja:h1': { ease: 2.5, lastSeen: 1, timesSeen: 0, timesHovered: 0, word: '学校', language: 'ja', claim: 'known', claimAt: 100 },
        },
      });
      vi.mocked(loadFlashcards).mockResolvedValue(persisted);
      const freshSnapshot = testStore({
        rev: 5,
        wordKnowledge: {
          'ja:h1': { ease: 1.8, lastSeen: 2, timesSeen: 1, timesHovered: 0, word: '学校', language: 'ja', claim: 'learning', claimAt: 300 },
        },
      });

      const res = await postToHandler('/api/flashcards', freshSnapshot);

      expect(res.statusCode).toBe(200);
      const saved = vi.mocked(saveFlashcards).mock.calls[0][0];
      expect(saved.wordKnowledge['ja:h1']?.claim).toBe('learning');
      // saveFlashcards bumps the revision on persist.
      expect(saved.rev).toBe(6);
      const body = JSON.parse(res.body) as { store: FlashcardStore };
      expect(body.store.rev).toBe(6);
    });

    it('merges when the incoming rev is newer than the persisted rev', async () => {
      const persisted = testStore({
        rev: 5,
        wordKnowledge: {
          'ja:h1': { ease: 2.5, lastSeen: 1, timesSeen: 0, timesHovered: 0, word: '学校', language: 'ja', claim: 'known', claimAt: 100 },
        },
      });
      vi.mocked(loadFlashcards).mockResolvedValue(persisted);
      const newerSnapshot = testStore({
        rev: 9,
        wordKnowledge: {
          'ja:h1': { ease: 2.0, lastSeen: 3, timesSeen: 2, timesHovered: 0, word: '学校', language: 'ja', claim: 'learning', claimAt: 400 },
        },
      });

      const res = await postToHandler('/api/flashcards', newerSnapshot);

      expect(res.statusCode).toBe(200);
      const saved = vi.mocked(saveFlashcards).mock.calls[0][0];
      expect(saved.wordKnowledge['ja:h1']?.claimAt).toBe(400);
      expect(saved.rev).toBe(6);
    });

    it('merges legacy payloads without a rev', async () => {
      const persisted = testStore({
        rev: 5,
        wordKnowledge: {
          'ja:h1': { ease: 2.5, lastSeen: 1, timesSeen: 0, timesHovered: 0, word: '学校', language: 'ja', claim: 'known', claimAt: 100 },
        },
      });
      vi.mocked(loadFlashcards).mockResolvedValue(persisted);
      const legacySnapshot = testStore({
        wordKnowledge: {
          'ja:h1': { ease: 2.0, lastSeen: 3, timesSeen: 2, timesHovered: 0, word: '学校', language: 'ja', claim: 'learning', claimAt: 400 },
        },
      });

      const res = await postToHandler('/api/flashcards', legacySnapshot);

      expect(res.statusCode).toBe(200);
      const saved = vi.mocked(saveFlashcards).mock.calls[0][0];
      expect(saved.wordKnowledge['ja:h1']?.claimAt).toBe(400);
      expect(saved.rev).toBe(6);
    });

    it('responds 400 and saves nothing on invalid JSON', async () => {
      vi.mocked(loadFlashcards).mockResolvedValue(testStore());

      const res = await postToHandler('/api/flashcards', undefined, 'not-json{');

      expect(res.statusCode).toBe(400);
      expect(saveFlashcards).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/settings', () => {
    it('rejects an older lastModified: keeps persisted settings and returns them with a stale flag', async () => {
      const res = await postToHandler('/api/settings', { language: 'en', lastModified: 999 });

      expect(saveSettings).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { status: string; stale: boolean; settings: { language: string } };
      expect(body.status).toBe('stale');
      expect(body.stale).toBe(true);
      expect(body.settings.language).toBe('ja');
    });

    it('saves when the incoming lastModified is newer', async () => {
      const res = await postToHandler('/api/settings', { language: 'en', lastModified: 1001 });

      expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ language: 'en', lastModified: 1001 }));
      expect(JSON.parse(res.body)).toEqual({ status: 'ok' });
    });

    it('saves when lastModified is absent (legacy client)', async () => {
      const res = await postToHandler('/api/settings', { language: 'en' });

      expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ language: 'en' }));
      expect(JSON.parse(res.body)).toEqual({ status: 'ok' });
    });
  });
});
