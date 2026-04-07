// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../context', () => ({
  useLocalization: () => ({
    t: (key: string) => key,
  }),
}));

import { matchesKeybind } from './KeybindInput';

describe('matchesKeybind', () => {
  it('matches modifier-only bindings on keydown and keyup', () => {
    const keyDown = new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true });
    const keyUp = new KeyboardEvent('keyup', { key: 'Shift' });

    expect(matchesKeybind(keyDown, 'shift')).toBe(true);
    expect(matchesKeybind(keyUp, 'shift')).toBe(true);
  });

  it('matches modifier combinations when a modifier is released', () => {
    const keyUp = new KeyboardEvent('keyup', {
      key: 'Shift',
      ctrlKey: true,
    });

    expect(matchesKeybind(keyUp, 'ctrl+shift')).toBe(true);
  });

  it('rejects events with extra modifiers', () => {
    const event = new KeyboardEvent('keydown', {
      key: 'Shift',
      shiftKey: true,
      altKey: true,
    });

    expect(matchesKeybind(event, 'shift')).toBe(false);
  });
});