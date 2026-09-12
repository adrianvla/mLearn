import type { WordStatus } from '../../../../shared/constants';
import { eventIsMeasurable, readActiveEvidence, type KnowledgeEvent } from '../../../../shared/knowledgeEvents';
import { bucketRepresentative, type KeyArchive } from '../../../../shared/knowledge/historyArchive';
import { eventAppliesToCapability } from '../../../../shared/graph/addressing';
import type { CapabilityKey } from '../../../../shared/graph/types';
import { applyEventToFold, emptyKeyFold, mergeKeyFolds, projectKeyFold } from '../../../../shared/utils/projectionReplay';
import { easeToStatus } from '../../../../shared/utils/knowledgeStrength';

export type TrajectoryState = WordStatus | 'unmeasured';
export interface TrajectoryPoint {
  t: number;
  state?: TrajectoryState;
  claim: boolean;
  event: KnowledgeEvent;
}

/** Presentation replay uses the canonical fold. No normalized score or prediction.
 * Inside compressed periods we cannot reconstruct intermediate state, so leave
 * gaps. After a bucket ends its exact sufficient statistics seed the tail. */
export function knowledgeTrajectoryData(events: readonly KnowledgeEvent[], archives: readonly KeyArchive[], capability: CapabilityKey) {
  const buckets = archives.flatMap((archive) => Object.entries(archive.buckets).flatMap(([key, bucket]) => {
    const representative = bucketRepresentative(key);
    return representative && eventAppliesToCapability(representative, capability) ? [bucket] : [];
  }));
  const compressed = buckets.map((bucket) => ({
    from: bucket.fold.firstSeen ?? bucket.fold.lastSeen ?? 0,
    to: bucket.fold.lastSeen ?? bucket.fold.firstSeen ?? 0,
    count: bucket.rowCount,
  }));
  const exact = emptyKeyFold();
  const points: TrajectoryPoint[] = [];
  readActiveEvidence(events).filter((event) => eventAppliesToCapability(event, capability) && eventIsMeasurable(event))
    .sort((a, b) => a.t - b.t).forEach((event, seq) => {
      applyEventToFold(exact, event, seq);
      let prefix = emptyKeyFold();
      for (const bucket of buckets) {
        if ((bucket.fold.lastSeen ?? Infinity) <= event.t) prefix = mergeKeyFolds(prefix, bucket.measurableFold);
      }
      const projection = projectKeyFold(mergeKeyFolds(prefix, exact));
      const incomplete = compressed.some((range) => range.from <= event.t && range.to > event.t);
      const claim = projection?.claim !== undefined;
      const state = incomplete && !claim ? undefined : projection?.claim ?? (projection?.hasActiveEvidence ? easeToStatus(projection.ease) : 'unmeasured');
      points.push({ t: event.t, state, claim, event });
    });
  return { points, compressed };
}
