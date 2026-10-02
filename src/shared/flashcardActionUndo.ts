import type { Flashcard, FlashcardStore } from './types';
import { hashWordSync } from './utils/wordHash';
import { nextAttemptId } from './knowledgeEvents';

/** A manual scheduling action owns one exclusion flag, not the card snapshot. */
export interface FlashcardActionUndo {
  cardId: string;
  field: 'buried' | 'suspended';
  language: string | undefined;
  front: string;
  before: boolean | undefined;
  expected: boolean | undefined;
  beforeUpdated: number;
  expectedUpdated: number;
  /** Equal millisecond timestamps alone cannot prove ownership of later edits. */
  expectedFingerprint: string;
  beforeOwner: string | undefined;
  expectedOwner: string;
  expectedGeneration: number;
}

function actionGeneration(card: Flashcard | undefined, field: FlashcardActionUndo['field']): number {
  const value = card?.scheduleActionGenerations?.[field];
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function clearFlashcardActionOwner(card: Flashcard, field: FlashcardActionUndo['field']): void {
  if (!card.scheduleActionOwners?.[field]) return;
  const owners = { ...card.scheduleActionOwners };
  card.scheduleActionGenerations = { ...card.scheduleActionGenerations, [field]: actionGeneration(card, field) + 1 };
  delete owners[field];
  if (Object.keys(owners).length) card.scheduleActionOwners = owners;
  else delete card.scheduleActionOwners;
}

export function setFlashcardExclusion(card: Flashcard, field: FlashcardActionUndo['field'], excluded: boolean): Flashcard {
  const updated = { ...card, [field]: excluded, lastUpdated: Date.now() };
  if (excluded) {
    updated.scheduleActionOwners = { ...card.scheduleActionOwners, [field]: nextAttemptId() };
    updated.scheduleActionGenerations = { ...card.scheduleActionGenerations, [field]: actionGeneration(card, field) + 1 };
  }
  else clearFlashcardActionOwner(updated, field);
  return updated;
}

/** Older snapshot writers cannot carry an action owner through Resume/reapply. */
export function reconcileFlashcardActionOwners(card: Flashcard, previous?: Flashcard): void {
  for (const field of ['buried', 'suspended'] as const) {
    const previousGeneration = actionGeneration(previous, field);
    const incomingGeneration = actionGeneration(card, field);
    let generation = Math.max(previousGeneration, incomingGeneration);
    if (card[field] !== true) {
      const hasOwner = !!card.scheduleActionOwners?.[field];
      clearFlashcardActionOwner(card, field);
      const retiredPreviousOwner = previous?.[field] === true && previous.scheduleActionOwners?.[field];
      generation = Math.max(generation, actionGeneration(card, field), retiredPreviousOwner ? previousGeneration + 1 : 0);
      if (!hasOwner && previous?.[field] !== true && !generation) continue;
    } else if (previous?.[field] === true && incomingGeneration <= previousGeneration) {
      // A content-only/legacy snapshot cannot replace the authoritative action.
      if (previous.scheduleActionOwners?.[field]) {
        card.scheduleActionOwners = { ...card.scheduleActionOwners, [field]: previous.scheduleActionOwners[field] };
      } else clearFlashcardActionOwner(card, field);
    } else if (previous && (incomingGeneration <= previousGeneration || !card.scheduleActionOwners?.[field])) {
      // Resume/reapply with a retained old snapshot is a fresh exclusion, never
      // a resurrection of that snapshot's retired Undo owner.
      card.scheduleActionOwners = { ...card.scheduleActionOwners, [field]: nextAttemptId() };
      generation = Math.max(generation, previousGeneration + 1);
    }
    if (generation || card.scheduleActionGenerations?.[field] !== undefined) {
      card.scheduleActionGenerations = { ...card.scheduleActionGenerations, [field]: generation };
    }
  }
}

export function captureFlashcardActionUndo(
  before: Flashcard, after: Flashcard, field: FlashcardActionUndo['field'],
): FlashcardActionUndo {
  const expectedOwner = after.scheduleActionOwners?.[field];
  if (!expectedOwner) throw new Error('The manual action has no ownership proof');
  return { cardId: before.id, field, language: before.language, front: before.content.front,
    before: before[field], expected: after[field], beforeUpdated: before.lastUpdated,
    expectedUpdated: after.lastUpdated, expectedFingerprint: hashWordSync(JSON.stringify(after)),
    beforeOwner: before.scheduleActionOwners?.[field], expectedOwner, expectedGeneration: actionGeneration(after, field) };
}

export function flashcardActionUndoIsApplicable(store: FlashcardStore, undo: FlashcardActionUndo): boolean {
  const card = store.flashcards[undo.cardId];
  return !!card && card.id === undo.cardId && card.language === undo.language
    && card.content.front === undo.front && card[undo.field] === undo.expected
    && card.scheduleActionOwners?.[undo.field] === undo.expectedOwner
    && actionGeneration(card, undo.field) === undo.expectedGeneration;
}

/** Preserves current authored content, package metadata and later scheduling. */
export function restoreFlashcardAction(store: FlashcardStore, undo: FlashcardActionUndo): void {
  if (!flashcardActionUndoIsApplicable(store, undo)) throw new Error('The card changed before its manual action could be undone');
  const card = store.flashcards[undo.cardId];
  const ownsTimestamp = card.lastUpdated === undo.expectedUpdated
    && hashWordSync(JSON.stringify(card)) === undo.expectedFingerprint;
  if (undo.before === undefined) delete card[undo.field];
  else card[undo.field] = undo.before;
  if (undo.beforeOwner) card.scheduleActionOwners = { ...card.scheduleActionOwners, [undo.field]: undo.beforeOwner };
  else clearFlashcardActionOwner(card, undo.field);
  if (ownsTimestamp) card.lastUpdated = undo.beforeUpdated;
}
