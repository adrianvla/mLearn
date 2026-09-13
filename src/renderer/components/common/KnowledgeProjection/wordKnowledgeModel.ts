import type { KnowledgeEvent } from '../../../../shared/knowledgeEvents';
import type { KnowledgeProjection } from '../../../../shared/graph/ipc';
import type { WordStatus } from '../../../../shared/constants';
import type { ComprehensiveWordStatusResult } from '../../../utils/comprehensiveKnowledge';
import type { KnowledgeBasisToken } from '../WordStatusPillKnowledge/knowledgeSummary';

/**
 * Everything the knowledge drawer renders for one word, composed once from the
 * existing resolvers so hosts assemble a single aggregate instead of repeating
 * the resolver wiring per surface.
 */
export interface WordKnowledgeModel {
  /** Per-capability graph projection payload for the surface. */
  projection: KnowledgeProjection | undefined;
  /** Full knowledge journal for the surface (including claim events). */
  events: KnowledgeEvent[] | undefined;
  /** Word-level claim as resolved by the comprehensive resolver; null = no active claim. */
  wordClaim: WordStatus | null;
  /** Teaching-policy exclusion (ignored word) — orthogonal to knowledge status. */
  excluded: boolean;
  /**
   * Header summary for the word as a whole (sense knowledge): status, basis
   * token, and passive exposure count. Reported by the canonical graph
   * projection; only presented here, never recomputed.
   */
  overall: { status: WordStatus; basis: KnowledgeBasisToken; timesSeen: number; ease?: number };
}

const UNMEASURED_OVERALL = { status: 'unknown' as WordStatus, basis: 'unmeasured' as KnowledgeBasisToken, timesSeen: 0 };

/**
 * Canonical drawer aggregate: pure composition of the comprehensive status
 * resolver, the graph projection, and the event journal. All classification
 * and basis arithmetic stays inside those resolvers — nothing is recomputed
 * here, the reported fields are only shaped for consumption.
 */
export function assembleWordKnowledgeModel(input: {
  comprehensive?: ComprehensiveWordStatusResult | undefined;
  projection?: KnowledgeProjection | undefined;
  events?: KnowledgeEvent[] | undefined;
}): WordKnowledgeModel {
  const { comprehensive } = input;
  const wordClaim = comprehensive?.basis === 'claim' ? comprehensive.claim ?? comprehensive.status : null;
  const projected = input.projection?.lexical?.overall;
  // The header and capability rows must describe the same addressed journal
  // projection. Materialized word status can refer to a different form family.
  const overall = projected
    ? {
        status: (projected.classification === 'known' || projected.classification === 'learning' ? projected.classification : 'unknown') as WordStatus,
        basis: projected.basis,
        timesSeen: comprehensive?.timesSeen ?? 0,
      }
    : UNMEASURED_OVERALL;
  return {
    projection: input.projection,
    events: input.events,
    wordClaim,
    excluded: comprehensive?.excluded === true,
    overall,
  };
}
