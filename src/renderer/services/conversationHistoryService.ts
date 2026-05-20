import type { ConversationSession } from '../../shared/types';
import { getBridge } from '../../shared/bridges';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger("renderer.services.conversationHistory");

function getSessionsKey(lang: string): string {
  return `conversation-sessions-${lang}`;
}

export async function loadSessions(language: string = 'en'): Promise<ConversationSession[]> {
  const raw = await getBridge().kvStore.kvGet(getSessionsKey(language));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    log.error("error", e);
    return [];
  }
}

async function saveSessions(sessions: ConversationSession[], language: string): Promise<void> {
  await getBridge().kvStore.kvSet(getSessionsKey(language), JSON.stringify(sessions));
}

export async function addSession(session: ConversationSession, language: string = 'en'): Promise<ConversationSession[]> {
  const sessions = await loadSessions(language);
  sessions.push(session);
  await saveSessions(sessions, language);
  return sessions;
}

export async function updateSession(session: ConversationSession, language: string = 'en'): Promise<ConversationSession[]> {
  const sessions = await loadSessions(language);
  const idx = sessions.findIndex((s) => s.id === session.id);
  if (idx !== -1) {
    sessions[idx] = session;
  } else {
    sessions.push(session);
  }
  await saveSessions(sessions, language);
  return sessions;
}

export async function deleteSession(id: string, language: string = 'en'): Promise<ConversationSession[]> {
  const sessions = await loadSessions(language);
  const filtered = sessions.filter((s) => s.id !== id);
  await saveSessions(filtered, language);
  return filtered;
}

export async function deleteAllSessions(language: string = 'en'): Promise<void> {
  await saveSessions([], language);
}

export function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
