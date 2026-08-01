import { describe, expect, it } from 'vitest';
import { isLanguageMetadataFileName } from './languageCode';

describe('isLanguageMetadataFileName', () => {
  it.each(['zh.json', 'cu.json', 'de.json', 'ja.json', 'ru.json', 'es.json'])(
    'accepts plain language metadata file %s',
    (file) => {
      expect(isLanguageMetadataFileName(file)).toBe(true);
    },
  );

  it.each(['zh-Hant.json', 'zh-Hans.json', 'ko-KR.json', 'ko-KP.json', 'pt-BR.json', 'es-419.json'])(
    'accepts BCP-47 hyphenated variant file %s',
    (file) => {
      expect(isLanguageMetadataFileName(file)).toBe(true);
    },
  );

  it.each([
    'zh.freq.json',
    'zh.t2s.json',
    'aa.t2s.json',
    'ja.pitch.json',
    'zh-Hant.freq.json',
    'manifest.json.bak',
    'zh.JSON.bak',
    'zh_freq.json',
  ])('rejects non-metadata file %s', (file) => {
    expect(isLanguageMetadataFileName(file)).toBe(false);
  });

  it('rejects non-json files', () => {
    expect(isLanguageMetadataFileName('zh.py')).toBe(false);
    expect(isLanguageMetadataFileName('zh')).toBe(false);
  });
});
