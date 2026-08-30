import fs from 'fs';
import path from 'path';
import { BrowserWindow, ipcMain } from 'electron';
import { IPC_CHANNELS, KNOWLEDGE_ASPECTS, KNOWLEDGE_SOURCES } from '../../shared/constants';
import type { KnowledgeEvent, KnowledgeEventLog } from '../../shared/knowledgeEvents';
import { getUserDataPath } from '../utils/platform';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger('electron.knowledgeEvents');
const FILE_NAME = 'knowledge-events.json';
const ROLLUP_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_ROLLUPS_PER_KEY = 500;
const WARN_TOTAL_EVENTS_PER_KEY = 2000;
const SAVE_DEBOUNCE_MS = 300;

let eventLog: KnowledgeEventLog = {};
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let writeQueue: Promise<void> = Promise.resolve();
let readyPromise: Promise<void> = Promise.resolve();

function getKnowledgeEventsPath(): string {
  return path.join(getUserDataPath(), FILE_NAME);
}

function enqueueWrite(fn: () => Promise<void>): Promise<void> {
  writeQueue = writeQueue.then(fn, fn);
  return writeQueue;
}

function isoWeekKey(timestamp: number): string {
  const date = new Date(timestamp);
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return `${date.getUTCFullYear()}-${week}`;
}

const VALID_KINDS = new Set(['status', 'review', 'rating', 'rollup', 'claim', 'retraction']);
const VALID_ASPECTS = new Set<string>([...KNOWLEDGE_ASPECTS, 'grammar']);
const VALID_SOURCES = new Set<string>([...KNOWLEDGE_SOURCES, 'manual', 'grammar', 'migration']);

function isAttemptId(value: unknown): boolean {
  return typeof value === 'string' || typeof value === 'number';
}

function isKnowledgeEvent(value: unknown): value is KnowledgeEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const event = value as Partial<KnowledgeEvent>;
  if (typeof event.t !== 'number' || !Number.isFinite(event.t)) return false;
  if (!VALID_KINDS.has(event.kind as string)) return false;
  if (!VALID_SOURCES.has(event.source as string)) return false;
  // gender/pronunciation/orthography joined the aspect union after this
  // validator was written; rejecting them here silently dropped their evidence
  // from disk on every reload.
  if (!VALID_ASPECTS.has(event.aspect as string)) return false;
  if (event.kind === 'retraction') return isAttemptId(event.retracts);
  if (event.attemptId !== undefined && !isAttemptId(event.attemptId)) return false;
  if (event.presentedSurface !== undefined && typeof event.presentedSurface !== 'string') return false;
  if (event.targetRef !== undefined) {
    if (!event.targetRef || typeof event.targetRef !== 'object' || Array.isArray(event.targetRef)) return false;
    if (typeof event.targetRef.kind !== 'string' || typeof event.targetRef.id !== 'string') return false;
  }
  return true;
}

function normalizeLog(value: unknown): KnowledgeEventLog {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const logEntries: KnowledgeEventLog = {};
  for (const [key, events] of Object.entries(value)) {
    if (!Array.isArray(events)) continue;
    const validEvents = events.filter(isKnowledgeEvent);
    if (validEvents.length > 0) logEntries[key] = validEvents;
  }
  return logEntries;
}

export function consolidateKnowledgeEvents(logEntries: KnowledgeEventLog, now = Date.now()): KnowledgeEventLog {
  const cutoff = now - ROLLUP_RETENTION_MS;
  const result: KnowledgeEventLog = {};

  for (const [key, events] of Object.entries(logEntries)) {
    const weekly = new Map<string, { latestIndex: number; event: KnowledgeEvent; timesSeenDelta: number }>();
    for (let index = 1; index < events.length; index++) {
      const entry = events[index];
      if (entry.kind !== 'rollup' || entry.t >= cutoff) continue;
      const week = isoWeekKey(entry.t);
      const existing = weekly.get(week);
      if (existing) {
        existing.timesSeenDelta += entry.timesSeenDelta ?? 0;
        if (entry.t >= existing.event.t) {
          existing.latestIndex = index;
          existing.event = entry;
        }
      } else {
        weekly.set(week, { latestIndex: index, event: entry, timesSeenDelta: entry.timesSeenDelta ?? 0 });
      }
    }

    if (weekly.size === 0) {
      result[key] = [...events];
      continue;
    }

    const latestByIndex = new Map<number, KnowledgeEvent>();
    const consolidatedIndexes = new Set<number>();
    for (const value of weekly.values()) {
      latestByIndex.set(value.latestIndex, { ...value.event, timesSeenDelta: value.timesSeenDelta });
    }
    for (let index = 1; index < events.length; index++) {
      const entry = events[index];
      if (entry.kind === 'rollup' && entry.t < cutoff) consolidatedIndexes.add(index);
    }

    result[key] = events.flatMap((entry, index) => {
      if (!consolidatedIndexes.has(index)) return [entry];
      const consolidated = latestByIndex.get(index);
      return consolidated ? [consolidated] : [];
    });
  }

  return result;
}

export function retainKnowledgeEvents(events: readonly KnowledgeEvent[]): KnowledgeEvent[] {
  const retained = [...events];
  const firstEvent = retained[0];
  const removable = retained
    .map((event, index) => ({ event, index }))
    .filter(({ event, index }) => index > 0 && event.kind === 'rollup')
    .sort((a, b) => a.event.t - b.event.t || a.index - b.index);
  const rollupCount = retained.filter(({ kind }) => kind === 'rollup').length;
  const protectedAnchorIsRollup = firstEvent?.kind === 'rollup';
  const allowedRollups = MAX_ROLLUPS_PER_KEY + (protectedAnchorIsRollup ? 1 : 0);
  const removeCount = Math.max(0, rollupCount - allowedRollups);
  const indicesToRemove = new Set(removable.slice(0, removeCount).map(({ index }) => index));
  return retained.filter((_, index) => !indicesToRemove.has(index));
}

function applyRetention(logEntries: KnowledgeEventLog): KnowledgeEventLog {
  return Object.fromEntries(
    Object.entries(logEntries).map(([key, events]) => [key, retainKnowledgeEvents(events)]),
  );
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    void saveKnowledgeEvents();
  }, SAVE_DEBOUNCE_MS);
}

/** Resolves once the event log has finished loading from disk; IPC handlers gate on this. */
export function whenKnowledgeEventsReady(): Promise<void> {
  return readyPromise;
}

export function loadKnowledgeEvents(now = Date.now()): Promise<KnowledgeEventLog> {
  const load = (async () => {
    try {
      const filePath = getKnowledgeEventsPath();
      const loaded = normalizeLog(JSON.parse(await fs.promises.readFile(filePath, 'utf-8')) as unknown);
      const consolidated = applyRetention(consolidateKnowledgeEvents(loaded, now));
      eventLog = consolidated;
      if (JSON.stringify(loaded) !== JSON.stringify(consolidated)) await saveKnowledgeEvents();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.error('Failed to load knowledge events:', error);
      }
      eventLog = {};
    }
    return getKnowledgeEvents(Object.keys(eventLog));
  })();
  readyPromise = load.then(() => undefined);
  return load;
}

export async function saveKnowledgeEvents(): Promise<void> {
  eventLog = applyRetention(eventLog);
  for (const [key, events] of Object.entries(eventLog)) {
    if (events.length > WARN_TOTAL_EVENTS_PER_KEY) {
      log.warn(`[knowledgeEvents] ${key} has ${events.length} events; retaining all protected history`);
    }
  }
  return enqueueWrite(async () => {
    try {
      const filePath = getKnowledgeEventsPath();
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      const tmpPath = `${filePath}.tmp`;
      await fs.promises.writeFile(tmpPath, JSON.stringify(eventLog, null, 2));
      await fs.promises.rename(tmpPath, filePath);
    } catch (error) {
      log.error('Failed to save knowledge events:', error);
    }
  });
}

export async function appendKnowledgeEvents(eventsByKey: KnowledgeEventLog): Promise<void> {
  for (const [key, events] of Object.entries(eventsByKey)) {
    if (!events.length) continue;
    eventLog[key] = retainKnowledgeEvents([...(eventLog[key] ?? []), ...events]);
  }
  scheduleSave();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.KNOWLEDGE_EVENTS_CHANGED);
  }
}

export function getKnowledgeEvents(keys: readonly string[]): KnowledgeEventLog {
  return Object.fromEntries(
    keys.flatMap((key) => eventLog[key] ? [[key, [...eventLog[key]]] as const] : []),
  );
}

export function getKnowledgeEventsForLanguage(language: string): KnowledgeEventLog {
  const prefix = `${language}:`;
  return Object.fromEntries(
    Object.entries(eventLog).flatMap(([key, events]) => key.startsWith(prefix) ? [[key, [...events]] as const] : []),
  );
}

export function setupKnowledgeEventsIPC(): void {
  void loadKnowledgeEvents();

  ipcMain.handle(IPC_CHANNELS.KNOWLEDGE_EVENTS_APPEND, async (_event, eventsByKey: KnowledgeEventLog) => {
    await whenKnowledgeEventsReady();
    await appendKnowledgeEvents(eventsByKey);
    return true;
  });
  ipcMain.handle(IPC_CHANNELS.KNOWLEDGE_EVENTS_QUERY, async (_event, keys: string[]) => {
    await whenKnowledgeEventsReady();
    return getKnowledgeEvents(keys);
  });
  ipcMain.handle(IPC_CHANNELS.KNOWLEDGE_EVENTS_QUERY_LANGUAGE, async (_event, language: string) => {
    await whenKnowledgeEventsReady();
    return getKnowledgeEventsForLanguage(language);
  });
  ipcMain.handle(IPC_CHANNELS.KNOWLEDGE_EVENTS_GET, async (_event, key: string) => {
    await whenKnowledgeEventsReady();
    return getKnowledgeEvents([key]);
  });
}
