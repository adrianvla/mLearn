import { chooseLearningSequence, fitLearningModel, learningAddress, type LearningAction } from '../../shared/learningModel';
import { evaluateLearningActions, learningSequenceDelay } from '../../shared/learningInformation';
import { inferLearningOpportunities } from '../../shared/learningOpportunities';
import { surfaceEntityId } from '../../shared/graph/load';
import { hashWordSync } from '../../shared/utils/wordHash';
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
export const POLICY_TRACE_VERSION = 'teaching-policy@9-sequence-completion';

/** Bounded trace size: ranking rows kept per decision (R20 persistence bound). */
export const POLICY_RANKING_CAP = 8;

/** Bounded trace size: recent-pick and cooldown history entries kept per decision. */
export const POLICY_TRACE_HISTORY_CAP = 16;

/** Bounded per-decision draw and exclusion details retained in a trace. */
export const POLICY_TRACE_DETAIL_CAP = 16;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface TeachingPolicyConfig {
  /** Stored callers may still supply weighted; live model selection is deterministic. */
  selection?: 'weighted' | 'ranked';
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
  /** Outcome constraints, model snapshot and observed opportunities. */
  context?: PolicyContext;
  /** Select within an activity the learner deliberately opened; deferral is advice, not admission control. */
  preserveActivityChoice?: boolean;
  /**
   * Seed of the rng used for this selection (R20 replay). Recorded in the
   * trace so the stochastic draw can be replayed exactly; absent = the
   * caller supplied an unseeded rng and the trace records seed null. The
   * seed labels the entropy origin — replay reconstructs the draw sequence
   * from the trace either way.
   */
  seed?: number;
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
  _rng: Rng = Math.random,
  _drawForCandidate?: (key: string) => number,
): PolicyDecision | null {
  if (candidates.length === 0) return null;

  const fallbackOpportunities = inferLearningOpportunities([], config.nowMs);
  const learned = config.context?.learning;
  const model = learned?.model ?? fitLearningModel([], config.nowMs, 'unfitted-no-history');
  const horizonDays = learned?.horizonDays ?? (config.context?.goal?.deadlineMs !== undefined
    ? Math.max(1, (config.context.goal.deadlineMs - config.nowMs) / DAY_MS) : 30);
  const deferDays = learned?.deferDays ?? 3;
  const actions: LearningAction[] = [];
  const fallbackWeights: Record<string, number> = {};
  const goalWords = new Set(config.context?.goals?.flatMap(goal => goal.scope?.words ?? []) ?? []);
  for (const candidate of candidates) {
    const targets = candidate.word ? candidate.targets.map(target => ({ ...target,
      entityId: surfaceEntityId(candidate.language, hashWordSync(candidate.word!)) })) : candidate.targets;
    const task = candidate.task ?? config.task;
    const targetWeights = learned?.targetWeights ?? (goalWords.size ? Object.fromEntries(targets.map(target =>
      [learningAddress(target), candidate.word && goalWords.has(candidate.word) ? 1 : 0])) : undefined);
    if (targetWeights && !learned?.targetWeights) Object.assign(fallbackWeights, targetWeights);
    const measured = task.responseModality === 'recall' ? targets.find(target => !task.supplied.includes(target.capability)) : undefined;
    actions.push({
      key: candidate.key, family: task.taskTemplateId, targets,
      mode: requiresProbe(candidate) ? 'diagnostic' : 'practice',
      ...(measured ? { measurement: { address: learningAddress(measured), provenance: 'Declared recall task with requested unsupplied access. Prospective self-reported recall, not independent assessment calibration.' } } : {}),
    });
  }
  const evaluationContext = { nowMs: config.nowMs, horizonDays, deferDays,
    targetWeights: learned?.targetWeights ?? (goalWords.size ? fallbackWeights : undefined), assessmentAt: learned?.assessmentAt };
  const actionValues = evaluateLearningActions(model, actions, evaluationContext,
    { availableSeconds: learned?.availableSeconds ?? fallbackOpportunities.availableSeconds, continuationValue: learned?.continuationValue ?? 0 });
  const evaluations = new Map(actionValues.map(value => [value.key, value]));
  // Heuristic source metadata stays available for provenance, but is not a learning-effect model.
  const effective = {}; const rules: PolicyWeightRule[] = [];
  const scored = candidates.map(candidate => { const value = evaluations.get(candidate.key)!;
    return { candidate, total: value.expectedCapabilityDays + (value.information?.expectedDecisionBenefit ?? 0) }; });
  const modelTrace: NonNullable<PolicyTrace['model']> = {
    version: model.version, evidenceVersion: model.evidenceVersion, horizonDays, deferDays,
    evaluations: [...evaluations.values()].slice(0, POLICY_TRACE_DETAIL_CAP),
    evaluationsOmitted: Math.max(0, evaluations.size - POLICY_TRACE_DETAIL_CAP), sequence: [], alternative: 'continue-immersion',
  };
  config = { ...config, selection: 'ranked' };
  const best = scored.reduce((current, item) => item.total > current.total ? item : current);

  const defer = (
    action: PolicyAction,
    why: string,
    exclusions: PolicyExclusion[] = [],
    exclusionsOmitted = 0,
  ) => decision(best, action, config, why, {
    effective, rules, scored, exclusions, exclusionsOmitted, draws: [], drawsOmitted: 0, model: modelTrace,
  });

  if (config.attentionBudgetRemaining <= 0) {
    return defer('DEFER', 'attention budget exhausted');
  }
  if (best.total < config.deferFloor && !config.preserveActivityChoice) {
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

  const delay = learningSequenceDelay(model, actions, evaluationContext);
  const sequence = chooseLearningSequence(eligible.map(row => evaluations.get(row.candidate.key)!), {
    availableSeconds: learned?.availableSeconds ?? fallbackOpportunities.availableSeconds,
    continuationValue: learned?.continuationValue ?? 0, delayedValue: delay.delayedValue, delayedIdentity: delay.delayedIdentity,
  });
  if (!sequence.keys.length && !config.preserveActivityChoice) return defer('DEFER', 'No feasible additional action improves on continuing immersion under this model', exclusions, exclusionsOmitted);
  const activityChoicePreserved = sequence.keys.length === 0;
  const selected = activityChoicePreserved
    ? eligible.reduce((current, item) => item.total > current.total ? item : current)
    : eligible.find(row => row.candidate.key === sequence.keys[0])!;
  modelTrace.sequence = activityChoicePreserved ? [selected.candidate.key] : sequence.keys;
  modelTrace.sequenceValue = activityChoicePreserved ? undefined : sequence.value;
  modelTrace.sequenceTiming = 'ordered-completion';
  modelTrace.activityChoicePreserved = activityChoicePreserved;
  const draws: RngDraw[] = []; const drawsOmitted = 0;
  const action: PolicyAction = selected.candidate.origin === 'retention'
    ? 'MAINTAIN'
    : requiresProbe(selected.candidate)
      ? 'PROBE'
      : 'TEACH';
  // Explain the conditional action comparison recorded in this same trace.
  const value = evaluations.get(selected.candidate.key)!;
  const why = `${activityChoicePreserved ? 'Preserved learner-selected activity; chose its highest-valued eligible task despite the model preference to defer' : `Selected feasible sequence ${sequence.keys.join(' → ')}`}: expected marginal ${value.expectedCapabilityDays.toFixed(3)} capability-days over ${horizonDays.toFixed(1)} days against ${value.counterfactual}; ${value.effort.meanSeconds.toFixed(1)} seconds expected active effort. Expected future decision benefit ${(value.information?.expectedDecisionBenefit ?? 0).toFixed(3)} capability-days; belief revision is not learning. ${value.priorDriven ? 'Prior-driven estimate.' : 'Conditioned on bounded task-compatible observations.'}`;
  return decision(
    selected,
    action,
    config,
    why,
    { effective, rules, scored, exclusions, exclusionsOmitted, draws, drawsOmitted, model: modelTrace },
  );
}

/** Origins that consume the probe budget and honor probe cooldown. */
function requiresProbe(candidate: Candidate): boolean {
  // A missing-access measurement remains a probe irrespective of support.
  // The outcome, not an uncalibrated score, establishes whether it is known.
  return candidate.origin === 'probe' || candidate.origin === 'bridge';
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

interface DecisionContext {
  model?: PolicyTrace['model'];
  effective: Partial<Record<ScoreDimension, number>>;
  rules: PolicyWeightRule[];
  scored: readonly ScoredCandidate[];
  exclusions: PolicyExclusion[];
  exclusionsOmitted: number;
  /** Recorded rng draws over the eligible pool (empty for DEFER: nothing was drawn). */
  draws: RngDraw[];
  drawsOmitted: number;
}

const MEDIA_LIMIT =
  'media-relevance is recurrence of unmeasured tokens in the learner\'s selected media (coverage), not demonstrated comprehension.';

function rankRow(candidate: Candidate, effective: Partial<Record<ScoreDimension, number>>, task: EncounterTask): PolicyRankRow {
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
    targets: JSON.parse(JSON.stringify(candidate.targets)) as Candidate['targets'],
    task: JSON.parse(JSON.stringify(candidate.task ?? task)) as EncounterTask,
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
    .map((row) => ({ ...rankRow(row.candidate, context.effective, config.task), total: row.total, contributions: [] }));

  const limits: string[] = context.model ? ['Capability-days are model-conditional action predictions, not causal effect estimates or official pass probabilities.', 'Action effects and opportunity headroom remain prior-driven where delayed data is sparse.', 'Exact replay requires the recorded model/evidence snapshot; bounded traces alone do not reconstruct learner history.'] : ['No model snapshot recorded.'];
  if (context.scored.some(({ candidate }) => candidate.origin === 'media')) limits.push(MEDIA_LIMIT);

  const consultedRecentPicks = config.minRepeatDistance > 0
    ? config.recentPicks.slice(-config.minRepeatDistance)
    : [];

  return {
    version: POLICY_TRACE_VERSION,
    ...(context.model ? { model: context.model } : {}),
    inputs: {
      ...(config.selection ? { selection: config.selection } : {}),
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
      taskSnapshot: JSON.parse(JSON.stringify(config.task)) as EncounterTask,
      candidateCount: context.scored.length,
      goal: config.context?.goal ?? null,
      intensity: config.context?.intensity ?? null,
    },
    weights: {
      base: {},
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

/** Exact reconstruction needs the immutable model/evidence snapshot as well as candidates.
 * A bounded inspection trace cannot silently substitute an unfitted model. */
export function replayFromTrace(_trace: PolicyTrace, _candidates: readonly Candidate[], _task?: EncounterTask): PolicyDecision | null {
  return null;
}
