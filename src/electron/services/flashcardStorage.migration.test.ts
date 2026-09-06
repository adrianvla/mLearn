import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createTempDir, type TempDir } from '../../../test/helpers/tempDir';
import type { Flashcard, FlashcardStore, LanguageData, PassiveWordKnowledge, Settings } from '../../shared/types';
import { canonicalKeyHash } from '../../shared/utils/canonicalWordKey';
import { CURRENT_NORMALIZATION_VERSION } from '../../shared/utils/normalizationVersion';
import { clearMappingTables, registerMappingTable } from '../../shared/languageFeatures';

let tempDir: TempDir;

vi.mock('electron', () => ({ ipcMain: { on: vi.fn() } }));
vi.mock('../utils/platform', () => ({ getUserDataPath: vi.fn(() => tempDir.tmpDir) }));
vi.mock('./flashcardImageStorage', () => ({ extractBase64Images: vi.fn(() => false) }));

const mockLoadLangData = vi.hoisted(() => vi.fn());
const mockLoadSettings = vi.hoisted(() => vi.fn());
vi.mock('./settings', () => ({ loadLangData: mockLoadLangData, loadSettings: mockLoadSettings }));

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
    mockLoadLangData.mockReturnValue({ zh: zhMetadata });
    mockLoadSettings.mockReturnValue({ frequencyProviderSelections: {}, frequencyLevelSystemSelections: {} } as Settings);
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
    const deferred = await loadFlashcards();
    // zh migration defers (no backup, no key changes); the normalization-version
    // stamp on meta is orthogonal bookkeeping and is expected on every legacy store.
    expect(deferred.wordCandidates).toEqual(original.wordCandidates);
    expect(deferred.knownUntracked).toEqual(original.knownUntracked);
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

const casefoldPackage: LanguageData = {
  name: 'Ambient-casing test',
  textProcessing: {
    lexemeNormalization: {
      type: 'surface',
      surfaceScripts: ['Latn'],
      // v2 pins casefold to the root locale ('und'); v1 used the AMBIENT host
      // locale, so a Turkish host hashed 'Izmir' -> 'ızmir' while v2 hashes
      // 'izmir'. This package is locale-sensitive through its casing step.
      surfaceNormalizers: ['casefold'],
    },
  },
};

const trLocalePackage: LanguageData = {
  name: 'Turkic locale test',
  textProcessing: {
    lexemeNormalization: {
      type: 'surface',
      surfaceScripts: ['Latn'],
      surfaceNormalizers: [{ type: 'lowercase-locale', locale: 'tr' }],
    },
  },
};

const zhMappingPackage: LanguageData = {
  name: 'Zh mapping test',
  textProcessing: {
    lexemeNormalization: {
      type: 'surface',
      surfaceScripts: ['Han'],
      mappingTableAsset: 'languages/zh.t2s.json',
      surfaceNormalizers: [{ type: 'mapping-table' }],
    },
  },
};

function langCard(id: string, front: string, language: string, overrides: Partial<Flashcard> = {}): Flashcard {
  return {
    id,
    content: { type: 'word', front, back: front },
    language,
    state: 'new', ease: 2.5, interval: 0, dueDate: 100, reviews: 0, lapses: 0,
    learningStep: 0, createdAt: 10, lastReviewed: 0, lastUpdated: 10,
    ...overrides,
  };
}

function legacyKnowledge(word: string | undefined, language: string, lastSeen: number): PassiveWordKnowledge {
  return {
    ease: 2.5,
    lastSeen,
    timesSeen: 3,
    timesHovered: 1,
    ...(word !== undefined ? { word } : {}),
    language,
  } as PassiveWordKnowledge;
}

describe('flashcardStorage normalization-version keyed-record migration (D3)', () => {
  let loadFlashcards: () => Promise<FlashcardStore>;

  beforeEach(async () => {
    tempDir = createTempDir('mlearn-fc-norm-');
    vi.resetModules();
    mockLoadLangData.mockReset();
    mockLoadSettings.mockReset();
    mockLoadSettings.mockReturnValue({ frequencyProviderSelections: {}, frequencyLevelSystemSelections: {} } as Settings);
    ({ loadFlashcards } = await import('./flashcardStorage'));
  });
  afterEach(() => tempDir.cleanup());

  it('rebuilds mixed-language source-backed records under v2 keys and carries non-attributable cards', async () => {
    mockLoadLangData.mockReturnValue({ tst: casefoldPackage, zh: zhMappingPackage });
    const { registerMappingTable } = await import('../../shared/languageFeatures');
    registerMappingTable('zh', { words: {}, chars: { '學': '学' } });
    const legacyIzmirKey = `tst:${hash('ızmir')}`; // v1 ambient Turkish host casing
    const legacyXizmirKey = `tst:${hash('izmir')}`; // v1 ambient English host casing
    write(store({
      flashcards: {
        izmir: langCard('izmir', 'Izmir', 'tst'),
        xue: langCard('xue', '學', 'zh'),
        anon: { ...langCard('anon', 'xyz', ''), id: 'anon', language: undefined as unknown as string },
      },
      wordToCardMap: { [legacyIzmirKey]: ['izmir'], [legacyXizmirKey]: ['izmir'], [key('zh', '學')]: ['xue'], 'legacy-bare': ['anon'] },
    }));

    const migrated = await loadFlashcards();
    // Both legacy ambient casings converge on the single v2 key (card rebuilt once).
    expect(migrated.wordToCardMap[`tst:${hash('izmir')}`]).toEqual(['izmir']);
    expect(migrated.wordToCardMap[`zh:${hash('学')}`]).toEqual(['xue']);
    expect(migrated.wordToCardMap['legacy-bare']).toEqual(['anon']);
    expect(Object.keys(migrated.wordToCardMap).sort()).toEqual([`tst:${hash('izmir')}`, `zh:${hash('学')}`, 'legacy-bare'].sort());
    expect(migrated.wordStatsMap[`tst:${hash('izmir')}`]?.cardCount).toBe(1);
    expect(migrated.meta.normalizationVersion).toBe(CURRENT_NORMALIZATION_VERSION);
    clearMappingTables();
  });

  it('keeps identity keys for languages without installed package metadata', async () => {
    mockLoadLangData.mockReturnValue({});
    const rawKey = `xx:${hash('Merkwürdig')}`;
    write(store({
      flashcards: { w: langCard('w', 'Merkwürdig', 'xx') },
      wordToCardMap: { [rawKey]: ['w'] },
      wordKnowledge: { [rawKey]: legacyKnowledge('Merkwürdig', 'xx', 5) },
    }));

    const migrated = await loadFlashcards();
    expect(migrated.wordToCardMap[rawKey]).toEqual(['w']);
    expect(migrated.wordKnowledge[rawKey]?.word).toBe('Merkwürdig');
    expect(migrated.meta.normalizationVersion).toBe(CURRENT_NORMALIZATION_VERSION);
  });

  it('rekeys locale-sensitive casing from legacy ambient keys to pinned root-locale keys', async () => {
    mockLoadLangData.mockReturnValue({ tst: trLocalePackage });
    const v1TurkishHostKey = `tst:${hash('ızmir')}`; // ambient tr host produced dotless ı via casefold-era semantics
    write(store({
      flashcards: { izmir: langCard('izmir', 'Izmir', 'tst') },
      wordToCardMap: { [v1TurkishHostKey]: ['izmir'] },
      wordKnowledge: { [v1TurkishHostKey]: legacyKnowledge('Izmir', 'tst', 7) },
    }));

    const migrated = await loadFlashcards();
    // Package pins the step locale to 'tr': v2 derivation also yields 'ızmir'.
    const v2Key = `tst:${hash('ızmir')}`;
    expect(migrated.wordToCardMap[v2Key]).toEqual(['izmir']);
    expect(migrated.wordKnowledge[v2Key]?.lastSeen).toBe(7);
    expect(migrated.meta.normalizationVersion).toBe(CURRENT_NORMALIZATION_VERSION);
  });

  it('rekeys mapping-table normalization from raw traditional surfaces to mapped keys', async () => {
    mockLoadLangData.mockReturnValue({ zh: zhMappingPackage });
    const { registerMappingTable } = await import('../../shared/languageFeatures');
    registerMappingTable('zh', { words: {}, chars: { '學': '学' } });
    const legacyKey = `zh:${hash('學')}`;
    write(store({
      wordCandidates: { [legacyKey]: { word: '學', language: 'zh', count: 2, lastSeen: 3 } },
      suggestedFlashcards: { [legacyKey]: { id: 's1', word: '學', language: 'zh', createdAt: 1, lastSeen: 2, count: 1 } },
    }));

    const migrated = await loadFlashcards();
    const v2Key = `zh:${hash('学')}`;
    expect(migrated.wordCandidates[v2Key]).toMatchObject({ word: '學', count: 2, lastSeen: 3 });
    expect(migrated.wordCandidates[legacyKey]).toBeUndefined();
    expect(migrated.suggestedFlashcards[v2Key]?.word).toBe('學');
    clearMappingTables();
  });

  it('preserves key-only records verbatim and rebuilds source-backed records in one store', async () => {
    mockLoadLangData.mockReturnValue({ tst: casefoldPackage });
    const legacyAmbientKey = `tst:${hash('ızmir')}`;
    const orphanKey = `tst:${hash('nowhere')}`;
    write(store({
      flashcards: { izmir: langCard('izmir', 'Izmir', 'tst') },
      wordToCardMap: { [legacyAmbientKey]: ['izmir'] },
      wordKnowledge: {
        [legacyAmbientKey]: legacyKnowledge('Izmir', 'tst', 9),
        [orphanKey]: legacyKnowledge(undefined, 'tst', 4), // key-only: no raw word
      },
      wordSyncSeen: { [legacyAmbientKey]: 11, [orphanKey]: 12 },
      knownUntracked: { [orphanKey]: true },
    }));

    const migrated = await loadFlashcards();
    const v2Key = `tst:${hash('izmir')}`;
    expect(migrated.wordKnowledge[v2Key]?.lastSeen).toBe(9);
    expect(migrated.wordKnowledge[orphanKey]?.lastSeen).toBe(4); // key-only row kept read-only
    expect(migrated.wordSyncSeen).toEqual({ [legacyAmbientKey]: 11, [orphanKey]: 12 });
    expect(migrated.knownUntracked).toEqual({ [orphanKey]: true });
  });

  it('migrates stores stamped with the old normalization version and stays idempotent', async () => {
    mockLoadLangData.mockReturnValue({ tst: casefoldPackage });
    const legacyAmbientKey = `tst:${hash('ızmir')}`;
    const legacy = store({
      flashcards: { izmir: langCard('izmir', 'Izmir', 'tst') },
      wordToCardMap: { [legacyAmbientKey]: ['izmir'] },
    });
    legacy.meta.normalizationVersion = 1;
    write(legacy);

    const once = await loadFlashcards();
    expect(once.meta.normalizationVersion).toBe(CURRENT_NORMALIZATION_VERSION);
    expect(once.wordToCardMap[`tst:${hash('izmir')}`]).toEqual(['izmir']);
    expect(once.wordToCardMap[legacyAmbientKey]).toBeUndefined();

    const snapshot = JSON.stringify(once);
    const twice = await loadFlashcards();
    expect(JSON.stringify(twice)).toBe(snapshot);
  });
  it('no-ops for stores already on the current normalization version', async () => {
    mockLoadLangData.mockReturnValue({ tst: casefoldPackage });
    const staleKey = `tst:${hash('ızmir')}`;
    const current = store({
      flashcards: { izmir: langCard('izmir', 'Izmir', 'tst') },
      wordToCardMap: { [staleKey]: ['izmir'] },
      wordKnowledge: { [staleKey]: legacyKnowledge('Izmir', 'tst', 2) },
    });
    current.meta.normalizationVersion = CURRENT_NORMALIZATION_VERSION;
    current.version = 3; // checkFlashcards stores this as the current store version
    write(current);

    const migrated = await loadFlashcards();
    // Version-gated: no rebuild, no stamping, keys untouched.
    expect(migrated.meta.normalizationVersion).toBe(CURRENT_NORMALIZATION_VERSION);
    expect(migrated.wordToCardMap).toEqual({ [staleKey]: ['izmir'] });
    expect(migrated.wordKnowledge[staleKey]?.word).toBe('Izmir');
  });

  it('never downgrades a future normalization version', async () => {
    mockLoadLangData.mockReturnValue({ tst: casefoldPackage });
    const future = store({ flashcards: { izmir: langCard('izmir', 'Izmir', 'tst') } });
    future.meta.normalizationVersion = CURRENT_NORMALIZATION_VERSION + 1;
    write(future);

    const migrated = await loadFlashcards();
    expect(migrated.meta.normalizationVersion).toBe(CURRENT_NORMALIZATION_VERSION + 1);
  });
});
