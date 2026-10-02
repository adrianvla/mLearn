import { voiceSpeakablePhrases } from './voiceSpeechText';
import { HARNESS_ACTOR, USER_ACTOR, type JournalEvent, type VoiceDeliveryPayload } from './world';

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const normalized = (text: string): string => text.replace(/\s+/g, '');

export function isTrackedVoiceMessage(event: JournalEvent): boolean {
  return event.type === 'message.character' && record(event.payload) && event.payload.modality === 'voice'
    && event.payload.voiceDelivery === 'tracked';
}

export function validVoiceDelivery(message: JournalEvent, sidecar: JournalEvent): sidecar is JournalEvent & { payload: VoiceDeliveryPayload } {
  if (!isTrackedVoiceMessage(message) || sidecar.type !== 'delivery.voice' || sidecar.actorId !== HARNESS_ACTOR
    || sidecar.roomId !== message.roomId || sidecar.scope.kind !== message.scope.kind
    || (sidecar.scope.kind === 'thread' && message.scope.kind === 'thread' && sidecar.scope.threadId !== message.scope.threadId)
    || sidecar.seq <= message.seq || !record(message.payload) || !record(sidecar.payload)) return false;
  const data = sidecar.payload;
  if (!Array.isArray(message.witnesses) || !Array.isArray(sidecar.witnesses)) return false;
  const witnesses = new Set(message.witnesses);
  if (sidecar.witnesses.length !== witnesses.size || new Set(sidecar.witnesses).size !== witnesses.size
    || sidecar.witnesses.some(id => !witnesses.has(id))) return false;
  if (data.messageEventId !== message.id || data.actorId !== message.actorId || data.voiceSessionId !== message.payload.voiceSessionId
    || typeof data.voiceSessionId !== 'string' || !data.voiceSessionId || typeof message.payload.text !== 'string'
    || typeof data.spokenText !== 'string' || typeof data.confirmedText !== 'string'
    || typeof data.state !== 'string' || !['playing', 'completed', 'interrupted', 'stopped', 'failed'].includes(data.state)
    || typeof data.basis !== 'string' || !['playback-complete', 'playback-estimate', 'system-complete', 'unavailable'].includes(data.basis)) return false;
  const phrases = voiceSpeakablePhrases(message.payload.text);
  const expectedText = phrases.join(' ');
  const expected = normalized(expectedText);
  const spoken = normalized(data.spokenText), confirmed = normalized(data.confirmedText);
  const wholePrefixes = new Set(['', ...phrases.map((_phrase, index) => phrases.slice(0, index + 1).join(' '))]);
  if (!wholePrefixes.has(data.confirmedText) || !expectedText.startsWith(data.spokenText) || !data.spokenText.startsWith(data.confirmedText)) return false;
  if (data.basis !== 'playback-estimate' && spoken !== confirmed) return false;
  if (data.basis === 'unavailable' && spoken) return false;
  if (data.state === 'completed' && (spoken !== expected || confirmed !== expected || data.basis === 'playback-estimate' || data.basis === 'unavailable')) return false;
  return true;
}

/** Exact identity and scope validation; append order cannot replace a terminal observation. */
export function voiceDeliveries(events: readonly JournalEvent[]): Map<string, JournalEvent & { payload: VoiceDeliveryPayload }> {
  const messages = new Map(events.filter(isTrackedVoiceMessage).map(event => [event.id, event]));
  const result = new Map<string, JournalEvent & { payload: VoiceDeliveryPayload }>();
  for (const event of events) {
    if (event.type !== 'delivery.voice' || !record(event.payload) || typeof event.payload.messageEventId !== 'string') continue;
    const message = messages.get(event.payload.messageEventId);
    if (!message || !validVoiceDelivery(message, event)) continue;
    const previous = result.get(message.id);
    if (previous && (event.seq <= previous.seq || previous.payload.state !== 'playing'
      || !normalized(event.payload.confirmedText).startsWith(normalized(previous.payload.confirmedText)))) continue;
    result.set(message.id, event);
  }
  return result;
}

/** Staging never widens a private note's audience or invents a source encounter. */
export function validVoiceMemoryIntent(message: JournalEvent, note: JournalEvent, events: readonly JournalEvent[]): boolean {
  if (!isTrackedVoiceMessage(message) || note.type !== 'memory.belief' || note.actorId !== HARNESS_ACTOR
    || note.provenance?.voiceMemoryMessageId !== message.id || note.seq <= message.seq
    || note.roomId !== message.roomId || note.scope.kind !== message.scope.kind
    || (note.scope.kind === 'thread' && message.scope.kind === 'thread' && note.scope.threadId !== message.scope.threadId)
    || !record(note.payload) || note.payload.ownerId !== message.actorId || note.payload.kind !== 'belief'
    || typeof note.payload.text !== 'string' || !note.payload.text.trim()
    || !Array.isArray(note.witnesses) || !Array.isArray(message.witnesses)
    || note.witnesses.length !== 2 || new Set(note.witnesses).size !== 2
    || !note.witnesses.includes(USER_ACTOR) || !note.witnesses.includes(message.actorId)
    || note.witnesses.some(id => !message.witnesses.includes(id))
    || !Array.isArray(note.payload.sourceEventIds) || !note.payload.sourceEventIds.includes(message.id)
    || new Set(note.payload.sourceEventIds).size !== note.payload.sourceEventIds.length) return false;
  const restricted = new Set(events.filter(event => event.type === 'review.boundary')
    .map(event => (event.payload as { sourceEventId?: unknown } | null)?.sourceEventId));
  return note.payload.sourceEventIds.every(id => typeof id === 'string' && (id === message.id || events.some(source =>
    source.id === id && source.seq < message.seq && source.type === 'message.user' && source.roomId === note.roomId
    && source.scope.kind === note.scope.kind
    && (source.scope.kind !== 'thread' || note.scope.kind !== 'thread' || source.scope.threadId === note.scope.threadId)
    && !restricted.has(source.id) && Array.isArray(source.witnesses) && note.witnesses.every(witness => source.witnesses.includes(witness)))));
}

/** A durable staged note becomes canonical only after its own response finished playback. */
export function releasedVoiceMemoryEvents(events: readonly JournalEvent[]): JournalEvent[] {
  if (!events.some(event => event.provenance?.voiceMemoryMessageId !== undefined)) return [...events];
  const deliveries = voiceDeliveries(events);
  const messages = new Map(events.filter(isTrackedVoiceMessage).map(event => [event.id, event]));
  return events.flatMap(event => {
    const sourceId = event.provenance?.voiceMemoryMessageId;
    if (sourceId === undefined) return [event];
    const source = messages.get(sourceId), delivery = deliveries.get(sourceId);
    if (!source || !delivery || delivery.payload.state !== 'completed' || !validVoiceMemoryIntent(source, event, events)) return [];
    const { voiceMemoryMessageId: _held, ...provenance } = event.provenance!;
    return [{ ...event, provenance, inferenceAvailabilitySeq: Math.max(event.seq, delivery.seq) }];
  });
}

/** Derived copies only; original generated content and unknown metadata remain in the journal. */
export function deliveredInferenceEvents(events: readonly JournalEvent[]): JournalEvent[] {
  const deliveries = voiceDeliveries(events);
  return releasedVoiceMemoryEvents(events).flatMap(event => {
    if (event.type === 'delivery.voice') return [];
    if (!isTrackedVoiceMessage(event)) return [event];
    const delivery = deliveries.get(event.id);
    if (!delivery || !delivery.payload.confirmedText.trim()) return [];
    const { voiceDelivery: _tracked, widget: _widget, widgets: _widgets, ...payload } = event.payload as Record<string, unknown>;
    return [{ ...event, inferenceAvailabilitySeq: delivery.seq, payload: { ...payload, text: delivery.payload.confirmedText } }];
  });
}
