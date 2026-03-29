import { createEffect, onCleanup, type Accessor } from 'solid-js'

import {
  isSameAppActivity,
  normalizeVideoAppActivity,
  shouldEmitVideoProgressUpdate,
  type AppActivity,
} from '../../../../shared/plugins/appActivity'
import {
  publishSourceActivityUpdate,
  type SourceActivityUpdatePayload,
} from './readerActivityPublisher'

export const VIDEO_ACTIVITY_SOURCE_ID = 'video-route'

export function createVideoAppActivityPublisher(input: {
  workName: Accessor<string>
  currentTimeSeconds: Accessor<number>
  durationSeconds: Accessor<number | null>
  isFocused: Accessor<boolean>
  publishSourceUpdate?: (payload: SourceActivityUpdatePayload) => void
}): void {
  const publishSourceUpdate = input.publishSourceUpdate ?? publishSourceActivityUpdate
  let previousActivity: AppActivity | null = null
  let previousIsFocused: boolean | null = null

  createEffect(() => {
    const isFocused = input.isFocused()
    const workName = input.workName()
    const currentTimeSeconds = input.currentTimeSeconds()
    const durationSeconds = input.durationSeconds()

    let activity = isFocused
      ? normalizeVideoAppActivity(workName, currentTimeSeconds, durationSeconds)
      : null

    if (
      activity
      && activity.kind === 'video'
      && previousActivity?.kind === 'video'
      && previousActivity.workName === activity.workName
      && previousActivity.durationSeconds === activity.durationSeconds
      && !shouldEmitVideoProgressUpdate(previousActivity.currentTimeSeconds, activity.currentTimeSeconds)
    ) {
      activity = previousActivity
    }

    const isSameActivity = previousActivity === null
      ? activity === null
      : activity !== null && isSameAppActivity(previousActivity, activity)

    if (previousIsFocused === isFocused && isSameActivity) {
      return
    }

    previousActivity = activity
    previousIsFocused = isFocused

    publishSourceUpdate({
      sourceId: VIDEO_ACTIVITY_SOURCE_ID,
      isFocused,
      activity,
    })
  })

  onCleanup(() => {
    publishSourceUpdate({
      sourceId: VIDEO_ACTIVITY_SOURCE_ID,
      isFocused: false,
      activity: null,
    })
  })
}
