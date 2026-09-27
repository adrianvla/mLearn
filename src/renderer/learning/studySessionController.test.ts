import { describe, expect, it, vi } from 'vitest';
import { createStudySessionController, type StudySessionLocks } from './studySessionController';

function harness() {
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
    validate: (record) => record.identity === 'package-v1'
      && record.queue.length === 3 && record.queue.every((item) => typeof item.id === 'string'),
    writeAttempt: async (pending) => write(pending.attemptId),
    next: (record) => ({ index: record.index + 1, meta: record.meta }),
  });
  return { make, write, values, storage };
}

describe('shared study session controller', () => {
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
    expect(await resumed.retry(resumed.current()!)).toBe(true);
    expect(resumed.current()?.index).toBe(1);
    expect(resumed.current()?.rated).toBe(1);
    expect(h.write.mock.calls[0][0]).toBe(h.write.mock.calls[1][0]);
    expect(await first.skip(failed)).toBe(false);
    expect(first.current()?.index).toBe(1);
    first.dispose(); resumed.dispose();
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
    expect(await session.retry(failed)).toBe(true);
    expect(session.current()?.index).toBe(1);
    expect(h.write.mock.calls[0][0]).toBe(h.write.mock.calls[1][0]);
    session.dispose();
  });
});
