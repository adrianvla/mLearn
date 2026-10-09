import type { DictionaryWordPair, TranslateRequestOptions } from '../../shared/backends/types';
import { getBackend } from '../../shared/backends';

/**
 * The dictionary universe: every headword the active dictionary can serve
 * (word, reading) pairs for. Shared by Level Study's bulk add and the Word
 * Database Editor so both browse the same full vocabulary — the Word DB's
 * "All Words" view is frequency ∪ dictionary ∪ store, never frequency alone.
 */

const cache = new Map<string, DictionaryWordPair[]>();
const inflight = new Map<string, Promise<DictionaryWordPair[]>>();

export async function loadDictionaryUniverse(language: string, options: TranslateRequestOptions = {}): Promise<DictionaryWordPair[]> {
  const key = JSON.stringify([language, options.variant, options.generation, options.dictionaryTargetLanguage]);
  const cached = cache.get(key);
  if (cached) return cached;
  const active = inflight.get(key);
  if (active) return active;
  const promise = Promise.resolve(getBackend().enumerateDictionaryWords(language, options))
    .then((pairs) => {
      cache.set(key, pairs);
      while (cache.size > 4) cache.delete(cache.keys().next().value!);
      inflight.delete(key);
      return pairs;
    })
    .catch((error) => {
      inflight.delete(key);
      throw error;
    });
  inflight.set(key, promise);
  return promise;
}

/** Test seam: clear the universe cache between suites. */
export function clearDictionaryUniverseCache(): void {
  cache.clear();
  inflight.clear();
}
