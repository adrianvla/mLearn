import { describe, expect, it } from 'vitest';
import { USER_ACTOR, type JournalEvent, type Participant } from '../../../shared/world';
import type { CompiledContext } from '../../../shared/contextCompiler';
import { messageText, projectMessages, renderCompiledContext } from './roomMessages';

const p1: Participant = {
  id: 'p1',
  displayName: 'Alice',
  kind: 'persistent',
  personaText: 'Cheerful barista',
  setupComplete: true,
};
const p2: Participant = {
  id: 'p2',
  displayName: 'Bob',
  kind: 'persistent',
  personaText: 'Quiet poet',
  setupComplete: true,
};

function evt(overrides: Partial<JournalEvent>): JournalEvent {
  return {
    id: 'evt_1',
    seq: 1,
    roomId: 'r1',
    scope: { kind: 'thread', threadId: 't1' },
    type: 'message.character',
    actorId: 'p1',
    witnesses: ['p1', 'p2'],
    payload: { text: 'hi' },
    createdAt: 1,
    ...overrides,
  };
}

describe('projectMessages', () => {
  it('projects message events with resolved display names', () => {
    const events = [
      evt({ id: 'e1', seq: 1, type: 'message.user', actorId: USER_ACTOR, payload: { text: 'hello' } }),
      evt({ id: 'e2', seq: 2, actorId: 'p1', payload: { text: 'hi' } }),
    ];
    const result = projectMessages(events, [p1, p2], 'You');
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ isUser: true, displayName: 'You', text: 'hello' });
    expect(result[1]).toMatchObject({ isUser: false, displayName: 'Alice', text: 'hi' });
  });

  it('skips non-message events and payloads without text', () => {
    const events = [
      evt({ id: 'e1', seq: 1, type: 'membership', payload: { participantId: 'p1', action: 'added' } }),
      evt({ id: 'e2', seq: 2, type: 'message.character', actorId: 'p1', payload: { widget: {} } }),
    ];
    expect(projectMessages(events, [p1, p2], 'You')).toHaveLength(0);
  });

  it('falls back to actorId when the participant is unknown', () => {
    const events = [evt({ id: 'e1', seq: 1, actorId: 'ghost', payload: { text: 'boo' } })];
    const result = projectMessages(events, [p1, p2], 'You');
    expect(result[0].displayName).toBe('ghost');
  });
});

describe('renderCompiledContext', () => {
  it('renders persona, memories, and recent thread with display names', () => {
    const ctx: CompiledContext = {
      persona: { text: 'Cheerful barista', facets: {} },
      negativeKnowledge: [],
      relationships: [],
      memories: [{ kind: 'belief', text: 'Likes coffee', createdAt: 1 }],
      openLoops: [],
      recentThreadEvents: [
        { seq: 1, type: 'message.user', actorId: USER_ACTOR, text: 'hello', createdAt: 1 },
        { seq: 2, type: 'message.character', actorId: 'p1', text: 'hi', createdAt: 2 },
      ],
    };
    const out = renderCompiledContext(ctx, [p1, p2], 'You');
    expect(out).toContain('Cheerful barista');
    expect(out).toContain('Likes coffee');
    expect(out).toContain('You: hello');
    expect(out).toContain('Alice: hi');
  });

  it('omits empty sections', () => {
    const ctx: CompiledContext = {
      persona: { text: 'x', facets: {} },
      negativeKnowledge: [],
      relationships: [],
      memories: [],
      openLoops: [],
      recentThreadEvents: [],
    };
    expect(renderCompiledContext(ctx, [p1], 'You')).toBe('## Persona\nx');
  });
  it('renders the grammar exposure line with unmeasured phrasing when present', () => {
    const ctx: CompiledContext = {
      persona: { text: 'x', facets: {} },
      negativeKnowledge: [],
      relationships: [],
      memories: [],
      openLoops: [],
      recentThreadEvents: [],
      learnerProjection: { failedWords: ['難しい'], grammarPoints: ['てform'], grammarExposure: ['ている', '〜てしまう'] },
    };
    const out = renderCompiledContext(ctx, [p1], 'You');
    expect(out).toContain('Grammar seen repeatedly (unmeasured, exposure-ranked — practice candidates, not failures): ている, 〜てしまう');
    // Exposure patterns must not leak into the demonstrated-failure phrasings.
    expect(out).toContain('Grammar points selected for practice: てform');
  });

  it('omits the grammar exposure line when absent', () => {
    const ctx: CompiledContext = {
      persona: { text: 'x', facets: {} },
      negativeKnowledge: [],
      relationships: [],
      memories: [],
      openLoops: [],
      recentThreadEvents: [],
      learnerProjection: { grammarPoints: ['てform'] },
    };
    const out = renderCompiledContext(ctx, [p1], 'You');
    expect(out).not.toContain('Grammar seen repeatedly');
    expect(out).toContain('Grammar points selected for practice: てform');
  });
});

describe('messageText', () => {
  it('extracts string text payloads only', () => {
    expect(messageText({ text: 'a' })).toBe('a');
    expect(messageText({ text: 5 })).toBeUndefined();
    expect(messageText(null)).toBeUndefined();
  });
});
