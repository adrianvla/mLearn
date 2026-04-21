import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getNLPBackendFactory, resetNLPBackendFactory } from './nlp-backend-factory';
import { getNLPBackendRegistry, resetNLPBackendRegistry } from './nlp-backend-registry';

describe('NLPBackendFactory', () => {
  beforeEach(() => {
    resetNLPBackendFactory();
    resetNLPBackendRegistry();
  });

  afterEach(() => {
    resetNLPBackendFactory();
    resetNLPBackendRegistry();
  });

  describe('singleton pattern', () => {
    it('should return the same instance', () => {
      const factory1 = getNLPBackendFactory();
      const factory2 = getNLPBackendFactory();
      expect(factory1).toBe(factory2);
    });

    it('should reset to a new instance', () => {
      const factory1 = getNLPBackendFactory();
      resetNLPBackendFactory();
      const factory2 = getNLPBackendFactory();
      expect(factory1).not.toBe(factory2);
    });
  });

  describe('backend creation', () => {
    it('should create a MeCab backend', async () => {
      const factory = getNLPBackendFactory();
      const backend = await factory.createBackend('mecab', { autoInitialize: false });
      
      expect(backend).toBeDefined();
      expect(backend.id).toBe('mecab');
      expect(backend.supportedLanguages).toContain('ja');
    });

    it('should create a spaCy backend', async () => {
      const factory = getNLPBackendFactory();
      const backend = await factory.createBackend('spacy', { autoInitialize: false });
      
      expect(backend).toBeDefined();
      expect(backend.id).toBe('spacy');
      expect(backend.supportedLanguages).toContain('de');
    });

    it('should throw error for unknown backend type', async () => {
      const factory = getNLPBackendFactory();
      await expect(
        factory.createBackend('unknown' as any, { autoInitialize: false })
      ).rejects.toThrow();
    });

    it('should auto-initialize backend if configured', async () => {
      const factory = getNLPBackendFactory();
      const backend = await factory.createBackend('mecab', { autoInitialize: true });
      
      expect(backend.isAvailable).toBe(true);
    });

    it('should not auto-initialize backend if not configured', async () => {
      const factory = getNLPBackendFactory();
      const backend = await factory.createBackend('mecab', { autoInitialize: false });
      
      expect(backend.isAvailable).toBe(false);
    });
  });

  describe('backend registration', () => {
    it('should create and register backend', async () => {
      const factory = getNLPBackendFactory();
      const registry = getNLPBackendRegistry();
      
      const backend = await factory.createAndRegisterBackend('mecab', {
        autoInitialize: false,
      });
      
      const registered = registry.getBackend('mecab');
      expect(registered).toBe(backend);
    });

    it('should auto-initialize registered backend if configured', async () => {
      const factory = getNLPBackendFactory();
      const backend = await factory.createAndRegisterBackend('mecab', {
        autoInitialize: true,
      });
      
      expect(backend.isAvailable).toBe(true);
    });
  });

  describe('batch creation', () => {
    it('should create multiple backends', async () => {
      const factory = getNLPBackendFactory();
      const backends = await factory.createMultipleBackends([
        { type: 'mecab', config: { autoInitialize: false } },
        { type: 'spacy', config: { autoInitialize: false } },
      ]);
      
      expect(backends).toHaveLength(2);
      expect(backends[0].id).toBe('mecab');
      expect(backends[1].id).toBe('spacy');
    });

    it('should create and register multiple backends', async () => {
      const factory = getNLPBackendFactory();
      const registry = getNLPBackendRegistry();
      
      const backends = await factory.createAndRegisterMultipleBackends([
        { type: 'mecab', config: { autoInitialize: false } },
        { type: 'spacy', config: { autoInitialize: false } },
      ]);
      
      expect(backends).toHaveLength(2);
      expect(registry.getBackend('mecab')).toBe(backends[0]);
      expect(registry.getBackend('spacy')).toBe(backends[1]);
    });

    it('should handle partial failures in batch creation', async () => {
      const factory = getNLPBackendFactory();
      const backends = await factory.createMultipleBackends([
        { type: 'mecab', config: { autoInitialize: false } },
        { type: 'unknown' as any, config: { autoInitialize: false } },
        { type: 'spacy', config: { autoInitialize: false } },
      ]);
      
      // Should return only successful backends
      expect(backends.length).toBeGreaterThan(0);
      expect(backends.some(b => b.id === 'mecab')).toBe(true);
      expect(backends.some(b => b.id === 'spacy')).toBe(true);
    });
  });
});
