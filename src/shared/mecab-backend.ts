/**
 * MeCab NLP Backend Implementation
 * 
 * Implements the NLPBackend interface for Japanese morphological analysis
 * using MeCab (Morphological Analyzer for Japanese).
 * 
 * MeCab is a dependency parser and morphological analyzer for Japanese.
 * It's the standard tool for Japanese NLP and provides:
 * - Tokenization (handles no-space-delimited text)
 * - POS tagging
 * - Lemmatization
 * - Reading extraction (furigana)
 * - Pitch accent detection
 * 
 * This implementation delegates to the Python backend via HTTP.
 */

import type { LanguageCode } from './language-abstraction';
import type { NLPBackend, TokenizationResult, NLPBackendConfig } from './nlp-backend-abstraction';
import {
  NLPBackendError,
  NLPBackendNotAvailableError,
  NLPBackendNotInitializedError,
} from './nlp-backend-abstraction';
import { getNLPHttpAdapter } from './nlp-http-adapter';

// ============================================================================
// MeCab Backend Implementation
// ============================================================================

/**
 * MeCab NLP Backend for Japanese
 * 
 * Handles morphological analysis of Japanese text using MeCab.
 * Delegates to Python backend via HTTP adapter.
 */
export class MeCabBackend implements NLPBackend {
  readonly id = 'mecab';
  readonly name = 'MeCab';
  readonly supportedLanguages: LanguageCode[] = ['ja'];
  
  private initialized = false;
  private httpAdapter = getNLPHttpAdapter();
  
  constructor(config?: NLPBackendConfig) {
    // Config is stored for future use when integrating with Python backend
    // Currently uses HTTP adapter for communication
    void config;
  }
  
  get isAvailable(): boolean {
    return this.initialized;
  }
  
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    
    try {
      console.log('[MeCabBackend] Initializing MeCab backend');
      
      // Test connection to Python backend
      // In a real implementation, this would check if MeCab is installed
      // For now, we assume the Python backend is available
      this.initialized = true;
      
      console.log('[MeCabBackend] MeCab backend initialized successfully');
    } catch (error) {
      throw new NLPBackendError(
        this.id,
        'ja',
        'Failed to initialize MeCab backend',
        error instanceof Error ? error : undefined
      );
    }
  }
  
  isReady(): boolean {
    return this.initialized;
  }
  
  async tokenize(text: string, language: LanguageCode): Promise<TokenizationResult> {
    if (!this.isReady()) {
      throw new NLPBackendNotInitializedError(this.id);
    }
    
    if (language !== 'ja') {
      throw new NLPBackendNotAvailableError(this.id, language);
    }
    
    try {
      return await this.httpAdapter.tokenize(text, language);
    } catch (error) {
      throw new NLPBackendError(
        this.id,
        language,
        'Tokenization failed',
        error instanceof Error ? error : undefined
      );
    }
  }
  
  async tokenizeBatch(texts: string[], language: LanguageCode): Promise<TokenizationResult[]> {
    if (!this.isReady()) {
      throw new NLPBackendNotInitializedError(this.id);
    }
    
    if (language !== 'ja') {
      throw new NLPBackendNotAvailableError(this.id, language);
    }
    
    try {
      return await this.httpAdapter.tokenizeBatch(texts, language);
    } catch (error) {
      throw new NLPBackendError(
        this.id,
        language,
        'Batch tokenization failed',
        error instanceof Error ? error : undefined
      );
    }
  }
  
  async getLemma(word: string, language: LanguageCode): Promise<string> {
    if (!this.isReady()) {
      throw new NLPBackendNotInitializedError(this.id);
    }
    
    if (language !== 'ja') {
      throw new NLPBackendNotAvailableError(this.id, language);
    }
    
    try {
      return await this.httpAdapter.getLemma(word, language);
    } catch (error) {
      throw new NLPBackendError(
        this.id,
        language,
        `Failed to get lemma for word: ${word}`,
        error instanceof Error ? error : undefined
      );
    }
  }
  
  async getReading(word: string, language: LanguageCode): Promise<string | undefined> {
    if (!this.isReady()) {
      throw new NLPBackendNotInitializedError(this.id);
    }
    
    if (language !== 'ja') {
      throw new NLPBackendNotAvailableError(this.id, language);
    }
    
    try {
      return await this.httpAdapter.getReading(word, language);
    } catch (error) {
      throw new NLPBackendError(
        this.id,
        language,
        `Failed to get reading for word: ${word}`,
        error instanceof Error ? error : undefined
      );
    }
  }
  
  async getPitchAccent(word: string, language: LanguageCode): Promise<number | undefined> {
    if (!this.isReady()) {
      throw new NLPBackendNotInitializedError(this.id);
    }
    
    if (language !== 'ja') {
      throw new NLPBackendNotAvailableError(this.id, language);
    }
    
    try {
      return await this.httpAdapter.getPitchAccent(word, language);
    } catch (error) {
      throw new NLPBackendError(
        this.id,
        language,
        `Failed to get pitch accent for word: ${word}`,
        error instanceof Error ? error : undefined
      );
    }
  }
  
  async cleanup(): Promise<void> {
    if (!this.initialized) {
      return;
    }
    
    try {
      console.log('[MeCabBackend] Cleaning up MeCab backend');
      this.initialized = false;
      console.log('[MeCabBackend] MeCab backend cleaned up successfully');
    } catch (error) {
      throw new NLPBackendError(
        this.id,
        'ja',
        'Failed to cleanup MeCab backend',
        error instanceof Error ? error : undefined
      );
    }
  }
}
