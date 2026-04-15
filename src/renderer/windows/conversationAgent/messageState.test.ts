import { describe, expect, it } from 'vitest';
import type { ConversationMessage } from '../../../shared/types';
import {
  canRegenerateAssistantMessage,
  getLatestAssistantMessageIndex,
  isStreamingAssistantBubble,
  shouldHideAssistantBubble,
} from './messageState';

function makeMessage(role: ConversationMessage['role'], content: string): ConversationMessage {
  return {
    role,
    content,
    timestamp: 0,
  };
}

describe('conversationAgent messageState', () => {
  it('finds the latest assistant message index', () => {
    const messages: ConversationMessage[] = [
      makeMessage('assistant', 'first'),
      makeMessage('user', 'reply'),
      makeMessage('assistant', 'second'),
    ];

    expect(getLatestAssistantMessageIndex(messages)).toBe(2);
  });

  it('does not hide the currently streaming assistant bubble even when it is empty', () => {
    const messages: ConversationMessage[] = [
      makeMessage('user', 'hello'),
      makeMessage('assistant', ''),
    ];

    expect(shouldHideAssistantBubble(messages, 1, true, 1)).toBe(false);
    expect(isStreamingAssistantBubble(messages[1], 1, true, 1)).toBe(true);
  });

  it('hides empty assistant bubbles that are not the active streaming target', () => {
    const messages: ConversationMessage[] = [
      makeMessage('assistant', ''),
      makeMessage('user', 'hello'),
      makeMessage('assistant', 'visible'),
    ];

    expect(shouldHideAssistantBubble(messages, 0, false, null)).toBe(true);
  });

  it('keeps quiz-only assistant bubbles visible even when they have no text', () => {
    const messages: ConversationMessage[] = [
      makeMessage('user', 'hello'),
      {
        ...makeMessage('assistant', ''),
        widget: {
          type: 'quiz',
          data: {
            type: 'mcq',
            question: 'Pick one',
            options: ['a', 'b'],
            correctAnswer: 'a',
          },
        },
      },
    ];

    expect(shouldHideAssistantBubble(messages, 1, false, null)).toBe(false);
  });

  it('allows regenerate only for the latest assistant message when idle', () => {
    const messages: ConversationMessage[] = [
      makeMessage('assistant', 'older'),
      makeMessage('user', 'reply'),
      makeMessage('assistant', 'latest'),
    ];

    expect(canRegenerateAssistantMessage(messages, 0, false)).toBe(false);
    expect(canRegenerateAssistantMessage(messages, 2, false)).toBe(true);
    expect(canRegenerateAssistantMessage(messages, 2, true)).toBe(false);
  });
});