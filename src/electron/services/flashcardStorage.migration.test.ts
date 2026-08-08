import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createTempDir, type TempDir } from '../../../test/helpers/tempDir';
import type { Flashcard, FlashcardStore, LanguageData } from '../../shared/types';
import { canonicalKeyHash } from '../../shared/utils/canonicalWordKey';

let tempDir: TempDir;

vi.mock('electron', () => ({ ipcMain: { on: vi.fn() } }));
vi.mock('../utils/platform', () => ({ getUserDataPath: vi.fn(() => tempDir.tmpDir) }));
vi.mock('./flashcardImageStorage', () => ({ extractBase64Images: vi.fn(() => false) }));

const mockLoadLangData = vi.hoisted(() => vi.fn());
vi.mock('./settings', () => ({ loadLangData: mockLoadLangData }));

const table = { words: {}, chars: { '學': '学', '沒': '没' } };
const zhMetadata: LanguageData = {
  name: 'Chinese',
  legacyCodes: ['zh-Hans', 'zh-Hant'],
  variants: {
    'zh-Hans': { name: 'Simplified', overrides: {} },
    'zh-Hant': { name: 'Traditional', overrides: {}, scriptConversion: { engine: 'opencc', config: 't2s', mappingAsset: 'languages/zh.t2s.json' } },
  },
};

function hash(word: string): string {
  return require('crypto').createHash('sha256').update(Buffer.from(word)).digest('hex');
}

function key(language: 'zh-Hans' | 'zh-Hant', word: string): string {
  return `${language}:${hash(word)}`;
}

function card(id: string, front: string, language: 'zh-Hans' | 'zh-Hant', overrides: Partial<Flashcard> = {}): Flashcard {
  return {
    id,
    content: { type: 'word', front, back: front },
    language,
    state: 'new', ease: 2.5, interval: 0, dueDate: 100, reviews: 0, lapses: 0,
    learningStep: 0, createdAt: 10, lastReviewed: 0, lastUpdated: 10,
    ...overrides,
  };
}

function store(overrides: Partial<FlashcardStore> = {}): FlashcardStore {
  return {
    flashcards: {}, wordCandidates: {}, wordToCardMap: {}, wordStatsMap: {}, knownUntracked: {}, ignoredWords: {}, wordKnowledge: {}, grammarKnowledge: {}, suggestedFlashcards: {}, wordSyncSeen: {},
    meta: { perLanguage: {}, maxNewCardsPerDay: 10, maxNewCardsPerDayLearning: 20, maxReviewsPerDay: -1, learningSteps: [1, 10], relearnSteps: [10], graduatingInterval: 1, easyInterval: 4, newIntervalModifier: 100, reviewIntervalModifier: 100, maxInterval: 36500 },
    dailyStats: {}, version: 2,
    ...overrides,
  };
}

function writePackage(): void {
  const languages = path.join(tempDir.tmpDir, 'language-data', 'languages');
  fs.mkdirSync(languages, { recursive: true });
  fs.writeFileSync(path.join(languages, 'zh.json'), JSON.stringify(zhMetadata));
  fs.writeFileSync(path.join(languages, 'zh.t2s.json'), JSON.stringify(table));
}

function write(input: FlashcardStore): void {
  fs.writeFileSync(path.join(tempDir.tmpDir, 'flashcards.json'), JSON.stringify(input));
}

function backups(): string[] {
  return fs.readdirSync(tempDir.tmpDir).filter(file => file.includes('-backup-v2-'));
}

describe('flashcardStorage v2→v3 zh variant migration', () => {
  let loadFlashcards: () => Promise<FlashcardStore>;

  beforeEach(async () => {
    tempDir = createTempDir('mlearn-fc-migration-');
    vi.resetModules();
    ({ loadFlashcards } = await import('./flashcardStorage'));
  });
  afterEach(() => tempDir.cleanup());

  it('(a), (h) merges colliding cards and writes a complete report beside the backup', async () => {
    writePackage();
    const hans = card('learned', '学', 'zh-Hans', { state: 'review', ease: 2.8, interval: 800, dueDate: 90, reviews: 10, lapses: 2, lastReviewed: 200, tags: ['a'] });
    const hant = card('older', '學', 'zh-Hant', { state: 'learning', ease: 1.8, interval: 20, dueDate: 50, reviews: 3, lapses: 4, lastReviewed: 100, tags: ['b'] });
    write(store({ flashcards: { learned: hans, older: hant }, wordToCardMap: { [key('zh-Hans', '学')]: ['learned'], [key('zh-Hant', '學')]: ['older'] } }));

    const migrated = await loadFlashcards();
    expect(Object.values(migrated.flashcards)).toHaveLength(1);
    expect(migrated.flashcards.learned).toMatchObject({ id: 'learned', state: 'review', ease: 2.8, interval: 800, dueDate: 50, reviews: 13, lapses: 6, language: 'zh' });
    expect(migrated.wordToCardMap).toEqual({ [canonicalKeyHash('zh', '学', { hashWord: hash, languageData: zhMetadata })]: ['learned'] });
    expect(Object.values(migrated.wordStatsMap)[0]).toMatchObject({ cardCount: 1, totalReviews: 13, totalLapses: 6 });
    expect(backups()).toHaveLength(1);
    const report = JSON.parse(fs.readFileSync(path.join(tempDir.tmpDir, 'flashcards.zh-variant-merge-report.json'), 'utf-8'));
    expect(report.loserSnapshots).toEqual([{ survivorId: 'learned', loser: hant, oldMapKeys: [key('zh-Hans', '学'), key('zh-Hant', '學')] }]);
    expect(report.collisionCounts.flashcards).toBe(1);
    expect(report.migratedKeyCounts).toBeDefined();
  });

  it('(b), (c) converges identical-script cards, grammar, and per-form knowledge', async () => {
    writePackage();
    const hansKnowledge = { word: '学', language: 'zh-Hans', ease: 2, lastSeen: 10, timesSeen: 2, timesHovered: 1, lastStatusChange: 10 };
    const hantKnowledge = { word: '學', language: 'zh-Hant', ease: 4, lastSeen: 20, timesSeen: 3, timesHovered: 2, lastStatusChange: 20 };
    write(store({
      flashcards: { h: card('h', '世界', 'zh-Hans', { reviews: 1, lastReviewed: 1 }), t: card('t', '世界', 'zh-Hant', { reviews: 2, lastReviewed: 2 }) },
      wordKnowledge: { [key('zh-Hans', '学')]: hansKnowledge, [key('zh-Hant', '學')]: hantKnowledge },
      grammarKnowledge: {
        [key('zh-Hans', '没有')]: { pattern: '没有', language: 'zh-Hans', ease: 2, timesEncountered: 2, timesFailed: 1, lastSeen: 10, level: 1 },
        [key('zh-Hant', '沒有')]: { pattern: '沒有', language: 'zh-Hant', ease: 4, timesEncountered: 3, timesFailed: 2, lastSeen: 20, level: 2 },
      },
    }));

    const migrated = await loadFlashcards();
    expect(Object.values(migrated.flashcards)).toHaveLength(1);
    const canonical = canonicalKeyHash('zh', '学', { hashWord: hash, languageData: zhMetadata });
    expect(migrated.wordKnowledge[canonical]).toMatchObject({ language: 'zh', ease: 4, lastSeen: 20, timesSeen: 5, timesHovered: 3, forms: { 'zh-Hans': { recognize: { ease: 2, lastSeen: 10, timesSeen: 2, timesHovered: 1, lastStatusChange: 10 } }, 'zh-Hant': { recognize: { ease: 4, lastSeen: 20, timesSeen: 3, timesHovered: 2, lastStatusChange: 20 } } } });
    const grammar = Object.values(migrated.grammarKnowledge);
    expect(grammar).toHaveLength(1);
    expect(Object.keys(migrated.grammarKnowledge)).toEqual([canonicalKeyHash('zh', '没有', { hashWord: hash, languageData: zhMetadata })]);
    expect(grammar[0]).toMatchObject({ language: 'zh', ease: 4, timesEncountered: 5, timesFailed: 3, lastSeen: 20 });
  });

  it('(d) recovers invertible hashes and reports prefix-only orphans', async () => {
    writePackage();
    const recoverable = key('zh-Hant', '學');
    const orphan = `zh-Hans:${hash('orphan')}`;
    write(store({ wordCandidates: { [recoverable]: { word: '學', language: 'zh-Hant', count: 1, lastSeen: 1 } }, knownUntracked: { [recoverable]: true, [orphan]: true }, wordSyncSeen: { [recoverable]: 4, [orphan]: 2 } }));

    const migrated = await loadFlashcards();
    const canonical = canonicalKeyHash('zh', '学', { hashWord: hash, languageData: zhMetadata });
    expect(migrated.knownUntracked).toEqual({ [canonical]: true, [`zh:${hash('orphan')}`]: true });
    expect(migrated.wordSyncSeen).toEqual({ [canonical]: 4, [`zh:${hash('orphan')}`]: 2 });
    const report = JSON.parse(fs.readFileSync(path.join(tempDir.tmpDir, 'flashcards.zh-variant-merge-report.json'), 'utf-8'));
    expect(report.orphanCounts).toEqual({ knownUntracked: 1, wordSyncSeen: 1 });
  });

  it('(e) merges meta and daily stats by their specified rules', async () => {
    writePackage();
    write(store({
      meta: { ...store().meta, perLanguage: { 'zh-Hans': { newCardsToday: 2, reviewsToday: 3, newCardsDate: '2026-01-01' }, 'zh-Hant': { newCardsToday: 4, reviewsToday: 5, newCardsDate: '2026-01-01' } } },
      dailyStats: { '2026-01-01': { 'zh-Hans': { date: '2026-01-01', newCardsStudied: 1, reviewCardsStudied: 2, lapses: 3, timeSpent: 4, graduated: 5 }, 'zh-Hant': { date: '2026-01-01', newCardsStudied: 6, reviewCardsStudied: 7, lapses: 8, timeSpent: 9, graduated: 10 } } },
    }));
    const migrated = await loadFlashcards();
    expect(migrated.meta.perLanguage.zh).toEqual({ newCardsToday: 6, reviewsToday: 8, newCardsDate: '2026-01-01' });
    expect(migrated.dailyStats['2026-01-01'].zh).toEqual({ date: '2026-01-01', newCardsStudied: 7, reviewCardsStudied: 9, lapses: 11, timeSpent: 13, graduated: 15 });

    write(store({ meta: { ...store().meta, perLanguage: { 'zh-Hans': { newCardsToday: 2, reviewsToday: 3, newCardsDate: '2026-01-01' }, 'zh-Hant': { newCardsToday: 4, reviewsToday: 5, newCardsDate: '2026-01-02' } } } }));
    expect((await loadFlashcards()).meta.perLanguage.zh).toEqual({ newCardsToday: 4, reviewsToday: 5, newCardsDate: '2026-01-02' });
  });

  it('(f) stamps non-zh stores without a backup or key changes', async () => {
    const original = store({ wordToCardMap: { 'ja:unchanged': ['card'] } });
    write(original);
    const migrated = await loadFlashcards();
    expect(migrated.version).toBe(3);
    expect(migrated.wordToCardMap).toEqual(original.wordToCardMap);
    expect(backups()).toHaveLength(0);
  });

  it('(g) defers untouched while the zh package is absent, then succeeds after installation', async () => {
    const original = store({ wordCandidates: { [key('zh-Hans', '学')]: { word: '学', language: 'zh-Hans', count: 1, lastSeen: 1 } } });
    write(original);
    expect(await loadFlashcards()).toEqual(original);
    expect(backups()).toHaveLength(0);
    writePackage();
    expect((await loadFlashcards()).version).toBe(3);
  });

  it('is idempotent after a successful migration', async () => {
    writePackage();
    write(store({ flashcards: { hans: card('hans', '学', 'zh-Hans'), hant: card('hant', '學', 'zh-Hant') } }));
    const once = await loadFlashcards();
    const snapshot = JSON.stringify(once);
    const backupCount = backups().length;
    const twice = await loadFlashcards();
    expect(JSON.stringify(twice)).toBe(snapshot);
    expect(backups()).toHaveLength(backupCount);
  });
});

const jaFrequencyLevels = { names: { '1': 'JLPT N1', '5': 'JLPT N5' }, rowLevelIndex: 2, difficulty: 'lower-is-harder', displayOrder: 'descending' } as const;
const jaLangData: LanguageData = {
  name: 'Japanese',
  frequencyLevels: jaFrequencyLevels,
  freq: [
    ['食べ物', 'たべもの', 5],
    ['飛行機', 'ひこうき', 5],
    ['猫', 'ねこ', 1],
  ],
};

function jaCard(id: string, front: string, overrides: Partial<Flashcard> = {}): Flashcard {
  return {
    id,
    content: { type: 'word', front, back: front, word: front },
    language: 'ja',
    state: 'new', ease: 2.5, interval: 0, dueDate: 100, reviews: 0, lapses: 0,
    learningStep: 0, createdAt: 10, lastReviewed: 0, lastUpdated: 10,
    ...overrides,
  };
}

describe('flashcardStorage level backfill', () => {
  let loadFlashcards: () => Promise<FlashcardStore>;

  beforeEach(async () => {
    tempDir = createTempDir('mlearn-fc-backfill-');
    vi.resetModules();
    mockLoadLangData.mockReset();
    ({ loadFlashcards } = await import('./flashcardStorage'));
  });
  afterEach(() => tempDir.cleanup());

  it('stamps content.level from frequency data for level-less word cards', async () => {
    mockLoadLangData.mockReturnValue({ ja: jaLangData });
    write(store({
      flashcards: {
        food: jaCard('food', '食べ物'),
        plane: jaCard('plane', '飛行機'),
        cat: jaCard('cat', '猫'),
      },
    }));

    const migrated = await loadFlashcards();
    expect(migrated.flashcards.food.content.level).toBe(5);
    expect(migrated.flashcards.plane.content.level).toBe(5);
    expect(migrated.flashcards.cat.content.level).toBe(1);
  });

  it('leaves cards that already carry a level untouched', async () => {
    mockLoadLangData.mockReturnValue({ ja: jaLangData });
    write(store({
      flashcards: {
        custom: jaCard('custom', '食べ物', { content: { type: 'word', front: '食べ物', back: 'food', word: '食べ物', level: 3 } }),
      },
    }));

    const migrated = await loadFlashcards();
    expect(migrated.flashcards.custom.content.level).toBe(3);
  });

  it('skips words absent from frequency data and languages without installed data', async () => {
    mockLoadLangData.mockReturnValue({ ja: jaLangData });
    write(store({
      flashcards: {
        rare: jaCard('rare', '存在しない語'),
        german: { ...jaCard('german', 'Haus'), id: 'german', language: 'de' },
      },
    }));

    const migrated = await loadFlashcards();
    expect(migrated.flashcards.rare.content.level).toBeUndefined();
    expect(migrated.flashcards.german.content.level).toBeUndefined();
  });

  it('no-ops when no language data is installed', async () => {
    mockLoadLangData.mockReturnValue({});
    const original = store({ flashcards: { food: jaCard('food', '食べ物') } });
    write(original);

    const migrated = await loadFlashcards();
    expect(migrated.flashcards.food.content.level).toBeUndefined();
    expect(migrated.version).toBe(3);
  });

  it('is idempotent: no freq reads once every card has a level', async () => {
    mockLoadLangData.mockReturnValue({ ja: jaLangData });
    write(store({ flashcards: { food: jaCard('food', '食べ物') } }));

    const once = await loadFlashcards();
    expect(once.flashcards.food.content.level).toBe(5);
    mockLoadLangData.mockClear();
    const twice = await loadFlashcards();
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
    expect(mockLoadLangData).not.toHaveBeenCalled();
  });
});
