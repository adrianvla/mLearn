import { describe, expect, it } from 'vitest';
import type { Candidate, EncounterTask } from './types';
import { createSeededRng, selectNext, type TeachingPolicyConfig } from './teachingPolicy';

const task: EncounterTask = {
  taskTemplateId: 'recognition',
  inputModality: 'text',
  responseModality: 'choice',
  supplied: ['surface'],
  requested: ['meaning'],
  fluencyRequired: false,
  ratingMode: 'dominant',
};

function candidate(key: string, score: number, origin: Candidate['origin'] = 'curriculum'): Candidate {
  return {
    key,
    language: 'de',
    targets: [{ entityId: `de:surface:${key}`, capability: 'surface-recognition' }],
    origin,
    scores: { 'retention-need': score },
  };
}

function config(overrides: Partial<TeachingPolicyConfig> = {}): TeachingPolicyConfig {
  return {
    weights: { 'retention-need': 1 },
    deferFloor: 0,
    attentionBudgetRemaining: 1,
    probeBudgetRemaining: 1,
    probeCooldownMs: 1_000,
    nowMs: 10_000,
    cooldowns: new Map(),
    recentPicks: [],
    minRepeatDistance: 0,
    task,
    ...overrides,
  };
}

describe('selectNext', () => {
  it('samples higher-scoring candidates more often with a seeded RNG', () => {
    const rng = createSeededRng(42);
    const counts = { high: 0, low: 0 };

    for (let draw = 0; draw < 10_000; draw += 1) {
      const decision = selectNext([candidate('high', 4), candidate('low', 1)], config(), rng);
      expect(decision).not.toBeNull();
      counts[decision!.candidate.key as keyof typeof counts] += 1;
    }

    expect(counts.high).toBeGreaterThan(counts.low * 2);
  });

  it('defers when the best score is below the floor or attention is exhausted', () => {
    expect(selectNext([candidate('low', 0.2)], config({ deferFloor: 0.3 }))?.action).toBe('DEFER');
    expect(selectNext([candidate('ready', 1)], config({ attentionBudgetRemaining: 0 }))?.action).toBe('DEFER');
  });

  it('only probes with budget and after cooldown', () => {
    const probe = candidate('probe', 1, 'probe');

    expect(selectNext([probe], config({ probeBudgetRemaining: 0 }))?.action).toBe('DEFER');
    expect(selectNext([probe], config({ cooldowns: new Map([['probe', 9_500]]) }))?.action).toBe('DEFER');
    expect(selectNext([probe], config({ cooldowns: new Map([['probe', 8_000]]) }))?.action).toBe('PROBE');
  });

  it('does not repeat a candidate within the configured pick distance', () => {
    const decision = selectNext(
      [candidate('recent', 10), candidate('other', 1)],
      config({ recentPicks: ['older', 'recent'], minRepeatDistance: 1 }),
      () => 0.5,
    );

    expect(decision?.candidate.key).toBe('other');
  });
});
