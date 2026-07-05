/**
 * NLP Tokenizer Hook
 * Handles text tokenization using language-specific NLP backends (MeCab, spaCy, etc.)
 */

import { createSignal } from 'solid-js';
import { getBackend } from '../../shared/backends';
import { getTokenizerCacheNamespace } from '../../shared/languageFeatures';
import type { LanguageData } from '../../shared/types';

export type LanguageCode = string;

export interface MorphToken {
  surface: string;
  base: string;
  pos: string;
  reading?: string;
}

export interface TokenizationResult {
  text: string;
  language: LanguageCode;
  tokens: MorphToken[];
}

export interface TokenizationCacheOptions {
  /** Namespace for installed language-data/tokenizer version. Prevents stale tokens after package updates. */
  cacheNamespace?: string;
}

export interface UseNLPTokenizerOptions {
  languageData?: LanguageData | null | (() => LanguageData | null | undefined);
}

// In-flight deduplication: prevent concurrent identical tokenization requests
const tokenInFlight = new Map<string, Promise<TokenizationResult>>();

// LRU cache for tokenization results
const tokenCache = new Map<string, { result: TokenizationResult; ts: number }>();
const TOKEN_CACHE_MAX = 1000;
const TOKEN_CACHE_TTL = 1000 * 60 * 60; // 1 hour

/**
 * Generate cache key from text and language
 */
function getCacheKey(text: string, language: LanguageCode, cacheNamespace?: string): string {
  return `${language}:${cacheNamespace || 'default'}:${text}`;
}

function resolveLanguageData(value: UseNLPTokenizerOptions['languageData']): LanguageData | null {
  return typeof value === 'function' ? value() ?? null : value ?? null;
}

/**
 * Get cached tokenization result (without fetching)
 * Returns null if not cached or expired
 */
export function getCachedNLPTokenization(
  text: string,
  language: LanguageCode,
  options: TokenizationCacheOptions = {},
): TokenizationResult | null {
  const key = getCacheKey(text, language, options.cacheNamespace);
  const cached = tokenCache.get(key);
  
  if (!cached) return null;
  
  // Check if cache entry has expired
  if (Date.now() - cached.ts > TOKEN_CACHE_TTL) {
    tokenCache.delete(key);
    return null;
  }
  
  return cached.result;
}

/**
 * Clear NLP tokenization cache
 */
export function clearNLPTokenizationCache(): void {
  tokenCache.clear();
  tokenInFlight.clear();
}

/**
 * Tokenize text using the best available backend for the language
 * 
 * Features:
 * - In-flight deduplication: concurrent identical requests share the same promise
 * - LRU caching: results cached for 1 hour (max 1000 entries)
 * - Error handling: throws if backend unavailable or text invalid
 * 
 * @param text - Text to tokenize
 * @param language - Language code from installed language data
 * @returns Promise resolving to tokenization result
 * @throws Error if no backend available for language or backend not initialized
 */
async function tokenizeTextInternal(
  text: string,
  language: LanguageCode,
  options: TokenizationCacheOptions = {},
): Promise<TokenizationResult> {
  if (!text || text.trim().length === 0) {
    throw new Error('Cannot tokenize empty text');
  }
  
  const cacheKey = getCacheKey(text, language, options.cacheNamespace);
  
  // Check cache first
  const cached = getCachedNLPTokenization(text, language, options);
  if (cached) {
    return cached;
  }
  
  // Check if request is already in flight
  const inFlight = tokenInFlight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }
  
  // Create new tokenization request
  const promise = (async () => {
    const tokens = await getBackend().tokenize(text, language);
    const result: TokenizationResult = {
      text,
      language,
      tokens: tokens.map((token) => ({
        surface: token.surface ?? token.word,
        base: token.actual_word ?? token.word,
        pos: token.partOfSpeech ?? token.type,
        reading: token.reading,
      })),
    };

    // Store in cache (with LRU eviction)
    tokenCache.set(cacheKey, { result, ts: Date.now() });
    if (tokenCache.size > TOKEN_CACHE_MAX) {
      // Remove oldest entry (first entry in Map)
      const firstKey = tokenCache.keys().next().value;
      if (firstKey) tokenCache.delete(firstKey);
    }
    
    return result;
  })();
  
  // Track in-flight request
  tokenInFlight.set(cacheKey, promise);
  
  try {
    return await promise;
  } finally {
    // Clean up in-flight tracking
    tokenInFlight.delete(cacheKey);
  }
}

/**
 * Hook for tokenizing text with NLP backends
 * 
 * Usage:
 * ```tsx
 * const { tokenize, getCached } = useNLPTokenizer();
 * 
 * const handleTokenize = async () => {
 *   try {
 *     const result = await tokenize(text, languageCode);
 *     console.log(result.tokens);
 *   } catch (err) {
 *     console.error('Tokenization failed:', err);
 *   }
 * };
 * ```
 * 
 * @returns Object with tokenize function and cache utilities
 */
export function useNLPTokenizer(options: UseNLPTokenizerOptions = {}) {
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<Error | null>(null);
  
  return {
    /**
     * Tokenize text with the specified language
     * @param textToTokenize - Text to tokenize
     * @param lang - Language code
     * @returns Promise resolving to tokenization result
     */
    tokenize: async (textToTokenize: string, lang: LanguageCode): Promise<TokenizationResult> => {
      setIsLoading(true);
      setError(null);
      
      try {
        return await tokenizeTextInternal(textToTokenize, lang, {
          cacheNamespace: getTokenizerCacheNamespace(resolveLanguageData(options.languageData)),
        });
      } catch (err) {
        const errorObj = err instanceof Error ? err : new Error(String(err));
        setError(errorObj);
        throw errorObj;
      } finally {
        setIsLoading(false);
      }
    },
    
    /**
     * Tokenize text synchronously if cached, otherwise return null
     * @param textToTokenize - Text to tokenize
     * @param lang - Language code
     * @returns Cached result or null if not cached
     */
    getCached: (textToTokenize: string, lang: LanguageCode): TokenizationResult | null => {
      return getCachedNLPTokenization(textToTokenize, lang, {
        cacheNamespace: getTokenizerCacheNamespace(resolveLanguageData(options.languageData)),
      });
    },
    
    // State signals
    isLoading,
    error,
  };
}
