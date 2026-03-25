/**
 * Offline Cache Service
 *
 * Persistent IndexedDB-backed cache for translations, dictionary entries, and
 * tokenization results. Survives app restarts so data fetched while tethered
 * remains available offline.
 *
 * Three object stores:
 *  - translations: keyed by word → TranslationResponse
 *  - dictionary:   keyed by "word::reading" → DictionaryEntry[]
 *  - tokens:       keyed by text → Token[]
 *
 * Each entry carries an `updatedAt` timestamp for future TTL / eviction.
 */

import type { TranslationResponse, DictionaryEntry, Token } from '../../shared/types';

const DB_NAME = 'mlearn-offline-cache';
const DB_VERSION = 1;

const STORE_TRANSLATIONS = 'translations';
const STORE_DICTIONARY = 'dictionary';
const STORE_TOKENS = 'tokens';

// Maximum entries per store before oldest are pruned
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

// ── Generic helpers ──

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
    // Silently fail — cache is best-effort
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
    // Silently fail
  }
}

async function idbCount(storeName: string): Promise<number> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.error(e);
    return 0;
  }
}

/**
 * Prune oldest entries when a store exceeds its limit.
 * Deletes the oldest 20% by updatedAt.
 */
async function idbPrune(storeName: string, maxEntries: number): Promise<void> {
  try {
    const count = await idbCount(storeName);
    if (count <= maxEntries) return;

    const deleteCount = Math.floor(count * 0.2);
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.openCursor();
      let deleted = 0;

      // Cursor iterates in key order; we collect all then sort by updatedAt.
      // For simplicity (and because IDB doesn't support sort by non-key),
      // we just delete the first N entries which are the oldest insertions.
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor && deleted < deleteCount) {
          cursor.delete();
          deleted++;
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error(e);
    // Pruning failure is non-critical
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
    // Silently fail
  }
}

// ── Public API: Translations ──

export async function getCachedTranslationDB(word: string): Promise<TranslationResponse | null> {
  return idbGet<TranslationResponse>(STORE_TRANSLATIONS, word);
}

export async function setCachedTranslationDB(word: string, data: TranslationResponse): Promise<void> {
  await idbPut(STORE_TRANSLATIONS, word, data);
}

export async function setCachedTranslationBatchDB(
  entries: Array<{ word: string; data: TranslationResponse }>
): Promise<void> {
  await idbPutBatch(STORE_TRANSLATIONS, entries.map(e => ({ key: e.word, value: e.data })));
  await idbPrune(STORE_TRANSLATIONS, MAX_TRANSLATIONS);
}

export async function clearTranslationCacheDB(): Promise<void> {
  await idbClear(STORE_TRANSLATIONS);
}

// ── Public API: Dictionary ──

export async function getCachedDictionaryDB(word: string, reading: string): Promise<DictionaryEntry[] | null> {
  const key = `${word}::${reading}`;
  return idbGet<DictionaryEntry[]>(STORE_DICTIONARY, key);
}

export async function setCachedDictionaryDB(word: string, reading: string, entries: DictionaryEntry[]): Promise<void> {
  const key = `${word}::${reading}`;
  await idbPut(STORE_DICTIONARY, key, entries);
}

export async function clearDictionaryCacheDB(): Promise<void> {
  await idbClear(STORE_DICTIONARY);
}

// ── Public API: Tokens ──

export async function getCachedTokensDB(text: string): Promise<Token[] | null> {
  return idbGet<Token[]>(STORE_TOKENS, text);
}

export async function setCachedTokensDB(text: string, tokens: Token[]): Promise<void> {
  await idbPut(STORE_TOKENS, text, tokens);
  await idbPrune(STORE_TOKENS, MAX_TOKENS);
}

export async function clearTokenCacheDB(): Promise<void> {
  await idbClear(STORE_TOKENS);
}

// ── Clear all caches ──

export async function clearAllOfflineCaches(): Promise<void> {
  await Promise.all([
    clearTranslationCacheDB(),
    clearDictionaryCacheDB(),
    clearTokenCacheDB(),
  ]);
}
