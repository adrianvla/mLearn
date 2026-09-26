import { describe, expect, it } from 'vitest';
import { sortByStudyScope } from './studyOrder';
import type { LanguageData } from '../../../shared/types';

describe('Word Database study order', () => {
  const entries = [
    { word: 'dictionary only', level: null },
    { word: 'hard', level: 1 },
    { word: 'easy', level: 5 },
    { word: 'target A', level: 3 },
    { word: 'target B', level: 3 },
    { word: 'nearer easy', level: 4 },
    { word: 'nearer hard', level: 2 },
  ];
  const packageData = { frequencyLevels: { difficulty: 'lower-is-harder' } } as LanguageData;

  it('starts with selected scope and preserves package order within a level', () => {
    expect(sortByStudyScope(entries, 3, packageData).map((entry) => entry.word)).toEqual([
      'target A', 'target B', 'nearer easy', 'easy', 'nearer hard', 'hard', 'dictionary only',
    ]);
  });

  it('uses metadata for an unfamiliar level direction', () => {
    const unknownPackage = { frequencyLevels: { difficulty: 'higher-is-harder' } } as LanguageData;
    expect(sortByStudyScope(entries, 3, unknownPackage).map((entry) => entry.word)).toEqual([
      'target A', 'target B', 'nearer hard', 'hard', 'nearer easy', 'easy', 'dictionary only',
    ]);
  });

  it('starts with the easiest declared level when no target is selected', () => {
    expect(sortByStudyScope(entries, null, packageData).map((entry) => entry.word)).toEqual([
      'easy', 'nearer easy', 'target A', 'target B', 'nearer hard', 'hard', 'dictionary only',
    ]);
  });
});
