import { describe, expect, it } from 'vitest';
import type { FlashcardStore } from '../types';
import { createMobileLibraryStore, MOBILE_LIBRARY_KEYS as keys, type MobileLibraryStorage } from './mobileLibraryStore';

function candidate(rev = 0): FlashcardStore {
  return { rev, flashcards: {}, wordToCardMap: { 'package:unknown': ['card'] }, wordStatsMap: {},
    wordCandidates: {}, futurePackageState: { unknown: { values: [1, { opaque: true }] } } } as unknown as FlashcardStore;
}
function disk() {
  const data = new Map<string, string>();
  let fail: ((key: string, operation: string) => boolean) | undefined;
  const storage: MobileLibraryStorage = {
    async get(key) { if (fail?.(key, 'get')) throw new Error('read refused'); return data.get(key) ?? null; },
    async set(key, value) { if (fail?.(key, 'set')) throw new Error('write refused'); data.set(key, value); },
    async remove(key) { if (fail?.(key, 'remove')) throw new Error('remove refused'); data.delete(key); },
  };
  return { data, storage, fail: (predicate?: typeof fail) => { fail = predicate; } };
}

describe('mobile library authority', () => {
  it.each([`${keys.cards}0`, keys.meta, keys.pending])('recovers the exact detached candidate after failure at %s', async key => {
    const d = disk(); const library = createMobileLibraryStore(d.storage);
    const original = candidate(); await library.save(original);
    const next = candidate(1); next.wordToCardMap['00new'] = ['new'];
    d.fail((at, operation) => at === key && operation === (key === keys.pending ? 'remove' : 'set'));
    await expect(library.save(next)).rejects.toThrow();
    expect(next.rev).toBe(1); // No acknowledgement was fabricated.
    expect(d.data.has(keys.pending)).toBe(true);
    next.wordToCardMap['00new'] = ['mutated after failure'];
    d.fail();
    const cold = createMobileLibraryStore(d.storage);
    const recovered = await cold.load();
    expect(recovered.rev).toBe(2);
    expect(recovered.wordToCardMap['00new']).toEqual(['new']);
    expect(recovered).toHaveProperty('futurePackageState.unknown.values', [1, { opaque: true }]);
    expect(d.data.has(keys.pending)).toBe(false);
    expect(await createMobileLibraryStore(d.storage).load()).toEqual(recovered);
  });

  it('preserves opaque index identifiers that match JavaScript prototype names', async () => {
    const d = disk(); const store = candidate();
    store.wordToCardMap = JSON.parse('{"__proto__":["card"],"constructor":["other"]}');
    store.wordStatsMap = JSON.parse('{"__proto__":{"unknown":[1,{"context":true}]}}');
    await createMobileLibraryStore(d.storage).save(store);
    const loaded = await createMobileLibraryStore(d.storage).load();
    expect(loaded.wordToCardMap).toEqual(store.wordToCardMap);
    expect(loaded.wordStatsMap).toEqual(store.wordStatsMap);
  });

  it('refuses stale saves after another writer commits and retains that writer', async () => {
    const d = disk(); const a = createMobileLibraryStore(d.storage); const b = createMobileLibraryStore(d.storage);
    const original = candidate(); await a.save(original);
    const stale = await b.load(); const current = await a.load(); current.wordToCardMap['00peer'] = ['peer'];
    await a.save(current);
    await expect(b.save(stale)).rejects.toThrow(/revision/i);
    expect((await b.load()).wordToCardMap['00peer']).toEqual(['peer']);
  });

  it('serializes overlapping no-Web-Lock writers across library instances', async () => {
    const d = disk(); const a = createMobileLibraryStore(d.storage); const b = createMobileLibraryStore({ ...d.storage });
    await a.save(candidate()); const left = await a.load(); const right = await b.load();
    left.wordToCardMap['00left'] = ['left']; right.wordToCardMap['00right'] = ['right'];
    const outcomes = await Promise.allSettled([a.save(left), b.save(right)]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const failed = outcomes.find(result => result.status === 'rejected');
    expect(failed?.status === 'rejected' && String(failed.reason)).toMatch(/revision/);
    expect((await a.load()).wordToCardMap['00left']).toEqual(['left']);
  });

  it('does not overwrite any authority while reads fail', async () => {
    const d = disk(); const library = createMobileLibraryStore(d.storage); await library.save(candidate());
    const before = new Map(d.data); d.fail((key, op) => key === keys.meta && op === 'get');
    await expect(library.save(candidate(1))).rejects.toThrow('read refused');
    expect(d.data).toEqual(before);
  });

  it.each(['{bad', JSON.stringify({ version: 1, store: candidate(), removeLegacy: ['unrelated'] })])('refuses a malformed interrupted write without changing it', async raw => {
    const d = disk(); d.data.set(keys.pending, raw); const before = new Map(d.data);
    await expect(createMobileLibraryStore(d.storage).load()).rejects.toThrow();
    expect(d.data).toEqual(before);
  });

  it('refuses conflicting duplicate index entries across saved shards', async () => {
    const d = disk(); await createMobileLibraryStore(d.storage).save(candidate());
    const owner = [...d.data].find(([key, value]) => key.startsWith(keys.cards) && Object.prototype.hasOwnProperty.call(JSON.parse(value), 'package:unknown'))![0];
    const other = owner === `${keys.cards}0` ? `${keys.cards}1` : `${keys.cards}0`;
    d.data.set(other, JSON.stringify({ 'package:unknown': ['conflicting'] }));
    const before = new Map(d.data);
    await expect(createMobileLibraryStore(d.storage).load()).rejects.toThrow(/conflicting/i);
    expect(d.data).toEqual(before);
  });

  it('refuses missing or malformed committed index shards instead of replacing them', async () => {
    const d = disk(); await createMobileLibraryStore(d.storage).save(candidate());
    for (const value of [undefined, '[]', 'null', '{bad']) {
      if (value === undefined) d.data.delete(`${keys.cards}4`); else d.data.set(`${keys.cards}4`, value);
      const before = new Map(d.data);
      await expect(createMobileLibraryStore(d.storage).save(candidate(1))).rejects.toThrow();
      expect(d.data).toEqual(before);
    }
  });

  it.each(keys.legacy)('migrates %s and preserves unknown root data with its revision', async legacy => {
    const d = disk(); const old = candidate(9); d.data.set(legacy, JSON.stringify(old));
    expect(await createMobileLibraryStore(d.storage).load()).toEqual(old);
    expect(d.data.has(legacy)).toBe(false);
    expect(await createMobileLibraryStore(d.storage).load()).toEqual(old);
  });

  it('retains conflicting legacy libraries without choosing or merging them', async () => {
    const d = disk(); d.data.set(keys.legacy[0], JSON.stringify(candidate(8))); d.data.set(keys.legacy[1], JSON.stringify(candidate(9)));
    const before = new Map(d.data);
    await expect(createMobileLibraryStore(d.storage).load()).rejects.toThrow('Conflicting'); expect(d.data).toEqual(before);
  });

  it('recovers a migration interrupted while removing the old authoritative copy', async () => {
    const d = disk(); d.data.set(keys.legacy[0], JSON.stringify(candidate(9)));
    d.fail((key, op) => key === keys.legacy[0] && op === 'remove');
    await expect(createMobileLibraryStore(d.storage).load()).rejects.toThrow();
    expect(d.data.has(keys.legacy[0])).toBe(true);
    d.fail(); expect(await createMobileLibraryStore(d.storage).load()).toEqual(candidate(9));
    expect(d.data.has(keys.legacy[0])).toBe(false);
  });

  it('refuses an unknown root version or orphaned shards without overwriting them', async () => {
    for (const [key, raw] of [[keys.meta, JSON.stringify({ version: 3, flashcards: {}, shardCount: 16 })],
      [`${keys.cards}0`, JSON.stringify({ orphan: ['card'] })]]) {
      const d = disk(); d.data.set(key, raw); const before = new Map(d.data);
      await expect(createMobileLibraryStore(d.storage).save(candidate())).rejects.toThrow();
      expect(d.data).toEqual(before);
    }
  });

  it('migrates the old flat shard envelope without discarding package-owned fields', async () => {
    const d = disk(); d.data.set(keys.meta, JSON.stringify({ version: 1, shardCount: 16,
      flashcards: {}, storeMeta: { opaque: [1] }, storeVersion: 3, rev: 9, futurePackage: { unknown: true } }));
    d.data.set(`${keys.cards}0`, JSON.stringify({ 'opaque:key': ['legacy'] }));
    const first = await createMobileLibraryStore(d.storage).load();
    expect(first.rev).toBe(9); expect(first).toHaveProperty('futurePackage', { unknown: true });
    expect(first.wordToCardMap['opaque:key']).toEqual(['legacy']);
    expect(await createMobileLibraryStore(d.storage).load()).toEqual(first);
  });

  it('holds ownership until all launched writes settle after one fails', async () => {
    const d = disk(); const library = createMobileLibraryStore(d.storage); await library.save(candidate());
    let release!: () => void; let started!: () => void;
    const reached = new Promise<void>(resolve => { started = resolve; });
    const slow = new Promise<void>(resolve => { release = resolve; });
    const base = d.storage.set;
    d.storage.set = async (key, value) => {
      if (key === `${keys.cards}0`) { started(); await slow; }
      if (key === `${keys.stats}0`) throw new Error('write refused');
      await base(key, value);
    };
    const next = candidate(1); next.wordToCardMap['00slow'] = ['slow']; next.wordStatsMap['00fail'] = {} as never;
    const save = library.save(next).catch(() => undefined); await reached;
    let readSettled = false; const read = library.load().then(() => { readSettled = true; }).catch(() => undefined);
    await Promise.resolve(); expect(readSettled).toBe(false);
    d.storage.set = base; release(); await save; await read;
    expect((await library.load()).wordToCardMap['00slow']).toEqual(['slow']);
  });
});
