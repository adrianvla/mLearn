import { describe, expect, it } from 'vitest';
import { learningGoalSemanticBasis } from './learningGoalCompatibility';
import { learningScopeForSettings, learningTargetSettingsUpdate } from './learningScope';
import { DEFAULT_SETTINGS, type LanguageData } from './types';
const data: LanguageData = { name: 'Future', freq: [['alpha', '', 1], ['beta', '', 2]], frequencyLevels: { rowLevelIndex: 2 },
  grammar: [{ pattern: 'construction', meaning: 'Meaning', level: 9 }], learning: { outcomes: { scope: {
    label: 'Declared scope', provenance: 'package', groups: [
      { id: 'words', selectors: [{ source: 'frequency', levels: [1] }] },
      { id: 'grammar', selectors: [{ source: 'grammar' }] },
    ],
  } } } };
const goal = { id: 'target', language: 'future', outcome: 'Old label', outcomeRef: { id: 'scope', groupIds: ['grammar'], semanticBasis: learningGoalSemanticBasis(data, { id: 'scope', groupIds: ['grammar'] }) }, status: 'active' as const, priority: 1, createdAt: 1, scope: { provenance: 'user' as const, words: ['stale'] } };
describe('shared supported learning scope', () => {
  it('shares declared subset membership, deduplicates overlap and preserves legacy storage', () => {
    const settings = { ...DEFAULT_SETTINGS, language: 'future', learningGoals: [goal, { ...goal, id: 'overlap' }, { ...goal, id: 'legacy', outcomeRef: undefined }] };
    const scope = learningScopeForSettings(settings, data);
    expect(scope).toMatchObject({ selected: true, words: [], patterns: ['construction'], unavailable: [] });
    expect(scope.goals.map(item => item.outcome)).toEqual(['Declared scope', 'Declared scope']);
    expect(settings.learningGoals[0].scope.words).toEqual(['stale']);
  });
  it('does not broaden a removed subset or absent package into an open curriculum', () => {
    const scope = learningScopeForSettings({ ...DEFAULT_SETTINGS, language: 'future', learningGoals: [{ ...goal, outcomeRef: { id: 'scope', groupIds: ['missing'] } }] }, data);
    expect(scope).toMatchObject({ selected: true, words: [], patterns: [], goals: [], unavailable: ['target'] });
    expect(learningScopeForSettings({ ...DEFAULT_SETTINGS, language: 'future', learningGoals: [goal] }, null)).toMatchObject({ selected: true, words: [], patterns: [], unavailable: ['target'] });
  });

  it('preserves learner scope provenance and opaque conditions while exposing package conditions separately', () => {
    const packageRequirements = { conditions: [{ id: 'package-floor', kind: 'canonical-capability-threshold', groupIds: ['words'], capability: 'future::recall', minimum: 0.7 }] };
    const assessment = { reference: 'package assessment', conditions: { scoreScale: 'provider-scale', sections: [{ id: 'future::section', minimum: 2 }] } };
    const userRequirements = { conditions: [{ id: 'personal-floor', kind: 'future::condition', value: { nested: [1, 'x'] } }] };
    const packageData: LanguageData = {
      ...data,
      languageData: { version: 'future-v2', assets: [] },
      learning: { outcomes: { scope: { ...data.learning!.outcomes!.scope, requirements: packageRequirements, assessment } } },
    };
    const userScope = { provenance: 'user' as const, reference: 'my own source', words: ['personal'], requirements: userRequirements };
    const settings = { ...DEFAULT_SETTINGS, language: 'future', learningGoals: [{ ...goal, outcomeRef: { id: 'scope', semanticBasis: learningGoalSemanticBasis(packageData, { id: 'scope' }) }, scope: userScope }] };

    const resolved = learningScopeForSettings(settings, packageData).goals[0];

    expect(resolved.scope).toEqual(userScope);
    expect(resolved.resolvedOutcome.declaration.requirements).toEqual(packageRequirements);
    expect(resolved.resolvedOutcome.declaration.assessment).toEqual(assessment);
    expect(JSON.parse(JSON.stringify(settings.learningGoals?.[0]?.scope))).toEqual(userScope);
  });

  it('does not resolve a goal against a different pinned package version', () => {
    const versionedGoal = { ...goal, outcomeRef: { id: 'scope', packageVersion: 'future-v1' } };
    const versionedData: LanguageData = { ...data, languageData: { version: 'future-v2', assets: [] } };

    expect(learningScopeForSettings({ ...DEFAULT_SETTINGS, language: 'future', learningGoals: [versionedGoal] }, versionedData))
      .toMatchObject({ selected: true, goals: [], unavailable: ['target'] });
  });
});

describe('deliberate preparation target update', () => {
  const packageData: LanguageData = { name: 'Future', frequencyProviders: {
    'arbitrary.provider': { name: 'Future provider' }, 'unrelated.provider': { name: 'Other provider' },
  }, defaultFrequencyProvider: 'arbitrary.provider' };
  it('updates the installed provider and language mirror together without changing outcomes or assessment', () => {
    const settings = { ...DEFAULT_SETTINGS, language: 'future', learningGoals: [goal],
      learningLanguageLevels: { future: 1, unrelated: 17 }, frequencyProviderTargets: { future: { 'arbitrary.provider': 1, 'unrelated.provider': 9 } } };
    const update = learningTargetSettingsUpdate(settings, 'future', 4, packageData);
    expect(update).toEqual({ learningLanguageLevels: { future: 4, unrelated: 17 },
      frequencyProviderTargets: { future: { 'arbitrary.provider': 4, 'unrelated.provider': 9 } } });
    expect(settings.learningGoals).toEqual([goal]);
    expect(settings.learningLanguageLevels.future).toBe(1);
  });
  it('retains explicit unlimited scope and never guesses an unavailable provider', () => {
    const settings = { ...DEFAULT_SETTINGS, frequencyProviderSelections: { future: 'absent' }, frequencyProviderTargets: { future: { absent: 8 } } };
    expect(learningTargetSettingsUpdate(settings, 'future', null, packageData)).toMatchObject({
      learningLanguageLevels: { future: null }, frequencyProviderTargets: { future: { absent: 8, 'arbitrary.provider': null } },
    });
    expect(learningTargetSettingsUpdate(settings, 'future', 7, null)).toEqual({ learningLanguageLevels: { future: 7 } });
  });
});
