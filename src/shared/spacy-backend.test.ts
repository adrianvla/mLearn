import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SpaCyBackend } from './spacy-backend';
import { getNLPHttpAdapter } from './nlp-http-adapter';

// Mock the HTTP adapter
vi.mock('./nlp-http-adapter', () => ({
  getNLPHttpAdapter: vi.fn(),
  resetNLPHttpAdapter: vi.fn(),
}));

describe('SpaCyBackend', () => {
  let backend: SpaCyBackend;
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
    backend = new SpaCyBackend();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('backend properties', () => {
    it('should have correct id', () => {
      expect(backend.id).toBe('spacy');
    });

    it('should have correct name', () => {
      expect(backend.name).toBe('spaCy');
    });

    it('should support German', () => {
      expect(backend.supportedLanguages).toContain('de');
    });

    it('should not support Japanese', () => {
      expect(backend.supportedLanguages).not.toContain('ja');
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

    it('should tokenize German text', async () => {
      const mockTokens = [
        { surface: 'Ich', base: 'ich', pos: 'PRON' },
        { surface: 'bin', base: 'sein', pos: 'AUX' },
      ];
      
      mockAdapter.tokenize.mockResolvedValue({
        text: 'Ich bin',
        language: 'de',
        tokens: mockTokens,
      });
      
      const result = await backend.tokenize('Ich bin', 'de');
      
      expect(result.text).toBe('Ich bin');
      expect(result.language).toBe('de');
      expect(result.tokens).toHaveLength(2);
      expect(mockAdapter.tokenize).toHaveBeenCalledWith('Ich bin', 'de');
    });

    it('should handle empty text', async () => {
      mockAdapter.tokenize.mockResolvedValue({
        text: '',
        language: 'de',
        tokens: [],
      });
      
      const result = await backend.tokenize('', 'de');
      
      expect(result.tokens).toHaveLength(0);
    });

    it('should reject unsupported languages', async () => {
      await expect(backend.tokenize('text', 'ja')).rejects.toThrow();
    });
  });

  describe('batch tokenization', () => {
    beforeEach(async () => {
      await backend.initialize();
    });

    it('should tokenize multiple texts', async () => {
      const mockResults = [
        { text: 'Ich bin', language: 'de', tokens: [{ surface: 'Ich', base: 'ich', pos: 'PRON' }] },
        { text: 'Du bist', language: 'de', tokens: [{ surface: 'Du', base: 'du', pos: 'PRON' }] },
      ];
      
      mockAdapter.tokenizeBatch.mockResolvedValue(mockResults);
      
      const results = await backend.tokenizeBatch(['Ich bin', 'Du bist'], 'de');
      
      expect(results).toHaveLength(2);
      expect(mockAdapter.tokenizeBatch).toHaveBeenCalledWith(['Ich bin', 'Du bist'], 'de');
    });

    it('should reject unsupported languages in batch', async () => {
      await expect(backend.tokenizeBatch(['text'], 'ja')).rejects.toThrow();
    });
  });

  describe('lemma extraction', () => {
    beforeEach(async () => {
      await backend.initialize();
    });

    it('should get lemma for German word', async () => {
      mockAdapter.getLemma.mockResolvedValue('sein');
      
      const lemma = await backend.getLemma('bin', 'de');
      
      expect(lemma).toBe('sein');
      expect(mockAdapter.getLemma).toHaveBeenCalledWith('bin', 'de');
    });

    it('should reject unsupported languages', async () => {
      await expect(backend.getLemma('word', 'ja')).rejects.toThrow();
    });
  });

  describe('reading extraction', () => {
    beforeEach(async () => {
      await backend.initialize();
    });

    it('should return undefined for German (no readings)', async () => {
      const reading = await backend.getReading('Wort', 'de');
      
      expect(reading).toBeUndefined();
    });

    it('should reject unsupported languages', async () => {
      await expect(backend.getReading('word', 'ja')).rejects.toThrow();
    });
  });

  describe('pitch accent extraction', () => {
    beforeEach(async () => {
      await backend.initialize();
    });

    it('should return undefined for German (no pitch accent)', async () => {
      const pitch = await backend.getPitchAccent('Wort', 'de');
      
      expect(pitch).toBeUndefined();
    });

    it('should reject unsupported languages', async () => {
      await expect(backend.getPitchAccent('word', 'ja')).rejects.toThrow();
    });
  });

  describe('error handling', () => {
    it('should throw when not initialized', async () => {
      await expect(backend.tokenize('text', 'de')).rejects.toThrow();
    });

    it('should handle HTTP adapter errors', async () => {
      await backend.initialize();
      
      mockAdapter.tokenize.mockRejectedValue(new Error('Network error'));
      
      await expect(backend.tokenize('text', 'de')).rejects.toThrow();
    });
  });
});
