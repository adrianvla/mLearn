import { getLogger } from '../utils/logger';

const log = getLogger("shared.backends.cloudTTS");
/**
 * Cloud TTS Adapter
 *
 * Handles TTS via the BFF Worker's HATEOAS job flow.
 * Used by the renderer (mobile/desktop) when ttsProvider is 'cloud'.
 * The Electron main process uses its own Node.js http implementation in voiceService.ts.
 */

export interface CloudTTSCallbacks {
  onAudio: (audioData: ArrayBuffer, contentType: string) => void;
  onError: (error: string) => void;
  onDone: () => void;
}

/** BFF response for POST /api/tts/stream */
interface TTSStreamResponse {
  jobId: string;
  token: string;
  actions: {
    stream_url: string | null;
  };
}

/** BFF response for POST /api/tts/jobs */
interface TTSBatchResponse {
  jobId: string;
  actions: {
    listen_channel: string;
  };
}

export class CloudTTSAdapter {
  private readonly baseUrl: string;
  private readonly authToken: string;
  private abortController: AbortController | null = null;

  constructor(baseUrl: string, authToken: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.authToken = authToken;
  }

  /**
   * Stream TTS audio from the cloud.
   * 1. POST /api/tts/stream to get a Modal stream_url
   * 2. Fetch the stream_url to get audio chunks
   */
  async streamTTS(
    text: string,
    language: string,
    callbacks: CloudTTSCallbacks,
    provider?: string,
  ): Promise<void> {
    this.abortController = new AbortController();

    try {
      // Step 1: Get stream URL from BFF
      const res = await fetch(`${this.baseUrl}/api/tts/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.authToken}`,
        },
        body: JSON.stringify({ text, language, provider }),
        signal: this.abortController.signal,
      });

      if (!res.ok) {
        const errText = await res.text();
        callbacks.onError(`TTS stream setup failed: ${res.status} ${errText}`);
        return;
      }

      const response = (await res.json()) as TTSStreamResponse;
      const streamUrl = response.actions.stream_url;
      if (!streamUrl) {
        callbacks.onError('TTS stream: server returned no stream_url (endpoint may not be configured)');
        return;
      }

      // Step 2: Fetch audio from Modal stream endpoint
      const streamRes = await fetch(streamUrl, {
        method: 'GET',
        signal: this.abortController.signal,
      });

      if (!streamRes.ok) {
        const errText = await streamRes.text();
        callbacks.onError(`TTS audio stream failed: ${streamRes.status} ${errText}`);
        return;
      }

      const contentType = streamRes.headers.get('content-type') ?? 'audio/wav';
      const reader = streamRes.body?.getReader();
      if (!reader) {
        callbacks.onError('TTS stream: no response body');
        return;
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          callbacks.onAudio(value.buffer as ArrayBuffer, contentType);
        }
      }

      callbacks.onDone();
    } catch (err) {
      log.error("error", err);
      if ((err as Error).name === 'AbortError') {
        callbacks.onDone();
        return;
      }
      callbacks.onError((err as Error).message || 'TTS stream failed');
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Create a batch TTS job via the BFF's HATEOAS flow.
   * Returns the jobId so the caller can listen for completion via Realtime.
   */
  async createBatchJob(
    text: string,
    language: string,
    provider?: string,
  ): Promise<{ jobId: string; token: string }> {
    const res = await fetch(`${this.baseUrl}/api/tts/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.authToken}`,
      },
      body: JSON.stringify({ text, language, provider }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`TTS batch job creation failed: ${res.status} ${errText}`);
    }

    const response = (await res.json()) as TTSBatchResponse;
    return { jobId: response.jobId, token: '' };
  }

  /** Check if the cloud TTS endpoint is reachable */
  async checkAvailability(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${this.baseUrl}/api/health`, {
        headers: { 'Authorization': `Bearer ${this.authToken}` },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return res.ok;
    } catch (e) {
      log.error("error", e);
      return false;
    }
  }

  /** Abort the active stream */
  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
  }
}
