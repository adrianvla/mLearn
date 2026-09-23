/** Independent, local integrity boundary for irreplaceable learner data. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { backup, DatabaseSync } from 'node:sqlite';
import AdmZip from 'adm-zip';
import { StringDecoder } from 'node:string_decoder';
import type { RecoveryPointSummary } from '../../shared/guardian';
import { startupDuration, startupMark, startupTime } from '../startupTiming';

const SCHEMA = 1;
const MAX_SNAPSHOTS = 8;
const DATA_FILES = ['flashcards.json', 'world.json', 'settings.json', 'kv-store.json', 'knowledge-events.json', 'knowledge-events.json.migrated', 'voice-samples.json'] as const;
const DATA_DIRS = ['journal', 'flashcard-images', 'flashcard-video', 'voice-samples', 'media-stats'] as const;
const IMPORT_DIRS = [...DATA_DIRS, 'flashcard-audio'] as const;
const DB_FILE = 'knowledge-history.sqlite3';
const RESTORE_ITEMS = [...DATA_FILES, ...IMPORT_DIRS, DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`] as const;

export type GuardianState = 'ready' | 'blocked';
export interface GuardianMetrics {
  flashcardSchema: number;
  knowledgeSchema: number;
  cards: string[];
  cardReviews: Record<string, number>;
  wordKnowledge: string[];
  grammarKnowledge: string[];
  rooms: string[];
  threads: string[];
  participants: string[];
  journalRecords: Record<string, number>;
  knowledgeSequence: number;
  knowledgeKeys: number;
  knowledgeKeyIds: string[];
  knowledgeEvidenceCount: number;
  legacyKnowledgeKeys: string[];
  legacyKnowledgeEvents: number;
  legacyEvidence: Record<string, number>;
}

interface GuardianLedger {
  schema: number;
  generation: number;
  state: GuardianState;
  reason?: string;
  metrics: GuardianMetrics;
  lastGoodSnapshot?: string;
  snapshotStamp?: string;
  pendingJournalErases?: string[];
}

interface SnapshotManifest {
  schema: number;
  metrics: GuardianMetrics;
  hashes: Record<string, string>;
  flashcardVersion: number;
  knowledgeSchemaVersion: number;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function ids(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((entry) => {
    const item = object(entry, label);
    if (typeof item.id !== 'string' || !item.id) throw new Error(`${label} contains an invalid id`);
    return item.id;
  }).sort();
}

function keys(value: unknown, label: string): string[] {
  return Object.keys(object(value, label)).sort();
}

function reviewCounts(value: unknown): Record<string, number> {
  const cards = object(value, 'flashcards');
  const counts: Record<string, number> = {};
  for (const [id, candidate] of Object.entries(cards)) {
    const card = object(candidate, `flashcard ${id}`);
    const count = card.reviews ?? 0;
    if (!Number.isSafeInteger(count) || (count as number) < 0) throw new Error(`Invalid review count for ${id}`);
    counts[id] = count as number;
  }
  return counts;
}

function legacyEvidence(value: unknown): Record<string, number> {
  if (value === undefined) return {};
  const kv = object(value, 'kv-store.json');
  const counts: Record<string, number> = {};
  for (const [key, raw] of Object.entries(kv)) {
    if (key !== 'agent-configs' && key !== 'agent-config'
      && !key.startsWith('conversation-sessions-') && !key.startsWith('agent-memories-')) continue;
    if (typeof raw !== 'string') throw new Error(`Legacy evidence ${key} must be encoded JSON`);
    const parsed = JSON.parse(raw) as unknown;
    if (key === 'agent-config') counts[key] = object(parsed, key) ? 1 : 0;
    else if (Array.isArray(parsed)) counts[key] = parsed.length;
    else throw new Error(`Legacy evidence ${key} must be an array`);
  }
  return counts;
}

function legacyKnowledge(root: string): { keys: string[]; events: number } {
  const active = path.join(root, 'knowledge-events.json');
  const migrated = `${active}.migrated`;
  const value = readJson(fs.existsSync(active) ? active : migrated);
  if (value === undefined) return { keys: [], events: 0 };
  const log = object(value, 'legacy knowledge journal');
  let events = 0;
  for (const [key, rows] of Object.entries(log)) {
    if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
      throw new Error(`Legacy knowledge events for ${key} are malformed`);
    }
    events += rows.length;
  }
  return { keys: Object.keys(log).sort(), events };
}

function readJson(file: string): unknown | undefined {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function fileHashes(root: string): Record<string, string> {
  const started = startupTime();
  let enumeration = 0n;
  let reading = 0n;
  let digesting = 0n;
  let allocating = 0n;
  let opening = 0n;
  let closing = 0n;
  let finalizing = 0n;
  let files = 0;
  let bytesRead = 0;
  const byTopLevel = new Map<string, bigint>();
  const hashes: Record<string, string> = {};
  const visit = (dir: string): void => {
    const enumStart = startupTime();
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    enumeration += startupTime() - enumStart;
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isSymbolicLink()) throw new Error('Recovery data contains a symbolic link');
      else if (entry.isFile() && entry.name !== 'manifest.json') {
        const fileStart = startupTime();
        const hash = createHash('sha256');
        const openStart = startupTime();
        const fd = fs.openSync(full, 'r');
        opening += startupTime() - openStart;
        const allocationStart = startupTime();
        const chunk = Buffer.allocUnsafe(1024 * 1024);
        allocating += startupTime() - allocationStart;
        try {
          let bytes: number;
          while (true) {
            const readStart = startupTime();
            bytes = fs.readSync(fd, chunk, 0, chunk.length, null);
            reading += startupTime() - readStart;
            if (bytes === 0) break;
            bytesRead += bytes;
            const digestStart = startupTime();
            hash.update(chunk.subarray(0, bytes));
            digesting += startupTime() - digestStart;
          }
        } finally {
          const closeStart = startupTime();
          fs.closeSync(fd);
          closing += startupTime() - closeStart;
        }
        files += 1;
        const digestStart = startupTime();
        const relative = path.relative(root, full);
        hashes[relative] = hash.digest('hex');
        finalizing += startupTime() - digestStart;
        const category = relative.split(path.sep)[0];
        byTopLevel.set(category, (byTopLevel.get(category) ?? 0n) + startupTime() - fileStart);
      }
    }
  };
  visit(root);
  const ordered = Object.fromEntries(Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b)));
  startupMark(`Guardian hash walk complete files=${files} bytes=${bytesRead}`, started);
  startupDuration('Guardian hash walk readdir', enumeration);
  startupDuration('Guardian hash walk file reads', reading);
  startupDuration('Guardian hash walk SHA-256 updates', digesting);
  startupDuration('Guardian hash walk opens', opening);
  startupDuration('Guardian hash walk closes', closing);
  startupDuration('Guardian hash walk buffers', allocating);
  startupDuration('Guardian hash walk digest finalization and paths', finalizing);
  for (const [category, duration] of byTopLevel) startupDuration(`Guardian hash walk category ${category}`, duration);
  return ordered;
}

function sourceStamp(root: string): string {
  const started = startupTime();
  let enumeration = 0n;
  let stats = 0n;
  const rows: string[] = [];
  const visit = (relative: string): void => {
    const full = path.join(root, relative);
    if (!fs.existsSync(full)) return;
    const statStart = startupTime();
    const stat = fs.lstatSync(full);
    stats += startupTime() - statStart;
    if (stat.isSymbolicLink()) throw new Error('Learner data contains a symbolic link');
    if (stat.isDirectory()) {
      const enumStart = startupTime();
      const names = fs.readdirSync(full).sort();
      enumeration += startupTime() - enumStart;
      for (const name of names) visit(path.join(relative, name));
    } else if (stat.isFile()) {
      rows.push(`${relative}:${stat.size}:${stat.mtimeMs}`);
    }
  };
  for (const item of [...DATA_FILES, ...DATA_DIRS, DB_FILE, `${DB_FILE}-wal`]) visit(item);
  const stamp = createHash('sha256').update(rows.join('\n')).digest('hex');
  startupMark(`Guardian source stamp complete files=${rows.length}`, started);
  startupDuration('Guardian source stamp readdir and sorting', enumeration);
  startupDuration('Guardian source stamp lstat', stats);
  return stamp;
}

function sqliteSchemaVersion(file: string): number {
  if (!fs.existsSync(file)) return 0;
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='meta'").get();
    if (!exists) return 0;
    const row = db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get() as { value?: string } | undefined;
    return Number(row?.value ?? 0);
  } finally { db.close(); }
}

function journalCounts(root: string): Record<string, number> {
  const result: Record<string, number> = {};
  const base = path.join(root, 'journal');
  if (!fs.existsSync(base)) return result;
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isSymbolicLink()) throw new Error('Journal contains a symbolic link');
      else if (entry.isFile() && entry.name.endsWith('.ndjson')) {
        const fd = fs.openSync(full, 'r');
        const decoder = new StringDecoder('utf8');
        const chunk = Buffer.allocUnsafe(64 * 1024);
        let pending = '';
        let count = 0;
        const accept = (line: string, complete: boolean): void => {
          if (!line) return;
          try {
            const event = object(JSON.parse(line) as unknown, 'journal event');
            if (!Number.isSafeInteger(event.seq) || (event.seq as number) !== count + 1) {
              throw new Error('invalid journal sequence');
            }
            count += 1;
          } catch (error) {
            // A partial final append is recoverable, but its committed prefix
            // remains the integrity baseline until journal recovery runs.
            if (complete) throw error;
          }
        };
        try {
          let bytes: number;
          while ((bytes = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) {
            pending += decoder.write(chunk.subarray(0, bytes));
            let newline: number;
            while ((newline = pending.indexOf('\n')) !== -1) {
              accept(pending.slice(0, newline), true);
              pending = pending.slice(newline + 1);
            }
          }
          pending += decoder.end();
          accept(pending, false);
        } finally { fs.closeSync(fd); }
        result[path.relative(root, full)] = count;
      }
    }
  };
  visit(base);
  return result;
}

/** Reads persisted data only; it never trusts renderer projections or health APIs. */
export function inspectGuardianData(root: string): GuardianMetrics {
  let phase = startupTime();
  const flashcards = readJson(path.join(root, 'flashcards.json'));
  const world = readJson(path.join(root, 'world.json'));
  const kv = readJson(path.join(root, 'kv-store.json'));
  const legacyJournal = legacyKnowledge(root);
  startupMark('Guardian inspection JSON read and parse complete', phase);
  phase = startupTime();
  const cardStore = flashcards === undefined ? undefined : object(flashcards, 'flashcards.json');
  const worldStore = world === undefined ? undefined : object(world, 'world.json');
  const metrics: GuardianMetrics = {
    flashcardSchema: Number(cardStore?.version ?? 0),
    knowledgeSchema: 0,
    cards: cardStore ? keys(cardStore.flashcards, 'flashcards') : [],
    cardReviews: cardStore ? reviewCounts(cardStore.flashcards) : {},
    wordKnowledge: cardStore ? keys(cardStore.wordKnowledge ?? {}, 'wordKnowledge') : [],
    grammarKnowledge: cardStore ? keys(cardStore.grammarKnowledge ?? {}, 'grammarKnowledge') : [],
    rooms: worldStore ? ids(worldStore.rooms, 'rooms') : [],
    threads: worldStore ? ids(worldStore.threads, 'threads') : [],
    participants: worldStore ? ids(worldStore.participants, 'participants') : [],
    journalRecords: journalCounts(root),
    knowledgeSequence: 0,
    knowledgeKeys: 0,
    knowledgeKeyIds: [],
    knowledgeEvidenceCount: 0,
    legacyKnowledgeKeys: legacyJournal.keys,
    legacyKnowledgeEvents: legacyJournal.events,
    legacyEvidence: legacyEvidence(kv),
  };
  startupMark('Guardian inspection evidence enumeration complete', phase);
  const dbPath = path.join(root, DB_FILE);
  if (fs.existsSync(dbPath)) {
    phase = startupTime();
    const db = new DatabaseSync(dbPath, { readOnly: true });
    startupMark('Guardian inspection SQLite open complete', phase);
    try {
      phase = startupTime();
      const check = db.prepare('PRAGMA quick_check').get() as Record<string, unknown> | undefined;
      startupMark('Guardian inspection SQLite quick_check complete', phase);
      if (Object.values(check ?? {})[0] !== 'ok') throw new Error('knowledge history SQLite integrity check failed');
      phase = startupTime();
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
      const names = new Set(tables.map((table) => table.name));
      if (names.has('meta')) {
        const row = db.prepare("SELECT value FROM meta WHERE key = 'seqCounter'").get() as { value?: string } | undefined;
        metrics.knowledgeSequence = Number(row?.value ?? 0);
        const schemaRow = db.prepare("SELECT value FROM meta WHERE key = 'schemaVersion'").get() as { value?: string } | undefined;
        metrics.knowledgeSchema = Number(schemaRow?.value ?? 0);
      }
      if (names.has('rows')) {
        const row = db.prepare('SELECT COUNT(DISTINCT key) AS count FROM rows').get() as { count: number };
        metrics.knowledgeKeys = row.count;
      }
      if (names.has('rows') && names.has('archives')) {
        const keys = db.prepare('SELECT key FROM rows UNION SELECT key FROM archives').all() as Array<{ key: string }>;
        metrics.knowledgeKeyIds = keys.map((entry) => entry.key).sort();
        const exact = db.prepare('SELECT COUNT(*) AS n FROM rows').get() as { n: number };
        const archived = db.prepare("SELECT COALESCE(SUM(CAST(json_extract(json, '$.archivedEventCount') AS INTEGER)), 0) AS n FROM archives").get() as { n: number };
        metrics.knowledgeEvidenceCount = exact.n + archived.n;
      }
      if (!Number.isSafeInteger(metrics.knowledgeSequence) || metrics.knowledgeSequence < 0) throw new Error('invalid knowledge sequence');
      startupMark('Guardian inspection SQLite evidence queries complete', phase);
    } finally { db.close(); }
  }
  if (!Number.isSafeInteger(metrics.flashcardSchema) || metrics.flashcardSchema < 0
    || !Number.isSafeInteger(metrics.knowledgeSchema) || metrics.knowledgeSchema < 0) throw new Error('invalid data schema');
  return metrics;
}

function missing(before: readonly string[], after: readonly string[]): string[] {
  const present = new Set(after);
  return before.filter((id) => !present.has(id));
}

function loss(before: GuardianMetrics, after: GuardianMetrics, pendingJournalErases: readonly string[] = []): string[] {
  const problems: string[] = [];
  // wordKnowledge and grammarKnowledge are materialized projections; their
  // disappearance is not loss of canonical evidence in knowledge history.
  for (const name of ['cards', 'rooms', 'threads', 'participants'] as const) {
    const gone = missing(before[name], after[name]);
    if (gone.length) problems.push(`${name}: ${gone.length} missing`);
  }
  for (const [id, count] of Object.entries(before.cardReviews)) {
    if (after.cardReviews[id] !== undefined && after.cardReviews[id] < count) problems.push(`card ${id}: review history decreased`);
  }
  for (const [file, count] of Object.entries(before.journalRecords)) {
    if ((after.journalRecords[file] ?? 0) < count && !pendingJournalErases.includes(file)) problems.push(`${file}: journal shortened`);
  }
  if (after.knowledgeSequence < before.knowledgeSequence) problems.push('knowledge history sequence decreased');
  if (after.knowledgeEvidenceCount < before.knowledgeEvidenceCount) problems.push('knowledge evidence count decreased');
  if (missing(before.knowledgeKeyIds, after.knowledgeKeyIds).length) problems.push('knowledge history keys disappeared');
  if (after.legacyKnowledgeEvents < before.legacyKnowledgeEvents) problems.push('legacy knowledge events decreased');
  if (missing(before.legacyKnowledgeKeys, after.legacyKnowledgeKeys).length) problems.push('legacy knowledge keys disappeared');
  for (const [key, count] of Object.entries(before.legacyEvidence)) {
    if ((after.legacyEvidence[key] ?? 0) < count) problems.push(`${key}: legacy evidence decreased`);
  }
  return problems;
}

function writeAtomic(file: string, value: unknown): void {
  const tmp = `${file}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  let phase = startupTime();
  const encoded = JSON.stringify(value, null, 2);
  startupMark(`Guardian ${path.basename(file)} serialized`, phase);
  phase = startupTime();
  fs.writeFileSync(tmp, encoded, { mode: 0o600 });
  startupMark(`Guardian ${path.basename(file)} temp file written`, phase);
  phase = startupTime();
  fs.renameSync(tmp, file);
  startupMark(`Guardian ${path.basename(file)} temp file renamed`, phase);
}

export class Guardian {
  private readonly dir: string;
  private ledger: GuardianLedger | undefined;

  constructor(private readonly root: string) {
    this.dir = path.join(root, 'guardian');
  }

  get status(): { state: GuardianState; reason?: string; lastGoodSnapshot?: string; metrics?: GuardianMetrics } {
    return { state: this.ledger?.state ?? 'blocked', reason: this.ledger?.reason, lastGoodSnapshot: this.ledger?.lastGoodSnapshot, metrics: this.ledger?.metrics };
  }

  /** Call before any IPC registration, migration, or service mutation. */
  async preflight(): Promise<void> {
    const preflightStart = startupTime();
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    if (fs.existsSync(path.join(this.dir, 'restore-transaction.json'))) {
      this.finishRestore();
    }
    const previous = readJson(path.join(this.dir, 'ledger.json')) as GuardianLedger | undefined;
    if (previous && (previous.schema !== SCHEMA || previous.state === 'blocked')) {
      this.ledger = previous;
      throw new Error(`Guardian needs recovery: ${previous.reason ?? 'unsupported or blocked ledger'}`);
    }
    let current: GuardianMetrics;
    const inspectStart = startupTime();
    try { current = inspectGuardianData(this.root); }
    catch (error) { return this.block(`Canonical data failed validation: ${String(error)}`, previous); }
    startupMark('Guardian canonical data inspection complete', inspectStart);
    if (current.flashcardSchema > 3 || current.knowledgeSchema > 2) {
      return this.block('Current app cannot read this learner data schema; install a compatible release', previous);
    }
    const problems = previous ? loss(previous.metrics, current, previous.pendingJournalErases) : [];
    if (problems.length) return this.block(`Unexplained learner data loss: ${problems.join('; ')}`, previous);
    const latestSnapshotGeneration = this.listRecoveryPoints().reduce((max, name) => Math.max(max, Number(name.slice('snapshot-'.length))), 0);
    this.ledger = {
      schema: SCHEMA, generation: Math.max(previous?.generation ?? 0, latestSnapshotGeneration) + 1,
      state: 'ready', metrics: current, lastGoodSnapshot: previous?.lastGoodSnapshot,
      snapshotStamp: previous?.snapshotStamp,
    };
    // The snapshot is a consistent startup point: the single-instance lock is
    // held and normal writers have not yet been registered.
    const stampStart = startupTime();
    const snapshotNeeded = !previous?.lastGoodSnapshot || previous.snapshotStamp !== sourceStamp(this.root);
    startupMark(`Guardian snapshot decision needed=${snapshotNeeded}`, stampStart);
    if (snapshotNeeded) {
      const snapshotStart = startupTime();
      await this.snapshot();
      startupMark('Guardian recovery snapshot complete', snapshotStart);
    }
    writeAtomic(path.join(this.dir, 'ledger.json'), this.ledger);
    const importStart = startupTime();
    this.applyQueuedImport();
    startupMark('Guardian queued import check complete', importStart);
    startupMark('Guardian preflight complete', preflightStart);
  }

  /** Re-read canonical stores after migrations; never adopt a damaged state. */
  verify(): void {
    this.requireReady();
    let current: GuardianMetrics;
    try { current = inspectGuardianData(this.root); }
    catch (error) { return this.block(`Post-migration validation failed: ${String(error)}`, this.ledger); }
    const problems = loss(this.ledger!.metrics, current);
    if (problems.length) return this.block(`Post-migration learner data loss: ${problems.join('; ')}`, this.ledger);
    this.commit(current);
  }

  /** Capture the latest verified session state after writers have stopped. */
  async checkpoint(): Promise<void> {
    // A selected recovery point must remain available until the next preflight
    // installs it. The outgoing live profile is preserved by restore quarantine.
    if (fs.existsSync(path.join(this.dir, 'restore-transaction.json'))) return;
    this.verify();
    if (this.ledger!.snapshotStamp === sourceStamp(this.root)) return;
    this.ledger = { ...this.ledger!, generation: this.ledger!.generation + 1 };
    await this.snapshot();
    writeAtomic(path.join(this.dir, 'ledger.json'), this.ledger);
  }

  /** Authorize only specific intentional card removals, retaining the snapshot. */
  checkFlashcardWrite(next: unknown, removedCardIds: readonly string[] = [], resetReviewProgress = false): void {
    this.requireReady();
    const current = this.ledger!.metrics;
    const store = object(next, 'flashcard write');
    const nextCards = keys(store.flashcards, 'flashcards');
    const deleted = missing(current.cards, nextCards);
    if (deleted.some((id) => !removedCardIds.includes(id))) {
      throw new Error(`Guardian rejected flashcard write: ${deleted.length} undeclared cards missing`);
    }
    if (!resetReviewProgress) {
      const counts = reviewCounts(store.flashcards);
      for (const [id, count] of Object.entries(current.cardReviews)) {
        if (counts[id] !== undefined && counts[id] < count) throw new Error(`Guardian rejected flashcard write: ${id} review history decreased`);
      }
    }
  }

  /** Called only after a durable card write succeeds. */
  recordFlashcardWrite(next: unknown): void {
    this.requireReady();
    const store = object(next, 'flashcard write');
    this.commit({ ...this.ledger!.metrics,
      cards: keys(store.flashcards, 'flashcards'),
      flashcardSchema: Number(store.version ?? 0),
      cardReviews: reviewCounts(store.flashcards),
      wordKnowledge: keys(store.wordKnowledge, 'wordKnowledge'),
      grammarKnowledge: keys(store.grammarKnowledge, 'grammarKnowledge'),
    });
  }

  checkWorldWrite(next: unknown, allowed: { threads?: readonly string[]; participants?: readonly string[] } = {}): void {
    this.requireReady();
    const world = object(next, 'world write');
    for (const name of ['rooms', 'threads', 'participants'] as const) {
      const gone = missing(this.ledger!.metrics[name], ids(world[name], name));
      const permitted = name === 'threads' ? allowed.threads ?? [] : name === 'participants' ? allowed.participants ?? [] : [];
      if (gone.some((id) => !permitted.includes(id))) throw new Error(`Guardian rejected world write: ${gone.length} undeclared ${name} missing`);
    }
  }

  recordWorldWrite(next: unknown): void {
    this.requireReady();
    const world = object(next, 'world write');
    this.commit({ ...this.ledger!.metrics,
      rooms: ids(world.rooms, 'rooms'), threads: ids(world.threads, 'threads'), participants: ids(world.participants, 'participants'),
    });
  }

  recordJournalAppend(filePath: string, sequence: number): void {
    this.requireReady();
    const relative = path.relative(this.root, filePath);
    if (relative.startsWith('..') || !relative.startsWith(`journal${path.sep}`)) throw new Error('Invalid Guardian journal path');
    const current = this.ledger!.metrics.journalRecords[relative] ?? 0;
    if (sequence !== current + 1) this.block(`Journal append sequence changed: ${relative}`, this.ledger);
    this.commit({ ...this.ledger!.metrics, journalRecords: { ...this.ledger!.metrics.journalRecords, [relative]: sequence } });
  }

  beginJournalErase(filePath: string): void {
    this.requireReady();
    const relative = path.relative(this.root, filePath);
    if (relative.startsWith('..') || !relative.startsWith(`journal${path.sep}`)) throw new Error('Invalid Guardian journal path');
    this.ledger = { ...this.ledger!, pendingJournalErases: [...new Set([...(this.ledger!.pendingJournalErases ?? []), relative])] };
    writeAtomic(path.join(this.dir, 'ledger.json'), this.ledger);
  }

  finishJournalErase(filePath: string): void {
    this.requireReady();
    const relative = path.relative(this.root, filePath);
    const journalRecords = { ...this.ledger!.metrics.journalRecords };
    delete journalRecords[relative];
    this.ledger = { ...this.ledger!, pendingJournalErases: (this.ledger!.pendingJournalErases ?? []).filter((item) => item !== relative) };
    this.commit({ ...this.ledger.metrics, journalRecords });
  }

  recordKnowledgeSequence(sequence: number, appended = 0, touchedKeys: readonly string[] = []): void {
    this.requireReady();
    if (!Number.isSafeInteger(sequence) || sequence < this.ledger!.metrics.knowledgeSequence) {
      this.block('Knowledge history sequence decreased during a write', this.ledger);
    }
    if (sequence !== this.ledger!.metrics.knowledgeSequence || appended > 0) {
      this.commit({ ...this.ledger!.metrics, knowledgeSequence: sequence,
        knowledgeEvidenceCount: this.ledger!.metrics.knowledgeEvidenceCount + appended,
        knowledgeKeyIds: [...new Set([...this.ledger!.metrics.knowledgeKeyIds, ...touchedKeys])].sort() });
    }
  }

  checkKvWrite(next: unknown): void {
    this.requireReady();
    const counts = legacyEvidence(next);
    for (const [key, count] of Object.entries(this.ledger!.metrics.legacyEvidence)) {
      if ((counts[key] ?? 0) < count) throw new Error(`Guardian rejected KV write: ${key} legacy evidence decreased`);
    }
  }

  recordKvWrite(next: unknown): void {
    this.requireReady();
    this.commit({ ...this.ledger!.metrics, legacyEvidence: legacyEvidence(next) });
  }

  private commit(metrics: GuardianMetrics): void {
    this.ledger = { ...this.ledger!, metrics };
    writeAtomic(path.join(this.dir, 'ledger.json'), this.ledger);
  }

  private requireReady(): void {
    if (this.ledger?.state !== 'ready') throw new Error(this.ledger?.reason ?? 'Guardian has not completed preflight');
  }

  private block(reason: string, previous?: GuardianLedger): never {
    this.ledger = { schema: SCHEMA, generation: previous?.generation ?? 0,
      state: 'blocked', reason, snapshotStamp: previous?.snapshotStamp, pendingJournalErases: previous?.pendingJournalErases, metrics: previous?.metrics ?? {
        cards: [], cardReviews: {}, wordKnowledge: [], grammarKnowledge: [], rooms: [], threads: [], participants: [],
        journalRecords: {}, knowledgeSequence: 0, knowledgeKeys: 0, knowledgeKeyIds: [], knowledgeEvidenceCount: 0,
        legacyKnowledgeKeys: [], legacyKnowledgeEvents: 0, flashcardSchema: 0, knowledgeSchema: 0, legacyEvidence: {},
      }, lastGoodSnapshot: previous?.lastGoodSnapshot };
    writeAtomic(path.join(this.dir, 'ledger.json'), this.ledger);
    throw new Error(`Guardian blocked startup or write: ${reason}`);
  }

  private async snapshot(): Promise<void> {
    const snapshotStart = startupTime();
    const name = `snapshot-${String(this.ledger!.generation).padStart(8, '0')}`;
    const staging = path.join(this.dir, `${name}.staging`);
    const destination = path.join(this.dir, name);
    let phase = startupTime();
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true, mode: 0o700 });
    startupMark('Guardian snapshot staging prepared', phase);
    try {
      for (const file of DATA_FILES) {
        const source = path.join(this.root, file);
        if (fs.existsSync(source)) {
          phase = startupTime();
          fs.copyFileSync(source, path.join(staging, file));
          startupMark(`Guardian snapshot regular file copied ${file}`, phase);
        }
      }
      for (const dir of DATA_DIRS) {
        const source = path.join(this.root, dir);
        if (fs.existsSync(source)) {
          phase = startupTime();
          fs.cpSync(source, path.join(staging, dir), { recursive: true });
          startupMark(`Guardian snapshot directory copied ${dir}`, phase);
        }
      }
      let permissionEnumeration = 0n;
      let permissionChanges = 0n;
      let permissionFiles = 0;
      let permissionDirs = 0;
      const secure = (dir: string): void => {
        const enumStart = startupTime();
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        permissionEnumeration += startupTime() - enumStart;
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            const chmodStart = startupTime();
            fs.chmodSync(full, 0o700);
            permissionChanges += startupTime() - chmodStart;
            permissionDirs += 1;
            secure(full);
          } else if (entry.isFile()) {
            const chmodStart = startupTime();
            fs.chmodSync(full, 0o600);
            permissionChanges += startupTime() - chmodStart;
            permissionFiles += 1;
          }
        }
      };
      const dbPath = path.join(this.root, DB_FILE);
      if (fs.existsSync(dbPath)) {
        phase = startupTime();
        const db = new DatabaseSync(dbPath, { readOnly: true });
        try {
          const mode = db.prepare('PRAGMA journal_mode').get() as Record<string, unknown>;
          startupMark(`Guardian snapshot SQLite source open and mode=${String(Object.values(mode)[0])}`, phase);
          phase = startupTime();
          if (Object.values(mode)[0] === 'delete') {
            // No live writer exists before IPC setup; the rollback-journal
            // database can be copied without SQLite's WAL backup machinery.
            fs.copyFileSync(dbPath, path.join(staging, DB_FILE));
          } else {
            await backup(db, path.join(staging, DB_FILE));
          }
          startupMark('Guardian snapshot SQLite image copied', phase);
        }
        finally { db.close(); }
        // A recovery image is self-contained; it must not inherit a WAL mode
        // that depends on sidecar files from the live profile.
        phase = startupTime();
        const image = new DatabaseSync(path.join(staging, DB_FILE));
        try { image.exec('PRAGMA journal_mode=DELETE'); }
        finally { image.close(); }
        startupMark('Guardian snapshot SQLite image normalized', phase);
      }
      phase = startupTime();
      secure(staging);
      startupMark(`Guardian snapshot permissions applied files=${permissionFiles} dirs=${permissionDirs}`, phase);
      startupDuration('Guardian snapshot permission walk readdir', permissionEnumeration);
      startupDuration('Guardian snapshot chmod calls', permissionChanges);
      phase = startupTime();
      const checked = inspectGuardianData(staging);
      startupMark('Guardian snapshot data inspection complete', phase);
      phase = startupTime();
      if (loss(this.ledger!.metrics, checked).length || loss(checked, this.ledger!.metrics).length) {
        throw new Error('recovery snapshot differs from source');
      }
      startupMark('Guardian snapshot evidence comparison complete', phase);
      const cardStore = readJson(path.join(staging, 'flashcards.json')) as Record<string, unknown> | undefined;
      phase = startupTime();
      const manifest: SnapshotManifest = {
        schema: SCHEMA, metrics: checked, hashes: fileHashes(staging),
        flashcardVersion: Number(cardStore?.version ?? 0),
        knowledgeSchemaVersion: sqliteSchemaVersion(path.join(staging, DB_FILE)),
      };
      startupMark('Guardian snapshot hashing and manifest fields complete', phase);
      phase = startupTime();
      writeAtomic(path.join(staging, 'manifest.json'), manifest);
      startupMark('Guardian snapshot manifest write and rename complete', phase);
      phase = startupTime();
      if (fs.existsSync(destination)) throw new Error('Recovery snapshot generation already exists');
      fs.renameSync(staging, destination);
      startupMark('Guardian snapshot staging published by rename', phase);
      this.ledger!.lastGoodSnapshot = name;
      phase = startupTime();
      this.ledger!.snapshotStamp = sourceStamp(this.root);
      startupMark('Guardian snapshot final source stamp complete', phase);
      phase = startupTime();
      const snapshots = fs.readdirSync(this.dir).filter((entry) => /^snapshot-\d{8}$/.test(entry)).sort();
      for (const old of snapshots.slice(0, Math.max(0, snapshots.length - MAX_SNAPSHOTS))) {
        fs.rmSync(path.join(this.dir, old), { recursive: true, force: true });
      }
      startupMark('Guardian snapshot old generations pruned', phase);
      startupMark('Guardian snapshot total', snapshotStart);
    } catch (error) {
      fs.rmSync(staging, { recursive: true, force: true });
      throw error;
    }
  }

  listRecoveryPoints(): string[] {
    if (!fs.existsSync(this.dir)) return [];
    return fs.readdirSync(this.dir).filter((entry) => /^snapshot-\d{8}$/.test(entry)).sort().reverse();
  }

  listRecoveryPointSummaries(): RecoveryPointSummary[] {
    return this.listRecoveryPoints().flatMap((id) => {
      try {
        const location = path.join(this.dir, id);
        const manifest = readJson(path.join(location, 'manifest.json')) as SnapshotManifest | undefined;
        if (!manifest || manifest.schema !== SCHEMA) return [];
        return [{ id, createdAt: fs.statSync(location).mtimeMs,
          cards: manifest.metrics.cards.length, rooms: manifest.metrics.rooms.length,
          participants: manifest.metrics.participants.length }];
      } catch {
        // One damaged snapshot must not hide the others in Settings.
        return [];
      }
    });
  }

  /** Validate before scheduling restoration at startup, before writers open files. */
  queueRestore(snapshotName: string): void {
    this.requireReady();
    if (!this.listRecoveryPoints().includes(snapshotName)) throw new Error('Unknown recovery snapshot');
    this.validateSnapshot(snapshotName);
    if (fs.existsSync(path.join(this.dir, 'restore-transaction.json'))) throw new Error('Recovery is already scheduled');
    writeAtomic(path.join(this.dir, 'restore-transaction.json'), {
      snapshotName, quarantine: `quarantine-${Date.now()}`,
    });
  }

  cancelQueuedRestore(snapshotName: string): void {
    const transactionPath = path.join(this.dir, 'restore-transaction.json');
    const transaction = readJson(transactionPath) as { snapshotName?: string } | undefined;
    if (transaction?.snapshotName === snapshotName) fs.rmSync(transactionPath);
  }

  newestVerifiedRecoveryPoint(): string | undefined {
    for (const name of this.listRecoveryPoints()) {
      try { this.validateSnapshot(name); return name; }
      catch { /* Try the preceding snapshot without changing the ledger. */ }
    }
    return undefined;
  }

  /** Preserve the damaged profile in quarantine, then publish a verified snapshot. */
  restore(snapshotName: string): void {
    if (!this.listRecoveryPoints().includes(snapshotName)) throw new Error('Unknown recovery snapshot');
    const manifest = this.validateSnapshot(snapshotName);
    const quarantine = `quarantine-${Date.now()}`;
    writeAtomic(path.join(this.dir, 'restore-transaction.json'), { snapshotName, quarantine });
    this.finishRestore();
    if (loss(manifest.metrics, inspectGuardianData(this.root)).length) throw new Error('Restored data lost evidence');
  }

  /** Queue a user-selected archive for validation and installation before next startup mutations. */
  queueImportArchive(archivePath: string): void {
    this.requireReady();
    const bytes = fs.readFileSync(archivePath);
    if (bytes.length > 2 * 1024 * 1024 * 1024) throw new Error('Import archive is too large');
    const archive = new AdmZip(bytes);
    const names = archive.getEntries().map((entry) => entry.entryName);
    if (!names.some((name) => [...DATA_FILES, DB_FILE].includes(name as typeof DATA_FILES[number]))) throw new Error('Import has no supported data files');
    const pending = path.join(this.dir, 'pending-import.zip');
    const tmp = `${pending}.tmp`;
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, pending);
    writeAtomic(path.join(this.dir, 'pending-import.json'), {
      checksum: createHash('sha256').update(bytes).digest('hex'),
    });
  }

  private applyQueuedImport(): void {
    const marker = readJson(path.join(this.dir, 'pending-import.json')) as { checksum?: string } | undefined;
    if (!marker) return;
    const bytes = fs.readFileSync(path.join(this.dir, 'pending-import.zip'));
    if (createHash('sha256').update(bytes).digest('hex') !== marker.checksum) throw new Error('Queued import checksum mismatch');
    const zip = new AdmZip(bytes);
    const candidateName = `import-${Date.now()}`;
    const candidate = path.join(this.dir, candidateName);
    const source = path.join(this.dir, this.ledger!.lastGoodSnapshot!);
    fs.cpSync(source, candidate, { recursive: true });
    fs.rmSync(path.join(candidate, 'manifest.json'));
    let total = 0;
    for (const entry of zip.getEntries()) {
      const name = entry.entryName;
      const normalized = path.normalize(name);
      if (normalized !== name || name.startsWith('..') || path.isAbsolute(name)) throw new Error('Unsafe import path');
      const allowed = (DATA_FILES as readonly string[]).includes(name) || name === DB_FILE
        || (IMPORT_DIRS as readonly string[]).some((dir) => name.startsWith(`${dir}/`));
      if (!allowed) continue;
      if (entry.isDirectory) continue;
      const size = entry.header.size;
      total += size;
      if (size > 512 * 1024 * 1024 || total > 2 * 1024 * 1024 * 1024) throw new Error('Import exceeds size limit');
      const target = path.join(candidate, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, entry.getData());
    }
    const checked = inspectGuardianData(candidate);
    const cardStore = readJson(path.join(candidate, 'flashcards.json')) as Record<string, unknown> | undefined;
    const manifest: SnapshotManifest = { schema: SCHEMA, metrics: checked, hashes: fileHashes(candidate),
      flashcardVersion: Number(cardStore?.version ?? 0), knowledgeSchemaVersion: sqliteSchemaVersion(path.join(candidate, DB_FILE)) };
    writeAtomic(path.join(candidate, 'manifest.json'), manifest);
    this.validateSnapshot(candidateName);
    writeAtomic(path.join(this.dir, 'restore-transaction.json'), {
      snapshotName: candidateName, quarantine: `quarantine-import-${Date.now()}`,
      origin: 'import', previousSnapshot: this.ledger!.lastGoodSnapshot,
    });
    this.finishRestore();
  }

  private validateSnapshot(name: string): SnapshotManifest {
    const source = path.join(this.dir, name);
    const manifest = readJson(path.join(source, 'manifest.json')) as SnapshotManifest | undefined;
    if (!manifest || manifest.schema !== SCHEMA) throw new Error('Unsupported recovery manifest');
    if (!Number.isSafeInteger(manifest.flashcardVersion) || manifest.flashcardVersion > 3
      || !Number.isSafeInteger(manifest.knowledgeSchemaVersion) || manifest.knowledgeSchemaVersion > 2) {
      throw new Error('Recovery snapshot needs a newer mLearn data schema');
    }
    if (JSON.stringify(fileHashes(source)) !== JSON.stringify(manifest.hashes)) throw new Error('Recovery snapshot checksum mismatch');
    const checked = inspectGuardianData(source);
    if (loss(manifest.metrics, checked).length || loss(checked, manifest.metrics).length) {
      throw new Error('Recovery snapshot semantic metrics mismatch');
    }
    return manifest;
  }

  private finishRestore(): void {
    const transaction = readJson(path.join(this.dir, 'restore-transaction.json')) as {
      snapshotName: string; quarantine: string; origin?: 'import'; previousSnapshot?: string;
    } | undefined;
    if (!transaction) return;
    const manifest = this.validateSnapshot(transaction.snapshotName);
    const source = path.join(this.dir, transaction.snapshotName);
    const quarantine = path.join(this.dir, transaction.quarantine);
    fs.mkdirSync(quarantine, { recursive: true });
    for (const item of RESTORE_ITEMS) {
      const live = path.join(this.root, item);
      const saved = path.join(quarantine, item);
      const recovered = path.join(source, item);
      if (fs.existsSync(live)) {
        if (!fs.existsSync(saved)) fs.renameSync(live, saved);
        else fs.rmSync(live, { recursive: true, force: true });
      }
      if (fs.existsSync(recovered)) fs.cpSync(recovered, live, { recursive: true });
    }
    const checked = inspectGuardianData(this.root);
    if (loss(manifest.metrics, checked).length || loss(checked, manifest.metrics).length) {
      throw new Error('Restored data failed validation; original profile remains in quarantine');
    }
    const prior = readJson(path.join(this.dir, 'ledger.json')) as GuardianLedger | undefined;
    this.ledger = { schema: SCHEMA, generation: prior?.generation ?? 0, state: 'ready', metrics: checked,
      lastGoodSnapshot: transaction.origin === 'import' ? transaction.previousSnapshot : transaction.snapshotName,
      snapshotStamp: transaction.origin === 'import' ? undefined : sourceStamp(this.root) };
    writeAtomic(path.join(this.dir, 'ledger.json'), this.ledger);
    fs.rmSync(path.join(this.dir, 'restore-transaction.json'));
    if (transaction.origin === 'import') {
      fs.rmSync(path.join(this.dir, 'pending-import.json'), { force: true });
      fs.rmSync(path.join(this.dir, 'pending-import.zip'), { force: true });
    }
  }
}

let activeGuardian: Guardian | undefined;

export function activateGuardian(guardian: Guardian): void {
  activeGuardian = guardian;
}

export function guardianForWrites(): Guardian | undefined {
  return activeGuardian;
}
