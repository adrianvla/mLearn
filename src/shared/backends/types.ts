/**
 * Backend Adapter Types
 *
 * Abstraction over the Python backend location (local, tethered, or cloud).
 * All backends speak the same HTTP protocol — only the URL and auth differ.
 */

import type { Token, TranslationResponse } from '../types';

export interface OCRResult {
  text: string;
  confidence: number;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface BackendAdapter {
  /** Tokenize text into language tokens */
  tokenize(text: string, language?: string): Promise<Token[]>;
  /** Translate/look up a word */
  translate(word: string, language?: string): Promise<TranslationResponse>;
  /** Run OCR on image data */
  ocr(imageData: string | Blob): Promise<OCRResult>;
  /** Get Anki-compatible card data */
  getCard(params: Record<string, unknown>): Promise<unknown>;
  /** Ping the backend to check if it's alive */
  ping(): Promise<boolean>;
  /** Get the base URL of the backend */
  getBaseUrl(): string;
  /** Build a full URL for an endpoint path */
  buildUrl(path: string): string;
}

/** Backend connection mode */
export type BackendMode = 'local' | 'tethered';
