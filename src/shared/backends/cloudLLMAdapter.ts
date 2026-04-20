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

class CloudLLMStatusError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'CloudLLMStatusError';
    this.status = status;
  }
}

/** OpenAI-format tool definition */
interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** OpenAI-format message */
interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

interface PartialCloudToolCallState {
  id: string;
  name: string;
  argumentsText: string;
  lastEmittedSignature: string | null;
}

type CloudToolCallDelta = NonNullable<NonNullable<NonNullable<CloudStreamEvent['choices']>[number]['delta']>['tool_calls']>[number];
type CloudToolCallDeltaList = NonNullable<NonNullable<NonNullable<CloudStreamEvent['choices']>[number]['delta']>['tool_calls']>;

/**
 * Convert provider-agnostic tool definitions to OpenAI format.
 */
function toOpenAITools(tools: LLMToolDefinition[]): OpenAITool[] {
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/**
 * Convert provider-agnostic chat messages to OpenAI format.
 * Transforms camelCase fields (toolCalls, toolName) to snake_case (tool_calls, tool_call_id).
 */
function toOpenAIMessages(messages: LLMChatMessage[]): OpenAIMessage[] {
  return messages.map(m => {
    const msg: OpenAIMessage = {
      role: m.role,
      content: m.content,
    };

    if (m.toolCalls && m.toolCalls.length > 0) {
      msg.tool_calls = m.toolCalls.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.name,
          arguments: typeof tc.arguments === 'string'
            ? tc.arguments as string
            : JSON.stringify(tc.arguments),
        },
      }));
    }

    if (m.role === 'tool' && m.toolName) {
      msg.tool_call_id = m.toolName;
    }

    return msg;
  });
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
   * Converts provider-agnostic types to OpenAI format before sending.
   */
  async streamChat(
    messages: LLMChatMessage[],
    tools: LLMToolDefinition[],
    callbacks: CloudLLMCallbacks,
  ): Promise<void> {
    this.abortController = new AbortController();
    const partialToolCalls = new Map<string, PartialCloudToolCallState>();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    const openAIMessages = toOpenAIMessages(messages);
    const openAITools = tools.length > 0 ? toOpenAITools(tools) : undefined;

    try {
      const res = await fetch(`${this.baseUrl}/api/llm/stream`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          messages: openAIMessages,
          tools: openAITools,
        }),
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
              const chunk = this.parseStreamEvent(parsed, partialToolCalls);
              callbacks.onChunk(chunk);

              if (chunk.done) {
                callbacks.onDone();
                return;
              }
            } catch (e) {
              console.error(e);
              // Skip malformed JSON
            }
          }
        }
      }

      // Stream ended without [DONE] marker
      callbacks.onChunk({ done: true });
      callbacks.onDone();
    } catch (err) {
      console.error(err);
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
      const res = await fetch(`${this.baseUrl}/api/health`, {
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.status === 401) {
        const errorText = await res.text();
        throw new CloudLLMStatusError(401, errorText || 'Unauthorized');
      }

      return res.ok;
    } catch (e) {
      if (e instanceof CloudLLMStatusError) {
        throw e;
      }

      console.error(e);
      return false;
    }
  }

  /**
   * Parse a single SSE data event into an LLMStreamChunk.
   * Supports OpenAI-compatible format.
   */
  private parseStreamEvent(
    event: CloudStreamEvent,
    partialToolCalls: Map<string, PartialCloudToolCallState>,
  ): LLMStreamChunk {
    const chunk: LLMStreamChunk = {};

    // OpenAI format: choices[0].delta.content
    const delta = event.choices?.[0]?.delta;
    if (delta) {
      if (delta.content) {
        chunk.content = delta.content;
      }

      if (delta.tool_calls) {
        const toolCalls = accumulateToolCallDeltas(delta.tool_calls, partialToolCalls);
        if (toolCalls.length > 0) {
          chunk.toolCalls = toolCalls;
        }
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
        index?: number;
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

function accumulateToolCallDeltas(
  toolCalls: CloudToolCallDeltaList,
  partialToolCalls: Map<string, PartialCloudToolCallState>,
): LLMToolCall[] {
  const emittedToolCalls: LLMToolCall[] = [];

  for (const [fallbackIndex, toolCall] of toolCalls.entries()) {
    const key = getToolCallKey(toolCall, fallbackIndex);
    const state = partialToolCalls.get(key) ?? {
      id: toolCall.id ?? '',
      name: toolCall.function?.name ?? '',
      argumentsText: '',
      lastEmittedSignature: null,
    };

    if (toolCall.id) {
      state.id = toolCall.id;
    }

    if (toolCall.function?.name) {
      state.name = toolCall.function.name;
    }

    if (typeof toolCall.function?.arguments === 'string') {
      state.argumentsText += toolCall.function.arguments;
    }

    partialToolCalls.set(key, state);

    const normalizedArguments = getNormalizedToolArguments(state, toolCall.function?.arguments);
    if (!state.name || !normalizedArguments) {
      continue;
    }

    const signature = `${state.name}:${JSON.stringify(normalizedArguments)}`;
    if (state.lastEmittedSignature === signature) {
      continue;
    }

    state.lastEmittedSignature = signature;
    emittedToolCalls.push({
      id: state.id || `cloud_tool_call_${key}`,
      name: state.name,
      arguments: normalizedArguments,
    });
  }

  return emittedToolCalls;
}

function getToolCallKey(
  toolCall: CloudToolCallDelta,
  fallbackIndex: number,
): string {
  if (typeof toolCall.index === 'number') {
    return `index:${toolCall.index}`;
  }

  if (toolCall.id) {
    return `id:${toolCall.id}`;
  }

  return `position:${fallbackIndex}`;
}

function getNormalizedToolArguments(
  state: PartialCloudToolCallState,
  latestArguments: string | Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  if (latestArguments && typeof latestArguments !== 'string') {
    return latestArguments;
  }

  return tryParseJSONRecord(state.argumentsText);
}

function tryParseJSONRecord(s: string): Record<string, unknown> | null {
  const trimmed = s.trim();
  if (!trimmed) {
    return {};
  }

  try {
    const parsed = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
