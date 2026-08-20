import type { AttemptQuality, KnowledgeAspect, KnowledgeSource, WordStatus } from './constants';

export type { KnowledgeAspect };
export type KnowledgeEventKind = 'status' | 'review' | 'rating' | 'rollup';
export type Rating = 'again' | 'hard' | 'good' | 'easy';

export interface KnowledgeEvent {
  t: number;
  kind: KnowledgeEventKind;
  source: KnowledgeSource | 'manual';
  aspect: KnowledgeAspect;
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
  /** Response latency of the attempt (interaction start → rating), stored for calibration; never overrides the learner's report. */
  latencyMs?: number;
}

/** Keys are `${language}:${hash}` values shared with wordKnowledge. */
export type KnowledgeEventLog = Record<string, KnowledgeEvent[]>;
