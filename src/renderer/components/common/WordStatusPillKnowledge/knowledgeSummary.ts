import { KNOWLEDGE_ASPECT_LABEL_KEYS, type WordStatus } from '../../../../shared/constants';
import type { KnowledgeAspect } from '../../../../shared/knowledgeEvents';
import type { KnowledgeProjection, KnowledgeProjectionState } from '../../../../shared/graph/ipc';
import type { ComprehensiveWordStatusResult } from '../../../utils/comprehensiveKnowledge';

/**
 * Compact per-capability knowledge summary — the single derivation shared by
 * every knowledge surface (WordStatusPillKnowledge rows, hover chips) so the
 * pill popover and the hover can never diverge. Effective status always comes
 * from the comprehensive/claim-aware resolvers, never raw records; the basis
 * token is one of claim | evidence | prediction | unmeasured.
 */

export type KnowledgeBasisToken = 'claim' | 'evidence' | 'prediction' | 'unmeasured';

export const BASIS_LABEL_KEYS: Record<KnowledgeBasisToken, string> = {
  claim: 'mlearn.Knowledge.Basis.Claim',
  evidence: 'mlearn.Knowledge.Basis.Evidence',
  prediction: 'mlearn.Knowledge.Basis.Prediction',
  unmeasured: 'mlearn.Knowledge.Basis.Unmeasured',
};

export const STATUS_LABEL_KEYS: Record<WordStatus, string> = {
  unknown: 'mlearn.WordHover.Status.Unknown',
  learning: 'mlearn.WordHover.Status.Learning',
  known: 'mlearn.WordHover.Status.Known',
};

/** "No measurement or claim yet" — distinct from Unknown (measured not-known). */
export const UNTRACKED_LABEL_KEY = 'mlearn.Knowledge.Untracked';

/**
 * Tier-2 semantics: "no claim, no evidence" is untracked. Unknown is reserved
 * for an actual negative epistemic state — an explicit claim or evidence
 * resolving to unknown.
 */
export function isUntrackedKnowledge(status: WordStatus, basis: KnowledgeBasisToken): boolean {
  return status === 'unknown' && basis === 'unmeasured';
}

/**
 * The status text a knowledge pill/summary renders. Rows that already carry
 * an explicit untracked flag (finer aspects, prediction-context rows) pass it
 * through; pill headers derive it from the basis. Untracked always wins over
 * the raw "unknown" classification.
 */
export function knowledgeStatusLabelKey(
  status: WordStatus,
  basis: KnowledgeBasisToken,
  untracked: boolean = isUntrackedKnowledge(status, basis),
): string {
  return untracked ? UNTRACKED_LABEL_KEY : STATUS_LABEL_KEYS[status];
}

export interface AspectEffectiveState {
  status: WordStatus;
  untracked?: boolean;
}

export interface AspectCapabilitySummary {
  aspect: KnowledgeAspect;
  labelKey: string;
  status: WordStatus;
  basis: KnowledgeBasisToken;
  untracked: boolean;
  predictionReasons?: readonly string[];
}

/** The aspect-like capability a graph projection state describes, if any. */
export function projectionStateForAspect(
  projection: KnowledgeProjection | undefined,
  aspect: KnowledgeAspect,
): KnowledgeProjectionState | undefined {
  const capability = aspect === 'meaning'
    ? 'surface-recognition'
    : aspect === 'reading'
      ? 'surface-reading'
      : aspect === 'prosody'
        ? 'pronunciation-production'
        : undefined;
  return capability
    ? projection?.targets.flatMap((target) => target.states).find((state) => state.capability === capability)
    : undefined;
}

/**
 * One capability's compact summary:
 * - projection states supply prediction/evidence/unmeasured nuance (the graph
 *   can see attribution the local resolver cannot),
 * - otherwise the meaning aspect resolves through getComprehensiveWordStatus
 *   (claim/evidence/unmeasured) and finer aspects through their own record
 *   (evidence) or absence (unmeasured).
 */
export function aspectCapabilitySummary(
  aspect: KnowledgeAspect,
  effective: AspectEffectiveState,
  meaning: ComprehensiveWordStatusResult,
  projectionState: KnowledgeProjectionState | undefined,
): AspectCapabilitySummary {
  const labelKey = KNOWLEDGE_ASPECT_LABEL_KEYS[aspect];
  if (projectionState) {
    if (projectionState.basis === 'prediction') {
      return {
        aspect, labelKey, status: effective.status, basis: 'prediction',
        untracked: effective.untracked === true, predictionReasons: projectionState.prediction?.reasons,
      };
    }
    if (projectionState.basis === 'evidence') {
      const classification = projectionState.classification;
      return {
        aspect, labelKey,
        status: classification === 'known' || classification === 'learning' ? classification : effective.status,
        basis: 'evidence', untracked: false,
      };
    }
    // Excluded/unmeasured projection: the status stays honest from the resolver.
    // An unmeasured projection over an unknown resolver state is Untracked
    // (passive-only familiarity included — REQ13), never Unknown.
    return {
      aspect, labelKey,
      status: effective.status,
      basis: 'unmeasured',
      untracked: effective.untracked === true || isUntrackedKnowledge(effective.status, 'unmeasured'),
    };
  }
  if (aspect === 'meaning') {
    // The resolver's basis is authoritative (always present on Tier-2 results):
    // unmeasured meaning is Untracked, never Unknown.
    return { aspect, labelKey, status: meaning.status, basis: meaning.basis, untracked: meaning.basis === 'unmeasured' };
  }
  if (effective.untracked) {
    return { aspect, labelKey, status: 'unknown', basis: 'unmeasured', untracked: true };
  }
  // A record exists without projection nuance: claim and evidence both write the
  // same status, so without projection the resolver's record is the whole truth.
  return { aspect, labelKey, status: effective.status, basis: 'evidence', untracked: false };
}