/**
 * Bounded undo history for study surfaces.
 *
 * Every surface that lets a learner take back a rating keeps a stack of
 * previous states. The entries differ per domain (a flashcard rating and a
 * word-sync rating retract different things), but the retention policy is one
 * decision: keep a fixed window of recent history and drop the oldest beyond
 * it, so undo depth does not grow with session length.
 */

import type { StudySessionWriteStatus } from './studySession';

/** How many undoable actions a study surface remembers. */
export const MAX_UNDO_STACK_SIZE = 50;

/**
 * Appends an entry, dropping the oldest once the window is full.
 * Returns a new array; the input is not mutated.
 */
export function pushUndo<T>(stack: readonly T[], entry: T): T[] {
  const next = [...stack, entry];
  return next.length > MAX_UNDO_STACK_SIZE ? next.slice(next.length - MAX_UNDO_STACK_SIZE) : next;
}

/**
 * Undo is itself a durable write: taking a rating back appends a retraction to
 * the same knowledge journal, and that append can be refused exactly like a
 * rating append. It is therefore a *study write* and must be reported as one.
 *
 * The two study surfaces that offer undo previously disagreed about this:
 * flashcard review surfaced a failed retraction and offered a retry, while
 * word sync swallowed the refusal entirely, leaving the learner with an undo
 * keystroke that silently did nothing. This module is the single owner of the
 * retraction write's state, so both surfaces report and retry it identically.
 *
 * The state deliberately matches the study-session write vocabulary — the
 * banner and the interaction guards are then one concept, not two.
 */
export type RetractionWriteState = StudySessionWriteStatus;

/**
 * Whether a retraction write in the given state should block study actions.
 *
 * A *pending* retraction is still rewriting the journal a rating is appending
 * to, so undo and rating must both wait. A *failed* one has already settled
 * (nothing is in flight), and leaving the surface locked would strand the
 * learner behind an error they can only clear by retrying — so it blocks
 * neither, and the banner's retry is the way forward.
 */
export function isRetractionWriteBlocking(state: RetractionWriteState): boolean {
  return state === 'pending';
}

/**
 * Whether a failed retraction is still worth retrying.
 *
 * Retries are safe by construction: the retraction reuses the same persisted
 * attempt ids, and the journal append is idempotent, so re-running a refused
 * retraction cannot double-apply it.
 */
export function canRetryRetraction(state: RetractionWriteState): boolean {
  return state === 'failed';
}
