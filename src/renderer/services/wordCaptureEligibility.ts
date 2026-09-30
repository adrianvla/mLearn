/**
 * One answer to "may this word captured while reading or watching become a
 * flashcard?", for every surface that can capture one.
 *
 * Capturing a word is the same operation in four places - the reader sidebar,
 * the video sidebar, the floating overlay sidebar, and the hover popover over
 * a subtitle or page - and it is the same question each time: this word is
 * already a card, or the learner has excluded it, so adding it would either
 * duplicate a card or resurrect something they deliberately removed.
 *
 * That rule had four owners and they had already drifted:
 *
 *   - `UnknownWordsSidebar` filtered *what it offers* with
 *     `getCardByWordSync || excluded`, computing `excluded` itself from the
 *     canonical resolver's `excluded` flag.
 *   - `ReaderRoute` filtered the same list a second time inside its own
 *     `handleAddSidebarWord` and a third time as `bulkAddWords`' `skip`
 *     callback - the one caller of the three that passed `skip` at all.
 *   - `VideoRoute` and the overlay each passed no `skip` to `bulkAddWords`, so
 *     the "Add All" path there re-created cards for words that had become known
 *     or excluded since the sidebar list was built.
 *
 * The consequence is visible: the same word is offered in the reader's list and
 * not in the video's, and a bulk add in one route creates a duplicate card that
 * the other route would have refused. The list the user picks from and the
 * guard that runs when they pick are separate code, which is the shape that let
 * them disagree.
 *
 * This module owns the rule as data plus a predicate, so a surface states its
 * own facts and the decision is made once:
 *
 *   - `isCapturedWordEligible` is the canonical predicate.
 *   - `resolveCapturedWordEligibility` applies it for one word, so callers do
 *     not each re-derive "card OR excluded" from context methods.
 *
 * The distinction between *why* a word is ineligible is preserved rather than
 * flattened, because the surfaces present it differently: a word that is
 * already a card is not offered at all, whereas an excluded word is shown and
 * its add control is disabled, so the learner can see why it is there.
 */
/** What a surface knows about a captured word, without deciding anything. */
export interface CapturedWordFacts {
  /** The word as the learner met it, used to look the card up. */
  word: string;
  /** The language the capture belongs to. Ignored and card state are per-language. */
  language: string;
  /** True when a card already exists for this word in this language. */
  hasCard: boolean;
  /**
   * True when the learner has excluded this word from being tracked.
   *
   * This is the canonical resolver's `excluded` flag, which folds in every
   * form of the word. It is deliberately *not* "is known": knowledge is a fact
   * about the learner, exclusion is a policy about what may be captured, and a
   * word can be known and still captureable (a card may not exist for it yet).
   */
  excluded: boolean;
}

/** Why a captured word cannot become a card, or `null` when it can. */
export type CapturedWordIneligibility = 'already-a-card' | 'excluded';

export interface CapturedWordEligibility {
  eligible: boolean;
  reason: CapturedWordIneligibility | null;
}

/**
 * The canonical rule, over facts rather than over the store.
 *
 * Kept free of context and bridge imports so it can be checked directly: the
 * only question is whether the rule and the surfaces that depend on it can
 * drift, and a pure function is the part that cannot.
 *
 * The order matters only in that a word which is both excluded and already a
 * card is reported as the card, because that is the fact the learner can act on
 * - the word is in their collection already.
 */
export function isCapturedWordEligible(facts: CapturedWordFacts): CapturedWordEligibility {
  if (facts.hasCard) {
    return { eligible: false, reason: 'already-a-card' };
  }
  if (facts.excluded) {
    return { eligible: false, reason: 'excluded' };
  }
  return { eligible: true, reason: null };
}

/** Whether a captured word may become a card, for use as a `bulkAddWords` skip. */
export function isCapturedWordIneligible(facts: CapturedWordFacts): boolean {
  return !isCapturedWordEligible(facts).eligible;
}

/**
 * Read the facts for one word out of the store and apply the canonical rule.
 *
 * The two lookups are passed in rather than imported so that the surfaces keep
 * owning *where* the truth comes from, while this module keeps owning what it
 * means. Every surface resolves the same two facts, so passing them in is
 * honest; re-deriving the decision from them is not.
 */
export function resolveCapturedWordEligibility(
  word: string,
  language: string,
  hasCard: boolean,
  excluded: boolean,
): CapturedWordEligibility {
  return isCapturedWordEligible({ word, language, hasCard, excluded });
}
