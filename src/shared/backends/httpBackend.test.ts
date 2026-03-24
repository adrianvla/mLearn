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

  describe('buildUrl', () => {
    const backend = new HttpBackend('http://127.0.0.1:7752');

    it('concatenates baseUrl and path with leading slash', () => {
      expect(backend.buildUrl('/tokenize')).toBe('http://127.0.0.1:7752/tokenize');
    });

    it('adds leading slash when path has none', () => {
      expect(backend.buildUrl('tokenize')).toBe('http://127.0.0.1:7752/tokenize');
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

    it('throws when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(500));

      await expect(backend.tokenize('test')).rejects.toThrow('Tokenization failed: 500');
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

      await expect(backend.translate('unknown')).rejects.toThrow('Translation request failed: 404');
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
  });

  describe('getCard', () => {
    const backend = new HttpBackend('http://127.0.0.1:7752');

    it('returns parsed JSON on success', async () => {
      const card = { front: 'hello', back: 'world' };
      mockFetch.mockResolvedValueOnce(makeOkResponse(card));

      const result = await backend.getCard({ word: 'hello' });

      expect(result).toEqual(card);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:7752/getCard',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ word: 'hello' }),
        })
      );
    });

    it('throws when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(500));

      await expect(backend.getCard({ word: 'test' })).rejects.toThrow('getCard failed: 500');
    });
  });

  describe('getAnkiWords', () => {
    const backend = new HttpBackend('http://127.0.0.1:7752');

    it('returns words array from data.words on success', async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse({ words: ['apple', 'banana'] }));

      const result = await backend.getAnkiWords();

      expect(result).toEqual(['apple', 'banana']);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:7752/ankiWords',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('returns empty array when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(503));

      const result = await backend.getAnkiWords();

      expect(result).toEqual([]);
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
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('returns false when fetch throws', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network error'));

      const result = await backend.ping();

      expect(result).toBe(false);
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
