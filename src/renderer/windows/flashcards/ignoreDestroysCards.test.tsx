// @vitest-environment happy-dom

/**
 * Ignoring a word deletes the flashcards built from it. The control that does
 * it looked like a mute, and sat one button away from "Add card" for the very
 * same word.
 *
 * Observed in the running app, before this was fixed: the Suggested list's
 * "Ignore" button removed a real flashcard for that word and reported success,
 * 451 -> 450, with no dialog and nothing to undo. Reached from Browse, the
 * same word had an explicit Delete behind a prompt. Whether pressing "Ignore"
 * destroyed the learner's work depended on which surface they were standing in.
 *
 * These tests pin the shared decision. The prompt is keyed off "does this word
 * own cards", not off which surface asked, so a new caller cannot inherit the
 * silent behaviour by accident, and a word with no cards stays one-click.
 */

import { describe, expect, it } from 'vitest';
import {
  buildIgnoreConfirmOptions,
  cardsDestroyedByIgnoring,
  requiresIgnoreConfirmation,
} from './ignoreDestroysCards';
import { buildDestructiveConfirmOptions } from './bulkDestructiveConfirm';

/** Stands in for the localization context's `t`. */
const t = (key: string, params?: Record<string, string>) =>
  params ? `${key}:${params.count}` : key;

describe('ignoring a word that owns flashcards', () => {
  it('asks before taking cards with it', () => {
    expect(requiresIgnoreConfirmation(1)).toBe(true);
    expect(requiresIgnoreConfirmation(4)).toBe(true);
  });

  it('stays one-click when the word owns nothing to lose', () => {
    // The sidebar "Ignore" is the ordinary way to stop a word coming back, and
    // most words in it have no card. A prompt there would be pure friction.
    expect(requiresIgnoreConfirmation(0)).toBe(false);
  });

  it('reports the loss as the number of cards actually destroyed', () => {
    expect(cardsDestroyedByIgnoring(3)).toBe(3);
    expect(cardsDestroyedByIgnoring(0)).toBe(0);
    expect(cardsDestroyedByIgnoring(-1)).toBe(0);
  });

  it('asks the same question, in the same words, as a direct delete', () => {
    // The cards destroyed are ordinary flashcards and cannot be recovered, so
    // a second vocabulary for "ignore" would only disguise that this is the
    // same irreversible act as Delete.
    const viaIgnore = buildIgnoreConfirmOptions(t);
    const viaDelete = buildDestructiveConfirmOptions({
      count: 1,
      titleKey: 'mlearn.Flashcards.Modals.DeleteCard.Title',
      messageKey: 'mlearn.Flashcards.Modals.DeleteCard.Confirm',
    }, t);

    expect(viaIgnore).toEqual(viaDelete);
    expect(viaIgnore.variant).toBe('danger');
  });

  it('never treats many cards as safe enough to skip the prompt', () => {
    for (const count of [10, 100, 1000, 100_000]) {
      expect(requiresIgnoreConfirmation(count)).toBe(true);
    }
  });
});

/*
 * The behaviour that matters — that the dialog is really in the way, and that
 * declining it really keeps the card — is covered against the rendered
 * surfaces, where it can fail:
 *   - `ignoreConfirmation.test.tsx` renders the real Suggested surface.
 *   - `flashcardIgnoreSidebar.test.tsx` renders the real sidebar handler.
 * Both were checked by reverting the confirmation and watching them fail.
 *
 * A source-grep guard for the Reader/Video/overlay routes was tried here and
 * removed: it passed against an implementation that consulted the helper and
 * then ignored anyway, so it asserted the import rather than the behaviour.
 */
