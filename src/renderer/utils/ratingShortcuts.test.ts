// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { isRatingKeyIgnored, isUndoShortcut } from './ratingShortcuts';

describe('isRatingKeyIgnored', () => {
  it('ignores held-down OS auto-repeat keydowns but not fresh presses', () => {
    expect(isRatingKeyIgnored(new KeyboardEvent('keydown', { key: '1', repeat: true }))).toBe(true);
    expect(isRatingKeyIgnored(new KeyboardEvent('keydown', { key: '1', repeat: false }))).toBe(false);
  });

  it('ignores keystrokes inside editable/control elements', () => {
    for (const tag of ['input', 'textarea', 'select']) {
      const el = document.createElement(tag);
      const e = new KeyboardEvent('keydown', { key: '1', bubbles: true });
      el.dispatchEvent(e);
      expect(isRatingKeyIgnored(e)).toBe(true);
    }
  });

  it('ignores contentEditable and role=textbox targets', () => {
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    let e = new KeyboardEvent('keydown', { key: '1', bubbles: true });
    editable.dispatchEvent(e);
    expect(isRatingKeyIgnored(e)).toBe(true);

    const textbox = document.createElement('div');
    textbox.setAttribute('role', 'textbox');
    e = new KeyboardEvent('keydown', { key: '1', bubbles: true });
    textbox.dispatchEvent(e);
    expect(isRatingKeyIgnored(e)).toBe(true);
  });

  it('does not ignore presses on the plain document', () => {
    const e = new KeyboardEvent('keydown', { key: '1' });
    document.dispatchEvent(e);
    expect(isRatingKeyIgnored(e)).toBe(false);
  });
});

describe('isUndoShortcut', () => {
  it('matches Cmd/Ctrl+Z regardless of case', () => {
    expect(isUndoShortcut(new KeyboardEvent('keydown', { key: 'z', metaKey: true }))).toBe(true);
    expect(isUndoShortcut(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }))).toBe(true);
    expect(isUndoShortcut(new KeyboardEvent('keydown', { key: 'Z', metaKey: true }))).toBe(true);
  });

  it('rejects bare, shift/alt-modified, and non-Z keys', () => {
    expect(isUndoShortcut(new KeyboardEvent('keydown', { key: 'z' }))).toBe(false);
    expect(isUndoShortcut(new KeyboardEvent('keydown', { key: 'z', metaKey: true, shiftKey: true }))).toBe(false);
    expect(isUndoShortcut(new KeyboardEvent('keydown', { key: 'z', metaKey: true, altKey: true }))).toBe(false);
    expect(isUndoShortcut(new KeyboardEvent('keydown', { key: 'x', metaKey: true }))).toBe(false);
  });
});
