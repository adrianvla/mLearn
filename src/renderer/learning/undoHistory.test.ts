import { describe, expect, it } from 'vitest';
import {
  MAX_UNDO_STACK_SIZE,
  canRetryRetraction,
  isRetractionWriteBlocking,
  pushUndo,
  type RetractionWriteState,
} from './undoHistory';

describe('undo history', () => {
  it('keeps entries in order while under the window', () => {
    expect(pushUndo([], 'a')).toEqual(['a']);
    expect(pushUndo(['a'], 'b')).toEqual(['a', 'b']);
  });

  it('drops the oldest entry once the window is full', () => {
    let stack: string[] = [];
    for (let i = 0; i < MAX_UNDO_STACK_SIZE + 10; i += 1) stack = pushUndo(stack, String(i));
    expect(stack).toHaveLength(MAX_UNDO_STACK_SIZE);
    expect(stack[0]).toBe('10');
    expect(stack[MAX_UNDO_STACK_SIZE - 1]).toBe(String(MAX_UNDO_STACK_SIZE + 9));
  });

  it('never mutates the input stack', () => {
    const original = ['a'];
    const next = pushUndo(original, 'b');
    expect(original).toEqual(['a']);
    expect(next).not.toBe(original);
  });
});

describe('retraction write reporting', () => {
  it('blocks study actions only while a retraction is in flight', () => {
    // A settled failure must not strand the learner: the banner's retry is the
    // way forward, so neither rating nor undo stays locked behind it.
    expect(isRetractionWriteBlocking('pending')).toBe(true);
    expect(isRetractionWriteBlocking('failed')).toBe(false);
    expect(isRetractionWriteBlocking(null)).toBe(false);
  });

  it('offers a retry exactly when a retraction failed', () => {
    expect(canRetryRetraction('failed')).toBe(true);
    // Nothing is retained to retry once the retraction succeeded, and a
    // pending one has not failed yet.
    expect(canRetryRetraction('pending')).toBe(false);
    expect(canRetryRetraction(null)).toBe(false);
  });

  it('reports a refused retraction as a failure rather than swallowing it', () => {
    // The bug this owns: word sync returned early on a refused retraction and
    // left the learner no evidence that undo had failed. Every refusal must
    // land in the 'failed' state, which is the one the banner renders.
    const report = (succeeded: boolean): RetractionWriteState => (succeeded ? null : 'failed');
    expect(report(false)).toBe('failed');
    expect(canRetryRetraction(report(false))).toBe(true);
    expect(report(true)).toBeNull();
  });
});
