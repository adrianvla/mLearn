import { describe, it, expect, vi } from 'vitest';
import {
  getAnkiWordKnowledgeStatus,
  numericToWordStatus,
  wordStatusToNumeric,
  getEaseFromWordStatus,
  getAnkiEaseForStatus,
  extractReadingFromEntries,
  resolveProsodyForHover,
  buildWordHoverFlashcardContent,
} from './wordHoverHelpers';
import {
  extractProsodyFromTranslationData as extractFlashcardProsodyFromTranslationData,
  normalizeDictionaryReading,
} from '../../utils/readingProsody';
import { WORD_STATUS } from '../../../shared/constants';
import type { LanguageData } from '../../../shared/types';

const pinyinLanguage: LanguageData = {
  name: 'Chinese',
  colour_codes: {},
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
  runtime: {
    nlp: {
      dictionary: {
        readingPath: ['pinyin', 'value'],
        definitionsPath: ['glosses', 'english'],
      },
    },
  },
};

const japanesePitchLanguage: LanguageData = {
  name: 'Japanese',
  colour_codes: {},
  settings: { fixed: {} },
  prosody: { type: 'japanese-pitch-accent' },
};

const toneLanguage: LanguageData = {
  name: 'Tone Language',
  colour_codes: {},
  settings: { fixed: {} },
  prosody: { type: 'tone-contour', positionLabel: 'Tone position' },
};

describe('getAnkiWordKnowledgeStatus', () => {
  it('returns null when there are no matching Anki cards', () => {
    expect(getAnkiWordKnowledgeStatus([], 1550, 1800)).toBeNull();
    expect(getAnkiWordKnowledgeStatus(null, 1550, 1800)).toBeNull();
  });

  it('returns unknown for new cards below the learning threshold', () => {
    expect(getAnkiWordKnowledgeStatus([{ factor: 1300, queue: 0, type: 0 }], 1550, 1800)).toBe('unknown');
  });

  it('returns learning for learning queue cards', () => {
    expect(getAnkiWordKnowledgeStatus([{ factor: 1500, queue: 1, type: 1 }], 1550, 1800)).toBe('learning');
  });

  it('returns known for review cards', () => {
    expect(getAnkiWordKnowledgeStatus([{ factor: 1700, queue: 2, type: 2 }], 1550, 1800)).toBe('known');
  });

  it('uses the highest status across multiple Anki cards for the same word', () => {
    expect(getAnkiWordKnowledgeStatus([
      { factor: 1300, queue: 0, type: 0 },
      { factor: 2300, queue: 2, type: 2 },
    ], 1550, 1800)).toBe('known');
  });
});

describe('numericToWordStatus', () => {
  it('converts WORD_STATUS values', () => {
    expect(numericToWordStatus(WORD_STATUS.UNKNOWN)).toBe('unknown');
    expect(numericToWordStatus(WORD_STATUS.LEARNING)).toBe('learning');
    expect(numericToWordStatus(WORD_STATUS.KNOWN)).toBe('known');
  });

  it('defaults to unknown for unrecognized', () => {
    expect(numericToWordStatus(999)).toBe('unknown');
  });
});

describe('wordStatusToNumeric', () => {
  it('converts word status strings', () => {
    expect(wordStatusToNumeric('unknown')).toBe(WORD_STATUS.UNKNOWN);
    expect(wordStatusToNumeric('learning')).toBe(WORD_STATUS.LEARNING);
    expect(wordStatusToNumeric('known')).toBe(WORD_STATUS.KNOWN);
  });
});

describe('getEaseFromWordStatus', () => {
  it('returns default eases when no custom values are provided', () => {
    expect(getEaseFromWordStatus('learning')).toBeCloseTo(1.55);
    expect(getEaseFromWordStatus('known')).toBeCloseTo(1.8);
    expect(getEaseFromWordStatus('unknown')).toBeCloseTo(1.3);
  });

  it('uses custom ease values when provided', () => {
    expect(getEaseFromWordStatus('learning', 2.0, 2.5)).toBeCloseTo(2.0);
    expect(getEaseFromWordStatus('known', 2.0, 2.5)).toBeCloseTo(2.5);
  });

  it('returns minimum ease for unknown status regardless of custom values', () => {
    expect(getEaseFromWordStatus('unknown', 2.0, 2.5)).toBeCloseTo(1.3);
  });
});

describe('getAnkiEaseForStatus', () => {
  it('returns ankiLearningEase for learning status', () => {
    expect(getAnkiEaseForStatus('learning', 1550, 1800)).toBe(1550);
    expect(getAnkiEaseForStatus('learning', 2000, 2500)).toBe(2000);
  });

  it('returns ankiKnownEase for known status', () => {
    expect(getAnkiEaseForStatus('known', 1550, 1800)).toBe(1800);
    expect(getAnkiEaseForStatus('known', 2000, 2500)).toBe(2500);
  });

  it('returns Anki minimum ease (1300) for unknown status', () => {
    expect(getAnkiEaseForStatus('unknown', 1550, 1800)).toBe(1300);
  });
});

describe('normalizeDictionaryReading', () => {
  it('preserves configured Latin reading spaces for pinyin-style readings', () => {
    expect(normalizeDictionaryReading('你好 nǐ hǎo', pinyinLanguage)).toBe('nǐ hǎo');
  });

  it('normalizes compact dictionary reading text without metadata', () => {
    expect(normalizeDictionaryReading('<b>き ょ う</b>')).toBe('きょう');
  });
});

describe('extractReadingFromEntries', () => {
  it('uses the language package declared dictionary reading path', () => {
    expect(extractReadingFromEntries([
      {
        word: '你好',
        pinyin: { value: 'nǐ hǎo' },
        definitions: ['hello'],
      },
    ], pinyinLanguage)).toBe('nǐ hǎo');
  });
});

describe('extractFlashcardProsodyFromTranslationData', () => {
  it('maps declared Japanese pitch data into generic flashcard prosody', () => {
    const result = extractFlashcardProsodyFromTranslationData({
      data: [
        { reading: 'やっかい', definitions: ['trouble'] },
        { reading: '', definitions: [] },
        { pitches: [{ position: 0 }] },
      ],
    }, japanesePitchLanguage, 'やっかい');

    expect(result?.type).toBe('japanese-pitch-accent');
    expect(result?.position).toBe(0);
  });

  it('binds Japanese pitch data to the matching card reading', () => {
    const translationData = {
      data: [
        { reading: 'あく', definitions: ['to open'] },
        { reading: 'ひらく', pitches: [{ position: 2 }] },
      ],
    };

    expect(extractFlashcardProsodyFromTranslationData(translationData, japanesePitchLanguage, 'あく')).toBeUndefined();
    expect(extractFlashcardProsodyFromTranslationData(translationData, japanesePitchLanguage, 'ひらく')).toEqual({
      type: 'japanese-pitch-accent',
      position: 2,
      raw: { reading: 'ひらく', pitches: [{ position: 2 }] },
    });
  });

  it('does not create prosody when the language has no prosody model', () => {
    const result = extractFlashcardProsodyFromTranslationData({
      data: [
        { reading: 'test', definitions: ['test'] },
        { reading: '', definitions: [] },
        { pitches: [{ position: 0 }] },
      ],
    }, pinyinLanguage);

    expect(result).toBeUndefined();
  });

  it('preserves package-defined future prosody payloads for saved flashcards', () => {
    const raw = { contours: [{ syllable: 'ma', tone: 'rising' }] };
    const result = extractFlashcardProsodyFromTranslationData({
      data: [
        { reading: 'ma', definitions: ['mother'] },
        { reading: '', definitions: [] },
        raw,
      ],
    }, toneLanguage);

    expect(result).toEqual({
      type: 'tone-contour',
      raw,
    });
  });
});

describe('resolveProsodyForHover for Japanese pitch accent', () => {
  const baseOptions = {
    showProsody: true,
    getCanonicalForm: (word: string) => word,
    getCachedTranslation: () => null,
    languageData: japanesePitchLanguage,
    fallbackLabel: 'Prosody position',
  };

  const translationWithPitch = (position: number, reading = 'やっかい') => ({
    data: [
      { reading, definitions: ['trouble'] },
      { reading: '', definitions: [] },
      { pitches: [{ position }] },
    ],
  });

  it('returns null when pitch accent is disabled', () => {
    expect(resolveProsodyForHover({
      ...baseOptions,
      word: '厄介',
      showProsody: false,
      translationData: translationWithPitch(0),
    })).toBeNull();
  });

  it('returns pitch from the current translation data', () => {
    const result = resolveProsodyForHover({
      ...baseOptions,
      word: '厄介',
      translationData: translationWithPitch(0, 'やっかい'),
    });
    expect(result).toEqual({
      type: 'japanese-pitch-accent',
      renderer: 'inline-overlay',
      overlayRenderer: 'japanese-pitch-accent',
      position: 0,
      reading: 'やっかい',
    });
  });

  it('uses the extracted dictionary reading to bind separate pitch payload entries', () => {
    const result = resolveProsodyForHover({
      ...baseOptions,
      word: '楽しい',
      translationData: {
        data: [
          { reading: 'たのしい', definitions: ['enjoyable'] },
          ['楽しい', 'pitch', { reading: 'たのしい', pitches: [{ position: 3 }] }],
        ],
      },
    });

    expect(result).toEqual({
      type: 'japanese-pitch-accent',
      renderer: 'inline-overlay',
      overlayRenderer: 'japanese-pitch-accent',
      position: 3,
      reading: 'たのしい',
    });
  });

  it('normalizes readings through language metadata declared by the pitch package', () => {
    const pitchLanguageWithReadingRules: LanguageData = {
      ...pinyinLanguage,
      prosody: { type: 'japanese-pitch-accent' },
    };
    const result = resolveProsodyForHover({
      ...baseOptions,
      word: '你好',
      translationData: translationWithPitch(0, '你好 ni hao'),
      languageData: pitchLanguageWithReadingRules,
    });
    expect(result).toEqual({
      type: 'japanese-pitch-accent',
      renderer: 'inline-overlay',
      overlayRenderer: 'japanese-pitch-accent',
      position: 0,
      reading: 'ni hao',
    });
  });

  it('does not render non-pitch prosody with the Japanese pitch resolver', () => {
    const result = resolveProsodyForHover({
      ...baseOptions,
      word: 'ma',
      translationData: translationWithPitch(0, 'ma'),
      languageData: toneLanguage,
    });
    expect(result).toBeNull();
  });

  it('prefers the token reading over the cached reading', () => {
    const result = resolveProsodyForHover({
      ...baseOptions,
      word: '厄介',
      reading: 'やっかい',
      translationData: translationWithPitch(0, 'cached-reading'),
    });
    expect(result).toEqual({
      type: 'japanese-pitch-accent',
      renderer: 'inline-overlay',
      overlayRenderer: 'japanese-pitch-accent',
      position: 0,
      reading: 'やっかい',
    });
  });

  it('falls back to the canonical form when the hovered word has no pitch data', () => {
    const result = resolveProsodyForHover({
      ...baseOptions,
      word: 'やっかい',
      reading: 'やっかい',
      getCanonicalForm: (word) => word === 'やっかい' ? '厄介' : word,
      getCachedTranslation: (word) =>
        word === '厄介' ? translationWithPitch(0, 'やっかい') : null,
    });
    expect(result).toEqual({
      type: 'japanese-pitch-accent',
      renderer: 'inline-overlay',
      overlayRenderer: 'japanese-pitch-accent',
      position: 0,
      reading: 'やっかい',
    });
  });

  it('does not fallback when the current word already has pitch data', () => {
    const getCachedTranslation = vi.fn(() => translationWithPitch(1, 'different'));
    const result = resolveProsodyForHover({
      ...baseOptions,
      word: 'やっかい',
      getCanonicalForm: (word) => word === 'やっかい' ? '厄介' : word,
      getCachedTranslation,
      translationData: translationWithPitch(0, 'やっかい'),
    });
    expect(result).toEqual({
      type: 'japanese-pitch-accent',
      renderer: 'inline-overlay',
      overlayRenderer: 'japanese-pitch-accent',
      position: 0,
      reading: 'やっかい',
    });
    expect(getCachedTranslation).not.toHaveBeenCalled();
  });

  it('returns null when no pitch data exists for the word or its canonical form', () => {
    const result = resolveProsodyForHover({
      ...baseOptions,
      word: 'やっかい',
      getCanonicalForm: (word) => word === 'やっかい' ? '厄介' : word,
      getCachedTranslation: () => ({
        data: [
          { reading: 'やっかい', definitions: ['trouble'] },
          { reading: '', definitions: [] },
          null,
        ],
      }),
    });
    expect(result).toBeNull();
  });
});

describe('resolveProsodyForHover for metadata-defined prosody', () => {
  const baseOptions = {
    showProsody: true,
    getCanonicalForm: (word: string) => word,
    getCachedTranslation: () => null,
    languageData: toneLanguage,
    fallbackLabel: 'Prosody position',
  };

  const translationWithProsody = (position: number) => ({
    data: [
      { reading: 'ma', definitions: ['mother'] },
      { reading: '', definitions: [] },
      { type: 'tone-contour', position },
    ],
  });

  it('returns package-defined non-Japanese prosody position data', () => {
    const result = resolveProsodyForHover({
      ...baseOptions,
      word: 'ma',
      translationData: translationWithProsody(2),
    });

    expect(result).toEqual({
      value: '2',
      type: 'tone-contour',
      renderer: 'label',
      label: 'Tone position',
      position: 2,
    });
  });

  it('returns package-defined non-Japanese prosody display data without numeric positions', () => {
    const displayOnlyLanguage: LanguageData = {
      name: 'Display Prosody Language',
      colour_codes: {},
      settings: { fixed: {} },
      prosody: {
        type: 'tone-contour',
        positionLabel: 'Tone contour',
        displayPath: ['tone', 'label'],
      },
    };

    const result = resolveProsodyForHover({
      ...baseOptions,
      word: 'ma',
      languageData: displayOnlyLanguage,
      translationData: {
        data: [
          { reading: 'ma', definitions: ['mother'] },
          { reading: '', definitions: [] },
          { tone: { label: 'falling-rising' } },
        ],
      },
    });

    expect(result).toEqual({
      type: 'tone-contour',
      renderer: 'label',
      label: 'Tone contour',
      value: 'falling-rising',
    });
  });

  it('routes Japanese pitch accent through the same metadata resolver', () => {
    const result = resolveProsodyForHover({
      ...baseOptions,
      word: '厄介',
      translationData: {
        data: [
          { reading: 'やっかい', definitions: ['trouble'] },
          { reading: '', definitions: [] },
          { pitches: [{ position: 0 }] },
        ],
      },
      languageData: japanesePitchLanguage,
    });

    expect(result).toEqual({
      type: 'japanese-pitch-accent',
      renderer: 'inline-overlay',
      overlayRenderer: 'japanese-pitch-accent',
      position: 0,
      reading: 'やっかい',
    });
  });

  it('falls back to the canonical form when the hovered word has no prosody data', () => {
    const result = resolveProsodyForHover({
      ...baseOptions,
      word: 'surface',
      getCanonicalForm: (word) => word === 'surface' ? 'canonical' : word,
      getCachedTranslation: (word) => word === 'canonical' ? translationWithProsody(1) : null,
    });

    expect(result).toEqual({
      value: '1',
      type: 'tone-contour',
      renderer: 'label',
      label: 'Tone position',
      position: 1,
    });
  });
});

describe('buildWordHoverFlashcardContent', () => {
  it('does not fabricate reading fields when no distinct reading exists', async () => {
    const result = await buildWordHoverFlashcardContent({
      token: { word: 'Haus', actual_word: 'Haus', type: 'NOUN' },
      word: 'Haus',
      translationData: {
        data: [
          { reading: '', definitions: 'house' },
          { reading: '', definitions: '<div>house</div>' },
        ],
      },
      contextPhrase: 'Das Haus ist groß.',
      wordStatus: 'unknown',
      colourCodes: {},
      languageData: {
        name: 'German',
        colour_codes: {},
        settings: { fixed: {} },
        textProcessing: { scriptProfile: { acceptedScripts: ['Latn'] } },
      },
      tokenize: async () => [],
    });

    expect(result.content.back).toBe('house');
    expect(result.content.reading).toBeUndefined();
    expect(result.content.pronunciation).toBeUndefined();
  });

  it('uses package-declared dictionary reading paths when saving hover flashcards', async () => {
    const result = await buildWordHoverFlashcardContent({
      token: { word: '你好', actual_word: '你好', type: 'word' },
      word: '你好',
      translationData: {
        data: [
          {
            word: '你好',
            pinyin: { value: 'nǐ hǎo' },
            definitions: 'hello',
          },
          { definitions: '<div>hello</div>' },
        ],
      },
      contextPhrase: '你好。',
      wordStatus: 'unknown',
      colourCodes: {},
      languageData: pinyinLanguage,
      tokenize: async () => [],
    });

    expect(result.content.reading).toBe('nǐ hǎo');
    expect(result.content.pronunciation).toBe('nǐ hǎo');
  });

  it('does not save a fake level when the language package has no frequency level for the word', async () => {
    const result = await buildWordHoverFlashcardContent({
      token: { word: 'Haus', actual_word: 'Haus', type: 'NOUN' },
      word: 'Haus',
      translationData: {
        data: [
          { definitions: 'house' },
          { definitions: '<div>house</div>' },
        ],
      },
      contextPhrase: 'Das Haus ist groß.',
      level: undefined,
      wordStatus: 'unknown',
      colourCodes: {},
      languageData: {
        name: 'German',
        colour_codes: {},
        settings: { fixed: {} },
        textProcessing: { scriptProfile: { acceptedScripts: ['Latn'] } },
      },
      tokenize: async () => [],
    });

    expect(result.content.level).toBeUndefined();
  });

  it('uses package-declared dictionary definition paths when saving hover flashcards', async () => {
    const result = await buildWordHoverFlashcardContent({
      token: { word: '你好', actual_word: '你好', type: 'word' },
      word: '你好',
      translationData: {
        data: [
          {
            word: '你好',
            pinyin: { value: 'nǐ hǎo' },
            glosses: { english: ['hello', 'hi'] },
          },
          {
            glosses: { english: ['<div>hello</div>'] },
          },
        ],
      },
      contextPhrase: '你好。',
      wordStatus: 'unknown',
      colourCodes: {},
      languageData: pinyinLanguage,
      tokenize: async () => [],
    });

    expect(result.content.back).toBe('hello; hi');
    expect(result.content.translation).toEqual(['hello', 'hi']);
    expect(result.content.definition).toEqual(['<div>hello</div>']);
  });
});
