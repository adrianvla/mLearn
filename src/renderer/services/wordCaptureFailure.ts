/**
 * One answer to "the card could not be made", for every surface that captures
 * a word.
 *
 * Adding a word to the deck is one product action with six entry points: the
 * subtitle hover, the word definition popup, the reader sidebar, the video
 * sidebar, the floating overlay, and the vocabulary browser. Each of them runs
 * its own build pipeline - translation lookup, OCR crop, video clip, frame
 * capture - before handing the result to the shared store, so each of them can
 * fail in its own way. What the learner should be told about that failure was
 * decided independently six times, and the six decisions had already drifted
 * apart:
 *
 *   - the subtitle hover and the word definition popup toasted
 *     `Failed to add flashcard: {error}`, with the raw error interpolated;
 *   - the reader, video and overlay sidebars toasted the much terser
 *     `Failed to add flashcard`, from a different namespace, with no detail;
 *   - the video sidebar and the overlay swallowed the failure entirely -
 *     logging it and returning, so a word that never became a card left no
 *     trace on screen at all;
 *   - the vocabulary browser swallowed it too, and its row simply returned to
 *     offering "Add mLearn card" as though nothing had happened.
 *
 * The consequence is that "did my card get saved?" has a different answer on
 * every surface, and on two of them the answer is no answer at all. The learner
 * retries, the retry looks like it worked, and the deck is silently short a
 * card they believe they added.
 *
 * Two of those six also made their own per-word in-flight guard, and the video
 * and overlay guards were unreachable: `bulkAddWords` funnels a per-entry
 * rejection into its `onEntryError` callback and continues to the next entry,
 * but the sidebar add functions those callbacks call already caught and
 * swallowed their own errors, so `bulkAddWords` could never observe a rejection.
 * The error-reporting branches that were supposed to keep a bulk add honest
 * were dead code, which is why a bulk add through either video surface has
 * always been silent.
 *
 * This module owns the reporting decision, so a surface states only what it
 * knows - which word failed, and why - and the same failure is announced the
 * same way everywhere:
 *
 *   - `reportCaptureFailure` is the single announcement, and every surface
 *     routes its catch block through it rather than deciding on its own.
 *   - it returns whether the failure was reported, so a bulk caller that also
 *     owns an announcement (one toast per batch) can decline to double-report
 *     a failure it is about to describe itself.
 *
 * The detail is included because the terser wording is strictly less useful:
 * a learner looking at an empty deck slot cannot act on "it failed", but the
 * underlying cause (an unreachable backend, a refused write) tells them whether
 * retrying can help. The wording is owned here rather than borrowed from a
 * surface, so the message is not renamed when one of them is refactored.
 */
import { showToast } from '../components/common/Feedback/Toast';

export type Translate = (path: string, params?: Record<string, string | number>) => string;

/**
 * How much of the failure a surface is able to say.
 *
 * A bulk surface reports the batch as a whole, so naming one of many words
 * would misattribute a failure that the learner cannot act on per-word; it
 * names the count instead. A single capture names the word, because that is the
 * row the learner is looking at.
 */
export interface CaptureFailureContext {
  /** The word being captured, when a single capture failed. */
  word?: string;
  /** How many captures the surrounding operation covers, for a bulk report. */
  batchSize?: number;
}

export interface CaptureFailureReporter {
  translate: Translate;
  /** Optional log sink, so a surface can keep its own logger name. */
  log?: (message: string, error: unknown) => void;
}

/** Whether a caught value is worth showing a learner, as opposed to an abort. */
function isReportableFailure(error: unknown): boolean {
  if (error === null || error === undefined) return false;
  if (typeof error === 'object' && 'name' in error) {
    // A cancelled operation is the learner's own doing; a dialog closing or a
    // pending request being superseded is not a failure to announce.
    return (error as { name?: unknown }).name !== 'AbortError';
  }
  return true;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Announce a failed capture, once, in the learner's terms.
 *
 * A surface that captured one word names it, because that is the row the
 * learner is looking at. A surface running a batch names the batch size
 * instead: it usually cannot attribute the failure to one entry, and a toast
 * per failed word would bury the one the learner needs to read.
 *
 * Returns true when a toast was shown. A bulk caller whose `onEntryError`
 * already describes the batch uses the return value to avoid stacking one
 * toast per failed word on top of its own summary.
 */
export function reportCaptureFailure(
  error: unknown,
  context: CaptureFailureContext,
  reporter: CaptureFailureReporter,
): boolean {
  const { translate: t, log: logSink } = reporter;
  logSink?.('Failed to add flashcard:', error);

  if (!isReportableFailure(error)) return false;

  const params = { error: describeError(error) };
  const message = context.word
    ? t('mlearn.WordHover.Errors.FailedToAddFlashcardForWord', { ...params, word: context.word })
    : t('mlearn.WordHover.Errors.FailedToAddFlashcards', {
        ...params,
        count: context.batchSize ?? 1,
      });

  showToast({ message, variant: 'error' });
  return true;
}

/**
 * Describe a batch that contained at least one failed capture.
 *
 * Separate from `reportCaptureFailure` because a bulk surface runs
 * `bulkAddWords`, which reports each entry through `onEntryError` and keeps
 * going. A caller that wants one summary for the batch declines the per-entry
 * toast and calls this once at the end, so the learner is told how many failed
 * instead of how many times.
 */
export function reportCaptureBatchFailure(
  error: unknown,
  failedCount: number,
  reporter: CaptureFailureReporter,
): boolean {
  const { translate: t, log: logSink } = reporter;
  logSink?.('Some captures failed:', error);
  showToast({
    message: t('mlearn.WordHover.Errors.FailedToAddFlashcards', {
      error: describeError(error),
      count: failedCount,
    }),
    variant: 'error',
  });
  return true;
}
