import { eventIsMeasurable, readActiveEvidence, type KnowledgeEvent } from '../knowledgeEvents';
import { eventAppliesToCapability } from './addressing';
import { replayKeyProjection, type ReplayProjection } from '../utils/projectionReplay';
import { easeToStatus } from '../utils/knowledgeStrength';
import { deriveRetentionSchedule, type RetentionPolicy } from '../srs/retentionScheduler';
import type { CapabilityKey } from './types';

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
  projection: ReturnType<typeof replayKeyProjection>;
  retention: ReturnType<typeof deriveRetentionSchedule> | null;
  prediction?: { value: number; because: string[] };
}

/**
 * Capability-only routing moved to ./addressing (eventAppliesToCapability):
 * this module consumes the address-aware matcher so graph-relative evidence
 * resolution and legacy key scoping stay one implementation.
 */


/**
 * One classification rule for a replayed projection: claim ?? active evidence,
 * unmeasured when only passive familiarity exists. The projection (timesSeen,
 * ease, prediction) stays attached for familiarity consumers either way.
 */
function effectiveState(projection: ReplayProjection): TargetState {
  if (projection.claim !== undefined) {
    if (projection.claim === 'known') return 'claimed-known';
    if (projection.claim === 'learning') return 'claimed-learning';
    return 'claimed-unknown';
  }
  if (!projection.hasActiveEvidence) return 'unmeasured';
  const status = easeToStatus(projection.ease);
  return status === 'known' ? 'evidence-backed-known' : status;
}

/** Shared explainability assembly: active evidence first, predictions never become evidence. */
export function assembleTargetExplanation(
  capability: CapabilityKey,
  events: readonly KnowledgeEvent[],
  policy: RetentionPolicy,
  now = Date.now(),
  prediction?: TargetExplanation['prediction'],
  /**
   * Address-aware evidence predicate. Defaults to capability-only matching
   * (the caller's journal-key scoping is the address); graph-aware callers
   * pass eventAppliesToTarget partially applied to the graph + queried
   * surface so shared-entry variants resolve without state copies.
   */
  matcher: (event: KnowledgeEvent) => boolean = (event) => eventAppliesToCapability(event, capability),
): TargetExplanation {
  const active = readActiveEvidence(events);
  // Knowledge evidence vs scheduler bookkeeping: a scaffold-invalidated event
  // (its own presentation supplied the access) measures nothing, but the
  // review still HAPPENED — retention scheduling consumes the occurrence,
  // never crediting knowledge.
  const evidence = active.filter((event) => eventIsMeasurable(event) && matcher(event));
  // Retention consumes only what the queried capability's presentation left
  // measurable: a translation-cued review provides no sense-recognition
  // schedule, while a furigana-cued review still provides full meaning
  // retention. Per-access honesty — never the card-level aggregate.
  const ratings = active.filter((event) => eventIsMeasurable(event) && matcher(event)).flatMap((event) => event.rating ? [{ t: event.t, rating: event.rating }] : []);
  const projection = replayKeyProjection(evidence);
  const retention = ratings.length ? deriveRetentionSchedule({ createdAt: evidence[0]?.t ?? now, initialEase: 2.5 }, ratings, policy, now) : null;
  const state: TargetState = projection ? effectiveState(projection) : prediction ? 'predicted' : 'unmeasured';
  return { state, evidence, projection, retention, ...(prediction ? { prediction } : {}) };
}
