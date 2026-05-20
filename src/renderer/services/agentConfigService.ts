/**
 * Agent Config Service
 * Manages multiple agent configurations and tagged memories via KVStore bridge.
 */

import type { AgentConfig, AgentMemoryEntry } from '../../shared/types';
import { getBridge } from '../../shared/bridges';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger("renderer.services.agentConfig");

const AGENTS_KEY = 'agent-configs';
const ACTIVE_AGENT_KEY = 'active-agent-id';

function getMemoriesKey(lang: string): string {
  return `agent-memories-${lang}`;
}

// ============================================================================
// Agent CRUD
// ============================================================================

export async function loadAgents(): Promise<AgentConfig[]> {
  const raw = await getBridge().kvStore.kvGet(AGENTS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    log.error("error", e);
    return [];
  }
}

async function saveAgents(agents: AgentConfig[]): Promise<void> {
  await getBridge().kvStore.kvSet(AGENTS_KEY, JSON.stringify(agents));
}

export async function addAgent(config: AgentConfig): Promise<AgentConfig[]> {
  const agents = await loadAgents();
  agents.push(config);
  await saveAgents(agents);
  return agents;
}

export async function updateAgent(config: AgentConfig): Promise<AgentConfig[]> {
  const agents = await loadAgents();
  const idx = agents.findIndex((a) => a.id === config.id);
  if (idx !== -1) {
    agents[idx] = config;
  }
  await saveAgents(agents);
  return agents;
}

export async function deleteAgent(agentId: string, language: string = 'en'): Promise<AgentConfig[]> {
  const agents = await loadAgents();
  const filtered = agents.filter((a) => a.id !== agentId);
  await saveAgents(filtered);

  // Also remove this agent's memories
  const memories = await loadAllMemories(language);
  const remaining = memories.filter((m) => m.agentId !== agentId);
  await saveAllMemories(remaining, language);

  return filtered;
}

// ============================================================================
// Active Agent Selection
// ============================================================================

export async function loadActiveAgentId(): Promise<string | null> {
  return getBridge().kvStore.kvGet(ACTIVE_AGENT_KEY);
}

export async function saveActiveAgentId(agentId: string): Promise<void> {
  await getBridge().kvStore.kvSet(ACTIVE_AGENT_KEY, agentId);
}

// ============================================================================
// Migration: single agent → multi-agent
// ============================================================================

export async function migrateIfNeeded(language: string = 'en'): Promise<void> {
  const raw = await getBridge().kvStore.kvGet('agent-config');
  if (!raw) return;

  try {
    const oldConfig = JSON.parse(raw);
    if (oldConfig && oldConfig.setupComplete) {
      const id = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const migrated: AgentConfig = {
        id,
        agentName: oldConfig.agentName || '',
        userName: oldConfig.userName || '',
        personality: oldConfig.personality || 'casual',
        roleplayName: oldConfig.roleplayName || '',
        roleplayLore: oldConfig.roleplayLore || '',
        setupComplete: true,
      };

      const agents = await loadAgents();
      if (agents.length === 0) {
        await saveAgents([migrated]);
        await saveActiveAgentId(id);

        // Migrate old memories — tag them with the new agent ID
        const oldMemRaw = await getBridge().kvStore.kvGet('agent-memories');
        if (oldMemRaw) {
          try {
            const oldMems = JSON.parse(oldMemRaw);
            if (Array.isArray(oldMems)) {
              const tagged = oldMems.map((m: AgentMemoryEntry) => ({ ...m, agentId: id }));
              await saveAllMemories(tagged, language);
            }
          } catch (e) {
            log.error("error", e);
          }
        }
      }
    }
  } catch (e) {
    log.error("error", e);
  }

  // Clean up old keys
  await getBridge().kvStore.kvRemove('agent-config');
  await getBridge().kvStore.kvRemove('agent-memories');
}

// ============================================================================
// Memories
// ============================================================================

export async function loadAllMemories(language: string = 'en'): Promise<AgentMemoryEntry[]> {
  const raw = await getBridge().kvStore.kvGet(getMemoriesKey(language));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    log.error("error", e);
    return [];
  }
}

async function saveAllMemories(memories: AgentMemoryEntry[], language: string): Promise<void> {
  await getBridge().kvStore.kvSet(getMemoriesKey(language), JSON.stringify(memories));
}

export function filterMemories(
  allMemories: AgentMemoryEntry[],
  activeAgentId: string,
  shared: boolean,
): AgentMemoryEntry[] {
  if (shared) return allMemories;
  return allMemories.filter((m) => m.agentId === activeAgentId);
}

export async function addAgentMemory(
  content: string,
  agentId: string,
  language: string = 'en',
): Promise<AgentMemoryEntry> {
  const memories = await loadAllMemories(language);
  const entry: AgentMemoryEntry = {
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    agentId,
    content,
    timestamp: Date.now(),
  };
  memories.push(entry);
  await saveAllMemories(memories, language);
  return entry;
}

export async function removeAgentMemory(id: string, language: string = 'en'): Promise<AgentMemoryEntry[]> {
  const memories = await loadAllMemories(language);
  const filtered = memories.filter((m) => m.id !== id);
  await saveAllMemories(filtered, language);
  return filtered;
}

export async function clearAgentMemories(agentId?: string, language: string = 'en'): Promise<AgentMemoryEntry[]> {
  if (!agentId) {
    await saveAllMemories([], language);
    return [];
  }
  const memories = await loadAllMemories(language);
  const remaining = memories.filter((m) => m.agentId !== agentId);
  await saveAllMemories(remaining, language);
  return remaining;
}

export function generateAgentId(): string {
  return `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
