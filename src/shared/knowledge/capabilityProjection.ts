import { eventCapability, eventIsMeasurable, type KnowledgeEvent } from '../knowledgeEvents';
import { applyEventToFold, emptyKeyFold, mergeKeyFolds, projectKeyFold, type FoldState, type ReplayProjection } from '../utils/projectionReplay';
import { bucketRepresentative, type KeyArchive } from './historyArchive';

/** Materialize capability views from the bounded exact tail and archived folds. */
export function projectCapabilities(
  rows: readonly { event: KnowledgeEvent; seq: number }[],
  archive?: KeyArchive,
): Record<string, ReplayProjection> {
  const folds = new Map<string, FoldState>();
  for (const [key, bucket] of Object.entries(archive?.buckets ?? {})) {
    const representative = bucketRepresentative(key);
    const capability = representative && eventCapability(representative);
    if (capability === undefined) continue;
    folds.set(capability, mergeKeyFolds(folds.get(capability) ?? emptyKeyFold(), bucket.measurableFold));
  }
  const retracted = new Set(rows.flatMap(({ event }) => event.retracts === undefined ? [] : [String(event.retracts)]));
  const ordered = [...rows].sort((a, b) => a.event.t - b.event.t || a.seq - b.seq);
  for (const { event, seq } of ordered) {
    if (event.kind === 'retraction' || (event.attemptId !== undefined && retracted.has(String(event.attemptId)))) continue;
    const capability = eventCapability(event);
    if (capability === undefined || !eventIsMeasurable(event)) continue;
    const fold = folds.get(capability) ?? emptyKeyFold();
    applyEventToFold(fold, event, seq);
    folds.set(capability, fold);
  }
  const projections: Record<string, ReplayProjection> = {};
  for (const [capability, fold] of folds) {
    const projection = projectKeyFold(fold);
    if (projection) projections[capability] = projection;
  }
  return projections;
}
