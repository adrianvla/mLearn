import { beforeEach, describe, expect, it, vi } from 'vitest';
import { warmTranslationCache } from '../hooks/useTranslation';
import {
  filterSuggestedWords,
  shouldCaptureSuggestedFlashcard,
  isWordInDictionary,
} from './suggestedFlashcards';

const translationCache = vi.hoisted(() => new Map<string, { data?: unknown }>());
const warmTranslationCacheMock = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useTranslation', () => ({
  getCachedTranslation: (word: string, language?: string) => translationCache.get(`${language || 'default'}::${word}`) ?? null,
  warmTranslationCache: warmTranslationCacheMock,
}));

const settings = (overrides: Partial<{ autoSuggestFlashcards: boolean; autoSuggestUnknownWords: boolean }> = {}) => ({
  autoSuggestFlashcards: true,
  autoSuggestUnknownWords: true,
  ...overrides,
});

function cacheTranslation(word: string, language: string, data: unknown): void {
  translationCache.set(`${language}::${word}`, { data });
}

beforeEach(() => {
  translationCache.clear();
  warmTranslationCacheMock.mockReset();
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
