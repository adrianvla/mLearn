import { describe, expect, it, vi } from 'vitest'
import type { Settings } from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/types'
import type { ManagementActivityEventV1 } from '../../shared/plugins/appActivity'
import type { ActivityQueue } from './activityQueue'
import { createManagementAnalyticsAdapter } from './managementAnalyticsAdapter'

const EVENT: ManagementActivityEventV1 = { schemaVersion: 1, id: 'e1', type: 'activity.started', sessionId: 's1', sourceId: 'reader', activeGroupId: 'g1', policyVersionId: 'p1', sequence: 0, occurredAt: '2026-07-11T00:00:00.000Z', activity: { kind: 'flashcards' }, context: { privacy: 'progress-only' } }
function settings(extra: Partial<Settings> = {}): Settings { return { ...DEFAULT_SETTINGS, overrideCloudEndpointUrl: true, cloudApiUrl: 'https://school.test', cloudAuthStatus: 'signed-in', cloudAuthUserId: 'u1', cloudAuthActiveGroupId: 'g1', ...extra } }
function harness(response: Response) {
  let listener: ((event: ManagementActivityEventV1) => void) | undefined
  const rows = [EVENT]
  const queue: ActivityQueue = { enqueue: vi.fn(async event => { rows.push(event) }), peekBatch: vi.fn(async (_groupId) => rows), acknowledge: vi.fn(async ids => { for (const id of ids) { const index = rows.findIndex(row => row.id === id); if (index >= 0) rows.splice(index, 1) } }), quarantine: vi.fn(async () => {}), compact: vi.fn(async () => {}), stats: vi.fn(async () => ({ count: rows.length, bytes: 1, dropped: 0, droppedReasons: {} })), withLease: vi.fn(async (_owner, operation) => operation()), close: vi.fn() }
  const fetcher = vi.fn(async () => response)
  const adapter = createManagementAnalyticsAdapter({ getSettings: settings, hub: { subscribeEvents: next => { listener = next; return () => { listener = undefined } } }, queueFactory: vi.fn(async () => queue), fetch: fetcher, ensureToken: vi.fn(async () => 'token'), subscribeRefresh: () => () => {}, window, document })
  return { adapter, queue, fetcher, emit: () => listener?.(EVENT) }
}

describe('ManagementAnalyticsAdapter', () => {
  it('acknowledges accepted and duplicate ids only', async () => {
    const h = harness(new Response(JSON.stringify({ acceptedIds: ['e1'], duplicateIds: [], rejected: [] }), { status: 200 }))
    h.adapter.start(); await h.adapter.flush()
    expect(h.queue.acknowledge).toHaveBeenCalledWith(['e1'])
    expect(h.fetcher).toHaveBeenCalledWith('https://school.test/api/analytics/events', expect.objectContaining({ method: 'POST' }))
  })
  it('retains the entire batch for a malformed response', async () => {
    const h = harness(new Response('{}', { status: 200 })); h.adapter.start(); await h.adapter.flush()
    expect(h.queue.acknowledge).not.toHaveBeenCalled()
  })
  it('removes subscriptions on stop', () => {
    const h = harness(new Response('{}')); h.adapter.start(); h.adapter.stop(); h.emit()
    expect(h.queue.enqueue).not.toHaveBeenCalled()
  })

  it.each([
    { acceptedIds: ['e1'], duplicateIds: ['e1'], rejected: [] },
    { acceptedIds: ['outside'], duplicateIds: [], rejected: [] },
    { acceptedIds: [], duplicateIds: [], rejected: [{ id: 'e1', code: 'unknown', retryable: false }] },
  ])('retains a batch for contradictory or untrusted response IDs', async payload => {
    const h = harness(new Response(JSON.stringify(payload), { status: 200 })); h.adapter.start(); await h.adapter.flush()
    expect(h.queue.acknowledge).not.toHaveBeenCalled(); expect(h.queue.quarantine).not.toHaveBeenCalled()
  })

  it('evicts a failed queue-open promise and retries only on a later flush', async () => {
    const h = harness(new Response(JSON.stringify({ acceptedIds: ['e1'], duplicateIds: [], rejected: [] }), { status: 200 }))
    const factory = vi.fn().mockRejectedValueOnce(new Error('blocked')).mockResolvedValue(h.queue)
    const adapter = createManagementAnalyticsAdapter({ getSettings: settings, hub: { subscribeEvents: () => () => {} }, queueFactory: factory, fetch: h.fetcher, ensureToken: vi.fn(async () => 'token'), subscribeRefresh: () => () => {}, window, document })
    adapter.start(); await expect(adapter.flush()).resolves.toBeUndefined(); expect(factory).toHaveBeenCalledTimes(1)
    await adapter.flush(); expect(factory).toHaveBeenCalledTimes(2); expect(h.queue.acknowledge).toHaveBeenCalledWith(['e1'])
  })

  it('does not retry old-group events with a token obtained after the group changed', async () => {
    let current = settings()
    const h = harness(new Response('{}'))
    const fetcher = vi.fn(async () => new Response('', { status: 401 }))
    const ensureToken = vi.fn(async (options?: { forceRefresh?: boolean }) => {
      if (options?.forceRefresh) current = { ...current, cloudAuthActiveGroupId: 'g2' }
      return options?.forceRefresh ? 'new-token' : 'old-token'
    })
    const adapter = createManagementAnalyticsAdapter({ getSettings: () => current, hub: { subscribeEvents: () => () => {} }, queueFactory: vi.fn(async () => h.queue), fetch: fetcher, ensureToken, subscribeRefresh: () => () => {}, window, document })
    adapter.start(); await adapter.flush()
    expect(fetcher).toHaveBeenCalledTimes(1); expect(h.queue.acknowledge).not.toHaveBeenCalled()
  })

  it('aborts an in-flight request and settles before stop returns', async () => {
    const h = harness(new Response('{}'))
    const fetcher = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))
    const adapter = createManagementAnalyticsAdapter({ getSettings: settings, hub: { subscribeEvents: () => () => {} }, queueFactory: vi.fn(async () => h.queue), fetch: fetcher, ensureToken: vi.fn(async () => 'token'), subscribeRefresh: () => () => {}, window, document })
    adapter.start(); const flush = adapter.flush(); await vi.waitFor(() => expect(fetcher).toHaveBeenCalled())
    await expect(adapter.stop()).resolves.toBeUndefined(); await expect(flush).resolves.toBeUndefined()
    expect(h.queue.close).toHaveBeenCalled(); expect(h.queue.acknowledge).not.toHaveBeenCalled()
  })

  it.each(['stop', 'scope-switch'] as const)('persists a captured event after a slow open during %s', async transition => {
    let current = settings(); let emit: ((event: ManagementActivityEventV1) => void) | undefined
    let resolveQueue!: (queue: ActivityQueue) => void
    const opened = new Promise<ActivityQueue>(resolve => { resolveQueue = resolve })
    const h = harness(new Response('{}'))
    const adapter = createManagementAnalyticsAdapter({ getSettings: () => current, hub: { subscribeEvents: listener => { emit = listener; return () => { emit = undefined } } }, queueFactory: vi.fn(() => opened), fetch: h.fetcher, ensureToken: vi.fn(async () => 'token'), subscribeRefresh: () => () => {}, window, document })
    adapter.start(); emit?.(EVENT)
    let stopped: Promise<void> | undefined
    if (transition === 'stop') stopped = adapter.stop()
    else {
      current = { ...current, cloudAuthActiveGroupId: 'g2' }; adapter.updateScope(current)
    }
    resolveQueue(h.queue); await stopped; await vi.waitFor(() => expect(h.queue.enqueue).toHaveBeenCalledWith(EVENT))
    expect(h.fetcher).not.toHaveBeenCalled()
    if (transition === 'scope-switch') await adapter.stop()
  })

  it('invalidates a token wait across an A-B-A scope transition', async () => {
    let current = settings(); let resolveToken!: (value: string) => void
    const tokenWait = new Promise<string>(resolve => { resolveToken = resolve }); const h = harness(new Response('{}'))
    const fetcher = vi.fn(async () => new Response('{}'))
    const adapter = createManagementAnalyticsAdapter({ getSettings: () => current, hub: { subscribeEvents: () => () => {} }, queueFactory: vi.fn(async () => h.queue), fetch: fetcher, ensureToken: vi.fn(() => tokenWait), subscribeRefresh: () => () => {}, window, document })
    adapter.start(); const flush = adapter.flush(); await vi.waitFor(() => expect(h.queue.peekBatch).toHaveBeenCalled())
    current = { ...current, cloudAuthActiveGroupId: 'g2' }; adapter.updateScope(current)
    current = { ...current, cloudAuthActiveGroupId: 'g1' }; adapter.updateScope(current)
    resolveToken('token'); await flush
    expect(fetcher).not.toHaveBeenCalled(); expect(h.queue.acknowledge).not.toHaveBeenCalled()
  })

  it('invalidates a fetch response across an A-B-A scope transition', async () => {
    let current = settings(); let resolveFetch!: (value: Response) => void
    const fetchWait = new Promise<Response>(resolve => { resolveFetch = resolve }); const h = harness(new Response('{}'))
    const fetcher = vi.fn(() => fetchWait)
    const adapter = createManagementAnalyticsAdapter({ getSettings: () => current, hub: { subscribeEvents: () => () => {} }, queueFactory: vi.fn(async () => h.queue), fetch: fetcher, ensureToken: vi.fn(async () => 'token'), subscribeRefresh: () => () => {}, window, document })
    adapter.start(); const flush = adapter.flush(); await vi.waitFor(() => expect(fetcher).toHaveBeenCalled())
    current = { ...current, cloudAuthActiveGroupId: 'g2' }; adapter.updateScope(current)
    current = { ...current, cloudAuthActiveGroupId: 'g1' }; adapter.updateScope(current)
    resolveFetch(new Response(JSON.stringify({ acceptedIds: ['e1'], duplicateIds: [], rejected: [] }), { status: 200 })); await flush
    expect(h.queue.acknowledge).not.toHaveBeenCalled()
  })

  it('does not retry a 401 after an A-B-A transition during forced refresh', async () => {
    let current = settings(); let resolveRefresh!: (value: string) => void
    const refreshWait = new Promise<string>(resolve => { resolveRefresh = resolve }); const h = harness(new Response('{}'))
    const fetcher = vi.fn(async () => new Response('', { status: 401 }))
    const ensureToken = vi.fn((options?: { forceRefresh?: boolean }) => options?.forceRefresh ? refreshWait : Promise.resolve('old'))
    const adapter = createManagementAnalyticsAdapter({ getSettings: () => current, hub: { subscribeEvents: () => () => {} }, queueFactory: vi.fn(async () => h.queue), fetch: fetcher, ensureToken, subscribeRefresh: () => () => {}, window, document })
    adapter.start(); const flush = adapter.flush(); await vi.waitFor(() => expect(ensureToken).toHaveBeenCalledTimes(2))
    current = { ...current, cloudAuthActiveGroupId: 'g2' }; adapter.updateScope(current)
    current = { ...current, cloudAuthActiveGroupId: 'g1' }; adapter.updateScope(current)
    resolveRefresh('new'); await flush
    expect(fetcher).toHaveBeenCalledTimes(1); expect(h.queue.acknowledge).not.toHaveBeenCalled()
  })

  it('does not acknowledge a retry response after an A-B-A transition', async () => {
    let current = settings(); let resolveRetry!: (value: Response) => void
    const retryWait = new Promise<Response>(resolve => { resolveRetry = resolve }); const h = harness(new Response('{}'))
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockImplementationOnce(() => retryWait)
    const adapter = createManagementAnalyticsAdapter({ getSettings: () => current, hub: { subscribeEvents: () => () => {} }, queueFactory: vi.fn(async () => h.queue), fetch: fetcher, ensureToken: vi.fn(async () => 'token'), subscribeRefresh: () => () => {}, window, document })
    adapter.start(); const flush = adapter.flush(); await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    current = { ...current, cloudAuthActiveGroupId: 'g2' }; adapter.updateScope(current)
    current = { ...current, cloudAuthActiveGroupId: 'g1' }; adapter.updateScope(current)
    resolveRetry(new Response(JSON.stringify({ acceptedIds: ['e1'], duplicateIds: [], rejected: [] }), { status: 200 })); await flush
    expect(h.queue.acknowledge).not.toHaveBeenCalled()
  })

  it('suppresses later mutations after an A-B-A transition during acknowledgement', async () => {
    let current = settings(); let resolveAck!: () => void
    const ackWait = new Promise<void>(resolve => { resolveAck = resolve }); const h = harness(new Response('{}'))
    vi.mocked(h.queue.acknowledge).mockImplementationOnce(() => ackWait)
    const response = new Response(JSON.stringify({ acceptedIds: ['e1'], duplicateIds: [], rejected: [] }), { status: 200 })
    const adapter = createManagementAnalyticsAdapter({ getSettings: () => current, hub: { subscribeEvents: () => () => {} }, queueFactory: vi.fn(async () => h.queue), fetch: vi.fn(async () => response), ensureToken: vi.fn(async () => 'token'), subscribeRefresh: () => () => {}, window, document })
    adapter.start(); const flush = adapter.flush(); await vi.waitFor(() => expect(h.queue.acknowledge).toHaveBeenCalled())
    current = { ...current, cloudAuthActiveGroupId: 'g2' }; adapter.updateScope(current)
    current = { ...current, cloudAuthActiveGroupId: 'g1' }; adapter.updateScope(current)
    resolveAck(); await flush
    expect(h.queue.quarantine).not.toHaveBeenCalled()
  })
})
