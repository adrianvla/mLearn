import { describe, expect, it } from 'vitest';
import { createReviewAssistanceStore } from './reviewAssistance';

function fixture() {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  return { storage, values, store: createReviewAssistanceStore(storage, null) };
}

describe('durable review assistance', () => {
  it('preserves arbitrary supplied capabilities across a new store and separates cards and languages', async () => {
    const { storage, store } = fixture();
    await store.provide('one', { 'provided-access:future::unexpected': true });
    const resumed = createReviewAssistanceStore(storage, null);
    expect(resumed.read('one', 'original-choice')?.scaffolds).toEqual({ 'provided-access:future::unexpected': true });
    expect(resumed.read('another-language-or-card')).toBeNull();
  });

  it('retains answer exposure across reopening and subsequent cues until its own acknowledgment', async () => {
    const { storage, store } = fixture();
    const exposed = await store.reveal('one', 'original-choice');
    const resumed = createReviewAssistanceStore(storage, null);
    expect(resumed.read('one', 'original-choice')).toMatchObject({ revealed: true, scaffolds: {} });
    await resumed.provide('one', { 'provided-access:future::opaque': true }, undefined, 'original-choice');
    expect(resumed.read('one', 'original-choice')).toMatchObject({ revealed: true, scaffolds: { 'provided-access:future::opaque': true } });
    await resumed.acknowledge('one', exposed);
    expect(resumed.read('one', 'original-choice')).not.toBeNull();
    await resumed.acknowledge('one', resumed.read('one', 'original-choice'));
    expect(resumed.read('one', 'original-choice')).toBeNull();
  });

  it('retains both choice exposures when an older window reveals after a newer one', async () => {
    const { store, storage } = fixture();
    const peer = createReviewAssistanceStore(storage, null);
    await peer.reveal('one', 'new-choice');
    await store.reveal('one', 'old-choice', () => true);
    expect(peer.read('one', 'new-choice')?.revealed).toBe(true);
    expect(peer.read('one', 'old-choice')?.revealed).toBe(true);
    await store.acknowledge('one', store.read('one', 'old-choice'));
    expect(peer.read('one', 'new-choice')?.revealed).toBe(true);
    expect(peer.read('one', 'old-choice')?.revealed).toBeUndefined();
  });

  it('merges concurrent exposure and refuses to clear newer exposure with an older rating acknowledgment', async () => {
    const { store } = fixture();
    const [first] = await Promise.all([
      store.provide('one', { audio: true }),
      store.provide('one', { 'provided-access:future::unknown': true }),
    ]);
    expect(store.read('one')?.scaffolds).toEqual({ audio: true, 'provided-access:future::unknown': true });
    await store.acknowledge('one', first);
    expect(store.read('one')).not.toBeNull();
    const latest = store.read('one')!;
    await store.acknowledge('one', latest);
    expect(store.read('one')).toBeNull();
  });

  it('never clears a supplied cue just because a later presentation hides it', async () => {
    const { store } = fixture();
    await store.provide('one', { audio: true });
    await store.provide('one', { audio: false, 'provided-access:future::unknown': true });
    expect(store.read('one')?.scaffolds.audio).toBe(true);
  });

  it('propagates refused storage writes and malformed records rather than claiming no assistance', async () => {
    const { store, storage, values } = fixture();
    storage.setItem = () => { throw new Error('quota'); };
    await expect(store.provide('one', { audio: true })).rejects.toThrow('quota');
    values.set(store.key('one'), '{"revision":"test","scaffolds":{"answer":"yes"}}');
    expect(() => store.read('one')).toThrow();
  });
});
