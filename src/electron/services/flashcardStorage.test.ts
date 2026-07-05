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

function writeLanguageMetadata(dir: string, language: string, data: unknown): void {
  const languagesDir = path.join(dir, 'language-data', 'languages');
  fs.mkdirSync(languagesDir, { recursive: true });
  fs.writeFileSync(path.join(languagesDir, `${language}.json`), JSON.stringify(data, null, 2));
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

    it('strips stored top-level pitch accent content when a card has no language', async () => {
      const card = makeFlashcard('card-1', {
        content: {
          type: 'word',
          front: '赤い',
          back: 'red',
          reading: 'あかい',
          pitchAccent: 2,
        } as Flashcard['content'] & { pitchAccent: number },
      });
      const data = makeStore({ flashcards: { 'card-1': card }, version: 2 });
      writeFlashcardsFile(tempDir.tmpDir, data);

      const store = await loadFlashcards();

      const content = store.flashcards['card-1'].content as Flashcard['content'] & { pitchAccent?: number };
      expect(content.prosody).toBeUndefined();
      expect(content.pitchAccent).toBeUndefined();

      const saved = JSON.parse(fs.readFileSync(path.join(tempDir.tmpDir, 'flashcards.json'), 'utf-8'));
      expect(saved.flashcards['card-1'].content.prosody).toBeUndefined();
      expect(saved.flashcards['card-1'].content.pitchAccent).toBeUndefined();
    });

    it('migrates explicit-language legacy pitch accent only when language metadata uses Japanese pitch rendering', async () => {
      writeLanguageMetadata(tempDir.tmpDir, 'jp-test', {
        name: 'Japanese test',
        prosody: { type: 'japanese-pitch-accent' },
      });
      const card = makeFlashcard('card-1', {
        language: 'jp-test',
        content: {
          type: 'word',
          front: '赤い',
          back: 'red',
          reading: 'あかい',
          pitchAccent: 2,
        } as Flashcard['content'] & { pitchAccent: number },
      });
      const data = makeStore({ flashcards: { 'card-1': card }, version: 2 });
      writeFlashcardsFile(tempDir.tmpDir, data);

      const store = await loadFlashcards();

      expect(store.flashcards['card-1'].content.prosody).toEqual({
        type: 'japanese-pitch-accent',
        position: 2,
        raw: {
          type: 'japanese-pitch-accent',
          position: 2,
        },
      });
    });

    it('migrates legacy positional prosody to the language-declared prosody type', async () => {
      writeLanguageMetadata(tempDir.tmpDir, 'stress-test', {
        name: 'Stress test',
        prosody: { type: 'stress-position' },
      });
      const card = makeFlashcard('card-1', {
        language: 'stress-test',
        content: {
          type: 'word',
          front: 'example',
          back: 'example',
          pitchAccent: 1,
        } as Flashcard['content'] & { pitchAccent: number },
      });
      const data = makeStore({ flashcards: { 'card-1': card }, version: 2 });
      writeFlashcardsFile(tempDir.tmpDir, data);

      const store = await loadFlashcards();

      expect(store.flashcards['card-1'].content.prosody).toEqual({
        type: 'stress-position',
        position: 1,
        raw: { type: 'stress-position', position: 1 },
      });
    });

    it('strips explicit-language legacy pitch accent when language metadata is missing', async () => {
      const card = makeFlashcard('card-1', {
        language: 'missing-lang',
        content: {
          type: 'word',
          front: '赤い',
          back: 'red',
          reading: 'あかい',
          pitchAccent: 2,
        } as Flashcard['content'] & { pitchAccent: number },
      });
      const data = makeStore({ flashcards: { 'card-1': card }, version: 2 });
      writeFlashcardsFile(tempDir.tmpDir, data);

      const store = await loadFlashcards();

      const content = store.flashcards['card-1'].content as Flashcard['content'] & { pitchAccent?: number };
      expect(content.pitchAccent).toBeUndefined();
      expect(content.prosody).toBeUndefined();

      const saved = JSON.parse(fs.readFileSync(path.join(tempDir.tmpDir, 'flashcards.json'), 'utf-8'));
      expect(saved.flashcards['card-1'].content.pitchAccent).toBeUndefined();
      expect(saved.flashcards['card-1'].content.prosody).toBeUndefined();
    });

    it('strips legacy pitch accent fields from non-Japanese-prosody cards without inventing Japanese prosody', async () => {
      writeLanguageMetadata(tempDir.tmpDir, 'de', {
        name: 'German',
        prosody: { type: 'none' },
      });
      const card = makeFlashcard('card-1', {
        language: 'de',
        content: {
          type: 'word',
          front: 'rot',
          back: 'red',
          pitchAccent: 2,
          prosody: {
            type: 'none',
            pitchAccentPosition: 2,
          },
        } as Flashcard['content'] & {
          pitchAccent: number;
          prosody: Flashcard['content']['prosody'] & { pitchAccentPosition: number };
        },
      });
      const data = makeStore({ flashcards: { 'card-1': card }, version: 2 });
      writeFlashcardsFile(tempDir.tmpDir, data);

      const store = await loadFlashcards();

      const content = store.flashcards['card-1'].content as Flashcard['content'] & { pitchAccent?: number };
      expect(content.prosody).toEqual({ type: 'none' });
      expect(content.pitchAccent).toBeUndefined();
      expect(
        (content.prosody as Flashcard['content']['prosody'] & { pitchAccentPosition?: number })?.pitchAccentPosition
      ).toBeUndefined();
    });

    it('migrates stale prosody pitch accent position into the generic position field', async () => {
      const card = makeFlashcard('card-1', {
        content: {
          type: 'word',
          front: '赤い',
          back: 'red',
          reading: 'あかい',
          prosody: {
            type: 'japanese-pitch-accent',
            pitchAccentPosition: 2,
          },
        } as Flashcard['content'] & {
          prosody: Flashcard['content']['prosody'] & { pitchAccentPosition: number };
        },
      });
      const data = makeStore({ flashcards: { 'card-1': card }, version: 2 });
      writeFlashcardsFile(tempDir.tmpDir, data);

      const store = await loadFlashcards();

      expect(store.flashcards['card-1'].content.prosody?.position).toBe(2);
      expect(
        (store.flashcards['card-1'].content.prosody as Flashcard['content']['prosody'] & { pitchAccentPosition?: number })
          ?.pitchAccentPosition
      ).toBeUndefined();

      const saved = JSON.parse(fs.readFileSync(path.join(tempDir.tmpDir, 'flashcards.json'), 'utf-8'));
      expect(saved.flashcards['card-1'].content.prosody.position).toBe(2);
      expect(saved.flashcards['card-1'].content.prosody.pitchAccentPosition).toBeUndefined();
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

    it('persists current generic prosody content without Japanese-specific rewrite', async () => {
      const card = makeFlashcard('card-1', {
        content: {
          type: 'word',
          front: 'سلام',
          back: 'hello',
          prosody: {
            type: 'tone-contour',
            position: 1,
            raw: { contour: 'LH' },
          },
        },
      });

      await saveFlashcards(makeStore({ flashcards: { 'card-1': card } }));

      const saved = JSON.parse(fs.readFileSync(path.join(tempDir.tmpDir, 'flashcards.json'), 'utf-8'));
      expect(saved.flashcards['card-1'].content.prosody).toEqual({
        type: 'tone-contour',
        position: 1,
        raw: { contour: 'LH' },
      });
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

    it('assigns migrated v1 flashcards to the configured learning language', async () => {
      fs.writeFileSync(path.join(tempDir.tmpDir, 'settings.json'), JSON.stringify({ language: 'de' }));
      const v1Store = {
        flashcards: [
          {
            content: {
              word: 'hallo',
              translation: 'hello',
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
      const [card] = Object.values(store.flashcards);

      expect(card.language).toBe('de');
      expect(store.meta.perLanguage.de).toBeDefined();
      expect(store.meta.perLanguage.ja).toBeUndefined();
    });

    it('does not invent Japanese prosody when migrating v1 cards into a non-Japanese language', async () => {
      fs.writeFileSync(path.join(tempDir.tmpDir, 'settings.json'), JSON.stringify({ language: 'de' }));
      writeLanguageMetadata(tempDir.tmpDir, 'de', {
        name: 'German',
        prosody: { type: 'none' },
      });
      const v1Store = {
        flashcards: [
          {
            content: {
              word: 'hallo',
              translation: 'hello',
              pronunciation: 'hallo',
              pitchAccent: 2,
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
      const [card] = Object.values(store.flashcards);

      expect(card.language).toBe('de');
      expect(card.content.prosody).toBeUndefined();
    });

    it('does not invent Japanese prosody when migrating v1 cards without a known language', async () => {
      const v1Store = {
        flashcards: [
          {
            content: {
              word: 'legacy',
              translation: 'legacy',
              pronunciation: 'legacy',
              pitchAccent: 2,
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
      const [card] = Object.values(store.flashcards);

      expect(card.language).toBeUndefined();
      expect(card.content.prosody).toBeUndefined();
    });

    it('assigns migrated v1 flashcards to the single installed language when settings are missing', async () => {
      const languagesDir = path.join(tempDir.tmpDir, 'language-data', 'languages');
      fs.mkdirSync(languagesDir, { recursive: true });
      fs.writeFileSync(path.join(languagesDir, 'ru.json'), '{}');
      const v1Store = {
        flashcards: [
          {
            content: {
              word: 'привет',
              translation: 'hello',
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
      const [card] = Object.values(store.flashcards);

      expect(card.language).toBe('ru');
      expect(store.meta.perLanguage.ru).toBeDefined();
      expect(store.meta.perLanguage.ja).toBeUndefined();
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
