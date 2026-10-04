import type { FlashcardRatingCommand } from '../../shared/flashcardRating';
import fs from 'fs';
import path from 'path';
import { BrowserWindow, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { KnowledgeEventLog } from '../../shared/knowledgeEvents';
import type { KeyHistorySummary, KeyKnowledgeState, KnowledgeArchiveEnvelope, KnowledgeEventCursor, KnowledgeEventPage, GrammarProjectionMap } from '../../shared/knowledge/historyQueries';
import { KNOWLEDGE_STORE_SCHEMA_VERSION, KnowledgeHistoryStore, STORE_FILE_NAME, isKnowledgeEvent } from './knowledgeHistoryStore';
import { getUserDataPath } from '../utils/platform';
import { getLogger } from '../../shared/utils/logger';
import { guardianForWrites } from './guardian';
import { startupMark, startupTime } from '../startupTiming';
import { LearningEvidenceReader } from './learningEvidenceReader';

const log = getLogger('electron.knowledgeEvents');
const LEGACY_FILE_NAME = 'knowledge-events.json';
const SAVE_DEBOUNCE_MS = 300;
/** Bounded incremental compaction work per debounced save. */
const COMPACTION_BUDGET_PER_SAVE = 50;
const LEGACY_OBJECT_IPC_MAX_BYTES = 512 * 1024;

let store: KnowledgeHistoryStore | undefined;
let learningEvidenceReader: LearningEvidenceReader | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let writeQueue: Promise<void> = Promise.resolve();
let readyPromise: Promise<void> = Promise.resolve();
const grammarProjectionCache = new Map<string, { sequence: number; projections: GrammarProjectionMap }>();

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

/** Internal persistence ownership; these records are not learner evidence. */
export const reserveRatingCommand = (command: FlashcardRatingCommand, validateAdmission?: () => void) => ensureStore().reserveRatingCommand(command, validateAdmission);
export const ratingLedgerId = (): string => ensureStore().ratingLedgerId;
export const pendingRatingCommands = () => ensureStore().pendingRatingCommands();
export const isRatingCommandCommitted = (attemptId: string): boolean => ensureStore().isRatingCommandCommitted(attemptId);
export const completeRatingCommands = (throughSequence: number, revision: number): void => ensureStore().completeRatingCommands(throughSequence, revision);

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
  try {
    const backup = fs.existsSync(backupPath)
      ? JSON.parse(fs.readFileSync(backupPath, 'utf-8')) as KnowledgeEventLog : undefined;
    if (active.schemaVersion < 2 && backup) {
      const result = active.reclassifyFromBackup(backup, now);
      if (result.skipped > 0) log.warn(`[knowledgeEvents] attempt reclassification deferred ${result.skipped} keys lacking import boundaries`);
      if (!result.verified) {
        log.error('[knowledgeEvents] attempt reclassification failed verification; retrying next boot');
        return;
      }
    }
    // Existing generation-2 history needs identity seeding, never reclassification.
    active.backfillObservationIdentities(backup);
  } catch (error) {
    log.error('[knowledgeEvents] history upgrade failed; retrying next boot:', error);
  }
}

export function loadKnowledgeEvents(now = Date.now()): Promise<KnowledgeEventLog> {
  grammarProjectionCache.clear();
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
      grammarProjectionCache.clear();
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
  const before = active.sequenceCounter;
  active.appendEvents(eventsByKey);
  // Sequence reservations count inserted rows, after validation/deduplication.
  // Retrying durable observations must not invent evidence in Guardian's ledger
  // or invalidate every window's knowledge a second time.
  const appended = active.sequenceCounter - before;
  if (!appended) return;
  guardianForWrites()?.recordKnowledgeSequence(active.sequenceCounter, appended,
    Object.entries(eventsByKey).filter(([, events]) => events.some(isKnowledgeEvent)).map(([key]) => key));
  scheduleSave();
  const changedKeys = Object.entries(eventsByKey).filter(([, events]) => events.some(isKnowledgeEvent)).map(([key]) => key);
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.KNOWLEDGE_EVENTS_CHANGED, changedKeys);
  }
}

/** Exact rows (ledger + tail + acquisition residue) for the given keys. */
export function getKnowledgeEvents(keys: readonly string[]): KnowledgeEventLog {
  return ensureStore().getExactEvents(keys);
}

function assertLegacyObjectReplyBounded(keys: readonly string[]): void {
  if (ensureStore().exactEventJsonBytesOver(keys, LEGACY_OBJECT_IPC_MAX_BYTES)) {
    throw new Error('Exact knowledge history exceeds the object IPC limit; use paged event reads');
  }
}

export function pageKnowledgeEvents(key: string, after: KnowledgeEventCursor | null, maxSeq?: number, fragmentOffset?: number, itemOnly?: boolean): KnowledgeEventPage {
  return ensureStore().pageExactEvents(key, after, maxSeq, fragmentOffset, itemOnly);
}

export function queryGrammarProjections(language: string): GrammarProjectionMap {
  const active = ensureStore();
  const sequence = active.sequenceCounter;
  const cached = grammarProjectionCache.get(language);
  if (cached?.sequence === sequence) return cached.projections;
  const projections = active.getGrammarProjections(language);
  grammarProjectionCache.set(language, { sequence, projections });
  return projections;
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

export function getAddressedKnowledgeKeys(language: string, ids: readonly string[]): string[] {
  return ensureStore().queryAddressedKeys(language, ids);
}

export function getAddressedKnowledgeIds(keys: readonly string[]): string[] {
  return ensureStore().queryAddressedIds(keys);
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

  ipcMain.handle(IPC_CHANNELS.LEARNING_DECISION_RECORD, async (_event, decision: import('../../shared/learningDecision').LearningDecision) => {
    await whenKnowledgeEventsReady();
    ensureStore().recordLearningDecision(decision);
  });
  ipcMain.handle(IPC_CHANNELS.LEARNING_DECISION_GET, async (_event, id: string) => {
    await whenKnowledgeEventsReady();
    if (typeof id !== 'string' || !id) throw new Error('Invalid learning decision identity');
    return ensureStore().getLearningDecisionRecord(id);
  });
  ipcMain.handle(IPC_CHANNELS.RATING_UNDO_HISTORY, async (_event, surface: string) => {
    await whenKnowledgeEventsReady();
    return ensureStore().getRatingUndoHistory(surface);
  });

  ipcMain.handle(IPC_CHANNELS.KNOWLEDGE_EVENTS_APPEND, async (_event, eventsByKey: KnowledgeEventLog) => {
    // TEMP DIAGNOSTIC: opt-in via the mlearn.ratingTrace file flag, since the
    // main process has no localStorage. `touch <userData>/ratingTrace.flag`.
    const traceOn = fs.existsSync(path.join(getUserDataPath(), 'ratingTrace.flag'));
    const t0 = Date.now();
    await whenKnowledgeEventsReady();
    if (traceOn) console.log(`[MAIN append] ready=${(Date.now() - t0).toFixed(1)}ms`);
    const t1 = Date.now();
    await appendKnowledgeEvents(eventsByKey);
    if (traceOn) console.log(`[MAIN append] appendKnowledgeEvents=${(Date.now() - t1).toFixed(1)}ms`);
    return true;
  });
  ipcMain.handle(IPC_CHANNELS.LEARNING_EVIDENCE_QUERY, async (_event, language: string) => {
    await whenKnowledgeEventsReady();
    const sequence = ensureStore().sequenceCounter;
    learningEvidenceReader ??= new LearningEvidenceReader(getStorePath());
    return learningEvidenceReader.query(language, sequence);
  });
  ipcMain.handle(IPC_CHANNELS.KNOWLEDGE_EVENTS_QUERY, async (_event, keys: string[]) => {
    await whenKnowledgeEventsReady();
    assertLegacyObjectReplyBounded(keys);
    return getKnowledgeEvents(keys);
  });
  ipcMain.handle(IPC_CHANNELS.KNOWLEDGE_EVENTS_PAGE, async (_event, key: string, after: KnowledgeEventCursor | null, maxSeq?: number, fragmentOffset?: number, itemOnly?: boolean) => {
    await whenKnowledgeEventsReady();
    return pageKnowledgeEvents(key, after, maxSeq, fragmentOffset, itemOnly);
  });
  ipcMain.handle(IPC_CHANNELS.KNOWLEDGE_GRAMMAR_PROJECTIONS_QUERY, async (_event, language: string) => {
    await whenKnowledgeEventsReady();
    return queryGrammarProjections(language);
  });
  ipcMain.handle(IPC_CHANNELS.KNOWLEDGE_EVENTS_QUERY_LANGUAGE, async (_event, language: string) => {
    await whenKnowledgeEventsReady();
    const keys = queryLanguageKeys(language);
    assertLegacyObjectReplyBounded(keys);
    return getKnowledgeEvents(keys);
  });
  ipcMain.handle(IPC_CHANNELS.KNOWLEDGE_EVENTS_GET, async (_event, key: string) => {
    await whenKnowledgeEventsReady();
    assertLegacyObjectReplyBounded([key]);
    return getKnowledgeEvents([key]);
  });
  ipcMain.handle(IPC_CHANNELS.KNOWLEDGE_ROWS_QUERY, async (_event, keys: string[]) => {
    await whenKnowledgeEventsReady();
    assertLegacyObjectReplyBounded(keys);
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
