import { describe, expect, it } from 'vitest';
import { activeLearningGoals, goalSessionBudget, learningGoalsForSettings } from './learningGoals';
import { DEFAULT_SETTINGS } from './types';

const goal = { id: 'read', language: 'future', outcome: 'Defined scope', outcomeRef: { id: 'future:scope' }, status: 'active' as const, priority: 2, createdAt: 1, scope: { provenance: 'user' as const, words: ['one', 'two'] } };
describe('learner commitments', () => {
  it('keeps legacy exam intent stored without activating it', () => {
    const settings = { ...DEFAULT_SETTINGS, language: 'future', examGoal: { kind: 'exam' as const, language: 'future', target: 'My exam', deadline: '2000-01-01' } };
    expect(learningGoalsForSettings(settings)).toEqual([]);
    expect(settings.examGoal.target).toBe('My exam');
  });
  it('keeps paused/completed history and scopes active commitments by language and priority', () => {
    const goals = [goal, { ...goal, id: 'other', language: 'other' }, { ...goal, id: 'paused', status: 'paused' as const }, { ...goal, id: 'done', status: 'completed' as const }, { ...goal, id: 'first', priority: 3 }];
    expect(activeLearningGoals([...goals, { ...goal, id: 'legacy', outcomeRef: undefined }], 'future').map(g => g.id)).toEqual(['first', 'read']);
    expect(JSON.parse(JSON.stringify(goals))[0].scope).toEqual(goal.scope);
  });
  it('allocates finite encounters and never raises effort because a deadline passed', () => {
    expect(goalSessionBudget(5)).toBeLessThan(goalSessionBudget(15));
    expect(goalSessionBudget(0)).toBe(1);
    expect(goalSessionBudget(NaN)).toBe(goalSessionBudget(DEFAULT_SETTINGS.learningMinutes));
  });
});
