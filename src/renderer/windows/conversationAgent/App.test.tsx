// @vitest-environment happy-dom

/** Mounted Conversation runtime tests. The IPC/backend and provider boundaries
 * are controlled; turn orchestration, prompt construction, journal projection,
 * message rendering and the shared token component are real. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { Show } from 'solid-js';
import type { JSX } from 'solid-js';
import { DEFAULT_SETTINGS } from '../../../shared/types';
import type { LLMStreamChunk } from '../../../shared/types';
import type { JournalEvent, JournalEventDraft, WorldSnapshot } from '../../../shared/world';

// ============================================================================
// Bridge mock (the bridge boundary — everything else under test is real)
// ============================================================================

let streamCallback: (chunk: LLMStreamChunk) => void = () => {};
let windowContextCallback: (context: unknown) => void = () => {};
let journalEvents: JournalEvent[] = [];
const worldFixture = {
  rooms: [{ id: 'room-a', title: 'Tutor', participantIds: ['agent-a'], createdAt: 1 }],
  threads: [{ id: 'thread-a', roomId: 'room-a', state: 'active' as const, createdAt: 1 }],
  participants: [{ id: 'agent-a', displayName: 'Tutor', kind: 'persistent' as const, personaText: 'Helpful tutor', setupComplete: true }],
};
let currentWorld: WorldSnapshot = worldFixture;

function appendJournalEvent(draft: JournalEventDraft): JournalEvent {
  const event: JournalEvent = { ...draft, id: `evt-${journalEvents.length + 1}`, seq: journalEvents.length + 1, createdAt: Date.now() };
  journalEvents = [...journalEvents, event];
  return event;
}

const mockBridge = {
  llm: {
    onLLMStreamChunk: vi.fn((cb: (chunk: LLMStreamChunk) => void) => {
      streamCallback = cb;
      return () => {};
    }),
    llmStream: vi.fn(),
    llmStreamAbort: vi.fn(),
    llmCheckModel: vi.fn(async () => ({ downloaded: true })),
    onLLMModelStatus: vi.fn(() => () => {}),
    ollamaCheck: vi.fn(async () => false),
  },
  window: {
    onWindowContext: vi.fn((callback: (context: unknown) => void) => { windowContextCallback = callback; return () => {}; }),
    onOpenRoomEvent: vi.fn(() => () => {}),
    getWindowContext: vi.fn(),
    openWindow: vi.fn(),
  },
  world: {
    getWorldState: vi.fn(async () => currentWorld),
    createPersistentRoom: vi.fn(async (input: { operationId: string; participantIds: string[] }) => ({ id: 'room-new', title: 'New room', participantIds: input.participantIds, createdByOperation: input.operationId, createdAt: Date.now() })),
    updateThread: vi.fn(async (thread: WorldSnapshot['threads'][number]) => thread),
    clearRoomUnread: vi.fn(async () => {}),
  },
  journal: {
    appendEvent: vi.fn(async (_roomId: string, draft: JournalEventDraft) => appendJournalEvent(draft)),
    readSeaProjection: vi.fn(async (roomId: string) => journalEvents.filter(event => event.roomId === roomId && event.scope.kind === 'sea')),
    subscribeRoom: vi.fn(async () => ({ unsubscribe: () => {} })),
    readThread: vi.fn(async (_roomId: string, threadId: string) => journalEvents.filter((event) => event.scope.kind === 'thread' && event.scope.threadId === threadId)),
  },
  speech: {
    ttsSpeak: vi.fn(),
    onSttResult: vi.fn(() => () => {}),
    onTtsStatus: vi.fn(() => () => {}),
    sttStart: vi.fn(),
    sttStop: vi.fn(),
  },
  generic: {
    fetchUrl: vi.fn(async () => ({ content: '' })),
  },
  kvStore: {
    kvGet: vi.fn<() => Promise<string | null>>(async () => null),
    kvSet: vi.fn(async () => {}),
    kvRemove: vi.fn(async () => {}),
    kvGetAll: vi.fn(async () => ({})),
    kvSetBatch: vi.fn(async () => {}),
  },
};

vi.mock('../../../shared/bridges', () => ({ getBridge: () => mockBridge }));

const mockBackend = {
  tokenize: vi.fn(async (text: string) => [{ actual_word: text, word: text, type: 'NOUN' }]),
};

vi.mock('../../../shared/backends', () => ({
  getBackend: () => mockBackend,
  resolveCloudApiUrl: () => 'http://localhost:7752',
}));

// ============================================================================
// Provider / hook stubs (repo window-test convention — infrastructure only)
// ============================================================================

let testSettings: typeof DEFAULT_SETTINGS;

// Words the canonical knowledge resolver reports settled (evidence-known or
// excluded); mutated per test to drive learner-projection reconciliation.
let settledWords = new Set<string>();
vi.mock('../../context', () => ({
  WindowWrapper: (props: { children?: JSX.Element }) => <div>{props.children}</div>,
  useSettings: () => ({
    settings: testSettings,
    updateSettings: vi.fn(),
    openCloudReLoginModal: vi.fn(),
  }),
  useLocalization: () => ({
    t: (key: string) => key,
    locale: () => 'en',
  }),
  useLanguage: () => ({
    currentLangData: () => null,
    isTokenTranslatable: () => false,
    getLanguageFeatures: () => ({ supportsFrequencyLevels: false, tokenizerCapabilities: {} }),
    getFrequency: () => null,
    getFreqLevelNames: () => ({}),
    getGrammarLevelNames: () => ({}),
    getLevelName: () => undefined,
    getCanonicalForm: (word: string) => word,
    getWordVariants: (word: string) => [word],
    getReadingVariants: (word: string) => [word],
  }),
  useLowPowerGate: () => ({
    isActive: () => false,
    requestAccess: async () => true,
  }),
  useServer: () => ({
    statusMessage: () => '',
  }),
  useFlashcards: () => ({
    getAccessStatus: () => ({ status: 'unknown' }),
    isKnowledgeReady: () => true,
    getWordKnowledge: () => undefined,
    isWordSettledSync: (word: string) => settledWords.has(word),
    trackGrammarFailed: vi.fn(),
    trackGrammarEncountered: vi.fn(),
  }),
}));

vi.mock('../../hooks', () => ({
  useWordHover: () => ({
    hoverData: () => null,
    isVisible: () => false,
    showHover: vi.fn(),
    hideHover: vi.fn(),
    cancelHide: vi.fn(),
  }),
  useTranslation: () => ({
    translateWord: async () => null,
  }),
  useTokenizer: () => ({
    tokenize: mockBackend.tokenize,
  }),
  useDictionary: () => ({
    lookup: async () => [],
  }),
}));

// ============================================================================
// UI primitive mocks — plain DOM so behavior is asserted, not markup
// ============================================================================

vi.mock('../../components/common', () => ({
  Btn: (props: { children?: JSX.Element; onClick?: () => void; disabled?: boolean; variant?: string; size?: string; class?: string; 'aria-label'?: string; 'aria-disabled'?: boolean }) => (
    <button type="button" class={props.class} aria-label={props['aria-label']} aria-disabled={props['aria-disabled']} disabled={props.disabled} onClick={props.onClick}>{props.children}</button>
  ),
  Badge: (props: { children?: JSX.Element }) => <span>{props.children}</span>,
  Popover: (props: { open: boolean | (() => boolean); children?: JSX.Element }) => (
    <Show when={typeof props.open === 'function' ? props.open() : props.open}>
      <div class="ca-overflow-menu">{props.children}</div>
    </Show>
  ),
  IconBtn: (props: { children?: JSX.Element; onClick?: () => void; disabled?: boolean; 'aria-label'?: string; ref?: (el: HTMLButtonElement) => void }) => (
    <button type="button" ref={props.ref} aria-label={props['aria-label']} disabled={props.disabled} onClick={props.onClick}>{props.children}</button>
  ),
  Modal: (props: { children?: JSX.Element; footer?: JSX.Element; title?: JSX.Element | string }) => (
    <div>{props.title}{props.children}{props.footer}</div>
  ),
  ModalForm: (props: { isOpen?: boolean; children?: JSX.Element; footer?: JSX.Element; title?: JSX.Element | string }) => (
    props.isOpen === false ? null : <div>{props.title}{props.children}{props.footer}</div>
  ),
  Input: (props: { value?: string; onInput?: (e: InputEvent) => void; type?: string }) => (
    <input type={props.type ?? 'text'} value={props.value} onInput={(e) => props.onInput?.(e)} />
  ),
  HintText: (props: { children?: JSX.Element }) => <span>{props.children}</span>,
  FormField: (props: { children?: JSX.Element }) => <div>{props.children}</div>,
  VoiceSamplePicker: () => <span />,
  FloatingStatus: () => <span />,
  TabContainer: (props: { tabs?: Array<{ id: string; label: string }>; onTabChange?: (id: string) => void }) => (
    <div>{props.tabs?.map((tab) => <button type="button" onClick={() => props.onTabChange?.(tab.id)}>{tab.label}</button>)}</div>
  ),
  TabPanel: (props: { tabId?: string; activeTab?: string; children?: JSX.Element }) => (
    props.tabId === props.activeTab ? <div>{props.children}</div> : null
  ),
  Spinner: () => <span />,
  EmptyState: (props: { title?: JSX.Element | string; description?: JSX.Element | string; action?: { label: string; onClick: () => void } }) => (
    <div>
      <span>{props.title}</span>
      <span>{props.description}</span>
      {props.action && <button type="button" onClick={props.action.onClick}>{props.action.label}</button>}
    </div>
  ),
  ConnectionStatus: () => <span />,
  StatusBar: (props: { children?: JSX.Element }) => <div>{props.children}</div>,
  Textarea: (props: {
    value?: string;
    onInput?: (e: InputEvent) => void;
    onKeyDown?: (e: KeyboardEvent) => void;
    disabled?: boolean;
    placeholder?: string;
    class?: string;
    rows?: number;
    ref?: (el: HTMLTextAreaElement) => void;
  }) => (
    <textarea
      ref={props.ref}
      class={props.class}
      placeholder={props.placeholder}
      value={props.value}
      disabled={props.disabled}
      rows={props.rows}
      onInput={(e) => props.onInput?.(e)}
      onKeyDown={(e) => props.onKeyDown?.(e)}
    />
  ),
  Select: (props: { options?: Array<{ value: string; label: string }>; value?: string; onChange?: (e: Event) => void }) => (
    <select value={props.value} onChange={(e) => props.onChange?.(e)}>
      {props.options?.map((o) => <option value={o.value}>{o.label}</option>)}
    </select>
  ),
  ToggleSwitch: (props: { checked?: boolean; onChange?: (v: boolean) => void; label?: string }) => (
    <button type="button" onClick={() => props.onChange?.(!props.checked)}>{props.label}</button>
  ),
  Tag: (props: { children?: JSX.Element }) => <span>{props.children}</span>,
  formatKeybindDisplay: (key: string) => key,
  ChatIcon: () => <span />,
  TrashIcon: () => <span />,
  BatteryLowIcon: () => <span />,
}));

vi.mock('../../components', () => ({
  Btn: (props: { children?: JSX.Element; onClick?: () => void; disabled?: boolean }) => (
    <button type="button" disabled={props.disabled} onClick={props.onClick}>{props.children}</button>
  ),
  Input: (props: { value?: string; onInput?: (e: InputEvent) => void; type?: string }) => (
    <input type={props.type ?? 'text'} value={props.value} onInput={(e) => props.onInput?.(e)} />
  ),
  Spinner: () => <span />,
  IconBtn: (props: { children?: JSX.Element; onClick?: () => void; 'aria-label'?: string }) => (
    <button type="button" aria-label={props['aria-label']} onClick={props.onClick}>{props.children}</button>
  ),
  RefreshIcon: () => <span />,
  CheckIcon: () => <span />,
  CrossIcon: () => <span />,
  ScissorsIcon: () => <span />,
  SafeHtml: (props: { html?: string }) => <span innerHTML={String(props.html ?? '')} />,
}));

vi.mock('../../components/subtitle', () => ({
  WordHover: () => null,
}));

vi.mock('../../components/subtitle/ExplainerPopup', () => ({
  ExplainerPopup: () => null,
}));

vi.mock('./VoiceTab', () => ({
  VoiceTab: (props: { autoStartCall?: boolean }) => <div data-testid="voice-tab" data-auto-start={String(props.autoStartCall)} />,
}));

vi.mock('./ThreadInfoPanel', () => ({
  ThreadInfoPanel: () => <div data-testid="thread-info-panel" />,
}));

// ============================================================================
// Helpers
// ============================================================================

/** Emit an LLM chunk into the most recently registered stream listener. */
function emitChunk(chunk: LLMStreamChunk): void {
  streamCallback(chunk);
}

function chatText(container: HTMLElement): string {
  return container.querySelector('.ca-messages')?.textContent ?? '';
}

// ============================================================================
// Test
// ============================================================================

describe('conversationAgent window golden path (parity baseline)', () => {
  let container: HTMLDivElement;
  let dispose: () => void;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    streamCallback = () => {};
    windowContextCallback = () => {};
    journalEvents = [];
    currentWorld = {
      rooms: [{ id: 'room-a', title: 'Tutor', participantIds: ['agent-a'], createdAt: 1 }],
      threads: [{ id: 'thread-a', roomId: 'room-a', state: 'active', createdAt: 1 }],
      participants: [{ id: 'agent-a', displayName: 'Tutor', kind: 'persistent', personaText: 'Helpful tutor', setupComplete: true }],
    };
    testSettings = { ...DEFAULT_SETTINGS, livingWorldEnabled: true };
    mockBridge.kvStore.kvGet.mockResolvedValue(JSON.stringify({ roomId: 'room-a', threadId: 'thread-a' }));
    mockBridge.world.createPersistentRoom.mockClear();
    mockBridge.world.updateThread.mockClear();
    mockBridge.llm.llmStream.mockClear();
    mockBackend.tokenize.mockClear();
    settledWords = new Set();
  });

  afterEach(() => {
    dispose?.();
    container.remove();
  });

  it('boots rooms and renders journal messages for the selected room', async () => {
    currentWorld = {
      rooms: [
        { id: 'room-a', title: 'Tutor', participantIds: ['agent-a'], createdAt: 1 },
        { id: 'room-b', title: 'Partner', participantIds: ['agent-b'], createdAt: 2, unreadCount: 2 },
      ],
      threads: [
        { id: 'thread-a', roomId: 'room-a', state: 'active', createdAt: 1 },
        { id: 'thread-b', roomId: 'room-b', state: 'active', createdAt: 2 },
      ],
      participants: [
        { id: 'agent-a', displayName: 'Tutor', kind: 'persistent', personaText: 'Helpful tutor', setupComplete: true },
        { id: 'agent-b', displayName: 'Partner', kind: 'persistent', personaText: 'Helpful partner', setupComplete: true },
      ],
    };
    journalEvents = [appendJournalEvent({ roomId: 'room-b', scope: { kind: 'thread', threadId: 'thread-b' }, type: 'message.character', actorId: 'agent-b', witnesses: ['user', 'agent-b'], payload: { text: 'Hello from Partner' } })];
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    await vi.waitFor(() => expect(mockBridge.window.onWindowContext).toHaveBeenCalled());
    windowContextCallback({ roomId: 'room-b', threadId: 'thread-b' });
    await vi.waitFor(() => expect(mockBridge.journal.readThread).toHaveBeenCalledWith('room-b', 'thread-b'));
    await vi.waitFor(() => expect(chatText(container)).toContain('Hello from Partner'));
  });

  it('tokenizes journal-restored messages without persisted tokens', async () => {
    journalEvents = [appendJournalEvent({
      roomId: 'room-a',
      scope: { kind: 'thread', threadId: 'thread-a' },
      type: 'message.character',
      actorId: 'agent-a',
      witnesses: ['user', 'agent-a'],
      payload: { text: 'こんにちは' },
    })];
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);

    await vi.waitFor(() => expect(mockBackend.tokenize).toHaveBeenCalledWith('こんにちは'));
    await vi.waitFor(() => expect(container.querySelectorAll('.chat-token')).toHaveLength(1));
  });

  it('re-tokenizes restored bubbles when returning to a thread (A→B→A)', async () => {
    currentWorld = {
      rooms: [
        { id: 'room-a', title: 'Tutor', participantIds: ['agent-a'], createdAt: 1 },
        { id: 'room-b', title: 'Partner', participantIds: ['agent-b'], createdAt: 2 },
      ],
      threads: [
        { id: 'thread-a', roomId: 'room-a', state: 'active', createdAt: 1 },
        { id: 'thread-b', roomId: 'room-b', state: 'active', createdAt: 2 },
      ],
      participants: [
        { id: 'agent-a', displayName: 'Tutor', kind: 'persistent', personaText: 'Helpful tutor', setupComplete: true },
        { id: 'agent-b', displayName: 'Partner', kind: 'persistent', personaText: 'Helpful partner', setupComplete: true },
      ],
    };
    journalEvents = [appendJournalEvent({
      roomId: 'room-a',
      scope: { kind: 'thread', threadId: 'thread-a' },
      type: 'message.character',
      actorId: 'agent-a',
      witnesses: ['user', 'agent-a'],
      payload: { text: 'こんにちは' },
    })];
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    await vi.waitFor(() => expect(mockBridge.window.onWindowContext).toHaveBeenCalled());

    // Thread A mounts: the restored bubble tokenizes.
    await vi.waitFor(() => expect(container.querySelectorAll('.chat-token')).toHaveLength(1));

    // Switch to thread B, then back to A. The previously loaded bubble must
    // tokenize again instead of rendering as plain text.
    windowContextCallback({ roomId: 'room-b', threadId: 'thread-b' });
    await vi.waitFor(() => expect(mockBridge.journal.readThread).toHaveBeenCalledWith('room-b', 'thread-b'));
    windowContextCallback({ roomId: 'room-a', threadId: 'thread-a' });
    await vi.waitFor(() => expect(mockBridge.journal.readThread).toHaveBeenCalledWith('room-a', 'thread-a'));
    await vi.waitFor(() => expect(container.querySelectorAll('.chat-token')).toHaveLength(1));
    expect(chatText(container)).toContain('こんにちは');
  });

  it('opens persistent Room history and commits replies directly to Sea without creating a Thread', async () => {
    mockBridge.kvStore.kvGet.mockResolvedValue(null);
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    await vi.waitFor(() => expect(container.querySelector('textarea.ca-chat-textarea')).not.toBeNull());
    const textarea = container.querySelector('textarea.ca-chat-textarea') as HTMLTextAreaElement;
    textarea.value = 'Hello Tutor';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    const send = () => container.querySelector('button[aria-label="mlearn.ConversationAgent.Send"]') as HTMLButtonElement;
    await vi.waitFor(() => expect(send()?.disabled).toBe(false));
    send().click();
    await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalled());
    emitChunk({ content: 'Welcome back.', done: true });
    await vi.waitFor(() => expect(journalEvents.filter(event => event.type === 'message.character')).toHaveLength(1));
    expect(journalEvents.every(event => event.scope.kind === 'sea')).toBe(true);
    expect(mockBridge.world.createPersistentRoom).not.toHaveBeenCalled();
    expect(chatText(container)).toContain('Welcome back.');
  });

  it('restores Room-owned intent on a later mounted Room turn without selecting a Thread', async () => {
    testSettings.agentMistakeChecker = false; testSettings.agentSafetyChecker = false;
    mockBridge.journal.readThread.mockClear();
    mockBridge.kvStore.kvGet.mockResolvedValue(null);
    currentWorld = { ...worldFixture, threads: [], rooms: [{ ...worldFixture.rooms[0], scenarioRef: 'garden', scenario: {
      scene: { sharedFacts: ['The garden has a blue gate.'], socialConstraints: [], userObjectivePrivate: 'PRIVATE OWNER OBJECTIVE' },
      participants: [{ kind: 'temporary', localId: 'agent-a', profile: { name: 'Tutor', personaText: 'Helpful tutor',
        goals: ['Plant herbs'], behaviorConstraints: [], initialKnowledge: [{ text: 'PRIVATE TUTOR FACT', witnesses: ['agent-a'] }] } }],
      relationships: [], adaptations: [],
    } }] };
    const { ConversationContent } = await import('./App');
    for (let turn = 0; turn < 2; turn++) {
      dispose = render(() => <ConversationContent />, container);
      const send = () => container.querySelector('button[aria-label="mlearn.ConversationAgent.Send"]') as HTMLButtonElement;
      await vi.waitFor(() => expect(container.querySelector('textarea.ca-chat-textarea')).not.toBeNull());
      const textarea = container.querySelector('textarea.ca-chat-textarea') as HTMLTextAreaElement;
      textarea.value = 'What should we plant?'; textarea.dispatchEvent(new Event('input', { bubbles: true }));
      await vi.waitFor(() => expect(send()?.disabled).toBe(false)); send().click();
      await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalledTimes(turn + 1));
      const prompt = JSON.stringify(mockBridge.llm.llmStream.mock.calls[turn][0]);
      expect(prompt).toContain('The garden has a blue gate.');
      expect(prompt).toContain('Plant herbs');
      expect(prompt).toContain('PRIVATE TUTOR FACT');
      expect(prompt).not.toContain('PRIVATE OWNER OBJECTIVE');
      if (turn) expect(prompt).toContain('Let us plant basil.');
      emitChunk({ content: 'Let us plant basil.', done: true });
      await vi.waitFor(() => expect(journalEvents.filter(event => event.type === 'message.character')).toHaveLength(turn + 1));
      expect(journalEvents.every(event => event.scope.kind === 'sea')).toBe(true);
      expect(chatText(container)).not.toContain('PRIVATE TUTOR FACT');
      dispose(); container.replaceChildren();
    }
    expect(mockBridge.journal.readThread).not.toHaveBeenCalled();
  });

  it('appends user and character journal events for a streamed send', async () => {
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    await vi.waitFor(() => expect(mockBridge.window.onWindowContext).toHaveBeenCalled());
    windowContextCallback({ roomId: 'room-a', threadId: 'thread-a' });

    // Wait for the composer to render, then type and wait for it to become enabled
    // (enabled only once the LLM availability check passed and there is text).
    const sendButton = () =>
      container.querySelector('button[aria-label="mlearn.ConversationAgent.Send"]') as HTMLButtonElement | null;
    await vi.waitFor(() => expect(sendButton()).not.toBeNull());

    const textarea = container.querySelector('textarea.ca-chat-textarea') as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();
    textarea!.value = 'hola';
    textarea!.dispatchEvent(new Event('input', { bubbles: true }));

    await vi.waitFor(() => expect(sendButton()?.disabled).toBe(false));
    sendButton()!.click();

    await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalledTimes(1));
    expect(chatText(container)).toContain('hola');
    const sentHistory = mockBridge.llm.llmStream.mock.calls[0][0];
    expect(sentHistory.filter((message: { role: string; content: string }) => message.role === 'user' && message.content === 'hola')).toHaveLength(1);

    emitChunk({ content: 'こんにちは' });
    expect(chatText(container)).toContain('こんにちは');

    emitChunk({ content: '、元気？' });
    expect(chatText(container)).toContain('こんにちは、元気？');

    emitChunk({ done: true });
    await vi.waitFor(() => expect(journalEvents.map((event) => event.type)).toEqual(['message.user', 'message.character']));
    expect(chatText(container)).toContain('こんにちは、元気？');
    await vi.waitFor(() => expect(container.querySelectorAll('.chat-token')).toHaveLength(2));
  });

  it('keeps AI memory notes in the disposable Thread without writing Sea', async () => {
    testSettings.agentMemoryEnabled = true;
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    await vi.waitFor(() => expect(container.querySelector('textarea.ca-chat-textarea')).not.toBeNull());
    const textarea = container.querySelector('textarea.ca-chat-textarea') as HTMLTextAreaElement;
    textarea.value = 'I enjoy coffee';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    const send = container.querySelector('button[aria-label="mlearn.ConversationAgent.Send"]') as HTMLButtonElement;
    await vi.waitFor(() => expect(send.disabled).toBe(false));
    send.click();
    await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalledTimes(1));
    emitChunk({ content: 'Noted.', done: true, toolCalls: [{ id: 'memory-tool', name: 'save_memory', arguments: { content: 'Enjoys coffee' } }] });
    await vi.waitFor(() => expect(journalEvents.some(event => event.type === 'memory.belief')).toBe(true));
    expect(journalEvents.every(event => event.scope.kind === 'thread')).toBe(true);
    expect(journalEvents.find(event => event.type === 'memory.belief')?.payload).toMatchObject({ ownerId: 'agent-a', text: 'Enjoys coffee' });
  });

  it('opens and speaks in a saved standalone sandbox using its pinned person', async () => {
    const person = currentWorld.participants[0];
    currentWorld = { rooms: [], participants: [{ ...person, personaText: 'Later permanent persona' }], threads: [{
      id: 'practice-a', state: 'active', createdAt: 1,
      sandbox: { operationId: 'practice', requestHash: 'hash', baselineHeads: {},
        bindings: [{ originId: person.id, baseline: { ...person, personaText: 'Pinned practice persona' } }] },
    }] };
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    const sendButton = () => container.querySelector('button[aria-label="mlearn.ConversationAgent.Send"]') as HTMLButtonElement | null;
    await vi.waitFor(() => expect(sendButton()).not.toBeNull());
    const textarea = container.querySelector('textarea.ca-chat-textarea') as HTMLTextAreaElement;
    textarea.value = 'Hello again';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(sendButton()?.disabled).toBe(false));
    sendButton()!.click();
    await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalledTimes(1));
    const prompt = JSON.stringify(mockBridge.llm.llmStream.mock.calls[0][0]);
    expect(prompt).toContain('Pinned practice persona');
    expect(prompt).not.toContain('Later permanent persona');
    emitChunk({ content: 'Welcome back.', done: true });
    await vi.waitFor(() => expect(journalEvents.map(event => event.type)).toEqual(['message.user', 'message.character']));
    expect(journalEvents.every(event => event.roomId === 'practice-a' && event.scope.kind === 'thread' && event.scope.threadId === 'practice-a')).toBe(true);
    expect(currentWorld.rooms).toEqual([]);
  });

  it('translates arriving media context into the active thread and renders it in Thread', async () => {
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    await vi.waitFor(() => expect(mockBridge.window.onWindowContext).toHaveBeenCalled());

    windowContextCallback({
      roomId: 'room-a',
      threadId: 'thread-a',
      mediaHash: 'video-1',
      mediaName: 'Episode One',
      mediaType: 'video',
      assessedLevel: null,
      assessedLevelName: 'N3',
      language: 'ja',
      failedWords: [],
      failedGrammar: [],
      wordLevelPercentages: { entries: [], totalUnique: 0, totalOccurrences: 0 },
      grammarLevelPercentages: { entries: [], totalUnique: 0, totalOccurrences: 0 },
    });

    await vi.waitFor(() => expect(mockBridge.world.updateThread).toHaveBeenCalledWith(expect.objectContaining({
      id: 'thread-a',
      mediaRef: expect.objectContaining({ mediaHash: 'video-1', mediaName: 'Episode One', mediaType: 'video' }),
    })));
  });

  it('merges legacy tutor selections into the compiled learner projection', async () => {
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    await vi.waitFor(() => expect(mockBridge.window.onWindowContext).toHaveBeenCalled());
    windowContextCallback({
      roomId: 'room-a',
      threadId: 'thread-a',
      tutorConfig: {
        selectedGrammar: [{ pattern: 'て-form', meaning: 'connector', level: 5 }],
        selectedWords: [{ word: '猫', ease: 1 }],
        selectedMedia: [],
        customInstructions: 'Practice cats',
      },
    });
    const textarea = container.querySelector('textarea.ca-chat-textarea') as HTMLTextAreaElement;
    await vi.waitFor(() => expect(textarea).toBeTruthy());
    textarea.value = 'hello';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    const sendButton = container.querySelector('button[aria-label="mlearn.ConversationAgent.Send"]') as HTMLButtonElement;
    await vi.waitFor(() => expect(sendButton.disabled).toBe(false));
    sendButton.click();
    await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalled());
    const [messages] = mockBridge.llm.llmStream.mock.calls.at(-1) as [{ content: string }[]];
    expect(messages[0].content).toContain('猫');
    expect(messages[0].content).toContain('て-form');
  });

  it('filters journal-settled words out of media failures in the learner projection', async () => {
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    await vi.waitFor(() => expect(mockBridge.window.onWindowContext).toHaveBeenCalled());
    settledWords = new Set(['犬']);
    windowContextCallback({
      roomId: 'room-a',
      threadId: 'thread-a',
      mediaHash: 'video-1',
      mediaName: 'Episode One',
      mediaType: 'video',
      assessedLevel: null,
      assessedLevelName: 'N3',
      language: 'ja',
      failedWords: [{ word: '犬', ease: -2 }, { word: '消える', ease: -1 }],
      failedGrammar: [],
      wordLevelPercentages: { entries: [], totalUnique: 0, totalOccurrences: 0 },
      grammarLevelPercentages: { entries: [], totalUnique: 0, totalOccurrences: 0 },
    });
    const textarea = container.querySelector('textarea.ca-chat-textarea') as HTMLTextAreaElement;
    await vi.waitFor(() => expect(textarea).toBeTruthy());
    textarea.value = 'hello';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    const sendButton = container.querySelector('button[aria-label="mlearn.ConversationAgent.Send"]') as HTMLButtonElement;
    await vi.waitFor(() => expect(sendButton.disabled).toBe(false));
    sendButton.click();
    await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalled());
    const [messages] = mockBridge.llm.llmStream.mock.calls.at(-1) as [{ content: string }[]];
    // 消える is an unsettled failure and reaches the tutor; 犬 is journal-settled and must not.
    expect(messages[0].content).toContain('消える');
    expect(messages[0].content).not.toContain('犬');
  });

  it('keeps explicit tutor selections even when the word is journal-settled', async () => {
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    await vi.waitFor(() => expect(mockBridge.window.onWindowContext).toHaveBeenCalled());
    settledWords = new Set(['犬']);
    windowContextCallback({
      roomId: 'room-a',
      threadId: 'thread-a',
      tutorConfig: {
        selectedGrammar: [],
        selectedWords: [{ word: '犬', ease: 1 }],
        selectedMedia: [],
        customInstructions: 'Practice dogs',
      },
    });
    const textarea = container.querySelector('textarea.ca-chat-textarea') as HTMLTextAreaElement;
    await vi.waitFor(() => expect(textarea).toBeTruthy());
    textarea.value = 'hello';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    const sendButton = container.querySelector('button[aria-label="mlearn.ConversationAgent.Send"]') as HTMLButtonElement;
    await vi.waitFor(() => expect(sendButton.disabled).toBe(false));
    sendButton.click();
    await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalled());
    const [messages] = mockBridge.llm.llmStream.mock.calls.at(-1) as [{ content: string }[]];
    // Selections are assignments, not failure inferences — reconciliation never vetoes them.
    expect(messages[0].content).toContain('犬');
  });

  it('uses a single chat shell with header overflow controls', async () => {
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    await vi.waitFor(() => expect(container.querySelector('button[aria-label="mlearn.ConversationAgent.Menu.OverflowAria"]')).not.toBeNull());
    expect(container.querySelector('[role="tab"]')).toBeNull();
    (container.querySelector('button[aria-label="mlearn.ConversationAgent.Menu.OverflowAria"]') as HTMLButtonElement).click();
    expect(container.textContent).toContain('mlearn.ConversationAgent.Sidebar.NewConversation');
    expect(container.textContent).toContain('mlearn.ConversationAgent.Menu.Details');
    expect(container.textContent).not.toContain('mlearn.ConversationAgent.Menu.WordHover');
  });

  it('opens details from a media chip and initial stats context', async () => {
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    await vi.waitFor(() => expect(mockBridge.window.onWindowContext).toHaveBeenCalled());
    windowContextCallback({ roomId: 'room-a', threadId: 'thread-a', initialTab: 'stats' });
    await vi.waitFor(() => expect(container.querySelector('[data-testid="thread-info-panel"]')).not.toBeNull());
  });

  it('renders New conversation in the room sidebar', async () => {
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    await vi.waitFor(() => expect(container.querySelector('button[aria-label="mlearn.ConversationAgent.History.ToggleSidebar"]')).not.toBeNull());
    (container.querySelector('button[aria-label="mlearn.ConversationAgent.History.ToggleSidebar"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(Array.from(container.querySelectorAll('button')).some((button) => button.textContent === 'mlearn.ConversationAgent.Sidebar.NewConversation')).toBe(true));
    expect(container.querySelector('.room-sidebar-new-conversation')).not.toBeNull();
  });

  it('opens the NewConversationModal from the room sidebar', async () => {
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    await vi.waitFor(() => expect(container.querySelector('button[aria-label="mlearn.ConversationAgent.History.ToggleSidebar"]')).not.toBeNull());
    (container.querySelector('button[aria-label="mlearn.ConversationAgent.History.ToggleSidebar"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(Array.from(container.querySelectorAll('button')).some((button) => button.textContent === 'mlearn.ConversationAgent.Sidebar.NewConversation')).toBe(true));
    Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'mlearn.ConversationAgent.Sidebar.NewConversation')!.click();
    await vi.waitFor(() => expect(container.querySelector('.new-conversation-form')).not.toBeNull());
  });

  it('waits for the introduction before opening empty-world creation', async () => {
    currentWorld = { rooms: [], threads: [], participants: [] };
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    await vi.waitFor(() => expect(mockBridge.world.getWorldState).toHaveBeenCalled());
    expect(container.querySelector('.new-conversation-form')).toBeNull();
    Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'mlearn.ConversationAgent.AgeVerification.ContinueButton')!.click();
    await vi.waitFor(() => expect(container.querySelector('.new-conversation-form')).not.toBeNull());
  });

  it('opens NewConversationModal from the empty state when no room is selected', async () => {
    currentWorld = {
      rooms: [],
      threads: [],
      participants: [{ id: 'agent-a', displayName: 'Tutor', kind: 'persistent', personaText: 'Helpful tutor', setupComplete: true }],
    };
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);

    await vi.waitFor(() => expect(Array.from(container.querySelectorAll('button')).some((button) => button.textContent === 'mlearn.ConversationAgent.Empty.NewConversation')).toBe(true));
    Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'mlearn.ConversationAgent.Empty.NewConversation')!.click();
    await vi.waitFor(() => expect(container.querySelector('.new-conversation-form')).not.toBeNull());
  });

  it('mounts VoiceTab with autoStartCall from the call button', async () => {
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    await vi.waitFor(() => expect(container.querySelector('button[aria-label="mlearn.ConversationAgent.Call.StartAria"]')).not.toBeNull());
    const callButton = container.querySelector('button[aria-label="mlearn.ConversationAgent.Call.StartAria"]') as HTMLButtonElement;
    await vi.waitFor(() => expect(callButton.disabled).toBe(false));
    callButton.click();
    await vi.waitFor(() => expect(container.querySelector('[data-testid="voice-tab"]')?.getAttribute('data-auto-start')).toBe('true'));
  });
});
