import { describe, expect, it } from 'vitest';
import { inferenceEvents } from './inferenceBoundary';
import { HARNESS_ACTOR, type JournalEvent } from './world';
import { visibleEventsFor } from './contextCompiler';
import { projectionForCaller } from './memoryProjection';

const message = (id = 'speech-a', actorId = 'a'): JournalEvent => ({ id, seq: 2, createdAt: 2,
  roomId: 'room', scope: { kind: 'sea' }, actorId, witnesses: ['user', 'a', 'b'], type: 'message.character',
  payload: { text: 'First phrase. Second phrase.', modality: 'voice', voiceSessionId: 'call', voiceDelivery: 'tracked',
    'future:opaque': { value: [1, 'unknown'] } } });
const delivery = (patch: Record<string, unknown> = {}, eventPatch: Partial<JournalEvent> = {}): JournalEvent => ({
  ...message(), id: 'delivery', seq: 5, createdAt: 5, actorId: HARNESS_ACTOR,
  type: 'delivery.voice' as JournalEvent['type'],
  payload: { messageEventId: 'speech-a', actorId: 'a', voiceSessionId: 'call', state: 'interrupted',
    spokenText: 'First phrase. Sec', confirmedText: 'First phrase.', basis: 'playback-estimate', ...patch }, ...eventPatch });

describe('voice delivery inference boundary', () => {
  it('keeps pending generated voice text out of inference without mutating the journal', () => {
    const raw = message();
    expect(inferenceEvents([raw])).toEqual([]);
    expect((raw.payload as { text: string }).text).toBe('First phrase. Second phrase.');
  });

  it('uses only completed phrases from an exact actor/call sidecar and remains idempotent', () => {
    const raw = message();
    const projected = inferenceEvents([raw, delivery()]);
    expect(projected).toHaveLength(1);
    expect(projected[0]).toMatchObject({ id: raw.id, seq: raw.seq, inferenceAvailabilitySeq: 5, payload: { text: 'First phrase.', 'future:opaque': { value: [1, 'unknown'] } } });
    expect(inferenceEvents(projected)).toEqual(projected);
    expect((raw.payload as { text: string }).text).toBe('First phrase. Second phrase.');
  });

  it('does not confuse queued actor B with the currently delivered actor A', () => {
    const projected = inferenceEvents([message(), message('speech-b', 'b'), delivery()]);
    expect(projected.map(event => event.id)).toEqual(['speech-a']);
  });

  it.each([
    [{ actorId: 'b' }, {}], [{ voiceSessionId: 'old-call' }, {}], [{ messageEventId: 'other' }, {}],
    [{ confirmedText: 'Invented speech.', spokenText: 'Invented speech.' }, {}],
    [{ confirmedText: 'Second phrase.', spokenText: 'Second phrase.' }, {}],
    [{ confirmedText: 'Fir', spokenText: 'Fir', basis: 'playback-complete' }, {}],
    [{ confirmedText: 'F i r s t phrase.', spokenText: 'F i r s t phrase.', basis: 'playback-complete' }, {}],
    [{ confirmedText: 'First phrase.', spokenText: '' }, {}],
    [{ state: ['interrupted'] }, {}], [{ basis: ['playback-estimate'] }, {}],
    [{}, { roomId: 'other' }], [{}, { scope: { kind: 'thread', threadId: 'other' } }],
    [{}, { actorId: 'a' }], [{}, { witnesses: ['user', 'a', 'b', 'outsider'] }],
    [{}, { witnesses: null }], [{}, { witnesses: 'user,a,b' }],
  ])('ignores malformed or mismatched delivery records (%j, %j)', (patch, eventPatch) => {
    expect(inferenceEvents([message(), delivery(patch, eventPatch as Partial<JournalEvent>)])).toEqual([]);
  });

  it('excludes estimated fragments but preserves completed phrases from an unfinished call after restart', () => {
    expect(inferenceEvents([message(), delivery({ confirmedText: '', spokenText: 'Fir' })])).toEqual([]);
    expect(inferenceEvents([message(), delivery({ state: 'playing' })])).toMatchObject([{ payload: { text: 'First phrase.' } }]);
  });

  it('preserves legacy voice and ordinary text history without inventing a playback record', () => {
    const legacy = { ...message(), payload: { text: 'Legacy voice', modality: 'voice' } };
    const text = { ...message('text'), payload: { text: 'Ordinary text' } };
    expect(inferenceEvents([legacy, text])).toEqual([legacy, text]);
  });

  it('keeps original membership visibility separate from late delivery eligibility', () => {
    const removal: JournalEvent = { ...message(), id: 'removed', seq: 3, createdAt: 3, type: 'membership', actorId: HARNESS_ACTOR,
      payload: { participantId: 'b', action: 'removed' } };
    const original = message();
    const lateDelivery = delivery();
    const view = visibleEventsFor('b', inferenceEvents([original, removal, lateDelivery]));
    expect(view.find(event => event.id === original.id)).toMatchObject({ seq: 2, inferenceAvailabilitySeq: 5, payload: { text: 'First phrase.' } });
    const absentSpeech = { ...original, seq: 4, createdAt: 4 };
    expect(visibleEventsFor('b', inferenceEvents([removal, absentSpeech, lateDelivery])).map(event => event.id)).not.toContain(original.id);
  });

  it('releases durable private voice notes only after exact completed playback and survives projection round trips', () => {
    const speech = message();
    const note: JournalEvent = { ...speech, id: 'note', seq: 3, actorId: HARNESS_ACTOR, type: 'memory.belief',
      witnesses: ['user', 'a'], payload: { ownerId: 'a', kind: 'belief', text: 'Reviewed private note', sourceEventIds: [speech.id], 'future:data': { retained: true } },
      provenance: { voiceMemoryMessageId: speech.id } };
    expect(inferenceEvents([speech, note])).toEqual([]);
    expect(projectionForCaller([speech, note], 'a').beliefs).toEqual([]);
    expect(inferenceEvents([speech, note, delivery()]).map(event => event.id)).toEqual([speech.id]);
    const completed = delivery({ state: 'completed', spokenText: 'First phrase. Second phrase.', confirmedText: 'First phrase. Second phrase.', basis: 'playback-complete' });
    const projected = inferenceEvents(JSON.parse(JSON.stringify([speech, note, completed])) as JournalEvent[]);
    expect(projected.find(event => event.id === note.id)).toMatchObject({ seq: 3, inferenceAvailabilitySeq: 5,
      witnesses: ['user', 'a'], payload: { text: 'Reviewed private note', 'future:data': { retained: true } } });
    expect(inferenceEvents(projected)).toEqual(projected);
    expect(visibleEventsFor('b', projected).map(event => event.id)).not.toContain(note.id);
    expect(projectionForCaller([speech, note, completed], 'a').beliefs).toHaveLength(1);
    expect(projectionForCaller([speech, note, completed], 'b').beliefs).toHaveLength(0);
  });
});
