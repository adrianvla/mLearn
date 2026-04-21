import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NLPHttpAdapter, getNLPHttpAdapter, resetNLPHttpAdapter } from './nlp-http-adapter';
import type { MorphToken, TokenizationResult } from './nlp-backend-abstraction';

// Mock fetch globally
global.fetch = vi.fn();

describe('NLPHttpAdapter', () => {
  let adapter: NLPHttpAdapter;

  beforeEach(() => {
    adapter = new NLPHttpAdapter('http://localhost:7752');
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetNLPHttpAdapter();
  });

  describe('initialization', () => {
    it('should create adapter with base URL', () => {
      expect(adapter).toBeDefined();
    });

    it('should use default base URL if not provided', () => {
      const defaultAdapter = new NLPHttpAdapter();
      expect(defaultAdapter).toBeDefined();
    });
  });

  describe('tokenization', () => {
    it('should tokenize text successfully', async () => {
      const mockResponse: TokenizationResult = {
        text: '私は',
        language: 'ja',
        tokens: [
          { surface: '私', base: '私', pos: '代名詞' },
          { surface: 'は', base: 'は', pos: '助詞' },
        ],
      };

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await adapter.tokenize('私は', 'ja');

      expect(result.text).toBe('私は');
      expect(result.tokens).toHaveLength(2);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/nlp/backends/tokenize'),
        expect.any(Object)
      );
    });

    it('should handle tokenization errors', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as Response);

      await expect(adapter.tokenize('text', 'ja')).rejects.toThrow();
    });

    it('should handle network errors', async () => {
      vi.mocked(global.fetch).mockRejectedValue(new Error('Network error'));

      await expect(adapter.tokenize('text', 'ja')).rejects.toThrow('Network error');
    });
  });

  describe('batch tokenization', () => {
    it('should tokenize multiple texts', async () => {
      const mockResponse = [
        {
          text: '私は',
          language: 'ja',
          tokens: [{ surface: '私', base: '私', pos: '代名詞' }],
        },
        {
          text: '学生です',
          language: 'ja',
          tokens: [{ surface: '学生', base: '学生', pos: '名詞' }],
        },
      ];

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const results = await adapter.tokenizeBatch(['私は', '学生です'], 'ja');

      expect(results).toHaveLength(2);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/nlp/backends/tokenize-batch'),
        expect.any(Object)
      );
    });

    it('should handle empty batch', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => [],
      } as Response);

      const results = await adapter.tokenizeBatch([], 'ja');

      expect(results).toHaveLength(0);
    });
  });

  describe('lemma extraction', () => {
    it('should get lemma from token', async () => {
      const token: MorphToken = {
        surface: '買った',
        base: '買う',
        pos: '動詞',
      };

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ lemma: '買う' }),
      } as Response);

      const lemma = await adapter.getLemma(token, 'ja');

      expect(lemma).toBe('買う');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/nlp/backends/lemma'),
        expect.any(Object)
      );
    });
  });

  describe('reading extraction', () => {
    it('should get reading from token', async () => {
      const token: MorphToken = {
        surface: '私',
        base: '私',
        pos: '代名詞',
        reading: 'わたし',
      };

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ reading: 'わたし' }),
      } as Response);

      const reading = await adapter.getReading(token, 'ja');

      expect(reading).toBe('わたし');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/nlp/backends/reading'),
        expect.any(Object)
      );
    });
  });

  describe('pitch accent extraction', () => {
    it('should get pitch accent from token', async () => {
      const token: MorphToken = {
        surface: '橋',
        base: '橋',
        pos: '名詞',
        pitchAccent: 1,
      };

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ pitchAccent: 1 }),
      } as Response);

      const accent = await adapter.getPitchAccent(token, 'ja');

      expect(accent).toBe(1);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/nlp/backends/pitch-accent'),
        expect.any(Object)
      );
    });
  });

  describe('singleton pattern', () => {
    it('should return the same instance', () => {
      const adapter1 = getNLPHttpAdapter();
      const adapter2 = getNLPHttpAdapter();
      expect(adapter1).toBe(adapter2);
    });

    it('should reset to a new instance', () => {
      const adapter1 = getNLPHttpAdapter();
      resetNLPHttpAdapter();
      const adapter2 = getNLPHttpAdapter();
      expect(adapter1).not.toBe(adapter2);
    });
  });

  describe('error handling', () => {
    it('should handle JSON parse errors', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      } as Response);

      await expect(adapter.tokenize('text', 'ja')).rejects.toThrow();
    });

    it('should handle HTTP error responses', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => 'Invalid request',
      } as Response);

      await expect(adapter.tokenize('text', 'ja')).rejects.toThrow();
    });

    it('should handle 404 errors', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as Response);

      await expect(adapter.tokenize('text', 'ja')).rejects.toThrow();
    });

    it('should handle 500 errors', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as Response);

      await expect(adapter.tokenize('text', 'ja')).rejects.toThrow();
    });
  });

  describe('request formatting', () => {
    it('should send POST request with JSON body', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          text: 'test',
          language: 'ja',
          tokens: [],
        }),
      } as Response);

      await adapter.tokenize('test', 'ja');

      const call = vi.mocked(global.fetch).mock.calls[0];
      expect(call[1]).toMatchObject({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      });
    });

    it('should include language in request body', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          text: 'test',
          language: 'ja',
          tokens: [],
        }),
      } as Response);

      await adapter.tokenize('test', 'ja');

      const call = vi.mocked(global.fetch).mock.calls[0];
      const body = JSON.parse(call[1]?.body as string);
      expect(body.language).toBe('ja');
    });
  });
});
