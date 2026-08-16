import type { KnowledgeSource, WordStatus } from './constants';

export type KnowledgeAspect = 'meaning' | 'reading' | 'prosody';
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
}

/** Keys are `${language}:${hash}` values shared with wordKnowledge. */
export type KnowledgeEventLog = Record<string, KnowledgeEvent[]>;
