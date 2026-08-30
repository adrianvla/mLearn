import { describe, it, expect } from 'vitest';

import {
  deriveSyncKnowledgeJournal,
  mergeFlashcardStores,
  mergeFlashcardStoresWithJournal,
} from './flashcardMerge';
import type { KnowledgeEvent } from '../knowledgeEvents';
import type { Flashcard, FlashcardStore, PassiveWordKnowledge } from '../types';

const META = {
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
    meta: { ...META },
    dailyStats: {},
    suggestedFlashcards: {},
    wordSyncSeen: {},
    version: 3,
    ...overrides,
  };
}

function entry(overrides: Partial<PassiveWordKnowledge> = {}): PassiveWordKnowledge {
  return { ease: 2.5, lastSeen: 1, timesSeen: 0, timesHovered: 0, word: '学校', language: 'ja', ...overrides };
}

function card(overrides: Partial<Flashcard> = {}): Flashcard {
  return {
    id: 'c1',
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

describe('mergeFlashcardStores — wordKnowledge per-entry LWW', () => {
  it('keeps the newer current claim when the incoming entry is stale', () => {
    const current = makeStore({
      wordKnowledge: { 'ja:h1': entry({ claim: 'known', claimAt: 200, ease: 2.5 }) },
    });
    const incoming = makeStore({
      wordKnowledge: { 'ja:h1': entry({ claim: 'unknown', claimAt: 50, ease: 0.5 }) },
    });

    const merged = mergeFlashcardStores(current, incoming);

    expect(merged.wordKnowledge['ja:h1']?.claim).toBe('known');
    expect(merged.wordKnowledge['ja:h1']?.claimAt).toBe(200);
    expect(merged.wordKnowledge['ja:h1']?.ease).toBe(2.5);
  });

  it('takes the incoming entry when its claim is newer', () => {
    const current = makeStore({
      wordKnowledge: { 'ja:h1': entry({ claim: 'known', claimAt: 200 }) },
    });
    const incoming = makeStore({
      wordKnowledge: { 'ja:h1': entry({ claim: 'learning', claimAt: 300, ease: 1.8 }) },
    });

    const merged = mergeFlashcardStores(current, incoming);

    expect(merged.wordKnowledge['ja:h1']?.claim).toBe('learning');
    expect(merged.wordKnowledge['ja:h1']?.claimAt).toBe(300);
    expect(merged.wordKnowledge['ja:h1']?.ease).toBe(1.8);
  });

  it('keeps the current entry on equal recency', () => {
    const current = makeStore({
      wordKnowledge: { 'ja:h1': entry({ claim: 'known', claimAt: 200, ease: 2.5 }) },
    });
    const incoming = makeStore({
      wordKnowledge: { 'ja:h1': entry({ claim: 'unknown', claimAt: 200, ease: 0.5 }) },
    });

    const merged = mergeFlashcardStores(current, incoming);

    expect(merged.wordKnowledge['ja:h1']?.claim).toBe('known');
    expect(merged.wordKnowledge['ja:h1']?.ease).toBe(2.5);
  });

  it('falls back to lastStatusChange then lastSeen for the recency anchor', () => {
    const current = makeStore({
      wordKnowledge: {
        'ja:status': entry({ lastStatusChange: 10 }),
        'ja:seen': entry({ lastSeen: 100 }),
      },
    });
    const incoming = makeStore({
      wordKnowledge: {
        'ja:status': entry({ lastStatusChange: 5, lastSeen: 999 }),
        'ja:seen': entry({ lastSeen: 200 }),
      },
    });

    const merged = mergeFlashcardStores(current, incoming);

    expect(merged.wordKnowledge['ja:status']?.lastStatusChange).toBe(10);
    expect(merged.wordKnowledge['ja:status']?.lastSeen).toBe(1);
    expect(merged.wordKnowledge['ja:seen']?.lastSeen).toBe(200);
  });
});

describe('mergeFlashcardStores — sync epistemic honesty (REQ59)', () => {
  it('strips active-evidence and explicit-status markers from applied remote entries', () => {
    const current = makeStore({
      wordKnowledge: { 'ja:h1': entry({ lastSeen: 1 }) },
    });
    const incoming = makeStore({
      wordKnowledge: {
        'ja:h1': entry({
          ease: 4.5,
          lastSeen: 500,
          wordSyncRatedAt: 480,
          lastStatusChange: 490,
          statusChangedAtSeen: 3,
          hasActiveEvidence: true,
          lastEvidenceSource: 'srs',
        }),
      },
    });

    const merged = mergeFlashcardStores(current, incoming);

    const applied = merged.wordKnowledge['ja:h1'];
    expect(applied).toMatchObject({ ease: 4.5, lastSeen: 500, wordSyncRatedAt: 480 });
    expect(applied?.hasActiveEvidence).toBeUndefined();
    expect(applied?.lastEvidenceSource).toBeUndefined();
    expect(applied?.lastStatusChange).toBeUndefined();
    expect(applied?.statusChangedAtSeen).toBeUndefined();
  });

  it('keeps the receiving-device active-evidence markers when a remote entry wins', () => {
    const current = makeStore({
      wordKnowledge: { 'ja:h1': entry({ lastSeen: 1, hasActiveEvidence: true, lastEvidenceSource: 'anki' }) },
    });
    const incoming = makeStore({
      wordKnowledge: { 'ja:h1': entry({ ease: 3.2, lastSeen: 500 }) },
    });

    const merged = mergeFlashcardStores(current, incoming);

    expect(merged.wordKnowledge['ja:h1']).toMatchObject({
      ease: 3.2,
      hasActiveEvidence: true,
      lastEvidenceSource: 'anki',
    });
  });

  it('leaves the current entry completely untouched when the remote entry is stale', () => {
    const current = makeStore({
      wordKnowledge: { 'ja:h1': entry({ ease: 2.5, claim: 'known', claimAt: 200, hasActiveEvidence: true, lastStatusChange: 50 }) },
    });
    const incoming = makeStore({
      wordKnowledge: { 'ja:h1': entry({ ease: 0.5, claim: 'unknown', claimAt: 100, hasActiveEvidence: true }) },
    });

    const merged = mergeFlashcardStores(current, incoming);

    expect(merged.wordKnowledge['ja:h1']).toMatchObject({
      ease: 2.5,
      claim: 'known',
      claimAt: 200,
      hasActiveEvidence: true,
      lastStatusChange: 50,
    });
  });
});

describe('deriveSyncKnowledgeJournal', () => {
  it('projects applied entries into passive-strength rollups and manual claims', () => {
    const journal = deriveSyncKnowledgeJournal([
      ['ja:h1', entry({ ease: 4.2, lastSeen: 400, claim: 'known', claimAt: 500 })],
    ]);

    expect(journal['ja:h1']).toHaveLength(2);
    const [rollup, claim] = journal['ja:h1'] as KnowledgeEvent[];
    expect(rollup).toMatchObject({
      t: 400,
      kind: 'rollup',
      source: 'passiveTracking',
      aspect: 'meaning',
      easeAfter: 4.2,
      origin: 'sync',
    });
    expect(claim).toMatchObject({
      t: 500,
      kind: 'claim',
      source: 'manual',
      aspect: 'meaning',
      origin: 'sync',
      toStatus: 'known',
    });
  });

  it('marks word-sync rated entries with the word-sync provenance channel', () => {
    const journal = deriveSyncKnowledgeJournal([
      ['ja:h2', entry({ ease: 3.0, lastSeen: 400, wordSyncRatedAt: 380 })],
    ]);

    const [rollup] = journal['ja:h2'] as KnowledgeEvent[];
    expect(rollup.origin).toBe('word-sync');
    expect(rollup.t).toBe(380);
  });

  it('omits events for entries without ease or claim', () => {
    const journal = deriveSyncKnowledgeJournal([
      ['ja:h3', entry({ ease: 2.5, lastSeen: 10, claim: undefined })],
    ]);

    expect(journal['ja:h3']).toHaveLength(1);
    expect(journal['ja:h3']?.[0].kind).toBe('rollup');
  });
});

describe('mergeFlashcardStoresWithJournal', () => {
  it('journals exactly the epistemic state the merge applied', () => {
    const current = makeStore({
      wordKnowledge: {
        'ja:local-wins': entry({ claim: 'known', claimAt: 900 }),
        'ja:remote-wins': entry({ ease: 1.2, lastSeen: 10 }),
      },
    });
    const incoming = makeStore({
      wordKnowledge: {
        'ja:local-wins': entry({ claim: 'unknown', claimAt: 100 }),
        'ja:remote-wins': entry({ ease: 3.4, claim: 'learning', claimAt: 300, lastSeen: 200 }),
      },
    });

    const { store, journal } = mergeFlashcardStoresWithJournal(current, incoming);

    expect(Object.keys(journal)).toEqual(['ja:remote-wins']);
    expect(journal['ja:remote-wins']?.map((event) => event.kind)).toEqual(['rollup', 'claim']);
    expect(store.wordKnowledge['ja:local-wins']?.claim).toBe('known');
  });

  it('returns an empty journal when nothing epistemic was applied', () => {
    const journal = mergeFlashcardStoresWithJournal(makeStore(), makeStore()).journal;
    expect(journal).toEqual({});
  });

  it('exposes the same merged store through the store-only wrapper', () => {
    const current = makeStore({ wordKnowledge: { 'ja:h1': entry({ lastSeen: 1 }) } });
    const incoming = makeStore({ wordKnowledge: { 'ja:h1': entry({ ease: 3.9, lastSeen: 700 }) } });

    expect(mergeFlashcardStores(current, incoming)).toEqual(mergeFlashcardStoresWithJournal(current, incoming).store);
  });
});

describe('mergeFlashcardStores — non-knowledge collections', () => {
  it('unions knownUntracked without ever clearing current flags', () => {
    const current = makeStore({
      knownUntracked: { 'ja:known': true, 'ja:withdrawn': true },
    });
    const incoming = makeStore({
      knownUntracked: { 'ja:new': true, 'ja:withdrawn': false },
    });

    const merged = mergeFlashcardStores(current, incoming);

    expect(merged.knownUntracked['ja:known']).toBe(true);
    expect(merged.knownUntracked['ja:withdrawn']).toBe(true);
    expect(merged.knownUntracked['ja:new']).toBe(true);
  });

  it('merges ignoredWords by newest ignoredAt in both directions', () => {
    const current = makeStore({
      ignoredWords: {
        'ja:older-current': { word: '古', ignoredAt: 10 },
        'ja:newer-incoming': { word: '新', ignoredAt: 10 },
      },
    });
    const incoming = makeStore({
      ignoredWords: {
        'ja:older-current': { word: '古', ignoredAt: 5 },
        'ja:newer-incoming': { word: '新', ignoredAt: 20 },
        'ja:brand-new': { word: '追加', ignoredAt: 30 },
      },
    });

    const merged = mergeFlashcardStores(current, incoming);

    expect(merged.ignoredWords['ja:older-current']?.ignoredAt).toBe(10);
    expect(merged.ignoredWords['ja:newer-incoming']?.ignoredAt).toBe(20);
    expect(merged.ignoredWords['ja:brand-new']?.word).toBe('追加');
  });

  it('merges wordSyncSeen with max-wins', () => {
    const current = makeStore({ wordSyncSeen: { 'ja:a': 50, 'ja:b': 10 } });
    const incoming = makeStore({ wordSyncSeen: { 'ja:a': 5, 'ja:b': 90, 'ja:c': 7 } });

    const merged = mergeFlashcardStores(current, incoming);

    expect(merged.wordSyncSeen).toEqual({ 'ja:a': 50, 'ja:b': 90, 'ja:c': 7 });
  });

  it('union-max merges wordCandidates', () => {
    const current = makeStore({
      wordCandidates: {
        'ja:keep-count': { word: '多', count: 5, lastSeen: 100 },
        'ja:keep-lastseen': { word: '時', count: 1, lastSeen: 300, reading: 'とき' },
      },
    });
    const incoming = makeStore({
      wordCandidates: {
        'ja:keep-count': { word: '多', count: 9, lastSeen: 50 },
        'ja:keep-lastseen': { word: '時', count: 3, lastSeen: 200 },
        'ja:new': { word: '新', count: 2, lastSeen: 400 },
      },
    });

    const merged = mergeFlashcardStores(current, incoming);

    expect(merged.wordCandidates['ja:keep-count']).toMatchObject({ count: 9, lastSeen: 100 });
    expect(merged.wordCandidates['ja:keep-lastseen']).toMatchObject({ count: 3, lastSeen: 300, reading: 'とき' });
    expect(merged.wordCandidates['ja:new']?.count).toBe(2);
  });
});

describe('mergeFlashcardStores — flashcards', () => {
  it('adds cards that only exist in the incoming store', () => {
    const current = makeStore();
    const incoming = makeStore({ flashcards: { 'c-new': card({ id: 'c-new', reviews: 2 }) } });

    const merged = mergeFlashcardStores(current, incoming);

    expect(merged.flashcards['c-new']?.reviews).toBe(2);
  });

  it('keeps the current card state when it has more reviews, but adopts the fresher lastUpdated', () => {
    const current = makeStore({
      flashcards: { c1: card({ reviews: 5, lastUpdated: 100, ease: 2.8 }) },
    });
    const incoming = makeStore({
      flashcards: { c1: card({ reviews: 3, lastUpdated: 999, ease: 1.5 }) },
    });

    const merged = mergeFlashcardStores(current, incoming);

    expect(merged.flashcards.c1?.reviews).toBe(5);
    expect(merged.flashcards.c1?.ease).toBe(2.8);
    // Mirrors flashcardSyncService: a fresher remote lastUpdated still bumps
    // the merged card's lastUpdated even when the current card keeps its state.
    expect(merged.flashcards.c1?.lastUpdated).toBe(999);
  });

  it('takes the incoming card on a review tie with newer lastUpdated, merging content with example/imageUrl rules', () => {
    const current = makeStore({
      flashcards: {
        c1: card({
          reviews: 3,
          lastUpdated: 100,
          content: {
            type: 'word', front: '学校', back: 'desktop-back',
            example: '長い例文のほうが残る', imageUrl: 'desktop.png', reading: 'がっこう',
          },
        }),
      },
    });
    const incoming = makeStore({
      flashcards: {
        c1: card({
          reviews: 3,
          lastUpdated: 500,
          content: { type: 'word', front: '学校', back: 'mobile-back', example: '短い', imageUrl: '' },
        }),
      },
    });

    const merged = mergeFlashcardStores(current, incoming);

    expect(merged.flashcards.c1?.lastUpdated).toBe(500);
    expect(merged.flashcards.c1?.content.back).toBe('mobile-back');
    // Longer example wins; existing imageUrl survives an empty incoming one;
    // untouched local fields (reading) survive the shallow content merge.
    expect(merged.flashcards.c1?.content.example).toBe('長い例文のほうが残る');
    expect(merged.flashcards.c1?.content.imageUrl).toBe('desktop.png');
    expect(merged.flashcards.c1?.content.reading).toBe('がっこう');
  });

  it('keeps the current card on equal reviews and equal lastUpdated', () => {
    const current = makeStore({
      flashcards: { c1: card({ reviews: 3, lastUpdated: 100, ease: 2.8 }) },
    });
    const incoming = makeStore({
      flashcards: { c1: card({ reviews: 3, lastUpdated: 100, ease: 1.1 }) },
    });

    const merged = mergeFlashcardStores(current, incoming);

    expect(merged.flashcards.c1?.ease).toBe(2.8);
  });

  it('only contributes content when the incoming card has fewer reviews but a fresher lastUpdated', () => {
    const current = makeStore({
      flashcards: {
        c1: card({ reviews: 5, lastUpdated: 100, content: { type: 'word', front: '学校', back: 'old' } }),
      },
    });
    const incoming = makeStore({
      flashcards: {
        c1: card({ reviews: 2, lastUpdated: 500, content: { type: 'word', front: '学校', back: 'newer', pos: 'noun' } }),
      },
    });

    const merged = mergeFlashcardStores(current, incoming);

    expect(merged.flashcards.c1?.reviews).toBe(5);
    expect(merged.flashcards.c1?.lastUpdated).toBe(500);
    expect(merged.flashcards.c1?.content.back).toBe('newer');
    expect(merged.flashcards.c1?.content.pos).toBe('noun');
  });

  it('does not delete current cards absent from the incoming flashcards', () => {
    const current = makeStore({ flashcards: { c1: card(), c2: card({ id: 'c2' }) } });
    const incoming = makeStore({ flashcards: { c1: card({ reviews: 1 }) } });

    const merged = mergeFlashcardStores(current, incoming);

    expect(merged.flashcards.c1?.reviews).toBe(1);
    expect(merged.flashcards.c2).toBeDefined();
  });
});

describe('mergeFlashcardStores — store-level guarantees', () => {
  it('does not delete any current collection when the incoming store only carries one', () => {
    const current = makeStore({
      flashcards: { c1: card() },
      wordCandidates: { 'ja:x': { word: '語', count: 1, lastSeen: 1 } },
      wordToCardMap: { 'ja:x': ['c1'] },
      wordStatsMap: { 'ja:x': { cardCount: 1, bestEase: 2.5, totalReviews: 0, totalLapses: 0, lastReviewed: 900, bestInterval: 86400000, bestState: 'review' } },
      knownUntracked: { 'ja:k': true },
      ignoredWords: { 'ja:i': { word: '無視', ignoredAt: 5 } },
      wordKnowledge: { 'ja:h1': entry({ claim: 'known', claimAt: 100 }) },
      grammarKnowledge: { '〜てしまう': { pattern: '〜てしまう', ease: 3, timesEncountered: 2, timesFailed: 0, lastSeen: 5, level: 3 } },
      dailyStats: { '2026-08-30': { ja: { date: '2026-08-30', newCardsStudied: 1, reviewCardsStudied: 2, lapses: 0, timeSpent: 1000, graduated: 1 } } },
      suggestedFlashcards: { 'ja:s': { id: 's1', word: '語', language: 'ja', createdAt: 1, lastSeen: 1, count: 1 } },
      wordSyncSeen: { 'ja:h1': 42 },
      version: 3,
    });
    const incoming = makeStore({
      wordKnowledge: { 'ja:stale': entry({ claim: 'unknown', claimAt: 1 }) },
    });

    const merged = mergeFlashcardStores(current, incoming);

    expect(Object.keys(merged.flashcards)).toEqual(['c1']);
    expect(merged.wordCandidates['ja:x']?.count).toBe(1);
    expect(merged.wordToCardMap['ja:x']).toEqual(['c1']);
    expect(merged.wordStatsMap['ja:x']?.cardCount).toBe(1);
    expect(merged.knownUntracked['ja:k']).toBe(true);
    expect(merged.ignoredWords['ja:i']?.ignoredAt).toBe(5);
    expect(merged.wordKnowledge['ja:h1']?.claimAt).toBe(100);
    expect(merged.grammarKnowledge['〜てしまう']?.ease).toBe(3);
    expect(merged.dailyStats['2026-08-30']?.ja?.newCardsStudied).toBe(1);
    expect(merged.suggestedFlashcards['ja:s']?.word).toBe('語');
    expect(merged.wordSyncSeen['ja:h1']).toBe(42);
    expect(merged.meta.maxNewCardsPerDay).toBe(20);
    expect(merged.version).toBe(3);
    // Incoming entries still merge into the kept collections.
    expect(merged.wordKnowledge['ja:stale']?.claim).toBe('unknown');
  });

  it('does not mutate either input store', () => {
    const current = makeStore({
      flashcards: { c1: card() },
      wordKnowledge: { 'ja:h1': entry({ claim: 'known', claimAt: 200 }) },
      wordSyncSeen: { 'ja:h1': 10 },
    });
    const incoming = makeStore({
      flashcards: { c1: card({ reviews: 3, lastUpdated: 500 }) },
      wordKnowledge: { 'ja:h1': entry({ claim: 'learning', claimAt: 300 }) },
      wordSyncSeen: { 'ja:h1': 20 },
    });
    const currentSnapshot = JSON.stringify(current);
    const incomingSnapshot = JSON.stringify(incoming);

    mergeFlashcardStores(current, incoming);

    expect(JSON.stringify(current)).toBe(currentSnapshot);
    expect(JSON.stringify(incoming)).toBe(incomingSnapshot);
  });

  it('tolerates legacy stores missing newer collections', () => {
    const current = {
      flashcards: {},
      wordCandidates: {},
      wordToCardMap: {},
      wordStatsMap: {},
      knownUntracked: {},
      ignoredWords: {},
      wordKnowledge: {},
      grammarKnowledge: {},
      meta: { ...META },
      dailyStats: {},
      suggestedFlashcards: {},
      version: 3,
    } as FlashcardStore;
    const incoming = makeStore({ wordKnowledge: { 'ja:h1': entry({ claim: 'known', claimAt: 1 }) } });

    const merged = mergeFlashcardStores(current, incoming);

    expect(merged.wordKnowledge['ja:h1']?.claim).toBe('known');
    expect(merged.wordSyncSeen).toEqual({});
  });
});
