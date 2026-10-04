import { describe, expect, it } from 'vitest';
import { fitLearningModel } from './learningModel';
import { inferLearningOpportunities } from './learningOpportunities';
import { forecastScopeWorkload } from './learningWorkload';
const day = 86_400_000;
const model = fitLearningModel([], 30 * day);
const work = { items: Array.from({ length: 1000 }, (_, i) => ({ id: `future:${i}`, family: 'future-task' })) };
const sparse = inferLearningOpportunities([], model.at);
describe('deadline workload scenarios', () => {
  it('warns only about a necessary coverage workload even in the optimistic scenario, without claiming a pass probability', () => {
    const result = forecastScopeWorkload(model, work, sparse, model.at, model.at + day);
    expect(result.status).toBe('one-pass-exceeds-opportunity-scenarios');
    expect(result.requiredActiveSeconds.interval[0]).toBeGreaterThan(result.possibleActiveSeconds![1]);
    expect(result.priorDriven).toBe(true);
    expect(result.limits[0]).toContain('does not establish durable learning');
    expect(result).not.toHaveProperty('passProbability');
  });
  it('changes feasible workload with missed opportunities without inventing extra study or changing the required date', () => {
    const deadline = model.at + 20 * day;
    const short = forecastScopeWorkload(model, work, { ...sparse, gapDays: [1], availableSeconds: [300] }, model.at, deadline);
    const missed = forecastScopeWorkload(model, work, { ...sparse, gapDays: [20], availableSeconds: [300] }, model.at, deadline);
    expect(missed.possibleActiveSeconds![1]).toBeLessThan(short.possibleActiveSeconds![1]);
    expect(short.deadline).toBe(missed.deadline);
    expect(short.status).toBe('indeterminate');
    expect(missed.status).toBe('one-pass-exceeds-opportunity-scenarios');
  });
  it('shares overlapping work while keeping opaque task-family effort distinct', () => {
    const once = forecastScopeWorkload(model, work, sparse, model.at, model.at + day);
    const twice = forecastScopeWorkload(model, { items: [...work.items, ...work.items] }, sparse, model.at, model.at + day);
    expect(twice).toEqual(once);
    const mixed = forecastScopeWorkload(model, { items: [work.items[0], { id: 'other', family: 'unknown::conversational-work' }] }, sparse, model.at, model.at + day);
    expect(mixed.effortSources).toHaveLength(2);
  });
  it('does not interpret an empty scope or a passed date as a reached outcome', () => {
    expect(forecastScopeWorkload(model, { items: [] }, sparse, model.at, model.at + day).status).toBe('indeterminate');
    expect(forecastScopeWorkload(model, work, sparse, model.at, model.at - day).status).toBe('not-estimated');
  });
});
