import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getNLPBackendRegistry, resetNLPBackendRegistry } from './nlp-backend-registry';
import { NLPBackend, MorphToken, TokenizationResult } from './nlp-backend-abstraction';
import type { LanguageCode } from './language-abstraction';

// Mock NLP Backend for testing
class MockNLPBackend implements NLPBackend {
  readonly id: string;
  readonly name: string;
  readonly supportedLanguages: LanguageCode[];
  isAvailable: boolean = false;
  initCalled: boolean = false;
  cleanupCalled: boolean = false;

  constructor(id: string, languages: LanguageCode[]) {
    this.id = id;
    this.name = `Mock ${id}`;
    this.supportedLanguages = languages;
  }

  async initialize(): Promise<void> {
    this.initCalled = true;
    this.isAvailable = true;
  }

  async cleanup(): Promise<void> {
    this.cleanupCalled = true;
    this.isAvailable = false;
  }

  isReady(): boolean {
    return this.isAvailable;
  }

  async tokenize(text: string, language: LanguageCode): Promise<TokenizationResult> {
    return {
      text,
      language,
      tokens: [{ surface: text, base: text, pos: 'NOUN' }],
    };
  }

  async getLemma(word: string, language: LanguageCode): Promise<string> {
    return word;
  }

  async getReading(word: string, language: LanguageCode): Promise<string | undefined> {
    return undefined;
  }

  async getPitchAccent(word: string, language: LanguageCode): Promise<number | undefined> {
    return undefined;
  }

  async tokenizeBatch(texts: string[], language: LanguageCode): Promise<TokenizationResult[]> {
    return texts.map(text => ({
      text,
      language,
      tokens: [{ surface: text, base: text, pos: 'NOUN' }],
    }));
  }

  async getInflection(word: string, language: LanguageCode): Promise<string | undefined> {
    return undefined;
  }

  async getConjugation(word: string, language: LanguageCode): Promise<string | undefined> {
    return undefined;
  }

  async getFeatures(word: string, language: LanguageCode): Promise<Record<string, string> | undefined> {
    return undefined;
  }
}

describe('NLPBackendRegistry', () => {
  beforeEach(() => {
    resetNLPBackendRegistry();
  });

  afterEach(() => {
    resetNLPBackendRegistry();
  });

  describe('singleton pattern', () => {
    it('should return the same instance', () => {
      const registry1 = getNLPBackendRegistry();
      const registry2 = getNLPBackendRegistry();
      expect(registry1).toBe(registry2);
    });

    it('should reset to a new instance', () => {
      const registry1 = getNLPBackendRegistry();
      resetNLPBackendRegistry();
      const registry2 = getNLPBackendRegistry();
      expect(registry1).not.toBe(registry2);
    });
  });

  describe('backend registration', () => {
    it('should register a backend', () => {
      const registry = getNLPBackendRegistry();
      const backend = new MockNLPBackend('mecab', ['ja']);
      registry.register(backend);
      
      const backends = registry.getBackendsForLanguage('ja');
      expect(backends).toContain(backend);
    });

    it('should register multiple backends for same language', () => {
      const registry = getNLPBackendRegistry();
      const backend1 = new MockNLPBackend('mecab', ['ja']);
      const backend2 = new MockNLPBackend('janome', ['ja']);
      
      registry.register(backend1);
      registry.register(backend2);
      
      const backends = registry.getBackendsForLanguage('ja');
      expect(backends).toHaveLength(2);
      expect(backends).toContain(backend1);
      expect(backends).toContain(backend2);
    });

    it('should register backend for multiple languages', () => {
      const registry = getNLPBackendRegistry();
      const backend = new MockNLPBackend('spacy', ['de', 'en']);
      registry.register(backend);
      
      expect(registry.getBackendsForLanguage('de')).toContain(backend);
      expect(registry.getBackendsForLanguage('en')).toContain(backend);
    });

    it('should unregister a backend', () => {
      const registry = getNLPBackendRegistry();
      const backend = new MockNLPBackend('mecab', ['ja']);
      registry.register(backend);
      
      expect(registry.getBackendsForLanguage('ja')).toHaveLength(1);
      
      registry.unregister('mecab');
      
      expect(registry.getBackendsForLanguage('ja')).toHaveLength(0);
    });
  });

  describe('backend retrieval', () => {
    it('should return null for unsupported language', () => {
      const registry = getNLPBackendRegistry();
      const backend = new MockNLPBackend('mecab', ['ja']);
      registry.register(backend);
      
      expect(registry.getBestBackend('de')).toBeNull();
    });

    it('should return empty array for unsupported language', () => {
      const registry = getNLPBackendRegistry();
      const backend = new MockNLPBackend('mecab', ['ja']);
      registry.register(backend);
      
      expect(registry.getBackendsForLanguage('de')).toEqual([]);
    });

    it('should return backend by ID', () => {
      const registry = getNLPBackendRegistry();
      const backend = new MockNLPBackend('mecab', ['ja']);
      registry.register(backend);
      
      const retrieved = registry.getBackend('mecab');
      expect(retrieved).toBe(backend);
    });

    it('should return null for non-existent backend ID', () => {
      const registry = getNLPBackendRegistry();
      expect(registry.getBackend('nonexistent')).toBeNull();
    });

    it('should return best backend (first in list)', () => {
      const registry = getNLPBackendRegistry();
      const backend1 = new MockNLPBackend('mecab', ['ja']);
      const backend2 = new MockNLPBackend('janome', ['ja']);
      
      registry.register(backend1);
      registry.register(backend2);
      
      const best = registry.getBestBackend('ja');
      expect(best).toBeDefined();
      expect([backend1, backend2]).toContain(best);
    });
  });

  describe('initialization and cleanup', () => {
    it('should initialize all backends', async () => {
      const registry = getNLPBackendRegistry();
      const backend1 = new MockNLPBackend('mecab', ['ja']);
      const backend2 = new MockNLPBackend('spacy', ['de']);
      
      registry.register(backend1);
      registry.register(backend2);
      
      await registry.initializeAll();
      
      expect(backend1.initCalled).toBe(true);
      expect(backend2.initCalled).toBe(true);
      expect(backend1.isAvailable).toBe(true);
      expect(backend2.isAvailable).toBe(true);
    });

    it('should cleanup all backends', async () => {
      const registry = getNLPBackendRegistry();
      const backend1 = new MockNLPBackend('mecab', ['ja']);
      const backend2 = new MockNLPBackend('spacy', ['de']);
      
      registry.register(backend1);
      registry.register(backend2);
      
      await registry.initializeAll();
      await registry.cleanupAll();
      
      expect(backend1.cleanupCalled).toBe(true);
      expect(backend2.cleanupCalled).toBe(true);
      expect(backend1.isAvailable).toBe(false);
      expect(backend2.isAvailable).toBe(false);
    });
  });

  describe('statistics', () => {
    it('should return registry statistics', () => {
      const registry = getNLPBackendRegistry();
      const backend1 = new MockNLPBackend('mecab', ['ja']);
      const backend2 = new MockNLPBackend('spacy', ['de', 'en']);
      
      registry.register(backend1);
      registry.register(backend2);
      
      const stats = registry.getStats();
      
      expect(stats.totalBackends).toBe(2);
      expect(stats.supportedLanguages).toContain('ja');
      expect(stats.supportedLanguages).toContain('de');
      expect(stats.supportedLanguages).toContain('en');
    });
  });
});
