import { describe, expect, it } from 'vitest';
import { learningScopeForSettings } from './learningScope';
import { DEFAULT_SETTINGS, type LanguageData } from './types';
const data: LanguageData = { name: 'Future', freq: [['alpha', '', 1], ['beta', '', 2]], frequencyLevels: { rowLevelIndex: 2 },
  grammar: [{ pattern: 'construction', meaning: 'Meaning', level: 9 }], learning: { outcomes: { scope: {
    label: 'Declared scope', provenance: 'package', groups: [
      { id: 'words', selectors: [{ source: 'frequency', levels: [1] }] },
      { id: 'grammar', selectors: [{ source: 'grammar' }] },
    ],
  } } } };
const goal = { id: 'target', language: 'future', outcome: 'Old label', outcomeRef: { id: 'scope', groupIds: ['grammar'] }, status: 'active' as const, priority: 1, createdAt: 1, scope: { provenance: 'user' as const, words: ['stale'] } };
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
});
