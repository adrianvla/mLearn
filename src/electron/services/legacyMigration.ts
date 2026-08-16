/**
 * Legacy → World Migration (Phase 0 of the conversational-runtime overhaul).
 *
 * One-time, copy-only migration of the legacy KV conversation data into the
 * Sea/Thread world model:
 *   - `agent-configs`           → Participant + Room (1-on-1 per agent + user)
 *   - `conversation-sessions-*` → archived Threads under the agent's room, with
 *                                 each message appended as a thread-scoped
 *                                 journal event (in message array order)
 *   - `agent-memories-*`        → durable Sea `memory.belief` events
 *
 * Legacy KV data is never deleted or mutated — only the completion marker
 * `world-migration-v1` is added. A run after the marker is present is a no-op.
 * Entity creation is existence-checked so a re-run after a crash mid-migration
 * (marker not yet written) does not duplicate rooms/threads/participants.
 * Contract: .sisyphus/plans/conversational-runtime-overhaul.md §4 / Phase 0.
 */

import fs from 'fs';
import path from 'path';
import { getUserDataPath } from '../utils/platform';
import { appendEvent } from './journalService';
import { loadWorld, saveWorld } from './worldStore';
import { HARNESS_ACTOR, USER_ACTOR } from '../../shared/world';
import type { AgentConfig, AgentMemoryEntry, ConversationMessage, ConversationSession } from '../../shared/types';
import type { Participant, Thread } from '../../shared/world';

const AGENTS_KEY = 'agent-configs';
const SESSIONS_PREFIX = 'conversation-sessions-';
const MEMORIES_PREFIX = 'agent-memories-';
const MIGRATION_MARKER_KEY = 'world-migration-v1';
const MIGRATION_MARKER_VALUE = 'done';

export interface MigrationSummary {
  migrated: boolean;
  rooms: number;
  threads: number;
  participants: number;
  memoryEvents: number;
  messageEvents: number;
}

function roomIdForAgent(agentId: string): string {
  return `room-legacy-${agentId}`;
}

function kvStoreFilePath(): string {
  return path.join(getUserDataPath(), 'kv-store.json');
}

async function loadKvStore(): Promise<Record<string, string>> {
  try {
    await fs.promises.access(kvStoreFilePath());
  } catch {
    return {};
  }
  try {
    const raw = await fs.promises.readFile(kvStoreFilePath(), 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

async function saveKvStore(store: Record<string, string>): Promise<void> {
  const filePath = kvStoreFilePath();
  const tmpPath = `${filePath}.tmp`;
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(tmpPath, JSON.stringify(store, null, 2), 'utf-8');
  await fs.promises.rename(tmpPath, filePath);
}

function parseJsonArray<T>(raw: string | undefined): T[] {
  if (raw === undefined || raw === '') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/** Languages that have any kv key under the given prefix (e.g. `conversation-sessions-`). */
function languagesWithKeyPrefix(store: Record<string, string>, prefix: string): string[] {
  const langs = new Set<string>();
  for (const key of Object.keys(store)) {
    if (key.startsWith(prefix)) {
      const lang = key.slice(prefix.length);
      if (lang.length > 0) langs.add(lang);
    }
  }
  return [...langs];
}

/**
 * Richest available persona text: roleplay lore/context/quotes for roleplay
 * agents, personality mode for plain tutors. No canon anchors existed in the
 * legacy data, so none are invented.
 */
function buildPersonaText(config: AgentConfig): string {
  const parts: string[] = [];
  if (config.personality !== 'roleplay') {
    parts.push(`Personality: ${config.personality}`);
  }
  if (config.roleplayName) parts.push(`Character: ${config.roleplayName}`);
  if (config.roleplayLore) parts.push(config.roleplayLore);
  if (config.roleplayContext) parts.push(config.roleplayContext);
  if (config.roleplayQuotes && config.roleplayQuotes.length > 0) {
    parts.push(`Quotes:\n${config.roleplayQuotes.map((quote) => `- ${quote}`).join('\n')}`);
  }
  return parts.join('\n\n');
}

/** Oldest legacy timestamp related to this agent (sessions, messages, memories) or now. */
function agentOldestTimestamp(
  sessionsByLang: Record<string, ConversationSession[]>,
  memoriesByLang: Record<string, AgentMemoryEntry[]>,
  agentId: string,
): number {
  const stamps: number[] = [];
  for (const sessions of Object.values(sessionsByLang)) {
    for (const session of sessions) {
      if (session.agentId !== agentId) continue;
      stamps.push(session.createdAt, session.updatedAt);
      for (const message of session.messages) stamps.push(message.timestamp);
    }
  }
  for (const memories of Object.values(memoriesByLang)) {
    for (const memory of memories) {
      if (memory.agentId === agentId) stamps.push(memory.timestamp);
    }
  }
  const valid = stamps.filter((t) => Number.isFinite(t) && t > 0);
  return valid.length > 0 ? Math.min(...valid) : Date.now();
}

/** User-visible message fields worth carrying into the journal payload. */
function messagePayload(message: ConversationMessage): Record<string, unknown> {
  const payload: Record<string, unknown> = { text: message.content };
  if (message.widget !== undefined) payload.widget = message.widget;
  if (message.widgets !== undefined && message.widgets.length > 0) payload.widgets = message.widgets;
  return payload;
}

/**
 * Run the legacy → world migration. Returns summary counts for the caller's
 * logging; `migrated: false` when the completion marker short-circuits.
 */
export async function runLegacyMigration(): Promise<MigrationSummary> {
  const store = await loadKvStore();
  if (store[MIGRATION_MARKER_KEY] === MIGRATION_MARKER_VALUE) {
    return { migrated: false, rooms: 0, threads: 0, participants: 0, memoryEvents: 0, messageEvents: 0 };
  }

  const world = await loadWorld();
  const agents = parseJsonArray<AgentConfig>(store[AGENTS_KEY]);

  const sessionsByLang: Record<string, ConversationSession[]> = {};
  for (const lang of languagesWithKeyPrefix(store, SESSIONS_PREFIX)) {
    sessionsByLang[lang] = parseJsonArray<ConversationSession>(store[`${SESSIONS_PREFIX}${lang}`]);
  }
  const memoriesByLang: Record<string, AgentMemoryEntry[]> = {};
  for (const lang of languagesWithKeyPrefix(store, MEMORIES_PREFIX)) {
    memoriesByLang[lang] = parseJsonArray<AgentMemoryEntry>(store[`${MEMORIES_PREFIX}${lang}`]);
  }

  let participants = 0;
  let rooms = 0;
  let threads = 0;
  let memoryEvents = 0;
  let messageEvents = 0;

  // Participants + Rooms from agent configs.
  for (const agent of agents) {
    const participant: Participant = {
      id: agent.id,
      displayName: agent.agentName || agent.id,
      kind: 'persistent',
      personaText: buildPersonaText(agent) || agent.agentName || agent.id,
      ...(agent.voiceSampleId !== undefined ? { voiceSampleId: agent.voiceSampleId } : {}),
      ...(agent.profilePhoto !== undefined ? { profilePhoto: agent.profilePhoto } : {}),
      setupComplete: agent.setupComplete,
    };
    if (!world.participants.some((existing) => existing.id === participant.id)) {
      world.participants.push(participant);
      participants += 1;
    }

    const roomId = roomIdForAgent(agent.id);
    if (!world.rooms.some((existing) => existing.id === roomId)) {
      world.rooms.push({
        id: roomId,
        title: participant.displayName,
        participantIds: [agent.id],
        createdAt: agentOldestTimestamp(sessionsByLang, memoriesByLang, agent.id),
      });
      rooms += 1;
    }
  }

  // Sessions → archived Threads + thread-scoped message events (append order = message order).
  for (const sessions of Object.values(sessionsByLang)) {
    for (const session of sessions) {
      if (session.agentId === null) continue; // pre-agent legacy sessions have no room
      const roomId = roomIdForAgent(session.agentId);
      if (!world.rooms.some((room) => room.id === roomId)) continue; // agent config missing

      const thread: Thread = {
        id: session.id,
        roomId,
        title: session.title || undefined,
        state: 'archived',
        createdAt: session.createdAt > 0 ? session.createdAt : Date.now(),
      };
      if (!world.threads.some((existing) => existing.id === thread.id)) {
        world.threads.push(thread);
        threads += 1;
      }

      for (const message of session.messages) {
        if (message.role === 'user') {
          await appendEvent(roomId, {
            roomId,
            scope: { kind: 'thread', threadId: session.id },
            type: 'message.user',
            actorId: USER_ACTOR,
            witnesses: [USER_ACTOR, session.agentId],
            payload: messagePayload(message),
          });
          messageEvents += 1;
        } else if (message.role === 'assistant') {
          await appendEvent(roomId, {
            roomId,
            scope: { kind: 'thread', threadId: session.id },
            type: 'message.character',
            actorId: session.agentId,
            witnesses: [USER_ACTOR, session.agentId],
            payload: messagePayload(message),
          });
          messageEvents += 1;
        }
      }
    }
  }

  // Flat memories → durable Sea memory.belief events (legacy memories were durable).
  for (const memories of Object.values(memoriesByLang)) {
    for (const memory of memories) {
      const roomId = roomIdForAgent(memory.agentId);
      if (!world.rooms.some((room) => room.id === roomId)) continue; // agent config missing
      await appendEvent(roomId, {
        roomId,
        scope: { kind: 'sea' },
        type: 'memory.belief',
        actorId: HARNESS_ACTOR,
        witnesses: [USER_ACTOR, memory.agentId],
        payload: { ownerId: memory.agentId, kind: 'belief', text: memory.content, sourceMemoryId: memory.id },
      });
      memoryEvents += 1;
    }
  }

  await saveWorld(world);
  await saveKvStore({ ...store, [MIGRATION_MARKER_KEY]: MIGRATION_MARKER_VALUE });

  return { migrated: true, rooms, threads, participants, memoryEvents, messageEvents };
}
