import { describe, expect, it } from 'vitest';
import type { KnowledgeEvent } from '../../shared/knowledgeEvents';
import { replayKnowledgeHistory } from './knowledgeHistory';

const NOW = 1_000_000;

describe('replayKnowledgeHistory', () => {
  it('returns empty replay for no events', () => {
    expect(replayKnowledgeHistory([], { now: NOW })).toEqual({ points: [], bands: [] });
  });

  it('maps a review event ease (SRS domain) to normalized strength', () => {
    const events: KnowledgeEvent[] = [
      { t: 100, kind: 'review', source: 'srs', aspect: 'meaning', rating: 'good', easeAfter: 1.8 },
    ];
    const { points, bands } = replayKnowledgeHistory(events, { now: NOW });
    expect(points).toHaveLength(1);
    expect(points[0].strength).toBe(1);
    expect(points[0].source).toBe('srs');
    expect(bands).toEqual([{ from: 100, to: NOW, source: 'srs' }]);
  });

  it('treats anki ease as raw factor (same numeric anchors as SRS ×1000)', () => {
    const events: KnowledgeEvent[] = [
      { t: 100, kind: 'review', source: 'anki', aspect: 'meaning', rating: 'good', easeAfter: 1550 },
    ];
    const { points } = replayKnowledgeHistory(events, { now: NOW });
    expect(points[0].strength).toBe(0.5);
  });

  it('falls back to statusToStrength when the event carries no ease', () => {
    const events: KnowledgeEvent[] = [
      { t: 100, kind: 'status', source: 'anki', aspect: 'meaning', fromStatus: 'unknown', toStatus: 'known' },
    ];
    const { points } = replayKnowledgeHistory(events, { now: NOW });
    expect(points[0].strength).toBe(1);
  });

  it('keeps step semantics: value holds until the next event', () => {
    const events: KnowledgeEvent[] = [
      { t: 100, kind: 'review', source: 'srs', aspect: 'meaning', rating: 'good', easeAfter: 1.8 },
      { t: 200, kind: 'status', source: 'manual', aspect: 'meaning', fromStatus: 'known', toStatus: 'unknown', easeAfter: 1.3 },
    ];
    const { points, bands } = replayKnowledgeHistory(events, { now: NOW });
    expect(points.map((p) => p.strength)).toEqual([1, 0]);
    expect(bands).toEqual([
      { from: 100, to: 200, source: 'srs' },
      { from: 200, to: NOW, source: 'manual' },
    ]);
  });

  it('collapses same-timestamp events to the last write', () => {
    const events: KnowledgeEvent[] = [
      { t: 100, kind: 'rating', source: 'manual', aspect: 'meaning', toStatus: 'learning', easeAfter: 1.55 },
      { t: 100, kind: 'rating', source: 'manual', aspect: 'meaning', toStatus: 'known', easeAfter: 1.8 },
    ];
    const { points } = replayKnowledgeHistory(events, { now: NOW });
    expect(points).toHaveLength(1);
    expect(points[0].strength).toBe(1);
  });

  it('sorts out-of-order events by timestamp', () => {
    const events: KnowledgeEvent[] = [
      { t: 200, kind: 'review', source: 'srs', aspect: 'meaning', rating: 'good', easeAfter: 1.8 },
      { t: 100, kind: 'review', source: 'srs', aspect: 'meaning', rating: 'again', easeAfter: 1.3 },
    ];
    const { points } = replayKnowledgeHistory(events, { now: NOW });
    expect(points.map((p) => p.t)).toEqual([100, 200]);
    expect(points.map((p) => p.strength)).toEqual([0, 1]);
  });

  it('replays a downgrade cascade to zero', () => {
    const events: KnowledgeEvent[] = [
      { t: 100, kind: 'rating', source: 'manual', aspect: 'prosody', toStatus: 'known', easeAfter: 1.8 },
      { t: 150, kind: 'rating', source: 'manual', aspect: 'prosody', toStatus: 'unknown', easeAfter: 1.3 },
    ];
    const { points } = replayKnowledgeHistory(events, { now: NOW });
    expect(points.map((p) => p.strength)).toEqual([1, 0]);
  });

  it('respects injected thresholds', () => {
    const events: KnowledgeEvent[] = [
      { t: 100, kind: 'review', source: 'srs', aspect: 'meaning', rating: 'good', easeAfter: 1.7 },
    ];
    const relaxed = replayKnowledgeHistory(events, { now: NOW, learningThreshold: 1400, knownThreshold: 1700 });
    expect(relaxed.points[0].strength).toBe(1);
  });
});

describe('replayKnowledgeHistory retractions', () => {
  it('excludes undone attempts and their tombstones from the curve', () => {
    const events: KnowledgeEvent[] = [
      { t: 100, kind: 'status', source: 'manual', aspect: 'meaning', toStatus: 'known' },
      { t: 200, kind: 'rating', source: 'manual', aspect: 'meaning', attemptId: 'a1', quality: 'missed', toStatus: 'unknown', easeAfter: 1.3 },
      { t: 300, kind: 'retraction', source: 'manual', aspect: 'meaning', retracts: 'a1' },
    ];
    const { points } = replayKnowledgeHistory(events, { now: NOW });
    expect(points).toHaveLength(1);
    expect(points[0].strength).toBe(1);
  });
});
