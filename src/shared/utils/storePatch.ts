/**
 * ONE description of "what changed in the flashcard store", used by every layer
 * that has to move a store between processes or into a reactive proxy.
 *
 * A rating touches a handful of entries: one card, one or two `wordKnowledge`
 * entries, one `wordStatsMap` entry, the per-language counters, and today's
 * daily stats. The renderer used to re-DERIVE that set by structurally diffing
 * two deep clones, which walked every card in the collection twice per rating
 * and so scaled with the whole library rather than with the card being rated.
 * Callers that already know which entries they touched now declare them, and the
 * same description drives both the main-process apply and the reactive apply, so
 * the two cannot drift apart.
 *
 * Paths are declared, not re-derived: `recordSet` is called by the same code
 * that performs the write, so a write cannot be silently dropped. `applyStorePatch`
 * deep-copies on the way in, so an applied value never aliases live state.
 */

export interface StorePatchEntry {
  /** Path from the store root, e.g. `['flashcards', cardId]`. */
  readonly path: readonly string[];
  /** The entry as it was before the command ran, for a leaf-level merge. */
  readonly before: unknown;
  /** The entry as the command left it. */
  readonly after: unknown;
}

export interface StorePatch {
  readonly entries: readonly StorePatchEntry[];
  /** The store revision this patch was computed against. */
  readonly baseRev: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Deep copy, so a patched value never aliases the source it came from. */
const copyValue = <T>(value: T): T =>
  value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;

const pathKey = (path: readonly string[]): string => JSON.stringify(path);

/** Accumulates declared writes into a patch. Later writes to a path win. */
export class StorePatchRecorder {
  private readonly entries = new Map<string, StorePatchEntry>();

  /**
   * The store as it was before the command ran, read to capture each entry's
   * pre-image. It is what makes a concurrent edit to a *sibling* field survive:
   * the merge is done per leaf against this pre-image rather than by replacing
   * the whole entry with the command's post-image.
   */
  constructor(private readonly base: Record<string, unknown>) {}

  /**
   * Records a write to `path`. The value is copied immediately, so the patch
   * captures the value as of the write rather than as of `build()`; callers
   * that keep mutating an object afterwards must record it once it is settled.
   */
  set(path: readonly string[], value: unknown): void {
    this.entries.set(pathKey(path), {
      path: [...path],
      before: copyValue(getStorePath(this.base, path)),
      after: copyValue(value),
    });
  }

  /** Records a delete of `path`. */
  remove(path: readonly string[]): void {
    this.entries.set(pathKey(path), { path: [...path], before: copyValue(getStorePath(this.base, path)), after: undefined });
  }

  /** Whether anything has been recorded yet. */
  get isEmpty(): boolean {
    return this.entries.size === 0;
  }

  /** Snapshot of everything recorded so far, detached from the recorder. */
  build(baseRev: number): StorePatch {
    return {
      baseRev,
      entries: [...this.entries.values()].map((entry) => ({
        path: [...entry.path],
        before: entry.before,
        after: entry.after,
      })),
    };
  }
}

export const storePatchRecorder = (base: Record<string, unknown>): StorePatchRecorder =>
  new StorePatchRecorder(base);

/** Reads the current value at `path`. */
export function getStorePath(source: Record<string, unknown>, path: readonly string[]): unknown {
  let cursor: unknown = source;
  for (const segment of path) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

/** Writes `value` at `path` in place, creating intermediate records as needed. */
export function setStorePath(target: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let cursor: Record<string, unknown> = target;
  for (let index = 0; index < path.length - 1; index++) {
    const next = cursor[path[index]];
    if (!isRecord(next)) cursor[path[index]] = {};
    cursor = cursor[path[index]] as Record<string, unknown>;
  }
  cursor[path[path.length - 1]] = value;
}

/** Snapshot only the command's read/write paths, detached from the live store. */
export function snapshotStorePaths(source: Record<string, unknown>, paths: readonly (readonly string[])[]): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  for (const path of paths) setStorePath(snapshot, path, copyValue(getStorePath(source, path)));
  return snapshot;
}

/**
 * Apply onto a private copy of the touched branches. Unchanged branches are
 * shared with the previous immutable snapshot; a failed write leaves it intact.
 */
export function copyStoreWithPatch<T extends object>(source: T, patch: StorePatch): T {
  const result = { ...source } as Record<string, unknown>;
  const copied = new Set<object>();
  for (const entry of patch.entries) {
    let cursor = result;
    for (const segment of entry.path.slice(0, -1)) {
      const current = cursor[segment];
      if (!isRecord(current)) cursor[segment] = {};
      else if (!copied.has(current)) cursor[segment] = { ...current };
      cursor = cursor[segment] as Record<string, unknown>;
      copied.add(cursor);
    }
    applyStorePatch(result, [entry]);
  }
  return result as T;
}

/**
 * Merges a patch into a store, creating intermediate records as needed.
 *
 * Each entry is merged LEAF BY LEAF against its pre-image rather than
 * replacing the whole entry. That is what lets a write touch a handful of
 * entries and still preserve an edit that landed on a different field of the
 * same entry while this write was in flight — the behaviour the previous
 * structural diff provided.
 */
export function applyStorePatch(
  target: Record<string, unknown>,
  patch: StorePatch | readonly StorePatchEntry[],
): void {
  applyPatch(target, patch, mergeEntry);
}

/** Preserve Solid entry identities so field edits do not invalidate collection keys. */
export function applyStorePatchInPlace(target: Record<string, unknown>, patch: StorePatch | readonly StorePatchEntry[]): void {
  applyPatch(target, patch, mergeEntryInPlace);
}

function applyPatch(
  target: Record<string, unknown>,
  patch: StorePatch | readonly StorePatchEntry[],
  merge: (current: unknown, before: unknown, after: unknown) => unknown,
): void {
  const entries: readonly StorePatchEntry[] = Array.isArray(patch)
    ? patch as readonly StorePatchEntry[]
    : (patch as StorePatch).entries;
  for (const { path, before, after } of entries) {
    if (path.length === 0) continue;
    let cursor: Record<string, unknown> = target;
    for (let index = 0; index < path.length - 1; index++) {
      const next = cursor[path[index]];
      if (!isRecord(next)) cursor[path[index]] = {};
      cursor = cursor[path[index]] as Record<string, unknown>;
    }
    const name = path[path.length - 1];
    if (after === undefined) {
      delete cursor[name];
    } else {
      cursor[name] = merge(cursor[name], before, after);
    }
  }
}

function mergeEntryInPlace(current: unknown, before: unknown, after: unknown): unknown {
  if (!isRecord(current) || !isRecord(before) || !isRecord(after)) return copyValue(after);
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (Object.is(before[key], after[key])) {
      if (!(key in current) && key in after) current[key] = copyValue(after[key]);
    } else if (!(key in after)) {
      delete current[key];
    } else {
      current[key] = mergeEntryInPlace(current[key], before[key], after[key]);
    }
  }
  return current;
}

/**
 * Merge one entry's post-image onto whatever the target currently holds.
 *
 * A leaf the command left unchanged keeps the target's value, so a concurrent
 * edit to that leaf survives. A leaf the command changed is taken from the
 * post-image.
 */
function mergeEntry(current: unknown, before: unknown, after: unknown): unknown {
  if (!isRecord(before) || !isRecord(after)) return copyValue(after);
  const result: Record<string, unknown> = isRecord(current) ? { ...current } : {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const priorValue = before[key];
    const nextValue = after[key];
    if (Object.is(priorValue, nextValue)) {
      // Unchanged by the command: whatever the target holds wins.
      if (key in result) continue;
      if (key in after) result[key] = copyValue(after[key]);
      continue;
    }
    if (!(key in after)) {
      delete result[key];
    } else {
      result[key] = mergeEntry(result[key], priorValue, nextValue);
    }
  }
  return result;
}
