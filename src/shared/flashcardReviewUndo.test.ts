import { describe, expect, it } from 'vitest';
import { restoreReviewResponse, validateReviewResponseUndo, type ReviewUndoProjection } from './flashcardReviewUndo';
import type { Flashcard, FlashcardStore } from './types';

describe('recovered supplied-cache Undo', () => {
  function fixture() {
    const cache = { state: 'review' as const, ease: 2.5, interval: 100, dueAt: 100, reviews: 18,
      lapses: 0, learningStep: 0, lastReviewed: 1, provenance: 'migrated-scheduler-cache' as const };
    const prior = { id: 'one', content: { type: 'word', front: 'cue', back: 'answer' }, state: 'review',
      reviews: 19, lapses: 0, retentionCache: cache, lastReviewed: 1, lastUpdated: 1 } as Flashcard;
    const expected = { ...prior, reviews: 18, lastReviewed: 2, lastUpdated: 2,
      retentionCache: { ...cache, lastReviewed: 2, provenance: 'derived-scheduler-cache' as const } };
    const restore: ReviewUndoProjection = { cardId: 'one', type: 'answer', restoreCard: prior, expectedCard: expected,
      scaffolds: { 'prior-cue-exposure': true }, restorePerLanguage: null, today: 'today', restoreDailyStats: null };
    const store = { flashcards: { one: { ...expected, reviews: 19,
      retentionCache: { ...expected.retentionCache, reviews: 19 } } }, meta: {} } as FlashcardStore;
    return { store, restore };
  }

  it('retains exact response ownership after count-preserving recovery and reverses it without changing the receipt', () => {
    const { store, restore } = fixture();
    const receipt = JSON.stringify(restore);
    expect(() => validateReviewResponseUndo(store, restore)).not.toThrow();
    restoreReviewResponse(store, restore);
    expect(store.flashcards.one.reviews).toBe(19);
    expect(store.flashcards.one.lastReviewed).toBe(1);
    expect(JSON.stringify(restore)).toBe(receipt);
  });

  it.each(['lastReviewed', 'reviews', 'dueDate'] as const)('refuses later changes to %s', field => {
    const { store, restore } = fixture();
    store.flashcards.one[field] = 999;
    expect(() => validateReviewResponseUndo(store, restore)).toThrow('changed after the response');
  });

  it('does not reinterpret ordinary receipts without prior cue provenance', () => {
    const { store, restore } = fixture();
    restore.scaffolds = undefined;
    expect(() => validateReviewResponseUndo(store, restore)).toThrow('changed after the response');
  });
});
