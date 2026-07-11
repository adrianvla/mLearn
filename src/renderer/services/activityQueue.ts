import {
  isValidActivityIdentifier,
  projectActivityContext,
  projectAppActivity,
  type ManagementActivityEventV1,
} from '../../shared/plugins/appActivity'

export type ActivityQueueStats = { count: number; bytes: number; dropped: number; droppedReasons: Record<string, number> }
export type ActivityQueueOptions = {
  origin: string
  userId: string
  maxEvents?: number
  maxBytes?: number
  indexedDB?: IDBFactory
}
type StoredEvent = { key: string; partition: string; bytes: number; event: ManagementActivityEventV1 }
type Meta = { key: string; value: number; owner?: string }

const DB_NAME = 'mlearn-management-analytics'
const DB_VERSION = 1
const EVENTS = 'events'
const META = 'meta'
const encoder = new TextEncoder()

export function normalizeAnalyticsOrigin(value: string): string {
  const url = new URL(value)
  url.hash = ''
  url.search = ''
  url.pathname = url.pathname.replace(/\/+$/u, '')
  return url.toString().replace(/\/$/u, '')
}

export function projectManagementActivityEvent(value: unknown): ManagementActivityEventV1 | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const activity = projectAppActivity(row.activity)
  const context = projectActivityContext(row.context)
  if (row.schemaVersion !== 1 || !activity.ok || !context.ok
    || !['activity.started', 'activity.progressed', 'activity.completed', 'activity.stopped'].includes(String(row.type))
    || !isValidActivityIdentifier(row.id) || !isValidActivityIdentifier(row.sessionId)
    || !isValidActivityIdentifier(row.sourceId) || !isValidActivityIdentifier(row.activeGroupId)
    || !isValidActivityIdentifier(row.policyVersionId) || !Number.isSafeInteger(row.sequence)
    || (row.sequence as number) < 0 || typeof row.occurredAt !== 'string'
    || !Number.isFinite(Date.parse(row.occurredAt))) return null
  return Object.freeze({
    schemaVersion: 1,
    id: row.id,
    type: row.type,
    sessionId: row.sessionId,
    sourceId: row.sourceId,
    activeGroupId: row.activeGroupId,
    policyVersionId: row.policyVersionId,
    sequence: row.sequence,
    occurredAt: new Date(row.occurredAt).toISOString(),
    activity: Object.freeze({ ...activity.value }),
    context: Object.freeze({ ...context.value }),
  }) as ManagementActivityEventV1
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result)
    value.onerror = () => reject(value.error ?? new Error('IndexedDB request failed'))
  })
}
function complete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
  })
}
async function open(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      const store = db.createObjectStore(EVENTS, { keyPath: 'key' })
      store.createIndex('partition', 'partition')
      db.createObjectStore(META, { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Unable to open analytics queue'))
    req.onblocked = () => reject(new Error('Analytics queue upgrade blocked'))
  })
}
function sortEvents(rows: StoredEvent[]): StoredEvent[] {
  return rows.sort((a, b) => a.event.occurredAt.localeCompare(b.event.occurredAt)
    || a.event.sessionId.localeCompare(b.event.sessionId) || a.event.sequence - b.event.sequence
    || a.event.id.localeCompare(b.event.id))
}

export interface ActivityQueue {
  enqueue(event: ManagementActivityEventV1): Promise<void>
  peekBatch(maxCount: number, maxBytes: number): Promise<ManagementActivityEventV1[]>
  acknowledge(ids: readonly string[]): Promise<void>
  quarantine(ids: readonly string[], reason: string): Promise<void>
  compact(): Promise<void>
  stats(): Promise<ActivityQueueStats>
  withLease<T>(owner: string, operation: () => Promise<T>): Promise<T | undefined>
  close(): void
}

export async function createActivityQueue(options: ActivityQueueOptions): Promise<ActivityQueue> {
  const factory = options.indexedDB ?? globalThis.indexedDB
  if (!factory) throw new Error('IndexedDB is unavailable')
  const origin = normalizeAnalyticsOrigin(options.origin)
  const userId = options.userId.trim()
  if (!userId) throw new Error('Analytics queue requires a stable user id')
  const partition = `${origin}\n${userId}`
  const maxEvents = options.maxEvents ?? 5_000
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024
  const db = await open(factory)

  async function rows(tx: IDBTransaction): Promise<StoredEvent[]> {
    return (await request(tx.objectStore(EVENTS).index('partition').getAll(partition))) as StoredEvent[]
  }
  async function addDropped(tx: IDBTransaction, reason: string, count: number): Promise<void> {
    const key = `${partition}\ndropped:${reason}`
    const store = tx.objectStore(META)
    const current = await request(store.get(key)) as Meta | undefined
    store.put({ key, value: (current?.value ?? 0) + count })
  }
  async function enforce(tx: IDBTransaction): Promise<void> {
    const store = tx.objectStore(EVENTS)
    const all = sortEvents(await rows(tx))
    let count = all.length
    let bytes = all.reduce((sum, row) => sum + row.bytes, 0)
    if (count <= maxEvents && bytes <= maxBytes) return
    const progress = all.filter(row => row.event.type === 'activity.progressed')
    const terminal = all.filter(row => row.event.type !== 'activity.progressed')
    for (const row of [...progress, ...terminal]) {
      if (count <= maxEvents && bytes <= maxBytes) break
      store.delete(row.key); count--; bytes -= row.bytes
      await addDropped(tx, row.event.type === 'activity.progressed' ? 'capacity_progress' : 'capacity_terminal', 1)
    }
  }
  async function mutate(fn: (tx: IDBTransaction) => Promise<void>): Promise<void> {
    const tx = db.transaction([EVENTS, META], 'readwrite')
    try { await fn(tx); await complete(tx) } catch (error) { try { tx.abort() } catch { /* settled */ } throw error }
  }

  return {
    async enqueue(input) {
      const event = projectManagementActivityEvent(input)
      if (!event) throw new Error('Invalid management activity event')
      const json = JSON.stringify(event)
      const stored: StoredEvent = { key: `${partition}\n${event.id}`, partition, bytes: encoder.encode(json).byteLength, event }
      await mutate(async tx => {
        const store = tx.objectStore(EVENTS)
        if (await request(store.get(stored.key))) return
        // Superseded progress in the same content session has no durable value.
        const existing = await rows(tx)
        if (event.type === 'activity.progressed' && existing.some(row => row.event.type === 'activity.progressed'
          && row.event.sessionId === event.sessionId && row.event.sequence > event.sequence)) {
          await addDropped(tx, 'coalesced_progress', 1)
          return
        }
        let coalesced = 0
        for (const row of existing) if (row.event.type === 'activity.progressed'
          && row.event.sessionId === event.sessionId && row.event.sequence < event.sequence) { store.delete(row.key); coalesced++ }
        if (coalesced) await addDropped(tx, 'coalesced_progress', coalesced)
        store.put(stored)
        await enforce(tx)
      })
    },
    async peekBatch(maxCount, batchBytes) {
      const tx = db.transaction(EVENTS, 'readonly')
      const all = sortEvents(await rows(tx)); await complete(tx)
      const result: ManagementActivityEventV1[] = []; let bytes = 0
      for (const row of all) {
        if (result.length >= maxCount || (result.length > 0 && bytes + row.bytes > batchBytes)) break
        if (row.bytes > batchBytes && result.length === 0) continue
        result.push(projectManagementActivityEvent(row.event)!); bytes += row.bytes
      }
      return result
    },
    async acknowledge(ids) { await mutate(async tx => { for (const id of new Set(ids)) tx.objectStore(EVENTS).delete(`${partition}\n${id}`) }) },
    async quarantine(ids, reason) { await mutate(async tx => { for (const id of new Set(ids)) tx.objectStore(EVENTS).delete(`${partition}\n${id}`); await addDropped(tx, `rejected:${reason}`, new Set(ids).size) }) },
    async compact() { await mutate(enforce) },
    async stats() {
      const tx = db.transaction([EVENTS, META], 'readonly'); const all = await rows(tx)
      const meta = await request(tx.objectStore(META).getAll()) as Meta[]; await complete(tx)
      const reasons: Record<string, number> = {}
      for (const item of meta) if (item.key.startsWith(`${partition}\ndropped:`)) reasons[item.key.slice(`${partition}\ndropped:`.length)] = item.value
      return { count: all.length, bytes: all.reduce((sum, row) => sum + row.bytes, 0), dropped: Object.values(reasons).reduce((a, b) => a + b, 0), droppedReasons: reasons }
    },
    async withLease(owner, operation) {
      const leaseKey = `${partition}\nlease`
      let acquired = false
      await mutate(async tx => {
        const store = tx.objectStore(META)
        const current = await request(store.get(leaseKey)) as Meta | undefined
        if (current && current.value > Date.now() && current.owner !== owner) return
        store.put({ key: leaseKey, owner, value: Date.now() + 120_000 })
        acquired = true
      })
      if (!acquired) return undefined
      try { return await operation() } finally {
        await mutate(async tx => {
          const store = tx.objectStore(META)
          const current = await request(store.get(leaseKey)) as Meta | undefined
          if (current?.owner === owner) store.delete(leaseKey)
        }).catch(() => {})
      }
    },
    close() { db.close() },
  }
}
