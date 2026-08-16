// @vitest-environment happy-dom

/**
 * Room window smoke test — the Phase 1 conversationAgent App.test.tsx is the
 * precedent (bridge boundary mocked, context layer stubbed, window code real).
 *
 * Golden path: window context opens a room → roster renders → user send →
 * journaled user event → runRoomTurn drives one participant's AgentInstance
 * (compiled-context seam supplies the system prompt) → streamed reply is
 * journaled as a message.character event and rendered.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import { DEFAULT_SETTINGS } from '../../../shared/types';
import type { LLMStreamChunk } from '../../../shared/types';
import type { JournalEventDraft, Participant, Room, Thread } from '../../../shared/world';

let windowContextCallback: (ctx: Record<string, unknown> | null) => void = () => {};
let streamCallback: (chunk: LLMStreamChunk) => void = () => {};
let seqCounter = 0;

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
const roomFixture: Room = { id: 'room-1', title: 'Cafe', participantIds: ['p1', 'p2'], createdAt: 1 };
const threadFixture: Thread = { id: 'thread-1', roomId: 'room-1', state: 'active', createdAt: 1 };

const mockBridge = {
  window: {
    onWindowContext: vi.fn((cb: (ctx: Record<string, unknown> | null) => void) => {
      windowContextCallback = cb;
      return () => {};
    }),
    getWindowContext: vi.fn(),
    onOpenRoomEvent: vi.fn(() => () => {}),
  },
  world: {
    getWorldState: vi.fn(async () => ({
      rooms: [roomFixture],
      threads: [threadFixture],
      participants: [p1, p2],
    })),
    applyMembership: vi.fn(),
    createThread: vi.fn(async (roomId: string) => ({
      id: 'thread-2',
      roomId,
      state: 'active' as const,
      createdAt: 2,
    })),
  },
  journal: {
    subscribeRoom: vi.fn(async () => ({ events: [], headSeq: 0 })),
    readThread: vi.fn(async () => []),
    appendEvent: vi.fn(async (_roomId: string, draft: JournalEventDraft) => ({
      id: `evt_${++seqCounter}`,
      seq: seqCounter,
      createdAt: seqCounter,
      ...draft,
    })),
  },
  llm: {
    onLLMStreamChunk: vi.fn((cb: (chunk: LLMStreamChunk) => void) => {
      streamCallback = cb;
      return () => {};
    }),
    llmStream: vi.fn(),
    llmStreamAbort: vi.fn(),
  },
};

vi.mock('../../../shared/bridges', () => ({ getBridge: () => mockBridge }));

const mockBackend = { tokenize: vi.fn(async () => []) };

vi.mock('../../../shared/backends', () => ({
  getBackend: () => mockBackend,
  resolveCloudApiUrl: () => 'http://localhost:7752',
}));

let testSettings: typeof DEFAULT_SETTINGS;

vi.mock('../../context', () => ({
  WindowWrapper: (props: { children?: JSX.Element }) => <div>{props.children}</div>,
  useSettings: () => ({
    settings: testSettings,
    updateSettings: vi.fn(),
    openCloudReLoginModal: vi.fn(),
  }),
  useLocalization: () => ({
    t: (key: string) => key,
  }),
  useLanguage: () => ({
    currentLangData: () => null,
    getLanguageFeatures: () => ({ supportsFrequencyLevels: false, tokenizerCapabilities: {} }),
  }),
  useFlashcards: () => ({
    getWordKnowledge: () => undefined,
    trackGrammarFailed: vi.fn(),
    trackGrammarEncountered: vi.fn(),
  }),
}));

function emitChunk(chunk: LLMStreamChunk): void {
  streamCallback(chunk);
}

describe('room window golden path', () => {
  let container: HTMLDivElement;
  let dispose: () => void;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    windowContextCallback = () => {};
    streamCallback = () => {};
    seqCounter = 0;
    testSettings = { ...DEFAULT_SETTINGS };
    vi.clearAllMocks();
  });

  afterEach(() => {
    dispose?.();
    container.remove();
  });

  it('opens a room from window context and runs a character turn', async () => {
    const { RoomApp } = await import('./App');
    dispose = render(() => <RoomApp />, container);

    await vi.waitFor(() => expect(mockBridge.window.getWindowContext).toHaveBeenCalledWith('room'));

    windowContextCallback({ roomId: 'room-1' });
    await vi.waitFor(() => expect(container.textContent).toContain('Cafe'));

    const textarea = container.querySelector('.room-input') as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();
    textarea!.value = 'hello';
    textarea!.dispatchEvent(new Event('input', { bubbles: true }));

    const sendButton = () => container.querySelector('.room-send') as HTMLButtonElement | null;
    await vi.waitFor(() => expect(sendButton()?.disabled).toBe(false));
    sendButton()!.click();

    await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalled());
    expect(container.textContent).toContain('hello');

    const [messages] = mockBridge.llm.llmStream.mock.calls[0];
    const sysMsg = (messages as Array<{ role: string; content: string }>).find(
      (m) => m.role === 'system',
    );
    expect(sysMsg?.content).toContain('Cheerful barista');

    emitChunk({ content: 'Hi there!' });
    expect(container.textContent).toContain('Hi there!');
    emitChunk({ done: true });

    await vi.waitFor(() => {
      const charDrafts = mockBridge.journal.appendEvent.mock.calls
        .map((c) => c[1] as JournalEventDraft)
        .filter((d) => d.type === 'message.character');
      expect(charDrafts).toHaveLength(1);
      expect(charDrafts[0].actorId).toBe('p1');
      expect(charDrafts[0].payload).toEqual({ text: 'Hi there!' });
    });
    await vi.waitFor(() => expect(container.textContent).toContain('Hi there!'));
  });
});
