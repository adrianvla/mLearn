import { identityNeighbors, relationsOf, type LingualGraph } from '../graph/load';
import { CORE_GRAPH_RELATION_TYPES } from '../graph/types';
import type { CompoundAnalysis, CompoundPart } from '../graph/morphology/compounds';
import { isIdentityShareableCapability } from '../graph/targets';
import type { LearnableTarget } from '../graph/types';
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
   * method:'inference'). A learner who repeatedly succeeds at inferring
   * unseen words from known structure gets stronger predictions; failures
   * discount. This is a LEARNER-MODEL property — never evidence that any
   * specific unseen item is already known.
   */
  inferenceSuccess?: { attempts: number; successes: number };
  /**
   * Entry-level lexical state for the target's authoritative identity
   * (graph-resolved across variant surfaces). SUPPORT ONLY: a synchronized
   * lexical object makes a missing written bridge cheap to acquire — this
   * never becomes direct evidence for the bridge itself.
   */
  entry?: { entryId?: string; senseKnown: boolean; spokenKnown: boolean };
  /**
   * Character-component familiarity for the target surface (has-character
   * neighbors). SUPPORT ONLY: known components assist reading/recognition
   * inference, scaled by the learner's observed transfer calibration.
   */
  characters?: { known: number; total: number };
}

export interface Prediction {
  pSuccess: number;
  uncertainty: number;
  supportPath: Array<{ from: string; to: string; via: string }>;
  /** Always true today: predictions are expectations, never evidence. */
  readonly kind: 'prediction';
}

const SUPPORT_WEIGHTS: Record<string, { transparency: number; predictability: number } | undefined> = {
  'sense-recognition': { transparency: 0.6, predictability: 0 },
  'surface-reading': { transparency: 0, predictability: 0.7 },
};

/**
 * Entry-route support weights per target capability: how much an already
 * synchronized lexical object (meaning and/or spoken form) predicts success
 * on a not-yet-measured access. The written bridge of a word you know by
 * sound and meaning is the textbook cheap-missing-bridge.
 */
const ENTRY_SUPPORT: Record<string, { sense: number; spoken: number } | undefined> = {
  'surface-recognition': { sense: 0.45, spoken: 0.35 },
  'surface-reading': { sense: 0.05, spoken: 0.35 },
};

/**
 * Character-component support ceiling per target capability, scaled by the
 * known-character fraction and the learner's transfer calibration.
 */
const CHARACTER_SUPPORT: Record<string, number | undefined> = {
  'surface-reading': 0.5,
  'surface-recognition': 0.2,
  'sense-recognition': 0.15,
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

  // Laplace-smoothed observed transfer rate, expressed RELATIVE to the
  // 0.5 no-history prior: a learner who has successfully inferred unseen
  // words from known parts before is boosted, a learner who failed the same
  // structure is discounted, and thin history stays ≈ neutral. Clamped to
  // stay conservative.
  let calibration = 1;
  if (input.inferenceSuccess && input.inferenceSuccess.attempts >= 2) {
    calibration = Math.min(2, Math.max(0.25, ((input.inferenceSuccess.successes + 1) / (input.inferenceSuccess.attempts + 2)) / 0.5));
  }

  // ENTRY route: the lexical object is already synchronized (sense/spoken
  // access known through any authoritative variant). The target's missing
  // written bridge is cheap graph completion, not a novel lexical object.
  // Credit is support-side only — it never fabricates direct evidence.
  const entryWeights = ENTRY_SUPPORT[target.capability];
  if (input.entry && entryWeights) {
    let entryCredit = 0;
    if (input.entry.senseKnown) entryCredit += entryWeights.sense;
    if (input.entry.spokenKnown) entryCredit += entryWeights.spoken;
    if (entryCredit > 0) {
      supportTotal += entryCredit;
      knownNeighbors += entryCredit;
      supportPath.push({ from: input.entry.entryId ?? 'shared-entry', to: target.entityId, via: 'realizes' });
    }
  }

  // CHARACTER route: known graphemic components assist surface inference
  // (component-assisted reading/recognition), scaled by the learner's
  // observed transfer competence. Support-side only — never knowledge.
  const characterWeight = CHARACTER_SUPPORT[target.capability];
  if (input.characters && input.characters.total > 0 && input.characters.known > 0 && characterWeight !== undefined) {
    const credit = characterWeight * (input.characters.known / input.characters.total) * calibration;
    supportTotal += credit;
    knownNeighbors += credit;
    supportPath.push({ from: 'has-character', to: target.entityId, via: 'component-inference' });
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
  const pSuccess = Math.min(0.85, base + knownNeighbors / Math.max(1, supportTotal) * 0.5 * calibration);
  const uncertainty = Math.max(0.15, 1 - supportTotal);

  return { pSuccess, uncertainty, supportPath, kind: 'prediction' };
}

function leafLemmas(parts: readonly CompoundPart[]): string[] {
  return parts.flatMap((part) => part.parts ? leafLemmas(part.parts) : [part.lemma]);
}
