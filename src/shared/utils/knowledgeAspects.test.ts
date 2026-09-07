import { describe, expect, it } from 'vitest';
import { getAvailableAccesses, type LanguageData } from '../types';

describe('getAvailableAccesses', () => {
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

  it('returns all word accesses for a language with reading annotations and prosody', () => {
    expect(getAvailableAccesses({
      ...readingLanguage,
      prosody: { type: 'japanese-pitch-accent' },
    })).toEqual([
      'sense-recognition',
      'surface-reading',
      'prosodic-pattern',
      'spoken-recognition',
      'pronunciation-production',
      'surface-recognition',
    ]);
  });

  it('returns sense only without reading annotations', () => {
    expect(getAvailableAccesses({
      name: 'Meaning Only',
      settings: { fixed: {} },
    })).toEqual(['sense-recognition']);
  });

  it('omits pitch access when the prosody type is none', () => {
    expect(getAvailableAccesses({
      ...readingLanguage,
      prosody: { type: 'none' },
    })).toEqual([
      'sense-recognition',
      'surface-reading',
      'spoken-recognition',
      'pronunciation-production',
      'surface-recognition',
    ]);
  });

  it('returns sense only when language data is missing', () => {
    expect(getAvailableAccesses()).toEqual(['sense-recognition']);
  });

  it('maps a reading-critical accent feature into surface-reading (no pitch access)', () => {
    // Russian-like metadata: stress accentuation that is required to read the word.
    // No readingAnnotation: written-form recognition is not independently
    // learnable, but the spoken accesses are.
    expect(getAvailableAccesses({
      name: 'Stress Language',
      settings: { fixed: {} },
      prosody: { type: 'stress-accent', knowledgeAspect: 'reading' },
    })).toEqual([
      'sense-recognition',
      'surface-reading',
      'spoken-recognition',
      'pronunciation-production',
    ]);
  });

  it('keeps a pitch-nuance accent feature in the prosodic-pattern access', () => {
    expect(getAvailableAccesses({
      ...readingLanguage,
      prosody: { type: 'japanese-pitch-accent', knowledgeAspect: 'prosody' },
    })).toEqual([
      'sense-recognition',
      'surface-reading',
      'prosodic-pattern',
      'spoken-recognition',
      'pronunciation-production',
      'surface-recognition',
    ]);
  });

  it('enables gender when the language declares gender data', () => {
    expect(getAvailableAccesses({
      ...readingLanguage,
      gender: { attributeKey: 'gender' },
    })).toEqual([
      'sense-recognition',
      'surface-reading',
      'gender',
      'spoken-recognition',
      'pronunciation-production',
      'surface-recognition',
    ]);
  });

  it('gender coexists with the full reading+prosody set', () => {
    expect(getAvailableAccesses({
      ...readingLanguage,
      prosody: { type: 'japanese-pitch-accent' },
      gender: { attributeKey: 'gender' },
    })).toEqual([
      'sense-recognition',
      'surface-reading',
      'prosodic-pattern',
      'gender',
      'spoken-recognition',
      'pronunciation-production',
      'surface-recognition',
    ]);
  });

  it('real ru package: surface-reading + gender, no pitch access (stress belongs to reading)', async () => {
    const { readFileSync } = await import('fs');
    const ru = JSON.parse(readFileSync('scripts/language-data/source/root-of-app/languages/ru.json', 'utf-8'));
    expect(getAvailableAccesses(ru)).toEqual([
      'sense-recognition',
      'surface-reading',
      'gender',
      'spoken-recognition',
      'pronunciation-production',
      'surface-recognition',
    ]);
  });
});
