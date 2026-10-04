import { describe, expect, it, vi } from 'vitest';
import { selectNext, replayFromTrace, POLICY_TRACE_VERSION, POLICY_RANKING_CAP, POLICY_TRACE_DETAIL_CAP } from './teachingPolicy';
import type { Candidate, EncounterTask } from './types';
import { fitLearningModel, learningAddress } from '../../shared/learningModel';

const task: EncounterTask = { taskTemplateId: 'srs-review', inputModality: 'text', responseModality: 'recall', supplied: [], requested: ['future::access'], fluencyRequired: false, ratingMode: 'profile' };
const candidate = (key: string, origin: Candidate['origin'] = 'curriculum'): Candidate => ({ key, language: 'future', origin, targets: [{ entityId: key, capability: 'future::access' }], scores: { novelty: 1 } });
const config = () => ({ weights: { novelty: 1 }, deferFloor: 0, attentionBudgetRemaining: 1, probeBudgetRemaining: 1, probeCooldownMs: 1000, nowMs: 10000, cooldowns: new Map<string, number>(), recentPicks: [] as string[], minRepeatDistance: 0, task });

describe('model-driven TeachingPolicy', () => {
  it('uses ordered completion timing in the actual shared activity selection', () => {
    const model = fitLearningModel([], 10000);
    const n = 1000000;
    model.efforts['srs-review'] = { n, logSum: n * Math.log(10), logSquareSum: n * Math.log(10) ** 2 };
    const selected = selectNext([candidate('a'), candidate('b')], { ...config(), context: { learning: {
      model, horizonDays: 15 / 86400, deferDays: 0, availableSeconds: [30], continuationValue: 0 } } })!;
    expect(selected.trace!.model!.evaluations.every(value => value.expectedCapabilityDays > 0)).toBe(true);
    expect(selected.trace!.model!.sequence).toHaveLength(1);
  });

  it('returns no decision for an empty pool and defers exhausted attention', () => {
    expect(selectNext([], config())).toBeNull();
    expect(selectNext([candidate('a')], { ...config(), attentionBudgetRemaining: 0 })?.action).toBe('DEFER');
  });
  it('does not turn source priority, uncertainty or structural association into a learning effect', () => {
    const pool = [candidate('a'), { ...candidate('b'), scores: { novelty: 1e9, 'declared-support': 1e9 } }];
    expect(selectNext(pool, config())?.candidate.key).toBe('a');
    expect(selectNext([candidate('probe', 'probe')], config())?.action).toBe('DEFER');
    expect(selectNext([candidate('bridge', 'bridge')], config())?.action).toBe('DEFER');
  });
  it('preserves hysteresis, admission and probe exclusions independently of source scores', () => {
    const selected = selectNext([candidate('a'), candidate('b')], { ...config(), recentPicks: ['a'], minRepeatDistance: 1 })!;
    expect(selected.candidate.key).toBe('b');
    expect(selected.trace!.exclusions).toContainEqual({ key: 'a', reason: 'blocked by hysteresis (recent pick)' });
    const probe = selectNext([candidate('p', 'probe')], { ...config(), probeBudgetRemaining: 0 })!;
    expect(probe.action).toBe('DEFER');
    expect(probe.trace!.exclusions).toContainEqual({ key: 'p', reason: 'probe budget exhausted' });
    expect(selectNext([candidate('p', 'probe')], { ...config(), cooldowns: new Map([['p', 9500]]) })!.trace!.exclusions[0].reason).toContain('cooldown');
  });
  it('uses explicit access requirements and keeps labels and intensity out of effect math', () => {
    const learning = { model: fitLearningModel([], 10000, 'journal:42'), horizonDays: 30, deferDays: 3, availableSeconds: [120, 300], continuationValue: 0,
      targetWeights: { [learningAddress(candidate('b').targets[0])]: 1 } };
    const pool = [candidate('a'), candidate('b', 'retention')];
    const a = selectNext(pool, { ...config(), context: { learning, intensity: 'gentle', goal: { kind: 'outcome', target: 'old label' } } })!;
    const b = selectNext(pool, { ...config(), context: { learning, intensity: 'intensive', goal: { kind: 'outcome', target: 'renamed' } } })!;
    expect(a.candidate.key).toBe('b');
    expect(a.action).toBe('MAINTAIN');
    expect(b.candidate.key).toBe(a.candidate.key);
    expect(b.trace!.model).toEqual(a.trace!.model);
  });
  it('keeps the actual package task and scaffolds frozen in the decision', () => {
    const custom = { ...task, taskTemplateId: 'future::task', requested: ['future::other'] };
    const selected = selectNext([{ ...candidate('a'), task: custom }], { ...config(), scaffolds: [{ id: 'cue', supplied: ['text'] }] })!;
    expect(selected.encounter.task).toEqual(custom);
    expect(selected.trace!.ranking[0].task).toEqual(custom);
  });
  it('emits bounded effects, effort, uncertainty and counterfactual provenance without random draws', () => {
    const random = vi.fn(() => { throw new Error('No policy random draw'); });
    const pool = Array.from({ length: 25 }, (_, i) => candidate(String(i)));
    const selected = selectNext(pool, config(), random)!;
    const trace = selected.trace!;
    expect(trace.version).toBe(POLICY_TRACE_VERSION);
    expect(trace.ranking).toHaveLength(POLICY_RANKING_CAP);
    expect(trace.model!.evaluations).toHaveLength(POLICY_TRACE_DETAIL_CAP);
    expect(trace.model!.evaluationsOmitted).toBe(9);
    expect(trace.model!.evaluations[0]).toMatchObject({ counterfactual: 'defer-to-next-opportunity', priorDriven: true, effort: { source: 'unfitted-task-effort-prior' } });
    expect(trace.inputs.candidateCount).toBe(pool.length);
    expect(trace.selectedKey).toBe(selected.candidate.key);
    expect(trace.weights).toEqual({ base: {}, effective: {}, rules: [] });
    expect(trace.inputs.rng.draws).toEqual([]);
    expect(random).not.toHaveBeenCalled();
    expect(replayFromTrace(trace, pool)).toBeNull();
    expect(trace.limits.join(' ')).toContain('model/evidence snapshot');
  });
  it('reproduces estimation and selection from identical model, evidence and candidate inputs', () => {
    const learning = { model: fitLearningModel([], 10000, 'journal:42'), horizonDays: 14, deferDays: 2, availableSeconds: [60, 180], continuationValue: 0 };
    const inputs = { ...config(), context: { learning } };
    expect(selectNext([candidate('a'), candidate('b')], inputs)).toEqual(selectNext([candidate('a'), candidate('b')], inputs));
    expect(selectNext([candidate('a')], { ...inputs, context: { learning: { ...learning, continuationValue: 1e9 } } })?.action).toBe('DEFER');
  });
});
