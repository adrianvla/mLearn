import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';

import { getFlashcardsPluginActivityValue, syncFlashcardsPluginActivity } from './pluginActivity';

describe('getFlashcardsPluginActivityValue', () => {
  it('returns flashcards activity for review mode', () => {
    expect(getFlashcardsPluginActivityValue('review')).toEqual({ kind: 'flashcards' });
  });

  it('returns idle for non-review tabs', () => {
    expect(getFlashcardsPluginActivityValue('browse')).toEqual({ kind: 'idle' });
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

      syncFlashcardsPluginActivity({
        activeTab,
        isFocused,
        updateSource: publishSourceUpdate,
      });
    });

    await Promise.resolve();

    setIsFocused(false);
    await Promise.resolve();

    expect(publishSourceUpdate).toHaveBeenNthCalledWith(2, 'flashcards-window', {
      isFocused: false,
      isVisible: true,
      activity: { kind: 'flashcards' },
      context: { privacy: 'progress-only', contentId: 'flashcards-review' },
    });

    dispose();
  });

  it('publishes an unfocused idle update on cleanup', async () => {
    const publishSourceUpdate = vi.fn();
    const removeSource = vi.fn();

    let dispose!: () => void;

    createRoot((rootDispose) => {
      dispose = rootDispose;
      const [activeTab] = createSignal<'review' | 'browse' | 'generate' | 'stats'>('review');
      const [isFocused] = createSignal(true);

      syncFlashcardsPluginActivity({
        activeTab,
        isFocused,
        updateSource: publishSourceUpdate,
        removeSource,
      });
    });

    await Promise.resolve();

    dispose();

    expect(publishSourceUpdate).toHaveBeenCalledTimes(1);
    expect(removeSource).toHaveBeenCalledWith('flashcards-window');
  });
});
