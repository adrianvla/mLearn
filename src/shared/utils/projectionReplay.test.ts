import { describe, expect, it } from 'vitest';
import { replayKeyProjection } from './projectionReplay';
import { nextAttemptId } from '../knowledgeEvents';
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
});
