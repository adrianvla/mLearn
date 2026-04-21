import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MeCabBackend } from './mecab-backend';
import { getNLPHttpAdapter } from './nlp-http-adapter';

// Mock the HTTP adapter
vi.mock('./nlp-http-adapter', () => ({
  getNLPHttpAdapter: vi.fn(),
  resetNLPHttpAdapter: vi.fn(),
}));

describe('MeCabBackend', () => {
  let backend: MeCabBackend;
  let mockAdapter: any;

  beforeEach(() => {
    mockAdapter = {
      tokenize: vi.fn(),
      tokenizeBatch: vi.fn(),
      getLemma: vi.fn(),
      getReading: vi.fn(),
      getPitchAccent: vi.fn(),
    };
    
    vi.mocked(getNLPHttpAdapter).mockReturnValue(mockAdapter);
    backend = new MeCabBackend();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('backend properties', () => {
    it('should have correct id', () => {
      expect(backend.id).toBe('mecab');
    });

    it('should have correct name', () => {
      expect(backend.name).toBe('MeCab');
    });

    it('should support Japanese', () => {
      expect(backend.supportedLanguages).toContain('ja');
    });

    it('should not support other languages', () => {
      expect(backend.supportedLanguages).toHaveLength(1);
      expect(backend.supportedLanguages[0]).toBe('ja');
    });

    it('should not be available initially', () => {
      expect(backend.isAvailable).toBe(false);
    });
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      await backend.initialize();
      expect(backend.isAvailable).toBe(true);
    });

    it('should be idempotent', async () => {
      await backend.initialize();
      await backend.initialize();
      expect(backend.isAvailable).toBe(true);
    });
  });

  describe('cleanup', () => {
    it('should cleanup successfully', async () => {
      await backend.initialize();
      await backend.cleanup();
      expect(backend.isAvailable).toBe(false);
    });

    it('should be safe to call without initialization', async () => {
      await expect(backend.cleanup()).resolves.not.toThrow();
    });
  });

  describe('tokenization', () => {
    beforeEach(async () => {
      await backend.initialize();
    });

    it('should tokenize text', async () => {
      const mockTokens = [
        { surface: '私', base: '私', pos: '代名詞' },
        { surface: 'は', base: 'は', pos: '助詞' },
      ];
      
      mockAdapter.tokenize.mockResolvedValue({
        text: '私は',
        language: 'ja',
        tokens: mockTokens,
      });
      
      const result = await backend.tokenize('私は', 'ja');
      
      expect(result.text).toBe('私は');
      expect(result.language).toBe('ja');
      expect(result.tokens).toHaveLength(2);
      expect(mockAdapter.tokenize).toHaveBeenCalledWith('私は', 'ja');
    });

    it('should handle empty text', async () => {
      mockAdapter.tokenize.mockResolvedValue({
        text: '',
        language: 'ja',
        tokens: [],
      });
      
      const result = await backend.tokenize('', 'ja');
      
      expect(result.tokens).toHaveLength(0);
    });

    it('should reject non-Japanese text', async () => {
      await expect(backend.tokenize('text', 'de')).rejects.toThrow();
    });

    it('should propagate tokenization errors', async () => {
      mockAdapter.tokenize.mockRejectedValue(new Error('Tokenization failed'));
      
      await expect(backend.tokenize('text', 'ja')).rejects.toThrow();
    });
  });

  describe('batch tokenization', () => {
    beforeEach(async () => {
      await backend.initialize();
    });

    it('should tokenize multiple texts', async () => {
      const mockResults = [
        { text: '私は', language: 'ja', tokens: [{ surface: '私', base: '私', pos: '代名詞' }] },
        { text: '学生です', language: 'ja', tokens: [{ surface: '学生', base: '学生', pos: '名詞' }] },
      ];
      
      mockAdapter.tokenizeBatch.mockResolvedValue(mockResults);
      
      const results = await backend.tokenizeBatch(['私は', '学生です'], 'ja');
      
      expect(results).toHaveLength(2);
      expect(mockAdapter.tokenizeBatch).toHaveBeenCalledWith(['私は', '学生です'], 'ja');
    });

    it('should handle empty batch', async () => {
      mockAdapter.tokenizeBatch.mockResolvedValue([]);
      
      const results = await backend.tokenizeBatch([], 'ja');
      
      expect(results).toHaveLength(0);
    });
  });

  describe('lemma extraction', () => {
    beforeEach(async () => {
      await backend.initialize();
    });

    it('should get lemma from word', async () => {
      mockAdapter.getLemma.mockResolvedValue('買う');
      
      const lemma = await backend.getLemma('買った', 'ja');
      
      expect(lemma).toBe('買う');
      expect(mockAdapter.getLemma).toHaveBeenCalledWith('買った', 'ja');
    });
  });

  describe('reading extraction', () => {
    beforeEach(async () => {
      await backend.initialize();
    });

    it('should get reading from word', async () => {
      mockAdapter.getReading.mockResolvedValue('わたし');
      
      const reading = await backend.getReading('私', 'ja');
      
      expect(reading).toBe('わたし');
      expect(mockAdapter.getReading).toHaveBeenCalledWith('私', 'ja');
    });

    it('should return undefined for words without reading', async () => {
      mockAdapter.getReading.mockResolvedValue(undefined);
      
      const reading = await backend.getReading('a', 'ja');
      
      expect(reading).toBeUndefined();
    });
  });

  describe('pitch accent extraction', () => {
    beforeEach(async () => {
      await backend.initialize();
    });

    it('should get pitch accent from word', async () => {
      mockAdapter.getPitchAccent.mockResolvedValue(1);
      
      const accent = await backend.getPitchAccent('橋', 'ja');
      
      expect(accent).toBe(1);
      expect(mockAdapter.getPitchAccent).toHaveBeenCalledWith('橋', 'ja');
    });

    it('should return undefined for words without pitch accent', async () => {
      mockAdapter.getPitchAccent.mockResolvedValue(undefined);
      
      const accent = await backend.getPitchAccent('a', 'ja');
      
      expect(accent).toBeUndefined();
    });
  });

  describe('error handling', () => {
    beforeEach(async () => {
      await backend.initialize();
    });

    it('should handle HTTP adapter errors', async () => {
      mockAdapter.tokenize.mockRejectedValue(new Error('HTTP error'));
      
      await expect(backend.tokenize('text', 'ja')).rejects.toThrow();
    });

    it('should handle timeout errors', async () => {
      mockAdapter.tokenize.mockRejectedValue(new Error('Request timeout'));
      
      await expect(backend.tokenize('text', 'ja')).rejects.toThrow();
    });
  });
});
