/** Pure projections for V09 intention state and committed simulated occurrences. */

import { tombstonedIds } from './memoryProjection';
import type {
  IntentionPayload,
  IntentionStatus,
  JournalEvent,
  SimulatedOccurrencePayload,
} from './world';

const INTENTION_STATUSES: readonly IntentionStatus[] = [
  'created',
  'pursued',
  'revised',
  'completed',
  'abandoned',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isIntentionStatus(value: unknown): value is IntentionStatus {
  return typeof value === 'string' && (INTENTION_STATUSES as readonly string[]).includes(value);
}

export function intentionPayload(event: JournalEvent): IntentionPayload | null {
  if (event.type !== 'intention' || !isRecord(event.payload)) return null;
  const value = event.payload;
  if (
    typeof value.intentionId !== 'string'
    || typeof value.ownerId !== 'string'
    || !isIntentionStatus(value.status)
    || typeof value.text !== 'string'
    || !Array.isArray(value.sourceEventIds)
    || !value.sourceEventIds.every(item => typeof item === 'string')
    || !Array.isArray(value.groundingRefs)
    || !value.groundingRefs.every(item => typeof item === 'string')
    || (value.previousEventId !== undefined && typeof value.previousEventId !== 'string')
  ) return null;
  return value as unknown as IntentionPayload;
}

export interface IntentionState {
  event: JournalEvent;
  payload: IntentionPayload;
  active: boolean;
}

/** Latest surviving lifecycle row wins. Corrections retain journal history but
 * remove the invalid state transition from the current projection. */
export function intentionStates(events: JournalEvent[]): Map<string, IntentionState> {
  const invalid = tombstonedIds(events);
  const result = new Map<string, IntentionState>();
  for (const event of events) {
    if (invalid.has(event.id)) continue;
    const payload = intentionPayload(event);
    if (!payload) continue;
    const prior = result.get(payload.intentionId);
    if (prior && prior.event.seq > event.seq) continue;
    result.set(payload.intentionId, {
      event,
      payload,
      active: payload.status === 'created' || payload.status === 'pursued' || payload.status === 'revised',
    });
  }
  return result;
}

export function simulatedOccurrencePayload(event: JournalEvent): SimulatedOccurrencePayload | null {
  if (event.type !== 'occurrence.simulated' || !isRecord(event.payload)) return null;
  const value = event.payload;
  if (
    value.authority !== 'simulated-occurrence'
    || typeof value.operationId !== 'string'
    || typeof value.summary !== 'string'
    || !Array.isArray(value.actorIds)
    || !value.actorIds.every(item => typeof item === 'string')
    || !Array.isArray(value.sourceEventIds)
    || !value.sourceEventIds.every(item => typeof item === 'string')
    || typeof value.intentionId !== 'string'
    || !isIntentionStatus(value.outcome)
    || value.outcome === 'created'
    || typeof value.effectiveAt !== 'number'
    || !Number.isFinite(value.effectiveAt)
  ) return null;
  return value as unknown as SimulatedOccurrencePayload;
}

