import type { DictionaryWordPair } from '../../shared/backends/types';
import { getBackend } from '../../shared/backends';

/**
 * The dictionary universe: every headword the active dictionary can serve
 * (word, reading) pairs for. Shared by Level Study's bulk add and the Word
 * Database Editor so both browse the same full vocabulary — the Word DB's
 * "All Words" view is frequency ∪ dictionary ∪ store, never frequency alone.
 */

const cache = new Map<string, DictionaryWordPair[]>();
const inflight = new Map<string, Promise<DictionaryWordPair[]>>();

export async function loadDictionaryUniverse(language: string): Promise<DictionaryWordPair[]> {
  const cached = cache.get(language);
  if (cached) return cached;
  const promise = Promise.resolve(getBackend().enumerateDictionaryWords(language))
    .then((pairs) => {
      cache.set(language, pairs);
      inflight.delete(language);
      return pairs;
    })
    .catch((error) => {
      inflight.delete(language);
      throw error;
    });
  inflight.set(language, promise);
  return promise;
}

/** Test seam: clear the universe cache between suites. */
export function clearDictionaryUniverseCache(): void {
  cache.clear();
  inflight.clear();
}
