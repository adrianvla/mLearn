// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConversationSession } from '../../shared/types';

const mockKvGet = vi.fn<(key: string) => Promise<string | null>>();
const mockKvSet = vi.fn<(key: string, value: string) => Promise<void>>();

vi.mock('../../shared/bridges', () => ({
  getBridge: () => ({
    kvStore: {
      kvGet: mockKvGet,
      kvSet: mockKvSet,
    },
  }),
}));

function makeSession(overrides: Partial<ConversationSession> = {}): ConversationSession {
  return {
    id: 'session_test_abc',
    title: 'Test Session',
    agentId: 'agent_test',
    messages: [],
    llmHistory: [],
    createdAt: 1000,
    updatedAt: 1000,
    messageCount: 0,
    ...overrides,
  };
}

describe('conversationHistoryService', () => {
  beforeEach(() => {
    mockKvGet.mockResolvedValue(null);
    mockKvSet.mockResolvedValue(undefined);
  });

  describe('loadSessions', () => {
    it('returns empty array when kvGet returns null', async () => {
      const { loadSessions } = await import('./conversationHistoryService');
      mockKvGet.mockResolvedValue(null);
      const result = await loadSessions();
      expect(result).toEqual([]);
    });

    it('returns parsed array when kvGet returns valid JSON', async () => {
      const { loadSessions } = await import('./conversationHistoryService');
      const sessions = [makeSession()];
      mockKvGet.mockResolvedValue(JSON.stringify(sessions));
      const result = await loadSessions();
      expect(result).toEqual(sessions);
    });

    it('returns empty array when kvGet returns invalid JSON', async () => {
      const { loadSessions } = await import('./conversationHistoryService');
      mockKvGet.mockResolvedValue('not-json');
      const result = await loadSessions();
      expect(result).toEqual([]);
    });
  });

  describe('addSession', () => {
    it('appends to existing sessions', async () => {
      const { addSession } = await import('./conversationHistoryService');
      const existing = makeSession({ id: 'session_existing' });
      mockKvGet.mockResolvedValue(JSON.stringify([existing]));
      const newSession = makeSession({ id: 'session_new' });
      const result = await addSession(newSession);
      expect(result).toHaveLength(2);
      expect(result[1]).toEqual(newSession);
      expect(mockKvSet).toHaveBeenCalledWith(
        'conversation-sessions',
        JSON.stringify([existing, newSession]),
      );
    });
  });

  describe('updateSession', () => {
    it('replaces session by id', async () => {
      const { updateSession } = await import('./conversationHistoryService');
      const original = makeSession({ title: 'Original' });
      mockKvGet.mockResolvedValue(JSON.stringify([original]));
      const updated = makeSession({ id: original.id, title: 'Updated' });
      const result = await updateSession(updated);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Updated');
    });

    it('adds session if id does not exist', async () => {
      const { updateSession } = await import('./conversationHistoryService');
      const existing = makeSession({ id: 'session_existing' });
      mockKvGet.mockResolvedValue(JSON.stringify([existing]));
      const newSession = makeSession({ id: 'session_new', title: 'New' });
      const result = await updateSession(newSession);
      expect(result).toHaveLength(2);
      expect(result[1]).toEqual(newSession);
    });
  });

  describe('deleteSession', () => {
    it('removes session by id', async () => {
      const { deleteSession } = await import('./conversationHistoryService');
      const sessionA = makeSession({ id: 'session_a' });
      const sessionB = makeSession({ id: 'session_b' });
      mockKvGet.mockResolvedValue(JSON.stringify([sessionA, sessionB]));
      const result = await deleteSession('session_a');
      expect(result).toEqual([sessionB]);
    });
  });

  describe('deleteAllSessions', () => {
    it('saves empty array', async () => {
      const { deleteAllSessions } = await import('./conversationHistoryService');
      await deleteAllSessions();
      expect(mockKvSet).toHaveBeenCalledWith('conversation-sessions', '[]');
    });
  });

  describe('generateSessionId', () => {
    it('returns unique strings', async () => {
      const { generateSessionId } = await import('./conversationHistoryService');
      const a = generateSessionId();
      const b = generateSessionId();
      expect(a).not.toBe(b);
      expect(a).toMatch(/^session_/);
      expect(b).toMatch(/^session_/);
    });
  });
});
