import { describe, expect, it } from 'vitest';
import { inferLearningOpportunities, manageableEncounterCount } from './learningOpportunities';
import type { KnowledgeEvent } from './knowledgeEvents';
const row = (t: number, extra: Partial<KnowledgeEvent> = {}): KnowledgeEvent => ({ t, kind: 'rating', source: 'srs', attemptId: String(t), activeLatencyMs: 20000, ...extra });
describe('observable opportunities', () => {
  it('treats observed activity as a lower bound and excludes idle/wall time', () => {
    const observed = inferLearningOpportunities([row(1000), row(21000), row(41000, { stalled: true, activeLatencyMs: 9999999 }), row(61000, { latencyMs: 9999999, activeLatencyMs: undefined })], 80000);
    expect(observed.observedActiveSeconds).toBe(40);
    expect(observed.censoredBursts).toBe(1);
    expect(observed.availableSeconds.every(value => value >= 40)).toBe(true);
    expect(observed.limits.join(' ')).toContain('free time');
  });
  it('deduplicates physical attempts, respects Undo and carries interruption uncertainty', () => {
    const first = row(1000);
    const result = inferLearningOpportunities([first, first, row(21000, { interrupted: true }), { t: 30000, kind: 'retraction', source: 'manual', retracts: '1000' }], 40000);
    expect(result.observedActiveSeconds).toBe(0);
    expect(result.interruptions).toBe(1);
  });
  it('uses measured task effort and keeps a natural finite continuation point', () => {
    expect(manageableEncounterCount({ availableSeconds: [30, 60, 120] }, 60)).toBe(1);
    expect(manageableEncounterCount({ availableSeconds: [600, 1200, 2400] }, 10)).toBe(12);
  });
  it('carries an irregular observed absence without creating a daily schedule or free time', () => {
    const day = 86_400_000;
    const result = inferLearningOpportunities([row(day), row(2 * day), row(12 * day)], 40 * day);
    expect(result.gapDays).toEqual([1, 10, 28]);
    expect(result.censoredBursts).toBe(3);
    expect(result.observedActiveSeconds).toBe(60);
    expect(result.availableSeconds).toHaveLength(9);
  });
});
