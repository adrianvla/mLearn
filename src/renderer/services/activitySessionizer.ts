import {
  isValidActivityIdentifier,
  projectActivityContext,
  projectAppActivity,
  shouldEmitVideoProgressUpdate,
  type ActivityContext,
  type AppActivity,
  type ManagementActivityEventType,
  type ManagementActivityEventV1,
} from '../../shared/plugins/appActivity'

export type ActivityPolicyScope = {
  activeGroupId: string
  policyVersionId: string
}

function projectScope(value: ActivityPolicyScope | null): ActivityPolicyScope | null {
  if (!value
    || !isValidActivityIdentifier(value.activeGroupId)
    || !isValidActivityIdentifier(value.policyVersionId)) return null
  return { activeGroupId: value.activeGroupId, policyVersionId: value.policyVersionId }
}

export type ProjectedActivity = {
  sourceId: string
  activity: AppActivity
  context: ActivityContext
}

type ActiveSession = {
  identity: string
  sessionId: string
  sequence: number
  completed: boolean
  projected: ProjectedActivity
  scope: ActivityPolicyScope
}

type ActivitySessionizerOptions = {
  now?: () => Date
  uuid?: () => string
  emit: (event: ManagementActivityEventV1) => void
}

function defaultUuid(): string {
  return globalThis.crypto.randomUUID()
}

function cloneProjected(value: ProjectedActivity): ProjectedActivity {
  return {
    sourceId: value.sourceId,
    activity: { ...value.activity },
    context: { ...value.context },
  }
}

function contentIdentity(projected: ProjectedActivity): string {
  const { activity, context } = projected
  if (context.contentId) return `${activity.kind}:id:${context.contentId}`
  switch (activity.kind) {
    case 'reader':
    case 'video':
      return `${activity.kind}:title:${activity.workName}`
    case 'flashcards':
    case 'idle':
      return activity.kind
  }
}

function sessionIdentity(projected: ProjectedActivity, scope: ActivityPolicyScope): string {
  return [
    projected.sourceId,
    contentIdentity(projected),
    projected.context.language ?? '',
    projected.context.privacy,
    scope.activeGroupId,
    scope.policyVersionId,
  ].join('\u0000')
}

function sanitize(projected: ProjectedActivity): ProjectedActivity {
  const result = cloneProjected(projected)
  if (result.context.privacy === 'progress-only' && 'workName' in result.activity) {
    result.activity.workName = ''
  }
  return result
}

function isComplete(activity: AppActivity): boolean {
  switch (activity.kind) {
    case 'reader':
      return activity.totalPages > 0 && activity.currentPage >= activity.totalPages
    case 'video':
      return activity.durationSeconds !== null
        && activity.durationSeconds > 0
        && activity.currentTimeSeconds >= activity.durationSeconds
    case 'idle':
    case 'flashcards':
      return false
  }
}

function hasProgressed(previous: AppActivity, next: AppActivity): boolean {
  if (previous.kind !== next.kind) return false
  switch (next.kind) {
    case 'reader':
      return previous.kind === 'reader'
        && (previous.currentPage !== next.currentPage || previous.totalPages !== next.totalPages)
    case 'video':
      return previous.kind === 'video'
        && (previous.durationSeconds !== next.durationSeconds
          || shouldEmitVideoProgressUpdate(previous.currentTimeSeconds, next.currentTimeSeconds))
    case 'idle':
    case 'flashcards':
      return false
  }
}

export function createActivitySessionizer(options: ActivitySessionizerOptions) {
  const now = options.now ?? (() => new Date())
  const uuid = options.uuid ?? defaultUuid
  let active: ActiveSession | null = null
  let lastOccurredAt = -1

  function nextId(): string | null {
    try {
      const id = uuid()
      return isValidActivityIdentifier(id) ? id : null
    } catch {
      return null
    }
  }

  function nextOccurredAt(): string | null {
    try {
      const date = now()
      if (!(date instanceof Date)) return null
      const candidate = date.getTime()
      if (!Number.isFinite(candidate)) return null
      const next = Math.max(candidate, lastOccurredAt + 1)
      const occurredAt = new Date(next).toISOString()
      lastOccurredAt = next
      return occurredAt
    } catch {
      return null
    }
  }

  function emit(type: ManagementActivityEventType, session: ActiveSession, projected: ProjectedActivity): boolean {
    const id = nextId()
    if (!id) return false
    const occurredAt = nextOccurredAt()
    if (!occurredAt) return false
    const sequence = session.sequence + 1
    const safe = sanitize(projected)
    options.emit({
      schemaVersion: 1,
      id,
      type,
      sessionId: session.sessionId,
      sourceId: safe.sourceId,
      activeGroupId: session.scope.activeGroupId,
      policyVersionId: session.scope.policyVersionId,
      sequence,
      occurredAt,
      activity: safe.activity,
      context: safe.context,
    })
    session.sequence = sequence
    return true
  }

  function stop(): void {
    if (!active) return
    emit('activity.stopped', active, active.projected)
    active = null
  }

  function start(projected: ProjectedActivity, scope: ActivityPolicyScope): void {
    const sessionId = nextId()
    if (!sessionId) return
    active = {
      identity: sessionIdentity(projected, scope),
      sessionId,
      sequence: 0,
      completed: false,
      projected: cloneProjected(projected),
      scope: { ...scope },
    }
    if (!emit('activity.started', active, projected)) {
      active = null
      return
    }
    if (isComplete(projected.activity)) {
      active.completed = emit('activity.completed', active, projected)
    }
  }

  return {
    update(projected: ProjectedActivity | null, scope: ActivityPolicyScope | null): void {
      const projectedActivity = projected && projectAppActivity(projected.activity)
      const projectedContext = projected && projectActivityContext(projected.context)
      const safeScope = projectScope(scope)
      const eligible = projected
        && isValidActivityIdentifier(projected.sourceId)
        && projectedActivity?.ok
        && projectedContext?.ok
        && projectedActivity.value.kind !== 'idle'
        ? { sourceId: projected.sourceId, activity: projectedActivity.value, context: projectedContext.value }
        : null
      if (!eligible || !safeScope) {
        stop()
        return
      }
      const identity = sessionIdentity(eligible, safeScope)
      if (!active || active.identity !== identity) {
        stop()
        start(eligible, safeScope)
        return
      }

      const previous = active.projected.activity
      const completed = isComplete(eligible.activity)
      if (completed && !active.completed) {
        active.completed = emit('activity.completed', active, eligible)
      } else if (!active.completed && hasProgressed(previous, eligible.activity)) {
        emit('activity.progressed', active, eligible)
      }
      active.projected = cloneProjected(eligible)
    },
    stop,
  }
}
