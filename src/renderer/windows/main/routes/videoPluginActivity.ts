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
}): void {
  const updateSource = input.updateSource ?? activityHub.updateSource
  const removeSource = input.removeSource ?? activityHub.removeSource
  let previousActivity: AppActivity | null = null
  let previousIsFocused: boolean | null = null
  let previousIsVisible: boolean | null = null
  let previousContext: ActivityContext | null = null

  createEffect(() => {
    const isFocused = input.isFocused()
    const workName = input.workName()
    const currentTimeSeconds = input.currentTimeSeconds()
    const durationSeconds = input.durationSeconds()
    const isVisible = input.isVisible?.() ?? true
    const contentId = input.contentId?.()
    const language = input.language?.()
    const context: ActivityContext = {
      privacy: 'title-and-progress',
      ...(contentId ? { contentId } : {}),
      ...(language ? { language } : {}),
    }

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

    const isSameContext = previousContext?.contentId === context.contentId
      && previousContext?.language === context.language
      && previousContext?.privacy === context.privacy

    if (previousIsFocused === isFocused
      && previousIsVisible === isVisible
      && isSameActivity
      && isSameContext) {
      return
    }

    previousActivity = value
    previousIsFocused = isFocused
    previousIsVisible = isVisible
    previousContext = context
    updateSource(VIDEO_ACTIVITY_SOURCE_ID, {
      isFocused,
      isVisible,
      activity: value ?? { kind: 'idle' },
      context,
    })
  })

  onCleanup(() => removeSource(VIDEO_ACTIVITY_SOURCE_ID))
}
