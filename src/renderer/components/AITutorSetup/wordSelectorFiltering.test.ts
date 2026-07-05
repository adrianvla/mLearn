import { describe, expect, it } from 'vitest';
import type { LanguageData } from '../../../shared/types';
import { isWordInLanguageScript } from '../../../shared/utils/textUtils';
import { resolveWordSelectorLanguageData } from './wordSelectorLanguage';

describe('WordSelector language filtering expectations', () => {
  it('accepts German custom words written in Latin script', () => {
    expect(isWordInLanguageScript('Straße', 'de')).toBe(true);
  });

  it('rejects Japanese-script words in German sessions', () => {
    expect(isWordInLanguageScript('こんにちは', 'de')).toBe(false);
  });

  it('rejects Latin-script words in Russian sessions', () => {
    expect(isWordInLanguageScript('hello', 'ru')).toBe(false);
  });

  it('accepts Russian-script words in Russian sessions', () => {
    expect(isWordInLanguageScript('привет', 'ru')).toBe(true);
  });

  it('resolves stored words with metadata for their own language instead of the active language', () => {
    const activeJapanese: LanguageData = {
      name: 'Japanese',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Hira', 'Kana', 'Han'] },
      },
    };
    const arabic: LanguageData = {
      name: 'Arabic',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: {
          acceptedScripts: ['Arab'],
          minWordCodePoints: 2,
          wordScriptValidation: 'only-accepted',
        },
      },
    };

    const resolved = resolveWordSelectorLanguageData('ar', 'ja', { ar: arabic }, activeJapanese);

    expect(resolved).toBe(arabic);
    expect(isWordInLanguageScript('سلام', 'ar', resolved)).toBe(true);
    expect(isWordInLanguageScript('hello', 'ar', resolved)).toBe(false);
  });

  it('does not borrow active language metadata for missing non-active word languages', () => {
    const activeJapanese: LanguageData = {
      name: 'Japanese',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: { scriptProfile: { acceptedScripts: ['Hira', 'Kana', 'Han'] } },
    };

    expect(resolveWordSelectorLanguageData('ar', 'ja', {}, activeJapanese)).toBeNull();
  });
});
