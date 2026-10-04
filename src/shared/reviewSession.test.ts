import { describe, expect, it } from 'vitest';
import { beginReviewSession, reviewSessionRemaining, completeReviewEncounter, undoReviewEncounter, isReviewSession, reviewSessionHasAvailableCards } from './reviewSession';
import type { Flashcard, FlashcardStore, ReviewPresentation } from './types';
import { hashWordSync } from './utils/wordHash';
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
  it('round-trips a fresh handoff card without losing membership or accepting another card', () => {
    const session = { ...beginReviewSession('visit', ['first', 'chosen'], 2, 10), requestId: 'home', initialCardId: 'chosen' };
    expect(isReviewSession(JSON.parse(JSON.stringify(session)))).toBe(true);
    expect(isReviewSession({ ...session, initialCardId: 'foreign' })).toBe(false);
    expect(completeReviewEncounter(session, 'chosen')).toMatchObject({ initialCardId: 'chosen', completedCardIds: ['chosen'] });
  });
  it('preserves the captured offer and opaque cue metadata across serialization', () => {
    const initialHandoff = { id: 'home', at: 10, policyVersion: 'future-controller', selected: {
      key: 'chosen', action: 'review', task: { taskTemplateId: 'opaque-task', inputModality: 'activity-handoff', responseModality: 'none',
        supplied: [], requested: ['unknown-access'], fluencyRequired: false, ratingMode: 'profile' as const },
      targets: [{ kind: 'opaque-entity', id: 'future:chosen', capability: 'unknown-access' }],
      presentation: { unknownFeature: { values: ['unseen'], context: { arbitrary: true } } },
    }, baseline: null, detail: { arbitraryPackageData: [1, { future: true }] } };
    const session = { ...beginReviewSession('visit', ['chosen'], 1, 10), requestId: 'home', initialCardId: 'chosen', initialHandoff };
    const restored = JSON.parse(JSON.stringify(session));
    expect(isReviewSession(restored)).toBe(true); expect(restored.initialHandoff).toEqual(initialHandoff);
    expect(isReviewSession({ ...session, requestId: 'different-home' })).toBe(false);
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

  it('keeps an already admitted presentation resumable before its next due time', () => {
    const card: Flashcard = { id: 'a', language: 'future', content: { type: 'word', front: 'opaque', back: 'answer' },
      state: 'review', dueDate: 1000, interval: 1000, ease: 2.5, reviews: 1, lapses: 0, learningStep: 0,
      createdAt: 1, lastReviewed: 1, lastUpdated: 1 };
    const session = beginReviewSession('s', ['a'], 1, 1);
    const presentation: ReviewPresentation = { id: 'choice', cardId: card.id, session,
      decision: { id: 'choice', at: 1, policyVersion: 'test', selected: { key: card.id, action: 'MAINTAIN',
        presentation: { cardId: card.id, language: 'future', surface: card.content.front, contentVersion: hashWordSync(JSON.stringify(card.content)) },
        targets: [{ kind: 'surface', id: 'future:surface:opaque', capability: 'unknown-task' }],
        task: { taskTemplateId: 'package-task', inputModality: 'audio', responseModality: 'self-assessment',
          supplied: ['cue'], requested: ['unknown-task'], fluencyRequired: false, ratingMode: 'profile' } },
        baseline: null, detail: {} } };
    const store = { flashcards: { a: card }, ignoredWords: {}, meta: {
      reviewPresentations: { future: presentation } } } as unknown as FlashcardStore;
    expect(reviewSessionHasAvailableCards(session, store, 'future', 10)).toBe(true);
    expect(reviewSessionHasAvailableCards(session, { ...store, meta: { ...store.meta, reviewPresentations: {} } }, 'future', 10)).toBe(false);
    expect(reviewSessionHasAvailableCards(session, { ...store, flashcards: { a: { ...card, content: { ...card.content, back: 'changed' } } } }, 'future', 10)).toBe(false);
    expect(reviewSessionHasAvailableCards(session, { ...store, flashcards: { a: { ...card, buried: true } } }, 'future', 10)).toBe(false);
    expect(reviewSessionHasAvailableCards({ ...session, id: 'different' }, store, 'future', 10)).toBe(false);
    expect(reviewSessionHasAvailableCards(completeReviewEncounter(session, 'a'), store, 'future', 10)).toBe(false);
  });
});
