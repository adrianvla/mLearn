import { describe, expect, it } from 'vitest';
import { deriveRoomProjection, projectionForCaller } from './memoryProjection';
import type { EventScope, JournalEvent } from './world';

const SEA: EventScope = { kind: 'sea' };

type Draft = Omit<JournalEvent, 'id' | 'seq' | 'createdAt'>;

function evt(draft: Draft, seq: number): JournalEvent {
  return { ...draft, id: `evt_${seq}`, seq, createdAt: 1000 + seq };
}

function memory(
  seq: number,
  ownerId: string,
  kind: string,
  text: string,
  witnesses: string[],
  extra: Record<string, unknown> = {},
): JournalEvent {
  return evt(
    { roomId: 'room_1', scope: SEA, type: 'memory.belief', actorId: ownerId, witnesses, payload: { ownerId, kind, text, ...extra } },
    seq,
  );
}

function correction(seq: number, targetId: string, ownerId: string): JournalEvent {
  return evt(
    { roomId: 'room_1', scope: SEA, type: 'memory.belief', actorId: ownerId, witnesses: ['harness'], payload: { targetId, ownerId } },
    seq,
  );
}

describe('memory projection', () => {
  it('derives beliefs, open loops, episodes, relationships and room culture from a sea stream', () => {
    const sea = [
      memory(1, 'A', 'belief', 'A durable belief.', ['A', 'user']),
      memory(2, 'A', 'open-loop', 'Ask about the plan.', ['A', 'user']),
      memory(3, 'A', 'episode', 'An episode.', ['A', 'user']),
      memory(4, 'A', 'relationship', 'Trusts the user.', ['A', 'user'], { toId: 'user' }),
      memory(5, 'harness', 'fact', 'Room culture entry.', []),
    ];

    const proj = deriveRoomProjection(sea);

    expect(proj.beliefs).toHaveLength(1);
    expect(proj.beliefs[0]).toEqual({
      id: 'evt_1',
      ownerId: 'A',
      kind: 'belief',
      text: 'A durable belief.',
      witnesses: ['A', 'user'],
      durability: 'durable',
      salience: 0,
      createdAt: 1001,
      sourceEventIds: ['evt_1'],
    });
    expect(proj.openLoops.map((m) => m.text)).toEqual(['Ask about the plan.']);
    expect(proj.episodes.map((m) => m.text)).toEqual(['An episode.']);
    expect(proj.relationships).toEqual([
      { fromId: 'A', toId: 'user', text: 'Trusts the user.', sourceEventId: 'evt_4', createdAt: 1004 },
    ]);
    expect(proj.roomCulture.map((m) => m.text)).toEqual(['Room culture entry.']);
  });

  it('tombstones a corrected memory without deleting journal history', () => {
    const sea = [
      memory(1, 'A', 'belief', 'A durable belief.', ['A', 'user']),
      correction(2, 'evt_1', 'A'),
    ];

    const proj = deriveRoomProjection(sea);

    expect(proj.beliefs).toEqual([]);
    expect(sea).toHaveLength(2); // journal history intact
  });

  it('does not tombstone when the correction owner differs from the memory owner', () => {
    const sea = [
      memory(1, 'A', 'belief', 'A durable belief.', ['A', 'user']),
      correction(2, 'evt_1', 'B'),
    ];

    const proj = deriveRoomProjection(sea);

    expect(proj.beliefs.map((m) => m.text)).toEqual(['A durable belief.']);
  });

  it('redacts an other-owner belief the caller did not witness', () => {
    const sea = [
      memory(1, 'A', 'belief', 'A secret.', ['A', 'user']),
      memory(2, 'B', 'belief', 'B secret.', ['B', 'user']),
    ];

    const proj = projectionForCaller(sea, 'A');

    expect(proj.beliefs.map((m) => m.text)).toEqual(['A secret.']);
  });

  it('applies the joinedSeq cutoff', () => {
    const sea = [
      memory(1, 'A', 'belief', 'Before joining.', ['A', 'user']),
      memory(2, 'A', 'belief', 'After joining.', ['A', 'user']),
    ];

    const proj = projectionForCaller(sea, 'A', 2);

    expect(proj.beliefs.map((m) => m.text)).toEqual(['After joining.']);
  });

  it('excludes deletion and integration marker events from projections', () => {
    const sea = [
      memory(1, 'A', 'belief', 'A belief.', ['A', 'user']),
      evt({ roomId: 'room_1', scope: SEA, type: 'deletion', actorId: 'harness', witnesses: ['harness'], payload: { sourceEventIds: ['evt_1'] } }, 2),
      evt(
        { roomId: 'room_1', scope: SEA, type: 'integration', actorId: 'harness', witnesses: ['harness'], payload: { integrationId: 'int_1', sourceThreadId: 'thread_1', sourceEventIds: [], promotedParticipantIds: [] } },
        3,
      ),
    ];

    const proj = deriveRoomProjection(sea);

    expect(proj.beliefs.map((m) => m.text)).toEqual(['A belief.']);
    expect(proj.openLoops).toEqual([]);
    expect(proj.episodes).toEqual([]);
    expect(proj.relationships).toEqual([]);
    expect(proj.roomCulture).toEqual([]);
  });
});