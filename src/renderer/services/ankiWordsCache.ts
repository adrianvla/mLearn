/**
 * Anki Words Cache Service
 * 
 * Global singleton cache of words existing in Anki.
 * Fetched once from the backend when Anki is enabled,
 * then checked synchronously by WordHover and other components.
 */

import { getBackend } from '../../shared/backends';
import type { AnkiWordStatusRecord } from '../../shared/backends/types';

let ankiWordsSet: Set<string> = new Set();
let ankiWordCardsMap: Map<string, AnkiWordStatusRecord[]> = new Map();
let fetched = false;
let fetchPromise: Promise<Set<string>> | null = null;

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
        const word = typeof card.word === 'string' ? card.word.trim() : '';
        if (!word) {
          continue;
        }

        nextSet.add(word);
        const existing = nextMap.get(word);
        if (existing) {
          existing.push(card);
        } else {
          nextMap.set(word, [card]);
        }
      }

      ankiWordsSet = nextSet;
      ankiWordCardsMap = nextMap;
      fetched = true;
    } catch (e) {
      console.error(e);
      // Silently fail — ankiWordsSet stays empty
    }
    fetchPromise = null;
    return ankiWordsSet;
  })();

  return fetchPromise;
}

/** Synchronously check if a word exists in the Anki cache */
export function isWordInAnkiCache(word: string): boolean {
  return ankiWordsSet.has(word);
}

/** Return the first matched Anki cache entry, preserving candidate priority. */
export function findAnkiWordMatchInCache(words: readonly string[]): AnkiWordCacheMatch | null {
  for (const word of words) {
    if (!word) {
      continue;
    }

    const cards = ankiWordCardsMap.get(word);
    if (cards && cards.length > 0) {
      return { word, cards };
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
  fetched = false;
  fetchPromise = null;
  ankiWordsSet = new Set();
  ankiWordCardsMap = new Map();
  return fetchAnkiWordsCache();
}
