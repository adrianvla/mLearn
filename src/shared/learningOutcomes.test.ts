import { describe, expect, it } from 'vitest';
import { resolveLearningOutcome, learningOutcomeOptions } from './learningOutcomes';
import type { LanguageData } from './types';

const data: LanguageData = { name: 'Future', frequencyProviders: { corpus: { name: 'Corpus', freq: [['alpha', '', 1], ['beta', '', 2]], frequencyLevels: { rowLevelIndex: 2 } } }, grammar: [{ pattern: 'arbitrary construction', meaning: 'Meaning', level: 4 }], learning: { outcomes: {
  subset: { label: 'Defined subset', provenance: 'package', groups: [{ id: 'lexical', selectors: [{ source: 'frequency', provider: 'corpus', levels: [1] }] }, { id: 'construction', selectors: [{ source: 'grammar', patterns: ['arbitrary construction'] }] }], requirements: { 'future:unknown': { relation: ['speaker', 'listener'], values: [1, { x: 'y' }] } } },
  unsupported: { label: 'Unknown extension', provenance: 'package', groups: [{ id: 'new', selectors: [{ source: 'future-extension', query: { imaginary: true } }] }] },
} } };

describe('installed semantic outcome resolution', () => {
  it('fails gracefully on malformed declarations without dropping unknown package data', () => {
    const malformed = { ...data.learning!.outcomes!.subset, groups: [{ id: 'broken' }, { id: 'bad-selector', selectors: [{ source: 'grammar', patterns: 4, opaque: { future: true } }] }] };
    const packageData = { ...data, learning: { outcomes: { malformed } } } as unknown as LanguageData;
    expect(resolveLearningOutcome(packageData, 'malformed')).toMatchObject({ complete: false, words: [], patterns: [] });
    expect(learningOutcomeOptions(packageData)).toEqual([]);
    expect(resolveLearningOutcome(packageData, 'malformed')?.declaration).toEqual(malformed);
  });
  it('resolves actual provider and grammar members independently of labels', () => {
    const result = resolveLearningOutcome(data, 'subset');
    expect(result?.words).toEqual(['alpha']);
    expect(result?.patterns).toEqual(['arbitrary construction']);
    expect(result?.groups.map(group => group.id)).toEqual(['lexical', 'construction']);
    expect(resolveLearningOutcome({ ...data, learning: { outcomes: { subset: { ...data.learning!.outcomes!.subset, label: 'renamed' } } } }, 'subset')?.words).toEqual(result?.words);
  });
  it('preserves unknown requirements and reports unavailable extensions without inventing members', () => {
    expect(JSON.parse(JSON.stringify(resolveLearningOutcome(data, 'subset')?.declaration.requirements))).toEqual(data.learning!.outcomes!.subset.requirements);
    expect(resolveLearningOutcome(data, 'unsupported')).toMatchObject({ complete: false, words: [], patterns: [] });
    expect(learningOutcomeOptions(data).map(option => option.id)).toEqual(['subset']);
  });
  it('does not substitute a different provider when the declared asset is missing', () => {
    expect(resolveLearningOutcome({ ...data, frequencyProviders: {} }, 'subset')).toMatchObject({ complete: false, words: [] });
  });
  it('deduplicates overlapping selectors without duplicating group membership', () => {
    const outcome = data.learning!.outcomes!.subset;
    const result = resolveLearningOutcome({ ...data, learning: { outcomes: { subset: { ...outcome, groups: [...outcome.groups, outcome.groups[0]] } } } }, 'subset');
    expect(result?.words).toEqual(['alpha']);
    expect(result?.groups.filter(group => group.id === 'lexical')).toHaveLength(1);
  });
});
