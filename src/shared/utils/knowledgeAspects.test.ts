import { describe, expect, it } from 'vitest';
import { getAvailableAspects, type LanguageData } from '../types';

describe('getAvailableAspects', () => {
  const readingLanguage: LanguageData = {
    name: 'Reading Language',
    settings: { fixed: {} },
    textProcessing: {
      readingAnnotation: {
        type: 'script-reading',
        annotationScripts: ['Han'],
      },
    },
  };

  it('returns all aspects for a language with reading annotations and prosody', () => {
    expect(getAvailableAspects({
      ...readingLanguage,
      prosody: { type: 'japanese-pitch-accent' },
    })).toEqual(['meaning', 'reading', 'prosody']);
  });

  it('returns meaning only without reading annotations', () => {
    expect(getAvailableAspects({
      name: 'Meaning Only',
      settings: { fixed: {} },
    })).toEqual(['meaning']);
  });

  it('omits prosody when its type is none', () => {
    expect(getAvailableAspects({
      ...readingLanguage,
      prosody: { type: 'none' },
    })).toEqual(['meaning', 'reading']);
  });

  it('returns meaning only when language data is missing', () => {
    expect(getAvailableAspects()).toEqual(['meaning']);
  });
});
