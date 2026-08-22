import type { AttemptQuality, KnowledgeAspect, KnowledgeSource, WordStatus } from './constants';

export type { KnowledgeAspect };
export type KnowledgeEventKind = 'status' | 'review' | 'rating' | 'rollup' | 'retraction';
export type Rating = 'again' | 'hard' | 'good' | 'easy';

/**
 * Evidence-layer vocabularies. Word-status resolution keeps the narrow
 * KnowledgeSource/KnowledgeAspect unions; the event journal additionally
 * carries grammar-pattern observations (targetRef kind 'grammar-pattern').
 */
export type EvidenceSource = KnowledgeSource | 'manual' | 'grammar';
export type EvidenceAspect = KnowledgeAspect | 'grammar';

/**
 * Logical-attempt identity. Durable across restarts (uuid v4) so multi-event
 * attempts group correctly even when the process restarted between observations.
 * Legacy logs contain small numeric ids from the previous session-scoped
 * counter; they remain valid grouping keys within their original session.
 */
export type AttemptId = string;

// One id per logical learner response (one physical rating / one profile
// submit). All observation events sharing an attemptId belong to the same
// attempt — unique ids count attempts, events count aspect observations.
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
  rating?: Rating;
  timesSeenDelta?: number;
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
   * Retraction tombstone (kind: 'retraction'): marks every event sharing this
   * attemptId as undone (undo/rerate). Append-only bookkeeping — projections
   * must exclude both retracted events and these tombstones via stripRetractions.
   */
  retracts?: AttemptId;
  /** The exact surface the learner was shown, independent of the storage key's primary form. Presentation provenance — never fan out observations from it. */
  presentedSurface?: string;
  /** Tier-2 target pointer when the observation is about a typed graph entity (e.g. grammar patterns); absent = legacy word-hash addressing. */
  targetRef?: { kind: string; id: string };
  /** Presenting surface/policy channel that produced the observation (e.g. 'word-sync'); replay maps this to policy markers like wordSyncRatedAt. */
  origin?: string;
}

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
