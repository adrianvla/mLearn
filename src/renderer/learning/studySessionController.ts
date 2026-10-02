import { createSignal, type Accessor } from 'solid-js';
import { nextAttemptId, type AttemptId } from '../../shared/knowledgeEvents';
import type { StudyWriteState } from './studySession';

export interface StudyQueueItem {
  id: string;
}

export interface StudyPending<Payload, Answer> {
  index: number;
  itemId: string;
  attemptId: AttemptId;
  payload: Payload;
  outcome: 'advance' | 'answer';
  answer?: Answer;
  /** Non-nullable by design: this record exists only while a write is in
   *  flight or was refused; idle is the absence of the record. */
  state: StudyWriteState;
}

export interface StudySessionRecord<Item extends StudyQueueItem, Payload, Answer, Meta> {
  id: string;
  identity: string;
  queue: Item[];
  index: number;
  visited: number[];
  rated: number;
  revealed: boolean;
  /** One durable policy choice per question, including an unrevealed restart. */
  questionSelected?: boolean;
  answered?: Answer;
  pending?: StudyPending<Payload, Answer>;
  meta: Meta;
}

type RecordOf<I extends StudyQueueItem, P, A, M> = StudySessionRecord<I, P, A, M>;

const stableJson = (value: unknown): string => JSON.stringify(value, (_key, entry: unknown) => {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
  return Object.fromEntries(Object.keys(entry).sort().map((key) => [key, (entry as Record<string, unknown>)[key]]));
}) ?? 'undefined';

export interface StudySessionLocks {
  request(name: string, callback: () => void | Promise<void>): Promise<void>;
}

/** Single-window hosts without Web Locks still serialize local study actions. */
const inProcessChains = new Map<string, Promise<void>>();
export const inProcessStudySessionLocks: StudySessionLocks = {
  request: async (name, callback) => {
    const previous = inProcessChains.get(name) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(callback);
    const settled = task.then(() => undefined, () => undefined);
    inProcessChains.set(name, settled);
    try { await task; } finally {
      if (inProcessChains.get(name) === settled) inProcessChains.delete(name);
    }
  },
};

export interface StudySessionControllerOptions<I extends StudyQueueItem, P, A, M> {
  storageKey: string;
  lockKey: string;
  locks: StudySessionLocks | null;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  validate: (record: RecordOf<I, P, A, M>) => boolean;
  /** Recheck dynamic exclusion policy under the session lock before evidence is written. */
  shouldSkipAttempt?: (pending: StudyPending<P, A>, record: RecordOf<I, P, A, M>) => boolean | Promise<boolean>;
  writeAttempt: (pending: StudyPending<P, A>, record: RecordOf<I, P, A, M>) => Promise<void>;
  /** Task policy chooses a queue position; the controller owns the resulting cursor. */
  next: (record: RecordOf<I, P, A, M>, outcome: 'rated' | 'skipped' | 'advanced') => { index: number; meta: M };
  onAcknowledged?: (before: RecordOf<I, P, A, M>, after: RecordOf<I, P, A, M>, pending: StudyPending<P, A>) => void;
}

export interface StudySessionController<I extends StudyQueueItem, P, A, M> {
  current: Accessor<RecordOf<I, P, A, M> | null>;
  resume: () => RecordOf<I, P, A, M> | null;
  start: (identity: string, queue: I[], index: number, meta: M) => Promise<boolean>;
  reveal: (expected: RecordOf<I, P, A, M>) => Promise<boolean>;
  /** Persist an unpresented policy choice without counting the anchor as encountered. */
  selectQuestion: (expected: RecordOf<I, P, A, M>, index: number, meta: M) => Promise<boolean>;
  reserve: (expected: RecordOf<I, P, A, M>, payload: P, outcome: 'advance' | 'answer', answer?: A) => Promise<boolean>;
  retry: (expected: RecordOf<I, P, A, M>) => Promise<boolean>;
  skip: (expected: RecordOf<I, P, A, M>) => Promise<boolean>;
  advance: (expected: RecordOf<I, P, A, M>) => Promise<boolean>;
  updateMeta: (expected: RecordOf<I, P, A, M>, meta: M) => Promise<boolean>;
  clear: (expected: RecordOf<I, P, A, M>) => Promise<boolean>;
  undo: (expected: RecordOf<I, P, A, M>, previous: RecordOf<I, P, A, M>) => Promise<boolean>;
  dispose: () => void;
}

/**
 * One durable owner for both study tasks. Every mutation re-reads the exact
 * session under the same Web Lock before writing it. A stale window adopts
 * the durable record and drops its queued action. Evidence is written only
 * after a stable attempt reservation is durable; retries reuse that id.
 */
export function createStudySessionController<I extends StudyQueueItem, P, A, M>(
  options: StudySessionControllerOptions<I, P, A, M>,
): StudySessionController<I, P, A, M> {
  type Session = RecordOf<I, P, A, M>;
  const [current, setCurrent] = createSignal<Session | null>(null);
  let recoverPending: ((record: Session) => void) | undefined;

  const read = (): Session | null => {
    try {
      const raw = options.storage.getItem(options.storageKey);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      const record = parsed as Session;
      if (typeof record.id !== 'string' || typeof record.identity !== 'string'
        || !Array.isArray(record.queue) || !Array.isArray(record.visited)
        || !Number.isInteger(record.index) || !Number.isInteger(record.rated)
        || (record.questionSelected !== undefined && typeof record.questionSelected !== 'boolean')
        || !options.validate(record)) return null;
      if (record.pending && (record.pending.index !== record.index
        || record.pending.itemId !== record.queue[record.index]?.id
        || typeof record.pending.attemptId !== 'string')) return null;
      return record;
    } catch { return null; }
  };

  const publish = (next: Session): boolean => {
    try {
      options.storage.setItem(options.storageKey, JSON.stringify(next));
      setCurrent(next);
      return true;
    } catch { return false; }
  };

  const resume = (): Session | null => {
    const loaded = read();
    setCurrent(loaded);
    if (loaded?.pending) recoverPending?.(loaded);
    return loaded;
  };

  const locked = async (
    expected: Session | null,
    change: (record: Session | null) => Promise<boolean> | boolean,
    allowPendingStateSkew = false,
  ): Promise<boolean> => {
    if (!options.locks) return false;
    let accepted = false;
    try {
      await options.locks.request(options.lockKey, async () => {
        const durable = read();
        const exact = stableJson(durable) === stableJson(expected);
        // A failed attempt may be marked only in memory when storage refuses
        // the failure/acknowledgement write. Retrying that exact durable
        // reservation must still reuse its attempt ID.
        const sameReservation = allowPendingStateSkew && expected?.pending?.state === 'failed'
          && durable?.pending !== undefined
          && stableJson({ ...expected, pending: { ...expected.pending, state: durable.pending.state } }) === stableJson(durable);
        if (!exact && !sameReservation) {
          setCurrent(durable);
          return;
        }
        accepted = await change(durable);
      });
    } catch { return false; }
    return accepted;
  };

  const move = (record: Session, outcome: 'rated' | 'skipped' | 'advanced'): Session => {
    const visited = record.visited.includes(record.index) ? record.visited : [...record.visited, record.index];
    const step = options.next({ ...record, visited }, outcome);
    return {
      ...record,
      visited,
      index: step.index,
      meta: step.meta,
      rated: record.rated + (outcome === 'rated' ? 1 : 0),
      revealed: false,
      questionSelected: undefined,
      answered: undefined,
      pending: undefined,
    };
  };

  const settle = async (record: Session): Promise<boolean> => {
    const pending = record.pending;
    if (!pending) return false;
    try {
      if (options.shouldSkipAttempt && await options.shouldSkipAttempt(pending, record)) {
        return publish(move(record, 'skipped'));
      }
      await options.writeAttempt(pending, record);
    } catch {
      const failed = { ...record, pending: { ...pending, state: 'failed' as const } };
      if (!publish(failed)) setCurrent(failed);
      return false;
    }
    const acknowledged = pending.outcome === 'answer'
      ? { ...record, answered: pending.answer, pending: undefined }
      : move(record, 'rated');
    if (!publish(acknowledged)) {
      setCurrent({ ...record, pending: { ...pending, state: 'failed' } });
      return false;
    }
    options.onAcknowledged?.(record, acknowledged, pending);
    return true;
  };

  const onStorage = (event: StorageEvent) => {
    if (event.key === options.storageKey) resume();
  };
  globalThis.addEventListener?.('storage', onStorage);

  const controller: StudySessionController<I, P, A, M> = {
    current,
    resume,
    start: (identity, queue, index, meta) => locked(current(), (durable) => {
      if (durable && durable.index < durable.queue.length) return false;
      if (index < 0 || index > queue.length || queue.some((item) => typeof item.id !== 'string')) return false;
      const record: Session = {
        id: nextAttemptId(), identity, queue, index,
        visited: [], rated: 0, revealed: false, meta,
      };
      return options.validate(record) && publish(record);
    }),
    reveal: (expected) => locked(expected, (record) => {
      if (!record || record.pending || record.answered !== undefined || record.index >= record.queue.length) return false;
      return publish({ ...record, revealed: true });
    }),
    selectQuestion: (expected, index, meta) => locked(expected, (record) => {
      if (!record || record.pending || record.revealed || record.questionSelected || record.answered !== undefined
        || !Number.isInteger(index) || index < 0 || index >= record.queue.length || record.visited.includes(index)) return false;
      const selected = { ...record, index, meta, questionSelected: true };
      return options.validate(selected) && publish(selected);
    }),
    reserve: (expected, payload, outcome, answer) => locked(expected, async (record) => {
      if (!record || (outcome === 'advance' && !record.revealed) || record.pending || record.answered !== undefined) return false;
      const item = record.queue[record.index];
      if (!item) return false;
      const pending: StudyPending<P, A> = {
        index: record.index, itemId: item.id, attemptId: nextAttemptId(),
        payload, outcome, ...(answer !== undefined ? { answer } : {}), state: 'pending',
      };
      const reserved = { ...record, pending };
      return publish(reserved) && settle(reserved);
    }),
    retry: (expected) => locked(expected, (record) => record?.pending ? settle(record) : false, true),
    skip: (expected) => locked(expected, (record) => {
      if (!record || record.pending || record.answered !== undefined || record.index >= record.queue.length) return false;
      return publish(move(record, 'skipped'));
    }),
    advance: (expected) => locked(expected, (record) => {
      if (!record || record.pending || record.answered === undefined) return false;
      return publish(move(record, 'advanced'));
    }),
    updateMeta: (expected, meta) => locked(expected, (record) => {
      if (!record || record.pending) return false;
      return publish({ ...record, meta });
    }),
    clear: (expected) => locked(expected, (record) => {
      if (!record || record.pending) return false;
      try {
        options.storage.removeItem(options.storageKey);
        setCurrent(null);
        return true;
      } catch { return false; }
    }),
    undo: (expected, previous) => locked(expected, (record) => {
      if (!record || record.pending || record.id !== previous.id || record.identity !== previous.identity) return false;
      return publish(previous);
    }),
    dispose: () => globalThis.removeEventListener?.('storage', onStorage),
  };
  recoverPending = (record) => { void controller.retry(record); };
  resume();
  return controller;
}
