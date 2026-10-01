import type { ConversationMessage } from '../../../shared/types';
type GroupMessage = ConversationMessage & { actorId?: string };

/** Stable identity, adjacency and time establish a visual run; names do not. */
export function sameMessageGroup(previous: GroupMessage | undefined, next: GroupMessage | undefined): boolean {
  if (!previous || !next || previous.isError || next.isError || previous.role === 'system') return false;
  if (previous.role !== next.role || !previous.actorId || previous.actorId !== next.actorId) return false;
  const gap = next.timestamp - previous.timestamp;
  return gap >= 0 && gap <= 5 * 60 * 1000;
}
