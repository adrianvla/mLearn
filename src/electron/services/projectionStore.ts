/** Derived, non-journaled memory projections. */

import fs from 'fs';
import path from 'path';
import { getUserDataPath } from '../utils/platform';

export interface ProjectionEntry {
  salience: number;
  lastAccessed: number;
}

export type ProjectionStore = Record<string, Record<string, ProjectionEntry>>;

interface ProjectionFile {
  version: 2;
  contexts: ProjectionStore;
  appliedOperations: Record<string, string[]>;
}

const MAX_APPLIED_OPERATIONS_PER_CONTEXT = 64;

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

async function loadProjectionFile(): Promise<ProjectionFile> {
  try {
    const raw = await fs.promises.readFile(projectionFilePath(), 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { version: 2, contexts: {}, appliedOperations: {} };
    }

    const record = parsed as Record<string, unknown>;
    const rawContexts = record.version === 2 && record.contexts !== null
      && typeof record.contexts === 'object' && !Array.isArray(record.contexts)
      ? record.contexts as Record<string, unknown>
      : record;

    const store: ProjectionStore = {};
    for (const [roomId, entries] of Object.entries(rawContexts)) {
      if (entries === null || typeof entries !== 'object' || Array.isArray(entries)) continue;
      const room: Record<string, ProjectionEntry> = {};
      for (const [eventId, entry] of Object.entries(entries)) {
        if (isProjectionEntry(entry)) room[eventId] = entry;
      }
      store[roomId] = room;
    }
    const appliedOperations: Record<string, string[]> = {};
    if (record.version === 2 && record.appliedOperations !== null
      && typeof record.appliedOperations === 'object' && !Array.isArray(record.appliedOperations)) {
      for (const [contextId, value] of Object.entries(record.appliedOperations as Record<string, unknown>)) {
        if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
          appliedOperations[contextId] = value.slice(-MAX_APPLIED_OPERATIONS_PER_CONTEXT);
        }
      }
    }
    return { version: 2, contexts: store, appliedOperations };
  } catch {
    return { version: 2, contexts: {}, appliedOperations: {} };
  }
}

export async function loadProjectionStore(): Promise<ProjectionStore> {
  return (await loadProjectionFile()).contexts;
}

async function saveProjectionFile(file: ProjectionFile): Promise<void> {
  const filePath = projectionFilePath();
  const tmpPath = `${filePath}.tmp`;
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(tmpPath, JSON.stringify(file, null, 2), 'utf-8');
  await fs.promises.rename(tmpPath, filePath);
}

export async function saveProjectionStore(store: ProjectionStore): Promise<void> {
  const current = await loadProjectionFile();
  await saveProjectionFile({ ...current, contexts: store });
}

/** Apply one reflection's salience contribution exactly once. The operation
 * marker and projection values share one atomic file rename, so recovery can
 * safely repeat this call before settling the maintenance record. */
export async function applyMaintenanceProjection(
  contextId: string,
  operationId: string,
  touchedEventIds: ReadonlySet<string>,
  now: number,
): Promise<void> {
  const file = await loadProjectionFile();
  const applied = file.appliedOperations[contextId] ?? [];
  if (applied.includes(operationId)) return;
  const room = file.contexts[contextId] ?? {};
  for (const [eventId, entry] of Object.entries(room)) {
    room[eventId] = touchedEventIds.has(eventId)
      ? { salience: Math.min(1, entry.salience + 0.2), lastAccessed: now }
      : { ...entry, salience: entry.salience * 0.9 };
  }
  for (const eventId of touchedEventIds) {
    if (room[eventId] === undefined) room[eventId] = { salience: 1, lastAccessed: now };
  }
  file.contexts[contextId] = room;
  file.appliedOperations[contextId] = [...applied, operationId].slice(-MAX_APPLIED_OPERATIONS_PER_CONTEXT);
  await saveProjectionFile(file);
}
