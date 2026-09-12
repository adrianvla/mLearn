import { projectCapabilities } from '../../shared/knowledge/capabilityProjection';
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
  decodeAttemptRecord,
  decodeBucketRecords,
  emptyTransitions,
  encodeBucketRecords,
  foldFromArchive,
  isAggregatableEvent,
  KNOWLEDGE_ARCHIVE_TAIL_MS,
  KNOWLEDGE_MEASURABLE_VERSION,
  KNOWLEDGE_ACQUISITION_WINDOW_MS,
  rebuildBucketFromRecords,
  type BucketArchive,
  type BucketRebuild,
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
  const schedulerOnly = event.kind === 'review' && isAttemptId(event.attemptId)
    && typeof event.schedulerCardId === 'string' && event.schedulerCardId.length > 0;
  if (!schedulerOnly && event.aspect === undefined && !isValidCapabilityId(event.targetRef?.capability)) return false;
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

/** 2 = per-row contribution records (bucket_recs + attempt_index) exist. */
export const KNOWLEDGE_STORE_SCHEMA_VERSION = 2;
export const KNOWLEDGE_STORE_FOLD_VERSION = 1;
export const STORE_FILE_NAME = 'knowledge-history.sqlite3';
/** Maximum keys compacted per pass — bounded incremental work. */
export const COMPACTION_KEY_BUDGET = 200;

export interface KeyKnowledgeState {
  projection: ReplayProjection | null;
  capabilities?: Record<string, ReplayProjection>;
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
  /** Reserve a contiguous block — one meta read/write per batch, not per row. */
  reserve(count: number): number {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'seqCounter'").get() as { value?: string } | undefined;
    const base = row?.value !== undefined ? Number(row.value) : 0;
    this.db.prepare("INSERT INTO meta (key, value) VALUES ('seqCounter', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(base + count));
    return base;
  }

  next(): number {
    return this.reserve(1) + 1;
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

/** Deterministic identity for occurrence matching: recursively sorted-key JSON. */
function canonicalEventJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalEventJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, v]) => `${JSON.stringify(key)}:${canonicalEventJson(v)}`).join(',')}}`;
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
      CREATE TABLE IF NOT EXISTS attempt_index (
        attempt_id TEXT NOT NULL,
        key TEXT NOT NULL,
        bucket TEXT NOT NULL,
        t INTEGER NOT NULL,
        seq INTEGER NOT NULL,
        rec BLOB NOT NULL,
        PRIMARY KEY (attempt_id, key, seq)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS attempt_index_bucket ON attempt_index(key, bucket);
      CREATE TABLE IF NOT EXISTS bucket_recs (
        key TEXT NOT NULL,
        bucket TEXT NOT NULL,
        recs BLOB NOT NULL,
        PRIMARY KEY (key, bucket)
      ) WITHOUT ROWID;
    `);
    const setMeta = this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING');
    setMeta.run('schemaVersion', String(KNOWLEDGE_STORE_SCHEMA_VERSION));
    setMeta.run('foldVersion', String(KNOWLEDGE_STORE_FOLD_VERSION));
  }

  /** Persisted schema generation (0/undefined = fresh or pre-versioned DB). */
  get schemaVersion(): number {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'schemaVersion'").get() as { value?: string } | undefined;
    return row?.value !== undefined ? Number(row.value) : 0;
  }

  markSchemaVersion(version: number): void {
    this.db
      .prepare("INSERT INTO meta (key, value) VALUES ('schemaVersion', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(String(version));
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
        const pending = events.slice(existing).filter((event): event is KnowledgeEvent => isKnowledgeEvent(event)); // malformed rows never migrate
        const seqBase = this.seq.reserve(pending.length);
        pending.forEach((event, index) => {
          insert.run(seqBase + index + 1, key, lang, event.t, JSON.stringify(event));
          totalEvents += 1;
        });
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
        // Import boundary: rows of this key with seq <= boundary are backup
        // survivors; anything above is a post-migration append. Gives the v2
        // reclassification an exact survivor/appends split (no payload
        // guessing when identical rows exist).
        const boundary = (this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM rows WHERE key = ?').get(key) as { m: number }).m;
        setMarker.run(`migseq:${key}`, String(boundary));
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
    this.db.exec("DELETE FROM rows; DELETE FROM archives; DELETE FROM checkpoints; DELETE FROM attempt_index; DELETE FROM bucket_recs; DELETE FROM meta WHERE key LIKE 'mig:%' OR key LIKE 'migseq:%' OR key LIKE 'v2mig:%' OR key = 'seqCounter';");
  }

  /** Transaction-body variant — callers own BEGIN/COMMIT. */
  private writeArchiveAndCheckpointLocked(key: string, compact: ReturnType<typeof compactKeyEvents>): void {
    {
      const lang = this.languageOfKey(key);
      if (compact.archive) {
        this.db
          .prepare(
            'INSERT INTO archives (key, lang, frontier_t, json) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET frontier_t = excluded.frontier_t, json = excluded.json',
          )
          .run(key, lang, compact.archive.frontierT, JSON.stringify(compact.archive));
        // Contribution records: same transaction as the archive itself, so
        // archive-and-records are never observable apart (the records are
        // what makes archived attempts exactly retractable).
        const mergeBlob = this.db.prepare(
          'INSERT INTO bucket_recs (key, bucket, recs) VALUES (?, ?, ?) ON CONFLICT(key, bucket) DO UPDATE SET recs = excluded.recs',
        );
        const byBucket = new Map<string, Array<{ event: KnowledgeEvent; seq: number }>>();
        for (const { bucketKey, event, seq } of compact.records.bucketRecords) {
          const list = byBucket.get(bucketKey) ?? [];
          list.push({ event, seq });
          byBucket.set(bucketKey, list);
        }
        const readBlob = this.db.prepare('SELECT recs FROM bucket_recs WHERE key = ? AND bucket = ?');
        for (const [bucketKey, fresh] of byBucket) {
          const existing = readBlob.get(key, bucketKey) as { recs?: Uint8Array } | undefined;
          const merged = existing?.recs
            ? [...decodeBucketRecords(existing.recs), ...fresh]
            : fresh;
          mergeBlob.run(key, bucketKey, encodeBucketRecords(merged));
        }
        const insertAttempt = this.db.prepare(
          'INSERT OR REPLACE INTO attempt_index (attempt_id, key, bucket, t, seq, rec) VALUES (?, ?, ?, ?, ?, ?)',
        );
        for (const { attemptId, bucketKey, t, seq, rec } of compact.records.attemptRecords) {
          insertAttempt.run(attemptId, key, bucketKey, t, seq, rec);
        }
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
    if (!row?.json) return undefined;
    const archive = JSON.parse(row.json) as KeyArchive;
    if (archive.measurableVersion === KNOWLEDGE_MEASURABLE_VERSION) return archive;
    let incomplete = false;
    const now = Date.now();
    for (const [bucketKey, bucket] of Object.entries(archive.buckets)) {
      const blob = this.db.prepare('SELECT recs FROM bucket_recs WHERE key = ? AND bucket = ?')
        .get(key, bucketKey) as { recs?: Uint8Array } | undefined;
      const attempts = this.db.prepare('SELECT rec FROM attempt_index WHERE key = ? AND bucket = ?')
        .all(key, bucketKey) as Array<{ rec: Uint8Array }>;
      const records = blob?.recs ? decodeBucketRecords(blob.recs) : [];
      for (const { rec } of attempts) {
        const decoded = decodeAttemptRecord(rec);
        if (decoded) records.push(decoded);
      }
      if (records.length === bucket.rowCount) {
        const rebuilt = rebuildBucketFromRecords(bucketKey, records, now);
        bucket.measurableFold = rebuilt.measurableFold;
        bucket.ratings = rebuilt.ratings;
        bucket.latency = rebuilt.latency;
        bucket.sourceSeen = rebuilt.sourceSeen;
        bucket.lastDirect = rebuilt.lastDirect;
        bucket.methodStats = rebuilt.methodStats;
        archive.weekPoints = [...archive.weekPoints.filter((point) => point.b !== bucketKey), ...rebuilt.points];
      } else {
        // Preserve the audit fold and row counts; missing records cannot prove which
        // old observations were genuine reviews rather than scheduler snapshots.
        incomplete = true;
        bucket.measurableFold = emptyKeyFold();
        bucket.ratings = [];
        bucket.latency = { count: 0, sum: 0 };
        delete bucket.sourceSeen;
        delete bucket.lastDirect;
        delete bucket.methodStats;
        for (const point of archive.weekPoints) {
          if (point.b === bucketKey) { delete point.ease; delete point.source; }
        }
      }
    }
    archive.weekPoints.sort((a, b) => a.w - b.w);
    archive.measurableVersion = KNOWLEDGE_MEASURABLE_VERSION;
    if (incomplete) {
      archive.measurableRebuildIncomplete = true;
      log.warn('Legacy knowledge archive lacks complete observation records; measurable support withheld for key:', key);
    }
    this.db.prepare('UPDATE archives SET json = ? WHERE key = ?').run(JSON.stringify(archive), key);
    return archive;
  }

  private checkpoint(key: string): CheckpointRow | undefined {
    const row = this.db.prepare('SELECT json FROM checkpoints WHERE key = ?').get(key) as { json?: string } | undefined;
    if (!row?.json) return undefined;
    const parsed = JSON.parse(row.json) as CheckpointRow;
    if (parsed.foldVersion !== KNOWLEDGE_STORE_FOLD_VERSION) return undefined;
    return parsed;
  }

  /**
   * Reverse archived attempts of `retractedIds` for one key: rebuild every
   * affected bucket from its contribution records minus the retracted rows,
   * rewrite the bucket caches + LOD points, and drop the index entries. The
   * tombstone row itself stays exact forever (append-only audit).
   */
  private rebuildArchivedAttempts(key: string, retractedIds: readonly string[], now: number): void {
    if (retractedIds.length === 0) return;
    const affected = new Map<string, Set<number>>(); // bucket -> retracted seqs
    const placeholders = retractedIds.map(() => '?').join(',');
    for (const row of this.db
      .prepare(`SELECT DISTINCT bucket, seq FROM attempt_index WHERE key = ? AND attempt_id IN (${placeholders})`)
      .all(key, ...retractedIds) as Array<{ bucket: string; seq: number }>) {
      const seqs = affected.get(row.bucket) ?? new Set<number>();
      seqs.add(row.seq);
      affected.set(row.bucket, seqs);
    }
    if (affected.size === 0) return;
    const archive = this.readArchive(key);
    if (!archive) return;
    const buckets: Record<string, BucketArchive> = { ...archive.buckets };
    for (const [bucketKey, retractedSeqs] of affected) {
      const blobRow = this.db.prepare('SELECT recs FROM bucket_recs WHERE key = ? AND bucket = ?').get(key, bucketKey) as { recs?: Uint8Array } | undefined;
      const attemptRows = this.db
        .prepare('SELECT t, seq, rec FROM attempt_index WHERE key = ? AND bucket = ?')
        .all(key, bucketKey) as Array<{ t: number; seq: number; rec: Uint8Array }>;
      const records = [
        ...(blobRow?.recs ? decodeBucketRecords(blobRow.recs) : []),
        ...attemptRows.flatMap(({ rec }) => (decodeAttemptRecord(rec) !== undefined ? [decodeAttemptRecord(rec) as { event: KnowledgeEvent; seq: number }] : [])),
      ].filter(({ seq }) => !retractedSeqs.has(seq));
      const rebuilt: BucketRebuild = rebuildBucketFromRecords(bucketKey, records, now);
      buckets[bucketKey] = {
        fold: rebuilt.fold,
        measurableFold: rebuilt.measurableFold,
        transitions: rebuilt.transitions,
        ratings: rebuilt.ratings,
        latency: rebuilt.latency,
        rowCount: rebuilt.rowCount,
        ...(rebuilt.methodStats !== undefined ? { methodStats: rebuilt.methodStats } : {}),
        ...(rebuilt.sourceSeen !== undefined ? { sourceSeen: rebuilt.sourceSeen } : {}),
        ...(rebuilt.lastDirect !== undefined ? { lastDirect: rebuilt.lastDirect } : {}),
      };
      let archivedEventCount = 0;
      for (const bucket of Object.values(buckets)) archivedEventCount += bucket.rowCount;
      archive.buckets = buckets;
      archive.archivedEventCount = archivedEventCount;
      archive.weekPoints = [...archive.weekPoints.filter((point) => point.b !== bucketKey), ...rebuilt.points].sort((a, b) => a.w - b.w);
    }
    this.db
      .prepare('UPDATE archives SET json = ? WHERE key = ?')
      .run(JSON.stringify(archive), key);
    this.db
      .prepare(`DELETE FROM attempt_index WHERE key = ? AND attempt_id IN (${placeholders})`)
      .run(key, ...retractedIds);
  }

  /**
   * Append exact rows and advance the checkpoint. Retractions rebuild the
   * key's fold from canonical data (tombstones invalidate folded attempts —
   * exact rows via stripping, archived attempts via contribution-record
   * rebuild). Ordinary batches fold separately (ordered by (t, seq)) and
   * merge into the checkpoint by marker timestamps — sync appends may carry
   * rows older than the frontier, and evidence markers are order-sensitive.
   */
  appendEvents(eventsByKey: KnowledgeEventLog): void {
    const insert = this.db.prepare('INSERT INTO rows (seq, key, lang, t, json) VALUES (?, ?, ?, ?, ?)');
    for (const [key, events] of Object.entries(eventsByKey)) {
      if (!events.length) continue;
      const lang = this.languageOfKey(key);
      this.db.exec('BEGIN');
      try {
        const valid = events.filter((event) => {
          if (isKnowledgeEvent(event)) return true;
          log.warn('[knowledgeHistoryStore] dropped malformed event on append', key);
          return false;
        });
        const seqBase = this.seq.reserve(valid.length);
        const newSeqs: number[] = [];
        valid.forEach((event, index) => {
          const seq = seqBase + index + 1;
          insert.run(seq, key, lang, event.t, JSON.stringify(event));
          newSeqs.push(seq);
        });
        if (newSeqs.length === 0) {
          this.db.exec('COMMIT');
          continue;
        }
        const checkpoint = this.checkpoint(key);
        const archive = this.readArchive(key);
        // `valid` (not `events`) is the seq-aligned row set: malformed drops
        // would otherwise misalign incremental folds and tombstone handling.
        const hasTombstone = valid.some((event) => event.retracts !== undefined || event.kind === 'retraction');
        let fold: FoldState;
        if (hasTombstone) {
          const retractedIds = [...new Set(valid.flatMap((event) => (event.retracts !== undefined ? [`${event.retracts}`] : [])))];
          this.rebuildArchivedAttempts(key, retractedIds, Date.now());
          fold = foldRowsAndArchive(rowsWithSeq(this.db, key), this.readArchive(key));
        } else if (!checkpoint) {
          fold = foldRowsAndArchive(rowsWithSeq(this.db, key), archive);
        } else {
          const batchFold = emptyKeyFold();
          valid
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

  /** Whether archived contribution records exist for these attempt ids on a key. */
  hasAttemptRecords(key: string, attemptIds: readonly string[]): boolean[] {
    const stmt = this.db.prepare('SELECT 1 FROM attempt_index WHERE key = ? AND attempt_id = ? LIMIT 1');
    return attemptIds.map((id) => stmt.get(key, id) !== undefined);
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
      capabilities: projectCapabilities(rowsWithSeq(this.db, key), archive),
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
    // Row reads happen inside the same IMMEDIATE transaction as the writes:
    // an append interleaving before the old read-then-delete gap would be
    // silently deleted with the snapshot. IMMEDIATE takes the write lock up
    // front, so read → compact → rewrite is atomic against appends.
    //
    // Candidate scanning uses a persistent cursor: old acquisition/ledger
    // residue keeps keys in the candidate set forever, so a key-ordered
    // LIMIT window alone would revisit the same prefix eternally and starve
    // every key behind it. The cursor advances each pass and wraps, giving
    // every key periodic coverage with bounded per-pass work.
    const getMeta = this.db.prepare("SELECT value FROM meta WHERE key = 'compactCursor'");
    const setMeta = this.db.prepare("INSERT INTO meta (key, value) VALUES ('compactCursor', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    const cursorRow = getMeta.get() as { value?: string } | undefined;
    const cursor = cursorRow?.value ?? '';
    const candidates = this.db
      .prepare('SELECT DISTINCT key FROM rows WHERE key > ? AND t < ? ORDER BY key LIMIT ?')
      .all(cursor, now - KNOWLEDGE_ARCHIVE_TAIL_MS, maxKeys * 4) as Array<{ key: string }>;
    let compacted = 0;
    let scanned = 0;
    let lastKey = cursor;
    for (const { key } of candidates) {
      if (compacted >= maxKeys) break;
      scanned += 1;
      lastKey = key;
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const rows = rowsWithSeq(this.db, key);
        if (!rows.some(({ event }) => isAggregatableEvent(event, now))) {
          this.db.exec('COMMIT');
          continue;
        }
        const compact = compactKeyEvents(rows, now, this.readArchive(key));
        // Count only keys that actually moved rows: old rows held as exact
        // acquisition/ledger residue re-qualify on every scan, but they are
        // not compaction work — counting them would make convergence (and
        // this loop's termination) impossible.
        if (!compact.archive || compact.kept.length === rows.length) {
          this.db.exec('COMMIT');
          continue;
        }
        this.writeArchiveAndCheckpointLocked(key, compact);
        this.db.exec('COMMIT');
        compacted += 1;
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    }
    // Cursor wrap: reset only when the scan consumed a genuinely short list
    // (everything past the cursor was exhausted). A budget break, or a full
    // window, means keys may exist beyond `lastKey` — persist the position.
    setMeta.run(scanned === candidates.length && candidates.length < maxKeys * 4 ? '' : lastKey);
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

  /**
   * v1 → v2 reclassification. v1 archives hold aggregates without per-row
   * records, so old attempt rows could never compact there. The migration
   * source is the verified `.migrated` journal backup: per key, backup rows
   * and current exact rows are merged (deduped by canonical event identity —
   * the store may hold post-migration appends the backup lacks), rewritten
   * with fresh (t, seq)-ordered seqs, compacted under generation-2 rules,
   * and verified against a full replay of the merged history. Per-key
   * atomic, resumable via markers, idempotent.
   */
  reclassifyFromBackup(backupLog: KnowledgeEventLog, now = Date.now()): { keys: number; verified: boolean; skipped: number } {
    const keys = new Set<string>(Object.keys(backupLog));
    for (const row of this.db.prepare('SELECT DISTINCT key FROM rows').all() as Array<{ key: string }>) keys.add(row.key);
    let verified = true;
    let skipped = 0;
    for (const key of keys) {
      const markerKey = `v2mig:${key}`;
      const canonical = canonicalEventJson;
      const lang = this.languageOfKey(key);
      // Snapshot, merge, and rewrite all happen inside the write transaction:
      // an append interleaving before the delete would be silently dropped.
      // Completed keys are checked FIRST: a rewritten key's fresh seqs lie
      // beyond its old import boundary, so recomputing the merge on resume
      // would misclassify survivors as appends and duplicate the backup.
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const marker = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(markerKey) as { value?: string } | undefined;
        if (marker?.value !== undefined) {
          this.db.exec('COMMIT');
          continue;
        }
        const currentRows = rowsWithSeq(this.db, key);
        const inBackup = backupLog[key] !== undefined;
        const boundaryRow = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(`migseq:${key}`) as { value?: string } | undefined;
        let backupOnly: KnowledgeEvent[] = [];
        let appendCount = 0;
        let skip = false;
        if (!inBackup) {
          // Key created after the v1 import: current rows are the complete
          // history — nothing to merge, just recompact under v2 rules.
        } else if (boundaryRow?.value !== undefined) {
          // Exact split: rows with seq <= boundary are import survivors;
          // rows above are post-migration appends. merged = survivors ∪
          // backup-only ∪ appends is exact even for byte-identical rows.
          const boundary = Number(boundaryRow.value);
          const survivors = currentRows.filter(({ seq }) => seq <= boundary);
          appendCount = currentRows.length - survivors.length;
          const survivorCounts = new Map<string, number>();
          for (const { event } of survivors) {
            const key2 = canonical(event);
            survivorCounts.set(key2, (survivorCounts.get(key2) ?? 0) + 1);
          }
          const claimed = new Map<string, number>();
          for (const event of backupLog[key] ?? []) {
            if (!isKnowledgeEvent(event)) continue;
            const key2 = canonical(event);
            const remaining = survivorCounts.get(key2) ?? 0;
            const claimedCount = claimed.get(key2) ?? 0;
            if (claimedCount < remaining) {
              claimed.set(key2, claimedCount + 1);
              continue;
            }
            backupOnly.push(event);
          }
        } else {
          // Legacy v1 key without an import boundary: payload matching cannot
          // distinguish identical appends from identical survivors, so
          // reclassifying could lose an occurrence. Never reclassify
          // speculatively — the key keeps its v1 exact-attempt path (correct,
          // just not compacted) and is reported as deferred.
          skipped += 1;
          skip = true;
        }
        if (skip) {
          this.db.exec('COMMIT');
          continue;
        }
        const merged: Array<{ event: KnowledgeEvent; origin: 0 | 1; seq: number }> = [
          ...currentRows.map(({ event, seq }) => ({ event, origin: 0 as const, seq })),
          ...backupOnly.map((event, index) => ({ event, origin: 1 as const, seq: currentRows.length + index })),
        ].sort((a, b) => a.event.t - b.event.t || a.origin - b.origin || a.seq - b.seq);
        this.db.prepare('DELETE FROM rows WHERE key = ?').run(key);
        this.db.prepare('DELETE FROM archives WHERE key = ?').run(key);
        this.db.prepare('DELETE FROM checkpoints WHERE key = ?').run(key);
        this.db.prepare('DELETE FROM attempt_index WHERE key = ?').run(key);
        this.db.prepare('DELETE FROM bucket_recs WHERE key = ?').run(key);
        const insert = this.db.prepare('INSERT INTO rows (seq, key, lang, t, json) VALUES (?, ?, ?, ?, ?)');
        let seq = 0;
        for (const { event } of merged) {
          seq += 1;
          insert.run(this.seq.next(), key, lang, event.t, JSON.stringify(event));
        }
        const rows = rowsWithSeq(this.db, key);
        const compact = compactKeyEvents(rows, now);
        this.writeArchiveAndCheckpointLocked(key, compact);
        const state = this.getKnowledgeState(key);
        const expected = replayKeyProjection(merged.map(({ event }) => event));
        if (JSON.stringify(state.projection) !== JSON.stringify(expected)) {
          verified = false;
          log.error(`[knowledgeHistoryStore] v2 reclassification mismatch for ${key} — aborting`);
          this.db.exec('ROLLBACK');
          break;
        }
        this.db
          .prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
          .run(markerKey, String(merged.length + appendCount));
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    }
    if (verified) this.markSchemaVersion(KNOWLEDGE_STORE_SCHEMA_VERSION);
    return { keys: keys.size, verified, skipped };
  }

  /** Byte + row accounting per table (benchmark/storage diagnostics). */
  storageStats(): { rows: number; rowBytes: number; archives: number; archiveBytes: number; attemptIndex: number; attemptBytes: number; bucketRecBlobs: number; bucketRecBytes: number; dbBytes: number } {
    const count = (sql: string): number => (this.db.prepare(sql).get() as { n: number }).n;
    const pageSize = (this.db.prepare('PRAGMA page_size').get() as { page_size: number }).page_size;
    const pageCount = (this.db.prepare('PRAGMA page_count').get() as { page_count: number }).page_count;
    return {
      rows: count('SELECT COUNT(*) AS n FROM rows'),
      rowBytes: count('SELECT COALESCE(SUM(LENGTH(json)), 0) AS n FROM rows'),
      archives: count('SELECT COUNT(*) AS n FROM archives'),
      archiveBytes: count('SELECT COALESCE(SUM(LENGTH(json)), 0) AS n FROM archives'),
      attemptIndex: count('SELECT COUNT(*) AS n FROM attempt_index'),
      attemptBytes: count('SELECT COALESCE(SUM(LENGTH(rec)) + SUM(LENGTH(attempt_id)) + SUM(LENGTH(key)) + SUM(LENGTH(bucket)), 0) AS n FROM attempt_index'),
      bucketRecBlobs: count('SELECT COUNT(*) AS n FROM bucket_recs'),
      bucketRecBytes: count('SELECT COALESCE(SUM(LENGTH(recs)), 0) AS n FROM bucket_recs'),
      dbBytes: pageSize * pageCount,
    };
  }

  close(): void {
    this.db.close();
  }
}
