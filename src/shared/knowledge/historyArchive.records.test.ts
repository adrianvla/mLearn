import { describe, expect, it } from 'vitest';
import type { KnowledgeEvent } from '../knowledgeEvents';
import {
  archiveBucketStats,
  compactKeyEvents,
  decodeAttemptRecord,
  decodeBucketRecords,
  encodeAttemptRecord,
  encodeBucketRecords,
  isAggregatableEvent,
  mergeArchives,
  rebuildBucketFromRecords,
} from './historyArchive';
import { applyEventToFold, emptyKeyFold, mergeKeyFolds, projectKeyFold, replayKeyProjection } from '../utils/projectionReplay';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800 * DAY;

let attemptCounter = 0;

function attempt(overrides: Partial<KnowledgeEvent> & { t: number }): KnowledgeEvent {
  return {
    kind: 'rating',
    source: 'srs',
    aspect: 'meaning',
    attemptId: `attempt-${++attemptCounter}`,
    quality: 'fluent',
    easeAfter: 2.5 + (attemptCounter % 7) * 0.17,
    rating: 'good',
    timesSeenDelta: 1,
    ...overrides,
  };
}

function ankiReview(t: number, ease: number): KnowledgeEvent {
  return { t, kind: 'review', source: 'anki', aspect: 'meaning', easeAfter: ease, rating: 'good', timesSeenDelta: 1, ankiReviewId: t };
}

/** Fields the record carries: the address context (aspect/attemptId) is bucket/index bookkeeping. */
function recordFields(event: KnowledgeEvent): Record<string, unknown> {
  const { t: _t, aspect: _aspect, attemptId: _attemptId, targetRef: _targetRef, ankiReviewId: _anki, ...rest } = event;
  void _t; void _aspect; void _attemptId; void _targetRef; void _anki;
  const normalized: Record<string, unknown> = JSON.parse(JSON.stringify(rest));
  // Records intentionally keep only the RESOLVED latency (active ?? wall) —
  // the only form any aggregate consumes.
  if (normalized.activeLatencyMs !== undefined || normalized.latencyMs !== undefined) {
    normalized.latencyMs = (event.activeLatencyMs ?? event.latencyMs) as number;
    delete normalized.activeLatencyMs;
  }
  return normalized;
}

describe('attempt compaction classifier', () => {
  it('compacts old attempt rows regardless of source, keeps the sparse ledger exact', () => {
    const old = NOW - 400 * DAY;
    expect(isAggregatableEvent(attempt({ t: old }), NOW)).toBe(true);
    expect(isAggregatableEvent(attempt({ t: old, source: 'manual' }), NOW)).toBe(true);
    expect(isAggregatableEvent(attempt({ t: old, source: 'anki' }), NOW)).toBe(true);
    // Explicit learner statements stay exact forever.
    expect(isAggregatableEvent({ t: old, kind: 'claim', source: 'manual', aspect: 'meaning', toStatus: 'known' }, NOW)).toBe(false);
    expect(isAggregatableEvent({ t: old, kind: 'status', source: 'manual', aspect: 'meaning', toStatus: 'known' }, NOW)).toBe(false);
    expect(isAggregatableEvent({ t: old, kind: 'retraction', source: 'manual', aspect: 'meaning', retracts: 'x' }, NOW)).toBe(false);
    expect(isAggregatableEvent({ t: old, kind: 'rating', source: 'grammar', aspect: 'grammar' as never }, NOW)).toBe(false);
    // Question-item provenance (R12/G03) stays ledger-exact forever: item
    // invalidation must discover every attempt recorded through an item at any age.
    expect(isAggregatableEvent(attempt({ t: old, itemRef: { id: 'de-weil-fieber-1', version: 'de-package-2026.09.19' } }), NOW)).toBe(false);
    // Question-item provenance (G03) stays exact forever: item invalidation
    // must discover every attempt through an item at any archive age.
    expect(isAggregatableEvent(attempt({ t: old, itemRef: { id: 'de-weil-fieber-1', version: 'v1' } }), NOW)).toBe(false);
    // Recency and acquisition windows still gate.
    expect(isAggregatableEvent(attempt({ t: NOW - 10 * DAY }), NOW)).toBe(false);
  });
});

describe('record codec round-trips', () => {
  const samples: KnowledgeEvent[] = [
    attempt({ t: 1_000 }),
    attempt({ t: 2_000, method: 'inference', quality: 'struggled', rating: 'hard', easeAfter: 0.123456789 }),
    attempt({ t: 3_000, method: 'recall', quality: 'missed', rating: 'again', stalled: true, latencyMs: 400_000, activeLatencyMs: 1_250 }),
    attempt({ t: 4_000, source: 'manual', kind: 'status', toStatus: 'known', timesSeenDelta: 0 }),
    attempt({ t: 5_000, origin: 'word-sync', scaffolds: { reading: true } }),
    attempt({ t: 6_000, scaffolds: { translation: true, prosody: false }, quality: 'fluent' }),
    { t: 7_000, kind: 'rollup', source: 'passiveTracking', aspect: 'meaning', timesSeenDelta: 3 },
    { t: 8_000, kind: 'status', source: 'passiveTracking', targetRef: { kind: 'surface', id: 'ja:surface:abc', capability: 'sense-recognition' }, toStatus: 'learning' },
    attempt({ t: 9_000, rating: 'easy', easeAfter: 3.4, retentionCondition: 'assisted' }),
    attempt({ t: 10_000, retentionCondition: 'supplied', scaffolds: { reading: true } }),
  ];

  it('round-trips standalone attempt records field-exactly (record-carried fields)', () => {
    for (const event of samples) {
      const decoded = decodeAttemptRecord(encodeAttemptRecord(event, 42));
      expect(decoded).toBeDefined();
      expect(decoded?.seq).toBe(42);
      expect(recordFields(decoded?.event as KnowledgeEvent)).toEqual(recordFields(event));
    }
  });

  it('round-trips bucket blobs with delta positions and shared dictionary', () => {
    const entries = samples.map((event, index) => ({ event, seq: 10 + index }));
    const decoded = decodeBucketRecords(encodeBucketRecords(entries));
    expect(decoded).toHaveLength(entries.length);
    for (let index = 0; index < entries.length; index++) {
      expect(decoded[index].seq).toBe(entries[index].seq);
      expect(decoded[index].event.t).toBe(entries[index].event.t);
      expect(recordFields(decoded[index].event)).toEqual(recordFields(entries[index].event));
    }
  });

  it('preserves out-of-order arrival after re-encoding', () => {
    const first = encodeBucketRecords([{ event: attempt({ t: 5_000 }), seq: 10 }]);
    const merged = decodeBucketRecords(first).concat([{ event: attempt({ t: 1_000 }), seq: 11 }]);
    const decoded = decodeBucketRecords(encodeBucketRecords(merged));
    expect(decoded.map(({ event }) => event.t).sort((a, b) => a - b)).toEqual([1_000, 5_000]);
  });
});

describe('record-rebuild equivalence', () => {
  it('fold(rebuilt records + kept rows) deep-equals full raw replay', () => {
    const events: KnowledgeEvent[] = [];
    for (let day = 5; day < 900; day += 13) {
      events.push(ankiReview(day * DAY, 2.1 + (day % 5) * 0.2));
      if (day % 3 === 0) {
        events.push(attempt({ t: day * DAY + 3_600, method: day % 2 ? 'recall' : 'inference', quality: day % 4 ? 'fluent' : 'struggled' }));
      }
      if (day % 7 === 0) {
        events.push({ t: day * DAY + 7_200, kind: 'status', source: 'passiveTracking', aspect: 'meaning', timesSeenDelta: 2 });
      }
    }
    const rows = events.map((event, index) => ({ event, seq: index + 1 }));
    const compact = compactKeyEvents(rows, NOW);
    expect(compact.archive).toBeDefined();

    // Rebuild every bucket purely from its emitted records.
    let rebuiltFold = emptyKeyFold();
    for (const bucketKey of Object.keys(compact.archive?.buckets ?? {})) {
      const records = [
        ...decodeBucketRecords(encodeBucketRecords(
          compact.records.bucketRecords.filter((record) => record.bucketKey === bucketKey).map(({ event, seq }) => ({ event, seq })),
        )),
        ...compact.records.attemptRecords
          .filter((record) => record.bucketKey === bucketKey)
          .flatMap(({ rec }) => {
            const decoded = decodeAttemptRecord(rec);
            return decoded ? [decoded] : [];
          }),
      ];
      const partial = rebuildBucketFromRecords(bucketKey, records, NOW);
      rebuiltFold = mergeKeyFolds(rebuiltFold, partial.fold);
    }
    const exactFold = emptyKeyFold();
    // Mirror the store: tombstones and retracted rows never reach the fold.
    const retracted = new Set<string>();
    for (const { event } of compact.kept) {
      if (event.retracts !== undefined) retracted.add(`${event.retracts}`);
    }
    for (const { event, seq } of compact.kept) {
      if (event.kind === 'retraction' || event.retracts !== undefined) continue;
      if (event.attemptId !== undefined && retracted.has(`${event.attemptId}`)) continue;
      applyEventToFold(exactFold, event, seq);
    }
    const combined = mergeKeyFolds(rebuiltFold, exactFold);
    expect(projectKeyFold(combined)).toEqual(replayKeyProjection(events));
  });

  it('retracting an archived attempt via records equals exact replay with the attempt removed', () => {
    const retractedId = `attempt-${++attemptCounter}`;
    const mid = `attempt-${++attemptCounter}`;
    const events: KnowledgeEvent[] = [
      ankiReview(100 * DAY, 2.2),
      { ...attempt({ t: 200 * DAY, easeAfter: 2.9, method: 'recall', quality: 'fluent' }), attemptId: retractedId },
      { ...attempt({ t: 260 * DAY, easeAfter: 2.4, method: 'inference', quality: 'struggled', rating: 'hard' }), attemptId: mid },
      ankiReview(300 * DAY, 2.6),
      attempt({ t: 400 * DAY, easeAfter: 3.1, quality: 'fluent' }),
    ];
    const rows = events.map((event, index) => ({ event, seq: index + 1 }));
    const compact = compactKeyEvents(rows, NOW);
    expect(compact.records.attemptRecords).toHaveLength(3);

    const retracted = compact.records.attemptRecords.find((record) => record.seq === 2);
    expect(retracted).toBeDefined();
    const bucketKey = retracted?.bucketKey as string;
    const records = [
      ...decodeBucketRecords(encodeBucketRecords(
        compact.records.bucketRecords.filter((record) => record.bucketKey === bucketKey).map(({ event, seq }) => ({ event, seq })),
      )),
      ...compact.records.attemptRecords
        .filter((record) => record.seq !== 2)
        .flatMap(({ rec }) => {
          const decoded = decodeAttemptRecord(rec);
          return decoded ? [decoded] : [];
        }),
    ];
    const rebuilt = rebuildBucketFromRecords(bucketKey, records, NOW);
    const exactFold = emptyKeyFold();
    for (const { event, seq } of compact.kept) applyEventToFold(exactFold, event, seq);
    const combined = mergeKeyFolds(rebuilt.fold, exactFold);
    const expected = replayKeyProjection(events.filter((event) => event.attemptId !== retractedId));
    expect(projectKeyFold(combined)).toEqual(expected);
  });
});

describe('compaction record emission', () => {
  it('drops tombstoned attempts entirely and never records them', () => {
    const retractedId = `attempt-${++attemptCounter}`;
    const events: KnowledgeEvent[] = [
      { ...attempt({ t: 200 * DAY, easeAfter: 2.2 }), attemptId: retractedId },
      { t: 210 * DAY, kind: 'retraction', source: 'manual', aspect: 'meaning', retracts: retractedId },
      attempt({ t: 220 * DAY, easeAfter: 2.4 }),
    ];
    const rows = events.map((event, index) => ({ event, seq: index + 1 }));
    const compact = compactKeyEvents(rows, NOW);
    expect(compact.kept.some(({ event }) => event.attemptId === retractedId)).toBe(false);
    expect(compact.records.attemptRecords.some((record) => record.attemptId === retractedId)).toBe(false);
    // The dead attempt is excluded from the aggregate too: replaying the
    // emitted kept rows must match a journal without the attempt (the
    // archive fold carries the survivor attempt only).
    const survivorOnly = events.filter((event) => event.attemptId !== retractedId && event.kind !== 'retraction');
    let archiveFoldState = emptyKeyFold();
    for (const [bucketKey] of Object.entries(compact.archive?.buckets ?? {})) {
      const records = [
        ...decodeBucketRecords(encodeBucketRecords(
          compact.records.bucketRecords.filter((record) => record.bucketKey === bucketKey).map(({ event, seq }) => ({ event, seq })),
        )),
        ...compact.records.attemptRecords.flatMap(({ rec }) => {
          const decoded = decodeAttemptRecord(rec);
          return decoded ? [decoded] : [];
        }),
      ];
      archiveFoldState = mergeKeyFolds(archiveFoldState, rebuildBucketFromRecords(bucketKey, records, NOW).fold);
    }
    const exactFold = emptyKeyFold();
    for (const { event, seq } of compact.kept) {
      if (event.kind === 'retraction' || event.retracts !== undefined) continue;
      applyEventToFold(exactFold, event, seq);
    }
    const combined = mergeKeyFolds(archiveFoldState, exactFold);
    expect(projectKeyFold(combined)).toEqual(replayKeyProjection([...survivorOnly]));
  });

  it('keeps rows out of v1 buckets immutable (records-incomplete archives)', () => {
    const old = NOW - 400 * DAY;
    const v1Archive = {
      v: 1 as const,
      frontierT: old + DAY,
      frontierSeq: 5,
      acquisitionCutoff: Number.NEGATIVE_INFINITY,
      buckets: {
        ['sense-recognition\u0000legacy']: {
          fold: emptyKeyFold(),
          measurableFold: emptyKeyFold(),
          transitions: { lapsedAfterFirstKnown: false },
          ratings: [],
          latency: { count: 0, sum: 0 },
          rowCount: 3,
        },
      },
      archivedEventCount: 3,
      ankiReviewIds: [],
      weekPoints: [],
    };
    const events = [
      attempt({ t: old, aspect: 'meaning' }),
      attempt({ t: NOW - 300 * DAY, targetRef: { kind: 'surface', id: 'ja:surface:x', capability: 'surface-reading' } }),
    ];
    const rows = events.map((event, index) => ({ event, seq: index + 1 }));
    const compact = compactKeyEvents(rows, NOW, v1Archive);
    // The legacy-bucket row stays exact; the fresh-bucket row archives with a record.
    expect(compact.kept.some(({ event }) => event.attemptId === events[0].attemptId)).toBe(true);
    expect(compact.records.attemptRecords).toHaveLength(1);
    expect(compact.archive?.v).toBe(1);
  });

  it('carries method/source statistics through compaction and sibling merge', () => {
    const old = NOW - 300 * DAY;
    const ref = { kind: 'surface', id: 'ja:surface:s1', capability: 'sense-recognition' } as const;
    const events = [
      { ...attempt({ t: old, method: 'inference', quality: 'fluent', rating: 'good', timesSeenDelta: 0, targetRef: ref }), attemptId: undefined },
      attempt({ t: old + 20 * DAY, method: 'recall', quality: 'fluent', rating: 'good', timesSeenDelta: 2, targetRef: ref }),
      attempt({ t: old + 40 * DAY, method: 'inference', quality: 'struggled', rating: 'hard', scaffolds: { translation: true }, targetRef: ref }),
    ];
    const rows = events.map((event, index) => ({ event, seq: index + 1 }));
    const compact = compactKeyEvents(rows, NOW);
    const bucket = Object.values(compact.archive?.buckets ?? {})[0];
    // Event 1 sits inside the acquisition window and stays exact; the other
    // two archive and carry their method/source statistics.
    expect(bucket?.methodStats).toEqual({ inference: 1, inferenceSuccess: 0 });
    // sourceSeen is measurable-only: the supplied third row contributes 0.
    expect(bucket?.sourceSeen).toEqual({ srs: 2 });
    expect(bucket?.lastDirect?.t).toBe(old + 20 * DAY);

    const stats = archiveBucketStats(compact.archive as NonNullable<typeof compact.archive>, () => true);
    expect(stats.inference).toBe(1);
    expect(stats.inferenceSuccess).toBe(0);
    expect(stats.sourceSeen).toEqual({ srs: 2 });
    expect(stats.lastDirectT).toBe(old + 20 * DAY);

    const merged = mergeArchives([compact.archive as NonNullable<typeof compact.archive>, compact.archive as NonNullable<typeof compact.archive>]);
    const mergedBucket = Object.values(merged?.buckets ?? {})[0];
    expect(mergedBucket?.methodStats).toEqual({ inference: 2, inferenceSuccess: 0 });
    expect(mergedBucket?.sourceSeen).toEqual({ srs: 4 });
    expect(merged?.v).toBe(2);
  });
});
