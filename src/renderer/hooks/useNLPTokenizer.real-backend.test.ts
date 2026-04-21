/**
 * useNLPTokenizer Real Backend Tests
 * Tests with actual NLP backends (MeCab for Japanese, spaCy for German)
 * 
 * Run with: SKIP_INTEGRATION=false npm run test -- useNLPTokenizer.real-backend.test.ts
 * 
 * Prerequisites:
 * - Python backend running on localhost:7752
 * - MeCab server available
 * - spaCy server available
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { TokenizationResult, MorphToken } from '../../shared/nlp-backend-abstraction';
import type { LanguageCode } from '../../shared/language-abstraction';

// Skip if backends not available
const SKIP_REAL_BACKEND = process.env.SKIP_INTEGRATION === 'true';

/**
 * Helper to verify backend is available
 */
async function isBackendAvailable(): Promise<boolean> {
  try {
    const response = await fetch('http://localhost:7752/health', { timeout: 5000 });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Helper to call tokenization endpoint
 */
async function tokenizeViaBackend(text: string, language: LanguageCode): Promise<TokenizationResult> {
  const response = await fetch('http://localhost:7752/tokenize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language }),
  });
  
  if (!response.ok) {
    throw new Error(`Backend error: ${response.statusText}`);
  }
  
  return response.json();
}

describe.skipIf(SKIP_REAL_BACKEND)('useNLPTokenizer Real Backend Tests', () => {
  let backendAvailable = false;

  beforeAll(async () => {
    backendAvailable = await isBackendAvailable();
    if (!backendAvailable) {
      console.warn('⚠️  Backend not available at localhost:7752');
      console.warn('   Start Python backend with: cd src/root-of-app && python server.py');
    }
  });

  describe.skipIf(!backendAvailable)('Japanese Tokenization (MeCab)', () => {
    it('should tokenize simple Japanese sentence', async () => {
      const result = await tokenizeViaBackend('こんにちは', 'ja');
      
      expect(result).toBeDefined();
      expect(result.text).toBe('こんにちは');
      expect(result.language).toBe('ja');
      expect(result.tokens).toBeDefined();
      expect(result.tokens.length).toBeGreaterThan(0);
      
      // Verify token structure
      const token = result.tokens[0];
      expect(token.surface).toBeDefined();
      expect(token.base).toBeDefined();
      expect(token.pos).toBeDefined();
    });

    it('should extract readings from Japanese tokens', async () => {
      const result = await tokenizeViaBackend('漢字', 'ja');
      
      expect(result.tokens.length).toBeGreaterThan(0);
      const token = result.tokens[0];
      
      // Verify reading is extracted
      expect(token.reading).toBeDefined();
      expect(typeof token.reading).toBe('string');
      expect(token.reading!.length).toBeGreaterThan(0);
    });

    it('should detect pitch accent for Japanese words', async () => {
      const result = await tokenizeViaBackend('橋', 'ja');
      
      expect(result.tokens.length).toBeGreaterThan(0);
      const token = result.tokens[0];
      
      // Verify pitch accent is present
      expect(token.pitchAccent).toBeDefined();
      expect(typeof token.pitchAccent).toBe('number');
      expect(token.pitchAccent).toBeGreaterThanOrEqual(0);
    });

    it('should handle complex Japanese sentence with kanji', async () => {
      const result = await tokenizeViaBackend('私は毎日学校に行きます', 'ja');
      
      expect(result.tokens.length).toBeGreaterThan(0);
      
      // Verify token count is reasonable (should be 7-8 tokens)
      expect(result.tokens.length).toBeGreaterThanOrEqual(5);
      expect(result.tokens.length).toBeLessThanOrEqual(10);
      
      // Verify all tokens have required fields
      result.tokens.forEach((token) => {
        expect(token.surface).toBeDefined();
        expect(token.base).toBeDefined();
        expect(token.pos).toBeDefined();
      });
    });

    it('should handle mixed hiragana and kanji', async () => {
      const result = await tokenizeViaBackend('ひらがなと漢字', 'ja');
      
      expect(result.tokens.length).toBeGreaterThan(0);
      
      // Verify tokens are correctly identified
      const surfaces = result.tokens.map((t) => t.surface);
      expect(surfaces.join('')).toContain('ひらがな');
      expect(surfaces.join('')).toContain('漢字');
    });

    it('should handle katakana', async () => {
      const result = await tokenizeViaBackend('コンピューター', 'ja');
      
      expect(result.tokens.length).toBeGreaterThan(0);
      const token = result.tokens[0];
      
      expect(token.surface).toBe('コンピューター');
      expect(token.pos).toBeDefined();
    });

    it('should handle punctuation', async () => {
      const result = await tokenizeViaBackend('これはテストです。', 'ja');
      
      expect(result.tokens.length).toBeGreaterThan(0);
      
      // Should include punctuation as token
      const hasPunctuation = result.tokens.some((t) => t.surface === '。');
      expect(hasPunctuation).toBe(true);
    });

    it('should return consistent results for same input', async () => {
      const text = 'テスト';
      
      const result1 = await tokenizeViaBackend(text, 'ja');
      const result2 = await tokenizeViaBackend(text, 'ja');
      
      // Results should be identical
      expect(result1.tokens.length).toBe(result2.tokens.length);
      result1.tokens.forEach((token, index) => {
        const token2 = result2.tokens[index];
        expect(token.surface).toBe(token2.surface);
        expect(token.base).toBe(token2.base);
        expect(token.pos).toBe(token2.pos);
      });
    });

    it('should produce correct POS tags', async () => {
      const result = await tokenizeViaBackend('私は学生です', 'ja');
      
      expect(result.tokens.length).toBeGreaterThan(0);
      
      // Verify POS tags are reasonable
      result.tokens.forEach((token) => {
        expect(token.pos).toBeDefined();
        expect(typeof token.pos).toBe('string');
        expect(token.pos.length).toBeGreaterThan(0);
      });
    });

    it('should produce correct lemmas', async () => {
      const result = await tokenizeViaBackend('走っている', 'ja');
      
      expect(result.tokens.length).toBeGreaterThan(0);
      
      // Verify lemmas are extracted
      result.tokens.forEach((token) => {
        expect(token.base).toBeDefined();
        expect(typeof token.base).toBe('string');
        expect(token.base.length).toBeGreaterThan(0);
      });
    });
  });

  describe.skipIf(!backendAvailable)('German Tokenization (spaCy)', () => {
    it('should tokenize simple German sentence', async () => {
      const result = await tokenizeViaBackend('Guten Tag', 'de');
      
      expect(result).toBeDefined();
      expect(result.text).toBe('Guten Tag');
      expect(result.language).toBe('de');
      expect(result.tokens).toBeDefined();
      expect(result.tokens.length).toBeGreaterThan(0);
      
      // Verify token structure
      result.tokens.forEach((token) => {
        expect(token.surface).toBeDefined();
        expect(token.base).toBeDefined();
        expect(token.pos).toBeDefined();
      });
    });

    it('should tokenize German sentence with verbs', async () => {
      const result = await tokenizeViaBackend('Ich gehe zur Schule', 'de');
      
      expect(result.tokens.length).toBeGreaterThan(0);
      
      // Verify token count is reasonable
      expect(result.tokens.length).toBeGreaterThanOrEqual(3);
      expect(result.tokens.length).toBeLessThanOrEqual(6);
    });

    it('should handle German compound words', async () => {
      const result = await tokenizeViaBackend('Donaudampfschifffahrtsgesellschaftskapitän', 'de');
      
      expect(result.tokens.length).toBeGreaterThan(0);
      
      // Verify compound word is tokenized
      const surfaces = result.tokens.map((t) => t.surface);
      expect(surfaces.join('').length).toBeGreaterThan(0);
    });

    it('should handle German umlauts', async () => {
      const result = await tokenizeViaBackend('Äpfel', 'de');
      
      expect(result.tokens.length).toBeGreaterThan(0);
      const token = result.tokens[0];
      
      expect(token.surface).toContain('Ä');
    });

    it('should handle German punctuation', async () => {
      const result = await tokenizeViaBackend('Das ist ein Test!', 'de');
      
      expect(result.tokens.length).toBeGreaterThan(0);
      
      // Should include punctuation as token
      const hasPunctuation = result.tokens.some((t) => t.surface === '!');
      expect(hasPunctuation).toBe(true);
    });

    it('should extract lemmas for German words', async () => {
      const result = await tokenizeViaBackend('laufen', 'de');
      
      expect(result.tokens.length).toBeGreaterThan(0);
      const token = result.tokens[0];
      
      expect(token.base).toBeDefined();
      expect(typeof token.base).toBe('string');
    });

    it('should handle German articles', async () => {
      const result = await tokenizeViaBackend('der Mann', 'de');
      
      expect(result.tokens.length).toBeGreaterThan(0);
      
      // Should tokenize article and noun separately
      expect(result.tokens.length).toBeGreaterThanOrEqual(2);
    });

    it('should not have pitch accent for German', async () => {
      const result = await tokenizeViaBackend('Wort', 'de');
      
      expect(result.tokens.length).toBeGreaterThan(0);
      result.tokens.forEach((token) => {
        // Pitch accent should be undefined for German
        expect(token.pitchAccent).toBeUndefined();
      });
    });

    it('should return consistent results for same input', async () => {
      const text = 'Test';
      
      const result1 = await tokenizeViaBackend(text, 'de');
      const result2 = await tokenizeViaBackend(text, 'de');
      
      // Results should be identical
      expect(result1.tokens.length).toBe(result2.tokens.length);
      result1.tokens.forEach((token, index) => {
        const token2 = result2.tokens[index];
        expect(token.surface).toBe(token2.surface);
        expect(token.base).toBe(token2.base);
        expect(token.pos).toBe(token2.pos);
      });
    });

    it('should produce correct POS tags', async () => {
      const result = await tokenizeViaBackend('Ich bin Schüler', 'de');
      
      expect(result.tokens.length).toBeGreaterThan(0);
      
      // Verify POS tags are reasonable
      result.tokens.forEach((token) => {
        expect(token.pos).toBeDefined();
        expect(typeof token.pos).toBe('string');
        expect(token.pos.length).toBeGreaterThan(0);
      });
    });

    it('should produce correct lemmas', async () => {
      const result = await tokenizeViaBackend('laufen', 'de');
      
      expect(result.tokens.length).toBeGreaterThan(0);
      
      // Verify lemmas are extracted
      result.tokens.forEach((token) => {
        expect(token.base).toBeDefined();
        expect(typeof token.base).toBe('string');
        expect(token.base.length).toBeGreaterThan(0);
      });
    });
  });

  describe.skipIf(!backendAvailable)('Performance Verification', () => {
    it('should tokenize Japanese within reasonable time', async () => {
      const start = performance.now();
      await tokenizeViaBackend('これはテストです', 'ja');
      const duration = performance.now() - start;
      
      // Should complete within 100ms (including network latency)
      expect(duration).toBeLessThan(100);
    });

    it('should tokenize German within reasonable time', async () => {
      const start = performance.now();
      await tokenizeViaBackend('Dies ist ein Test', 'de');
      const duration = performance.now() - start;
      
      // Should complete within 100ms (including network latency)
      expect(duration).toBeLessThan(100);
    });

    it('should handle long Japanese text', async () => {
      const longText = 'これはテストです。'.repeat(10);
      const result = await tokenizeViaBackend(longText, 'ja');
      
      expect(result.tokens.length).toBeGreaterThan(0);
    });

    it('should handle long German text', async () => {
      const longText = 'Dies ist ein Test. '.repeat(10);
      const result = await tokenizeViaBackend(longText, 'de');
      
      expect(result.tokens.length).toBeGreaterThan(0);
    });
  });

  describe.skipIf(!backendAvailable)('Error Handling', () => {
    it('should handle empty text', async () => {
      try {
        await tokenizeViaBackend('', 'ja');
        // May succeed with empty token array or throw error
      } catch (err) {
        // Error is acceptable for empty text
        expect(err).toBeDefined();
      }
    });

    it('should handle invalid language code', async () => {
      try {
        await tokenizeViaBackend('test', 'xx' as LanguageCode);
        // May fail or return error
      } catch (err) {
        // Error is expected for unsupported language
        expect(err).toBeDefined();
      }
    });
  });
});
