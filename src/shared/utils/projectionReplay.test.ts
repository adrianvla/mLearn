import { describe, expect, it } from 'vitest';
import { replayKeyProjection } from './projectionReplay';
import { nextAttemptId, stripRetractions } from '../knowledgeEvents';
import type { KnowledgeEvent } from '../knowledgeEvents';

const base = { source: 'manual' as const, aspect: 'meaning' as const };

const ev = (overrides: Partial<KnowledgeEvent> & { t: number }): KnowledgeEvent => ({
  kind: 'rating',
  ...base,
  ...overrides,
} as KnowledgeEvent);

describe('projectionReplay', () => {
  it('replays ease/status outcomes in timestamp order', () => {
    const projection = replayKeyProjection([
      ev({ t: 200, easeAfter: 1.8 }),
      ev({ t: 100, easeAfter: 1.3 }),
    ]);
    expect(projection?.ease).toBe(1.8);
    expect(projection?.firstSeen).toBe(100);
    expect(projection?.lastSeen).toBe(200);
  });

  it('marks lastStatusChange only for explicit sources (passive can never claim)', () => {
    const explicit = replayKeyProjection([ev({ t: 100, toStatus: 'known', easeAfter: 1.9 })]);
    expect(explicit?.lastStatusChange).toBe(100);

    const passive = replayKeyProjection([
      ev({ t: 100, source: 'passiveTracking', kind: 'rollup', easeAfter: 2.5, timesSeenDelta: 10 }),
    ]);
    expect(passive?.ease).toBe(2.5);
    expect(passive?.lastStatusChange).toBeUndefined();
  });

  it('sums timesSeenDelta across rollups and observations', () => {
    const projection = replayKeyProjection([
      ev({ t: 100, source: 'passiveTracking', kind: 'rollup', easeAfter: 1.3, timesSeenDelta: 4 }),
      ev({ t: 200, quality: 'fluent', easeAfter: 1.8 }),
      ev({ t: 300, source: 'passiveTracking', kind: 'rollup', easeAfter: 1.81, timesSeenDelta: 2 }),
    ]);
    expect(projection?.timesSeen).toBe(6);
  });

  it('counts hover-failure status rows as timesHovered', () => {
    const projection = replayKeyProjection([
      ev({ t: 100, easeAfter: 1.3 }),
      ev({ t: 150, source: 'passiveTracking', kind: 'status', easeAfter: 1.25 }),
      ev({ t: 250, source: 'passiveTracking', kind: 'status', easeAfter: 1.2 }),
    ]);
    expect(projection?.timesHovered).toBe(2);
    expect(projection?.lastStatusChange).toBeUndefined();
  });

  it('retractions erase the whole attempt: replay returns the pre-attempt state', () => {
    const attemptId = nextAttemptId();
    const events: KnowledgeEvent[] = [
      ev({ t: 100, source: 'passiveTracking', kind: 'rollup', easeAfter: 1.5, timesSeenDelta: 3 }),
      ev({ t: 200, attemptId, quality: 'fluent', easeAfter: 1.8 }),
      ev({ t: 300, kind: 'retraction', retracts: attemptId }),
    ];
    const projection = replayKeyProjection(events);
    expect(projection?.ease).toBe(1.5);
    expect(projection?.timesSeen).toBe(3);
  });

  it('returns null for empty or fully-retracted keys (undo deletes created entries)', () => {
    const attemptId = nextAttemptId();
    expect(replayKeyProjection([])).toBeNull();
    expect(replayKeyProjection([
      ev({ t: 1, attemptId, easeAfter: 1.55 }),
      ev({ t: 2, kind: 'retraction', retracts: attemptId }),
    ])).toBeNull();
  });

  it('normalizes raw Anki factors into the SRS scale while SRS-scale values pass through', () => {
    const raw = replayKeyProjection([ev({ t: 1, source: 'anki', easeAfter: 1950 })]);
    expect(raw?.ease).toBe(1.95);
    const scaled = replayKeyProjection([ev({ t: 1, source: 'anki', easeAfter: 1.95 })]);
    expect(scaled?.ease).toBe(1.95);
  });

  it('derives the outcome ease from an explicit status when easeAfter is absent', () => {
    const derived = replayKeyProjection([ev({ t: 1, source: 'anki', kind: 'status', toStatus: 'known' })]);
    expect(derived?.ease).toBe(1.8);
    expect(derived?.hasActiveEvidence).toBe(true);
  });

  it('never derives a status outcome from passive rows without a recorded ease', () => {
    const active = replayKeyProjection([ev({ t: 1, easeAfter: 1.8 })]);
    const passive = replayKeyProjection([
      ev({ t: 1, easeAfter: 1.8 }),
      ev({ t: 2, source: 'passiveTracking', kind: 'status', toStatus: 'unknown' }),
    ]);
    expect(passive?.ease).toBe(active?.ease);
  });

  it('round-trips attempt task metadata: journal → replay preserves it and never breaks parity', () => {
    // REQ3/REQ52: attempt metadata is provenance — replay keeps deriving the
    // same projection while the fields ride along for horizon-sensitive
    // projection later.
    const events: KnowledgeEvent[] = [
      ev({
        t: 100,
        quality: 'fluent',
        easeAfter: 1.9,
        taskType: 'welcome-review',
        scaffolds: { translation: true, reading: false },
        sourceVersions: { graphSchemaVersion: 1, packageVersions: { 'freq-ja': '2024.1' } },
      }),
      ev({ t: 200, source: 'passiveTracking', kind: 'rollup', easeAfter: 1.95, timesSeenDelta: 2 }),
    ];
    const projection = replayKeyProjection(events);
    expect(projection?.hasActiveEvidence).toBe(true);
    expect(projection?.ease).toBe(1.95);
    expect(projection?.timesSeen).toBe(2);

    // The fields survive the read API untouched (stripRetractions is the only
    // transform) — future projections can still weigh the scaffolded task.
    const [carried] = stripRetractions(events);
    expect(carried.taskType).toBe('welcome-review');
    expect(carried.scaffolds).toEqual({ translation: true, reading: false });
    expect(carried.sourceVersions).toEqual({ graphSchemaVersion: 1, packageVersions: { 'freq-ja': '2024.1' } });
  });

  it('retracting an attempt drops its task metadata with it', () => {
    const attemptId = nextAttemptId();
    const projection = replayKeyProjection([
      ev({ t: 100, attemptId, quality: 'fluent', easeAfter: 1.9, taskType: 'reader', scaffolds: { reading: true } }),
      ev({ t: 200, kind: 'retraction', retracts: attemptId }),
    ]);
    expect(projection).toBeNull();
  });
});
