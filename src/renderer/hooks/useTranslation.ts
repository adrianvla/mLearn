/**
 * Translation Hook
 * Handles word translation and dictionary lookups
 */

import { createSignal, createResource } from 'solid-js';
import type { TranslationResponse, TranslationEntry, DictionaryEntry, Token } from '../../shared/types';
import { getBackend } from '../../shared/backends';
import { getBridge } from '../../shared/bridges';
import {
  getCachedTranslationByLanguageDB,
  setCachedTranslationByLanguageDB,
  setCachedTranslationBatchByLanguageDB,
  getCachedDictionaryByLanguageDB,
  setCachedDictionaryByLanguageDB,
  getCachedTokensByLanguageDB,
  setCachedTokensByLanguageDB,
} from '../services/offlineCache';

const translationCache = new Map<string, TranslationResponse>();
const [cacheVersion, setCacheVersion] = createSignal(0);

export { cacheVersion };

const tokenCache = new Map<string, { tokens: Token[]; ts: number }>();
const tokenInFlight = new Map<string, Promise<Token[]>>();
const TOKEN_CACHE_MAX = 1000;

const dictionaryCache = new Map<string, DictionaryEntry[]>();

const OVERRIDE_KEY = 'ml_translation_overrides';

function buildTranslationCacheKey(word: string, language?: string): string {
  return `${language || 'default'}::${word}`;
}

function buildDictionaryCacheKey(word: string, reading: string, language?: string): string {
  return `${language || 'default'}::${word}::${reading}`;
}

function buildTokenCacheKey(text: string, language?: string): string {
  return `${language || 'default'}::${text}`;
}

export function getCachedTranslation(word: string, language?: string): TranslationResponse | null {
  return translationCache.get(buildTranslationCacheKey(word, language)) || null;
}

export function getCachedReading(word: string, language?: string): string | null {
  const cached = translationCache.get(buildTranslationCacheKey(word, language));
  if (!cached?.data) return null;

  const firstEntry = cached.data[0] as TranslationEntry | undefined;
  if (!firstEntry?.reading) return null;

  let reading = firstEntry.reading;
  const markerIdx = reading.indexOf('<!-- accent_start -->');
  if (markerIdx !== -1) reading = reading.substring(0, markerIdx);
  reading = reading.replace(/<[^>]*>/g, '').trim();
  return reading || null;
}

let overridesCache: Record<string, TranslationResponse> | null = null;

async function readOverrides(): Promise<Record<string, TranslationResponse>> {
  if (overridesCache) return overridesCache;
  try {
    const raw = await getBridge().kvStore.kvGet(OVERRIDE_KEY);
    overridesCache = raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error(e);
    overridesCache = {};
  }
  return overridesCache ?? {};
}

function writeOverrides(map: Record<string, TranslationResponse>): void {
  overridesCache = map;
  getBridge().kvStore.kvSet(OVERRIDE_KEY, JSON.stringify(map));
}

export async function fetchTranslation(word: string, language?: string): Promise<TranslationResponse> {
  const cacheKey = buildTranslationCacheKey(word, language);
  const overrides = await readOverrides();
  if (overrides[cacheKey]) {
    return overrides[cacheKey];
  }

  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey)!;
  }

  const dbCached = await getCachedTranslationByLanguageDB(word, language);
  if (dbCached) {
    translationCache.set(cacheKey, dbCached);
    setCacheVersion((v) => v + 1);
    return dbCached;
  }

  const data = await getBackend().translate(word, language);
  translationCache.set(cacheKey, data);
  setCacheVersion((v) => v + 1);
  void setCachedTranslationByLanguageDB(word, data, language);
  return data;
}

export interface UseTranslationOptions {
  immediate?: boolean;
  language?: string;
}

export function useTranslation(options: UseTranslationOptions = {}) {
  const [currentWord, setCurrentWord] = createSignal<string | null>(null);

  const [translation, { refetch }] = createResource(
    () => currentWord(),
    async (word) => {
      if (!word) return null;
      return fetchTranslation(word, options.language);
    },
  );

  const translate = async (word: string): Promise<TranslationResponse | null> => {
    setCurrentWord(word);
    if (options.immediate) {
      await refetch();
    }
    return translation() ?? null;
  };

  const translateWord = async (word: string): Promise<TranslationResponse> => {
    return fetchTranslation(word, options.language);
  };

  const setOverride = async (word: string, value: TranslationResponse | null) => {
    const overrides = await readOverrides();
    const cacheKey = buildTranslationCacheKey(word, options.language);
    if (value === null) {
      delete overrides[cacheKey];
    } else {
      overrides[cacheKey] = value;
    }
    writeOverrides(overrides);
    translationCache.delete(cacheKey);
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

export async function warmTranslationCache(
  words: string[],
  _translationUrl?: string,
  _translatableTypes?: string[],
  language?: string,
): Promise<void> {
  const backend = getBackend();
  const unique = [...new Set(words)];
  const batchEntries: Array<{ word: string; data: TranslationResponse }> = [];
  const promises = unique
    .filter((w) => w && w.trim())
    .filter((w) => !translationCache.has(buildTranslationCacheKey(w, language)))
    .map((word) =>
      backend.translate(word, language)
        .then((data) => {
          translationCache.set(buildTranslationCacheKey(word, language), data);
          setCacheVersion((v) => v + 1);
          batchEntries.push({ word, data });
        })
        .catch(() => {
          // Ignore errors during cache warming
        }),
    );

  await Promise.all(promises);
  if (batchEntries.length > 0) {
    void setCachedTranslationBatchByLanguageDB(batchEntries, language);
  }
}

export interface UseTokenizerOptions {
  language?: string;
}

function createFallbackTokens(text: string): Token[] {
  return [{ actual_word: text, word: text, type: 'UNKNOWN' }];
}

export function useTokenizer(options: UseTokenizerOptions = {}) {
  const tokenize = async (text: string) => {
    const key = typeof text === 'string' ? text : String(text);
    const cacheKey = buildTokenCacheKey(key, options.language);
    if (!key.trim()) return createFallbackTokens(key);
    if (tokenCache.has(cacheKey)) return tokenCache.get(cacheKey)!.tokens;
    if (tokenInFlight.has(cacheKey)) return tokenInFlight.get(cacheKey)!;

    const p = (async () => {
      const dbCached = await getCachedTokensByLanguageDB(key, options.language);
      if (dbCached) {
        tokenCache.set(cacheKey, { tokens: dbCached, ts: Date.now() });
        return dbCached;
      }

      const tokens = await getBackend().tokenize(key, options.language);
      tokenCache.set(cacheKey, { tokens, ts: Date.now() });
      if (tokenCache.size > TOKEN_CACHE_MAX) {
        const firstKey = tokenCache.keys().next().value as string | undefined;
        if (firstKey) tokenCache.delete(firstKey);
      }
      void setCachedTokensByLanguageDB(key, tokens, options.language);
      return tokens;
    })();

    tokenInFlight.set(cacheKey, p);
    try {
      return await p;
    } catch (e) {
      console.error(e);
      return createFallbackTokens(key);
    } finally {
      tokenInFlight.delete(cacheKey);
    }
  };

  return { tokenize };
}

export interface UseDictionaryOptions {
  language?: string;
}

export function useDictionary(options: UseDictionaryOptions = {}) {
  const lookup = async (word: string, reading?: string): Promise<DictionaryEntry[]> => {
    try {
      const readingKey = reading || '';
      const cacheKey = buildDictionaryCacheKey(word, readingKey, options.language);
      if (dictionaryCache.has(cacheKey)) return dictionaryCache.get(cacheKey)!;

      const dbCached = await getCachedDictionaryByLanguageDB(word, readingKey, options.language);
      if (dbCached) {
        dictionaryCache.set(cacheKey, dbCached);
        return dbCached;
      }

      const data = await getBackend().translate(word, options.language);
      if (data.data && Array.isArray(data.data)) {
        const entries: DictionaryEntry[] = [];

        for (const entry of data.data) {
          if (!entry || typeof entry !== 'object') continue;

          const typedEntry = entry as TranslationEntry;
          if (typedEntry.definitions) {
            entries.push({
              word,
              reading: typedEntry.reading || '',
              meanings: Array.isArray(typedEntry.definitions)
                ? typedEntry.definitions
                : [String(typedEntry.definitions)],
            });
          }
        }

        dictionaryCache.set(cacheKey, entries);
        void setCachedDictionaryByLanguageDB(word, readingKey, entries, options.language);
        return entries;
      }

      dictionaryCache.set(cacheKey, []);
      void setCachedDictionaryByLanguageDB(word, readingKey, [], options.language);
      return [];
    } catch (e) {
      console.error('Dictionary lookup error:', e);
      return [];
    }
  };

  return { lookup };
}
