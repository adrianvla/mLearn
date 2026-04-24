/**
 * Offline Cache Service
 *
 * Persistent IndexedDB-backed cache for translations, dictionary entries, and
 * tokenization results. Survives app restarts so data fetched while tethered
 * remains available offline.
 *
 * Three object stores:
 *  - translations: keyed by "language::word" → TranslationResponse
 *  - dictionary:   keyed by "language::word::reading" → DictionaryEntry[]
 *  - tokens:       keyed by "language::text" → Token[]
 *
 * Each entry carries an `updatedAt` timestamp for future TTL / eviction.
 */

import type { TranslationResponse, DictionaryEntry, Token } from '../../shared/types';

const DB_NAME = 'mlearn-offline-cache';
const DB_VERSION = 1;

const STORE_TRANSLATIONS = 'translations';
const STORE_DICTIONARY = 'dictionary';
const STORE_TOKENS = 'tokens';

function buildTranslationKey(word: string, language?: string): string {
  return `${language || 'default'}::${word}`;
}

function buildDictionaryKey(word: string, reading: string, language?: string): string {
  return `${language || 'default'}::${word}::${reading}`;
}

function buildTokenKey(text: string, language?: string): string {
  return `${language || 'default'}::${text}`;
}

const MAX_TRANSLATIONS = 50_000;
const MAX_TOKENS = 5_000;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_TRANSLATIONS)) {
        db.createObjectStore(STORE_TRANSLATIONS, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_DICTIONARY)) {
        db.createObjectStore(STORE_DICTIONARY, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_TOKENS)) {
        db.createObjectStore(STORE_TOKENS, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

async function idbGet<T>(storeName: string, key: string): Promise<T | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => {
        const row = req.result as { key: string; value: T; updatedAt: number } | undefined;
        resolve(row ? row.value : null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.error(e);
    return null;
  }
}

async function idbPut<T>(storeName: string, key: string, value: T): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.put({ key, value, updatedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error(e);
  }
}

async function idbPutBatch<T>(storeName: string, entries: Array<{ key: string; value: T }>): Promise<void> {
  if (entries.length === 0) return;
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const now = Date.now();
      for (const { key, value } of entries) {
        store.put({ key, value, updatedAt: now });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error(e);
  }
}

async function idbPrune(storeName: string, maxEntries: number): Promise<void> {
  try {
    const db = await openDB();
    // Scan + delete inside ONE readwrite tx so no concurrent put can refresh
    // an entry between our read of updatedAt and our decision to delete it.
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const collected: Array<{ key: string; updatedAt: number }> = [];
      const req = store.openCursor();

      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const row = cursor.value as { key: string; updatedAt?: number };
          collected.push({ key: row.key, updatedAt: row.updatedAt ?? 0 });
          cursor.continue();
          return;
        }

        if (collected.length <= maxEntries) return;
        const deleteCount = Math.floor(collected.length * 0.2);
        if (deleteCount <= 0) return;

        collected.sort((a, b) => a.updatedAt - b.updatedAt);
        // Deletes issued synchronously from the final cursor callback so the
        // tx stays active (IDB closes a tx once no pending requests remain).
        for (let i = 0; i < deleteCount; i++) {
          store.delete(collected[i].key);
        }
      };
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error(e);
  }
}

async function idbClear(storeName: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error(e);
  }
}

export async function getCachedTranslationDB(word: string): Promise<TranslationResponse | null> {
  return idbGet<TranslationResponse>(STORE_TRANSLATIONS, word);
}

export async function getCachedTranslationByLanguageDB(word: string, language?: string): Promise<TranslationResponse | null> {
  return idbGet<TranslationResponse>(STORE_TRANSLATIONS, buildTranslationKey(word, language));
}

export async function setCachedTranslationDB(word: string, data: TranslationResponse): Promise<void> {
  await idbPut(STORE_TRANSLATIONS, word, data);
}

export async function setCachedTranslationByLanguageDB(word: string, data: TranslationResponse, language?: string): Promise<void> {
  await idbPut(STORE_TRANSLATIONS, buildTranslationKey(word, language), data);
}

export async function setCachedTranslationBatchDB(entries: Array<{ word: string; data: TranslationResponse }>): Promise<void> {
  await idbPutBatch(STORE_TRANSLATIONS, entries.map((entry) => ({ key: entry.word, value: entry.data })));
  await idbPrune(STORE_TRANSLATIONS, MAX_TRANSLATIONS);
}

export async function setCachedTranslationBatchByLanguageDB(
  entries: Array<{ word: string; data: TranslationResponse }>,
  language?: string,
): Promise<void> {
  await idbPutBatch(
    STORE_TRANSLATIONS,
    entries.map((entry) => ({ key: buildTranslationKey(entry.word, language), value: entry.data })),
  );
  await idbPrune(STORE_TRANSLATIONS, MAX_TRANSLATIONS);
}

export async function clearTranslationCacheDB(): Promise<void> {
  await idbClear(STORE_TRANSLATIONS);
}

export async function getCachedDictionaryDB(word: string, reading: string): Promise<DictionaryEntry[] | null> {
  return idbGet<DictionaryEntry[]>(STORE_DICTIONARY, `${word}::${reading}`);
}

export async function getCachedDictionaryByLanguageDB(word: string, reading: string, language?: string): Promise<DictionaryEntry[] | null> {
  return idbGet<DictionaryEntry[]>(STORE_DICTIONARY, buildDictionaryKey(word, reading, language));
}

export async function setCachedDictionaryDB(word: string, reading: string, entries: DictionaryEntry[]): Promise<void> {
  await idbPut(STORE_DICTIONARY, `${word}::${reading}`, entries);
}

export async function setCachedDictionaryByLanguageDB(word: string, reading: string, entries: DictionaryEntry[], language?: string): Promise<void> {
  await idbPut(STORE_DICTIONARY, buildDictionaryKey(word, reading, language), entries);
}

export async function clearDictionaryCacheDB(): Promise<void> {
  await idbClear(STORE_DICTIONARY);
}

export async function getCachedTokensDB(text: string): Promise<Token[] | null> {
  return idbGet<Token[]>(STORE_TOKENS, text);
}

export async function getCachedTokensByLanguageDB(text: string, language?: string): Promise<Token[] | null> {
  return idbGet<Token[]>(STORE_TOKENS, buildTokenKey(text, language));
}

export async function setCachedTokensDB(text: string, tokens: Token[]): Promise<void> {
  await idbPut(STORE_TOKENS, text, tokens);
  await idbPrune(STORE_TOKENS, MAX_TOKENS);
}

export async function setCachedTokensByLanguageDB(text: string, tokens: Token[], language?: string): Promise<void> {
  await idbPut(STORE_TOKENS, buildTokenKey(text, language), tokens);
  await idbPrune(STORE_TOKENS, MAX_TOKENS);
}

export async function clearTokenCacheDB(): Promise<void> {
  await idbClear(STORE_TOKENS);
}

export async function clearAllOfflineCaches(): Promise<void> {
  await Promise.all([
    clearTranslationCacheDB(),
    clearDictionaryCacheDB(),
    clearTokenCacheDB(),
  ]);
}
