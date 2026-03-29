import { createEffect, onCleanup, type Accessor } from 'solid-js';

import type { AppActivity } from '../../../shared/plugins/appActivity';
import {
  publishSourceActivityUpdate,
  type SourceActivityUpdatePayload,
} from '../main/routes/readerActivityPublisher';

export type FlashcardsTabId = 'review' | 'browse' | 'generate' | 'stats';

export const FLASHCARDS_ACTIVITY_SOURCE_ID = 'flashcards-window';

export function getFlashcardsAppActivity(activeTab: FlashcardsTabId): AppActivity {
  return activeTab === 'review' ? { kind: 'flashcards' } : { kind: 'idle' };
}

export function createFlashcardsAppActivityPublisher(input: {
  activeTab: Accessor<FlashcardsTabId>;
  isFocused: Accessor<boolean>;
  publishSourceUpdate?: (payload: SourceActivityUpdatePayload) => void;
}): void {
  const publishSourceUpdate = input.publishSourceUpdate ?? publishSourceActivityUpdate;
  const idleActivity: AppActivity = { kind: 'idle' };

  createEffect(() => {
    const isFocused = input.isFocused();
    const activity = isFocused ? getFlashcardsAppActivity(input.activeTab()) : idleActivity;

    publishSourceUpdate({
      sourceId: FLASHCARDS_ACTIVITY_SOURCE_ID,
      isFocused,
      activity,
    });
  });

  onCleanup(() => {
    publishSourceUpdate({
      sourceId: FLASHCARDS_ACTIVITY_SOURCE_ID,
      isFocused: false,
      activity: idleActivity,
    });
  });
}
