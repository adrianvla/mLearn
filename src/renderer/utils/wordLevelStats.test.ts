import { describe, it, expect } from 'vitest';
import {
  buildWordFrequencyMapFromLanguageData,
  computeWordLevelStats,
  computeLevelCoverage,
  computeLevelStats,
  resolveLevelStudyWordFrequency,
} from './wordLevelStats';
import { hashWordSync } from '../services/srsAlgorithm';
import type { FlashcardStore, LanguageData, WordFrequencyMap } from '../../shared/types';

function lk(language: string, word: string): string {
  return language + ':' + hashWordSync(word);
}

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
    meta: {
      perLanguage: {},
      newCardsToday: 0,
      reviewsToday: 0,
      newCardsDate: '2024-01-01',
      maxNewCardsPerDay: 20,
      maxNewCardsPerDayLearning: -1,
      maxReviewsPerDay: -1,
      learningSteps: [1, 10],
      relearnSteps: [1, 10],
      graduatingInterval: 1,
      easyInterval: 4,
      newIntervalModifier: 0,
      reviewIntervalModifier: 0,
      maxInterval: 36500,
    },
    dailyStats: {},
    suggestedFlashcards: {},
    wordSyncSeen: {},
    version: 6,
    ...overrides,
  };
}

function makeFreq(): WordFrequencyMap {
  return {
    hello: { reading: 'hello', level: 'Beginner', raw_level: 5 },
    world: { reading: 'world', level: 'Beginner', raw_level: 5 },
    difficult: { reading: 'difficult', level: 'Advanced', raw_level: 1 },
    medium: { reading: 'medium', level: 'Intermediate', raw_level: 3 },
  };
}

describe('computeWordLevelStats', () => {
  const ascendingDifficultyLanguage: LanguageData = {
    name: 'Ascending Difficulty Language',
    colour_codes: {},
    settings: { fixed: {} },
    frequencyLevels: {
      difficulty: 'higher-is-harder',
    },
  };

  it('returns empty stats when no data', () => {
    const store = makeStore();
    const freq = makeFreq();
    const result = computeWordLevelStats(store, freq, 'en', 1800, 1550, {
      5: 'Beginner',
      3: 'Intermediate',
      1: 'Advanced',
    });

    expect(result.byLevel).toHaveLength(3);
    expect(result.byLevel[0]).toMatchObject({
      level: 5,
      totalDictionaryWords: 2,
      known: 0,
      learning: 0,
      unknown: 2,
      knownPct: 0,
    });
    expect(result.outsideLevels.total).toBe(0);
    expect(result.allEncountered.total).toBe(4);
  });

  it('orders ascending-difficulty levels from easiest to hardest', () => {
    const freq: WordFrequencyMap = {
      a1: { reading: 'a1', level: 'A1', raw_level: 1 },
      a2: { reading: 'a2', level: 'A2', raw_level: 2 },
      b1: { reading: 'b1', level: 'B1', raw_level: 3 },
    };
    const result = computeWordLevelStats(
      makeStore(),
      freq,
      'xx',
      1800,
      1550,
      { 1: 'A1', 2: 'A2', 3: 'B1' },
      ascendingDifficultyLanguage,
    );

    expect(result.byLevel.map((entry) => entry.level)).toEqual([1, 2, 3]);
  });

  it('derives level buckets from frequency entries when level names are missing', () => {
    const freq: WordFrequencyMap = {
      a1: { reading: 'a1', level: 'A1', raw_level: 1 },
      b2: { reading: 'b2', level: 'B2', raw_level: 4 },
    };
    const result = computeWordLevelStats(
      makeStore(),
      freq,
      'xx',
      1800,
      1550,
      {},
      ascendingDifficultyLanguage,
    );

    expect(result.byLevel.map((entry) => [entry.level, entry.name, entry.totalDictionaryWords])).toEqual([
      [1, 'Level 1', 1],
      [4, 'Level 4', 1],
    ]);
  });

  it('uses language metadata fallback templates for unnamed levels', () => {
    const freq: WordFrequencyMap = {
      a1: { reading: 'a1', level: 'Ignored Source Label', raw_level: 1 },
      b2: { reading: 'b2', level: 'Ignored Source Label', raw_level: 4 },
    };
    const languageData: LanguageData = {
      ...ascendingDifficultyLanguage,
      frequencyLevels: {
        difficulty: 'higher-is-harder',
        fallbackLabelTemplate: 'Band {level}',
      },
    };
    const result = computeWordLevelStats(
      makeStore(),
      freq,
      'xx',
      1800,
      1550,
      {},
      languageData,
    );

    expect(result.byLevel.map((entry) => [entry.level, entry.name, entry.totalDictionaryWords])).toEqual([
      [1, 'Band 1', 1],
      [4, 'Band 4', 1],
    ]);
  });

  it('counts known words from wordKnowledge ease', () => {
    const store = makeStore({
      wordKnowledge: {
        [lk('en', 'hello')]: { ease: 2.0, lastSeen: 1, timesSeen: 1, timesHovered: 0, word: 'hello' },
      },
    });
    const freq = makeFreq();
    const result = computeWordLevelStats(store, freq, 'en', 1800, 1550, {
      5: 'Beginner',
    });

    const beginner = result.byLevel.find((l) => l.level === 5);
    expect(beginner?.known).toBe(1);
    expect(beginner?.unknown).toBe(1);
  });

  it('counts known words from knownUntracked', () => {
    const store = makeStore({
      knownUntracked: { [lk('en', 'world')]: true },
    });
    const freq = makeFreq();
    const result = computeWordLevelStats(store, freq, 'en', 1800, 1550, {
      5: 'Beginner',
    });

    const beginner = result.byLevel.find((l) => l.level === 5);
    expect(beginner?.known).toBe(1);
    expect(result.outsideLevels.known).toBe(0);
  });

  it('counts learning words from flashcard state', () => {
    const store = makeStore({
      flashcards: {
        c1: {
          id: 'c1',
          content: { type: 'word', front: 'medium', back: 'meaning' },
          state: 'learning',
          ease: 2.5,
          interval: 0,
          dueDate: 0,
          reviews: 0,
          lapses: 0,
          learningStep: 0,
          createdAt: 1,
          lastReviewed: 0,
          lastUpdated: 1,
          tags: [],
          suspended: false,
          buried: false,
          language: 'en',
        },
      },
      wordToCardMap: { [lk('en', 'medium')]: ['c1'] },
    });
    const freq = makeFreq();
    const result = computeWordLevelStats(store, freq, 'en', 1800, 1550, {
      3: 'Intermediate',
    });

    const intermediate = result.byLevel.find((l) => l.level === 3);
    expect(intermediate?.learning).toBe(1);
  });

  it('counts outside levels for tracked words not in frequency list', () => {
    const store = makeStore({
      wordKnowledge: {
        [lk('en', 'untracked')]: { ease: 3.0, lastSeen: 1, timesSeen: 1, timesHovered: 0, word: 'untracked' },
      },
    });
    const freq = makeFreq();
    const result = computeWordLevelStats(store, freq, 'en', 1800, 1550, {
      5: 'Beginner',
    });

    expect(result.outsideLevels.known).toBe(1);
    expect(result.outsideLevels.total).toBe(1);
  });
});

describe('computeLevelStats', () => {
  const levelNames = {
    5: 'N5',
    4: 'N4',
    3: 'N3',
    2: 'N2',
    1: 'N1',
  };

  it('returns empty array when wordFrequency is empty', () => {
    const result = computeLevelStats(makeStore(), {}, 'ja', 1800, 1550, levelNames);

    expect(result).toEqual([]);
  });

  it('returns all untracked when store is empty', () => {
    const result = computeLevelStats(
      makeStore(),
      {
        猫: { reading: 'ねこ', level: 'N5', raw_level: 5 },
        犬: { reading: 'いぬ', level: 'N5', raw_level: 5 },
      },
      'ja',
      1800,
      1550,
      levelNames,
    );

    expect(result).toEqual([
      {
        level: 5,
        name: 'N5',
        total: 2,
        known: 0,
        learning: 0,
        unknown: 0,
        untracked: 2,
        knownPct: 0,
        learningPct: 0,
        unknownPct: 0,
        untrackedPct: 100,
      },
    ]);
  });

  it('ignores sentinel frequency entries that are not real study levels', () => {
    const result = computeLevelStats(
      makeStore(),
      {
        赤い: { reading: 'あかい', level: '', raw_level: -1 },
        猫: { reading: 'ねこ', level: 'N5', raw_level: 5 },
      },
      'ja',
      1800,
      1550,
      levelNames,
    );

    expect(result.map((level) => [level.level, level.name, level.total])).toEqual([
      [5, 'N5', 1],
    ]);
  });

  it('keeps zero as a real level when declared by language metadata', () => {
    const result = computeLevelStats(
      makeStore(),
      {
        starter: { reading: 'starter', level: 'Starter', raw_level: 0 },
        a1: { reading: 'a1', level: 'A1', raw_level: 1 },
      },
      'xx',
      1800,
      1550,
      { 0: 'Starter', 1: 'A1' },
      {
        name: 'Declared Zero Level Language',
        colour_codes: {},
        settings: { fixed: {} },
        frequencyLevels: {
          difficulty: 'higher-is-harder',
          names: { 0: 'Starter', 1: 'A1' },
        },
      },
    );

    expect(result.map((level) => [level.level, level.name, level.total])).toEqual([
      [0, 'Starter', 1],
      [1, 'A1', 1],
    ]);
  });

  it('counts known from review-state flashcards', () => {
    const store = makeStore({
      flashcards: {
        card1: {
          id: 'card1',
          content: { type: 'word', front: '猫', back: 'cat' },
          state: 'review',
          ease: 2.5,
          interval: 1,
          dueDate: 1,
          reviews: 1,
          lapses: 0,
          learningStep: 0,
          createdAt: 1,
          lastReviewed: 1,
          lastUpdated: 1,
          tags: [],
          suspended: false,
          buried: false,
          language: 'ja',
        },
      },
      wordToCardMap: { [lk('ja', '猫')]: ['card1'] },
    });

    const [level] = computeLevelStats(
      store,
      { 猫: { reading: 'ねこ', level: 'N5', raw_level: 5 } },
      'ja',
      1800,
      1550,
      levelNames,
    );

    expect(level.known).toBe(1);
    expect(level.untracked).toBe(0);
  });

  it('counts learning from learning-state flashcards + wordKnowledge', () => {
    const store = makeStore({
      flashcards: {
        card1: {
          id: 'card1',
          content: { type: 'word', front: '猫', back: 'cat' },
          state: 'learning',
          ease: 2.5,
          interval: 0,
          dueDate: 1,
          reviews: 0,
          lapses: 0,
          learningStep: 0,
          createdAt: 1,
          lastReviewed: 0,
          lastUpdated: 1,
          tags: [],
          suspended: false,
          buried: false,
          language: 'ja',
        },
      },
      wordToCardMap: { [lk('ja', '猫')]: ['card1'] },
      wordKnowledge: {
        [lk('ja', '犬')]: { ease: 1.6, lastSeen: 1, timesSeen: 3, timesHovered: 1, word: '犬', language: 'ja' },
      },
    });

    const [level] = computeLevelStats(
      store,
      {
        猫: { reading: 'ねこ', level: 'N5', raw_level: 5 },
        犬: { reading: 'いぬ', level: 'N5', raw_level: 5 },
      },
      'ja',
      1800,
      1550,
      levelNames,
    );

    expect(level.learning).toBe(2);
    expect(level.known).toBe(0);
  });

  it('counts unknown from tracked but not known/learning', () => {
    const store = makeStore({
      wordKnowledge: {
        [lk('ja', '猫')]: { ease: 1.0, lastSeen: 1, timesSeen: 1, timesHovered: 3, word: '猫', language: 'ja' },
      },
    });

    const [level] = computeLevelStats(
      store,
      { 猫: { reading: 'ねこ', level: 'N5', raw_level: 5 } },
      'ja',
      1800,
      1550,
      levelNames,
    );

    expect(level.unknown).toBe(1);
    expect(level.untracked).toBe(0);
  });

  it('counts untracked as total minus tracked', () => {
    const store = makeStore({
      wordKnowledge: {
        [lk('ja', '猫')]: { ease: 1.0, lastSeen: 1, timesSeen: 1, timesHovered: 3, word: '猫', language: 'ja' },
      },
    });

    const [level] = computeLevelStats(
      store,
      {
        猫: { reading: 'ねこ', level: 'N5', raw_level: 5 },
        犬: { reading: 'いぬ', level: 'N5', raw_level: 5 },
      },
      'ja',
      1800,
      1550,
      levelNames,
    );

    expect(level.unknown).toBe(1);
    expect(level.untracked).toBe(1);
  });

  it('percentages sum to 100 for each level', () => {
    const store = makeStore({
      flashcards: {
        knownCard: {
          id: 'knownCard',
          content: { type: 'word', front: '猫', back: 'cat' },
          state: 'review',
          ease: 2.5,
          interval: 1,
          dueDate: 1,
          reviews: 1,
          lapses: 0,
          learningStep: 0,
          createdAt: 1,
          lastReviewed: 1,
          lastUpdated: 1,
          tags: [],
          suspended: false,
          buried: false,
          language: 'ja',
        },
      },
      wordToCardMap: { [lk('ja', '猫')]: ['knownCard'] },
      wordKnowledge: {
        [lk('ja', '犬')]: { ease: 1.6, lastSeen: 1, timesSeen: 2, timesHovered: 1, word: '犬', language: 'ja' },
        [lk('ja', '鳥')]: { ease: 1.0, lastSeen: 1, timesSeen: 1, timesHovered: 2, word: '鳥', language: 'ja' },
      },
    });

    const [level] = computeLevelStats(
      store,
      {
        猫: { reading: 'ねこ', level: 'N5', raw_level: 5 },
        犬: { reading: 'いぬ', level: 'N5', raw_level: 5 },
        鳥: { reading: 'とり', level: 'N5', raw_level: 5 },
        魚: { reading: 'さかな', level: 'N5', raw_level: 5 },
      },
      'ja',
      1800,
      1550,
      levelNames,
    );

    expect(level.knownPct + level.learningPct + level.unknownPct + level.untrackedPct).toBe(100);
    expect(level).toMatchObject({ knownPct: 25, learningPct: 25, unknownPct: 25, untrackedPct: 25 });
  });

  it('returns levels sorted descending (5 to 1)', () => {
    const result = computeLevelStats(
      makeStore(),
      {
        難問: { reading: 'なんもん', level: 'N1', raw_level: 1 },
        基本: { reading: 'きほん', level: 'N5', raw_level: 5 },
        中級: { reading: 'ちゅうきゅう', level: 'N3', raw_level: 3 },
      },
      'ja',
      1800,
      1550,
      levelNames,
    );

    expect(result.map((level) => level.level)).toEqual([5, 3, 1]);
  });
});

describe('resolveLevelStudyWordFrequency', () => {
  it('falls back to installed language freq rows when the derived context map is empty', () => {
    const languageData: LanguageData = {
      name: 'Japanese',
      colour_codes: {},
      settings: { fixed: {} },
      freq: [
        ['会う', 'あう', 5],
        ['払う', 'はらう', 4],
      ],
      frequencyLevels: {
        names: { '5': 'N5', '4': 'N4' },
        rowLevelIndex: 2,
        difficulty: 'lower-is-harder',
        displayOrder: 'descending',
      },
    };

    const resolved = resolveLevelStudyWordFrequency({}, languageData);

    expect(resolved).toEqual({
      会う: { reading: 'あう', level: 'N5', raw_level: 5 },
      払う: { reading: 'はらう', level: 'N4', raw_level: 4 },
    });
  });

  it('unwraps installed frequency payloads that carry rows and level metadata together', () => {
    const languageData = {
      name: 'Japanese',
      colour_codes: {},
      settings: { fixed: {} },
      freq: {
        freq: [
          ['会う', 'あう', 5],
          ['払う', 'はらう', 4],
        ],
        frequencyLevels: {
          names: { '5': 'N5', '4': 'N4' },
          rowLevelIndex: 2,
          difficulty: 'lower-is-harder',
          displayOrder: 'descending',
        },
      },
    } as unknown as LanguageData;

    const resolved = resolveLevelStudyWordFrequency({}, languageData);

    expect(resolved).toEqual({
      会う: { reading: 'あう', level: 'N5', raw_level: 5 },
      払う: { reading: 'はらう', level: 'N4', raw_level: 4 },
    });
  });

  it('keeps the provider frequency map when it is already populated', () => {
    const providerMap: WordFrequencyMap = {
      ready: { reading: 'ready', level: 'Ready', raw_level: 1 },
    };

    expect(resolveLevelStudyWordFrequency(providerMap, {
      name: 'Ignored',
      colour_codes: {},
      settings: { fixed: {} },
      freq: [['fallback', 'fallback', 2]],
    })).toBe(providerMap);
  });

  it('assigns fallback boundary levels from language metadata', () => {
    const map = buildWordFrequencyMapFromLanguageData({
      name: 'Boundary Language',
      colour_codes: {},
      settings: { fixed: {} },
      freq: [
        ['alpha', 'alpha'],
        ['beta', 'beta'],
        ['gamma', 'gamma'],
      ],
      frequencyLevels: {
        names: { '1': 'Hard', '2': 'Easy' },
        boundaries: [0],
        difficulty: 'lower-is-harder',
      },
    });

    expect(map.alpha).toMatchObject({ level: 'Easy', raw_level: 2 });
    expect(map.beta).toMatchObject({ level: 'Hard', raw_level: 1 });
    expect(map.gamma).toMatchObject({ level: 'Hard', raw_level: 1 });
  });
});

describe('computeLevelCoverage', () => {
  it('returns coverage percentages', () => {
    const store = makeStore();
    const freq = makeFreq();
    const result = computeLevelCoverage(store, freq, 'en', 1800, {
      5: 'Beginner',
      1: 'Advanced',
    });

    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ level: 5, total: 2, known: 0, pct: 0 });
    expect(result[1]).toMatchObject({ level: 3, name: 'Level 3', total: 1, known: 0, pct: 0 });
    expect(result[2]).toMatchObject({ level: 1, total: 1, known: 0, pct: 0 });
  });

  it('derives coverage buckets from frequency entries when level names are missing', () => {
    const ascendingDifficultyLanguage: LanguageData = {
      name: 'Ascending Difficulty Language',
      colour_codes: {},
      settings: { fixed: {} },
      frequencyLevels: {
        difficulty: 'higher-is-harder',
      },
    };
    const freq: WordFrequencyMap = {
      a1: { reading: 'a1', level: 'A1', raw_level: 1 },
      b2: { reading: 'b2', level: 'B2', raw_level: 4 },
    };

    const result = computeLevelCoverage(makeStore(), freq, 'xx', 1800, {}, ascendingDifficultyLanguage);

    expect(result.map((entry) => [entry.level, entry.name, entry.total])).toEqual([
      [1, 'Level 1', 1],
      [4, 'Level 4', 1],
    ]);
  });
});
