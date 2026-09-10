import { DatabaseSync } from 'node:sqlite';
import type { KnowledgeEvent, KnowledgeEventLog } from '../../shared/knowledgeEvents';
import { eventCapability } from '../../shared/knowledgeEvents';
import {
  applyEventToFold,
  emptyKeyFold,
  mergeKeyFolds,
  projectKeyFold,
  replayKeyProjection,
  type FoldState,
  type ReplayProjection,
} from '../../shared/utils/projectionReplay';
import {
  applyTransitions,
  bucketRepresentative,
  compactKeyEvents,
  emptyTransitions,
  foldFromArchive,
  isAggregatableEvent,
  KNOWLEDGE_ARCHIVE_TAIL_MS,
  KNOWLEDGE_ACQUISITION_WINDOW_MS,
  type KeyArchive,
  type TransitionsState,
} from '../../shared/knowledge/historyArchive';
import { getLogger } from '../../shared/utils/logger';
import { isValidCapabilityId } from '../../shared/graph/access';
import { KNOWLEDGE_ASPECTS, KNOWLEDGE_SOURCES } from '../../shared/constants';

const log = getLogger('electron.knowledgeHistoryStore');

// ─── Journal validation (port of the legacy normalizeLog guard) ───
const VALID_KINDS = new Set(['status', 'review', 'rating', 'rollup', 'claim', 'retraction']);
const VALID_ASPECTS = new Set<string>([...KNOWLEDGE_ASPECTS, 'grammar']);
const VALID_SOURCES = new Set<string>([...KNOWLEDGE_SOURCES, 'manual', 'grammar', 'migration']);

function isAttemptId(value: unknown): boolean {
  return typeof value === 'string' || typeof value === 'number';
}

export function isKnowledgeEvent(value: unknown): value is KnowledgeEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const event = value as Partial<KnowledgeEvent>;
  if (typeof event.t !== 'number' || !Number.isFinite(event.t)) return false;
  if (!VALID_KINDS.has(event.kind as string)) return false;
  if (!VALID_SOURCES.has(event.source as string)) return false;
  // Epistemic address: every non-retraction event carries EITHER a legacy
  // aspect value OR a canonical targetRef.capability (core or namespaced
  // package id). Aspect-less capability-addressed events are the new normal.
  if (event.kind === 'retraction') return isAttemptId(event.retracts);
  if (event.aspect === undefined && !isValidCapabilityId(event.targetRef?.capability)) return false;
  if (event.aspect !== undefined && !VALID_ASPECTS.has(event.aspect)) return false;
  if (event.attemptId !== undefined && !isAttemptId(event.attemptId)) return false;
  if (event.presentedSurface !== undefined && typeof event.presentedSurface !== 'string') return false;
  if (event.targetRef !== undefined) {
    if (!event.targetRef || typeof event.targetRef !== 'object' || Array.isArray(event.targetRef)) return false;
    if (typeof event.targetRef.kind !== 'string' || typeof event.targetRef.id !== 'string') return false;
    if (event.targetRef.capability !== undefined && !isValidCapabilityId(event.targetRef.capability)) return false;
  }
  if (event.taskType !== undefined && (typeof event.taskType !== 'string' || event.taskType.length === 0)) return false;
  if (event.scaffolds !== undefined) {
    if (!event.scaffolds || typeof event.scaffolds !== 'object' || Array.isArray(event.scaffolds)) return false;
    for (const visible of Object.values(event.scaffolds)) {
      if (typeof visible !== 'boolean') return false;
    }
  }
  return true;
}

export const KNOWLEDGE_STORE_SCHEMA_VERSION = 1;
export const KNOWLEDGE_STORE_FOLD_VERSION = 1;
export const STORE_FILE_NAME = 'knowledge-history.sqlite3';
/** Maximum keys compacted per pass — bounded incremental work. */
export const COMPACTION_KEY_BUDGET = 200;

export interface KeyKnowledgeState {
  projection: ReplayProjection | null;
  /** True when the key has an archive (aggregated old evidence exists). */
  hasArchive: boolean;
  /** Rows summarized by the archive. */
  archivedEventCount: number;
  /** t of the oldest evidence the archive summarizes. */
  archiveFirstT?: number;
}

export interface KeyHistorySummary {
  firstT?: number;
  lastT?: number;
  /** Exact rows still stored for this key. */
  exactRows: number;
  /** Rows summarized by the archive. */
  archivedRows: number;
  /** Cohort transitions (sense-routed buckets merged with sense-routed exact rows). */
  firstKnownT?: number;
  stableKnownT?: number;
  lapsedAfterFirstKnown: boolean;
}

interface CheckpointRow {
  fold: FoldState;
  frontierSeq: number;
  foldVersion: number;
}

/**
 * Journal-order identity: `seq` is a store-wide monotonic counter persisted in
 * `meta`, NOT the SQLite rowid — compaction re-inserts kept rows with their
 * original seq values, so (t, seq) ordering is stable across compaction.
 */
class SeqCounter {
  constructor(private db: DatabaseSync) {}
  next(): number {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'seqCounter'").get() as { value?: string } | undefined;
    const next = (row?.value !== undefined ? Number(row.value) : 0) + 1;
    this.db.prepare("INSERT INTO meta (key, value) VALUES ('seqCounter', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(next));
    return next;
  }
}

function rowsWithSeq(db: DatabaseSync, key: string): Array<{ event: KnowledgeEvent; seq: number }> {
  const rows = db.prepare('SELECT seq, json FROM rows WHERE key = ? ORDER BY t, seq').all(key) as Array<{ seq: number; json: string }>;
  return rows.map((row) => ({ event: JSON.parse(row.json) as KnowledgeEvent, seq: row.seq }));
}

function stripRetractedRows(rows: Array<{ event: KnowledgeEvent; seq: number }>): Array<{ event: KnowledgeEvent; seq: number }> {
  const retracted = new Set<string>();
  for (const { event } of rows) {
    if (event.retracts !== undefined) retracted.add(`${event.retracts}`);
  }
  if (retracted.size === 0) return rows.filter(({ event }) => event.kind !== 'retraction');
  return rows.filter(({ event }) => {
    if (event.retracts !== undefined || event.kind === 'retraction') return false;
    return !(event.attemptId !== undefined && retracted.has(`${event.attemptId}`));
  });
}

/**
 * Canonical fold of one key: the archived prefix folds first, the exact rows
 * fold separately, and the two partial folds merge by marker (t, seq) —
 * exact rows may interleave with (or precede) archived rows, and evidence
 * markers are order-sensitive.
 */
function foldRowsAndArchive(rows: Array<{ event: KnowledgeEvent; seq: number }>, archive: KeyArchive | undefined): FoldState {
  const active = stripRetractedRows(rows);
  const sorted = [...active].sort((a, b) => a.event.t - b.event.t || a.seq - b.seq);
  const exactFold = emptyKeyFold();
  for (const { event, seq } of sorted) {
    applyEventToFold(exactFold, event, seq);
  }
  return archive ? mergeKeyFolds(foldFromArchive(archive), exactFold) : exactFold;
}

function minDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}

/**
 * Cohort-transition merge. `pendingCandidateT` is preserved: a candidate can
 * sit at the archive frontier with its 30-day lapse window still open, and a
 * later exact-row continuation must resolve the SAME candidate, not a fresh
 * one.
 */
function mergeTransitions(a: TransitionsState, b: TransitionsState): TransitionsState {
  const firstT = minDefined(a.firstT, b.firstT);
  const firstKnownT = minDefined(a.firstKnownT, b.firstKnownT);
  const stableKnownT = minDefined(a.stableKnownT, b.stableKnownT);
  const pendingCandidateT = minDefined(a.pendingCandidateT, b.pendingCandidateT);
  return {
    lapsedAfterFirstKnown: a.lapsedAfterFirstKnown || b.lapsedAfterFirstKnown,
    ...(firstT !== undefined ? { firstT } : {}),
    ...(firstKnownT !== undefined ? { firstKnownT } : {}),
    ...(stableKnownT !== undefined ? { stableKnownT } : {}),
    ...(pendingCandidateT !== undefined ? { pendingCandidateT } : {}),
  };
}

/**
 * SQLite-backed knowledge-history store.
 *
 * Canonical truth = exact `rows` (ledger + tail + acquisition residue, each
 * with a stable journal-order `seq`) plus per-key `archives` (multi-
 * resolution sufficient statistics). `checkpoints` are a derived cache: each
 * key's full fold, versioned and rebuildable from rows + archives. Appends
 * advance checkpoints incrementally; compaction rewrites a key atomically.
 */
export class KnowledgeHistoryStore {
  private db: DatabaseSync;
  private seq: SeqCounter;

  private constructor(db: DatabaseSync) {
    this.db = db;
    this.migrateSchema();
    this.seq = new SeqCounter(this.db);
  }

  static open(dbPath: string): KnowledgeHistoryStore {
    const db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = NORMAL;');
    return new KnowledgeHistoryStore(db);
  }

  private migrateSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        seq INTEGER NOT NULL,
        key TEXT NOT NULL,
        lang TEXT NOT NULL,
        t INTEGER NOT NULL,
        json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS rows_key_t ON rows(key, t, seq);
      CREATE TABLE IF NOT EXISTS archives (
        key TEXT PRIMARY KEY,
        lang TEXT NOT NULL,
        frontier_t INTEGER NOT NULL,
        json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS checkpoints (
        key TEXT PRIMARY KEY,
        lang TEXT NOT NULL,
        frontier_seq INTEGER NOT NULL,
        json TEXT NOT NULL
      );
    `);
    const setMeta = this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING');
    setMeta.run('schemaVersion', String(KNOWLEDGE_STORE_SCHEMA_VERSION));
    setMeta.run('foldVersion', String(KNOWLEDGE_STORE_FOLD_VERSION));
  }

  /** Whether the legacy JSON import has not been completed yet. */
  get migrationPending(): boolean {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'migration'").get() as { value?: string } | undefined;
    return row?.value !== 'done';
  }

  markMigrationDone(): void {
    this.db
      .prepare("INSERT INTO meta (key, value) VALUES ('migration', 'done') ON CONFLICT(key) DO UPDATE SET value = 'done'")
      .run();
    // One-time reclaim of import/compaction churn on the migrated profile.
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM;');
  }

  languageOfKey(key: string): string {
    const at = key.indexOf(':');
    return at > 0 ? key.slice(0, at) : key;
  }

  /**
   * Import a legacy JSON journal. Per-key atomic: insert the key's rows,
   * compact, verify projection equivalence against the source, and record a
   * progress marker — all in one transaction. Interrupted migrations resume
   * without duplicating rows or corrupting folds (a compacted key is marked
   * done, so count-based re-inserts never run against compacted state).
   */
  importLegacyLog(sourceLog: KnowledgeEventLog, now = Date.now()): { keys: number; events: number; verified: boolean } {
    const insert = this.db.prepare('INSERT INTO rows (seq, key, lang, t, json) VALUES (?, ?, ?, ?, ?)');
    const countRows = this.db.prepare('SELECT COUNT(*) AS n FROM rows WHERE key = ?');
    const getMarker = this.db.prepare("SELECT value FROM meta WHERE key = ?");
    const setMarker = this.db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    let totalEvents = 0;
    let verified = true;

    for (const [key, events] of Object.entries(sourceLog)) {
      if (!events || events.length === 0) continue;
      const markerKey = `mig:${key}`;
      const marker = getMarker.get(markerKey) as { value?: string } | undefined;
      if (marker?.value === String(events.length)) continue;
      const lang = this.languageOfKey(key);
      this.db.exec('BEGIN');
      try {
        const existing = (countRows.get(key) as { n: number }).n;
        for (let index = existing; index < events.length; index++) {
          const event = events[index];
          if (!isKnowledgeEvent(event)) continue; // malformed rows never migrate
          insert.run(this.seq.next(), key, lang, event.t, JSON.stringify(event));
          totalEvents += 1;
        }
        const rows = rowsWithSeq(this.db, key);
        const compact = compactKeyEvents(rows, now);
        this.writeArchiveAndCheckpointLocked(key, compact);
        const state = this.getKnowledgeState(key);
        const expected = replayKeyProjection(events);
        if (JSON.stringify(state.projection) !== JSON.stringify(expected)) {
          verified = false;
          log.error(`[knowledgeHistoryStore] projection mismatch for ${key} — aborting migration`);
          this.db.exec('ROLLBACK');
          break;
        }
        setMarker.run(markerKey, String(events.length));
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    }
    return { keys: Object.keys(sourceLog).length, events: totalEvents, verified };
  }

  /**
   * Drop all store contents (used when a migration verification fails).
   * Migration markers and the sequence counter reset with the data: a retry
   * must re-import every key against the empty store.
   */
  resetForReimport(): void {
    this.db.exec("DELETE FROM rows; DELETE FROM archives; DELETE FROM checkpoints; DELETE FROM meta WHERE key LIKE 'mig:%' OR key = 'seqCounter';");
  }

  /** Atomically rewrite one key's rows/archive/checkpoint from a compaction. */
  private writeArchiveAndCheckpoint(key: string, compact: ReturnType<typeof compactKeyEvents>): void {
    this.db.exec('BEGIN');
    try {
      this.writeArchiveAndCheckpointLocked(key, compact);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** Transaction-body variant — caller owns BEGIN/COMMIT. */
  private writeArchiveAndCheckpointLocked(key: string, compact: ReturnType<typeof compactKeyEvents>): void {
    {
      const lang = this.languageOfKey(key);
      if (compact.archive) {
        this.db
          .prepare(
            'INSERT INTO archives (key, lang, frontier_t, json) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET frontier_t = excluded.frontier_t, json = excluded.json',
          )
          .run(key, lang, compact.archive.frontierT, JSON.stringify(compact.archive));
        this.db.prepare('DELETE FROM rows WHERE key = ?').run(key);
        const insert = this.db.prepare('INSERT INTO rows (seq, key, lang, t, json) VALUES (?, ?, ?, ?, ?)');
        for (const { event, seq } of compact.kept) {
          insert.run(seq, key, lang, event.t, JSON.stringify(event));
        }
      }
      const rows = rowsWithSeq(this.db, key);
      const archive = this.readArchive(key);
      const fold = foldRowsAndArchive(rows, archive);
      const frontierSeq = rows.reduce((max, row) => Math.max(max, row.seq), 0);
      this.db
        .prepare(
          'INSERT INTO checkpoints (key, lang, frontier_seq, json) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET frontier_seq = excluded.frontier_seq, json = excluded.json',
        )
        .run(key, lang, frontierSeq, JSON.stringify({ fold, frontierSeq, foldVersion: KNOWLEDGE_STORE_FOLD_VERSION } satisfies CheckpointRow));
    }
  }

  private readArchive(key: string): KeyArchive | undefined {
    const row = this.db.prepare('SELECT json FROM archives WHERE key = ?').get(key) as { json?: string } | undefined;
    return row?.json ? (JSON.parse(row.json) as KeyArchive) : undefined;
  }

  private checkpoint(key: string): CheckpointRow | undefined {
    const row = this.db.prepare('SELECT json FROM checkpoints WHERE key = ?').get(key) as { json?: string } | undefined;
    if (!row?.json) return undefined;
    const parsed = JSON.parse(row.json) as CheckpointRow;
    if (parsed.foldVersion !== KNOWLEDGE_STORE_FOLD_VERSION) return undefined;
    return parsed;
  }

  /**
   * Append exact rows and advance the checkpoint. Retractions rebuild the
   * key's fold from canonical data (tombstones invalidate folded attempts).
   * Ordinary batches fold separately (ordered by (t, seq)) and merge into the
   * checkpoint by marker timestamps — sync appends may carry rows older than
   * the frontier, and evidence markers are order-sensitive.
   */
  appendEvents(eventsByKey: KnowledgeEventLog): void {
    const insert = this.db.prepare('INSERT INTO rows (seq, key, lang, t, json) VALUES (?, ?, ?, ?, ?)');
    for (const [key, events] of Object.entries(eventsByKey)) {
      if (!events.length) continue;
      const lang = this.languageOfKey(key);
      this.db.exec('BEGIN');
      try {
        const newSeqs: number[] = [];
        for (const event of events) {
          if (!isKnowledgeEvent(event)) {
            log.warn('[knowledgeHistoryStore] dropped malformed event on append', key);
            continue;
          }
          const seq = this.seq.next();
          insert.run(seq, key, lang, event.t, JSON.stringify(event));
          newSeqs.push(seq);
        }
        if (newSeqs.length === 0) {
          this.db.exec('COMMIT');
          continue;
        }
        const checkpoint = this.checkpoint(key);
        const archive = this.readArchive(key);
        const hasTombstone = events.some((event) => event.retracts !== undefined || event.kind === 'retraction');
        let fold: FoldState;
        if (hasTombstone || !checkpoint) {
          fold = foldRowsAndArchive(rowsWithSeq(this.db, key), archive);
        } else {
          const batchFold = emptyKeyFold();
          events
            .map((event, index) => ({ event, seq: newSeqs[index] }))
            .sort((a, b) => a.event.t - b.event.t || a.seq - b.seq)
            .forEach(({ event, seq }) => applyEventToFold(batchFold, event, seq));
          fold = mergeKeyFolds(checkpoint.fold, batchFold);
        }
        const frontierSeq = Math.max(checkpoint?.frontierSeq ?? 0, ...newSeqs);
        this.db
          .prepare(
            'INSERT INTO checkpoints (key, lang, frontier_seq, json) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET frontier_seq = excluded.frontier_seq, json = excluded.json',
          )
          .run(key, lang, frontierSeq, JSON.stringify({ fold, frontierSeq, foldVersion: KNOWLEDGE_STORE_FOLD_VERSION } satisfies CheckpointRow));
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    }
  }

  /** Exact rows (ledger + tail + acquisition residue) for the given keys. */
  getExactEvents(keys: readonly string[]): KnowledgeEventLog {
    const result: KnowledgeEventLog = {};
    const stmt = this.db.prepare('SELECT json FROM rows WHERE key = ? ORDER BY t, seq');
    for (const key of keys) {
      const rows = stmt.all(key) as Array<{ json: string }>;
      if (rows.length > 0) result[key] = rows.map((row) => JSON.parse(row.json) as KnowledgeEvent);
    }
    return result;
  }

  rowsWithSeq(key: string): Array<{ event: KnowledgeEvent; seq: number }> {
    return rowsWithSeq(this.db, key);
  }

  getArchive(key: string): KeyArchive | undefined {
    return this.readArchive(key);
  }

  /**
   * Derived per-key state. Fast path: checkpoint fold (all rows applied).
   * Rows newer than the checkpoint frontier trigger a transparent rebuild.
   */
  getKnowledgeState(key: string): KeyKnowledgeState {
    const archive = this.readArchive(key);
    const checkpoint = this.checkpoint(key);
    let fold: FoldState | undefined;
    if (checkpoint) {
      const maxSeq = this.db.prepare('SELECT MAX(seq) AS maxSeq FROM rows WHERE key = ?').get(key) as { maxSeq: number | null };
      if ((maxSeq.maxSeq ?? 0) <= checkpoint.frontierSeq) {
        fold = checkpoint.fold;
      }
    }
    if (!fold) {
      fold = foldRowsAndArchive(rowsWithSeq(this.db, key), archive);
    }
    let archivedEventCount = 0;
    let archiveFirstT: number | undefined;
    if (archive) {
      archivedEventCount = archive.archivedEventCount;
      for (const bucket of Object.values(archive.buckets)) {
        if (bucket.fold.firstSeen !== undefined && (archiveFirstT === undefined || bucket.fold.firstSeen < archiveFirstT)) {
          archiveFirstT = bucket.fold.firstSeen;
        }
      }
    }
    return {
      projection: projectKeyFold(fold),
      ...(fold.statusMarkers ? { statusMarkers: fold.statusMarkers } : {}),
      hasArchive: archive !== undefined,
      archivedEventCount,
      ...(archiveFirstT !== undefined ? { archiveFirstT } : {}),
    };
  }

  /** Keys for a language, optionally filtered by journal-key prefix. */
  queryLanguageKeys(language: string, prefix?: string): string[] {
    const like = `${language}:${prefix ?? ''}%`;
    const keys = new Set<string>();
    for (const row of this.db.prepare('SELECT DISTINCT key FROM rows WHERE key LIKE ?').all(like) as Array<{ key: string }>) keys.add(row.key);
    for (const row of this.db.prepare('SELECT DISTINCT key FROM archives WHERE key LIKE ?').all(like) as Array<{ key: string }>) keys.add(row.key);
    return [...keys];
  }

  /**
   * Per-key history summaries (analytics/overview granularity). Cohort
   * transitions cover sense-routed archive buckets AND sense-routed exact
   * rows only — the same routing learningAnalytics applies.
   */
  queryKeySummaries(language: string, now = Date.now()): Record<string, KeyHistorySummary> {
    const result: Record<string, KeyHistorySummary> = {};
    for (const key of this.queryLanguageKeys(language)) {
      const archive = this.readArchive(key);
      const rows = rowsWithSeq(this.db, key);
      const fold = foldRowsAndArchive(rows, archive);
      let transitions = emptyTransitions();
      if (archive) {
        for (const [bucketKey, bucket] of Object.entries(archive.buckets)) {
          const representative = bucketRepresentative(bucketKey);
          if (!representative || eventCapability(representative) !== 'sense-recognition') continue;
          transitions = mergeTransitions(transitions, bucket.transitions);
        }
      }
      for (const { event } of rows) {
        if (eventCapability(event) !== 'sense-recognition') continue;
        applyTransitions(transitions, event, now);
      }
      // Acquisition-window meaning rows stay exact forever; they are the
      // cohort slope input (family slope replays them like raw events).
      const acquisitionRows = rows
        .filter(({ event }) => {
          if (eventCapability(event) !== 'sense-recognition') return false;
          return transitions.firstT !== undefined && event.t <= transitions.firstT + KNOWLEDGE_ACQUISITION_WINDOW_MS;
        });
      result[key] = {
        ...(fold.firstSeen !== undefined ? { firstT: fold.firstSeen } : {}),
        ...(fold.lastSeen !== undefined ? { lastT: fold.lastSeen } : {}),
        exactRows: rows.length,
        archivedRows: archive?.archivedEventCount ?? 0,
        ...(transitions.firstT !== undefined ? { firstSenseT: transitions.firstT } : {}),
        ...(transitions.firstKnownT !== undefined ? { firstKnownT: transitions.firstKnownT } : {}),
        ...(transitions.stableKnownT !== undefined ? { stableKnownT: transitions.stableKnownT } : {}),
        lapsedAfterFirstKnown: transitions.lapsedAfterFirstKnown,
        ...(acquisitionRows.length > 0 ? { acquisitionRows } : {}),
      };
    }
    return result;
  }

  /**
   * Per-key stored `ankiReviewId` sets (exact rows + archive registries) —
   * the idempotency key space of Anki re-imports.
   */
  getAnkiReviewIdsByKeys(keys: readonly string[]): Record<string, number[]> {
    const result: Record<string, number[]> = {};
    const rowStmt = this.db.prepare("SELECT json FROM rows WHERE key = ? AND json LIKE '%' || char(34) || 'ankiReviewId' || char(34) || '%'");
    const archiveStmt = this.db.prepare('SELECT json FROM archives WHERE key = ?');
    for (const key of keys) {
      const ids = new Set<number>();
      for (const row of rowStmt.all(key) as Array<{ json: string }>) {
        const event = JSON.parse(row.json) as KnowledgeEvent;
        if (event.ankiReviewId !== undefined) ids.add(event.ankiReviewId);
      }
      const archiveRow = archiveStmt.get(key) as { json?: string } | undefined;
      if (archiveRow?.json) {
        const archive = JSON.parse(archiveRow.json) as KeyArchive;
        for (const id of archive.ankiReviewIds) ids.add(id);
      }
      if (ids.size > 0) result[key] = [...ids].sort((a, b) => a - b);
    }
    return result;
  }

  /** Anki re-import idempotency: which of these review ids already exist. */
  hasAnkiReviewIds(language: string, ids: readonly number[]): boolean[] {
    const known = new Set<number>();
    for (const row of this.db.prepare("SELECT json FROM rows WHERE lang = ? AND json LIKE '%\"ankiReviewId\"%'").all(language) as Array<{ json: string }>) {
      const event = JSON.parse(row.json) as KnowledgeEvent;
      if (event.ankiReviewId !== undefined) known.add(event.ankiReviewId);
    }
    for (const row of this.db.prepare('SELECT json FROM archives WHERE lang = ?').all(language) as Array<{ json: string }>) {
      const archive = JSON.parse(row.json) as KeyArchive;
      for (const id of archive.ankiReviewIds) known.add(id);
    }
    return ids.map((id) => known.has(id));
  }

  /**
   * Bounded incremental compaction pass: aggregate eligible rows older than
   * the tail window for at most `maxKeys` keys, merging into each key's
   * existing archive. Compaction is policy-free (pure data restructuring),
   * deterministic, and per-key atomic.
   */
  compact(now: number, maxKeys = COMPACTION_KEY_BUDGET): number {
    const candidates = this.db
      .prepare('SELECT DISTINCT key FROM rows WHERE t < ? ORDER BY key LIMIT ?')
      .all(now - KNOWLEDGE_ARCHIVE_TAIL_MS, maxKeys * 4) as Array<{ key: string }>;
    let compacted = 0;
    for (const { key } of candidates) {
      if (compacted >= maxKeys) break;
      const rows = rowsWithSeq(this.db, key);
      if (!rows.some(({ event }) => isAggregatableEvent(event, now))) continue;
      const compact = compactKeyEvents(rows, now, this.readArchive(key));
      if (!compact.archive) continue;
      this.writeArchiveAndCheckpoint(key, compact);
      compacted += 1;
    }
    return compacted;
  }

  /** Rebuild every checkpoint from canonical rows + archives. */
  rebuildCheckpoints(): void {
    const keys = new Set<string>();
    for (const row of this.db.prepare('SELECT DISTINCT key FROM rows').all() as Array<{ key: string }>) keys.add(row.key);
    for (const row of this.db.prepare('SELECT DISTINCT key FROM archives').all() as Array<{ key: string }>) keys.add(row.key);
    for (const key of keys) {
      const rows = rowsWithSeq(this.db, key);
      const archive = this.readArchive(key);
      const fold = foldRowsAndArchive(rows, archive);
      const frontierSeq = rows.reduce((max, row) => Math.max(max, row.seq), 0);
      this.db
        .prepare(
          'INSERT INTO checkpoints (key, lang, frontier_seq, json) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET frontier_seq = excluded.frontier_seq, json = excluded.json',
        )
        .run(key, this.languageOfKey(key), frontierSeq, JSON.stringify({ fold, frontierSeq, foldVersion: KNOWLEDGE_STORE_FOLD_VERSION } satisfies CheckpointRow));
    }
  }

  close(): void {
    this.db.close();
  }
}
