import { readActiveEvidence, type KnowledgeEvent } from './knowledgeEvents';

/** Bounded canonical tail; not a new evidence authority or an archive reconstruction. */
export interface LearningEvidenceSnapshot {
  sequence: number;
  events: KnowledgeEvent[];
  truncated: boolean;
  /** Oldest retained observation. Missing history stays missing, never failed. */
  firstT?: number;
}
export const LEARNING_EVIDENCE_ROW_CAP = 1024;
export const LEARNING_EVIDENCE_BYTE_CAP = 384 * 1024;

/** Trim wire-only audit detail, retaining the actual task, assistance, identities and versions. */
export function compactLearningEvidence(event: KnowledgeEvent): KnowledgeEvent {
  const { decision, ...rest } = event;
  return { ...rest, ...(decision ? { decision: { ...decision, baseline: null, detail: { scope: decision.detail.scope },
    selected: { ...decision.selected, presentation: undefined } } } : {}) };
}

/** Mobile owns an in-memory shard. Retractions are applied BEFORE taking its bounded tail. */
export function learningEvidenceFromEvents(events: readonly KnowledgeEvent[], sequence: number): LearningEvidenceSnapshot {
  const active = readActiveEvidence(events).filter(event => event.kind === 'rating' || event.kind === 'review').sort((a, b) => b.t - a.t);
  const decisions = new Map(events.flatMap(event => event.decision ? [[event.decision.id, event.decision] as const] : []));
  const selected: KnowledgeEvent[] = []; let bytes = 128;
  for (const event of active.slice(0, LEARNING_EVIDENCE_ROW_CAP)) {
    const compact = compactLearningEvidence(!event.decision && event.decisionRef && decisions.has(event.decisionRef.id)
      ? { ...event, decision: decisions.get(event.decisionRef.id) } : event);
    const size = new TextEncoder().encode(JSON.stringify(compact)).byteLength + 1;
    if (bytes + size > LEARNING_EVIDENCE_BYTE_CAP) break;
    selected.push(compact); bytes += size;
  }
  selected.reverse();
  return { sequence, events: selected, truncated: selected.length < active.length, ...(selected.length ? { firstT: selected[0].t } : {}) };
}
