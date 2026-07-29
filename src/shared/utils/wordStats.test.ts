import { describe, expect, it } from 'vitest';
import { SRS_EASE } from '../constants';
import type { Flashcard, FlashcardState, WordStats } from '../types';
import { calculateWordStats } from './wordStats';

// ponytail: verbatim copy of the legacy implementations deleted from
// src/renderer/services/flashcardSyncService.ts and src/electron/services/flashcardStorage.ts
// (both were byte-identical). Kept here to prove the consolidated shared
// implementation produces identical output on the same card set.
function legacyCompareStates(a: FlashcardState, b: FlashcardState): number {
  const order: Record<FlashcardState, number> = { 'new': 0, 'learning': 1, 'relearning': 2, 'review': 3 };
  return order[a] - order[b];
}

function legacyCalculateWordStats(cards: Flashcard[]): WordStats {
  if (cards.length === 0) {
    return {
      cardCount: 0,
      bestEase: SRS_EASE.DEFAULT_KNOWN,
      totalReviews: 0,
      totalLapses: 0,
      lastReviewed: 0,
      bestInterval: 0,
      bestState: 'new',
    };
  }

  let bestEase = 0;
  let totalReviews = 0;
  let totalLapses = 0;
  let lastReviewed = 0;
  let bestInterval = 0;
  let bestState: FlashcardState = 'new';

  for (const card of cards) {
    if (card.ease > bestEase) bestEase = card.ease;
    totalReviews += card.reviews || 0;
    totalLapses += card.lapses || 0;
    if (card.lastReviewed > lastReviewed) lastReviewed = card.lastReviewed;
    if (card.interval > bestInterval) bestInterval = card.interval;
    if (legacyCompareStates(card.state, bestState) > 0) bestState = card.state;
  }

  return {
    cardCount: cards.length,
    bestEase,
    totalReviews,
    totalLapses,
    lastReviewed,
    bestInterval,
    bestState,
  };
}

function makeCard(overrides: Partial<Flashcard>): Flashcard {
  return {
    id: 'card-id',
    content: { type: 'word', front: '學習', back: 'to learn' },
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

const CARD_SETS: Record<string, Flashcard[]> = {
  empty: [],
  singleNew: [makeCard({})],
  mixedStates: [
    makeCard({ id: 'a', state: 'review', ease: 2.8, interval: 86400000, reviews: 10, lapses: 2, lastReviewed: 1000 }),
    makeCard({ id: 'b', state: 'learning', ease: 2.5, interval: 600000, reviews: 0, lapses: 0, lastReviewed: 5000 }),
    makeCard({ id: 'c', state: 'relearning', ease: 1.3, interval: 3600000, reviews: 5, lapses: 3, lastReviewed: 3000 }),
  ],
  falsyCounters: [
    makeCard({ id: 'a', state: 'review', ease: 2.1, interval: 100, reviews: 0, lapses: 0, lastReviewed: 7 }),
    makeCard({ id: 'b', state: 'review', ease: 2.4, interval: 200, reviews: 0, lapses: 0, lastReviewed: 3 }),
  ],
};

describe('calculateWordStats', () => {
  it.each(Object.keys(CARD_SETS))('matches the legacy implementations for card set: %s', (name) => {
    const cards = CARD_SETS[name];
    expect(calculateWordStats(cards)).toStrictEqual(legacyCalculateWordStats(cards));
  });

  it('returns the known-default stats for an empty card list', () => {
    expect(calculateWordStats([])).toStrictEqual({
      cardCount: 0,
      bestEase: SRS_EASE.DEFAULT_KNOWN,
      totalReviews: 0,
      totalLapses: 0,
      lastReviewed: 0,
      bestInterval: 0,
      bestState: 'new',
    });
  });
});
