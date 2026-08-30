import { readActiveEvidence, type KnowledgeEvent } from '../knowledgeEvents';
import { replayKeyProjection, type ReplayProjection } from '../utils/projectionReplay';
import { easeToStatus } from '../utils/knowledgeStrength';
import { deriveRetentionSchedule, type RetentionPolicy } from '../srs/retentionScheduler';
import type { CapabilityKind } from './types';
import { ASPECT_CAPABILITY } from './types';

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
 * Meaning evidence/claims govern the meaning-visible capabilities; every other
 * word aspect maps 1:1 through ASPECT_CAPABILITY. Grammar rows travel only via
 * targetRef.capability; legacy flat grammar rows (aspect 'grammar', no
 * capability) stay on the conservative recognition capability they can justify.
 */
const MEANING_CAPABILITIES: ReadonlySet<CapabilityKind> = new Set(['sense-recognition', 'surface-recognition']);

export function eventAppliesToCapability(event: KnowledgeEvent, capability: CapabilityKind): boolean {
  if (event.targetRef?.capability !== undefined) return event.targetRef.capability === capability;
  if (event.aspect === 'grammar') return capability === 'grammar-recognition';
  const eventCapability = ASPECT_CAPABILITY[event.aspect];
  if (eventCapability === 'sense-recognition') return MEANING_CAPABILITIES.has(capability);
  return eventCapability === capability;
}

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
  capability: CapabilityKind,
  events: readonly KnowledgeEvent[],
  policy: RetentionPolicy,
  now = Date.now(),
  prediction?: TargetExplanation['prediction'],
): TargetExplanation {
  const evidence = readActiveEvidence(events).filter((event) => eventAppliesToCapability(event, capability));
  const projection = replayKeyProjection(evidence);
  const ratings = evidence.flatMap((event) => event.rating ? [{ t: event.t, rating: event.rating }] : []);
  const retention = ratings.length ? deriveRetentionSchedule({ createdAt: evidence[0]?.t ?? now, initialEase: 2.5 }, ratings, policy, now) : null;
  const state: TargetState = projection ? effectiveState(projection) : prediction ? 'predicted' : 'unmeasured';
  return { state, evidence, projection, retention, ...(prediction ? { prediction } : {}) };
}
