import { identityNeighbors, relationsOf, type LingualGraph } from '../graph/load';
import { CORE_GRAPH_RELATION_TYPES } from '../graph/types';
import type { CompoundAnalysis, CompoundPart } from '../graph/morphology/compounds';
import { isIdentityShareableCapability } from '../graph/targets';
import type { CapabilityKind, LearnableTarget } from '../graph/types';
import type { ReplayProjection } from '../utils/projectionReplay';

/**
 * Conservative SUPPORT-based predictor (Tier-2 v0).
 *
 * Reads ONLY: the linguistic graph (structure) and the replayed projection
 * (evidence-derived state). Produces READ-ONLY predictions. This module must
 * never import from evidence writers (FlashcardContext, knowledgeEvents
 * append paths) — the firewall test in prediction.firewall.test.ts enforces
 * that structurally.
 */
export interface PredictionInput {
  graph: LingualGraph | null;
  /** Active-evidence projection for the target's surface key, when available. */
  direct: ReplayProjection | null;
  target: LearnableTarget;
  classify(ease: number): 'known' | 'learning' | 'unknown';
  /** Read-only productive compound support for an unseen target. Decomposition is
   * capability-selected by the caller from the language package's declared strategy. */
  compound?: { analysis: CompoundAnalysis; isKnownPart(lemma: string): boolean };
  /**
   * Learner calibration from OBSERVED compositional transfers (attempts with
   * method 'inference' and their fluent outcomes). Read-only policy input —
   * never evidence, never written back. Absent or thin history leaves the
   * structure-based prediction untouched.
   */
  inferenceSuccess?: { attempts: number; successes: number };
}

export interface Prediction {
  pSuccess: number;
  uncertainty: number;
  supportPath: Array<{ from: string; to: string; via: string }>;
  /** Always true today: predictions are expectations, never evidence. */
  readonly kind: 'prediction';
}

const SUPPORT_WEIGHTS: Partial<Record<CapabilityKind, { transparency: number; predictability: number }>> = {
  'sense-recognition': { transparency: 0.6, predictability: 0 },
  'surface-reading': { transparency: 0, predictability: 0.7 },
};

export function predictTargetAccessibility(input: PredictionInput): Prediction {
  const { graph, direct, target } = input;
  if (!graph || (!graph.nodes.has(target.entityId) && !input.compound)) {
    return { pSuccess: 0, uncertainty: 1, supportPath: [], kind: 'prediction' };
  }

  // Direct evidence dominates: no inference needed.
  if (direct && input.classify(direct.ease) === 'known') {
    return { pSuccess: 1, uncertainty: 0.05, supportPath: [], kind: 'prediction' };
  }

  // Lexeme-level capabilities may aggregate across IDENTITY edges — but only
  // for capabilities that are not surface-scoped (isIdentityShareableCapability).
  let knownNeighbors = 0;
  let supportTotal = 0;
  const supportPath: Prediction['supportPath'] = [];

  if (isIdentityShareableCapability(target.capability)) {
    for (const neighbor of identityNeighbors(graph, target.entityId)) {
      supportTotal += 0.5;
      // Neighbor's own strength would come from its projection; unknown here →
      // conservative credit only when caller supplies per-neighbor projections.
      knownNeighbors += 0;
      void neighbor;
    }
  }

  // SUPPORT edges with measured transparency/predictability feed expectation.
  for (const relation of relationsOf(graph, target.entityId, { direction: 'in' })) {
    // Open-world rule: namespaced extension relations are inert — they can never
    // accidentally create support credit; only core relations participate.
    if (!(CORE_GRAPH_RELATION_TYPES as readonly string[]).includes(relation.type)) continue;
    const weights = SUPPORT_WEIGHTS[target.capability];
    if (!weights) continue;
    const t = relation.transparency ?? 0;
    const p = relation.predictability ?? 0;
    const credit = weights.transparency * t + weights.predictability * p;
    if (credit > 0) {
      supportTotal += credit;
      knownNeighbors += credit; // conservative: full credit only from explicit weights
      supportPath.push({ from: relation.from, to: relation.to, via: relation.type });
    }
  }

  const compound = input.compound?.analysis;
  // Conservative: only a UNIQUE parse extends support — graph-attested
  // structure (primary) or a strategy-derived productive split. An ambiguous
  // compound receives no prediction credit from its preferred parse alone.
  if (compound && !compound.ambiguous) {
    const parts = leafLemmas(compound.parts);
    const knownParts = parts.filter(input.compound!.isKnownPart);
    const credit = compound.confidence * knownParts.length / Math.max(1, parts.length);
    if (credit > 0) {
      supportTotal += credit;
      knownNeighbors += credit;
      const via = compound.source === 'attested' ? 'attested-compound' : 'generated-compound';
      for (const lemma of knownParts) supportPath.push({ from: lemma, to: target.entityId, via });
    }
  }

  const base = direct ? input.classify(direct.ease) === 'learning' ? 0.35 : 0.1 : 0.05;
  // Laplace-smoothed observed transfer rate, expressed RELATIVE to the
  // 0.5 no-history prior: a learner who has successfully inferred unseen
  // words from known parts before is boosted, a learner who failed the same
  // structure is discounted, and thin history stays ≈ neutral. Clamped to
  // stay conservative.
  let calibration = 1;
  if (input.inferenceSuccess && input.inferenceSuccess.attempts >= 2) {
    calibration = Math.min(2, Math.max(0.25, ((input.inferenceSuccess.successes + 1) / (input.inferenceSuccess.attempts + 2)) / 0.5));
  }
  const pSuccess = Math.min(0.85, base + knownNeighbors / Math.max(1, supportTotal) * 0.5 * calibration);
  const uncertainty = Math.max(0.15, 1 - supportTotal);

  return { pSuccess, uncertainty, supportPath, kind: 'prediction' };
}

function leafLemmas(parts: readonly CompoundPart[]): string[] {
  return parts.flatMap((part) => part.parts ? leafLemmas(part.parts) : [part.lemma]);
}
