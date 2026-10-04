import { undoReviewEncounter } from './reviewSession';
import type { DailyStudyStats, Flashcard, FlashcardStore, PerLanguageMeta, ReviewCorrection } from './types';
import type { AttemptScaffolds } from './knowledgeEvents';
import type { FlashcardRatingCommand } from './flashcardRating';
import { getStorePath, setStorePath } from './utils/storePatch';
import { isLearningDecision } from './learningDecision';

export function isReviewCorrection(value: unknown): value is ReviewCorrection {
  if (!value || typeof value !== 'object') return false;
  const correction = value as ReviewCorrection;
  return typeof correction.attemptId === 'string' && correction.attemptId.length > 0
    && Number.isFinite(correction.at) && correction.at >= 0 && isLearningDecision(correction.decision)
    && (correction.scaffolds === undefined || (!!correction.scaffolds && typeof correction.scaffolds === 'object'
      && !Array.isArray(correction.scaffolds) && Object.values(correction.scaffolds).every(flag => flag === undefined || typeof flag === 'boolean')));
}

export interface ReviewUndoProjection {
  /** Immutable original elicitation conditions for retrospective correction. Older receipts lack these. */
  correction?: ReviewCorrection;
  reviewSessionId?: string;
  cardId: string;
  type: string;
  restoreCard: Flashcard;
  restorePerLanguage: PerLanguageMeta | null;
  today: string;
  restoreDailyStats: DailyStudyStats | null;
  scaffolds?: AttemptScaffolds;
  /** Post-response ownership proof; absent only on older in-flight Undos. */
  expectedCard?: Flashcard;
  counterDeltas?: FlashcardRatingCommand['counterDeltas'];
}

const schedulingFields = ['state', 'ease', 'interval', 'dueDate', 'reviews', 'lapses',
  'learningStep', 'lastReviewed', 'retentionCache'] as const;

/** A pre-fix revealed-response receipt can retain the stale cache count in its ownership proof. */
function expectedReviewCard(restore: ReviewUndoProjection): Flashcard | undefined {
  const expected = restore.expectedCard;
  const prior = restore.restoreCard;
  const priorCache = prior.retentionCache;
  const nextCache = expected?.retentionCache;
  if (!expected || !priorCache || !nextCache || !restore.scaffolds?.['prior-cue-exposure']
    || priorCache.provenance !== 'migrated-scheduler-cache' || nextCache.provenance !== 'derived-scheduler-cache'
    || prior.reviews <= priorCache.reviews || expected.reviews !== priorCache.reviews
    || nextCache.reviews !== priorCache.reviews
    || !['state', 'ease', 'interval', 'dueAt', 'lapses', 'learningStep'].every(key =>
      Object.is((priorCache as unknown as Record<string, unknown>)[key], (nextCache as unknown as Record<string, unknown>)[key]))) return expected;
  // Everything except the historical count and response timestamp remains the
  // captured post-image. A later rating or scheduler edit still refuses Undo.
  return { ...expected, reviews: prior.reviews, retentionCache: { ...nextCache, reviews: prior.reviews } };
}

export function validateReviewResponseUndo(store: FlashcardStore, restore: ReviewUndoProjection): void {
  if (!restore.expectedCard) return; // Shipped interrupted Undo records retain their recovery contract.
  const card = store.flashcards[restore.cardId];
  const expected = expectedReviewCard(restore)!;
  if (!card || card.id !== expected.id || card.language !== expected.language
    || card.content.front !== expected.content.front
    || schedulingFields.some(field => JSON.stringify(card[field]) !== JSON.stringify(expected[field]))) {
    throw new Error('This card changed after the response; its earlier review cannot be undone');
  }
  const record = store as unknown as Record<string, unknown>;
  for (const { path, delta, scope } of restore.counterDeltas ?? []) {
    if (path[0] !== 'meta' && path[0] !== 'dailyStats') throw new Error('Invalid review Undo counter');
    if (scope && !Object.is(getStorePath(record, scope.path), scope.value)) continue;
    const current = getStorePath(record, path);
    if (typeof current !== 'number' || !Number.isFinite(delta) || delta < 0 || current < delta) {
      throw new Error('The review totals changed before this response could be undone');
    }
  }
}

/** Reverses one scheduler response without replacing authored content or peer totals. */
export function restoreReviewResponse(store: FlashcardStore, restore: ReviewUndoProjection): void {
  validateReviewResponseUndo(store, restore);
  const card = store.flashcards[restore.cardId];
  if (!restore.expectedCard || !card) throw new Error('The response has no scheduler rollback proof');
  for (const field of schedulingFields) {
    const value = restore.restoreCard[field];
    if (value === undefined) delete card[field];
    else (card as unknown as Record<string, unknown>)[field] = JSON.parse(JSON.stringify(value)) as unknown;
  }
  if (card.lastUpdated === restore.expectedCard.lastUpdated) card.lastUpdated = restore.restoreCard.lastUpdated;
  const sessionLanguage = Object.keys(store.meta.reviewSessions ?? {}).find(language => store.meta.reviewSessions![language].id === restore.reviewSessionId);
  if (sessionLanguage) store.meta.reviewSessions![sessionLanguage] = undoReviewEncounter(store.meta.reviewSessions![sessionLanguage], restore.cardId);
  const record = store as unknown as Record<string, unknown>;
  for (const { path, delta, scope } of restore.counterDeltas ?? []) {
    if (scope && !Object.is(getStorePath(record, scope.path), scope.value)) continue;
    setStorePath(record, path, (getStorePath(record, path) as number) - delta);
  }
}
