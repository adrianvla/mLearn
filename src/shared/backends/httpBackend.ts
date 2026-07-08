/**
 * HTTP Backend Adapter
 *
 * Single implementation that works for both backend modes:
 * - `local`    → http://127.0.0.1:7752  (desktop, Python running locally)
 * - `tethered` → http://<host-ip>:7752  (mobile connecting to desktop)
 */

import type { Token, TranslationResponse } from '../types';
import { API_PATHS } from '../constants';
import type {
  AnkiWordStatusRecord,
  BackendAdapter,
  OCRRequestOptions,
  OCRResult,
  OCRWarmupResult,
  TranslateRequestOptions,
} from './types';
import { getLogger } from '../utils/logger';

const log = getLogger("shared.backends.http");
const DEFAULT_OCR_TIMEOUT_MS = 120_000;

export interface HttpBackendOptions {
  /** Bearer token for auth (optional) */
  authToken?: string;
  /** Base URL for the Electron Node server that owns Anki cache/index routes. */
  ankiBaseUrl?: string;
}

class HttpBackendStatusError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpBackendStatusError';
    this.status = status;
  }
}

export class HttpBackend implements BackendAdapter {
  private readonly baseUrl: string;
  private readonly ankiBaseUrl: string;
  private readonly authToken?: string;

  constructor(baseUrl: string, options?: HttpBackendOptions) {
    // Strip trailing slash
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.ankiBaseUrl = (options?.ankiBaseUrl || this.baseUrl).replace(/\/+$/, '');
    this.authToken = options?.authToken;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getAnkiBaseUrl(): string {
    return this.ankiBaseUrl;
  }

  private buildUrl(path: string): string {
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${this.baseUrl}${p}`;
  }

  private buildAnkiUrl(path: string): string {
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${this.ankiBaseUrl}${p}`;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { ...extra };
    if (this.authToken) {
      h['Authorization'] = `Bearer ${this.authToken}`;
    }
    return h;
  }

  /**
   * Throw a structured error for non-ok responses so callers can detect
   * auth failures (401) vs other server errors.
   */
  private async throwOnError(res: Response, label: string): Promise<void> {
    if (res.ok) return;
    const text = await res.text().catch(() => '');
    throw new HttpBackendStatusError(res.status, `${label} failed: ${res.status}${text ? ` - ${text}` : ''}`);
  }

  async tokenize(text: string, language?: string): Promise<Token[]> {
    const body: Record<string, string> = { text };
    if (language) body.language = language;

    const res = await fetch(this.buildUrl(API_PATHS.tokenize), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    await this.throwOnError(res, 'Tokenization');
    const data = await res.json() as Record<string, unknown>;
    return ((data.tokens || data) as unknown) as Token[];
  }

  async translate(word: string, language?: string, options?: TranslateRequestOptions): Promise<TranslationResponse> {
    const body: Record<string, string> = { word };
    if (language) body.language = language;
    if (options?.dictionaryTargetLanguage) {
      body.dictionaryTargetLanguage = options.dictionaryTargetLanguage;
    }

    const res = await fetch(this.buildUrl(API_PATHS.translate), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    await this.throwOnError(res, 'Translation request');
    return (await res.json()) as TranslationResponse;
  }

  async ocr(imageData: string | Blob, options?: OCRRequestOptions): Promise<OCRResult> {
    const form = new FormData();

    if (typeof imageData === 'string') {
      // Data URL or base64 — convert to blob
      const response = await fetch(imageData);
      const blob = await response.blob();
      form.append('file', blob, 'image.png');
    } else {
      form.append('file', imageData, 'image.png');
    }

    if (options?.language) {
      form.append('language', options.language);
    }
    if (options?.turbo !== undefined) {
      form.append('turbo', options.turbo ? '1' : '0');
    }
    if (options?.ramSaver !== undefined) {
      form.append('ram_saver', options.ramSaver ? '1' : '0');
    }
    if (options?.devMode !== undefined) {
      form.append('dev_mode', options.devMode ? '1' : '0');
    }
    if (options?.detectionMaxWidth !== undefined) {
      form.append('detection_max_width', String(options.detectionMaxWidth));
    }
    if (options?.detectionMaxHeight !== undefined) {
      form.append('detection_max_height', String(options.detectionMaxHeight));
    }

    const res = await fetch(this.buildUrl(API_PATHS.ocr), {
      method: 'POST',
      headers: this.headers(),
      body: form,
      signal: AbortSignal.timeout(options?.timeoutMs ?? DEFAULT_OCR_TIMEOUT_MS),
    });

    await this.throwOnError(res, 'OCR request');
    return (await res.json()) as OCRResult;
  }

  async warmupOcr(language?: string): Promise<OCRWarmupResult> {
    const warmupUrl = this.buildUrl(API_PATHS.ocrWarmup);
    const url = language
      ? `${warmupUrl}${warmupUrl.includes('?') ? '&' : '?'}language=${encodeURIComponent(language)}`
      : warmupUrl;

    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      signal: AbortSignal.timeout(30_000),
    });

    await this.throwOnError(res, 'OCR warmup');
    return (await res.json()) as OCRWarmupResult;
  }

  async getCard(params: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(this.buildAnkiUrl(API_PATHS.ankiCard), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(10_000),
    });

    await this.throwOnError(res, 'getCard');
    return res.json();
  }

  private async getAnkiWordsPayload(): Promise<{ words?: string[]; cards?: AnkiWordStatusRecord[] }> {
    const res = await fetch(this.buildAnkiUrl(API_PATHS.ankiWords), {
      method: 'GET',
      headers: this.headers(),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return {};
    }

    return res.json() as Promise<{ words?: string[]; cards?: AnkiWordStatusRecord[] }>;
  }

  async getAnkiWords(): Promise<string[]> {
    const data = await this.getAnkiWordsPayload();
    return data.words || [];
  }

  async getAnkiWordStatuses(): Promise<AnkiWordStatusRecord[]> {
    const data = await this.getAnkiWordsPayload();
    return data.cards || [];
  }

  async reloadAnkiCache(): Promise<boolean> {
    const res = await fetch(this.buildAnkiUrl(API_PATHS.ankiReload), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      signal: AbortSignal.timeout(30_000),
    });

    return res.ok;
  }

  async ping(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(this.buildUrl(API_PATHS.control), {
        method: 'POST',
        headers: this.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ function: 'ping' }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.status === 401) {
        const errorText = await res.text();
        throw new HttpBackendStatusError(401, errorText || 'Unauthorized');
      }

      return res.ok;
    } catch (e) {
      if (e instanceof HttpBackendStatusError) {
        throw e;
      }

      log.error("error", e);
      return false;
    }
  }
}
