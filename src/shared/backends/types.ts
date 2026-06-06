/**
 * Backend Adapter Types
 *
 * Capability-oriented contract for local or tethered backend work. HTTP is one
 * transport implementation, not part of the shared renderer-facing contract.
 */

import type { Token, TranslationResponse } from '../types';

export interface OCRResult {
  text?: string;
  confidence?: number;
  boxes?: Array<{
    box?: number[][];
    text: string;
    score?: number;
    is_vertical?: boolean;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    confidence?: number;
  }>;
  processing_times?: {
    total_ms: number;
    detection_ms?: number;
    detection_engine?: string;
    recognition_ms?: number;
    recognition_engine?: string;
    per_box_ms?: number[];
  };
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  client_scale?: number;
  downscale_factor?: number;
  original_size?: { width: number; height: number };
  sent_size?: { width: number; height: number };
}

export interface OCRRequestOptions {
  turbo?: boolean;
  ramSaver?: boolean;
  devMode?: boolean;
  paddleMaxWidth?: number;
  paddleMaxHeight?: number;
}

export interface OCRWarmupResult {
  status: 'disabled' | 'already_done' | 'in_progress' | 'started' | string;
}

export interface AnkiWordStatusRecord {
  word: string;
  cardId?: number | null;
  factor?: number | null;
  due?: number | null;
  queue?: number | null;
  type?: number | null;
  interval?: number | null;
  mod?: number | null;
}

export interface BackendAdapter {
  /** Tokenize text into language tokens */
  tokenize(text: string, language?: string): Promise<Token[]>;
  /** Translate/look up a word */
  translate(word: string, language?: string): Promise<TranslationResponse>;
  /** Run OCR on image data */
  ocr(imageData: string | Blob, options?: OCRRequestOptions): Promise<OCRResult>;
  /** Warm up local OCR models when supported */
  warmupOcr(): Promise<OCRWarmupResult>;
  /** Get Anki-compatible card data */
  getCard(params: Record<string, unknown>): Promise<unknown>;
  /** Get the list of all expression values from the Anki cache */
  getAnkiWords(): Promise<string[]>;
  /** Get cached Anki scheduling metadata keyed by expression value */
  getAnkiWordStatuses(): Promise<AnkiWordStatusRecord[]>;
  /** Ping the backend to check if it's alive */
  ping(): Promise<boolean>;
}

/** Backend connection mode */
export type BackendMode = 'local' | 'tethered';
