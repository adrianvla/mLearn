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

  it('maps an accent feature declared reading-critical into the reading aspect (no prosody aspect)', () => {
    // Russian-like metadata: stress accentuation that is required to read the word.
    expect(getAvailableAspects({
      name: 'Stress Language',
      settings: { fixed: {} },
      prosody: { type: 'stress-accent', knowledgeAspect: 'reading' },
    })).toEqual(['meaning', 'reading']);
  });

  it('keeps a pitch-nuance accent feature in the prosody aspect', () => {
    expect(getAvailableAspects({
      ...readingLanguage,
      prosody: { type: 'japanese-pitch-accent', knowledgeAspect: 'prosody' },
    })).toEqual(['meaning', 'reading', 'prosody']);
  });
});
