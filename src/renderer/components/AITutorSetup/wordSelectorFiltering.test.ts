import { describe, expect, it } from 'vitest';
import { isWordInLanguageScript } from '../../../shared/utils/textUtils';

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
});
