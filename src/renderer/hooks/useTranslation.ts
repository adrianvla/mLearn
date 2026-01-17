/**
 * Translation Hook
 * Handles word translation and dictionary lookups
 */

import { createSignal, createResource } from 'solid-js';
import type { TranslationResponse } from '../../shared/types';
import { useSettings } from '../context';

// Translation cache
const translationCache = new Map<string, TranslationResponse>();

// Tokenization cache (promise de-dup + LRU)
const tokenCache = new Map<string, { tokens: any[]; ts: number }>();
const tokenInFlight = new Map<string, Promise<any[]>>();
const TOKEN_CACHE_MAX = 1000;

// Dictionary cache
const dictionaryCache = new Map<string, DictionaryEntry[]>();

// Local overrides storage key
const OVERRIDE_KEY = 'ml_translation_overrides';

// Read overrides from localStorage
function readOverrides(): Record<string, TranslationResponse> {
  try {
    const raw = localStorage.getItem(OVERRIDE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// Write overrides to localStorage
function writeOverrides(map: Record<string, TranslationResponse>): void {
  try {
    localStorage.setItem(OVERRIDE_KEY, JSON.stringify(map));
  } catch {
    // Ignore quota errors
  }
}

// Fetch translation from backend
async function fetchTranslation(word: string, url: string): Promise<TranslationResponse> {
  // Check override first
  const overrides = readOverrides();
  if (overrides[word]) {
    return overrides[word];
  }

  // Check cache
  if (translationCache.has(word)) {
    return translationCache.get(word)!;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ word }),
  });

  if (!response.ok) {
    throw new Error(`Translation request failed: ${response.status}`);
  }

  const data = await response.json() as TranslationResponse;
  translationCache.set(word, data);
  return data;
}

export interface UseTranslationOptions {
  immediate?: boolean;
}

export function useTranslation(options: UseTranslationOptions = {}) {
  const { settings } = useSettings();
  const [currentWord, setCurrentWord] = createSignal<string | null>(null);

  const [translation, { refetch }] = createResource(
    () => currentWord(),
    async (word) => {
      if (!word) return null;
      return fetchTranslation(word, settings.getTranslationUrl);
    }
  );

  const translate = async (word: string): Promise<TranslationResponse | null> => {
    setCurrentWord(word);
    if (options.immediate) {
      await refetch();
    }
    return translation() ?? null;
  };

  const translateWord = async (word: string): Promise<TranslationResponse> => {
    return fetchTranslation(word, settings.getTranslationUrl);
  };

  const setOverride = (word: string, value: TranslationResponse | null) => {
    const overrides = readOverrides();
    if (value === null) {
      delete overrides[word];
    } else {
      overrides[word] = value;
    }
    writeOverrides(overrides);
    translationCache.delete(word);
  };

  const clearCache = () => {
    translationCache.clear();
  };

  return {
    translation,
    translate,
    translateWord,
    setOverride,
    clearCache,
    isLoading: () => translation.loading,
    error: () => translation.error,
  };
}

export function useTokenizer() {
  const { settings } = useSettings();

  const tokenize = async (text: string) => {
    const key = typeof text === 'string' ? text : String(text);
    if (!key.trim()) return [{ actual_word: key, word: key, type: '名詞' }];
    if (tokenCache.has(key)) return tokenCache.get(key)!.tokens;
    if (tokenInFlight.has(key)) return tokenInFlight.get(key)!;

    const p = (async () => {
      const response = await fetch(settings.tokeniserUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: key }),
      });

      if (!response.ok) {
        throw new Error(`Tokenization failed: ${response.status}`);
      }

      const data = await response.json();
      const tokens = data.tokens || [];
      tokenCache.set(key, { tokens, ts: Date.now() });
      if (tokenCache.size > TOKEN_CACHE_MAX) {
        const firstKey = tokenCache.keys().next().value as string | undefined;
        if (firstKey) tokenCache.delete(firstKey);
      }
      return tokens;
    })();

    tokenInFlight.set(key, p);
    try {
      return await p;
    } catch (e) {
      return [{ actual_word: key, word: key, type: '名詞' }];
    } finally {
      tokenInFlight.delete(key);
    }
  };

  return { tokenize };
}

import type { DictionaryEntry, TranslationEntry } from '../../shared/types';

export function useDictionary() {
  const { settings } = useSettings();
  
  const lookup = async (word: string, reading?: string): Promise<DictionaryEntry[]> => {
    try {
      const cacheKey = `${word}::${reading || ''}`;
      if (dictionaryCache.has(cacheKey)) return dictionaryCache.get(cacheKey)!;

      // Use translation endpoint for dictionary lookup (not getCard which is for Anki)
      const response = await fetch(settings.getTranslationUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word }),
      });
      
      if (!response.ok) {
        return [];
      }
      
      const data = await response.json();
      // Transform backend response to DictionaryEntry array
      // Response format: { data: [TranslationEntry?, TranslationEntry?, PitchData?] }
      if (data.data && Array.isArray(data.data)) {
        const entries: DictionaryEntry[] = [];
        
        for (const entry of data.data) {
          if (!entry || typeof entry !== 'object') continue;
          
          // Check if it has definitions (TranslationEntry)
          const typedEntry = entry as TranslationEntry;
          if (typedEntry.definitions) {
            entries.push({
              word: word,
              reading: typedEntry.reading || '',
              meanings: Array.isArray(typedEntry.definitions) 
                ? typedEntry.definitions 
                : [String(typedEntry.definitions)],
            });
          }
        }
        
        dictionaryCache.set(cacheKey, entries);
        return entries;
      }
      dictionaryCache.set(cacheKey, []);
      return [];
    } catch (e) {
      console.error('Dictionary lookup error:', e);
      return [];
    }
  };
  
  return { lookup };
}
