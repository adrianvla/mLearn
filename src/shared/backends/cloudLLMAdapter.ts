/**
 * Cloud LLM Adapter
 *
 * Streams chat completions from a remote cloud endpoint using SSE / fetch streaming.
 * Compatible with OpenAI-style streaming API format.
 */

import type { LLMChatMessage, LLMToolDefinition, LLMStreamChunk, LLMToolCall } from '../types';

export interface CloudLLMCallbacks {
  onChunk: (chunk: LLMStreamChunk) => void;
  onDone: () => void;
  onError: (error: string) => void;
}

export class CloudLLMAdapter {
  private readonly baseUrl: string;
  private readonly authToken: string;
  private abortController: AbortController | null = null;

  constructor(baseUrl: string, authToken: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.authToken = authToken;
  }

  /**
   * Stream a chat completion from the cloud endpoint.
   * Expects an OpenAI-compatible streaming API at `<baseUrl>/llm/stream`.
   */
  async streamChat(
    messages: LLMChatMessage[],
    tools: LLMToolDefinition[],
    callbacks: CloudLLMCallbacks,
  ): Promise<void> {
    this.abortController = new AbortController();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    try {
      const res = await fetch(`${this.baseUrl}/llm/stream`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ messages, tools }),
        signal: this.abortController.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        callbacks.onError(`Cloud LLM error: ${res.status} ${text}`);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        callbacks.onError('Cloud LLM: no response body');
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;

          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);
            if (data === '[DONE]') {
              callbacks.onChunk({ done: true });
              callbacks.onDone();
              return;
            }

            try {
              const parsed = JSON.parse(data) as CloudStreamEvent;
              const chunk = this.parseStreamEvent(parsed);
              callbacks.onChunk(chunk);

              if (chunk.done) {
                callbacks.onDone();
                return;
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }

      // Stream ended without [DONE] marker
      callbacks.onChunk({ done: true });
      callbacks.onDone();
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        callbacks.onChunk({ done: true });
        callbacks.onDone();
        return;
      }
      callbacks.onError((err as Error).message || 'Cloud LLM stream failed');
    } finally {
      this.abortController = null;
    }
  }

  /** Abort the active stream */
  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  /** Check if the cloud endpoint is reachable */
  async checkAvailability(): Promise<boolean> {
    try {
      const headers: Record<string, string> = {};
      if (this.authToken) {
        headers['Authorization'] = `Bearer ${this.authToken}`;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${this.baseUrl}/health`, {
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Parse a single SSE data event into an LLMStreamChunk.
   * Supports OpenAI-compatible format.
   */
  private parseStreamEvent(event: CloudStreamEvent): LLMStreamChunk {
    const chunk: LLMStreamChunk = {};

    // OpenAI format: choices[0].delta.content
    const delta = event.choices?.[0]?.delta;
    if (delta) {
      if (delta.content) {
        chunk.content = delta.content;
      }

      if (delta.tool_calls) {
        chunk.toolCalls = delta.tool_calls.map((tc): LLMToolCall => ({
          id: tc.id || '',
          name: tc.function?.name || '',
          arguments: tc.function?.arguments
            ? (typeof tc.function.arguments === 'string'
                ? safeParseJSON(tc.function.arguments)
                : tc.function.arguments)
            : {},
        }));
      }
    }

    // Direct mLearn format (content/done/toolCalls at top level)
    if (event.content) chunk.content = event.content;
    if (event.done) chunk.done = true;
    if (event.error) chunk.error = event.error;

    // Stats from final chunk
    if (event.eval_count) chunk.evalCount = event.eval_count;
    if (event.eval_duration) chunk.evalDuration = event.eval_duration;

    // Check finish_reason
    if (event.choices?.[0]?.finish_reason) {
      chunk.done = true;
    }

    return chunk;
  }
}

// ============================================================================
// Internal types for SSE parsing
// ============================================================================

interface CloudStreamEvent {
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: Array<{
        id?: string;
        function?: {
          name?: string;
          arguments?: string | Record<string, unknown>;
        };
      }>;
    };
    finish_reason?: string | null;
  }>;
  // Direct mLearn format fields
  content?: string;
  done?: boolean;
  error?: string;
  eval_count?: number;
  eval_duration?: number;
}

function safeParseJSON(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
