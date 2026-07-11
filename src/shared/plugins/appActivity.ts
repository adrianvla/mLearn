export type AppActivity =
  | { kind: 'idle' }
  | {
      kind: 'reader'
      workName: string
      currentPage: number
      totalPages: number
    }
  | {
      kind: 'video'
      workName: string
      currentTimeSeconds: number
      durationSeconds: number | null
    }
  | { kind: 'flashcards' }

export type ActivityContext = {
  readonly contentId?: string
  readonly language?: string
  readonly privacy: 'title-and-progress' | 'progress-only'
}

export type ManagementActivityEventType =
  | 'activity.started'
  | 'activity.progressed'
  | 'activity.completed'
  | 'activity.stopped'

export type ManagementActivityEventV1 = {
  readonly schemaVersion: 1
  readonly id: string
  readonly type: ManagementActivityEventType
  readonly sessionId: string
  readonly sourceId: string
  readonly activeGroupId: string
  readonly policyVersionId: string
  readonly sequence: number
  readonly occurredAt: string
  readonly activity: Readonly<AppActivity>
  readonly context: ActivityContext
}

export const MAX_ACTIVITY_IDENTIFIER_LENGTH = 256
export const MAX_ACTIVITY_TITLE_LENGTH = 512

type ProjectionResult<T> = { ok: true; value: T } | { ok: false }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isValidActivityIdentifier(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_ACTIVITY_IDENTIFIER_LENGTH
    && value.trim() === value
    && !/[\u0000-\u001f\u007f]/u.test(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function projectAppActivity(value: unknown): ProjectionResult<AppActivity> {
  if (!isRecord(value)) return { ok: false }
  switch (value.kind) {
    case 'idle':
      return { ok: true, value: { kind: 'idle' } }
    case 'flashcards':
      return { ok: true, value: { kind: 'flashcards' } }
    case 'reader': {
      if (typeof value.workName !== 'string'
        || value.workName.length === 0
        || value.workName.length > MAX_ACTIVITY_TITLE_LENGTH
        || !Number.isInteger(value.currentPage)
        || !Number.isInteger(value.totalPages)
        || (value.currentPage as number) < 1
        || (value.totalPages as number) < 1
        || (value.currentPage as number) > (value.totalPages as number)) return { ok: false }
      return {
        ok: true,
        value: {
          kind: 'reader',
          workName: value.workName,
          currentPage: value.currentPage as number,
          totalPages: value.totalPages as number,
        },
      }
    }
    case 'video': {
      const duration = value.durationSeconds
      if (typeof value.workName !== 'string'
        || value.workName.length === 0
        || value.workName.length > MAX_ACTIVITY_TITLE_LENGTH
        || !isFiniteNumber(value.currentTimeSeconds)
        || value.currentTimeSeconds < 0
        || (duration !== null && (!isFiniteNumber(duration) || duration <= 0))
        || (typeof duration === 'number' && value.currentTimeSeconds > duration)) return { ok: false }
      return {
        ok: true,
        value: {
          kind: 'video',
          workName: value.workName,
          currentTimeSeconds: value.currentTimeSeconds,
          durationSeconds: duration as number | null,
        },
      }
    }
    default:
      return { ok: false }
  }
}

export function projectActivityContext(value: unknown): ProjectionResult<ActivityContext> {
  if (!isRecord(value)
    || (value.privacy !== 'title-and-progress' && value.privacy !== 'progress-only')
    || (value.contentId !== undefined && !isValidActivityIdentifier(value.contentId))
    || (value.language !== undefined && !isValidActivityIdentifier(value.language))) return { ok: false }
  const context: ActivityContext = {
    privacy: value.privacy,
    ...(value.contentId === undefined ? {} : { contentId: value.contentId }),
    ...(value.language === undefined ? {} : { language: value.language }),
  }
  return { ok: true, value: context }
}

export function isSameAppActivity(
  left: AppActivity,
  right: AppActivity,
): boolean {
  if (left.kind !== right.kind) {
    return false
  }

  switch (left.kind) {
    case 'idle':
    case 'flashcards':
      return true
    case 'reader':
      return right.kind === 'reader'
        && left.workName === right.workName
        && left.currentPage === right.currentPage
        && left.totalPages === right.totalPages
    case 'video':
      return right.kind === 'video'
        && left.workName === right.workName
        && left.currentTimeSeconds === right.currentTimeSeconds
        && left.durationSeconds === right.durationSeconds
  }
}

export function shouldEmitVideoProgressUpdate(
  previousTimeSeconds: number,
  nextTimeSeconds: number,
): boolean {
  return Math.floor(previousTimeSeconds / 15) !== Math.floor(nextTimeSeconds / 15)
}

export function normalizeReaderAppActivity(
  workName: string,
  zeroBasedPage: number,
  totalPages: number,
): AppActivity | null {
  if (!workName || totalPages <= 0) {
    return null
  }

  return {
    kind: 'reader',
    workName,
    currentPage: zeroBasedPage + 1,
    totalPages,
  }
}

export function normalizeVideoAppActivity(
  workName: string,
  currentTimeSeconds: number,
  durationSeconds: number | null,
): AppActivity | null {
  if (!workName || durationSeconds === null) {
    return null
  }

  return {
    kind: 'video',
    workName,
    currentTimeSeconds,
    durationSeconds,
  }
}
