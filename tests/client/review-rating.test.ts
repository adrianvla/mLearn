/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import type { ReviewTarget } from '@mlearn/contracts';
import { initialRating, learningKeyAllowed, rateAll, rateTarget, ratingActions, ratingGrade, ratingKey } from '../../apps/client/src/features/review/rating';

const targets: ReviewTarget[] = [
  { id: 'reading', label: 'Reading', mnemonic: 'r', key: null },
  { id: 'meaning', label: 'Meaning', mnemonic: 'm', key: null },
  { id: 'pitch', label: 'Pitch', mnemonic: 'p', key: null },
];
test('collapsed digits submit compatible rows and Easy remains fluent evidence', () => {
  for (const action of ratingActions) {
    const result = ratingKey(targets, initialRating(), action.key, 10, true);
    assert.deepEqual(result.grades, targets.map(target => ({
      targetId: target.id, quality: action.quality, easy: action.easy, method: 'worked_out',
    })));
  }
});
test('expanded double-key All preserves explicit mixed and untested exceptions', () => {
  let state = initialRating(true);
  const missed = ratingKey(targets, state, '1', 10, false);
  assert.equal(missed.grades, null);
  const reading = ratingKey(targets, missed.state, 'r', 11, false);
  assert.equal(reading.grades, null);
  state = rateTarget(targets, reading.state, { targetId: 'pitch', quality: null, easy: false, method: 'remembered' }).state;
  const armed = ratingKey(targets, state, '4', 20, false);
  assert.equal(armed.grades, null);
  const result = ratingKey(targets, armed.state, '4', 21, false);
  assert.deepEqual(result.grades, [
    { targetId: 'reading', quality: 'missed', easy: false, method: 'remembered' },
    { targetId: 'meaning', quality: 'fluent', easy: true, method: 'remembered' },
    { targetId: 'pitch', quality: null, easy: false, method: 'remembered' },
  ]);
});
test('explicit row actions submit once all targets have an intentional outcome', () => {
  let state = initialRating(true);
  for (const [index, target] of targets.entries()) {
    const result = rateTarget(targets, state, ratingGrade(target.id, ratingActions[2], 'remembered'));
    assert.equal(result.grades?.length ?? 0, index === targets.length - 1 ? targets.length : 0);
    state = result.state;
  }
});
test('closing Adjust preserves explicit grades and Untested for bulk clicks and shortcuts', () => {
  let state = initialRating(true);
  state = rateTarget(targets, state, ratingGrade('reading', ratingActions[0], 'remembered')).state;
  state = rateTarget(targets, state, { targetId: 'pitch', quality: null, easy: false, method: 'remembered' }).state;
  const closed = { ...state, expanded: false };
  const expected = [
    { targetId: 'reading', quality: 'missed', easy: false, method: 'remembered' },
    { targetId: 'meaning', quality: 'fluent', easy: false, method: 'remembered' },
    { targetId: 'pitch', quality: null, easy: false, method: 'remembered' },
  ];
  assert.deepEqual(rateAll(targets, closed, ratingActions[2], 'remembered'), expected);
  assert.deepEqual(ratingKey(targets, closed, '3', 20, false).grades, expected);
});
test('expired chord cannot rate a row or act as a double-key All', () => {
  const armed = ratingKey(targets, initialRating(true), '2', 10, false);
  assert.equal(ratingKey(targets, armed.state, 'm', 1511, false).handled, false);
  const expiredDigit = ratingKey(targets, armed.state, '2', 1511, false);
  assert.equal(expiredDigit.grades, null);
  assert.deepEqual(expiredDigit.state.pending, { key: '2', at: 1511 });
});
test('Escape clears pending before collapsing and duplicate package mnemonics never guess', () => {
  const armed = ratingKey(targets, initialRating(true), '3', 10, false);
  const cleared = ratingKey(targets, armed.state, 'Escape', 20, false);
  assert.equal(cleared.state.expanded, true);
  assert.equal(cleared.state.pending, null);
  assert.equal(ratingKey(targets, cleared.state, 'Escape', 21, false).state.expanded, false);
  const duplicates = targets.map(target => ({ ...target, mnemonic: 'r' }));
  assert.equal(ratingKey(duplicates, armed.state, 'r', 22, false).handled, false);
});
test('expanded All applies only to admitted targets; supplied and unknown rows cannot appear', () => {
  const state = rateTarget(targets, initialRating(true), ratingGrade('not-admitted', ratingActions[0], 'remembered')).state;
  assert.deepEqual(rateAll(targets, state, ratingActions[2], 'remembered').map(grade => grade.targetId), targets.map(target => target.id));
});
test('learning input suppresses composition, repeat, editable, selection, modal and modified contexts independently', () => {
  const allowed = { repeat: false, composing: false, prevented: false, editable: false, selected: false, modal: false, modified: false };
  assert.equal(learningKeyAllowed(allowed), true);
  for (const name of Object.keys(allowed)) assert.equal(learningKeyAllowed({ ...allowed, [name]: true }), false, name);
});
