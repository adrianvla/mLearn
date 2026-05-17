import { describe, it, expect } from 'vitest';
import { buildKnownWordSet, isWordKnown, buildKnownWordSetFromStore } from './knowledgeUtils';
import type { Flashcard, FlashcardStore, PassiveWordKnowledge, IgnoredWordEntry } from '../../shared/types';

function makeCard(overrides?: Partial<Flashcard>): Flashcard {
  const now = Date.now();
  return {
    id: 'c1',
    content: { type: 'word', front: 'テスト', back: 'test' },
    state: 'new',
    ease: 2.5,
    interval: 0,
    dueDate: now,
    reviews: 0,
    lapses: 0,
    learningStep: 0,
    createdAt: now,
    lastReviewed: now,
    lastUpdated: now,
    language: 'ja',
    ...overrides,
  };
}

describe('buildKnownWordSet', () => {
  it('includes knownUntracked words', () => {
    const set = buildKnownWordSet(
      {}, {}, { 'ja:h1': true }, {}, {}, 4000
    );
    expect(set.has('ja:h1')).toBe(true);
  });

  it('includes ignoredWords', () => {
    const ignored: Record<string, IgnoredWordEntry> = {
      'ja:h2': { word: '猫', language: 'ja', ignoredAt: Date.now() },
    };
    const set = buildKnownWordSet({}, {}, {}, ignored, {}, 4000);
    expect(set.has('ja:h2')).toBe(true);
  });

  it('includes words with review-state flashcards', () => {
    const cards: Record<string, Flashcard> = {
      'fc-1': makeCard({ id: 'fc-1', state: 'review' }),
    };
    const set = buildKnownWordSet(cards, { 'ja:h3': ['fc-1'] }, {}, {}, {}, 4000);
    expect(set.has('ja:h3')).toBe(true);
  });

  it('excludes words with non-review flashcards', () => {
    const cards: Record<string, Flashcard> = {
      'fc-1': makeCard({ id: 'fc-1', state: 'learning' }),
    };
    const set = buildKnownWordSet(cards, { 'ja:h4': ['fc-1'] }, {}, {}, {}, 4000);
    expect(set.has('ja:h4')).toBe(false);
  });

  it('includes words with high passive knowledge ease', () => {
    const knowledge: Record<string, PassiveWordKnowledge> = {
      'ja:h5': { ease: 4.5, lastSeen: Date.now(), timesSeen: 100, timesHovered: 0, word: '犬', language: 'ja' },
    };
    const set = buildKnownWordSet({}, {}, {}, {}, knowledge, 4000);
    expect(set.has('ja:h5')).toBe(true);
  });

  it('excludes words with low passive knowledge ease', () => {
    const knowledge: Record<string, PassiveWordKnowledge> = {
      'ja:h6': { ease: 2.0, lastSeen: Date.now(), timesSeen: 5, timesHovered: 10, word: '難', language: 'ja' },
    };
    const set = buildKnownWordSet({}, {}, {}, {}, knowledge, 4000);
    expect(set.has('ja:h6')).toBe(false);
  });

  it('combines all sources', () => {
    const cards: Record<string, Flashcard> = {
      'fc-1': makeCard({ id: 'fc-1', state: 'review' }),
    };
    const knowledge: Record<string, PassiveWordKnowledge> = {
      'ja:h8': { ease: 4.5, lastSeen: Date.now(), timesSeen: 100, timesHovered: 0, word: '鳥', language: 'ja' },
    };
    const set = buildKnownWordSet(
      cards,
      { 'ja:h7': ['fc-1'] },
      { 'ja:h9': true },
      {},
      knowledge,
      4000
    );
    expect(set.has('ja:h7')).toBe(true);
    expect(set.has('ja:h8')).toBe(true);
    expect(set.has('ja:h9')).toBe(true);
    expect(set.size).toBe(3);
  });
});

describe('isWordKnown', () => {
  it('returns true for words in the Set', () => {
    const set = new Set(['ja:h1']);
    expect(isWordKnown('ja:h1', set, {}, 4000)).toBe(true);
  });

  it('returns false for words not in the Set with no knowledge', () => {
    const set = new Set<string>();
    expect(isWordKnown('ja:h2', set, {}, 4000)).toBe(false);
  });

  it('falls back to wordKnowledge when not in Set', () => {
    const set = new Set<string>();
    const knowledge: Record<string, PassiveWordKnowledge> = {
      'ja:h3': { ease: 4.5, lastSeen: Date.now(), timesSeen: 100, timesHovered: 0, word: '魚', language: 'ja' },
    };
    expect(isWordKnown('ja:h3', set, knowledge, 4000)).toBe(true);
  });
});

describe('buildKnownWordSetFromStore', () => {
  it('builds from full store', () => {
    const store: FlashcardStore = {
      flashcards: {
        'fc-1': makeCard({ id: 'fc-1', state: 'review' }),
      },
      wordToCardMap: { 'ja:h1': ['fc-1'] },
      wordStatsMap: {},
      wordCandidates: {},
      knownUntracked: { 'ja:h2': true },
      ignoredWords: {},
      wordKnowledge: {
        'ja:h3': { ease: 4.5, lastSeen: Date.now(), timesSeen: 100, timesHovered: 0, word: '花', language: 'ja' },
      },
      grammarKnowledge: {},
      suggestedFlashcards: {},
      wordSyncSeen: {},
      meta: {
        newCardsToday: 0,
        reviewsToday: 0,
        newCardsDate: '',
        maxNewCardsPerDay: 20,
        maxNewCardsPerDayLearning: -1,
        maxReviewsPerDay: -1,
        learningSteps: [1, 10],
        relearnSteps: [10],
        graduatingInterval: 1,
        easyInterval: 4,
        newIntervalModifier: 100,
        reviewIntervalModifier: 100,
        maxInterval: 365,
      },
      dailyStats: {},
      version: 6,
    };

    const set = buildKnownWordSetFromStore(store, 4000);
    expect(set.has('ja:h1')).toBe(true);
    expect(set.has('ja:h2')).toBe(true);
    expect(set.has('ja:h3')).toBe(true);
    expect(set.size).toBe(3);
  });
});
