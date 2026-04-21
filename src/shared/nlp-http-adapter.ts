/**
 * NLP HTTP Adapter
 * 
 * Bridges TypeScript NLP backends with Python backend endpoints.
 * Provides HTTP client for calling the NLP backend routes.
 * 
 * Used by MeCab and spaCy backends to delegate actual tokenization
 * to the Python backend via HTTP.
 */

import type { LanguageCode } from './language-abstraction';
import type { MorphToken, TokenizationResult } from './nlp-backend-abstraction';
import { NLPBackendError } from './nlp-backend-abstraction';

// ============================================================================
// HTTP Response Types
// ============================================================================

interface MorphTokenResponse {
  surface: string;
  base: string;
  pos: string;
  posTags?: string[];
  reading?: string;
  pitchAccent?: number;
  inflection?: string;
  conjugation?: string;
  features?: Record<string, string>;
}

interface TokenizationResultResponse {
  text: string;
  language: LanguageCode;
  tokens: MorphTokenResponse[];
  processingTime?: number;
  confidence?: number;
}

// ============================================================================
// NLP HTTP Adapter
// ============================================================================

/**
 * HTTP adapter for NLP backend endpoints
 * 
 * Provides methods to call Python backend NLP endpoints.
 * Handles error handling, timeouts, and response parsing.
 */
export class NLPHttpAdapter {
  private baseUrl: string;
  private timeout: number;

  constructor(baseUrl: string = 'http://127.0.0.1:7752', timeout: number = 5000) {
    this.baseUrl = baseUrl;
    this.timeout = timeout;
  }

  /**
   * Make HTTP request with timeout
   */
  private async fetchWithTimeout(
    url: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Tokenize text
   */
  async tokenize(
    text: string,
    language: LanguageCode
  ): Promise<TokenizationResult> {
    const url = `${this.baseUrl}/nlp/backends/tokenize`;

    try {
      const response = await this.fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, language }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as TokenizationResultResponse;
      return this.convertTokenizationResult(data);
    } catch (error) {
      throw new NLPBackendError(
        'http-adapter',
        language,
        `Tokenization failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Batch tokenize multiple texts
   */
  async tokenizeBatch(
    texts: string[],
    language: LanguageCode
  ): Promise<TokenizationResult[]> {
    const url = `${this.baseUrl}/nlp/backends/tokenize-batch`;

    try {
      const response = await this.fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts, language }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as TokenizationResultResponse[];
      return data.map(d => this.convertTokenizationResult(d));
    } catch (error) {
      throw new NLPBackendError(
        'http-adapter',
        language,
        `Batch tokenization failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get lemma for a word
   */
  async getLemma(word: string, language: LanguageCode): Promise<string> {
    const url = `${this.baseUrl}/nlp/backends/lemma`;

    try {
      const response = await this.fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word, language }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as { lemma: string };
      return data.lemma;
    } catch (error) {
      throw new NLPBackendError(
        'http-adapter',
        language,
        `Lemma lookup failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get reading for a word
   */
  async getReading(word: string, language: LanguageCode): Promise<string | undefined> {
    const url = `${this.baseUrl}/nlp/backends/reading`;

    try {
      const response = await this.fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word, language }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as { reading: string | null };
      return data.reading || undefined;
    } catch (error) {
      throw new NLPBackendError(
        'http-adapter',
        language,
        `Reading lookup failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get pitch accent for a word
   */
  async getPitchAccent(word: string, language: LanguageCode): Promise<number | undefined> {
    const url = `${this.baseUrl}/nlp/backends/pitch-accent`;

    try {
      const response = await this.fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word, language }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as { pitchAccent: number | null };
      return data.pitchAccent || undefined;
    } catch (error) {
      throw new NLPBackendError(
        'http-adapter',
        language,
        `Pitch accent lookup failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Convert HTTP response to TokenizationResult
   */
  private convertTokenizationResult(data: TokenizationResultResponse): TokenizationResult {
    return {
      text: data.text,
      language: data.language,
      tokens: data.tokens.map(t => this.convertToken(t)),
      processingTime: data.processingTime,
      confidence: data.confidence,
    };
  }

  /**
   * Convert HTTP token response to MorphToken
   */
  private convertToken(data: MorphTokenResponse): MorphToken {
    return {
      surface: data.surface,
      base: data.base,
      pos: data.pos,
      posTags: data.posTags,
      reading: data.reading,
      pitchAccent: data.pitchAccent,
      inflection: data.inflection,
      conjugation: data.conjugation,
      features: data.features,
    };
  }
}

// ============================================================================
// Global HTTP Adapter Singleton
// ============================================================================

let globalHttpAdapter: NLPHttpAdapter | null = null;

/**
 * Get the global NLP HTTP adapter
 */
export function getNLPHttpAdapter(
  baseUrl?: string,
  timeout?: number
): NLPHttpAdapter {
  if (!globalHttpAdapter) {
    globalHttpAdapter = new NLPHttpAdapter(baseUrl, timeout);
  }
  return globalHttpAdapter;
}

/**
 * Reset the global HTTP adapter (for testing)
 */
export function resetNLPHttpAdapter(): void {
  globalHttpAdapter = null;
}
