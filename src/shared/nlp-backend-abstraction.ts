/**
 * NLP Backend Abstraction Layer
 * 
 * Defines trait-based interfaces for pluggable morphological analysis,
 * tokenization, and NLP processing. This enables support for multiple
 * languages with different NLP backends (MeCab, spaCy, STANZA, etc.)
 * without coupling the core logic to specific implementations.
 * 
 * Based on MeCrab's trait-based design pattern.
 */

import type { LanguageCode } from './language-abstraction';

// ============================================================================
// Token Types
// ============================================================================

/**
 * Morphological token from NLP analysis
 * Represents a single word/morpheme with linguistic information
 */
export interface MorphToken {
  /** Surface form (as it appears in text) */
  surface: string;
  
  /** Dictionary/base form (lemma) */
  base: string;
  
  /** Part of speech (language-specific) */
  pos: string;
  
  /** Detailed POS tags (language-specific) */
  posTags?: string[];
  
  /** Reading/pronunciation (if available) */
  reading?: string;
  
  /** Pitch accent information (if available) */
  pitchAccent?: number;
  
  /** Inflection form (if applicable) */
  inflection?: string;
  
  /** Conjugation form (if applicable) */
  conjugation?: string;
  
  /** Additional features (language-specific) */
  features?: Record<string, string>;
}

/**
 * Tokenization result
 */
export interface TokenizationResult {
  /** Input text */
  text: string;
  
  /** Language code */
  language: LanguageCode;
  
  /** Tokenized morphemes */
  tokens: MorphToken[];
  
  /** Processing time in milliseconds */
  processingTime?: number;
  
  /** Confidence score (0-1) */
  confidence?: number;
}

// ============================================================================
// NLP Backend Interface (Trait)
// ============================================================================

/**
 * NLP Backend trait
 * Defines the interface for morphological analysis and tokenization
 * 
 * Implementations should handle:
 * - Language-specific tokenization (space-delimited vs. no-space)
 * - Morphological analysis (POS tagging, lemmatization)
 * - Reading/pronunciation extraction (if applicable)
 * - Pitch accent detection (if applicable)
 */
export interface NLPBackend {
  /** Backend identifier (e.g., 'mecab', 'spacy', 'stanza') */
  readonly id: string;
  
  /** Human-readable name */
  readonly name: string;
  
  /** Supported languages */
  readonly supportedLanguages: LanguageCode[];
  
  /** Whether this backend is available/initialized */
  readonly isAvailable: boolean;
  
  /**
   * Initialize the backend
   * Called once at application startup
   */
  initialize(): Promise<void>;
  
  /**
   * Check if backend is ready for use
   */
  isReady(): boolean;
  
  /**
   * Tokenize and analyze text
   * @param text - Input text to analyze
   * @param language - Language code
   * @returns Tokenization result with morphological information
   */
  tokenize(text: string, language: LanguageCode): Promise<TokenizationResult>;
  
  /**
   * Batch tokenize multiple texts
   * @param texts - Array of texts to analyze
   * @param language - Language code
   * @returns Array of tokenization results
   */
  tokenizeBatch(texts: string[], language: LanguageCode): Promise<TokenizationResult[]>;
  
  /**
   * Get lemma (dictionary form) for a word
   * @param word - Surface form
   * @param language - Language code
   * @returns Dictionary form or original word if not found
   */
  getLemma(word: string, language: LanguageCode): Promise<string>;
  
  /**
   * Get reading/pronunciation for a word
   * @param word - Surface form
   * @param language - Language code
   * @returns Reading or undefined if not available
   */
  getReading(word: string, language: LanguageCode): Promise<string | undefined>;
  
  /**
   * Get pitch accent for a word (Japanese only)
   * @param word - Surface form
   * @param language - Language code
   * @returns Pitch accent position or undefined if not available
   */
  getPitchAccent(word: string, language: LanguageCode): Promise<number | undefined>;
  
  /**
   * Cleanup and release resources
   */
  cleanup(): Promise<void>;
}

// ============================================================================
// NLP Backend Registry
// ============================================================================

/**
 * Registry for managing multiple NLP backends
 */
export interface NLPBackendRegistry {
  /**
   * Register a new backend
   */
  register(backend: NLPBackend): void;
  
  /**
   * Unregister a backend
   */
  unregister(backendId: string): void;
  
  /**
   * Get a backend by ID
   */
  getBackend(backendId: string): NLPBackend | null;
  
  /**
   * Get the best backend for a language
   */
  getBestBackend(language: LanguageCode): NLPBackend | null;
  
  /**
   * Get all available backends
   */
  getAllBackends(): NLPBackend[];
  
  /**
   * Get all backends that support a language
   */
  getBackendsForLanguage(language: LanguageCode): NLPBackend[];
}

// ============================================================================
// Backend Factory
// ============================================================================

/**
 * Factory for creating NLP backend instances
 */
export interface NLPBackendFactory {
  /**
   * Create a backend instance
   * @param backendType - Type of backend (e.g., 'mecab', 'spacy')
   * @param config - Backend-specific configuration
   */
  createBackend(
    backendType: string,
    config?: NLPBackendConfig
  ): Promise<NLPBackend>;
}

// ============================================================================
// Backend Configuration
// ============================================================================

/**
 * Configuration for an NLP backend
 */
export interface NLPBackendConfig {
  /** Backend type identifier */
  type: string;
  
  /** Backend-specific options */
  options?: Record<string, unknown>;
  
  /** Whether to auto-initialize on startup */
  autoInitialize?: boolean;
  
  /** Priority for backend selection (higher = preferred) */
  priority?: number;
  
  /** Timeout for operations in milliseconds */
  timeout?: number;
  
  /** Cache settings */
  cache?: {
    enabled: boolean;
    maxSize?: number;
    ttl?: number; // Time to live in milliseconds
  };
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error thrown by NLP backend
 */
export class NLPBackendError extends Error {
  constructor(
    public readonly backendId: string,
    public readonly language: LanguageCode,
    message: string,
    public readonly originalError?: Error
  ) {
    super(`[${backendId}] ${message}`);
    this.name = 'NLPBackendError';
  }
}

/**
 * Error thrown when backend is not available
 */
export class NLPBackendNotAvailableError extends NLPBackendError {
  constructor(backendId: string, language: LanguageCode) {
    super(backendId, language, `Backend not available for language: ${language}`);
    this.name = 'NLPBackendNotAvailableError';
  }
}

/**
 * Error thrown when backend is not initialized
 */
export class NLPBackendNotInitializedError extends NLPBackendError {
  constructor(backendId: string) {
    super(backendId, 'ja', 'Backend not initialized');
    this.name = 'NLPBackendNotInitializedError';
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a token is a translatable word
 * (not punctuation, symbols, or particles)
 */
export function isTranslatableToken(token: MorphToken, translatablePOS: string[]): boolean {
  return translatablePOS.includes(token.pos);
}

/**
 * Extract base forms from tokens
 */
export function extractBaseForms(tokens: MorphToken[]): string[] {
  return tokens.map(t => t.base);
}

/**
 * Extract surface forms from tokens
 */
export function extractSurfaceForms(tokens: MorphToken[]): string[] {
  return tokens.map(t => t.surface);
}

/**
 * Filter tokens by POS
 */
export function filterTokensByPOS(tokens: MorphToken[], pos: string[]): MorphToken[] {
  return tokens.filter(t => pos.includes(t.pos));
}

/**
 * Create a token from raw data
 */
export function createToken(
  surface: string,
  base: string,
  pos: string,
  options?: Partial<MorphToken>
): MorphToken {
  return {
    surface,
    base,
    pos,
    ...options,
  };
}
