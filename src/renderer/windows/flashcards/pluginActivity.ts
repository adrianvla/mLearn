import { createEffect, onCleanup, type Accessor } from 'solid-js';

import type { AppActivity } from '../../../shared/plugins/appActivity';

export type FlashcardsTabId = 'review' | 'browse' | 'generate' | 'suggested' | 'stats';

export const FLASHCARDS_ACTIVITY_SOURCE_ID = 'flashcards-window';

export type FlashcardsScopedActivityPayload = {
  sourceId: string;
  isFocused: boolean;
  value: AppActivity | null;
};

export function getFlashcardsPluginActivityValue(activeTab: FlashcardsTabId): AppActivity {
  return activeTab === 'review' ? { kind: 'flashcards' } : { kind: 'idle' };
}

export function publishFlashcardsScopedActivityValue(payload: FlashcardsScopedActivityPayload): void {
  window.mLearnInternal?.setScopedPluginValue({
    sourceId: payload.sourceId,
    isFocused: payload.isFocused,
    channel: 'app.user.activity',
    value: payload.value,
  });
}

export function syncFlashcardsPluginActivity(input: {
  activeTab: Accessor<FlashcardsTabId>;
  isFocused: Accessor<boolean>;
  publishScopedValue?: (payload: FlashcardsScopedActivityPayload) => void;
}): void {
  const publishScopedValue = input.publishScopedValue ?? publishFlashcardsScopedActivityValue;
  const idleActivity: AppActivity = { kind: 'idle' };

  createEffect(() => {
    const isFocused = input.isFocused();
    const value = isFocused ? getFlashcardsPluginActivityValue(input.activeTab()) : idleActivity;

    publishScopedValue({
      sourceId: FLASHCARDS_ACTIVITY_SOURCE_ID,
      isFocused,
      value,
    });
  });

  onCleanup(() => {
    publishScopedValue({
      sourceId: FLASHCARDS_ACTIVITY_SOURCE_ID,
      isFocused: false,
      value: idleActivity,
    });
  });
}
