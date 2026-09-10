import { describe, expect, it } from 'vitest';
import type { KnowledgeEvent } from '../knowledgeEvents';
import { replayKeyProjection, projectKeyFold, applyEventToFold, emptyKeyFold, mergeKeyFolds, type FoldState } from '../utils/projectionReplay';
import {
  compactKeyEvents,
  computeRetention,
  foldFromArchive,
  foldArchiveBucketsMeasurable,
  mergeArchives,
  type KeyArchive,
} from './historyArchive';
import { assembleTargetExplanation, type JournalRow } from '../graph/explanations';
import type { RetentionPolicy } from '../srs/retentionScheduler';
import { deriveRetentionSchedule } from '../srs/retentionScheduler';


const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 15, 12);
const POLICY: RetentionPolicy = {
  learningSteps: [1, 10],
  relearnSteps: [10],
  graduatingInterval: 1,
  easyInterval: 4,
  reviewIntervalModifier: 100,
  maxInterval: 365,
};

/** Deterministic PRNG so failures reproduce. */
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

interface GeneratorOptions {
  seed: number;
  languages: string[];
  historyDays: number;
}

/**
 * Representative history generator: direct reviews, inference-mediated
 * successes, scaffolded attempts, Missed/Struggled/Fluent outcomes, passive
 * exposures, grammar targets, character targets, claims (set + cleared),
 * retractions, reratings, and multi-language spread across old/recent ages.
 */
function generateHistory(opts: GeneratorOptions): KnowledgeEventLog {
  const rng = mulberry32(opts.seed);
  const log: KnowledgeEventLog = {};
  let attemptCounter = 0;

  const push = (key: string, event: KnowledgeEvent): void => {
    (log[key] ??= []).push(event);
  };
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(rng() * items.length)]!;
  const oldT = () => NOW - (200 + Math.floor(rng() * 600)) * DAY;
  const recentT = () => NOW - Math.floor(rng() * 60) * DAY;
  const t = () => (rng() < 0.6 ? oldT() : recentT());

  for (let i = 0; i < 24; i++) {
    const language = pick(opts.languages);
    const word = `w${i}`;
    const key = `${language}:${word}`;
    const kind = pick(['anki-heavy', 'attempts', 'passive', 'mixed', 'claim-only'] as const);

    if (kind === 'anki-heavy') {
      // Repeated direct Anki reviews with factor chains + status diffs.
      let ease = 1.4 + rng();
      for (let r = 0; r < 8 + Math.floor(rng() * 20); r++) {
        const when = t();
        ease = Math.min(3.4, ease + 0.15 * (rng() < 0.7 ? 1 : -1));
        push(key, { t: when, kind: 'review', source: 'anki', aspect: 'meaning', easeAfter: Math.round(ease * 1000) / 1000, rating: pick(['again', 'hard', 'good', 'easy'] as const), timesSeenDelta: 1, ankiReviewId: when + r });
      }
      if (rng() < 0.5) push(key, { t: t(), kind: 'status', source: 'anki', aspect: 'meaning', toStatus: pick(['learning', 'known'] as const) });
    } else if (kind === 'attempts') {
      // Scaffolded/unscaffolded attempts with quality + latency; some retracted, some rerated.
      for (let a = 0; a < 3 + Math.floor(rng() * 4); a++) {
        const attemptId = `attempt-${++attemptCounter}`;
        const scaffolded = rng() < 0.5;
        const when = t();
        push(key, {
          t: when,
          kind: 'rating',
          source: 'srs',
          aspect: 'meaning',
          attemptId,
          quality: pick(['missed', 'struggled', 'fluent'] as const),
          rating: pick(['again', 'hard', 'good', 'easy'] as const),
          easeAfter: 1.5 + rng() * 2,
          timesSeenDelta: 1,
          method: rng() < 0.4 ? 'inference' : 'recall',
          latencyMs: 1200 + Math.floor(rng() * 4000),
          ...(scaffolded ? { scaffolds: { reading: rng() < 0.5, translation: rng() < 0.3 } } : {}),
          taskType: 'srs-review',
        });
        // Rerating: a second observation sharing the attempt id.
        if (rng() < 0.3) {
          push(key, { t: when + 30_000, kind: 'rating', source: 'srs', aspect: 'meaning', attemptId, easeAfter: 2.2, timesSeenDelta: 0 });
        }
        // Retraction: whole logical attempt (both rows) undone.
        if (rng() < 0.25) {
          push(key, { t: when + 60_000, kind: 'retraction', source: 'manual', retracts: attemptId });
        }
      }
    } else if (kind === 'passive') {
      for (let p = 0; p < 4 + Math.floor(rng() * 8); p++) {
        push(key, { t: t(), kind: 'status', source: 'passiveTracking', aspect: 'meaning', timesSeenDelta: 1 + Math.floor(rng() * 2) });
      }
      if (rng() < 0.4) {
        push(key, { t: t(), kind: 'status', source: 'passiveTracking', aspect: 'meaning', toStatus: 'learning' });
      }
    } else if (kind === 'claim-only') {
      const when = t();
      push(key, { t: when, kind: 'claim', source: 'manual', aspect: 'meaning', toStatus: pick(['known', 'learning', 'unknown'] as const) });
      if (rng() < 0.4) push(key, { t: when + DAY, kind: 'claim', source: 'manual', aspect: 'meaning' }); // cleared
    } else {
      // Mixed: a bit of everything, including character targets.
      push(key, { t: t(), kind: 'review', source: 'anki', aspect: 'meaning', easeAfter: 2.0, rating: 'good', timesSeenDelta: 1, ankiReviewId: t() });
      const attemptId = `attempt-${++attemptCounter}`;
      push(key, {
        t: t(), kind: 'rating', source: 'srs', aspect: 'meaning', attemptId,
        quality: 'fluent', easeAfter: 2.9, timesSeenDelta: 1, method: 'inference',
        activeLatencyMs: 2200, taskType: 'reader',
        targetRef: { kind: 'character', id: `${language}:char:${Math.floor(rng() * 5)}`, capability: 'character-recognition' },
      });
      push(key, { t: t(), kind: 'claim', source: 'manual', aspect: 'reading', toStatus: 'learning' });
    }
  }

  // Grammar targets under their own keys (ledger-exact class).
  for (let g = 0; g < 6; g++) {
    const language = pick(opts.languages);
    push(`${language}:grammar:てform:grammar-recognition`, { t: oldT(), kind: 'rollup', source: 'grammar', aspect: 'grammar', timesSeenDelta: 2 + g });
    push(`${language}:grammar:てform:grammar-recognition`, { t: recentT(), kind: 'rating', source: 'grammar', aspect: 'grammar', quality: 'fluent', easeAfter: 2.6 });
  }

  return log;
}

function rowsOf(events: KnowledgeEvent[]): JournalRow[] {
  const ordered = [...events].sort((a, b) => a.t - b.t);
  return ordered.map((event, seq) => ({ event, seq }));
}

function stripRetractedRows(rows: JournalRow[]): JournalRow[] {
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

function foldExact(rows: JournalRow[]): FoldState {
  const fold = emptyKeyFold();
  for (const { event, seq } of stripRetractedRows(rows)) applyEventToFold(fold, event, seq);
  return fold;
}

/** Store-equivalent fold of one key: archive prefix merged with exact rows. */
function storeFold(events: KnowledgeEvent[], now: number): { fold: FoldState; archive: KeyArchive | undefined; kept: JournalRow[] } {
  const rows = rowsOf(events);
  const compact = compactKeyEvents(rows, now);
  // Compaction preserves original seqs on kept rows — the same identity the
  // store persists, so (t, seq) tie-breaks match exactly.
  const fold = compact.archive
    ? mergeKeyFolds(foldFromArchive(compact.archive), foldExact(compact.kept))
    : foldExact(rows);
  return { fold, archive: compact.archive, kept: compact.kept };
}

function expectFoldEquivalence(events: KnowledgeEvent[], now: number): void {
  const raw = replayKeyProjection(events);
  const { fold, archive, kept } = storeFold(events, now);
  const projected = projectKeyFold(fold);
  expect(projected).toEqual(raw);
  // Partition sanity: compaction dropped rows only when an archive exists.
  if (archive) expect(kept.length).toBeLessThan(events.length);
}

describe('history archive — projection equivalence', () => {
  it('fold(compact archive + exact rows) === fold(full journal) across generated histories', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const languages = seed % 2 === 0 ? ['ja'] : ['ja', 'de', 'ru'];
      const log = generateHistory({ seed, languages, historyDays: 800 });
      for (const [, events] of Object.entries(log)) {
        expectFoldEquivalence(events, NOW);
      }
    }
  });

  it('is exact at the class boundaries: tail edge, acquisition cutoff, frontier ties', () => {
    const events: KnowledgeEvent[] = [
      // Acquisition window rows (first 14d) — kept exact.
      { t: NOW - 400 * DAY, kind: 'status', source: 'passiveTracking', aspect: 'meaning', timesSeenDelta: 1 },
      { t: NOW - 399 * DAY, kind: 'review', source: 'anki', aspect: 'meaning', easeAfter: 1.4, rating: 'good', timesSeenDelta: 1, ankiReviewId: 1 },
      // Old aggregatable rows.
      { t: NOW - 300 * DAY, kind: 'review', source: 'anki', aspect: 'meaning', easeAfter: 1.8, rating: 'good', timesSeenDelta: 1, ankiReviewId: 2 },
      { t: NOW - 200 * DAY, kind: 'status', source: 'anki', aspect: 'meaning', toStatus: 'learning' },
      // Exactly at the tail boundary (now - 180d): archived.
      { t: NOW - 180 * DAY, kind: 'review', source: 'anki', aspect: 'meaning', easeAfter: 2.4, rating: 'good', timesSeenDelta: 1, ankiReviewId: 3 },
      // Same-timestamp rows straddling the compaction decision.
      { t: NOW - 100 * DAY, kind: 'review', source: 'anki', aspect: 'meaning', easeAfter: 2.0, rating: 'hard', timesSeenDelta: 1, ankiReviewId: 4 },
      { t: NOW - 100 * DAY, kind: 'claim', source: 'manual', aspect: 'meaning', toStatus: 'learning' },
      // Tail rows.
      { t: NOW - 10 * DAY, kind: 'rating', source: 'srs', aspect: 'meaning', attemptId: 'a1', quality: 'fluent', easeAfter: 3.0, timesSeenDelta: 1 },
    ];
    expectFoldEquivalence(events, NOW);

    // Retraction of an ancient attempt after compaction.
    const withRetraction = [...events, { t: NOW - DAY, kind: 'retraction', source: 'manual', retracts: 'a1' } as KnowledgeEvent];
    expectFoldEquivalence(withRetraction, NOW);
  });

  it('compaction applied twice (incremental merge) stays fold-exact and absorbs new rows', () => {
    const events: KnowledgeEvent[] = [
      { t: NOW - 400 * DAY, kind: 'review', source: 'anki', aspect: 'meaning', easeAfter: 1.5, rating: 'good', timesSeenDelta: 1, ankiReviewId: 11 },
      { t: NOW - 350 * DAY, kind: 'review', source: 'anki', aspect: 'meaning', easeAfter: 2.0, rating: 'good', timesSeenDelta: 1, ankiReviewId: 12 },
    ];
    const rows = rowsOf(events);
    const first = compactKeyEvents(rows, NOW);
    expect(first.archive).toBeDefined();

    // Later rows cross the tail boundary; second pass merges into the archive.
    const later: KnowledgeEvent[] = [
      ...first.kept.map(({ event }) => event),
      { t: NOW - 190 * DAY, kind: 'review', source: 'anki', aspect: 'meaning', easeAfter: 2.3, rating: 'good', timesSeenDelta: 1, ankiReviewId: 13 },
    ];
    const second = compactKeyEvents(rowsOf(later), NOW + 30 * DAY, first.archive);
    expect(second.archive?.archivedEventCount).toBe((first.archive?.archivedEventCount ?? 0) + 1);
    // 11 sits inside the acquisition window — it stays exact, never archived.
    expect(second.archive?.ankiReviewIds).toEqual([12, 13]);

    // Raw fold covers all three rows: 11 (acquisition-exact), 12 and 13 (archived).
    const allEvents: KnowledgeEvent[] = [...events, { t: NOW - 190 * DAY, kind: 'review', source: 'anki', aspect: 'meaning', easeAfter: 2.3, rating: 'good', timesSeenDelta: 1, ankiReviewId: 13 }];
    const raw = replayKeyProjection(allEvents);
    const fold = second.archive
      ? mergeKeyFolds(foldFromArchive(second.archive), foldExact(second.kept))
      : foldExact(second.kept);
    expect(projectKeyFold(fold)).toEqual(raw);
  });

  it('per-capability explanation folds match raw capability-filtered replay (bucket matcher)', () => {
    for (let seed = 100; seed <= 120; seed++) {
      const log = generateHistory({ seed, languages: ['ja'], historyDays: 800 });
      for (const [, events] of Object.entries(log)) {
        const rows = rowsOf(events);
        const compact = compactKeyEvents(rows, NOW);
        const raw = assembleTargetExplanation('sense-recognition', rows, POLICY, NOW);
        const compacted = assembleTargetExplanation('sense-recognition', compact.kept, POLICY, NOW, undefined, undefined, compact.archive ? [compact.archive] : undefined);
        expect(compacted.state).toBe(raw.state);
        expect(compacted.projection).toEqual(raw.projection);
        expect(compacted.retention).toEqual(raw.retention);
      }
    }
  });

  it('retention across the frontier never double-counts or drops ratings', () => {
    const events: KnowledgeEvent[] = [
      { t: NOW - 300 * DAY, kind: 'review', source: 'anki', aspect: 'meaning', easeAfter: 1.5, rating: 'good', timesSeenDelta: 1, ankiReviewId: 21 },
      { t: NOW - 250 * DAY, kind: 'review', source: 'anki', aspect: 'meaning', easeAfter: 1.9, rating: 'hard', timesSeenDelta: 1, ankiReviewId: 22 },
      { t: NOW - 100 * DAY, kind: 'review', source: 'anki', aspect: 'meaning', easeAfter: 2.4, rating: 'good', timesSeenDelta: 1, ankiReviewId: 23 },
      { t: NOW - 10 * DAY, kind: 'review', source: 'anki', aspect: 'meaning', easeAfter: 2.8, rating: 'easy', timesSeenDelta: 1, ankiReviewId: 24 },
    ];
    const rows = rowsOf(events);
    const compact = compactKeyEvents(rows, NOW);
    const archive = compact.archive!;
    // Residue count === rating rows removed from the exact store.
    const archivedRatings = Object.values(archive.buckets).reduce((sum, bucket) => sum + bucket.ratings.length, 0);
    const keptRatings = compact.kept.filter(({ event }) => event.rating !== undefined).length;
    expect(archivedRatings + keptRatings).toBe(events.filter((event) => event.rating !== undefined).length);

    const raw = deriveRetentionSchedule({ createdAt: events[0]!.t, initialEase: 2.5 }, rows.flatMap(({ event }) => event.rating ? [{ t: event.t, rating: event.rating }] : []), POLICY, NOW);
    const compacted = computeRetention(archive, compact.kept, POLICY, NOW, () => true);
    // FSM inputs identical ⇒ schedule identical.
    expect(compacted).toEqual({ ...raw, pressure: compacted?.pressure });
    expect(compacted?.ease).toBe(raw.ease);
    expect(compacted?.dueAt).toBe(raw.dueAt);
    expect(compacted?.reviews).toBe(raw.reviews);
    expect(compacted?.lapses).toBe(raw.lapses);
  });

  it('week points appear only for dense archived keys (LOD threshold)', () => {
    // Below threshold: 3 archived rows — curve points omitted, folds exact.
    const sparse: KnowledgeEvent[] = [
      { t: NOW - 300 * DAY, kind: 'review', source: 'anki', aspect: 'meaning', easeAfter: 1.6, rating: 'good', timesSeenDelta: 1, ankiReviewId: 41 },
      { t: NOW - 250 * DAY, kind: 'review', source: 'anki', aspect: 'meaning', easeAfter: 2.0, rating: 'good', timesSeenDelta: 1, ankiReviewId: 42 },
      { t: NOW - 200 * DAY, kind: 'review', source: 'anki', aspect: 'meaning', easeAfter: 2.2, rating: 'good', timesSeenDelta: 1, ankiReviewId: 43 },
      { t: NOW - 10 * DAY, kind: 'review', source: 'anki', aspect: 'meaning', easeAfter: 2.4, rating: 'good', timesSeenDelta: 1, ankiReviewId: 44 },
    ];
    const sparseCompact = compactKeyEvents(rowsOf(sparse), NOW);
    expect(sparseCompact.archive).toBeDefined();
    // Sparse keys keep LOD coverage at month granularity (never dropped).
    expect(sparseCompact.archive!.weekPoints.length).toBeGreaterThan(0);
    expect(sparseCompact.archive!.weekPoints.every((point) => new Date(point.w).getUTCDate() === 1)).toBe(true);
    expectFoldEquivalence(sparse, NOW);

    // Above threshold: 20 archived rows — curve points present.
    const dense: KnowledgeEvent[] = Array.from({ length: 20 }, (_, index) => ({
      t: NOW - (300 - index * 5) * DAY,
      kind: 'review',
      source: 'anki',
      aspect: 'meaning',
      easeAfter: 1.5 + index * 0.05,
      rating: 'good',
      timesSeenDelta: 1,
      ankiReviewId: 50 + index,
    }));
    const denseCompact = compactKeyEvents(rowsOf(dense), NOW);
    expect(denseCompact.archive).toBeDefined();
    expect(denseCompact.archive!.weekPoints.length).toBeGreaterThan(0);
    expectFoldEquivalence(dense, NOW);
  });

  it('sibling archives merge without changing per-capability folds', () => {
    // Each key: an acquisition-window anchor + an archiveable row.
    const a: KnowledgeEvent[] = [
      { t: NOW - 300 * DAY, kind: 'review', source: 'anki', aspect: 'meaning', easeAfter: 1.6, rating: 'good', timesSeenDelta: 1, ankiReviewId: 31 },
      { t: NOW - 250 * DAY, kind: 'review', source: 'anki', aspect: 'meaning', easeAfter: 2.0, rating: 'good', timesSeenDelta: 1, ankiReviewId: 33 },
    ];
    const b: KnowledgeEvent[] = [
      { t: NOW - 280 * DAY, kind: 'review', source: 'anki', aspect: 'meaning', easeAfter: 2.6, rating: 'easy', timesSeenDelta: 1, ankiReviewId: 32 },
      { t: NOW - 240 * DAY, kind: 'review', source: 'anki', aspect: 'meaning', easeAfter: 2.2, rating: 'hard', timesSeenDelta: 1, ankiReviewId: 34 },
    ];
    const archiveA = compactKeyEvents(rowsOf(a), NOW).archive!;
    const archiveB = compactKeyEvents(rowsOf(b), NOW).archive!;
    const merged = mergeArchives([archiveA, archiveB])!;
    expect(merged.archivedEventCount).toBe(2);
    expect(mergeKeyFolds(foldFromArchive(archiveA), foldFromArchive(archiveB))).toEqual(foldFromArchive(merged));
    // Merged LOD points cover both siblings: same-bucket same-month points
    // coalesce (both archived rows land in one legacy bucket + month here),
    // so the merged set is non-empty and deduplicated.
    expect(merged.weekPoints.length).toBeGreaterThan(0);
    expect(merged.weekPoints.length).toBeLessThanOrEqual(archiveA.weekPoints.length + archiveB.weekPoints.length);
    const distinctPeriods = new Set([...archiveA.weekPoints, ...archiveB.weekPoints].map((point) => `${point.b}|${point.w}`));
    expect(merged.weekPoints.length).toBe(distinctPeriods.size);
    expect(foldArchiveBucketsMeasurable(merged, () => true)).toEqual(
      mergeKeyFolds(foldArchiveBucketsMeasurable(archiveA, () => true), foldArchiveBucketsMeasurable(archiveB, () => true)),
    );
  });
});
