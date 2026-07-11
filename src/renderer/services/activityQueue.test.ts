import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import type { ManagementActivityEventV1 } from '../../shared/plugins/appActivity'
import { createActivityQueue } from './activityQueue'

function event(id: string, sequence: number, type: ManagementActivityEventV1['type'] = 'activity.progressed'): ManagementActivityEventV1 {
  return { schemaVersion: 1, id, type, sessionId: 'session', sourceId: 'reader', activeGroupId: 'group', policyVersionId: 'policy', sequence,
    occurredAt: new Date(1_700_000_000_000 + sequence).toISOString(), activity: { kind: 'reader', workName: 'Book', currentPage: sequence + 1, totalPages: 20 }, context: { privacy: 'title-and-progress', contentId: 'book' } }
}

describe('ActivityQueue', () => {
  it('partitions users and acknowledges only named events', async () => {
    const factory = new IDBFactory()
    const alice = await createActivityQueue({ origin: 'https://school.test/', userId: 'alice', indexedDB: factory })
    const bob = await createActivityQueue({ origin: 'https://school.test', userId: 'bob', indexedDB: factory })
    await alice.enqueue(event('a', 1)); await alice.enqueue(event('b', 2)); await bob.enqueue(event('c', 1))
    await alice.acknowledge(['a'])
    expect((await alice.peekBatch(10, 64_000)).map(row => row.id)).toEqual(['b'])
    expect((await bob.peekBatch(10, 64_000)).map(row => row.id)).toEqual(['c'])
  })

  it('is idempotent, deterministic, and coalesces superseded progress', async () => {
    const queue = await createActivityQueue({ origin: 'https://school.test', userId: 'alice', indexedDB: new IDBFactory() })
    await queue.enqueue(event('later', 2)); await queue.enqueue(event('earlier', 1)); await queue.enqueue(event('later', 2))
    expect((await queue.peekBatch(10, 64_000)).map(row => row.id)).toEqual(['later'])
  })

  it('drops progress before lifecycle events at capacity and counts drops', async () => {
    const queue = await createActivityQueue({ origin: 'https://school.test', userId: 'alice', indexedDB: new IDBFactory(), maxEvents: 2 })
    await queue.enqueue(event('start', 0, 'activity.started'))
    await queue.enqueue(event('progress', 1))
    await queue.enqueue(event('done', 2, 'activity.completed'))
    expect((await queue.peekBatch(10, 64_000)).map(row => row.id)).toEqual(['start', 'done'])
    expect(await queue.stats()).toMatchObject({ count: 2, dropped: 1, droppedReasons: { coalesced_progress: 1 } })
  })

  it('rejects malformed events and reports unavailable IndexedDB', async () => {
    await expect(createActivityQueue({ origin: 'https://school.test', userId: 'alice', indexedDB: undefined })).rejects.toThrow()
    const queue = await createActivityQueue({ origin: 'https://school.test', userId: 'alice', indexedDB: new IDBFactory() })
    await expect(queue.enqueue({ ...event('bad', 1), sequence: Number.NaN })).rejects.toThrow('Invalid')
  })
})
