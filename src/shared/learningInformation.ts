import { conditionProspectiveObservation, chooseLearningSequence, evaluateLearningAction, learningAddress, predictRecall, prepareLearningActionCompletionValue,
  type ActionValue, type EvaluationContext, type LearningAction, type LearningModel } from './learningModel';

const DAY = 86_400_000;
const INFORMATION_ACTION_CAP = 8;
const FUTURE_ALTERNATIVE_CAP = 8;

/** Within one immutable decision, wholly unobserved targets with identical task,
 * transfer, effort and outcome weights have the same prior calculation. Remap
 * addresses rather than recomputing it; never cache fitted memories or journal state. */
export function evaluatePhysicalLearningActions(model: LearningModel, actions: readonly LearningAction[], context: EvaluationContext,
  options: { performanceLimit?: number; completionSeconds?: (action: LearningAction) => number; maxCalculations?: number } = {}) {
  const prepared = actions.map(action => {
    const addresses = [...new Set(action.targets.map(learningAddress))];
    const completionSeconds = options.completionSeconds?.(action) ?? context.completionSeconds;
    const weights = addresses.map(address => context.targetWeights ? context.targetWeights[address]
      ?? context.targetWeights[JSON.stringify([JSON.parse(address)[0], '*'])] ?? 0 : 1);
    // A fitted/projected memory is never interchangeable with another target.
    const signature = addresses.some(address => model.memories[address]) ? undefined
      : JSON.stringify([action.family, action.mode, action.durationSeconds, action.transfer, weights, completionSeconds]);
    return { action, addresses, signature, context: { ...context, completionSeconds } };
  });
  const requiredCalculations = prepared.filter(row => row.signature === undefined).length
    + new Set(prepared.flatMap(row => row.signature === undefined ? [] : [row.signature])).size;
  // Refuse an incomplete comparison before computing any part of this pool.
  if (requiredCalculations > (options.maxCalculations ?? Infinity))
    return { values: [] as ActionValue[], calculations: 0, requiredCalculations, complete: false };
  const priorValues = new Map<string, ActionValue>();
  let calculations = 0;
  const values = prepared.map(({ action, addresses, signature, context: actionContext }) => {
    const cached = signature === undefined ? undefined : priorValues.get(signature);
    if (cached) return { ...cached, key: action.key, addresses,
      completionSamples: cached.completionSamples?.map(draw => ({ ...draw })),
      performance: cached.performance.map((row, index) => ({ ...row, address: addresses[index] })) };
    const value = evaluateLearningAction(model, action, actionContext, { performanceLimit: options.performanceLimit ?? 16 });
    calculations++;
    if (signature !== undefined) priorValues.set(signature, value);
    return value;
  });
  return { values, calculations, requiredCalculations, complete: true };
}

/** Immutable short-sequence calculation: disjoint targets let the second action
 * use the original model, but its completion includes the first action's effort.
 * The evaluation start/end and deferred alternative stay fixed for the sequence. */
export function learningSequenceDelay(model: LearningModel, actions: readonly LearningAction[], context: EvaluationContext,
  maxCalculations = Infinity) {
  const byKey = new Map(actions.map(action => [action.key, action]));
  const signatures = new Map(actions.map(action => {
    const addresses = [...new Set(action.targets.map(learningAddress))];
    const weights = addresses.map(address => context.targetWeights ? context.targetWeights[address]
      ?? context.targetWeights[JSON.stringify([JSON.parse(address)[0], '*'])] ?? 0 : 1);
    return [action.key, addresses.some(address => model.memories[address]) ? action.key
      : JSON.stringify([action.family, action.mode, action.transfer, weights])];
  }));
  const cache = new Map<string, Map<number, number>>();
  const prepared = new Map<string, ReturnType<typeof prepareLearningActionCompletionValue>>();
  let calculations = 0;
  let complete = true;
  const delayedValue = (value: ActionValue, delaySeconds: number, ownSeconds: number): number | undefined => {
    const action = byKey.get(value.key);
    if (!action) { complete = false; return undefined; }
    const completionSeconds = delaySeconds + ownSeconds;
    const signature = signatures.get(value.key)!;
    let durations = cache.get(signature);
    if (durations?.has(completionSeconds)) return durations.get(completionSeconds)!;
    if (calculations >= maxCalculations) { complete = false; return undefined; }
    let calculation = prepared.get(signature);
    if (!calculation) {
      calculation = prepareLearningActionCompletionValue(model, action, context);
      prepared.set(signature, calculation);
    }
    const result = calculation(completionSeconds);
    if (!durations) { durations = new Map(); cache.set(signature, durations); }
    durations.set(completionSeconds, result);
    calculations++;
    return result;
  };
  return {
    get calculations() { return calculations; },
    get complete() { return complete; },
    delayedValue,
    delayedIdentity: (value: ActionValue) => signatures.get(value.key),
    // A selected trace needs its full bounds. Its completion case was already
    // counted by the sequence comparison; deriving bounds adds no new scenario.
    valueAtCompletion: (value: ActionValue, delaySeconds: number, ownSeconds: number): ActionValue | undefined =>
      delayedValue(value, delaySeconds, ownSeconds) === undefined ? undefined
        : evaluateLearningAction(model, byKey.get(value.key)!, { ...context, completionSeconds: delaySeconds + ownSeconds }, { performanceLimit: 0 }),
  };
}

function evaluatePhysicalActions(model: LearningModel, actions: readonly LearningAction[], context: EvaluationContext,
  performanceLimit = 16): ActionValue[] {
  return evaluatePhysicalLearningActions(model, actions, context, { performanceLimit }).values;
}

/** Expected value of adapting a later action to one legitimate response.
 * E[max future utility | response] - max E[future utility | response].
 * The reference has the same physical intervention; belief revision is never counted as teaching.
 * Bounds keep this on the live selection path, not a journal scan or a recursive planner.
 */
export function evaluateLearningActions(model: LearningModel, actions: readonly LearningAction[], context: EvaluationContext,
  opportunity: Parameters<typeof chooseLearningSequence>[1]): ActionValue[] {
  const values = evaluatePhysicalActions(model, actions, context);
  const futureAt = context.nowMs + context.deferDays * DAY;
  const futureHorizon = context.horizonDays - context.deferDays;
  if (context.deferDays <= 0 || futureHorizon <= 0) return values;
  const futurePool = actions.filter(action => action.mode !== 'diagnostic');
  let analysed = 0;
  for (let i = 0; i < actions.length && analysed < INFORMATION_ACTION_CAP; i++) {
    const action = actions[i];
    const measurement = action.measurement;
    if (action.mode === 'immersion' || !measurement || !measurement.provenance || !action.targets.some(target => learningAddress(target) === measurement.address)) continue;
    const memory = model.memories[measurement.address];
    if (memory && memory.lastTask === action.family && context.nowMs - memory.lastAt < DAY) continue;
    const reportingError = measurement.reportingError ?? 0.1;
    if (!Number.isFinite(reportingError) || reportingError < 0 || reportingError > 0.5) continue;
    analysed++;
    const relevant = futurePool.find(alternative => alternative.targets.some(target => learningAddress(target) === measurement.address));
    const futureActions = [...(relevant ? [relevant] : []), ...futurePool.filter(alternative => alternative !== relevant)].slice(0, FUTURE_ALTERNATIVE_CAP);
    const latent = predictRecall(model, measurement.address, context.nowMs);
    const recallProbability = reportingError + (1 - 2 * reportingError) * latent.mean;
    const branches = [true, false].map(success => {
      const conditioned = conditionProspectiveObservation(model, action, context.nowMs, success, reportingError);
      const evaluations = evaluatePhysicalActions(conditioned, futureActions,
        { ...context, nowMs: futureAt, horizonDays: futureHorizon }, 0);
      const delay = learningSequenceDelay(conditioned, futureActions, { ...context, nowMs: futureAt, horizonDays: futureHorizon });
      const selected = chooseLearningSequence(evaluations, { ...opportunity, continuationValue: 0, delayedValue: delay.delayedValue, delayedIdentity: delay.delayedIdentity });
      return { report: success ? 'recalled' as const : 'missed' as const, probability: success ? recallProbability : 1 - recallProbability,
        selected: selected.keys, futureValue: selected.value, evaluations, delay };
    });
    // Same intervention and outcome distribution, but the future decision cannot observe which branch occurred.
    const marginalized = futureActions.map((_, index) => ({ ...branches[0].evaluations[index],
      expectedCapabilityDays: branches.reduce((sum, branch) => sum + branch.probability * branch.evaluations[index].expectedCapabilityDays, 0),
      completionSamples: branches[0].evaluations[index].completionSamples?.map((draw, sample) => ({ ...draw,
        expectedCapabilityDays: branches.reduce((sum, branch) => sum + branch.probability
          * branch.evaluations[index].completionSamples![sample].expectedCapabilityDays, 0),
      })) }));
    const withoutObservation = chooseLearningSequence(marginalized, { ...opportunity, continuationValue: 0,
      delayedIdentity: value => JSON.stringify(branches.map(branch => branch.delay.delayedIdentity(value))),
      delayedValue: (value, elapsed, own) => branches.reduce((sum, branch) => sum
        + branch.probability * branch.delay.delayedValue(value, elapsed, own)!, 0) });
    const adaptive = branches.reduce((sum, branch) => sum + branch.probability * branch.futureValue, 0);
    const difference = adaptive - withoutObservation.value;
    const roundoff = Number.EPSILON * Math.max(1, Math.abs(adaptive), Math.abs(withoutObservation.value)) * 8;
    values[i].information = { expectedDecisionBenefit: difference > roundoff ? difference : 0, at: futureAt,
      address: measurement.address, reportingError, provenance: measurement.provenance,
      branches: branches.map(({ evaluations: _evaluations, delay: _delay, ...branch }) => branch),
      withoutObservationValue: withoutObservation.value, alternativesOmitted: Math.max(0, futurePool.length - futureActions.length) };
  }
  return values;
}
