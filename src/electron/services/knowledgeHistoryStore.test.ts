import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { KnowledgeEvent, KnowledgeEventLog } from '../../shared/knowledgeEvents';
import { replayKeyProjection } from '../../shared/utils/projectionReplay';
import { COMPACTION_KEY_BUDGET, KnowledgeHistoryStore } from './knowledgeHistoryStore';

const DAY = 24 * 60 * 60 * 1000;

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mlearn-khstore-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function store(): KnowledgeHistoryStore {
  return KnowledgeHistoryStore.open(path.join(dir, 'knowledge-history.sqlite3'));
}

const NOW_VAL = () => Date.UTC(2026, 7, 15, 12);

function attemptEvent(overrides: Partial<KnowledgeEvent> & { t: number }): KnowledgeEvent {
  return {
    kind: 'review',
    source: 'srs',
    aspect: 'meaning',
    attemptId: `attempt-${overrides.t}`,
    easeAfter: 2.5,
    timesSeenDelta: 1,
    ...overrides,
  } as KnowledgeEvent;
}

function ankiReview(t: number, easeAfter: number, ankiReviewId?: number): KnowledgeEvent {
  return { t, kind: 'review', source: 'anki', aspect: 'meaning', easeAfter, rating: 'good', timesSeenDelta: 1, ...(ankiReviewId !== undefined ? { ankiReviewId } : {}) };
}

function ankiStatus(t: number, toStatus: KnowledgeEvent['toStatus']): KnowledgeEvent {
  return { t, kind: 'status', source: 'anki', aspect: 'meaning', toStatus };
}

describe('KnowledgeHistoryStore', () => {
  it('round-trips appends through exact rows and derives matching projections', () => {
    const s = store();
    const now = Date.now();
    const events: KnowledgeEventLog = {
      'ja:h1': [ankiReview(now - DAY, 2.8), ankiStatus(now - 3600_000, 'known')],
    };
    s.appendEvents(events);
    const exact = s.getExactEvents(['ja:h1']);
    expect(exact['ja:h1']).toHaveLength(2);
    const state = s.getKnowledgeState('ja:h1');
    expect(state.projection).toEqual(replayKeyProjection(events['ja:h1']));
    expect(state.hasArchive).toBe(false);
    s.close();
  });

  it('compacts old aggregatable rows but keeps exact projections, ledger rows, and retraction behavior', () => {
    const s = store();
    const now = Date.now();
    const old = now - 400 * DAY;
    const attemptId = 'attempt-ancient';
    const log: KnowledgeEventLog = {
      'ja:h1': [
        ankiReview(old, 1.5, 1001),
        ankiReview(old + 1000, 2.2, 1002),
        { ...attemptEvent({ t: old + 2000 }), attemptId, easeAfter: 3.1 },
        ankiReview(old + 30 * DAY, 2.4, 1003),
        ankiReview(old + 60 * DAY, 2.6, 1004),
        ankiReview(now - DAY, 2.9, 1005),
      ],
    };
    s.appendEvents(log);
    expect(s.compact(now)).toBe(1);

    // Archive exists; exact rows keep the ledger attempt + recent tail + acquisition residue.
    const archive = s.getArchive('ja:h1');
    expect(archive).toBeDefined();
    expect(archive!.archivedEventCount).toBeGreaterThan(0);
    const exact = s.getExactEvents(['ja:h1'])['ja:h1'];
    expect(exact.some((event) => event.attemptId === attemptId)).toBe(true);

    // Projection equivalence: compacted store vs raw replay.
    const state = s.getKnowledgeState('ja:h1');
    expect(state.projection).toEqual(replayKeyProjection(log['ja:h1']));

    // Ancient attempt still retractable after compaction: append a tombstone.
    s.appendEvents({ 'ja:h1': [{ t: now, kind: 'retraction', source: 'manual', retracts: attemptId }] });
    const afterRetract = s.getKnowledgeState('ja:h1');
    const rawWithRetraction = [...log['ja:h1'], { t: now, kind: 'retraction', source: 'manual', retracts: attemptId } as KnowledgeEvent];
    expect(afterRetract.projection).toEqual(replayKeyProjection(rawWithRetraction));
    s.close();
  });

  it('imports a legacy JSON log with per-key projection equivalence and is idempotent', () => {
    const s = store();
    const now = Date.now();
    const old = now - 400 * DAY;
    const legacy: KnowledgeEventLog = {
      'ja:h1': [ankiReview(old, 1.4, 2001), ankiReview(old + DAY, 2.5, 2002), attemptEvent({ t: now - DAY })],
      'ja:h2': [ankiStatus(old, 'known'), { t: old + 100, kind: 'claim', source: 'manual', aspect: 'meaning', toStatus: 'learning' }],
    };
    const first = s.importLegacyLog(legacy, now);
    expect(first.verified).toBe(true);
    expect(first.events).toBe(5);

    for (const [key, events] of Object.entries(legacy)) {
      expect(s.getKnowledgeState(key).projection).toEqual(replayKeyProjection(events));
    }

    // Idempotent: re-import imports nothing and stays verified.
    const second = s.importLegacyLog(legacy, now);
    expect(second.events).toBe(0);
    expect(second.verified).toBe(true);
    s.close();
  });

  it('keeps projections exact when sync appends land out of order below the archive frontier', () => {
    const s = store();
    const now = Date.now();
    const old = now - 400 * DAY;
    s.appendEvents({ 'ja:h1': [ankiReview(old, 1.6, 3001), ankiReview(old + DAY, 2.4, 3002), ankiReview(now - DAY, 2.7, 3003)] });
    s.compact(now);

    // Tethered sync journals a row with an old recency anchor (below frontier).
    const lateRow = ankiReview(old + 12 * 3600_000, 3.2);
    s.appendEvents({ 'ja:h1': [lateRow] });

    const raw = [ankiReview(old, 1.6, 3001), lateRow, ankiReview(old + DAY, 2.4, 3002), ankiReview(now - DAY, 2.7, 3003)];
    expect(s.getKnowledgeState('ja:h1').projection).toEqual(replayKeyProjection(raw));
    s.close();
  });

  it('rebuilds checkpoints from canonical rows + archives with identical results', () => {
    const s = store();
    const now = Date.now();
    const old = now - 400 * DAY;
    s.appendEvents({ 'ja:h1': [ankiReview(old, 1.8, 4001), ankiReview(now - 2 * DAY, 2.6, 4002)] });
    s.compact(now);
    const before = s.getKnowledgeState('ja:h1').projection;
    s.rebuildCheckpoints();
    const after = s.getKnowledgeState('ja:h1').projection;
    expect(after).toEqual(before);
    s.close();
  });

  it('reports anki review id presence across exact rows and archives', () => {
    const s = store();
    const now = Date.now();
    const old = now - 400 * DAY;
    s.appendEvents({ 'ja:h1': [ankiReview(old, 1.5, 5001), ankiReview(now - DAY, 2.0, 5002)] });
    s.compact(now);
    const [archivedId, exactId, missingId] = s.hasAnkiReviewIds('ja', [5001, 5002, 9999]);
    expect(archivedId).toBe(true);
    expect(exactId).toBe(true);
    expect(missingId).toBe(false);
    s.close();
  });

  it('compaction is incremental: a second pass merges into the existing archive', () => {
    const s = store();
    const now = Date.now();
    const old = now - 500 * DAY;
    s.appendEvents({ 'ja:h1': [ankiReview(old, 1.5, 7001), ankiReview(old + 40 * DAY, 2.5, 7002)] });
    expect(s.compact(now)).toBe(1);
    const firstArchive = s.getArchive('ja:h1')!;
    const firstCount = firstArchive.archivedEventCount;

    // Later rows cross the tail boundary; the second pass must merge into
    // (not replace) the archive.
    const mid = now - 200 * DAY;
    s.appendEvents({ 'ja:h1': [ankiReview(mid, 2.8, 7003)] });
    s.compact(now + 30 * DAY);
    const secondArchive = s.getArchive('ja:h1')!;
    expect(secondArchive.archivedEventCount).toBe(firstCount + 1);
    expect(secondArchive.ankiReviewIds).toContain(7002);
    expect(secondArchive.ankiReviewIds).toContain(7003);
    // 7001 sits inside the key's acquisition window — it stays exact forever.
    expect(s.getExactEvents(['ja:h1'])['ja:h1'].some((event) => event.ankiReviewId === 7001)).toBe(true);
    s.close();
  });

  it('preserves same-timestamp journal order across the archive frontier', () => {
    const s = store();
    const now = Date.now();
    const old = now - 400 * DAY;
    // An older anchor keeps the pair outside the acquisition window, so the
    // equal-t rows land in the archive: the LATER-inserted one must win.
    const anchor = ankiReview(old, 1.5, 8000);
    const first = ankiReview(old + 90 * DAY, 1.4, 8001);
    const second = ankiReview(old + 90 * DAY, 3.0, 8002);
    s.appendEvents({ 'ja:h1': [anchor, first, second, ankiReview(now - DAY, 2.2, 8003)] });
    s.compact(now);
    expect(s.getArchive('ja:h1')).toBeDefined();
    const raw = [anchor, first, second, ankiReview(now - DAY, 2.2, 8003)];
    expect(s.getKnowledgeState('ja:h1').projection).toEqual(replayKeyProjection(raw));
    expect(s.getKnowledgeState('ja:h1').projection?.evidenceSource).toBe('anki');
    s.close();
  });

  it('keeps seq unique and monotonic across restart cycles', () => {
    const dbPath = path.join(dir, 'knowledge-history.sqlite3');
    const first = KnowledgeHistoryStore.open(dbPath);
    first.appendEvents({ 'ja:h1': [ankiReview(NOW_VAL(), 2.0), ankiReview(NOW_VAL() + 1, 2.1)] });
    first.close();

    // Restart: counter must persist — no seq reuse, strictly increasing.
    const second = KnowledgeHistoryStore.open(dbPath);
    second.appendEvents({ 'ja:h1': [ankiReview(NOW_VAL() + 2, 2.2)] });
    const rows = second.rowsWithSeq('ja:h1');
    const seqs = rows.map(({ seq }) => seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    second.close();
  });

  it('compaction respects the per-pass key budget', () => {
    const s = store();
    const now = Date.now();
    const old = now - 400 * DAY;
    const log: KnowledgeEventLog = {};
    for (let i = 0; i < COMPACTION_KEY_BUDGET + 10; i++) {
      // One acquisition-window row + one archiveable row per key.
      log[`ja:k${i}`] = [ankiReview(old, 1.5, 6000 + i), ankiReview(old + 30 * DAY, 2.0, 6500 + i)];
    }
    s.appendEvents(log);
    const compacted = s.compact(now);
    expect(compacted).toBe(COMPACTION_KEY_BUDGET);
    s.close();
  });
});
