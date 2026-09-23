import fs from 'fs';
import path from 'path';
import { BrowserWindow, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { KnowledgeEventLog } from '../../shared/knowledgeEvents';
import type { KeyHistorySummary, KeyKnowledgeState, KnowledgeArchiveEnvelope } from '../../shared/knowledge/historyQueries';
import { KNOWLEDGE_STORE_SCHEMA_VERSION, KnowledgeHistoryStore, STORE_FILE_NAME, isKnowledgeEvent } from './knowledgeHistoryStore';
import { getUserDataPath } from '../utils/platform';
import { getLogger } from '../../shared/utils/logger';
import { guardianForWrites } from './guardian';
import { startupMark, startupTime } from '../startupTiming';

const log = getLogger('electron.knowledgeEvents');
const LEGACY_FILE_NAME = 'knowledge-events.json';
const SAVE_DEBOUNCE_MS = 300;
/** Bounded incremental compaction work per debounced save. */
const COMPACTION_BUDGET_PER_SAVE = 50;

let store: KnowledgeHistoryStore | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let writeQueue: Promise<void> = Promise.resolve();
let readyPromise: Promise<void> = Promise.resolve();

function getStorePath(): string {
  return path.join(getUserDataPath(), STORE_FILE_NAME);
}

function getLegacyPath(): string {
  return path.join(getUserDataPath(), LEGACY_FILE_NAME);
}

function ensureStore(): KnowledgeHistoryStore {
  if (!store) {
    const started = startupTime();
    store = KnowledgeHistoryStore.open(getStorePath());
    startupMark('knowledge DB open and schema initialization complete', started);
  }
  return store;
}

function enqueueWrite(fn: () => Promise<void>): Promise<void> {
  writeQueue = writeQueue.then(fn, fn);
  return writeQueue;
}

function scheduleSave(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    void saveKnowledgeEvents();
  }, SAVE_DEBOUNCE_MS);
}

/** Resolves once the store has finished opening/migrating; IPC handlers gate on this. */
export function whenKnowledgeEventsReady(): Promise<void> {
  return readyPromise;
}

/**
 * Open the store and, on first run, migrate the legacy JSON journal.
 * Migration is verified per key (projection equivalence); on success the
 * legacy file is renamed to `knowledge-events.json.migrated` (kept as the
 * quarantine/recovery backup), on failure the store is wiped and migration
 * retries next boot — the legacy file stays untouched and authoritative.
 */
function openAndMigrate(now = Date.now()): void {
  const started = startupTime();
  const active = ensureStore();
  if (!active.migrationPending) {
    ensureSchemaCurrent(active, now);
    startupMark('knowledge DB migrations complete (existing store)', started);
    return;
  }
  const legacyPath = getLegacyPath();
  if (!fs.existsSync(legacyPath)) {
    // No legacy journal: fresh install (or already-migrated profile).
    active.markMigrationDone();
    ensureSchemaCurrent(active, now);
    startupMark('knowledge DB migrations complete (no legacy journal)', started);
    return;
  }
  const raw = fs.readFileSync(legacyPath, 'utf-8');
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    active.markMigrationDone();
    ensureSchemaCurrent(active, now);
    startupMark('knowledge DB migrations complete (empty legacy journal)', started);
    return;
  }
  const result = active.importLegacyLog(parsed as KnowledgeEventLog, now);
  if (!result.verified) {
    active.resetForReimport();
    throw new Error('knowledge history migration failed projection verification; store reset for retry');
  }
  active.markMigrationDone();
  fs.renameSync(legacyPath, `${legacyPath}.migrated`);
  log.info(`[knowledgeEvents] migrated journal: ${result.keys} keys, ${result.events} events`);
  ensureSchemaCurrent(active, now);
  startupMark('knowledge DB migrations complete (legacy import)', started);
}

/**
 * Generation-2 upgrade: compact native attempts via contribution records.
 * Runs after legacy migration on every boot until the schema version flips.
 * Source of truth for reclassification is the verified `.migrated` backup;
 * keys migrated before the import-boundary marker existed are skipped
 * (deferred, never speculatively rewritten) and keep their exact-attempt
 * path. A store without a backup either has nothing to reclassify or was
 * created post-v2.
 */
function ensureSchemaCurrent(active: KnowledgeHistoryStore, now: number): void {
  if (active.schemaVersion >= KNOWLEDGE_STORE_SCHEMA_VERSION) return;
  const backupPath = `${getLegacyPath()}.migrated`;
  if (fs.existsSync(backupPath)) {
    try {
      const backup = JSON.parse(fs.readFileSync(backupPath, 'utf-8')) as KnowledgeEventLog;
      const result = active.reclassifyFromBackup(backup, now);
      if (result.skipped > 0) {
        log.warn(`[knowledgeEvents] v2 reclassification deferred ${result.skipped} keys lacking import boundaries`);
      }
      if (!result.verified) {
        log.error('[knowledgeEvents] v2 reclassification failed projection verification; left on v1 semantics for retry');
        return;
      }
      log.info(`[knowledgeEvents] reclassified history for attempt compaction: ${result.keys} keys`);
    } catch (error) {
      log.error('[knowledgeEvents] v2 reclassification failed; retrying next boot:', error);
      return;
    }
  } else {
    active.markSchemaVersion(KNOWLEDGE_STORE_SCHEMA_VERSION);
  }
}

export function loadKnowledgeEvents(now = Date.now()): Promise<KnowledgeEventLog> {
  const load = (async () => {
    openAndMigrate(now);
    return {};
  })();
  readyPromise = load.then(() => undefined);
  return load;
}

/**
 * Durability barrier for journal-first ingestion (REQ59): appends are already
 * committed synchronously by the store; a save flushes the bounded
 * incremental compaction pass.
 */
export async function saveKnowledgeEvents(): Promise<void> {
  const active = ensureStore();
  return enqueueWrite(async () => {
    try {
      active.compact(Date.now(), COMPACTION_BUDGET_PER_SAVE);
      guardianForWrites()?.recordKnowledgeSequence(active.sequenceCounter);
    } catch (error) {
      log.error('Failed to compact knowledge history:', error);
    }
  });
}

export async function appendKnowledgeEvents(eventsByKey: KnowledgeEventLog): Promise<void> {
  const hasAny = Object.values(eventsByKey).some((events) => events.length > 0);
  if (!hasAny) return;
  const active = ensureStore();
  active.appendEvents(eventsByKey);
  const appended = Object.values(eventsByKey).reduce((count, events) => count + events.filter(isKnowledgeEvent).length, 0);
  guardianForWrites()?.recordKnowledgeSequence(active.sequenceCounter, appended,
    Object.entries(eventsByKey).filter(([, events]) => events.some(isKnowledgeEvent)).map(([key]) => key));
  scheduleSave();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.KNOWLEDGE_EVENTS_CHANGED);
  }
}

/** Exact rows (ledger + tail + acquisition residue) for the given keys. */
export function getKnowledgeEvents(keys: readonly string[]): KnowledgeEventLog {
  return ensureStore().getExactEvents(keys);
}

export function getKnowledgeEventsForLanguage(language: string): KnowledgeEventLog {
  const active = ensureStore();
  return active.getExactEvents(active.queryLanguageKeys(language));
}

/** Exact rows WITH stable journal seq — required for archive-aware replay. */
export function getKnowledgeRows(keys: readonly string[]): Record<string, Array<{ event: import('../../shared/knowledgeEvents').KnowledgeEvent; seq: number }>> {
  const active = ensureStore();
  const result: Record<string, Array<{ event: import('../../shared/knowledgeEvents').KnowledgeEvent; seq: number }>> = {};
  for (const key of keys) {
    result[key] = active.rowsWithSeq(key);
  }
  return result;
}

export function getKnowledgeStates(keys: readonly string[]): Record<string, KeyKnowledgeState> {
  const active = ensureStore();
  const result: Record<string, KeyKnowledgeState> = {};
  for (const key of keys) {
    result[key] = active.getKnowledgeState(key);
  }
  return result;
}

export function getKnowledgeArchives(keys: readonly string[]): KnowledgeArchiveEnvelope[] {
  const active = ensureStore();
  return keys.map((key) => ({ key, archive: active.getArchive(key) }));
}

export function getKnowledgeArchive(key: string): KnowledgeArchiveEnvelope {
  return { key, archive: ensureStore().getArchive(key) };
}

export function queryKeySummaries(language: string): Record<string, KeyHistorySummary> {
  return ensureStore().queryKeySummaries(language);
}

export function queryAnkiReviewIds(language: string, ids: readonly number[]): boolean[] {
  return ensureStore().hasAnkiReviewIds(language, ids);
}

export function queryAnkiReviewIdSets(keys: readonly string[]): Record<string, number[]> {
  return ensureStore().getAnkiReviewIdsByKeys(keys);
}

export function queryLanguageKeys(language: string, prefix?: string): string[] {
  return ensureStore().queryLanguageKeys(language, prefix);
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
  ipcMain.handle(IPC_CHANNELS.KNOWLEDGE_ROWS_QUERY, async (_event, keys: string[]) => {
    await whenKnowledgeEventsReady();
    return getKnowledgeRows(keys);
  });
  ipcMain.handle(IPC_CHANNELS.KNOWLEDGE_STATES_QUERY, async (_event, keys: string[]) => {
    await whenKnowledgeEventsReady();
    return getKnowledgeStates(keys);
  });
  ipcMain.handle(IPC_CHANNELS.KNOWLEDGE_ARCHIVE_QUERY, async (_event, key: string) => {
    await whenKnowledgeEventsReady();
    return getKnowledgeArchive(key);
  });
  ipcMain.handle(IPC_CHANNELS.KNOWLEDGE_SUMMARIES_QUERY, async (_event, language: string) => {
    await whenKnowledgeEventsReady();
    return queryKeySummaries(language);
  });
  ipcMain.handle(IPC_CHANNELS.KNOWLEDGE_ANKI_IDS_QUERY, async (_event, language: string, ids: number[]) => {
    await whenKnowledgeEventsReady();
    return queryAnkiReviewIds(language, ids);
  });
  ipcMain.handle(IPC_CHANNELS.KNOWLEDGE_ANKI_ID_SETS_QUERY, async (_event, keys: string[]) => {
    await whenKnowledgeEventsReady();
    return queryAnkiReviewIdSets(keys);
  });
  ipcMain.handle(IPC_CHANNELS.KNOWLEDGE_LANGUAGE_KEYS, async (_event, language: string, prefix?: string) => {
    await whenKnowledgeEventsReady();
    return queryLanguageKeys(language, prefix);
  });
}
