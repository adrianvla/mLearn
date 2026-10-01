import { eventCapability, type KnowledgeEvent } from '../knowledgeEvents';

/** One logical observation, distinct from the physical attempt containing several accesses. */
export function knowledgeEventIdentity(event: KnowledgeEvent): string | undefined {
  if (event.eventId) return `event:${event.eventId}`;
  if (event.kind === 'retraction') return stableId(event.retracts) ? `retraction:${event.retracts}` : undefined;
  const ref = event.targetRef;
  if (event.ankiReviewId !== undefined) return JSON.stringify(['anki-review', event.ankiReviewId, event.kind,
    ref?.kind ?? '', ref?.id ?? '', ref?.to ?? '', event.schedulerCardId ?? '', eventCapability(event) ?? '']);
  // Old numeric session counters can collide across restarts. Preserve them,
  // rather than guessing whether two historical rows describe the same action.
  if (!stableId(event.attemptId)) return undefined;
  return JSON.stringify(['attempt-observation', event.attemptId, event.kind, event.source,
    ref?.kind ?? '', ref?.id ?? '', ref?.to ?? '', eventCapability(event) ?? '', event.schedulerCardId ?? '']);
}

function stableId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !/^\d+$/.test(value);
}
