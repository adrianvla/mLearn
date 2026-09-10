import { ANKI_EASE } from '../constants';
import { ASPECT_CAPABILITY } from '../graph/types';
import type { AttemptScaffolds, KnowledgeEvent, Rating } from '../knowledgeEvents';
import { eventCapability, eventIsMeasurable, SCAFFOLD_INVALIDATES } from '../knowledgeEvents';
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
 * - Exact forever (sparse semantic ledger): explicit learner claims, claim
 *   carriers (manual rows without an attemptId), retraction tombstones, and
 *   grammar-detector provenance rows.
 * - Exact while recent: every row inside the tail window.
 * - Exact forever (acquisition residue): rows inside the first acquisition
 *   window of a key, so cohort slopes keep replaying from raw evidence.
 * - Aggregatable: everything else older than the tail window — anki /
 *   passiveTracking / migration rows AND native attempt rows (any event with
 *   an `attemptId`, including manual-sourced attempt observations). Native
 *   Attempts are the COMMON case, not exceptional: an old attempt compacts
 *   into its bucket aggregate plus a small exact contribution record
 *   (`attempt_index`), so an ancient retraction can rebuild the bucket
 *   without the original payload. Aggregated rows are recorded twice over:
 *   once as bucket sufficient statistics, once as per-row packed reducer
 *   inputs (`bucket_recs` blobs + attempt records) so any bucket can be
 *   re-derived — and any single attempt reversed — exactly.
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

/**
 * Archival classifier. Ledger semantics first, then recency, then acquisition
 * residue. Explicit learner statements (claims — manual rows without an
 * attemptId), tombstones, and grammar-detector provenance stay exact forever.
 * Attempt-bearing rows (the common native case, any source) aggregate with a
 * contribution record; an attemptId row whose attempt was retracted never
 * reaches here (compaction drops tombstoned rows outright).
 */
export function isAggregatableEvent(event: KnowledgeEvent, now: number): boolean {
  if (event.kind === 'claim' || event.kind === 'retraction') return false;
  if (event.retracts !== undefined) return false;
  if (event.attemptId === undefined && (event.source === 'manual' || event.source === 'grammar')) return false;
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
  /**
   * Method-class sufficient statistics (prediction calibration): archived
   * inference-mediated attempts and their successes. Consumers count exact
   * rows plus these sums — identical predicates to the raw path.
   */
  methodStats?: { inference: number; inferenceSuccess: number };
  /** Per-source summed `timesSeenDelta ?? 1` (target evidenceSourceCounts). */
  sourceSeen?: Record<string, number>;
  /** Latest direct-recall success in the bucket (target lastDirectSuccess). */
  lastDirect?: { t: number; seq: number };
}

export interface KeyArchive {
  /** Archive generation: 2 = every bucket carries per-row records. */
  v: 1 | 2;
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

/** Strictly (t, seq)-newer — mirrors projectionReplay's marker ordering. */
function isNewer(aT: number, aSeq: number, bT: number, bSeq: number): boolean {
  return aT > bT || (aT === bT && aSeq > bSeq);
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
  // Method/source sufficient statistics with the SAME predicates the raw
  // evidence path applies (knowledgeProjection reduces explanation.evidence,
  // which is measurability+matcher filtered; calibration reads active rows
  // unconditionally).
  const measurable = eventIsMeasurable(event);
  if (event.method === 'inference') {
    const stats = (bucket.methodStats ??= { inference: 0, inferenceSuccess: 0 });
    stats.inference += 1;
    if (event.quality === 'fluent' || event.rating === 'good' || event.rating === 'easy') stats.inferenceSuccess += 1;
  }
  if (measurable && event.method === 'recall' && (event.quality === 'fluent' || event.rating === 'good' || event.rating === 'easy')) {
    if (bucket.lastDirect === undefined || isNewer(event.t, seq, bucket.lastDirect.t, bucket.lastDirect.seq)) {
      bucket.lastDirect = { t: event.t, seq };
    }
  }
  if (measurable) {
    bucket.sourceSeen ??= {};
    bucket.sourceSeen[event.source] = (bucket.sourceSeen[event.source] ?? 0) + (event.timesSeenDelta ?? 1);
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
 * Per-row contribution records emitted by compaction. Attempt records go to
 * the exact `attempt_index` (attemptId → bucket + reducer-input delta);
 * non-attempt records join their bucket's packed record blob. Together with
 * the bucket aggregates they let any bucket be re-derived — and any single
 * archived attempt be reversed — exactly, without the original payload.
 */
export interface CompactionRecords {
  attemptRecords: Array<{ attemptId: string; bucketKey: string; t: number; seq: number; rec: Uint8Array }>;
  bucketRecords: Array<{ bucketKey: string; event: KnowledgeEvent; seq: number }>;
}

/**
 * Pure compaction classification for one key's rows: exact ledger/recency/
 * acquisition classes stay raw, everything else folds into the archive.
 * Deterministic in row order; `seq` carries journal insertion order.
 * Tombstoned attempts (retracted rows still in the journal) are epistemically
 * dead: dropped entirely, never aggregated, never recorded.
 *
 * `previous` (the key's existing archive) is merged in: newly archived rows
 * extend its buckets by ordered accumulation. Generation-1 archives carry no
 * per-row records, so they must stay immutable: rows mapping into a v1
 * bucket are kept exact (they will compact once that key is reclassified
 * from its re-import source); only fresh buckets receive records.
 */
export function compactKeyEvents(
  events: ReadonlyArray<{ event: KnowledgeEvent; seq: number }>,
  now: number,
  previous?: KeyArchive,
): { kept: Array<{ event: KnowledgeEvent; seq: number }>; archive: KeyArchive | undefined; records: CompactionRecords } {
  const ordered = [...events].sort((a, b) => a.event.t - b.event.t || a.seq - b.seq);
  let firstMeaningT: number | undefined;
  for (const { event } of ordered) {
    const capability = eventCapability(event);
    if (capability === 'sense-recognition' && (firstMeaningT === undefined || event.t < firstMeaningT)) firstMeaningT = event.t;
  }
  const acquisitionCutoff = firstMeaningT !== undefined ? firstMeaningT + KNOWLEDGE_ACQUISITION_WINDOW_MS : Number.NEGATIVE_INFINITY;

  // Retracted attempts are dead rows: their tombstone (kept exact) is the
  // audit; neither fold nor record may ever see them again.
  const retractedIds = new Set<string>();
  for (const { event } of ordered) {
    if (event.retracts !== undefined) retractedIds.add(`${event.retracts}`);
  }

  const kept: Array<{ event: KnowledgeEvent; seq: number }> = [];
  const transientBuckets = new Map<string, TransientBucket>();
  const ankiReviewIds: number[] = [...(previous?.ankiReviewIds ?? [])];
  let frontierT = previous?.frontierT ?? Number.NEGATIVE_INFINITY;
  let frontierSeq = previous?.frontierSeq ?? -1;
  let archivedAny = previous !== undefined;
  // v1 archives carry aggregates without records — immutable prefix.
  const previousIncomplete = previous !== undefined && previous.v < 2;
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

  const records: CompactionRecords = { attemptRecords: [], bucketRecords: [] };

  for (const { event, seq } of ordered) {
    if (event.attemptId !== undefined && retractedIds.has(`${event.attemptId}`)) continue;
    const bucketKey = archiveBucketKey(event);
    if (!isAggregatableEvent(event, now) || event.t <= acquisitionCutoff || (previousIncomplete && previous.buckets[bucketKey] !== undefined)) {
      kept.push({ event, seq });
      continue;
    }
    archivedAny = true;
    let bucket = transientBuckets.get(bucketKey);
    if (!bucket) {
      bucket = emptyTransientBucket();
      transientBuckets.set(bucketKey, bucket);
    }
    accumulateBucket(bucket, bucketKey, event, seq, now);
    if (event.attemptId !== undefined) records.attemptRecords.push({ attemptId: `${event.attemptId}`, bucketKey, t: event.t, seq, rec: encodeAttemptRecord(event, seq) });
    else records.bucketRecords.push({ bucketKey, event, seq });
    if (event.ankiReviewId !== undefined) ankiReviewIds.push(event.ankiReviewId);
    if (event.t > frontierT || (event.t === frontierT && seq > frontierSeq)) {
      frontierT = event.t;
      frontierSeq = seq;
    }
  }

  if (!archivedAny) return { kept, archive: undefined, records };

  const buckets: Record<string, BucketArchive> = {};
  const freshWeekPoints: WeekPoint[] = [];
  for (const [bucketKey, bucket] of transientBuckets) {
    bucket.ratings.sort((a, b) => a.t - b.t || a.seq - b.seq);
    const { points, ...persisted } = bucket;
    buckets[bucketKey] = persisted;
    collapseBucketPoints(bucket, now, freshWeekPoints);
  }

  let archivedEventCount = 0;
  for (const bucket of Object.values(buckets)) archivedEventCount += bucket.rowCount;
  return {
    kept,
    archive: {
      v: previousIncomplete ? 1 : 2,
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
    records,
  };
}

/** LOD collapse shared by compaction and bucket rebuilds (same fixed rules). */
function collapseBucketPoints(bucket: TransientBucket, now: number, freshWeekPoints: WeekPoint[]): void {
  // Weeks older than the LOD horizon collapse into month points. Points
  // are per-bucket so History LOD never conflates capabilities. Sparse
  // buckets (row fingerprint below threshold) collapse their WHOLE range
  // to months — LOD coverage retained at coarser resolution.
  const sparseBucket = bucket.rowCount < 20;
  const months = new Map<number, WeekPoint>();
  for (const point of bucket.points.values()) {
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
        ...(target.methodStats !== undefined || bucket.methodStats !== undefined
          ? {
              methodStats: {
                inference: (target.methodStats?.inference ?? 0) + (bucket.methodStats?.inference ?? 0),
                inferenceSuccess: (target.methodStats?.inferenceSuccess ?? 0) + (bucket.methodStats?.inferenceSuccess ?? 0),
              },
            }
          : {}),
        ...(target.sourceSeen !== undefined || bucket.sourceSeen !== undefined
          ? {
              sourceSeen: mergeSourceSeen(target.sourceSeen, bucket.sourceSeen),
            }
          : {}),
        ...(target.lastDirect !== undefined || bucket.lastDirect !== undefined
          ? {
              lastDirect: isNewer(
                target.lastDirect?.t ?? Number.NEGATIVE_INFINITY,
                target.lastDirect?.seq ?? -1,
                bucket.lastDirect?.t ?? Number.NEGATIVE_INFINITY,
                bucket.lastDirect?.seq ?? -1,
              )
                ? target.lastDirect
                : bucket.lastDirect,
            }
          : {}),
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
    v: archives.some((archive) => archive.v === 1) ? 1 : 2,
    frontierT,
    frontierSeq,
    acquisitionCutoff,
    buckets,
    archivedEventCount,
    ankiReviewIds: [...new Set(ankiReviewIds)].sort((a, b) => a - b),
    weekPoints: coalesceWeekPoints([weekPoints]),
  };
}

function mergeSourceSeen(a: Record<string, number> | undefined, b: Record<string, number> | undefined): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const [source, count] of Object.entries(a ?? {})) merged[source] = (merged[source] ?? 0) + count;
  for (const [source, count] of Object.entries(b ?? {})) merged[source] = (merged[source] ?? 0) + count;
  return merged;
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

// ─── Row records: the packed reducer-input projection of archived rows ───
//
// A record carries exactly the fields the learner reducers consume
// (applyEventToFold, applyTransitions, residue, latency, LOD, method/source
// statistics) — never the presentation payload. Buckets re-derive from their
// records; a retracted attempt is reversed by rebuilding its bucket from the
// remaining records. Attempt records are standalone (self-contained source
// dictionary); bucket blobs share one dictionary and delta-encode t/seq.

const RECORD_VERSION = 1;
const RECORD_KINDS = ['status', 'review', 'rating', 'rollup'] as const;
const RECORD_RATINGS: readonly Rating[] = ['again', 'hard', 'good', 'easy'];
const RECORD_STATUSES = ['unknown', 'learning', 'known'] as const;
const RECORD_QUALITIES = ['missed', 'struggled', 'fluent'] as const;
const RECORD_SCAFFOLD_KEYS = Object.keys(SCAFFOLD_INVALIDATES);

const FLAG_TOSTATUS = 1 << 0;
const FLAG_EASE = 1 << 1;
const FLAG_RATING = 1 << 2;
const FLAG_CONDITION = 1 << 3;
const FLAG_SEEN = 1 << 4;
const FLAG_LATENCY = 1 << 5;
const FLAG_STALLED = 1 << 6;
const FLAG_WORDSYNC = 1 << 7;
const FLAG2_METHOD = 1 << 0;
const FLAG2_METHOD_RECALL = 1 << 1;
const FLAG2_SCAFFOLDS = 1 << 2;
const FLAG2_QUALITY_MASK = 3 << 3; // 0=none, 1=missed, 2=struggled, 3=fluent

function pushUvarint(bytes: number[], value: number): void {
  let v = value;
  while (v >= 0x80) {
    bytes.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  bytes.push(v);
}

function readUvarint(buf: Uint8Array, pos: { i: number }): number {
  let result = 0;
  let shift = 1;
  for (;;) {
    const b = buf[pos.i++];
    result += (b & 0x7f) * shift;
    if (b < 0x80) return result;
    shift *= 128;
  }
}

function zigzag(n: number): number {
  return n >= 0 ? n * 2 : -n * 2 - 1;
}

function unzigzag(n: number): number {
  return n % 2 === 1 ? -(n + 1) / 2 : n / 2;
}

function pushString(bytes: number[], text: string): void {
  const encoded = new TextEncoder().encode(text);
  pushUvarint(bytes, encoded.length);
  for (const byte of encoded) bytes.push(byte);
}

function readString(buf: Uint8Array, pos: { i: number }): string {
  const length = readUvarint(buf, pos);
  const text = new TextDecoder().decode(buf.subarray(pos.i, pos.i + length));
  pos.i += length;
  return text;
}

function encodeRecordBody(bytes: number[], event: KnowledgeEvent, sourceIndex: number): void {
  let flags = 0;
  let flags2 = 0;
  if (event.toStatus !== undefined) flags |= FLAG_TOSTATUS;
  if (event.easeAfter !== undefined) flags |= FLAG_EASE;
  if (event.rating !== undefined) flags |= FLAG_RATING;
  if (event.retentionCondition === 'assisted' || event.retentionCondition === 'supplied') flags |= FLAG_CONDITION;
  if (event.timesSeenDelta !== undefined) flags |= FLAG_SEEN;
  const latency = event.activeLatencyMs ?? event.latencyMs;
  if (latency !== undefined) flags |= FLAG_LATENCY;
  if (event.stalled) flags |= FLAG_STALLED;
  if (event.origin === 'word-sync') flags |= FLAG_WORDSYNC;
  if (event.method !== undefined) {
    flags2 |= FLAG2_METHOD;
    if (event.method === 'recall') flags2 |= FLAG2_METHOD_RECALL;
  }
  if (event.quality !== undefined) {
    // 0 = absent; quality index is offset by one so 'missed' (0) stays distinct.
    flags2 |= FLAG2_QUALITY_MASK & ((RECORD_QUALITIES.indexOf(event.quality) + 1) << 3);
  }
  const scaffoldEntries = event.scaffolds !== undefined ? Object.entries(event.scaffolds).filter(([, value]) => value !== undefined) : [];
  if (scaffoldEntries.length > 0) flags2 |= FLAG2_SCAFFOLDS;
  bytes.push(flags, flags2, Math.max(0, RECORD_KINDS.indexOf(event.kind as (typeof RECORD_KINDS)[number])));
  pushUvarint(bytes, sourceIndex);
  if (flags & FLAG_TOSTATUS) bytes.push(Math.max(0, RECORD_STATUSES.indexOf(event.toStatus as (typeof RECORD_STATUSES)[number])));
  if (flags & FLAG_EASE) pushString(bytes, String(event.easeAfter as number));
  if (flags & FLAG_RATING) bytes.push(Math.max(0, RECORD_RATINGS.indexOf(event.rating as Rating)));
  if (flags & FLAG_CONDITION) bytes.push(event.retentionCondition === 'supplied' ? 1 : 0);
  if (flags & FLAG_SEEN) pushUvarint(bytes, zigzag(event.timesSeenDelta as number));
  if (flags & FLAG_LATENCY) pushUvarint(bytes, latency as number);
  if (flags2 & FLAG2_SCAFFOLDS) {
    pushUvarint(bytes, scaffoldEntries.length);
    for (const [key, value] of scaffoldEntries) {
      const keyIndex = RECORD_SCAFFOLD_KEYS.indexOf(key);
      if (keyIndex >= 0) {
        pushUvarint(bytes, keyIndex);
      } else {
        pushUvarint(bytes, RECORD_SCAFFOLD_KEYS.length);
        pushString(bytes, key);
      }
      if (value === true) {
        bytes.push(1);
      } else if (value === false) {
        bytes.push(0);
      } else {
        bytes.push(2);
        pushString(bytes, JSON.stringify(value));
      }
    }
  }
}

function decodeRecordBody(buf: Uint8Array, pos: { i: number }, sources: readonly string[]): KnowledgeEvent {
  const flags = buf[pos.i++];
  const flags2 = buf[pos.i++];
  const kind = RECORD_KINDS[buf[pos.i++]] ?? 'status';
  const source = sources[readUvarint(buf, pos)] ?? 'anki';
  const event: Record<string, unknown> = { t: 0, kind, source };
  if (flags & FLAG_TOSTATUS) event.toStatus = RECORD_STATUSES[buf[pos.i++]];
  if (flags & FLAG_EASE) event.easeAfter = Number(readString(buf, pos));
  if (flags & FLAG_RATING) event.rating = RECORD_RATINGS[buf[pos.i++]];
  if (flags & FLAG_CONDITION) event.retentionCondition = buf[pos.i++] === 1 ? 'supplied' : 'assisted';
  if (flags & FLAG_SEEN) event.timesSeenDelta = unzigzag(readUvarint(buf, pos));
  if (flags & FLAG_LATENCY) event.latencyMs = readUvarint(buf, pos);
  if (flags & FLAG_STALLED) event.stalled = true;
  if (flags & FLAG_WORDSYNC) event.origin = 'word-sync';
  if (flags2 & FLAG2_METHOD) event.method = flags2 & FLAG2_METHOD_RECALL ? 'recall' : 'inference';
  {
    const qualityIndex = (flags2 & FLAG2_QUALITY_MASK) >> 3;
    if (qualityIndex !== 0) event.quality = RECORD_QUALITIES[qualityIndex - 1];
  }
  if (flags2 & FLAG2_SCAFFOLDS) {
    const count = readUvarint(buf, pos);
    const scaffolds: Record<string, unknown> = {};
    for (let index = 0; index < count; index++) {
      const keyIndex = readUvarint(buf, pos);
      const key = keyIndex === RECORD_SCAFFOLD_KEYS.length ? readString(buf, pos) : RECORD_SCAFFOLD_KEYS[keyIndex] ?? `scaffold-${keyIndex}`;
      const valueKind = buf[pos.i++];
      if (valueKind === 1) scaffolds[key] = true;
      else if (valueKind === 0) scaffolds[key] = false;
      else {
        const length = readUvarint(buf, pos);
        try {
          scaffolds[key] = JSON.parse(new TextDecoder().decode(buf.subarray(pos.i, pos.i + length)));
        } catch {
          scaffolds[key] = true;
        }
        pos.i += length;
      }
    }
    event.scaffolds = scaffolds as AttemptScaffolds;
  }
  return event as unknown as KnowledgeEvent;
}

/**
 * Encode one bucket's records in (t, seq) order: versioned header, shared
 * source dictionary, then delta-coded positions. Deterministic.
 */
export function encodeBucketRecords(entries: ReadonlyArray<{ event: KnowledgeEvent; seq: number }>): Uint8Array {
  const ordered = [...entries].sort((a, b) => a.event.t - b.event.t || a.seq - b.seq);
  const sources: string[] = [];
  for (const { event } of ordered) if (!sources.includes(event.source)) sources.push(event.source);
  const bytes: number[] = [RECORD_VERSION];
  pushUvarint(bytes, sources.length);
  for (const source of sources) pushString(bytes, source);
  pushUvarint(bytes, ordered.length);
  let previousT = 0;
  let previousSeq = 0;
  for (const { event, seq } of ordered) {
    pushUvarint(bytes, zigzag(event.t - previousT));
    pushUvarint(bytes, zigzag(seq - previousSeq));
    previousT = event.t;
    previousSeq = seq;
    encodeRecordBody(bytes, event, sources.indexOf(event.source));
  }
  return new Uint8Array(bytes);
}

/** Decode a bucket record blob back to reducer-input rows, ascending (t, seq). */
export function decodeBucketRecords(blob: Uint8Array): Array<{ event: KnowledgeEvent; seq: number }> {
  const pos = { i: 0 };
  if (blob.length === 0 || blob[pos.i++] !== RECORD_VERSION) return [];
  const sourceCount = readUvarint(blob, pos);
  const sources: string[] = [];
  for (let index = 0; index < sourceCount; index++) sources.push(readString(blob, pos));
  const count = readUvarint(blob, pos);
  const entries: Array<{ event: KnowledgeEvent; seq: number }> = [];
  let t = 0;
  let seq = 0;
  for (let index = 0; index < count; index++) {
    t += unzigzag(readUvarint(blob, pos));
    seq += unzigzag(readUvarint(blob, pos));
    const event = decodeRecordBody(blob, pos, sources);
    event.t = t;
    entries.push({ event, seq });
  }
  return entries;
}

/**
 * Standalone attempt record: same body format with a single-entry dictionary
 * and absolute positions — the exact delta needed to rebuild its bucket
 * without this attempt.
 */
export function encodeAttemptRecord(event: KnowledgeEvent, seq: number): Uint8Array {
  const bytes: number[] = [RECORD_VERSION];
  pushUvarint(bytes, 1);
  pushString(bytes, event.source);
  pushUvarint(bytes, 1);
  pushUvarint(bytes, zigzag(event.t));
  pushUvarint(bytes, zigzag(seq));
  encodeRecordBody(bytes, event, 0);
  return new Uint8Array(bytes);
}

export function decodeAttemptRecord(rec: Uint8Array): { event: KnowledgeEvent; seq: number } | undefined {
  const pos = { i: 0 };
  if (rec.length === 0 || rec[pos.i++] !== RECORD_VERSION) return undefined;
  if (readUvarint(rec, pos) !== 1) return undefined;
  const source = readString(rec, pos);
  if (readUvarint(rec, pos) !== 1) return undefined;
  const t = unzigzag(readUvarint(rec, pos));
  const seq = unzigzag(readUvarint(rec, pos));
  const event = decodeRecordBody(rec, pos, [source]);
  event.t = t;
  return { event, seq };
}

/** Reconstructed reducer-input row: bucket representative supplies the address. */
function materializeRecord(base: KnowledgeEvent | undefined, event: KnowledgeEvent, seq: number): { event: KnowledgeEvent; seq: number } {
  const materialized: KnowledgeEvent = {
    ...(base?.aspect !== undefined ? { aspect: base.aspect } : {}),
    ...(base?.targetRef !== undefined ? { targetRef: base.targetRef } : {}),
    ...event,
  };
  return { event: materialized, seq };
}

/** Persisted per-bucket caches, rebuilt purely from records. */
export interface BucketRebuild {
  fold: FoldState;
  measurableFold: FoldState;
  transitions: TransitionsState;
  ratings: RatingResidue[];
  latency: { count: number; sum: number; max?: number };
  rowCount: number;
  methodStats?: { inference: number; inferenceSuccess: number };
  sourceSeen?: Record<string, number>;
  lastDirect?: { t: number; seq: number };
  /** LOD points (post-collapse rules at `now`), ascending. */
  points: WeekPoint[];
}

/**
 * Re-derive one bucket's caches from its records — the exact aggregate the
 * rows would have produced, minus whatever is absent (e.g. a retracted
 * attempt). `now` drives the fixed LOD collapse rules exactly like a fresh
 * compaction pass.
 */
export function rebuildBucketFromRecords(bucketKey: string, records: ReadonlyArray<{ event: KnowledgeEvent; seq: number }>, now: number): BucketRebuild {
  const representative = bucketRepresentative(bucketKey);
  const bucket = emptyTransientBucket();
  const ordered = records
    .map(({ event, seq }) => materializeRecord(representative, event, seq))
    .sort((a, b) => a.event.t - b.event.t || a.seq - b.seq);
  for (const { event, seq } of ordered) accumulateBucket(bucket, bucketKey, event, seq, now);
  bucket.ratings.sort((a, b) => a.t - b.t || a.seq - b.seq);
  const points: WeekPoint[] = [];
  collapseBucketPoints(bucket, now, points);
  const { points: _transient, ...persisted } = bucket;
  void _transient;
  return { ...persisted, points: points.sort((a, b) => a.w - b.w) };
}

/** Matcher-scoped target statistics over a merged archive (evidence-path semantics). */
export interface ArchiveTargetStats {
  sourceSeen: Record<string, number>;
  lastDirectT?: number;
  inference: number;
  inferenceSuccess: number;
}

export function emptyArchiveTargetStats(): ArchiveTargetStats {
  return { sourceSeen: {}, inference: 0, inferenceSuccess: 0 };
}

/**
 * Sum the new sufficient statistics over buckets whose representative matches
 * — the same selection rule the fold/retention paths use, so archived and
 * exact evidence contribute identically.
 */
export function archiveBucketStats(archive: KeyArchive, match: (representative: KnowledgeEvent) => boolean, into: ArchiveTargetStats = emptyArchiveTargetStats()): ArchiveTargetStats {
  for (const [bucketKey, bucket] of Object.entries(archive.buckets)) {
    const representative = bucketRepresentative(bucketKey);
    if (!representative || !match(representative)) continue;
    for (const [source, count] of Object.entries(bucket.sourceSeen ?? {})) into.sourceSeen[source] = (into.sourceSeen[source] ?? 0) + count;
    if (bucket.lastDirect !== undefined && (into.lastDirectT === undefined || bucket.lastDirect.t > into.lastDirectT)) into.lastDirectT = bucket.lastDirect.t;
    if (bucket.methodStats !== undefined) {
      into.inference += bucket.methodStats.inference;
      into.inferenceSuccess += bucket.methodStats.inferenceSuccess;
    }
  }
  return into;
}
