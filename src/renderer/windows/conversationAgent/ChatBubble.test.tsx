// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { ChatBubble } from './ChatBubble';
import type { ConversationMessage, LanguageData, Token } from '../../../shared/types';
import type { WordHoverTriggerMode } from '../../../shared/constants';

type MockSettings = {
  readerWordHoverTrigger?: WordHoverTriggerMode;
  readerWordHoverKey?: string;
  do_colour_codes?: boolean;
  colour_codes?: Record<string, string>;
};

let mockSettings: MockSettings;
let mockLanguageData: LanguageData | null;

vi.mock('../../context', () => ({
  useSettings: () => ({
    settings: mockSettings,
  }),
  useFlashcards: () => ({ getAccessStatus: () => ({ status: 'unknown' }), isKnowledgeReady: () => true }),
  useLanguage: () => ({
    getLanguageFeatures: () => ({ tokenizerCapabilities: {} }),
    getFrequency: () => null,
    getFreqLevelNames: () => ({}),
    currentLangData: () => mockLanguageData,
    isTranslatable: (partOfSpeech: string) => partOfSpeech === 'noun',
    isTokenTranslatable: (token: Token) => (token.partOfSpeech ?? token.type) === 'noun',
  }),
  useLocalization: () => ({
    t: (key: string, params?: Record<string, string>) => {
      if (params?.key) return `${key}:${params.key}`;
      if (params?.text) return `${key}:${params.text}`;
      return key;
    },
    locale: () => 'en',
  }),
}));

vi.mock('../../utils/timeFormatting', () => ({
  formatClockTime: () => '12:00',
}));

vi.mock('../../components', () => ({
  Button: (props: Record<string, unknown>) => (
    <button type="button" onClick={props.onClick as ((event: MouseEvent) => void) | undefined}>
      {props.children as any}
    </button>
  ),
  Input: (props: Record<string, unknown>) => (
    <input
      value={props.value as string | undefined}
      onInput={props.onInput as ((event: InputEvent) => void) | undefined}
    />
  ),
  Spinner: () => <span>spinner</span>,
  IconBtn: (props: Record<string, unknown>) => (
    <button
      type="button"
      aria-label={(props['aria-label'] as string | undefined) ?? (props.ariaLabel as string | undefined)}
      onClick={props.onClick as ((event: MouseEvent) => void) | undefined}
    >
      {props.children as any}
    </button>
  ),
  RefreshIcon: () => <span>refresh</span>,
  CheckIcon: () => <span>check</span>,
  CrossIcon: () => <span>cross</span>,
  ScissorsIcon: () => <span>scissors</span>,
  SafeHtml: (props: Record<string, unknown>) => (
    <span innerHTML={(props.html as string) ?? ''} />
  ),
}));

vi.mock('./MarkdownRenderer', () => ({
  MarkdownRenderer: (props: { content: string }) => <span>{props.content}</span>,
  parseMarkdownToHtml: (content: string) => content,
}));

describe('ChatBubble hover triggers', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    mockSettings = {
      readerWordHoverTrigger: 'hover',
      readerWordHoverKey: 'shift',
      do_colour_codes: false,
    };
    mockLanguageData = null;
  });

  afterEach(() => {
    vi.useRealTimers();
    container.remove();
  });

  it('preserves authored whitespace and untokenized text in ordinary user messages', async () => {
    const dispose = render(() => <ChatBubble message={{ role: 'user', timestamp: 0,
      content: 'hola  mundo\n! ', tokens: [{ word: 'hola', actual_word: 'hola', type: 'noun' }, { word: 'mundo', actual_word: 'mundo', type: 'noun' }] }} />, container);
    expect(container.querySelector('.chat-bubble-content')?.textContent).toBe('hola  mundo\n! ');
    dispose();
  }, 15000);

  it('distinguishes estimated playback from preserved generation and keeps visual activities available', async () => {
    const dispose = render(() => <ChatBubble message={{ role: 'assistant', timestamp: 0,
      content: 'Played phrase. Sec', generatedContent: 'Played phrase. Second phrase.',
      voiceDelivery: { state: 'interrupted', basis: 'playback-estimate' },
      widgets: [{ type: 'quiz', data: { question: 'Visual question', correctAnswer: 'A' } }] }} />, container);
    expect(container.textContent).toContain('mlearn.ConversationAgent.Voice.Delivery.interrupted');
    expect(container.textContent).toContain('mlearn.ConversationAgent.Voice.Delivery.Estimated');
    const details = container.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')?.textContent).toBe('mlearn.ConversationAgent.Voice.Delivery.Generated');
    expect(details.textContent).toContain('Played phrase. Second phrase.');
    expect(container.querySelector('.chat-widget')?.textContent).toContain('Visual question');
    expect(container.querySelector('.chat-widget')?.textContent).toContain('mlearn.ConversationAgent.Voice.VisualActivity');
    dispose();
  });

  async function renderChatBubble(triggerMode: WordHoverTriggerMode, callbacks?: {
    onTokenHover?: (token: Token, rect: DOMRect, el: HTMLElement) => void;
    onTokenLeave?: () => void;
  }) {
    const token: Token = {
      word: 'hola',
      actual_word: 'hola',
      type: 'noun',
      partOfSpeech: 'noun',
    };
    const message: ConversationMessage = {
      role: 'user',
      content: 'hola',
      tokens: [token],
      timestamp: 0,
    };

    const dispose = render(() => (
      <ChatBubble
        message={message}
        triggerMode={triggerMode}
        triggerKey="shift"
        onTokenHover={callbacks?.onTokenHover}
        onTokenLeave={callbacks?.onTokenLeave}
      />
    ), container);

    const tokenElement = container.querySelector('.chat-token') as HTMLSpanElement | null;
    expect(tokenElement).not.toBeNull();

    return {
      dispose,
      tokenElement: tokenElement!,
    };
  }

  it('keeps coached conversation readable with corrections visible and analysis available on demand', () => {
    const dispose = render(() => <ChatBubble studyMode message={{ role: 'user', content: 'hola', timestamp: 0,
      tokens: [{ word: 'hola', actual_word: 'hola', type: 'noun', partOfSpeech: 'noun' }],
      corrections: [{ userMessageIndex: 0, errorSpan: 'hola', correction: 'Hola', errorType: 'typo' }] }} />, container);
    expect(container.querySelector('.chat-bubble')?.classList.contains('quiet-text')).toBe(true);
    expect(container.querySelector('.chat-correction-replacement')?.textContent).toBe('Hola');
    const inspect = container.querySelector('.chat-bubble-inspect') as HTMLButtonElement;
    expect(inspect).not.toBeNull(); inspect.click();
    expect(container.querySelector('.chat-bubble')?.classList.contains('showing-analysis')).toBe(true);
    expect(inspect.getAttribute('aria-pressed')).toBe('true');
    inspect.click();
    expect(container.querySelector('.chat-bubble')?.classList.contains('quiet-text')).toBe(true);
    expect(container.querySelector('.chat-correction-replacement')?.textContent).toBe('Hola');
    dispose();
  });

  it('shows the journal speaker for a participant message without hover', async () => {
    const message = { role: 'assistant' as const, content: 'Hello', timestamp: 0, displayName: 'Kai' };
    const dispose = render(() => <ChatBubble message={message} />, container);
    expect(container.querySelector('.chat-bubble-speaker')?.textContent).toBe('Kai');
    dispose();
  });

  it('waits for long-hover and does not expose a native title tooltip', async () => {
    vi.useFakeTimers();
    const onTokenHover = vi.fn();
    mockSettings.readerWordHoverTrigger = 'long-hover';

    const { dispose, tokenElement } = await renderChatBubble('long-hover', { onTokenHover });

    expect(tokenElement.getAttribute('title')).toBeNull();

    tokenElement.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(onTokenHover).not.toHaveBeenCalled();

    vi.advanceTimersByTime(499);
    expect(onTokenHover).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onTokenHover).toHaveBeenCalledOnce();

    dispose();
  });

  it('requires the configured key and hides when that modifier is released', async () => {
    const onTokenHover = vi.fn();
    const onTokenLeave = vi.fn();
    mockSettings.readerWordHoverTrigger = 'key-hover';
    mockSettings.readerWordHoverKey = 'shift';

    const { dispose, tokenElement } = await renderChatBubble('key-hover', {
      onTokenHover,
      onTokenLeave,
    });

    expect(tokenElement.getAttribute('title')).toBeNull();

    tokenElement.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(onTokenHover).not.toHaveBeenCalled();

    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Shift',
      shiftKey: true,
      bubbles: true,
    }));
    expect(onTokenHover).toHaveBeenCalledOnce();

    window.dispatchEvent(new KeyboardEvent('keyup', {
      key: 'Shift',
      bubbles: true,
    }));
    expect(onTokenLeave).toHaveBeenCalledOnce();

    dispose();
  });

  it('renders an urgent user safety notice with help text', async () => {
    const message: ConversationMessage = {
      role: 'user',
      content: 'I want to hurt myself',
      timestamp: 0,
      safety: {
        category: 'self-harm',
        severity: 'urgent',
        flaggedSpan: 'hurt myself',
        source: 'checker',
      },
    };

    const dispose = render(() => (
      <ChatBubble message={message} triggerMode="hover" triggerKey="shift" />
    ), container);

    expect(container.textContent).toContain('mlearn.ConversationAgent.Safety.UrgentNotice');
    expect(container.textContent).toContain('mlearn.ConversationAgent.Safety.GetHelp');

    dispose();
  });

  it('renders tokenized user text with the current language token separator', async () => {
    mockLanguageData = {
      name: 'Latin Language',
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Latn'] },
        lexemeNormalization: {
          type: 'identity',
        },
      },
    };
    const message: ConversationMessage = {
      role: 'user',
      content: 'hello world',
      tokens: [
        { word: 'hello', actual_word: 'hello', type: 'noun', partOfSpeech: 'noun' },
        { word: 'world', actual_word: 'world', type: 'noun', partOfSpeech: 'noun' },
      ],
      timestamp: 0,
    };

    const dispose = render(() => (
      <ChatBubble message={message} triggerMode="hover" triggerKey="shift" />
    ), container);

    expect(container.textContent).toContain('hello world');

    dispose();
  });

  it('renders the unspoken interruption point when an assistant message is interrupted', async () => {
    const message: ConversationMessage = {
      role: 'assistant',
      content: 'Spoken prefix',
      timestamp: 0,
      interrupted: true,
      interruptedAt: 'remaining suffix',
    };

    const dispose = render(() => (
      <ChatBubble message={message} triggerMode="hover" triggerKey="shift" />
    ), container);

    expect(container.textContent).toContain('Spoken prefix');
    expect(container.textContent).toContain('mlearn.ConversationAgent.Voice.Interrupted');
    expect(container.textContent).toContain('mlearn.ConversationAgent.Voice.InterruptedBefore:remaining suffix');

    dispose();
  });

  it('renders an assistant safety notice without the user help text', async () => {
    const message: ConversationMessage = {
      role: 'assistant',
      content: 'I need to respond carefully here.',
      timestamp: 0,
      safety: {
        category: 'self-harm-related',
        severity: 'concern',
        source: 'checker',
      },
    };

    const dispose = render(() => (
      <ChatBubble message={message} triggerMode="hover" triggerKey="shift" />
    ), container);

    expect(container.textContent).toContain('mlearn.ConversationAgent.Safety.AssistantFiltered');
    expect(container.textContent).not.toContain('mlearn.ConversationAgent.Safety.GetHelp');

    dispose();
  });
});
