import { describe, expect, it } from 'vitest';
import { applyFlashcardRatingCommand, type FlashcardRatingCommand } from './flashcardRating';

const command = (attemptId: string): FlashcardRatingCommand => ({
  attemptId, events: {}, patch: { baseRev: 1, entries: [{
    path: ['cards', 'one'], before: { reviews: 2, answer: 'original' }, after: { reviews: 3, answer: 'original' },
  }] }, counterDeltas: [{ path: ['cards', 'one', 'reviews'], delta: 1 }],
});

describe('applyFlashcardRatingCommand', () => {
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
