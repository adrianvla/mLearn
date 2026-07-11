import {
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

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
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
  return [projected.sourceId, contentIdentity(projected), scope.activeGroupId, scope.policyVersionId].join('\u0000')
}

function sanitize(projected: ProjectedActivity): ProjectedActivity {
  const result = clone(projected)
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

  function emit(type: ManagementActivityEventType, session: ActiveSession, projected: ProjectedActivity): void {
    session.sequence += 1
    const safe = sanitize(projected)
    options.emit({
      schemaVersion: 1,
      id: uuid(),
      type,
      sessionId: session.sessionId,
      sourceId: safe.sourceId,
      activeGroupId: session.scope.activeGroupId,
      policyVersionId: session.scope.policyVersionId,
      sequence: session.sequence,
      occurredAt: now().toISOString(),
      activity: safe.activity,
      context: safe.context,
    })
  }

  function stop(): void {
    if (!active) return
    emit('activity.stopped', active, active.projected)
    active = null
  }

  function start(projected: ProjectedActivity, scope: ActivityPolicyScope): void {
    active = {
      identity: sessionIdentity(projected, scope),
      sessionId: uuid(),
      sequence: 0,
      completed: false,
      projected: clone(projected),
      scope: { ...scope },
    }
    emit('activity.started', active, projected)
    if (isComplete(projected.activity)) {
      active.completed = true
      emit('activity.completed', active, projected)
    }
  }

  return {
    update(projected: ProjectedActivity | null, scope: ActivityPolicyScope | null): void {
      const eligible = projected?.activity.kind === 'idle' ? null : projected
      if (!eligible || !scope) {
        stop()
        return
      }
      const identity = sessionIdentity(eligible, scope)
      if (!active || active.identity !== identity) {
        stop()
        start(eligible, scope)
        return
      }

      const previous = active.projected.activity
      const completed = isComplete(eligible.activity)
      if (completed && !active.completed) {
        active.completed = true
        emit('activity.completed', active, eligible)
      } else if (!active.completed && hasProgressed(previous, eligible.activity)) {
        emit('activity.progressed', active, eligible)
      }
      active.projected = clone(eligible)
    },
    stop,
  }
}
