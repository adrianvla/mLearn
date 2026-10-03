import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/types';
import { policyContextFromSettings } from './policyContext';
import { selectNextEncounter } from './engine';

const goal = { id: 'book', language: 'future', outcome: 'Read the chosen book', status: 'active' as const, priority: 3, createdAt: 1, scope: { provenance: 'user' as const, words: ['chosen'] } };
const pick = (goals: typeof goal[]) => selectNextEncounter({ preset: 'CURRICULUM', nowMs: 100, levelStudyItems: [
  { key: 'other-key', word: 'other', language: 'future' },
  { key: 'chosen-key', word: 'chosen', language: 'future' },
], context: policyContextFromSettings({ ...DEFAULT_SETTINGS, learningGoals: goals }, 'future'), config: { selection: 'ranked' } });
describe('goals drive shared preparation', () => {
  it('changes actual selection for user scope and keeps overlap one encounter', () => {
    expect(pick([])?.candidate.word).toBe('other');
    const decision = pick([goal, { ...goal, id: 'class' }]);
    expect(decision?.candidate.word).toBe('chosen');
    expect(decision?.trace?.inputs.candidateCount).toBe(2);
    expect(decision?.candidate.meta?.goalIds).toEqual(['book', 'class']);
  });
  it('changes preparation when a relevant deadline moves closer without duplicating overlap', () => {
    const other = { ...goal, id: 'other', scope: { provenance: 'user' as const, words: ['other'] } };
    expect(pick([other, goal])?.candidate.word).toBe('other');
    expect(pick([other, { ...goal, deadline: '1970-01-02' }])?.candidate.word).toBe('chosen');
  });
  it('does not weight paused goals or another language and keeps deadlines optional', () => {
    expect(policyContextFromSettings({ ...DEFAULT_SETTINGS, learningGoals: [{ ...goal, status: 'paused' }] }, 'future').goals).toEqual([]);
    expect(policyContextFromSettings({ ...DEFAULT_SETTINGS, learningGoals: [goal] }, 'other').goals).toEqual([]);
    expect(policyContextFromSettings({ ...DEFAULT_SETTINGS, learningGoals: [goal] }, 'future').goal).toMatchObject({ target: goal.outcome });
  });
});
