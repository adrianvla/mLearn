import { describe, expect, it } from 'vitest';
import { getProvidedAccessesForCue } from './languageFeatures';
import type { LanguageData } from './types';

describe('package-declared assistance cues', () => {
  const language: LanguageData = { name: 'Future language', learning: { capabilities: {
    'future:relationship': { testableIn: ['srs-review'], providedBy: ['example-audio'] },
    'future:contour': { providedBy: ['word-audio', 'example-audio'] },
    'future:other': { providedBy: ['future:presentation'] },
  } } };

  it('uses package-owned unknown access and cue IDs without registration', () => {
    const roundTripped = JSON.parse(JSON.stringify(language)) as LanguageData;
    expect(getProvidedAccessesForCue(roundTripped, ['future:relationship', 'future:contour'], 'example-audio'))
      .toEqual(['future:relationship', 'future:contour']);
    expect(getProvidedAccessesForCue(roundTripped, ['future:other'], 'future:presentation')).toEqual(['future:other']);
  });

  it('never adds untested capabilities or guesses semantics from a label', () => {
    expect(getProvidedAccessesForCue(language, ['future:relationship'], 'word-audio')).toEqual([]);
    expect(getProvidedAccessesForCue(language, ['future:contour'], 'future:presentation')).toEqual([]);
    expect(getProvidedAccessesForCue(null, ['surface-reading'], 'word-audio')).toEqual([]);
  });
  it.each([{}, true, ['example-audio', 4]])('rejects malformed cue declarations with %j', malformed => {
    const data = { name: 'Malformed', learning: { capabilities: { 'future:x': { providedBy: malformed } } } } as unknown as LanguageData;
    expect(() => getProvidedAccessesForCue(data, ['future:x'], 'example-audio')).toThrow('Invalid providedBy');
  });

});
