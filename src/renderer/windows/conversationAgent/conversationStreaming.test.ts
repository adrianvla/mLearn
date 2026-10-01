import { describe, expect, it } from 'vitest';
import { streamingMessages } from './conversationStreaming';
import { sameMessageGroup } from './messageGrouping';

describe('streaming message beats', () => {
  it('renders distinct beats with stable identity and attaches widgets only to the final beat', () => {
    const overlay = { role: 'assistant' as const, content: 'What?!\n\nWho?', timestamp: 12,
      actorId: 'person', beats: ['What?!', 'Who?'], tokens: [{ surface: 'Whole response' }], widgets: [{ type: 'quiz' }] };
    const messages = streamingMessages(overlay as Parameters<typeof streamingMessages>[0]);
    expect(messages.map(message => message.content)).toEqual(['What?!', 'Who?']);
    expect(messages[0].widgets).toBeUndefined();
    expect(messages[1].widgets).toEqual(overlay.widgets);
    expect(messages.every(message => message.tokens === undefined)).toBe(true);
    expect(sameMessageGroup(messages[0], messages[1])).toBe(true);
  });
  it('keeps single-message annotation and waiting overlays intact', () => {
    const overlay = { role: 'assistant' as const, content: '', timestamp: 12 };
    expect(streamingMessages(overlay)).toEqual([overlay]);
    expect(streamingMessages(null)).toEqual([]);
  });
});
