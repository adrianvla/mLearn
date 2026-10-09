import { revalidateLearningGoal } from '../../shared/learningGoalCompatibility';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/types';
import { policyContextFromSettings } from './policyContext';
import { fitLearningModel } from '../../shared/learningModel';
import { selectNextEncounter } from './engine';

const goal = { id: 'book', language: 'future', outcome: 'Defined material', outcomeRef: { id: 'scope' }, status: 'active' as const, priority: 3, createdAt: 1, scope: { provenance: 'user' as const, words: ['chosen'] } };
const runtime = (goals: typeof goal[]) => ({ model: fitLearningModel([], 100), events: [], data: { name: 'Future', freq: [['chosen', '', 1], ['other', '', 1]] as [string, string, number][], frequencyLevels: { rowLevelIndex: 2 }, learning: { outcomes: Object.fromEntries(goals.map(goal => [goal.outcomeRef.id, { label: goal.outcome, provenance: 'package' as const, groups: [{ id: 'words', selectors: [{ source: 'frequency', words: goal.scope.words }] }] }])) } } });
const pick = (goals: typeof goal[]) => selectNextEncounter({ preset: 'CURRICULUM', nowMs: 100, levelStudyItems: [
  { key: 'other-key', word: 'other', language: 'future' },
  { key: 'chosen-key', word: 'chosen', language: 'future' },
], context: policyContextFromSettings({ ...DEFAULT_SETTINGS, learningGoals: goals.map(goal => revalidateLearningGoal(goal, runtime(goals).data)!) }, 'future', runtime(goals)), config: { selection: 'ranked' } });
describe('goals drive shared preparation', () => {
  it('changes actual selection for user scope and keeps overlap one encounter', () => {
    expect(pick([])?.candidate.word).toBe('other');
    const decision = pick([goal, { ...goal, id: 'class' }]);
    expect(decision?.candidate.word).toBe('chosen');
    expect(decision?.trace?.inputs.candidateCount).toBe(2);
    expect(decision?.candidate.meta?.goalIds).toEqual(['book', 'class']);
  });
  it('records a relevant deadline without fabricating a preference multiplier for overlapping scope', () => {
    const other = { ...goal, id: 'other', outcomeRef: { id: 'other' }, scope: { provenance: 'user' as const, words: ['other'] } };
    expect(pick([other, goal])?.candidate.word).toBe('other');
    expect(pick([other, { ...goal, deadline: '1970-01-02' }])?.candidate.word).toBe('other');
    expect(pick([other, { ...goal, deadline: '1970-01-02' }])?.trace?.model?.horizonDays).toBeGreaterThan(0);
  });
  it('does not weight paused goals or another language and keeps deadlines optional', () => {
    expect(policyContextFromSettings({ ...DEFAULT_SETTINGS, learningGoals: [{ ...goal, status: 'paused' }] }, 'future').goals).toEqual([]);
    expect(policyContextFromSettings({ ...DEFAULT_SETTINGS, learningGoals: [goal] }, 'other').goals).toEqual([]);
    expect(policyContextFromSettings({ ...DEFAULT_SETTINGS, learningGoals: [revalidateLearningGoal(goal, runtime([goal]).data)!] }, 'future', runtime([goal])).goal).toMatchObject({ target: goal.outcome });
  });
});
