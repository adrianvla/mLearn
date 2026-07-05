// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
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
  useLanguage: () => ({
    currentLangData: () => mockLanguageData,
    isTranslatable: (partOfSpeech: string) => partOfSpeech === 'noun',
    isTokenTranslatable: (token: Token) => (token.partOfSpeech ?? token.type) === 'noun',
  }),
  useLocalization: () => ({
    t: (key: string, params?: Record<string, string>) => params?.key ? `${key}:${params.key}` : key,
    locale: () => 'en',
  }),
}));

vi.mock('../../utils/timeFormatting', () => ({
  formatClockTime: () => '12:00',
}));

vi.mock('../../components', () => ({
  Btn: (props: Record<string, unknown>) => (
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

  async function renderChatBubble(triggerMode: WordHoverTriggerMode, callbacks?: {
    onTokenHover?: (token: Token, rect: DOMRect, el: HTMLElement) => void;
    onTokenLeave?: () => void;
  }) {
    const { ChatBubble } = await import('./ChatBubble');
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
    const { ChatBubble } = await import('./ChatBubble');
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
    const { ChatBubble } = await import('./ChatBubble');
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

  it('renders an assistant safety notice without the user help text', async () => {
    const { ChatBubble } = await import('./ChatBubble');
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
