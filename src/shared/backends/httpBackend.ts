/**
 * HTTP Backend Adapter
 *
 * Single implementation that works for both backend modes:
 * - `local`    → http://127.0.0.1:7752  (desktop, Python running locally)
 * - `tethered` → http://<host-ip>:7752  (mobile connecting to desktop)
 */

import type { Token, TranslationResponse } from '../types';
import type { AnkiWordStatusRecord, BackendAdapter, OCRResult } from './types';

export interface HttpBackendOptions {
  /** Bearer token for auth (optional) */
  authToken?: string;
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
  private readonly authToken?: string;

  constructor(baseUrl: string, options?: HttpBackendOptions) {
    // Strip trailing slash
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.authToken = options?.authToken;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  buildUrl(path: string): string {
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${this.baseUrl}${p}`;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { ...extra };
    if (this.authToken) {
      h['Authorization'] = `Bearer ${this.authToken}`;
    }
    return h;
  }

  async tokenize(text: string, language?: string): Promise<Token[]> {
    const body: Record<string, string> = { text };
    if (language) body.language = language;

    const res = await fetch(this.buildUrl('/tokenize'), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) throw new Error(`Tokenization failed: ${res.status}`);
    const data = await res.json() as Record<string, unknown>;
    return ((data.tokens || data) as unknown) as Token[];
  }

  async translate(word: string, language?: string): Promise<TranslationResponse> {
    const body: Record<string, string> = { word };
    if (language) body.language = language;

    const res = await fetch(this.buildUrl('/translate'), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) throw new Error(`Translation request failed: ${res.status}`);
    return (await res.json()) as TranslationResponse;
  }

  async ocr(imageData: string | Blob): Promise<OCRResult> {
    const form = new FormData();

    if (typeof imageData === 'string') {
      // Data URL or base64 — convert to blob
      const response = await fetch(imageData);
      const blob = await response.blob();
      form.append('file', blob, 'image.png');
    } else {
      form.append('file', imageData, 'image.png');
    }

    const res = await fetch(this.buildUrl('/ocr'), {
      method: 'POST',
      headers: this.headers(),
      body: form,
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`OCR request failed: ${res.status} - ${errorText}`);
    }

    return (await res.json()) as OCRResult;
  }

  async getCard(params: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(this.buildUrl('/getCard'), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) throw new Error(`getCard failed: ${res.status}`);
    return res.json();
  }

  private async getAnkiWordsPayload(): Promise<{ words?: string[]; cards?: AnkiWordStatusRecord[] }> {
    const res = await fetch(this.buildUrl('/ankiWords'), {
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

  async ping(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(this.buildUrl('/control'), {
        method: 'GET',
        headers: this.headers(),
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

      console.error(e);
      return false;
    }
  }
}
