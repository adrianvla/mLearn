import { describe, it, expect, vi } from 'vitest';
import { HttpBackend } from './httpBackend';
import type { OCRResult } from './types';
import type { Token, TranslationResponse } from '../types';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeOkResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    blob: () => Promise.resolve(new Blob()),
  } as unknown as Response;
}

function makeErrorResponse(status: number, text = 'error'): Response {
  return {
    ok: false,
    status,
    json: () => Promise.reject(new Error('not json')),
    text: () => Promise.resolve(text),
  } as unknown as Response;
}

describe('HttpBackend', () => {
  describe('constructor and getBaseUrl', () => {
    it('strips trailing slash from baseUrl', () => {
      const backend = new HttpBackend('http://127.0.0.1:7752/');
      expect(backend.getBaseUrl()).toBe('http://127.0.0.1:7752');
    });

    it('strips multiple trailing slashes', () => {
      const backend = new HttpBackend('http://127.0.0.1:7752///');
      expect(backend.getBaseUrl()).toBe('http://127.0.0.1:7752');
    });

    it('leaves clean URL unchanged', () => {
      const backend = new HttpBackend('http://127.0.0.1:7752');
      expect(backend.getBaseUrl()).toBe('http://127.0.0.1:7752');
    });
  });

  describe('tokenize', () => {
    const backend = new HttpBackend('http://127.0.0.1:7752');

    it('returns tokens from data.tokens when present', async () => {
      const tokens: Token[] = [{ word: '日本', actual_word: '日本', type: '名詞' }];
      mockFetch.mockResolvedValueOnce(makeOkResponse({ tokens }));

      const result = await backend.tokenize('日本語');

      expect(result).toEqual(tokens);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:7752/tokenize',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ text: '日本語' }),
        })
      );
    });

    it('returns data itself when tokens field is absent', async () => {
      const tokens: Token[] = [{ word: 'hello', actual_word: 'hello', type: 'noun' }];
      mockFetch.mockResolvedValueOnce(makeOkResponse(tokens));

      const result = await backend.tokenize('hello');

      expect(result).toEqual(tokens);
    });

    it('includes language in request body when provided', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse({ tokens: [] }));

      await backend.tokenize('hello', 'de');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ body: JSON.stringify({ text: 'hello', language: 'de' }) })
      );
    });

    it('uses same-origin paths when constructed with an empty base URL', async () => {
      const sameOriginBackend = new HttpBackend('');
      mockFetch.mockResolvedValueOnce(makeOkResponse({ tokens: [] }));

      await sameOriginBackend.tokenize('日本語', 'ja');

      expect(mockFetch).toHaveBeenCalledWith(
        '/tokenize',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ text: '日本語', language: 'ja' }),
        })
      );
    });

    it('throws when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(500));

      await expect(backend.tokenize('test')).rejects.toThrow('Tokenization failed: 500 - error');
    });

    it('throws structured error on 401 so auth can be detected', async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(401, 'Unauthorized'));

      await expect(backend.tokenize('test')).rejects.toMatchObject({
        name: 'HttpBackendStatusError',
        status: 401,
        message: 'Tokenization failed: 401 - Unauthorized',
      });
    });

    it('includes Authorization header when authToken is provided', async () => {
      const authed = new HttpBackend('http://127.0.0.1:7752', { authToken: 'my-token' });
      mockFetch.mockResolvedValueOnce(makeOkResponse({ tokens: [] }));

      await authed.tokenize('test');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer my-token' }),
        })
      );
    });
  });

  describe('translate', () => {
    const backend = new HttpBackend('http://127.0.0.1:7752');

    it('returns TranslationResponse on success', async () => {
      const response: TranslationResponse = { data: [{ definitions: 'Japan', reading: 'にほん' }] };
      mockFetch.mockResolvedValueOnce(makeOkResponse(response));

      const result = await backend.translate('日本');

      expect(result).toEqual(response);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:7752/translate',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ word: '日本' }),
        })
      );
    });

    it('throws when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(404));

      await expect(backend.translate('unknown')).rejects.toThrow('Translation request failed: 404 - error');
    });

    it('throws structured error on 401 so auth can be detected', async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(401, 'Unauthorized'));

      await expect(backend.translate('test')).rejects.toMatchObject({
        name: 'HttpBackendStatusError',
        status: 401,
        message: 'Translation request failed: 401 - Unauthorized',
      });
    });

    it('includes language in translate request body when provided', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse({ data: [] }));

      await backend.translate('Haus', 'de');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:7752/translate',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ word: 'Haus', language: 'de' }),
        }),
      );
    });

    it('includes dictionary target language in translate request body when provided', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse({ data: [] }));

      await backend.translate('赤い', 'ja', { dictionaryTargetLanguage: 'fr' });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:7752/translate',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ word: '赤い', language: 'ja', dictionaryTargetLanguage: 'fr' }),
        }),
      );
    });
  });

  describe('ocr', () => {
    const backend = new HttpBackend('http://127.0.0.1:7752');

    it('sends Blob input directly as FormData', async () => {
      const blob = new Blob(['fake-image'], { type: 'image/png' });
      const ocrResult: OCRResult = { text: 'hello', confidence: 0.99 };
      mockFetch.mockResolvedValueOnce(makeOkResponse(ocrResult));

      const result = await backend.ocr(blob);

      expect(result).toEqual(ocrResult);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://127.0.0.1:7752/ocr');
      expect(opts.method).toBe('POST');
      expect(opts.body).toBeInstanceOf(FormData);
    });

    it('fetches data URL first when input is a string', async () => {
      const dataUrl = 'data:image/png;base64,abc123';
      const blob = new Blob(['fake'], { type: 'image/png' });
      const ocrResult: OCRResult = { text: 'text', confidence: 0.95 };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          blob: () => Promise.resolve(blob),
        } as unknown as Response)
        .mockResolvedValueOnce(makeOkResponse(ocrResult));

      const result = await backend.ocr(dataUrl);

      expect(result).toEqual(ocrResult);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[0][0]).toBe(dataUrl);
      expect(mockFetch.mock.calls[1][0]).toBe('http://127.0.0.1:7752/ocr');
    });

    it('throws with error text when response is not ok', async () => {
      const blob = new Blob(['img'], { type: 'image/png' });
      mockFetch.mockResolvedValueOnce(makeErrorResponse(422, 'Unprocessable Entity'));

      await expect(backend.ocr(blob)).rejects.toThrow('OCR request failed: 422 - Unprocessable Entity');
    });

    it('throws structured error on 401 so auth can be detected', async () => {
      const blob = new Blob(['img'], { type: 'image/png' });
      mockFetch.mockResolvedValueOnce(makeErrorResponse(401, 'Unauthorized'));

      await expect(backend.ocr(blob)).rejects.toMatchObject({
        name: 'HttpBackendStatusError',
        status: 401,
        message: 'OCR request failed: 401 - Unauthorized',
      });
    });

    it('serializes OCR options as backend form fields', async () => {
      const blob = new Blob(['img'], { type: 'image/png' });
      mockFetch.mockResolvedValueOnce(makeOkResponse({ boxes: [] }));

      await backend.ocr(blob, {
        language: 'ja',
        devMode: true,
        singleRegion: true,
        detectionMaxWidth: 640,
        detectionMaxHeight: 480,
      });

      const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      const form = opts.body as FormData;
      expect(form.get('language')).toBe('ja');
      expect(form.get('dev_mode')).toBe('1');
      expect(form.get('single_region')).toBe('1');
      expect(form.get('detection_max_width')).toBe('640');
      expect(form.get('detection_max_height')).toBe('480');
    });

    it('uses a longer default timeout for local OCR requests', async () => {
      const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
      const blob = new Blob(['img'], { type: 'image/png' });
      mockFetch.mockResolvedValueOnce(makeOkResponse({ boxes: [] }));

      await backend.ocr(blob);

      expect(timeoutSpy).toHaveBeenCalledWith(120_000);
      timeoutSpy.mockRestore();
    });

    it('allows OCR callers to override the request timeout', async () => {
      const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
      const blob = new Blob(['img'], { type: 'image/png' });
      mockFetch.mockResolvedValueOnce(makeOkResponse({ boxes: [] }));

      await backend.ocr(blob, { timeoutMs: 45_000 });

      expect(timeoutSpy).toHaveBeenCalledWith(45_000);
      timeoutSpy.mockRestore();
    });
  });

  describe('warmupOcr', () => {
    const backend = new HttpBackend('http://127.0.0.1:7752');

    it('posts to /ocr/warmup with the requested language and returns status payload', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse({ status: 'started', language: 'ja' }));

      const result = await backend.warmupOcr('ja');

      expect(result).toEqual({ status: 'started', language: 'ja' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:7752/ocr/warmup?language=ja',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('supports same-origin warmup URLs for the Vite dev proxy', async () => {
      const sameOriginBackend = new HttpBackend('');
      mockFetch.mockResolvedValueOnce(makeOkResponse({ status: 'started', language: 'ja' }));

      await sameOriginBackend.warmupOcr('ja');

      expect(mockFetch).toHaveBeenCalledWith(
        '/ocr/warmup?language=ja',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('throws structured errors from warmup failures', async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(403, 'disabled'));

      await expect(backend.warmupOcr()).rejects.toMatchObject({
        name: 'HttpBackendStatusError',
        status: 403,
        message: 'OCR warmup failed: 403 - disabled',
      });
    });
  });

  describe('getCard', () => {
    const backend = new HttpBackend('http://127.0.0.1:7752', { ankiBaseUrl: 'http://127.0.0.1:7753' });

    it('returns parsed JSON on success', async () => {
      const card = { front: 'hello', back: 'world' };
      mockFetch.mockResolvedValueOnce(makeOkResponse(card));

      const result = await backend.getCard({ word: 'hello' });

      expect(result).toEqual(card);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:7753/api/anki/card',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ word: 'hello' }),
        })
      );
    });

    it('throws when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(500));

      await expect(backend.getCard({ word: 'test' })).rejects.toThrow('getCard failed: 500 - error');
    });

    it('throws structured error on 401 so auth can be detected', async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(401, 'Unauthorized'));

      await expect(backend.getCard({ word: 'test' })).rejects.toMatchObject({
        name: 'HttpBackendStatusError',
        status: 401,
        message: 'getCard failed: 401 - Unauthorized',
      });
    });
  });

  describe('getAnkiWords', () => {
    const backend = new HttpBackend('http://127.0.0.1:7752', { ankiBaseUrl: 'http://127.0.0.1:7753' });

    it('returns words array from data.words on success', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse({ words: ['apple', 'banana'], cards: [] }));

      const result = await backend.getAnkiWords();

      expect(result).toEqual(['apple', 'banana']);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:7753/api/anki/words',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('returns empty array when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(503));

      const result = await backend.getAnkiWords();

      expect(result).toEqual([]);
    });
  });

  describe('getAnkiWordStatuses', () => {
    const backend = new HttpBackend('http://127.0.0.1:7752', { ankiBaseUrl: 'http://127.0.0.1:7753' });

    it('returns cached scheduling records from data.cards on success', async () => {
      const cards = [{ word: 'apple', factor: 2300, queue: 2, type: 2, due: 1325 }];
      mockFetch.mockResolvedValueOnce(makeOkResponse({ words: ['apple'], cards }));

      const result = await backend.getAnkiWordStatuses();

      expect(result).toEqual(cards);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:7753/api/anki/words',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('returns empty array when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(503));

      const result = await backend.getAnkiWordStatuses();

      expect(result).toEqual([]);
    });
  });

  describe('reloadAnkiCache', () => {
    const backend = new HttpBackend('http://127.0.0.1:7752', { ankiBaseUrl: 'http://127.0.0.1:7753' });

    it('POSTs the Anki reload route on the node server', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse({ response: 'Reloaded' }));

      const result = await backend.reloadAnkiCache();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:7753/api/anki/reload',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('returns false when reload fails', async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(503));

      const result = await backend.reloadAnkiCache();

      expect(result).toBe(false);
    });
  });

  describe('ping', () => {
    const backend = new HttpBackend('http://127.0.0.1:7752');

    it('returns true when /control responds ok', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true } as Response);

      const result = await backend.ping();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:7752/control',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ function: 'ping' }),
        })
      );
    });

    it('returns false when fetch throws', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network error'));

      const result = await backend.ping();

      expect(result).toBe(false);
    });

    it('throws when the backend responds unauthorized', async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(401, 'Unauthorized'));

      await expect(backend.ping()).rejects.toMatchObject({
        message: 'Unauthorized',
        status: 401,
      });
    });
  });

  describe('auth token', () => {
    it('sends Authorization header on all requests', async () => {
      const backend = new HttpBackend('http://127.0.0.1:7752', { authToken: 'secret-token' });

      mockFetch.mockResolvedValue(makeOkResponse({ tokens: [] }));
      await backend.tokenize('test');
      expect(mockFetch).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer secret-token' }) })
      );

      mockFetch.mockResolvedValue(makeOkResponse({ data: [] }));
      await backend.translate('test');
      expect(mockFetch).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer secret-token' }) })
      );

      mockFetch.mockResolvedValue(makeOkResponse({ words: [] }));
      await backend.getAnkiWords();
      expect(mockFetch).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer secret-token' }) })
      );
    });

    it('does not send Authorization header when no authToken', async () => {
      const backend = new HttpBackend('http://127.0.0.1:7752');
      mockFetch.mockResolvedValueOnce(makeOkResponse({ tokens: [] }));

      await backend.tokenize('test');

      const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = opts.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
    });
  });
});
