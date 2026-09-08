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
it('treats a highly predicted bridge as a probe, a costly one as teaching', () => {
    const bridge = (key: string, pSuccess: number): Candidate => ({
      key,
      language: 'ja',
      targets: [{ entityId: `ja:surface:${key}`, capability: 'surface-recognition' }],
      origin: 'bridge',
      scores: { 'information-gain': 1, novelty: 0, uncertainty: 1, 'attention-cost': 1 - pSuccess },
      meta: { bridge: true, pSuccess },
    });
    expect(selectNext([bridge('cheap', 0.9)], config())?.action).toBe('PROBE');
    expect(selectNext([bridge('costly', 0.3)], config())?.action).toBe('TEACH');
  });

  it('a highly predicted bridge consumes probe budget and cooldown like a probe', () => {
    const bridge = (key: string, pSuccess: number): Candidate => ({
      key,
      language: 'ja',
      targets: [{ entityId: `ja:surface:${key}`, capability: 'surface-recognition' }],
      origin: 'bridge',
      scores: { 'information-gain': 1, uncertainty: 1, 'attention-cost': 1 - pSuccess },
      meta: { bridge: true, pSuccess },
    });
    expect(selectNext([bridge('cheap', 0.9)], config({ probeBudgetRemaining: 0 }))?.action).toBe('DEFER');
    expect(selectNext([bridge('cheap', 0.9)], config({ cooldowns: new Map([['cheap', 10_000]]) }))?.action).toBe('DEFER');
  });

  it('values graph completion over novelty: a cheap bridge beats a novel object', () => {
    const cheapBridge: Candidate = {
      key: 'bridge',
      language: 'ja',
      targets: [{ entityId: 'ja:surface:bridge', capability: 'surface-recognition' }],
      origin: 'bridge',
      scores: { 'information-gain': 1, novelty: 0, uncertainty: 1, 'attention-cost': 0.1 },
      meta: { bridge: true, pSuccess: 0.9 },
    };
    const novel: Candidate = {
      key: 'novel',
      language: 'ja',
      targets: [{ entityId: 'ja:surface:novel', capability: 'sense-recognition' }],
      origin: 'curriculum',
      scores: { 'curriculum-relevance': 1 },
    };
    // Cost-aware CALIBRATION weighting: the cheap bridge wins despite equal
    // headline scores — useful graph completion ÷ teaching cost.
    expect(selectNext([novel, cheapBridge], config({
      weights: { 'information-gain': 1, uncertainty: 1, novelty: 1, 'curriculum-relevance': 1, 'attention-cost': -0.5 },
      task,
    }))).not.toBeNull();
    const rng = createSeededRng(7);
    let bridgePicks = 0;
    for (let draw = 0; draw < 2_000; draw += 1) {
      const decision = selectNext([novel, cheapBridge], config({
        weights: { 'information-gain': 1, uncertainty: 1, novelty: 1, 'curriculum-relevance': 1, 'attention-cost': -0.5 },
      }), rng);
      if (decision?.candidate.key === 'bridge') bridgePicks += 1;
    }
    expect(bridgePicks).toBeGreaterThan(1_200);
  });
});
