import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LanguageData } from '../../shared/types';
import { warmTranslationCache } from '../hooks/useTranslation';
import {
  filterSuggestedWords,
  shouldCaptureSuggestedFlashcard,
  shouldKeepSuggestion,
  isWordInDictionary,
} from './suggestedFlashcards';

const translationCache = vi.hoisted(() => new Map<string, { data?: unknown }>());
const warmTranslationCacheMock = vi.hoisted(() => vi.fn());
const hashWordSyncMock = vi.hoisted(() => vi.fn((word: string) => `hash:${word}`));

vi.mock('../hooks/useTranslation', () => ({
  getCachedTranslation: (word: string, language?: string) => translationCache.get(`${language || 'default'}::${word}`) ?? null,
  warmTranslationCache: warmTranslationCacheMock,
}));

vi.mock('../services/srsAlgorithm', () => ({
  hashWordSync: hashWordSyncMock,
}));

const settings = (overrides: Partial<{
  autoSuggestFlashcards: boolean;
  autoSuggestUnknownWords: boolean;
  learningLanguageLevel: number | null;
  learningLanguageLevels: Record<string, number | null>;
}> = {}) => ({
  autoSuggestFlashcards: true,
  autoSuggestUnknownWords: true,
  learningLanguageLevel: null,
  learningLanguageLevels: {},
  ...overrides,
});

function cacheTranslation(word: string, language: string, data: unknown): void {
  translationCache.set(`${language}::${word}`, { data });
}

function knownKey(word: string, language: string): string {
  return `${language}:hash:${word}`;
}

beforeEach(() => {
  translationCache.clear();
  warmTranslationCacheMock.mockReset();
  hashWordSyncMock.mockClear();
});

describe('shouldKeepSuggestion', () => {
  const ascendingDifficultyLanguage: LanguageData = {
    name: 'Ascending Difficulty Language',
    colour_codes: {},
    settings: { fixed: {} },
    frequencyLevels: {
      difficulty: 'higher-is-harder',
    },
  };
  const arabicScriptLanguage: LanguageData = {
    name: 'Arabic Script Language',
    colour_codes: {},
    settings: { fixed: {} },
    textProcessing: {
      scriptProfile: {
        acceptedScripts: ['Arab'],
        wordScriptValidation: 'only-accepted',
      },
    },
  };
  const nestedDefinitionsLanguage = {
    name: 'Nested Definitions Language',
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

  it('returns false when auto-suggest is disabled', () => {
    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja' },
      settings({ autoSuggestFlashcards: false }),
      new Set<string>(),
    );

    expect(result).toBe(false);
  });

  it('returns true when unknown words are allowed and no other filters apply', () => {
    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja' },
      settings(),
      new Set<string>(),
    );

    expect(result).toBe(true);
  });

  it('returns true for dictionary words when unknown words are disabled', () => {
    cacheTranslation('word', 'ja', [{ definitions: ['definition'] }]);

    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja' },
      settings({ autoSuggestUnknownWords: false }),
      new Set<string>(),
    );

    expect(result).toBe(true);
  });

  it('returns true for dictionary words with package-declared definition paths', () => {
    cacheTranslation('你好', 'zh', [{ glosses: { english: ['hello'] } }]);

    const result = shouldKeepSuggestion(
      { word: '你好', language: 'zh' },
      settings({ autoSuggestUnknownWords: false }),
      new Set<string>(),
      null,
      null,
      nestedDefinitionsLanguage,
    );

    expect(result).toBe(true);
  });

  it('returns true for dictionary words resolved through word-form candidates', () => {
    cacheTranslation('كتب', 'ar', [{ definitions: ['to write'] }]);

    const result = shouldKeepSuggestion(
      { word: 'يكتب', language: 'ar' },
      settings({ autoSuggestUnknownWords: false }),
      new Set<string>(),
      null,
      null,
      null,
      { getWordForms: (word) => word === 'يكتب' ? ['كتب'] : [word] },
    );

    expect(result).toBe(true);
  });

  it('returns false for non-dictionary words when unknown words are disabled', () => {
    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja' },
      settings({ autoSuggestUnknownWords: false }),
      new Set<string>(),
    );

    expect(result).toBe(false);
  });

  it('returns false when the suggestion level is below the user level', () => {
    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja', level: 2 },
      settings({ learningLanguageLevels: { ja: 3 } }),
      new Set<string>(),
    );

    expect(result).toBe(false);
  });

  it('returns false when the suggestion has no level but the user level is set', () => {
    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja' },
      settings({ learningLanguageLevels: { ja: 3 } }),
      new Set<string>(),
    );

    expect(result).toBe(false);
  });

  it('returns true when the suggestion level equals the user level', () => {
    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja', level: 3 },
      settings({ learningLanguageLevels: { ja: 3 } }),
      new Set<string>(),
    );

    expect(result).toBe(true);
  });

  it('returns true when the suggestion level exceeds the user level', () => {
    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja', level: 5 },
      settings({ learningLanguageLevels: { ja: 3 } }),
      new Set<string>(),
    );

    expect(result).toBe(true);
  });

  it('uses language metadata for ascending difficulty level filters', () => {
    expect(shouldKeepSuggestion(
      { word: 'word', language: 'xx', level: 2 },
      settings({ learningLanguageLevels: { xx: 3 } }),
      new Set<string>(),
      undefined,
      undefined,
      ascendingDifficultyLanguage,
    )).toBe(true);
    expect(shouldKeepSuggestion(
      { word: 'word', language: 'xx', level: 4 },
      settings({ learningLanguageLevels: { xx: 3 } }),
      new Set<string>(),
      undefined,
      undefined,
      ascendingDifficultyLanguage,
    )).toBe(false);
  });

  it('skips the level check when userLevel is explicitly null', () => {
    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja', level: null },
      settings({ learningLanguageLevel: 3 }),
      new Set<string>(),
      null,
    );

    expect(result).toBe(true);
  });

  it('uses settings.learningLanguageLevels for the suggestion language when userLevel is undefined', () => {
    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja', level: 2 },
      settings({ learningLanguageLevels: { ja: 3 } }),
      new Set<string>(),
    );

    expect(result).toBe(false);
  });

  it('uses the per-language learning level instead of the legacy scalar setting', () => {
    expect(shouldKeepSuggestion(
      { word: 'word', language: 'ja', level: 2 },
      settings({ learningLanguageLevel: 3, learningLanguageLevels: { ja: null } }),
      new Set<string>(),
    )).toBe(true);

    expect(shouldKeepSuggestion(
      { word: 'word', language: 'de', level: 4 },
      settings({ learningLanguageLevel: null, learningLanguageLevels: { de: 3 } }),
      new Set<string>(),
      undefined,
      undefined,
      ascendingDifficultyLanguage,
    )).toBe(false);
  });

  it('does not apply a legacy scalar level to another concrete language', () => {
    expect(shouldKeepSuggestion(
      { word: 'مرحبا', language: 'ar', level: 1 },
      settings({ learningLanguageLevel: 5 }),
      new Set<string>(),
      undefined,
      undefined,
      arabicScriptLanguage,
    )).toBe(true);
  });

  it('returns false when the word is in the known word set', () => {
    const known = new Set<string>([knownKey('word', 'ja')]);

    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja' },
      settings(),
      known,
    );

    expect(result).toBe(false);
  });

  it('returns false when any word-form candidate is in the known word set', () => {
    const known = new Set<string>([knownKey('идти', 'ru')]);

    const result = shouldKeepSuggestion(
      { word: 'идут', language: 'ru' },
      settings(),
      known,
      undefined,
      undefined,
      null,
      { getWordForms: (word) => word === 'идут' ? ['идти'] : [word] },
    );

    expect(result).toBe(false);
  });

  it('returns false when comprehensive status is known', () => {
    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja' },
      settings(),
      new Set<string>(),
      undefined,
      'known',
    );

    expect(result).toBe(false);
  });

  it('returns true when comprehensive status is learning', () => {
    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja' },
      settings(),
      new Set<string>(),
      undefined,
      'learning',
    );

    expect(result).toBe(true);
  });

  it('returns true when comprehensive status is unknown', () => {
    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja' },
      settings(),
      new Set<string>(),
      undefined,
      'unknown',
    );

    expect(result).toBe(true);
  });

  it('returns true when comprehensive status is null', () => {
    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja' },
      settings(),
      new Set<string>(),
      undefined,
      null,
    );

    expect(result).toBe(true);
  });

  it('returns true when comprehensive status is undefined', () => {
    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja' },
      settings(),
      new Set<string>(),
    );

    expect(result).toBe(true);
  });

  it('falls back to DEFAULT_SETTINGS when settings are undefined', () => {
    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja', level: 5 },
      {} as unknown as ReturnType<typeof settings>,
      new Set<string>(),
    );

    expect(result).toBe(true);
  });

  it('prefers explicit userLevel over settings.learningLanguageLevel', () => {
    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja', level: 2 },
      settings({ learningLanguageLevel: 3 }),
      new Set<string>(),
      1,
    );

    expect(result).toBe(true);
  });

  it('rejects unknown words when dictionary check fails even if level is ok', () => {
    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja', level: 5 },
      settings({ autoSuggestUnknownWords: false, learningLanguageLevel: 3 }),
      new Set<string>(),
    );

    expect(result).toBe(false);
  });

  it('rejects known words regardless of dictionary status', () => {
    cacheTranslation('word', 'ja', [{ definitions: ['definition'] }]);
    const known = new Set<string>([knownKey('word', 'ja')]);

    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja' },
      settings({ autoSuggestUnknownWords: false }),
      known,
    );

    expect(result).toBe(false);
  });

  it('rejects suggestions outside the language script when metadata is available', () => {
    expect(shouldKeepSuggestion(
      { word: 'hello', language: 'ar' },
      settings(),
      new Set<string>(),
      null,
      null,
      arabicScriptLanguage,
    )).toBe(false);

    expect(shouldKeepSuggestion(
      { word: 'سلام', language: 'ar' },
      settings(),
      new Set<string>(),
      null,
      null,
      arabicScriptLanguage,
    )).toBe(true);
  });
});

describe('filterSuggestedWords', () => {
  it('returns empty set when auto-suggest is disabled', async () => {
    const result = await filterSuggestedWords(['word'], 'ja', settings({ autoSuggestFlashcards: false }));

    expect(result).toEqual(new Set());
    expect(warmTranslationCache).not.toHaveBeenCalled();
  });

  it('returns all words when unknown words are allowed', async () => {
    const result = await filterSuggestedWords(['word', 'missing'], 'ja', settings({ autoSuggestUnknownWords: true }));

    expect(result).toEqual(new Set(['word', 'missing']));
    expect(warmTranslationCache).not.toHaveBeenCalled();
  });

  it('warms cache and returns only dictionary words when unknown words are disabled', async () => {
    warmTranslationCacheMock.mockImplementation(async (words: string[], _unusedA: unknown, _unusedB: unknown, language: string) => {
      for (const word of words) {
        if (word === 'known') {
          cacheTranslation(word, language, [{ definitions: ['definition'] }]);
        }
      }
    });

    const result = await filterSuggestedWords(['known', 'missing'], 'ja', settings({ autoSuggestUnknownWords: false }));

    expect(warmTranslationCache).toHaveBeenCalledWith(['known', 'missing'], undefined, undefined, 'ja');
    expect(result).toEqual(new Set(['known']));
  });

  it('warms candidate forms and keeps words whose canonical form has a dictionary entry', async () => {
    warmTranslationCacheMock.mockImplementation(async (words: string[], _unusedA: unknown, _unusedB: unknown, language: string) => {
      for (const word of words) {
        if (word === 'كتب') {
          cacheTranslation(word, language, [{ definitions: ['to write'] }]);
        }
      }
    });

    const result = await filterSuggestedWords(
      ['يكتب'],
      'ar',
      settings({ autoSuggestUnknownWords: false }),
      null,
      { getWordForms: (word) => word === 'يكتب' ? ['كتب'] : [word] },
    );

    expect(warmTranslationCache).toHaveBeenCalledWith(['يكتب', 'كتب'], undefined, undefined, 'ar');
    expect(result).toEqual(new Set(['يكتب']));
  });

  it('deduplicates input words', async () => {
    const result = await filterSuggestedWords([' word ', 'word', 'other', ''], 'ja', settings());

    expect(result).toEqual(new Set(['word', 'other']));
  });

  it('does not filter by learningLanguageLevel', async () => {
    const result = await filterSuggestedWords(['word'], 'ja', settings({ learningLanguageLevel: 5 }));

    expect(result).toEqual(new Set(['word']));
  });

  it('filters batch suggestions by language script when metadata is supplied', async () => {
    const arabicScriptLanguage: LanguageData = {
      name: 'Arabic Script Language',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: {
          acceptedScripts: ['Arab'],
          wordScriptValidation: 'only-accepted',
        },
      },
    };

    const result = await filterSuggestedWords(['سلام', 'hello'], 'ar', settings(), arabicScriptLanguage);

    expect(result).toEqual(new Set(['سلام']));
  });
});

describe('shouldCaptureSuggestedFlashcard', () => {
  it('returns false when auto-suggest is disabled', () => {
    expect(shouldCaptureSuggestedFlashcard('word', 'ja', settings({ autoSuggestFlashcards: false }))).toBe(false);
  });

  it('captures any word when unknown words are allowed', () => {
    expect(shouldCaptureSuggestedFlashcard('word', 'ja', settings())).toBe(true);
  });

  it('captures cached dictionary words when unknown words are disabled', () => {
    cacheTranslation('word', 'ja', [{ definitions: ['definition'] }]);

    expect(shouldCaptureSuggestedFlashcard('word', 'ja', settings({ autoSuggestUnknownWords: false }))).toBe(true);
  });

  it('rejects words without cached definitions when unknown words are disabled', () => {
    expect(shouldCaptureSuggestedFlashcard('word', 'ja', settings({ autoSuggestUnknownWords: false }))).toBe(false);
  });

  it('rejects uncached words when unknown words are disabled', () => {
    expect(shouldCaptureSuggestedFlashcard('uncached', 'ja', settings({ autoSuggestUnknownWords: false }))).toBe(false);
  });

  it('ignores learningLanguageLevel', () => {
    expect(shouldCaptureSuggestedFlashcard('word', 'ja', settings({ learningLanguageLevel: 5 }))).toBe(true);
  });
});

describe('isWordInDictionary', () => {
  it('treats cached words with definitions as dictionary words', () => {
    cacheTranslation('word', 'ja', [{ definitions: ['definition'] }]);

    expect(isWordInDictionary('word', 'ja')).toBe(true);
  });

  it('treats words with dictionary definitions on a candidate form as dictionary words', () => {
    cacheTranslation('идти', 'ru', [{ definitions: ['to go'] }]);

    expect(isWordInDictionary('идут', 'ru', {
      getWordForms: (word) => word === 'идут' ? ['идти'] : [word],
    })).toBe(true);
  });

  it('treats uncached words as non-dictionary', () => {
    expect(isWordInDictionary('word', 'ja')).toBe(false);
  });

  it('treats cached words without definitions as non-dictionary', () => {
    cacheTranslation('word', 'ja', [{ reading: 'word' }]);

    expect(isWordInDictionary('word', 'ja')).toBe(false);
  });

  it('treats cached empty translations as non-dictionary', () => {
    cacheTranslation('word', 'ja', []);

    expect(isWordInDictionary('word', 'ja')).toBe(false);
  });

  it('treats uncached words as non-dictionary', () => {
    expect(isWordInDictionary('uncached-word', 'ja')).toBe(false);
  });
});
