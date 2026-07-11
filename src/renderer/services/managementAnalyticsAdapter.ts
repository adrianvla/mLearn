import { resolveCloudApiUrl } from '../../shared/backends'
import type { Settings } from '../../shared/types'
import type { ManagementActivityEventV1 } from '../../shared/plugins/appActivity'
import type { ActivityQueue } from './activityQueue'
import { createActivityQueue, normalizeAnalyticsOrigin } from './activityQueue'
import { activityHub } from './activityHubRuntime'
import { ensureCloudAccessToken, subscribeCloudSessionRefresh } from './cloudSessionManager'

type ActivityEventSource = { subscribeEvents(listener: (event: ManagementActivityEventV1) => void): () => void }
type Scope = { origin: string; userId: string; groupId: string }
type Rejected = { id: string; code: RejectionCode; retryable: boolean }
type IngestionActions = { acknowledge: string[]; permanent: Rejected[] }
const REJECTION_CODES = new Set(['invalid_schema', 'invalid_event', 'invalid_activity', 'invalid_progress', 'title_too_long', 'event_too_old', 'event_too_new', 'active_group_mismatch', 'invalid_scope'])
type RejectionCode = 'invalid_schema' | 'invalid_event' | 'invalid_activity' | 'invalid_progress' | 'title_too_long' | 'event_too_old' | 'event_too_new' | 'active_group_mismatch' | 'invalid_scope'

export type ManagementAnalyticsAdapterOptions = {
  getSettings: () => Settings
  hub?: ActivityEventSource
  queueFactory?: typeof createActivityQueue
  fetch?: typeof globalThis.fetch
  ensureToken?: typeof ensureCloudAccessToken
  subscribeRefresh?: typeof subscribeCloudSessionRefresh
  window?: Window
  document?: Document
  batchCount?: number
  batchBytes?: number
  flushThreshold?: number
}
export interface ManagementAnalyticsAdapter { start(): void; flush(): Promise<void>; stop(): Promise<void> }

function eligible(settings: Settings): Scope | null {
  if (settings.cloudAuthStatus !== 'signed-in') return null
  const userId = settings.cloudAuthUserId.trim(); const groupId = settings.cloudAuthActiveGroupId.trim()
  if (!userId || !groupId) return null
  try { return { origin: normalizeAnalyticsOrigin(resolveCloudApiUrl(settings)), userId, groupId } } catch { return null }
}
function sameScope(left: Scope, right: Scope | null): boolean {
  return !!right && left.origin === right.origin && left.userId === right.userId && left.groupId === right.groupId
}
function ingestionActions(value: unknown, batch: ReadonlySet<string>): IngestionActions | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (!Array.isArray(row.acceptedIds) || !Array.isArray(row.duplicateIds) || !Array.isArray(row.rejected)) return null
  if (!row.acceptedIds.every(v => typeof v === 'string') || !row.duplicateIds.every(v => typeof v === 'string')) return null
  const rejected: Rejected[] = []
  for (const value of row.rejected) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const item = value as Record<string, unknown>
    if (typeof item.id !== 'string' || typeof item.code !== 'string' || item.code.length > 64
      || !REJECTION_CODES.has(item.code) || typeof item.retryable !== 'boolean') return null
    rejected.push({ id: item.id, code: item.code as RejectionCode, retryable: item.retryable })
  }
  const all = [...row.acceptedIds, ...row.duplicateIds, ...rejected.map(item => item.id)] as string[]
  if (all.some(id => !batch.has(id)) || new Set(all).size !== all.length) return null
  return { acknowledge: [...row.acceptedIds, ...row.duplicateIds] as string[], permanent: rejected.filter(item => !item.retryable) }
}

export function createManagementAnalyticsAdapter(options: ManagementAnalyticsAdapterOptions): ManagementAnalyticsAdapter {
  const hub = options.hub ?? activityHub
  const makeQueue = options.queueFactory ?? createActivityQueue
  const fetcher = options.fetch ?? globalThis.fetch
  const token = options.ensureToken ?? ensureCloudAccessToken
  const subscribeRefresh = options.subscribeRefresh ?? subscribeCloudSessionRefresh
  const targetWindow = options.window ?? globalThis.window
  const targetDocument = options.document ?? globalThis.document
  const batchCount = options.batchCount ?? 100
  const batchBytes = options.batchBytes ?? 256 * 1024
  const threshold = options.flushThreshold ?? 20
  const leaseOwner = crypto.randomUUID()
  const queues = new Map<string, Promise<ActivityQueue>>()
  const pendingEnqueues = new Set<Promise<void>>()
  const aborters = new Set<AbortController>()
  let started = false; let generation = 0; let flushing: Promise<void> | null = null
  let unsubscribeHub: (() => void) | null = null; let unsubscribeRefresh: (() => void) | null = null

  function current(scope: Scope, expectedGeneration: number): boolean {
    return started && generation === expectedGeneration && sameScope(scope, eligible(options.getSettings()))
  }
  async function queueFor(scope: Pick<Scope, 'origin' | 'userId'>): Promise<ActivityQueue> {
    const key = `${scope.origin}\n${scope.userId}`
    let queue = queues.get(key)
    if (!queue) {
      queue = makeQueue(scope)
      queues.set(key, queue)
      void queue.catch(() => { if (queues.get(key) === queue) queues.delete(key) })
    }
    return queue
  }
  async function enqueue(event: ManagementActivityEventV1, expectedGeneration: number): Promise<void> {
    const scope = eligible(options.getSettings())
    if (!scope || !current(scope, expectedGeneration) || event.activeGroupId !== scope.groupId) return
    const queue = await queueFor(scope)
    if (!current(scope, expectedGeneration)) return
    await queue.enqueue(event)
    if (!current(scope, expectedGeneration)) return
    const stats = await queue.stats()
    if (current(scope, expectedGeneration) && stats.count >= threshold && targetWindow.navigator.onLine !== false) void flush()
  }
  function trackEnqueue(event: ManagementActivityEventV1, expectedGeneration: number): void {
    const work = enqueue(event, expectedGeneration).catch(() => {}).finally(() => pendingEnqueues.delete(work))
    pendingEnqueues.add(work)
  }
  async function upload(scope: Scope, queue: ActivityQueue, expectedGeneration: number): Promise<void> {
    if (!current(scope, expectedGeneration) || targetWindow.navigator.onLine === false) return
    const events = await queue.peekBatch(scope.groupId, batchCount, batchBytes)
    if (!current(scope, expectedGeneration) || !events.length || events.some(event => event.activeGroupId !== scope.groupId)) return
    let accessToken = await token({ interactive: false, openModalOnExpiry: false })
    if (!current(scope, expectedGeneration) || !accessToken) return
    const controller = new AbortController(); aborters.add(controller)
    const send = (bearer: string) => fetcher(`${scope.origin}/api/analytics/events`, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ schemaVersion: 1, events }),
    })
    try {
      let response = await send(accessToken)
      if (!current(scope, expectedGeneration)) return
      if (response.status === 401) {
        accessToken = await token({ forceRefresh: true, interactive: false, openModalOnExpiry: false })
        if (!current(scope, expectedGeneration) || !accessToken) return
        response = await send(accessToken)
        if (!current(scope, expectedGeneration)) return
      }
      if (!response.ok) return
      const payload: unknown = await response.json()
      if (!current(scope, expectedGeneration)) return
      const actions = ingestionActions(payload, new Set(events.map(event => event.id)))
      if (!actions) return
      if (!current(scope, expectedGeneration)) return
      await queue.acknowledge(actions.acknowledge)
      if (!current(scope, expectedGeneration)) return
      const byCode = new Map<RejectionCode, string[]>()
      for (const item of actions.permanent) byCode.set(item.code, [...(byCode.get(item.code) ?? []), item.id])
      for (const [code, ids] of byCode) {
        if (!current(scope, expectedGeneration)) return
        await queue.quarantine(ids, code)
      }
    } finally { aborters.delete(controller) }
  }
  async function lockedUpload(expectedGeneration: number): Promise<void> {
    const scope = eligible(options.getSettings())
    if (!scope || !current(scope, expectedGeneration)) return
    const queue = await queueFor(scope)
    if (!current(scope, expectedGeneration)) return
    await queue.withLease(leaseOwner, async () => {
      if (!current(scope, expectedGeneration)) return
      await upload(scope, queue, expectedGeneration)
    })
    if (!current(scope, expectedGeneration)) return
  }
  function flush(): Promise<void> {
    if (!started) return Promise.resolve()
    if (!flushing) {
      const expectedGeneration = generation
      const work = lockedUpload(expectedGeneration).catch(() => {}).finally(() => { if (flushing === work) flushing = null })
      flushing = work
    }
    return flushing
  }
  const onOnline = () => { void flush() }
  const onVisibility = () => { if (targetDocument.visibilityState === 'hidden') void flush() }
  const onPageHide = () => { void flush() }
  return {
    start() {
      if (started) return
      started = true; const expectedGeneration = ++generation
      unsubscribeHub = hub.subscribeEvents(event => trackEnqueue(event, expectedGeneration))
      unsubscribeRefresh = subscribeRefresh(() => { void flush() })
      targetWindow.addEventListener('online', onOnline); targetWindow.addEventListener('pagehide', onPageHide)
      targetDocument.addEventListener('visibilitychange', onVisibility)
    },
    flush,
    async stop() {
      if (!started) return
      started = false; generation++
      unsubscribeHub?.(); unsubscribeHub = null; unsubscribeRefresh?.(); unsubscribeRefresh = null
      targetWindow.removeEventListener('online', onOnline); targetWindow.removeEventListener('pagehide', onPageHide)
      targetDocument.removeEventListener('visibilitychange', onVisibility)
      for (const controller of aborters) controller.abort()
      await Promise.allSettled([...(flushing ? [flushing] : []), ...pendingEnqueues])
      const pendingQueues = [...queues.values()]; queues.clear()
      const settled = await Promise.allSettled(pendingQueues)
      for (const result of settled) if (result.status === 'fulfilled') { try { result.value.close() } catch { /* best effort */ } }
    },
  }
}
