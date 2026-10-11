import type { Flashcard, FlashcardStore } from './types';
import { isStudyExcluded } from './studyExclusion';
import { hashWordSync } from './utils/wordHash';
import { isLearningDecision, type LearningDecision } from './learningDecision';

/** A finite boundary over scheduler-admitted work; it never schedules or stores mastery. */
export interface ReviewSession {
  id: string;
  /** Correlates a repeated window context with the same requested visit. */
  requestId?: string;
  /** Fresh handoff selection; completed work and durable presentations take precedence. */
  initialCardId?: string;
  /** Captured Home offer; the canonical parent remains in the decision journal. */
  initialHandoff?: LearningDecision;
  cardIds: string[];
  completedCardIds: string[];
  /** Immutable admitted item+task worklist. Omitted on legacy/material-only sessions. */
  workIds?: string[];
  workCardIds?: Record<string, string>;
  completedWorkIds?: string[];
  encounterLimit: number;
  startedAt: number;
}

export function beginReviewSession(id: string, cardIds: readonly string[], limit: number, startedAt: number,
  workItems?: readonly { id: string; cardId: string }[]): ReviewSession {
  const ids = [...new Set(cardIds)];
  if (!workItems) return { id, cardIds: ids, completedCardIds: [],
    encounterLimit: Math.min(ids.length, Math.max(1, Math.floor(limit))), startedAt };
  const workCardIds: Record<string, string> = {};
  for (const item of workItems) {
    if (item.id && ids.includes(item.cardId) && workCardIds[item.id] === undefined) workCardIds[item.id] = item.cardId;
  }
  const workIds = Object.keys(workCardIds);
  return { id, cardIds: ids, completedCardIds: [], workIds, workCardIds, completedWorkIds: [],
    encounterLimit: Math.min(workIds.length, Math.max(1, Math.floor(limit))), startedAt };
}

export function reviewSessionRemaining(session: ReviewSession): number {
  return session.workIds
    ? Math.max(0, Math.min(session.encounterLimit, session.workIds.length) - (session.completedWorkIds?.length ?? 0))
    : Math.max(0, Math.min(session.encounterLimit, session.cardIds.length) - session.completedCardIds.length);
}

export function reviewSessionCompletedCount(session: ReviewSession): number {
  return session.workIds ? (session.completedWorkIds?.length ?? 0) : session.completedCardIds.length;
}

export function reviewSessionWorkAvailable(session: ReviewSession, workId: string, cardId: string): boolean {
  if (!session.cardIds.includes(cardId) || reviewSessionRemaining(session) === 0) return false;
  if (!session.workIds) return !session.completedCardIds.includes(cardId);
  return session.workIds.includes(workId) && session.workCardIds?.[workId] === cardId
    && !session.completedWorkIds?.includes(workId);
}

export function reviewSessionHasPendingWorkForCard(session: ReviewSession, cardId: string): boolean {
  if (!session.cardIds.includes(cardId) || reviewSessionRemaining(session) === 0) return false;
  return session.workIds
    ? session.workIds.some(workId => session.workCardIds?.[workId] === cardId && !session.completedWorkIds?.includes(workId))
    : !session.completedCardIds.includes(cardId);
}

export function completeReviewEncounter(session: ReviewSession, workId: string, cardId = workId): ReviewSession {
  if (session.workIds) {
    if (!reviewSessionWorkAvailable(session, workId, cardId)) return session;
    const completedWorkIds = [...(session.completedWorkIds ?? []), workId];
    const completedCardIds = session.cardIds.filter(id => {
      const workForCard = session.workIds!.filter(candidate => session.workCardIds?.[candidate] === id);
      return workForCard.length > 0 && workForCard.every(candidate => completedWorkIds.includes(candidate));
    });
    return { ...session, completedWorkIds, completedCardIds };
  }
  if (!session.cardIds.includes(cardId) || session.completedCardIds.includes(cardId) || reviewSessionRemaining(session) === 0) return session;
  return { ...session, completedCardIds: [...session.completedCardIds, cardId] };
}

export function undoReviewEncounter(session: ReviewSession, workId: string, cardId = workId): ReviewSession {
  if (session.workIds) {
    const completedWorkIds = (session.completedWorkIds ?? []).filter(id => id !== workId);
    const completedCardIds = session.completedCardIds.filter(id => id !== cardId
      || session.workIds!.filter(candidate => session.workCardIds?.[candidate] === id).every(candidate => completedWorkIds.includes(candidate)));
    return { ...session, completedWorkIds, completedCardIds };
  }
  return { ...session, completedCardIds: session.completedCardIds.filter(id => id !== cardId) };
}

/** Withdrawn/removed or already reviewed members do not strand an old boundary. */
export function reviewCardAvailableNow(card: Flashcard | undefined, store: FlashcardStore, language: string, now = Date.now()): boolean {
  return Boolean(card && !card.suspended && !card.buried && (card.language || language) === language
    && (card.state === 'new' || card.dueDate <= now)
    && !isStudyExcluded(store.ignoredWords[`${language}:${hashWordSync(card.content.front)}`]));
}

export function reviewSessionHasAvailableCards(session: ReviewSession, store: FlashcardStore, language: string, now = Date.now()): boolean {
  const cursor = store.meta?.reviewPresentations?.[language];
  const choice = cursor?.decision;
  const cue = choice?.selected.presentation;
  return reviewSessionRemaining(session) > 0 && session.cardIds.some(id => {
    if (!reviewSessionHasPendingWorkForCard(session, id)) return false;
    const card = store.flashcards[id];
    if (reviewCardAvailableNow(card, store, language, now)) return true;
    // A task-aware session froze these exact material+task opportunities; due-date
    // advancement after a sibling response must not retire the other work.
    if (session.workIds && card && !card.suspended && !card.buried && (card.language || language) === language
      && !isStudyExcluded(store.ignoredWords[`${language}:${hashWordSync(card.content.front)}`])) return true;
    // A frozen, unfinished legacy encounter has already been admitted.
    return Boolean(card && cursor?.cardId === id && cursor.session?.id === session.id
      && isLearningDecision(choice) && cue?.cardId === id && choice.selected.presentation?.cardId === id
      && cue.language === language && cue.surface === card.content.front
      && cue.contentVersion === hashWordSync(JSON.stringify(card.content))
      && !card.suspended && !card.buried && (card.language || language) === language
      && !isStudyExcluded(store.ignoredWords[`${language}:${hashWordSync(card.content.front)}`]));
  });
}

export function isReviewSession(value: unknown): value is ReviewSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as ReviewSession;
  const workFieldsValid = session.workIds === undefined
    ? session.workCardIds === undefined && session.completedWorkIds === undefined
    : Array.isArray(session.workIds) && session.workIds.every(id => typeof id === 'string' && id.length > 0)
      && new Set(session.workIds).size === session.workIds.length && !!session.workCardIds
      && typeof session.workCardIds === 'object' && !Array.isArray(session.workCardIds)
      && Object.keys(session.workCardIds).length === session.workIds.length
      && session.workIds.every(id => typeof session.workCardIds![id] === 'string' && session.cardIds.includes(session.workCardIds![id]))
      && Array.isArray(session.completedWorkIds) && session.completedWorkIds.every(id => session.workIds!.includes(id))
      && new Set(session.completedWorkIds).size === session.completedWorkIds.length;
  return typeof session.id === 'string' && (session.requestId === undefined || typeof session.requestId === 'string')
    && Array.isArray(session.cardIds) && session.cardIds.every(id => typeof id === 'string')
    && (session.initialHandoff === undefined || (isLearningDecision(session.initialHandoff) && session.initialHandoff.id === session.requestId))
    && (session.initialCardId === undefined || (typeof session.initialCardId === 'string' && session.cardIds.includes(session.initialCardId)))
    && Array.isArray(session.completedCardIds) && session.completedCardIds.every(id => session.cardIds.includes(id))
    && new Set(session.cardIds).size === session.cardIds.length && new Set(session.completedCardIds).size === session.completedCardIds.length
    && workFieldsValid && Number.isInteger(session.encounterLimit) && session.encounterLimit >= 0 && Number.isFinite(session.startedAt);
}
