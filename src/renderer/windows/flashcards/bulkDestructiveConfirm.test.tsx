// @vitest-environment happy-dom

/**
 * Deleting flashcards is not undoable, and the bulk bar and the single-row
 * action are the same user intent at two scales. Only the row action asked.
 *
 * Observed in the running app, before this was fixed:
 *   - Browse:      select all 449 cards -> Delete selected -> 449 gone, no dialog.
 *   - Suggested:   select all 30 -> Delete selected -> 30 gone, no dialog.
 *   - Browse row:  Delete on one card -> confirm dialog.
 *
 * So "are you sure" was a property of having exactly one card selected rather
 * than of the action being destructive. These tests pin the shared decision so
 * a third bulk bar cannot quietly opt out again.
 */

import { describe, expect, it } from 'vitest';
import { buildDestructiveConfirmOptions, requiresDestructiveConfirmation } from './bulkDestructiveConfirm';

/** Stands in for the localization context's `t`. */
const t = (key: string, params?: Record<string, string>) =>
  params ? `${key}:${params.count}` : key;

describe('destructive bulk actions', () => {
  it('asks for any selection, including a single one', () => {
    expect(requiresDestructiveConfirmation(1)).toBe(true);
    expect(requiresDestructiveConfirmation(2)).toBe(true);
    expect(requiresDestructiveConfirmation(449)).toBe(true);
  });

  it('has nothing to confirm with an empty selection', () => {
    expect(requiresDestructiveConfirmation(0)).toBe(false);
  });

  it('builds one prompt shape, with the count the learner is about to lose', () => {
    expect(buildDestructiveConfirmOptions({
      count: 449,
      titleKey: 'title',
      messageKey: 'message',
    }, t)).toEqual({ variant: 'danger', title: 'title', message: 'message:449' });
  });

  it('lets each surface name its own subject instead of sharing one noun', () => {
    // Browse removes flashcards, Suggested removes suggestions. Sharing a
    // single message would make one of the two prompts lie about what is going.
    const flashcards = buildDestructiveConfirmOptions({ count: 2, titleKey: 'title', messageKey: 'card' }, t);
    const suggestions = buildDestructiveConfirmOptions({ count: 2, titleKey: 'title', messageKey: 'suggestion' }, t);
    expect(flashcards.message).not.toBe(suggestions.message);
  });

  it('never treats a large selection as safe enough to skip the prompt', () => {
    // A count high enough to hurt is exactly the case that needs a prompt, not
    // one that may skip it. The threshold is not a safety valve.
    for (const count of [10, 100, 1000, 100_000]) {
      expect(requiresDestructiveConfirmation(count)).toBe(true);
    }
  });
});

/*
 * The behaviour that matters — that the dialog is really in the way — is covered
 * against the rendered components, where it can fail:
 *   - `flashcardsSuggestedSelection.test.tsx` renders the real Suggested surface.
 *   - `browseBulkDelete.test.tsx` renders the real Browse surface.
 * Both were checked by reverting the confirmation and watching them fail.
 *
 * A source-grep guard for Browse was tried here and removed: it passed against
 * an implementation that consulted the helper and then deleted anyway, so it
 * asserted the import rather than the behaviour.
 */
