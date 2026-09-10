// Knowledge-history scaling benchmark (streaming fixtures — no whole-journal materialization).
// Usage: npx esbuild scripts/benchmark-knowledge-history.ts --bundle --platform=node --outfile=/tmp/kh-bench.mjs --format=esm --external:node:sqlite && node /tmp/kh-bench.mjs
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { compactKeyEvents, computeRetention, foldFromArchive, type KeyArchive } from '../src/shared/knowledge/historyArchive';
import { applyEventToFold, emptyKeyFold, mergeKeyFolds, projectKeyFold, type FoldState } from '../src/shared/utils/projectionReplay';
import { stripRetractions } from '../src/shared/knowledgeEvents';

function foldRowsAndArchive(mapped: Array<{ event: KnowledgeEvent; seq: number }>, archive: KeyArchive | undefined): FoldState {
  const active = stripRetractedRows(mapped);
  const sorted = [...active].sort((a, b) => a.event.t - b.event.t || a.seq - b.seq);
  const exact = emptyKeyFold();
  for (const { event, seq } of sorted) applyEventToFold(exact, event, seq);
  return archive ? mergeKeyFolds(foldFromArchive(archive), exact) : exact;
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
import type { KnowledgeEvent } from '../src/shared/knowledgeEvents';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 15, 12);
const POLICY = { learningSteps: [1, 10], relearnSteps: [10], graduatingInterval: 1, easyInterval: 4, reviewIntervalModifier: 100, maxInterval: 365 };

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildKeyRows(_key: string, k: number, reviewsPerKey: number, spanDays: number, rng: () => number): KnowledgeEvent[] {
  const firstT = NOW - spanDays * DAY;
  const rows: KnowledgeEvent[] = [];
  for (let r = 0; r < reviewsPerKey; r++) {
    const t = Math.floor(firstT + (r / Math.max(1, reviewsPerKey)) * (spanDays - 1) * DAY + rng() * DAY);
    rows.push({ t, kind: 'review', source: 'anki', aspect: 'meaning', easeAfter: Math.round(1300 + rng() * 2200) / 1000, rating: 'good', timesSeenDelta: 1, ankiReviewId: firstT + r * 1000 + k });
  }
  rows.push({ t: NOW - 5 * DAY, kind: 'claim', source: 'manual', aspect: 'meaning', toStatus: 'known' });
  rows.push({ t: NOW - 3 * DAY, kind: 'rating', source: 'srs', aspect: 'meaning', attemptId: `a-${k}`, quality: 'fluent', easeAfter: 2.9, timesSeenDelta: 1 });
  return rows.sort((a, b) => (a.t as number) - (b.t as number));
}

interface StoreDb { db: DatabaseSync; seq: number }
function openStore(dir: string): StoreDb {
  const db = new DatabaseSync(path.join(dir, 'bench.sqlite3'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rows (id INTEGER PRIMARY KEY AUTOINCREMENT, seq INTEGER NOT NULL UNIQUE, key TEXT NOT NULL, lang TEXT NOT NULL, t INTEGER NOT NULL, json TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS rows_key_t ON rows(key, t, seq);
    CREATE TABLE IF NOT EXISTS archives (key TEXT PRIMARY KEY, lang TEXT NOT NULL, frontier_t INTEGER NOT NULL, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS checkpoints (key TEXT PRIMARY KEY, lang TEXT NOT NULL, frontier_seq INTEGER NOT NULL, json TEXT NOT NULL);`);
  return { db, seq: 0 };
}

function ms(start: number): number {
  return Math.round((performance.now() - start) * 100) / 100;
}

async function main(): Promise<void> {
  const scenarios = [
    { label: 'profile ×0.5 (9k keys)', keyCount: 9000, reviewsPerKey: 17, spanDays: 890 },
    { label: 'profile ×1 (18k keys, ~595k events)', keyCount: 18000, reviewsPerKey: 33, spanDays: 890 },
    { label: 'profile ×5 (45k keys, ~1.5M events)', keyCount: 45000, reviewsPerKey: 33, spanDays: 890 },
    { label: 'profile ×20 (90k keys, ~6M events)', keyCount: 90000, reviewsPerKey: 66, spanDays: 3600 },
  ];

  const rows: string[] = [];
  rows.push('| scenario | events | legacy JSON | store size | legacy JSON.parse | store insert | compaction pass | checkpoint build | checkpoint load (startup) | append ×5 | 1-key projection read | History day/month/year/all |');
  rows.push('|---|---|---|---|---|---|---|---|---|---|---|---|');

  for (const scenario of scenarios) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kh-bench-'));
    const store = openStore(dir);
    const rng = mulberry32(7);
    const jsonPath = path.join(dir, 'legacy-events.json');
    const jsonFd = fs.openSync(jsonPath, 'w');
    fs.writeSync(jsonFd, '{');
    let events = 0;
    let jsonBytes = 0;
    let firstKey = '';

    const insert = store.db.prepare('INSERT INTO rows (seq, key, lang, t, json) VALUES (?, ?, ?, ?, ?)');
    let t0 = performance.now();
    for (let k = 0; k < scenario.keyCount; k++) {
      const key = `ja:k${k}`;
      if (k === 0) firstKey = key;
      const rowsFor = buildKeyRows(key, k, scenario.reviewsPerKey, scenario.spanDays, rng);
      if (k > 0) fs.writeSync(jsonFd, ',');
      fs.writeSync(jsonFd, `"${key}":${JSON.stringify(rowsFor)}`);
      for (const event of rowsFor) {
        store.seq += 1;
        const json = JSON.stringify(event);
        jsonBytes += json.length + key.length + 8;
        insert.run(store.seq, key, 'ja', event.t as number, json);
        events += 1;
      }
    }
    fs.writeSync(jsonFd, '}');
    fs.closeSync(jsonFd);
    const insertMs = ms(t0);

    // Legacy equivalent: JSON.parse of the same journal. Node caps strings at
    // ~512MB — beyond that the legacy path is not just slow, it CRASHES; the
    // size column still tells the growth story.
    const legacyBytes = fs.statSync(jsonPath).size;
    t0 = performance.now();
    let legacyParseMs = ms(t0);
    if (legacyBytes < 4e8) {
      const raw = fs.readFileSync(jsonPath, 'utf-8');
      const parsedLegacy: unknown = JSON.parse(raw);
      void parsedLegacy;
      legacyParseMs = ms(t0);
    } else {
      legacyParseMs = NaN;
    }

    // Compaction pass over every key.
    t0 = performance.now();
    const compactStmt = store.db.prepare('INSERT INTO archives (key, lang, frontier_t, json) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET frontier_t = excluded.frontier_t, json = excluded.json');
    const deleteRows = store.db.prepare('DELETE FROM rows WHERE key = ?');
    const reinsert = store.db.prepare('INSERT INTO rows (seq, key, lang, t, json) VALUES (?, ?, ?, ?, ?)');
    const selectRows = store.db.prepare('SELECT seq, json FROM rows WHERE key = ? ORDER BY t, seq');
    for (let k = 0; k < scenario.keyCount; k++) {
      const key = `ja:k${k}`;
      const rowsFor = selectRows.all(key) as Array<{ seq: number; json: string }>;
      const mapped = rowsFor.map((row) => ({ event: JSON.parse(row.json) as KnowledgeEvent, seq: row.seq }));
      const compact = compactKeyEvents(mapped, NOW);
      if (!compact.archive) continue;
      compactStmt.run(key, 'ja', compact.archive.frontierT, JSON.stringify(compact.archive));
      deleteRows.run(key);
      for (const { event, seq } of compact.kept) reinsert.run(seq, key, 'ja', event.t as number, JSON.stringify(event));
    }
    const compactMs = ms(t0);

    // Checkpoint build (real fold per key: archive prefix + exact rows).
    const archiveStmt = store.db.prepare('SELECT json FROM archives WHERE key = ?');
    t0 = performance.now();
    const checkpointInsert = store.db.prepare('INSERT INTO checkpoints (key, lang, frontier_seq, json) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET frontier_seq = excluded.frontier_seq, json = excluded.json');
    for (let k = 0; k < scenario.keyCount; k++) {
      const key = `ja:k${k}`;
      const rowsFor = selectRows.all(key) as Array<{ seq: number; json: string }>;
      const mapped = rowsFor.map((row) => ({ event: JSON.parse(row.json) as KnowledgeEvent, seq: row.seq }));
      const archiveRow = archiveStmt.get(key) as { json?: string } | undefined;
      const archive = archiveRow?.json ? (JSON.parse(archiveRow.json) as KeyArchive) : undefined;
      const fold = foldRowsAndArchive(mapped, archive);
      const frontierSeq = mapped.reduce((max, row) => Math.max(max, row.seq), 0);
      checkpointInsert.run(key, 'ja', frontierSeq, JSON.stringify({ fold, frontierSeq }));
    }
    const checkpointBuildMs = ms(t0);

    // Startup path: load all checkpoints from disk.
    t0 = performance.now();
    const allCheckpoints = store.db.prepare('SELECT json FROM checkpoints').all() as Array<{ json: string }>;
    let checkpointBytes = 0;
    for (const row of allCheckpoints) {
      checkpointBytes += row.json.length;
      void JSON.parse(row.json);
    }
    const checkpointLoadMs = ms(t0);

    // Append ×5.
    t0 = performance.now();
    for (let i = 0; i < 5; i++) {
      store.seq += 1;
      insert.run(store.seq, 'ja:append-probe', 'ja', NOW + i, JSON.stringify({ t: NOW + i, kind: 'status', source: 'anki', aspect: 'meaning', toStatus: 'learning' }));
    }
    const appendMs = ms(t0);

    // One-key projection read: checkpoint load + tail rows + projection.
    t0 = performance.now();
    {
      const checkpointRow = store.db.prepare('SELECT json FROM checkpoints WHERE key = ?').get(firstKey) as { json?: string } | undefined;
      const checkpoint = checkpointRow?.json ? (JSON.parse(checkpointRow.json) as { fold: FoldState; frontierSeq: number }) : undefined;
      const rowsFor = selectRows.all(firstKey) as Array<{ seq: number; json: string }>;
      const mapped = rowsFor.map((row) => ({ event: JSON.parse(row.json) as KnowledgeEvent, seq: row.seq })).filter(({ seq }) => seq > (checkpoint?.frontierSeq ?? 0));
      const fold = checkpoint ? { ...checkpoint.fold } : emptyKeyFold();
      for (const { event, seq } of mapped) applyEventToFold(fold, event, seq);
      void projectKeyFold(fold);
    }
    const projectionReadMs = ms(t0);

    // History range queries (exact-row aggregates + archive scan).
    t0 = performance.now();
    for (const days of [1, 30, 365, 100000]) {
      const from = NOW - days * DAY;
      void (store.db.prepare('SELECT COUNT(*) AS n FROM rows WHERE lang = ? AND t >= ?').get('ja', from) as { n: number });
      void (store.db.prepare('SELECT COUNT(*) AS n FROM archives WHERE lang = ?').get('ja') as { n: number });
    }
    const historyMs = ms(t0);

    // Retention equivalence sanity on the first key.
    {
      const rowsFor = selectRows.all(firstKey) as Array<{ seq: number; json: string }>;
      const mapped = rowsFor.map((row) => ({ event: JSON.parse(row.json) as KnowledgeEvent, seq: row.seq }));
      const archiveRow = archiveStmt.get(firstKey) as { json?: string } | undefined;
      const archive = archiveRow?.json ? (JSON.parse(archiveRow.json) as KeyArchive) : undefined;
      const compacted = computeRetention(archive, mapped, POLICY, NOW, () => true);
      void compacted;
    }

    const storeSize = (fs.statSync(path.join(dir, 'bench.sqlite3')).size + fs.statSync(path.join(dir, 'bench.sqlite3-wal')).size) / 1e6;
    rows.push(`| ${scenario.label} | ${events} | ${(legacyBytes / 1e6).toFixed(1)}MB | ${storeSize.toFixed(1)}MB | ${legacyParseMs}ms | ${insertMs}ms | ${compactMs}ms | ${checkpointBuildMs}ms | ${checkpointLoadMs}ms (${(checkpointBytes / 1e6).toFixed(1)}MB) | ${appendMs}ms | ${projectionReadMs}ms | ${historyMs}ms |`);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log(rows.join('\n'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
