import { describe, expect, it } from 'vitest';
import { evaluateLearningActions, evaluatePhysicalLearningActions, learningSequenceDelay } from './learningInformation';
import { chooseLearningSequence, evaluateLearningAction, fitLearningModel, learningAddress, type LearningAction } from './learningModel';

const day = 86_400_000;
const target = { entityId: 'future:utterance:a', capability: 'future:relationship' };
const context = { nowMs: day, horizonDays: 30, deferDays: 3 };
const opportunity = { availableSeconds: [120, 300], continuationValue: 0 };
const diagnostic: LearningAction = { key: 'check', family: 'recall-check', mode: 'diagnostic', targets: [target],
  measurement: { address: learningAddress(target), provenance: 'Declared self-reported recall, unassisted cue' } };

describe('bounded decision value of observations', () => {
  it('preserves ordered choices when reusing equivalent pair comparisons with overlap and fitted state', () => {
    const actions: LearningAction[] = ['a', 'b', 'c', 'd', 'e', 'f'].map(key => ({ key, family: 'task', mode: 'practice',
      targets: [{ ...target, entityId: key === 'f' ? 'a' : key }] }));
    const model = fitLearningModel([{ t: day, kind: 'rating', source: 'manual', quality: 'fluent', method: 'recall',
      taskType: 'task', attemptId: 'observed', targetRef: { kind: 'surface', id: 'e', capability: target.capability } }], 3 * day);
    const ctx = { ...context, nowMs: model.at };
    const values = evaluatePhysicalLearningActions(model, actions, ctx).values;
    const referenceDelay = learningSequenceDelay(model, actions, ctx);
    const reusedDelay = learningSequenceDelay(model, actions, ctx);
    let referenceCalls = 0; let reusedCalls = 0;
    const reference = chooseLearningSequence(values, { ...opportunity,
      delayedValue: (value, elapsed, own) => { referenceCalls++; return referenceDelay.delayedValue(value, elapsed, own); } });
    const reused = chooseLearningSequence(values, { ...opportunity, delayedIdentity: reusedDelay.delayedIdentity,
      delayedValue: (value, elapsed, own) => { reusedCalls++; return reusedDelay.delayedValue(value, elapsed, own); } });
    expect(reused.keys).toEqual(reference.keys);
    expect(reused.value).toBeCloseTo(reference.value, 12);
    expect(reusedCalls).toBeLessThan(referenceCalls);
    expect(new Set(reused.keys.flatMap(key => actions.find(action => action.key === key)!.targets.map(learningAddress))).size)
      .toBe(reused.keys.length);
  });

  it('values delayed completion against the same trajectory end and reuses only equivalent unfitted targets', () => {
    const model = fitLearningModel([], day);
    const ctx = { nowMs: day, horizonDays: 15 / 86400, deferDays: 0 };
    const actions: LearningAction[] = ['a', 'b'].map(key => ({ key, family: 'practice', mode: 'practice',
      targets: [{ ...target, entityId: key }] }));
    const values = evaluatePhysicalLearningActions(model, actions, ctx, { completionSeconds: () => 10 }).values;
    const delay = learningSequenceDelay(model, actions, ctx);
    expect(values.every(value => value.expectedCapabilityDays > 0)).toBe(true);
    expect(delay.delayedValue(values[0], 10, 10)).toBe(0);
    expect(delay.delayedValue(values[1], 10, 10)).toBe(0);
    expect(delay.calculations).toBe(1);
    const plan = chooseLearningSequence(values, { availableSeconds: [30], continuationValue: 0, delayedValue: delay.delayedValue });
    expect(plan.keys).toHaveLength(1);
    expect(model.observations).toBe(0);
  });

  it('refuses another distinct delayed calculation when the forecast numerical bound is reached', () => {
    const model = fitLearningModel([], day);
    const teach: LearningAction = { key: 'teach', family: 'task', mode: 'practice', targets: [target] };
    const value = evaluateLearningAction(model, teach, context);
    const delay = learningSequenceDelay(model, [teach], context, 1);
    expect(delay.delayedValue(value, 1, 1)).toBeTypeOf('number');
    expect(delay.delayedValue(value, 2, 1)).toBeUndefined();
    expect(delay.complete).toBe(false);
    expect(delay.calculations).toBe(1);
  });

  it('preserves exact candidate values and provenance when reusing identical unobserved priors', () => {
    const targets = Array.from({ length: 8 }, (_, index) => ({ ...target, entityId: `opaque:${index}` }));
    const model = fitLearningModel([{ t: day, kind: 'rating', source: 'manual', quality: 'fluent', method: 'recall',
      taskType: 'srs-review', attemptId: 'observed', targetRef: { kind: 'surface', id: targets[7].entityId, capability: targets[7].capability } }], 3 * day);
    const ctx = { ...context, nowMs: 3 * day, targetWeights: Object.fromEntries(targets.map((item, index) =>
      [learningAddress(item), index === 2 ? 2 : index === 3 ? 0 : 1])) };
    const actions: LearningAction[] = targets.map((item, index) => ({ key: `candidate:${index}`, family: 'same-task',
      mode: index === 6 ? 'immersion' : 'practice', targets: index === 4 ? [item, item] : [item],
      ...(index === 5 ? { durationSeconds: 900 } : {}),
      ...(index === 6 ? { transfer: { probability: 0.1, provenance: 'Declared hypothetical bridge' } } : {}) }));
    expect(evaluateLearningActions(model, actions, ctx, opportunity)).toEqual(actions.map(action => evaluateLearningAction(model, action, ctx)));
    expect(model.observations).toBe(1);
  });
  it('reuses only identical completion scenarios and refuses a partial pool before numerical work', () => {
    const targets = ['a', 'b', 'c', 'd'].map(entityId => ({ ...target, entityId }));
    const model = fitLearningModel([{ t: day, kind: 'rating', source: 'manual', quality: 'fluent', method: 'recall',
      taskType: 'srs-review', attemptId: 'observed', targetRef: { kind: 'surface', id: 'c', capability: target.capability } }], 3 * day);
    const actions: LearningAction[] = targets.map((item, index) => ({ key: String(index), family: 'task', mode: 'practice', targets: [item] }));
    const completionSeconds = (action: LearningAction) => action.key === '1' ? 20 : 10;
    const result = evaluatePhysicalLearningActions(model, actions, context, { completionSeconds, performanceLimit: 0 });
    expect(result.values).toEqual(actions.map(action => evaluateLearningAction(model, action,
      { ...context, completionSeconds: completionSeconds(action) }, { performanceLimit: 0 })));
    expect(result.calculations).toBe(3);
    const refused = evaluatePhysicalLearningActions(model, actions, context,
      { completionSeconds, performanceLimit: 0, maxCalculations: 2 });
    expect(refused).toEqual({ values: [], calculations: 0, requiredCalculations: 3, complete: false });
  });
  it('never turns diagnostic belief revision into learner capability or writes hypothetical observations', () => {
    const model = fitLearningModel([], day);
    const before = structuredClone(model);
    const values = evaluateLearningActions(model, [diagnostic], context, opportunity);
    expect(values[0].expectedCapabilityDays).toBe(0);
    expect(values[0].information?.expectedDecisionBenefit).toBe(0);
    expect(chooseLearningSequence(values, opportunity).keys).toEqual([]);
    expect(model).toEqual(before);
  });
  it('withholds information credit without a declared measurable access or a future opportunity', () => {
    const teach: LearningAction = { key: 'teach', family: 'recall-check', mode: 'practice', targets: [target] };
    const model = fitLearningModel([], day);
    expect(evaluateLearningActions(model, [{ ...diagnostic, measurement: undefined }, teach], context, opportunity)[0].information).toBeUndefined();
    expect(evaluateLearningActions(model, [diagnostic, teach], { ...context, deferDays: 40 }, opportunity)[0].information).toBeUndefined();
    expect(evaluateLearningActions(model, [{ ...diagnostic, measurement: { ...diagnostic.measurement!, address: 'unrelated' } }, teach], context, opportunity)[0].information).toBeUndefined();
    expect(evaluateLearningActions(model, [{ ...diagnostic, mode: 'immersion' }, teach], context, opportunity)[0].information).toBeUndefined();
  });
  it('cannot reward re-testing the same recently revealed recall encounter', () => {
    const model = fitLearningModel([{ t: day, source: 'srs', kind: 'rating', method: 'recall', taskType: 'recall-check', attemptId: 'actual', quality: 'fluent',
      targetRef: { kind: 'surface', id: target.entityId, capability: target.capability } }], day + 1000);
    const values = evaluateLearningActions(model, [diagnostic, { key: 'teach-a', family: 'recall-check', mode: 'practice', targets: [target] }],
      { ...context, nowMs: day + 1000 }, opportunity);
    expect(values[0].information).toBeUndefined();
  });
  it('assigns useful information only to a response that can change the future choice', () => {
    const model = fitLearningModel([], day);
    const other = { ...target, entityId: 'future:utterance:b' };
    const alternatives: LearningAction[] = [diagnostic,
      { key: 'teach-a', family: 'recall-check', mode: 'practice', targets: [target] },
      { key: 'teach-b', family: 'recall-check', mode: 'practice', targets: [other] }];
    const limited = { ...opportunity, availableSeconds: [30] };
    // Unequal package scope sizes can put two actions near a decision boundary.
    const scoped = { ...context, targetWeights: { [learningAddress(target)]: 1, [learningAddress(other)]: 13 / 12 } };
    const values = evaluateLearningActions(model, alternatives, scoped, limited);
    const information = values[0].information!;
    expect(information.expectedDecisionBenefit).toBeGreaterThan(0);
    expect(information.branches.map(branch => branch.selected.join(','))).not.toEqual([information.branches[0].selected.join(','), information.branches[0].selected.join(',')]);
    expect(information.at).toBe(4 * day);
    const uselessReport = evaluateLearningActions(model, [{ ...diagnostic, measurement: { ...diagnostic.measurement!, reportingError: 0.5 } }, ...alternatives.slice(1)], scoped, limited)[0];
    expect(uselessReport.information!.expectedDecisionBenefit).toBeCloseTo(0, 12);
  });
  it('charges diagnostic effort and never admits an expensive observation solely because uncertainty is high', () => {
    const model = fitLearningModel([], day);
    const values = evaluateLearningActions(model, [{ ...diagnostic, durationSeconds: 100000 },
      { key: 'teach-a', family: 'recall-check', mode: 'practice', targets: [target] },
      { key: 'teach-b', family: 'recall-check', mode: 'practice', targets: [{ ...target, entityId: 'future:b' }] }], context, opportunity);
    expect(chooseLearningSequence(values, opportunity).keys).not.toContain('check');
  });
});
