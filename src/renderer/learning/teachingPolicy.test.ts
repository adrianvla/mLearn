import { describe, expect, it } from 'vitest';
import type { Candidate, EncounterTask, PolicyTrace, ScoreDimension } from './types';
import {
  DEADLINE_WINDOW_DAYS,
  MOMENTUM_WEIGHTS,
  POLICY_RANKING_CAP,
  POLICY_TRACE_DETAIL_CAP,
  POLICY_TRACE_VERSION,
  createSeededRng,
  effectiveWeights,
  replayFromTrace,
  selectNext,
  totalScore,
  type TeachingPolicyConfig,
} from './teachingPolicy';

const task: EncounterTask = {
  taskTemplateId: 'recognition',
  inputModality: 'text',
  responseModality: 'choice',
  supplied: ['surface'],
  requested: ['meaning'],
  fluencyRequired: false,
  ratingMode: 'dominant',
};

/**
 * Constant-rng seam: weightedPick draws one random per candidate, so a fixed
 * r makes the sampler order strictly by total (higher total → smaller key)
 * while the seeded-RNG tests below cover the stochastic sampling behavior.
 */
const argmaxRng = (): number => 0.5;

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

describe('selectNext trace (R20)', () => {
  const traceWeights = { 'retention-need': 1, 'curriculum-relevance': 1, novelty: 1 } as const;

  function scored(key: string, scores: Partial<Record<ScoreDimension, number>>, origin: Candidate['origin'] = 'curriculum'): Candidate {
    return {
      key,
      language: 'de',
      targets: [{ entityId: `de:surface:${key}`, capability: 'surface-recognition' }],
      origin,
      scores,
    };
  }

  it('emits a bounded typed trace that agrees with the decision', () => {
    const decision = selectNext(
      [scored('repair', { 'retention-need': 0.9 }, 'retention'), scored('neu', { 'curriculum-relevance': 0.5, novelty: 1 })],
      config({ weights: { ...traceWeights } }),
    );
    expect(decision).not.toBeNull();
    const trace = decision!.trace!;
    expect(trace.version).toBe(POLICY_TRACE_VERSION);
    expect(trace.inputs).toMatchObject({
      nowMs: 10_000,
      attentionBudgetRemaining: 1,
      probeBudgetRemaining: 1,
      deferFloor: 0,
      minRepeatDistance: 0,
      probeCooldownMs: 1_000,
      recentPickCount: 0,
      task: 'recognition',
      candidateCount: 2,
      goal: null,
      intensity: null,
    });
    // No context → base weights pass through unchanged and no rules fired.
    expect(trace.weights.base).toEqual(traceWeights);
    expect(trace.weights.effective).toEqual(traceWeights);
    expect(trace.weights.rules).toEqual([]);
    // The chosen candidate's own row reconciles: contributions sum to the
    // total, and the total equals a fresh scoring under the effective weights.
    const row = trace.ranking[0]!;
    expect(row.key).toBe(decision!.candidate.key);
    const contributionSum = row.contributions.reduce((sum, entry) => sum + entry.value, 0);
    expect(contributionSum).toBeCloseTo(row.total, 12);
    expect(row.total).toBeCloseTo(totalScore(decision!.candidate, trace.weights.effective), 12);
    expect(trace.selectedKey).toBe(decision!.candidate.key);
    expect(trace.action).toBe(decision!.action);
    expect(trace.exclusions).toEqual([]);
    expect(trace.limits.length).toBeGreaterThan(0);
    expect(trace.limits.join(' ')).toContain('not calibrated recall probabilities');
  });

  it('replays identically from the same inputs and seed', () => {
    const candidates = [
      scored('repair', { 'retention-need': 0.9 }, 'retention'),
      scored('neu', { 'curriculum-relevance': 0.5, novelty: 1 }),
      scored('bridge', { 'information-gain': 1, uncertainty: 1 }, 'bridge'),
    ];
    const first = selectNext(candidates, config({ weights: { ...traceWeights } }), createSeededRng(7));
    const second = selectNext(candidates, config({ weights: { ...traceWeights } }), createSeededRng(7));
    expect(first).toEqual(second);
  });

  it('bounds the ranking over large pools and counts the omitted rows', () => {
    const pool = Array.from({ length: 12 }, (_, index) =>
      scored(`w${index}`, { 'curriculum-relevance': index / 12 }));
    const decision = selectNext(pool, config({ weights: { ...traceWeights } }), argmaxRng)!;
    expect(decision.trace!.ranking).toHaveLength(POLICY_RANKING_CAP);
    expect(decision.trace!.rankingOmitted).toBe(12 - POLICY_RANKING_CAP);
    expect(decision.trace!.ranking[0]!.key).toBe(decision.candidate.key);
    expect(decision.trace!.ranking.map((row) => row.total)).toEqual(
      [...decision.trace!.ranking.map((row) => row.total)].sort((left, right) => right - left),
    );
  });

  it('bounds draw details and refuses exact replay when draws were omitted', () => {
    const pool = Array.from({ length: POLICY_TRACE_DETAIL_CAP + 5 }, (_, index) =>
      scored(`draw-${index}`, { 'curriculum-relevance': (index + 1) / 100 }));
    const decision = selectNext(pool, config({ weights: { ...traceWeights } }), argmaxRng)!;
    expect(decision.trace!.inputs.rng.draws).toHaveLength(POLICY_TRACE_DETAIL_CAP);
    expect(decision.trace!.inputs.rng.drawsOmitted).toBe(5);
    expect(replayFromTrace(decision.trace!, pool)).toBeNull();
  });

  it('bounds exclusion and hysteresis details with honest omission counts', () => {
    const pool = Array.from({ length: POLICY_TRACE_DETAIL_CAP + 5 }, (_, index) =>
      scored(`blocked-${index}`, { 'curriculum-relevance': 1 }));
    const recentPicks = pool.map((candidate) => candidate.key);
    const decision = selectNext(pool, config({
      weights: { ...traceWeights },
      recentPicks,
      minRepeatDistance: recentPicks.length,
    }))!;
    expect(decision.action).toBe('DEFER');
    expect(decision.trace!.exclusions).toHaveLength(POLICY_TRACE_DETAIL_CAP);
    expect(decision.trace!.exclusionsOmitted).toBe(5);
    expect(decision.trace!.inputs.recentPicks).toHaveLength(POLICY_TRACE_DETAIL_CAP);
    expect(decision.trace!.inputs.recentPicksOmitted).toBe(5);
    expect(replayFromTrace(decision.trace!, pool)).toBeNull();
  });

  it('records blocked candidates with reasons even when a selection succeeds', () => {
    // 'recent' outscores the eligible candidate but sits inside hysteresis;
    // the trace must still say WHY it was not offered.
    const decision = selectNext(
      [scored('recent', { 'curriculum-relevance': 1 }), scored('open', { 'curriculum-relevance': 0.4 })],
      config({ weights: { ...traceWeights }, recentPicks: ['recent'], minRepeatDistance: 1 }),
      argmaxRng,
    )!;
    expect(decision.action).not.toBe('DEFER');
    expect(decision.candidate.key).toBe('open');
    const reasons = new Map(decision.trace!.exclusions.map((entry) => [entry.key, entry.reason]));
    expect(reasons.get('recent')).toBe('blocked by hysteresis (recent pick)');
    expect(reasons.has('open')).toBe(false);
  });

  it('records pool-relevant cooldown identities and recent-pick identities in the trace inputs', () => {
    const decision = selectNext(
      [scored('open', { 'curriculum-relevance': 1 })],
      config({
        weights: { ...traceWeights },
        recentPicks: ['a', 'b'],
        minRepeatDistance: 5,
        // Cooldowns for keys OUTSIDE the pool cannot have influenced the
        // decision and are not recorded; pool keys are.
        cooldowns: new Map([['open', 5_000], ['elsewhere', 5_000]]),
      }),
    )!;
    expect(decision.trace!.inputs.recentPicks).toEqual(['a', 'b']);
    expect(decision.trace!.inputs.cooldowns).toEqual([{ key: 'open', lastProbeAtMs: 5_000 }]);
    expect(decision.trace!.inputs.cooldownsOmitted).toBe(0);
  });

  it('refuses replay when pool-relevant cooldown entries were truncated', () => {
    const pool = Array.from({ length: 17 }, (_, index) =>
      scored(`probe-${index}`, { 'information-gain': 1 }, 'probe'));
    const cooldowns = new Map(pool.map((candidate, index) => [candidate.key, 5_000 + index]));
    cooldowns.set('irrelevant', 5_000); // filtered out of the trace entirely
    const decision = selectNext(pool, config({
      weights: { 'information-gain': 1 },
      probeCooldownMs: 60_000,
      cooldowns,
    }), createSeededRng(11))!;
    // 17 pool-relevant entries, 16 recorded: one omitted, replay refused —
    // and the omission counts only pool-relevant keys, not the noise key.
    expect(decision.trace!.inputs.cooldowns).toHaveLength(16);
    expect(decision.trace!.inputs.cooldownsOmitted).toBe(1);
    expect(replayFromTrace(decision.trace!, pool)).toBeNull();
  });

  it('records the rng seed and one draw per drawn candidate', () => {
    const candidates = [
      scored('repair', { 'retention-need': 0.9 }, 'retention'),
      scored('neu', { novelty: 1 }),
    ];
    const decision = selectNext(candidates, config({ weights: { ...traceWeights }, seed: 7 }), createSeededRng(7))!;
    const rng = decision.trace!.inputs.rng;
    expect(rng.seed).toBe(7);
    expect(rng.draws).toHaveLength(2);
    expect(rng.draws.map((entry) => entry.key).sort()).toEqual(['neu', 'repair']);
    for (const entry of rng.draws) {
      expect(entry.draw).toBeGreaterThanOrEqual(0);
      expect(entry.draw).toBeLessThan(1);
    }
    // The draw record agrees with the selection: the winner's key is among the draws.
    expect(rng.draws.some((entry) => entry.key === decision.candidate.key)).toBe(true);
  });

  it('carries candidate metadata into ranking rows so explanations name the source inputs', () => {
    const mediaRow = { ...scored('fukushi', { 'media-relevance': 1, novelty: 1 }), meta: { timesSeen: 12, timesHovered: 4, status: 'unmeasured' } };
    const decision = selectNext([mediaRow], config({ weights: { ...traceWeights } }), argmaxRng)!;
    const row = decision.trace!.ranking.find((entry) => entry.key === 'fukushi')!;
    expect(row.meta).toEqual({ timesSeen: 12, timesHovered: 4, status: 'unmeasured' });
  });

  it('replays a seeded decision from the EMITTED TRACE alone', () => {
    const candidates = [
      scored('repair', { 'retention-need': 0.9 }, 'retention'),
      scored('neu', { 'curriculum-relevance': 0.5, novelty: 1 }),
      scored('bridge', { 'information-gain': 1, uncertainty: 1 }, 'bridge'),
    ];
    const seeded = config({ weights: { ...traceWeights }, seed: 7, recentPicks: ['old'], minRepeatDistance: 1 });
    seeded.cooldowns = new Map([['bridge', 5_000]]);
    const original = selectNext(candidates, seeded, createSeededRng(7))!;
    const replayed = replayFromTrace(original.trace!, candidates);
    expect(replayed).not.toBeNull();
    // Same selection, same action, same trace — computed from the trace's
    // own recorded inputs, not caller-retained config.
    expect(replayed!.candidate.key).toBe(original.candidate.key);
    expect(replayed!.action).toBe(original.action);
    expect(replayed!.trace).toEqual(original.trace);
  });

  it('replays from the recorded draws even when the original rng was NOT createSeededRng', () => {
    // The replay contract is the RECORDED DRAW SEQUENCE, not a seeded-rng
    // algorithm: any rng implementation with a declared seed must replay.
    let state = 0.123456;
    const customRng = (): number => {
      state = (state * 9301 + 49297) % 233_280;
      return state / 233_280;
    };
    const candidates = [
      scored('repair', { 'retention-need': 0.9 }, 'retention'),
      scored('neu', { 'curriculum-relevance': 0.5, novelty: 1 }),
      scored('bridge', { 'information-gain': 1, uncertainty: 1 }, 'bridge'),
    ];
    const original = selectNext(candidates, config({ weights: { ...traceWeights }, seed: 5 }), customRng)!;
    const replayed = replayFromTrace(original.trace!, candidates)!;
    expect(replayed.candidate.key).toBe(original.candidate.key);
    expect(replayed.trace).toEqual(original.trace);
  });

  it('makes a reordered replay pool detectably divergent instead of silently reassigning draws', () => {
    const candidates = [
      scored('repair', { 'retention-need': 0.9 }, 'retention'),
      scored('neu', { novelty: 1 }),
    ];
    const original = selectNext(candidates, config({ weights: { 'retention-need': 1, novelty: 1 }, seed: 9 }), createSeededRng(9))!;
    const replayed = replayFromTrace(original.trace!, [...candidates].reverse())!;
    // Draws are emitted in eligibility order: serving them to a reordered
    // pool misassigns them, and the replayed trace's per-key weighted keys
    // diverge — the comparison the replay consumer performs.
    const originalKeys = original.trace!.inputs.rng.draws.map((draw) => [draw.key, draw.weightedKey]);
    const replayedKeys = replayed.trace!.inputs.rng.draws.map((draw) => [draw.key, draw.weightedKey]);
    expect(replayedKeys).not.toEqual(originalKeys);
  });

  it('replays an unseeded draw from its recorded draw sequence', () => {
    // Production decisions default to an unseeded rng; the replay contract
    // is the RECORDED DRAW SEQUENCE, so seed null does not block replay —
    // every emitted decision trace stays replayable (R20).
    const candidates = [scored('a', { novelty: 1 }), scored('b', { novelty: 0.5 })];
    const decision = selectNext(candidates, config({ weights: { ...traceWeights } }))!; // Math.random
    expect(decision.trace!.inputs.rng.seed).toBeNull();
    expect(decision.trace!.inputs.rng.draws).toHaveLength(2);
    const replayed = replayFromTrace(decision.trace!, candidates)!;
    expect(replayed.candidate.key).toBe(decision.candidate.key);
    expect(replayed.action).toBe(decision.action);
    expect(replayed.trace).toEqual(decision.trace);
  });

  it('refuses a corrupt pick trace that recorded no draws', () => {
    // A successful weighted pick always draws; a pick trace without draws
    // cannot be replayed and pretending otherwise would fabricate a result.
    const candidates = [scored('a', { novelty: 1 })];
    const decision = selectNext(candidates, config({ weights: { ...traceWeights } }), argmaxRng)!;
    const corrupt: PolicyTrace = {
      ...decision.trace!,
      action: 'TEACH',
      inputs: { ...decision.trace!.inputs, rng: { seed: null, draws: [], drawsOmitted: 0 } },
    };
    expect(replayFromTrace(corrupt, candidates)).toBeNull();
  });

  it('refuses to replay a trace whose version does not pin the current algorithm (R20)', () => {
    const candidates = [candidate('a', 1), candidate('b', 0.5)];
    const original = selectNext(candidates, config({ seed: 7 }), createSeededRng(7))!;
    expect(original.trace!.version).toBe(POLICY_TRACE_VERSION);
    // A trace recorded under an older or unknown selection math must not be
    // re-executed by the current algorithm and presented as an exact replay.
    for (const version of ['teaching-policy@1', 'teaching-policy@2', 'unknown-policy']) {
      const mutated: PolicyTrace = { ...original.trace!, version };
      expect(replayFromTrace(mutated, candidates)).toBeNull();
    }
  });

  it('explains probe/hysteresis exclusions when everything is blocked', () => {
    const probe = scored('probe', { 'information-gain': 1 }, 'probe');
    const recent = scored('recent', { 'curriculum-relevance': 1 });
    const decision = selectNext([probe, recent], config({
      weights: { ...traceWeights },
      probeBudgetRemaining: 0,
      recentPicks: ['recent'],
      minRepeatDistance: 3,
    }))!;
    expect(decision.action).toBe('DEFER');
    const reasons = new Map(decision.trace!.exclusions.map((entry) => [entry.key, entry.reason]));
    expect(reasons.get('probe')).toBe('probe budget exhausted');
    expect(reasons.get('recent')).toBe('blocked by hysteresis (recent pick)');
  });
});

describe('goal/deadline ROI (R07)', () => {
  const roiWeights = { 'retention-need': 1, 'curriculum-relevance': 1, novelty: 1 } as const;
  const DAY = 24 * 60 * 60 * 1000;

  // Same knowledge state, two horizons: an overdue repair target vs a novel
  // curriculum item. Scores are identical; only the goal context differs.
  const repair = (key = 'repair'): Candidate => ({
    key,
    language: 'de',
    targets: [{ entityId: `de:surface:${key}`, capability: 'surface-recognition' }],
    origin: 'retention',
    scores: { 'retention-need': 0.9 },
  });
  const novel: Candidate = {
    key: 'neu',
    language: 'de',
    targets: [{ entityId: 'de:surface:neu', capability: 'surface-recognition' }],
    origin: 'curriculum',
    scores: { 'curriculum-relevance': 0.2, novelty: 1 },
  };

  it('weights consolidation over exploration near the deadline, and the reverse with months to spare', () => {
    const threeWeeks = selectNext([repair(), novel], config({
      weights: { ...roiWeights },
      context: { goal: { kind: 'exam', deadlineMs: 10_000 + 21 * DAY } },
    }), argmaxRng)!;
    expect(threeWeeks.candidate.key).toBe('repair');
    const rules = threeWeeks.trace!.weights.rules;
    expect(rules.filter((rule) => rule.rule === 'deadline-consolidation').map((rule) => rule.multiplier))
      .toEqual([1.5, 1.5]);
    expect(rules.find((rule) => rule.rule === 'deadline-novelty-discount')?.multiplier).toBe(0.75);
    expect(threeWeeks.trace!.inputs.goal).toEqual({ kind: 'exam', deadlineMs: 10_000 + 21 * DAY });
    // The trace explains WHY with the actual terms, and the arithmetic matches.
    expect(threeWeeks.trace!.weights.rules.every((rule) => rule.why.includes('21 days'))).toBe(true);
    const row = threeWeeks.trace!.ranking.find((entry) => entry.key === 'repair')!;
    expect(row.total).toBeCloseTo(0.9 * 1.5, 12);

    const sixMonths = selectNext([repair(), novel], config({
      weights: { ...roiWeights },
      context: { goal: { kind: 'exam', deadlineMs: 10_000 + 180 * DAY } },
    }), argmaxRng)!;
    expect(sixMonths.candidate.key).toBe('neu');
    expect(sixMonths.trace!.weights.rules).toEqual([]);
    expect(sixMonths.trace!.weights.effective).toEqual(roiWeights);
  });

  it('keeps maintenance identical to the legacy no-context path', () => {
    const candidates = [repair(), novel];
    const legacy = selectNext(candidates, config({ weights: { ...roiWeights } }), argmaxRng);
    const maintenance = selectNext(candidates, config({
      weights: { ...roiWeights },
      context: { intensity: 'steady' },
    }), argmaxRng);
    expect(maintenance!.trace!.weights.rules.map((rule) => rule.rule)).toEqual(['intensity-momentum']);
    // No goal → no deadline weighting: the momentum addend is the only delta.
    const withoutIntensity = selectNext(candidates, config({
      weights: { ...roiWeights },
      context: {},
    }), argmaxRng);
    expect(withoutIntensity).toEqual(legacy);
  });

  it('never selects a near-zero-value candidate in either horizon (no perfectionism)', () => {
    const trivial = repair('trivial');
    const low: Candidate = { ...trivial, scores: { 'retention-need': 0.05 } };
    for (const deadlineDays of [21, 180]) {
      const decision = selectNext([repair(), novel, low], config({
        weights: { ...roiWeights },
        context: { goal: { kind: 'exam', deadlineMs: 10_000 + deadlineDays * DAY } },
      }), argmaxRng);
      expect(decision!.candidate.key).not.toBe('trivial');
    }
  });
});

describe('intensity (R08)', () => {
  const dayWeights = { 'retention-need': 1, novelty: 1 } as const;
  // A familiar, recently consolidated item vs a slightly more novel one.
  const familiar = (momentum: number): Candidate => ({
    key: 'familiar',
    language: 'de',
    targets: [{ entityId: 'de:surface:familiar', capability: 'surface-recognition' }],
    origin: 'retention',
    scores: { 'retention-need': 0.8, momentum },
  });
  const challenging: Candidate = {
    key: 'challenging',
    language: 'de',
    targets: [{ entityId: 'de:surface:challenging', capability: 'surface-recognition' }],
    origin: 'curriculum',
    scores: { novelty: 0.9 },
  };

  it('changes selection with intensity while leaving the evidence inputs untouched', () => {
    const intensive = selectNext([familiar(1), challenging], config({
      weights: { ...dayWeights },
      context: { intensity: 'intensive' },
    }), argmaxRng)!;
    expect(intensive.candidate.key).toBe('challenging');
    expect(intensive.action).toBe('TEACH');
    expect(intensive.trace!.inputs.intensity).toBe('intensive');

    const steady = selectNext([familiar(1), challenging], config({
      weights: { ...dayWeights },
      context: { intensity: 'steady' },
    }), argmaxRng)!;
    expect(steady.candidate.key).toBe('familiar');
    expect(steady.action).toBe('MAINTAIN');

    const gentle = selectNext([familiar(1), challenging], config({
      weights: { ...dayWeights },
      context: { intensity: 'gentle' },
    }), argmaxRng)!;
    expect(gentle.candidate.key).toBe('familiar');
    expect(gentle.trace!.weights.rules).toEqual([
      {
        rule: 'intensity-momentum',
        dimension: 'momentum',
        multiplier: 1,
        addend: MOMENTUM_WEIGHTS.gentle,
        why: `gentle session: momentum weight +${MOMENTUM_WEIGHTS.gentle.toFixed(2)} (padding, selection-only)`,
      },
    ]);
    // Selection-only: the base weights and candidate scores are identical
    // across intensities; only the momentum rule moves the total.
    for (const trace of [intensive.trace!, steady.trace!, gentle.trace!]) {
      expect(trace.weights.base).toEqual(dayWeights);
      const row = trace.ranking.find((entry) => entry.key === 'familiar')!;
      expect(row.contributions.find((entry) => entry.dimension === 'retention-need')?.score).toBe(0.8);
      expect(row.contributions.find((entry) => entry.dimension === 'momentum')?.score).toBe(1);
    }
  });
});

describe('effectiveWeights', () => {
  it('applies each emitted rule exactly once', () => {
    const { weights, rules } = effectiveWeights(
      { 'retention-need': 1, 'curriculum-relevance': 1, novelty: 1 },
      { goal: { kind: 'exam', deadlineMs: 1_000 + 21 * 24 * 60 * 60 * 1000 } },
      1_000,
    );
    expect(rules).toHaveLength(3);
    // 21 of 42 days left → proximity 0.5: consolidation ×1.5, novelty ×0.75.
    expect(weights['retention-need']).toBeCloseTo(1.5, 12);
    expect(weights['curriculum-relevance']).toBeCloseTo(1.5, 12);
    expect(weights.novelty).toBeCloseTo(0.75, 12);
  });

  it('treats expired deadlines and far horizons as no weighting', () => {
    const base = { 'retention-need': 1, novelty: 1 };
    const expired = effectiveWeights(base, { goal: { kind: 'exam', deadlineMs: 500 } }, 1_000);
    expect(expired.rules).toEqual([]);
    expect(expired.weights).toEqual(base);
    const far = effectiveWeights(base, { goal: { kind: 'exam', deadlineMs: 1_000 + (DEADLINE_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000 } }, 1_000);
    expect(far.rules).toEqual([]);
  });
});
