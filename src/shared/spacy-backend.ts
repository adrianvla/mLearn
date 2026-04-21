/**
 * spaCy NLP Backend Implementation
 * 
 * Implements the NLPBackend interface for German (and other languages)
 * morphological analysis using spaCy.
 * 
 * spaCy is a modern NLP library that provides:
 * - Tokenization (handles space-delimited text)
 * - POS tagging
 * - Lemmatization
 * - Dependency parsing
 * - Named entity recognition
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
// spaCy Backend Implementation
// ============================================================================

/**
 * spaCy NLP Backend for German and other languages
 * 
 * Handles morphological analysis using spaCy.
 * Delegates to Python backend via HTTP adapter.
 */
export class SpaCyBackend implements NLPBackend {
  readonly id = 'spacy';
  readonly name = 'spaCy';
  readonly supportedLanguages: LanguageCode[] = ['de'];
  
  private initialized = false;
  private readonly language: LanguageCode;
  private httpAdapter = getNLPHttpAdapter();
  
  constructor(language: LanguageCode = 'de', config?: NLPBackendConfig) {
    this.language = language;
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
      console.log(`[SpaCyBackend] Initializing spaCy backend for ${this.language}`);
      
      // Test connection to Python backend
      // In a real implementation, this would check if spaCy is installed
      // and load the language model (e.g., de_core_news_sm)
      // For now, we assume the Python backend is available
      this.initialized = true;
      
      console.log(`[SpaCyBackend] spaCy backend initialized successfully for ${this.language}`);
    } catch (error) {
      throw new NLPBackendError(
        this.id,
        this.language,
        `Failed to initialize spaCy backend for ${this.language}`,
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
    
    if (!this.supportedLanguages.includes(language)) {
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
    
    if (!this.supportedLanguages.includes(language)) {
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
    
    if (!this.supportedLanguages.includes(language)) {
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
  
  async getReading(_word: string, language: LanguageCode): Promise<string | undefined> {
    if (!this.isReady()) {
      throw new NLPBackendNotInitializedError(this.id);
    }
    
    if (!this.supportedLanguages.includes(language)) {
      throw new NLPBackendNotAvailableError(this.id, language);
    }
    
    // spaCy doesn't provide reading/pronunciation for German
    // This is a Japanese-specific feature
    return undefined;
  }
  
  async getPitchAccent(_word: string, language: LanguageCode): Promise<number | undefined> {
    if (!this.isReady()) {
      throw new NLPBackendNotInitializedError(this.id);
    }
    
    if (!this.supportedLanguages.includes(language)) {
      throw new NLPBackendNotAvailableError(this.id, language);
    }
    
    // spaCy doesn't provide pitch accent for German
    // This is a Japanese-specific feature
    return undefined;
  }
  
  async cleanup(): Promise<void> {
    if (!this.initialized) {
      return;
    }
    
    try {
      console.log(`[SpaCyBackend] Cleaning up spaCy backend for ${this.language}`);
      this.initialized = false;
      console.log(`[SpaCyBackend] spaCy backend cleaned up successfully for ${this.language}`);
    } catch (error) {
      throw new NLPBackendError(
        this.id,
        this.language,
        `Failed to cleanup spaCy backend for ${this.language}`,
        error instanceof Error ? error : undefined
      );
    }
  }
}
