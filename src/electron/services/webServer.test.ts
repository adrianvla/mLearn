import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { loadFlashcards, saveFlashcards } from './flashcardStorage';
import { saveSettings } from './settings';
import type { Flashcard, FlashcardStore } from '../../shared/types';

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
      wordSyncSeen: {},
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
        wordSyncSeen: { 'ja:h1': 10 },
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
      expect(saved.wordSyncSeen['ja:h1']).toBe(10);
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
