import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';

import { createFlashcardsAppActivityPublisher, getFlashcardsAppActivity } from './flashcardsActivityPublisher';

describe('getFlashcardsAppActivity', () => {
  it('returns flashcards activity for review mode', () => {
    expect(getFlashcardsAppActivity('review')).toEqual({ kind: 'flashcards' });
  });

  it('returns idle for non-review tabs', () => {
    expect(getFlashcardsAppActivity('browse')).toEqual({ kind: 'idle' });
  });

  it('publishes an unfocused idle update when focus changes from true to false', async () => {
    const publishSourceUpdate = vi.fn();

    let setIsFocused!: (value: boolean) => void;
    let dispose!: () => void;

    createRoot((rootDispose) => {
      dispose = rootDispose;
      const [activeTab] = createSignal<'review' | 'browse' | 'generate' | 'stats'>('review');
      const [isFocused, updateIsFocused] = createSignal(true);
      setIsFocused = updateIsFocused;

      createFlashcardsAppActivityPublisher({
        activeTab,
        isFocused,
        publishSourceUpdate,
      });
    });

    await Promise.resolve();

    setIsFocused(false);
    await Promise.resolve();

    expect(publishSourceUpdate).toHaveBeenNthCalledWith(2, {
      sourceId: 'flashcards-window',
      isFocused: false,
      activity: { kind: 'idle' },
    });

    dispose();
  });

  it('publishes an unfocused idle update on cleanup', async () => {
    const publishSourceUpdate = vi.fn();

    let dispose!: () => void;

    createRoot((rootDispose) => {
      dispose = rootDispose;
      const [activeTab] = createSignal<'review' | 'browse' | 'generate' | 'stats'>('review');
      const [isFocused] = createSignal(true);

      createFlashcardsAppActivityPublisher({
        activeTab,
        isFocused,
        publishSourceUpdate,
      });
    });

    await Promise.resolve();

    dispose();

    expect(publishSourceUpdate).toHaveBeenNthCalledWith(2, {
      sourceId: 'flashcards-window',
      isFocused: false,
      activity: { kind: 'idle' },
    });
  });
});
