import { describe, expect, it } from 'vitest';
import { compileContext } from './contextCompiler';
import { projectHistoryForParticipant } from './roomOrchestrator';
import type { JournalEvent, Participant } from './world';

const person: Participant = { id: 'p', displayName: 'Person', kind: 'persistent', personaText: 'Same person', setupComplete: true };
const message: JournalEvent = { id: 'msg', roomId: 'r', seq: 1, createdAt: 200, scope: { kind: 'thread', threadId: 't' }, type: 'message.user', actorId: 'user', witnesses: ['user', 'p'], payload: { text: 'Hello' } };

describe('conversation isolation at runtime boundaries', () => {
  it('does not compare independent Sea and Thread sequence numbers', () => {
    const joined: JournalEvent = { ...message, id: 'join', seq: 80, createdAt: 100, scope: { kind: 'sea' }, type: 'membership', payload: { participantId: 'p', action: 'added' } };
    const context = compileContext({ participant: person, participants: [person], seaEvents: [joined], threadEvents: [message] });
    expect(context.recentThreadEvents.map(event => event.text)).toEqual(['Hello']);
  });

  it('keeps persistent memories across rooms without applying another room membership sequence', () => {
    const memory: JournalEvent = { ...message, id: 'memory', roomId: 'old-room', seq: 1, scope: { kind: 'sea' }, type: 'memory.belief', payload: { ownerId: 'p', kind: 'belief', text: 'Promised a visit' } };
    const joined: JournalEvent = { ...message, id: 'join', seq: 80, scope: { kind: 'sea' }, type: 'membership', payload: { participantId: 'p', action: 'added' } };
    const context = compileContext({ participant: person, participants: [person], seaEvents: [memory, joined], threadEvents: [message] });
    expect(context.memories.map(memory => memory.text)).toEqual(['Promised a visit']);
  });

  it('uses a temporary memory note locally without promoting it to the Sea projection', () => {
    const note: JournalEvent = { ...message, type: 'memory.belief', payload: { ownerId: 'p', kind: 'belief', text: 'Practice note' } };
    const context = compileContext({ participant: person, participants: [person], seaEvents: [], threadEvents: [note] });
    expect(context.memories.map(memory => memory.text)).toEqual(['Practice note']);
    expect(context.callerProjection.beliefs).toEqual([]);
    expect(compileContext({ participant: person, participants: [person], seaEvents: [], threadEvents: [] }).memories).toEqual([]);
  });

  it('never puts unwitnessed messages in the actual LLM history', () => {
    expect(projectHistoryForParticipant([{ ...message, witnesses: ['user', 'other'] }], person.id, [person])).toEqual([]);
  });
});
