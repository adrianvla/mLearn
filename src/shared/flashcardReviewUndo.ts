import type { DailyStudyStats, Flashcard, FlashcardStore, PerLanguageMeta } from './types';
import type { AttemptScaffolds } from './knowledgeEvents';
import type { FlashcardRatingCommand } from './flashcardRating';
import { getStorePath, setStorePath } from './utils/storePatch';

export interface ReviewUndoProjection {
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

export function validateReviewResponseUndo(store: FlashcardStore, restore: ReviewUndoProjection): void {
  if (!restore.expectedCard) return; // Shipped interrupted Undo records retain their recovery contract.
  const card = store.flashcards[restore.cardId];
  const expected = restore.expectedCard;
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
  const record = store as unknown as Record<string, unknown>;
  for (const { path, delta, scope } of restore.counterDeltas ?? []) {
    if (scope && !Object.is(getStorePath(record, scope.path), scope.value)) continue;
    setStorePath(record, path, (getStorePath(record, path) as number) - delta);
  }
}
