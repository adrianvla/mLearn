import type { KnowledgeEventLog } from './knowledgeEvents';
import type { PendingRetraction } from './retractionRecovery';
import { completeReviewEncounter, isReviewSession, reviewSessionRemaining } from './reviewSession';
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

const ADMISSION_REFUSAL_MARKER = 'mlearn-rating-admission-refused:';

/** Never-admitted responses can be released; admitted I/O failures must retry. */
export class RatingAdmissionRefusal extends Error {
  constructor(readonly attemptIds: readonly string[], reason = 'The captured review card changed before admission.') {
    super(`${reason} ${ADMISSION_REFUSAL_MARKER}${JSON.stringify(attemptIds)}`);
    this.name = 'RatingAdmissionRefusal';
  }
}

/** Electron serializes errors to messages; keep the refusal identity across IPC. */
export function refusedRatingAttemptIds(error: unknown): readonly string[] | null {
  if (error instanceof RatingAdmissionRefusal) return error.attemptIds;
  const message = error instanceof Error ? error.message : String(error);
  const index = message.indexOf(ADMISSION_REFUSAL_MARKER);
  if (index < 0) return null;
  try {
    const parsed: unknown = JSON.parse(message.slice(index + ADMISSION_REFUSAL_MARKER.length));
    return Array.isArray(parsed) && parsed.length > 0 && parsed.every(value => typeof value === 'string' && value.length > 0) ? parsed : null;
  } catch { return null; }
}

export function applyFlashcardRatingCommand<T extends object>(source: T, command: FlashcardRatingCommand, inPlace = false): T {
  const record = source as Record<string, unknown>;
  // Session progress composes like additive counters: two windows may rate
  // different frozen members from the same revision without losing a slot.
  const sessions = command.patch.entries.flatMap(entry => {
    if (entry.path.length !== 3 || entry.path[0] !== 'meta' || entry.path[1] !== 'reviewSessions') return [];
    const current = getStorePath(record, entry.path);
    if (!isReviewSession(entry.before) || !isReviewSession(entry.after) || !isReviewSession(current)
      || current.id !== entry.before.id || current.id !== entry.after.id) {
      throw new RatingAdmissionRefusal([command.attemptId], 'The review session changed before admission.');
    }
    const before = entry.before;
    const additions = entry.after.completedCardIds.filter(id => !before.completedCardIds.includes(id));
    if (additions.length !== 1 || !current.cardIds.includes(additions[0])
      || (!current.completedCardIds.includes(additions[0]) && reviewSessionRemaining(current) === 0)) {
      throw new RatingAdmissionRefusal([command.attemptId], 'The review session has no available encounter.');
    }
    return [{ path: entry.path, value: completeReviewEncounter(current, additions[0]) }];
  });
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
    for (const { path, value } of [...counters, ...sessions]) setStorePath(result as Record<string, unknown>, path, value);
    return result;
  }
  return copyStoreWithPatch(result, { baseRev: command.patch.baseRev, entries: [...counters, ...sessions].map(({ path, value }) => ({
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
