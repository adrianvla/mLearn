/**
 * Translation Hook
 * Handles word translation and dictionary lookups
 */

import { createSignal, createResource } from 'solid-js';
import type { TranslationResponse, TranslationEntry, DictionaryEntry } from '../../shared/types';
import { getBackend } from '../../shared/backends';
import { getBridge } from '../../shared/bridges';

// Translation cache - globally accessible for all components
const translationCache = new Map<string, TranslationResponse>();

// Tokenization cache (promise de-dup + LRU)
const tokenCache = new Map<string, { tokens: any[]; ts: number }>();
const tokenInFlight = new Map<string, Promise<any[]>>();
const TOKEN_CACHE_MAX = 1000;

// Dictionary cache
const dictionaryCache = new Map<string, DictionaryEntry[]>();

// Local overrides storage key
const OVERRIDE_KEY = 'ml_translation_overrides';

/**
 * Get cached translation for a word (without fetching)
 * Returns null if not cached
 */
export function getCachedTranslation(word: string): TranslationResponse | null {
  return translationCache.get(word) || null;
}

/**
 * Get reading from cached translation
 */
export function getCachedReading(word: string): string | null {
  const cached = translationCache.get(word);
  if (!cached?.data) return null;
  
  const firstEntry = cached.data[0] as TranslationEntry | undefined;
  if (firstEntry?.reading) {
    // Strip HTML and accent markers from reading
    let reading = firstEntry.reading;
    const markerIdx = reading.indexOf('<!-- accent_start -->');
    if (markerIdx !== -1) reading = reading.substring(0, markerIdx);
    reading = reading.replace(/<[^>]*>/g, '').trim();
    return reading || null;
  }
  return null;
}

// In-memory cache of overrides, loaded once from KV store
let overridesCache: Record<string, TranslationResponse> | null = null;

async function readOverrides(): Promise<Record<string, TranslationResponse>> {
  if (overridesCache) return overridesCache;
  try {
    const raw = await getBridge().kvStore.kvGet(OVERRIDE_KEY);
    overridesCache = raw ? JSON.parse(raw) : {};
  } catch {
    overridesCache = {};
  }
  return overridesCache!;
}

// Write overrides to KV store
function writeOverrides(map: Record<string, TranslationResponse>): void {
  overridesCache = map;
  getBridge().kvStore.kvSet(OVERRIDE_KEY, JSON.stringify(map));
}

// Fetch translation from backend (also exported for use by batch queues)
export async function fetchTranslation(word: string): Promise<TranslationResponse> {
  // Check override first
  const overrides = await readOverrides();
  if (overrides[word]) {
    return overrides[word];
  }

  // Check cache
  if (translationCache.has(word)) {
    return translationCache.get(word)!;
  }

  const data = await getBackend().translate(word);
  translationCache.set(word, data);
  return data;
}

export interface UseTranslationOptions {
  immediate?: boolean;
}

export function useTranslation(options: UseTranslationOptions = {}) {
  const [currentWord, setCurrentWord] = createSignal<string | null>(null);

  const [translation, { refetch }] = createResource(
    () => currentWord(),
    async (word) => {
      if (!word) return null;
      return fetchTranslation(word);
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
    return fetchTranslation(word);
  };

  const setOverride = async (word: string, value: TranslationResponse | null) => {
    const overrides = await readOverrides();
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

/**
 * Pre-warm translation cache for a list of words.
 * @param words - Words to pre-fetch translations for
 * @param _translationUrl - Deprecated, ignored. Uses BackendAdapter.
 * @param _translatableTypes - Deprecated, ignored.
 */
export async function warmTranslationCache(
  words: string[],
  _translationUrl?: string,
  _translatableTypes?: string[]
): Promise<void> {
  const backend = getBackend();
  const unique = [...new Set(words)];
  const promises = unique
    .filter((w) => w && w.trim())
    .filter((w) => !translationCache.has(w))
    .map((word) =>
      backend.translate(word)
        .then((data) => {
          translationCache.set(word, data);
        })
        .catch(() => {
          // Ignore errors during cache warming
        })
    );
  await Promise.all(promises);
}

export function useTokenizer() {
  const tokenize = async (text: string) => {
    const key = typeof text === 'string' ? text : String(text);
    if (!key.trim()) return [{ actual_word: key, word: key, type: '名詞' }];
    if (tokenCache.has(key)) return tokenCache.get(key)!.tokens;
    if (tokenInFlight.has(key)) return tokenInFlight.get(key)!;

    const p = (async () => {
      const tokens = await getBackend().tokenize(key);
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

export function useDictionary() {
  const lookup = async (word: string, reading?: string): Promise<DictionaryEntry[]> => {
    try {
      const cacheKey = `${word}::${reading || ''}`;
      if (dictionaryCache.has(cacheKey)) return dictionaryCache.get(cacheKey)!;

      const data = await getBackend().translate(word);
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
