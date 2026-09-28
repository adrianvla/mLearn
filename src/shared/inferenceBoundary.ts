import type { JournalEvent } from './world';

/** Preserve the journal for display while excluding reviewed-out learner text from later inference. */
export function inferenceEvents(events: readonly JournalEvent[]): JournalEvent[] {
  const restricted = new Set(events.filter(event => event.type === 'review.boundary')
    .map(event => (event.payload as { sourceEventId?: unknown })?.sourceEventId)
    .filter((id): id is string => typeof id === 'string'));
  return events.filter(event => event.type !== 'review.boundary' && event.type !== 'review.admitted'
    && !(event.type === 'message.user' && restricted.has(event.id)));
}
