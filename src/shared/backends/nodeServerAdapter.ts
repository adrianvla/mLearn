/**
 * Node Server Adapter
 *
 * Client-side wrapper for the Electron web server on port 7753.
 * Used by mobile tethered mode to sync settings, flashcards,
 * localization, and lang data with the desktop host.
 */

import type { Settings } from '../types';
import type { FlashcardStore } from '../types';
import { PROXY_SERVER_PORT } from '../constants';
import { getLogger } from '../utils/logger';

const log = getLogger("shared.backends.nodeServer");

export interface NodeServerAdapter {
  /** Base URL of the node server (e.g. http://192.168.1.10:7753) */
  getBaseUrl(): string;

  // Settings sync
  getSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<void>;

  // Flashcard sync
  getFlashcards(): Promise<FlashcardStore>;
  saveFlashcards(store: FlashcardStore): Promise<void>;

  // Localization
  getLocalization(lang: string): Promise<Record<string, unknown>>;

  // Language data
  getLangData(lang?: string): Promise<Record<string, unknown>>;

  // Health check
  ping(): Promise<boolean>;
}

export class HttpNodeServerAdapter implements NodeServerAdapter {
  private readonly baseUrl: string;
  private readonly authToken?: string;

  constructor(baseUrl: string, options?: { authToken?: string }) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.authToken = options?.authToken;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  private buildUrl(path: string): string {
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${this.baseUrl}${p}`;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { ...extra };
    if (this.authToken) {
      h['X-Auth-Token'] = this.authToken;
    }
    return h;
  }

  async getSettings(): Promise<Settings> {
    const res = await fetch(this.buildUrl('/api/settings'), { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to get settings: ${res.status}`);
    return await res.json() as Settings;
  }

  async saveSettings(settings: Settings): Promise<void> {
    const res = await fetch(this.buildUrl('/api/settings'), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(settings),
    });
    if (!res.ok) throw new Error(`Failed to save settings: ${res.status}`);
  }

  async getFlashcards(): Promise<FlashcardStore> {
    const res = await fetch(this.buildUrl('/api/flashcards'), { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to get flashcards: ${res.status}`);
    return await res.json() as FlashcardStore;
  }

  async saveFlashcards(store: FlashcardStore): Promise<void> {
    const res = await fetch(this.buildUrl('/api/flashcards'), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(store),
    });
    if (!res.ok) throw new Error(`Failed to save flashcards: ${res.status}`);
  }

  async getLocalization(lang: string): Promise<Record<string, unknown>> {
    const res = await fetch(this.buildUrl(`/api/localization/${encodeURIComponent(lang)}`), { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to get localization: ${res.status}`);
    return await res.json() as Record<string, unknown>;
  }

  async getLangData(lang?: string): Promise<Record<string, unknown>> {
    const path = lang ? `/api/lang-data/${encodeURIComponent(lang)}` : '/api/lang-data';
    const res = await fetch(this.buildUrl(path), { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to get lang data: ${res.status}`);
    return await res.json() as Record<string, unknown>;
  }

  async ping(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(this.buildUrl('/api/ping'), {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return res.ok;
    } catch (e) {
      log.error("error", e);
      return false;
    }
  }
}

let cached: NodeServerAdapter | null = null;

export function getNodeServer(baseUrl?: string, options?: { authToken?: string }): NodeServerAdapter {
  const url = baseUrl || `http://127.0.0.1:${PROXY_SERVER_PORT}`;
  if (cached && (cached as HttpNodeServerAdapter).getBaseUrl() === url) return cached;
  cached = new HttpNodeServerAdapter(url, options);
  return cached;
}

export function resetNodeServer(): void {
  cached = null;
}
