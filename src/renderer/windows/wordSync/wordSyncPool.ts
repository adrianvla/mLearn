import type { KnowledgeProjection } from '../../../shared/graph/ipc';
import type { CapabilityKind } from '../../../shared/graph/types';
import { projectedWordStatus, unresolvedProjectionTargets } from '../../../shared/graph/targets';
import type { KnowledgeBasis } from '../../../shared/knowledge/effectiveKnowledge';
import { WORD_STATUS } from '../../../shared/constants';
import { WORD_SYNC_STATUS_UNTRACKED } from '../../components/common/FilterBuilder/presets';


/** Encode canonical knowledge for filter operands; Untracked means Unmeasured. */
export function wordSyncPoolStatus(resolvedStatus: 'unknown' | 'learning' | 'known', basis: KnowledgeBasis): string {
  if (basis === 'unmeasured') return WORD_SYNC_STATUS_UNTRACKED;
  return String(WORD_STATUS[resolvedStatus.toUpperCase() as keyof typeof WORD_STATUS]);
}


/** One admission rule for the counter and the presented encounter. */
export function wordSyncProbe(projection: KnowledgeProjection, possible: readonly CapabilityKind[]) {
  // A surface prompt cannot isolate an unmeasured homograph sense from a known one.
  const testable = possible.filter(capability => !projection.targets.some(target => target.states.some(state => state.capability === capability && state.classification === 'known')));
  const targets = unresolvedProjectionTargets(projection, testable);
  const { status, basis } = projectedWordStatus(projection);
  return { targets, status: wordSyncPoolStatus(status, basis), focused: testable.length < possible.length };
}
