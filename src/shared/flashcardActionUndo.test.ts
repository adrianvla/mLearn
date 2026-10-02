import { describe, expect, it } from 'vitest';
import { captureFlashcardActionUndo, flashcardActionUndoIsApplicable, restoreFlashcardAction, setFlashcardExclusion, reconcileFlashcardActionOwners } from './flashcardActionUndo';
import type { Flashcard, FlashcardStore } from './types';

const card: Flashcard = { id: 'owned-action', language: 'unfamiliar-package',
  content: { type: 'word', front: 'cue', back: 'answer' }, state: 'review', ease: 2.5,
  interval: 5, dueDate: 10, reviews: 2, lapses: 0, learningStep: 0, createdAt: 1, lastReviewed: 0, lastUpdated: 2 };
const library = (value: Flashcard) => ({ flashcards: { [value.id]: value } }) as FlashcardStore;

describe('manual scheduling rollback ownership', () => {
  it.each(['buried', 'suspended'] as const)('serialized %s proof preserves later peer state and unfamiliar package metadata', field => {
    const after = { ...setFlashcardExclusion(card, field, true), lastUpdated: 3 };
    const undo = JSON.parse(JSON.stringify(captureFlashcardActionUndo(card, after, field)));
    const current = { ...after, reviews: 10, lastUpdated: 9, content: { ...after.content,
      back: 'peer answer', unfamiliar: { values: [null, { conditional: ['opaque'] }] } } };
    const store = library(current);
    const { scheduleActionOwners: _owners, ...preserved } = structuredClone(current);
    restoreFlashcardAction(store, undo);
    expect(store.flashcards[card.id]).toEqual({ ...preserved, [field]: undefined, scheduleActionGenerations: { [field]: 2 } });
    expect(Object.hasOwn(store.flashcards[card.id], field)).toBe(false);
    expect(store.flashcards[card.id].lastUpdated).toBe(9);
  });

  it('keeps a later authored timestamp even when two writes share the same millisecond', () => {
    const after = { ...setFlashcardExclusion(card, 'buried', true), lastUpdated: 3, content: { ...card.content } };
    const undo = captureFlashcardActionUndo(card, after, 'buried');
    const current = { ...after, content: { ...after.content, back: 'later same-millisecond edit' } };
    const store = library(current);
    restoreFlashcardAction(store, undo);
    expect(store.flashcards[card.id].lastUpdated).toBe(3);
    expect(store.flashcards[card.id].content.back).toBe('later same-millisecond edit');
  });

  it.each(['buried', 'suspended'] as const)('rejects an older %s Undo after Resume and a new exclusion', field => {
    const first = setFlashcardExclusion(card, field, true);
    const undo = captureFlashcardActionUndo(card, first, field);
    const resumed = setFlashcardExclusion(first, field, false);
    const replacement = setFlashcardExclusion(resumed, field, true);
    expect(flashcardActionUndoIsApplicable(library(replacement), undo)).toBe(false);
    expect(() => restoreFlashcardAction(library(replacement), undo)).toThrow('changed');
    expect(replacement[field]).toBe(true);
  });

  it('clears carried legacy owners on Resume while preserving unrelated future action owners', () => {
    const original = setFlashcardExclusion(card, 'buried', true);
    const resumed = { ...original, buried: false, scheduleActionOwners: { ...original.scheduleActionOwners, 'future-action': 'opaque-owner' } };
    reconcileFlashcardActionOwners(resumed, original);
    expect(resumed.scheduleActionOwners).toEqual({ 'future-action': 'opaque-owner' });
    const again = setFlashcardExclusion(resumed, 'buried', true);
    expect(again.scheduleActionOwners?.buried).not.toBe(original.scheduleActionOwners?.buried);
  });

  it('refuses a retired owner carried through cloned legacy Resume and reapply snapshots', () => {
    const first = setFlashcardExclusion(card, 'buried', true);
    const proof = captureFlashcardActionUndo(card, first, 'buried');
    const legacy = structuredClone(first);
    legacy.buried = false;
    const canonicalResume = structuredClone(legacy);
    reconcileFlashcardActionOwners(canonicalResume, first);
    legacy.buried = true; // The revision-only ACK left this caller's old token/frontier untouched.
    reconcileFlashcardActionOwners(legacy, canonicalResume);
    expect(legacy.scheduleActionOwners?.buried).not.toBe(proof.expectedOwner);
    expect(legacy.scheduleActionGenerations?.buried).toBeGreaterThan(proof.expectedGeneration);
    expect(flashcardActionUndoIsApplicable(library(legacy), proof)).toBe(false);
    const legitimate = setFlashcardExclusion(canonicalResume, 'buried', true);
    const freshProof = captureFlashcardActionUndo(canonicalResume, legitimate, 'buried');
    reconcileFlashcardActionOwners(legitimate, canonicalResume);
    expect(flashcardActionUndoIsApplicable(library(legitimate), freshProof)).toBe(true);
  });

  it('does not advance an absent flag owner when reconciling another active action', () => {
    const first = setFlashcardExclusion(card, 'suspended', true);
    const buried = setFlashcardExclusion(first, 'buried', true);
    const resumed = setFlashcardExclusion(buried, 'suspended', false);
    const expected = structuredClone(resumed);
    reconcileFlashcardActionOwners(resumed, first);
    expect(resumed).toEqual(expected);
    reconcileFlashcardActionOwners(resumed, expected);
    expect(resumed).toEqual(expected);
  });

  it('keeps legacy unowned daily unbury identical to its current-writer projection', () => {
    const legacy = { ...card, buried: true };
    const unburied = setFlashcardExclusion(legacy, 'buried', false);
    const expected = structuredClone(unburied);
    reconcileFlashcardActionOwners(unburied, legacy);
    expect(unburied).toEqual(expected);
    expect(unburied.scheduleActionGenerations).toBeUndefined();
  });

  it('restores the prior timestamp only when the action still owns it', () => {
    const after = { ...setFlashcardExclusion(card, 'buried', true), lastUpdated: 3 };
    const store = library(after);
    restoreFlashcardAction(store, captureFlashcardActionUndo(card, after, 'buried'));
    expect(store.flashcards[card.id]).toEqual({ ...card, scheduleActionGenerations: { buried: 2 } });
  });

  it.each(['missing', 'front', 'language', 'flag'] as const)('refuses %s identity/ownership without changing current data', change => {
    const after = { ...setFlashcardExclusion(card, 'suspended', true), lastUpdated: 3, content: { ...card.content } };
    const undo = captureFlashcardActionUndo(card, after, 'suspended');
    const store = library(after);
    if (change === 'missing') delete store.flashcards[card.id];
    else if (change === 'front') after.content.front = 'replacement';
    else if (change === 'language') after.language = 'another-package';
    else after.suspended = false;
    const current = JSON.stringify(store);
    expect(flashcardActionUndoIsApplicable(store, undo)).toBe(false);
    expect(() => restoreFlashcardAction(store, undo)).toThrow('changed');
    expect(JSON.stringify(store)).toBe(current);
  });
});
