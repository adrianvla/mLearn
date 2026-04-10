import { describe, expect, it } from 'vitest';

import { createAnkiCacheToastGate } from './windowWrapperNotifications';

describe('createAnkiCacheToastGate', () => {
  it('waits until localization is loaded before showing the Anki cache toast', () => {
    const gate = createAnkiCacheToastGate();

    expect(gate.shouldShow('Loaded from cache', false)).toBe(false);
    expect(gate.shouldShow('Loaded from cache', true)).toBe(true);
  });

  it('suppresses duplicate cache messages until the status changes away', () => {
    const gate = createAnkiCacheToastGate();

    expect(gate.shouldShow('Loaded from cache', true)).toBe(true);
    expect(gate.shouldShow('Loaded from cache', true)).toBe(false);
    expect(gate.shouldShow('Python server running', true)).toBe(false);
    expect(gate.shouldShow('Loaded from cache', true)).toBe(true);
  });

  it('ignores unrelated status messages', () => {
    const gate = createAnkiCacheToastGate();

    expect(gate.shouldShow('Installing components...', true)).toBe(false);
  });
});