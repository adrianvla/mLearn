import { describe, expect, it } from 'vitest';

import {
  applyMembershipChange,
  makeThread,
  projectHistoryForParticipant,
  runRoomTurn,
  type RoomAgentRunner,
} from './roomOrchestrator';
import {
  HARNESS_ACTOR,
  USER_ACTOR,
  type JournalEvent,
  type JournalEventDraft,
  type Participant,
  type Room,
} from './world';

function participant(id: string, displayName: string, facets?: Participant['facets']): Participant {
  return { id, displayName, kind: 'persistent', personaText: '', facets, setupComplete: true };
}

function room(id: string, participantIds: string[]): Room {
  return { id, title: 'Test Room', participantIds, createdAt: 0 };
}

function messageEvent(
  id: string,
  seq: number,
  actorId: string,
  text: string,
  witnesses: string[],
): JournalEvent {
  return {
    id,
    seq,
    roomId: 'r1',
    scope: { kind: 'thread', threadId: 't1' },
    type: actorId === USER_ACTOR ? 'message.user' : 'message.character',
    actorId,
    witnesses,
    payload: { text },
    createdAt: 0,
  };
}

function memoryEvent(id: string, seq: number): JournalEvent {
  return {
    id,
    seq,
    roomId: 'r1',
    scope: { kind: 'sea' },
    type: 'memory.belief',
    actorId: 'p_a',
    witnesses: ['p_a', USER_ACTOR],
    payload: { ownerId: 'p_a', kind: 'belief', text: 'remembered' },
    createdAt: 0,
  };
}

function makeAppender() {
  const appended: JournalEvent[] = [];
  const appendEvent = async (draft: JournalEventDraft): Promise<JournalEvent> => {
    const e: JournalEvent = {
      ...draft,
      id: `evt_${appended.length + 2}`,
      seq: appended.length + 2,
      createdAt: 0,
    };
    appended.push(e);
    return e;
  };
  return { appended, appendEvent };
}

function makeRunner(script: Record<string, string>) {
  const order: string[] = [];
  const runner: RoomAgentRunner = async (participantId, _context) => {
    order.push(`start:${participantId}`);
    await Promise.resolve();
    order.push(`end:${participantId}`);
    return { text: script[participantId] ?? '...' };
  };
  return { runner, order };
}

describe('applyMembershipChange', () => {
  it('add appends the id and drafts an added event witnessed by pre-change roster + affected + user', () => {
    const r = room('r1', ['p_a']);
    const { room: r2, event } = applyMembershipChange(r, 'p_b', 'add');
    expect(r2.participantIds).toEqual(['p_a', 'p_b']);
    expect(event).not.toBeNull();
    expect(event!.type).toBe('membership');
    expect(event!.actorId).toBe(HARNESS_ACTOR);
    expect(event!.scope).toEqual({ kind: 'sea' });
    expect(event!.payload).toEqual({ participantId: 'p_b', action: 'added' });
    expect(event!.witnesses).toEqual(['p_a', 'p_b', USER_ACTOR]);
  });

  it('remove drops the id and drafts a removed event witnessed by the removed participant', () => {
    const r = room('r1', ['p_a', 'p_b']);
    const { room: r2, event } = applyMembershipChange(r, 'p_b', 'remove');
    expect(r2.participantIds).toEqual(['p_a']);
    expect(event!.payload).toEqual({ participantId: 'p_b', action: 'removed' });
    expect(event!.witnesses).toEqual(['p_a', 'p_b', USER_ACTOR]);
  });

  it('add when present / remove when absent → unchanged room, null event', () => {
    const r = room('r1', ['p_a']);
    expect(applyMembershipChange(r, 'p_a', 'add').event).toBeNull();
    expect(applyMembershipChange(r, 'p_b', 'remove').event).toBeNull();
  });

  it('honors a custom userActorId in witnesses', () => {
    const r = room('r1', ['p_a']);
    const { event } = applyMembershipChange(r, 'p_b', 'add', 'me');
    expect(event!.witnesses).toEqual(['p_a', 'p_b', 'me']);
  });
});

describe('projectHistoryForParticipant', () => {
  it('maps roles: own → assistant, user → user, others → user with displayName prefix', () => {
    const a = participant('p_a', 'Anna');
    const b = participant('p_b', 'Bella');
    const events = [
      messageEvent('evt_1', 1, USER_ACTOR, 'Hello Anna', ['p_a', USER_ACTOR]),
      messageEvent('evt_2', 2, 'p_a', 'Hi there', ['p_a', USER_ACTOR]),
      messageEvent('evt_3', 3, 'p_b', 'Hey Anna', ['p_a', 'p_b', USER_ACTOR]),
    ];
    expect(projectHistoryForParticipant(events, 'p_a', [a, b])).toEqual([
      { role: 'user', content: 'Hello Anna' },
      { role: 'assistant', content: 'Hi there' },
      { role: 'user', content: 'Bella: Hey Anna' },
    ]);
  });

  it('skips non-message events', () => {
    const a = participant('p_a', 'Anna');
    const events = [
      messageEvent('evt_1', 1, USER_ACTOR, 'Hi', ['p_a', USER_ACTOR]),
      memoryEvent('evt_2', 2),
    ];
    expect(projectHistoryForParticipant(events, 'p_a', [a])).toEqual([
      { role: 'user', content: 'Hi' },
    ]);
  });
});

describe('makeThread', () => {
  it('matches the Thread contract', () => {
    expect(makeThread('r1', 't1', 1234, 'My Thread')).toEqual({
      id: 't1',
      roomId: 'r1',
      title: 'My Thread',
      state: 'active',
      createdAt: 1234,
    });
    const t = makeThread('r1', 't2', 0);
    expect(t.title).toBeUndefined();
    expect(t.state).toBe('active');
  });
});

describe('runRoomTurn', () => {
  it('runs character turns sequentially: A fully resolves before B starts', async () => {
    const a = participant('p_a', 'Anna');
    const b = participant('p_b', 'Bella');
    const r = room('r1', ['p_a', 'p_b']);
    const threadEvents = [messageEvent('evt_1', 1, USER_ACTOR, 'Hello everyone', ['p_a', 'p_b', USER_ACTOR])];
    const { runner, order } = makeRunner({ p_a: 'Hi Bella!', p_b: 'Hey Anna!' });
    const result = await runRoomTurn({
      room: r,
      participants: [a, b],
      seaEvents: [],
      threadEvents,
      runAgentTurn: runner,
      appendEvent: makeAppender().appendEvent,
      maxCharacterExchanges: 1,
    });
    expect(order).toEqual(['start:p_a', 'end:p_a', 'start:p_b', 'end:p_b']);
    expect(result.speakerIds).toEqual(['p_a', 'p_b']);
  });

  it('excludes a removed participant from appended-event witnesses', async () => {
    const a = participant('p_a', 'Anna');
    const b = participant('p_b', 'Bella');
    const r = room('r1', ['p_a']);
    const threadEvents = [messageEvent('evt_1', 1, USER_ACTOR, 'Hello Anna', ['p_a', USER_ACTOR])];
    const { appended, appendEvent } = makeAppender();
    const result = await runRoomTurn({
      room: r,
      participants: [a, b],
      seaEvents: [],
      threadEvents,
      runAgentTurn: async () => ({ text: 'Hi!' }),
      appendEvent,
    });
    expect(result.events.length).toBeGreaterThan(0);
    expect(appended.length).toBe(result.events.length);
    for (const e of appended) {
      expect(e.witnesses).not.toContain('p_b');
      expect(e.witnesses).toContain('p_a');
      expect(e.witnesses).toContain(USER_ACTOR);
    }
  });

  it('remove then add: participantIds excludes then includes the id', () => {
    const r = room('r1', ['p_a', 'p_b']);
    const removed = applyMembershipChange(r, 'p_b', 'remove');
    expect(removed.room.participantIds).toEqual(['p_a']);
    expect(removed.event!.payload).toEqual({ participantId: 'p_b', action: 'removed' });
    expect(removed.event!.witnesses).toEqual(['p_a', 'p_b', USER_ACTOR]);

    const readded = applyMembershipChange(removed.room, 'p_b', 'add');
    expect(readded.room.participantIds).toEqual(['p_a', 'p_b']);
    expect(readded.event!.payload).toEqual({ participantId: 'p_b', action: 'added' });
    expect(readded.event!.witnesses).toEqual(['p_a', 'p_b', USER_ACTOR]);
  });

  it('stops at the exchange cap with exchange-limit even when every message addresses the next speaker', async () => {
    const a = participant('p_a', 'Anna');
    const b = participant('p_b', 'Bella');
    const r = room('r1', ['p_a', 'p_b']);
    const threadEvents = [messageEvent('evt_1', 1, USER_ACTOR, 'Hello', ['p_a', 'p_b', USER_ACTOR])];
    const { appended, appendEvent } = makeAppender();
    const result = await runRoomTurn({
      room: r,
      participants: [a, b],
      seaEvents: [],
      threadEvents,
      runAgentTurn: async (id) => ({ text: id === 'p_a' ? 'Bella, your turn!' : 'Anna, your turn!' }),
      appendEvent,
      maxCharacterExchanges: 3,
    });
    expect(result.stoppedReason).toBe('exchange-limit');
    expect(result.events.length).toBe(4);
    expect(result.speakerIds.length).toBe(4);
    expect(appended.length).toBe(4);
  });

  it('returns an empty result when nobody is eligible', async () => {
    const quiet = participant('p_q', 'Quiet', { speaking_propensity: 0.05 });
    const r = room('r1', ['p_q']);
    const threadEvents = [messageEvent('evt_1', 1, USER_ACTOR, 'Hello', ['p_q', USER_ACTOR])];
    const { appended, appendEvent } = makeAppender();
    const result = await runRoomTurn({
      room: r,
      participants: [quiet],
      seaEvents: [],
      threadEvents,
      runAgentTurn: async () => ({ text: '...' }),
      appendEvent,
    });
    expect(result).toEqual({ speakerIds: [], events: [], stoppedReason: 'no-eligible-speaker' });
    expect(appended.length).toBe(0);
  });

  it('interjects when the last character message addresses another participant by name', async () => {
    const a = participant('p_a', 'Anna');
    const b = participant('p_b', 'Bella');
    const r = room('r1', ['p_a', 'p_b']);
    const threadEvents = [messageEvent('evt_1', 1, USER_ACTOR, 'Hello', ['p_a', 'p_b', USER_ACTOR])];
    const { appendEvent } = makeAppender();
    const result = await runRoomTurn({
      room: r,
      participants: [a, b],
      seaEvents: [],
      threadEvents,
      runAgentTurn: async () => ({ text: 'Bella, what do you think?' }),
      appendEvent,
      maxCharacterExchanges: 1,
    });
    expect(result.speakerIds).toEqual(['p_a', 'p_b']);
    expect(result.events.length).toBe(2);
  });

  it('stops with no-eligible-speaker when the first response does not address anyone', async () => {
    const a = participant('p_a', 'Anna');
    const b = participant('p_b', 'Bella');
    const r = room('r1', ['p_a', 'p_b']);
    const threadEvents = [messageEvent('evt_1', 1, USER_ACTOR, 'Hello', ['p_a', 'p_b', USER_ACTOR])];
    const result = await runRoomTurn({
      room: r,
      participants: [a, b],
      seaEvents: [],
      threadEvents,
      runAgentTurn: async () => ({ text: 'Just chatting.' }),
      appendEvent: makeAppender().appendEvent,
    });
    expect(result.speakerIds).toEqual(['p_a']);
    expect(result.events.length).toBe(1);
    expect(result.stoppedReason).toBe('no-eligible-speaker');
  });
});