/**
 * Native-attempt scaling benchmark: measures the REAL KnowledgeHistoryStore
 * paths (append, v2 compaction with contribution records, archived-attempt
 * retraction, checkpoint rebuild, History overview) for attempt-majority
 * histories. "before" = attempts exact forever (no compaction run);
 * "after" = compact native-attempt architecture.
 *
 * Usage (esbuild bundle + node, matching the repo's toolchain):
 *   npx esbuild scripts/benchmark-native-attempts.ts --bundle --platform=node \
 *     --format=cjs --outfile=/tmp/bench-native.cjs && node /tmp/bench-native.cjs
 * Scenarios (default): 5 50 250 attempts/key → 100k / 1M / 5M over 20k keys.
 * Memory figures are SAMPLED process.heapUsed (before/after each phase), not
 * a true allocator peak.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KnowledgeHistoryStore } from '../src/electron/services/knowledgeHistoryStore';
import type { KnowledgeEvent } from '../src/shared/knowledgeEvents';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 15, 12);
const KEYS = 20_000;
const LANGS = ['ja', 'zh', 'es'];

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stream-generate one key's native history: attempts dominate by design. */
function buildKeyEvents(keyIndex: number, attemptsPerKey: number, rng: () => number): KnowledgeEvent[] {
  const lang = LANGS[keyIndex % LANGS.length];
  const key = `${lang}:k${keyIndex}`;
  const events: KnowledgeEvent[] = [];
  const spanDays = 720;
  // A sparse anki past for realism (10% of keys), pre-dating the attempts.
  if (keyIndex % 10 === 0) {
    events.push({ t: NOW - spanDays * DAY, kind: 'review', source: 'anki', aspect: 'meaning', easeAfter: 2.3, rating: 'good', timesSeenDelta: 1, ankiReviewId: keyIndex * 10 });
  }
  for (let n = 0; n < attemptsPerKey; n++) {
    const t = Math.floor(NOW - (spanDays - (n / attemptsPerKey) * (spanDays - 30)) * DAY - rng() * DAY);
    const method = rng() < 0.3 ? 'inference' : 'recall';
    const quality = rng() < 0.7 ? 'fluent' : rng() < 0.6 ? 'struggled' : 'missed';
    const scaffoldRoll = rng();
    const scaffolds = scaffoldRoll < 0.15 ? { reading: true } : scaffoldRoll < 0.25 ? { translation: true } : undefined;
    const kind: KnowledgeEvent['kind'] = rng() < 0.8 ? 'rating' : 'status';
    events.push({
      t,
      kind,
      source: 'srs',
      aspect: 'meaning',
      attemptId: `a-${keyIndex}-${n}`,
      ...(kind === 'rating' ? { easeAfter: 1.8 + rng() * 2.2, rating: quality === 'missed' ? 'again' : quality === 'struggled' ? 'hard' : rng() < 0.5 ? 'good' : 'easy' } : { toStatus: quality === 'fluent' ? 'known' : 'learning' }),
      quality,
      method,
      ...(scaffolds ? { scaffolds } : {}),
      latencyMs: Math.floor(500 + rng() * 9000),
      ...(rng() < 0.2 ? { activeLatencyMs: Math.floor(300 + rng() * 2000) } : {}),
      timesSeenDelta: 1,
      taskType: 'reader',
    } as KnowledgeEvent);
  }
  // A recent tail row so every key has live exact history.
  events.push({ t: NOW - 2 * DAY, kind: 'review', source: 'srs', aspect: 'meaning', easeAfter: 2.8, rating: 'good', timesSeenDelta: 1 } as KnowledgeEvent);
  return events;
}

function ms(start: number): number {
  return Math.round((performance.now() - start) * 100) / 100;
}

function peakHeap(): number {
  return Math.round(process.memoryUsage().heapUsed / 1048576);
}

async function runScenario(attemptsPerKey: number): Promise<void> {
  const totalAttempts = KEYS * attemptsPerKey;
  const label = `${totalAttempts.toLocaleString()} attempts (${KEYS.toLocaleString()} keys × ${attemptsPerKey})`;
  console.log(`\n── scenario: ${label} ──`);

  // BEFORE: attempts stay exact forever (legacy policy) — same seed, no compaction.
  const beforeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mlearn-bench-before-'));
  const before = KnowledgeHistoryStore.open(path.join(beforeDir, 's.sqlite3'));
  let genStart = performance.now();
  let appended = 0;
  for (let start = 0; start < KEYS; start += 100) {
    const batch: KnowledgeEventLog = {};
    for (let k = start; k < Math.min(start + 100, KEYS); k++) {
      batch[`${LANGS[k % LANGS.length]}:k${k}`] = buildKeyEvents(k, attemptsPerKey, mulberry32(1000 + k));
    }
    before.appendEvents(batch);
    appended += Object.values(batch).reduce((sum, events) => sum + events.length, 0);
    process.stdout.write(`before append ${start + 100}\r\n`);
  }
  const beforeAppend = ms(genStart);
  const beforeStats = before.storageStats();
  // Startup shape: cold open + full language overview (checkpoint path).
  genStart = performance.now();
  before.queryKeySummaries('ja', NOW);
  const beforeOverview = ms(genStart);
  genStart = performance.now();
  before.rebuildCheckpoints();
  const beforeRebuild = ms(genStart);
  before.close();
  fs.rmSync(beforeDir, { recursive: true, force: true });

  // AFTER: compact native-attempt architecture.
  const afterDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mlearn-bench-after-'));
  const after = KnowledgeHistoryStore.open(path.join(afterDir, 's.sqlite3'));
  genStart = performance.now();
  for (let start = 0; start < KEYS; start += 100) {
    const batch: KnowledgeEventLog = {};
    for (let k = start; k < Math.min(start + 100, KEYS); k++) {
      batch[`${LANGS[k % LANGS.length]}:k${k}`] = buildKeyEvents(k, attemptsPerKey, mulberry32(1000 + k));
    }
    after.appendEvents(batch);
  }
  const afterAppend = ms(genStart);

  // Append latency after the fact (5 fresh single-event appends).
  const appendLat: number[] = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    after.appendEvents({ 'ja:k0': [{ t: NOW - DAY + i, kind: 'review', source: 'srs', aspect: 'meaning', easeAfter: 2.7, rating: 'good', timesSeenDelta: 1 } as KnowledgeEvent] });
    appendLat.push(ms(start));
  }
  const appendAvg = (appendLat.reduce((a, b) => a + b, 0) / appendLat.length).toFixed(3);

  // Compaction (includes record emission + attempt index).
  const heapBefore = peakHeap();
  const compStart = performance.now();
  let compactedKeys = 0;
  while (true) {
    const passStart = performance.now();
    const n = after.compact(NOW, 2000);
    compactedKeys += n;
    process.stdout.write(`compact pass: ${n} keys in ${ms(passStart)}ms\r\n`);
    if (n === 0) break;
  }
  const compactMs = ms(compStart);
  const heapPeak = Math.max(peakHeap(), heapBefore);

  const afterStats = after.storageStats();

  // Archived retraction: five distinct ja keys, one real reversal each.
  const retractSamples: number[] = [];
  for (let i = 0; i < 5; i++) {
    // Five distinct ja keys, same in-key position: attempt 1 of
    // floor(attemptsPerKey * 0.3) archived ones (past tail and acquisition
    // windows for every default scenario), so every sample is a real
    // archived-contribution reversal.
    const keyIndex = i * 3;
    const attemptId = `a-${keyIndex}-${Math.max(1, Math.floor(attemptsPerKey * 0.3) - 1)}`;
    const start = performance.now();
    after.appendEvents({ [`ja:k${keyIndex}`]: [{ t: NOW, kind: 'retraction', source: 'manual', retracts: attemptId } as KnowledgeEvent] });
    retractSamples.push(ms(start));
  }
  const retractAvg = (retractSamples.reduce((a, b) => a + b, 0) / retractSamples.length).toFixed(2);

  // Startup shape after compaction + retraction.
  genStart = performance.now();
  after.queryKeySummaries('ja', NOW);
  const afterOverview = ms(genStart);
  genStart = performance.now();
  after.rebuildCheckpoints();
  const afterRebuild = ms(genStart);

  after.close();

  const b = (n: number): string => `${(n / 1048576).toFixed(1)}MB`;
  console.log(`events=${appended.toLocaleString()} compactedKeys=${compactedKeys.toLocaleString()} compact=${compactMs}ms (${Math.round(appended / Math.max(1, compactMs))}/ms) sampledHeap=${heapPeak}MB`);
  console.log(`append: batch-sweep=${beforeAppend}ms/${afterAppend}ms  single=${appendAvg}ms  retraction(archived)=${retractAvg}ms`);
  console.log(`overview(ja keys): before=${beforeOverview}ms after=${afterOverview}ms  rebuildCheckpoints: before=${beforeRebuild}ms after=${afterRebuild}ms`);
  console.log(`BEFORE bytes: db=${b(beforeStats.dbBytes)} rows=${beforeStats.rows.toLocaleString()}/${b(beforeStats.rowBytes)}`);
  console.log(`AFTER  bytes: db=${b(afterStats.dbBytes)} rows=${afterStats.rows.toLocaleString()}/${b(afterStats.rowBytes)} archives=${b(afterStats.archiveBytes)} attemptIndex=${afterStats.attemptIndex.toLocaleString()}/${b(afterStats.attemptBytes)} bucketRecs=${b(afterStats.bucketRecBytes)}`);
  // Comparable LOGICAL bytes: exact-row JSON vs exact+archive+records.
  // (dbBytes is physical page allocation incl. free pages — reported raw.)
  const beforeLogicalPerEvent = beforeStats.rowBytes / appended;
  const afterLogicalPerEvent = (afterStats.rowBytes + afterStats.archiveBytes + afterStats.attemptBytes + afterStats.bucketRecBytes) / appended;
  console.log(`logical B/event: before(exact rows)=${beforeLogicalPerEvent.toFixed(0)}  after(rows+archives+index+recs)=${afterLogicalPerEvent.toFixed(0)}`);
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  const scenarios = arg ? [Number(arg)] : [5, 50, 250];
  for (const perKey of scenarios) {
    await runScenario(perKey);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
