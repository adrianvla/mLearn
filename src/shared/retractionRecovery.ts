/**
 * The durable recovery record for a study-surface Undo.
 *
 * Taking a rating back is itself a durable write that spans two places: the
 * knowledge journal (the attempt must be retracted) and the surface's own
 * projection (a card's scheduling state, a word session's position). Both
 * halves can be interrupted between the decision and its completion — the
 * window can reload, the machine can close — and when that happens the
 * in-memory undo entry is gone. The rating the learner tried to take back stays
 * applied, and nothing on screen can take it back any more.
 *
 * The record is the promise that this cannot happen: enough is written down
 * before the retraction to finish it without the window that decided it, so the
 * next load can complete it.
 *
 * The envelope is deliberately domain-neutral. Core owns the protocol — record,
 * retract, clear — and knows only the journal-facing fields. What each surface
 * puts back is its own business, carried opaquely in `restore` and interpreted
 * by whoever registered the record, so a third study surface can take a rating
 * back without core learning anything about its projection.
 */

/**
 * Which journal keys a retraction must land on, and what has to be replayed
 * once they do.
 *
 * A tombstone is routed by KEY: the reading projection only un-counts an
 * attempt where it later finds the tombstone, so writing one to the wrong key
 * retracts nothing while still looking like a completed Undo. Deriving those
 * keys therefore belongs to whoever wrote the attempt, not to the shared Undo
 * protocol — a surface must say where its evidence lives.
 *
 * The kinds are open descriptors rather than an enum of subject types. Core
 * routes by descriptor and replays the named projection; it does not know
 * what a "pattern" is, and a surface for a subject kind core has never seen
 * adds no branch here.
 */
export interface RetractionReplayDescriptor {
  kind: string;
  /** Package- or surface-owned parameters, preserved without normalization. */
  [field: string]: unknown;
}

export interface RetractionTarget {
  /**
   * Exact journal keys the attempt being retracted was written to. These are
   * the keys the surface's own writer used — not keys re-derived from the
   * subject — so a retracted attempt is always reachable at the place it
   * actually landed.
 */
  keys: readonly string[];
  /**
   * Which derived projection to replay afterwards, so the retracted attempt
   * stops counting in what the learner sees rather than lingering until the
   * next unrelated write happens to refresh it.
 */
  replay: RetractionReplayDescriptor;
}

/** The stable identity of the retraction a record belongs to. */
export interface PendingRetraction {
  /**
   * Identifies this retraction. Recovery may only finish the retraction it
   * recorded: a record replaced by a newer one is not ours to complete, and a
   * mismatch means the learner has since started a different one.
   */
  attemptId: string;
  /**
   * Which study surface owns the projection to restore. Open-ended by design:
   * it is a claim tag, not a closed catalog, so a new surface can claim its own
   * without core registering it.
   */
  surface: string;
  /** The word whose attempts are being taken back, in each surface's spelling. */
  word: string;
  language: string;
  /** The attempt ids whose journal events must be retracted. */
  attemptIds: string[];
  /**
   * Where the retracted attempts were written, so a window finishing an
   * interrupted Undo routes the tombstones exactly where the original did.
   *
   * Optional because records written before this field existed must still
   * recover: an absent target falls back to the word-form routing those
   * records were written under, rather than being discarded mid-undo.
   */
  target?: RetractionTarget;
  /** The surface's own projection state, opaque to core and to this store. */
  restore: unknown;
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

/**
 * Whether a value is a record complete enough to act on.
 *
 * A corrupt or truncated record must not be treated as "nothing to recover" —
 * that is exactly the silent loss the record exists to prevent — but it also
 * must not be trusted enough to act on half of. Rejecting it is the safe middle:
 * the retraction stays visibly un-finished in the journal rather than being
 * half-applied from half a record.
 *
 * `restore` is deliberately not validated here. Its shape is the registering
 * surface's business, and only that surface can say whether it is usable — so
 * each surface validates its own payload before relying on it.
 */
export function isPendingRetraction(value: unknown): value is PendingRetraction {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.attemptId === 'string' && record.attemptId.length > 0
    && typeof record.surface === 'string' && record.surface.length > 0
    && typeof record.word === 'string'
    && typeof record.language === 'string'
    && isStringArray(record.attemptIds)
    // `undefined` counts as absent: a record whose projection did not survive
    // the write is truncated, not a surface that restores nothing.
    && record.restore !== undefined;
}

/**
 * Normalizes whatever was on disk into a record recovery can act on, or null.
 *
 * Also understands the pre-envelope record: the flashcard review path used to
 * persist its own bespoke `pendingReviewUndo` shape. Those stores are upgraded
 * in place on read rather than discarded, because discarding one would strand
 * exactly the interrupted Undo the record was written to rescue.
 */
export function readPendingRetraction(stored: unknown): PendingRetraction | null {
  if (isPendingRetraction(stored)) return stored;
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) return null;
  const legacy = stored as Record<string, unknown>;
  if (typeof legacy.attemptId !== 'string' || !legacy.attemptId) return null;
  if (typeof legacy.word !== 'string' || typeof legacy.language !== 'string') return null;
  const {
    attemptId, word, language,
    type, cardId, restoreCard, restorePerLanguage, today, restoreDailyStats,
  } = legacy;
  if (typeof cardId !== 'string') return null;
  return {
    attemptId,
    surface: 'flashcard-review',
    word,
    language,
    attemptIds: [attemptId],
    restore: { type, cardId, restoreCard, restorePerLanguage, today, restoreDailyStats },
  };
}

/**
 * How a write says which in-flight retraction it is finishing, if any.
 *
 * The store is a whole snapshot, so "this store has no pending retraction" is
 * ambiguous on its own: it means either "I decided nothing is pending" or "I
 * have not seen the decision yet". Collapsing those two is how an unrelated
 * window's ordinary save used to delete a record the learner was relying on.
 * Naming the retraction being completed tells the two apart without keeping a
 * second copy of the record in step.
 */
export interface RetractionCompletionClaim {
  /** The retraction this write is completing, by its stable identity. */
  attemptId: string;
}

/**
 * Reads a write's completion claim, or null when it makes none.
 *
 * A claim only means something if the write really did drop the record: a write
 * that still carries `pendingRetraction` is not finishing anything, whatever
 * it claims.
 */
export function readRetractionCompletionClaim(store: {
  pendingRetraction?: unknown;
  retractionCompleted?: unknown;
}): RetractionCompletionClaim | null {
  const attemptId = store.retractionCompleted;
  if (typeof attemptId !== 'string' || !attemptId) return null;
  if (readPendingRetraction(store.pendingRetraction)) return null;
  return { attemptId };
}

/**
 * Puts a record into the canonical form it is stored and read back in.
 *
 * The record is persisted as JSON, so this is the same normalization the
 * storage layer performs — which also means the in-memory copy can never hold
 * anything a later load would not get back identically. A plain deep copy is
 * not enough: a record read out of a reactive store is a proxy, and cloning or
 * holding it by reference would let a later mutation rewrite a recovery record
 * that is already on disk.
 */
export function clonePendingRetraction(record: PendingRetraction): PendingRetraction {
  return JSON.parse(JSON.stringify(record)) as PendingRetraction;
}
