import {
  isSameAppActivity,
  isValidActivityIdentifier,
  projectActivityContext,
  projectAppActivity,
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

type StoredSource = Omit<ActivitySourceState, 'context'> & {
  activation: number
  context: ActivityContext
  analyticsContext: ActivityContext | null
}
type LiveListener = (activity: LiveActivity | null) => void
type EventListener = (event: ManagementActivityEventV1) => void

type ActivitySourceCandidate = readonly [string, Pick<StoredSource, 'priority' | 'activation'>]

/** @internal Exported for deterministic arbitration contract tests. */
export function compareActivitySourceCandidates(
  [leftId, left]: ActivitySourceCandidate,
  [rightId, right]: ActivitySourceCandidate,
): number {
  return (right.priority ?? 0) - (left.priority ?? 0)
    || right.activation - left.activation
    || (leftId < rightId ? -1 : leftId > rightId ? 1 : 0)
}

function cloneActivity(activity: AppActivity): AppActivity {
  return { ...activity }
}

function cloneLive(value: LiveActivity | null): LiveActivity | null {
  if (!value) return null
  return {
    sourceId: value.sourceId,
    activity: cloneActivity(value.activity),
    context: { ...value.context },
  }
}

function cloneEvent(value: ManagementActivityEventV1): ManagementActivityEventV1 {
  return {
    ...value,
    activity: { ...value.activity } as AppActivity,
    context: { ...value.context },
  }
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

function safelyNotify<T>(listeners: Set<(value: T) => void>, value: T, cloneValue: (input: T) => T): void {
  for (const listener of [...listeners]) {
    try {
      listener(cloneValue(value))
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
      try { options.emitEvent?.(cloneEvent(event)) } catch { /* adapter isolation */ }
      safelyNotify(eventListeners, event, cloneEvent)
    },
  })

  function selectSource(): [string, StoredSource] | null {
    const eligible = [...sources.entries()].filter(([, source]) =>
      source.isFocused && (source.isVisible ?? true))
    eligible.sort(compareActivitySourceCandidates)
    const selected = eligible[0]
    return selected ?? null
  }

  function toLive(selected: [string, StoredSource] | null): LiveActivity | null {
    if (!selected) return null
    return {
      sourceId: selected[0],
      activity: cloneActivity(selected[1].activity),
      context: { ...selected[1].context },
    }
  }

  function project(forceScopeRefresh = false): void {
    const selected = selectSource()
    const next = toLive(selected)
    const changed = !sameLive(live, next)
    if (changed) {
      live = next
      safelyNotify(liveListeners, live, cloneLive)
    }
    if (changed || forceScopeRefresh) {
      const analytics = selected?.[1].analyticsContext
        ? { sourceId: selected[0], activity: selected[1].activity, context: selected[1].analyticsContext }
        : null
      let scope: ActivityPolicyScope | null = null
      try { scope = options.getPolicyScope() } catch { /* unavailable attribution */ }
      sessionizer.update(analytics, scope)
    }
  }

  return {
    updateSource(sourceId: string, state: ActivitySourceState): void {
      if (!isValidActivityIdentifier(sourceId)) return
      const activity = projectAppActivity(state.activity)
      if (!activity.ok) return
      const context = projectActivityContext(state.context)
      const safeContext: ActivityContext = context.ok ? context.value : { privacy: 'progress-only' }
      const safeState: ActivitySourceState = {
        isFocused: state.isFocused === true,
        isVisible: state.isVisible === undefined ? undefined : state.isVisible === true,
        priority: typeof state.priority === 'number' && Number.isFinite(state.priority) ? state.priority : 0,
        activity: activity.value,
        context: safeContext,
      }
      const previous = sources.get(sourceId)
      if (previous
        && sameSource(previous, safeState)
        && (previous.analyticsContext !== null) === context.ok) return
      const becomesActive = safeState.isFocused
        && (safeState.isVisible ?? true)
        && (!previous?.isFocused || !(previous.isVisible ?? true))
      const analyticsValidityChanged = previous !== undefined
        && (previous.analyticsContext !== null) !== context.ok
      sources.set(sourceId, {
        ...safeState,
        analyticsContext: context.ok ? context.value : null,
        activation: becomesActive || !previous ? ++activation : previous.activation,
      })
      project(analyticsValidityChanged)
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
      try { listener(cloneLive(live)) } catch { /* subscriber isolation */ }
      return () => liveListeners.delete(listener)
    },
    subscribeEvents(listener: EventListener): () => void {
      eventListeners.add(listener)
      return () => eventListeners.delete(listener)
    },
    getLive(): LiveActivity | null {
      return cloneLive(live)
    },
  }
}
