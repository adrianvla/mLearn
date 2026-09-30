/**
 * One decision, one prompt, for the Generate tab's two bulk actions.
 *
 * The tab offers one "Generation mode" picker and two buttons underneath it:
 * Generate TTS and Generate Examples. Both read the same picker, and the two
 * are not the same kind of act, which is the whole problem this file exists to
 * resolve.
 *
 * Observed in the running app before this existed:
 *   - Selecting "Regenerate all (replace existing)" and pressing Generate
 *     Examples starts rewriting every card immediately. Nothing is asked, and
 *     the button is labelled only "Generate Examples" — the same label as the
 *     safe mode sitting behind the very same picker.
 *   - The blast radius was 448 of 449 cards in a real profile, all of which
 *     already had an example and 447 of which also had a meaning.
 *   - The picker also offers "Regenerate older than date", and for Examples
 *     that option did nothing at all: the date input appeared, the policy only
 *     ever branched on "replaceAll", so the run silently fell back to
 *     "only empty" while the screen claimed a date filter.
 *   - The section copy said "for cards without examples" no matter which mode
 *     was selected, describing the mode the learner had just turned off.
 *
 * The reason this is destructive and not merely wasteful: an example is
 * authored content. The card editor exposes the example and its meaning as
 * editable rich text, and the store records which fields a learner touched in
 * `userEditedFields`. In a real profile nine cards had a hand-edited
 * `exampleMeaning`, and this path would have overwritten all nine.
 *
 * So the rule is decided here rather than in the handlers:
 *
 *   - a mode that replaces existing content is asked about, and the prompt
 *     names the count, because the same button means very different things at
 *     one card and at four hundred;
 *   - the two buttons declare their own subject (audio vs. example sentences),
 *     so the prompt says which one is about to be thrown away;
 *   - TTS is regenerable from the text it was made from and is not gated,
 *     which is a real difference and not an oversight;
 *   - `onlyEmpty` never overwrites anything, so it stays one click.
 *
 * The count is derived, not passed in, so a caller cannot show a prompt about
 * a different number of cards than the ones it is about to rewrite.
 */

import type { Flashcard } from '../../../shared/types';
import { buildDestructiveConfirmOptions, type DestructiveConfirmOptions } from './bulkDestructiveConfirm';

type TranslateKey = (key: string, params?: Record<string, string>) => string;

/**
 * The mode picker shared by both bulk buttons.
 *
 * `olderThan` is honoured only where a generation timestamp exists to compare
 * against. TTS records one per field in its metadata; examples are plain
 * card content with no generation stamp, so the option is not offered for them
 * rather than offered and ignored.
 */
export type BulkGenerationMode = 'onlyEmpty' | 'replaceAll' | 'olderThan';

/** What a bulk button is about to write. Decides how the prompt reads. */
export type BulkGenerationSubject = 'examples' | 'tts';

/** The modes that make sense for one subject. */
export type BulkGenerationModeFor<S extends BulkGenerationSubject> = S extends 'tts'
  ? BulkGenerationMode
  : 'onlyEmpty' | 'replaceAll';

export interface BulkGenerationRequest<S extends BulkGenerationSubject> {
  subject: S;
  mode: BulkGenerationModeFor<S>;
  /** The cards this run would write to, as the surface already selected them. */
  cards: readonly Flashcard[];
}

export interface BulkGenerationPlan<S extends BulkGenerationSubject> {
  subject: S;
  mode: BulkGenerationModeFor<S>;
  /** The cards the run will actually write. */
  cards: Flashcard[];
  /** Whether the learner must be asked first. */
  requiresConfirmation: boolean;
  /** Present only when `requiresConfirmation` is true. */
  confirmOptions?: DestructiveConfirmOptions;
}

/**
 * Whether a mode discards content that already exists.
 *
 * `onlyEmpty` is the only mode that cannot: it selects cards with nothing to
 * lose, so it never prompts.
 */
function overwritesExistingContent(mode: BulkGenerationMode): boolean {
  return mode === 'replaceAll';
}

export function planBulkGeneration<S extends BulkGenerationSubject>(
  request: BulkGenerationRequest<S>,
  t: TranslateKey,
): BulkGenerationPlan<S> {
  const { subject, mode, cards } = request;
  const selected = [...cards];
  const overwrites = overwritesExistingContent(mode);

  // A replace run that would land on nothing is not destructive, so it is not
  // worth a prompt. The only way that happens is an empty selection.
  if (!overwrites || selected.length === 0) {
    return { subject, mode, cards: selected, requiresConfirmation: false };
  }

  return {
    subject,
    mode,
    cards: selected,
    requiresConfirmation: true,
    confirmOptions: buildDestructiveConfirmOptions({
      count: selected.length,
      titleKey: 'mlearn.Flashcards.Bulk.ReplaceAllTitle',
      messageKey: subject === 'examples'
        ? 'mlearn.Flashcards.Bulk.ReplaceAllExamplesConfirm'
        : 'mlearn.Flashcards.Bulk.ReplaceAllTtsConfirm',
      // Not a removal: the run throws the old content away in order to write a
      // replacement, so the button that goes ahead says so. Left to the
      // dialog's default it would read "Delete".
      confirmTextKey: 'mlearn.Flashcards.Bulk.ReplaceAllConfirmAction',
    }, t),
  };
}
