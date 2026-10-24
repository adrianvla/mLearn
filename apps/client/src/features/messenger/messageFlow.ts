import type { AnalyzedToken, ConversationMessage, SourceAnchor } from '@mlearn/contracts';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

/** Source selections use original message UTF-8 offsets, not display positions. */
export function messageAnchor(message: ConversationMessage, packageId: string, packageVersion: string,
  token: Pick<AnalyzedToken, 'start' | 'end'>): SourceAnchor {
  const bytes = encoder.encode(message.text);
  if (token.start < 0 || token.end <= token.start || token.end > bytes.length
    || [token.start, token.end].some(offset => offset < bytes.length && (bytes[offset] & 0xc0) === 0x80))
    throw new Error('Message selection is not on an original UTF-8 boundary.');
  // Keep the original sentence, never just the selected word. A long message's
  // bounded context is centred on the actual occurrence, without splitting UTF-8.
  let start = Math.max(0, token.start - 1536);
  while (start > 0 && (bytes[start] & 0xc0) === 0x80) start--;
  let end = Math.min(bytes.length, Math.max(token.end, start + 4096));
  while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
  return {
    sourceId: message.conversationId, contentRevision: message.contentRevision, packageId, packageVersion,
    text: decoder.decode(bytes.subarray(start, end)),
    locator: { kind: 'message', conversationId: message.conversationId, messageId: message.id,
      messageRevision: message.revision, contextStart: start,
      selectionStart: token.start - start, selectionEnd: token.end - start },
  };
}

export function visibleMessageBatch(messages: readonly ConversationMessage[], visible: readonly string[]) {
  let bytes = 0;
  return messages.filter(message => {
    const length = encoder.encode(message.text).length;
    if (!visible.includes(message.id) || message.status !== 'complete' || length === 0 || bytes + length > 8192) return false;
    bytes += length; return true;
  }).slice(0, 8);
}

export function mergeMessagePage(current: readonly ConversationMessage[], incoming: readonly ConversationMessage[], older = false) {
  const messages = new Map(current.map(message => [message.id, message]));
  for (const message of incoming) {
    const previous = messages.get(message.id);
    if (!previous || previous.revision <= message.revision) messages.set(message.id, message);
  }
  const sorted = [...messages.values()].sort((a, b) => a.sequence - b.sequence);
  return older ? sorted.slice(0, 120) : sorted.slice(-120);
}

export function shouldSendComposer(key: string, shift: boolean, composing: boolean, keyCode?: number) {
  return key === 'Enter' && !shift && !composing && keyCode !== 229;
}
