import {
  isSameAppActivity,
  type ActivityContext,
  type AppActivity,
  type ManagementActivityEventV1,
} from '../../shared/plugins/appActivity'
import {
  createActivitySessionizer,
  type ActivityPolicyScope,
  type ProjectedActivity,
} from './activitySessionizer'

export type ActivitySourceState = {
  isFocused: boolean
  isVisible?: boolean
  priority?: number
  activity: AppActivity
  context: ActivityContext
}

export type LiveActivity = ProjectedActivity

type ActivityHubOptions = {
  now?: () => Date
  uuid?: () => string
  getPolicyScope: () => ActivityPolicyScope | null
  emitEvent?: (event: ManagementActivityEventV1) => void
}

type StoredSource = ActivitySourceState & { activation: number }
type LiveListener = (activity: LiveActivity | null) => void
type EventListener = (event: ManagementActivityEventV1) => void

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function sameContext(left: ActivityContext, right: ActivityContext): boolean {
  return left.contentId === right.contentId
    && left.language === right.language
    && left.privacy === right.privacy
}

function sameSource(left: StoredSource, right: ActivitySourceState): boolean {
  return left.isFocused === right.isFocused
    && (left.isVisible ?? true) === (right.isVisible ?? true)
    && (left.priority ?? 0) === (right.priority ?? 0)
    && isSameAppActivity(left.activity, right.activity)
    && sameContext(left.context, right.context)
}

function sameLive(left: LiveActivity | null, right: LiveActivity | null): boolean {
  if (!left || !right) return left === right
  return left.sourceId === right.sourceId
    && isSameAppActivity(left.activity, right.activity)
    && sameContext(left.context, right.context)
}

function safelyNotify<T>(listeners: Set<(value: T) => void>, value: T): void {
  for (const listener of [...listeners]) {
    try {
      listener(clone(value))
    } catch {
      // A presentation or upload adapter must not break learning activity.
    }
  }
}

export function createActivityHub(options: ActivityHubOptions) {
  const sources = new Map<string, StoredSource>()
  const liveListeners = new Set<LiveListener>()
  const eventListeners = new Set<EventListener>()
  let activation = 0
  let live: LiveActivity | null = null

  const sessionizer = createActivitySessionizer({
    now: options.now,
    uuid: options.uuid,
    emit: event => {
      try { options.emitEvent?.(clone(event)) } catch { /* adapter isolation */ }
      safelyNotify(eventListeners, event)
    },
  })

  function selectLive(): LiveActivity | null {
    const eligible = [...sources.entries()].filter(([, source]) =>
      source.isFocused && (source.isVisible ?? true))
    eligible.sort(([leftId, left], [rightId, right]) =>
      (right.priority ?? 0) - (left.priority ?? 0)
      || right.activation - left.activation
      || (leftId < rightId ? -1 : leftId > rightId ? 1 : 0))
    const selected = eligible[0]
    if (!selected) return null
    return {
      sourceId: selected[0],
      activity: clone(selected[1].activity),
      context: clone(selected[1].context),
    }
  }

  function project(forceScopeRefresh = false): void {
    const next = selectLive()
    const changed = !sameLive(live, next)
    if (changed) {
      live = next
      safelyNotify(liveListeners, live)
    }
    if (changed || forceScopeRefresh) {
      sessionizer.update(live, options.getPolicyScope())
    }
  }

  return {
    updateSource(sourceId: string, state: ActivitySourceState): void {
      const previous = sources.get(sourceId)
      if (previous && sameSource(previous, state)) return
      const becomesActive = state.isFocused
        && (state.isVisible ?? true)
        && (!previous?.isFocused || !(previous.isVisible ?? true))
      sources.set(sourceId, {
        ...clone(state),
        activation: becomesActive || !previous ? ++activation : previous.activation,
      })
      project()
    },
    removeSource(sourceId: string): void {
      if (!sources.delete(sourceId)) return
      project()
    },
    refreshPolicyScope(): void {
      project(true)
    },
    subscribeLive(listener: LiveListener): () => void {
      liveListeners.add(listener)
      try { listener(clone(live)) } catch { /* subscriber isolation */ }
      return () => liveListeners.delete(listener)
    },
    subscribeEvents(listener: EventListener): () => void {
      eventListeners.add(listener)
      return () => eventListeners.delete(listener)
    },
    getLive(): LiveActivity | null {
      return clone(live)
    },
  }
}
