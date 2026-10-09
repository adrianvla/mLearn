import { isReviewSession, reviewSessionRemaining, reviewSessionHasAvailableCards } from './reviewSession';
import { isLearningDecision } from './learningDecision';
import type { Flashcard, FlashcardStore, ReviewPresentation } from './types';
import type { StorePatch } from './utils/storePatch';
import { hashWordSync } from './utils/wordHash';
import type { ReviewSession } from './reviewSession';
import { isReviewCorrection } from './flashcardReviewUndo';

/** A cursor command captures its question; it never carries the whole library. */
export interface ReviewPresentationWrite {
  language: string;
  presentation: ReviewPresentation;
  expectedId: string | null;
  card: Flashcard;
}

/** Explicitly leave captured work; this carries no response or scheduling change. */
export interface ReviewPositionRelease {
  kind: 'release';
  language: string;
  expectedPresentation: ReviewPresentation | null;
  expectedSession: ReviewSession | null;
}
export interface ReviewPositionSwitch extends Omit<ReviewPositionRelease, 'kind'> {
  kind: 'switch';
  /** Absence means Start; Resume must identify a stored position exactly. */
  resumeId?: string;
}
export type ReviewPositionWrite = ReviewPresentationWrite | ReviewPositionRelease | ReviewPositionSwitch;

const samePosition = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object'
    || Array.isArray(left) !== Array.isArray(right)) return false;
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
  return Object.keys(a).length === Object.keys(b).length
    && Object.keys(a).every(key => Object.hasOwn(b, key) && samePosition(a[key], b[key]));
};

/** Validate at the writer, after earlier ratings/peer writes have settled. */
export function reviewPresentationPatch(store: FlashcardStore, command: ReviewPositionWrite): StorePatch | null {
  if ('kind' in command && command.kind === 'switch') {
    if (!command.language || typeof command.language !== 'string'
      || (command.resumeId !== undefined && (typeof command.resumeId !== 'string' || !command.resumeId))
      || (command.expectedSession !== null && !isReviewSession(command.expectedSession))) throw new Error('Invalid review position switch');
    if (store.pendingRetraction !== undefined) throw new Error('Complete the pending Undo before switching this review');
    const presentation = store.meta.reviewPresentations?.[command.language];
    const session = store.meta.reviewSessions?.[command.language];
    if (!samePosition(presentation ?? null, command.expectedPresentation) || !samePosition(session ?? null, command.expectedSession)) {
      throw new Error('The review position was replaced by another window');
    }
    const id = session?.id ?? presentation?.id;
    if (command.resumeId && command.resumeId === id) return { baseRev: store.rev ?? 0, entries: [] };
    const prior = store.meta.suspendedReviews?.[command.language];
    const restored = command.resumeId ? prior?.[command.resumeId] : undefined;
    if (command.resumeId && (!restored || (restored.session?.id ?? restored.presentation?.id) !== command.resumeId
      || (restored.session !== undefined && !isReviewSession(restored.session))
      || (restored.presentation !== undefined && (!restored.presentation.id || !restored.presentation.cardId
        || (restored.session && restored.presentation.session?.id !== restored.session.id))))) {
      throw new Error('The saved review is unavailable');
    }
    const suspended = { ...prior, ...(id ? { [id]: { ...(session ? { session } : {}), ...(presentation ? { presentation } : {}) } } : {}) };
    if (command.resumeId) delete suspended[command.resumeId];
    return { baseRev: store.rev ?? 0, entries: [
      { path: ['meta', 'suspendedReviews', command.language], before: prior, after: suspended },
      { path: ['meta', 'reviewPresentations', command.language], before: presentation, after: restored?.presentation },
      { path: ['meta', 'reviewSessions', command.language], before: session, after: restored?.session },
    ] };
  }
  if ('kind' in command && command.kind === 'release') {
    if (typeof command.language !== 'string' || !command.language
      || (command.expectedSession !== null && !isReviewSession(command.expectedSession))
      || (command.expectedPresentation !== null && (!command.expectedPresentation
        || typeof command.expectedPresentation.id !== 'string' || typeof command.expectedPresentation.cardId !== 'string'))) {
      throw new Error('Invalid review position release');
    }
    if (store.pendingRetraction !== undefined) throw new Error('Complete the pending Undo before leaving this review');
    const presentation = store.meta.reviewPresentations?.[command.language];
    const session = store.meta.reviewSessions?.[command.language];
    if (!presentation && !session) return { baseRev: store.rev ?? 0, entries: [] };
    if (!samePosition(presentation ?? null, command.expectedPresentation) || !samePosition(session ?? null, command.expectedSession)) {
      throw new Error('The review position was replaced by another window');
    }
    return { baseRev: store.rev ?? 0, entries: [
      ...(presentation ? [{ path: ['meta', 'reviewPresentations', command.language], before: presentation, after: undefined }] : []),
      ...(session ? [{ path: ['meta', 'reviewSessions', command.language], before: session, after: undefined }] : []),
    ] };
  }
  if ('kind' in command) throw new Error('Invalid review position command');
  const { presentation, language, card, expectedId } = command;
  const decision = presentation.decision;
  const cue = decision?.selected.presentation;
  if (!isLearningDecision(decision) || presentation.id !== decision.id || presentation.cardId !== decision.selected.key
    || card.id !== presentation.cardId || cue?.cardId !== card.id || cue.surface !== card.content.front
    || cue.language !== language || cue.language !== (card.language || language)
    || (cue.contentVersion !== undefined && cue.contentVersion !== hashWordSync(JSON.stringify(card.content)))) {
    throw new Error('Invalid saved review choice');
  }
  if (presentation.stageIndex !== undefined && (!decision.selected.task.stages
    || !Number.isInteger(presentation.stageIndex) || presentation.stageIndex < 0
    || presentation.stageIndex >= decision.selected.task.stages.length)) throw new Error('Invalid retrieval stage');
  if (presentation.stageScaffolds !== undefined) {
    if (!presentation.stageScaffolds || typeof presentation.stageScaffolds !== 'object' || Array.isArray(presentation.stageScaffolds)) throw new Error('Invalid stage conditions');
    for (const [id, flags] of Object.entries(presentation.stageScaffolds)) {
      const index = decision.selected.task.stages?.findIndex(stage => stage.id === id) ?? -1;
      if (index < 0 || index >= (presentation.stageIndex ?? 0) || !flags || typeof flags !== 'object'
        || Array.isArray(flags) || Object.values(flags).some(value => value !== undefined && typeof value !== 'boolean')) throw new Error('Invalid stage conditions');
    }
  }
  // A late cursor for a rated/edited/removed card is obsolete, not a failed encounter.
  if (card.suspended || card.buried || JSON.stringify({ ...store.flashcards[card.id], retentionCache: undefined }) !== JSON.stringify({ ...card, retentionCache: undefined })) return null;
  const existing = store.meta.reviewPresentations?.[language];
  if (presentation.materialSnapshot !== undefined) {
    const material = presentation.materialSnapshot;
    if (!material || typeof material !== 'object' || Array.isArray(material)
      || !(material.languageData === null || (!!material.languageData && typeof material.languageData === 'object' && !Array.isArray(material.languageData)))
      || !(material.lookup === null || (!!material.lookup && typeof material.lookup === 'object' && Array.isArray(material.lookup.data)))) {
      throw new Error('Invalid review material snapshot');
    }
  }
  if (existing?.id === presentation.id && existing.materialSnapshot !== undefined
    && JSON.stringify(existing.materialSnapshot) !== JSON.stringify(presentation.materialSnapshot)) {
    throw new Error('Admitted review material cannot be replaced');
  }
  if ((existing?.correction || presentation.correction) && (!existing?.correction
    || !isReviewCorrection(existing.correction)
    || !samePosition(existing.correction, presentation.correction)
    || !samePosition(presentation.decision, existing.correction.decision))) {
    throw new Error('The original elicitation of a correction cannot be replaced');
  }
  if (existing?.id === presentation.id && JSON.stringify(existing) === JSON.stringify(presentation)) {
    return { baseRev: store.rev ?? 0, entries: [] };
  }
  if ((existing?.id ?? null) !== expectedId) throw new Error('The review position was replaced by another window');
  if (existing?.id === presentation.id && existing.stageIndex !== undefined
    && (presentation.stageIndex ?? 0) < existing.stageIndex) throw new Error('Retrieval stage cannot rewind exposed cues');
  if ((presentation.stageIndex ?? 0) > (existing?.id === presentation.id ? (existing.stageIndex ?? 0) + 1 : 0)) {
    throw new Error('Retrieval stages must be admitted in order');
  }
  if (existing?.id === presentation.id && Object.entries(existing.stageScaffolds ?? {}).some(([id, flags]) =>
    JSON.stringify(presentation.stageScaffolds?.[id]) !== JSON.stringify(flags))) throw new Error('Completed retrieval conditions cannot be replaced');
  const entries: Array<StorePatch['entries'][number]> = [{ path: ['meta', 'reviewPresentations', language], before: existing, after: presentation }];
  if (presentation.session) {
    const session = presentation.session;
    const prior = store.meta.reviewSessions?.[language];
    if (!isReviewSession(session) || !session.cardIds.includes(card.id) || session.completedCardIds.includes(card.id)
      || reviewSessionRemaining(session) === 0) throw new Error('Invalid finite review session');
    if (prior?.id !== session.id) {
      if (prior && reviewSessionHasAvailableCards(prior, store, language)) throw new Error('An interrupted review session must be resumed');
      entries.push({ path: ['meta', 'reviewSessions', language], before: prior, after: session });
    } else if (prior.completedCardIds.includes(card.id) || reviewSessionRemaining(prior) === 0) return null;
  }
  return { baseRev: store.rev ?? 0, entries };
}
