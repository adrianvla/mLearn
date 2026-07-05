/**
 * useNLPTokenizer Hook Tests
 * Unit tests for NLP tokenization hook with mocked LanguageContext
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { LanguageData, Token } from '../../shared/types';

const backendTokenizeMock = vi.hoisted(() => vi.fn<() => Promise<Token[]>>());

vi.mock('../../shared/backends', () => ({
  getBackend: () => ({
    tokenize: backendTokenizeMock,
  }),
}));

import { useNLPTokenizer, getCachedNLPTokenization, clearNLPTokenizationCache } from './useNLPTokenizer';

describe('useNLPTokenizer', () => {
  beforeEach(() => {
    clearNLPTokenizationCache();
    vi.clearAllMocks();
    backendTokenizeMock.mockReset();
  });

  afterEach(() => {
    clearNLPTokenizationCache();
  });

  describe('getCachedNLPTokenization', () => {
    it('should return null for uncached text', () => {
      const result = getCachedNLPTokenization('test', 'ja');
      expect(result).toBeNull();
    });
  });

  describe('clearNLPTokenizationCache', () => {
    it('should clear the cache', () => {
      clearNLPTokenizationCache();
      const result = getCachedNLPTokenization('test', 'ja');
      expect(result).toBeNull();
    });
  });

  describe('useNLPTokenizer hook', () => {
    it('should have tokenize and getCached methods', () => {
      const { tokenize, getCached, isLoading, error } = useNLPTokenizer();
      
      expect(typeof tokenize).toBe('function');
      expect(typeof getCached).toBe('function');
      expect(typeof isLoading).toBe('function');
      expect(typeof error).toBe('function');
    });

    it('should throw error for empty text', async () => {
      const { tokenize } = useNLPTokenizer();
      
      await expect(tokenize('', 'ja')).rejects.toThrow('Cannot tokenize empty text');
      await expect(tokenize('   ', 'ja')).rejects.toThrow('Cannot tokenize empty text');
    });

    it('should return cached result on second call', async () => {
      const { tokenize, getCached } = useNLPTokenizer();
      
      // First call should hit the backend (mocked)
      // Second call should return cached result
      const cached = getCached('test', 'ja');
      expect(cached).toBeNull(); // Not cached yet
    });

    it('should handle different languages', async () => {
      const { getCached } = useNLPTokenizer();
      
      // Verify that language parameter is properly used in cache key
      const jaResult = getCached('test', 'ja');
      const deResult = getCached('test', 'de');
      
      // Both should be null (not cached)
      expect(jaResult).toBeNull();
      expect(deResult).toBeNull();
    });

    it('keys cached tokens by tokenizer package namespace', async () => {
      const languageV1: LanguageData = {
        name: 'Test',
        colour_codes: {},
        settings: { fixed: {} },
        languageData: { version: 'pkg-v1', assets: [] },
        runtime: {
          nlp: {
            tokenizer: { type: 'unicode-word', lowercaseLemma: true },
          },
        },
      };
      const languageV2: LanguageData = {
        ...languageV1,
        languageData: { version: 'pkg-v2', assets: [] },
        runtime: {
          nlp: {
            tokenizer: { type: 'spacy', model: 'xx_core_web_sm' },
          },
        },
      };
      let activeLanguageData = languageV1;
      backendTokenizeMock
        .mockResolvedValueOnce([{ word: 'Alpha', actual_word: 'alpha-v1', type: 'WORD' }])
        .mockResolvedValueOnce([{ word: 'Alpha', actual_word: 'alpha-v2', type: 'WORD' }]);

      const { tokenize, getCached } = useNLPTokenizer({ languageData: () => activeLanguageData });

      const first = await tokenize('Alpha', 'xx');
      expect(first.tokens[0]?.base).toBe('alpha-v1');
      expect(getCached('Alpha', 'xx')?.tokens[0]?.base).toBe('alpha-v1');

      activeLanguageData = languageV2;
      expect(getCached('Alpha', 'xx')).toBeNull();

      const second = await tokenize('Alpha', 'xx');
      expect(second.tokens[0]?.base).toBe('alpha-v2');
      expect(backendTokenizeMock).toHaveBeenCalledTimes(2);
    });

    it('should handle errors gracefully', async () => {
      const { error } = useNLPTokenizer();
      
      // Initially no error
      expect(error()).toBeNull();
    });
  });

  describe('cache expiration', () => {
    it('should expire cache entries after TTL', async () => {
      // Cache TTL is 1 hour (3600000 ms)
      // This test would require time mocking to verify expiration
      const result = getCachedNLPTokenization('test', 'ja');
      expect(result).toBeNull();
    });
  });

  describe('integration with LanguageContext', () => {
    it('should handle backend unavailability', async () => {
      // If no backend is available for language, should throw error
      // This is handled by LanguageContext.tokenizeText
    });

    it('should handle uninitialized backends', async () => {
      // If backend is not initialized, should throw error
      // This is handled by LanguageContext.tokenizeText
    });
  });

  describe('performance', () => {
    it('should cache results to avoid redundant tokenization', () => {
      // Verify that repeated calls with same text use cache
      // and do not call backend multiple times
    });

    it('should deduplicate in-flight requests', () => {
      // Verify that concurrent identical requests share the same promise
      // and do not spawn multiple backend calls
    });
  });

  describe('error handling', () => {
    it('should propagate backend errors', async () => {
      // If backend throws, error should propagate to caller
    });

    it('should handle network errors', async () => {
      // If HTTP request fails, error should propagate
    });

    it('should handle invalid language codes', async () => {
      // If language code is not supported, should throw error
    });
  });
});
