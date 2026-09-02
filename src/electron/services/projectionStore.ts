/** Derived, non-journaled memory projections. */

import fs from 'fs';
import path from 'path';
import { getUserDataPath } from '../utils/platform';

export interface ProjectionEntry {
  salience: number;
  lastAccessed: number;
}

export type ProjectionStore = Record<string, Record<string, ProjectionEntry>>;

function projectionFilePath(): string {
  return path.join(getUserDataPath(), 'projection-store.json');
}

function isProjectionEntry(value: unknown): value is ProjectionEntry {
  return (
    value !== null &&
    typeof value === 'object' &&
    'salience' in value &&
    typeof value.salience === 'number' &&
    Number.isFinite(value.salience) &&
    'lastAccessed' in value &&
    typeof value.lastAccessed === 'number' &&
    Number.isFinite(value.lastAccessed)
  );
}

export async function loadProjectionStore(): Promise<ProjectionStore> {
  try {
    const raw = await fs.promises.readFile(projectionFilePath(), 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const store: ProjectionStore = {};
    for (const [roomId, entries] of Object.entries(parsed)) {
      if (entries === null || typeof entries !== 'object' || Array.isArray(entries)) continue;
      const room: Record<string, ProjectionEntry> = {};
      for (const [eventId, entry] of Object.entries(entries)) {
        if (isProjectionEntry(entry)) room[eventId] = entry;
      }
      store[roomId] = room;
    }
    return store;
  } catch {
    return {};
  }
}

export async function saveProjectionStore(store: ProjectionStore): Promise<void> {
  const filePath = projectionFilePath();
  const tmpPath = `${filePath}.tmp`;
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(tmpPath, JSON.stringify(store, null, 2), 'utf-8');
  await fs.promises.rename(tmpPath, filePath);
}
