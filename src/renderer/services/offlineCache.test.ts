// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TranslationResponse, DictionaryEntry, Token } from '@shared/types';

type IDBRequestResult = unknown;

interface FakeStore {
  data: Map<string, { key: string; value: IDBRequestResult; updatedAt: number }>;
}

interface FakeTx {
  store: FakeStore;
  oncomplete: (() => void) | null;
  onerror: (() => void) | null;
  error: DOMException | null;
}

function makeFakeRequest<T>(result: T, error: DOMException | null = null) {
  return {
    result,
    error,
    onsuccess: null as (() => void) | null,
    onerror: null as (() => void) | null,
    _fire(success: boolean) {
      if (success) this.onsuccess?.();
      else this.onerror?.();
    },
  };
}

function makeObjectStore(fakeStore: FakeStore, tx: FakeTx) {
  return {
    get(key: string) {
      const req = makeFakeRequest(fakeStore.data.get(key) ?? undefined);
      queueMicrotask(() => {
        req._fire(true);
        tx.oncomplete?.();
      });
      return req;
    },
    put(record: { key: string; value: IDBRequestResult; updatedAt: number }) {
      fakeStore.data.set(record.key, record);
      const req = makeFakeRequest(undefined);
      queueMicrotask(() => {
        req._fire(true);
        tx.oncomplete?.();
      });
      return req;
    },
    count() {
      const req = makeFakeRequest(fakeStore.data.size);
      queueMicrotask(() => {
        req._fire(true);
        tx.oncomplete?.();
      });
      return req;
    },
    clear() {
      fakeStore.data.clear();
      const req = makeFakeRequest(undefined);
      queueMicrotask(() => {
        req._fire(true);
        tx.oncomplete?.();
      });
      return req;
    },
    openCursor() {
      const entries = [...fakeStore.data.values()];
      let index = 0;
      const req = makeFakeRequest<{ delete(): void; continue(): void } | null>(null);
      function advance() {
        if (index < entries.length) {
          const entry = entries[index];
          req.result = {
            delete() {
              fakeStore.data.delete(entry.key);
            },
            continue() {
              index++;
              queueMicrotask(advance);
            },
          };
          req._fire(true);
        } else {
          req.result = null;
          req._fire(true);
          tx.oncomplete?.();
        }
      }
      queueMicrotask(advance);
      return req;
    },
  };
}

function makeFakeDB(storeMap: Map<string, FakeStore>) {
  const db = {
    objectStoreNames: {
      contains: (name: string) => storeMap.has(name),
    },
    createObjectStore(name: string, _options: { keyPath: string }) {
      if (!storeMap.has(name)) {
        storeMap.set(name, { data: new Map() });
      }
      return makeObjectStore(storeMap.get(name)!, { store: storeMap.get(name)!, oncomplete: null, onerror: null, error: null });
    },
    transaction(storeName: string, _mode: string) {
      const fakeStore = storeMap.get(storeName);
      if (!fakeStore) throw new Error(`Store ${storeName} not found`);
      const tx: FakeTx = { store: fakeStore, oncomplete: null, onerror: null, error: null };
      const objectStore = makeObjectStore(fakeStore, tx);
      return {
        objectStore: (_name: string) => objectStore,
        get oncomplete() { return tx.oncomplete; },
        set oncomplete(fn: (() => void) | null) { tx.oncomplete = fn; },
        get onerror() { return tx.onerror; },
        set onerror(fn: (() => void) | null) { tx.onerror = fn; },
        get error() { return tx.error; },
      };
    },
  };
  return db;
}

function setupFakeIndexedDB() {
  const storeMap = new Map<string, FakeStore>([
    ['translations', { data: new Map() }],
    ['dictionary', { data: new Map() }],
    ['tokens', { data: new Map() }],
  ]);
  const db = makeFakeDB(storeMap);

  const openRequest = {
    result: db,
    error: null,
    onupgradeneeded: null as (() => void) | null,
    onsuccess: null as (() => void) | null,
    onerror: null as (() => void) | null,
  };

  vi.stubGlobal('indexedDB', {
    open: (_name: string, _version: number) => {
      queueMicrotask(() => {
        openRequest.onupgradeneeded?.();
        openRequest.onsuccess?.();
      });
      return openRequest;
    },
  });

  return { storeMap, db };
}

async function loadOfflineCache() {
  vi.resetModules();
  const mod = await import('./offlineCache');
  return mod;
}

describe('offlineCache', () => {
  beforeEach(() => {
    setupFakeIndexedDB();
  });

  describe('translations', () => {
    it('returns null when key is not cached', async () => {
      const { getCachedTranslationDB } = await loadOfflineCache();
      const result = await getCachedTranslationDB('missing');
      expect(result).toBeNull();
    });

    it('stores and retrieves a translation', async () => {
      const { getCachedTranslationDB, setCachedTranslationDB } = await loadOfflineCache();
      const translation: TranslationResponse = { data: [{ definitions: 'hello', reading: 'こんにちは' }] };

      await setCachedTranslationDB('こんにちは', translation);
      const result = await getCachedTranslationDB('こんにちは');

      expect(result).toEqual(translation);
    });

    it('overwrites an existing translation', async () => {
      const { getCachedTranslationDB, setCachedTranslationDB } = await loadOfflineCache();
      const v1: TranslationResponse = { data: [{ definitions: 'v1', reading: 'r' }] };
      const v2: TranslationResponse = { data: [{ definitions: 'v2', reading: 'r' }] };

      await setCachedTranslationDB('word', v1);
      await setCachedTranslationDB('word', v2);
      const result = await getCachedTranslationDB('word');

      expect(result).toEqual(v2);
    });

    it('stores multiple translations in batch', async () => {
      const { getCachedTranslationDB, setCachedTranslationBatchDB } = await loadOfflineCache();
      const entries = [
        { word: 'a', data: { data: [{ definitions: 'A', reading: 'a' }] } as TranslationResponse },
        { word: 'b', data: { data: [{ definitions: 'B', reading: 'b' }] } as TranslationResponse },
      ];

      await setCachedTranslationBatchDB(entries);

      expect(await getCachedTranslationDB('a')).toEqual(entries[0].data);
      expect(await getCachedTranslationDB('b')).toEqual(entries[1].data);
    });

    it('does nothing on empty batch', async () => {
      const { setCachedTranslationBatchDB } = await loadOfflineCache();
      await expect(setCachedTranslationBatchDB([])).resolves.toBeUndefined();
    });

    it('clears all translations', async () => {
      const { getCachedTranslationDB, setCachedTranslationDB, clearTranslationCacheDB } = await loadOfflineCache();
      const translation: TranslationResponse = { data: [{ definitions: 'hi', reading: 'hi' }] };

      await setCachedTranslationDB('word', translation);
      await clearTranslationCacheDB();
      const result = await getCachedTranslationDB('word');

      expect(result).toBeNull();
    });
  });

  describe('dictionary', () => {
    it('returns null when key is not cached', async () => {
      const { getCachedDictionaryDB } = await loadOfflineCache();
      const result = await getCachedDictionaryDB('word', 'reading');
      expect(result).toBeNull();
    });

    it('stores and retrieves dictionary entries using word::reading key', async () => {
      const { getCachedDictionaryDB, setCachedDictionaryDB } = await loadOfflineCache();
      const entries: DictionaryEntry[] = [
        { word: 'test', reading: 'テスト', meanings: ['test', 'examination'] },
      ];

      await setCachedDictionaryDB('test', 'テスト', entries);
      const result = await getCachedDictionaryDB('test', 'テスト');

      expect(result).toEqual(entries);
    });

    it('returns null for a different reading of the same word', async () => {
      const { getCachedDictionaryDB, setCachedDictionaryDB } = await loadOfflineCache();
      const entries: DictionaryEntry[] = [{ word: 'test', reading: 'テスト', meanings: ['test'] }];

      await setCachedDictionaryDB('test', 'テスト', entries);
      const result = await getCachedDictionaryDB('test', 'ちがう');

      expect(result).toBeNull();
    });

    it('clears all dictionary entries', async () => {
      const { getCachedDictionaryDB, setCachedDictionaryDB, clearDictionaryCacheDB } = await loadOfflineCache();
      const entries: DictionaryEntry[] = [{ word: 'w', reading: 'r', meanings: ['m'] }];

      await setCachedDictionaryDB('w', 'r', entries);
      await clearDictionaryCacheDB();
      const result = await getCachedDictionaryDB('w', 'r');

      expect(result).toBeNull();
    });
  });

  describe('tokens', () => {
    it('returns null when key is not cached', async () => {
      const { getCachedTokensDB } = await loadOfflineCache();
      const result = await getCachedTokensDB('some text');
      expect(result).toBeNull();
    });

    it('stores and retrieves tokens', async () => {
      const { getCachedTokensDB, setCachedTokensDB } = await loadOfflineCache();
      const tokens: Token[] = [
        { word: 'hello', actual_word: 'hello', type: '名詞' },
        { word: 'world', actual_word: 'world', type: '名詞' },
      ];

      await setCachedTokensDB('hello world', tokens);
      const result = await getCachedTokensDB('hello world');

      expect(result).toEqual(tokens);
    });

    it('returns null for a different text', async () => {
      const { getCachedTokensDB, setCachedTokensDB } = await loadOfflineCache();
      const tokens: Token[] = [{ word: 'hi', actual_word: 'hi', type: '名詞' }];

      await setCachedTokensDB('hi', tokens);
      const result = await getCachedTokensDB('hello');

      expect(result).toBeNull();
    });

    it('clears all token entries', async () => {
      const { getCachedTokensDB, setCachedTokensDB, clearTokenCacheDB } = await loadOfflineCache();
      const tokens: Token[] = [{ word: 'hi', actual_word: 'hi', type: '名詞' }];

      await setCachedTokensDB('hi', tokens);
      await clearTokenCacheDB();
      const result = await getCachedTokensDB('hi');

      expect(result).toBeNull();
    });
  });

  describe('clearAllOfflineCaches', () => {
    it('clears translations, dictionary, and tokens simultaneously', async () => {
      const {
        setCachedTranslationDB,
        setCachedDictionaryDB,
        setCachedTokensDB,
        getCachedTranslationDB,
        getCachedDictionaryDB,
        getCachedTokensDB,
        clearAllOfflineCaches,
      } = await loadOfflineCache();

      const translation: TranslationResponse = { data: [{ definitions: 'hi', reading: 'hi' }] };
      const dictEntries: DictionaryEntry[] = [{ word: 'w', reading: 'r', meanings: ['m'] }];
      const tokens: Token[] = [{ word: 'hi', actual_word: 'hi', type: '名詞' }];

      await setCachedTranslationDB('word', translation);
      await setCachedDictionaryDB('w', 'r', dictEntries);
      await setCachedTokensDB('text', tokens);

      await clearAllOfflineCaches();

      expect(await getCachedTranslationDB('word')).toBeNull();
      expect(await getCachedDictionaryDB('w', 'r')).toBeNull();
      expect(await getCachedTokensDB('text')).toBeNull();
    });
  });

  describe('error handling when indexedDB is unavailable', () => {
    it('getCachedTranslationDB returns null when indexedDB.open throws', async () => {
      vi.stubGlobal('indexedDB', {
        open: () => { throw new Error('indexedDB unavailable'); },
      });

      const { getCachedTranslationDB } = await loadOfflineCache();
      const result = await getCachedTranslationDB('word');

      expect(result).toBeNull();
    });

    it('setCachedTranslationDB silently fails when indexedDB.open throws', async () => {
      vi.stubGlobal('indexedDB', {
        open: () => { throw new Error('indexedDB unavailable'); },
      });

      const { setCachedTranslationDB } = await loadOfflineCache();
      const translation: TranslationResponse = { data: [{ definitions: 'hi', reading: 'hi' }] };

      await expect(setCachedTranslationDB('word', translation)).resolves.toBeUndefined();
    });

    it('getCachedTokensDB returns null when indexedDB.open throws', async () => {
      vi.stubGlobal('indexedDB', {
        open: () => { throw new Error('indexedDB unavailable'); },
      });

      const { getCachedTokensDB } = await loadOfflineCache();
      const result = await getCachedTokensDB('some text');

      expect(result).toBeNull();
    });

    it('getCachedDictionaryDB returns null when indexedDB.open throws', async () => {
      vi.stubGlobal('indexedDB', {
        open: () => { throw new Error('indexedDB unavailable'); },
      });

      const { getCachedDictionaryDB } = await loadOfflineCache();
      const result = await getCachedDictionaryDB('word', 'reading');

      expect(result).toBeNull();
    });
  });

  describe('DB open and upgrade', () => {
    it('creates object stores on first open (upgrade path)', async () => {
      const storeMap = new Map<string, FakeStore>();
      const db = makeFakeDB(storeMap);

      const openRequest = {
        result: db,
        error: null,
        onupgradeneeded: null as (() => void) | null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
      };

      vi.stubGlobal('indexedDB', {
        open: () => {
          queueMicrotask(() => {
            openRequest.onupgradeneeded?.();
            openRequest.onsuccess?.();
          });
          return openRequest;
        },
      });

      const { setCachedTranslationDB, getCachedTranslationDB } = await loadOfflineCache();
      const translation: TranslationResponse = { data: [{ definitions: 'hello', reading: 'hi' }] };

      await setCachedTranslationDB('word', translation);
      const result = await getCachedTranslationDB('word');

      expect(result).toEqual(translation);
    });

    it('reuses the same DB instance across multiple calls (singleton)', async () => {
      const openSpy = vi.fn();
      const { storeMap } = setupFakeIndexedDB();
      const db = makeFakeDB(storeMap);

      const openRequest = {
        result: db,
        error: null,
        onupgradeneeded: null as (() => void) | null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
      };

      vi.stubGlobal('indexedDB', {
        open: (...args: unknown[]) => {
          openSpy(...args);
          queueMicrotask(() => {
            openRequest.onupgradeneeded?.();
            openRequest.onsuccess?.();
          });
          return openRequest;
        },
      });

      const { getCachedTranslationDB } = await loadOfflineCache();

      await getCachedTranslationDB('a');
      await getCachedTranslationDB('b');

      expect(openSpy).toHaveBeenCalledTimes(1);
    });
  });
});
