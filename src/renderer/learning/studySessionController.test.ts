import { describe, expect, it, vi } from 'vitest';
import { createStudySessionController, type StudySessionLocks } from './studySessionController';

function harness(skipAttempts = false) {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  let chain = Promise.resolve();
  const locks: StudySessionLocks = {
    request: async <T,>(_name: string, callback: () => T | Promise<T>): Promise<T> => {
      const job = chain.then(callback);
      chain = job.then(() => undefined, () => undefined);
      return job;
    },
  };
  const write = vi.fn<(_attemptId: string) => Promise<void>>();
  const make = () => createStudySessionController({
    storageKey: 'study:test', lockKey: 'study-lock:test', storage, locks,
    shouldSkipAttempt: skipAttempts ? () => true : undefined,
    validate: (record) => record.identity === 'package-v1'
      && record.queue.length === 3 && record.queue.every((item) => typeof item.id === 'string'),
    writeAttempt: async (pending) => write(pending.attemptId),
    next: (record) => ({ index: record.index + 1, meta: record.meta }),
  });
  return { make, write, values, storage };
}

describe('shared study session controller', () => {
  it('pins a competing question before presentation without recording an encounter or losing its decision on restart', async () => {
    const h = harness();
    const first = h.make();
    await first.start('package-v1', [{ id: 'one' }, { id: 'two' }, { id: 'three' }], 0, {});
    const anchor = first.current()!;
    const meta = { decision: { id: 'choice-1', selected: 'three', baseline: 'one' } };
    expect(await first.selectQuestion(anchor, 2, meta)).toBe(true);
    expect(first.current()).toMatchObject({ index: 2, visited: [], rated: 0, revealed: false, meta });
    expect(h.write).not.toHaveBeenCalled();
    const restored = h.make();
    expect(restored.current()).toEqual(first.current());
    expect(await restored.selectQuestion(restored.current()!, 1, {})).toBe(false);
    expect(await first.selectQuestion(anchor, 1, {})).toBe(false);
    await restored.reveal(restored.current()!);
    expect(await restored.selectQuestion(restored.current()!, 0, {})).toBe(false);
    first.dispose(); restored.dispose();
  });

  it('refuses an invalid or already visited question and keeps the durable cursor when selection cannot persist', async () => {
    const h = harness();
    const first = h.make();
    await first.start('package-v1', [{ id: 'one' }, { id: 'two' }, { id: 'three' }], 0, {});
    await first.skip(first.current()!);
    const anchor = first.current()!;
    expect(await first.selectQuestion(anchor, 0, {})).toBe(false);
    expect(await first.selectQuestion(anchor, 3, {})).toBe(false);
    expect(await first.selectQuestion(anchor, 1.5, {})).toBe(false);
    h.storage.setItem = () => { throw new Error('storage full'); };
    expect(await first.selectQuestion(anchor, 2, { decision: 'not-persisted' })).toBe(false);
    expect(first.current()).toEqual(anchor);
    first.dispose();
  });
  it('rechecks a dynamic exclusion under the lock and advances as a skip without evidence', async () => {
    const h = harness(true);
    const session = h.make();
    await session.start('package-v1', [{ id: 'one' }, { id: 'two' }, { id: 'three' }], 0, {});
    await session.reveal(session.current()!);

    expect(await session.reserve(session.current()!, { quality: 'fluent' }, 'advance')).toBe(true);
    expect(session.current()?.index).toBe(1);
    expect(session.current()?.rated).toBe(0);
    expect(session.current()?.visited).toEqual([0]);
    expect(h.write).not.toHaveBeenCalled();
    session.dispose();
  });

  it('reserves one attempt, persists a failure, retries with its id, then resumes at the acknowledged cursor', async () => {
    const h = harness();
    h.write.mockRejectedValueOnce(new Error('journal unavailable')).mockResolvedValue(undefined);
    const first = h.make();
    expect(await first.start('package-v1', [{ id: 'one' }, { id: 'two' }, { id: 'three' }], 0, {})).toBe(true);
    expect(await first.reveal(first.current()!)).toBe(true);
    expect(await first.reserve(first.current()!, { quality: 'fluent' }, 'advance')).toBe(false);
    const failed = first.current()!;
    expect(failed.index).toBe(0);
    expect(failed.pending?.state).toBe('failed');
    expect(await first.skip(failed)).toBe(false);
    const resumed = h.make();
    expect(resumed.current()?.pending?.attemptId).toBe(failed.pending?.attemptId);
    await vi.waitFor(() => expect(resumed.current()?.index).toBe(1));
    expect(resumed.current()?.rated).toBe(1);
    expect(h.write.mock.calls[0][0]).toBe(h.write.mock.calls[1][0]);
    expect(await first.skip(failed)).toBe(false);
    expect(first.current()?.index).toBe(1);
    first.dispose(); resumed.dispose();
  });

  it('recovers a durable pending reservation when the shared controller resumes', async () => {
    const h = harness();
    h.write.mockResolvedValue(undefined);
    h.values.set('study:test', JSON.stringify({
      id: 'session-1', identity: 'package-v1',
      queue: [{ id: 'one' }, { id: 'two' }, { id: 'three' }],
      index: 0, visited: [], rated: 0, revealed: true, meta: {},
      pending: {
        index: 0, itemId: 'one', attemptId: 'persisted-attempt',
        payload: { quality: 'fluent' }, outcome: 'advance', state: 'pending',
      },
    }));

    const recovered = h.make();
    await vi.waitFor(() => expect(recovered.current()?.index).toBe(1));

    expect(h.write).toHaveBeenCalledOnce();
    expect(h.write).toHaveBeenCalledWith('persisted-attempt');
    expect(recovered.current()?.rated).toBe(1);
    expect(recovered.current()?.pending).toBeUndefined();
    recovered.dispose();
  });

  it('serializes concurrent recovery to one accepted attempt', async () => {
    const h = harness();
    h.write.mockResolvedValue(undefined);
    h.values.set('study:test', JSON.stringify({
      id: 'session-1', identity: 'package-v1',
      queue: [{ id: 'one' }, { id: 'two' }, { id: 'three' }],
      index: 0, visited: [], rated: 0, revealed: true, meta: {},
      pending: {
        index: 0, itemId: 'one', attemptId: 'concurrent-attempt',
        payload: { quality: 'fluent' }, outcome: 'advance', state: 'pending',
      },
    }));

    const first = h.make();
    const second = h.make();
    await vi.waitFor(() => {
      expect(first.current()?.index).toBe(1);
      expect(second.current()?.index).toBe(1);
    });

    expect(h.write).toHaveBeenCalledOnce();
    expect(h.write).toHaveBeenCalledWith('concurrent-attempt');
    first.dispose();
    second.dispose();
  });

  it('serializes skip and a competing answer across windows without evidence for the skipped item', async () => {
    const h = harness();
    h.write.mockResolvedValue(undefined);
    const a = h.make();
    await a.start('package-v1', [{ id: 'one' }, { id: 'two' }, { id: 'three' }], 0, {});
    const b = h.make();
    const stale = b.current()!;
    await a.skip(a.current()!);
    expect(await b.reveal(stale)).toBe(false);
    expect(b.current()?.queue[b.current()!.index].id).toBe('two');
    expect(h.write).not.toHaveBeenCalled();
    a.dispose(); b.dispose();
  });

  it('keeps an answered item until explicit advance and refuses a second reservation', async () => {
    const h = harness();
    h.write.mockResolvedValue(undefined);
    const session = h.make();
    await session.start('package-v1', [{ id: 'one' }, { id: 'two' }, { id: 'three' }], 0, {});
    await session.reveal(session.current()!);
    expect(await session.reserve(session.current()!, { quality: 'missed' }, 'answer', { correct: false })).toBe(true);
    expect(session.current()?.answered).toEqual({ correct: false });
    expect(session.current()?.index).toBe(0);
    expect(await session.reserve(session.current()!, { quality: 'fluent' }, 'answer', { correct: true })).toBe(false);
    expect(await session.advance(session.current()!)).toBe(true);
    expect(session.current()?.index).toBe(1);
    session.dispose();
  });

  it('retries the same reserved attempt when the evidence succeeds but cursor acknowledgement cannot persist', async () => {
    const h = harness();
    h.write.mockResolvedValue(undefined);
    const session = h.make();
    await session.start('package-v1', [{ id: 'one' }, { id: 'two' }, { id: 'three' }], 0, {});
    await session.reveal(session.current()!);
    const write = h.storage.setItem;
    let refuseAcknowledgement = true;
    vi.spyOn(h.storage, 'setItem').mockImplementation((key, value) => {
      if (refuseAcknowledgement && JSON.parse(value).index === 1) throw new Error('quota exceeded');
      write(key, value);
    });

    expect(await session.reserve(session.current()!, { quality: 'fluent' }, 'advance')).toBe(false);
    const failed = session.current()!;
    expect(failed.pending?.state).toBe('failed');
    expect(JSON.parse(h.values.get('study:test')!).pending.state).toBe('pending');
    expect(await session.skip(failed)).toBe(false);
    refuseAcknowledgement = false;
    session.dispose();
    const recovered = h.make();
    await vi.waitFor(() => expect(recovered.current()?.index).toBe(1));
    expect(h.write).toHaveBeenCalledTimes(2);
    expect(h.write.mock.calls[0][0]).toBe(h.write.mock.calls[1][0]);
    recovered.dispose();
  });
});
