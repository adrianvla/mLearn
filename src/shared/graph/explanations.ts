import { eventIsDirectKnowledgeEvidence, type KnowledgeEvent } from '../knowledgeEvents';
import { eventAppliesToCapability } from './addressing';
import {
  computeRetention,
  foldArchiveBucketsMeasurable,
  mergeArchives,
  type KeyArchive,
} from '../knowledge/historyArchive';
import {
  applyEventToFold,
  emptyKeyFold,
  mergeKeyFolds,
  projectKeyFold,
  type ReplayProjection,
} from '../utils/projectionReplay';

/** Exact journal row with its stable insertion-order identity. */
export interface JournalRow {
  event: KnowledgeEvent;
  seq: number;
}

/**
 * Normalization boundary: production callers pass true journal rows (stable
 * seq from the store); tests and legacy callers pass plain event arrays whose
 * array order IS the journal order of a single key.
 */
export function toJournalRows(input: readonly (KnowledgeEvent | JournalRow)[]): JournalRow[] {
  return input.map((item, index) => ('event' in item ? (item as JournalRow) : { event: item as KnowledgeEvent, seq: index }));
}

function stripRetractedRows(rows: readonly JournalRow[]): JournalRow[] {
  const retracted = new Set<string>();
  for (const { event } of rows) {
    if (event.retracts !== undefined) retracted.add(`${event.retracts}`);
  }
  if (retracted.size === 0) return rows.filter(({ event }) => event.kind !== 'retraction');
  return rows.filter(({ event }) => {
    if (event.retracts !== undefined || event.kind === 'retraction') return false;
    return !(event.attemptId !== undefined && retracted.has(`${event.attemptId}`));
  });
}
import { effectiveStateFromEntry, effectiveThresholds, type EffectiveThresholds } from '../knowledge/effectiveKnowledge';
import { deriveRetentionSchedule, type RetentionPolicy } from '../srs/retentionScheduler';
import type { CapabilityKey } from './types';
import type { SupportContributor } from '../prediction/supportContributors';

/**
 * Effective state of one learnable target. Claim states are distinct from
 * evidence states so every consumer can show basis honestly:
 *
 * - `claimed-*` — an active explicit claim overrides the classification;
 *   the underlying evidence stays intact and is reported separately.
 * - `evidence-backed-known` — active (non-passive) evidence classifies Known.
 * - `learning` — active evidence-derived Learning only. Passive-only
 *   familiarity is never a state: exposure alone proves nothing (REQ13).
 * - `unknown` — actual negative evidence (or a negative claim).
 * - `predicted` — no measurement, graph support only. Never evidence.
 * - `unmeasured` — nothing measured: no active evidence and no claim. A
 *   passive-only replay (hasEvidence, no hasActiveEvidence, no claim) lands
 *   here — with familiarity counts and prediction preserved on the payload.
 */
export type TargetState =
  | 'evidence-backed-known'
  | 'claimed-known'
  | 'claimed-learning'
  | 'claimed-unknown'
  | 'learning'
  | 'unknown'
  | 'predicted'
  | 'unmeasured';

export interface TargetExplanation {
  state: TargetState;
  evidence: KnowledgeEvent[];
  projection: ReturnType<typeof projectKeyFold>;
  retention: ReturnType<typeof deriveRetentionSchedule> | null;
  /** Exact retained event establishing the current replay strength, not all history. */
  knowledgeWitness?: KnowledgeEvent;
  prediction?: { value: number; because: string[]; model?: string; interpretation?: 'heuristic-support'; contributors?: SupportContributor[] };
}

/**
 * Capability-only routing moved to ./addressing (eventAppliesToCapability):
 * this module consumes the address-aware matcher so graph-relative evidence
 * resolution and legacy key scoping stay one implementation.
 */


/** Shared explainability assembly: active evidence first, predictions never become evidence. */
export function assembleTargetExplanation(
  capability: CapabilityKey,
  rawRows: readonly (KnowledgeEvent | JournalRow)[],
  policy: RetentionPolicy | undefined,
  now = Date.now(),
  prediction?: TargetExplanation['prediction'],
  /**
   * Address-aware evidence predicate. Defaults to capability-only matching
   * (the caller's journal-key scoping is the address); graph-aware callers
   * pass eventAppliesToTarget partially applied to the graph + queried
   * surface so shared-entry variants resolve without state copies. The SAME
   * predicate selects archive buckets (via their raw-address representatives)
   * so aggregated old evidence resolves identically to raw rows.
   */
  matcher: (event: KnowledgeEvent) => boolean = (event) => eventAppliesToCapability(event, capability),
  /** Sibling-key archives (aggregated old evidence) for the queried target. */
  archives?: readonly KeyArchive[],
  thresholds: EffectiveThresholds = effectiveThresholds(),
): TargetExplanation {
  const rows = toJournalRows(rawRows);
  const active = stripRetractedRows(rows);
  // Knowledge evidence vs scheduler bookkeeping: a scaffold-invalidated event
  // (its own presentation supplied the access) measures nothing, but the
  // review still HAPPENED — retention scheduling consumes the occurrence,
  // never crediting knowledge.
  const evidenceRows = active
    .filter(({ event }) => eventIsDirectKnowledgeEvidence(event) && matcher(event))
    .sort((a, b) => a.event.t - b.event.t || a.seq - b.seq);
  const evidence = evidenceRows.filter(({ event }) => event.kind !== 'claim').map(({ event }) => event);
  const mergedArchive = mergeArchives(archives ?? []);
  // Archived prefix: measurable bucket folds selected by the same matcher.
  const archiveFold = mergedArchive ? foldArchiveBucketsMeasurable(mergedArchive, matcher) : emptyKeyFold();
  const exactFold = emptyKeyFold();
  for (const { event, seq } of evidenceRows) {
    applyEventToFold(exactFold, event, seq);
  }
  const fold = mergedArchive ? mergeKeyFolds(archiveFold, exactFold) : exactFold;
  const projection: ReplayProjection | null = evidenceRows.length > 0 || archiveFold.hasEvidence || archiveFold.claim !== undefined ? projectKeyFold(fold) : null;
  // Retention over the frontier sequence: exact rows + residue columns in one
  // (t, seq) order — true journal seq on both sides, no ordering ambiguity.
  const retention = computeRetention(mergedArchive, evidenceRows, policy, now, matcher);
  const effective = effectiveStateFromEntry(projection ?? undefined, thresholds);
  // Presentation vocabulary only: classification and basis come from the shared resolver.
  const state: TargetState = effective.basis === 'claim'
    ? `claimed-${effective.status}`
    : effective.basis === 'unmeasured'
      ? (!projection && prediction ? 'predicted' : 'unmeasured')
      : effective.status === 'known' ? 'evidence-backed-known' : effective.status;
  // Sequences are journal-key local. A retained sibling row can share the
  // archived winner's t/seq; mergeKeyFolds keeps the archive on a tie. Pin the
  // actual winning side before looking for an exact retained event.
  const exactWins = exactFold.ease !== undefined && (archiveFold.ease === undefined
    || exactFold.easeT > archiveFold.easeT || (exactFold.easeT === archiveFold.easeT && exactFold.easeSeq > archiveFold.easeSeq));
  const witness = exactWins ? evidenceRows.find(row => row.event.t === exactFold.easeT && row.seq === exactFold.easeSeq)?.event : undefined;
  return { state, evidence, projection, retention,
    ...(witness ? { knowledgeWitness: witness } : {}), ...(prediction ? { prediction } : {}) };
}
