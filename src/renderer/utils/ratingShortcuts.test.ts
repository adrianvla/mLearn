// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { isBlockedByPendingWrite, isNativeActivationTarget, isRatingKeyIgnored, isRevealKey, isUndoShortcut } from './ratingShortcuts';

describe('isRatingKeyIgnored', () => {
  it('respects a key already consumed by another interaction owner', () => {
    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    event.preventDefault();
    expect(isRatingKeyIgnored(event)).toBe(true);
  });

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

  it('blocks editable shortcuts and leaves native button activation to the button', () => {
    const button = document.createElement('button');
    const buttonEvent = new KeyboardEvent('keydown', { key: ' ', bubbles: true });
    button.dispatchEvent(buttonEvent);
    expect(isRatingKeyIgnored(buttonEvent)).toBe(false);
    expect(isNativeActivationTarget(buttonEvent)).toBe(true);

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const dialogEvent = new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true });
    dialog.dispatchEvent(dialogEvent);
    document.body.append(dialog);
    expect(isRatingKeyIgnored(dialogEvent)).toBe(true);
    document.body.removeChild(dialog);
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

describe('study shortcut policy', () => {
  const keyOn = (target: HTMLElement, key: string, init: KeyboardEventInit = {}) => {
    const e = new KeyboardEvent('keydown', { key, bubbles: true, ...init });
    target.dispatchEvent(e);
    return e;
  };

  it('treats Space and Enter as the reveal key on plain content', () => {
    const plain = document.createElement('div');
    document.body.appendChild(plain);
    expect(isRevealKey(keyOn(plain, ' '))).toBe(true);
    expect(isRevealKey(keyOn(plain, 'Enter'))).toBe(true);
    expect(isRevealKey(keyOn(plain, 'a'))).toBe(false);
    plain.remove();
  });

  it('leaves Space and Enter to a focused control that natively activates', () => {
    const button = document.createElement('button');
    document.body.appendChild(button);
    expect(isRevealKey(keyOn(button, 'Enter'))).toBe(false);
    expect(isRevealKey(keyOn(button, ' '))).toBe(false);
    button.remove();
  });

  it('blocks undo while a write is in flight', () => {
    expect(isBlockedByPendingWrite('undo', true)).toBe(true);
    expect(isBlockedByPendingWrite('undo', false)).toBe(false);
  });

  it('does not let a pending write swallow unrelated shortcuts', () => {
    // Bury/remove/skip still mean something while a rating is being filed.
    expect(isBlockedByPendingWrite('other', true)).toBe(false);
  });
});
