/**
 * Anki Words Cache Service
 * 
 * Global singleton cache of words existing in Anki.
 * Fetched once from the backend when Anki is enabled,
 * then checked synchronously by WordHover and other components.
 */

import { getBackend } from '../../shared/backends';

let ankiWordsSet: Set<string> = new Set();
let fetched = false;
let fetchPromise: Promise<Set<string>> | null = null;

/** Fetch (or return cached) the set of all words in Anki */
export async function fetchAnkiWordsCache(): Promise<Set<string>> {
  if (fetched) return ankiWordsSet;
  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    try {
      const words = await getBackend().getAnkiWords();
      ankiWordsSet = new Set(words);
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

/** Check whether the cache has been populated */
export function isAnkiCacheFetched(): boolean {
  return fetched;
}

/** Force a refresh of the Anki words cache */
export async function refreshAnkiWordsCache(): Promise<Set<string>> {
  fetched = false;
  fetchPromise = null;
  return fetchAnkiWordsCache();
}
