import { beforeEach, describe, expect, it, vi } from 'vitest';
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

const settings = (overrides: Partial<{ autoSuggestFlashcards: boolean; autoSuggestUnknownWords: boolean; learningLanguageLevel: number | null }> = {}) => ({
  autoSuggestFlashcards: true,
  autoSuggestUnknownWords: true,
  learningLanguageLevel: null,
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
      settings({ learningLanguageLevel: 3 }),
      new Set<string>(),
    );

    expect(result).toBe(false);
  });

  it('returns false when the suggestion has no level but the user level is set', () => {
    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja' },
      settings({ learningLanguageLevel: 3 }),
      new Set<string>(),
    );

    expect(result).toBe(false);
  });

  it('returns true when the suggestion level equals the user level', () => {
    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja', level: 3 },
      settings({ learningLanguageLevel: 3 }),
      new Set<string>(),
    );

    expect(result).toBe(true);
  });

  it('returns true when the suggestion level exceeds the user level', () => {
    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja', level: 5 },
      settings({ learningLanguageLevel: 3 }),
      new Set<string>(),
    );

    expect(result).toBe(true);
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

  it('uses settings.learningLanguageLevel when userLevel is undefined', () => {
    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja', level: 2 },
      settings({ learningLanguageLevel: 3 }),
      new Set<string>(),
    );

    expect(result).toBe(false);
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

  it('deduplicates input words', async () => {
    const result = await filterSuggestedWords([' word ', 'word', 'other', ''], 'ja', settings());

    expect(result).toEqual(new Set(['word', 'other']));
  });

  it('does not filter by learningLanguageLevel', async () => {
    const result = await filterSuggestedWords(['word'], 'ja', settings({ learningLanguageLevel: 5 }));

    expect(result).toEqual(new Set(['word']));
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
