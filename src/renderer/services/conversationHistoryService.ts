import type { ConversationSession } from '../../shared/types';
import { getBridge } from '../../shared/bridges';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger("renderer.services.conversationHistory");

const SESSIONS_KEY = 'conversation-sessions';

export async function loadSessions(): Promise<ConversationSession[]> {
  const raw = await getBridge().kvStore.kvGet(SESSIONS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    log.error("error", e);
    return [];
  }
}

async function saveSessions(sessions: ConversationSession[]): Promise<void> {
  await getBridge().kvStore.kvSet(SESSIONS_KEY, JSON.stringify(sessions));
}

export async function addSession(session: ConversationSession): Promise<ConversationSession[]> {
  const sessions = await loadSessions();
  sessions.push(session);
  await saveSessions(sessions);
  return sessions;
}

export async function updateSession(session: ConversationSession): Promise<ConversationSession[]> {
  const sessions = await loadSessions();
  const idx = sessions.findIndex((s) => s.id === session.id);
  if (idx !== -1) {
    sessions[idx] = session;
  } else {
    sessions.push(session);
  }
  await saveSessions(sessions);
  return sessions;
}

export async function deleteSession(id: string): Promise<ConversationSession[]> {
  const sessions = await loadSessions();
  const filtered = sessions.filter((s) => s.id !== id);
  await saveSessions(filtered);
  return filtered;
}

export async function deleteAllSessions(): Promise<void> {
  await saveSessions([]);
}

export function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
