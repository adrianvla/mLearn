import { describe, expect, it, vi } from 'vitest';
import type { LanguageData, SuggestedFlashcard, TranslationResponse } from '../../../shared/types';
import {
  buildSuggestedLevelFilterOptions,
  buildSuggestedFlashcardPreviewContent,
  buildSuggestedWordLookupOptions,
  groupSuggestedWordsByLanguageForWarmCache,
  resolveSuggestedLevel,
  suggestedLevelFilterMatches,
} from './flashcardsSuggestedPreview';

function makeSuggestion(overrides: Partial<SuggestedFlashcard> = {}): SuggestedFlashcard {
  return {
    id: 'suggestion-1',
    word: 'سلام',
    language: 'ar',
    level: null,
    createdAt: 1,
    lastSeen: 1,
    count: 1,
    ...overrides,
  };
}

describe('buildSuggestedFlashcardPreviewContent', () => {
  it('builds lookup options from the suggestion language instead of the active language', () => {
    const tools = {
      getCanonicalFormForLanguage: vi.fn((language: string, word: string) => `${language}:${word}:canonical`),
      getWordVariantsForLanguage: vi.fn((language: string, word: string) => [`${language}:${word}:variant`]),
      getReadingVariantsForLanguage: vi.fn((language: string, reading: string) => [`${language}:${reading}:reading`]),
      langData: {
        ar: { name: 'Arabic', targetLanguage: 'ar' } as LanguageData,
      },
      currentLangData: vi.fn(() => null),
    };
    const options = buildSuggestedWordLookupOptions({
      language: 'de',
      uiLanguage: 'en',
      dictionaryTargetLanguages: {
        de: 'en',
        ar: 'fr',
      },
    }, 'ar', tools);

    expect(options.getCanonicalForm?.('سلام')).toBe('ar:سلام:canonical');
    expect(options.getWordVariants?.('سلام')).toEqual(['ar:سلام:variant']);
    expect(options.getReadingVariants?.('salaam')).toEqual(['ar:salaam:reading']);
    expect(options.dictionaryTargetLanguage?.()).toBe('fr');
    expect(options.languageData?.()).toEqual({ name: 'Arabic', targetLanguage: 'ar' });
  });

  it('uses the suggestion language for cache lookup and metadata extraction', () => {
    const arabicToneLanguage: LanguageData = {
      name: 'Arabic tone test',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: { scriptProfile: { acceptedScripts: ['Arab'] } },
      prosody: { type: 'tone-contour' },
    };
    const translation: TranslationResponse = {
      data: [
        { definitions: ['peace'] },
        {},
        { tone: 'falling' },
      ],
    };
    const getCachedTranslation = vi.fn(() => translation);
    const getCachedReading = vi.fn(() => 'salaam');
    const getLanguageData = vi.fn(() => arabicToneLanguage);
    const lookupOptions = {
      getCanonicalForm: (word: string) => word,
      getWordVariants: () => [] as string[],
      dictionaryTargetLanguage: () => 'fr',
    };

    const content = buildSuggestedFlashcardPreviewContent(
      makeSuggestion(),
      lookupOptions,
      { getCachedTranslation, getCachedReading, getLanguageData },
    );

    expect(getLanguageData).toHaveBeenCalledWith('ar');
    expect(getCachedTranslation).toHaveBeenCalledWith('سلام', 'ar', lookupOptions);
    expect(getCachedReading).toHaveBeenCalledWith('سلام', 'ar', lookupOptions);
    expect(content).toMatchObject({
      front: 'سلام',
      reading: 'salaam',
      back: 'peace',
      prosody: {
        type: 'tone-contour',
        raw: { tone: 'falling' },
      },
    });
    expect((content as unknown as Record<string, unknown>).pitchAccent).toBeUndefined();
  });

  it('prefers a saved suggestion reading over cached readings', () => {
    const content = buildSuggestedFlashcardPreviewContent(
      makeSuggestion({ reading: 'saved-reading' }),
      {},
      {
        getCachedTranslation: () => null,
        getCachedReading: () => 'cached-reading',
        getLanguageData: () => null,
      },
    );

    expect(content.reading).toBe('saved-reading');
  });

  it('groups cache warmup words by suggestion language', () => {
    const groups = groupSuggestedWordsByLanguageForWarmCache([
      makeSuggestion({ id: 'ar-1', word: 'سلام', language: 'ar' }),
      makeSuggestion({ id: 'ar-2', word: 'سلام', language: 'ar' }),
      makeSuggestion({ id: 'de-1', word: 'Haus', language: 'de' }),
      makeSuggestion({ id: 'blank', word: '   ', language: 'de' }),
    ], 'ja');

    expect(groups).toEqual([
      { language: 'ar', words: ['سلام'] },
      { language: 'de', words: ['Haus'] },
    ]);
  });

  it('builds language-qualified level filters for mixed-language suggestions', () => {
    const options = buildSuggestedLevelFilterOptions({
      suggestions: [
        makeSuggestion({ id: 'ja-1', word: '赤い', language: 'ja', level: 5 }),
        makeSuggestion({ id: 'de-1', word: 'Haus', language: 'de', level: 1 }),
        makeSuggestion({ id: 'de-2', word: 'Nebensatz', language: 'de', level: 2 }),
      ],
      languageDataFor: (language) => ({
        name: language === 'de' ? 'German' : 'Japanese',
        colour_codes: {},
        settings: { fixed: {} },
        frequencyLevels: language === 'de'
          ? { names: { '1': 'A1', '2': 'A2' }, difficulty: 'higher-is-harder', displayOrder: 'ascending' }
          : { names: { '5': 'N5' }, difficulty: 'lower-is-harder', displayOrder: 'descending' },
      }),
      t: (key) => key,
    });

    expect(options).toEqual([
      { value: 'all', label: 'mlearn.Flashcards.Suggested.Filter.AllLevels' },
      { value: 'level:de:1', label: 'German A1' },
      { value: 'level:de:2', label: 'German A2' },
      { value: 'level:ja:5', label: 'Japanese N5' },
      { value: 'unknown', label: 'mlearn.Flashcards.Suggested.Filter.Unknown' },
    ]);
  });

  it('localizes mixed-language level filter language names through the display locale', () => {
    const options = buildSuggestedLevelFilterOptions({
      suggestions: [
        makeSuggestion({ id: 'ar-1', word: 'سلام', language: 'ar', level: 1 }),
        makeSuggestion({ id: 'de-1', word: 'Haus', language: 'de', level: 1 }),
      ],
      languageDataFor: (language) => ({
        name: language === 'ar' ? 'Arabic' : 'German',
        colour_codes: {},
        settings: { fixed: {} },
        frequencyLevels: {
          names: { '1': 'A1' },
          displayOrder: 'ascending',
        },
      }),
      t: (key) => key,
      displayLocale: 'de',
    });

    expect(options).toContainEqual({ value: 'level:ar:1', label: 'Arabisch A1' });
  });

  it('matches suggested level filters by language and level together', () => {
    const germanA1 = makeSuggestion({ id: 'de-1', language: 'de', level: 1 });
    const japaneseN5 = makeSuggestion({ id: 'ja-5', language: 'ja', level: 5 });
    const unknownGerman = makeSuggestion({ id: 'de-x', language: 'de', level: null });

    expect(suggestedLevelFilterMatches(germanA1, 'level:de:1')).toBe(true);
    expect(suggestedLevelFilterMatches(japaneseN5, 'level:de:1')).toBe(false);
    expect(suggestedLevelFilterMatches(unknownGerman, 'unknown')).toBe(true);
    expect(suggestedLevelFilterMatches(germanA1, 'unknown')).toBe(false);
  });

  it('derives missing suggested levels from installed per-language frequency data', () => {
    const options = buildSuggestedLevelFilterOptions({
      suggestions: [
        makeSuggestion({ id: 'de-1', word: 'Haus', language: 'de', level: null }),
        makeSuggestion({ id: 'fa-1', word: 'کتاب', language: 'fa', level: null }),
      ],
      languageDataFor: (language) => ({
        name: language === 'de' ? 'German' : 'Farsi',
        colour_codes: {},
        settings: { fixed: {} },
        frequencyLevels: {
          names: language === 'de' ? { '1': 'A1' } : { '2': 'Beginner' },
        },
      }),
      getFrequencyForLanguage: (language, word) => {
        if (language === 'de' && word === 'Haus') return { raw_level: 1, level: 'A1', reading: 'Haus' };
        if (language === 'fa' && word === 'کتاب') return { raw_level: 2, level: 'Beginner', reading: 'ketab' };
        return null;
      },
      t: (key) => key,
    });

    expect(options).toEqual([
      { value: 'all', label: 'mlearn.Flashcards.Suggested.Filter.AllLevels' },
      { value: 'level:de:1', label: 'German A1' },
      { value: 'level:fa:2', label: 'Farsi Beginner' },
      { value: 'unknown', label: 'mlearn.Flashcards.Suggested.Filter.Unknown' },
    ]);
  });

  it('omits non-displayable sentinel levels from suggested level filters', () => {
    const languageData: LanguageData = {
      name: 'Japanese',
      colour_codes: {},
      settings: { fixed: {} },
      frequencyLevels: {
        names: { '5': 'N5' },
        difficulty: 'lower-is-harder',
        displayOrder: 'descending',
      },
    };

    const options = buildSuggestedLevelFilterOptions({
      suggestions: [
        makeSuggestion({ id: 'ja-sentinel', word: '赤い', language: 'ja', level: -1 }),
        makeSuggestion({ id: 'ja-n5', word: '猫', language: 'ja', level: 5 }),
      ],
      languageDataFor: () => languageData,
      t: (key) => key,
    });

    expect(options).toEqual([
      { value: 'all', label: 'mlearn.Flashcards.Suggested.Filter.AllLevels' },
      { value: 'level:ja:5', label: 'N5' },
      { value: 'unknown', label: 'mlearn.Flashcards.Suggested.Filter.Unknown' },
    ]);
  });

  it('treats derived sentinel levels as unknown for suggested level filters', () => {
    const languageData: LanguageData = {
      name: 'Japanese',
      colour_codes: {},
      settings: { fixed: {} },
      frequencyLevels: {
        names: { '5': 'N5' },
      },
    };
    const suggestion = makeSuggestion({ id: 'ja-sentinel', word: '赤い', language: 'ja', level: null });
    const getFrequencyForLanguage = () => ({ raw_level: -1, level: '', reading: 'あかい' });

    expect(resolveSuggestedLevel(suggestion, getFrequencyForLanguage, languageData)).toBeNull();
    expect(suggestedLevelFilterMatches(suggestion, 'unknown', getFrequencyForLanguage, languageData)).toBe(true);
    expect(suggestedLevelFilterMatches(suggestion, 'level:ja:-1', getFrequencyForLanguage, languageData)).toBe(false);
  });

  it('keeps declared zero levels in suggested level filters', () => {
    const languageData: LanguageData = {
      name: 'Starter Language',
      colour_codes: {},
      settings: { fixed: {} },
      frequencyLevels: {
        names: { '0': 'Starter', '1': 'A1' },
        difficulty: 'higher-is-harder',
        displayOrder: 'ascending',
      },
    };

    const options = buildSuggestedLevelFilterOptions({
      suggestions: [
        makeSuggestion({ id: 'zz-0', word: 'alpha', language: 'zz', level: 0 }),
        makeSuggestion({ id: 'zz-1', word: 'beta', language: 'zz', level: 1 }),
      ],
      languageDataFor: () => languageData,
      t: (key) => key,
    });

    expect(options).toEqual([
      { value: 'all', label: 'mlearn.Flashcards.Suggested.Filter.AllLevels' },
      { value: 'level:zz:0', label: 'Starter' },
      { value: 'level:zz:1', label: 'A1' },
      { value: 'unknown', label: 'mlearn.Flashcards.Suggested.Filter.Unknown' },
    ]);
  });

  it('matches filters using effective language-data levels when saved level is missing', () => {
    const suggestion = makeSuggestion({ id: 'de-1', word: 'Haus', language: 'de', level: null });
    const getFrequencyForLanguage = (language: string, word: string) => (
      language === 'de' && word === 'Haus'
        ? { raw_level: 1, level: 'A1', reading: 'Haus' }
        : null
    );

    expect(resolveSuggestedLevel(suggestion, getFrequencyForLanguage)).toBe(1);
    expect(suggestedLevelFilterMatches(suggestion, 'level:de:1', getFrequencyForLanguage)).toBe(true);
    expect(suggestedLevelFilterMatches(suggestion, 'unknown', getFrequencyForLanguage)).toBe(false);
  });
});
