import { describe, expect, it } from 'vitest';
import { compileContext, visibleEventsFor } from './contextCompiler';
import type { EventScope, JournalEvent, Participant, ScenarioGrounding } from './world';

const SEA: EventScope = { kind: 'sea' };
const THREAD: EventScope = { kind: 'thread', threadId: 'thread_1' };

type Draft = Omit<JournalEvent, 'id' | 'seq' | 'createdAt'>;

function evt(draft: Draft, seq: number): JournalEvent {
  return { ...draft, id: `evt_${seq}`, seq, createdAt: 1000 + seq };
}

function participant(overrides: Partial<Participant> = {}): Participant {
  return {
    id: 'p1',
    displayName: 'Aria',
    kind: 'persistent',
    personaText: 'A warm mentor persona.',
    setupComplete: true,
    ...overrides,
  };
}

function message(
  seq: number,
  type: 'message.user' | 'message.character',
  text: string,
  witnesses: string[],
  actorId: string,
): JournalEvent {
  return evt({ roomId: 'room_1', scope: THREAD, type, actorId, witnesses, payload: { text } }, seq);
}

function belief(
  seq: number,
  ownerId: string,
  kind: string,
  text: string,
  witnesses: string[],
  extra: Record<string, unknown> = {},
): JournalEvent {
  return evt(
    {
      roomId: 'room_1',
      scope: SEA,
      type: 'memory.belief',
      actorId: ownerId,
      witnesses,
      payload: { ownerId, kind, text, ...extra },
    },
    seq,
  );
}

function membership(
  seq: number,
  participantId: string,
  action: 'added' | 'removed',
  witnesses: string[] = ['harness'],
): JournalEvent {
  return evt(
    { roomId: 'room_1', scope: SEA, type: 'membership', actorId: 'harness', witnesses, payload: { participantId, action } },
    seq,
  );
}

describe('context compiler', () => {
  it('filters by witnesses per participant in both streams', () => {
    const sea = [
      belief(1, 'A', 'belief', 'A secret only A heard.', ['A', 'user']),
      belief(2, 'B', 'belief', 'B secret only B heard.', ['B', 'user']),
    ];
    const thread = [
      message(3, 'message.character', 'A speaks.', ['A', 'user'], 'A'),
      message(4, 'message.character', 'B speaks.', ['B', 'user'], 'B'),
    ];
    const a = participant({ id: 'A', displayName: 'Aria' });
    const b = participant({ id: 'B', displayName: 'Brody' });

    const ctxB = compileContext({ participant: b, participants: [a, b], seaEvents: sea, threadEvents: thread });
    expect(ctxB.memories.map((m) => m.text)).toEqual(['B secret only B heard.']);
    expect(ctxB.recentThreadEvents.map((e) => e.seq)).toEqual([4]);
    expect(ctxB.openLoops).toEqual([]);
    expect(ctxB.relationships).toEqual([]);

    const ctxA = compileContext({ participant: a, participants: [a, b], seaEvents: sea, threadEvents: thread });
    expect(ctxA.memories.map((m) => m.text)).toEqual(['A secret only A heard.']);
    expect(ctxA.recentThreadEvents.map((e) => e.seq)).toEqual([3]);
  });

  it('excludes post-removal events even when witnessed, until re-added', () => {
    const sea = [
      membership(5, 'A', 'removed', ['A', 'user']),
      belief(6, 'A', 'belief', 'Heard while gone.', ['A', 'user']),
      membership(9, 'A', 'added', ['A', 'user']),
      belief(10, 'A', 'belief', 'Heard after return.', ['A', 'user']),
    ];
    const thread = [
      message(4, 'message.character', 'Before removal.', ['A', 'user'], 'A'),
      message(6, 'message.character', 'During absence 1.', ['A', 'user'], 'A'),
      message(7, 'message.character', 'During absence 2.', ['A', 'user'], 'A'),
      message(8, 'message.character', 'During absence 3.', ['A', 'user'], 'A'),
      message(10, 'message.character', 'After return.', ['A', 'user'], 'A'),
    ];
    const a = participant({ id: 'A' });

    const ctx = compileContext({ participant: a, participants: [a], seaEvents: sea, threadEvents: thread });
    expect(ctx.recentThreadEvents.map((e) => e.seq)).toEqual([4, 10]);
    expect(ctx.memories.map((m) => m.text)).toEqual(['Heard after return.']);

    // The removal and re-add events themselves stay visible when witnessed.
    const visibleSea = visibleEventsFor('A', sea);
    expect(visibleSea.map((e) => e.seq)).toEqual([5, 9, 10]);
  });

  it('excludes events before the first membership event when it is an add', () => {
    const sea = [
      belief(1, 'A', 'belief', 'Before joining.', ['A', 'user']),
      belief(2, 'A', 'belief', 'Still before joining.', ['A', 'user']),
      membership(3, 'A', 'added'),
      belief(4, 'A', 'belief', 'After joining.', ['A', 'user']),
    ];
    const a = participant({ id: 'A' });

    const ctx = compileContext({ participant: a, participants: [a], seaEvents: sea });
    expect(ctx.memories.map((m) => m.text)).toEqual(['After joining.']);
  });

  it('merges canon notYetHappened with grounding doesNotKnow by id and displayName', () => {
    const canonParticipant = (id: string, displayName: string): Participant =>
      participant({
        id,
        displayName,
        canon: {
          workTitle: 'Example Saga',
          fandomBaseUrl: 'https://example.test',
          characterPageTitle: 'Hero',
          coordinate: { kind: 'chapter', value: 'ch40' },
          baseline: {
            lore: 'Lore.',
            quotes: ['Quote.'],
            context: 'Context.',
            notYetHappened: ['the war ends'],
            provenance: [],
            generatedFill: [],
          },
        },
      });

    const byId = canonParticipant('p1', 'Aria');
    const byName = canonParticipant('p2', 'Bria');
    const grounding: ScenarioGrounding = {
      presentCharacters: ['Aria', 'Bria'],
      setting: 'Castle',
      priorEvents: [],
      conflicts: [],
      perParticipant: {
        p1: { knows: [], doesNotKnow: ['the alliance secret'], relationships: [], motivations: [], speechTraits: [] },
        Bria: { knows: [], doesNotKnow: ['the hidden passage'], relationships: [], motivations: [], speechTraits: [] },
      },
      provenance: [],
      fillSegments: [],
    };

    const ctxId = compileContext({ participant: byId, participants: [byId, byName], seaEvents: [], grounding });
    expect(ctxId.negativeKnowledge).toContain('the war ends');
    expect(ctxId.negativeKnowledge).toContain('the alliance secret');

    const ctxName = compileContext({ participant: byName, participants: [byId, byName], seaEvents: [], grounding });
    expect(ctxName.negativeKnowledge).toContain('the war ends');
    expect(ctxName.negativeKnowledge).toContain('the hidden passage');
  });

  it('splits memory.belief payloads by kind into their sections', () => {
    const sea = [
      belief(1, 'A', 'belief', 'A durable belief.', ['A', 'user']),
      belief(2, 'A', 'episode', 'An episode.', ['A', 'user']),
      belief(3, 'A', 'open-loop', 'Ask about the plan.', ['A', 'user']),
      belief(4, 'A', 'relationship', 'Trusts the user.', ['A', 'user'], { toId: 'user' }),
      belief(5, 'A', 'relationship', 'Still trusts the user.', ['A', 'user']),
      belief(6, 'A', 'fact', 'A fact.', ['A', 'user']),
    ];
    const a = participant({ id: 'A' });

    const ctx = compileContext({ participant: a, participants: [a], seaEvents: sea });
    expect(ctx.memories.map((m) => ({ kind: m.kind, text: m.text }))).toEqual([
      { kind: 'belief', text: 'A durable belief.' },
      { kind: 'episode', text: 'An episode.' },
      { kind: 'fact', text: 'A fact.' },
    ]);
    expect(ctx.openLoops).toEqual([{ text: 'Ask about the plan.', createdAt: 1003 }]);
    expect(ctx.relationships).toEqual([
      { toId: 'user', label: 'Trusts the user.' },
      { toId: '', label: 'Still trusts the user.' },
    ]);
  });

  it('skips malformed belief payloads without throwing', () => {
    const sea: JournalEvent[] = [
      belief(1, 'A', 'belief', 'Valid.', ['A', 'user']),
      evt({ roomId: 'room_1', scope: SEA, type: 'memory.belief', actorId: 'A', witnesses: ['A', 'user'], payload: null }, 2),
      evt({ roomId: 'room_1', scope: SEA, type: 'memory.belief', actorId: 'A', witnesses: ['A', 'user'], payload: 'oops' }, 3),
      evt({ roomId: 'room_1', scope: SEA, type: 'memory.belief', actorId: 'A', witnesses: ['A', 'user'], payload: {} }, 4),
      evt(
        { roomId: 'room_1', scope: SEA, type: 'memory.belief', actorId: 'A', witnesses: ['A', 'user'], payload: { ownerId: 'B', kind: 'belief', text: 'Not yours.' } },
        5,
      ),
      evt({ roomId: 'room_1', scope: SEA, type: 'memory.belief', actorId: 'A', witnesses: ['A', 'user'], payload: { ownerId: 'A', kind: 'belief' } }, 6),
    ];
    const a = participant({ id: 'A' });

    expect(() => compileContext({ participant: a, participants: [a], seaEvents: sea })).not.toThrow();
    const ctx = compileContext({ participant: a, participants: [a], seaEvents: sea });
    expect(ctx.memories.map((m) => m.text)).toEqual(['Valid.']);
  });

  it('omits canonBaseline and learnerProjection and yields empty sections with minimal input', () => {
    const a = participant({ id: 'A' });

    const ctx = compileContext({ participant: a, participants: [a], seaEvents: [] });
    expect(ctx.canonBaseline).toBeUndefined();
    expect(ctx.learnerProjection).toBeUndefined();
    expect(ctx.negativeKnowledge).toEqual([]);
    expect(ctx.relationships).toEqual([]);
    expect(ctx.memories).toEqual([]);
    expect(ctx.openLoops).toEqual([]);
    expect(ctx.recentThreadEvents).toEqual([]);
    expect(ctx.persona).toEqual({ text: 'A warm mentor persona.', facets: {} });
  });

  it('copies persona text and facets', () => {
    const a = participant({ id: 'A', facets: { warmth: 7, style: 'gentle' } });

    const ctx = compileContext({ participant: a, participants: [a], seaEvents: [] });
    expect(ctx.persona.text).toBe('A warm mentor persona.');
    expect(ctx.persona.facets).toEqual({ warmth: 7, style: 'gentle' });
  });

  it('passes learnerProjection through', () => {
    const a = participant({ id: 'A' });
    const proj = { language: 'ja', failedWords: ['行く'], levelEstimate: 'A2' };

    const ctx = compileContext({ participant: a, participants: [a], seaEvents: [], learnerProjection: proj });
    expect(ctx.learnerProjection).toEqual(proj);
  });

  it('exposes the caller projection with witnessed relationship state', () => {
    const sea = [belief(1, 'A', 'relationship', 'Trusts the user.', ['A', 'user'], { toId: 'user' })];
    const a = participant({ id: 'A' });

    const ctx = compileContext({ participant: a, participants: [a], seaEvents: sea });

    expect(ctx.callerProjection.relationships).toEqual([
      { fromId: 'A', toId: 'user', text: 'Trusts the user.', sourceEventId: 'evt_1', createdAt: 1001 },
    ]);
  });

  it('exposes the caller witnessed beliefs as private knowledge', () => {
    const sea = [belief(1, 'A', 'belief', 'A private belief.', ['A', 'user'])];
    const a = participant({ id: 'A' });

    const ctx = compileContext({ participant: a, participants: [a], seaEvents: sea });

    expect(ctx.callerProjection.beliefs.map((m) => m.text)).toEqual(['A private belief.']);
  });

  it('keeps unwitnessed relationship and belief events out of the caller projection', () => {
    const sea = [
      belief(1, 'A', 'belief', 'A secret.', ['A', 'user']),
      belief(2, 'B', 'belief', 'B secret.', ['B', 'user']),
      belief(3, 'B', 'relationship', 'B trusts C.', ['B', 'C'], { toId: 'C' }),
    ];
    const a = participant({ id: 'A' });
    const b = participant({ id: 'B', displayName: 'Brody' });

    const ctxA = compileContext({ participant: a, participants: [a, b], seaEvents: sea });

    expect(ctxA.callerProjection.beliefs.map((m) => m.text)).toEqual(['A secret.']);
    expect(ctxA.callerProjection.relationships).toEqual([]);
  });

  it('applies membership absence to the caller projection', () => {
    const sea = [
      membership(5, 'A', 'removed', ['A', 'user']),
      belief(6, 'A', 'belief', 'Heard while gone.', ['A', 'user']),
      membership(9, 'A', 'added', ['A', 'user']),
      belief(10, 'A', 'belief', 'Heard after return.', ['A', 'user']),
    ];
    const a = participant({ id: 'A' });

    const ctx = compileContext({ participant: a, participants: [a], seaEvents: sea });

    expect(ctx.callerProjection.beliefs.map((m) => m.text)).toEqual(['Heard after return.']);
  });
});
