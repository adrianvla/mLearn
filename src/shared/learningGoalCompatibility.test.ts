import { expect, it } from 'vitest';
import { learningGoalCompatibility, learningGoalSemanticBasis, revalidateLearningGoal } from './learningGoalCompatibility';
import { learningScopeForSettings } from './learningScope';
import { evaluateLearningRequirements } from './learningRequirementEvaluation';
import { fitLearningModel } from './learningModel';
import type { LearningGoal } from './learningGoals';
import { DEFAULT_SETTINGS, type LanguageData } from './types';
const data: LanguageData = { name: 'Unknown future package', languageData: { version: 'one', assets: [] },
  freq: [['term', '', 1], ['other', '', 2]], frequencyLevels: { rowLevelIndex: 2 },
  grammar: [{ pattern: 'construction', meaning: 'An arbitrary relationship', level: 1 }], learning: { outcomes: { curriculum: {
    label: 'Curriculum', provenance: 'community', groups: [{ id: 'words', selectors: [{ source: 'frequency', levels: [1] }] },
      { id: 'construction', selectors: [{ source: 'grammar' }] }], requirements: { conditions: [{ id: 'unknown::recall',
      kind: 'canonical-capability-threshold', groupIds: ['words'], capability: 'unregistered::ability', minimum: 0.6 }] },
  } } } };
const ref = { id: 'curriculum', groupIds: ['words'] };
const goal: LearningGoal = { id: 'stable', language: 'unknown', outcome: 'Curriculum', status: 'active', priority: 7,
  createdAt: 1, deadline: '2027-01-01', outcomeRef: { ...ref, packageVersion: 'one', semanticBasis: learningGoalSemanticBasis(data, ref), 'future::extra': { nested: [1, true] } },
  scope: { provenance: 'user', requirements: { 'unrecognized::condition': { arbitrary: [1, 2] } } } };
const clone = () => JSON.parse(JSON.stringify(data)) as LanguageData;
it('ignores dictionary transport bytes while recording an exact compatible rebind', () => {
  const next = clone(); next.languageData!.version = 'two'; next.languageData!.bundleSha256 = 'different';
  expect(learningGoalCompatibility(goal, next)).toMatchObject({ supported: true, status: 'compatible-rebind', requestedVersion: 'one', installedVersion: 'two' });
  expect(learningGoalCompatibility(goal, next).basis?.fingerprint).toBe(goal.outcomeRef!.semanticBasis!.fingerprint);
});
it('rejects changed membership at the same version and preserves the complete selected intent', () => {
  const next = clone(); next.freq!.push(['new-member', '', 1]);
  expect(learningGoalCompatibility(goal, next)).toMatchObject({ supported: false, status: 'changed' });
  expect(learningScopeForSettings({ ...DEFAULT_SETTINGS, language: 'unknown', learningGoals: [goal] }, next).unavailable).toEqual(['stable']);
  expect(goal.outcomeRef?.groupIds).toEqual(['words']); expect(goal.priority).toBe(7);
});
it('rejects a changed rubric or objective meaning despite a stable ID and package version', () => {
  const next = clone(); (next.learning!.outcomes!.curriculum.requirements!.conditions as Array<{ minimum: number }>)[0].minimum = 0.9;
  expect(learningGoalCompatibility(goal, next).status).toBe('changed');
  const content = clone(); content.grammar![0].meaning = 'A different objective';
  expect(learningGoalCompatibility(goal, content).status).toBe('changed');
});
it('does not validate removed or unknown selectors and requirements by version equality', () => {
  const removed = clone(); delete removed.learning!.outcomes!.curriculum;
  expect(learningGoalCompatibility(goal, removed).status).toBe('unavailable');
  const unknown = clone(); unknown.learning!.outcomes!.curriculum.groups[0].selectors = [{ source: 'unregistered::selector', value: { arbitrary: true } }];
  expect(learningGoalCompatibility(goal, unknown).supported).toBe(false);
});
it('revalidates deliberately, preserving history, unknown data, deadline, priority and learner evidence', () => {
  const next = clone(); next.freq!.push(['new-member', '', 1]); const rebound = revalidateLearningGoal(goal, next, 123)!;
  expect(rebound).toMatchObject({ id: goal.id, deadline: goal.deadline, priority: goal.priority, scope: goal.scope });
  expect(rebound.outcomeRef!['future::extra']).toEqual({ nested: [1, true] });
  expect(rebound.outcomeRef!.bindingHistory![0]).toMatchObject({ at: 123, previous: goal.outcomeRef!.semanticBasis });
  expect(learningGoalCompatibility(rebound, next).supported).toBe(true);
  const model = fitLearningModel([], 1000);
  expect(evaluateLearningRequirements([rebound], 'unknown', model, [], next, 1000)[0].requirements.some(item => item.status === 'unsupported')).toBe(true);
  expect(model).toEqual(fitLearningModel([], 1000));
});
it('preserves two distinct deadlines across missing package then compatible installation', () => {
  const second = { ...goal, id: 'later', deadline: '2028-01-01' };
  const settings = { ...DEFAULT_SETTINGS, language: 'unknown', learningGoals: [goal, second] };
  expect(learningScopeForSettings(settings, null).unavailable).toEqual(['stable', 'later']);
  const installed = clone(); installed.languageData!.version = 'two';
  expect(learningScopeForSettings(settings, installed).goals.map(item => item.deadline)).toEqual(['2027-01-01', '2028-01-01']);
});
it('keeps a legacy mismatch unverified until explicit revalidation', () => {
  const legacy = { ...goal, outcomeRef: { ...ref, packageVersion: 'before-any-retained-basis' } };
  expect(learningGoalCompatibility(legacy, data).status).toBe('unverified-version');
  expect(learningGoalCompatibility(revalidateLearningGoal(legacy, data)!, data).supported).toBe(true);
});
