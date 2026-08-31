import type { AttemptQuality, KnowledgeAspect, KnowledgeSource, WordStatus } from './constants';
import type { CapabilityKind } from './graph/types';

export type { KnowledgeAspect, WordStatus };
export type KnowledgeEventKind = 'status' | 'review' | 'rating' | 'rollup' | 'claim' | 'retraction';
export type Rating = 'again' | 'hard' | 'good' | 'easy';

/**
 * Evidence-layer vocabularies. Word-status resolution keeps the narrow
 * KnowledgeSource/KnowledgeAspect unions; the event journal additionally
 * carries grammar-pattern observations (targetRef kind 'grammar-pattern').
 */
export type EvidenceSource = KnowledgeSource | 'manual' | 'grammar' | 'migration';
export type EvidenceAspect = KnowledgeAspect | 'grammar';

/**
 * Logical-attempt identity. Durable across restarts (uuid v4) so multi-event
 * attempts group correctly even when the process restarted between observations.
 * Legacy logs contain small numeric ids from the previous session-scoped
 * counter; they remain valid grouping keys within their original session.
 */
export type AttemptId = string;

/**
 * What kind of task produced an attempt. Provenance for horizon-sensitive
 * projection (a scaffolded welcome review is weaker evidence than a cold SRS
 * recall). Written only when genuinely known — absent, never guessed.
 */
export type AttemptTaskType =
  | 'srs-review'
  | 'word-sync'
  | 'welcome-review'
  | 'reader'
  | 'video'
  | 'ocr'
  | 'anki-import';

/**
 * Scaffolds the task showed during the attempt (translation, furigana reading,
 * prosody hint). `true` = scaffold was visible while the learner responded.
 */
export interface AttemptScaffolds {
  reading?: boolean;
  translation?: boolean;
  prosody?: boolean;
}

/**
 * Versions of the reference data the observation was recorded under, so future
 * re-projections can tell which graph schema / package generation an attempt
 * predates. Only written where meaningfully available.
 */
export interface EventSourceVersions {
  graphSchemaVersion?: number;
  packageVersions?: Record<string, string>;
}

export function nextAttemptId(): AttemptId {
  return crypto.randomUUID();
}

export interface KnowledgeEvent {
  t: number;
  kind: KnowledgeEventKind;
  source: EvidenceSource;
  aspect: EvidenceAspect;
  fromStatus?: WordStatus;
  toStatus?: WordStatus;
  easeBefore?: number;
  easeAfter?: number;
  intervalBefore?: number;
  intervalAfter?: number;
  /** SRS template identity; makes scheduler replay unambiguous for cards sharing a target word. */
  schedulerCardId?: string;
  rating?: Rating;
  timesSeenDelta?: number;
  /** Grammar-only learner difficulty count for the materialized recognition view. */
  grammarFailedDelta?: number;
  /** Anki revlog entry id (review timestamp ms). Set only on imported anki reviews; the idempotency key for re-imports. */
  ankiReviewId?: number;
  /**
   * How the learner produced the outcome: 'recall' = direct lexical recall,
   * 'inference' = composed from known parts (characters/compounds/morphology).
   * Absent = unspecified (never assume direct recall). Provenance only — never
   * a knowledge aspect; later analytics may derive inference accuracy from this
   * without ever treating inferred success as prior memorized knowledge.
   */
  method?: 'recall' | 'inference';
  /** Attempt performance grade from the universal rating matrix, when this event came from an attempt rating. */
  quality?: AttemptQuality;
  /** Logical-attempt identity: all observation events of one physical response share this id. */
  attemptId?: AttemptId;
  /** Response latency of the attempt (interaction start → rating), stored for calibration; never overrides the learner's report. */
  latencyMs?: number;
  /**
   * What task produced the attempt (REQ3/REQ52 attempt metadata). Provenance
   * only — projection may weigh a scaffolded task differently from a cold
   * recall, but presence alone never changes the evidence rule. Absent = the
   * writer did not know the task type.
   */
  taskType?: AttemptTaskType;
  /** Scaffolds visible to the learner during the attempt (presentation provenance). */
  scaffolds?: AttemptScaffolds;
  /** Reference-data versions the observation was recorded under (re-projection provenance). */
  sourceVersions?: EventSourceVersions;
  /**
   * Retraction tombstone (kind: 'retraction'): marks every event sharing this
   * attemptId as undone (undo/rerate). Append-only bookkeeping — projections
   * must exclude both retracted events and these tombstones via stripRetractions.
   */
  /** Grammar-encounter provenance: detector confidence for the matched occurrence (0–1). Absent = not measured. */
  confidence?: number;
  /** Grammar-encounter provenance: character span of the matched occurrence within the presented surface. */
  span?: { start: number; end: number };
  retracts?: AttemptId;
  /** The exact surface the learner was shown, independent of the storage key's primary form. Presentation provenance — never fan out observations from it. */
  presentedSurface?: string;
  /** Tier-2 target pointer when the observation is about a typed graph entity (e.g. grammar patterns); absent = legacy word-hash addressing. */
  targetRef?: { kind: string; id: string; capability?: CapabilityKind };
  /** Presenting surface/policy channel that produced the observation (e.g. 'word-sync'); replay maps this to policy markers like wordSyncRatedAt. */
  origin?: string;
}
/**
 * Explicit epistemic claim (kind: 'claim') — the user's own statement about a
 * target: "I know this" / "I am learning this" / "I do not know this", or the
 * withdrawal of that statement. A claim is NOT evidence: it never changes the
 * evidence-derived ease, it overrides the *classification* of the effective
 * state until cleared. Semantics:
 * - `toStatus` present  → claim that status (latest active claim wins)
 * - `toStatus` absent   → clear any previous claim (effective state returns to
 *   the evidence projection; historical evidence remains intact)
 * `aspect` scopes the claim (meaning = whole-word identity; other aspects =
 * aspect-scoped claim). Cleared the same way as attempt events: append a
 * retraction or a clearing claim — the journal is append-only.
 */

/** Keys are `${language}:${hash}` values shared with wordKnowledge. */
export type KnowledgeEventLog = Record<string, KnowledgeEvent[]>;

/**
 * The normal read API for evidence consumers: retractions applied, tombstones
 * dropped. Raw journal access (append log inspection) is exceptional and only
 * for audit/migration/debugging paths.
 */
export const readActiveEvidence = stripRetractions;

export function collectRetractedAttemptIds(events: readonly KnowledgeEvent[]): Set<AttemptId> {
  const retracted = new Set<AttemptId>();
  for (const event of events) {
    if (event.retracts !== undefined) retracted.add(event.retracts);
  }
  return retracted;
}

/**
 * Drop retraction tombstones and every event whose attemptId was retracted.
 * Legacy numeric attemptIds compare by value across the string/number union.
 */
export function stripRetractions<T extends KnowledgeEvent>(events: readonly T[]): T[] {
  const retracted = collectRetractedAttemptIds(events);
  if (retracted.size === 0) return events.filter((event) => event.retracts === undefined);
  return events.filter((event) => {
    if (event.retracts !== undefined) return false;
    return !(event.attemptId !== undefined && retracted.has(`${event.attemptId}`));
  });
}

export function stripRetractedLog(log: KnowledgeEventLog): KnowledgeEventLog {
  return Object.fromEntries(
    Object.entries(log)
      .map(([key, events]) => [key, stripRetractions(events)] as const)
      .filter(([, events]) => events.length > 0),
  );
}

// ─── Retention policy (shared by the desktop journal and mobile shards) ───

/** Evidence older than this is consolidated: old rollups collapse to one per ISO week. */
export const KNOWLEDGE_EVENTS_ROLLUP_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
/** Upper bound on retained rollups per key; the anchor event is always protected. */
export const KNOWLEDGE_EVENTS_MAX_ROLLUPS_PER_KEY = 500;

function isoWeekKey(timestamp: number): string {
  const date = new Date(timestamp);
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return `${date.getUTCFullYear()}-${week}`;
}

/**
 * Consolidate stale bookkeeping without touching epistemic truth: only
 * `rollup` events older than the retention window collapse, one per ISO week
 * (latest values, summed encounter deltas). Claims, retractions, ratings, and
 * statuses are never dropped, so replay stays equivalent.
 */
export function consolidateKnowledgeEvents(logEntries: KnowledgeEventLog, now = Date.now()): KnowledgeEventLog {
  const cutoff = now - KNOWLEDGE_EVENTS_ROLLUP_RETENTION_MS;
  const result: KnowledgeEventLog = {};

  for (const [key, events] of Object.entries(logEntries)) {
    const weekly = new Map<string, { latestIndex: number; event: KnowledgeEvent; timesSeenDelta: number }>();
    for (let index = 1; index < events.length; index++) {
      const entry = events[index];
      if (entry.kind !== 'rollup' || entry.t >= cutoff) continue;
      const week = isoWeekKey(entry.t);
      const existing = weekly.get(week);
      if (existing) {
        existing.timesSeenDelta += entry.timesSeenDelta ?? 0;
        if (entry.t >= existing.event.t) {
          existing.latestIndex = index;
          existing.event = entry;
        }
      } else {
        weekly.set(week, { latestIndex: index, event: entry, timesSeenDelta: entry.timesSeenDelta ?? 0 });
      }
    }

    if (weekly.size === 0) {
      result[key] = [...events];
      continue;
    }

    const latestByIndex = new Map<number, KnowledgeEvent>();
    const consolidatedIndexes = new Set<number>();
    for (const value of weekly.values()) {
      latestByIndex.set(value.latestIndex, { ...value.event, timesSeenDelta: value.timesSeenDelta });
    }
    for (let index = 1; index < events.length; index++) {
      const entry = events[index];
      if (entry.kind === 'rollup' && entry.t < cutoff) consolidatedIndexes.add(index);
    }

    result[key] = events.flatMap((entry, index) => {
      if (!consolidatedIndexes.has(index)) return [entry];
      const consolidated = latestByIndex.get(index);
      return consolidated ? [consolidated] : [];
    });
  }

  return result;
}

/**
 * Bound journal growth by removing the oldest removable rollups once a key
 * exceeds the rollup budget. Index 0 (the anchor) and every non-rollup event
 * are always retained.
 */
export function retainKnowledgeEvents(events: readonly KnowledgeEvent[]): KnowledgeEvent[] {
  const retained = [...events];
  const firstEvent = retained[0];
  const removable = retained
    .map((event, index) => ({ event, index }))
    .filter(({ event, index }) => index > 0 && event.kind === 'rollup')
    .sort((a, b) => a.event.t - b.event.t || a.index - b.index);
  const rollupCount = retained.filter(({ kind }) => kind === 'rollup').length;
  const protectedAnchorIsRollup = firstEvent?.kind === 'rollup';
  const allowedRollups = KNOWLEDGE_EVENTS_MAX_ROLLUPS_PER_KEY + (protectedAnchorIsRollup ? 1 : 0);
  const removeCount = Math.max(0, rollupCount - allowedRollups);
  const indicesToRemove = new Set(removable.slice(0, removeCount).map(({ index }) => index));
  return retained.filter((_, index) => !indicesToRemove.has(index));
}

export function applyKnowledgeEventRetention(logEntries: KnowledgeEventLog): KnowledgeEventLog {
  return Object.fromEntries(
    Object.entries(logEntries).map(([key, events]) => [key, retainKnowledgeEvents(events)]),
  );
}
