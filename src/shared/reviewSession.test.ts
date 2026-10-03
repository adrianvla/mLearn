import { describe, expect, it } from 'vitest';
import { beginReviewSession, reviewSessionRemaining, completeReviewEncounter, undoReviewEncounter } from './reviewSession';
describe('finite review boundary', () => {
  it('freezes eligible membership, limits work and does not immediately repeat failure', () => {
    const session = beginReviewSession('s', ['a', 'b', 'a', 'c'], 2, 10);
    expect(session.cardIds).toEqual(['a', 'b', 'c']);
    const next = completeReviewEncounter(session, 'a');
    expect(reviewSessionRemaining(next)).toBe(1);
    expect(completeReviewEncounter(next, 'a')).toEqual(next);
    expect(reviewSessionRemaining(completeReviewEncounter(next, 'b'))).toBe(0);
    expect(completeReviewEncounter(next, 'new')).toEqual(next);
  });
  it('persists interruption and retracts only the actual reviewed encounter', () => {
    const session = completeReviewEncounter(beginReviewSession('s', ['a', 'b'], 2, 10), 'a');
    expect(reviewSessionRemaining(JSON.parse(JSON.stringify(session)))).toBe(1);
    const undone = undoReviewEncounter(session, 'a');
    expect(undone.completedCardIds).toEqual([]);
    expect(reviewSessionRemaining(undone)).toBe(2);
  });
});

describe('withdrawn work', () => {
  it('does not confuse an unavailable boundary with completed learning', async () => {
    const { reviewSessionHasAvailableCards } = await import('./reviewSession');
    const session = beginReviewSession('s', ['removed', 'buried'], 2, 1);
    const store = { flashcards: { buried: { id: 'buried', buried: true, state: 'review', dueDate: 0, content: { front: 'word' } } }, ignoredWords: {} };
    expect(reviewSessionHasAvailableCards(session, store as never, 'future', 10)).toBe(false);
    expect(session.completedCardIds).toEqual([]);
    expect(reviewSessionRemaining(session)).toBe(2);
  });
});
