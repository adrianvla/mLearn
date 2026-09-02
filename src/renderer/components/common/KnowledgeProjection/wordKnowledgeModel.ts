import type { KnowledgeEvent } from '../../../../shared/knowledgeEvents';
import type { KnowledgeProjection } from '../../../../shared/graph/ipc';
import type { WordStatus } from '../../../../shared/constants';
import type { ComprehensiveWordStatusResult } from '../../../utils/comprehensiveKnowledge';

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
}

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
  return {
    projection: input.projection,
    events: input.events,
    wordClaim: comprehensive?.basis === 'claim' ? comprehensive.claim ?? comprehensive.status : null,
    excluded: comprehensive?.excluded === true,
  };
}
