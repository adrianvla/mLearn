import {
  isSameAppActivity,
  type AppActivity,
} from '../../shared/plugins/appActivity'

type SourceActivityRecord = {
  isFocused: boolean
  activity: AppActivity | null
  focusSequence: number
  focusTimestamp: number | null
}

type UpdateSourceInput = {
  isFocused: boolean
  activity: AppActivity | null
  updatedAt?: number
}

type ActivityListener = (activity: AppActivity) => void

export type PluginAppActivityStore = {
  updateSource: (sourceId: string, next: UpdateSourceInput) => void
  getCurrentActivity: () => AppActivity
  subscribe: (listener: ActivityListener) => () => void
}

const IDLE_ACTIVITY: AppActivity = { kind: 'idle' }

export function createPluginAppActivityStore(): PluginAppActivityStore {
  const sourceRecords = new Map<string, SourceActivityRecord>()
  const listeners = new Set<ActivityListener>()
  let lastEmittedActivity: AppActivity = IDLE_ACTIVITY
  let nextSequence = 0

  function getCurrentActivity(): AppActivity {
    let activeRecord: SourceActivityRecord | null = null

    for (const record of sourceRecords.values()) {
      if (!record.isFocused || !record.activity) {
        continue
      }

      const recordWins = activeRecord === null
        || (
          record.focusTimestamp !== null
          && activeRecord.focusTimestamp !== null
          ? record.focusTimestamp > activeRecord.focusTimestamp
          : record.focusSequence > activeRecord.focusSequence
        )

      if (recordWins) {
        activeRecord = record
      }
    }

    return activeRecord?.activity ?? IDLE_ACTIVITY
  }

  function emitIfChanged() {
    const currentActivity = getCurrentActivity()
    if (isSameAppActivity(lastEmittedActivity, currentActivity)) {
      return
    }

    lastEmittedActivity = currentActivity

    for (const listener of listeners) {
      listener(currentActivity)
    }
  }

  return {
    updateSource(sourceId, next) {
      const previousRecord = sourceRecords.get(sourceId)
      const focusSequence = next.isFocused
        ? previousRecord?.isFocused
          ? previousRecord.focusSequence
          : ++nextSequence
        : previousRecord?.focusSequence ?? 0
      const focusTimestamp = next.isFocused
        ? previousRecord?.isFocused
          ? previousRecord.focusTimestamp
          : next.updatedAt ?? null
        : previousRecord?.focusTimestamp ?? null

      sourceRecords.set(sourceId, {
        isFocused: next.isFocused,
        activity: next.activity,
        focusSequence,
        focusTimestamp,
      })
      emitIfChanged()
    },

    getCurrentActivity,

    subscribe(listener) {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
  }
}
