import type {
  Candidate,
  EncounterTask,
  PolicyAction,
  PolicyContext,
  PolicyDecision,
  PolicyExclusion,
  PolicyRankRow,
  PolicyTrace,
  PolicyWeightRule,
  ScaffoldRef,
  ScoreDimension,
} from './types';

export type Rng = () => number;

/** Version of the selection math captured in every trace (R20 replay pin). */
export const POLICY_TRACE_VERSION = 'teaching-policy@3';

/** Deadline window (days) inside which goal weighting ramps up (R07 heuristic, bounded). */
export const DEADLINE_WINDOW_DAYS = 42;

/** Momentum weight by session intensity (R08): padding, selection-only. */
export const MOMENTUM_WEIGHTS: Record<NonNullable<PolicyContext['intensity']>, number> = {
  gentle: 0.35,
  steady: 0.15,
  intensive: 0,
};

/** Bounded trace size: ranking rows kept per decision (R20 persistence bound). */
export const POLICY_RANKING_CAP = 8;

/** Bounded trace size: recent-pick and cooldown history entries kept per decision. */
export const POLICY_TRACE_HISTORY_CAP = 16;

/** Bounded per-decision draw and exclusion details retained in a trace. */
export const POLICY_TRACE_DETAIL_CAP = 16;

const DAY_MS = 24 * 60 * 60 * 1000;

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
  /** Learner goal/intensity context (R07/R08). Absent = legacy behavior, byte-identical. */
  context?: PolicyContext;
  /**
   * Seed of the rng used for this selection (R20 replay). Recorded in the
   * trace so the stochastic draw can be replayed exactly; absent = the
   * caller supplied an unseeded rng and the trace records seed null. The
   * seed labels the entropy origin — replay reconstructs the draw sequence
   * from the trace either way.
   */
  seed?: number;
}

export interface EffectiveWeights {
  weights: Partial<Record<ScoreDimension, number>>;
  rules: PolicyWeightRule[];
}

/**
 * Pure derivation of context-driven weight adjustments (R07/R08).
 *
 * Every emitted rule states its exact arithmetic; absent context emits no
 * rules and returns the base weights unchanged. These are explainable
 * HEURISTICS over bounded constants — never calibrated probabilities.
 */
export function effectiveWeights(
  base: Partial<Record<ScoreDimension, number>>,
  context: PolicyContext | undefined,
  nowMs: number,
): EffectiveWeights {
  const weights = { ...base };
  const rules: PolicyWeightRule[] = [];
  if (!context) return { weights, rules };

  const goal = context.goal;
  if (goal?.kind === 'exam' && goal.deadlineMs !== undefined && Number.isFinite(goal.deadlineMs)) {
    const daysLeft = (goal.deadlineMs - nowMs) / DAY_MS;
    if (daysLeft >= 0 && daysLeft <= DEADLINE_WINDOW_DAYS) {
      const proximity = 1 - daysLeft / DEADLINE_WINDOW_DAYS;
      const consolidation = 1 + proximity;
      // Deadline pressure shifts weight toward consolidation and repair of
      // what is learnable now; exploration (novelty) yields half its weight
      // at the deadline. Six-month horizons sit outside the window and get
      // no weighting: more varied/spaced development stays available.
      for (const dimension of ['retention-need', 'curriculum-relevance'] as const) {
        rules.push({
          rule: 'deadline-consolidation',
          dimension,
          multiplier: consolidation,
          addend: 0,
          why: `exam deadline in ${Math.round(daysLeft)} days: ${dimension} weight ×${consolidation.toFixed(2)}`,
        });
      }
      const discount = 1 - 0.5 * proximity;
      rules.push({
        rule: 'deadline-novelty-discount',
        dimension: 'novelty',
        multiplier: discount,
        addend: 0,
        why: `exam deadline in ${Math.round(daysLeft)} days: novelty weight ×${discount.toFixed(2)}`,
      });
      // Apply each emitted rule exactly once — the loop IS the arithmetic,
      // so the trace's rules always describe the real factors.
      for (const { dimension, multiplier } of rules) {
        weights[dimension] = (weights[dimension] ?? 0) * multiplier;
      }
    }
  }

  const intensity = context.intensity;
  if (intensity !== undefined) {
    // Momentum padding (R08): gentle sessions lean on recently consolidated
    // material for sustainable participation; intensive sessions keep
    // padding low. Adds to the momentum weight only — scores are untouched.
    const addend = MOMENTUM_WEIGHTS[intensity];
    weights.momentum = (weights.momentum ?? 0) + addend;
    rules.push({
      rule: 'intensity-momentum',
      dimension: 'momentum',
      multiplier: 1,
      addend,
      why: `${intensity} session: momentum weight +${addend.toFixed(2)} (padding, selection-only)`,
    });
  }

  return { weights, rules };
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

  const { weights: effective, rules } = effectiveWeights(config.weights, config.context, config.nowMs);
  const scored = candidates.map((candidate) => ({
    candidate,
    total: totalScore(candidate, effective),
  }));
  const best = scored.reduce((current, item) => item.total > current.total ? item : current);

  const defer = (
    action: PolicyAction,
    why: string,
    exclusions: PolicyExclusion[] = [],
    exclusionsOmitted = 0,
  ) => decision(best, action, config, why, {
    effective, rules, scored, exclusions, exclusionsOmitted, draws: [], drawsOmitted: 0,
  });

  if (config.attentionBudgetRemaining <= 0) {
    return defer('DEFER', 'attention budget exhausted');
  }
  if (best.total < config.deferFloor) {
    return defer('DEFER', `best score ${best.total} below floor ${config.deferFloor}`);
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
    const exclusions: PolicyExclusion[] = [];
    let exclusionsOmitted = 0;
    const addExclusion = (exclusion: PolicyExclusion) => {
      if (exclusions.length < POLICY_TRACE_DETAIL_CAP) exclusions.push(exclusion);
      else exclusionsOmitted += 1;
    };
    for (const { candidate } of scored) {
      if (blockedByHysteresis.has(candidate.key)) {
        addExclusion({ key: candidate.key, reason: 'blocked by hysteresis (recent pick)' });
        continue;
      }
      if (!requiresProbe(candidate)) continue;
      if (config.probeBudgetRemaining <= 0) {
        addExclusion({ key: candidate.key, reason: 'probe budget exhausted' });
      } else {
        const lastProbeAt = config.cooldowns.get(candidate.key);
        const remaining = lastProbeAt === undefined ? 0 : config.probeCooldownMs - (config.nowMs - lastProbeAt);
        addExclusion({ key: candidate.key, reason: `probe cooldown (${Math.max(0, Math.round(remaining))}ms remaining)` });
      }
    }
    return defer('DEFER', 'all candidates blocked by cooldown, budget, or hysteresis', exclusions, exclusionsOmitted);
  }

  // Blocked candidates are recorded even when a selection succeeds (R20): a
  // higher-scoring non-selection must carry its reason in the same trace.
  const eligibleKeys = new Set(eligible.map(({ candidate }) => candidate.key));
  const exclusions: PolicyExclusion[] = [];
  let exclusionsOmitted = 0;
  const addExclusion = (exclusion: PolicyExclusion) => {
    if (exclusions.length < POLICY_TRACE_DETAIL_CAP) exclusions.push(exclusion);
    else exclusionsOmitted += 1;
  };
  for (const { candidate } of scored) {
    if (eligibleKeys.has(candidate.key)) continue;
    if (blockedByHysteresis.has(candidate.key)) {
      addExclusion({ key: candidate.key, reason: 'blocked by hysteresis (recent pick)' });
      continue;
    }
    const reason = probeBlockReason(candidate, config);
    if (reason) addExclusion({ key: candidate.key, reason });
  }

  const { selected, draws, drawsOmitted } = weightedPick(eligible, rng);
  const action: PolicyAction = selected.candidate.origin === 'retention'
    ? 'MAINTAIN'
    : requiresProbe(selected.candidate)
      ? 'PROBE'
      : 'TEACH';
  // The why names the actual selection event: the stochastic pick and what
  // the deterministic ranking alone would have chosen, so a weighted draw is
  // explainable without post-hoc narrative.
  const why = eligible.length === 1
    ? `sole eligible candidate, score ${selected.total}`
    : `weighted pick over ${eligible.length} eligible (seed ${config.seed ?? 'unseeded'}): "${selected.candidate.key}" won with score ${selected.total}; deterministic top was "${best.candidate.key}" at ${best.total}`;
  return decision(
    selected,
    action,
    config,
    why,
    { effective, rules, scored, exclusions, exclusionsOmitted, draws, drawsOmitted },
  );
}

/**
 * A bridge the graph already predicts as highly accessible only deserves a
 * cheap calibration probe — measuring it teaches nothing; full teaching is
 * reserved for bridges with genuine acquisition cost.
 */
const BRIDGE_PROBE_THRESHOLD = 0.7;

function bridgeDeservesOnlyProbe(candidate: Candidate): boolean {
  const predicted = candidate.meta?.pSuccess;
  return typeof predicted === 'number' && predicted >= BRIDGE_PROBE_THRESHOLD;
}

/** Origins that consume the probe budget and honor probe cooldown. */
function requiresProbe(candidate: Candidate): boolean {
  return candidate.origin === 'probe' || (candidate.origin === 'bridge' && bridgeDeservesOnlyProbe(candidate));
}

function probeIsAllowed(candidate: Candidate, config: TeachingPolicyConfig): boolean {
  return probeBlockReason(candidate, config) === null;
}

/** The exact reason a probe-consuming candidate cannot be offered now, or null when allowed. */
function probeBlockReason(candidate: Candidate, config: TeachingPolicyConfig): string | null {
  if (!requiresProbe(candidate)) return null;
  if (config.probeBudgetRemaining <= 0) return 'probe budget exhausted';
  const lastProbeAt = config.cooldowns.get(candidate.key);
  if (lastProbeAt === undefined || config.nowMs - lastProbeAt >= config.probeCooldownMs) return null;
  const remaining = config.probeCooldownMs - (config.nowMs - lastProbeAt);
  return `probe cooldown (${Math.max(0, Math.round(remaining))}ms remaining)`;
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


/** One rng draw recorded in the trace (R20): raw draw and its weighted key. */
export interface RngDraw { key: string; draw: number; weightedKey: number }

function weightedPick(
  candidates: readonly ScoredCandidate[],
  rng: Rng,
): { selected: ScoredCandidate; draws: RngDraw[]; drawsOmitted: number } {
  const first = weightedKey(candidates[0].total, rng);
  let selected = candidates[0];
  let selectedKey = first.weightedKey;
  const draws: RngDraw[] = [{ key: selected.candidate.key, draw: first.draw, weightedKey: first.weightedKey }];
  let drawsOmitted = 0;

  for (let index = 1; index < candidates.length; index += 1) {
    const { weightedKey: key, draw } = weightedKey(candidates[index].total, rng);
    if (draws.length < POLICY_TRACE_DETAIL_CAP) {
      draws.push({ key: candidates[index].candidate.key, draw, weightedKey: key });
    } else {
      drawsOmitted += 1;
    }
    if (key < selectedKey) {
      selected = candidates[index];
      selectedKey = key;
    }
  }
  return { selected, draws, drawsOmitted };
}

// Word Sync heritage: higher weights sort first by -random^(1/weight).
// Returns the weighted key AND the raw draw so the trace can record both (R20).
function weightedKey(score: number, rng: Rng): { weightedKey: number; draw: number } {
  const weight = Math.max(Number.EPSILON, score);
  const draw = rng();
  return { weightedKey: -Math.pow(draw, 1 / weight), draw };
}

interface DecisionContext {
  effective: Partial<Record<ScoreDimension, number>>;
  rules: PolicyWeightRule[];
  scored: readonly ScoredCandidate[];
  exclusions: PolicyExclusion[];
  exclusionsOmitted: number;
  /** Recorded rng draws over the eligible pool (empty for DEFER: nothing was drawn). */
  draws: RngDraw[];
  drawsOmitted: number;
}

const TRACE_LIMITS = [
  'Scores are explainable heuristic weights, not calibrated recall probabilities.',
  'Momentum is recent-consolidation padding: selection-only, never evidence and never a threshold.',
] as const;

const MEDIA_LIMIT =
  'media-relevance is recurrence of unmeasured tokens in the learner\'s selected media (coverage), not demonstrated comprehension.';

function rankRow(candidate: Candidate, effective: Partial<Record<ScoreDimension, number>>): PolicyRankRow {
  const contributions = Object.entries(candidate.scores)
    .filter((entry): entry is [ScoreDimension, number] => entry[1] !== undefined)
    .map(([dimension, score]) => {
      const weight = effective[dimension] ?? 0;
      return { dimension, score, weight, value: score * weight };
    });
  contributions.sort((left, right) => Math.abs(right.value) - Math.abs(left.value));
  return {
    key: candidate.key,
    origin: candidate.origin,
    // Source inputs verbatim: the explanation names the counts/status the
    // scores were derived from, not just the arithmetic (R20).
    ...(candidate.meta ? { meta: { ...candidate.meta } } : {}),
    contributions,
    total: contributions.reduce((sum, entry) => sum + entry.value, 0),
  };
}

function buildTrace(
  chosen: ScoredCandidate,
  action: PolicyAction,
  config: TeachingPolicyConfig,
  context: DecisionContext,
): PolicyTrace {
  // Bounded ranking: the chosen candidate first, then the top competitors by
  // total — selection AND non-selection explanations without unbounded rows.
  const sorted = [...context.scored].sort((left, right) => right.total - left.total);
  const ranking = [chosen, ...sorted.filter((row) => row.candidate.key !== chosen.candidate.key)]
    .slice(0, Math.min(POLICY_RANKING_CAP, context.scored.length))
    .map((row) => rankRow(row.candidate, context.effective));

  const limits: string[] = [...TRACE_LIMITS];
  if (context.scored.some(({ candidate }) => candidate.origin === 'media')) limits.push(MEDIA_LIMIT);

  const consultedRecentPicks = config.minRepeatDistance > 0
    ? config.recentPicks.slice(-config.minRepeatDistance)
    : [];

  return {
    version: POLICY_TRACE_VERSION,
    inputs: {
      nowMs: config.nowMs,
      attentionBudgetRemaining: config.attentionBudgetRemaining,
      probeBudgetRemaining: config.probeBudgetRemaining,
      probeCooldownMs: config.probeCooldownMs,
      deferFloor: config.deferFloor,
      minRepeatDistance: config.minRepeatDistance,
      recentPickCount: config.recentPicks.length,
      // Retain the tail of the hysteresis window; an omission count makes
      // traces over long ranked walks honest and non-replayable.
      recentPicks: consultedRecentPicks.slice(-POLICY_TRACE_HISTORY_CAP),
      recentPicksOmitted: Math.max(0, consultedRecentPicks.length - POLICY_TRACE_HISTORY_CAP),
      cooldowns: (() => {
        const poolKeys = new Set(context.scored.map(({ candidate }) => candidate.key));
        return [...config.cooldowns.entries()]
          .filter(([key]) => poolKeys.has(key))
          .slice(0, POLICY_TRACE_HISTORY_CAP)
          .map(([key, lastProbeAtMs]) => ({ key, lastProbeAtMs }));
      })(),
      cooldownsOmitted: (() => {
        const poolKeys = new Set(context.scored.map(({ candidate }) => candidate.key));
        const relevant = [...config.cooldowns.keys()].filter((key) => poolKeys.has(key)).length;
        return Math.max(0, relevant - POLICY_TRACE_HISTORY_CAP);
      })(),
      rng: {
        seed: config.seed ?? null,
        draws: context.draws,
        drawsOmitted: context.drawsOmitted,
      },
      task: config.task.taskTemplateId,
      candidateCount: context.scored.length,
      goal: config.context?.goal ?? null,
      intensity: config.context?.intensity ?? null,
    },
    weights: {
      base: config.weights,
      effective: context.effective,
      rules: context.rules,
    },
    ranking,
    rankingOmitted: Math.max(0, context.scored.length - ranking.length),
    selectedKey: chosen.candidate.key,
    action,
    exclusions: context.exclusions,
    exclusionsOmitted: context.exclusionsOmitted,
    limits,
  };
}

function decision(
  selected: ScoredCandidate,
  action: PolicyAction,
  config: TeachingPolicyConfig,
  why: string,
  traceContext: DecisionContext,
): PolicyDecision {
  return {
    candidate: selected.candidate,
    action,
    encounter: {
      targets: selected.candidate.targets,
      // The source declares what its encounter measures; the preset task is
      // the fallback for lexical candidates.
      task: selected.candidate.task ?? config.task,
      scaffolds: [...(config.scaffolds ?? [])],
      why,
    },
    trace: buildTrace(selected, action, config, traceContext),
  };
}

/**
 * R20 replay: rebuild the selection from an EMITTED TRACE plus the same
 * candidate pool — not from caller-retained inputs. The reconstructed config
 * comes from the trace's recorded inputs (weights.base, budgets, cooldown
 * snapshot, recent-pick identities, goal incl. target, intensity); the rng is
 * the trace's RECORDED DRAW SEQUENCE — replay never assumes a particular rng
 * algorithm, only that the candidate pool is presented in the same order the
 * trace drew it (the draw record is emitted in eligibility order; a reordered
 * pool diverges and is detectable by comparing the replayed trace). The
 * seed only labels the entropy origin (null = caller-supplied unseeded rng):
 * replay serves the recorded draws either way, so an unseeded trace replays
 * exactly as long as its full draw record is present. `task` is
 * optional: the task template only labels the fallback encounter and never
 * enters the selection math.
 */
export function replayFromTrace(
  trace: PolicyTrace,
  candidates: readonly Candidate[],
  task?: EncounterTask,
): PolicyDecision | null {
  // Replay pins the emitted trace's version (R20): the selection math is
  // versioned precisely so a trace recorded under an older or unknown
  // algorithm cannot be re-executed by the current one and presented as an
  // exact replay. `null` = this trace is not replayable here.
  if (trace.version !== POLICY_TRACE_VERSION) return null;
  // Truncated pool-relevant cooldown history cannot be reconstructed from the
  // trace: an exact replay is impossible, and pretending otherwise would
  // fabricate a result (R20).
  if (trace.inputs.cooldownsOmitted > 0) return null;
  if (trace.inputs.recentPicksOmitted > 0) return null;
  if (trace.inputs.rng.drawsOmitted > 0) return null;
  // Integrity: a weighted pick draws once per eligible candidate, so a
  // successful pick must carry its draw record; a DEFER never drew. A pick
  // trace with no draws is corrupt and cannot be replayed.
  if (trace.action !== null && trace.action !== 'DEFER' && trace.inputs.rng.draws.length === 0) return null;
  const goal = trace.inputs.goal;
  const intensity = trace.inputs.intensity;
  const context: PolicyContext | undefined = goal || intensity
    ? {
        ...(intensity ? { intensity } : {}),
        ...(goal ? { goal } : {}),
      }
    : undefined;
  return selectNext(candidates, {
    weights: { ...trace.weights.base },
    deferFloor: trace.inputs.deferFloor,
    attentionBudgetRemaining: trace.inputs.attentionBudgetRemaining,
    probeBudgetRemaining: trace.inputs.probeBudgetRemaining,
    probeCooldownMs: trace.inputs.probeCooldownMs,
    nowMs: trace.inputs.nowMs,
    cooldowns: new Map(trace.inputs.cooldowns.map((entry) => [entry.key, entry.lastProbeAtMs])),
    recentPicks: trace.inputs.recentPicks,
    minRepeatDistance: trace.inputs.minRepeatDistance,
    task: task ?? {
      taskTemplateId: trace.inputs.task,
      inputModality: 'replay',
      responseModality: 'none',
      supplied: [],
      requested: [],
      fluencyRequired: false,
      ratingMode: 'profile',
    },
    context,
    // Restore the entropy-origin label so the replayed trace's `why` (and
    // therefore the whole trace) matches the emitted one; an unseeded trace
    // replays unseeded.
    ...(trace.inputs.rng.seed !== null ? { seed: trace.inputs.rng.seed } : {}),
  }, replayRngFromDraws(trace.inputs.rng.draws));
}

/** Serves the trace's recorded draws in emission order (R20 exact replay). */
function replayRngFromDraws(draws: PolicyTrace['inputs']['rng']['draws']): Rng {
  let index = 0;
  return () => {
    if (index >= draws.length) {
      throw new Error('replay exhausted the trace draw record: the pool differs from the traced one');
    }
    return draws[index++]!.draw;
  };
}
