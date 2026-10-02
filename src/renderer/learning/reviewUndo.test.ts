import { describe, expect, it } from 'vitest';
import type { Flashcard, FlashcardStore } from '../../shared/types';
import { restoreReviewResponse, validateReviewResponseUndo, type ReviewUndoProjection } from '../../shared/flashcardReviewUndo';

const card = { id: 'card', language: 'xx', content: { type: 'word', front: 'cue', back: 'old answer' },
  state: 'review', reviews: 3, lapses: 0, interval: 4, ease: 2, dueDate: 1, lastReviewed: 1 } as Flashcard;
const after = { ...card, reviews: 4, interval: 8, dueDate: 2, lastReviewed: 2 };
const projection: ReviewUndoProjection = { cardId: card.id, type: 'answer', restoreCard: card,
  expectedCard: after, restorePerLanguage: null, today: 'day', restoreDailyStats: null,
  counterDeltas: [{ path: ['meta', 'perLanguage', 'xx', 'reviewsToday'], delta: 1,
    scope: { path: ['meta', 'perLanguage', 'xx', 'newCardsDate'], value: 'day' } },
    { path: ['dailyStats', 'day', 'xx', 'reviewCardsStudied'], delta: 1 }] };
const store = () => ({ flashcards: { card: { ...after, content: { ...card.content, back: 'later authored answer' }, suspended: true } },
  meta: { perLanguage: { xx: { reviewsToday: 7, newCardsToday: 2, newCardsDate: 'day' } } },
  dailyStats: { day: { xx: { reviewCardsStudied: 7, timeSpent: 90 } } } }) as unknown as FlashcardStore;

describe('review response rollback', () => {
  it('reverses this response while preserving later content, exclusions and unrelated review totals', () => {
    const target = store();
    restoreReviewResponse(target, projection);
    expect(target.flashcards.card).toMatchObject({ reviews: 3, interval: 4, dueDate: 1,
      suspended: true, content: { back: 'later authored answer' } });
    expect(target.meta.perLanguage.xx.reviewsToday).toBe(6);
    expect(target.meta.perLanguage.xx.newCardsToday).toBe(2);
    expect(target.dailyStats.day.xx).toEqual({ reviewCardsStudied: 6, timeSpent: 90 });
  });
  it('leaves a new study day intact while reversing the historical daily contribution', () => {
    const target = store();
    target.meta.perLanguage.xx.newCardsDate = 'next day';
    restoreReviewResponse(target, projection);
    expect(target.meta.perLanguage.xx.reviewsToday).toBe(7);
    expect(target.dailyStats.day.xx.reviewCardsStudied).toBe(6);
  });
  it('refuses a later response on the same card before changing anything', () => {
    const target = store();
    target.flashcards.card.reviews = 5;
    const before = structuredClone(target);
    expect(() => validateReviewResponseUndo(target, projection)).toThrow(/changed/);
    expect(() => restoreReviewResponse(target, projection)).toThrow(/changed/);
    expect(target).toEqual(before);
  });
  it('refuses deleted or retargeted cards instead of resurrecting or retracting another cue', () => {
    const target = store();
    target.flashcards.card.content.front = 'other cue';
    expect(() => validateReviewResponseUndo(target, projection)).toThrow(/changed/);
    delete target.flashcards.card;
    expect(() => validateReviewResponseUndo(target, projection)).toThrow(/changed/);
  });
});
