import { CAPABILITY_LABEL_KEYS } from '../../../../shared/graph/access';
import type { CapabilityKey } from '../../../../shared/graph/types';
import type { KnowledgeProjection, KnowledgeProjectionState } from '../../../../shared/graph/ipc';
import type { WordStatus } from '../../../../shared/constants';
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

export interface CapabilityEffectiveState {
  status: WordStatus;
  untracked?: boolean;
  /** Provenance of the status when a record exists: an explicit claim outranks evidence. */
  basis?: 'claim' | 'evidence';
  claim?: WordStatus;
}
export interface CapabilitySummary {
  capability: CapabilityKey;
  labelKey: string;
  status: WordStatus;
  basis: KnowledgeBasisToken;
  untracked: boolean;
  predictionReasons?: readonly string[];
}

/**
 * The graph projection state describing one capability, if any — a direct
 * match against the projection's per-target states.
 */
export function projectionStateForCapability(
  projection: KnowledgeProjection | undefined,
  capability: CapabilityKey,
): KnowledgeProjectionState | undefined {
  return projection?.targets.flatMap((target) => target.states).find((state) => state.capability === capability);
}

/**
 * One capability's compact summary:
 * - projection states supply prediction/evidence/unmeasured nuance (the graph
 *   can see attribution the local resolver cannot),
 * - otherwise sense recognition resolves through getComprehensiveWordStatus
 *   (claim/evidence/unmeasured) and finer capabilities through their own
 *   record (evidence) or absence (unmeasured).
 */
export function capabilitySummary(
  capability: CapabilityKey,
  effective: CapabilityEffectiveState,
  meaning: ComprehensiveWordStatusResult,
  projectionState: KnowledgeProjectionState | undefined,
): CapabilitySummary {
  const labelKey = CAPABILITY_LABEL_KEYS[capability] ?? `mlearn.Knowledge.Capability.${capability}`;
  // A local claim outranks cached projection nuance: the projection is an
  // async IPC snapshot that can predate the claim.
  if (effective.basis === 'claim') {
    return { capability, labelKey, status: effective.status, basis: 'claim', untracked: false };
  }
  if (projectionState) {
    if (projectionState.basis === 'claim') {
      // The projection's classification IS the claimed status. A claimed
      // 'unknown' is an explicit negative statement — it must not fall back
      // to the local resolver status, and it is never Untracked.
      const classification = projectionState.classification;
      return {
        capability, labelKey,
        status: classification === 'known' || classification === 'learning' || classification === 'unknown'
          ? classification
          : effective.status,
        basis: 'claim', untracked: false,
      };
    }
    if (projectionState.basis === 'prediction') {
      return {
        capability, labelKey, status: effective.status, basis: 'prediction',
        untracked: effective.untracked === true, predictionReasons: projectionState.prediction?.reasons,
      };
    }
    if (projectionState.basis === 'evidence') {
      const classification = projectionState.classification;
      return {
        capability, labelKey,
        status: classification === 'known' || classification === 'learning' ? classification : effective.status,
        basis: 'evidence', untracked: false,
      };
    }
    // Excluded/unmeasured projection: the status stays honest from the resolver.
    // An unmeasured projection over an unknown resolver state is Untracked
    // (passive-only familiarity included — REQ13), never Unknown.
    return {
      capability, labelKey,
      status: effective.status,
      basis: 'unmeasured',
      untracked: effective.untracked === true || isUntrackedKnowledge(effective.status, 'unmeasured'),
    };
  }
  if (capability === 'sense-recognition') {
    // The resolver's basis is authoritative (always present on Tier-2 results):
    // unmeasured sense knowledge is Untracked, never Unknown.
    return { capability, labelKey, status: meaning.status, basis: meaning.basis, untracked: meaning.basis === 'unmeasured' };
  }
  if (effective.untracked) {
    return { capability, labelKey, status: 'unknown', basis: 'unmeasured', untracked: true };
  }
  // A record exists without projection nuance: keep the resolver's basis —
  // a manual access record arrives here with basis 'claim', and collapsing
  // it to 'evidence' would misattribute the user's own statement.
  return { capability, labelKey, status: effective.status, basis: effective.basis ?? 'evidence', untracked: false };
}