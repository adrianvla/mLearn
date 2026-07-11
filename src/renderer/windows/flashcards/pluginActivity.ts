import { createEffect, onCleanup, type Accessor } from 'solid-js';

import type { AppActivity } from '../../../shared/plugins/appActivity';
import { activityHub } from '../../services/activityHubRuntime';

export type FlashcardsTabId = 'review' | 'browse' | 'generate' | 'suggested' | 'stats';

export const FLASHCARDS_ACTIVITY_SOURCE_ID = 'flashcards-window';

type LegacyPublisher = (payload: { sourceId: string; isFocused: boolean; value: AppActivity | null }) => void;

export function getFlashcardsPluginActivityValue(activeTab: FlashcardsTabId): AppActivity {
  return activeTab === 'review' ? { kind: 'flashcards' } : { kind: 'idle' };
}

export function syncFlashcardsPluginActivity(input: {
  activeTab: Accessor<FlashcardsTabId>;
  isFocused: Accessor<boolean>;
  isVisible?: Accessor<boolean>;
  language?: Accessor<string | undefined>;
  updateSource?: typeof activityHub.updateSource;
  removeSource?: typeof activityHub.removeSource;
  /** @deprecated Test seam retained for compatibility; production uses ActivityHub. */
  publishScopedValue?: LegacyPublisher;
}): void {
  const updateSource = input.updateSource ?? activityHub.updateSource;
  const removeSource = input.removeSource ?? activityHub.removeSource;

  createEffect(() => {
    const isFocused = input.isFocused();
    const activity = getFlashcardsPluginActivityValue(input.activeTab());
    if (input.publishScopedValue) {
      input.publishScopedValue({
        sourceId: FLASHCARDS_ACTIVITY_SOURCE_ID,
        isFocused,
        value: isFocused ? activity : { kind: 'idle' },
      });
    } else {
      updateSource(FLASHCARDS_ACTIVITY_SOURCE_ID, {
        isFocused,
        isVisible: input.isVisible?.() ?? true,
        activity,
        context: {
          privacy: 'progress-only',
          contentId: 'flashcards-review',
          ...(input.language?.() ? { language: input.language() } : {}),
        },
      });
    }
  });

  onCleanup(() => {
    if (input.publishScopedValue) {
      input.publishScopedValue({ sourceId: FLASHCARDS_ACTIVITY_SOURCE_ID, isFocused: false, value: { kind: 'idle' } });
    } else removeSource(FLASHCARDS_ACTIVITY_SOURCE_ID);
  });
}
