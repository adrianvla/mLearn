import { describe, expect, it } from 'vitest';
import type { FlashcardStore } from './types';
import { reviewPresentationPatch, type ReviewPositionRelease } from './reviewPresentationWrite';
import { copyStoreWithPatch } from './utils/storePatch';

function fixture() {
  const store: FlashcardStore = { flashcards: {}, wordCandidates: {}, wordToCardMap: {}, wordStatsMap: {},
    knownUntracked: {}, ignoredWords: {}, wordKnowledge: {}, grammarKnowledge: {}, suggestedFlashcards: {},
    meta: { perLanguage: {}, maxNewCardsPerDay: 10, maxNewCardsPerDayLearning: 20, maxReviewsPerDay: -1,
      learningSteps: [1, 10], relearnSteps: [10], graduatingInterval: 1, easyInterval: 4,
      newIntervalModifier: 100, reviewIntervalModifier: 100, maxInterval: 36500 }, dailyStats: {}, version: 3 };
  const session = { id: 'held', cardIds: ['card'], completedCardIds: [], encounterLimit: 1, startedAt: 1 };
  const presentation = { id: 'choice', cardId: 'card', session };
  store.meta.reviewSessions = { opaque: session };
  store.meta.reviewPresentations = { opaque: presentation };
  const command: ReviewPositionRelease = { kind: 'release', language: 'opaque',
    expectedSession: structuredClone(session), expectedPresentation: structuredClone(presentation) };
  return { store, command };
}

describe('explicit Review position release', () => {
  it('suspends captured work on Start and restores only a named saved position', () => {
    const { store, command } = fixture();
    const started = copyStoreWithPatch(store, reviewPresentationPatch(store, { ...command, kind: 'switch' })!);
    expect(started.meta.reviewPresentations?.opaque).toBeUndefined();
    expect(started.meta.suspendedReviews?.opaque.held).toEqual({ session: command.expectedSession, presentation: command.expectedPresentation });
    started.meta.reviewPresentations = { opaque: { id: 'other', cardId: 'other-card', revealed: true } };
    const resumed = copyStoreWithPatch(started, reviewPresentationPatch(started, { kind: 'switch', language: 'opaque',
      expectedSession: null, expectedPresentation: started.meta.reviewPresentations.opaque, resumeId: 'held' })!);
    expect(resumed.meta.reviewSessions?.opaque).toEqual(command.expectedSession);
    expect(resumed.meta.reviewPresentations?.opaque).toEqual(command.expectedPresentation);
    expect(resumed.meta.suspendedReviews?.opaque.other).toEqual({ presentation: started.meta.reviewPresentations.opaque });
    expect(resumed.flashcards).toEqual(store.flashcards);
  });

  it('refuses missing identities, stale switches and switching during Undo recovery', () => {
    const { store, command } = fixture();
    expect(() => reviewPresentationPatch(store, { ...command, kind: 'switch', resumeId: 'missing' })).toThrow('unavailable');
    expect(() => reviewPresentationPatch(store, { ...command, kind: 'switch', expectedSession: null })).toThrow('another window');
    store.pendingRetraction = {} as NonNullable<FlashcardStore['pendingRetraction']>;
    expect(() => reviewPresentationPatch(store, { ...command, kind: 'switch' })).toThrow('Undo');
  });

  it('releases only the captured boundary and cursor, preserving learner state and Undo', () => {
    const { store, command } = fixture();
    const original = structuredClone(store);
    const patch = reviewPresentationPatch(store, command)!;
    expect(patch.entries.map(entry => entry.path)).toEqual([
      ['meta', 'reviewPresentations', 'opaque'], ['meta', 'reviewSessions', 'opaque'],
    ]);
    expect(store).toEqual(original);
    const next = copyStoreWithPatch(store, patch);
    expect(next.meta.reviewPresentations?.opaque).toBeUndefined();
    expect(next.meta.reviewSessions?.opaque).toBeUndefined();
    expect(next.flashcards).toEqual(original.flashcards);
    expect(next.wordKnowledge).toEqual(original.wordKnowledge);
    expect(reviewPresentationPatch(next, command)?.entries).toEqual([]);
  });

  it('refuses a late release after exposure, progress or another window replaced work', () => {
    for (const change of ['exposure', 'progress', 'replacement']) {
      const { store, command } = fixture();
      if (change === 'exposure') store.meta.reviewPresentations!.opaque.stageIndex = 1;
      if (change === 'progress') store.meta.reviewSessions!.opaque.completedCardIds.push('card');
      if (change === 'replacement') store.meta.reviewPresentations!.opaque.id = 'peer';
      expect(() => reviewPresentationPatch(store, command)).toThrow('another window');
    }
  });

  it('does not discard work while Undo recovery is pending', () => {
    const { store, command } = fixture();
    store.pendingRetraction = {} as NonNullable<FlashcardStore['pendingRetraction']>;
    expect(() => reviewPresentationPatch(store, command)).toThrow('Undo');
  });
});
