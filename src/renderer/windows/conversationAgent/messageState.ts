import type { ConversationMessage } from '../../../shared/types';

export function getLatestAssistantMessageIndex(messages: ConversationMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'assistant') {
      return index;
    }
  }

  return -1;
}

export function isStreamingAssistantBubble(
  message: ConversationMessage | undefined,
  index: number,
  isStreaming: boolean,
  streamingMessageIndex: number | null,
): boolean {
  return !!message
    && message.role === 'assistant'
    && isStreaming
    && streamingMessageIndex === index;
}

export function shouldHideAssistantBubble(
  messages: ConversationMessage[],
  index: number,
  isStreaming: boolean,
  streamingMessageIndex: number | null,
): boolean {
  const message = messages[index];
  if (!message || message.role !== 'assistant') {
    return false;
  }

  if (message.content.trim()) {
    return false;
  }

  const hasWidgets = (message.widgets && message.widgets.length > 0) || !!message.widget;
  const isCurrentlyStreaming = isStreamingAssistantBubble(message, index, isStreaming, streamingMessageIndex);

  if (hasWidgets && isCurrentlyStreaming) {
    return true;
  }

  if (hasWidgets) {
    return false;
  }

  return !isCurrentlyStreaming;
}

export function canRegenerateAssistantMessage(
  messages: ConversationMessage[],
  index: number,
  isStreaming: boolean,
): boolean {
  if (isStreaming || messages[index]?.role !== 'assistant') {
    return false;
  }

  return index === getLatestAssistantMessageIndex(messages);
}