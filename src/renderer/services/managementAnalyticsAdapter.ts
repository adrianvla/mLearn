import { resolveCloudApiUrl } from '../../shared/backends'
import type { Settings } from '../../shared/types'
import type { ManagementActivityEventV1 } from '../../shared/plugins/appActivity'
import type { ActivityQueue } from './activityQueue'
import { createActivityQueue, normalizeAnalyticsOrigin } from './activityQueue'
import { activityHub } from './activityHubRuntime'
import { ensureCloudAccessToken, subscribeCloudSessionRefresh } from './cloudSessionManager'

type ActivityEventSource = { subscribeEvents(listener: (event: ManagementActivityEventV1) => void): () => void }
type IngestionResponse = { acceptedIds: string[]; duplicateIds: string[]; rejected: Array<{ id: string; code: string; retryable?: boolean }> }
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
export interface ManagementAnalyticsAdapter { start(): void; flush(): Promise<void>; stop(): void }

function validResponse(value: unknown): value is IngestionResponse {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return Array.isArray(row.acceptedIds) && row.acceptedIds.every(v => typeof v === 'string')
    && Array.isArray(row.duplicateIds) && row.duplicateIds.every(v => typeof v === 'string')
    && Array.isArray(row.rejected) && row.rejected.every(v => v && typeof v === 'object'
      && typeof (v as Record<string, unknown>).id === 'string' && typeof (v as Record<string, unknown>).code === 'string'
      && ((v as Record<string, unknown>).retryable === undefined || typeof (v as Record<string, unknown>).retryable === 'boolean'))
}
function eligible(settings: Settings): { origin: string; userId: string; groupId: string } | null {
  if (settings.cloudAuthStatus !== 'signed-in') return null
  const userId = settings.cloudAuthUserId.trim(); const groupId = settings.cloudAuthActiveGroupId.trim()
  if (!userId || !groupId) return null
  return { origin: normalizeAnalyticsOrigin(resolveCloudApiUrl(settings)), userId, groupId }
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
  let started = false; let generation = 0; let flushing: Promise<void> | null = null
  let unsubscribeHub: (() => void) | null = null; let unsubscribeRefresh: (() => void) | null = null

  async function queueFor(scope: { origin: string; userId: string }): Promise<ActivityQueue> {
    const key = `${scope.origin}\n${scope.userId}`
    let queue = queues.get(key)
    if (!queue) { queue = makeQueue(scope); queues.set(key, queue) }
    return queue
  }
  async function enqueue(event: ManagementActivityEventV1, currentGeneration: number): Promise<void> {
    const scope = eligible(options.getSettings())
    if (!started || currentGeneration !== generation || !scope || event.activeGroupId !== scope.groupId) return
    try {
      const queue = await queueFor(scope)
      await queue.enqueue(event)
      if ((await queue.stats()).count >= threshold && targetWindow.navigator.onLine !== false) void flush()
    } catch { /* analytics is best effort and never blocks learning */ }
  }
  async function upload(): Promise<void> {
    const before = eligible(options.getSettings())
    if (!before || targetWindow.navigator.onLine === false) return
    let queue: ActivityQueue
    try { queue = await queueFor(before) } catch { return }
    const events = await queue.peekBatch(batchCount, batchBytes)
    if (!events.length || events.some(event => event.activeGroupId !== before.groupId)) return
    let accessToken = await token({ interactive: false, openModalOnExpiry: false })
    if (!accessToken) return
    const still = eligible(options.getSettings())
    if (!still || still.origin !== before.origin || still.userId !== before.userId || still.groupId !== before.groupId) return
    const send = (bearer: string) => fetcher(`${before.origin}/api/analytics/events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ schemaVersion: 1, events }),
    })
    let response: Response
    try {
      response = await send(accessToken)
      if (response.status === 401) {
        accessToken = await token({ forceRefresh: true, interactive: false, openModalOnExpiry: false })
        if (!accessToken) return
        response = await send(accessToken)
      }
    } catch { return }
    if (!response.ok) return
    const payload: unknown = await response.json().catch(() => null)
    if (!validResponse(payload)) return
    const batchIds = new Set(events.map(event => event.id))
    const acknowledged = [...payload.acceptedIds, ...payload.duplicateIds].filter(id => batchIds.has(id))
    await queue.acknowledge(acknowledged)
    const permanent = payload.rejected.filter(row => batchIds.has(row.id) && row.retryable === false)
    for (const row of permanent) await queue.quarantine([row.id], row.code)
  }
  async function lockedUpload(): Promise<void> {
    const scope = eligible(options.getSettings())
    if (!scope) return
    let queue: ActivityQueue
    try { queue = await queueFor(scope) } catch { return }
    await queue.withLease(leaseOwner, upload)
  }
  function flush(): Promise<void> {
    if (!started) return Promise.resolve()
    if (!flushing) flushing = lockedUpload().finally(() => { flushing = null })
    return flushing
  }
  const onOnline = () => { void flush() }
  const onVisibility = () => { if (targetDocument.visibilityState === 'hidden') void flush() }
  const onPageHide = () => { void flush() }
  return {
    start() {
      if (started) return
      started = true; const currentGeneration = ++generation
      unsubscribeHub = hub.subscribeEvents(event => { void enqueue(event, currentGeneration) })
      unsubscribeRefresh = subscribeRefresh(() => { void flush() })
      targetWindow.addEventListener('online', onOnline)
      targetWindow.addEventListener('pagehide', onPageHide)
      targetDocument.addEventListener('visibilitychange', onVisibility)
    },
    flush,
    stop() {
      if (!started) return
      started = false; generation++
      unsubscribeHub?.(); unsubscribeHub = null; unsubscribeRefresh?.(); unsubscribeRefresh = null
      targetWindow.removeEventListener('online', onOnline); targetWindow.removeEventListener('pagehide', onPageHide)
      targetDocument.removeEventListener('visibilitychange', onVisibility)
      for (const queue of queues.values()) void queue.then(value => value.close()).catch(() => {})
      queues.clear()
    },
  }
}
