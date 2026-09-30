import type { KnowledgeEventLog } from './knowledgeEvents';
import { applyStorePatchInPlace, copyStoreWithPatch, getStorePath, setStorePath, type StorePatch } from './utils/storePatch';

/** One stable attempt, including the scheduler and its observation provenance. */
export interface FlashcardRatingCommand {
  attemptId: string;
  patch: StorePatch;
  events: KnowledgeEventLog;
  /** Additive counters must survive another window rating from the same revision. */
  counterDeltas?: readonly {
    path: readonly string[];
    delta: number;
    /** A changed counter scope (for example study date) starts from zero. */
    scope?: { path: readonly string[]; value: unknown };
  }[];
}

/** The committed batch, broadcast once regardless of how many attempts it contains. */
export interface FlashcardRatingCommit {
  patch: StorePatch;
  rev: number;
  attemptIds: readonly string[];
}

export function applyFlashcardRatingCommand<T extends object>(source: T, command: FlashcardRatingCommand, inPlace = false): T {
  const record = source as Record<string, unknown>;
  const counters = (command.counterDeltas ?? []).map(({ path, delta, scope }) => {
    if (!Number.isFinite(delta) || !command.patch.entries.some(entry =>
      entry.path.length <= path.length && entry.path.every((segment, index) => path[index] === segment))) {
      throw new Error('Invalid rating counter delta');
    }
    const current = scope && !Object.is(getStorePath(record, scope.path), scope.value) ? 0 : getStorePath(record, path);
    if (current !== undefined && typeof current !== 'number') throw new Error('Invalid rating counter');
    return { path, value: ((current as number | undefined) ?? 0) + delta };
  });
  const result = inPlace ? source : copyStoreWithPatch(source, command.patch);
  if (inPlace) applyStorePatchInPlace(record, command.patch);
  if (inPlace) {
    for (const { path, value } of counters) setStorePath(result as Record<string, unknown>, path, value);
    return result;
  }
  return copyStoreWithPatch(result, { baseRev: command.patch.baseRev, entries: counters.map(({ path, value }) => ({
    path, before: getStorePath(result as Record<string, unknown>, path), after: value,
  })) });
}
