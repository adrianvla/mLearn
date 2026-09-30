/**
 * The one "Add All" behaviour every unknown-words sidebar performs.
 *
 * "Add All" is not `for (word of words) add(word)` that happens to live in
 * three files. It is a five-part behaviour with a specific shape:
 *
 *   1. refuse to re-enter while a run is in flight, and refuse an empty run;
 *   2. mark the run in flight so every surface in step 1 agrees;
 *   3. capture each entry independently, skipping the ones that are no longer
 *      allowed to become a card, and keep going after a failure rather than
 *      abandoning the rest;
 *   4. clear the in-flight mark however the run ends;
 *   5. report the run as a batch - one announcement naming how many failed -
 *      instead of one per word.
 *
 * Steps 3 and 5 are the parts that were decided separately per surface.
 * `ReaderRoute`, `VideoRoute` and the floating overlay each carried the same
 * twenty lines, character for character apart from the name of their
 * eligibility predicate, and the three had not been edited together: the video
 * and overlay copies predated the reader's fix for swallowed errors, so their
 * `if (failed > 0)` branches were unreachable and a bulk add through either of
 * them had always been silent about failing. Keeping three copies of a step
 * that has already been proven to drift is not a de-duplication opportunity,
 * it is a loop that re-opens the same bug.
 *
 * So the whole behaviour lives here and each surface supplies only what it
 * knows: how to capture one entry, whether that entry is still allowed, how to
 * mark the run in flight, and how to log. None of that is language-specific,
 * so none of it belongs to a surface.
 *
 * The eligibility predicate is passed in rather than imported because it is
 * already owned once, in `wordCaptureEligibility`; this module calls it and
 * does not restate it. A caller that omits `isEligible` captures every entry it
 * was handed, which is only correct for a caller whose list is already
 * filtered - the batch then has no opinion of its own about what is allowed.
 */

import { bulkAddWords } from '../utils/bulkAddWords';
import { reportCaptureBatchFailure, type Translate } from './wordCaptureFailure';

export interface AddAllCapturedWordsOptions<E> {
  /** The entries the learner confirmed, in the order they were offered. */
  entries: readonly E[];
  /** Capture one entry. Rejecting is how an entry reports that it failed. */
  addFlashcard: (entry: E) => Promise<void>;
  /**
   * Whether this entry may still become a card, evaluated at capture time
   * rather than when the list was built.
   */
  isEligible?: (entry: E) => boolean;
  /** Marks the run in flight. Must be cleared when the run settles. */
  setInFlight: (inFlight: boolean) => void;
  /** Whether a run is already in flight; the reason this cannot re-enter. */
  isInFlight: () => boolean;
  /** How the run is described to the learner when part of it failed. */
  translate: Translate;
  /** Optional per-entry log sink, so a surface keeps its own logger name. */
  logEntryError?: (entry: E, error: unknown) => void;
  /** Optional batch log sink for the failure summary. */
  logBatchError?: (message: string, error: unknown) => void;
}

/**
 * The word a batch is reported against, for the per-entry log line only.
 *
 * Batch reporting deliberately names a count and not a word, because a learner
 * cannot act on which of twenty captures it was. The log is the opposite: it
 * exists so the word that actually failed is recoverable after the fact, so it
 * needs the word, and every surface's entry carries one at `.word`.
 */
function entryWord(entry: unknown): string | undefined {
  const word = (entry as { word?: unknown } | null | undefined)?.word;
  return typeof word === 'string' ? word : undefined;
}

export async function addAllCapturedWords<E>(options: AddAllCapturedWordsOptions<E>): Promise<void> {
  const { entries, addFlashcard, isEligible, setInFlight, isInFlight, translate } = options;

  // Re-entering would capture the same words twice. The disabled Add All
  // button is what actually stops a learner reaching this, so this guard is
  // defence in depth for any caller that is not that button.
  if (isInFlight() || entries.length === 0) {
    return;
  }

  setInFlight(true);
  let failed = 0;
  let firstError: unknown;
  try {
    await bulkAddWords({
      entries,
      addFlashcard,
      // Re-checked per entry, not once for the batch: a word can become a card
      // or get excluded while the run is still capturing the ones before it.
      skip: isEligible ? (entry) => !isEligible(entry) : undefined,
      onEntryError: (entry, err) => {
        failed += 1;
        firstError ??= err;
        if (options.logEntryError) {
          options.logEntryError(entry, err);
        } else {
          // eslint-disable-next-line no-console
          console.error(`Failed to add flashcard for "${entryWord(entry) ?? 'unknown'}":`, err);
        }
      },
    });
  } finally {
    // Cleared in a `finally` so an unwind from anywhere in the run - most
    // realistically a throwing eligibility re-check, which `bulkAddWords`
    // calls outside its own try - does not leave the sidebar stuck mid-add.
    // A sidebar holding this mark can never be re-entered, so the mark being
    // left behind is a permanent wedge, not a cosmetic one.
    setInFlight(false);
  }

  // One toast for the batch rather than one per failed word: a bulk add that
  // fails for one reason fails for all of them, and a learner cannot act on
  // which of twenty words it was.
  if (failed > 0) {
    reportCaptureBatchFailure(firstError, failed, {
      translate,
      log: options.logBatchError,
    });
  }
}
