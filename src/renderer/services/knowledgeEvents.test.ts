import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeEventLog } from '../../shared/knowledgeEvents';

const journal = vi.hoisted(() => {
  const rows = new Map<string, Array<Record<string, unknown>>>();
  const query = vi.fn(async (keys: readonly string[]) => Object.fromEntries(
    keys.flatMap((key) => rows.has(key) ? [[key, rows.get(key)!]] : []),
  ));
  const append = vi.fn(async (eventsByKey: KnowledgeEventLog) => {
    for (const [key, events] of Object.entries(eventsByKey)) {
      rows.set(key, [...(rows.get(key) ?? []), ...events]);
    }
    return true;
  });
  return { rows, query, append };
});

vi.mock('../../shared/bridges', () => ({
  getBridge: () => ({
    knowledgeEvents: {
      queryKnowledgeEvents: journal.query,
      appendKnowledgeEvents: journal.append,
      onKnowledgeEventsChanged: () => () => undefined,
    },
  }),
}));

describe('knowledge event idempotent append', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    journal.rows.clear();
  });

  it('does not append the same retraction twice after an interrupted Undo acknowledgement', async () => {
    const { appendEventsIdempotentAcknowledged } = await import('./knowledgeEvents');
    const retractions: KnowledgeEventLog = {
      'ja:hash': [{ t: 1, kind: 'retraction', source: 'manual', retracts: 'attempt-1' }],
    };

    await expect(appendEventsIdempotentAcknowledged(retractions)).resolves.toBe(true);
    await expect(appendEventsIdempotentAcknowledged(retractions)).resolves.toBe(true);

    expect(journal.append).toHaveBeenCalledTimes(1);
  });

  it('deduplicates a retried attempt but accepts identical evidence under a new action id', async () => {
    const { appendEventsIdempotentAcknowledged } = await import('./knowledgeEvents');
    const rating = (attemptId: string): KnowledgeEventLog => ({
      'ja:hash': [{ t: 1, kind: 'rating', source: 'manual', quality: 'fluent', attemptId }],
    });

    await expect(appendEventsIdempotentAcknowledged(rating('action-1'))).resolves.toBe(true);
    await expect(appendEventsIdempotentAcknowledged({
      'ja:hash': [{ t: 2, kind: 'retraction', source: 'manual', retracts: 'action-1' }],
    })).resolves.toBe(true);
    await expect(appendEventsIdempotentAcknowledged(rating('action-2'))).resolves.toBe(true);
    await expect(appendEventsIdempotentAcknowledged(rating('action-2'))).resolves.toBe(true);

    const events = journal.rows.get('ja:hash') ?? [];
    expect(events.filter((event) => event.kind === 'rating').map((event) => event.attemptId)).toEqual(['action-1', 'action-2']);
    expect(events.filter((event) => event.kind === 'retraction')).toHaveLength(1);
    expect(journal.append).toHaveBeenCalledTimes(3);
  });

  it('does not publish cache invalidation for a refused append, then invalidates on retry success', async () => {
    const { appendEventsAcknowledged, eventsVersion, getEvents } = await import('./knowledgeEvents');
    const key = 'ja:hash';
    await getEvents([key]);
    const versionBefore = eventsVersion();
    journal.append.mockResolvedValueOnce(false);

    await expect(appendEventsAcknowledged({
      [key]: [{ t: 1, kind: 'status', source: 'manual', toStatus: 'known' }],
    })).resolves.toBe(false);
    expect(eventsVersion()).toBe(versionBefore);

    await expect(appendEventsAcknowledged({
      [key]: [{ t: 2, kind: 'status', source: 'manual', toStatus: 'known' }],
    })).resolves.toBe(true);
    expect(eventsVersion()).toBe(versionBefore + 1);
    await expect(getEvents([key])).resolves.toMatchObject([{ t: 2, toStatus: 'known' }]);
  });

  it('keeps word projections cached for grammar-only appends and invalidates them for word evidence', async () => {
    const { appendEventsAcknowledged, eventsVersion, wordEventsVersion } = await import('./knowledgeEvents');
    const allBefore = eventsVersion();
    const wordsBefore = wordEventsVersion();
    await appendEventsAcknowledged({
      'ja:grammar:tense:recognition': [{ t: 1, kind: 'rating', source: 'grammar', quality: 'fluent' }],
    });
    expect(eventsVersion()).toBe(allBefore + 1);
    expect(wordEventsVersion()).toBe(wordsBefore);

    await appendEventsAcknowledged({
      'ja:hash': [{ t: 2, kind: 'rating', source: 'manual', quality: 'fluent', attemptId: 'word-action' }],
    });
    expect(wordEventsVersion()).toBe(wordsBefore + 1);
  });

  it('does not let an invalidated in-flight query repopulate the cache with an older log', async () => {
    let finishStaleQuery!: (log: Awaited<ReturnType<typeof journal.query>>) => void;
    journal.query.mockImplementationOnce(() => new Promise((resolve) => {
      finishStaleQuery = resolve;
    }));

    const { appendEventsAcknowledged, getEvents } = await import('./knowledgeEvents');
    const staleRead = getEvents(['ja:hash']);
    await Promise.resolve();
    expect(finishStaleQuery).toBeTypeOf('function');

    await appendEventsAcknowledged({
      'ja:hash': [{ t: 2, kind: 'status', source: 'manual', toStatus: 'known' }],
    });
    await expect(getEvents(['ja:hash'])).resolves.toMatchObject([{ t: 2, toStatus: 'known' }]);

    finishStaleQuery({
      'ja:hash': [{ t: 1, kind: 'status', source: 'manual', toStatus: 'unknown' }],
    });
    await expect(staleRead).resolves.toMatchObject([{ t: 1, toStatus: 'unknown' }]);
    await expect(getEvents(['ja:hash'])).resolves.toMatchObject([{ t: 2, toStatus: 'known' }]);
    expect(journal.query).toHaveBeenCalledTimes(2);
  });
});
