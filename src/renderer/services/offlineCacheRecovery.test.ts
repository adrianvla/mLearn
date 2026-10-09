import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

async function seedLegacyCache(): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('mlearn-offline-cache', 1);
    request.onupgradeneeded = () => {
      for (const name of ['translations', 'dictionary', 'tokens']) request.result.createObjectStore(name, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(['translations', 'dictionary', 'tokens'], 'readwrite');
    transaction.objectStore('translations').put({ key: 'zz::missing', value: { data: [] }, updatedAt: 1 });
    transaction.objectStore('dictionary').put({ key: 'zz::missing::', value: [], updatedAt: 1 });
    transaction.objectStore('tokens').put({ key: 'zz::default::missing', value: [], updatedAt: 1 });
    transaction.objectStore('translations').put({ key: 'zz::valid', value: { data: [{ definitions: ['retained'] }] }, updatedAt: 1 });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

describe('truthful NLP cache recovery', () => {
  beforeEach(() => { vi.resetModules(); vi.stubGlobal('indexedDB', new IDBFactory()); });
  afterEach(() => vi.unstubAllGlobals());
  it('retires only legacy negative cache rows and preserves populated offline results', async () => {
    await seedLegacyCache();
    const cache = await import('./offlineCache');
    expect(await cache.getCachedTranslationByLanguageDB('missing', 'zz')).toBeNull();
    expect(await cache.getCachedDictionaryByLanguageDB('missing', '', 'zz')).toBeNull();
    expect(await cache.getCachedTokensByLanguageDB('missing', 'zz')).toBeNull();
    expect(await cache.getCachedTranslationByLanguageDB('valid', 'zz')).toEqual({ data: [{ definitions: ['retained'] }] });
  });
  it('retains new authoritative empty responses, including batched tokens and translations', async () => {
    const cache = await import('./offlineCache');
    await cache.setCachedTranslationByLanguageDB('no-match', { data: [] }, 'zz');
    await cache.setCachedDictionaryByLanguageDB('no-match', '', [], 'zz');
    await cache.setCachedTokensByLanguageDB('.', [], 'zz');
    await cache.setCachedTokensBatchByLanguageDB([{ text: '!', tokens: [] }], 'zz');
    await cache.setCachedTranslationBatchByLanguageDB([{ word: 'no-match-2', data: { data: [] } }], 'zz');
    expect(await cache.getCachedTranslationByLanguageDB('no-match', 'zz')).toEqual({ data: [] });
    expect(await cache.getCachedTranslationByLanguageDB('no-match-2', 'zz')).toEqual({ data: [] });
    expect(await cache.getCachedDictionaryByLanguageDB('no-match', '', 'zz')).toEqual([]);
    expect(await cache.getCachedTokensByLanguageDB('.', 'zz')).toEqual([]);
    expect(await cache.getCachedTokensByLanguageDB('!', 'zz')).toEqual([]);
  });
});
