import { describe, expect, it, vi } from 'vitest';
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

  it('records answer exposure synchronously even while shared cue admission is blocked', async () => {
    const { storage } = fixture();
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const locks = { request: vi.fn(async (_name: string, callback: () => void | Promise<void>) => {
      await blocked;
      await callback();
    }) };
    const store = createReviewAssistanceStore(storage, locks);
    const audio = store.provide('one', { audio: true }, undefined, 'choice');
    const revealed = store.reveal('one', 'choice');
    expect(store.read('one', 'choice')?.revealed).toBe(true);
    await expect(revealed).resolves.toMatchObject({ revealed: true });
    expect(locks.request).toHaveBeenCalledTimes(1); // only the shared cue waits
    release();
    await audio;
    expect(store.read('one', 'choice')).toMatchObject({ revealed: true, scaffolds: { audio: true } });
  });

  it('cannot clear a later exposure of the same choice with an older acknowledgment', async () => {
    const { store } = fixture();
    const old = await store.reveal('one', 'same-choice');
    const next = await store.reveal('one', 'same-choice');
    await store.acknowledge('one', old);
    expect(store.read('one', 'same-choice')).toEqual(next);
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

  // Automatic front TTS and a learner-opened reference drawer write the SAME
  // record through the same call. The `requested` flag is the only thing that
  // tells them apart in the reference UI and diagnostics, so an
  // unattended cue must never inherit it - and a requested one must never lose
  // it to a later automatic cue.
  it('distinguishes an unattended cue from a learner-requested one', async () => {
    const { store } = fixture();
    const automatic = await store.provide('one', { audio: true }, undefined, 'choice-1', false);
    expect(automatic?.requested).toBeUndefined();
    const requested = await store.provide('one', { audio: true }, undefined, 'choice-2', true);
    expect(requested?.requested).toBe(true);
    // Each choice is scoped: the automatic one is still unattended.
    expect(store.read('one', 'choice-1')?.requested).toBeUndefined();
    expect(store.read('one', 'choice-2')?.requested).toBe(true);
  });

  it('keeps a requested cue requested when an automatic cue follows it', async () => {
    const { store } = fixture();
    await store.provide('one', { audio: true }, undefined, 'choice-1', true);
    const later = await store.provide('one', { 'provided-access:future::unknown': true }, undefined, 'choice-1', false);
    expect(later?.requested).toBe(true);
  });

  it('rejects a malformed requested flag rather than guessing its meaning', async () => {
    const { store, values } = fixture();
    await store.provide('one', { audio: true }, undefined, 'choice-1', true);
    const key = store.key('one');
    const raw = JSON.parse(values.get(key)!) as { choices: Record<string, { requested: unknown }> };
    raw.choices['choice-1']!.requested = 'yes';
    values.set(key, JSON.stringify(raw));
    expect(() => store.read('one', 'choice-1')).toThrow('Invalid review assistance record');
  });

  it('propagates refused storage writes and malformed records rather than claiming no assistance', async () => {
    const { store, storage, values } = fixture();
    storage.setItem = () => { throw new Error('quota'); };
    await expect(store.provide('one', { audio: true })).rejects.toThrow('quota');
    values.set(store.key('one'), '{"revision":"test","scaffolds":{"answer":"yes"}}');
    expect(() => store.read('one')).toThrow();
  });
});
