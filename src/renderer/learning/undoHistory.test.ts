import { describe, expect, it } from 'vitest';
import { MAX_UNDO_STACK_SIZE, pushUndo } from './undoHistory';

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
