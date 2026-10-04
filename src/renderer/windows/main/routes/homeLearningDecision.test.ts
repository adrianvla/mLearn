import { describe, expect, it } from 'vitest';
import { chooseHomeLearningAction, homePracticePool } from './homeLearningDecision';
import { fitLearningModel, learningAddress } from '../../../../shared/learningModel';
const target = { entityId: 'future:surface:a', capability: 'sense-recognition' };
const context = { nowMs: 10, horizonDays: 30, deferDays: 3 };
describe('Home consumes actual action estimates', () => {
  it('does not offer a second intervention whose completion is beyond the evaluated trajectory', () => {
    const model = fitLearningModel([], 10);
    const n = 1000000;
    model.efforts['task'] = { n, logSum: n * Math.log(10), logSquareSum: n * Math.log(10) ** 2 };
    const choice = chooseHomeLearningAction(model, ['a', 'b'].map(key => ({ action: 'practice' as const,
      key, family: 'task', mode: 'practice' as const, targets: [{ ...target, entityId: key }] })),
      { ...context, horizonDays: 15 / 86400, deferDays: 0, assessmentAt: 15010 }, [30]);
    expect(choice.trace.evaluations.every(value => value.expectedCapabilityDays > 0)).toBe(true);
    expect(choice.trace.sequence).toHaveLength(1);
  });

  it('admits observed scope maintenance without equating a Known claim with readiness or truncating unresolved work', () => {
    const day = 86_400_000;
    const model = fitLearningModel([{ t: day, kind: 'rating', source: 'srs', taskType: 'srs-review',
      quality: 'fluent', attemptId: 'observed', targetRef: { kind: 'surface', id: target.entityId, capability: target.capability } }], 40 * day);
    const pool = homePracticePool(model, new Map([[target.entityId, 'observed'], ['future:claim', 'claim-only']]),
      Array.from({ length: 40 }, (_, i) => `new-${i}`), () => true, 40 * day, 60 * day);
    expect(pool.filter(item => item.intent === 'reinforce').map(item => item.word)).toEqual(['observed']);
    expect(pool).toHaveLength(41);
    expect(pool.some(item => item.word === 'claim-only')).toBe(false);
    const recent = { ...model, memories: { ...model.memories, [learningAddress(target)]: {
      ...model.memories[learningAddress(target)], lastAt: 40 * day } } };
    expect(homePracticePool(recent, new Map([[target.entityId, 'observed']]), [], () => true, 40 * day, 60 * day)).toEqual([]);
  });
  it('keeps selected immersion eligible when practice is infeasible without turning a backlog into an obligation', () => {
    const model = fitLearningModel([], 10);
    const result = chooseHomeLearningAction(model, [
      { action: 'review', key: 'due', family: 'srs-review', mode: 'practice', targets: [target], durationSeconds: 10000 },
      { action: 'continue', key: 'book', family: 'reader', mode: 'immersion', targets: [], durationSeconds: 120 },
    ], context, [60, 120, 300]);
    expect(result.selected.action).toBe('continue');
    expect(result.trace.alternative).toBe('book');
    expect(result.trace.evaluations[0].effort.source).toContain('prior');
  });
  it('hands useful bounded work to the existing activity and records effect/cost uncertainty', () => {
    const model = fitLearningModel([], 10);
    const result = chooseHomeLearningAction(model, [{ action: 'practice', key: 'learn', family: 'word-sync', mode: 'practice', targets: [target] }], context, [60, 120, 300]);
    expect(result.selected.key).toBe('learn');
    expect(result.encounterLimit).toBeGreaterThan(0);
    expect(result.encounterLimit).toBeLessThanOrEqual(12);
    expect(result.trace.evaluations[0].interval[1]).toBeGreaterThan(result.trace.evaluations[0].interval[0]);
  });
  it('lets a valuable later candidate select the actual Home handoff', () => {
    const model = fitLearningModel([], 10);
    const candidates = Array.from({ length: 100 }, (_, index) => ({ action: 'grammar' as const,
      key: `grammar:${index}`, family: 'grammar-self-assess', mode: 'practice' as const,
      targets: [{ ...target, entityId: `future:${index}` }], patterns: [`pattern:${index}`] }));
    const result = chooseHomeLearningAction(model, candidates, { ...context,
      targetWeights: Object.fromEntries(candidates.map((candidate, index) => [learningAddress(candidate.targets[0]), index === 99 ? 1 : 0.01])) }, [60, 120, 300]);
    expect(result.selected.key).toBe('grammar:99');
    expect(result.trace.evaluations.some(value => value.key === 'grammar:99')).toBe(true);
  });
  it('does not value two mutually exclusive first activities on the same review card as an executable pair', () => {
    const model = fitLearningModel([], 10);
    const result = chooseHomeLearningAction(model, [
      { action: 'review', key: 'written', family: 'written-task', cardId: 'same-card', mode: 'practice', targets: [target],
        measurement: { address: learningAddress(target), provenance: 'Prospective unsupplied written recall' } },
      { action: 'review', key: 'sound', family: 'sound-task', cardId: 'same-card', mode: 'practice', targets: [{ ...target, capability: 'future::sound' }] },
    ], context, [600]);
    expect(result.trace.sequence).toHaveLength(1);
    expect(result.selected.exclusiveOpportunityGroups).toContain('review-card:same-card');
    const information = result.trace.evaluations.find(value => value.key === 'written')!.information!;
    expect(information.branches.every(branch => branch.selected.length <= 1)).toBe(true);
  });
  it('preserves declared physical constraints alongside the Review card constraint', () => {
    const model = fitLearningModel([], 10);
    const result = chooseHomeLearningAction(model, [
      { action: 'review', key: 'written', family: 'written-task', cardId: 'first', mode: 'practice', targets: [target],
        exclusiveOpportunityGroups: ['opaque:shared-device'] },
      { action: 'practice', key: 'different', family: 'other-task', mode: 'practice', targets: [{ ...target, capability: 'future::other' }],
        exclusiveOpportunityGroups: ['opaque:shared-device'] },
    ], context, [600]);
    expect(result.trace.sequence).toHaveLength(1);
    if (result.selected.key === 'written') expect(result.selected.exclusiveOpportunityGroups).toEqual(['opaque:shared-device', 'review-card:first']);
  });
  it('exposes a decision reversal under an unvalidated immersion-transfer assumption', () => {
    const model = fitLearningModel([], 10);
    const choose = (probability: number) => chooseHomeLearningAction(model, [
      { action: 'practice', key: 'learn', family: 'word-sync', mode: 'practice', targets: [target] },
      { action: 'continue', key: 'book', family: 'reader', mode: 'immersion', targets: Array.from({ length: 4 }, (_, index) => ({ ...target, entityId: `future:book:${index}` })),
        transfer: { probability, provenance: 'sensitivity scenario; not a fitted effect' } },
    ], context, [600, 900]);
    expect(choose(0).selected.action).toBe('practice');
    expect(choose(1).selected.action).toBe('continue');
    expect(choose(1).trace.evaluations.find(value => value.key === 'book')?.transferProvenance).toContain('not a fitted effect');
  });
});
