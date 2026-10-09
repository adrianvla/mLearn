import { fitLearningModel } from '../../shared/learningModel';
import { learningGoalSemanticBasis } from '../../shared/learningGoalCompatibility';
import type { LanguageData } from '../../shared/types';
import { expect, it } from 'vitest';
import { evaluateLearningRequirements, canonicalRequirementGroupTargets, type CanonicalCapabilityThreshold } from '../../shared/learningRequirementEvaluation';
import type { LearningGoal } from '../../shared/learningGoals';
import { discoverRecallConditionOptions, installedGoalRecallCandidates, withPersonalRecallCondition, withoutPersonalRecallCondition } from './goalRecallConditions';
import type { Candidate } from './types';

const condition: CanonicalCapabilityThreshold = { id: 'learner-one', kind: 'canonical-capability-threshold', groupIds: ['declared'], capability: 'future::allocutive-recall', minimum: 0.7 };
const goal: LearningGoal = { id: 'goal-one', language: 'qx', outcome: 'Declared material', status: 'active', priority: 2, createdAt: 1, deadline: '2027-01-01', outcomeRef: { id: 'qx:material', groupIds: ['declared', 'other'], 'future:binding': { hierarchy: [1, 2] } }, scope: { provenance: 'user', requirements: { conditions: [{ id: 'opaque', kind: 'future::discourse', value: { nested: [1, 2] } }], 'future:unknown': { values: ['never-seen'] } } } };

it('appends and edits only a personal condition, retaining unknown intent and multi-group binding', () => {
  const snapshot = JSON.stringify(goal);
  const added = withPersonalRecallCondition(goal, condition)!;
  expect(added.scope!.requirements!.conditions).toEqual([...(goal.scope!.requirements!.conditions as unknown[]), condition]);
  const changed = withPersonalRecallCondition(added, { ...condition, minimum: 0.6 })!;
  expect(changed.outcomeRef).toEqual(goal.outcomeRef);
  expect(changed.scope!.requirements!['future:unknown']).toEqual(goal.scope!.requirements!['future:unknown']);
  expect((changed.scope!.requirements!.conditions as unknown[])[0]).toEqual((goal.scope!.requirements!.conditions as unknown[])[0]);
  expect(JSON.stringify(goal)).toBe(snapshot);
});

it('does not reinterpret a direct-root requirement when appending another condition', () => {
  const direct = { ...goal, scope: { provenance: 'user' as const, requirements: { ...condition } } };
  expect(withPersonalRecallCondition(direct, { ...condition, id: 'learner-two' })).toBeNull();
  expect(withPersonalRecallCondition(direct, { ...condition, minimum: 0.6 })?.scope?.requirements).toEqual({ ...condition, minimum: 0.6 });
});

it('discovers unknown package capability IDs only when every member has a matching unsupplied recall task', () => {
  const groups = [{ id: 'declared', label: 'Package material', words: [], patterns: ['opaque-one', 'opaque-two'] }];
  const targets = canonicalRequirementGroupTargets('qx', groups, condition.capability);
  const candidates: Candidate[] = targets.map((target, index) => ({ key: `candidate-${index}`, language: 'qx', origin: 'curriculum', scores: {}, targets: [target],
    task: { taskTemplateId: 'future::recall', inputModality: 'future::cue', responseModality: 'recall', requested: [condition.capability], supplied: [], ratingMode: 'dominant', fluencyRequired: false } }));
  expect(discoverRecallConditionOptions('qx', groups, candidates)).toEqual([{ groupId: 'declared', groupLabel: 'Package material', capability: condition.capability, taskIds: ['future::recall'] }]);
  expect(discoverRecallConditionOptions('qx', groups, candidates.slice(0, 1))).toEqual([]);
  expect(discoverRecallConditionOptions('other', groups, candidates)).toEqual([]);
  expect(discoverRecallConditionOptions('qx', groups, candidates.map(candidate => ({ ...candidate, task: { ...candidate.task!, supplied: [condition.capability] } })))).toEqual([]);
});

it('does not advertise grammar material the real recall pass cannot admit', () => {
  expect(installedGoalRecallCandidates('qx', { name: 'Unknown', grammar: [{ pattern: 'not-admitted', meaning: 'Meaning' } as never] })).toEqual([]);
});


it('refuses ambiguous IDs and duplicate simple intent while removing only the selected supported condition', () => {
  const added = withPersonalRecallCondition(goal, condition)!;
  expect(withPersonalRecallCondition(added, { ...condition, id: 'duplicate' })).toBeNull();
  const ambiguous = { ...added, scope: { ...added.scope!, requirements: { ...added.scope!.requirements, conditions: [condition, { ...condition, minimum: 0.9 }] } } };
  expect(withPersonalRecallCondition(ambiguous, { ...condition, minimum: 0.6 })).toBeNull();
  expect(withoutPersonalRecallCondition(ambiguous, condition.id)).toBeNull();
  expect(withoutPersonalRecallCondition(added, condition.id)).toEqual(goal);
  expect(withoutPersonalRecallCondition(goal, 'opaque')).toBeNull();
});


it('removing the sole direct-root threshold leaves no opaque user requirement in the actual evaluator', () => {
  const data: LanguageData = { name: 'Unknown', languageData: { version: 'v1', assets: [] }, grammar: [{ pattern: 'declared-pattern', meaning: 'Declared', level: 1 }], learning: { outcomes: { 'qx:material': { label: 'Declared', provenance: 'package', groups: [{ id: 'declared', selectors: [{ source: 'grammar', patterns: ['declared-pattern'] }] }] } } } };
  const direct = { ...goal, outcomeRef: { id: 'qx:material', semanticBasis: learningGoalSemanticBasis(data, { id: 'qx:material' }) }, scope: { provenance: 'user' as const, reference: 'preserved', requirements: { ...condition } } };
  const removed = withoutPersonalRecallCondition(direct, condition.id)!;
  expect(removed.scope?.reference).toBe('preserved');
  const result = evaluateLearningRequirements([removed], 'qx', fitLearningModel([], 1), [], data, 1)[0];
  expect(result.requirements.filter(row => row.source === 'user')).toEqual([]);
});
