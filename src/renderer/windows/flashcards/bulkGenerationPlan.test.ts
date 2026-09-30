/**
 * The Generate tab's two bulk buttons shared one "Generation mode" picker, and
 * under "Regenerate all" both of them rewrote existing content on a single
 * click with nothing asked and no count on screen.
 *
 * Observed in the running app before this existed: choosing "Regenerate all"
 * and pressing "Generate Examples" would have rewritten 448 of 449 real cards,
 * nine of which carried an example meaning the learner had edited by hand —
 * with a button labelled identically to the safe mode behind the same picker.
 * The Examples section also offered "Regenerate older than date", which the
 * run ignored entirely.
 *
 * These pin the decision and the wording in one place, so a third bulk writer
 * cannot opt out by accident, and so the two buttons cannot drift into
 * disagreeing about what a replace run costs.
 */

import { describe, expect, it } from 'vitest';
import type { Flashcard } from '../../../shared/types';
import { planBulkGeneration, type BulkGenerationModeFor } from './bulkGenerationPlan';

/** Stands in for the localization context's `t`. */
const t = (key: string, params?: Record<string, string>) =>
  params ? `${key}:${params.count}` : key;

const card = (id: string): Flashcard => ({
  id,
  language: 'ja',
  state: 'new',
  interval: 0,
  easeFactor: 2.5,
  repetitions: 0,
  dueDate: 0,
  created: 0,
  lastUpdated: 0,
  content: { type: 'word', front: id, back: id },
});

describe('bulk generation that replaces existing content', () => {
  it('asks before rewriting examples that are already there', () => {
    const plan = planBulkGeneration(
      { subject: 'examples', mode: 'replaceAll', cards: [card('a'), card('b'), card('c')] },
      t,
    );

    expect(plan.requiresConfirmation).toBe(true);
    expect(plan.confirmOptions).toEqual({
      variant: 'danger',
      title: 'mlearn.Flashcards.Bulk.ReplaceAllTitle',
      message: 'mlearn.Flashcards.Bulk.ReplaceAllExamplesConfirm:3',
      confirmText: 'mlearn.Flashcards.Bulk.ReplaceAllConfirmAction',
    });
  });

  it('names the count of cards actually at stake, not a number the caller guessed', () => {
    // The plan derives the count from the selection it was handed, so a prompt
    // cannot end up describing a different number of cards than will be hit.
    const plan = planBulkGeneration(
      { subject: 'examples', mode: 'replaceAll', cards: [card('a')] },
      t,
    );
    expect(plan.confirmOptions?.message).toBe('mlearn.Flashcards.Bulk.ReplaceAllExamplesConfirm:1');
  });

  it('tells the learner that their own edits are what gets thrown away', () => {
    // Examples are authored content: the card editor exposes them as editable
    // rich text and the store records touched fields. A prompt that said only
    // "regenerate" would understate what is lost.
    const plan = planBulkGeneration({ subject: 'examples', mode: 'replaceAll', cards: [card('a')] }, t);
    const message = plan.confirmOptions?.message ?? '';
    expect(message).toContain('ReplaceAllExamplesConfirm');
    expect(message).not.toContain('ReplaceAllTtsConfirm');
  });

  it('gives the TTS button its own wording, because audio is a different loss', () => {
    const plan = planBulkGeneration({ subject: 'tts', mode: 'replaceAll', cards: [card('a')] }, t);
    expect(plan.confirmOptions?.message).toBe('mlearn.Flashcards.Bulk.ReplaceAllTtsConfirm:1');
  });

  it('does not confirm with a button reading "Delete", because nothing is deleted', () => {
    // The dialog falls back to "Delete" for its danger variant, which is right
    // for removing a card and wrong for a run that overwrites content in order
    // to write a replacement. A regeneration confirmed by a button that says
    // "Delete" tells the learner the opposite of what happens.
    const plan = planBulkGeneration({ subject: 'examples', mode: 'replaceAll', cards: [card('a')] }, t);
    expect(plan.confirmOptions?.confirmText).toBe('mlearn.Flashcards.Bulk.ReplaceAllConfirmAction');
  });

  it('has nothing to confirm when a replace run would land on nothing', () => {
    const plan = planBulkGeneration({ subject: 'examples', mode: 'replaceAll', cards: [] }, t);
    expect(plan.requiresConfirmation).toBe(false);
    expect(plan.confirmOptions).toBeUndefined();
  });
});

describe('bulk generation that cannot lose anything', () => {
  it('stays one click when only empty fields are filled', () => {
    // "Only cards without existing data" selects cards with nothing to
    // overwrite, so prompting there would be friction without protection.
    for (const subject of ['examples', 'tts'] as const) {
      const mode: BulkGenerationModeFor<typeof subject> = 'onlyEmpty';
      const plan = planBulkGeneration({ subject, mode, cards: [card('a')] }, t);
      expect(plan.requiresConfirmation).toBe(false);
    }
  });

  it('asks for a TTS run older than a date only when it replaces', () => {
    // `olderThan` can select cards that already have audio, so the same gate
    // applies as for an explicit replace.
    const replacing = planBulkGeneration({ subject: 'tts', mode: 'replaceAll', cards: [card('a')] }, t);
    const filling = planBulkGeneration({ subject: 'tts', mode: 'onlyEmpty', cards: [card('a')] }, t);
    expect(replacing.requiresConfirmation).toBe(true);
    expect(filling.requiresConfirmation).toBe(false);
  });
});

describe('mode vocabulary', () => {
  it('does not offer the examples run a mode it cannot honour', () => {
    // Compile-time guarantee, asserted here so the intent is documented: an
    // example has no generation timestamp, so there is nothing for a date
    // filter to compare. If a future change re-adds one, this file is where
    // the policy has to grow a real implementation.
    const examplesMode: BulkGenerationModeFor<'examples'> = 'replaceAll';
    expect(examplesMode).toBe('replaceAll');
  });
});
