import type { KnowledgeProjection } from '../../../shared/graph/ipc';
import type { CapabilityKey } from '../../../shared/graph/types';
import { projectedWordStatus, unresolvedProjectionTargets } from '../../../shared/graph/targets';
import type { KnowledgeBasis } from '../../../shared/knowledge/effectiveKnowledge';
import { WORD_STATUS } from '../../../shared/constants';
import { WORD_SYNC_STATUS_UNTRACKED } from '../../components/common/FilterBuilder/presets';


/** Encode canonical knowledge for filter operands; Untracked means Unmeasured. */
export function wordSyncPoolStatus(resolvedStatus: 'unknown' | 'learning' | 'known', basis: KnowledgeBasis): string {
  if (basis === 'unmeasured') return WORD_SYNC_STATUS_UNTRACKED;
  return String(WORD_STATUS[resolvedStatus.toUpperCase() as keyof typeof WORD_STATUS]);
}


/** One admission rule for the counter and the presented encounter.
 *
 *  An ABSENT projection — or a READY projection with an empty target list
 *  and `surfaceKnown: false` (graph-unmapped surface) — is treated as
 *  UNMEASURED when the caller supplies the surface's canonical entity id:
 *  one unresolved target per possible capability, status Untracked, focused
 *  false. Without the entity id those surfaces stay non-admissible (the
 *  fallback is a total non-crashing status only, never an admission path).
 *  A ready projection WITH targets keeps the existing admission rule.
 */
export function wordSyncProbe(
  projection: KnowledgeProjection | undefined,
  possible: readonly CapabilityKey[],
  surfaceEntityId?: string,
) {
  if (!projection) {
    // Absent surface: admissible only with identity (unmeasured shape).
    if (surfaceEntityId !== undefined && possible.length > 0) {
      return {
        targets: possible.map(capability => ({ entityId: surfaceEntityId, capability })),
        status: WORD_SYNC_STATUS_UNTRACKED,
        focused: false,
      };
    }
    return { targets: [], status: WORD_SYNC_STATUS_UNTRACKED, focused: false };
  }
  // A surface prompt cannot isolate an unmeasured homograph sense from a known one.
  const testable = possible.filter(capability => !projection.targets.some(target => target.states.some(state => state.capability === capability && state.classification === 'known')));
  const targets = unresolvedProjectionTargets(projection, testable);
  const { status, basis } = projectedWordStatus(projection);
  // Graph-unmapped surface: a ready projection with NO targets is the
  // unmeasured shape (surfaceKnown false) — construct identity-backed
  // targets so the word stays admissible. A graph-unmapped projection that
  // already carries measured lexical evidence is NOT reconstructed: its
  // summary decides admission like any measured surface.
  const lexicalUnmeasured = projection.lexical?.overall?.basis === undefined
    || projection.lexical.overall.basis === 'unmeasured';
  const effectiveTargets = targets.length > 0 || projection.targets.length > 0
    ? targets
    : (surfaceEntityId !== undefined && projection.surfaceKnown === false && lexicalUnmeasured && possible.length > 0
      ? possible.map(capability => ({ entityId: surfaceEntityId, capability }))
      : targets);
  return {
    targets: effectiveTargets,
    status: wordSyncPoolStatus(status, basis),
    focused: testable.length < possible.length,
  };
}
