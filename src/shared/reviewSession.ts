import type { Flashcard, FlashcardStore } from './types';
import { isStudyExcluded } from './studyExclusion';
import { hashWordSync } from './utils/wordHash';

/** A finite boundary over scheduler-admitted work; it never schedules or stores mastery. */
export interface ReviewSession {
  id: string;
  /** Correlates a repeated window context with the same requested visit. */
  requestId?: string;
  cardIds: string[];
  completedCardIds: string[];
  encounterLimit: number;
  startedAt: number;
}
export function beginReviewSession(id: string, cardIds: readonly string[], limit: number, startedAt: number): ReviewSession {
  const ids = [...new Set(cardIds)];
  return { id, cardIds: ids, completedCardIds: [], encounterLimit: Math.min(ids.length, Math.max(1, Math.floor(limit))), startedAt };
}
export function reviewSessionRemaining(session: ReviewSession): number {
  return Math.max(0, Math.min(session.encounterLimit, session.cardIds.length) - session.completedCardIds.length);
}
export function completeReviewEncounter(session: ReviewSession, cardId: string): ReviewSession {
  if (!session.cardIds.includes(cardId) || session.completedCardIds.includes(cardId) || reviewSessionRemaining(session) === 0) return session;
  return { ...session, completedCardIds: [...session.completedCardIds, cardId] };
}
export function undoReviewEncounter(session: ReviewSession, cardId: string): ReviewSession {
  return { ...session, completedCardIds: session.completedCardIds.filter(id => id !== cardId) };
}
/** Withdrawn/removed or already reviewed members do not strand an old boundary.
 * This checks availability only; scheduler queues still admit all actual work. */
export function reviewCardAvailableNow(card: Flashcard | undefined, store: FlashcardStore, language: string, now = Date.now()): boolean {
  return Boolean(card && !card.suspended && !card.buried && (card.language || language) === language
    && (card.state === 'new' || card.dueDate <= now)
    && !isStudyExcluded(store.ignoredWords[`${language}:${hashWordSync(card.content.front)}`]));
}
export function reviewSessionHasAvailableCards(session: ReviewSession, store: FlashcardStore, language: string, now = Date.now()): boolean {
  return reviewSessionRemaining(session) > 0 && session.cardIds.some(id =>
    !session.completedCardIds.includes(id) && reviewCardAvailableNow(store.flashcards[id], store, language, now));
}
export function isReviewSession(value: unknown): value is ReviewSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as ReviewSession;
  return typeof session.id === 'string' && (session.requestId === undefined || typeof session.requestId === 'string') && Array.isArray(session.cardIds) && session.cardIds.every(id => typeof id === 'string')
    && Array.isArray(session.completedCardIds) && session.completedCardIds.every(id => session.cardIds.includes(id))
    && new Set(session.cardIds).size === session.cardIds.length && new Set(session.completedCardIds).size === session.completedCardIds.length
    && Number.isInteger(session.encounterLimit) && session.encounterLimit >= 0 && Number.isFinite(session.startedAt);
}
