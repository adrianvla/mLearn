// @vitest-environment happy-dom

/** Mounted Conversation runtime tests. The IPC/backend and provider boundaries
 * are controlled; turn orchestration, prompt construction, journal projection,
 * message rendering and the shared token component are real. */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { Show } from 'solid-js';
import type { JSX } from 'solid-js';
import { DEFAULT_SETTINGS } from '../../../shared/types';
import type { LLMModelStatus, LLMStreamChunk } from '../../../shared/types';
import type { JournalEvent, JournalEventDraft, WorldSnapshot } from '../../../shared/world';
import type { TurnReviewRequest, TurnReviewResult } from '../../../shared/conversationReview';

const mockForceHideHover = vi.hoisted(() => vi.fn());
const mockCloudToken = vi.hoisted(() => vi.fn(async () => 'fresh-token'));
let desktopRuntime = false;

vi.mock('../../../shared/platform', async (original) => ({
  ...await original<typeof import('../../../shared/platform')>(),
  isElectron: () => desktopRuntime,
}));

vi.mock('../../services/cloudSessionManager', async (original) => ({
  ...await original<typeof import('../../services/cloudSessionManager')>(),
  ensureCloudAccessToken: mockCloudToken,
}));

vi.mock('../../../shared/backends/cloudLLMAdapter', () => ({
  CloudLLMAdapter: class { async checkAvailability() { return true; } },
}));

// ============================================================================
// Bridge mock (the bridge boundary — everything else under test is real)
// ============================================================================

let streamCallback: (chunk: LLMStreamChunk) => void = () => {};
let windowContextCallback: (context: unknown) => void = () => {};
let openRoomCallback: (payload: import('../../../shared/world').OpenRoomEventPayload) => void = () => {};
let journalEvents: JournalEvent[] = [];
let voiceTabMounts = 0;
const readyModelStatus: LLMModelStatus = {
  downloaded: true,
  loaded: true,
  runtimeAvailable: true,
  ready: true,
  downloading: false,
  progress: 1,
  downloadedBytes: 1,
  expectedBytes: 1,
};
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
  settings: {
    awaitSettingsSaved: vi.fn(async () => {}),
  },
  llm: {
    onLLMStreamChunk: vi.fn((cb: (chunk: LLMStreamChunk) => void) => {
      streamCallback = cb;
      return () => {};
    }),
    llmStream: vi.fn(),
    llmStreamAbort: vi.fn(),
    llmCheckModel: vi.fn(async () => readyModelStatus),
    onLLMModelStatus: vi.fn(() => () => {}),
    ollamaCheck: vi.fn(async () => false),
  },
  window: {
    onWindowContext: vi.fn((callback: (context: unknown) => void) => { windowContextCallback = callback; return () => {}; }),
    onOpenRoomEvent: vi.fn((callback: typeof openRoomCallback) => { openRoomCallback = callback; return () => {}; }),
    getWindowContext: vi.fn(),
    openWindow: vi.fn(),
  },
  world: {
    onChanged: vi.fn(() => () => {}),
    reviewConversationTurn: vi.fn(async (request: TurnReviewRequest): Promise<TurnReviewResult> => ({
      status: 'approved', text: request.assistantText, reason: 'none', restrictUserContext: false, reviewId: request.operationId,
    })),
    cancelConversationReview: vi.fn(async () => {}),
    getWorldState: vi.fn(async () => currentWorld),
    prepareScenario: vi.fn(async (request: { operationId: string; intent?: string; participantIds: string[] }) => ({
      operationId: request.operationId, status: 'ready', request, bindings: [],
      scenario: { scene: { sharedFacts: ['Practice session'], socialConstraints: [] }, participants: [], relationships: [], adaptations: [] },
    })),
    activateScenario: vi.fn(async () => {
      const request = mockBridge.world.prepareScenario.mock.calls.at(-1)![0];
      const thread = { id: 'thread-tutor', roomId: 'room-a', state: 'active' as const, createdAt: 2, intent: request.intent };
      currentWorld = { ...currentWorld, threads: [...currentWorld.threads, thread] };
      return thread;
    }),
    cancelScenario: vi.fn(async () => {}),
    createPersistentRoom: vi.fn(async (input: { operationId: string; participantIds: string[] }) => ({ id: 'room-new', title: 'New room', participantIds: input.participantIds, createdByOperation: input.operationId, createdAt: Date.now() })),
    updateThread: vi.fn(async (thread: WorldSnapshot['threads'][number]) => thread),
    clearRoomUnread: vi.fn(async () => {}),
    triggerReflection: vi.fn(async () => {}),
    respondToContact: vi.fn(async (contactId: string, response: 'accept' | 'decline') => ({
      ok: true as const,
      contact: currentWorld.contacts!.find(contact => contact.contactId === contactId && contact.modality === 'call')!,
      response,
    })),
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
let settingsLoading = false;

// Words the canonical knowledge resolver reports settled (evidence-known or
// excluded); mutated per test to drive learner-projection reconciliation.
let settledWords = new Set<string>();
vi.mock('../../context', () => ({
  WindowWrapper: (props: { children?: JSX.Element }) => <div>{props.children}</div>,
  useSettings: () => ({
    settings: testSettings,
    isLoading: () => settingsLoading,
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
    forceHide: mockForceHideHover,
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

vi.mock('../../components/common', async (original) => ({
  ...await original<typeof import('../../components/common')>(),
  PlusIcon: () => <span aria-hidden="true" />,
  SearchIcon: () => <span aria-hidden="true" />,
  Button: (props: { children?: JSX.Element; onClick?: () => void; disabled?: boolean; variant?: string; size?: string; class?: string; 'aria-label'?: string; 'aria-disabled'?: boolean }) => (
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
  RadioChoice: (props: { name: string; label: string; checked: boolean; disabled?: boolean; onChange: () => void }) => (
    <label><input type="radio" name={props.name} aria-label={props.label} checked={props.checked} disabled={props.disabled} onChange={props.onChange} />{props.label}</label>
  ),
  VoiceSamplePicker: () => <span />,
  TabContainer: (props: { children?: JSX.Element; tabs?: Array<{ id: string; label: string }>; onTabChange?: (id: string) => void }) => (
    <div>{props.tabs?.map((tab) => <button type="button" onClick={() => props.onTabChange?.(tab.id)}>{tab.label}</button>)}{props.children}</div>
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
  Button: (props: { children?: JSX.Element; onClick?: () => void; disabled?: boolean }) => (
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
  VoiceTab: (props: { autoStartCall?: boolean; agentName?: string; defaultVoiceSampleId?: string; onSendMessage?: (text: string) => Promise<void>; onAbort?: () => void; onStatusChange?: (status: string) => void; onCallStateChange?: (active: boolean, reason?: 'failed' | 'completed', error?: string) => void }) => {
    voiceTabMounts++;
    return (
    <div
      data-testid="voice-tab"
      data-auto-start={String(props.autoStartCall)}
      data-agent-name={props.agentName}
      data-voice-sample={props.defaultVoiceSampleId}
    ><button onClick={() => props.onCallStateChange?.(false, 'failed', "No module named kokoro")}>Simulate voice failure</button>
      <button onClick={() => props.onStatusChange?.('Listening…')}>Simulate listening</button>
      <button onClick={() => props.onCallStateChange?.(true)}>Start call session</button>
      <button onClick={() => void props.onSendMessage?.('A spoken question')}>Send voice transcript</button>
      <button onClick={() => props.onAbort?.()}>Abort call response</button>
      <button onClick={() => { props.onCallStateChange?.(true); props.onCallStateChange?.(false, 'completed'); }}>Complete call</button>
    </div>
    );
  },
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

// ============================================================================
// Test
// ============================================================================

describe('conversationAgent window golden path (parity baseline)', () => {
  beforeAll(async () => { await import('./App'); }, 30000);
  let container: HTMLDivElement;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    dispose = undefined;
    container = document.createElement('div');
    document.body.appendChild(container);
    streamCallback = () => {};
    windowContextCallback = () => {};
    openRoomCallback = () => {};
    journalEvents = [];
    voiceTabMounts = 0;
    desktopRuntime = false;
    mockCloudToken.mockResolvedValue('fresh-token');
    currentWorld = {
      rooms: [{ id: 'room-a', title: 'Tutor', participantIds: ['agent-a'], createdAt: 1 }],
      threads: [{ id: 'thread-a', roomId: 'room-a', state: 'active', createdAt: 1 }],
      participants: [{ id: 'agent-a', displayName: 'Tutor', kind: 'persistent', personaText: 'Helpful tutor', setupComplete: true }],
    };
    testSettings = { ...DEFAULT_SETTINGS, livingWorldEnabled: true };
    settingsLoading = false;
    // Sending is gated on the model's `ready` status. Keep the bridge fixture
    // explicit so this suite never inherits a status implementation from a
    // different test order.
    mockBridge.llm.llmCheckModel.mockReset().mockResolvedValue(readyModelStatus);
    mockBridge.kvStore.kvGet.mockResolvedValue(JSON.stringify({ roomId: 'room-a', threadId: 'thread-a' }));
    mockBridge.world.prepareScenario.mockClear();
    mockBridge.world.activateScenario.mockClear();
    mockBridge.world.createPersistentRoom.mockClear();
    mockBridge.world.updateThread.mockClear();
    mockBridge.llm.llmStream.mockClear();
    mockBackend.tokenize.mockReset().mockImplementation(async text => [{ actual_word: text, word: text, type: 'NOUN' }]);
    mockBridge.world.getWorldState.mockReset().mockImplementation(async () => currentWorld);
    mockBridge.journal.readSeaProjection.mockReset().mockImplementation(async roomId => journalEvents.filter(event => event.roomId === roomId && event.scope.kind === 'sea'));
    mockBridge.journal.readThread.mockReset().mockImplementation(async (_roomId, threadId) => journalEvents.filter(event => event.scope.kind === 'thread' && event.scope.threadId === threadId));
    settledWords = new Set();
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    container.remove();
  });

  it('waits for saved settings before checking the built-in model', async () => {
    settingsLoading = true;
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    await Promise.resolve();

    expect(mockBridge.llm.llmCheckModel).not.toHaveBeenCalled();
  });

  it('shows shared skeletons until the world and saved conversation have loaded', async () => {
    const worldRead = deferred<WorldSnapshot>();
    mockBridge.world.getWorldState.mockImplementationOnce(() => worldRead.promise);
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    expect(container.querySelectorAll('.ca-history-loading .skeleton-card')).toHaveLength(3);
    expect(container.querySelector('.room-sidebar-list .skeleton-rows')).not.toBeNull();
    expect(container.textContent).not.toContain('mlearn.ConversationAgent.Empty.Title');
    expect(container.querySelector('.new-conversation-form')).toBeNull();
    expect((container.querySelector('.ca-chat-textarea') as HTMLTextAreaElement).disabled).toBe(true);
    worldRead.resolve(currentWorld);
    await vi.waitFor(() => expect(container.querySelector('.ca-history-loading')).toBeNull());
    expect(container.querySelector('.room-sidebar-list .skeleton-rows')).toBeNull();
    expect(mockBridge.kvStore.kvSet).toHaveBeenCalledWith('conversation-selection', JSON.stringify({ roomId: 'room-a', threadId: 'thread-a' }));
  });

  it('keeps skeletons while saved history is pending, then shows that history without a new-practice dialog', async () => {
    const historyRead = deferred<JournalEvent[]>();
    mockBridge.journal.readThread.mockImplementation(() => historyRead.promise);
    const savedMessage = appendJournalEvent({ roomId: 'room-a', scope: { kind: 'thread', threadId: 'thread-a' },
      type: 'message.character', actorId: 'agent-a', witnesses: ['user'], payload: { text: 'Welcome back' } });
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    await vi.waitFor(() => expect(mockBridge.journal.readThread).toHaveBeenCalled());
    expect(container.querySelector('.ca-history-loading')).not.toBeNull();
    expect(container.textContent).not.toContain('mlearn.ConversationAgent.Empty.Title');
    historyRead.resolve([savedMessage]);
    await vi.waitFor(() => expect(container.querySelector('.chat-bubble')?.textContent).toContain('Welcome back'));
    expect(container.querySelector('.ca-history-loading')).toBeNull();
    expect(container.querySelector('.new-conversation-form')).toBeNull();
  });

  it('ends a failed load with a retry action and restores the saved conversation on retry', async () => {
    mockBridge.world.getWorldState.mockRejectedValueOnce(new Error('Read unavailable'));
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    await vi.waitFor(() => expect(container.querySelector('.ca-history-loading')).toBeNull());
    expect(container.querySelector('.ca-messages')?.textContent).toContain('mlearn.ConversationAgent.ErrorTitle');
    expect(container.querySelector('.ca-messages')?.textContent).not.toContain('mlearn.ConversationAgent.Empty.Title');
    const retry = Array.from(container.querySelectorAll('.ca-messages button')).find(button => button.textContent === 'mlearn.Global.Retry')!;
    (retry as HTMLButtonElement).click();
    await vi.waitFor(() => expect(mockBridge.kvStore.kvSet).toHaveBeenCalledWith('conversation-selection', JSON.stringify({ roomId: 'room-a', threadId: 'thread-a' })));
    expect(container.querySelector('.ca-history-loading')).toBeNull();
    expect(container.querySelector('.new-conversation-form')).toBeNull();
  });

  it('returns to a saved practice conversation and selects its sidebar tab', async () => {
    testSettings.livingWorldEnabled = false;
    currentWorld = { rooms: [], participants: [], threads: [{ id: 'practice-a', interactionMode: 'practice', state: 'active', createdAt: 2,
      sandbox: { operationId: 'practice', requestHash: 'hash', bindings: [{ baseline: worldFixture.participants[0] }], baselineHeads: {} } }] };
    mockBridge.kvStore.kvGet.mockResolvedValue(JSON.stringify({ roomId: 'practice-a', threadId: 'practice-a' }));
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    await vi.waitFor(() => expect(mockBridge.kvStore.kvSet).toHaveBeenCalledWith('conversation-selection', JSON.stringify({ roomId: 'practice-a', threadId: 'practice-a' })));
    expect(container.querySelector('.room-sidebar-title')?.textContent).toBe('mlearn.ConversationAgent.Contacts.Practice');
    expect(container.querySelectorAll('.room-sidebar-thread')).toHaveLength(1);
    expect(container.querySelector('.new-conversation-form')).toBeNull();
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

  it('requires explicit acceptance before an incoming contact starts the real voice surface', async () => {
    currentWorld = {
      ...worldFixture,
      contacts: [{
        contactId: 'contact-call', operationId: 'contact-call', roomId: 'room-a', participantId: 'agent-a',
        targetActorId: 'user', causeKind: 'open-loop', sourceEventIds: ['evt-cause'], sourceHash: 'hash',
        status: 'opened', revision: 3, history: [{ status: 'opened', at: 3 }], createdAt: 1, effectiveAt: 1,
        readyAt: 1, expiresAt: Date.now() + 60_000, modality: 'call', callId: 'call-1', eventIds: ['evt-invite'],
        deliveryAttempts: 1, participantRevision: 'p', roomRevision: 'r',
      }],
    };
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    await vi.waitFor(() => expect(mockBridge.window.onOpenRoomEvent).toHaveBeenCalled());

    openRoomCallback({ roomId: 'room-a', contactId: 'contact-call', callId: 'call-1' });
    await vi.waitFor(() => expect(container.textContent).toContain('mlearn.ConversationAgent.IncomingCall.Title'));
    expect(container.querySelector('[data-testid="voice-tab"]')).toBeNull();

    const accept = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'mlearn.ConversationAgent.IncomingCall.Accept')!;
    accept.click();
    await vi.waitFor(() => expect(mockBridge.world.respondToContact).toHaveBeenCalledWith('contact-call', 'accept'));
    await vi.waitFor(() => expect(container.querySelector('[data-testid="voice-tab"]')?.getAttribute('data-auto-start')).toBe('true'));
  });

  it('keeps a multi-person incoming call bound to the contacting person and voice', async () => {
    currentWorld = {
      rooms: [{ id: 'room-a', title: 'Garden', participantIds: ['agent-a', 'agent-b'], createdAt: 1 }],
      threads: [],
      participants: [
        { id: 'agent-a', displayName: 'Eli', kind: 'persistent', personaText: 'Eli plans layouts.', setupComplete: true, voiceSampleId: 'voice-eli' },
        { id: 'agent-b', displayName: 'Mara', kind: 'persistent', personaText: 'Mara keeps the catalog.', setupComplete: true, voiceSampleId: 'voice-mara' },
      ],
      contacts: [{
        contactId: 'contact-call-b', operationId: 'contact-call-b', roomId: 'room-a', participantId: 'agent-b',
        targetActorId: 'user', causeKind: 'open-loop', sourceEventIds: ['evt-cause'], sourceHash: 'hash',
        status: 'opened', revision: 3, history: [{ status: 'opened', at: 3 }], createdAt: 1, effectiveAt: 1,
        readyAt: 1, expiresAt: Date.now() + 60_000, modality: 'call', callId: 'call-b', eventIds: ['evt-invite'],
        deliveryAttempts: 1, participantRevision: 'p', roomRevision: 'r',
      }],
    };
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    await vi.waitFor(() => expect(mockBridge.window.onOpenRoomEvent).toHaveBeenCalled());

    openRoomCallback({ roomId: 'room-a', contactId: 'contact-call-b', callId: 'call-b' });
    await vi.waitFor(() => expect(container.textContent).toContain('mlearn.ConversationAgent.IncomingCall.Title'));
    const accept = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'mlearn.ConversationAgent.IncomingCall.Accept')!;
    accept.click();

    await vi.waitFor(() => expect(container.querySelector('[data-testid="voice-tab"]')?.getAttribute('data-agent-name')).toBe('Mara'));
    expect(container.querySelector('[data-testid="voice-tab"]')?.getAttribute('data-voice-sample')).toBe('voice-mara');
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
    await vi.waitFor(() => expect(chatText(container)).toContain('こんにちは'));
  });

  it('sends on Enter, but not Shift+Enter or an IME composition confirmation', async () => {
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    await vi.waitFor(() => expect(container.querySelector('textarea.ca-chat-textarea')).not.toBeNull());
    const textarea = container.querySelector('textarea.ca-chat-textarea') as HTMLTextAreaElement;
    await vi.waitFor(() => expect(textarea.disabled).toBe(false));
    textarea.value = 'Compose before sending'; textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
    await Promise.resolve(); expect(mockBridge.llm.llmStream).not.toHaveBeenCalled();
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalledOnce());
    emitChunk({ content: 'Reply', done: true });
    await vi.waitFor(() => expect(journalEvents.some(event => event.type === 'message.character')).toBe(true));
  });

  it('reopens the current conversation without aborting its response', async () => {
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    const textarea = container.querySelector('.ca-chat-textarea') as HTMLTextAreaElement;
    await vi.waitFor(() => expect(textarea.disabled).toBe(false));
    textarea.value = 'Hello'; textarea.dispatchEvent(new Event('input', { bubbles: true }));
    (container.querySelector('button[aria-label="mlearn.ConversationAgent.Send"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalled());
    emitChunk({ content: 'A pending reply' });
    mockBridge.llm.llmStreamAbort.mockClear();
    const readCount = mockBridge.journal.readThread.mock.calls.length;
    windowContextCallback({ roomId: 'room-a', threadId: 'thread-a' });
    await vi.waitFor(() => expect(mockBridge.journal.readThread.mock.calls.length).toBeGreaterThan(readCount));
    expect(mockBridge.llm.llmStreamAbort).not.toHaveBeenCalled();
    emitChunk({ done: true });
    await vi.waitFor(() => expect(journalEvents.some(event => event.type === 'message.character')).toBe(true));
    expect(chatText(container)).toContain('A pending reply');
  });

  it('commits a completed reply across call teardown while annotation is pending and restores it after reopening', async () => {
    desktopRuntime = true;
    const review = deferred<TurnReviewResult>();
    mockBridge.world.reviewConversationTurn.mockImplementationOnce(() => review.promise);
    const annotation = deferred<import('../../../shared/types').Token[]>();
    mockBackend.tokenize.mockImplementation(() => annotation.promise);
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    const textarea = container.querySelector('.ca-chat-textarea') as HTMLTextAreaElement;
    await vi.waitFor(() => expect(textarea.disabled).toBe(false));
    textarea.value = 'Hello'; textarea.dispatchEvent(new Event('input', { bubbles: true }));
    (container.querySelector('button[aria-label="mlearn.ConversationAgent.Send"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalled());
    emitChunk({ content: 'The latest completed reply', done: true });
    await vi.waitFor(() => expect(mockBridge.world.reviewConversationTurn).toHaveBeenCalledOnce());
    (container.querySelector('button[aria-label="mlearn.ConversationAgent.Call.StartAria"]') as HTMLButtonElement).click();
    const abort = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Abort call response')!;
    (abort as HTMLButtonElement).click();
    review.resolve({ status: 'approved', text: 'The latest completed reply', reason: 'none', restrictUserContext: false, reviewId: 'review-complete' });
    await vi.waitFor(() => expect(journalEvents.some(event => event.type === 'message.character' && (event.payload as { text: string }).text === 'The latest completed reply')).toBe(true));
    dispose();
    dispose = render(() => <ConversationContent />, container);
    await vi.waitFor(() => expect(chatText(container)).toContain('The latest completed reply'));
    annotation.resolve([]);
  });

  it.each(['Abort call response', 'Complete call', 'Simulate voice failure'])('cancels an in-call review on %s without admitting unheard content', async (action) => {
    desktopRuntime = true;
    testSettings.agentMistakeChecker = false;
    testSettings.agentSafetyChecker = false;
    const review = deferred<TurnReviewResult>();
    mockBridge.world.reviewConversationTurn.mockImplementationOnce(() => review.promise);
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    const call = () => container.querySelector<HTMLButtonElement>('button[aria-label="mlearn.ConversationAgent.Call.StartAria"]');
    await vi.waitFor(() => expect(call()?.disabled).toBe(false));
    call()!.click();
    const button = (label: string) => Array.from(container.querySelectorAll('button')).find(b => b.textContent === label)!;
    button('Start call session').click();
    button('Send voice transcript').click();
    await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalledOnce());
    emitChunk({ content: 'Unheard secret for a later turn', done: true });
    await vi.waitFor(() => expect(mockBridge.world.reviewConversationTurn).toHaveBeenCalledOnce());
    button(action).click();
    expect(mockBridge.world.cancelConversationReview).toHaveBeenCalledOnce();
    review.resolve({ status: 'approved', text: 'Unheard secret for a later turn', reason: 'none', restrictUserContext: false, reviewId: 'cancelled-call' });
    await new Promise<void>(resolve => queueMicrotask(resolve));
    await new Promise<void>(resolve => queueMicrotask(resolve));
    expect(journalEvents.filter(event => event.type === 'message.character' || event.type === 'memory.belief')).toHaveLength(0);
    expect(mockBridge.llm.llmStream).toHaveBeenCalledOnce();
    expect(chatText(container)).not.toContain('Unheard secret');
    expect(mockBridge.world.triggerReflection).not.toHaveBeenCalled();
  });

  it('keeps a successor voice overlay when a cancelled turn finishes its in-flight journal append', async () => {
    desktopRuntime = true;
    testSettings.agentMistakeChecker = false;
    testSettings.agentSafetyChecker = false;
    const append = deferred<JournalEvent>();
    let delayedDraft: JournalEventDraft | undefined;
    mockBridge.journal.appendEvent.mockImplementationOnce(async (_roomId, draft) => appendJournalEvent(draft));
    mockBridge.journal.appendEvent.mockImplementationOnce(async (_roomId, draft) => { delayedDraft = draft; return append.promise; });
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    const call = () => container.querySelector<HTMLButtonElement>('button[aria-label="mlearn.ConversationAgent.Call.StartAria"]');
    await vi.waitFor(() => expect(call()?.disabled).toBe(false));
    call()!.click();
    const button = (label: string) => Array.from(container.querySelectorAll('button')).find(b => b.textContent === label)!;
    button('Start call session').click();
    button('Send voice transcript').click();
    await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalledOnce());
    emitChunk({ content: 'Earlier approved response', done: true });
    await vi.waitFor(() => expect(delayedDraft?.type).toBe('message.character'));
    button('Abort call response').click();
    button('Send voice transcript').click();
    await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalledTimes(2));
    emitChunk({ content: 'Successor is still speaking' });
    expect(chatText(container)).toContain('Successor is still speaking');
    append.resolve(appendJournalEvent(delayedDraft!));
    await new Promise<void>(resolve => queueMicrotask(resolve));
    await new Promise<void>(resolve => queueMicrotask(resolve));
    expect(chatText(container)).toContain('Successor is still speaking');
    emitChunk({ done: true });
    await vi.waitFor(() => expect(journalEvents.some(event => event.type === 'message.character' && (event.payload as { text: string }).text === 'Successor is still speaking')).toBe(true));
  });

  it.each(['Complete call', 'Simulate voice failure'])('cancels a voice send waiting for settings on %s', async (action) => {
    desktopRuntime = true;
    testSettings.llmProvider = 'openai-compatible';
    const preflight = deferred<void>();
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    const call = () => container.querySelector<HTMLButtonElement>('button[aria-label="mlearn.ConversationAgent.Call.StartAria"]');
    await vi.waitFor(() => expect(call()?.disabled).toBe(false));
    call()!.click();
    const button = (label: string) => Array.from(container.querySelectorAll('button')).find(b => b.textContent === label)!;
    button('Start call session').click();
    mockBridge.settings.awaitSettingsSaved.mockImplementationOnce(() => preflight.promise);
    button('Send voice transcript').click();
    await vi.waitFor(() => expect(mockBridge.settings.awaitSettingsSaved).toHaveBeenCalled());
    button(action).click();
    preflight.resolve();
    await new Promise<void>(resolve => queueMicrotask(resolve));
    await new Promise<void>(resolve => queueMicrotask(resolve));
    expect(mockBridge.llm.llmStream).not.toHaveBeenCalled();
    expect(journalEvents).toHaveLength(0);
  });

  it('allows a new room to send while the cancelled prior preflight is still pending', async () => {
    desktopRuntime = true;
    currentWorld.rooms.push({ id: 'room-b', title: 'Other chat', participantIds: ['agent-a'], createdAt: 2 });
    currentWorld.threads.push({ id: 'thread-b', roomId: 'room-b', state: 'active', createdAt: 2 });
    const preflight = deferred<void>();
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    const input = () => container.querySelector<HTMLTextAreaElement>('.ca-chat-textarea')!;
    await vi.waitFor(() => expect(input().disabled).toBe(false));
    // Availability is established independently; this test owns the save
    // barrier, not a live OpenAI-compatible endpoint or model selection.
    testSettings.llmProvider = 'openai-compatible';
    mockBridge.settings.awaitSettingsSaved.mockClear();
    mockBridge.settings.awaitSettingsSaved.mockImplementationOnce(() => preflight.promise);
    const send = (text: string) => {
      input().value = text; input().dispatchEvent(new Event('input', { bubbles: true }));
      container.querySelector<HTMLButtonElement>('button[aria-label="mlearn.ConversationAgent.Send"]')!.click();
    };
    send('Old preflight');
    await vi.waitFor(() => expect(mockBridge.settings.awaitSettingsSaved).toHaveBeenCalledOnce());
    windowContextCallback({ roomId: 'room-b', threadId: 'thread-b' });
    await vi.waitFor(() => expect(mockBridge.journal.readThread).toHaveBeenCalledWith('room-b', 'thread-b'));
    await vi.waitFor(() => expect(container.querySelector('button[aria-label="mlearn.ConversationAgent.Send"]')).not.toBeNull());
    send('New room message');
    await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalledOnce());
    expect(journalEvents.filter(event => event.type === 'message.user').map(event => event.roomId)).toEqual(['room-b']);
    preflight.resolve();
    await new Promise<void>(resolve => queueMicrotask(resolve));
    expect(mockBridge.llm.llmStream).toHaveBeenCalledOnce();
    emitChunk({ content: 'New room response', done: true });
    await vi.waitFor(() => expect(chatText(container)).toContain('New room response'));
  });

  it('reads an earlier queued exit before checking the next user message', async () => {
    currentWorld.threads[0] = { ...currentWorld.threads[0], interactionMode: 'practice', intent: 'Correct every message until I stop.' };
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    const textarea = () => container.querySelector('.ca-chat-textarea') as HTMLTextAreaElement;
    const send = async (text: string) => {
      await vi.waitFor(() => expect(container.querySelector('button[aria-label="mlearn.ConversationAgent.Send"]')).not.toBeNull());
      textarea().value = text; textarea().dispatchEvent(new Event('input', { bubbles: true }));
      (container.querySelector('button[aria-label="mlearn.ConversationAgent.Send"]') as HTMLButtonElement).click();
    };
    await vi.waitFor(() => expect(textarea().disabled).toBe(false));
    await send('No corrections now.');
    await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalledOnce());
    emitChunk({ content: 'Okay.', done: true });
    await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalledTimes(2));
    const delayedStopChecker = streamCallback;
    await send('Yesterday I eat vanilla.');
    await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalledTimes(3));
    emitChunk({ content: 'I prefer chocolate.', done: true });
    await vi.waitFor(() => expect(journalEvents.filter(event => event.type === 'message.character')).toHaveLength(2));
    delayedStopChecker({ toolCalls: [{ id: 'stop', name: 'report_feedback_agreement', arguments: {
      active: false, scope: 'Social conversation', evidence: 'No corrections now.',
    } }], done: true });
    await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalledTimes(4));
    const envelope = JSON.parse(mockBridge.llm.llmStream.mock.calls[3][0][1].content);
    expect(envelope.feedbackAgreement).toEqual({ active: false, scope: 'Social conversation', evidence: 'No corrections now.' });
    emitChunk({ done: true });
  });

  it('persists ended feedback, reopens quietly, and supplies it to both character and checker', async () => {
    currentWorld.threads[0] = { ...currentWorld.threads[0], interactionMode: 'practice', intent: 'Correct every message until I stop.' };
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    const textarea = () => container.querySelector('.ca-chat-textarea') as HTMLTextAreaElement;
    await vi.waitFor(() => expect(textarea().disabled).toBe(false));
    textarea().value = 'No corrections now. Ice cream?'; textarea().dispatchEvent(new Event('input', { bubbles: true }));
    (container.querySelector('button[aria-label="mlearn.ConversationAgent.Send"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalledOnce());
    emitChunk({ content: 'Chocolate.', done: true });
    await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalledTimes(2));
    emitChunk({ toolCalls: [{ id: 'agreement', name: 'report_feedback_agreement', arguments: {
      active: false, scope: 'Social conversation', evidence: 'No corrections now.',
    } }], done: true });
    await vi.waitFor(() => expect(journalEvents.some(event => event.type === 'feedback.agreement')).toBe(true));
    dispose(); dispose = render(() => <ConversationContent />, container);
    await vi.waitFor(() => expect(chatText(container)).toContain('Chocolate.'));
    expect(container.querySelector('.chat-bubble.showing-analysis')).toBeNull();
    mockBridge.llm.llmStream.mockClear();
    textarea().value = 'Yesterday I eat vanilla.'; textarea().dispatchEvent(new Event('input', { bubbles: true }));
    (container.querySelector('button[aria-label="mlearn.ConversationAgent.Send"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalledOnce());
    expect(JSON.stringify(mockBridge.llm.llmStream.mock.calls[0][0])).toContain('Saved feedback agreement');
    emitChunk({ content: 'I prefer chocolate.', done: true });
    await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalledTimes(2));
    const envelope = JSON.parse(mockBridge.llm.llmStream.mock.calls[1][0][1].content);
    expect(envelope.initialPracticeIntent).toBe('Correct every message until I stop.');
    expect(envelope.feedbackAgreement).toEqual({ active: false, scope: 'Social conversation', evidence: 'No corrections now.' });
    emitChunk({ done: true });
  });

  it('keeps deliberate beats separate while streaming, saves each once, and restores them on reopening', async () => {
    testSettings.agentMistakeChecker = false;
    testSettings.agentSafetyChecker = false;
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    const textarea = container.querySelector('.ca-chat-textarea') as HTMLTextAreaElement;
    await vi.waitFor(() => expect(textarea.disabled).toBe(false));
    textarea.value = 'Who took lunch?'; textarea.dispatchEvent(new Event('input', { bubbles: true }));
    (container.querySelector('button[aria-label="mlearn.ConversationAgent.Send"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalled());
    emitChunk({ content: 'What?!\n<message-break/>\nWho was it?' });
    expect(container.querySelectorAll('.chat-bubble.assistant')).toHaveLength(2);
    expect(chatText(container)).not.toContain('<message-break/>');
    expect(container.querySelectorAll('.ca-message-continuation')).toHaveLength(1);
    emitChunk({ done: true });
    await vi.waitFor(() => expect(journalEvents.filter(event => event.type === 'message.character')).toHaveLength(2));
    expect(journalEvents.filter(event => event.type === 'message.character').map(event => (event.payload as { text: string }).text)).toEqual(['What?!', 'Who was it?']);
    await vi.waitFor(() => expect(container.querySelectorAll('.chat-bubble.assistant')).toHaveLength(2));
    dispose();
    dispose = render(() => <ConversationContent />, container);
    await vi.waitFor(() => expect(container.querySelectorAll('.chat-bubble.assistant')).toHaveLength(2));
    expect(chatText(container)).toContain('Who was it?');
    expect(container.querySelectorAll('.ca-message-continuation')).toHaveLength(1);
  });

  it('lets the user compose the next message during a reply without losing or prematurely sending the draft', async () => {
    testSettings.agentMistakeChecker = false;
    testSettings.agentSafetyChecker = false;
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    const textarea = container.querySelector('.ca-chat-textarea') as HTMLTextAreaElement;
    await vi.waitFor(() => expect(textarea.disabled).toBe(false));
    textarea.value = 'Hello'; textarea.dispatchEvent(new Event('input', { bubbles: true }));
    (container.querySelector('button[aria-label="mlearn.ConversationAgent.Send"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalled());
    expect(textarea.disabled).toBe(false);
    textarea.value = 'And another thing'; textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(mockBridge.llm.llmStream).toHaveBeenCalledOnce();
    emitChunk({ content: 'Hi there', done: true });
    await vi.waitFor(() => expect(container.querySelector('button[aria-label="mlearn.ConversationAgent.Send"]')).not.toBeNull());
    expect(textarea.value).toBe('And another thing');
    expect(journalEvents.filter(event => event.type === 'message.user')).toHaveLength(1);
  });

  it('stops a response under review without committing it later or losing the next draft', async () => {
    desktopRuntime = true;
    const review = deferred<TurnReviewResult>();
    mockBridge.world.reviewConversationTurn.mockImplementationOnce(() => review.promise);
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    const textarea = container.querySelector('.ca-chat-textarea') as HTMLTextAreaElement;
    await vi.waitFor(() => expect(textarea.disabled).toBe(false));
    textarea.value = 'Hello'; textarea.dispatchEvent(new Event('input', { bubbles: true }));
    (container.querySelector('button[aria-label="mlearn.ConversationAgent.Send"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalled());
    emitChunk({ content: 'A cancelled reply', done: true });
    await vi.waitFor(() => expect(mockBridge.world.reviewConversationTurn).toHaveBeenCalledOnce());
    textarea.value = 'My next thought'; textarea.dispatchEvent(new Event('input', { bubbles: true }));
    (container.querySelector('button[aria-label="mlearn.ConversationAgent.StopStreaming"]') as HTMLButtonElement).click();
    expect(mockBridge.world.cancelConversationReview).toHaveBeenCalledOnce();
    review.resolve({ status: 'approved', text: 'A cancelled reply', reason: 'none', restrictUserContext: false, reviewId: 'cancelled' });
    await new Promise<void>(resolve => queueMicrotask(resolve));
    await new Promise<void>(resolve => queueMicrotask(resolve));
    expect(journalEvents.filter(event => event.type === 'message.character')).toHaveLength(0);
    expect(chatText(container)).not.toContain('A cancelled reply');
    expect(textarea.value).toBe('My next thought');
  });

  it('opens persistent Room history and commits replies directly to Sea without creating a Thread', async () => {
    mockBridge.kvStore.kvGet.mockResolvedValue(null);
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    await vi.waitFor(() => expect(container.querySelector('textarea.ca-chat-textarea')).not.toBeNull());
    const textarea = container.querySelector('textarea.ca-chat-textarea') as HTMLTextAreaElement;
    await vi.waitFor(() => expect(textarea.disabled).toBe(false));
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
      await vi.waitFor(() => expect(textarea.disabled).toBe(false));
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
    await vi.waitFor(() => expect(textarea!.disabled).toBe(false));
    textarea!.value = 'hola';
    textarea!.dispatchEvent(new Event('input', { bubbles: true }));

    await vi.waitFor(() => expect(sendButton()?.disabled).toBe(false));
    sendButton()!.click();

    await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalledTimes(1));
    expect(chatText(container)).toContain('hola');
    const sentHistory = mockBridge.llm.llmStream.mock.calls[0][0];
    expect(sentHistory.filter((message: { role: string; content: string }) => message.role === 'user' && message.content === 'hola')).toHaveLength(1);

    emitChunk({ content: 'こんにちは' });
    await vi.waitFor(() => expect(chatText(container)).toContain('こんにちは'));

    emitChunk({ content: '、元気？' });
    expect(chatText(container)).toContain('こんにちは、元気？');

    emitChunk({ done: true });
    await vi.waitFor(() => expect(journalEvents.map((event) => event.type)).toEqual(['message.user', 'message.character']));
    expect(chatText(container)).toContain('こんにちは、元気？');
    await vi.waitFor(() => expect(container.querySelectorAll('.chat-token')).toHaveLength(2));
    expect(container.querySelector('.chat-bubble.error')).toBeNull();
  });

  it('dismisses word lookup while dragging to select message text', async () => {
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    await vi.waitFor(() => expect(container.querySelector('.ca-messages')).not.toBeNull());
    const messages = container.querySelector('.ca-messages')!;
    messages.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, buttons: 0 }));
    expect(mockForceHideHover).not.toHaveBeenCalled();
    messages.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1 }));
    messages.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, buttons: 1 }));
    expect(mockForceHideHover).toHaveBeenCalledTimes(2);
  });

  it('keeps model failures readable and offers settings beside the failed reply', async () => {
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    await vi.waitFor(() => expect(container.querySelector('textarea.ca-chat-textarea')).not.toBeNull());
    const textarea = container.querySelector('textarea.ca-chat-textarea') as HTMLTextAreaElement;
    await vi.waitFor(() => expect(textarea.disabled).toBe(false));
    textarea.value = 'hello';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    const send = container.querySelector('button[aria-label="mlearn.ConversationAgent.Send"]') as HTMLButtonElement;
    await vi.waitFor(() => expect(send.disabled).toBe(false));
    send.click();
    await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalled());
    emitChunk({ error: 'Cloud LLM error: 400 {"error":{"message":"example/model is not a valid model ID"},"user_id":"private-account"}' });
    await vi.waitFor(() => expect(container.querySelector('.chat-error-message')?.textContent).toBe('mlearn.ConversationAgent.Recovery.Model'));
    expect(container.textContent).not.toContain('private-account');
    const recovery = container.querySelector('.chat-error-retry') as HTMLButtonElement;
    expect(recovery?.textContent).toContain('mlearn.ConversationAgent.Banner.SettingsLink');
    recovery.click();
    expect(mockBridge.window.openWindow).toHaveBeenCalledWith({ type: 'settings' });
    expect(journalEvents.filter(event => event.type === 'message.user')).toHaveLength(1);
  });

  it('refreshes cloud authentication and waits for desktop persistence before sending', async () => {
    desktopRuntime = true;
    testSettings.llmProvider = 'cloud';
    const releaseSave = deferred<void>();
    mockBridge.settings.awaitSettingsSaved.mockReturnValueOnce(releaseSave.promise);
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    await vi.waitFor(() => expect(container.querySelector('textarea.ca-chat-textarea')).not.toBeNull());
    const textarea = container.querySelector('textarea.ca-chat-textarea') as HTMLTextAreaElement;
    await vi.waitFor(() => expect(textarea.disabled).toBe(false));
    textarea.value = 'hello';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    const send = container.querySelector('button[aria-label="mlearn.ConversationAgent.Send"]') as HTMLButtonElement;
    await vi.waitFor(() => expect(send.disabled).toBe(false));
    send.click();
    await vi.waitFor(() => expect(mockBridge.settings.awaitSettingsSaved).toHaveBeenCalledOnce());
    expect(mockBridge.llm.llmStream).not.toHaveBeenCalled();
    expect(journalEvents).toHaveLength(0);

    releaseSave.resolve();
    await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalledOnce());
    expect(mockCloudToken).toHaveBeenCalledWith({ interactive: true });
  });

  it('keeps AI memory notes in the disposable Thread without writing Sea', async () => {
    testSettings.agentMemoryEnabled = true;
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    await vi.waitFor(() => expect(container.querySelector('textarea.ca-chat-textarea')).not.toBeNull());
    const textarea = container.querySelector('textarea.ca-chat-textarea') as HTMLTextAreaElement;
    await vi.waitFor(() => expect(textarea.disabled).toBe(false));
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
    await vi.waitFor(() => expect(textarea.disabled).toBe(false));
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

  it('starts a distinct conversation for a media-only launch', async () => {
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    await vi.waitFor(() => expect(mockBridge.window.onWindowContext).toHaveBeenCalled());
    Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'mlearn.ConversationAgent.AgeVerification.ContinueButton')!.click();
    windowContextCallback({
      mediaHash: 'video-2', mediaName: 'Episode Two', mediaType: 'video',
      assessedLevel: null, assessedLevelName: 'N3', language: 'ja',
      failedWords: [], failedGrammar: [],
      wordLevelPercentages: { entries: [], totalUnique: 0, totalOccurrences: 0 },
      grammarLevelPercentages: { entries: [], totalUnique: 0, totalOccurrences: 0 },
    });
    await vi.waitFor(() => expect(container.querySelector('.new-conversation-form')).not.toBeNull());
    expect(mockBridge.world.updateThread).not.toHaveBeenCalled();
  });

  it('carries tutor purpose and selections into a newly created conversation', async () => {
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
    expect(container.querySelector('.new-conversation-form')).toBeNull();
    Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'mlearn.ConversationAgent.AgeVerification.ContinueButton')!.click();
    await vi.waitFor(() => expect(container.querySelector('.new-conversation-form textarea')).not.toBeNull());
    const intent = (container.querySelector('.new-conversation-form textarea') as HTMLTextAreaElement).value;
    expect(intent).toContain('Words selected for practice (not evidence of difficulty)');
    expect(mockBridge.llm.llmStream).not.toHaveBeenCalled();
    (container.querySelector('button[aria-label="mlearn.ConversationAgent.NewConversation.StartAria"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(mockBridge.world.prepareScenario).toHaveBeenCalled());
    await vi.waitFor(() => expect((container.querySelector('button[aria-label="mlearn.ConversationAgent.NewConversation.UseScenario"]') as HTMLButtonElement)?.disabled).toBe(false));
    (container.querySelector('button[aria-label="mlearn.ConversationAgent.NewConversation.UseScenario"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(container.querySelector('.new-conversation-form')).toBeNull());
    const textarea = container.querySelector('textarea.ca-chat-textarea') as HTMLTextAreaElement;
    await vi.waitFor(() => expect(textarea).toBeTruthy());
    await vi.waitFor(() => expect(textarea.disabled).toBe(false));
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
    await vi.waitFor(() => expect(textarea.disabled).toBe(false));
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
    expect(container.querySelector('.new-conversation-form')).toBeNull();
    Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'mlearn.ConversationAgent.AgeVerification.ContinueButton')!.click();
    await vi.waitFor(() => expect(container.querySelector('.new-conversation-form textarea')).not.toBeNull());
    const intent = (container.querySelector('.new-conversation-form textarea') as HTMLTextAreaElement).value;
    expect(intent).toContain('Words selected for practice (not evidence of difficulty)');
    expect(mockBridge.llm.llmStream).not.toHaveBeenCalled();
    (container.querySelector('button[aria-label="mlearn.ConversationAgent.NewConversation.StartAria"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(mockBridge.world.prepareScenario).toHaveBeenCalled());
    await vi.waitFor(() => expect((container.querySelector('button[aria-label="mlearn.ConversationAgent.NewConversation.UseScenario"]') as HTMLButtonElement)?.disabled).toBe(false));
    (container.querySelector('button[aria-label="mlearn.ConversationAgent.NewConversation.UseScenario"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(container.querySelector('.new-conversation-form')).toBeNull());
    const textarea = container.querySelector('textarea.ca-chat-textarea') as HTMLTextAreaElement;
    await vi.waitFor(() => expect(textarea).toBeTruthy());
    await vi.waitFor(() => expect(textarea.disabled).toBe(false));
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
    expect(container.textContent).toContain('mlearn.ConversationAgent.Contacts.NewMessage');
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

  it('renders New message in the room sidebar', async () => {
    currentWorld = { rooms: [], threads: [], participants: [] };
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    await vi.waitFor(() => expect(container.querySelector('button[aria-label="mlearn.ConversationAgent.History.ToggleSidebar"]')).not.toBeNull());
    (container.querySelector('button[aria-label="mlearn.ConversationAgent.History.ToggleSidebar"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(container.querySelector('.room-sidebar button[aria-label="mlearn.ConversationAgent.Contacts.NewMessage"]')).not.toBeNull());
    (Array.from(container.querySelectorAll('.room-sidebar button')).find(button => button.textContent === 'mlearn.ConversationAgent.Contacts.Practice') as HTMLButtonElement).click();
    expect(container.querySelector('.room-sidebar button[aria-label="mlearn.ConversationAgent.Contacts.NewPractice"]')).not.toBeNull();
    expect(Array.from(container.querySelectorAll('.ca-chat-content button')).some(button => button.textContent === 'mlearn.ConversationAgent.Contacts.NewPractice')).toBe(true);
  });

  it('defers Living World consent until an existing contact DM is explicitly opened', async () => {
    testSettings.livingWorldEnabled = false;
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    await vi.waitFor(() => expect(container.querySelector('button[aria-label="mlearn.ConversationAgent.History.ToggleSidebar"]')).not.toBeNull());
    Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'mlearn.ConversationAgent.AgeVerification.ContinueButton')?.click();
    expect(container.textContent).not.toContain('mlearn.ConversationAgent.LivingWorld.ConsentTitle');
    (container.querySelector('button[aria-label="mlearn.ConversationAgent.History.ToggleSidebar"]') as HTMLButtonElement).click();
    const contactsTab = Array.from(container.querySelectorAll('.room-sidebar button')).find(tab => tab.textContent === 'mlearn.ConversationAgent.Contacts.Tab') as HTMLButtonElement;
    contactsTab.click();
    await vi.waitFor(() => expect(Array.from(container.querySelectorAll('.room-sidebar-list button')).some(button => button.textContent?.includes('Tutor'))).toBe(true));
    (Array.from(container.querySelectorAll('.room-sidebar-list button')).find(button => button.textContent?.includes('Tutor')) as HTMLButtonElement).click();
    const message = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'mlearn.ConversationAgent.Contacts.Message');
    expect(message).toBeTruthy();
    message!.click();
    await vi.waitFor(() => expect(container.textContent).toContain('mlearn.ConversationAgent.LivingWorld.ConsentTitle'));
    expect(container.querySelector('.new-conversation-form')).toBeNull();
    expect(mockBridge.world.createPersistentRoom).not.toHaveBeenCalled();
  });

  it('exposes scenario creation separately from explicit practice', async () => {
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'mlearn.ConversationAgent.AgeVerification.ContinueButton')!.click();
    await vi.waitFor(() => expect(container.querySelector('[aria-label="mlearn.ConversationAgent.Menu.OverflowAria"]')).not.toBeNull());
    (container.querySelector('[aria-label="mlearn.ConversationAgent.Menu.OverflowAria"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent === 'mlearn.ConversationAgent.Contacts.NewScenario')).toBe(true));
    Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'mlearn.ConversationAgent.Contacts.NewScenario')!.click();
    await vi.waitFor(() => expect(container.querySelector('.new-conversation-scope')).not.toBeNull());
  });

  it('persists quiz feedback before continuing and restores it on remount', async () => {
    appendJournalEvent({ roomId: 'room-a', scope: { kind: 'thread', threadId: 'thread-a' }, type: 'message.character', actorId: 'agent-a', witnesses: ['user', 'agent-a'],
      payload: { text: 'One question', widgets: [{ type: 'quiz', data: { type: 'mcq', question: 'Choose', options: ['A', 'B'], correctAnswer: 'A' } }] } });
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    await vi.waitFor(() => expect(container.querySelector('.quiz-options button')).not.toBeNull());
    const answer = container.querySelector('.quiz-options button') as HTMLButtonElement;
    answer.click(); answer.click();
    await vi.waitFor(() => expect(journalEvents.filter(event => event.type === 'widget.response')).toHaveLength(1));
    expect(journalEvents.find(event => event.type === 'widget.response')).toMatchObject({ actorId: 'user', scope: { kind: 'thread', threadId: 'thread-a' },
      payload: { messageEventId: 'evt-1', widgetIndex: 0, userAnswer: 'A', isCorrect: true } });
    dispose();
    dispose = render(() => <ConversationContent />, container);
    await vi.waitFor(() => expect(container.querySelector('.quiz-result-correct')).not.toBeNull());
    expect(container.querySelectorAll('.quiz-options button')[1]).toHaveProperty('disabled', true);
  });

  it('restores a persisted draft after remount and saves edits in order', async () => {
    mockBridge.kvStore.kvGet.mockImplementation(async (...args: unknown[]) => args[0] === 'conversation-draft:room-a:thread-a'
      ? JSON.stringify({ text: 'Unsent thought' }) : JSON.stringify({ roomId: 'room-a', threadId: 'thread-a' }));
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    await vi.waitFor(() => expect((container.querySelector('.ca-chat-textarea') as HTMLTextAreaElement)?.value).toBe('Unsent thought'));
    const input = container.querySelector('.ca-chat-textarea') as HTMLTextAreaElement;
    input.value = 'Revised thought'; input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(mockBridge.kvStore.kvSet).toHaveBeenCalledWith('conversation-draft:room-a:thread-a', JSON.stringify({ text: 'Revised thought' })));
  });

  it('keeps drafts scoped to their conversation while browsing searchable history', async () => {
    currentWorld = {
      rooms: [
        { id: 'room-a', title: 'Tutor', participantIds: ['agent-a'], createdAt: 1 },
        { id: 'room-b', title: 'Tutor', participantIds: ['agent-b'], createdAt: 2 },
      ],
      threads: [
        { id: 'thread-a', roomId: 'room-a', title: 'Book practice', state: 'active', createdAt: 1 },
        { id: 'thread-b', roomId: 'room-b', title: 'Video practice', state: 'active', createdAt: 2 },
      ],
      participants: [
        { id: 'agent-a', displayName: 'Tutor', kind: 'persistent', personaText: '', setupComplete: true },
        { id: 'agent-b', displayName: 'Tutor', kind: 'persistent', personaText: '', setupComplete: true },
      ],
    };
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    await vi.waitFor(() => expect(mockBridge.window.onWindowContext).toHaveBeenCalled());
    windowContextCallback({ roomId: 'room-a', threadId: 'thread-a' });
    await vi.waitFor(() => expect(mockBridge.journal.readThread).toHaveBeenCalledWith('room-a', 'thread-a'));
    await vi.waitFor(() => expect((container.querySelector('textarea.ca-chat-textarea') as HTMLTextAreaElement)?.disabled).toBe(false));
    const input = container.querySelector('textarea.ca-chat-textarea') as HTMLTextAreaElement;
    input.value = 'draft for book';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    (container.querySelector('button[aria-label="mlearn.ConversationAgent.History.ToggleSidebar"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(container.querySelectorAll('.room-sidebar-room').length).toBe(2));
    expect(container.querySelector('.room-sidebar-list')?.textContent).toContain('Book practice');
    expect(container.querySelector('.room-sidebar-list')?.textContent).toContain('Video practice');
    (Array.from(container.querySelectorAll('.room-sidebar-room')).find(row => row.textContent?.includes('Video practice')) as HTMLButtonElement).click();
    await vi.waitFor(() => expect((container.querySelector('textarea.ca-chat-textarea') as HTMLTextAreaElement).value).toBe(''));
    // The desktop navigation remains mounted; the shared drawer handles narrow layouts.
    expect(container.querySelector('.room-sidebar-search input')).not.toBeNull();
    (container.querySelector('button[aria-label="mlearn.ConversationAgent.History.ToggleSidebar"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(container.querySelector('.room-sidebar-search input')).not.toBeNull());
    const search = container.querySelector('.room-sidebar-search input') as HTMLInputElement;
    search.value = 'Book practice';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(container.querySelectorAll('.room-sidebar-room').length).toBe(1);
    (container.querySelector('.room-sidebar-room') as HTMLButtonElement).click();
    await vi.waitFor(() => expect((container.querySelector('textarea.ca-chat-textarea') as HTMLTextAreaElement).value).toBe('draft for book'));
  });

  it('opens the NewConversationModal from the room sidebar', async () => {
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'mlearn.ConversationAgent.AgeVerification.ContinueButton')!.click();
    await vi.waitFor(() => expect(container.querySelector('button[aria-label="mlearn.ConversationAgent.History.ToggleSidebar"]')).not.toBeNull());
    (container.querySelector('button[aria-label="mlearn.ConversationAgent.History.ToggleSidebar"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(container.querySelector('.room-sidebar button[aria-label="mlearn.ConversationAgent.Contacts.NewMessage"]')).not.toBeNull());
    (container.querySelector('.room-sidebar button[aria-label="mlearn.ConversationAgent.Contacts.NewMessage"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(container.querySelector('.new-conversation-form')).not.toBeNull());
  });

  it('leaves the empty messenger available after introduction instead of forcing a setup form', async () => {
    currentWorld = { rooms: [], threads: [], participants: [] };
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    await vi.waitFor(() => expect(mockBridge.world.getWorldState).toHaveBeenCalled());
    expect(container.querySelector('.new-conversation-form')).toBeNull();
    Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'mlearn.ConversationAgent.AgeVerification.ContinueButton')!.click();
    expect(container.querySelector('.new-conversation-form')).toBeNull();
    expect(container.textContent).toContain('mlearn.ConversationAgent.Contacts.Add');
  });

  it('opens NewConversationModal from the empty state when no room is selected', async () => {
    currentWorld = {
      rooms: [],
      threads: [],
      participants: [{ id: 'agent-a', displayName: 'Tutor', kind: 'persistent', personaText: 'Helpful tutor', setupComplete: true }],
    };
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'mlearn.ConversationAgent.AgeVerification.ContinueButton')!.click();

    await vi.waitFor(() => expect(Array.from(container.querySelectorAll('button')).some((button) => button.textContent === 'mlearn.ConversationAgent.Contacts.NewMessage')).toBe(true));
    Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'mlearn.ConversationAgent.Contacts.NewMessage')!.click();
    await vi.waitFor(() => expect(container.querySelector('.new-conversation-form')).not.toBeNull());
  });

  it('preserves the backend error after a failed call unmounts its voice overlay', async () => {
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    const button = () => container.querySelector('button[aria-label="mlearn.ConversationAgent.Call.StartAria"]') as HTMLButtonElement;
    await vi.waitFor(() => expect(button()?.disabled).toBe(false));
    button().click();
    await vi.waitFor(() => expect(container.querySelector('[data-testid="voice-tab"]')).not.toBeNull());
    Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Simulate voice failure')!.click();
    expect(container.querySelector('[data-testid="voice-tab"]')).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain('No module named kokoro');
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

  it('prioritizes call identity and state and moves provider details into the menu', async () => {
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    const callButton = () => container.querySelector<HTMLButtonElement>('button[aria-label="mlearn.ConversationAgent.Call.StartAria"]');
    await vi.waitFor(() => expect(callButton()?.disabled).toBe(false));
    callButton()!.click();
    Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Simulate listening')!.click();
    const header = container.querySelector('.ca-header')!;
    expect(header.querySelector('.ca-header-title')?.textContent).toBe('Tutor');
    expect(header.querySelector('[role="status"]')?.textContent).toBe('Listening…');
    expect(header.querySelector('.ca-connection-info')).toBeNull();
    expect(callButton()).toBeNull();
    (header.querySelector('button[aria-label="mlearn.ConversationAgent.Menu.OverflowAria"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector('.ca-overflow-menu .ca-connection-info')).not.toBeNull());
  });

  it('cancels a call response without opening new-conversation setup', async () => {
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    const callButton = () => container.querySelector<HTMLButtonElement>('button[aria-label="mlearn.ConversationAgent.Call.StartAria"]');
    await vi.waitFor(() => expect(callButton()?.disabled).toBe(false));
    callButton()!.click();
    Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Abort call response')!.click();
    expect(container.querySelector('.new-conversation-form')).toBeNull();
  });

  it('dismisses the call summary without transiently remounting an auto-start call', async () => {
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);
    const callButton = () => container.querySelector<HTMLButtonElement>('button[aria-label="mlearn.ConversationAgent.Call.StartAria"]');
    await vi.waitFor(() => expect(callButton()?.disabled).toBe(false));
    callButton()!.click();
    expect(voiceTabMounts).toBe(1);
    Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Complete call')!.click();
    const dismiss = container.querySelector<HTMLButtonElement>('button[aria-label="mlearn.ConversationAgent.Voice.Aftermath.Title"]');
    expect(dismiss).not.toBeNull();
    dismiss!.click();
    expect(voiceTabMounts).toBe(1);
    expect(container.querySelector('.ca-voice-overlay')).toBeNull();
  });
});
