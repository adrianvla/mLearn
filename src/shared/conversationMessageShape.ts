/** Model-selected messenger boundaries. Paragraphs are never implicit messages. */
export const MESSAGE_BREAK = '<message-break/>';

export function splitConversationMessages(text: string): string[] {
  const messages: string[] = [];
  let current: string[] = [];
  let fence: string | undefined;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    const marker = /^(?:`{3,}|~{3,})/.exec(trimmed);
    if (marker) {
      const kind = trimmed[0];
      fence = fence === kind ? undefined : fence ?? kind;
    }
    if (!fence && trimmed === MESSAGE_BREAK) {
      const message = current.join('\n').trim();
      if (message) messages.push(message);
      current = [];
    } else current.push(line);
  }
  const last = current.join('\n').trim();
  if (last) messages.push(last);
  return messages;
}

/** Keep protocol syntax out of the streaming view, including partial markers. */
export function conversationStreamMessages(text: string): string[] {
  const lastLine = text.slice(text.lastIndexOf('\n') + 1).trimStart();
  if (lastLine && MESSAGE_BREAK.startsWith(lastLine) && lastLine !== MESSAGE_BREAK) {
    text = text.slice(0, text.lastIndexOf('\n') + 1);
  }
  return splitConversationMessages(text);
}

export function conversationStreamText(text: string): string {
  return conversationStreamMessages(text).join('\n\n');
}
