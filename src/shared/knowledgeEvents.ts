import type { KnowledgeAspect, KnowledgeSource, WordStatus } from './constants';

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
   * Absent = unspecified. Provenance only — never a knowledge aspect; later
   * analytics may derive inference accuracy from this without ever treating
   * inferred success as prior memorized knowledge.
   */
  method?: 'recall' | 'inference';
}

/** Keys are `${language}:${hash}` values shared with wordKnowledge. */
export type KnowledgeEventLog = Record<string, KnowledgeEvent[]>;
