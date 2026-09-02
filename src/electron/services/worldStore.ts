/**
 * World Store — rooms/threads/participants entity persistence.
 * One JSON file ({userData}/world.json), written atomically (tmp + rename).
 * Callers save explicitly; no debounce. No IPC here — wiring is a later wave.
 */

import fs from 'fs';
import path from 'path';
import { getUserDataPath } from '../utils/platform';
import { getLogger } from '../../shared/utils/logger';
import type { Participant, Room, Thread } from '../../shared/world';

const log = getLogger('electron.world');

export interface WorldState {
  rooms: Room[];
  threads: Thread[];
  participants: Participant[];
}

function worldFilePath(): string {
  return path.join(getUserDataPath(), 'world.json');
}

export async function loadWorld(): Promise<WorldState> {
  try {
    const filePath = worldFilePath();
    try {
      await fs.promises.access(filePath);
    } catch {
      return { rooms: [], threads: [], participants: [] };
    }
    const raw = await fs.promises.readFile(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      log.warn('[worldStore] world.json is not a plain object — using empty world');
      return { rooms: [], threads: [], participants: [] };
    }
    const state = parsed as Partial<WorldState>;
    return {
      rooms: Array.isArray(state.rooms) ? state.rooms : [],
      threads: Array.isArray(state.threads) ? state.threads : [],
      participants: Array.isArray(state.participants) ? state.participants : [],
    };
  } catch (error) {
    log.warn('[worldStore] Failed to load world.json — using empty world:', error);
    return { rooms: [], threads: [], participants: [] };
  }
}

export async function saveWorld(state: WorldState): Promise<void> {
  const filePath = worldFilePath();
  const tmpPath = `${filePath}.tmp`;
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
  await fs.promises.rename(tmpPath, filePath);
}
