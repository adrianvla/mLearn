import { describe, expect, it } from 'vitest';
import type { LanguageData } from '../../shared/types';
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

  it('preserves package-defined future prosody payloads for saved flashcards', () => {
    const raw = { contours: [{ syllable: 'ma', tone: 'rising' }] };
    expect(extractProsodyFromTranslationData({
      data: [
        { reading: 'ma', definitions: ['mother'] },
        { reading: '', definitions: [] },
        raw,
      ],
    }, toneLanguage)).toEqual({
      type: 'tone-contour',
      display: 'rising',
      raw,
    });
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
