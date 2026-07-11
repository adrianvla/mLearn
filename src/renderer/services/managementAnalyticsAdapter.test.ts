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
})
