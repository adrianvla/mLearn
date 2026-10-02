import { publishWorldChange } from './worldChanges';
/**
 * World Store — rooms/threads/participants entity persistence.
 * One JSON file ({userData}/world.json), written atomically (tmp + rename).
 * Callers save explicitly; no debounce. No IPC here — wiring is a later wave.
 */

import fs from 'fs';
import path from 'path';
import { getUserDataPath } from '../utils/platform';
import type { AutonomyJobRecord, ContactRecord, IntegrationRecord, Participant, Room, Thread, ScenarioCreation, ReflectionRunRecord } from '../../shared/world';
import type { StoryTrack, StoryAdvanceRecord } from '../../shared/story';
import { guardianForWrites } from './guardian';

export interface WorldState {
  rooms: Room[];
  threads: Thread[];
  participants: Participant[];
  scenarioCreations?: ScenarioCreation[];
  /** Durable integration operation ledger (crash-recovery + conflict identity). */
  integrations?: IntegrationRecord[];
  /** Durable reflection/evolution maintenance ledger (crash-recovery + window identity). */
  reflectionRuns?: ReflectionRunRecord[];
  /** Durable V09 autonomous work ledger. */
  autonomyJobs?: AutonomyJobRecord[];
  /** Durable V10 contact and delivery ledger. */
  contacts?: ContactRecord[];
  storyTracks?: StoryTrack[];
  storyAdvances?: StoryAdvanceRecord[];
  /** Main-owned scoped erasure work; source ids only, never private content. */
  pendingThreadErasures?: { roomId: string; threadId: string; sourceEventIds?: string[] }[];
}

function worldFilePath(): string {
  return path.join(getUserDataPath(), 'world.json');
}

export async function loadWorld(): Promise<WorldState> {
  let raw: string;
  try {
    raw = await fs.promises.readFile(worldFilePath(), 'utf-8');
  } catch (error) {
    // Only absence denotes a fresh world. A failed read must abort mutations,
    // otherwise they could replace existing user data with an empty world.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { rooms: [], threads: [], participants: [] };
    }
    throw error;
  }
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('[worldStore] world.json must contain an object');
  }
  const state = parsed as Partial<WorldState>;
  for (const key of ['rooms', 'threads', 'participants'] as const) {
    if (!Array.isArray(state[key])) {
      throw new Error(`[worldStore] world.json ${key} must be an array`);
    }
  }
  for (const key of ['scenarioCreations', 'integrations', 'reflectionRuns', 'autonomyJobs', 'contacts', 'storyTracks', 'storyAdvances', 'pendingThreadErasures'] as const) {
    if (Object.prototype.hasOwnProperty.call(state, key) && !Array.isArray(state[key])) {
      throw new Error(`[worldStore] world.json ${key} must be an array when present`);
    }
  }
  for (const intent of state.pendingThreadErasures ?? []) {
    if (!intent || typeof intent.roomId !== 'string' || !intent.roomId || typeof intent.threadId !== 'string' || !intent.threadId
      || (intent.sourceEventIds !== undefined && (!Array.isArray(intent.sourceEventIds)
        || intent.sourceEventIds.some(id => typeof id !== 'string' || !id)
        || new Set(intent.sourceEventIds).size !== intent.sourceEventIds.length))) {
      throw new Error('[worldStore] malformed pending thread erasure; history preserved');
    }
  }
  // Retain fields owned by packages or newer app versions during round trips.
  return state as WorldState;
}

export async function saveWorld(state: WorldState, removed?: { threads?: readonly string[]; participants?: readonly string[] }): Promise<void> {
  const guardian = guardianForWrites();
  guardian?.checkWorldWrite(state, removed);
  const filePath = worldFilePath();
  const tmpPath = `${filePath}.tmp`;
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
  await fs.promises.rename(tmpPath, filePath);
  guardian?.recordWorldWrite(state);
  publishWorldChange({ kind: 'world' });
}

// Serialize complete read-modify-write operations, including scheduler updates.
// Atomic rename alone does not prevent two callers from overwriting each other.
let mutationQueue: Promise<unknown> = Promise.resolve();
export function withWorldMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutationQueue.then(operation, operation);
  mutationQueue = result.then(() => undefined, () => undefined);
  return result;
}
