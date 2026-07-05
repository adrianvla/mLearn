import { describe, it, expect } from 'vitest';
import {
  extractProsodyData,
  extractProsodyDataForReading,
  extractProsodyPosition,
  extractProsodyPositionFromProsody,
  extractReadingValue,
  extractFirstDefinition,
} from './translationCacheParsers';
import { extractJapanesePitchAccentPayloadPosition } from './japanesePitchAccent';
import { extractProsodyPayloadPosition, hasProsodyPayloadPositionExtractor } from './prosodyPayloadExtractors';
import type { LanguageData, TranslationResponse } from '../../shared/types';

describe('extractJapanesePitchAccentPayloadPosition', () => {
  it('returns null for null/undefined', () => {
    expect(extractJapanesePitchAccentPayloadPosition(null)).toBeNull();
    expect(extractJapanesePitchAccentPayloadPosition(undefined)).toBeNull();
  });

  it('extracts pitch position from nested pitch data', () => {
    expect(extractJapanesePitchAccentPayloadPosition({ pitches: [{ position: 2 }] })).toBe(2);
  });

  it('extracts pitch position from generic saved override payloads', () => {
    expect(extractJapanesePitchAccentPayloadPosition({
      type: 'japanese-pitch-accent',
      position: 2,
    })).toBe(2);
  });

  it('extracts pitch position from array data', () => {
    expect(extractJapanesePitchAccentPayloadPosition([{ pitches: [{ position: 0 }] }])).toBe(0);
  });
});

describe('prosody payload extractors', () => {
  it('routes model-specific payload shapes through the selected prosody type', () => {
    expect(hasProsodyPayloadPositionExtractor('japanese-pitch-accent')).toBe(true);
    expect(extractProsodyPayloadPosition({ pitches: [{ position: 2 }] }, 'japanese-pitch-accent')).toBe(2);
    expect(extractProsodyPayloadPosition({ pitches: [{ position: 2 }] }, 'tone-contour')).toBeNull();
  });
});

describe('extractProsodyPosition', () => {
  it('extracts direct package-defined positions', () => {
    expect(extractProsodyPosition({ type: 'tone-contour', position: 3 })).toBe(3);
  });

  it('does not infer generic prosody positions from Japanese pitch-accent payload shapes', () => {
    expect(extractProsodyPosition({ value: [{ pitches: [{ position: 1 }] }] })).toBeNull();
  });
});

describe('extractProsodyData', () => {
  const japanesePitchLanguage: LanguageData = {
    name: 'Japanese',
    colour_codes: {},
    settings: { fixed: {} },
    prosody: { type: 'japanese-pitch-accent' },
  };

  const noProsodyLanguage: LanguageData = {
    name: 'German',
    colour_codes: {},
    settings: { fixed: {} },
    prosody: { type: 'none' },
  };

  const toneLanguage: LanguageData = {
    name: 'Tone Language',
    colour_codes: {},
    settings: { fixed: {} },
    prosody: { type: 'tone-contour' },
  };

  it('maps Japanese pitch-accent payloads into generic flashcard prosody', () => {
    const raw = { pitches: [{ position: 2 }] };
    const prosody = extractProsodyData(raw, japanesePitchLanguage);

    expect(prosody).toEqual({
      type: 'japanese-pitch-accent',
      position: 2,
      raw,
    });
    expect(extractProsodyPositionFromProsody(prosody)).toBe(2);
  });

  it('maps generic Japanese pitch-accent override payloads into flashcard prosody', () => {
    const raw = { type: 'japanese-pitch-accent', position: 2 };

    expect(extractProsodyData(raw, japanesePitchLanguage)).toEqual({
      type: 'japanese-pitch-accent',
      position: 2,
      raw,
    });
  });

  it('does not invent prosody for languages that do not declare a prosody model', () => {
    expect(extractProsodyData({ pitches: [{ position: 2 }] }, noProsodyLanguage)).toBeUndefined();
    expect(extractProsodyData({ pitches: [{ position: 2 }] }, null)).toBeUndefined();
  });

  it('preserves raw prosody payloads for package-defined future prosody models', () => {
    const raw = { type: 'tone-contour', position: 3, contours: [{ syllable: 'ma', tone: 'rising' }] };

    expect(extractProsodyData(raw, toneLanguage)).toEqual({
      type: 'tone-contour',
      position: 3,
      raw,
    });
  });

  it('requires explicit generic positions or package-declared paths for non-Japanese prosody', () => {
    const raw = { pitches: [{ position: 2 }] };

    expect(extractProsodyData(raw, toneLanguage)).toEqual({
      type: 'tone-contour',
      raw,
    });
  });

  it('accepts package-defined prosody payloads in TranslationResponse slot 3', () => {
    const raw = { contours: [{ syllable: 'ma', tone: 'rising' }] };
    const response: TranslationResponse = {
      data: [
        { definitions: 'mother', reading: 'ma' },
        undefined,
        raw,
      ],
    };

    expect(extractProsodyData(response.data[2], toneLanguage)).toEqual({
      type: 'tone-contour',
      raw,
    });
  });

  it('uses package-declared prosody position paths instead of Japanese-shaped payloads', () => {
    const contourLanguage: LanguageData = {
      name: 'Contour Language',
      colour_codes: {},
      settings: { fixed: {} },
      prosody: {
        type: 'tone-contour',
        positionPath: ['tone', 'number'],
      },
    };
    const raw = { tone: { number: 4, label: 'falling' } };

    expect(extractProsodyData(raw, contourLanguage)).toEqual({
      type: 'tone-contour',
      position: 4,
      raw,
    });
  });

  it('uses package-declared prosody display paths for non-numeric models', () => {
    const contourLanguage: LanguageData = {
      name: 'Contour Language',
      colour_codes: {},
      settings: { fixed: {} },
      prosody: {
        type: 'tone-contour',
        displayPath: ['tone', 'label'],
      },
    };
    const raw = { tone: { label: 'falling-rising' } };

    expect(extractProsodyData(raw, contourLanguage)).toEqual({
      type: 'tone-contour',
      display: 'falling-rising',
      raw,
    });
  });

  it('uses package-declared wildcard prosody paths for nested tone entries', () => {
    const contourLanguage: LanguageData = {
      name: 'Contour Language',
      colour_codes: {},
      settings: { fixed: {} },
      prosody: {
        type: 'tone-contour',
        positionPath: ['tones', '*', 'number'],
        displayPath: ['tones', '*', 'label'],
      },
    };
    const raw = {
      tones: [
        { label: '', number: Number.NaN },
        { label: 'high-rising', number: 2 },
      ],
    };

    expect(extractProsodyData(raw, contourLanguage)).toEqual({
      type: 'tone-contour',
      position: 2,
      display: 'high-rising',
      raw,
    });
  });
});

describe('extractProsodyDataForReading', () => {
  const japanesePitchLanguage: LanguageData = {
    name: 'Japanese',
    colour_codes: {},
    settings: { fixed: {} },
    prosody: { type: 'japanese-pitch-accent' },
  };

  it('binds Japanese pitch accent to the matching reading in multi-reading payloads', () => {
    const data = [
      { definitions: ['to open'], reading: 'あく' },
      { reading: 'ひらく', pitches: [{ position: 2 }] },
    ];

    expect(extractProsodyDataForReading(data, japanesePitchLanguage, (reading) => reading === 'あく')).toBeUndefined();
    expect(extractProsodyDataForReading(data, japanesePitchLanguage, (reading) => reading === 'ひらく')).toEqual({
      type: 'japanese-pitch-accent',
      position: 2,
      raw: { reading: 'ひらく', pitches: [{ position: 2 }] },
    });
  });
});

describe('extractReadingValue', () => {
  const pinyinDictionaryLanguage: LanguageData = {
    name: 'Pinyin Dictionary Language',
    colour_codes: {},
    settings: { fixed: {} },
    runtime: {
      nlp: {
        dictionary: {
          readingPath: ['pinyin', 'value'],
        },
      },
    },
  };

  it('returns null for null/undefined', () => {
    expect(extractReadingValue(null)).toBeNull();
    expect(extractReadingValue(undefined)).toBeNull();
  });

  it('extracts reading from a record', () => {
    expect(extractReadingValue({ reading: 'あめ' })).toBe('あめ');
  });

  it('extracts reading from nested data', () => {
    expect(extractReadingValue([{ reading: 'あたま' }])).toBe('あたま');
  });

  it('uses package-declared dictionary reading paths for transliterations', () => {
    expect(extractReadingValue({ pinyin: { value: 'nǐ hǎo' } }, pinyinDictionaryLanguage)).toBe('nǐ hǎo');
  });

  it('uses wildcard path segments to read transliterations from array payloads', () => {
    const languageData = {
      name: 'Nested Reading Language',
      settings: { fixed: {} },
      runtime: {
        nlp: {
          dictionary: {
            readingPath: ['pronunciations', '*', 'value'],
          },
        },
      },
    } as LanguageData;

    expect(extractReadingValue({
      pronunciations: [
        { system: 'ipa' },
        { system: 'pinyin', value: 'nǐ hǎo' },
      ],
    }, languageData)).toBe('nǐ hǎo');
  });
});

describe('extractFirstDefinition', () => {
  it('returns null for null/undefined', () => {
    expect(extractFirstDefinition(null)).toBeNull();
    expect(extractFirstDefinition(undefined)).toBeNull();
  });

  it('returns null for empty data', () => {
    expect(extractFirstDefinition({ data: [] })).toBeNull();
  });

  it('extracts first definition as a string', () => {
    const response: TranslationResponse = {
      data: [{ definitions: 'rain', reading: 'あめ' }],
    };
    expect(extractFirstDefinition(response)).toBe('rain');
  });

  it('uses package-declared dictionary definition paths', () => {
    const languageData = {
      name: 'Nested Dictionary Language',
      colour_codes: {},
      settings: { fixed: {} },
      runtime: {
        nlp: {
          dictionary: {
            definitionsPath: ['glosses', 'english'],
          },
        },
      },
    } as unknown as LanguageData;

    expect(extractFirstDefinition({
      word: '你好',
      glosses: {
        english: ['<b>hello</b>', 'hi'],
      },
    }, languageData)).toBe('hello');
  });

  it('uses package-declared definition paths inside response arrays', () => {
    const languageData = {
      name: 'Nested Dictionary Language',
      colour_codes: {},
      settings: { fixed: {} },
      runtime: {
        nlp: {
          dictionary: {
            definitionsPath: ['sense', 'gloss'],
          },
        },
      },
    } as unknown as LanguageData;

    const response: TranslationResponse = {
      data: [
        {
          word: 'كتب',
          sense: { gloss: 'to write' },
        } as never,
      ],
    };

    expect(extractFirstDefinition(response, languageData)).toBe('to write');
  });

  it('uses wildcard path segments for nested dictionary sense arrays', () => {
    const languageData = {
      name: 'Nested Sense Language',
      settings: { fixed: {} },
      runtime: {
        nlp: {
          dictionary: {
            definitionsPath: ['senses', '*', 'glosses'],
          },
        },
      },
    } as LanguageData;

    expect(extractFirstDefinition({
      senses: [
        { partOfSpeech: 'noun', glosses: ['house', 'home'] },
        { partOfSpeech: 'verb', glosses: ['to house'] },
      ],
    }, languageData)).toBe('house');
  });

  it('extracts first definition from array', () => {
    const response: TranslationResponse = {
      data: [{ definitions: ['rain', 'candy'], reading: 'あめ' }],
    };
    expect(extractFirstDefinition(response)).toBe('rain');
  });

  it('falls back to second entry when first has no definitions', () => {
    const response: TranslationResponse = {
      data: [
        { definitions: [], reading: 'あめ' },
        { definitions: 'candy', reading: 'あめ' },
      ],
    };
    expect(extractFirstDefinition(response)).toBe('candy');
  });

  it('strips HTML tags from definitions', () => {
    const response: TranslationResponse = {
      data: [{ definitions: '<b>rain</b>', reading: 'あめ' }],
    };
    expect(extractFirstDefinition(response)).toBe('rain');
  });

  it('ignores non-string entries in definitions array', () => {
    const response: TranslationResponse = {
      data: [{ definitions: [null, 'rain', 42] as unknown as string[], reading: 'あめ' }],
    };
    expect(extractFirstDefinition(response)).toBe('rain');
  });

  it('trims whitespace from definitions', () => {
    const response: TranslationResponse = {
      data: [{ definitions: '  rain  ', reading: 'あめ' }],
    };
    expect(extractFirstDefinition(response)).toBe('rain');
  });
});
