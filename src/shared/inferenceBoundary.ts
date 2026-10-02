import type { JournalEvent } from './world';
import { deliveredInferenceEvents } from './voiceDelivery';

/** Maintenance availability is distinct from original journal order and witness entitlement. */
export function inferenceSequence(event: JournalEvent): number {
  return typeof event.inferenceAvailabilitySeq === 'number' && Number.isSafeInteger(event.inferenceAvailabilitySeq)
    && event.inferenceAvailabilitySeq >= event.seq ? event.inferenceAvailabilitySeq : event.seq;
}

/** Preserve the journal for display while excluding reviewed-out learner text from later inference. */
export function inferenceEvents(events: readonly JournalEvent[]): JournalEvent[] {
  const restricted = new Set(events.filter(event => event.type === 'review.boundary')
    .map(event => (event.payload as { sourceEventId?: unknown })?.sourceEventId)
    .filter((id): id is string => typeof id === 'string'));
  return deliveredInferenceEvents(events).filter(event => event.type !== 'review.boundary' && event.type !== 'review.admitted'
    && !(event.type === 'message.user' && restricted.has(event.id)));
}
