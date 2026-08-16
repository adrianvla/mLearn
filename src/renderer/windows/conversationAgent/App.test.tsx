// @vitest-environment happy-dom

/**
 * Characterization (parity) test — conversational-runtime overhaul, Phase 1 QA gate
 * (see .sisyphus/plans/conversational-runtime-overhaul.md, gate 3).
 *
 * Locks TODAY's golden path for the conversationAgent window so later phases cannot
 * silently regress it:
 *
 *   send → streamed chunks render incrementally → create_quiz tool round-trip
 *   executes (widget renders + follow-up inference fires) → the checker agent fires
 *   its own second LLM stream (assistant safety scan, then user mistake check) and
 *   applies a correction to the user message.
 *
 * It asserts what the code does TODAY — if an assertion fails on current code the
 * test is wrong, not the production code.
 *
 * Mock scope:
 * - `shared/bridges` + `shared/backends` are mocked (the bridge boundary). The LLM
 *   stream is driven by capturing the callback passed to `bridge.llm.onLLMStreamChunk`
 *   and emitting `LLMStreamChunk`s into it (same technique as
 *   services/conversationAgent.test.ts).
 * - `../../context` and `../../hooks` are stubbed per the repo's window-test
 *   convention (wordDefinition/App.test.tsx, ChatBubble.test.tsx, LevelStudyTab.test.tsx):
 *   the provider/hook layer is infrastructure with its own test files. ALL chat-runtime
 *   code under test is real: ConversationContent's send/stream/tool/checker
 *   orchestration, conversationAgent, checkerAgent, ChatBubble, messageState.
 * - UI primitives (`components/common`, `components` barrel) are replaced with plain
 *   DOM equivalents so behavior (text, clicks, disabled state) is asserted instead of
 *   markup snapshots.
 *
 * Out of scope (not exercised, not stubbed-to-force): voice panel, word hover,
 * agent-setup wizard internals, cloud provider flows. Voice requires real STT/TTS
 * plumbing that is not feasible in happy-dom.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import { DEFAULT_SETTINGS } from '../../../shared/types';
import type { LLMStreamChunk } from '../../../shared/types';

// ============================================================================
// Bridge mock (the bridge boundary — everything else under test is real)
// ============================================================================

let streamCallback: (chunk: LLMStreamChunk) => void = () => {};

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
    onWindowContext: vi.fn(() => () => {}),
    getWindowContext: vi.fn(),
    openWindow: vi.fn(),
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
    kvGet: vi.fn(async () => null),
    kvSet: vi.fn(async () => {}),
    kvRemove: vi.fn(async () => {}),
    kvGetAll: vi.fn(async () => ({})),
    kvSetBatch: vi.fn(async () => {}),
  },
};

vi.mock('../../../shared/bridges', () => ({ getBridge: () => mockBridge }));

const mockBackend = {
  tokenize: vi.fn(async () => []),
};

vi.mock('../../../shared/backends', () => ({
  getBackend: () => mockBackend,
  resolveCloudApiUrl: () => 'http://localhost:7752',
}));

// ============================================================================
// Provider / hook stubs (repo window-test convention — infrastructure only)
// ============================================================================

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
    locale: () => 'en',
  }),
  useLanguage: () => ({
    currentLangData: () => null,
    isTokenTranslatable: () => false,
    getLanguageFeatures: () => ({ supportsFrequencyLevels: false, tokenizerCapabilities: {} }),
    getFrequency: () => null,
    getFreqLevelNames: () => ({}),
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
    getWordKnowledge: () => undefined,
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
  useDictionary: () => ({
    lookup: async () => [],
  }),
}));

// ============================================================================
// UI primitive mocks — plain DOM so behavior is asserted, not markup
// ============================================================================

vi.mock('../../components/common', () => ({
  Btn: (props: { children?: JSX.Element; onClick?: () => void; disabled?: boolean; variant?: string; size?: string }) => (
    <button type="button" disabled={props.disabled} onClick={props.onClick}>{props.children}</button>
  ),
  IconBtn: (props: { children?: JSX.Element; onClick?: () => void; disabled?: boolean; 'aria-label'?: string }) => (
    <button type="button" aria-label={props['aria-label']} disabled={props.disabled} onClick={props.onClick}>{props.children}</button>
  ),
  Modal: (props: { children?: JSX.Element; footer?: JSX.Element; title?: JSX.Element | string }) => (
    <div>{props.title}{props.children}{props.footer}</div>
  ),
  ModalForm: (props: { children?: JSX.Element; footer?: JSX.Element }) => (
    <div>{props.children}{props.footer}</div>
  ),
  Input: (props: { value?: string; onInput?: (e: InputEvent) => void; type?: string }) => (
    <input type={props.type ?? 'text'} value={props.value} onInput={(e) => props.onInput?.(e)} />
  ),
  HintText: (props: { children?: JSX.Element }) => <span>{props.children}</span>,
  FormField: (props: { children?: JSX.Element }) => <div>{props.children}</div>,
  VoiceSamplePicker: () => <span />,
  FloatingStatus: () => <span />,
  TabContainer: () => <div />,
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
    testSettings = { ...DEFAULT_SETTINGS };
  });

  afterEach(() => {
    dispose?.();
    container.remove();
  });

  it('send → streamed chunks render → create_quiz tool round-trip → checker fires', async () => {
    const { ConversationContent } = await import('./App');
    dispose = render(() => <ConversationContent />, container);

    // Wait for the composer to render, then type and wait for it to become enabled
    // (enabled only once the LLM availability check passed and there is text).
    const sendButton = () =>
      container.querySelector('button[aria-label="mlearn.ConversationAgent.Send"]') as HTMLButtonElement | null;
    await vi.waitFor(() => expect(sendButton()).not.toBeNull());

    // --- (a) send flow: type into the composer, submit → the user's message appears
    const textarea = container.querySelector('textarea.ca-chat-textarea') as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();
    textarea!.value = 'hola';
    textarea!.dispatchEvent(new Event('input', { bubbles: true }));

    await vi.waitFor(() => expect(sendButton()?.disabled).toBe(false));
    sendButton()!.click();

    await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalledTimes(1));
    expect(chatText(container)).toContain('hola');

    // --- (b) streaming: emitted chunks render incrementally in the assistant bubble
    emitChunk({ content: 'こんにちは' });
    expect(chatText(container)).toContain('こんにちは');

    emitChunk({ content: '、元気？' });
    expect(chatText(container)).toContain('こんにちは、元気？');

    // --- (c) tool-call loop: create_quiz widget renders, then a follow-up inference fires
    emitChunk({
      done: true,
      toolCalls: [
        {
          id: 'quiz-1',
          name: 'create_quiz',
          arguments: {
            quiz_type: 'mcq',
            question: 'What does 猫 mean?',
            options: ['cat', 'dog'],
            correct_answer: 'cat',
          },
        },
      ],
    });

    await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalledTimes(2));
    expect(chatText(container)).toContain('What does 猫 mean?');

    // The follow-up stream appends its text to the already-visible assistant content.
    emitChunk({ content: '良い答えです！' });
    expect(chatText(container)).toContain('良い答えです！');

    // Complete the follow-up stream; this triggers the checker agent path.
    emitChunk({ done: true });

    // First checker inference: assistant safety scan (agentSafetyChecker is on).
    await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalledTimes(3));
    const assistantScanCall = mockBridge.llm.llmStream.mock.calls[2];
    const assistantScanTools = assistantScanCall[1] as Array<{ name: string }>;
    expect(assistantScanTools.map((t) => t.name)).toContain('flag_self_harm_risk');

    emitChunk({ done: true, toolCalls: [{ id: 'safe-1', name: 'mark_safe', arguments: {} }] });

    // Second checker inference: user mistake check with corrections enabled.
    await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalledTimes(4));
    const checkerCall = mockBridge.llm.llmStream.mock.calls[3];
    const checkerMessages = checkerCall[0] as Array<{ role: string; content: string }>;
    const checkerTools = checkerCall[1] as Array<{ name: string }>;
    const checkerSystem = checkerMessages.find((m) => m.role === 'system');
    expect(checkerSystem?.content).toContain('language review assistant');
    expect(checkerTools.map((t) => t.name)).toEqual(
      expect.arrayContaining(['suggest_corrections']),
    );

    // (d) the checker's result is applied: correction lands on the user message
    emitChunk({
      done: true,
      toolCalls: [
        {
          id: 'corr-1',
          name: 'suggest_corrections',
          arguments: {
            corrections: [
              { error_span: 'hola', correction: 'hola, 元気？', error_type: 'unnatural' },
            ],
          },
        },
      ],
    });

    await vi.waitFor(() => expect(chatText(container)).toContain('hola, 元気？'));
  });
});
