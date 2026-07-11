import { createEffect, onCleanup, type Accessor } from 'solid-js'

import {
  isSameAppActivity,
  normalizeVideoAppActivity,
  shouldEmitVideoProgressUpdate,
  type ActivityContext,
  type AppActivity,
} from '../../../../shared/plugins/appActivity'
import { activityHub } from '../../../services/activityHubRuntime'

export const VIDEO_ACTIVITY_SOURCE_ID = 'video-route'

type LegacyPublisher = (payload: { sourceId: string; isFocused: boolean; value: AppActivity | null }) => void

export function syncVideoPluginActivity(input: {
  workName: Accessor<string>
  currentTimeSeconds: Accessor<number>
  durationSeconds: Accessor<number | null>
  isFocused: Accessor<boolean>
  isVisible?: Accessor<boolean>
  contentId?: Accessor<string | undefined>
  language?: Accessor<string | undefined>
  updateSource?: typeof activityHub.updateSource
  removeSource?: typeof activityHub.removeSource
  /** @deprecated Test seam retained for compatibility; production uses ActivityHub. */
  publishScopedValue?: LegacyPublisher
}): void {
  const updateSource = input.updateSource ?? activityHub.updateSource
  const removeSource = input.removeSource ?? activityHub.removeSource
  let previousActivity: AppActivity | null = null
  let previousIsFocused: boolean | null = null

  createEffect(() => {
    const isFocused = input.isFocused()
    const workName = input.workName()
    const currentTimeSeconds = input.currentTimeSeconds()
    const durationSeconds = input.durationSeconds()

    let value = normalizeVideoAppActivity(workName, currentTimeSeconds, durationSeconds)

    if (
      value
      && value.kind === 'video'
      && previousActivity?.kind === 'video'
      && previousActivity.workName === value.workName
      && previousActivity.durationSeconds === value.durationSeconds
      && !shouldEmitVideoProgressUpdate(previousActivity.currentTimeSeconds, value.currentTimeSeconds)
    ) {
      value = previousActivity
    }

    const isSameActivity = previousActivity === null
      ? value === null
      : value !== null && isSameAppActivity(previousActivity, value)

    if (previousIsFocused === isFocused && isSameActivity) {
      return
    }

    previousActivity = value
    previousIsFocused = isFocused

    const context: ActivityContext = {
      privacy: 'title-and-progress',
      ...(input.contentId?.() ? { contentId: input.contentId() } : {}),
      ...(input.language?.() ? { language: input.language() } : {}),
    }
    if (input.publishScopedValue) {
      input.publishScopedValue({ sourceId: VIDEO_ACTIVITY_SOURCE_ID, isFocused, value })
    } else {
      updateSource(VIDEO_ACTIVITY_SOURCE_ID, {
        isFocused,
        isVisible: input.isVisible?.() ?? true,
        activity: value ?? { kind: 'idle' },
        context,
      })
    }
  })

  onCleanup(() => {
    if (input.publishScopedValue) {
      input.publishScopedValue({ sourceId: VIDEO_ACTIVITY_SOURCE_ID, isFocused: false, value: null })
    } else removeSource(VIDEO_ACTIVITY_SOURCE_ID)
  })
}
