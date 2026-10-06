import { eventCapability, eventIsDirectKnowledgeEvidence, type KnowledgeEvent } from '../knowledgeEvents';
import { applyEventToFold, emptyKeyFold, mergeKeyFolds, projectKeyFold, type FoldState, type ReplayProjection } from '../utils/projectionReplay';
import { bucketRepresentative, type KeyArchive } from './historyArchive';

/** Materialize capability views from the bounded exact tail and archived folds. */
export function projectCapabilities(
  rows: readonly { event: KnowledgeEvent; seq: number }[],
  archive?: KeyArchive,
  surfaceOnly = false,
): Record<string, ReplayProjection> {
  const folds = new Map<string, FoldState>();
  for (const [key, bucket] of Object.entries(archive?.buckets ?? {})) {
    const representative = bucketRepresentative(key);
    const capability = representative && eventCapability(representative);
    if (capability === undefined || (surfaceOnly && representative?.targetRef !== undefined && representative.targetRef.kind !== 'surface')) continue;
    folds.set(capability, mergeKeyFolds(folds.get(capability) ?? emptyKeyFold(), bucket.measurableFold));
  }
  const retracted = new Set(rows.flatMap(({ event }) => event.retracts === undefined ? [] : [String(event.retracts)]));
  const ordered = [...rows].sort((a, b) => a.event.t - b.event.t || a.seq - b.seq);
  for (const { event, seq } of ordered) {
    if (event.kind === 'retraction' || (event.attemptId !== undefined && retracted.has(String(event.attemptId)))) continue;
    const capability = eventCapability(event);
    if (capability === undefined || !eventIsDirectKnowledgeEvidence(event) || (surfaceOnly && event.targetRef !== undefined && event.targetRef.kind !== 'surface')) continue;
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

/** Latest effective claim or withdrawal; retired claims still prove prior authorship. */
export function projectClaimMarkers(rows: readonly { event: KnowledgeEvent; seq: number }[], surfaceOnly = false): Record<string, { t: number; seq: number; status?: import('../constants').WordStatus }> {
  const markers: ReturnType<typeof projectClaimMarkers> = {};
  const retracted = new Set(rows.flatMap(({ event }) => event.retracts === undefined ? [] : [String(event.retracts)]));
  for (const { event, seq } of [...rows].sort((a, b) => a.event.t - b.event.t || a.seq - b.seq)) {
    if ((surfaceOnly && event.targetRef !== undefined && event.targetRef.kind !== 'surface') || event.kind !== 'claim') continue;
    const capability = eventCapability(event);
    if (capability === undefined) continue;
    if (event.attemptId !== undefined && retracted.has(String(event.attemptId))) {
      // A cache containing this retired claim must not be treated as an
      // unjournaled legacy claim. Keep any older effective claim or withdrawal.
      markers[capability] ??= { t: event.t, seq };
      continue;
    }
    markers[capability] = { t: event.t, seq, ...(event.toStatus !== undefined ? { status: event.toStatus } : {}) };
  }
  return markers;
}
