import { describe, expect, it, vi } from 'vitest';
import { createWindowActivation } from './windowActivation';

describe('window activation during startup', () => {
  it('waits for app initialization before a Dock activation can create a window', () => {
    const focusExisting = vi.fn(() => false);
    const createWindow = vi.fn();
    const activation = createWindowActivation(focusExisting, createWindow);

    activation.activate();
    activation.activate();
    expect(createWindow).not.toHaveBeenCalled();

    activation.markReady();
    activation.activate();
    expect(createWindow).toHaveBeenCalledTimes(1);
  });

  it('focuses an existing startup or error window without creating another one', () => {
    const createWindow = vi.fn();
    const activation = createWindowActivation(() => true, createWindow);

    activation.activate();
    activation.markReady();
    activation.activate();

    expect(createWindow).not.toHaveBeenCalled();
  });
});
