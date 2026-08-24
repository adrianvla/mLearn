import { readActiveEvidence, type KnowledgeEvent } from '../knowledgeEvents';
import { replayKeyProjection } from '../utils/projectionReplay';
import { deriveRetentionSchedule, type RetentionPolicy } from '../srs/retentionScheduler';
import type { CapabilityKind } from './types';

export type TargetState = 'evidence-backed-known' | 'learning' | 'predicted' | 'unmeasured' | 'excluded';

export interface TargetExplanation {
  state: TargetState;
  evidence: KnowledgeEvent[];
  projection: ReturnType<typeof replayKeyProjection>;
  retention: ReturnType<typeof deriveRetentionSchedule> | null;
  prediction?: { value: number; because: string[] };
}

/** Shared explainability assembly: active evidence first, predictions never become evidence. */
export function assembleTargetExplanation(
  capability: CapabilityKind,
  events: readonly KnowledgeEvent[],
  policy: RetentionPolicy,
  now = Date.now(),
  prediction?: TargetExplanation['prediction'],
): TargetExplanation {
  const evidence = readActiveEvidence(events).filter((event) => !event.targetRef?.capability || event.targetRef.capability === capability);
  const projection = replayKeyProjection(evidence);
  const ratings = evidence.flatMap((event) => event.rating ? [{ t: event.t, rating: event.rating }] : []);
  const retention = ratings.length ? deriveRetentionSchedule({ createdAt: evidence[0]?.t ?? now, initialEase: 2.5 }, ratings, policy, now) : null;
  const state: TargetState = projection?.ease !== undefined && projection.ease >= 2.5
    ? 'evidence-backed-known'
    : projection ? 'learning'
      : prediction ? 'predicted'
        : 'unmeasured';
  return { state, evidence, projection, retention, ...(prediction ? { prediction } : {}) };
}
