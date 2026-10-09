import { describe, expect, it } from 'vitest';
import { latestConversationPreview } from './conversationPreviews';
import type { JournalEvent } from '../../../shared/world';
const event = (id: string, type: JournalEvent['type'], createdAt: number, text: string): JournalEvent => ({
  id, type, createdAt, seq: createdAt, roomId: 'r', actorId: 'person', scope: { kind: 'thread', threadId: 't' }, witnesses: ['user'], payload: { text },
});
describe('messenger previews', () => {
  it('shows the most recent real message, not a newer maintenance event or creation date', () => {
    const result = latestConversationPreview([event('a', 'message.user', 1, 'Hello'), event('c', 'memory.belief', 3, 'Private memory'), event('b', 'message.character', 2, 'Hi\nthere')]);
    expect(result).toMatchObject({ eventId: 'b', threadId: 't', text: 'Hi there', timestamp: 2 });
  });
  it('does not expose a newer character-private message as the learner conversation preview', () => {
    expect(latestConversationPreview([event('public', 'message.character', 1, 'Shared message'),
      { ...event('private', 'message.character', 2, 'Private dialogue'), witnesses: ['person', 'another-person'] }]))
      .toMatchObject({ eventId: 'public', text: 'Shared message' });
  });
  it('does not manufacture a preview for a chat with no messages', () => {
    expect(latestConversationPreview([event('a', 'memory.belief', 1, 'Memory')])).toBeUndefined();
  });
});
