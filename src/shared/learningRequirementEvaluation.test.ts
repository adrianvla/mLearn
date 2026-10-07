import { describe, expect, it } from 'vitest';
import { grammarEntityId, surfaceEntityId } from './graph/load';
import { fitLearningModel, learningAddress } from './learningModel';
import { evaluateLearningRequirements } from './learningRequirementEvaluation';
import { hashWordSync } from './utils/wordHash';
import japaneseMetadata from '../../scripts/language-data/language-overrides/ja.metadata.json';
import type { KnowledgeEvent } from './knowledgeEvents';
import type { LearningGoal } from './learningGoals';
import type { LanguageData } from './types';

const capability = 'future-language::discourse-access';
const lexicalId = surfaceEntityId('future', hashWordSync('alpha'));
const grammarId = grammarEntityId('future', 'conditional construction');
const lexicalAddress = learningAddress({ entityId: lexicalId, capability });

const packageCondition = {
  id: 'package-recall-floor',
  kind: 'canonical-capability-threshold',
  groupIds: ['lexical'],
  capability,
  minimum: 0.2,
};

const data: LanguageData = {
  name: 'Future language',
  languageData: { version: 'future-v2', assets: [] },
  freq: [['alpha', '', 1]],
  frequencyLevels: { rowLevelIndex: 2 },
  learning: {
    outcomes: {
      objective: {
        label: 'Package objective',
        provenance: 'package',
        groups: [
          { id: 'lexical', selectors: [{ source: 'frequency', words: ['alpha'] }] },
          { id: 'construction', selectors: [{ source: 'grammar', patterns: ['conditional construction'] }] },
        ],
        requirements: { conditions: [packageCondition] },
        assessment: {
          reference: 'provider assessment',
          conditions: { scoreScale: 'provider-scale', overallMinimum: 80, allSectionsRequired: true,
            sections: [{ id: 'reading', minimum: 19 }, { id: 'listening', minimum: 19 }] },
        },
      },
    },
  },
  grammar: [{ pattern: 'conditional construction', meaning: 'Condition', level: 1 }],
};

const goal: LearningGoal = {
  id: 'goal-one',
  language: 'future',
  outcome: 'Old display label',
  outcomeRef: { id: 'objective', packageVersion: 'future-v2' },
  status: 'active',
  priority: 1,
  createdAt: 1,
  deadline: '1970-01-02',
  scope: {
    provenance: 'user',
    reference: 'personal refinement',
    requirements: { conditions: [
      { id: 'personal-recall-floor', kind: 'canonical-capability-threshold', groupIds: ['lexical'], capability, minimum: 0.99 },
      { id: 'opaque-future-condition', kind: 'future-provider::section-rule', section: { speaker: 'addressee', values: [1, { nested: true }] } },
    ] },
  },
};

function successEvent(t: number, attemptId: string, entityId = lexicalId): KnowledgeEvent {
  return {
    t,
    kind: 'rating',
    source: 'srs',
    rating: 'easy',
    quality: 'easy',
    attemptId,
    eventId: `${attemptId}-event`,
    taskType: 'srs-review',
    method: 'recall',
    targetRef: { kind: 'surface', id: entityId, capability },
  };
}

describe('derived goal requirement evaluation', () => {
  it('evaluates package and user thresholds separately and keeps provider assessment conjunctive/unsupported', () => {
    const events = [successEvent(100, 'observed-alpha')];
    const model = fitLearningModel(events, Date.parse('1970-01-02'));
    const evaluation = evaluateLearningRequirements([goal], 'future', model, events, data, Date.parse('1970-01-02'))[0];

    expect(evaluation).toMatchObject({ requestedPackageVersion: 'future-v2', packageVersion: 'future-v2',
      scopeProvenance: 'user', scopeReference: 'personal refinement', modelVersion: model.version, evidenceVersion: model.evidenceVersion });
    expect(evaluation.requirements.find(row => row.requirementId === 'package-recall-floor')).toMatchObject({
      source: 'package', packageVersion: 'future-v2', status: 'met', conditional: true,
      targets: [{ address: lexicalAddress, observations: 1, status: 'met', evidence: [{ attemptId: 'observed-alpha', eventId: 'observed-alpha-event' }] }],
    });
    expect(evaluation.requirements.find(row => row.requirementId === 'personal-recall-floor')).toMatchObject({
      source: 'user', status: 'unmet', targets: [{ address: lexicalAddress, status: 'unmet' }],
    });
    expect(evaluation.requirements.find(row => row.requirementId === 'opaque-future-condition')).toMatchObject({
      source: 'user', status: 'unsupported', conditions: (goal.scope?.requirements?.conditions as unknown[])[1],
    });
    expect(evaluation.requirements.find(row => row.requirementId === 'assessment.conditions')).toMatchObject({
      source: 'assessment', status: 'unsupported', conditions: data.learning?.outcomes?.objective.assessment?.conditions,
    });
    expect(evaluation.status).toBe('unmet');
    expect(evaluation.requirements.find(row => row.requirementId === 'personal-recall-floor')?.selection?.targetWeights[lexicalAddress]).toBeGreaterThan(0);
    expect(JSON.parse(JSON.stringify(goal.scope?.requirements))).toEqual(goal.scope?.requirements);
  });

  it('keeps prior-driven and partial evidence unknown, without inventing observations', () => {
    const model = fitLearningModel([], 1000);
    const evaluation = evaluateLearningRequirements([goal], 'future', model, [], data, 1000)[0];

    expect(evaluation.requirements.find(row => row.requirementId === 'package-recall-floor')).toMatchObject({
      status: 'unknown', conditional: true, targets: [{ observations: 0, priorDriven: true, status: 'unknown' }],
    });
    expect(model.memories[lexicalAddress]).toBeUndefined();
  });

  it('does not cite incompatible evidence that the canonical model did not fit', () => {
    const incompatible = { ...successEvent(100, 'welcome-attempt'), taskType: 'welcome-review' as const };
    const model = fitLearningModel([incompatible], 1000);
    const evaluation = evaluateLearningRequirements([goal], 'future', model, [incompatible], data, 1000)[0];

    expect(evaluation.requirements.find(row => row.requirementId === 'package-recall-floor')?.targets?.[0])
      .toMatchObject({ observations: 0, status: 'unknown', evidence: [] });
  });

  it('keeps model memories unknown when supporting canonical events are unavailable', () => {
    const canonicalEvent = successEvent(100, 'stored-attempt');
    const model = fitLearningModel([canonicalEvent], 1000);
    const evaluation = evaluateLearningRequirements([goal], 'future', model, [], data, 1000)[0];

    expect(evaluation.requirements.find(row => row.requirementId === 'package-recall-floor')?.targets?.[0])
      .toMatchObject({ observations: 1, status: 'unknown', evidence: [] });
  });

  it('retains opaque top-level package requirements as unsupported', () => {
    const opaque = { 'future:dimension': { speaker: 'addressee', values: [1, { nested: true }] } };
    const opaqueData: LanguageData = { ...data, learning: { outcomes: { objective: {
      ...data.learning!.outcomes!.objective, requirements: opaque,
    } } } };
    const evaluation = evaluateLearningRequirements([goal], 'future', fitLearningModel([], 1000), [], opaqueData, 1000)[0];

    expect(evaluation.requirements).toContainEqual(expect.objectContaining({ source: 'package', status: 'unsupported', conditions: opaque }));
  });

  it('does not claim the stored reliability target without a calibrated model', () => {
    const reliabilityGoal = { ...goal, requiredReliability: 0.8 };
    const evaluation = evaluateLearningRequirements([reliabilityGoal], 'future', fitLearningModel([], 1000), [], data, 1000)[0];

    expect(evaluation.requirements.find(row => row.requirementId === 'requiredReliability')).toMatchObject({
      source: 'user', status: 'unsupported', conditions: { value: 0.8 }, reason: 'reliability-calibration-unavailable',
    });
  });

  it('keeps the current Japanese official score and section conditions unsupported', () => {
    const outcome = japaneseMetadata.learning.outcomes['ja:jlpt-n5'];
    const data: LanguageData = { name: 'Japanese', freq: [], frequencyLevels: { rowLevelIndex: 2 },
      frequencyProviders: { jlpt: { name: 'Community vocabulary list', freq: [['語', 'ご', 5]], frequencyLevels: { rowLevelIndex: 2 } } },
      grammar: [{ pattern: 'N5 grammar item', meaning: 'meaning', level: 5 }],
      learning: { outcomes: { 'ja:jlpt-n5': outcome } } };
    const goal: LearningGoal = { id: 'jlpt-n5', language: 'ja', outcome: 'JLPT N5',
      outcomeRef: { id: 'ja:jlpt-n5' }, status: 'active', priority: 1, createdAt: 1 };
    const evaluation = evaluateLearningRequirements([goal], 'ja', fitLearningModel([], 1000), [], data, 1000)[0];
    const currentOfficialConditions = outcome.assessment.conditions;

    expect(evaluation.requirements.find(row => row.requirementId === 'assessment.conditions')).toMatchObject({
      source: 'assessment', kind: 'provider-assessment', status: 'unsupported',
      conditions: currentOfficialConditions, reason: 'assessment-provider-unavailable',
    });
    expect(evaluation.requirements.find(row => row.requirementId === 'package-requirements')).toMatchObject({
      source: 'package', status: 'unsupported', conditions: outcome.requirements,
    });
    expect(evaluation.status).toBe('unsupported');
  });

  it('keeps different goal deadlines and selected group requirements independent', () => {
    const laterGoal: LearningGoal = { ...goal, id: 'goal-two', deadline: '1970-01-04',
      outcomeRef: { id: 'objective', packageVersion: 'future-v2', groupIds: ['construction'] } };
    const later = Date.parse('1970-01-04');
    const events = [successEvent(100, 'observed-alpha')];
    const evaluations = evaluateLearningRequirements([goal, laterGoal], 'future', fitLearningModel(events, later), events, data, later - 2 * 86_400_000);
    const firstGoal = evaluations.find(row => row.goalId === 'goal-one')!;
    const secondGoal = evaluations.find(row => row.goalId === 'goal-two')!;
    const first = firstGoal.requirements.find(row => row.requirementId === 'package-recall-floor');
    const second = secondGoal.requirements.find(row => row.requirementId === 'package-recall-floor');

    expect(first?.deadline).toBe('1970-01-02');
    expect(second?.deadline).toBe('1970-01-04');
    expect(secondGoal.selectedGroupIds).toEqual(['construction']);
    expect(first?.targets).toHaveLength(1);
    expect(second?.targets).toHaveLength(1);
    expect(second?.status).toBe('met');
  });

  it('does not reinterpret past deadlines or conditions against another package version', () => {
    const afterDeadline = Date.parse('1970-01-03');
    const past = evaluateLearningRequirements([goal], 'future', fitLearningModel([successEvent(100, 'observed-alpha')], afterDeadline), [successEvent(100, 'observed-alpha')], data, afterDeadline)[0]
      .requirements.find(row => row.requirementId === 'package-recall-floor');
    const pinned = { ...goal, outcomeRef: { id: 'objective', packageVersion: 'future-v1' } };
    const packageChanged = evaluateLearningRequirements([pinned], 'future', fitLearningModel([], 1000), [], data, 1000);

    expect(past).toMatchObject({ status: 'unknown', reason: 'deadline-past' });
    expect(packageChanged[0]).toMatchObject({ status: 'unsupported', requirements: [
      expect.objectContaining({ status: 'unsupported', reason: 'package-version-unavailable' }),
    ] });
  });
});

it('does not silently satisfy a supported threshold with unknown required qualifiers', () => {
  const events = [successEvent(100, 'actual')];
  const model = fitLearningModel(events, 1000);
  const qualified = { ...data, learning: { ...data.learning, outcomes: { objective: {
    ...data.learning!.outcomes!.objective,
    requirements: { conditions: [{ ...packageCondition, 'future:required-context': { participants: ['speaker', 'elder'], modality: 'unheard-of' } }] },
  } } } };
  const evaluated = evaluateLearningRequirements([goal], 'future', model, events, qualified, 1000)[0];
  expect(evaluated.requirements.find(row => row.requirementId === packageCondition.id)).toMatchObject({ status: 'unsupported', reason: 'requirement-qualifiers-unsupported' });
});

it('keeps unknown user requirement siblings conjunctive rather than dropping them', () => {
  const events = [successEvent(100, 'actual')];
  const model = fitLearningModel(events, 1000);
  const refined = { ...goal, scope: { ...goal.scope!, requirements: { conditions: [packageCondition], 'future:discourse': { hierarchy: [7, 9] } } } };
  const evaluated = evaluateLearningRequirements([refined], 'future', model, events, data, 1000)[0];
  expect(evaluated.requirements.find(row => row.requirementId === 'user-requirements-extension')).toMatchObject({ status: 'unsupported', conditions: { 'future:discourse': { hierarchy: [7, 9] } } });
});
