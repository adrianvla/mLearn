import { describe, expect, it } from 'vitest';
import { knowledgeTrajectoryData } from './knowledgeTrajectoryData';
import type { KnowledgeEvent } from '../../../../shared/knowledgeEvents';
import { compactKeyEvents } from '../../../../shared/knowledge/historyArchive';

const event = (t: number, rest: Partial<KnowledgeEvent> = {}): KnowledgeEvent => ({ t, kind: 'rating', source: 'manual', aspect: 'meaning', easeAfter: 2.6, ...rest });

describe('categorical Inspector trajectory', () => {
  it('uses canonical classification, preserves same-time observations, and clears claims back to evidence', () => {
    const { points } = knowledgeTrajectoryData([
      event(1, { easeAfter: 1.3 }), event(2, { easeAfter: 1.5 }),
      event(2), event(3, { kind: 'claim', toStatus: 'unknown' }), event(4, { kind: 'claim', easeAfter: undefined }),
    ], [], 'sense-recognition');
    expect(points.map((point) => point.state)).toEqual(['unknown', 'unknown', 'known', 'unknown', 'known']);
    expect(points.map((point) => point.claim)).toEqual([false, false, false, true, false]);
  });
  it('never promotes passive exposure or scaffolded observations and strips retracted attempts', () => {
    const { points } = knowledgeTrajectoryData([
      event(1, { source: 'passiveTracking', kind: 'status' }),
      event(2, { scaffolds: { translation: true } }),
      event(3, { attemptId: 'undone' }), event(4, { kind: 'retraction', retracts: 'undone' }),
    ], [], 'sense-recognition');
    expect(points.map((point) => point.state)).toEqual(['unmeasured']);
  });
  it('normalizes real Anki factors using the shared reducer', () => {
    expect(knowledgeTrajectoryData([event(1, { source: 'anki', easeAfter: 1500 })], [], 'sense-recognition').points[0].state).toBe('unknown');
  });
  it('leaves compressed intervals unknown, then seeds exact tail from canonical archive folds', () => {
    const day = 86400000;
    const raw = [event(day, { source: 'anki', easeAfter: 1300 }), event(40 * day, { source: 'anki', easeAfter: 1500 }), event(60 * day, { source: 'anki', easeAfter: 2600 })];
    const { archive } = compactKeyEvents(raw.map((event, seq) => ({ event, seq })), 400 * day);
    expect(archive).toBeDefined();
    const result = knowledgeTrajectoryData([
      raw[0], event(50 * day, { source: 'passiveTracking', kind: 'status', easeAfter: undefined }),
      event(390 * day, { kind: 'claim', toStatus: 'unknown' }),
      event(391 * day, { kind: 'claim', easeAfter: undefined }),
    ], [archive!], 'sense-recognition');
    expect(result.compressed).toEqual([{ from: 40 * day, to: 60 * day, count: 2 }]);
    expect(result.points.map((point) => point.state)).toEqual(['unknown', undefined, 'unknown', 'known']);
  });

});
