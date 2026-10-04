import { describe, expect, it } from 'vitest';
import { fitLearningModel, predictRecall, evaluateLearningAction, chooseLearningSequence, learningAddress, projectLearningIntervention, prepareLearningActionCompletionValue, MODEL_ASSUMPTIONS } from './learningModel';
import type { KnowledgeEvent } from './knowledgeEvents';

const DAY = 86_400_000;
const target = { entityId: 'future:surface:a', capability: 'future::discourse' };
const address = learningAddress(target);
const observation = (t: number, quality: KnowledgeEvent['quality'] = 'fluent', extra: Partial<KnowledgeEvent> = {}): KnowledgeEvent => ({
  t, kind: 'rating', source: 'srs', quality, attemptId: `attempt-${t}`,
  taskType: 'srs-review', activeLatencyMs: 14000,
  targetRef: { kind: 'surface', id: target.entityId, capability: target.capability }, ...extra,
});
const action = { key: 'practice', family: 'srs-review', targets: [target], mode: 'practice' as const };

describe('uncertain learning-action model', () => {
  it('preserves the full physical integral when preparing repeated completion-time comparisons', () => {
    const model = fitLearningModel([observation(DAY)], 3 * DAY);
    const before = structuredClone(model);
    const variants = [action, { ...action, mode: 'diagnostic' as const },
      { ...action, mode: 'immersion' as const, transfer: { probability: 0.1, sensitivity: [0, 0.3], provenance: 'explicit test bridge' } },
      { ...action, targets: [target, { ...target, entityId: 'unobserved' }] }];
    for (const variant of variants) for (const deferDays of [0, 3]) {
      const context = { nowMs: model.at, horizonDays: 30, deferDays,
        targetWeights: { [address]: 0.4, [learningAddress({ ...target, entityId: 'unobserved' })]: 0.6 } };
      const prepared = prepareLearningActionCompletionValue(model, variant, context);
      for (const completionSeconds of [0, 20, 900, 31 * 86400]) {
        expect(prepared(completionSeconds)).toBeCloseTo(evaluateLearningAction(model, variant,
          { ...context, completionSeconds }).expectedCapabilityDays, 12);
      }
    }
    const recent = { nowMs: DAY + 1000, horizonDays: 30, deferDays: 3 };
    const fitted = fitLearningModel([observation(DAY)], recent.nowMs);
    expect(prepareLearningActionCompletionValue(fitted, action, recent)(20)).toBeCloseTo(
      evaluateLearningAction(fitted, action, { ...recent, completionSeconds: 20 }).expectedCapabilityDays, 12);
    expect(model).toEqual(before);
  });

  it('compares execution orders using the second task value at its delayed completion', () => {
    const base = evaluateLearningAction(fitLearningModel([], DAY), action, { nowMs: DAY, horizonDays: 1, deferDays: 0 });
    const first = { ...base, key: 'long', addresses: ['long'], expectedCapabilityDays: 3,
      completionSamples: [{ seconds: 20, expectedCapabilityDays: 3 }] };
    const second = { ...base, key: 'brief', addresses: ['brief'], expectedCapabilityDays: 2,
      completionSamples: [{ seconds: 2, expectedCapabilityDays: 2 }] };
    const opportunity = { availableSeconds: [30], continuationValue: 0,
      delayedValue: (value: typeof base, delay: number, seconds: number) =>
        value.key === 'long' && delay === 2 && seconds === 20 ? 2.5 : 0 };
    // brief -> long gives 2 + 2.5; long -> brief gives 3 + 0.
    expect(chooseLearningSequence([first, second], opportunity)).toMatchObject({ keys: ['brief', 'long'], value: 4.5 });
  });

  it('does not select a pair when delaying its second task removes its marginal benefit', () => {
    const base = evaluateLearningAction(fitLearningModel([], DAY), action, { nowMs: DAY, horizonDays: 1, deferDays: 0 });
    const values = ['a', 'b'].map(key => ({ ...base, key, addresses: [key], expectedCapabilityDays: 2,
      completionSamples: [{ seconds: 10, expectedCapabilityDays: 2 }] }));
    const opportunity = { availableSeconds: [30], continuationValue: 0, delayedValue: () => 0 };
    expect(chooseLearningSequence(values, opportunity)).toMatchObject({ keys: ['a'], value: 2 });
  });

  it('withholds instructional credit when estimated completion is beyond the performance point and trajectory', () => {
    const model = fitLearningModel([], DAY);
    const value = evaluateLearningAction(model, action,
      { nowMs: DAY, horizonDays: 1 / 86400, deferDays: 1, assessmentAt: DAY + 1000 });
    expect(value.expectedCapabilityDays).toBe(0);
    expect(value.performance[0].oneActionNow).toEqual(value.performance[0].noExtraStudy);
  });
  it('integrates completion-dependent benefit with the same effort draws that determine feasibility', () => {
    const model = fitLearningModel([], DAY);
    const context = { nowMs: DAY, horizonDays: 40 / 86400, deferDays: 0, assessmentAt: DAY + 30000 };
    const value = evaluateLearningAction(model, action, context);
    const draws = value.completionSamples!;
    expect(draws).toHaveLength(5);
    const conditional = draws.map(draw => evaluateLearningAction(model, action, { ...context, completionSeconds: draw.seconds }));
    expect(value.expectedCapabilityDays).toBeCloseTo(conditional.reduce((sum, row) => sum + row.expectedCapabilityDays / 5, 0), 12);
    expect(value.performance[0].oneActionNow.mean).toBeCloseTo(conditional.reduce((sum, row) => sum + row.performance[0].oneActionNow.mean / 5, 0), 12);
    const plan = chooseLearningSequence([value], { availableSeconds: [20], continuationValue: 0 });
    const feasibleValue = draws.reduce((sum, draw) => sum + (draw.seconds <= 20 ? draw.expectedCapabilityDays : 0) / draws.length, 0);
    expect(plan.value).toBeCloseTo(feasibleValue, 12);
    expect(plan.value).not.toBeCloseTo(value.expectedCapabilityDays * draws.filter(draw => draw.seconds <= 20).length / draws.length, 8);
  });
  it('can retain a valuable feasible completion branch even when the unconditional mean is negative', () => {
    const base = evaluateLearningAction(fitLearningModel([], DAY), action, { nowMs: DAY, horizonDays: 1, deferDays: 1 });
    const value = { ...base, expectedCapabilityDays: -1, completionSamples: [
      { seconds: 1, expectedCapabilityDays: 1 }, { seconds: 100, expectedCapabilityDays: -3 },
    ] };
    expect(chooseLearningSequence([value], { availableSeconds: [10], continuationValue: 0 })).toMatchObject({ keys: ['practice'], value: 0.5 });
    expect(chooseLearningSequence([value], { availableSeconds: [100], continuationValue: 0 }).keys).toEqual([]);
  });
  it('projects repeated physical teaching without fabricating observations or changing the canonical fitted state', () => {
    const model = fitLearningModel([observation(DAY)], 3 * DAY);
    const before = structuredClone(model);
    const one = projectLearningIntervention(model, action, 3 * DAY, 512);
    const expected = evaluateLearningAction(model, action, { nowMs: 3 * DAY, horizonDays: 7, deferDays: 0,
      completionSeconds: 0 }).performance[0].oneActionNow;
    expect(predictRecall(one, address, 10 * DAY).mean).toBeCloseTo(expected.mean, 12);
    const untouched = learningAddress({ entityId: 'unknown', capability: 'future::other' });
    expect(predictRecall(one, untouched, 10 * DAY)).toEqual(predictRecall(model, untouched, 10 * DAY));
    expect(one.observations).toBe(model.observations);
    expect(one.memories[address].observations).toBe(model.memories[address].observations);
    let bounded = model;
    for (let index = 0; index < 20; index++) bounded = projectLearningIntervention(bounded, action, (3 + index * 3) * DAY);
    expect(bounded.memories[address].particles.length).toBeLessThanOrEqual(128);
    expect(bounded.validation).toEqual(model.validation);
    let finer = model;
    for (let index = 0; index < 20; index++) finer = projectLearningIntervention(finer, action, (3 + index * 3) * DAY, 512);
    expect(Math.abs(predictRecall(bounded, address, 65 * DAY).mean - predictRecall(finer, address, 65 * DAY).mean)).toBeLessThan(0.05);
    expect(model).toEqual(before);
  });
  it('does not simulate teaching from diagnosis, undeclared immersion or immediate repetition', () => {
    const model = fitLearningModel([observation(DAY)], 3 * DAY);
    expect(projectLearningIntervention(model, { ...action, mode: 'diagnostic' }, 3 * DAY)).toBe(model);
    expect(projectLearningIntervention(model, { ...action, mode: 'immersion' }, 3 * DAY)).toBe(model);
    const next = projectLearningIntervention(model, action, 3 * DAY);
    expect(projectLearningIntervention(next, action, 3 * DAY + 1000)).toBe(next);
    expect(projectLearningIntervention(model, { ...action, targets: [target, target] }, 3 * DAY, 512))
      .toEqual(projectLearningIntervention(model, action, 3 * DAY, 512));
  });
  it('learns only newly declared Word Sync retrieval tasks, leaving legacy familiarity reports unchanged', () => {
    const declared = observation(DAY, 'fluent', { taskType: 'word-sync', method: 'recall',
      decision: { id: 'new-retrieval', at: DAY, policyVersion: 'new',
        selected: { key: 'word', action: 'PROBE', targets: [{ kind: 'surface', id: target.entityId, capability: target.capability }],
          task: { taskTemplateId: 'word-sync', inputModality: 'written-form', responseModality: 'recall',
            supplied: [], requested: [target.capability], fluencyRequired: false, ratingMode: 'profile' } }, baseline: null, detail: {} } });
    expect(fitLearningModel([declared], 2 * DAY).observations).toBe(1);
    expect(fitLearningModel([{ ...declared, decision: undefined }], 2 * DAY).observations).toBe(0);
    expect(fitLearningModel([{ ...declared, method: 'inference' }], 2 * DAY).observations).toBe(0);
    expect(fitLearningModel([{ ...declared, scaffolds: { 'prior-cue-exposure': true } }], 2 * DAY).observations).toBe(0);
  });
  it('keeps exposure, claims and supplied answers out of observed recall', () => {
    const prior = fitLearningModel([], 5 * DAY);
    const model = fitLearningModel([observation(DAY, 'fluent', { kind: 'claim', toStatus: 'known' }),
      observation(2 * DAY, 'fluent', { scaffolds: { [`provided-access:${target.capability}`]: true } }),
      observation(3 * DAY, 'fluent', { kind: 'rollup', timesSeenDelta: 100 })], 5 * DAY);
    expect(predictRecall(model, address, 6 * DAY)).toEqual(predictRecall(prior, address, 6 * DAY));
    expect(model.observations).toBe(0);
  });
  it('preserves explicit inference as distinct from recall even for scheduler-admitted SRS work', () => {
    const inferred = observation(DAY, 'fluent', { method: 'inference' });
    const admitted = { ...inferred, decision: {
      id: 'scheduler-inference', at: DAY, policyVersion: 'existing',
      selected: { key: 'review', action: 'PROBE' as const,
        targets: [{ kind: 'surface' as const, id: target.entityId, capability: target.capability }],
        task: { taskTemplateId: 'srs-review', inputModality: 'written-form', responseModality: 'recall',
          supplied: [], requested: [target.capability], fluencyRequired: false, ratingMode: 'profile' as const } },
      baseline: null, detail: { scope: 'scheduler-admitted-workload' },
    } };
    const before = structuredClone(admitted);
    for (const event of [inferred, admitted]) {
      const model = fitLearningModel([event], 2 * DAY);
      expect(model.observations).toBe(0);
      expect(model.memories[address]).toBeUndefined();
    }
    expect(admitted).toEqual(before);
    expect(fitLearningModel([{ ...admitted, method: 'recall' }], 2 * DAY).observations).toBe(1);
    expect(fitLearningModel([observation(DAY)], 2 * DAY).observations).toBe(1);
  });
  it('uses compatible delayed outcomes and excludes retracted attempts reproducibly', () => {
    const rows = [observation(DAY), observation(3 * DAY), observation(7 * DAY)];
    const fitted = fitLearningModel(rows, 8 * DAY);
    expect(fitted.validation.delayedPredictions).toBe(2);
    expect(fitted.validation.brier).toBeGreaterThanOrEqual(0);
    expect(predictRecall(fitted, address, 9 * DAY).mean).toBeGreaterThan(predictRecall(fitLearningModel([], 8 * DAY), address, 9 * DAY).mean);
    expect(fitLearningModel([...rows, { t: 8 * DAY, kind: 'retraction', source: 'manual', retracts: 'attempt-604800000' }], 8 * DAY)).toEqual(fitLearningModel(rows.slice(0, 2), 8 * DAY));
    expect(fitLearningModel(rows, 8 * DAY)).toEqual(fitted);
  });
  it('does not fit instruction effectiveness on immediate revealed-answer repetition or self assessment', () => {
    const model = fitLearningModel([observation(DAY), observation(DAY + 1000), observation(4 * DAY, 'fluent', {
      decision: { id: 'sync', at: 4 * DAY, policyVersion: 'v', selected: { key: 'a', action: 'PROBE', targets: [{ kind: 'surface', id: target.entityId, capability: target.capability }], task: { taskTemplateId: 'word-sync', inputModality: 'written', responseModality: 'self-assessment', supplied: [], requested: [target.capability], fluencyRequired: false, ratingMode: 'profile' } }, baseline: null, detail: {} },
    })], 5 * DAY);
    expect(model.validation.delayedPredictions).toBe(0);
  });
  it('predicts task-conditioned effort from clean active timing, not minutes times cards', () => {
    const model = fitLearningModel([observation(DAY, 'fluent', { activeLatencyMs: 10000 }), observation(2 * DAY, 'fluent', { activeLatencyMs: 20000 }), observation(3 * DAY, 'fluent', { activeLatencyMs: 999000, stalled: true })], 4 * DAY);
    const value = evaluateLearningAction(model, action, { nowMs: 4 * DAY, horizonDays: 14, deferDays: 2 });
    expect(value.effort.samples).toBe(2);
    expect(value.effort.meanSeconds).toBeLessThan(60);
    expect(value.counterfactual).toBe('defer-to-next-opportunity');
    expect(value.expectedCapabilityDays).toBeGreaterThanOrEqual(0);
    expect(value.interval[1]).toBeGreaterThan(value.interval[0]);
  });
  it('never counts diagnostic belief revision as learning', () => {
    const value = evaluateLearningAction(fitLearningModel([], DAY), { ...action, mode: 'diagnostic' }, { nowMs: DAY, horizonDays: 14, deferDays: 2 });
    expect(value.expectedCapabilityDays).toBe(0);
    expect(value.informationOnly).toBe(true);
  });
  it('uses declared immersion transfer for its expectation and alternatives only for sensitivity', () => {
    const model = fitLearningModel([], DAY);
    const context = { nowMs: DAY, horizonDays: 14, deferDays: 2 };
    const immersion = { ...action, mode: 'immersion' as const, transfer: { probability: 0.1, provenance: 'unfitted qualitative bridge' } };
    const nominal = evaluateLearningAction(model, immersion, context);
    const sensitivity = evaluateLearningAction(model, { ...immersion, transfer: { ...immersion.transfer, sensitivity: [0, 0.1, 0.3] } }, context);
    expect(sensitivity.expectedCapabilityDays).toBeCloseTo(nominal.expectedCapabilityDays, 12);
    expect(sensitivity.interval).not.toEqual(nominal.interval);
    expect(evaluateLearningAction(model, { ...immersion, transfer: undefined }, context).expectedCapabilityDays).toBe(0);
  });
  it('updates from declared self-reported recall without treating ordinary self-assessment as recall', () => {
    const recalled = observation(DAY, 'fluent', { taskType: 'future-task', method: 'recall' });
    expect(fitLearningModel([recalled], 2 * DAY).observations).toBe(1);
    expect(fitLearningModel([{ ...recalled, method: undefined }], 2 * DAY).observations).toBe(0);
  });
  it('compares total feasible sequence benefit and preserves immersion as the explicit alternative', () => {
    const model = fitLearningModel([], DAY);
    const context = { nowMs: DAY, horizonDays: 14, deferDays: 2 };
    const values = [evaluateLearningAction(model, { ...action, key: 'one' }, context), evaluateLearningAction(model, { ...action, key: 'duplicate' }, context)];
    const plan = chooseLearningSequence(values, { availableSeconds: [60, 120, 180], continuationValue: 0 });
    expect(plan.keys).toHaveLength(1);
    expect(plan.alternative).toBe('continue-immersion');
    expect(chooseLearningSequence(values, { availableSeconds: [60], continuationValue: 1e6 }).keys).toEqual([]);
  });
  it('records role and provenance for every consequential model assumption', () => {
    expect(MODEL_ASSUMPTIONS.every(item => item.id && item.role && item.provenance)).toBe(true);
  });
  it('does not let an endless stream of cheap tasks postpone the valuable longer member of a plan', () => {
    const model = fitLearningModel([], DAY);
    const context = { nowMs: DAY, horizonDays: 30, deferDays: 3 };
    const short = evaluateLearningAction(model, { ...action, key: 'short', durationSeconds: 5 }, context);
    const long = evaluateLearningAction(model, { ...action, key: 'long', durationSeconds: 100,
      targets: Array.from({ length: 20 }, (_, index) => ({ ...target, entityId: `future:long:${index}` })) }, context);
    const plan = chooseLearningSequence([short, long], { availableSeconds: [600, 900], continuationValue: 0 });
    expect(plan.keys).toEqual(['long', 'short']);
  });
  it('retains early gains over long horizons instead of evaluating only the endpoint', () => {
    const model = fitLearningModel([], DAY);
    const value = evaluateLearningAction(model, action, { nowMs: DAY, horizonDays: 10000, deferDays: 3 });
    expect(value.expectedCapabilityDays).toBeGreaterThan(0);
    expect(Number.isFinite(value.expectedCapabilityDays)).toBe(true);
  });
  it('reports a forward baseline comparison without requiring the model to win on selected history', () => {
    const rows = [observation(DAY), observation(8 * DAY, 'missed'), observation(32 * DAY), observation(64 * DAY, 'missed')];
    const model = fitLearningModel(rows, 65 * DAY);
    expect(model.validation.delayedPredictions).toBe(3);
    expect(model.validation.constantHalfBrier).toBe(0.25);
    expect(model.validation.lastOutcomeBrier).toBe(1);
    expect(model.validation.brier).toBeGreaterThanOrEqual(0);
    expect(model.validation.brier).toBeLessThanOrEqual(1);
  });
  it('validates the forecast of the observed report, rather than comparing a latent possession prediction to a noisy answer', () => {
    const priorToAnswer = fitLearningModel([observation(DAY)], 3 * DAY);
    const latent = predictRecall(priorToAnswer, address, 3 * DAY).mean;
    const reportProbability = 0.1 + 0.8 * latent;
    const scored = fitLearningModel([observation(DAY), observation(3 * DAY)], 3 * DAY);
    expect(scored.validation.brier).toBeCloseTo((1 - reportProbability) ** 2, 12);
  });
  it('does not extrapolate extra benefit from repeating the same revealed recall task immediately', () => {
    const model = fitLearningModel([observation(DAY)], DAY + 1000);
    const value = evaluateLearningAction(model, action, { nowMs: DAY + 1000, horizonDays: 14, deferDays: 2 });
    expect(value.expectedCapabilityDays).toBeLessThanOrEqual(0);
    const unknown = evaluateLearningAction(model, { ...action, key: 'unseen', targets: [{ ...target, entityId: 'future:new' }] }, { nowMs: DAY + 1000, horizonDays: 14, deferDays: 2 });
    expect(chooseLearningSequence([value, unknown], { availableSeconds: [120, 300], continuationValue: 0 }).keys).toEqual(['unseen']);
  });
  it('integrates uncertain effort instead of rejecting everything above a mean duration cutoff', () => {
    const value = evaluateLearningAction(fitLearningModel([], DAY), { ...action, durationSeconds: 100 }, { nowMs: DAY, horizonDays: 14, deferDays: 2 });
    expect(value.effort.meanSeconds).toBeGreaterThan(60);
    const uncertain = chooseLearningSequence([value], { availableSeconds: [60], continuationValue: 0 });
    expect(uncertain.keys).toEqual(['practice']);
    expect(uncertain.value).toBeGreaterThan(0);
    expect(uncertain.value).toBeLessThan(value.expectedCapabilityDays);
  });
  it('separates current performance from one-action and no-extra-study forecasts at the required date', () => {
    const model = fitLearningModel([observation(DAY)], 4 * DAY);
    const value = evaluateLearningAction(model, action, { nowMs: 4 * DAY, horizonDays: 30, deferDays: 2, assessmentAt: 14 * DAY });
    const forecast = value.performance[0];
    expect(forecast.current).toEqual(predictRecall(model, address, 4 * DAY));
    expect(forecast.at).toBe(14 * DAY);
    expect(forecast.noExtraStudy.mean).toBeLessThan(forecast.current.mean);
    expect(forecast.oneActionNow.mean).toBeGreaterThan(forecast.noExtraStudy.mean);
    expect(forecast.condition).toBe('one-action-only; not a future-study guarantee');
    expect(value.expectedCapabilityDays).toBeGreaterThan(0);
  });
  it('does not revise current or no-study predictions merely by changing the prospective activity family', () => {
    const model = fitLearningModel([observation(DAY), observation(3 * DAY), observation(7 * DAY)], 8 * DAY);
    model.kernelWeights.alternative = [0, 0, 1];
    const context = { nowMs: 8 * DAY, horizonDays: 30, deferDays: 3, assessmentAt: 20 * DAY };
    const before = evaluateLearningAction(model, action, context).performance[0];
    const alternative = evaluateLearningAction(model, { ...action, family: 'alternative' }, context).performance[0];
    expect(alternative.current).toEqual(before.current);
    expect(alternative.noExtraStudy).toEqual(before.noExtraStudy);
    expect(alternative.oneActionNow.mean).not.toBe(before.oneActionNow.mean);
  });
  it('withholds an intervention forecast when it occurs after the assessment or only diagnoses', () => {
    const model = fitLearningModel([], DAY);
    const context = { nowMs: DAY, horizonDays: 30, deferDays: 20, assessmentAt: 10 * DAY };
    const forecast = evaluateLearningAction(model, action, context).performance[0];
    expect(forecast.oneActionDeferred).toEqual(forecast.noExtraStudy);
    const diagnostic = evaluateLearningAction(model, { ...action, mode: 'diagnostic' }, context).performance[0];
    expect(diagnostic.oneActionNow).toEqual(diagnostic.noExtraStudy);
    expect(diagnostic.current.priorDriven).toBe(true);
  });
});
