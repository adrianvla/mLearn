import { USER_ACTOR, type JournalEvent } from '../../../shared/world';

export interface ConversationPreview { text: string; timestamp: number; actorId: string; threadId?: string; eventId: string }
export type ConversationPreviews = Record<string, ConversationPreview | undefined>;

/** Canonical readers apply retractions; learner previews additionally require the learner witness. */
export function latestConversationPreview(events: readonly JournalEvent[]): ConversationPreview | undefined {
  const event = events.filter(item => item.witnesses.includes(USER_ACTOR)).filter(item => item.type === 'message.user' || item.type === 'message.character')
    .filter(item => item.payload && typeof item.payload === 'object' && 'text' in item.payload && typeof item.payload.text === 'string' && item.payload.text.trim())
    .reduce<JournalEvent | undefined>((latest, item) => !latest || item.createdAt > latest.createdAt || (item.createdAt === latest.createdAt && item.seq > latest.seq) ? item : latest, undefined);
  if (!event) return undefined;
  return { text: (event.payload as { text: string }).text.replace(/\s+/gu, ' ').slice(0, 240), timestamp: event.createdAt,
    actorId: event.actorId, eventId: event.id, threadId: event.scope.kind === 'thread' ? event.scope.threadId : undefined };
}
