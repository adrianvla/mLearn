import { createEffect, onCleanup, type Accessor } from 'solid-js'

import {
  isSameAppActivity,
  normalizeVideoAppActivity,
  shouldEmitVideoProgressUpdate,
  type AppActivity,
} from '../../../../shared/plugins/appActivity'
import { publishScopedActivityValue, type ScopedActivityPayload } from './readerPluginActivity'

export const VIDEO_ACTIVITY_SOURCE_ID = 'video-route'

export function syncVideoPluginActivity(input: {
  workName: Accessor<string>
  currentTimeSeconds: Accessor<number>
  durationSeconds: Accessor<number | null>
  isFocused: Accessor<boolean>
  publishScopedValue?: (payload: ScopedActivityPayload) => void
}): void {
  const publishScopedValue = input.publishScopedValue ?? publishScopedActivityValue
  let previousActivity: AppActivity | null = null
  let previousIsFocused: boolean | null = null

  createEffect(() => {
    const isFocused = input.isFocused()
    const workName = input.workName()
    const currentTimeSeconds = input.currentTimeSeconds()
    const durationSeconds = input.durationSeconds()

    let value = isFocused
      ? normalizeVideoAppActivity(workName, currentTimeSeconds, durationSeconds)
      : null

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

    publishScopedValue({
      sourceId: VIDEO_ACTIVITY_SOURCE_ID,
      isFocused,
      value,
    })
  })

  onCleanup(() => {
    publishScopedValue({
      sourceId: VIDEO_ACTIVITY_SOURCE_ID,
      isFocused: false,
      value: null,
    })
  })
}
