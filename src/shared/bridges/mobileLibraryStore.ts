import type { FlashcardStore } from '../types';
import { staleFlashcardRevisionMessage } from '../flashcardWriteRevision';
import { hashWordSync } from '../utils/wordHash';

export const MOBILE_LIBRARY_KEYS = {
  meta: 'flashcards_meta', pending: 'flashcards_pending_write',
  cards: 'flashcards_cards_shard_', stats: 'flashcards_stats_shard_',
  legacy: ['mlearn-flashcards', 'flashcards'] as readonly string[],
};
const SHARDS = 16;

export interface MobileLibraryStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
export interface MobileLibraryLocks {
  request<T>(name: string, operation: () => Promise<T>): Promise<T>;
}
interface PendingWrite { version: 1; store: FlashcardStore; removeLegacy: string[] }
interface RootEnvelope { version: 2; shardCount: number; store: Omit<FlashcardStore, 'wordToCardMap' | 'wordStatsMap'> }

function isMap(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function checkedStore(value: unknown): FlashcardStore {
  if (!isMap(value) || !isMap(value.flashcards)
    || (value.wordToCardMap !== undefined && !isMap(value.wordToCardMap))
    || (value.wordStatsMap !== undefined && !isMap(value.wordStatsMap))
    || (value.rev !== undefined && (!Number.isSafeInteger(value.rev) || (value.rev as number) < 0))) {
    throw new Error('The saved flashcard library has an invalid structure');
  }
  return { ...value, wordToCardMap: value.wordToCardMap ?? {}, wordStatsMap: value.wordStatsMap ?? {} } as unknown as FlashcardStore;
}
function detach<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function shard(map: Record<string, unknown>): string[] {
  const pieces: Record<string, unknown>[] = Array.from({ length: SHARDS }, () => Object.create(null) as Record<string, unknown>);
  for (const [key, value] of Object.entries(map)) {
    const prefix = /^[0-9a-f]{2}/i.test(key) ? key.slice(0, 2) : hashWordSync(key).slice(0, 2);
    pieces[parseInt(prefix, 16) % SHARDS][key] = value;
  }
  return pieces.map(piece => JSON.stringify(piece));
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!isMap(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, stable(value[key])]));
}
function sameLibrary(left: FlashcardStore, right: FlashcardStore): boolean {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

// Bridge factories share this runtime owner even when Web Locks are absent.
// Web Locks additionally serialize writers in other same-origin contexts.
let runtimeQueue: Promise<unknown> = Promise.resolve();

/** One durable library authority. An admitted candidate is recovered before any later access. */
export function createMobileLibraryStore(storage: MobileLibraryStorage, locks?: MobileLibraryLocks) {
  let cachedCards: string[] | undefined;
  let cachedStats: string[] | undefined;
  function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const task = runtimeQueue.then(() => locks ? locks.request('mlearn-mobile-library', operation) : operation());
    runtimeQueue = task.catch(() => undefined);
    return task;
  }
  async function persist(pending: PendingWrite, force: boolean): Promise<void> {
    const cards = shard(pending.store.wordToCardMap);
    const stats = shard(pending.store.wordStatsMap);
    const writes: Promise<void>[] = [];
    for (let index = 0; index < SHARDS; index++) {
      if (force || cards[index] !== cachedCards?.[index]) writes.push(storage.set(`${MOBILE_LIBRARY_KEYS.cards}${index}`, cards[index]));
      if (force || stats[index] !== cachedStats?.[index]) writes.push(storage.set(`${MOBILE_LIBRARY_KEYS.stats}${index}`, stats[index]));
    }
    // Wait for every launched writer before releasing ownership after a failure.
    const outcomes = await Promise.allSettled(writes);
    const failed = outcomes.find(result => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    const { wordToCardMap: _cards, wordStatsMap: _stats, ...root } = pending.store;
    const envelope: RootEnvelope = { version: 2, shardCount: SHARDS, store: root };
    await storage.set(MOBILE_LIBRARY_KEYS.meta, JSON.stringify(envelope));
    for (const key of pending.removeLegacy) await storage.remove(key);
    await storage.remove(MOBILE_LIBRARY_KEYS.pending);
    cachedCards = cards; cachedStats = stats;
  }
  async function recover(): Promise<void> {
    const raw = await storage.get(MOBILE_LIBRARY_KEYS.pending);
    if (raw === null) return;
    const record: unknown = JSON.parse(raw);
    if (!isMap(record) || record.version !== 1 || !Array.isArray(record.removeLegacy)
      || record.removeLegacy.some(key => typeof key !== 'string' || !MOBILE_LIBRARY_KEYS.legacy.includes(key))) {
      throw new Error('The interrupted library write is unreadable');
    }
    const pending: PendingWrite = { version: 1, store: checkedStore(record.store), removeLegacy: record.removeLegacy as string[] };
    try { await persist(pending, true); }
    catch (error) { cachedCards = undefined; cachedStats = undefined; throw error; }
  }
  async function admit(store: FlashcardStore, removeLegacy: string[] = []): Promise<void> {
    const pending: PendingWrite = { version: 1, store: checkedStore(detach(store)), removeLegacy };
    // No library shard changes before its exact candidate is durable.
    await storage.set(MOBILE_LIBRARY_KEYS.pending, JSON.stringify(pending));
    try { await persist(pending, false); }
    catch (error) { cachedCards = undefined; cachedStats = undefined; throw error; }
  }
  async function readCommitted(): Promise<FlashcardStore> {
    const [metaRaw, ...legacyRaws] = await Promise.all([
      storage.get(MOBILE_LIBRARY_KEYS.meta), ...MOBILE_LIBRARY_KEYS.legacy.map(key => storage.get(key)),
    ]);
    const candidates: FlashcardStore[] = [];
    const removeLegacy: string[] = [];
    let modern = false;
    if (metaRaw !== null) {
      const meta: unknown = JSON.parse(metaRaw);
      if (!isMap(meta)) throw new Error('The saved flashcard library has an invalid structure');
      modern = meta.version === 2;
      if (!modern && (meta.version !== 1 || meta.shardCount !== SHARDS || !isMap(meta.flashcards))) throw new Error('The saved library root is unreadable');
      if (modern && (meta.shardCount !== SHARDS || !isMap(meta.store))) throw new Error('The saved library root is unreadable');
      const cardRaws = await Promise.all(Array.from({ length: SHARDS }, (_, index) => storage.get(`${MOBILE_LIBRARY_KEYS.cards}${index}`)));
      const statsRaws = await Promise.all(Array.from({ length: SHARDS }, (_, index) => storage.get(`${MOBILE_LIBRARY_KEYS.stats}${index}`)));
      const parse = (raws: (string | null)[]): Record<string, unknown> => {
        const result: Record<string, unknown> = Object.create(null);
        for (const raw of raws) {
          if (raw === null) { if (modern) throw new Error('A saved library index shard is missing'); continue; }
          const piece: unknown = JSON.parse(raw);
          if (!isMap(piece)) throw new Error('A saved library index shard is unreadable');
          for (const [key, value] of Object.entries(piece)) {
            if (Object.prototype.hasOwnProperty.call(result, key) && JSON.stringify(stable(result[key])) !== JSON.stringify(stable(value))) {
              throw new Error('Saved library index shards contain conflicting entries');
            }
            result[key] = value;
          }
        }
        return result;
      };
      const wordToCardMap = parse(cardRaws); const wordStatsMap = parse(statsRaws);
      // Rename only the old transport envelope fields. Package-owned fields
      // survive migration even when core cannot interpret them.
      const { version: _transportVersion, shardCount: _shardCount, lastUpdated: _lastUpdated,
        storeMeta, storeVersion, ...legacyRoot } = meta;
      const root = modern ? meta.store : { ...legacyRoot, meta: storeMeta ?? {}, version: storeVersion ?? 0 };
      candidates.push(checkedStore({ ...(root as Record<string, unknown>), wordToCardMap, wordStatsMap }));
      cachedCards = modern ? cardRaws.map(raw => JSON.stringify(JSON.parse(raw!))) : undefined;
      cachedStats = modern ? statsRaws.map(raw => JSON.stringify(JSON.parse(raw!))) : undefined;
    }
    for (let index = 0; index < legacyRaws.length; index++) if (legacyRaws[index] !== null) {
      candidates.push(checkedStore(JSON.parse(legacyRaws[index]!)));
      removeLegacy.push(MOBILE_LIBRARY_KEYS.legacy[index]);
    }
    if (metaRaw === null) {
      const existingShards = await Promise.all(Array.from({ length: SHARDS }, (_, index) =>
        Promise.all([storage.get(`${MOBILE_LIBRARY_KEYS.cards}${index}`), storage.get(`${MOBILE_LIBRARY_KEYS.stats}${index}`)])));
      if (existingShards.some(pair => pair.some(raw => raw !== null))) throw new Error('Saved library indexes have no readable root; recovery is required');
    }
    if (!candidates.length) return { flashcards: {}, wordCandidates: {}, wordToCardMap: {}, wordStatsMap: {} } as FlashcardStore;
    const store = candidates[0];
    if (candidates.some(candidate => !sameLibrary(store, candidate))) {
      throw new Error('Conflicting saved mobile libraries require recovery; no library was overwritten');
    }
    if (!modern || removeLegacy.length) await admit(store, removeLegacy);
    return detach(store);
  }
  return {
    load: () => exclusive(async () => { await recover(); return readCommitted(); }),
    save: (store: FlashcardStore): Promise<number> => {
      const candidate = checkedStore(detach(store));
      return exclusive(async () => {
        await recover();
        const current = await readCommitted();
        if ((candidate.rev ?? 0) !== (current.rev ?? 0)) throw new Error(staleFlashcardRevisionMessage(current.rev ?? 0, candidate.rev ?? 0));
        candidate.rev = (current.rev ?? 0) + 1;
        await admit(candidate);
        store.rev = candidate.rev;
        return candidate.rev;
      });
    },
    update: (mutate: (store: FlashcardStore) => FlashcardStore | Promise<FlashcardStore>): Promise<FlashcardStore> => exclusive(async () => {
      await recover();
      const current = await readCommitted();
      const candidate = checkedStore(detach(await mutate(detach(current))));
      candidate.rev = (current.rev ?? 0) + 1;
      await admit(candidate);
      return detach(candidate);
    }),
  };
}
