import { isLearningDecision } from './learningDecision';
import type { Flashcard, FlashcardStore, ReviewPresentation } from './types';
import type { StorePatch } from './utils/storePatch';
import { hashWordSync } from './utils/wordHash';

/** A cursor command captures its question; it never carries the whole library. */
export interface ReviewPresentationWrite {
  language: string;
  presentation: ReviewPresentation;
  expectedId: string | null;
  card: Flashcard;
}

/** Validate at the writer, after earlier ratings/peer writes have settled. */
export function reviewPresentationPatch(store: FlashcardStore, command: ReviewPresentationWrite): StorePatch | null {
  const { presentation, language, card, expectedId } = command;
  const decision = presentation.decision;
  const cue = decision?.selected.presentation;
  if (!isLearningDecision(decision) || presentation.id !== decision.id || presentation.cardId !== decision.selected.key
    || card.id !== presentation.cardId || cue?.cardId !== card.id || cue.surface !== card.content.front
    || cue.language !== language || cue.language !== (card.language || language)
    || (cue.contentVersion !== undefined && cue.contentVersion !== hashWordSync(JSON.stringify(card.content)))) {
    throw new Error('Invalid saved review choice');
  }
  // A late cursor for a rated/edited/removed card is obsolete, not a failed encounter.
  if (card.suspended || card.buried || JSON.stringify({ ...store.flashcards[card.id], retentionCache: undefined }) !== JSON.stringify({ ...card, retentionCache: undefined })) return null;
  const existing = store.meta.reviewPresentations?.[language];
  if (existing?.id === presentation.id && JSON.stringify(existing) === JSON.stringify(presentation)) {
    return { baseRev: store.rev ?? 0, entries: [] };
  }
  if ((existing?.id ?? null) !== expectedId) throw new Error('The review position was replaced by another window');
  return { baseRev: store.rev ?? 0, entries: [{ path: ['meta', 'reviewPresentations', language], before: existing, after: presentation }] };
}
