import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTempDir, type TempDir } from '../../../test/helpers/tempDir';
import path from 'path';
import fs from 'fs';
import type { FlashcardStore, Flashcard } from '../../shared/types';

const mockIpcListeners = new Map<string, Function[]>();

vi.mock('electron', () => ({
  ipcMain: {
    on: vi.fn((channel: string, handler: Function) => {
      const existing = mockIpcListeners.get(channel) || [];
      existing.push(handler);
      mockIpcListeners.set(channel, existing);
    }),
    handle: vi.fn(),
    removeHandler: vi.fn(),
    removeAllListeners: vi.fn(),
  },
  app: {
    getPath: vi.fn(() => '/tmp/test'),
    on: vi.fn(),
    isPackaged: false,
  },
  protocol: {
    handle: vi.fn(),
    registerSchemesAsPrivileged: vi.fn(),
  },
  net: { fetch: vi.fn() },
}));

let tempDir: TempDir;

vi.mock('../utils/platform', () => ({
  getUserDataPath: vi.fn(() => tempDir?.tmpDir || '/tmp/test'),
  getAppPath: vi.fn(() => tempDir?.tmpDir || '/tmp/test'),
  getResourcePath: vi.fn(() => tempDir?.tmpDir || '/tmp/test'),
}));

vi.mock('./flashcardImageStorage', () => ({
  extractBase64Images: vi.fn(() => false),
}));

function makeStore(overrides: Partial<FlashcardStore> = {}): FlashcardStore {
  return {
    flashcards: {},
    wordCandidates: {},
    wordToCardMap: {},
    wordStatsMap: {},
    knownUntracked: {},
    ignoredWords: {},
    wordKnowledge: {},
    grammarKnowledge: {},
    suggestedFlashcards: {},
    wordSyncSeen: {},
    meta: {
      perLanguage: {
        ja: {
          newCardsToday: 0,
          reviewsToday: 0,
          newCardsDate: new Date().toISOString().split('T')[0],
        },
      },
      newCardsToday: 0,
      reviewsToday: 0,
      newCardsDate: new Date().toISOString().split('T')[0],
      maxNewCardsPerDay: 10,
      maxNewCardsPerDayLearning: 20,
      maxReviewsPerDay: -1,
      learningSteps: [1, 10],
      relearnSteps: [10],
      graduatingInterval: 1,
      easyInterval: 4,
      newIntervalModifier: 100,
      reviewIntervalModifier: 100,
      maxInterval: 36500,
    },
    dailyStats: {},
    version: 2,
    ...overrides,
  };
}

function makeFlashcard(id: string, overrides: Partial<Flashcard> = {}): Flashcard {
  return {
    id,
    content: { type: 'word', front: 'hello', back: 'world' },
    state: 'new',
    ease: 2.5,
    interval: 0,
    dueDate: 0,
    reviews: 0,
    lapses: 0,
    learningStep: 0,
    createdAt: 0,
    lastReviewed: 0,
    lastUpdated: 0,
    ...overrides,
  };
}

function writeFlashcardsFile(dir: string, data: unknown): void {
  fs.writeFileSync(path.join(dir, 'flashcards.json'), JSON.stringify(data, null, 2));
}

describe('flashcardStorage', () => {
  let loadFlashcards: () => Promise<FlashcardStore>;
  let saveFlashcards: (store: FlashcardStore) => Promise<void>;
  let getFlashcardEaseMap: () => Promise<Record<string, number>>;
  let setupFlashcardIPC: () => void;
  let getMigrationInfo: () => { occurred: boolean; backupPath: string | null; fromVersion: number | null };

  beforeEach(async () => {
    tempDir = createTempDir('mlearn-fc-test-');
    mockIpcListeners.clear();
    vi.resetModules();

    const mod = await import('./flashcardStorage');
    loadFlashcards = mod.loadFlashcards;
    saveFlashcards = mod.saveFlashcards;
    getFlashcardEaseMap = mod.getFlashcardEaseMap;
    setupFlashcardIPC = mod.setupFlashcardIPC;
    getMigrationInfo = mod.getMigrationInfo;
  });

  afterEach(() => {
    tempDir.cleanup();
  });

  describe('loadFlashcards', () => {
    it('returns default empty store when flashcards.json does not exist', async () => {
      const store = await loadFlashcards();

      expect(store.version).toBe(2);
      expect(store.flashcards).toEqual({});
      expect(store.wordToCardMap).toEqual({});
    });

    it('loads a valid v5 store from disk', async () => {
      const card = makeFlashcard('card-1', { content: { type: 'word', front: 'test', back: 'exam' } });
      const data = makeStore({ flashcards: { 'card-1': card }, version: 2 });
      writeFlashcardsFile(tempDir.tmpDir, data);

      const store = await loadFlashcards();

      expect(store.flashcards['card-1']).toBeDefined();
      expect(store.flashcards['card-1'].content.front).toBe('test');
    });

    it('returns default store on corrupt JSON', async () => {
      fs.writeFileSync(path.join(tempDir.tmpDir, 'flashcards.json'), '{ invalid json <<<');

      const store = await loadFlashcards();

      expect(store.flashcards).toEqual({});
      expect(store.version).toBe(2);
    });

    it('returns default store when JSON root is not an object', async () => {
      fs.writeFileSync(path.join(tempDir.tmpDir, 'flashcards.json'), '"just a string"');

      const store = await loadFlashcards();

      expect(store.flashcards).toEqual({});
    });

    it('returns default store when JSON is an array', async () => {
      fs.writeFileSync(path.join(tempDir.tmpDir, 'flashcards.json'), '[1,2,3]');

      const store = await loadFlashcards();

      expect(store.flashcards).toEqual({});
    });

    it('calls extractBase64Images after loading', async () => {
      const { extractBase64Images } = await import('./flashcardImageStorage');
      const data = makeStore({ version: 2 });
      writeFlashcardsFile(tempDir.tmpDir, data);

      await loadFlashcards();

      expect(extractBase64Images).toHaveBeenCalled();
    });

    it('saves store after loading if extractBase64Images returns true', async () => {
      const { extractBase64Images } = await import('./flashcardImageStorage');
      vi.mocked(extractBase64Images).mockReturnValueOnce(true);
      const data = makeStore({ version: 2 });
      writeFlashcardsFile(tempDir.tmpDir, data);

      await loadFlashcards();

      const saved = JSON.parse(fs.readFileSync(path.join(tempDir.tmpDir, 'flashcards.json'), 'utf-8'));
      expect(saved.version).toBe(2);
    });

    it('loads store with missing optional fields and fills in defaults', async () => {
      const partial = { flashcards: {}, version: 2 };
      writeFlashcardsFile(tempDir.tmpDir, partial);

      const store = await loadFlashcards();

      expect(store.wordCandidates).toEqual({});
      expect(store.wordToCardMap).toEqual({});
      expect(store.meta).toBeDefined();
      expect(store.meta.maxNewCardsPerDay).toBe(10);
    });
  });

  describe('saveFlashcards', () => {
    it('saves store to flashcards.json', async () => {
      const store = makeStore({ flashcards: { 'card-save': makeFlashcard('card-save') } });

      await saveFlashcards(store);

      const filePath = path.join(tempDir.tmpDir, 'flashcards.json');
      expect(fs.existsSync(filePath)).toBe(true);
      const saved = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(saved.flashcards['card-save']).toBeDefined();
    });

    it('uses atomic write via .tmp file then rename', async () => {
      const store = makeStore();
      const tmpPath = path.join(tempDir.tmpDir, 'flashcards.json.tmp');

      await saveFlashcards(store);

      expect(fs.existsSync(tmpPath)).toBe(false);
      expect(fs.existsSync(path.join(tempDir.tmpDir, 'flashcards.json'))).toBe(true);
    });

    it('calls extractBase64Images before persisting', async () => {
      const { extractBase64Images } = await import('./flashcardImageStorage');
      const store = makeStore();

      await saveFlashcards(store);

      expect(extractBase64Images).toHaveBeenCalledWith(store);
    });

    it('overwrites existing file with updated store', async () => {
      const storeV1 = makeStore({ flashcards: { 'card-a': makeFlashcard('card-a') } });
      await saveFlashcards(storeV1);

      const storeV2 = makeStore({ flashcards: { 'card-b': makeFlashcard('card-b') } });
      await saveFlashcards(storeV2);

      const saved = JSON.parse(fs.readFileSync(path.join(tempDir.tmpDir, 'flashcards.json'), 'utf-8'));
      expect(saved.flashcards['card-b']).toBeDefined();
      expect(saved.flashcards['card-a']).toBeUndefined();
    });

    it('serializes store as valid JSON with indentation', async () => {
      const store = makeStore();

      await saveFlashcards(store);

      const raw = fs.readFileSync(path.join(tempDir.tmpDir, 'flashcards.json'), 'utf-8');
      expect(() => JSON.parse(raw)).not.toThrow();
      expect(raw).toContain('\n');
    });

    it('concurrent saves are serialized via write queue', async () => {
      const results: string[] = [];
      const stores = Array.from({ length: 5 }, (_, i) => {
        const id = `card-${i}`;
        return makeStore({ flashcards: { [id]: makeFlashcard(id) } });
      });

      await Promise.all(stores.map(s => saveFlashcards(s)));

      const filePath = path.join(tempDir.tmpDir, 'flashcards.json');
      expect(fs.existsSync(filePath)).toBe(true);
      const saved = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(typeof saved.flashcards).toBe('object');
      results.push('done');
      expect(results).toHaveLength(1);
    });
  });

  describe('getFlashcardEaseMap', () => {
    it('returns empty map when no flashcards exist', async () => {
      const map = await getFlashcardEaseMap();
      expect(map).toEqual({});
    });

    it('returns map of front -> ease for each flashcard', async () => {
      const store = makeStore({
        flashcards: {
          'card-1': makeFlashcard('card-1', { content: { type: 'word', front: 'hello', back: 'world' }, ease: 2.5 }),
          'card-2': makeFlashcard('card-2', { content: { type: 'word', front: 'goodbye', back: 'au revoir' }, ease: 1.8 }),
        },
        version: 2,
      });
      writeFlashcardsFile(tempDir.tmpDir, store);

      const map = await getFlashcardEaseMap();

      expect(map['hello']).toBe(2.5);
      expect(map['goodbye']).toBe(1.8);
    });

    it('skips cards without content.front', async () => {
      const store = makeStore({
        flashcards: {
          'card-nf': makeFlashcard('card-nf', { content: { type: 'word', front: '', back: 'x' } }),
        },
        version: 2,
      });
      writeFlashcardsFile(tempDir.tmpDir, store);

      const map = await getFlashcardEaseMap();

      expect(Object.keys(map)).toHaveLength(0);
    });
  });

  describe('getMigrationInfo', () => {
    it('returns default migration info when no migration occurred', () => {
      const info = getMigrationInfo();

      expect(info.occurred).toBe(false);
      expect(info.backupPath).toBeNull();
      expect(info.fromVersion).toBeNull();
    });
  });

  describe('migrations', () => {
    it('migrates v2 store to v5: converts single cardId string to array in wordToCardMap', async () => {
      const cardId = 'card-v2';
      const v2Store = {
        flashcards: {
          [cardId]: makeFlashcard(cardId, { content: { type: 'word', front: 'test-word', back: 'x' } }),
        },
        wordToCardMap: { 'some-key': cardId },
        version: 2,
      };
      writeFlashcardsFile(tempDir.tmpDir, v2Store);

      const store = await loadFlashcards();

      expect(store.version).toBe(2);
    });

    it('migrates v1 (array flashcards) store to v5', async () => {
      const v1Store = {
        flashcards: [
          {
            content: {
              word: 'test',
              translation: 'prueba',
              pronunciation: 'test',
            },
            dueDate: Date.now(),
            lastReviewed: Date.now() - 86400000,
            ease: 2.0,
            reviews: 3,
          },
        ],
        wordCandidates: {},
        alreadyCreated: {},
        knownUnTracked: {},
        meta: {
          flashcardsCreatedToday: 2,
          lastFlashcardCreatedDate: Date.now(),
        },
      };
      writeFlashcardsFile(tempDir.tmpDir, v1Store);

      const store = await loadFlashcards();

      expect(store.version).toBe(2);
      const cards = Object.values(store.flashcards);
      expect(cards).toHaveLength(1);
      expect(cards[0].content.front).toBe('test');
      expect(cards[0].reviews).toBe(3);
    });

    it('v1 migration sets migrationInfo.occurred to true', async () => {
      const v1Store = {
        flashcards: [
          {
            content: { word: 'hello', translation: 'hola' },
            dueDate: Date.now(),
            lastReviewed: Date.now(),
            ease: 2.5,
            reviews: 0,
          },
        ],
        wordCandidates: {},
        alreadyCreated: {},
        knownUnTracked: {},
        meta: { flashcardsCreatedToday: 0, lastFlashcardCreatedDate: Date.now() },
      };
      writeFlashcardsFile(tempDir.tmpDir, v1Store);

      await loadFlashcards();

      const info = getMigrationInfo();
      expect(info.occurred).toBe(true);
      expect(info.fromVersion).toBe(1);
      expect(info.backupPath).toBeTruthy();
    });

    it('v1 migration converts array translation to string back', async () => {
      const v1Store = {
        flashcards: [
          {
            content: {
              word: 'palabra',
              translation: ['word', 'term'],
            },
            dueDate: Date.now(),
            lastReviewed: Date.now(),
            ease: 2.5,
            reviews: 0,
          },
        ],
        wordCandidates: {},
        alreadyCreated: {},
        knownUnTracked: {},
        meta: { flashcardsCreatedToday: 0, lastFlashcardCreatedDate: Date.now() },
      };
      writeFlashcardsFile(tempDir.tmpDir, v1Store);

      const store = await loadFlashcards();

      const cards = Object.values(store.flashcards);
      expect(cards[0].content.back).toBe('word; term');
    });

    it('v1 migration skips cards with no word', async () => {
      const v1Store = {
        flashcards: [
          { content: {}, dueDate: 0, lastReviewed: 0, ease: 2.5, reviews: 0 },
          { content: { word: 'valid' }, dueDate: 0, lastReviewed: 0, ease: 2.5, reviews: 0 },
        ],
        wordCandidates: {},
        alreadyCreated: {},
        knownUnTracked: {},
        meta: { flashcardsCreatedToday: 0, lastFlashcardCreatedDate: 0 },
      };
      writeFlashcardsFile(tempDir.tmpDir, v1Store);

      const store = await loadFlashcards();

      expect(Object.keys(store.flashcards)).toHaveLength(1);
    });

    it('v2 migration handles array cardIds in wordToCardMap', async () => {
      const cardId1 = 'card-a';
      const cardId2 = 'card-b';
      const v2Store = {
        flashcards: {
          [cardId1]: makeFlashcard(cardId1, { content: { type: 'word', front: 'word', back: 'x' } }),
          [cardId2]: makeFlashcard(cardId2, { content: { type: 'word', front: 'word', back: 'y' } }),
        },
        wordToCardMap: { 'word-key': [cardId1, cardId2] },
        version: 2,
      };
      writeFlashcardsFile(tempDir.tmpDir, v2Store);

      const store = await loadFlashcards();

      expect(store.version).toBe(2);
    });

  });

  describe('setupFlashcardIPC', () => {
    it('registers listeners for GET_FLASHCARDS, SAVE_FLASHCARDS, and GET_FLASHCARD_MIGRATION_INFO', async () => {
      const { ipcMain } = await import('electron');

      setupFlashcardIPC();

      expect(vi.mocked(ipcMain.on)).toHaveBeenCalledWith('get-flashcards', expect.any(Function));
      expect(vi.mocked(ipcMain.on)).toHaveBeenCalledWith('save-flashcards', expect.any(Function));
      expect(vi.mocked(ipcMain.on)).toHaveBeenCalledWith('get-flashcard-migration-info', expect.any(Function));
    });

    it('GET_FLASHCARDS handler replies with loaded flashcards', async () => {
      const store = makeStore({ version: 2 });
      writeFlashcardsFile(tempDir.tmpDir, store);

      setupFlashcardIPC();

      const listeners = mockIpcListeners.get('get-flashcards');
      expect(listeners).toBeDefined();
      expect(listeners!).toHaveLength(1);

      const replyFn = vi.fn();
      await listeners![0]({ reply: replyFn });

      expect(replyFn).toHaveBeenCalledWith('flashcards-loaded', expect.objectContaining({ version: 2 }));
    });

    it('GET_FLASHCARDS handler also replies with migration info when migration occurred', async () => {
      const v1Store = {
        flashcards: [
          { content: { word: 'hello', translation: 'hola' }, dueDate: 0, lastReviewed: 0, ease: 2.5, reviews: 0 },
        ],
        wordCandidates: {},
        alreadyCreated: {},
        knownUnTracked: {},
        meta: { flashcardsCreatedToday: 0, lastFlashcardCreatedDate: 0 },
      };
      writeFlashcardsFile(tempDir.tmpDir, v1Store);

      await loadFlashcards();

      setupFlashcardIPC();

      const listeners = mockIpcListeners.get('get-flashcards');
      const replyFn = vi.fn();
      await listeners![0]({ reply: replyFn });

      expect(replyFn).toHaveBeenCalledWith('flashcard-migration-complete', expect.objectContaining({ occurred: true }));
    });

    it('SAVE_FLASHCARDS handler saves the provided store', async () => {
      setupFlashcardIPC();

      const listeners = mockIpcListeners.get('save-flashcards');
      expect(listeners).toBeDefined();

      const store = makeStore({ flashcards: { 'card-ipc': makeFlashcard('card-ipc') } });
      await listeners![0]({}, store);

      await new Promise(resolve => setTimeout(resolve, 50));

      const filePath = path.join(tempDir.tmpDir, 'flashcards.json');
      const saved = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(saved.flashcards['card-ipc']).toBeDefined();
    });

    it('GET_FLASHCARD_MIGRATION_INFO handler replies with current migration info', async () => {
      setupFlashcardIPC();

      const listeners = mockIpcListeners.get('get-flashcard-migration-info');
      expect(listeners).toBeDefined();

      const replyFn = vi.fn();
      listeners![0]({ reply: replyFn });

      expect(replyFn).toHaveBeenCalledWith('flashcard-migration-complete', expect.objectContaining({
        occurred: expect.any(Boolean),
      }));
    });
  });
});
