import { describe, expect, it } from 'vitest';
import type { LanguageData } from '../../shared/types';
import pitchFixture from '../../../test/fixtures/japanese-pitch-accent-bulk-add-v1.json';
import { getJapanesePitchAccentInfo } from './japanesePitchAccent';
import {
  extractProsodyFromTranslationData,
  normalizeDictionaryReading,
  resolveStoredProsodyForDisplayedReading,
} from './readingProsody';

const japanesePitchLanguage: LanguageData = {
  name: 'Japanese',
  settings: { fixed: {} },
  prosody: { type: 'japanese-pitch-accent' },
  textProcessing: {
    scriptProfile: { acceptedScripts: ['Hira', 'Kana', 'Han'] },
    lexemeNormalization: {
      type: 'surface-reading',
      surfaceScripts: ['Han'],
      readingScripts: ['Hira', 'Kana'],
      readingNormalizer: 'kana-to-hiragana',
    },
    readingAnnotation: {
      type: 'script-reading',
      annotationScripts: ['Han'],
      surfaceSuffixScripts: ['Hira', 'Kana'],
    },
  },
};

const pinyinLanguage: LanguageData = {
  name: 'Chinese',
  settings: { fixed: {} },
  textProcessing: {
    scriptProfile: { acceptedScripts: ['Han', 'Latn'] },
    lexemeNormalization: {
      type: 'reading',
      surfaceScripts: ['Han'],
      readingScripts: ['Latn'],
      readingNormalizer: 'lowercase-strip-diacritics',
    },
    readingAnnotation: {
      type: 'script-reading',
      annotationScripts: ['Han'],
      readingSeparator: ' ',
    },
  },
};

const toneLanguage: LanguageData = {
  name: 'Tone language',
  settings: { fixed: {} },
  prosody: {
    type: 'tone-contour',
    displayPath: ['contours', '*', 'tone'],
  },
};

describe('normalizeDictionaryReading', () => {
  it('preserves configured Latin reading spaces for pinyin-style readings', () => {
    expect(normalizeDictionaryReading('你好 nǐ hǎo', pinyinLanguage)).toBe('nǐ hǎo');
  });

  it('normalizes compact dictionary reading text without metadata', () => {
    expect(normalizeDictionaryReading('<b>き ょ う</b>')).toBe('きょう');
  });
});

describe('extractProsodyFromTranslationData', () => {
  it('binds Japanese pitch data to the matching card reading', () => {
    const translationData = {
      data: [
        { reading: 'あく', definitions: ['to open'] },
        { reading: 'ひらく', pitches: [{ position: 2 }] },
      ],
    };

    expect(extractProsodyFromTranslationData(translationData, japanesePitchLanguage, 'あく')).toBeUndefined();
    expect(extractProsodyFromTranslationData(translationData, japanesePitchLanguage, 'ひらく')).toEqual({
      type: 'japanese-pitch-accent',
      position: 2,
      raw: { reading: 'ひらく', pitches: [{ position: 2 }] },
    });
  });

  it('binds a secondary reading from a headword payload with multiple pitch rows', () => {
    const translationData = {
      data: [
        { reading: 'あさって', definitions: ['day after tomorrow'] },
        { reading: 'あさって', definitions: ['day after tomorrow'] },
        [
          ['明後日', 'pitch', { reading: 'あさって', pitches: [{ position: 2 }] }],
          ['明後日', 'pitch', { reading: 'みょうごにち', pitches: [{ position: 3 }] }],
        ],
      ],
    };

    expect(extractProsodyFromTranslationData(translationData, japanesePitchLanguage, 'みょうごにち')).toEqual({
      type: 'japanese-pitch-accent',
      position: 3,
      raw: { reading: 'みょうごにち', pitches: [{ position: 3 }] },
    });
  });

  it('binds the real 迫る records by reading, independent of dictionary result order', () => {
    const records = pitchFixture.records.historicalMismatch.pitchRecords.map((record) => record.raw[2]);
    for (const orderedRecords of [records, [...records].reverse()]) {
      const response = {
        data: [
          { reading: 'せまる', definitions: ['to approach'] },
          { reading: 'せる', definitions: [] },
          orderedRecords,
        ],
      };
      const semaru = extractProsodyFromTranslationData(response, japanesePitchLanguage, 'せまる')?.position;
      const seru = extractProsodyFromTranslationData(response, japanesePitchLanguage, 'せる')?.position;
      expect(semaru).toBe(2);
      expect(seru).toBe(1);
      expect(getJapanesePitchAccentInfo(semaru, 'せまる')?.pattern.map((high) => high ? 'H' : 'L'))
        .toEqual(pitchFixture.records.historicalMismatch.expectedRenderer['せまる'].contour);
      expect(getJapanesePitchAccentInfo(seru, 'せる')?.pattern.map((high) => high ? 'H' : 'L'))
        .toEqual(pitchFixture.records.historicalMismatch.expectedRenderer['せる'].contour);
    }
  });

  it('leaves pitch unresolved when a response record cannot be associated with the selected reading', () => {
    expect(extractProsodyFromTranslationData({
      data: [
        { reading: 'せまる', definitions: ['to approach'] },
        {},
        { pitches: [{ position: 1 }] },
      ],
    }, japanesePitchLanguage, 'せまる')).toBeUndefined();
  });

  it('leaves conflicting same-reading source positions unresolved', () => {
    expect(extractProsodyFromTranslationData({
      data: [
        { reading: 'せまる', definitions: ['to approach'] },
        [
          ['迫る', 'pitch', { reading: 'せまる', pitches: [{ position: 2 }] }],
          ['迫る', 'pitch', { reading: 'せまる', pitches: [{ position: 3 }] }],
        ],
      ],
    }, japanesePitchLanguage, 'せまる')).toBeUndefined();
  });

  it('keeps 順 / じゅん heiban [0] as the positive control', () => {
    const raw = pitchFixture.records.positiveControl.pitchRecord.raw[2];
    expect(extractProsodyFromTranslationData({
      data: [{ reading: 'じゅん', definitions: ['order'] }, {}, raw],
    }, japanesePitchLanguage, 'じゅん')?.position).toBe(0);
    const rendered = getJapanesePitchAccentInfo(0, 'じゅん');
    expect(rendered?.moraCharCounts).toEqual([2, 1]);
    expect(rendered?.pattern.map((high) => high ? 'H' : 'L')).toEqual(['L', 'H']);
    expect(rendered?.particleAccent).toBe(true);
  });

  it('leaves package-defined payloads unresolved when their reading association is absent', () => {
    const raw = { contours: [{ syllable: 'ma', tone: 'rising' }] };
    expect(extractProsodyFromTranslationData({
      data: [
        { reading: '', definitions: ['mother'] },
        { reading: '', definitions: [] },
        raw,
      ],
    }, toneLanguage)).toBeUndefined();
  });
});

describe('resolveStoredProsodyForDisplayedReading', () => {
  it('attaches saved position-only prosody to the saved displayed reading', () => {
    const prosody = {
      type: 'japanese-pitch-accent' as const,
      position: 2,
      raw: { type: 'japanese-pitch-accent', position: 2 },
    };

    expect(resolveStoredProsodyForDisplayedReading({
      prosody,
      displayedReading: 'ひらく',
      savedReadings: ['ひらく'],
      languageData: japanesePitchLanguage,
    })).toBe(prosody);
  });

  it('does not leak position-only prosody to a different displayed reading', () => {
    const prosody = {
      type: 'japanese-pitch-accent' as const,
      position: 2,
      raw: { type: 'japanese-pitch-accent', position: 2 },
    };

    expect(resolveStoredProsodyForDisplayedReading({
      prosody,
      displayedReading: 'あく',
      savedReadings: ['ひらく'],
      languageData: japanesePitchLanguage,
    })).toBeUndefined();
  });

  it('prefers the raw payload reading when one is present', () => {
    const prosody = {
      type: 'japanese-pitch-accent' as const,
      position: 2,
      raw: { reading: 'ひらく', pitches: [{ position: 2 }] },
    };

    expect(resolveStoredProsodyForDisplayedReading({
      prosody,
      displayedReading: 'あく',
      savedReadings: ['あく'],
      languageData: japanesePitchLanguage,
    })).toBeUndefined();
    expect(resolveStoredProsodyForDisplayedReading({
      prosody,
      displayedReading: 'ひらく',
      savedReadings: ['あく'],
      languageData: japanesePitchLanguage,
    })).toEqual({
      type: 'japanese-pitch-accent',
      position: 2,
      raw: { reading: 'ひらく', pitches: [{ position: 2 }] },
    });
  });
});
