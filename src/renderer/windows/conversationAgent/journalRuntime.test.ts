// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JournalEvent, JournalEventDraft, Participant } from '../../../shared/world';
import { buildLLMHistory, createJournalThreadStore, eventsToDisplayMessages } from './journalRuntime';

const unsubscribe = vi.fn();
const mockJournal = {
  appendEvent: vi.fn<(roomId: string, draft: JournalEventDraft) => Promise<JournalEvent>>(),
  readSeaProjection: vi.fn<(roomId: string) => Promise<JournalEvent[]>>(),
  readThread: vi.fn<(roomId: string, threadId: string) => Promise<JournalEvent[]>>(),
  subscribeRoom: vi.fn(),
};

vi.mock('../../../shared/bridges', () => ({ getBridge: () => ({ journal: mockJournal }) }));

const participants: Participant[] = [
  { id: 'a', displayName: 'Alice', kind: 'persistent', personaText: '', setupComplete: true },
  { id: 'b', displayName: 'Bob', kind: 'persistent', personaText: '', setupComplete: true },
];

function event(overrides: Partial<JournalEvent> & Pick<JournalEvent, 'id' | 'type'>): JournalEvent {
  return {
    id: overrides.id,
    seq: overrides.seq ?? 1,
    roomId: overrides.roomId ?? 'room-1',
    scope: overrides.scope ?? { kind: 'thread', threadId: 'thread-1' },
    type: overrides.type,
    actorId: overrides.actorId ?? 'user',
    witnesses: overrides.witnesses ?? [],
    payload: overrides.payload ?? { text: 'text' },
    createdAt: overrides.createdAt ?? 1,
  };
}

describe('journalRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockJournal.subscribeRoom.mockResolvedValue({ events: [], headSeq: 0, unsubscribe });
  });

  it('loads, appends, reselects, and tears down journal streams', async () => {
    const seaOne = event({ id: 'sea-1', type: 'membership', scope: { kind: 'sea' } });
    const threadOne = event({ id: 'thread-1', type: 'message.user' });
    const seaTwo = event({ id: 'sea-2', type: 'membership', roomId: 'room-2', scope: { kind: 'sea' } });
    const threadTwo = event({ id: 'thread-2', type: 'message.user', roomId: 'room-2', scope: { kind: 'thread', threadId: 'thread-2' } });
    const appended = event({ id: 'appended', type: 'message.user' });
    mockJournal.readSeaProjection.mockImplementation(async (roomId) => roomId === 'room-1' ? [seaOne] : [seaTwo]);
    mockJournal.readThread.mockImplementation(async (roomId) => roomId === 'room-1' ? [threadOne] : [threadTwo]);
    mockJournal.appendEvent.mockResolvedValue(appended);
    const store = createJournalThreadStore();

    await store.select({ roomId: 'room-1', threadId: 'thread-1' });
    expect(store.seaEvents()).toEqual([seaOne]);
    expect(store.threadEvents()).toEqual([threadOne]);

    await store.append({ roomId: 'room-1', scope: { kind: 'thread', threadId: 'thread-1' }, type: 'message.user', actorId: 'user', witnesses: [], payload: { text: 'new' } });
    expect(mockJournal.appendEvent).toHaveBeenCalledOnce();
    expect(store.threadEvents()).toEqual([threadOne, appended]);

    await store.select({ roomId: 'room-2', threadId: 'thread-2' });
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(store.seaEvents()).toEqual([seaTwo]);
    expect(store.threadEvents()).toEqual([threadTwo]);
    store.teardown();
    expect(unsubscribe).toHaveBeenCalledTimes(2);
  });

  it('folds message sidecars into display messages and skips malformed events', () => {
    const widget = { type: 'quiz' as const, data: { question: 'Q' } };
    const extraWidget = { type: 'stats' as const, data: {} };
    const messages = eventsToDisplayMessages([
      event({ id: 'ev1', type: 'message.user', payload: { text: 'Hello' } }),
      event({ id: 'ev2', type: 'message.character', actorId: 'a', payload: { text: 'Hi', widgets: [widget], widget: extraWidget } }),
      event({ id: 'ev3', type: 'correction', payload: { messageEventId: 'ev1', corrections: [
        { userMessageIndex: 0, errorSpan: 'Hello', correction: 'Hallo', errorType: 'word' as const },
        { userMessageIndex: 0, errorSpan: 'Hello', correction: 'Hi', errorType: 'unnatural' as const },
      ] } }),
      event({ id: 'ev4', type: 'safety_flag', payload: { messageEventId: 'ev2', flag: { category: 'self-harm', severity: 'concern' as const } } }),
      event({ id: 'membership', type: 'membership', payload: { participantId: 'a', action: 'added' } }),
      event({ id: 'bad', type: 'message.user', payload: {} }),
    ], participants, 'You');

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: 'user', content: 'Hello', corrections: { length: 2 } });
    expect(messages[1]).toMatchObject({ role: 'assistant', content: 'Hi', widgets: [widget], widget: extraWidget, safety: { category: 'self-harm' } });
  });

  it('rebuilds participant-specific LLM history from journal messages', () => {
    const history = buildLLMHistory([
      event({ id: 'user', type: 'message.user', actorId: 'user', payload: { text: 'Question' } }),
      event({ id: 'alice', type: 'message.character', actorId: 'a', payload: { text: 'Answer' } }),
      event({ id: 'bob', type: 'message.character', actorId: 'b', payload: { text: 'Aside' } }),
    ], 'a', participants);

    expect(history).toEqual([
      { role: 'user', content: 'Question' },
      { role: 'assistant', content: 'Answer' },
      { role: 'user', content: 'Bob: Aside' },
    ]);
    expect(buildLLMHistory([event({ id: 'unknown', type: 'message.character', actorId: 'missing', payload: { text: 'Mine' } })], 'missing', participants)).toEqual([
      { role: 'assistant', content: 'Mine' },
    ]);
  });
});
