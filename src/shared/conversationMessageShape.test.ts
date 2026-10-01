import { describe, expect, it } from 'vitest';
import { conversationStreamText, splitConversationMessages } from './conversationMessageShape';

describe('deliberate messenger beats', () => {
  it('keeps paragraphs, inline quotations and fenced examples intact', () => {
    const text = 'First paragraph.\n\nSecond says <message-break/>.\n```xml\n<message-break/>\n```';
    expect(splitConversationMessages(text)).toEqual([text]);
  });
  it('ignores empty beats while preserving all real message content', () => {
    expect(splitConversationMessages('<message-break/>\nHi\n<message-break/>\n\n<message-break/>\nAre you there?')).toEqual(['Hi', 'Are you there?']);
  });
  it('hides partial streaming control lines without hiding ordinary inline text', () => {
    expect(conversationStreamText('Hi\n<message-bre')).toBe('Hi');
    expect(conversationStreamText('Hi\n<message-break/>\nAre you there?')).toBe('Hi\n\nAre you there?');
    expect(conversationStreamText('A < comparison')).toBe('A < comparison');
  });
});
