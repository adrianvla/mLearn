/**
 * One decision, one prompt, for every surface that removes flashcards.
 *
 * Removing a flashcard discards the sentences, images and audio it was built
 * from, and nothing in the app can put them back. The single-row Delete asked;
 * the two bulk bars did not, so the prompt depended on how many cards happened
 * to be selected rather than on the action being irreversible.
 *
 * Observed in the running app before this existed:
 *   - Browse:     select all 449 -> Delete selected -> 449 gone, no dialog.
 *   - Suggested:  select all 30  -> Delete selected -> 30 gone, no dialog.
 *   - Browse row: Delete on one card -> dialog.
 *
 * Both bars route their decision through here, so "one" and "many" cannot
 * drift apart again. The count is part of the prompt because the same two
 * buttons mean very different things at one card and at four hundred.
 *
 * There is deliberately no size above which the prompt is skipped: a bigger
 * selection is a stronger reason to ask, not a weaker one.
 */

export type TranslateKey = (key: string, params?: Record<string, string>) => string;

export interface DestructiveConfirmOptions {
  variant: 'danger';
  title: string;
  message: string;
}

export interface DestructiveConfirmRequest {
  /** How many items the learner is about to lose. */
  count: number;
  /**
   * The key describing what is being removed, so each surface names its own
   * subject ("flashcard(s)" / "suggestion(s)") rather than sharing one noun
   * for two different objects.
   */
  messageKey: string;
  titleKey: string;
}

/**
 * Whether a destructive action over `selectionCount` items must be confirmed
 * before it runs. False only when there is nothing to destroy.
 */
export function requiresDestructiveConfirmation(selectionCount: number): boolean {
  return selectionCount > 0;
}

/**
 * The prompt both bulk bars show, built from the count the learner is about to
 * lose. Kept next to `requiresDestructiveConfirmation` so the two cannot
 * disagree about what is being confirmed.
 */
export function buildDestructiveConfirmOptions(
  request: DestructiveConfirmRequest,
  t: TranslateKey,
): DestructiveConfirmOptions {
  return {
    variant: 'danger',
    title: t(request.titleKey),
    message: t(request.messageKey, { count: String(request.count) }),
  };
}
