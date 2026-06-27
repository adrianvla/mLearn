/**
 * Anki Words Cache Service
 * 
 * Global singleton cache of words existing in Anki.
 * Fetched once from the backend when Anki is enabled,
 * then checked synchronously by WordHover and other components.
 */

import { getBackend } from '../../shared/backends';
import type { AnkiWordStatusRecord } from '../../shared/backends/types';
import { normalizeWordLookupText } from '../../shared/utils/textUtils';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger("renderer.services.ankiWordsCache");

let ankiWordsSet: Set<string> = new Set();
let ankiWordCardsMap: Map<string, AnkiWordStatusRecord[]> = new Map();
let fetched = false;
let fetchPromise: Promise<Set<string>> | null = null;

function getLookupKeys(word: string): string[] {
  const normalized = normalizeWordLookupText(word);
  if (!normalized) {
    return [];
  }

  return normalized === word ? [word] : [word, normalized];
}

function addWordLookup(
  targetSet: Set<string>,
  targetMap: Map<string, AnkiWordStatusRecord[]>,
  word: string,
  card: AnkiWordStatusRecord,
): void {
  for (const key of getLookupKeys(word)) {
    targetSet.add(key);
    const existing = targetMap.get(key);
    if (existing) {
      existing.push(card);
    } else {
      targetMap.set(key, [card]);
    }
  }
}

export interface AnkiWordCacheMatch {
  word: string;
  cards: readonly AnkiWordStatusRecord[];
}

/** Fetch (or return cached) the set of all words in Anki */
export async function fetchAnkiWordsCache(): Promise<Set<string>> {
  if (fetched) return ankiWordsSet;
  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    try {
      const cards = await getBackend().getAnkiWordStatuses();
      const nextSet = new Set<string>();
      const nextMap = new Map<string, AnkiWordStatusRecord[]>();

      for (const card of cards) {
        const word = normalizeWordLookupText(card.word);
        if (!word) {
          continue;
        }

        addWordLookup(nextSet, nextMap, word, { ...card, word });
      }

      ankiWordsSet = nextSet;
      ankiWordCardsMap = nextMap;
      fetched = true;
    } catch (e) {
      log.error("error", e);
      // Silently fail — ankiWordsSet stays empty
    }
    fetchPromise = null;
    return ankiWordsSet;
  })();

  return fetchPromise;
}

/** Synchronously check if a word exists in the Anki cache */
export function isWordInAnkiCache(word: string): boolean {
  const keys = getLookupKeys(word);
  return keys.some((key) => ankiWordsSet.has(key));
}

/** Return the first matched Anki cache entry, preserving candidate priority. */
export function findAnkiWordMatchInCache(words: readonly string[]): AnkiWordCacheMatch | null {
  for (const word of words) {
    for (const key of getLookupKeys(word)) {
      const cards = ankiWordCardsMap.get(key);
      if (cards && cards.length > 0) {
        return { word: key, cards };
      }
    }
  }

  return null;
}

/** Return the first candidate word that exists in the Anki cache */
export function findWordInAnkiCache(words: readonly string[]): string | null {
  return findAnkiWordMatchInCache(words)?.word ?? null;
}

/** Check whether the cache has been populated */
export function isAnkiCacheFetched(): boolean {
  return fetched;
}

/** Force a refresh of the Anki words cache */
export async function refreshAnkiWordsCache(): Promise<Set<string>> {
  clearAnkiWordsCache();
  return fetchAnkiWordsCache();
}

export function clearAnkiWordsCache(): void {
  fetched = false;
  fetchPromise = null;
  ankiWordsSet = new Set();
  ankiWordCardsMap = new Map();
}
