import { chooseLearningSequence, evaluateLearningAction, learningActionsCanCombine, learningAddress, predictRecall, predictLearningEffort, projectLearningIntervention,
  type EvaluationContext, type LearningAction, type LearningModel } from './learningModel';
import { evaluatePhysicalLearningActions, learningSequenceDelay } from './learningInformation';
import type { LearningOpportunities } from './learningOpportunities';

const DAY = 86_400_000;
const MAX_OPPORTUNITIES = 128;
const MAX_EVALUATIONS_PER_SCENARIO = 3072;
const ordered = (values: readonly number[]) => values.filter(value => Number.isFinite(value) && value > 0).sort((a, b) => a - b);

export function preparationTaskPool(offered: readonly LearningAction[], first: LearningAction, scopeTasks: readonly LearningAction[] = []) {
  const tasks = new Map<string, LearningAction>();
  for (const task of [offered.find(task => task.key === first.key) ?? first, ...offered, ...scopeTasks])
    if (!tasks.has(task.key)) tasks.set(task.key, task);
  return [...tasks.values()];
}

/** Uniform summary of model accesses, not a score or joint readiness probability. */
function scopeCapability(model: LearningModel, addresses: readonly string[], at: number) {
  let total = 0; let lower = 0; let upper = 0; let minimum = 1; let minimumLower = 1; let unobservedTargets = 0;
  let untouchedPrior: ReturnType<typeof predictRecall> | undefined;
  for (const address of addresses) {
    const prediction = model.memories[address] ? predictRecall(model, address, at)
      : untouchedPrior ?? (untouchedPrior = predictRecall(model, address, at));
    total += prediction.mean; lower += prediction.interval[0]; upper += prediction.interval[1];
    minimum = Math.min(minimum, prediction.mean); minimumLower = Math.min(minimumLower, prediction.interval[0]);
    if (!prediction.observations) unobservedTargets++;
  }
  const count = addresses.length;
  return { at, targets: count, unobservedTargets,
    meanModelRecall: count ? total / count : null,
    meanMarginalBounds: count ? [lower / count, upper / count] as [number, number] : null,
    minimumModelRecall: count ? minimum : null, minimumMarginalLowerBound: count ? minimumLower : null };
}

/** Conditional continuation of runnable offered and scope tasks under the existing physical/action model.
 * Held work resumes before new choices; effects require completion. No hypothetical learner observations. */
export function forecastLearningPreparation(model: LearningModel, offered: readonly LearningAction[], first: LearningAction,
  context: EvaluationContext, opportunities: LearningOpportunities, scopeTasks: readonly LearningAction[] = []) {
  const deadline = context.assessmentAt;
  if (!deadline || !Number.isFinite(deadline) || deadline <= context.nowMs) return undefined;
  const evaluationEndsAt = context.nowMs + Math.max(0, context.horizonDays) * DAY;
  if (!Number.isFinite(evaluationEndsAt)) return undefined;
  // Preserve the actual first handoff and offered alternatives, then admit scope tasks.
  // Stable task keys identify executable tasks, not separate copies of overlapping outcomes.
  const declared = preparationTaskPool(offered, first, scopeTasks);
  const actions = declared;
  const actionsByKey = new Map(actions.map(action => [action.key, action]));
  const scopeKeys = new Set(scopeTasks.map(action => action.key));
  const admittedScopeCount = actions.filter(action => scopeKeys.has(action.key)).length;
  const targets = [...new Map(actions.flatMap(action => action.targets.map(target => [learningAddress(target), target] as const))).values()].slice(0, 64);
  const addresses = targets.map(learningAddress);
  const scopeAddresses = [...new Set((scopeTasks.length ? scopeTasks : declared).flatMap(action => action.targets.map(learningAddress)))];
  const gaps = ordered(opportunities.gapDays); const durations = ordered(opportunities.availableSeconds);
  if (!gaps.length || !durations.length) return undefined;
  const heldAction = declared[0];
  const firstEffort = predictLearningEffort(model, heldAction);
  const scenarios = [
    { name: 'less-opportunity-slower-work', gap: gaps.at(-1)!, seconds: durations[0], effort: 1 as const },
    { name: 'middle-pattern', gap: gaps[Math.floor(gaps.length / 2)], seconds: durations[Math.floor(durations.length / 2)], effort: 0 as const },
    { name: 'more-opportunity-faster-work', gap: gaps[0], seconds: durations.at(-1)!, effort: -1 as const },
  ].map(scenario => {
    let projected = model;
    const scenarioSeconds = (effort: typeof firstEffort) => scenario.effort < 0 ? effort.interval[0]
      : scenario.effort > 0 ? effort.interval[1] : Math.sqrt(effort.interval[0] * effort.interval[1]);
    const estimatedActiveSeconds = scenarioSeconds(firstEffort);
    let remaining = estimatedActiveSeconds;
    let firstActiveSeconds = 0;
    let firstCompletedAt: number | undefined;
    const workOnHeldAction = (at: number, available: number) => {
      const used = Math.min(remaining, available);
      remaining = Math.max(0, remaining - used);
      firstActiveSeconds += used;
      if (firstCompletedAt === undefined && remaining === 0) {
        firstCompletedAt = at + used * 1000;
        projected = projectLearningIntervention(projected, heldAction, firstCompletedAt);
      }
      return used;
    };
    workOnHeldAction(context.nowMs, Math.min(scenario.seconds, (deadline - context.nowMs) / 1000));
    let activeSeconds = 0;
    let actionEvaluations = 0;
    let numericalCalculations = 0;
    let stoppedForNumericalBudget = false;
    const steps: { at: number; opportunityAt: number; heldActionSeconds: number; keys: string[]; activeSeconds: number; horizonDays: number;
      choices: Array<Pick<ReturnType<typeof evaluateLearningAction>, 'key' | 'expectedCapabilityDays' | 'interval' | 'counterfactual' | 'priorDriven'> & { completedAt: number }> }[] = [];
    let at = context.nowMs + scenario.gap * DAY;
    while (at < deadline && steps.length < MAX_OPPORTUNITIES) {
      const capacity = Math.min(scenario.seconds, (deadline - at) / 1000);
      const heldActionSeconds = remaining > 0 ? workOnHeldAction(at, capacity) : 0;
      const choiceAt = at + heldActionSeconds * 1000;
      const decisionAt = choiceAt < deadline ? choiceAt : at;
      const horizonDays = Math.max(0, (evaluationEndsAt - decisionAt) / DAY);
      const availableSeconds = capacity - heldActionSeconds;
      if (remaining > 0 || availableSeconds <= 0) {
        activeSeconds += heldActionSeconds;
        steps.push({ at: decisionAt, opportunityAt: at, heldActionSeconds, keys: [], activeSeconds: heldActionSeconds, horizonDays, choices: [] });
        at += scenario.gap * DAY;
        continue;
      }
      const efforts = new Map(actions.map(action => [action.key, scenarioSeconds(predictLearningEffort(projected, action))]));
      const evaluated = evaluatePhysicalLearningActions(projected, actions, { ...context, nowMs: decisionAt,
        deferDays: scenario.gap, horizonDays }, { performanceLimit: 0,
        completionSeconds: action => efforts.get(action.key)!, maxCalculations: MAX_EVALUATIONS_PER_SCENARIO - numericalCalculations });
      if (!evaluated.complete) {
        stoppedForNumericalBudget = true;
        if (heldActionSeconds > 0) {
          activeSeconds += heldActionSeconds;
          steps.push({ at: decisionAt, opportunityAt: at, heldActionSeconds, keys: [], activeSeconds: heldActionSeconds, horizonDays, choices: [] });
        }
        break;
      }
      numericalCalculations += evaluated.calculations;
      const values = evaluated.values.map(value => {
        const seconds = efforts.get(value.key)!;
        return { ...value, effort: { ...value.effort, meanSeconds: seconds, interval: [seconds, seconds] as [number, number] } };
      });
      actionEvaluations += actions.length;
      const valuesByKey = new Map(values.map(value => [value.key, value]));
      // Finishing already admitted work occupies its physical slot for this
      // opportunity. Alternative cues remain eligible at a later boundary.
      const feasibleValues = values.filter(value => heldActionSeconds <= 0 || learningActionsCanCombine(heldAction, actionsByKey.get(value.key)));
      const immersion = feasibleValues.filter(value => actionsByKey.get(value.key)?.mode === 'immersion');
      const continuation = immersion.sort((a, b) => b.expectedCapabilityDays - a.expectedCapabilityDays)[0];
      // The sequence solver bounds pair search at 32; refresh that window from physical
      // action values each opportunity so later content can replace already practised tasks.
      const delay = learningSequenceDelay(projected, actions, { ...context, nowMs: decisionAt,
        deferDays: scenario.gap, horizonDays }, MAX_EVALUATIONS_PER_SCENARIO - numericalCalculations);
      const sequence = chooseLearningSequence(feasibleValues.filter(value => actionsByKey.get(value.key)?.mode !== 'immersion'
        && value.effort.meanSeconds <= availableSeconds)
        .sort((a, b) => b.expectedCapabilityDays - a.expectedCapabilityDays || a.key.localeCompare(b.key)),
        { availableSeconds: [availableSeconds], continuationValue: continuation?.expectedCapabilityDays ?? 0, delayedValue: delay.delayedValue, delayedIdentity: delay.delayedIdentity,
          canCombine: (left, right) => learningActionsCanCombine(actionsByKey.get(left.key), actionsByKey.get(right.key)) });
      numericalCalculations += delay.calculations;
      if (!delay.complete) {
        stoppedForNumericalBudget = true;
        if (heldActionSeconds > 0) {
          activeSeconds += heldActionSeconds;
          steps.push({ at: decisionAt, opportunityAt: at, heldActionSeconds, keys: [], activeSeconds: heldActionSeconds, horizonDays, choices: [] });
        }
        break;
      }
      const keys = sequence.keys.length ? sequence.keys : continuation && continuation.effort.meanSeconds <= availableSeconds ? [continuation.key] : [];
      let used = 0;
      const choices: (typeof steps)[number]['choices'] = [];
      for (const key of keys) {
        const value = valuesByKey.get(key)!;
        if (used + value.effort.meanSeconds > availableSeconds) continue;
        const elapsed = used;
        used += value.effort.meanSeconds;
        const completedAt = decisionAt + used * 1000;
        const executed = used === value.effort.meanSeconds ? value
          : delay.valueAtCompletion(value, elapsed, value.effort.meanSeconds)!;
        projected = projectLearningIntervention(projected, actionsByKey.get(key)!, completedAt);
        choices.push({ key, expectedCapabilityDays: executed.expectedCapabilityDays, interval: executed.interval,
          counterfactual: executed.counterfactual, priorDriven: executed.priorDriven, completedAt });
      }
      activeSeconds += used + heldActionSeconds;
      steps.push({ at: decisionAt, opportunityAt: at, heldActionSeconds, keys: choices.map(choice => choice.key), activeSeconds: used + heldActionSeconds, horizonDays, choices });
      at += scenario.gap * DAY;
    }
    return { scenario: scenario.name, gapDays: scenario.gap, opportunitySeconds: scenario.seconds,
      firstActionExecution: { startedAt: context.nowMs, estimatedActiveSeconds, activeSecondsBeforeDeadline: firstActiveSeconds,
        completedAt: firstCompletedAt, remainingActiveSeconds: remaining },
      futureActiveSeconds: activeSeconds, steps, futureOpportunitiesOmitted: at < deadline,
      actionEvaluations, numericalCalculations,
      continuationStop: { reason: stoppedForNumericalBudget ? 'numerical-bound' as const
        : at < deadline ? 'opportunity-bound' as const : 'deadline-reached' as const, nextOpportunityAt: at },
      scopeCapability: scopeCapability(projected, scopeAddresses, deadline),
      final: addresses.map(address => ({ address, prediction: predictRecall(projected, address, deadline) })) };
  });
  return { version: 'preparation-continuation@8', modelVersion: model.version, evidenceVersion: model.evidenceVersion,
    deadline, evaluationEndsAt, firstAction: first.key, current: addresses.map(address => ({ address, prediction: predictRecall(model, address, context.nowMs) })),
    noAdditionalStudy: addresses.map(address => ({ address, prediction: predictRecall(model, address, deadline) })), scenarios,
    scopeCapability: { current: scopeCapability(model, scopeAddresses, context.nowMs), noAdditionalStudy: scopeCapability(model, scopeAddresses, deadline) },
    scopeTasks: { declared: scopeKeys.size, admitted: admittedScopeCount, omitted: scopeKeys.size - admittedScopeCount },
    actionsOmitted: declared.length - actions.length, targetsOmitted: Math.max(0,
      new Set(declared.flatMap(action => action.targets.map(learningAddress))).size - addresses.length),
    priorDriven: opportunities.priorDriven || actions.some(action => !model.kernelWeights[action.family]) || addresses.some(address => !model.memories[address]?.observations),
    limits: ['Conditional on working on the already selected first action, then repeating past opportunity patterns and task-effort scenarios; not observed free time or a guarantee of future study.',
      'Declared alternative activities sharing one physical slot cannot execute in the same opportunity, including when held work finishes there. They remain eligible at later opportunities; this does not forecast scheduler eligibility or imply that every repeated task remains due.',
      'The held first action consumes current and later opportunity capacity until completion before new tasks are chosen. Its physical effect starts at completion, only if it finishes by assessment. Fragmented active work uses the same task-conditioned effort estimate; interruption overhead beyond that estimate is unmodelled. This forecast never terminates the live encounter.',
      'Current competence and no-additional-study predictions remain separate. Future physical transitions marginalize recall without fabricated reports, posterior information or fitted treatment effects.',
      'Runnable installed-scope tasks can enter future choices. Physical action values refresh the short-sequence window; belief-dependent adaptation and future information value are omitted. No official section score, pass probability or readiness claim.',
      'Every future choice uses the same absolute trajectory end as the current controller, including its declared post-assessment horizon. Opportunity gaps change deferral and feasibility, not that end date. Selected values are conditional physical capability-days against deferral, not readiness or measured learning gains.',
      'Future interventions take effect at scenario-estimated completion and must fit before the assessment point. Each action value conditions on the same effort scenario as feasibility and accounts for its own completion delay. Both execution orders are compared; the second task completion includes the first task effort, with the same trajectory end and deferred alternative. Pair targets must be disjoint. No time is added beyond an opportunity or deadline.',
      'All declared runnable tasks participate without a stable array-index cutoff. At most 32 pair-search candidates per opportunity, 64 individually reported accesses, 128 future opportunities and 3072 distinct numerical action calculations per scenario. Equivalent wholly unobserved priors reuse an exact calculation within one immutable opportunity; fitted/projected memories never share it. If the complete pool cannot fit the remaining numerical budget, no partial choice is made; held-task work already performed in that opportunity is still conserved. The continuation stop and next opportunity are explicit; unmodelled later opportunities contribute no invented study or failed observations. Later opportunities and individual rows omitted by these bounds are reported, not filled with study or counted as failures.',
      'Whole runnable-scope summaries cover every unique declared scope access, including those without an individual trace row. They report uniform model recall summaries and averages/minima of marginal bounds, not joint confidence, official section scores, package outcome success or calibrated readiness. Overlapping accesses are counted once; absence of fitted observations stays explicit. Empty scope summaries are null, not achieved.',
      'Low/middle/high gap, censored duration and task-effort combinations are sensitivity scenarios, not confidence bounds. Physical branches use deterministic 128-particle quadrature, not empirical calibration.'] };
}
