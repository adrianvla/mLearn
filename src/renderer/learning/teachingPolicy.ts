import type {
  Candidate,
  EncounterTask,
  PolicyAction,
  PolicyDecision,
  ScaffoldRef,
  ScoreDimension,
} from './types';

export type Rng = () => number;

export interface TeachingPolicyConfig {
  weights: Partial<Record<ScoreDimension, number>>;
  deferFloor: number;
  attentionBudgetRemaining: number;
  probeBudgetRemaining: number;
  probeCooldownMs: number;
  nowMs: number;
  cooldowns: ReadonlyMap<string, number>;
  /** Oldest to newest candidate keys. */
  recentPicks: readonly string[];
  minRepeatDistance: number;
  task: EncounterTask;
  scaffolds?: readonly ScaffoldRef[];
}

interface ScoredCandidate {
  candidate: Candidate;
  total: number;
}

/**
 * Prediction is read-only policy input: it contributes score dimensions but
 * never writes knowledge. Only recorded learner evidence may update knowledge.
 */
export function selectNext(
  candidates: readonly Candidate[],
  config: TeachingPolicyConfig,
  rng: Rng = Math.random,
): PolicyDecision | null {
  if (candidates.length === 0) return null;

  const scored = candidates.map((candidate) => ({
    candidate,
    total: totalScore(candidate, config.weights),
  }));
  const best = scored.reduce((current, item) => item.total > current.total ? item : current);

  if (config.attentionBudgetRemaining <= 0) {
    return decision(best, 'DEFER', config, 'attention budget exhausted');
  }
  if (best.total < config.deferFloor) {
    return decision(best, 'DEFER', config, `best score ${best.total} below floor ${config.deferFloor}`);
  }

  const blockedByHysteresis = new Set(
    config.minRepeatDistance > 0
      ? config.recentPicks.slice(-config.minRepeatDistance)
      : [],
  );
  const eligible = scored.filter(({ candidate }) => (
    !blockedByHysteresis.has(candidate.key)
    && probeIsAllowed(candidate, config)
  ));

  if (eligible.length === 0) {
    return decision(best, 'DEFER', config, 'all candidates blocked by cooldown, budget, or hysteresis');
  }

  const selected = weightedPick(eligible, rng);
  const action: PolicyAction = selected.candidate.origin === 'probe'
    ? 'PROBE'
    : selected.candidate.origin === 'retention'
      ? 'MAINTAIN'
      : 'TEACH';
  return decision(selected, action, config, `selected with score ${selected.total}`);
}

export function totalScore(
  candidate: Candidate,
  weights: Partial<Record<ScoreDimension, number>>,
): number {
  let total = 0;
  for (const [dimension, score] of Object.entries(candidate.scores)) {
    if (score !== undefined) total += score * (weights[dimension as ScoreDimension] ?? 0);
  }
  return total;
}

/** Seeded 32-bit generator for repeatable policy tests and simulations. */
export function createSeededRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1_664_525, state) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function probeIsAllowed(candidate: Candidate, config: TeachingPolicyConfig): boolean {
  if (candidate.origin !== 'probe') return true;
  if (config.probeBudgetRemaining <= 0) return false;
  const lastProbeAt = config.cooldowns.get(candidate.key);
  return lastProbeAt === undefined || config.nowMs - lastProbeAt >= config.probeCooldownMs;
}

function weightedPick(candidates: readonly ScoredCandidate[], rng: Rng): ScoredCandidate {
  let selected = candidates[0];
  let selectedKey = weightedKey(selected.total, rng);

  for (let index = 1; index < candidates.length; index += 1) {
    const key = weightedKey(candidates[index].total, rng);
    if (key < selectedKey) {
      selected = candidates[index];
      selectedKey = key;
    }
  }
  return selected;
}

// Word Sync heritage: higher weights sort first by -random^(1/weight).
function weightedKey(score: number, rng: Rng): number {
  const weight = Math.max(Number.EPSILON, score);
  return -Math.pow(rng(), 1 / weight);
}

function decision(
  selected: ScoredCandidate,
  action: PolicyAction,
  config: TeachingPolicyConfig,
  why: string,
): PolicyDecision {
  return {
    candidate: selected.candidate,
    action,
    encounter: {
      targets: selected.candidate.targets,
      task: config.task,
      scaffolds: [...(config.scaffolds ?? [])],
      why,
    },
  };
}
