import { describe, it, expect } from 'vitest';
import type { LanguageData } from './types';
import { usesReadingBasedLexemeNormalization, clearReadingLexemeNormalizationCache } from './languageFeatures';

describe('reading lexeme normalization config cache', () => {
  it('recomputes after an explicit clear when reconciled metadata mutates in place', () => {
    const data: LanguageData = {};
    data.textProcessing = { lexemeNormalization: { type: 'surface', surfaceNormalizers: ['lowercase'] } };

    expect(usesReadingBasedLexemeNormalization(data)).toBe(true);

    // Simulate Solid reconcile preserving the LanguageData identity while a
    // package reinstall swaps the normalization kind underneath it.
    data.textProcessing.lexemeNormalization = { type: 'identity' };
    expect(usesReadingBasedLexemeNormalization(data)).toBe(true);

    // The reload path must clear the identity-keyed cache before publishing.
    clearReadingLexemeNormalizationCache();
    expect(usesReadingBasedLexemeNormalization(data)).toBe(false);

    // And a later swap back is picked up after the next clear.
    data.textProcessing.lexemeNormalization = { type: 'reading' };
    expect(usesReadingBasedLexemeNormalization(data)).toBe(false);
    clearReadingLexemeNormalizationCache();
    expect(usesReadingBasedLexemeNormalization(data)).toBe(true);
  });
});
