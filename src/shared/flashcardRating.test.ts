import { beginReviewSession, completeReviewEncounter } from './reviewSession';
import { describe, expect, it } from 'vitest';
import { applyFlashcardRatingCommand, refusedRatingAttemptIds, RatingAdmissionRefusal, type FlashcardRatingCommand } from './flashcardRating';

const command = (attemptId: string): FlashcardRatingCommand => ({
  attemptId, events: {}, patch: { baseRev: 1, entries: [{
    path: ['cards', 'one'], before: { reviews: 2, answer: 'original' }, after: { reviews: 3, answer: 'original' },
  }] }, counterDeltas: [{ path: ['cards', 'one', 'reviews'], delta: 1 }],
});

describe('applyFlashcardRatingCommand', () => {
  it('merges concurrent finite-session progress and refuses work beyond the boundary', () => {
    const session = beginReviewSession('session', ['a', 'b', 'c'], 2, 1);
    const rating = (card: string): FlashcardRatingCommand => ({ attemptId: card, events: {}, patch: { baseRev: 1, entries: [{
      path: ['meta', 'reviewSessions', 'future'], before: session, after: completeReviewEncounter(session, card),
    }] } });
    const source = { meta: { reviewSessions: { future: session } } };
    const first = applyFlashcardRatingCommand(source, rating('a'));
    const second = applyFlashcardRatingCommand(first, rating('b'));
    expect(second.meta.reviewSessions.future.completedCardIds).toEqual(['a', 'b']);
    expect(() => applyFlashcardRatingCommand(second, rating('c'))).toThrow(RatingAdmissionRefusal);
    expect(source.meta.reviewSessions.future.completedCardIds).toEqual([]);
  });

  it('recognizes refused attempt identities after Electron error serialization without treating I/O failures as cancellation', () => {
    const refusal = new RatingAdmissionRefusal(['never-admitted']);
    expect(refusedRatingAttemptIds(refusal)).toEqual(['never-admitted']);
    expect(refusedRatingAttemptIds(new Error(`Error invoking handler: ${refusal.message}`))).toEqual(['never-admitted']);
    expect(refusedRatingAttemptIds(new Error('disk full'))).toBeNull();
    expect(refusedRatingAttemptIds(new Error('mlearn-rating-admission-refused:[1]'))).toBeNull();
  });
  it('accumulates ratings from the same revision while preserving concurrent content edits', () => {
    const source = { cards: { one: { reviews: 2, answer: 'peer edit', packageFeature: { unknown: [1, 2] } } } };
    const first = applyFlashcardRatingCommand(source, command('first'));
    const second = applyFlashcardRatingCommand(first, command('second'));
    expect(second.cards.one).toEqual({ reviews: 4, answer: 'peer edit', packageFeature: { unknown: [1, 2] } });
    expect(source.cards.one.reviews).toBe(2);
    expect(first.cards.one.reviews).toBe(3);
  });

  it('detaches counter ancestors even when the declared patch left them unchanged', () => {
    const nested = { reviews: 2 };
    const source = { cards: { one: { nested } } };
    const rating: FlashcardRatingCommand = { attemptId: 'nested', events: {},
      patch: { baseRev: 1, entries: [{ path: ['cards', 'one'], before: { nested }, after: { nested } }] },
      counterDeltas: [{ path: ['cards', 'one', 'nested', 'reviews'], delta: 1 }],
    };
    expect(applyFlashcardRatingCommand(source, rating).cards.one.nested.reviews).toBe(3);
    expect(source.cards.one.nested.reviews).toBe(2);
  });

  it('resets scoped counters once and then accumulates other ratings for that date', () => {
    const source = { meta: { reviewsToday: 9, date: 'previous' } };
    const rating: FlashcardRatingCommand = { attemptId: 'today', events: {},
      patch: { baseRev: 1, entries: [{ path: ['meta'], before: source.meta, after: { reviewsToday: 1, date: 'today' } }] },
      counterDeltas: [{ path: ['meta', 'reviewsToday'], delta: 1, scope: { path: ['meta', 'date'], value: 'today' } }],
    };
    const first = applyFlashcardRatingCommand(source, rating);
    expect(first.meta).toEqual({ reviewsToday: 1, date: 'today' });
    expect(applyFlashcardRatingCommand(first, rating).meta.reviewsToday).toBe(2);
    expect(source.meta).toEqual({ reviewsToday: 9, date: 'previous' });
  });

  it('recovers an immutable supplied-response command whose migrated cache lowered the saved review count', () => {
    const cache = { state: 'review', ease: 2.5, interval: 100, dueAt: 100, reviews: 18,
      lapses: 0, learningStep: 0, lastReviewed: 1, provenance: 'migrated-scheduler-cache' };
    const before = { id: 'one', reviews: 19, retentionCache: cache };
    const after = { ...before, reviews: 18, retentionCache: { ...cache, lastReviewed: 2, provenance: 'derived-scheduler-cache' } };
    const rating: FlashcardRatingCommand = { attemptId: 'supplied', guardCardIds: ['one'],
      events: { word: [{ t: 2, kind: 'review', source: 'srs', rating: 'good', schedulerCardId: 'one',
        attemptId: 'supplied', retentionCondition: 'supplied' }] },
      patch: { baseRev: 1, entries: [{ path: ['flashcards', 'one'], before, after }] },
      counterDeltas: [{ path: ['flashcards', 'one', 'reviews'], delta: -1 }] };
    const original = JSON.stringify(rating);
    const result = applyFlashcardRatingCommand({ flashcards: { one: before } }, rating);
    expect(result.flashcards.one.reviews).toBe(19);
    expect(result.flashcards.one.retentionCache.reviews).toBe(19);
    expect(result.flashcards.one.retentionCache.lastReviewed).toBe(2);
    expect(JSON.stringify(rating)).toBe(original);
    // An ordinary count-decreasing command is still rejected by Guardian;
    // only this exact supplied-cache mismatch receives the compatibility repair.
    const ordinary = { ...rating, events: {} };
    expect(applyFlashcardRatingCommand({ flashcards: { one: before } }, ordinary).flashcards.one.reviews).toBe(18);
  });

  it('rejects undeclared or invalid counters before mutating live state', () => {
    const source = { cards: { one: { reviews: 2, answer: 'original' } } };
    const invalid = { ...command('invalid'), counterDeltas: [{ path: ['unrelated'], delta: 1 }] };
    expect(() => applyFlashcardRatingCommand(source, invalid, true)).toThrow('Invalid rating counter delta');
    expect(() => applyFlashcardRatingCommand(source, { ...command('nan'), counterDeltas: [
      { path: ['cards', 'one', 'reviews'], delta: NaN },
    ] }, true)).toThrow('Invalid rating counter delta');
    expect(source.cards.one.reviews).toBe(2);
  });
});
