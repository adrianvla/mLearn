/**
 * One decision for "ignoring a word that owns flashcards".
 *
 * Ignoring a word is not a flag: `ignoreWordForLanguage` walks the word's
 * cards and removes each one, discarding the sentences, images and audio they
 * were built from. None of it can be put back. The control that triggers it
 * looks like a grey "Ignore" pill next to the word, sitting beside an "Add
 * card" control for the very same word — so whether pressing it destroyed work
 * depended on nothing the learner could see.
 *
 * Observed in the running app: the Suggested list's "Ignore" button removed a
 * real flashcard for that word and closed over it, 451 -> 450, with no dialog
 * and no way back. The same word reached from Browse offered an explicit
 * Delete behind a dialog. Two surfaces, one word, one of them silently
 * destructive.
 *
 * So the confirmation is decided here rather than at each call site, and it
 * keys off the one thing that actually determines the outcome: whether the
 * word currently owns cards. Ignoring a word with no cards destroys nothing,
 * so it stays a one-click action and the ordinary sidebar flow does not become
 * a wall of dialogs.
 *
 * This is deliberately the same owner as the direct Delete prompt
 * (`bulkDestructiveConfirm`): the act being confirmed is the same act, so the
 * wording is the same wording.
 */

import { buildDestructiveConfirmOptions, type DestructiveConfirmOptions } from './bulkDestructiveConfirm';

type TranslateKey = (key: string, params?: Record<string, string>) => string;

/**
 * How many cards ignoring `word` is about to destroy. Ignored words with no
 * cards destroy nothing, so the count is what the learner would actually lose.
 */
export function cardsDestroyedByIgnoring(cardCount: number): number {
  return Math.max(0, cardCount);
}

/**
 * Whether the learner must be asked first.
 *
 * False only when the word owns no cards, because then the ignore is a
 * reversible exclusion mark rather than a deletion.
 */
export function requiresIgnoreConfirmation(cardCount: number): boolean {
  return cardsDestroyedByIgnoring(cardCount) > 0;
}

/**
 * The prompt for an ignore that will take cards with it.
 *
 * Delegates to the delete owner rather than restating its keys. The cards being
 * destroyed are ordinary flashcards and the learner is being asked the same
 * question — do you really want to delete this flashcard, and it cannot be
 * undone — so a second vocabulary for it would only hide that this is the same
 * irreversible risk. Delegating rather than copying is what keeps them equal:
 * there is only one set of keys to get wrong.
 */
export function buildIgnoreConfirmOptions(t: TranslateKey): DestructiveConfirmOptions {
  return buildDestructiveConfirmOptions({
    count: 1,
    titleKey: 'mlearn.Flashcards.Modals.DeleteCard.Title',
    messageKey: 'mlearn.Flashcards.Modals.DeleteCard.Confirm',
  }, t);
}
