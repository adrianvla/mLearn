import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import type { ManagementActivityEventV1 } from '../../shared/plugins/appActivity'
import { createActivityQueue } from './activityQueue'

function event(id: string, sequence: number, type: ManagementActivityEventV1['type'] = 'activity.progressed'): ManagementActivityEventV1 {
  return { schemaVersion: 1, id, type, sessionId: 'session', sourceId: 'reader', activeGroupId: 'group', policyVersionId: 'policy', sequence,
    occurredAt: new Date(1_700_000_000_000 + sequence).toISOString(), activity: { kind: 'reader', workName: 'Book', currentPage: sequence + 1, totalPages: 20 }, context: { privacy: 'title-and-progress', contentId: 'book' } }
}

describe('ActivityQueue', () => {
  it('drops legacy zero-sequence rows during upgrade and counts the quarantine', async () => {
    const factory = new IDBFactory()
    await new Promise<void>((resolve, reject) => {
      const request = factory.open('mlearn-management-analytics', 2)
      request.onupgradeneeded = () => {
        const events = request.result.createObjectStore('events', { keyPath: 'key' })
        events.createIndex('partition', 'partition')
        events.createIndex('occurredAtSequence', 'order')
        events.createIndex('partitionGroupOrder', 'partitionGroupOrder')
        request.result.createObjectStore('meta', { keyPath: 'key' })
        const legacy = event('legacy-zero', 1, 'activity.started')
        const invalid = { ...legacy, sequence: 0 }
        const partition = 'https://school.test\nalice'
        events.put({ key: `${partition}\nlegacy-zero`, partition, groupId: 'group', order: [invalid.occurredAt, invalid.sessionId, 0, invalid.id], partitionGroupOrder: [partition, 'group', invalid.occurredAt, invalid.sessionId, 0, invalid.id], bytes: 1, event: invalid })
      }
      request.onsuccess = () => { request.result.close(); resolve() }
      request.onerror = () => reject(request.error)
    })
    const queue = await createActivityQueue({ origin: 'https://school.test', userId: 'alice', indexedDB: factory })
    expect(await queue.stats()).toMatchObject({ count: 0, dropped: 1, droppedReasons: { invalid_legacy: 1 } })
  })

  it('partitions users and acknowledges only named events', async () => {
    const factory = new IDBFactory()
    const alice = await createActivityQueue({ origin: 'https://school.test/', userId: 'alice', indexedDB: factory })
    const bob = await createActivityQueue({ origin: 'https://school.test', userId: 'bob', indexedDB: factory })
    await alice.enqueue(event('a', 1)); await alice.enqueue(event('b', 2)); await bob.enqueue(event('c', 1))
    await alice.acknowledge(['a'])
    expect((await alice.peekBatch('group', 10, 64_000)).map(row => row.id)).toEqual(['b'])
    expect((await bob.peekBatch('group', 10, 64_000)).map(row => row.id)).toEqual(['c'])
  })

  it('is idempotent, deterministic, and coalesces superseded progress', async () => {
    const queue = await createActivityQueue({ origin: 'https://school.test', userId: 'alice', indexedDB: new IDBFactory() })
    await queue.enqueue(event('later', 2)); await queue.enqueue(event('earlier', 1)); await queue.enqueue(event('later', 2))
    expect((await queue.peekBatch('group', 10, 64_000)).map(row => row.id)).toEqual(['later'])
  })

  it('drops progress before lifecycle events at capacity and counts drops', async () => {
    const queue = await createActivityQueue({ origin: 'https://school.test', userId: 'alice', indexedDB: new IDBFactory(), maxEvents: 2 })
    await queue.enqueue(event('start', 1, 'activity.started'))
    await queue.enqueue(event('progress', 2))
    await queue.enqueue(event('done', 3, 'activity.completed'))
    expect((await queue.peekBatch('group', 10, 64_000)).map(row => row.id)).toEqual(['start', 'done'])
    expect(await queue.stats()).toMatchObject({ count: 2, dropped: 1, droppedReasons: { coalesced_progress: 1 } })
  })

  it('rejects malformed events and reports unavailable IndexedDB', async () => {
    await expect(createActivityQueue({ origin: 'https://school.test', userId: 'alice', indexedDB: undefined })).rejects.toThrow()
    const queue = await createActivityQueue({ origin: 'https://school.test', userId: 'alice', indexedDB: new IDBFactory() })
    await expect(queue.enqueue({ ...event('bad', 1), sequence: Number.NaN })).rejects.toThrow('Invalid')
    await expect(queue.enqueue({ ...event('zero', 1), sequence: 0 })).rejects.toThrow('Invalid')
  })

  it('filters interleaved groups without head-of-line blocking and resumes on switch-back', async () => {
    const queue = await createActivityQueue({ origin: 'https://school.test', userId: 'alice', indexedDB: new IDBFactory() })
    await queue.enqueue({ ...event('a1', 1), activeGroupId: 'a' })
    await queue.enqueue({ ...event('b1', 2), activeGroupId: 'b' })
    await queue.enqueue({ ...event('a2', 3), activeGroupId: 'a' })
    expect((await queue.peekBatch('b', 10, 64_000)).map(row => row.id)).toEqual(['b1'])
    await queue.acknowledge(['b1'])
    expect((await queue.peekBatch('a', 10, 64_000)).map(row => row.id)).toEqual(['a2'])
  })

  it('reprojects safe fields, strips nested extras, and redacts progress-only titles durably', async () => {
    const factory = new IDBFactory()
    const queue = await createActivityQueue({ origin: 'https://school.test', userId: 'alice', indexedDB: factory })
    const malicious = { ...event('safe', 1), activity: { kind: 'reader', workName: 'Private title', currentPage: 2, totalPages: 20, secret: 'pii' }, context: { privacy: 'progress-only', contentId: 'opaque', nested: { email: 'x@y.test' } }, token: 'secret' }
    await queue.enqueue(malicious as ManagementActivityEventV1)
    queue.close()
    const reopened = await createActivityQueue({ origin: 'https://school.test', userId: 'alice', indexedDB: factory })
    expect((await reopened.peekBatch('group', 10, 64_000))[0]).toEqual({ ...event('safe', 1), activity: { kind: 'reader', workName: '', currentPage: 2, totalPages: 20 }, context: { privacy: 'progress-only', contentId: 'opaque' } })
  })

  it('coordinates lease ownership and permits a later owner after release', async () => {
    const factory = new IDBFactory()
    const first = await createActivityQueue({ origin: 'https://school.test', userId: 'alice', indexedDB: factory })
    const second = await createActivityQueue({ origin: 'https://school.test', userId: 'alice', indexedDB: factory })
    let release!: () => void
    const held = first.withLease('one', () => new Promise<void>(resolve => { release = resolve }))
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    expect(await second.withLease('two', async () => 'blocked')).toBeUndefined()
    release(); await held
    expect(await second.withLease('two', async () => 'acquired')).toBe('acquired')
  })
})
