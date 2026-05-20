// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentConfig, AgentMemoryEntry } from '../../shared/types';

const mockKvGet = vi.fn<(key: string) => Promise<string | null>>();
const mockKvSet = vi.fn<(key: string, value: string) => Promise<void>>();
const mockKvRemove = vi.fn<(key: string) => Promise<void>>();

vi.mock('../../shared/bridges', () => ({
  getBridge: () => ({
    kvStore: {
      kvGet: mockKvGet,
      kvSet: mockKvSet,
      kvRemove: mockKvRemove,
    },
  }),
}));

function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'agent_test_abc',
    agentName: 'Test Agent',
    userName: 'User',
    personality: 'casual',
    roleplayName: '',
    roleplayLore: '',
    setupComplete: true,
    ...overrides,
  };
}

function makeMemory(overrides: Partial<AgentMemoryEntry> = {}): AgentMemoryEntry {
  return {
    id: 'mem_test_abc',
    agentId: 'agent_test_abc',
    content: 'some memory',
    timestamp: 1000,
    ...overrides,
  };
}

describe('agentConfigService', () => {
  beforeEach(() => {
    mockKvGet.mockResolvedValue(null);
    mockKvSet.mockResolvedValue(undefined);
    mockKvRemove.mockResolvedValue(undefined);
  });

  describe('loadAgents', () => {
    it('returns empty array when kvGet returns null', async () => {
      const { loadAgents } = await import('./agentConfigService');
      mockKvGet.mockResolvedValue(null);
      const result = await loadAgents();
      expect(result).toEqual([]);
    });

    it('returns parsed array when kvGet returns valid JSON array', async () => {
      const { loadAgents } = await import('./agentConfigService');
      const agents = [makeAgent()];
      mockKvGet.mockResolvedValue(JSON.stringify(agents));
      const result = await loadAgents();
      expect(result).toEqual(agents);
    });

    it('returns empty array when kvGet returns non-array JSON', async () => {
      const { loadAgents } = await import('./agentConfigService');
      mockKvGet.mockResolvedValue(JSON.stringify({ id: 'x' }));
      const result = await loadAgents();
      expect(result).toEqual([]);
    });

    it('returns empty array when kvGet returns invalid JSON', async () => {
      const { loadAgents } = await import('./agentConfigService');
      mockKvGet.mockResolvedValue('not-json');
      const result = await loadAgents();
      expect(result).toEqual([]);
    });

    it('queries the agent-configs key', async () => {
      const { loadAgents } = await import('./agentConfigService');
      await loadAgents();
      expect(mockKvGet).toHaveBeenCalledWith('agent-configs');
    });
  });

  describe('addAgent', () => {
    it('appends the new agent to the existing list and saves', async () => {
      const { addAgent } = await import('./agentConfigService');
      const existing = makeAgent({ id: 'agent_existing' });
      mockKvGet.mockResolvedValue(JSON.stringify([existing]));
      const newAgent = makeAgent({ id: 'agent_new' });
      const result = await addAgent(newAgent);
      expect(result).toHaveLength(2);
      expect(result[1]).toEqual(newAgent);
      expect(mockKvSet).toHaveBeenCalledWith('agent-configs', JSON.stringify([existing, newAgent]));
    });

    it('adds agent to an empty list', async () => {
      const { addAgent } = await import('./agentConfigService');
      mockKvGet.mockResolvedValue(null);
      const agent = makeAgent();
      const result = await addAgent(agent);
      expect(result).toEqual([agent]);
    });
  });

  describe('updateAgent', () => {
    it('replaces the agent with matching id', async () => {
      const { updateAgent } = await import('./agentConfigService');
      const original = makeAgent({ agentName: 'Original' });
      mockKvGet.mockResolvedValue(JSON.stringify([original]));
      const updated = makeAgent({ agentName: 'Updated' });
      const result = await updateAgent(updated);
      expect(result[0].agentName).toBe('Updated');
    });

    it('saves unchanged list when no agent matches the id', async () => {
      const { updateAgent } = await import('./agentConfigService');
      const agent = makeAgent({ id: 'agent_a' });
      mockKvGet.mockResolvedValue(JSON.stringify([agent]));
      const nonExistent = makeAgent({ id: 'agent_x' });
      const result = await updateAgent(nonExistent);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(agent);
    });
  });

  describe('deleteAgent', () => {
    it('removes the agent with matching id from the list', async () => {
      const { deleteAgent } = await import('./agentConfigService');
      const agentA = makeAgent({ id: 'agent_a' });
      const agentB = makeAgent({ id: 'agent_b' });
      mockKvGet
        .mockResolvedValueOnce(JSON.stringify([agentA, agentB]))
        .mockResolvedValueOnce(null);
      const result = await deleteAgent('agent_a', 'ja');
      expect(result).toEqual([agentB]);
    });

    it('also removes memories for the deleted agent', async () => {
      const { deleteAgent } = await import('./agentConfigService');
      const agent = makeAgent({ id: 'agent_a' });
      const memA = makeMemory({ id: 'mem_1', agentId: 'agent_a' });
      const memB = makeMemory({ id: 'mem_2', agentId: 'agent_b' });
      mockKvGet
        .mockResolvedValueOnce(JSON.stringify([agent]))
        .mockResolvedValueOnce(JSON.stringify([memA, memB]));
      await deleteAgent('agent_a', 'ja');
      const savedMemories = JSON.parse(mockKvSet.mock.calls.find(c => c[0] === 'agent-memories-ja')![1]);
      expect(savedMemories).toEqual([memB]);
    });

    it('does nothing to memories when the deleted agent has none', async () => {
      const { deleteAgent } = await import('./agentConfigService');
      const agent = makeAgent();
      mockKvGet
        .mockResolvedValueOnce(JSON.stringify([agent]))
        .mockResolvedValueOnce(null);
      await deleteAgent(agent.id, 'ja');
      const memCall = mockKvSet.mock.calls.find(c => c[0] === 'agent-memories-ja');
      expect(JSON.parse(memCall![1])).toEqual([]);
    });
  });

  describe('loadActiveAgentId', () => {
    it('returns the stored active agent id', async () => {
      const { loadActiveAgentId } = await import('./agentConfigService');
      mockKvGet.mockResolvedValue('agent_active');
      const result = await loadActiveAgentId();
      expect(result).toBe('agent_active');
    });

    it('returns null when no active agent is stored', async () => {
      const { loadActiveAgentId } = await import('./agentConfigService');
      mockKvGet.mockResolvedValue(null);
      const result = await loadActiveAgentId();
      expect(result).toBeNull();
    });

    it('queries the active-agent-id key', async () => {
      const { loadActiveAgentId } = await import('./agentConfigService');
      await loadActiveAgentId();
      expect(mockKvGet).toHaveBeenCalledWith('active-agent-id');
    });
  });

  describe('saveActiveAgentId', () => {
    it('saves the agent id to the active-agent-id key', async () => {
      const { saveActiveAgentId } = await import('./agentConfigService');
      await saveActiveAgentId('agent_xyz');
      expect(mockKvSet).toHaveBeenCalledWith('active-agent-id', 'agent_xyz');
    });
  });

  describe('migrateIfNeeded', () => {
    it('does nothing when there is no legacy agent-config key', async () => {
      const { migrateIfNeeded } = await import('./agentConfigService');
      mockKvGet.mockResolvedValue(null);
      await migrateIfNeeded('ja');
      expect(mockKvSet).not.toHaveBeenCalled();
    });

    it('always removes the old agent-config key regardless of content', async () => {
      const { migrateIfNeeded } = await import('./agentConfigService');
      mockKvGet.mockImplementation(async (key) => {
        if (key === 'agent-config') return JSON.stringify({ setupComplete: false });
        return null;
      });
      await migrateIfNeeded('ja');
      expect(mockKvRemove).toHaveBeenCalledWith('agent-config');
    });

    it('removes old agent-memories key during cleanup', async () => {
      const { migrateIfNeeded } = await import('./agentConfigService');
      mockKvGet.mockImplementation(async (key) => {
        if (key === 'agent-config') return JSON.stringify({ setupComplete: false });
        return null;
      });
      await migrateIfNeeded('ja');
      expect(mockKvRemove).toHaveBeenCalledWith('agent-memories');
    });

    it('migrates a setupComplete legacy config to the multi-agent format when agents list is empty', async () => {
      const { migrateIfNeeded } = await import('./agentConfigService');
      const oldConfig = {
        agentName: 'Sensei',
        userName: 'Student',
        personality: 'formal',
        roleplayName: '',
        roleplayLore: '',
        setupComplete: true,
      };
      mockKvGet.mockImplementation(async (key) => {
        if (key === 'agent-config') return JSON.stringify(oldConfig);
        if (key === 'agent-configs') return JSON.stringify([]);
        return null;
      });
      await migrateIfNeeded('ja');
      const savedAgentsCall = mockKvSet.mock.calls.find(c => c[0] === 'agent-configs');
      expect(savedAgentsCall).toBeDefined();
      const savedAgents = JSON.parse(savedAgentsCall![1]);
      expect(savedAgents).toHaveLength(1);
      expect(savedAgents[0].agentName).toBe('Sensei');
      expect(savedAgents[0].userName).toBe('Student');
      expect(savedAgents[0].setupComplete).toBe(true);
    });

    it('does not migrate when legacy config lacks setupComplete', async () => {
      const { migrateIfNeeded } = await import('./agentConfigService');
      mockKvGet.mockImplementation(async (key) => {
        if (key === 'agent-config') return JSON.stringify({ agentName: 'X' });
        return null;
      });
      await migrateIfNeeded('ja');
      expect(mockKvSet).not.toHaveBeenCalled();
    });

    it('does not migrate when agents list is already non-empty', async () => {
      const { migrateIfNeeded } = await import('./agentConfigService');
      const existing = makeAgent();
      mockKvGet.mockImplementation(async (key) => {
        if (key === 'agent-config') return JSON.stringify({ setupComplete: true, agentName: 'Old' });
        if (key === 'agent-configs') return JSON.stringify([existing]);
        return null;
      });
      await migrateIfNeeded('ja');
      const agentsSaved = mockKvSet.mock.calls.filter(c => c[0] === 'agent-configs');
      expect(agentsSaved).toHaveLength(0);
    });

    it('migrates old memories and tags them with the new agent id', async () => {
      const { migrateIfNeeded } = await import('./agentConfigService');
      const oldMem = { id: 'mem_old', content: 'old memory', timestamp: 1234 };
      mockKvGet.mockImplementation(async (key) => {
        if (key === 'agent-config') return JSON.stringify({ setupComplete: true, agentName: 'A' });
        if (key === 'agent-configs') return JSON.stringify([]);
        if (key === 'agent-memories') return JSON.stringify([oldMem]);
        return null;
      });
      await migrateIfNeeded('ja');
      const memCall = mockKvSet.mock.calls.find(c => c[0] === 'agent-memories-ja');
      expect(memCall).toBeDefined();
      const savedMems = JSON.parse(memCall![1]);
      expect(savedMems).toHaveLength(1);
      expect(savedMems[0].content).toBe('old memory');
      expect(savedMems[0].agentId).toBeDefined();
    });

    it('skips memory migration when legacy memories are not an array', async () => {
      const { migrateIfNeeded } = await import('./agentConfigService');
      mockKvGet.mockImplementation(async (key) => {
        if (key === 'agent-config') return JSON.stringify({ setupComplete: true });
        if (key === 'agent-configs') return JSON.stringify([]);
        if (key === 'agent-memories') return JSON.stringify({ not: 'array' });
        return null;
      });
      await migrateIfNeeded('ja');
      const memCall = mockKvSet.mock.calls.find(c => c[0] === 'agent-memories-ja');
      expect(memCall).toBeUndefined();
    });

    it('does not throw when the legacy config JSON is invalid', async () => {
      const { migrateIfNeeded } = await import('./agentConfigService');
      mockKvGet.mockImplementation(async (key) => {
        if (key === 'agent-config') return 'not-json';
        return null;
      });
      await expect(migrateIfNeeded('ja')).resolves.toBeUndefined();
    });
  });

  describe('loadAllMemories', () => {
    it('returns empty array when kvGet returns null', async () => {
      const { loadAllMemories } = await import('./agentConfigService');
      mockKvGet.mockResolvedValue(null);
      const result = await loadAllMemories('ja');
      expect(result).toEqual([]);
    });

    it('returns parsed memories when kvGet returns a valid JSON array', async () => {
      const { loadAllMemories } = await import('./agentConfigService');
      const memories = [makeMemory()];
      mockKvGet.mockResolvedValue(JSON.stringify(memories));
      const result = await loadAllMemories('ja');
      expect(result).toEqual(memories);
    });

    it('returns empty array when kvGet returns non-array JSON', async () => {
      const { loadAllMemories } = await import('./agentConfigService');
      mockKvGet.mockResolvedValue(JSON.stringify({ id: 'x' }));
      const result = await loadAllMemories('ja');
      expect(result).toEqual([]);
    });

    it('returns empty array when kvGet returns invalid JSON', async () => {
      const { loadAllMemories } = await import('./agentConfigService');
      mockKvGet.mockResolvedValue('broken{');
      const result = await loadAllMemories('ja');
      expect(result).toEqual([]);
    });

    it('queries the language-scoped key', async () => {
      const { loadAllMemories } = await import('./agentConfigService');
      await loadAllMemories('ja');
      expect(mockKvGet).toHaveBeenCalledWith('agent-memories-ja');
    });
  });

  describe('addAgentMemory', () => {
    it('adds a new memory entry to the list', async () => {
      const { addAgentMemory } = await import('./agentConfigService');
      mockKvGet.mockResolvedValue(null);
      const entry = await addAgentMemory('remember this', 'agent_a', 'ja');
      expect(entry.content).toBe('remember this');
      expect(entry.agentId).toBe('agent_a');
    });

    it('returned entry has a generated id starting with mem_', async () => {
      const { addAgentMemory } = await import('./agentConfigService');
      mockKvGet.mockResolvedValue(null);
      const entry = await addAgentMemory('content', 'agent_a', 'ja');
      expect(entry.id).toMatch(/^mem_/);
    });

    it('returned entry has a numeric timestamp', async () => {
      const { addAgentMemory } = await import('./agentConfigService');
      mockKvGet.mockResolvedValue(null);
      const before = Date.now();
      const entry = await addAgentMemory('content', 'agent_a', 'ja');
      const after = Date.now();
      expect(entry.timestamp).toBeGreaterThanOrEqual(before);
      expect(entry.timestamp).toBeLessThanOrEqual(after);
    });

    it('appends to existing memories and saves all', async () => {
      const { addAgentMemory } = await import('./agentConfigService');
      const existing = makeMemory({ id: 'mem_existing' });
      mockKvGet.mockResolvedValue(JSON.stringify([existing]));
      await addAgentMemory('new memory', 'agent_b', 'ja');
      const saved = JSON.parse(mockKvSet.mock.calls[0][1]);
      expect(saved).toHaveLength(2);
      expect(saved[0]).toEqual(existing);
    });
  });

  describe('removeAgentMemory', () => {
    it('removes the memory with the given id', async () => {
      const { removeAgentMemory } = await import('./agentConfigService');
      const memA = makeMemory({ id: 'mem_a' });
      const memB = makeMemory({ id: 'mem_b' });
      mockKvGet.mockResolvedValue(JSON.stringify([memA, memB]));
      const result = await removeAgentMemory('mem_a', 'ja');
      expect(result).toEqual([memB]);
    });

    it('returns the same list when the id does not exist', async () => {
      const { removeAgentMemory } = await import('./agentConfigService');
      const mem = makeMemory({ id: 'mem_a' });
      mockKvGet.mockResolvedValue(JSON.stringify([mem]));
      const result = await removeAgentMemory('mem_nonexistent', 'ja');
      expect(result).toEqual([mem]);
    });
  });

  describe('clearAgentMemories', () => {
    it('clears all memories when no agentId is provided', async () => {
      const { clearAgentMemories } = await import('./agentConfigService');
      const result = await clearAgentMemories(undefined, 'ja');
      expect(result).toEqual([]);
      expect(mockKvSet).toHaveBeenCalledWith('agent-memories-ja', '[]');
    });

    it('removes only memories for the specified agentId', async () => {
      const { clearAgentMemories } = await import('./agentConfigService');
      const memA = makeMemory({ id: 'mem_a', agentId: 'agent_a' });
      const memB = makeMemory({ id: 'mem_b', agentId: 'agent_b' });
      mockKvGet.mockResolvedValue(JSON.stringify([memA, memB]));
      const result = await clearAgentMemories('agent_a', 'ja');
      expect(result).toEqual([memB]);
    });

    it('returns the unmodified list when the specified agentId has no memories', async () => {
      const { clearAgentMemories } = await import('./agentConfigService');
      const mem = makeMemory({ agentId: 'agent_b' });
      mockKvGet.mockResolvedValue(JSON.stringify([mem]));
      const result = await clearAgentMemories('agent_x', 'ja');
      expect(result).toEqual([mem]);
    });
  });

  describe('filterMemories', () => {
    it('returns all memories when shared is true', async () => {
      const { filterMemories } = await import('./agentConfigService');
      const memA = makeMemory({ agentId: 'agent_a' });
      const memB = makeMemory({ agentId: 'agent_b' });
      expect(filterMemories([memA, memB], 'agent_a', true)).toEqual([memA, memB]);
    });

    it('returns only memories matching activeAgentId when shared is false', async () => {
      const { filterMemories } = await import('./agentConfigService');
      const memA = makeMemory({ id: 'mem_a', agentId: 'agent_a' });
      const memB = makeMemory({ id: 'mem_b', agentId: 'agent_b' });
      expect(filterMemories([memA, memB], 'agent_a', false)).toEqual([memA]);
    });

    it('returns empty array when shared is false and no memories match activeAgentId', async () => {
      const { filterMemories } = await import('./agentConfigService');
      const mem = makeMemory({ agentId: 'agent_b' });
      expect(filterMemories([mem], 'agent_x', false)).toEqual([]);
    });

    it('returns empty array for empty input regardless of shared flag', async () => {
      const { filterMemories } = await import('./agentConfigService');
      expect(filterMemories([], 'agent_a', true)).toEqual([]);
      expect(filterMemories([], 'agent_a', false)).toEqual([]);
    });
  });

  describe('generateAgentId', () => {
    it('returns a string starting with agent_', async () => {
      const { generateAgentId } = await import('./agentConfigService');
      expect(generateAgentId()).toMatch(/^agent_/);
    });

    it('returns a unique id on each call', async () => {
      const { generateAgentId } = await import('./agentConfigService');
      const a = generateAgentId();
      const b = generateAgentId();
      expect(a).not.toBe(b);
    });
  });

  describe('language scoping', () => {
    it('does not return memories saved under a different language', async () => {
      const { loadAllMemories } = await import('./agentConfigService');
      const memory = makeMemory({ id: 'mem_1', content: 'ja memory' });
      mockKvGet.mockImplementation(async (key: string) => {
        if (key === 'agent-memories-ja') return JSON.stringify([memory]);
        return null;
      });
      const jaMemories = await loadAllMemories('ja');
      const deMemories = await loadAllMemories('de');
      expect(jaMemories).toHaveLength(1);
      expect(deMemories).toHaveLength(0);
    });
  });
});
