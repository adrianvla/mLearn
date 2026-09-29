/**
 * Bounded undo history for study surfaces.
 *
 * Every surface that lets a learner take back a rating keeps a stack of
 * previous states. The entries differ per domain (a flashcard rating and a
 * word-sync rating retract different things), but the retention policy is one
 * decision: keep a fixed window of recent history and drop the oldest beyond
 * it, so undo depth does not grow with session length.
 */

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
