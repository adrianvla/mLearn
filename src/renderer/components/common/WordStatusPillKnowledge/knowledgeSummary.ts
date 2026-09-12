import type { KnowledgeProjection, KnowledgeProjectionState } from '../../../../shared/graph/ipc';
import type { CapabilityKey } from '../../../../shared/graph/types';
import type { WordStatus } from '../../../../shared/constants';

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
export const UNMEASURED_LABEL_KEY = 'mlearn.Knowledge.Unmeasured';

export function isUnmeasuredKnowledge(status: WordStatus, basis: KnowledgeBasisToken): boolean {
  return status === 'unknown' && basis === 'unmeasured';
}

export function knowledgeStatusLabelKey(status: WordStatus, basis: KnowledgeBasisToken, unmeasured = isUnmeasuredKnowledge(status, basis)): string {
  if (basis === 'prediction') return 'mlearn.Knowledge.Projection.Predicted';
  return unmeasured ? UNMEASURED_LABEL_KEY : STATUS_LABEL_KEYS[status];
}

export function projectionStateForCapability(projection: KnowledgeProjection | undefined, capability: CapabilityKey): KnowledgeProjectionState | undefined {
  for (const target of projection?.targets ?? []) {
    const state = target.states.find((value) => value.capability === capability);
    if (state) return state;
  }
  return undefined;
}
