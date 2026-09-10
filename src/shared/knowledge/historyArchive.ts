import { ANKI_EASE } from '../constants';
import { ASPECT_CAPABILITY } from '../graph/types';
import type { KnowledgeEvent, Rating } from '../knowledgeEvents';
import { eventCapability, eventIsMeasurable } from '../knowledgeEvents';
import type { RetentionScheduleCache } from '../types';
import {
  applyEventToFold,
  mergeKeyFolds,
  emptyKeyFold,
  outcomeEase,
  type FoldState,
} from '../utils/projectionReplay';
import { scheduleAfterAnswer, type RetentionEvidence, type RetentionPolicy } from '../srs/retentionScheduler';

/**
 * Multi-resolution knowledge-history archive.
 *
 * The semantic model (append-only evidence journal) is unchanged; this module
 * changes only the PHYSICAL representation of old evidence. Event classes:
 *
 * - Exact forever (sparse semantic ledger): every event with an `attemptId`
 *   (undo/rerate surface), claims, retraction tombstones, and manual/grammar/
 *   srs-sourced rows. Retraction reversal always operates on exact rows.
 * - Exact while recent: every row inside the tail window.
 * - Exact forever (acquisition residue): rows inside the first acquisition
 *   window of a key, so cohort slopes keep replaying from raw evidence.
 * - Aggregatable: anki/passiveTracking/migration-style rows without an
 *   attemptId older than the tail window.
 *
 * Aggregated rows reduce into per-key, per-(capability × address-bucket)
 * sufficient statistics:
 *
 * - `fold` — the projection reducer state (`applyEventToFold`), merging
 *   exactly with the exact tail through the SAME reducer (one fold
 *   implementation for both paths).
 * - `ratings` — the retention residue column: (t, seq, rating, condition) of
 *   every measurable rating row, a few bytes each. The retention scheduler is
 *   a sequential FSM over that sequence; the column IS the sequence,
 *   compactly. This is the deliberate exact-rebuild tradeoff: canonical store
 *   bytes stay linear in RATINGS at a few bytes each (~20-30× flatter than
 *   raw JSON events) while startup, projection, and query costs stay
 *   independent of history length. Out-of-order appends (tethered sync
 *   journals rows with old recency anchors) merge by re-sorting against the
 *   column — no failure modes, no second truth.
 *
 * Address buckets carry the FULL opaque targetRef (kind|id|to) — never derived
 * from the storage key — so graph-aware target matching evaluates the matcher
 * once per homogeneous bucket (all rows in a bucket share the raw address,
 * hence share the matcher outcome for any fixed query/graph).
 */

/** Events older than this are eligible for archival aggregation. */
export const KNOWLEDGE_ARCHIVE_TAIL_MS = 180 * 24 * 60 * 60 * 1000;
/** Acquisition-window rows stay exact so cohort slopes replay from raw evidence. */
export const KNOWLEDGE_ACQUISITION_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
/** Lapse/stability window used by cohort analytics. */
export const KNOWLEDGE_STABLE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** Week points older than this merge into month points. */
export const KNOWLEDGE_WEEK_POINT_MS = 2 * 365 * 24 * 60 * 60 * 1000;

/** Sources whose rows are always part of the exact sparse ledger. */
export const LEDGER_SOURCES = new Set(['manual', 'grammar', 'srs']);

/**
 * Archival classifier. Ledger semantics first (undo must stay exact), then
 * recency, then acquisition residue. Claims and tombstones never aggregate;
 * anything retractable never aggregates — the retraction path never touches a
 * bucket.
 */
export function isAggregatableEvent(event: KnowledgeEvent, now: number): boolean {
  if (event.attemptId !== undefined) return false;
  if (event.kind === 'claim' || event.kind === 'retraction') return false;
  if (event.retracts !== undefined) return false;
  if (LEDGER_SOURCES.has(event.source)) return false;
  return event.t < now - KNOWLEDGE_ARCHIVE_TAIL_MS;
}

/** Opaque address bucket of one row: full raw targetRef, or the legacy mode. */
export function addressBucketOf(event: KnowledgeEvent): string {
  const ref = event.targetRef;
  if (!ref) return 'legacy';
  return `${ref.kind}|${ref.id}|${ref.to ?? ''}`;
}

export function archiveBucketKey(event: KnowledgeEvent): string {
  return `${eventCapability(event) ?? 'none'}\u0000${addressBucketOf(event)}`;
}

/**
 * Builds the minimal representative event for a bucket so graph-aware
 * matchers (`eventAppliesToTarget`) evaluate once per bucket. Legacy buckets
 * reproduce the aspect-routing conflation (a legacy meaning row speaks for
 * sense- and surface-recognition); address buckets carry their exact raw ref.
 */
export function bucketRepresentative(bucketKey: string): KnowledgeEvent | undefined {
  const nullAt = bucketKey.indexOf('\u0000');
  const capability = bucketKey.slice(0, nullAt);
  const address = bucketKey.slice(nullAt + 1);
  if (capability === 'none') return undefined;
  if (address === 'legacy') {
    const aspect = (Object.entries(ASPECT_CAPABILITY) as Array<[string, string]>).find(([, value]) => value === capability)?.[0]
      ?? (capability === 'grammar-recognition' ? 'grammar' : undefined);
    if (aspect === undefined) return undefined;
    return { t: 0, kind: 'status', source: 'anki', aspect: aspect as never };
  }
  const [kind, id, to] = address.split('|');
  return { t: 0, kind: 'status', source: 'anki', targetRef: { kind, id, ...(to !== '' ? { to } : {}), capability: capability as never } };
}

// ─── Cohort transitions (shared predicates; learningAnalytics reuses them) ───

export function reachesKnown(event: KnowledgeEvent): boolean {
  if (event.kind === 'rollup') return false;
  if (event.toStatus === 'known') return true;
  return event.kind === 'review' && event.source === 'anki' && (event.easeAfter ?? 0) >= ANKI_EASE.DEFAULT_KNOWN;
}

export function downgradesBelowKnown(event: KnowledgeEvent): boolean {
  if (event.kind === 'rollup') return false;
  if (event.toStatus === 'unknown' || event.toStatus === 'learning') return true;
  return event.kind === 'review' && event.rating === 'again';
}

/**
 * Resumable cohort-transition state for one bucket: the cohort scalars
 * (first known, first stable known, lapse flags) are order-determined, so
 * the accumulator freezes them at compaction and consumers continue the
 * same reduction over exact tail rows.
 */
export interface TransitionsState {
  /** First applied (sense-routed) row — the cohort "first seen" anchor. */
  firstT?: number;
  firstKnownT?: number;
  /** First stable (no lapse within the window) known — final once set. */
  stableKnownT?: number;
  /** A reachKnown candidate still inside its lapse window. */
  pendingCandidateT?: number;
  /** Any downgrade within the stable window after the first known. */
  lapsedAfterFirstKnown: boolean;
}

export function emptyTransitions(): TransitionsState {
  return { lapsedAfterFirstKnown: false };
}

export function applyTransitions(state: TransitionsState, event: KnowledgeEvent, now: number): void {
  if (state.firstT === undefined || event.t < state.firstT) state.firstT = event.t;
  if (downgradesBelowKnown(event)) {
    if (state.firstKnownT !== undefined && event.t > state.firstKnownT && event.t <= state.firstKnownT + KNOWLEDGE_STABLE_WINDOW_MS) {
      state.lapsedAfterFirstKnown = true;
    }
    if (state.pendingCandidateT !== undefined && event.t > state.pendingCandidateT && event.t <= state.pendingCandidateT + KNOWLEDGE_STABLE_WINDOW_MS) {
      state.pendingCandidateT = undefined;
    }
  }
  if (state.stableKnownT !== undefined) return;
  if (reachesKnown(event)) {
    if (state.firstKnownT === undefined) state.firstKnownT = event.t;
    if (state.pendingCandidateT === undefined) state.pendingCandidateT = event.t;
  }
  // A pending candidate survives once the scan passes its lapse window.
  if (state.pendingCandidateT !== undefined && now > state.pendingCandidateT + KNOWLEDGE_STABLE_WINDOW_MS) {
    state.stableKnownT = state.pendingCandidateT;
    state.pendingCandidateT = undefined;
  }
}

// ─── Bucket archive ───

/** Retention residue: the irreducible scheduler-FSM inputs of one rating row. */
export interface RatingResidue {
  t: number;
  /** Journal insertion order tie-break for same-timestamp rows. */
  seq: number;
  rating: Rating;
  condition?: 'assisted' | 'supplied';
}

export interface WeekPoint {
  /** Bucket key this point belongs to (capability × address). */
  b: string;
  /** ISO-week (or, past `KNOWLEDGE_WEEK_POINT_MS`, month) bucket start. */
  w: number;
  n: number;
  seen: number;
  /** Latest outcome ease within the bucket (LOD curve value). */
  ease?: number;
  /** Source of the latest evidence row within the bucket. */
  source?: string;
}

/** PERSISTED per-bucket sufficient statistics. */
export interface BucketArchive {
  /** Fold of every archived row in this bucket (the reducer state itself). */
  fold: FoldState;
  /**
   * Fold of only the measurable rows (scaffold-invalidated rows carry no
   * knowledge). Capability-scoped projection views replay this fold — the
   * raw explanation path folds `measurable && matcher` rows only.
   */
  measurableFold: FoldState;
  transitions: TransitionsState;
  /** Canonical retention residue column, ascending (t, seq). */
  ratings: RatingResidue[];
  latency: { count: number; sum: number; max?: number };
  /** Archived rows summarized by this bucket. */
  rowCount: number;
}

export interface KeyArchive {
  v: 1;
  /** (t, seq) frontier: archived rows all sort before this point. */
  frontierT: number;
  frontierSeq: number;
  /** Kept acquisition rows have t <= acquisitionCutoff. */
  acquisitionCutoff: number;
  buckets: Record<string, BucketArchive>;
  /** Total archived rows across all buckets. */
  archivedEventCount: number;
  /** Exact `ankiReviewId`s removed from the journal by compaction. */
  ankiReviewIds: number[];
  /** LOD curve points (weeks; months past the horizon), ascending. */
  weekPoints: WeekPoint[];
}

/** Compaction-internal accumulator: persisted shape + transient LOD points. */
interface TransientBucket extends BucketArchive {
  points: Map<number, WeekPoint>;
}

function emptyTransientBucket(): TransientBucket {
  return { fold: emptyKeyFold(), measurableFold: emptyKeyFold(), transitions: emptyTransitions(), ratings: [], latency: { count: 0, sum: 0 }, rowCount: 0, points: new Map() };
}

function weekStartOf(t: number): number {
  const date = new Date(t);
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

function monthStartOf(t: number): number {
  const date = new Date(t);
  date.setUTCDate(1);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

function residueOf(event: KnowledgeEvent, seq: number): RatingResidue | undefined {
  if (!eventIsMeasurable(event) || event.rating === undefined) return undefined;
  if (event.kind !== 'review' && event.kind !== 'rating') return undefined;
  return {
    t: event.t,
    seq,
    rating: event.rating,
    ...(event.retentionCondition === 'assisted' || event.retentionCondition === 'supplied' ? { condition: event.retentionCondition } : {}),
  };
}

/** Fold one row into its bucket. `seq` orders same-timestamp rows journal-first. */
function accumulateBucket(bucket: TransientBucket, bucketKey: string, event: KnowledgeEvent, seq: number, now: number): void {
  bucket.rowCount += 1;
  applyEventToFold(bucket.fold, event, seq);
  if (eventIsMeasurable(event)) applyEventToFold(bucket.measurableFold, event, seq);
  applyTransitions(bucket.transitions, event, now);
  const residue = residueOf(event, seq);
  if (residue !== undefined) bucket.ratings.push(residue);
  if (!event.stalled && eventIsMeasurable(event)) {
    const latency = event.activeLatencyMs ?? event.latencyMs;
    if (latency !== undefined) {
      bucket.latency.count += 1;
      bucket.latency.sum += latency;
      bucket.latency.max = bucket.latency.max === undefined ? latency : Math.max(bucket.latency.max, latency);
    }
  }
  const w = weekStartOf(event.t);
  let point = bucket.points.get(w);
  if (!point) {
    point = { b: bucketKey, w, n: 0, seen: 0 };
    bucket.points.set(w, point);
  }
  point.n += 1;
  point.seen += event.timesSeenDelta ?? 0;
  if (eventIsMeasurable(event)) {
    const ease = outcomeEase(event);
    if (ease !== undefined) point.ease = ease;
    point.source = event.source;
  }
}

/**
 * Pure compaction classification for one key's rows: exact ledger/recency/
 * acquisition classes stay raw, everything else folds into the archive.
 * Deterministic in row order; `seq` carries journal insertion order.
 *
 * `previous` (the key's existing archive) is merged in: newly archived rows
 * always sort after the previous frontier, so its buckets absorb them by
 * ordered accumulation — incremental compaction never discards old evidence.
 */
export function compactKeyEvents(
  events: ReadonlyArray<{ event: KnowledgeEvent; seq: number }>,
  now: number,
  previous?: KeyArchive,
): { kept: Array<{ event: KnowledgeEvent; seq: number }>; archive: KeyArchive | undefined } {
  const ordered = [...events].sort((a, b) => a.event.t - b.event.t || a.seq - b.seq);
  let firstMeaningT: number | undefined;
  for (const { event } of ordered) {
    const capability = eventCapability(event);
    if (capability === 'sense-recognition' && (firstMeaningT === undefined || event.t < firstMeaningT)) firstMeaningT = event.t;
  }
  const acquisitionCutoff = firstMeaningT !== undefined ? firstMeaningT + KNOWLEDGE_ACQUISITION_WINDOW_MS : Number.NEGATIVE_INFINITY;

  const kept: Array<{ event: KnowledgeEvent; seq: number }> = [];
  const transientBuckets = new Map<string, TransientBucket>();
  const ankiReviewIds: number[] = [...(previous?.ankiReviewIds ?? [])];
  let frontierT = previous?.frontierT ?? Number.NEGATIVE_INFINITY;
  let frontierSeq = previous?.frontierSeq ?? -1;
  let archivedAny = previous !== undefined;
  // Seed the accumulators from the previous archive so this pass extends it.
  if (previous) {
    for (const [bucketKey, bucket] of Object.entries(previous.buckets)) {
      transientBuckets.set(bucketKey, {
        ...bucket,
        fold: { ...bucket.fold },
        transitions: { ...bucket.transitions },
        ratings: bucket.ratings.map((residue) => ({ ...residue })),
        latency: { ...bucket.latency },
        points: new Map(),
      });
    }
  }

  for (const { event, seq } of ordered) {
    if (!isAggregatableEvent(event, now) || event.t <= acquisitionCutoff) {
      kept.push({ event, seq });
      continue;
    }
    archivedAny = true;
    const bucketKey = archiveBucketKey(event);
    let bucket = transientBuckets.get(bucketKey);
    if (!bucket) {
      bucket = emptyTransientBucket();
      transientBuckets.set(bucketKey, bucket);
    }
    accumulateBucket(bucket, bucketKey, event, seq, now);
    if (event.ankiReviewId !== undefined) ankiReviewIds.push(event.ankiReviewId);
    if (event.t > frontierT || (event.t === frontierT && seq > frontierSeq)) {
      frontierT = event.t;
      frontierSeq = seq;
    }
  }

  if (!archivedAny) return { kept, archive: undefined };

  const buckets: Record<string, BucketArchive> = {};
  const freshWeekPoints: WeekPoint[] = [];
  for (const [bucketKey, bucket] of transientBuckets) {
    bucket.ratings.sort((a, b) => a.t - b.t || a.seq - b.seq);
    const { points, ...persisted } = bucket;
    buckets[bucketKey] = persisted;

    // Weeks older than the LOD horizon collapse into month points. Points
    // are per-bucket so History LOD never conflates capabilities. Sparse
    // buckets (row fingerprint below threshold) collapse their WHOLE range
    // to months — LOD coverage retained at coarser resolution.
    const sparseBucket = bucket.rowCount < 20;
    const months = new Map<number, WeekPoint>();
    for (const point of points.values()) {
      if (!sparseBucket && point.w >= now - KNOWLEDGE_WEEK_POINT_MS) {
        freshWeekPoints.push(point);
        continue;
      }
      const m = monthStartOf(point.w);
      const month = months.get(m);
      if (month) {
        month.n += point.n;
        month.seen += point.seen;
        if (point.ease !== undefined) month.ease = point.ease;
        if (point.source !== undefined) month.source = point.source;
      } else {
        months.set(m, { b: point.b, w: m, n: point.n, seen: point.seen, ...(point.ease !== undefined ? { ease: point.ease } : {}), ...(point.source !== undefined ? { source: point.source } : {}) });
      }
    }
    for (const point of months.values()) freshWeekPoints.push(point);
  }

  let archivedEventCount = 0;
  for (const bucket of Object.values(buckets)) archivedEventCount += bucket.rowCount;
  return {
    kept,
    archive: {
      v: 1,
      frontierT,
      frontierSeq,
      acquisitionCutoff,
      buckets,
      archivedEventCount,
      ankiReviewIds: ankiReviewIds.sort((a, b) => a - b),
      weekPoints: previous
        ? coalesceWeekPoints([previous.weekPoints, freshWeekPoints])
        : freshWeekPoints.sort((a, b) => a.w - b.w),
    },
  };
}

/** Coalesce LOD points by (bucket, period): same-period points merge additively. */
function coalesceWeekPoints(lists: readonly WeekPoint[][]): WeekPoint[] {
  const byKey = new Map<string, WeekPoint>();
  // Later lists hold later rows — their per-period ease/source wins when both
  // sides observed the same period.
  for (const list of lists) {
    for (const point of list) {
      const key = `${point.b}\u0000${point.w}`;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { ...point });
        continue;
      }
      existing.n += point.n;
      existing.seen += point.seen;
      if (point.ease !== undefined) existing.ease = point.ease;
      if (point.source !== undefined) existing.source = point.source;
    }
  }
  return [...byKey.values()].sort((a, b) => a.w - b.w);
}

/** Merge sibling-key archives into one queryable view (disjoint row sets). */
export function mergeArchives(archives: readonly KeyArchive[]): KeyArchive | undefined {
  if (archives.length === 0) return undefined;
  if (archives.length === 1) return archives[0];
  const buckets: Record<string, BucketArchive> = {};
  const ankiReviewIds: number[] = [];
  const weekPoints: WeekPoint[] = [];
  let archivedEventCount = 0;
  let frontierT = Number.NEGATIVE_INFINITY;
  let frontierSeq = -1;
  let acquisitionCutoff = Number.POSITIVE_INFINITY;
  for (const archive of archives) {
    for (const [bucketKey, bucket] of Object.entries(archive.buckets)) {
      const target = buckets[bucketKey];
      if (!target) {
        buckets[bucketKey] = {
          ...bucket,
          fold: { ...bucket.fold },
          measurableFold: { ...bucket.measurableFold },
          transitions: { ...bucket.transitions },
          ratings: [...bucket.ratings],
          latency: { ...bucket.latency },
        };
        continue;
      }
      buckets[bucketKey] = {
        fold: mergeKeyFolds(target.fold, bucket.fold),
        measurableFold: mergeKeyFolds(target.measurableFold, bucket.measurableFold),
        transitions: mergeBucketTransitions(target.transitions, bucket.transitions),
        ratings: [...target.ratings, ...bucket.ratings].sort((a, b) => a.t - b.t || a.seq - b.seq),
        latency: {
          count: target.latency.count + bucket.latency.count,
          sum: target.latency.sum + bucket.latency.sum,
          ...(target.latency.max !== undefined || bucket.latency.max !== undefined
            ? { max: Math.max(target.latency.max ?? Number.NEGATIVE_INFINITY, bucket.latency.max ?? Number.NEGATIVE_INFINITY) }
            : {}),
        },
        rowCount: target.rowCount + bucket.rowCount,
      };
    }
    ankiReviewIds.push(...archive.ankiReviewIds);
    weekPoints.push(...archive.weekPoints);
    archivedEventCount += archive.archivedEventCount;
    if (archive.frontierT > frontierT || (archive.frontierT === frontierT && archive.frontierSeq > frontierSeq)) {
      frontierT = archive.frontierT;
      frontierSeq = archive.frontierSeq;
    }
    if (archive.acquisitionCutoff < acquisitionCutoff) acquisitionCutoff = archive.acquisitionCutoff;
  }
  return {
    v: 1,
    frontierT,
    frontierSeq,
    acquisitionCutoff,
    buckets,
    archivedEventCount,
    ankiReviewIds: [...new Set(ankiReviewIds)].sort((a, b) => a - b),
    weekPoints: coalesceWeekPoints([weekPoints]),
  };
}

/** Monotone transition merge used by archive combines (same rules as the store). */
function mergeBucketTransitions(a: TransitionsState, b: TransitionsState): TransitionsState {
  const firstKnownT = minT(a.firstKnownT, b.firstKnownT);
  const stableKnownT = minT(a.stableKnownT, b.stableKnownT);
  const pendingCandidateT = minT(a.pendingCandidateT, b.pendingCandidateT);
  return {
    lapsedAfterFirstKnown: a.lapsedAfterFirstKnown || b.lapsedAfterFirstKnown,
    ...(firstKnownT !== undefined ? { firstKnownT } : {}),
    ...(stableKnownT !== undefined ? { stableKnownT } : {}),
    ...(pendingCandidateT !== undefined ? { pendingCandidateT } : {}),
  };
}

function minT(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}

/** Merge the MEASURABLE-row bucket folds matching `match` (capability-scoped views). */
export function foldArchiveBucketsMeasurable(archive: KeyArchive, match: (representative: KnowledgeEvent) => boolean): FoldState {
  let state = emptyKeyFold();
  for (const [bucketKey, bucket] of Object.entries(archive.buckets)) {
    const representative = bucketRepresentative(bucketKey);
    if (representative && match(representative)) {
      state = mergeKeyFolds(state, bucket.measurableFold);
    }
  }
  return state;
}

/** Merge every bucket fold — the unfiltered key-level archived prefix. */
export function foldFromArchive(archive: KeyArchive): FoldState {
  let state = emptyKeyFold();
  for (const bucket of Object.values(archive.buckets)) {
    state = mergeKeyFolds(state, bucket.fold);
  }
  return state;
}

/** Merge the bucket folds whose representative matches `match`. */
export function foldArchiveBuckets(archive: KeyArchive, match: (representative: KnowledgeEvent) => boolean): FoldState {
  let state = emptyKeyFold();
  for (const [bucketKey, bucket] of Object.entries(archive.buckets)) {
    const representative = bucketRepresentative(bucketKey);
    if (representative && match(representative)) {
      state = mergeKeyFolds(state, bucket.fold);
    }
  }
  return state;
}

/** Retention evidence with the journal-order tie-break attached. */
type OrderedRetentionEvidence = RetentionEvidence & { seq: number };

/**
 * Retention replay inputs across the archive frontier.
 *
 * The full rating sequence for the matched buckets is the (t, seq)-ordered
 * merge of (a) exact matching rows with t <= frontierT (kept ledger/
 * acquisition rows and any out-of-order appended row) and (b) the matched
 * buckets' residue columns, followed by exact matching rows with
 * t > frontierT. Exactness needs no failure paths: every input row appears
 * exactly once, either as an exact row or as a residue.
 */
export function retentionSequence(
  archive: KeyArchive | undefined,
  exactRows: ReadonlyArray<{ event: KnowledgeEvent; seq: number }>,
  matches: (event: KnowledgeEvent) => boolean,
): { preArchive: OrderedRetentionEvidence[]; postArchive: OrderedRetentionEvidence[] } {
  const preArchive: OrderedRetentionEvidence[] = [];
  const postArchive: OrderedRetentionEvidence[] = [];
  for (const { event, seq } of exactRows) {
    if (event.rating === undefined || !eventIsMeasurable(event) || !matches(event)) continue;
    const evidence: OrderedRetentionEvidence = {
      t: event.t,
      seq,
      rating: event.rating,
      ...(event.retentionCondition === 'assisted' || event.retentionCondition === 'supplied' ? { condition: event.retentionCondition } : {}),
    };
    if (archive !== undefined && event.t <= archive.frontierT) preArchive.push(evidence);
    else postArchive.push(evidence);
  }
  if (archive !== undefined) {
    for (const [bucketKey, bucket] of Object.entries(archive.buckets)) {
      const representative = bucketRepresentative(bucketKey);
      if (!representative || !matches(representative)) continue;
      for (const residue of bucket.ratings) {
        preArchive.push({
          t: residue.t,
          seq: residue.seq,
          rating: residue.rating,
          ...(residue.condition !== undefined ? { condition: residue.condition } : {}),
        });
      }
    }
  }
  const byOrder = (a: OrderedRetentionEvidence, b: OrderedRetentionEvidence): number => a.t - b.t || a.seq - b.seq;
  preArchive.sort(byOrder);
  postArchive.sort(byOrder);
  return { preArchive, postArchive };
}

/**
 * Full retention computation: the archive-frontier sequence (exact
 * pre-frontier rows merged with residue columns) folded through the
 * scheduler, then the post-frontier exact rows. Template rule matches the
 * raw path: createdAt = first measurable matching evidence t.
 */
export function computeRetention(
  archive: KeyArchive | undefined,
  exactRows: ReadonlyArray<{ event: KnowledgeEvent; seq: number }>,
  policy: RetentionPolicy,
  now: number,
  matches: (event: KnowledgeEvent) => boolean,
): RetentionScheduleCache & { pressure: number } | null {
  const { preArchive, postArchive } = retentionSequence(archive, exactRows, matches);
  if (preArchive.length === 0 && postArchive.length === 0) return null;
  let firstEvidenceT = Number.POSITIVE_INFINITY;
  for (const { event } of exactRows) {
    if (eventIsMeasurable(event) && matches(event) && event.t < firstEvidenceT) firstEvidenceT = event.t;
  }
  if (archive !== undefined) {
    const archiveFold = foldArchiveBuckets(archive, matches);
    if (archiveFold.firstSeen !== undefined && archiveFold.firstSeen < firstEvidenceT) firstEvidenceT = archiveFold.firstSeen;
  }
  const template = { createdAt: Number.isFinite(firstEvidenceT) ? firstEvidenceT : now, initialEase: 2.5 };
  let schedule: RetentionScheduleCache = {
    state: 'new',
    ease: template.initialEase,
    interval: 0,
    dueAt: template.createdAt,
    reviews: 0,
    lapses: 0,
    learningStep: 0,
    lastReviewed: 0,
    provenance: 'derived-scheduler-cache',
  };
  for (const evidence of [...preArchive, ...postArchive]) {
    schedule = scheduleAfterAnswer(schedule, evidence.rating, policy, evidence.t, evidence.condition ?? 'unassisted');
  }
  return { ...schedule, pressure: Math.max(0, (now - schedule.dueAt) / Math.max(1, schedule.interval || 24 * 60 * 60 * 1000)) };
}
