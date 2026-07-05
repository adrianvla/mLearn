import { describe, expect, it } from 'vitest';
import type { LanguageData, LevelPercentageEntry } from '../../shared/types';
import {
  formatFrequencyLevelLabel,
  formatGrammarLevelLabel,
  getFrequencyFilterLevels,
  getGrammarFilterLevels,
} from './levelLabels';

function entry(level: number): LevelPercentageEntry {
  return {
    level,
    levelName: `ignored-${level}`,
    uniquePercent: 0,
    occurrencePercent: 0,
    uniqueCount: 0,
    occurrenceCount: 0,
  };
}

describe('levelLabels', () => {
  it('uses language metadata fallback templates when explicit names are missing', () => {
    const languageData: LanguageData = {
      name: 'Band Language',
      colour_codes: {},
      settings: { fixed: {} },
      frequencyLevels: {
        fallbackLabelTemplate: 'Band {level}',
      },
      grammarLevels: {
        fallbackLabelTemplate: 'Pattern {level}',
      },
    };

    expect(formatFrequencyLevelLabel(4, {}, languageData)).toBe('Band 4');
    expect(formatGrammarLevelLabel(2, {}, languageData)).toBe('Pattern 2');
  });

  it('returns an empty label when no numeric level exists', () => {
    const languageData: LanguageData = {
      name: 'Any Language',
      colour_codes: {},
      settings: { fixed: {} },
    };

    expect(formatFrequencyLevelLabel(null, {}, languageData)).toBe('');
    expect(formatGrammarLevelLabel(undefined, {}, languageData)).toBe('');
  });

  it('returns an empty frequency label for sentinel levels that are not real study levels', () => {
    const languageData: LanguageData = {
      name: 'Any Language',
      colour_codes: {},
      settings: { fixed: {} },
    };

    expect(formatFrequencyLevelLabel(-1, {}, languageData)).toBe('');
  });

  it('includes discovered frequency levels in filter options even when names are absent', () => {
    const languageData: LanguageData = {
      name: 'Ascending Language',
      colour_codes: {},
      settings: { fixed: {} },
      frequencyLevels: {
        difficulty: 'higher-is-harder',
      },
    };

    expect(getFrequencyFilterLevels({}, [entry(3), entry(1)], languageData)).toEqual([1, 3]);
  });

  it('excludes sentinel frequency levels from filter options', () => {
    const languageData: LanguageData = {
      name: 'Ascending Language',
      colour_codes: {},
      settings: { fixed: {} },
      frequencyLevels: {
        difficulty: 'higher-is-harder',
      },
    };

    expect(getFrequencyFilterLevels({}, [entry(-1), entry(3), entry(1)], languageData)).toEqual([1, 3]);
  });

  it('keeps zero in frequency filter options when the language declares it', () => {
    const languageData: LanguageData = {
      name: 'Zero Level Language',
      colour_codes: {},
      settings: { fixed: {} },
      frequencyLevels: {
        names: { '0': 'Starter', '1': 'A1' },
        difficulty: 'higher-is-harder',
      },
    };

    expect(getFrequencyFilterLevels({}, [entry(0), entry(1)], languageData)).toEqual([0, 1]);
  });

  it('includes discovered grammar levels in filter options using grammar display order', () => {
    const languageData: LanguageData = {
      name: 'Grammar Language',
      colour_codes: {},
      settings: { fixed: {} },
      frequencyLevels: {
        difficulty: 'higher-is-harder',
      },
      grammarLevels: {
        difficulty: 'lower-is-harder',
      },
    };

    expect(getGrammarFilterLevels({}, [entry(1), entry(4)], languageData)).toEqual([4, 1]);
  });
});
