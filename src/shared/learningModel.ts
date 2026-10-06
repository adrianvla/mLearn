import type { LearnableTarget } from './graph/types';
import { eventCapability, eventIsMeasurable, readActiveEvidence, type KnowledgeEvent } from './knowledgeEvents';

export const LEARNING_MODEL_VERSION = 'memory-action-filter@5';
const DAY = 86_400_000;
/** Assumptions, not externally fitted mLearn effects. Sensitivity must accompany decisions. */
export const MODEL_ASSUMPTIONS = [
  { id: 'recall-curve', role: 'model', provenance: 'Exponential forgetting: Settles & Meeder 2016; Tabibian et al. 2019. Applicability is task/access conditional.' },
  { id: 'initial-memory', role: 'prior', provenance: 'Unfitted broad engineering prior: half-lives 0.5, 7, 60 days; initial possession 0.1, 0.5, 0.9 with equal mass.' },
  { id: 'instruction-kernels', role: 'prior', provenance: 'Unfitted alternatives: growth 1.1/2/4; acquisition 0.1/0.35/0.7; failed-attempt refresh 0.5/1/2 days. Not sourced effect sizes.' },
  { id: 'prospective-kernel', role: 'model', provenance: 'The next instruction kernel is drawn independently from task-family weights, conditional on the existing memory posterior. Prospective activity choice cannot reweight current possession or no-study predictions.' },
  { id: 'assessment-forecast', role: 'model', provenance: 'Task/access predictions at the required performance point compare no additional study with exactly one prospective intervention. They are conditional forecasts, not current competence, an official scaled score or a guarantee of continued preparation. At most 16 target forecasts per action bound trace size.' },
  { id: 'decision-information', role: 'model', provenance: 'One declared unsupplied self-reported recall access per action supplies a two-response observation model. Information value is expected improved future action choice minus the best choice unable to observe that response, with the same physical intervention in both alternatives. It is not capability acquired or an identified causal effect. A single later opportunity uses the inferred gap and conditional opportunity distribution; future attendance remains uncertain.' },
  { id: 'information-bound', role: 'safeguard', provenance: 'At most 8 information-bearing actions and 8 future teaching/immersion alternatives, including an action addressing the measured access. No diagnostic recursion; recent same-task repetitions and passive immersion receive no information credit. Pair plans count only the larger single-observation information benefit, avoiding unsupported additive independence. Floating-point roundoff below 8 machine epsilons is zero credit.' },
  { id: 'report-noise', role: 'model', provenance: 'Self-reported recall likelihood: 0.1 symmetric reporting error. Sensitivity 0.05–0.25; never an objective test calibration.' },
  { id: 'delayed-outcome', role: 'safeguard', provenance: 'At least 24 hours separates effect-fitting outcomes; same item/version cannot validate generalization. Shorter observations never fit instruction effects. Within this unvalidated interval, another same-family action receives no positive transition extrapolation; defer remains eligible. This is a conservative burden safeguard, not a sourced optimal spacing rule.' },
  { id: 'effort-prior', role: 'prior', provenance: 'Unfitted lognormal task effort: median 30 seconds, log standard deviation log(3), two pseudo-observations. Active, uninterrupted native timing replaces it.' },
  { id: 'effort-interval', role: 'mathematical', provenance: 'Lognormal predictive interval uses normal 5th/95th quantiles (+/-1.645 log SD); log-variance floor 0.01 is a numerical safeguard, not measured certainty.' },
  { id: 'trajectory-integral', role: 'mathematical', provenance: 'Exact integral of the conditional exponential trajectory, split at intervention time. Early short-lived gains are retained even over long horizons; no endpoint-only cramming reward.' },
  { id: 'finite-memory', role: 'safeguard', provenance: 'Half-life growth capped at 3650 days to bound sparse extrapolation and prevent numerical overflow; not a mastery criterion.' },
  { id: 'forecast-particle-bound', role: 'mathematical', provenance: 'Forecast-only repeated physical transitions marginalize latent recall, then use sorted stratified midpoint quadrature at 128 particles (27–512 allowed for numerical sensitivity). This bounds exponential branch growth; it does not create recall observations or calibrate uncertainty.' },
  { id: 'plan-bound', role: 'safeguard', provenance: 'At most two interventions, 32 candidate values, shared target deduplication. Finite sequence search, not greedy benefit/seconds.' },
  { id: 'effort-feasibility', role: 'mathematical', provenance: 'Five equal-mass normal-quantile midpoints integrate the lognormal effort prediction against opportunity samples. Pair efforts are conditionally independent; correlated interruptions and extreme tails remain unmodelled. Quantile quadrature is a bounded numerical approximation, not an availability guarantee.' },
  { id: 'completion-timing', role: 'model', provenance: 'Instruction effects begin at task completion. The same five effort draws determine timing and feasibility; fixed effort scenarios condition on their declared completion seconds. Delayed alternatives add the same effort to their start. No effects are credited before completion. Short sequences compare both execution orders, keeping the evaluation start/end and deferred alternative fixed while adding first-task effort to second-task completion. Disjoint target accesses permit evaluation from the original model.' },
  { id: 'fallback-horizon', role: 'model', provenance: '30 day open-use evaluation horizon; deadline context records its own horizon. Sensitivity 7–60 days.' },
] as const;

interface Particle { halfLifeDays: number; possession: number; kernel: number; weight: number; at: number }
interface Memory { particles: Particle[]; observations: number; lastAt: number; lastTask: string; lastItem?: string }
interface Effort { logSum: number; logSquareSum: number; n: number }
export interface LearningModel {
  version: string;
  evidenceVersion: string;
  at: number;
  memories: Record<string, Memory>;
  kernelWeights: Record<string, number[]>;
  efforts: Record<string, Effort>;
  observations: number;
  validation: { delayedPredictions: number; brier: number | null; constantHalfBrier: number | null; lastOutcomeBrier: number | null };
  limits: string[];
}
export interface LearningAction {
  key: string;
  family: string;
  targets: readonly LearnableTarget[];
  mode: 'practice' | 'diagnostic' | 'immersion';
  /** Alternative activities occupying one physical slot cannot share an opportunity. */
  exclusiveOpportunityGroups?: readonly string[];
  /** Only declared, supported transfer paths may connect immersion to a measured target. */
  transfer?: { probability: number; sensitivity?: number[]; provenance: string };
  /** Producer measured duration or declared activity-specific prior; never derived from exposure counts. */
  durationSeconds?: number;
  /** Explicit observation model for one independently requested access. Ordinary claims/exposure omit it. */
  measurement?: { address: string; reportingError?: number; provenance: string };
}
export function learningActionsCanCombine(left: LearningAction | undefined, right: LearningAction | undefined): boolean {
  return !left?.exclusiveOpportunityGroups?.some(group => right?.exclusiveOpportunityGroups?.includes(group));
}
export interface EvaluationContext {
  nowMs: number;
  horizonDays: number;
  deferDays: number;
  /** Explicit requirements/importance. Shared outcomes use one target weight, not duplicate credit. */
  targetWeights?: Readonly<Record<string, number>>;
  reportingError?: number;
  /** Required performance point, distinct from the trajectory evaluation horizon. */
  assessmentAt?: number;
  /** Forecast-only conditioning on a declared effort scenario, never a learner setting. */
  completionSeconds?: number;
}
export interface ActionPerformanceForecast {
  address: string;
  at: number;
  current: ReturnType<typeof predictRecall>;
  noExtraStudy: ReturnType<typeof predictRecall>;
  oneActionNow: ReturnType<typeof predictRecall>;
  oneActionDeferred: ReturnType<typeof predictRecall>;
  condition: 'one-action-only; not a future-study guarantee';
}
export interface ActionValue {
  key: string;
  addresses: string[];
  family: string;
  expectedCapabilityDays: number;
  interval: [number, number];
  /** Difference against a delayed intervention at the next inferred opportunity. */
  counterfactual: 'defer-to-next-opportunity' | 'no-extra-work';
  effort: { meanSeconds: number; interval: [number, number]; samples: number; source: string };
  /** Correlated timing/value draws: feasibility cannot multiply an unrelated mean gain by completion probability. */
  completionSamples?: Array<{ seconds: number; expectedCapabilityDays: number }>;
  horizonDays: number;
  informationOnly: boolean;
  priorDriven: boolean;
  modelVersion: string;
  evidenceVersion: string;
  transferProvenance?: string;
  /** Conditional task/access predictions, never an official score or outcome probability. */
  performance: ActionPerformanceForecast[];
  performanceOmitted: number;
  information?: {
    expectedDecisionBenefit: number;
    at: number;
    address: string;
    reportingError: number;
    provenance: string;
    branches: Array<{ report: 'recalled' | 'missed'; probability: number; selected: string[]; futureValue: number }>;
    withoutObservationValue: number;
    alternativesOmitted: number;
  };
}

const KERNELS = [
  { growth: 1.1, acquisition: 0.1, refresh: 0.5 },
  { growth: 2, acquisition: 0.35, refresh: 1 },
  { growth: 4, acquisition: 0.7, refresh: 2 },
];
const uniform = () => KERNELS.map(() => 1 / KERNELS.length);
export const learningAddress = (target: LearnableTarget): string => JSON.stringify([target.entityId, target.capability]);
// Directed relations are not interchangeable with an undirected entity access.
const eventAddress = (event: KnowledgeEvent): string | null => !event.targetRef?.to && event.targetRef?.id && eventCapability(event)
  ? learningAddress({ entityId: event.targetRef.id, capability: eventCapability(event)! }) : null;
const familyOf = (event: KnowledgeEvent) => event.decision?.selected.task.taskTemplateId ?? event.taskType ?? 'unspecified';
/** Whether fitLearningModel accepts this event as a recall observation. */
export const isLearningModelRecallEvidence = (event: KnowledgeEvent): boolean => event.method === 'inference'
  ? false : event.decision?.detail.scope === 'scheduler-admitted-workload'
  ? true : event.decision?.selected.task.responseModality === 'self-assessment'
  ? false : event.decision?.selected.task.responseModality === 'recall' && event.taskType === 'word-sync'
  ? event.method === 'recall' : event.taskType !== 'word-sync' && event.taskType !== 'welcome-review'
    && (event.taskType === 'srs-review' || event.decision?.selected.task.responseModality === 'recall' || event.method === 'recall');
const successOf = (event: KnowledgeEvent) => event.quality !== undefined ? event.quality !== 'missed' : event.rating !== 'again';
function initialParticles(at: number): Particle[] {
  return [0.5, 7, 60].flatMap(halfLifeDays => [0.1, 0.5, 0.9].flatMap(possession => KERNELS.map((_, kernel) =>
    ({ halfLifeDays, possession, kernel, weight: 1 / 27, at }))));
}
function normalize(weights: number[]): number[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return total > 0 ? weights.map(weight => weight / total) : weights.map(() => 1 / weights.length);
}
function recall(particle: Particle, at: number): number {
  return particle.possession * Math.pow(2, -Math.max(0, at - particle.at) / DAY / particle.halfLifeDays);
}
function transition(particle: Particle, at: number, success: boolean, probability: number): Particle {
  const kernel = KERNELS[particle.kernel];
  const possessed = recall(particle, at);
  return { ...particle, at, halfLifeDays: success ? Math.min(3650, particle.halfLifeDays * (1 + (kernel.growth - 1) * probability)) : Math.max(particle.halfLifeDays, kernel.refresh * probability),
    possession: possessed + (1 - possessed) * kernel.acquisition * probability };
}
function quantile(values: Array<{ value: number; weight: number }>, probability: number): number {
  const sorted = [...values].sort((a, b) => a.value - b.value);
  let cumulative = 0;
  for (const row of sorted) { cumulative += row.weight; if (cumulative >= probability) return row.value; }
  return sorted.at(-1)?.value ?? 0;
}

/** Pure rebuild from bounded CANONICAL rows. No writes to knowledge/retention projections. */
export function fitLearningModel(events: readonly KnowledgeEvent[], nowMs: number, evidenceVersion = 'bounded-exact', reportingError = 0.1): LearningModel {
  const model: LearningModel = { version: LEARNING_MODEL_VERSION, evidenceVersion, at: nowMs, memories: {}, kernelWeights: {}, efforts: {}, observations: 0,
    validation: { delayedPredictions: 0, brier: null, constantHalfBrier: null, lastOutcomeBrier: null },
    limits: ['Uncalibrated predictive memory model; no official score or pass probability.',
      'Instruction transitions start from explicit engineering priors. Observational fitting does not establish causal action advantage.',
      'Only bounded exact evidence is fitted; archived or omitted evidence increases uncertainty.',
      'Self-reported recall differs from independently scored performance; task and assistance remain conditional.'] };
  const dedup = new Set<string>();
  let squaredError = 0; let lastSquaredError = 0;
  const lastOutcome = new Map<string, boolean>();
  for (const event of readActiveEvidence(events).filter(event => event.t <= nowMs).sort((a, b) => a.t - b.t)) {
    const address = eventAddress(event);
    if (!address || !event.attemptId || (event.kind !== 'rating' && event.kind !== 'review')
      || (event.quality === undefined && event.rating === undefined) || !eventIsMeasurable(event)) continue;
    const identity = `${address}:${event.attemptId}`;
    if (dedup.has(identity)) continue;
    dedup.add(identity);
    const family = familyOf(event);
    const latency = event.activeLatencyMs;
    if (!event.stalled && !event.interrupted && !event.interruptionCount && latency !== undefined && Number.isFinite(latency) && latency > 0) {
      const timingIdentity = `timing:${event.attemptId}`;
      if (!dedup.has(timingIdentity)) {
        dedup.add(timingIdentity);
        const effort = model.efforts[family] ?? { logSum: 0, logSquareSum: 0, n: 0 };
        const log = Math.log(latency / 1000); effort.logSum += log; effort.logSquareSum += log * log; effort.n++;
        model.efforts[family] = effort;
      }
    }
    // Self-assessment affects ordinary canonical claims; it cannot fit recall or instructional benefit here.
    if (!isLearningModelRecallEvidence(event)) continue;
    const memory = model.memories[address];
    const item = event.itemRef ? `${event.itemRef.id}:${event.itemRef.version}` : undefined;
    const delayed = memory !== undefined && event.t - memory.lastAt >= DAY && memory.lastTask === family
      && !(item && item === memory.lastItem);
    // Revealed-answer repetitions provide neither independent evidence nor fitted learning effect.
    if (memory && event.t - memory.lastAt < DAY) continue;
    const particles = memory?.particles ?? initialParticles(event.t);
    const success = successOf(event);
    const predicted = particles.reduce((sum, particle) => sum + particle.weight * recall(particle, event.t), 0);
    if (delayed) {
      const reportedProbability = reportingError + (1 - 2 * reportingError) * predicted;
      squaredError += (reportedProbability - Number(success)) ** 2;
      lastSquaredError += (Number(lastOutcome.get(address) ?? false) - Number(success)) ** 2;
      model.validation.delayedPredictions++;
      // Marginal likelihood of delayed outcomes, conditional on observed task, not policy reward.
      const likelihood = KERNELS.map((_, kernel) => {
        const subset = particles.filter(particle => particle.kernel === kernel);
        const mass = subset.reduce((sum, particle) => sum + particle.weight, 0);
        return mass > 0 ? subset.reduce((sum, particle) => {
          const p = reportingError + (1 - 2 * reportingError) * recall(particle, event.t);
          return sum + particle.weight * (success ? p : 1 - p);
        }, 0) / mass : 1;
      });
      model.kernelWeights[family] = normalize((model.kernelWeights[family] ?? uniform()).map((weight, index) => weight * likelihood[index]));
    }
    // Conditioning revises belief; only the transition kernel forecasts added learner capability.
    const weights = normalize(particles.map(particle => {
      const p = reportingError + (1 - 2 * reportingError) * recall(particle, event.t);
      return particle.weight * (success ? p : 1 - p);
    }));
    const next = particles.map((particle, index) => {
      const p = recall(particle, event.t);
      const conditioned = success ? (p * (1 - reportingError)) / (reportingError + (1 - 2 * reportingError) * p)
        : (p * reportingError) / (1 - reportingError - (1 - 2 * reportingError) * p);
      const measured = { ...particle, possession: conditioned, at: event.t, weight: weights[index] };
      return transition(measured, event.t, success, 1);
    });
    model.memories[address] = { particles: next, observations: (memory?.observations ?? 0) + 1, lastAt: event.t, lastTask: family, ...(item ? { lastItem: item } : {}) };
    model.observations++; lastOutcome.set(address, success);
  }
  const n = model.validation.delayedPredictions;
  if (n) { model.validation.brier = squaredError / n; model.validation.constantHalfBrier = 0.25; model.validation.lastOutcomeBrier = lastSquaredError / n; }
  return model;
}

export function predictRecall(model: LearningModel, address: string, at: number) {
  const memory = model.memories[address];
  const particles = memory?.particles ?? initialParticles(model.at);
  return summarizePerformance(particles, at, memory?.observations ?? 0);
}

function summarizePerformance(particles: Particle[], at: number, observations: number) {
  const values = particles.map(particle => ({ value: recall(particle, at), weight: particle.weight }));
  return { mean: values.reduce((sum, row) => sum + row.value * row.weight, 0),
    interval: [quantile(values, 0.05), quantile(values, 0.95)] as [number, number], observations, priorDriven: observations === 0 };
}

/** Prospective instruction uncertainty cannot reinterpret the learner's existing memory state. */
function instructionParticles(base: Particle[], weights: number[]): Particle[] {
  // The old kernel label is replaced by an independent prospective draw.
  // Identical physical states therefore share one summed probability mass.
  const states = new Map<string, Particle>();
  for (const particle of base) for (let kernel = 0; kernel < weights.length; kernel++) {
    const key = JSON.stringify([particle.halfLifeDays, particle.possession, particle.at, kernel]);
    const weight = particle.weight * weights[kernel];
    const previous = states.get(key);
    if (previous) previous.weight += weight;
    else states.set(key, { ...particle, kernel, weight });
  }
  return [...states.values()];
}

function forecastIntervention(particles: Particle[], interventions: readonly number[], at: number, transfer: number, observations: number) {
  const next = interventions.flatMap(intervention => particles.flatMap(original => {
    const particle = { ...original, weight: original.weight / interventions.length };
    if (intervention > at) return [particle];
    const success = recall(particle, intervention);
    return [{ ...transition(particle, intervention, true, transfer), weight: particle.weight * success },
      { ...transition(particle, intervention, false, transfer), weight: particle.weight * (1 - success) }];
  }));
  return summarizePerformance(next, at, observations);
}

/** Physical teaching marginalized over latent recall, without a hypothetical report or posterior information.
 * A forecast-only state: never store it as canonical learner evidence. */
export function projectLearningIntervention(model: LearningModel, action: LearningAction, at: number, particleLimit = 128): LearningModel {
  if (action.mode === 'diagnostic' || (action.mode === 'immersion' && !action.transfer)
    || !Number.isFinite(at) || at < model.at) return model;
  const transfer = action.mode === 'immersion' ? action.transfer!.probability : 1;
  if (!(transfer > 0)) return model;
  const memories = { ...model.memories };
  let changed = false;
  for (const address of new Set(action.targets.map(learningAddress))) {
    const memory = model.memories[address];
    if (memory && memory.lastTask === action.family && at - memory.lastAt < DAY) continue;
    const base = instructionParticles(memory?.particles ?? initialParticles(model.at), model.kernelWeights[action.family] ?? uniform());
    const expanded = base.flatMap(particle => {
      const success = recall(particle, at);
      return [{ ...transition(particle, at, true, transfer), weight: particle.weight * success },
        { ...transition(particle, at, false, transfer), weight: particle.weight * (1 - success) }];
    });
    // Deterministic stratified quadrature bounds exponential branch growth.
    // Sorting preserves the state spread; this is numerical approximation, not new evidence.
    const limit = Math.max(27, Math.min(512, Number.isFinite(particleLimit) ? Math.floor(particleLimit) : 128));
    let particles = expanded;
    if (expanded.length > limit) {
      const sorted = [...expanded].sort((a, b) => a.halfLifeDays - b.halfLifeDays || a.possession - b.possession || a.kernel - b.kernel);
      let index = 0; let cumulative = sorted[0].weight;
      particles = Array.from({ length: limit }, (_, sample) => {
        const midpoint = (sample + 0.5) / limit;
        while (index < sorted.length - 1 && cumulative < midpoint) cumulative += sorted[++index].weight;
        return { ...sorted[index], weight: 1 / limit };
      });
    }
    memories[address] = { particles, observations: memory?.observations ?? 0, lastAt: at, lastTask: action.family,
      ...(memory?.lastItem ? { lastItem: memory.lastItem } : {}) };
    changed = true;
  }
  return changed ? { ...model, memories } : model;
}

/** Hypothetical response for decision analysis only. Never appends evidence or changes the supplied model. */
export function conditionProspectiveObservation(model: LearningModel, action: LearningAction, at: number, success: boolean, reportingError: number): LearningModel {
  const address = action.measurement!.address;
  const memory = model.memories[address];
  const base = memory?.particles ?? initialParticles(model.at);
  const likelihoods = base.map(particle => {
    const probability = reportingError + (1 - 2 * reportingError) * recall(particle, at);
    return particle.weight * (success ? probability : 1 - probability);
  });
  const weights = normalize(likelihoods);
  const conditioned = base.map((particle, index) => {
    const p = recall(particle, at);
    const denominator = success ? reportingError + (1 - 2 * reportingError) * p : 1 - reportingError - (1 - 2 * reportingError) * p;
    const possession = denominator > 0 ? (success ? p * (1 - reportingError) : p * reportingError) / denominator : p;
    return { ...particle, possession, at, weight: weights[index] };
  });
  const particles = action.mode === 'diagnostic' ? conditioned
    : instructionParticles(conditioned, model.kernelWeights[action.family] ?? uniform()).map(particle => transition(particle, at, success, 1));
  const memories = { ...model.memories, [address]: { particles, observations: memory?.observations ?? 0,
    lastAt: at, lastTask: action.family, ...(memory?.lastItem ? { lastItem: memory.lastItem } : {}) } };
  // Both response branches include the same teaching of the remaining encounter accesses.
  // Only the declared measured access gains information; no synthetic multi-attribute answers.
  if (action.mode === 'practice') for (const otherAddress of new Set(action.targets.map(learningAddress))) {
    if (otherAddress === address) continue;
    const other = model.memories[otherAddress];
    const otherBase = instructionParticles(other?.particles ?? initialParticles(model.at), model.kernelWeights[action.family] ?? uniform());
    const projected = otherBase.flatMap(particle => {
      const p = recall(particle, at);
      return [{ ...transition(particle, at, true, 1), weight: particle.weight * p },
        { ...transition(particle, at, false, 1), weight: particle.weight * (1 - p) }];
    });
    memories[otherAddress] = { particles: projected, observations: other?.observations ?? 0, lastAt: at, lastTask: action.family,
      ...(other?.lastItem ? { lastItem: other.lastItem } : {}) };
  }
  return { ...model, at, memories };
}

export function predictLearningEffort(model: LearningModel, action: LearningAction): ActionValue['effort'] {
  const observed = model.efforts[action.family];
  const n = observed?.n ?? 0; const priorN = 2; const priorMean = Math.log(action.durationSeconds ?? 30); const priorVariance = Math.log(3) ** 2;
  const mean = ((observed?.logSum ?? 0) + priorN * priorMean) / (n + priorN);
  const variance = Math.max(0.01, ((observed?.logSquareSum ?? 0) + priorN * (priorMean ** 2 + priorVariance)) / (n + priorN) - mean ** 2);
  return { meanSeconds: Math.exp(mean + variance / 2), interval: [Math.exp(mean - 1.645 * Math.sqrt(variance)), Math.exp(mean + 1.645 * Math.sqrt(variance))],
    samples: n, source: n ? 'task-conditioned-active-timing-with-prior' : 'unfitted-task-effort-prior' };
}
function effortDraws(effort: ActionValue['effort']) {
  const [lower, upper] = effort.interval;
  const logMedian = (Math.log(lower) + Math.log(upper)) / 2;
  const logSD = (Math.log(upper) - Math.log(lower)) / (2 * 1.645);
  return [-1.2815516, -0.5244005, 0, 0.5244005, 1.2815516].map(z => Math.exp(logMedian + z * logSD));
}
function integratedCapability(possession: number, halfLifeDays: number, anchor: number, start: number, horizon: number): number {
  if (horizon <= 0) return 0;
  const beginning = Math.max(0, start - anchor) / DAY;
  const rate = Math.LN2 / halfLifeDays;
  return possession * Math.exp(-rate * beginning) * -Math.expm1(-rate * horizon) / rate;
}
function capabilityDays(particle: Particle, start: number, horizon: number): number {
  return integratedCapability(particle.possession, particle.halfLifeDays, particle.at, start, horizon);
}
function outcomeTrajectory(particle: Particle, intervention: number, start: number, horizon: number, transfer = 1): number {
  const success = recall(particle, intervention);
  const kernel = KERNELS[particle.kernel];
  const possession = success + (1 - success) * kernel.acquisition * transfer;
  const upgradedHalfLife = Math.min(3650, particle.halfLifeDays * (1 + (kernel.growth - 1) * transfer));
  const refreshedHalfLife = Math.max(particle.halfLifeDays, kernel.refresh * transfer);
  const beforeDays = Math.max(0, Math.min(horizon, (intervention - start) / DAY));
  const afterStart = start + beforeDays * DAY;
  return capabilityDays(particle, start, beforeDays)
    + success * integratedCapability(possession, upgradedHalfLife, intervention, afterStart, horizon - beforeDays)
    + (1 - success) * integratedCapability(possession, refreshedHalfLife, intervention, afterStart, horizon - beforeDays);
}

export function evaluateLearningAction(model: LearningModel, action: LearningAction, context: EvaluationContext,
  trace: { performanceLimit?: number } = {}): ActionValue {
  const addresses = [...new Set(action.targets.map(learningAddress))];
  const horizon = Math.max(0, context.horizonDays);
  const values: Array<{ value: number; weight: number }> = [];
  let mean = 0; let lower = 0; let upper = 0; let priorDriven = false;
  const performance: ActionPerformanceForecast[] = [];
  const performanceLimit = Math.max(0, Math.min(16, trace.performanceLimit ?? 16));
  const effort = predictLearningEffort(model, action);
  const durations = context.completionSeconds !== undefined && Number.isFinite(context.completionSeconds) && context.completionSeconds >= 0
    ? [context.completionSeconds] : effortDraws(effort);
  const completionSamples = durations.map(seconds => ({ seconds, expectedCapabilityDays: 0 }));
  const completionTimes = durations.map(seconds => context.nowMs + seconds * 1000);
  for (const address of addresses) {
    const memory = model.memories[address];
    priorDriven ||= !memory || !model.kernelWeights[action.family];
    const base = memory?.particles ?? initialParticles(model.at);
    const familyWeights = model.kernelWeights[action.family] ?? uniform();
    const particles = instructionParticles(base, familyWeights);
    values.length = 0;
    const nominalTransfer = action.mode === 'immersion' ? action.transfer?.probability ?? 0 : 1;
    const transfers = [...new Set([nominalTransfer, ...(action.mode === 'immersion' ? action.transfer?.sensitivity ?? [] : [])])];
    const recentSameTask = memory && memory.lastTask === action.family && context.nowMs - memory.lastAt < DAY;
    if (performance.length < performanceLimit) {
      const at = Math.max(context.nowMs, context.assessmentAt ?? context.nowMs + horizon * DAY);
      const noExtraStudy = predictRecall(model, address, at);
      const canIntervene = action.mode !== 'diagnostic' && (action.mode !== 'immersion' || action.transfer);
      const deferredTimes = completionTimes.map(at => at + Math.max(0, context.deferDays) * DAY);
      performance.push({ address, at, current: predictRecall(model, address, context.nowMs), noExtraStudy,
        oneActionNow: canIntervene && !recentSameTask && completionTimes.some(completion => completion <= at)
          ? forecastIntervention(particles, completionTimes, at, nominalTransfer, memory?.observations ?? 0) : noExtraStudy,
        oneActionDeferred: canIntervene && context.deferDays > 0 && deferredTimes.some(completion => completion <= at)
          ? forecastIntervention(particles, deferredTimes, at, nominalTransfer, memory?.observations ?? 0) : noExtraStudy,
        condition: 'one-action-only; not a future-study guarantee' });
    }
    let nominalMean = 0;
    for (const particle of particles) {
      for (const transfer of transfers) {
        for (let index = 0; index < completionTimes.length; index++) {
          const completion = completionTimes[index];
          let benefit = 0;
          if (action.mode !== 'diagnostic' && (action.mode !== 'immersion' || action.transfer)) {
            const nowValue = recentSameTask ? capabilityDays(particle, context.nowMs, horizon)
              : outcomeTrajectory(particle, completion, context.nowMs, horizon, transfer);
            const alternative = context.deferDays > 0
              ? outcomeTrajectory(particle, completion + context.deferDays * DAY, context.nowMs, horizon, transfer)
              : capabilityDays(particle, context.nowMs, horizon);
            benefit = nowValue - alternative;
          }
          const weight = context.targetWeights ? context.targetWeights[address]
            ?? context.targetWeights[JSON.stringify([JSON.parse(address)[0], '*'])] ?? 0 : 1;
          values.push({ value: benefit * weight, weight: particle.weight / (transfers.length * completionTimes.length) });
          if (transfer === nominalTransfer) {
            const nominal = benefit * weight * particle.weight;
            nominalMean += nominal / completionTimes.length;
            completionSamples[index].expectedCapabilityDays += nominal;
          }
        }
      }
    }
    mean += nominalMean;
    lower += quantile(values, 0.05); upper += quantile(values, 0.95);
  }
  return { key: action.key, addresses, family: action.family, expectedCapabilityDays: mean, interval: [lower, upper],
    effort, completionSamples, horizonDays: horizon, counterfactual: context.deferDays > 0 ? 'defer-to-next-opportunity' : 'no-extra-work',
    informationOnly: action.mode === 'diagnostic', priorDriven, modelVersion: model.version, evidenceVersion: model.evidenceVersion,
    performance, performanceOmitted: Math.max(0, addresses.length - performance.length),
    ...(action.transfer ? { transferProvenance: action.transfer.provenance } : {}) };
}

/** Same nominal physical integral as evaluateLearningAction, prepared once for
 * repeated completion-time comparisons. No trace quantiles or performance rows. */
export function prepareLearningActionCompletionValue(model: LearningModel, action: LearningAction, context: EvaluationContext) {
  if (action.mode === 'diagnostic' || (action.mode === 'immersion' && !action.transfer)) return (_seconds: number) => 0;
  const horizon = Math.max(0, context.horizonDays);
  const transfer = action.mode === 'immersion' ? action.transfer!.probability : 1;
  const prepared = [...new Set(action.targets.map(learningAddress))].map(address => {
    const memory = model.memories[address];
    const weight = context.targetWeights ? context.targetWeights[address]
      ?? context.targetWeights[JSON.stringify([JSON.parse(address)[0], '*'])] ?? 0 : 1;
    return { weight, recent: !!memory && memory.lastTask === action.family && context.nowMs - memory.lastAt < DAY,
      particles: instructionParticles(memory?.particles ?? initialParticles(model.at), model.kernelWeights[action.family] ?? uniform()) };
  });
  return (seconds: number) => {
    const completion = context.nowMs + seconds * 1000;
    let mean = 0;
    for (const row of prepared) {
      let targetMean = 0;
      for (const particle of row.particles) {
        const nowValue = row.recent ? capabilityDays(particle, context.nowMs, horizon)
          : outcomeTrajectory(particle, completion, context.nowMs, horizon, transfer);
        const alternative = context.deferDays > 0
          ? outcomeTrajectory(particle, completion + context.deferDays * DAY, context.nowMs, horizon, transfer)
          : capabilityDays(particle, context.nowMs, horizon);
        targetMean += (nowValue - alternative) * row.weight * particle.weight;
      }
      mean += targetMean;
    }
    return mean;
  };
}

/** Exhaustive short-sequence comparison. Compare total feasible value; never sort by gain/second. */
export function chooseLearningSequence(values: readonly ActionValue[], opportunity: { availableSeconds: readonly number[]; continuationValue: number; canCombine?: (left: ActionValue, right: ActionValue) => boolean;
  /** Physical value of the second action after the first has consumed active time. */
  delayedValue?: (value: ActionValue, delaySeconds: number, ownSeconds: number) => number | undefined;
  /** Exact physical equivalence within this immutable comparison, for pair-value reuse. */
  delayedIdentity?: (value: ActionValue) => string | undefined }) {
  const maximumAvailable = Math.max(0, ...opportunity.availableSeconds);
  const utility = (value: ActionValue) => value.expectedCapabilityDays + (value.information?.expectedDecisionBenefit ?? 0);
  const candidates = values.filter(value => value.completionSamples
    ? value.completionSamples.some(draw => draw.expectedCapabilityDays + (value.information?.expectedDecisionBenefit ?? 0) > 0)
    : utility(value) > 0).slice(0, 32);
  let best = { keys: [] as string[], value: opportunity.continuationValue };
  const effortSamples = new Map(candidates.map(row => [row.key, row.completionSamples
    ?? effortDraws(row.effort).map(seconds => ({ seconds, expectedCapabilityDays: row.expectedCapabilityDays }))]));
  const drawIdentities = new Map(candidates.map(row => [row.key, JSON.stringify(effortSamples.get(row.key))]));
  const pairValues = new Map<string, number>();
  const assess = (rows: ActionValue[]) => {
    if (rows.length === 2 && opportunity.canCombine && !opportunity.canCombine(rows[0], rows[1])) return;
    if (new Set(rows.flatMap(row => row.addresses)).size !== rows.reduce((sum, row) => sum + row.addresses.length, 0)) return;
    // Eligibility/overlap is checked before reuse. Equivalent first draw
    // distributions and second physical functions have the same pair utility.
    const information = Math.max(...rows.map(row => row.information?.expectedDecisionBenefit ?? 0));
    const secondIdentity = rows.length === 2 ? opportunity.delayedIdentity?.(rows[1]) : undefined;
    const cacheKey = secondIdentity === undefined ? undefined
      : JSON.stringify([drawIdentities.get(rows[0].key), secondIdentity, drawIdentities.get(rows[1].key), information]);
    let value = cacheKey === undefined ? undefined : pairValues.get(cacheKey);
    if (value === undefined) {
      const first = effortSamples.get(rows[0].key)!;
      const draws = rows.length === 1 ? first : first.flatMap(draw => effortSamples.get(rows[1].key)!.map(other => {
        const seconds = draw.seconds + other.seconds;
        // Keep the probability mass of infeasible draws, but do not spend a
        // physical calculation on a pair that fits no sampled opportunity.
        if (seconds > maximumAvailable) return { seconds, expectedCapabilityDays: 0 };
        const second = opportunity.delayedValue ? opportunity.delayedValue(rows[1], draw.seconds, other.seconds) : other.expectedCapabilityDays;
        return { seconds, expectedCapabilityDays: second === undefined ? -Infinity : draw.expectedCapabilityDays + second };
      }));
      // Independent information credits cannot be added as if two signals were independent.
      // Count at most the larger single-observation benefit within this bounded sequence.
      value = draws.reduce((sum, draw) => sum + (draw.expectedCapabilityDays + information)
        * opportunity.availableSeconds.filter(seconds => draw.seconds <= seconds).length, 0)
        / Math.max(1, draws.length * opportunity.availableSeconds.length);
      if (cacheKey !== undefined && Number.isFinite(value)) pairValues.set(cacheKey, value);
    }
    const roundoff = Number.EPSILON * Math.max(Math.abs(value), Math.abs(best.value), Number.MIN_VALUE) * 8;
    if (Number.isFinite(value) && value - best.value > roundoff) best = { keys: (opportunity.delayedValue ? rows
      : [...rows].sort((a, b) => utility(b) - utility(a))).map(row => row.key), value };
  };
  for (let i = 0; i < candidates.length; i++) {
    assess([candidates[i]]);
    for (let j = i + 1; j < candidates.length; j++) {
      assess([candidates[i], candidates[j]]);
      if (opportunity.delayedValue) assess([candidates[j], candidates[i]]);
    }
  }
  return { ...best, alternative: 'continue-immersion' as const, candidateCount: values.length, candidatesOmitted: Math.max(0, values.length - 32) };
}
