/**
 * The flashcard store's write-revision contract.
 *
 * The store is whole-snapshot and every window writes all of it, so the
 * authority stamps each persisted store with a monotonic `rev` and refuses any
 * write that does not carry the revision it currently holds. That refusal is a
 * normal outcome of ordinary use - several windows are open at once and each
 * decides independently - and it is the one failure a client can repair by
 * itself: re-read the store the authority holds, replay the decision it was
 * making, and write again.
 *
 * Every other failure (a full disk, a torn write, an interrupted process) means
 * the write did not happen, and re-reading tells the client nothing. Treating
 * those as refusals would spin on a failure no amount of retrying will fix.
 *
 * The message is the whole signal. A thrown Error crossing the IPC boundary
 * keeps its message and loses every other property, so both ends have to agree
 * on the text. Keep them in step.
 */

const STALE_PREFIX = 'Stale flashcard store revision:';

/** Builds the refusal message the authority answers a stale write with. */
export function staleFlashcardRevisionMessage(expected: number, received: number): string {
  return `${STALE_PREFIX} expected ${expected}, received ${received}`;
}

/**
 * Whether a failed flashcard write was refused for carrying a revision the
 * authority has already moved past - and can therefore be rebased and retried.
 *
 * A refusal raised in the main process does not arrive with its message
 * intact: crossing the IPC boundary wraps it as
 * "Error invoking remote method 'save-flashcards': Error: <message>". Matching
 * only the start of the message therefore never recognizes a real refusal, and
 * a repairable write gets reported as a failure instead of being rebased and
 * retried. The message has to be found anywhere in the text.
 */
export function isStaleFlashcardRevision(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return message.includes(STALE_PREFIX);
}
