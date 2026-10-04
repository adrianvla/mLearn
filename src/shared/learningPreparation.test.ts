import { describe, expect, it } from 'vitest';
import { evaluateLearningAction, fitLearningModel, learningAddress, predictRecall, projectLearningIntervention, type LearningAction } from './learningModel';
import { forecastLearningPreparation } from './learningPreparation';
import { inferLearningOpportunities } from './learningOpportunities';
const DAY = 86400000;
const model = fitLearningModel([], 30 * DAY);
const target = { entityId: 'unknown-package:construction:x', capability: 'future::relationship-access' };
const action: LearningAction = { key: 'teach', family: 'future-task', targets: [target], mode: 'practice' };
const opportunities = { ...inferLearningOpportunities([], model.at), gapDays: [1, 3, 7], availableSeconds: [30, 120, 300] };
const context = { nowMs: model.at, horizonDays: 21, deferDays: 3, assessmentAt: model.at + 14 * DAY };
describe('conditional repeated preparation', () => {
  it('records ordered pair values before applying their physical effects', () => {
    const held = { ...action, targets: [], durationSeconds: 1 };
    const tasks = ['first', 'second'].map(key => ({ ...action, key, durationSeconds: 10,
      targets: [{ ...target, entityId: key }] }));
    const forecast = forecastLearningPreparation(model, tasks, held, context,
      { ...opportunities, gapDays: [1], availableSeconds: [30] })!;
    const step = forecast.scenarios[1].steps.find(step => step.keys.length === 2)!;
    expect(step).toBeDefined();
    // The empty held task has no target effect, so the initial model is the
    // independent reference for this first two-task opportunity.
    expect(step).toBe(forecast.scenarios[1].steps[0]);
    for (const choice of step.choices) {
      const task = tasks.find(task => task.key === choice.key)!;
      const expected = evaluateLearningAction(model, task, { ...context, nowMs: step.at,
        deferDays: 1, horizonDays: step.horizonDays, completionSeconds: (choice.completedAt - step.at) / 1000 });
      expect(choice.expectedCapabilityDays).toBeCloseTo(expected.expectedCapabilityDays, 12);
      expect(choice.interval).toEqual(expected.interval);
    }
    expect(step.choices[1].completedAt).toBeGreaterThan(step.choices[0].completedAt);
  });

  it('does not credit a second task after the fixed evaluation trajectory ends', () => {
    const held = { ...action, targets: [], durationSeconds: 1 };
    const tasks = ['first', 'second'].map(key => ({ ...action, key, durationSeconds: 10,
      targets: [{ ...target, entityId: key }] }));
    const forecast = forecastLearningPreparation(model, tasks, held,
      { ...context, horizonDays: 1 + 15 / 86400, assessmentAt: model.at + DAY + 30000 },
      { ...opportunities, gapDays: [1], availableSeconds: [30] })!;
    expect(forecast.scenarios[1].steps[0].keys).toHaveLength(1);
  });

  it('keeps alternative activities in the pool without forecasting both in one opportunity', () => {
    const held = { ...action, targets: [], durationSeconds: 1 };
    const alternatives = [
      { ...action, key: 'future-written', durationSeconds: 10, exclusiveOpportunityGroups: ['opaque:one-physical-slot'] },
      { ...action, key: 'future-sound', durationSeconds: 10, exclusiveOpportunityGroups: ['opaque:one-physical-slot'],
        targets: [{ ...target, capability: 'future::sound' }] },
    ];
    const forecast = forecastLearningPreparation(model, alternatives, held, context,
      { ...opportunities, gapDays: [1], availableSeconds: [300] }, alternatives)!;
    expect(forecast.scopeTasks).toEqual({ declared: 2, admitted: 2, omitted: 0 });
    expect(forecast.scenarios.every(scenario => scenario.steps.every(step =>
      step.keys.filter(key => alternatives.some(action => action.key === key)).length <= 1))).toBe(true);
    expect(forecast.scenarios.some(scenario => scenario.steps.some(step => step.keys.some(key => key.startsWith('future-'))))).toBe(true);
  });

  it('reserves a completing held activity slot before choosing future work in that opportunity', () => {
    const held = { ...action, durationSeconds: 200, exclusiveOpportunityGroups: ['opaque:held-slot'] };
    const alternative = { ...action, key: 'alternative', durationSeconds: 10, exclusiveOpportunityGroups: ['opaque:held-slot'],
      targets: [{ ...target, capability: 'other-access' }] };
    const forecast = forecastLearningPreparation(model, [alternative], held,
      { ...context, assessmentAt: model.at + 5 * DAY }, { ...opportunities, gapDays: [1], availableSeconds: [60] })!;
    const middle = forecast.scenarios[1];
    expect(middle.steps[2].heldActionSeconds).toBeCloseTo(20);
    expect(middle.steps[2].keys).not.toContain('alternative');
    expect(middle.steps[3].keys).toContain('alternative');
  });

  it('does not credit the held first action before its estimated completion', () => {
    const forecast = forecastLearningPreparation(model, [action], action,
      { ...context, assessmentAt: model.at + 1000 }, opportunities)!;
    expect(forecast.scenarios.every(scenario => scenario.final[0].prediction.mean
      === forecast.noAdditionalStudy[0].prediction.mean)).toBe(true);
    expect(forecast.scenarios.every(scenario => scenario.firstActionExecution.completedAt === undefined)).toBe(true);
  });
  it('carries unfinished first work across opportunities before admitting replacement tasks', () => {
    const held = { ...action, durationSeconds: 200 };
    const later = { ...action, key: 'later', durationSeconds: 10, targets: [{ ...target, entityId: 'later' }] };
    const forecast = forecastLearningPreparation(model, [held, later], held,
      { ...context, assessmentAt: model.at + 4 * DAY },
      { ...opportunities, gapDays: [1], availableSeconds: [60] })!;
    const middle = forecast.scenarios[1];
    expect(middle.firstActionExecution.estimatedActiveSeconds).toBeCloseTo(200);
    expect(middle.firstActionExecution.completedAt).toBeCloseTo(model.at + 3 * DAY + 20000);
    expect(middle.firstActionExecution.remainingActiveSeconds).toBe(0);
    expect(middle.steps.slice(0, 2).every(step => step.keys.length === 0)).toBe(true);
    expect(middle.steps[2].at).toBe(middle.firstActionExecution.completedAt);
    expect(middle.steps[2].keys).toContain('later');
    expect(forecast.scenarios[0].firstActionExecution.completedAt).toBeUndefined();
    expect(forecast.scenarios[0].steps.every(step => step.keys.length === 0)).toBe(true);
    expect(model.observations).toBe(0);
  });
  it('keeps one trajectory end across opportunities and exposes the actual physical choices', () => {
    const forecast = forecastLearningPreparation(model, [action], action, context,
      { ...opportunities, gapDays: [1], availableSeconds: [300] })!;
    const end = context.nowMs + context.horizonDays * DAY;
    expect(forecast.evaluationEndsAt).toBe(end);
    let projected = projectLearningIntervention(model, action, forecast.scenarios[1].firstActionExecution.completedAt!);
    for (const step of forecast.scenarios[1].steps) {
      expect(step.horizonDays).toBeCloseTo((end - step.at) / DAY);
      expect(step.choices.map(choice => choice.key)).toEqual(step.keys);
      for (const choice of step.choices) {
        const expected = evaluateLearningAction(projected, action, { ...context, nowMs: step.at,
          deferDays: 1, horizonDays: (end - step.at) / DAY, completionSeconds: (choice.completedAt - step.at) / 1000 });
        expect(choice.expectedCapabilityDays).toBeCloseTo(expected.expectedCapabilityDays, 10);
        expect(choice.interval).toEqual(expected.interval);
        expect(choice.counterfactual).toBe(expected.counterfactual);
        expect(choice.completedAt).toBeGreaterThan(step.at);
        expect(choice.completedAt).toBeLessThanOrEqual(forecast.deadline);
        projected = projectLearningIntervention(projected, action, choice.completedAt);
      }
    }
    expect(forecast.scenarios[1].steps.at(-1)!.horizonDays).toBe(8);
    expect(projected.observations).toBe(0);
  });
  it('lets the declared post-assessment trajectory change content instead of shortening it to the next gap', () => {
    const observed = { entityId: 'observed', capability: 'opaque-access' };
    const unassessed = { entityId: 'unassessed', capability: 'opaque-access' };
    const history = [{ t: DAY, kind: 'rating' as const, source: 'manual' as const, quality: 'missed' as const,
      method: 'recall' as const, taskType: 'srs-review', attemptId: 'earlier',
      targetRef: { kind: 'surface' as const, id: observed.entityId, capability: observed.capability } }];
    const fitted = fitLearningModel(history, model.at);
    const tasks: LearningAction[] = [observed, unassessed].map(target => ({ key: target.entityId,
      family: 'teach', targets: [target], mode: 'practice' }));
    const first: LearningAction = { key: 'already-selected', family: 'checkpoint', targets: [], mode: 'diagnostic' };
    const assessmentAt = model.at + DAY + 60000;
    const requirements = { ...context, assessmentAt, targetWeights: {
      [learningAddress(observed)]: 0.8, [learningAddress(unassessed)]: 1,
    } };
    const regular = { ...opportunities, gapDays: [1], availableSeconds: [31] };
    const short = forecastLearningPreparation(fitted, tasks, first, { ...requirements,
      horizonDays: (assessmentAt - model.at) / DAY + 1 }, regular)!;
    const sustained = forecastLearningPreparation(fitted, tasks, first, { ...requirements, horizonDays: 30 }, regular)!;
    expect(short.scenarios[1].steps[0].keys).toEqual(['observed']);
    expect(sustained.scenarios[1].steps[0].keys).toEqual(['unassessed']);
    expect(sustained.deadline).toBe(short.deadline);
    expect(sustained.scenarios[1].futureActiveSeconds).toBe(short.scenarios[1].futureActiveSeconds);
    expect(fitted.observations).toBe(1);
  });
  it('does not credit work that starts at the assessment or cannot finish beforehand', () => {
    const regular = { ...opportunities, gapDays: [1], availableSeconds: [300] };
    const atAssessment = forecastLearningPreparation(model, [action], action,
      { ...context, assessmentAt: model.at + DAY }, regular)!;
    expect(atAssessment.scenarios.every(scenario => scenario.steps.length === 0)).toBe(true);
    const tooLate = forecastLearningPreparation(model, [action], action,
      { ...context, assessmentAt: model.at + DAY + 1000 }, regular)!;
    expect(tooLate.scenarios.every(scenario => scenario.steps[0].keys.length === 0)).toBe(true);
    const first: LearningAction = { key: 'held-diagnostic', family: 'checkpoint', targets: [], mode: 'diagnostic' };
    const fits = forecastLearningPreparation(model, [action], first,
      { ...context, assessmentAt: model.at + DAY + 60000 }, regular)!;
    expect(fits.scenarios[1].steps[0].choices[0].completedAt).toBeLessThan(fits.deadline);
    expect(fits.scenarios[0].steps[0].keys).toEqual([]);
  });
  it('admits runnable scope content beyond the initial Home offer and keeps current competence separate', () => {
    const future = { ...action, key: 'later-scope-task', targets: [{ ...target, entityId: 'future:second' }] };
    const forecast = forecastLearningPreparation(model, [action], action, context,
      { ...opportunities, gapDays: [1], availableSeconds: [300] }, [future])!;
    expect(forecast.scenarios[1].steps.some(step => step.keys.includes(future.key))).toBe(true);
    const address = learningAddress(future.targets[0]);
    const current = forecast.current.find(row => row.address === address)!;
    const baseline = forecast.noAdditionalStudy.find(row => row.address === address)!;
    const final = forecast.scenarios[1].final.find(row => row.address === address)!;
    expect(current.prediction.observations).toBe(0);
    expect(final.prediction.mean).toBeGreaterThan(baseline.prediction.mean);
    expect(final.prediction.observations).toBe(0);
    expect(forecast.scopeTasks).toEqual({ declared: 1, admitted: 1, omitted: 0 });
  });
  it('deduplicates all runnable tasks and bounds individual rows without excluding content', () => {
    const catalog = Array.from({ length: 300 }, (_, index) => ({ ...action, key: `scope:${index}`,
      targets: [{ ...target, entityId: `future:${index}` }] }));
    const forecast = forecastLearningPreparation(model, [action], action, context,
      { ...opportunities, gapDays: [20] }, [action, ...catalog])!;
    expect(forecast.scopeTasks.declared).toBe(301);
    expect(forecast.scopeTasks.admitted).toBe(301);
    expect(forecast.scopeTasks.omitted).toBe(0);
    expect(forecast.actionsOmitted).toBe(0);
    expect(forecast.targetsOmitted).toBe(237);
    expect(forecast.scopeCapability.current.targets).toBe(301);
    expect(forecast.scopeCapability.current.meanModelRecall).toBeCloseTo(0.5);
    expect(forecast.scopeCapability.current.unobservedTargets).toBe(301);
    const projected = projectLearningIntervention(model, action, forecast.scenarios[1].firstActionExecution.completedAt!);
    const expected = [action, ...catalog].reduce((sum, task) => sum + predictRecall(projected,
      learningAddress(task.targets[0]), forecast.deadline).mean, 0) / 301;
    expect(forecast.scenarios[1].scopeCapability.meanModelRecall).toBeCloseTo(expected, 12);
    expect(forecast.scenarios[1].scopeCapability.meanModelRecall!).toBeGreaterThan(forecast.scopeCapability.noAdditionalStudy.meanModelRecall!);
    expect(forecast.scenarios[1].scopeCapability.unobservedTargets).toBe(301);
  });
  it('compares a valuable task beyond the old fixed cutoff against the entire runnable pool', () => {
    const scope = Array.from({ length: 300 }, (_, index) => ({ ...action, key: `scope:${index}`,
      targets: [{ ...target, entityId: `scope:${index}` }] }));
    const held: LearningAction = { key: 'held', family: 'checkpoint', targets: [], mode: 'diagnostic' };
    const weights = Object.fromEntries(scope.map((task, index) => [learningAddress(task.targets[0]), index === 299 ? 1 : 0]));
    const forecast = forecastLearningPreparation(model, [], held, { ...context, targetWeights: weights,
      assessmentAt: model.at + DAY + 60000 }, { ...opportunities, gapDays: [1], availableSeconds: [120] }, scope)!;
    expect(forecast.scenarios[1].steps[0].keys).toEqual(['scope:299']);
    expect(forecast.scopeTasks).toEqual({ declared: 300, admitted: 300, omitted: 0 });
  });
  it('refreshes beyond the initial 32 tasks and does not let infeasible high-value tasks hide feasible study', () => {
    const expensive = Array.from({ length: 40 }, (_, index) => ({ ...action, key: `long:${index}`,
      durationSeconds: 10000, targets: Array.from({ length: 5 }, (_, access) => ({ ...target, entityId: `long:${index}:${access}` })) }));
    const feasible = { ...action, key: 'feasible-later', targets: [{ ...target, entityId: 'later' }] };
    const first: LearningAction = { key: 'held-diagnostic', family: 'checkpoint', targets: [], mode: 'diagnostic' };
    const forecast = forecastLearningPreparation(model, expensive, first, { ...context, assessmentAt: model.at + DAY + 60000 },
      { ...opportunities, gapDays: [1], availableSeconds: [120] }, [feasible])!;
    expect(forecast.scenarios[1].steps[0].keys).toEqual([feasible.key]);
    expect(forecast.scenarios[1].steps[0].activeSeconds).toBeLessThanOrEqual(120);
  });
  it('separates current competence, no future study and conditional repeated actions without invented evidence', () => {
    const before = structuredClone(model);
    const forecast = forecastLearningPreparation(model, [action], action, context, opportunities)!;
    expect(forecast.current[0].prediction.mean).toBeCloseTo(0.5);
    expect(forecast.noAdditionalStudy[0].prediction.mean).toBeLessThan(forecast.current[0].prediction.mean);
    expect(forecast.scenarios[1].final[0].prediction.mean).toBeGreaterThan(forecast.noAdditionalStudy[0].prediction.mean);
    expect(forecast.scenarios[1].final[0].prediction.observations).toBe(0);
    expect(forecast.priorDriven).toBe(true);
    expect(forecast).not.toHaveProperty('passProbability');
    expect(model).toEqual(before);
    expect(forecastLearningPreparation(model, [action], action, context, opportunities)).toEqual(forecast);
  });
  it('uses missed opportunities and different task effort without adding free time or moving the date', () => {
    const fast = forecastLearningPreparation(model, [action], action, context, { ...opportunities, gapDays: [1], availableSeconds: [120] })!;
    const missed = forecastLearningPreparation(model, [action], action, context, { ...opportunities, gapDays: [20], availableSeconds: [120] })!;
    const slow = forecastLearningPreparation(model, [{ ...action, durationSeconds: 10000 }], action, context,
      { ...opportunities, gapDays: [1], availableSeconds: [120] })!;
    expect(fast.deadline).toBe(missed.deadline);
    expect(missed.scenarios[1].steps).toHaveLength(0);
    expect(fast.scenarios[1].futureActiveSeconds).toBeGreaterThan(missed.scenarios[1].futureActiveSeconds);
    expect(slow.scenarios[1].futureActiveSeconds).toBe(13 * 120);
    expect(slow.scenarios[1].firstActionExecution.completedAt).toBeUndefined();
    expect(slow.scenarios[1].firstActionExecution.remainingActiveSeconds).toBeGreaterThan(0);
    expect(slow.scenarios[1].steps.every(step => step.keys.length === 0)).toBe(true);
    expect(slow.scenarios[1].final).toEqual(slow.noAdditionalStudy);
  });
  it('does not duplicate overlapping accesses or turn diagnosis and unbridged immersion into learning', () => {
    const diagnostic = { ...action, mode: 'diagnostic' as const };
    const forecast = forecastLearningPreparation(model, [diagnostic, { ...diagnostic, key: 'overlap' }], diagnostic, context, opportunities)!;
    expect(forecast.current.map(row => row.address)).toEqual([learningAddress(target)]);
    expect(forecast.scenarios.every(scenario => scenario.final[0].prediction.mean === forecast.noAdditionalStudy[0].prediction.mean)).toBe(true);
    const immersion = { ...action, mode: 'immersion' as const };
    const passive = forecastLearningPreparation(model, [immersion], immersion, context, opportunities)!;
    expect(passive.scenarios[1].final).toEqual(passive.noAdditionalStudy);
  });
  it('exposes numerical and finite planning limits, and never calls expired or missing dates achieved', () => {
    const forecast = forecastLearningPreparation(model, [action], action, { ...context, assessmentAt: model.at + 1000 * DAY }, opportunities)!;
    expect(forecast.scenarios[1].steps).toHaveLength(128);
    expect(forecast.scenarios[1].numericalCalculations).toBeLessThanOrEqual(3072);
    expect(forecast.scenarios[1].futureOpportunitiesOmitted).toBe(true);
    expect(forecastLearningPreparation(model, [action], action, { ...context, assessmentAt: model.at - DAY }, opportunities)).toBeUndefined();
    expect(forecastLearningPreparation(model, [action], action, { ...context, assessmentAt: undefined }, opportunities)).toBeUndefined();
  });
  it('stops before a partial comparison when fitted whole-scope calculations exhaust the bound', () => {
    const tasks = Array.from({ length: 1000 }, (_, index) => ({ ...action, key: `fitted:${index}`,
      targets: [{ ...target, entityId: `fitted:${index}` }] }));
    const fitted = fitLearningModel(tasks.map(task => ({ t: DAY, kind: 'rating' as const, source: 'manual' as const,
      quality: 'missed' as const, method: 'recall' as const, taskType: 'srs-review', attemptId: task.key,
      targetRef: { kind: 'surface' as const, id: task.targets[0].entityId, capability: target.capability } })), model.at);
    const held: LearningAction = { key: 'held', family: 'checkpoint', targets: [], mode: 'diagnostic' };
    const forecast = forecastLearningPreparation(fitted, [], held, { ...context, assessmentAt: model.at + 40 * DAY },
      { ...opportunities, gapDays: [1], availableSeconds: [300] }, tasks)!;
    const middle = forecast.scenarios[1];
    expect(middle.steps).toHaveLength(2);
    expect(middle.numericalCalculations).toBeLessThanOrEqual(3072);
    expect(middle.continuationStop.reason).toBe('numerical-bound');
    expect(middle.futureOpportunitiesOmitted).toBe(true);
    expect(forecast.scopeTasks).toEqual({ declared: 1000, admitted: 1000, omitted: 0 });
    expect(middle.scopeCapability.targets).toBe(1000);
    expect(fitted.observations).toBe(1000);
  });
  it('conserves held work when its completion is followed by a refused full-pool comparison', () => {
    const held = { ...action, key: 'held', durationSeconds: 200 };
    const scope = Array.from({ length: 3073 }, (_, index) => ({ ...action, key: `task:${index}`, family: `family:${index}`,
      targets: [{ ...target, entityId: `task:${index}` }] }));
    const forecast = forecastLearningPreparation(model, [], held, { ...context, assessmentAt: model.at + 4 * DAY },
      { ...opportunities, gapDays: [1], availableSeconds: [60] }, scope)!;
    const middle = forecast.scenarios[1];
    expect(middle.firstActionExecution.completedAt).toBe(model.at + 3 * DAY + 20000);
    expect(middle.futureActiveSeconds).toBeCloseTo(140, 12);
    expect(middle.steps.reduce((sum, step) => sum + step.heldActionSeconds, 0)).toBeCloseTo(140, 12);
    expect(middle.steps.every(step => step.keys.length === 0)).toBe(true);
    expect(middle.continuationStop.reason).toBe('numerical-bound');
    expect(middle.numericalCalculations).toBe(0);
  });
  it('does not turn an empty scope summary into reached readiness', () => {
    const held: LearningAction = { key: 'held', family: 'checkpoint', targets: [], mode: 'diagnostic' };
    const forecast = forecastLearningPreparation(model, [], held, context, opportunities)!;
    expect(forecast.scopeCapability.current.targets).toBe(0);
    expect(forecast.scopeCapability.current.meanModelRecall).toBeNull();
    expect(forecast.scenarios[1].scopeCapability.meanMarginalBounds).toBeNull();
    expect(forecast).not.toHaveProperty('readiness');
    expect(forecast).not.toHaveProperty('passProbability');
  });
  it('forecasts small scopes beyond twelve opportunities but bounds larger evaluation workloads', () => {
    const tasks = Array.from({ length: 4 }, (_, index) => ({ ...action, key: `task:${index}`,
      targets: [{ ...target, entityId: `future:${index}` }] }));
    const longContext = { ...context, assessmentAt: model.at + 40 * DAY };
    const regular = { ...opportunities, gapDays: [1], availableSeconds: [120] };
    const small = forecastLearningPreparation(model, tasks, tasks[0], longContext, regular)!;
    expect(small.scenarios[1].steps).toHaveLength(39);
    expect(small.scenarios[1].futureOpportunitiesOmitted).toBe(false);
    const larger = Array.from({ length: 256 }, (_, index) => ({ ...action, key: `large:${index}`,
      targets: [{ ...target, entityId: `large:${index}` }] }));
    const bounded = forecastLearningPreparation(model, larger, larger[0], longContext, regular)!;
    expect(bounded.scenarios[1].steps).toHaveLength(39);
    expect(bounded.scenarios[1].actionEvaluations).toBe(39 * 256);
    expect(bounded.scenarios[1].numericalCalculations).toBeLessThanOrEqual(3072);
    expect(bounded.scenarios[1].futureOpportunitiesOmitted).toBe(false);
  });
});
