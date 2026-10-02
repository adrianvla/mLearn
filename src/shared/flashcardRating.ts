import type { KnowledgeEventLog } from './knowledgeEvents';
import type { PendingRetraction } from './retractionRecovery';
import { applyStorePatchInPlace, copyStoreWithPatch, getStorePath, setStorePath, type StorePatch } from './utils/storePatch';

/** One stable attempt, including the scheduler and its observation provenance. */
export interface FlashcardRatingCommand {
  attemptId: string;
  /** A durable pre-presentation choice, including wholly assisted responses. */
  decisionId?: string;
  /** Actual input captured by the response producer, compared opaquely at admission. */
  presentation?: Record<string, unknown>;
  /** The original surface rollback, retained separately from compacted receipts. */
  undo?: PendingRetraction;
  patch: StorePatch;
  events: KnowledgeEventLog;
  /** First admission must still address these captured card pre-images. */
  guardCardIds?: readonly string[];
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

/** Scheduling counters compose across windows independently of their scalar pre-images. */
export function ratingCounterDeltas(patch: StorePatch): NonNullable<FlashcardRatingCommand['counterDeltas']> {
  const counterDeltas: NonNullable<FlashcardRatingCommand['counterDeltas']>[number][] = [];
  for (const entry of patch.entries) {
    const fields = entry.path[0] === 'flashcards' ? ['reviews', 'lapses']
      : entry.path[0] === 'meta' ? ['newCardsToday', 'reviewsToday']
        : entry.path[0] === 'dailyStats' ? ['newCardsStudied', 'reviewCardsStudied', 'lapses', 'timeSpent', 'graduated'] : [];
    for (const field of fields) {
      const changedDate = entry.path[0] === 'meta' &&
        (entry.before as Record<string, unknown> | undefined)?.newCardsDate !==
        (entry.after as Record<string, unknown> | undefined)?.newCardsDate;
      const before = changedDate ? 0 : (entry.before as Record<string, unknown> | undefined)?.[field] ?? 0;
      const after = (entry.after as Record<string, unknown> | undefined)?.[field];
      if (typeof before === 'number' && typeof after === 'number' && before !== after) {
        counterDeltas.push({ path: [...entry.path, field], delta: after - before,
          ...(entry.path[0] === 'meta' ? { scope: { path: [...entry.path, 'newCardsDate'],
            value: (entry.after as Record<string, unknown>).newCardsDate } } : {}),
        });
      }
    }
  }
  return counterDeltas;
}
