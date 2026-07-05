/**
 * Translation Hook
 * Handles word translation and dictionary lookups
 */

import { createSignal, createResource } from 'solid-js';
import type { TranslationResponse, TranslationEntry, DictionaryEntry, Token, LanguageData } from '../../shared/types';
import { getBackend } from '../../shared/backends';
import { getBridge } from '../../shared/bridges';
import { createRoughTokenizerTokens, getTokenizerCacheNamespace, tokenizerAllowsFallback } from '../../shared/languageFeatures';
import { getWordFormCandidates } from '../utils/wordForms';
import { extractDefinitionValues, extractReadingValue } from '../utils/translationCacheParsers';
import {
  getCachedTranslationByLanguageDB,
  setCachedTranslationByLanguageDB,
  setCachedTranslationBatchByLanguageDB,
  getCachedDictionaryByLanguageDB,
  setCachedDictionaryByLanguageDB,
  getCachedTokensByLanguageDB,
  setCachedTokensByLanguageDB,
} from '../services/offlineCache';
import { getLogger } from '../../shared/utils/logger';
import type { BackendAdapter } from '../../shared/backends/types';

const log = getLogger("renderer.hooks.useTranslation");

const TRANSLATION_CACHE_MAX = 5000;
const TRANSLATION_WARM_CONCURRENCY = 10;
const translationCache = new Map<string, TranslationResponse>();
const [cacheVersion, setCacheVersion] = createSignal(0);

export { cacheVersion };

const tokenCache = new Map<string, { tokens: Token[]; ts: number }>();
const tokenInFlight = new Map<string, Promise<Token[]>>();
const TOKEN_CACHE_MAX = 1000;

const DICTIONARY_CACHE_MAX = 5000;
const dictionaryCache = new Map<string, DictionaryEntry[]>();

function pruneMapFIFO<K, V>(map: Map<K, V>, max: number): void {
  while (map.size > max) {
    const firstKey = map.keys().next().value as K | undefined;
    if (firstKey === undefined) return;
    map.delete(firstKey);
  }
}

function setTranslationCache(key: string, value: TranslationResponse): void {
  translationCache.set(key, value);
  pruneMapFIFO(translationCache, TRANSLATION_CACHE_MAX);
}

function setDictionaryCache(key: string, value: DictionaryEntry[]): void {
  dictionaryCache.set(key, value);
  pruneMapFIFO(dictionaryCache, DICTIONARY_CACHE_MAX);
}

const OVERRIDE_KEY = 'ml_translation_overrides';

function buildLookupScope(language?: string, dictionaryTargetLanguage?: string): string {
  const base = language || 'default';
  return dictionaryTargetLanguage ? `${base}->${dictionaryTargetLanguage}` : base;
}

function buildVersionedLanguageCacheId(
  language?: string,
  languageData?: LanguageData | null,
  dictionaryTargetLanguage?: string,
): string | undefined {
  const base = language || 'default';
  const packageVersion = languageData?.languageData?.version;
  const dictionaryVersion = dictionaryTargetLanguage
    ? languageData?.languageData?.dictionaryPacks?.[dictionaryTargetLanguage]?.version
    : undefined;

  if (!packageVersion && !dictionaryVersion) {
    return language;
  }

  const parts = [base];
  if (packageVersion) {
    parts.push(`language:${packageVersion}`);
  }
  if (dictionaryTargetLanguage && dictionaryVersion) {
    parts.push(`dictionary:${dictionaryTargetLanguage}:${dictionaryVersion}`);
  }

  return parts.join('@');
}

function buildTranslationCacheKey(word: string, language?: string, dictionaryTargetLanguage?: string): string {
  return `${buildLookupScope(language, dictionaryTargetLanguage)}::${word}`;
}

function buildDictionaryCacheKey(
  word: string,
  reading: string,
  language?: string,
  dictionaryTargetLanguage?: string,
): string {
  return `${buildLookupScope(language, dictionaryTargetLanguage)}::${word}::${reading}`;
}

function buildTokenCacheKey(text: string, language?: string, namespace?: string): string {
  return `${language || 'default'}::${namespace || 'default'}::${text}`;
}

function getCachedTranslationScopedDB(
  word: string,
  language?: string,
  dictionaryTargetLanguage?: string,
): Promise<TranslationResponse | null> {
  return dictionaryTargetLanguage
    ? getCachedTranslationByLanguageDB(word, language, dictionaryTargetLanguage)
    : getCachedTranslationByLanguageDB(word, language);
}

function setCachedTranslationScopedDB(
  word: string,
  data: TranslationResponse,
  language?: string,
  dictionaryTargetLanguage?: string,
): Promise<void> {
  return dictionaryTargetLanguage
    ? setCachedTranslationByLanguageDB(word, data, language, dictionaryTargetLanguage)
    : setCachedTranslationByLanguageDB(word, data, language);
}

function setCachedTranslationBatchScopedDB(
  entries: Array<{ word: string; data: TranslationResponse }>,
  language?: string,
  dictionaryTargetLanguage?: string,
): Promise<void> {
  return dictionaryTargetLanguage
    ? setCachedTranslationBatchByLanguageDB(entries, language, dictionaryTargetLanguage)
    : setCachedTranslationBatchByLanguageDB(entries, language);
}

function getCachedDictionaryScopedDB(
  word: string,
  reading: string,
  language?: string,
  dictionaryTargetLanguage?: string,
): Promise<DictionaryEntry[] | null> {
  return dictionaryTargetLanguage
    ? getCachedDictionaryByLanguageDB(word, reading, language, dictionaryTargetLanguage)
    : getCachedDictionaryByLanguageDB(word, reading, language);
}

function setCachedDictionaryScopedDB(
  word: string,
  reading: string,
  entries: DictionaryEntry[],
  language?: string,
  dictionaryTargetLanguage?: string,
): Promise<void> {
  return dictionaryTargetLanguage
    ? setCachedDictionaryByLanguageDB(word, reading, entries, language, dictionaryTargetLanguage)
    : setCachedDictionaryByLanguageDB(word, reading, entries, language);
}

export function getCachedTranslation(
  word: string,
  language?: string,
  lookupOptions: WordLookupCandidateOptions = {},
): TranslationResponse | null {
  const languageData = resolveLanguageData(lookupOptions.languageData);
  const candidates = buildTranslationLookupCandidates(
    word,
    lookupOptions.getCanonicalForm ?? identityWordForm,
    lookupOptions.getWordVariants,
    languageData,
  );
  const dictionaryTargetLanguage = resolveDictionaryTargetLanguage(lookupOptions.dictionaryTargetLanguage);
  const cacheLanguage = buildVersionedLanguageCacheId(language, languageData, dictionaryTargetLanguage);
  const originalCacheKey = buildTranslationCacheKey(word, cacheLanguage, dictionaryTargetLanguage);

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const cacheKey = buildTranslationCacheKey(candidate, cacheLanguage, dictionaryTargetLanguage);
    const cached = translationCache.get(cacheKey);
    if (!cached) continue;

    if (translationHasEntries(cached) || i === candidates.length - 1) {
      if (cacheKey !== originalCacheKey && translationHasEntries(cached)) {
        setTranslationCache(originalCacheKey, cached);
      }
      return cached;
    }
  }

  return null;
}

export function getCachedReading(
  word: string,
  language?: string,
  lookupOptions: WordLookupCandidateOptions = {},
): string | null {
  const cached = getCachedTranslation(word, language, lookupOptions);
  if (!cached?.data) return null;

  const firstEntry = cached.data[0] as TranslationEntry | undefined;
  const extractedReading = extractReadingValue(firstEntry, resolveLanguageData(lookupOptions.languageData));
  if (!extractedReading) return null;

  let reading = extractedReading;
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
    log.error("error", e);
    overridesCache = {};
  }
  return overridesCache ?? {};
}

function writeOverrides(map: Record<string, TranslationResponse>): void {
  overridesCache = map;
  getBridge().kvStore.kvSet(OVERRIDE_KEY, JSON.stringify(map));
}

export interface WordLookupCandidateOptions {
  getCanonicalForm?: (word: string) => string;
  getWordVariants?: (word: string) => string[];
  getReadingVariants?: (reading: string) => string[];
  dictionaryTargetLanguage?: string | (() => string | undefined);
  languageData?: LanguageData | null | (() => LanguageData | null);
}

function resolveDictionaryTargetLanguage(value: WordLookupCandidateOptions['dictionaryTargetLanguage']): string | undefined {
  return typeof value === 'function' ? value() : value;
}

function resolveLanguageData(value: WordLookupCandidateOptions['languageData']): LanguageData | null {
  return typeof value === 'function' ? value() : value ?? null;
}

function translateWithDictionaryTarget(
  backend: BackendAdapter,
  word: string,
  language?: string,
  dictionaryTargetLanguage?: string,
): Promise<TranslationResponse> {
  return dictionaryTargetLanguage
    ? backend.translate(word, language, { dictionaryTargetLanguage })
    : backend.translate(word, language);
}

function identityWordForm(word: string): string {
  return word;
}

function buildWordLookupCandidates(
  word: string,
  getCanonicalForm: (word: string) => string = identityWordForm,
  getWordVariants?: (word: string) => string[],
  languageData?: LanguageData | null,
): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const append = (candidate: string | null | undefined) => {
    const normalized = candidate?.trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push(normalized);
  };

  append(word);
  for (const candidate of getWordFormCandidates(word, getCanonicalForm, getWordVariants, { languageData })) {
    append(candidate);
  }

  return candidates;
}

function translationHasEntries(value: TranslationResponse): boolean {
  return Array.isArray(value.data) && value.data.length > 0;
}

export function buildTranslationLookupCandidates(
  word: string,
  getCanonicalForm: (word: string) => string = identityWordForm,
  getWordVariants?: (word: string) => string[],
  languageData?: LanguageData | null,
): string[] {
  return buildWordLookupCandidates(word, getCanonicalForm, getWordVariants, languageData);
}

export async function fetchTranslation(
  word: string,
  language?: string,
  lookupOptions: WordLookupCandidateOptions = {},
): Promise<TranslationResponse> {
  const languageData = resolveLanguageData(lookupOptions.languageData);
  const candidates = buildTranslationLookupCandidates(
    word,
    lookupOptions.getCanonicalForm ?? identityWordForm,
    lookupOptions.getWordVariants,
    languageData,
  );
  const dictionaryTargetLanguage = resolveDictionaryTargetLanguage(lookupOptions.dictionaryTargetLanguage);
  const cacheLanguage = buildVersionedLanguageCacheId(language, languageData, dictionaryTargetLanguage);
  const originalCacheKey = buildTranslationCacheKey(word, cacheLanguage, dictionaryTargetLanguage);
  const overrides = await readOverrides();

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const cacheKey = buildTranslationCacheKey(candidate, cacheLanguage, dictionaryTargetLanguage);
    const overrideKey = buildTranslationCacheKey(candidate, language, dictionaryTargetLanguage);
    const isLastCandidate = i === candidates.length - 1;

    if (overrides[overrideKey]) {
      const override = overrides[overrideKey];
      if (cacheKey !== originalCacheKey && translationHasEntries(override)) {
        setTranslationCache(originalCacheKey, override);
      }
      return override;
    }

    if (translationCache.has(cacheKey)) {
      const cached = translationCache.get(cacheKey)!;
      if (translationHasEntries(cached) || isLastCandidate) {
        if (cacheKey !== originalCacheKey && translationHasEntries(cached)) {
          setTranslationCache(originalCacheKey, cached);
        }
        return cached;
      }
      continue;
    }

    const dbCached = await getCachedTranslationScopedDB(candidate, cacheLanguage, dictionaryTargetLanguage);
    if (dbCached) {
      setTranslationCache(cacheKey, dbCached);
      setCacheVersion((v) => v + 1);
      if (translationHasEntries(dbCached) || isLastCandidate) {
        if (cacheKey !== originalCacheKey && translationHasEntries(dbCached)) {
          setTranslationCache(originalCacheKey, dbCached);
        }
        return dbCached;
      }
      continue;
    }

    const data = await translateWithDictionaryTarget(getBackend(), candidate, language, dictionaryTargetLanguage);
    setTranslationCache(cacheKey, data);
    setCacheVersion((v) => v + 1);
    void setCachedTranslationScopedDB(candidate, data, cacheLanguage, dictionaryTargetLanguage);
    if (translationHasEntries(data) || isLastCandidate) {
      if (cacheKey !== originalCacheKey && translationHasEntries(data)) {
        setTranslationCache(originalCacheKey, data);
        void setCachedTranslationScopedDB(word, data, cacheLanguage, dictionaryTargetLanguage);
      }
      return data;
    }
  }

  return { data: [] };
}

export interface UseTranslationOptions {
  immediate?: boolean;
  language?: string;
  getCanonicalForm?: (word: string) => string;
  getWordVariants?: (word: string) => string[];
  getReadingVariants?: (reading: string) => string[];
  dictionaryTargetLanguage?: string | (() => string | undefined);
  languageData?: LanguageData | null | (() => LanguageData | null);
}

export function useTranslation(options: UseTranslationOptions = {}) {
  const [currentWord, setCurrentWord] = createSignal<string | null>(null);

  const [translation, { refetch }] = createResource(
    () => currentWord(),
    async (word) => {
      if (!word) return null;
      return fetchTranslation(word, options.language, options);
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
    return fetchTranslation(word, options.language, options);
  };

  const setOverride = async (word: string, value: TranslationResponse | null) => {
    const overrides = await readOverrides();
    const dictionaryTargetLanguage = resolveDictionaryTargetLanguage(options.dictionaryTargetLanguage);
    const cacheKey = buildTranslationCacheKey(
      word,
      options.language,
      dictionaryTargetLanguage,
    );
    if (value === null) {
      delete overrides[cacheKey];
      translationCache.delete(cacheKey);
    } else {
      overrides[cacheKey] = value;
      setTranslationCache(cacheKey, value);
    }
    writeOverrides(overrides);
    setCacheVersion((v) => v + 1);
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
  dictionaryTargetLanguage?: string,
  languageData?: LanguageData | null,
): Promise<void> {
  const backend = getBackend();
  const unique = [...new Set(words)];
  const cacheLanguage = buildVersionedLanguageCacheId(language, languageData, dictionaryTargetLanguage);
  const batchEntries: Array<{ word: string; data: TranslationResponse }> = [];
  const wordsToWarm = unique
    .filter((w) => w && w.trim())
    .filter((w) => !translationCache.has(buildTranslationCacheKey(w, cacheLanguage, dictionaryTargetLanguage)));

  for (let i = 0; i < wordsToWarm.length; i += TRANSLATION_WARM_CONCURRENCY) {
    const chunk = wordsToWarm.slice(i, i + TRANSLATION_WARM_CONCURRENCY).map(async (word) => {
      try {
        const data = await translateWithDictionaryTarget(backend, word, language, dictionaryTargetLanguage);
        setTranslationCache(buildTranslationCacheKey(word, cacheLanguage, dictionaryTargetLanguage), data);
        setCacheVersion((v) => v + 1);
        batchEntries.push({ word, data });
      } catch {
        // Ignore errors during cache warming
      }
    });

    await Promise.all(chunk);
  }

  if (batchEntries.length > 0) {
    void setCachedTranslationBatchScopedDB(batchEntries, cacheLanguage, dictionaryTargetLanguage);
  }
}

export interface UseTokenizerOptions {
  language?: string;
  languageData?: LanguageData | null | (() => LanguageData | null);
}

function resolveTokenizerLanguageData(value: UseTokenizerOptions['languageData']): LanguageData | null {
  return typeof value === 'function' ? value() : value ?? null;
}

function createEmptyFallbackToken(text: string): Token[] {
  return [{ actual_word: text, word: text, type: 'UNKNOWN' }];
}

export function useTokenizer(options: UseTokenizerOptions = {}) {
  const tokenize = async (text: string) => {
    const key = typeof text === 'string' ? text : String(text);
    if (!key.trim()) return createEmptyFallbackToken(key);
    const languageData = resolveTokenizerLanguageData(options.languageData);
    const namespace = getTokenizerCacheNamespace(languageData);
    const cacheKey = buildTokenCacheKey(key, options.language, namespace);
    if (tokenCache.has(cacheKey)) return tokenCache.get(cacheKey)!.tokens;
    if (tokenInFlight.has(cacheKey)) return tokenInFlight.get(cacheKey)!;

    const p = (async () => {
      const dbCached = await getCachedTokensByLanguageDB(key, options.language, namespace);
      if (dbCached) {
        tokenCache.set(cacheKey, { tokens: dbCached, ts: Date.now() });
        return dbCached;
      }

      const tokens = await getBackend().tokenize(key, options.language);
      tokenCache.set(cacheKey, { tokens, ts: Date.now() });
      pruneMapFIFO(tokenCache, TOKEN_CACHE_MAX);
      void setCachedTokensByLanguageDB(key, tokens, options.language, namespace);
      return tokens;
    })();

    tokenInFlight.set(cacheKey, p);
    try {
      return await p;
    } catch (e) {
      log.error("error", e);
      if (!tokenizerAllowsFallback(languageData)) {
        throw e;
      }
      const fallbackTokens = createRoughTokenizerTokens(key, languageData);
      if (fallbackTokens.length === 0) {
        throw e;
      }
      return fallbackTokens;
    } finally {
      tokenInFlight.delete(cacheKey);
    }
  };

  return { tokenize };
}

export interface UseDictionaryOptions {
  language?: string;
  getCanonicalForm?: (word: string) => string;
  getWordVariants?: (word: string) => string[];
  getReadingVariants?: (reading: string) => string[];
  dictionaryTargetLanguage?: string | (() => string | undefined);
  languageData?: LanguageData | null | (() => LanguageData | null);
}

export function buildDictionaryLookupCandidates(
  word: string,
  getCanonicalForm: (word: string) => string = identityWordForm,
  getWordVariants?: (word: string) => string[],
  languageData?: LanguageData | null,
): string[] {
  return buildWordLookupCandidates(word, getCanonicalForm, getWordVariants, languageData);
}

export function buildDictionaryReadingCandidates(
  reading: string,
  getReadingVariants?: (reading: string) => string[],
): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const append = (candidate: string | null | undefined) => {
    const normalized = candidate?.trim() ?? '';
    if (seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push(normalized);
  };

  append(reading);
  for (const candidate of getReadingVariants?.(reading) ?? []) {
    append(candidate);
  }

  return candidates;
}

export function useDictionary(options: UseDictionaryOptions = {}) {
  const lookup = async (word: string, reading?: string): Promise<DictionaryEntry[]> => {
    try {
      const readingKey = reading || '';
      const languageData = resolveLanguageData(options.languageData);
      const candidates = buildDictionaryLookupCandidates(
        word,
        options.getCanonicalForm ?? identityWordForm,
        options.getWordVariants,
        languageData,
      );
      const readingCandidates = buildDictionaryReadingCandidates(readingKey, options.getReadingVariants);
      const dictionaryTargetLanguage = resolveDictionaryTargetLanguage(options.dictionaryTargetLanguage);
      const cacheLanguage = buildVersionedLanguageCacheId(options.language, languageData, dictionaryTargetLanguage);
      const originalCacheKey = buildDictionaryCacheKey(word, readingKey, cacheLanguage, dictionaryTargetLanguage);

      for (const candidate of candidates) {
        let hasCachedEmptyMiss = false;
        const candidateOriginalReadingCacheKey = buildDictionaryCacheKey(
          candidate,
          readingKey,
          cacheLanguage,
          dictionaryTargetLanguage,
        );
        for (const readingCandidate of readingCandidates) {
          const cacheKey = buildDictionaryCacheKey(candidate, readingCandidate, cacheLanguage, dictionaryTargetLanguage);
          if (dictionaryCache.has(cacheKey)) {
            const cached = dictionaryCache.get(cacheKey)!;
            if (cached.length > 0) {
              if (cacheKey !== originalCacheKey) setDictionaryCache(originalCacheKey, cached);
              return cached;
            }
            hasCachedEmptyMiss = true;
          }

          const dbCached = await getCachedDictionaryScopedDB(
            candidate,
            readingCandidate,
            cacheLanguage,
            dictionaryTargetLanguage,
          );
          if (dbCached !== null) {
            setDictionaryCache(cacheKey, dbCached);
            if (dbCached.length > 0) {
              if (cacheKey !== originalCacheKey) setDictionaryCache(originalCacheKey, dbCached);
              return dbCached;
            }
            hasCachedEmptyMiss = true;
          }
        }
        if (hasCachedEmptyMiss) continue;

        const data = await translateWithDictionaryTarget(
          getBackend(),
          candidate,
          options.language,
          dictionaryTargetLanguage,
        );
        if (data.data && Array.isArray(data.data)) {
          const entries: DictionaryEntry[] = [];

          for (const entry of data.data) {
            if (!entry || typeof entry !== 'object') continue;

            const typedEntry = entry as TranslationEntry;
            const meanings = extractDefinitionValues(typedEntry, languageData);
            if (meanings.length > 0) {
              entries.push({
                word: typedEntry.word || candidate,
                reading: extractReadingValue(typedEntry, languageData) || '',
                meanings,
              });
            }
          }

          setDictionaryCache(candidateOriginalReadingCacheKey, entries);
          void setCachedDictionaryScopedDB(
            candidate,
            readingKey,
            entries,
            cacheLanguage,
            dictionaryTargetLanguage,
          );
          if (entries.length > 0) {
            if (candidateOriginalReadingCacheKey !== originalCacheKey) {
              setDictionaryCache(originalCacheKey, entries);
              void setCachedDictionaryScopedDB(
                word,
                readingKey,
                entries,
                cacheLanguage,
                dictionaryTargetLanguage,
              );
            }
            return entries;
          }
        } else {
          setDictionaryCache(candidateOriginalReadingCacheKey, []);
          void setCachedDictionaryScopedDB(
            candidate,
            readingKey,
            [],
            cacheLanguage,
            dictionaryTargetLanguage,
          );
        }
      }

      setDictionaryCache(originalCacheKey, []);
      void setCachedDictionaryScopedDB(
        word,
        readingKey,
        [],
        cacheLanguage,
        dictionaryTargetLanguage,
      );
      return [];
    } catch (e) {
      log.error('Dictionary lookup error:', e);
      return [];
    }
  };

  return { lookup };
}
