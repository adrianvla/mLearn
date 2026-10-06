import { describe, expect, it, vi } from 'vitest';
import { selectNext, replayFromTrace, POLICY_TRACE_VERSION, POLICY_RANKING_CAP, POLICY_TRACE_DETAIL_CAP } from './teachingPolicy';
import type { Candidate, EncounterTask } from './types';
import { fitLearningModel, learningAddress } from '../../shared/learningModel';
import { evaluateLearningRequirements } from '../../shared/learningRequirementEvaluation';
import { surfaceEntityId } from '../../shared/graph/load';
import { hashWordSync } from '../../shared/utils/wordHash';
import type { LearningGoal } from '../../shared/learningGoals';
import type { KnowledgeEvent } from '../../shared/knowledgeEvents';
import type { LanguageData } from '../../shared/types';

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
  it('selects against each requirement on its own target and assessment date', () => {
    const model = fitLearningModel([], 10000);
    const aAddress = learningAddress(candidate('a').targets[0]);
    const bAddress = learningAddress(candidate('b').targets[0]);
    const evaluate = (address: string, assessmentAt: number) => selectNext([candidate('a'), candidate('b')], {
      ...config(), context: {
        learning: { model, horizonDays: 30, deferDays: 3, availableSeconds: [120], continuationValue: 0, targetWeights: {} },
        requirementEvaluations: [{ goalId: 'goal', language: 'future', outcomeId: 'objective', deadline: new Date(assessmentAt).toISOString().slice(0, 10),
          status: 'unmet', requirements: [{ goalId: 'goal', requirementId: `condition-${address}`, source: 'package', kind: 'canonical-capability-threshold',
            status: 'unmet', conditions: {}, conditional: true, deadline: new Date(assessmentAt).toISOString().slice(0, 10), deadlineMs: assessmentAt,
            selection: { assessmentAt, horizonDays: (assessmentAt - 10000) / 86_400_000, targetWeights: { [address]: 1 } } }] }],
      },
    })!;

    const first = evaluate(aAddress, 10000 + 86_400_000);
    const second = evaluate(bAddress, 10000 + 3 * 86_400_000);
    expect(first.candidate.key).toBe('a');
    expect(second.candidate.key).toBe('b');
    expect(first.trace!.model!.requirementEvaluations?.[0]).toMatchObject({ assessmentAt: 10000 + 86_400_000, horizonDays: 1 });
    expect(second.trace!.model!.requirementEvaluations?.[0]).toMatchObject({ assessmentAt: 10000 + 3 * 86_400_000, horizonDays: 3 });
  });
  it('changes the next action when a supported canonical threshold changes from met to unmet', () => {
    const now = Date.parse('2026-10-04');
    const assessmentAt = Date.parse('2026-10-14');
    const capability = 'future-language::recall';
    const alphaId = surfaceEntityId('future', hashWordSync('alpha'));
    const betaId = surfaceEntityId('future', hashWordSync('beta'));
    const events: KnowledgeEvent[] = [{ t: now, kind: 'rating', source: 'srs', rating: 'easy', quality: 'easy',
      attemptId: 'alpha-attempt', eventId: 'alpha-event', taskType: 'srs-review', method: 'recall',
      targetRef: { kind: 'surface', id: alphaId, capability } }];
    const model = fitLearningModel(events, now);
    const goal: LearningGoal = { id: 'threshold-goal', language: 'future', outcome: 'Alpha objective',
      outcomeRef: { id: 'objective', packageVersion: 'future-v2' }, status: 'active', priority: 1, createdAt: now,
      deadline: '2026-10-14' };
    const packageData = (minimum: number): LanguageData => ({ name: 'Future', languageData: { version: 'future-v2', assets: [] },
      freq: [['alpha', '', 1]], frequencyLevels: { rowLevelIndex: 2 }, learning: { outcomes: { objective: {
        label: 'Alpha objective', provenance: 'package', groups: [{ id: 'alpha', selectors: [{ source: 'frequency', words: ['alpha'] }] }],
        requirements: { conditions: [{ id: 'alpha-floor', kind: 'canonical-capability-threshold', groupIds: ['alpha'], capability, minimum }] },
      } } } });
    const highEvaluation = evaluateLearningRequirements([goal], 'future', model, events, packageData(0.99), now)[0];
    const predicted = highEvaluation.requirements[0].targets![0].mean!;
    const lowEvaluation = evaluateLearningRequirements([goal], 'future', model, events, packageData(predicted), now)[0];
    const toWordCandidate = (word: string, entityId: string) => ({ ...candidate(word), word,
      targets: [{ entityId, capability }], task: { ...task, taskTemplateId: 'future-intervention' } });
    const run = (evaluation: typeof highEvaluation) => selectNext([
      toWordCandidate('beta', betaId),
      toWordCandidate('alpha', alphaId),
    ], { ...config(), nowMs: now, context: { learning: { model, horizonDays: 30, deferDays: 3,
      availableSeconds: [120], continuationValue: 0, targetWeights: { [learningAddress({ entityId: betaId, capability })]: 1 } },
      requirementEvaluations: [evaluation] } })!;

    expect(lowEvaluation.requirements[0].status).toBe('met');
    expect(highEvaluation.requirements[0].status).toBe('unmet');
    expect(run(lowEvaluation).candidate.key).toBe('beta');
    expect(run(highEvaluation).candidate.key).toBe('alpha');
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
