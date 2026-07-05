/**
 * Anki Words Cache Service
 * 
 * Global singleton cache of words existing in Anki.
 * Fetched once from the backend when Anki is enabled,
 * then checked synchronously by WordHover and other components.
 */

import { getBackend } from '../../shared/backends';
import type { AnkiWordStatusRecord } from '../../shared/backends/types';
import type { LanguageData } from '../../shared/types';
import { getResolvedScriptProfile } from '../../shared/languageScriptProfile';
import { normalizeWordLookupText } from '../../shared/utils/textUtils';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger("renderer.services.ankiWordsCache");

let activeCacheSignature = '';

interface AnkiWordsCacheEntry {
  wordsSet: Set<string>;
  wordCardsMap: Map<string, AnkiWordStatusRecord[]>;
  fetched: boolean;
  fetchPromise: Promise<Set<string>> | null;
  languageData: LanguageData | null | undefined;
}

const cachesBySignature = new Map<string, AnkiWordsCacheEntry>();

export interface AnkiWordsCacheOptions {
  language?: string;
  languageData?: LanguageData | null;
}

function getCacheSignature(options?: AnkiWordsCacheOptions): string {
  const language = options?.language ?? '';
  const data = options?.languageData;
  const metadataSignature = data
    ? JSON.stringify({
      acceptedScripts: getResolvedScriptProfile(language, data).acceptedScripts,
      textProcessing: data.textProcessing ?? null,
    })
    : 'legacy';
  return `${language}:${metadataSignature}`;
}

function createCacheEntry(options?: AnkiWordsCacheOptions): AnkiWordsCacheEntry {
  return {
    wordsSet: new Set(),
    wordCardsMap: new Map(),
    fetched: false,
    fetchPromise: null,
    languageData: options && 'languageData' in options ? options.languageData : undefined,
  };
}

function getCacheEntry(options?: AnkiWordsCacheOptions): AnkiWordsCacheEntry {
  const signature = getCacheSignature(options);
  let entry = cachesBySignature.get(signature);
  if (!entry) {
    entry = createCacheEntry(options);
    cachesBySignature.set(signature, entry);
  }
  activeCacheSignature = signature;
  if (options && 'languageData' in options) {
    entry.languageData = options.languageData;
  }
  return entry;
}

function getActiveCacheEntry(): AnkiWordsCacheEntry {
  if (activeCacheSignature) {
    const active = cachesBySignature.get(activeCacheSignature);
    if (active) return active;
  }
  return getCacheEntry();
}

function getLookupKeys(word: string, entry: AnkiWordsCacheEntry): string[] {
  const languageData = entry.languageData;
  const normalized = normalizeWordLookupText(word, languageData);
  if (!normalized) {
    return [];
  }

  return normalized === word ? [word] : [word, normalized];
}

function addWordLookup(
  entry: AnkiWordsCacheEntry,
  word: string,
  card: AnkiWordStatusRecord,
): void {
  for (const key of getLookupKeys(word, entry)) {
    entry.wordsSet.add(key);
    const existing = entry.wordCardsMap.get(key);
    if (existing) {
      existing.push(card);
    } else {
      entry.wordCardsMap.set(key, [card]);
    }
  }
}

export interface AnkiWordCacheMatch {
  /** Original Anki expression value to use for AnkiConnect card lookups/updates. */
  word: string;
  /** Normalized cache key that matched the hovered/candidate form. */
  lookupKey: string;
  cards: readonly AnkiWordStatusRecord[];
}

/** Fetch (or return cached) the set of all words in Anki */
export async function fetchAnkiWordsCache(options?: AnkiWordsCacheOptions): Promise<Set<string>> {
  const entry = getCacheEntry(options);
  if (entry.fetched) return entry.wordsSet;
  if (entry.fetchPromise) return entry.fetchPromise;

  entry.fetchPromise = (async () => {
    try {
      const cards = await getBackend().getAnkiWordStatuses();
      const nextSet = new Set<string>();
      const nextMap = new Map<string, AnkiWordStatusRecord[]>();
      const nextEntry: AnkiWordsCacheEntry = {
        ...entry,
        wordsSet: nextSet,
        wordCardsMap: nextMap,
      };

      for (const card of cards) {
        const lookupWord = normalizeWordLookupText(card.word, entry.languageData);
        if (!lookupWord) {
          continue;
        }

        addWordLookup(nextEntry, card.word, card);
      }

      entry.wordsSet = nextSet;
      entry.wordCardsMap = nextMap;
      entry.fetched = true;
    } catch (e) {
      log.error("error", e);
      // Silently fail — this cache entry stays empty
    }
    entry.fetchPromise = null;
    return entry.wordsSet;
  })();

  return entry.fetchPromise;
}

/** Synchronously check if a word exists in the Anki cache */
export function isWordInAnkiCache(word: string, options?: AnkiWordsCacheOptions): boolean {
  const entry = options ? getCacheEntry(options) : getActiveCacheEntry();
  const keys = getLookupKeys(word, entry);
  return keys.some((key) => entry.wordsSet.has(key));
}

/** Return the first matched Anki cache entry, preserving candidate priority. */
export function findAnkiWordMatchInCache(words: readonly string[], options?: AnkiWordsCacheOptions): AnkiWordCacheMatch | null {
  const entry = options ? getCacheEntry(options) : getActiveCacheEntry();
  for (const word of words) {
    for (const key of getLookupKeys(word, entry)) {
      const cards = entry.wordCardsMap.get(key);
      if (cards && cards.length > 0) {
        return { word: cards[0].word, lookupKey: key, cards };
      }
    }
  }

  return null;
}

/** Return the first candidate word that exists in the Anki cache */
export function findWordInAnkiCache(words: readonly string[], options?: AnkiWordsCacheOptions): string | null {
  return findAnkiWordMatchInCache(words, options)?.word ?? null;
}

/** Check whether the cache has been populated */
export function isAnkiCacheFetched(options?: AnkiWordsCacheOptions): boolean {
  const signature = options ? getCacheSignature(options) : activeCacheSignature;
  return cachesBySignature.get(signature)?.fetched === true;
}

export function getAnkiWordsCacheSignature(options?: AnkiWordsCacheOptions): string {
  return getCacheSignature(options);
}

export function getActiveAnkiWordsCacheSignature(): string {
  return activeCacheSignature;
}

export async function refreshAnkiWordsCache(options?: AnkiWordsCacheOptions): Promise<Set<string>> {
  if (options) {
    cachesBySignature.delete(getCacheSignature(options));
    if (activeCacheSignature === getCacheSignature(options)) activeCacheSignature = '';
  } else {
    clearAnkiWordsCache();
  }
  return fetchAnkiWordsCache(options);
}

export function clearAnkiWordsCache(): void {
  cachesBySignature.clear();
  activeCacheSignature = '';
}
