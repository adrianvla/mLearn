import { identityNeighbors, relationsOf, type LingualGraph } from '../graph/load';
import { createGermanCompoundLexicon, decomposeGermanCompound, type GermanCompoundPart } from '../graph/morphology/deCompounds';
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
  /** Read-only productive German compound support for an unseen target. */
  compound?: { surface: string; isKnownPart(lemma: string): boolean };
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

  const compound = input.compound && decomposeGermanCompound(input.compound.surface, germanLexicon(graph));
  // Conservative: only a UNIQUE generated parse extends support. An ambiguous
  // compound receives no prediction credit from its preferred parse alone.
  if (compound?.source === 'generated' && !compound.ambiguous) {
    const parts = leafLemmas(compound.parts);
    const knownParts = parts.filter(input.compound!.isKnownPart);
    const credit = compound.confidence * knownParts.length / Math.max(1, parts.length);
    if (credit > 0) {
      supportTotal += credit;
      knownNeighbors += credit;
      for (const lemma of knownParts) supportPath.push({ from: lemma, to: target.entityId, via: 'generated-compound' });
    }
  }

  const base = direct ? input.classify(direct.ease) === 'learning' ? 0.35 : 0.1 : 0.05;
  const pSuccess = Math.min(0.85, base + knownNeighbors / Math.max(1, supportTotal) * 0.5);
  const uncertainty = Math.max(0.15, 1 - supportTotal);

  return { pSuccess, uncertainty, supportPath, kind: 'prediction' };
}

function germanLexicon(graph: LingualGraph) {
  return createGermanCompoundLexicon([...graph.nodes.values()]
    .filter((node) => node.kind === 'surface' && node.id.startsWith('de:') && node.label)
    .flatMap((node) => relationsOf(graph, node.id, { direction: 'out' })
      .filter((relation) => relation.type === 'realizes')
      .map((relation) => ({ lemma: node.label!, entryId: relation.to }))));
}

function leafLemmas(parts: readonly GermanCompoundPart[]): string[] {
  return parts.flatMap((part) => part.parts ? leafLemmas(part.parts) : [part.lemma]);
}
