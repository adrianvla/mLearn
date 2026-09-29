/**
 * The one "ignore this word" behaviour every surface performs.
 *
 * Ignoring a word is not a mute. `ignoreWordForLanguage` walks the word's cards
 * and removes each one, discarding the sentences, images and audio they were
 * built from. The control that triggers it is a grey "Ignore" pill sitting one
 * button away from "Add card" for the very same word, so the button's label was
 * the only hint about what pressing it would do — and it hinted at nothing.
 *
 * Observed in the running app: the Suggested list's "Ignore" button removed a
 * real flashcard for that word and reported success, 451 -> 450, with no dialog
 * and nothing to undo. The reader, video and overlay sidebars all reached the
 * same hidden deletion through their own copy of a one-line handler, and none
 * of them asked.
 *
 * So the handler lives here once. Each surface supplies only what it knows —
 * how many cards the word owns, how to ask, and which locale to ask in — and
 * the decision cannot be re-implemented per surface and quietly drift back to
 * deleting without asking.
 */

import { buildIgnoreConfirmOptions, requiresIgnoreConfirmation } from './ignoreDestroysCards';

type TranslateKey = (key: string, params?: Record<string, string>) => string;

export interface IgnoreWordRequest {
  word: string;
  reading?: string;
  language: string;
}

export interface IgnoreWordDeps {
  /** How many flashcards the word currently owns; ignored words own none. */
  getCardCount: (word: string, language: string) => number;
  /** The underlying store operation. Runs only once the learner agrees. */
  ignoreWordForLanguage: (word: string, reading?: string, language?: string) => Promise<void>;
  showConfirm: (options: { variant: 'danger'; title: string; message: string }) => Promise<boolean>;
  t: TranslateKey;
}

/**
 * Ignore a word, asking first when that will take flashcards with it.
 *
 * Resolves to whether the word was actually ignored, so a caller that retires
 * a suggestion only does so once the exclusion was really applied.
 */
export async function ignoreWordWithConfirmation(
  request: IgnoreWordRequest,
  deps: IgnoreWordDeps,
): Promise<boolean> {
  const { word, reading, language } = request;

  // Nothing is destroyed unless the word owns cards, so the ordinary sidebar
  // flow stays one click and only the genuinely lossy case is interrupted.
  if (requiresIgnoreConfirmation(deps.getCardCount(word, language))) {
    const confirmed = await deps.showConfirm(buildIgnoreConfirmOptions(deps.t));
    if (!confirmed) return false;
  }

  await deps.ignoreWordForLanguage(word, reading, language);
  return true;
}
