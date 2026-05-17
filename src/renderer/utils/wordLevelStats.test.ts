import { describe, it, expect } from 'vitest';
import { computeWordLevelStats, computeLevelCoverage } from './wordLevelStats';
import { hashWordSync } from '../services/srsAlgorithm';
import type { FlashcardStore, WordFrequencyMap } from '../../shared/types';

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

describe('computeLevelCoverage', () => {
  it('returns coverage percentages', () => {
    const store = makeStore();
    const freq = makeFreq();
    const result = computeLevelCoverage(store, freq, 'en', 1800, {
      5: 'Beginner',
      1: 'Advanced',
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ level: 5, total: 2, known: 0, pct: 0 });
    expect(result[1]).toMatchObject({ level: 1, total: 1, known: 0, pct: 0 });
  });
});
