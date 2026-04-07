// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { ConversationMessage, Token } from '../../../shared/types';
import type { WordHoverTriggerMode } from '../../../shared/constants';

type MockSettings = {
  readerWordHoverTrigger?: WordHoverTriggerMode;
  readerWordHoverKey?: string;
  do_colour_codes?: boolean;
  colour_codes?: Record<string, string>;
};

let mockSettings: MockSettings;

vi.mock('../../context', () => ({
  useSettings: () => ({
    settings: mockSettings,
  }),
  useLanguage: () => ({
    currentLangData: () => null,
    isTranslatable: (partOfSpeech: string) => partOfSpeech === 'noun',
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
});