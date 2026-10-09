import { createServer, type Server } from 'node:http';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpBackend } from '../../shared/backends/httpBackend';

const owner = vi.hoisted(() => ({ backend: undefined as import('../../shared/backends/types').BackendAdapter | undefined }));
vi.mock('../../shared/backends', () => ({ getBackend: () => owner.backend }));
vi.mock('../../shared/bridges', () => ({ getBridge: () => ({ kvStore: { kvGet: async () => null } }) }));
let server: Server | undefined;
afterEach(async () => {
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined; }
  vi.unstubAllGlobals();
});

describe('NLP HTTP/cache boundary recovery', () => {
  it('does not cache unavailable results; retries the same generation and caches authoritative misses', async () => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', new IDBFactory());
    let ready = false;
    const calls: Array<{ path: string; language: string; dictionaryTargetLanguage?: string }> = [];
    server = createServer(async (request, response) => {
      response.setHeader('Access-Control-Allow-Origin', '*');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      if (request.method === 'OPTIONS') { response.end(); return; }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString()) as { language: string; dictionaryTargetLanguage?: string };
      calls.push({ path: request.url!, ...body });
      response.setHeader('Content-Type', 'application/json');
      response.statusCode = ready ? 200 : 503;
      response.end(JSON.stringify(ready ? request.url === '/tokenize' ? { tokens: [] } : { data: [] }
        : { detail: { code: 'language_unavailable' } }));
    });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test HTTP address');
    owner.backend = new HttpBackend(`http://127.0.0.1:${address.port}`);
    const { useTokenizer, fetchTranslation, useDictionary } = await import('./useTranslation');
    const { getCachedTokensByLanguageDB, getCachedTranslationByLanguageDB, getCachedDictionaryByLanguageDB } = await import('../services/offlineCache');
    const tokenizer = useTokenizer({ language: 'future-package' });
    const dictionary = useDictionary({ language: 'future-package', dictionaryTargetLanguage: 'future-target' });
    await expect(tokenizer.tokenize('.')).rejects.toMatchObject({ status: 503 });
    await expect(fetchTranslation('missing', 'future-package')).rejects.toMatchObject({ status: 503 });
    await expect(dictionary.lookup('missing')).rejects.toMatchObject({ status: 503 });
    expect(await getCachedTokensByLanguageDB('.', 'future-package')).toBeNull();
    expect(await getCachedTranslationByLanguageDB('missing', 'future-package')).toBeNull();
    expect(await getCachedDictionaryByLanguageDB('missing', '', 'future-package', 'future-target')).toBeNull();
    ready = true;
    expect(await tokenizer.tokenize('.')).toEqual([]);
    expect(await fetchTranslation('missing', 'future-package')).toEqual({ data: [] });
    expect(await dictionary.lookup('missing')).toEqual([]);
    const recoveredCalls = calls.length;
    expect(recoveredCalls).toBe(6);
    expect(await tokenizer.tokenize('.')).toEqual([]);
    expect(await fetchTranslation('missing', 'future-package')).toEqual({ data: [] });
    expect(await dictionary.lookup('missing')).toEqual([]);
    expect(calls).toHaveLength(recoveredCalls);
    expect(calls.every(call => call.language === 'future-package')).toBe(true);
    expect(calls.filter(call => call.dictionaryTargetLanguage === 'future-target')).toHaveLength(2);
  });
});
