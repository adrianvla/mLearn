import { describe, expect, it } from 'vitest';
import { selectNext } from './teachingPolicy';
import { fitLearningModel } from '../../shared/learningModel';
import type { Candidate } from './types';
const task = { taskTemplateId: 'srs-review', inputModality: 'written', responseModality: 'recall', supplied: [], requested: ['sense-recognition'], fluencyRequired: true, ratingMode: 'profile' as const };
const candidate = (key: string, score: number): Candidate => ({ key, language: 'future', targets: [{ entityId: key, capability: 'sense-recognition' }], origin: 'retention', task, scores: { 'retention-need': score } });
const config = { weights: { 'retention-need': 1 } as const, deferFloor: 0, attentionBudgetRemaining: 1, probeBudgetRemaining: 1, probeCooldownMs: 0, nowMs: 10, cooldowns: new Map<string, number>(), recentPicks: [] as string[], minRepeatDistance: 0, task };
describe('live TeachingPolicy action value', () => {
  it('ignores heuristic score decoration and records actual counterfactual effects, cost and model provenance', () => {
    const learning = { model: fitLearningModel([], 10, 'journal:42'), horizonDays: 30, deferDays: 3, availableSeconds: [60, 120, 300], continuationValue: 0 };
    const pick = selectNext([candidate('first', 0), candidate('decorated', 100000)], { ...config, context: { learning } });
    expect(pick?.candidate.key).toBe('first');
    expect(pick?.trace?.model?.evidenceVersion).toBe('journal:42');
    expect(pick?.trace?.model?.evaluations[0]).toMatchObject({ counterfactual: 'defer-to-next-opportunity', priorDriven: true });
    expect(pick?.trace?.weights.effective).toEqual({});
  });
  it('compares against continuation and does not force overdue work or unknown diagnostic chores', () => {
    const learning = { model: fitLearningModel([], 10), horizonDays: 30, deferDays: 3, availableSeconds: [60, 120, 300], continuationValue: 1e6 };
    expect(selectNext([candidate('due', 999)], { ...config, context: { learning } })?.action).toBe('DEFER');
    expect(selectNext([{ ...candidate('uncertain', 999), origin: 'probe' }], config)?.action).toBe('DEFER');
  });
});
