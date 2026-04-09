/**
 * Unified LLM Provider Service
 * Single abstraction for all LLM interactions (Explainer + Conversation Agent).
 * Routes to built-in (node-llama-cpp) or Ollama based on user settings.
 */

import type { LLMChatMessage, LLMToolDefinition, LLMStreamChunk, LLMToolCall, Settings } from '../../shared/types';
import { getBridge } from '../../shared/bridges';
import { isMobile } from '../../shared/platform';
import { CloudLLMAdapter } from '../../shared/backends/cloudLLMAdapter';
import { resolveCloudApiUrl } from '../../shared/backends';
import { ensureCloudAccessToken, getCloudSessionSettings, handleCloudSessionError } from './cloudSessionManager';

// ============================================================================
// Types
// ============================================================================

export interface LLMStreamCallbacks {
  onChunk: (content: string, accumulated: string) => void;
  onToolCall: (toolCall: LLMToolCall) => void;
  onDone: (finalContent: string, allToolCalls: LLMToolCall[], stats?: LLMStreamStats) => void;
  onError: (error: string) => void;
}

export interface LLMStreamStats {
  timeToFirstToken: number;
  totalTime: number;
  tokensPerSecond: number;
}

// ============================================================================
// Explanation cache
// ============================================================================

interface CacheEntry {
  toolCalls: LLMToolCall[];
  rawText: string;
  timestamp: number;
}

const explanationCache = new Map<string, CacheEntry>();
const CACHE_MAX = 500;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getCacheKey(word: string, context: string): string {
  const normalized = context.substring(0, 100).toLowerCase().trim();
  return `${word}|||${normalized}`;
}

export function getCachedExplanation(word: string, context: string): CacheEntry | null {
  const key = getCacheKey(word, context);
  const entry = explanationCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    explanationCache.delete(key);
    return null;
  }
  return entry;
}

function setCachedExplanation(word: string, context: string, toolCalls: LLMToolCall[], rawText: string): void {
  const key = getCacheKey(word, context);
  if (explanationCache.size >= CACHE_MAX) {
    // Remove oldest 10%
    const entries = Array.from(explanationCache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toRemove = Math.ceil(CACHE_MAX * 0.1);
    for (let i = 0; i < toRemove; i++) {
      explanationCache.delete(entries[i][0]);
    }
  }
  explanationCache.set(key, { toolCalls, rawText, timestamp: Date.now() });
}

// ============================================================================
// Stream management
// ============================================================================

let activeCleanup: (() => void) | null = null;

/**
 * Stream a chat completion through the unified LLM backend.
 * On desktop: routes through IPC bridge to Electron main process.
 * On mobile: streams directly via CloudLLMAdapter to cloud or tethered endpoint.
 */
export function streamChat(
  messages: LLMChatMessage[],
  tools: LLMToolDefinition[],
  callbacks: LLMStreamCallbacks,
  settings?: Settings,
): { abort: () => void } {
  const activeSettings = settings ?? getCloudSessionSettings() ?? undefined;

  // Mobile: stream directly via HTTP (no IPC bridge)
  if (isMobile() && activeSettings) {
    return streamChatMobile(messages, tools, callbacks, activeSettings);
  }

  const bridge = getBridge();

  let accumulated = '';
  const collectedToolCalls: LLMToolCall[] = [];
  const startTime = Date.now();
  let firstTokenTime = 0;
  let cleanup: (() => void) | null = null;
  let aborted = false;

  function cleanupListener() {
    cleanup?.();
    cleanup = null;
    if (activeCleanup === cleanupListener) activeCleanup = null;
  }

  const startStream = () => {
    if (aborted) {
      return;
    }

    cleanup = bridge.llm.onLLMStreamChunk((chunk: LLMStreamChunk) => {
      if (chunk.error) {
        if (activeSettings?.llmProvider === 'cloud') {
          handleCloudSessionError(chunk.error);
        }
        callbacks.onError(chunk.error);
        cleanupListener();
        return;
      }

      if (chunk.content) {
        if (!firstTokenTime) firstTokenTime = Date.now();
        accumulated += chunk.content;
        callbacks.onChunk(chunk.content, accumulated);
      }

      if (chunk.toolCalls) {
        for (const tc of chunk.toolCalls) {
          collectedToolCalls.push(tc);
          callbacks.onToolCall(tc);
        }
      }

      if (chunk.done) {
        const totalTime = Date.now() - startTime;
        const ttft = firstTokenTime ? firstTokenTime - startTime : 0;

        let tokensPerSecond = 0;
        if (chunk.evalCount && chunk.evalDuration) {
          tokensPerSecond = chunk.evalCount / (chunk.evalDuration / 1_000_000_000);
        } else if (chunk.evalCount && totalTime > 0) {
          tokensPerSecond = chunk.evalCount / (totalTime / 1000);
        }

        const stats: LLMStreamStats = {
          timeToFirstToken: ttft,
          totalTime,
          tokensPerSecond,
        };

        callbacks.onDone(accumulated, collectedToolCalls, stats);
        cleanupListener();
      }
    });

    activeCleanup = cleanupListener;

    if (activeSettings?.devMode) {
      console.log('[LLMProvider] Prompt sent to LLM:', JSON.stringify(messages, null, 2));
    }
    bridge.llm.llmStream(messages, tools);
  };

  if (activeSettings?.llmProvider === 'cloud') {
    void ensureCloudAccessToken().then((accessToken) => {
      if (!accessToken) {
        if (!aborted) {
          callbacks.onError('Cloud session expired. Please sign in again.');
        }
        return;
      }

      startStream();
    }).catch((error) => {
      console.error(error);
      if (!aborted) {
        callbacks.onError((error as Error).message || 'Unable to refresh cloud session');
      }
    });
  } else {
    startStream();
  }

  return {
    abort: () => {
      aborted = true;
      bridge.llm.llmStreamAbort();
      cleanupListener();
    },
  };
}

/**
 * Abort any active LLM stream
 */
export function abortStream(): void {
  getBridge().llm.llmStreamAbort();
  if (activeCleanup) {
    activeCleanup();
    activeCleanup = null;
  }
}

// ============================================================================
// Mobile streaming (direct HTTP, no IPC)
// ============================================================================

let mobileCloudAdapter: CloudLLMAdapter | null = null;

function streamChatMobile(
  messages: LLMChatMessage[],
  tools: LLMToolDefinition[],
  callbacks: LLMStreamCallbacks,
  settings: Settings,
): { abort: () => void } {
  const startTime = Date.now();
  let accumulated = '';
  let firstTokenTime = 0;
  const collectedToolCalls: LLMToolCall[] = [];
  let aborted = false;

  // Determine the cloud URL: tethered via desktop's forwarding endpoint
  let url: string;

  if (settings.backendMode === 'tethered' && settings.backendUrl) {
    // Tethered: forward through the desktop's web server
    url = settings.backendUrl.replace(/\/+$/, '');
  } else {
    callbacks.onError('No LLM endpoint configured for mobile');
    return { abort: () => {} };
  }

  void ensureCloudAccessToken().then((token) => {
    if (aborted) {
      return;
    }

    if (!token) {
      callbacks.onError('Cloud session expired. Please sign in again.');
      return;
    }

    mobileCloudAdapter = new CloudLLMAdapter(url, token);

    mobileCloudAdapter.streamChat(messages, tools, {
      onChunk: (chunk) => {
        if (chunk.error) {
          handleCloudSessionError(chunk.error);
          callbacks.onError(chunk.error);
          return;
        }
        if (chunk.content) {
          if (!firstTokenTime) firstTokenTime = Date.now();
          accumulated += chunk.content;
          callbacks.onChunk(chunk.content, accumulated);
        }
        if (chunk.toolCalls) {
          for (const tc of chunk.toolCalls) {
            collectedToolCalls.push(tc);
            callbacks.onToolCall(tc);
          }
        }
      },
      onDone: () => {
        const totalTime = Date.now() - startTime;
        const ttft = firstTokenTime ? firstTokenTime - startTime : 0;
        const stats: LLMStreamStats = { timeToFirstToken: ttft, totalTime, tokensPerSecond: 0 };
        callbacks.onDone(accumulated, collectedToolCalls, stats);
      },
      onError: (error) => {
        handleCloudSessionError(error);
        callbacks.onError(error);
      },
    });
  }).catch((error) => {
    console.error(error);
    callbacks.onError((error as Error).message || 'Unable to refresh cloud session');
  });

  return {
    abort: () => {
      aborted = true;
      mobileCloudAdapter?.abort();
      mobileCloudAdapter = null;
    },
  };
}

// ============================================================================
// Availability checks
// ============================================================================

/**
 * Check if the LLM is ready to use (provider-specific checks)
 */
export async function checkAvailability(settings: Settings): Promise<{ available: boolean; reason?: string }> {
  const bridge = getBridge();

  if (!settings.llmConfigured) {
    return { available: false, reason: 'not_configured' };
  }

  if (settings.llmProvider === 'cloud') {
    const accessToken = await ensureCloudAccessToken();
    if (!accessToken) {
      return { available: false, reason: 'cloud_unreachable' };
    }

    const cloudApiUrl = resolveCloudApiUrl(settings);
    const adapter = new CloudLLMAdapter(
      cloudApiUrl,
      accessToken,
    );
    try {
      const reachable = await adapter.checkAvailability();
      return reachable
        ? { available: true }
        : { available: false, reason: 'cloud_unreachable' };
    } catch (error) {
      console.error(error);
      handleCloudSessionError(error, false);
      return { available: false, reason: 'cloud_unreachable' };
    }
  }

  if (settings.llmProvider === 'ollama') {
    try {
      const connected = await bridge.llm.ollamaCheck();
      if (!connected) {
        return { available: false, reason: 'ollama_unreachable' };
      }
      return { available: true };
    } catch (e) {
      console.error(e);
      return { available: false, reason: 'ollama_unreachable' };
    }
  }

  // Built-in: check if model is downloaded
  try {
    const status = await bridge.llm.llmCheckModel();
    if (!status.downloaded) {
      return { available: false, reason: 'model_not_downloaded' };
    }
    return { available: true };
  } catch (e) {
    console.error(e);
    return { available: false, reason: 'model_check_failed' };
  }
}

/**
 * Check if setup is required (llmConfigured is false)
 */
export function requiresSetup(settings: Settings): boolean {
  return !settings.llmConfigured;
}

// ============================================================================
// Explainer helpers
// ============================================================================

/**
 * Stream a word explanation using tool calls.
 * The LLM is instructed to use only tool calls (show_translation, show_explanation, show_grammar_points).
 */
export function streamExplanation(
  word: string,
  contextPhrase: string,
  language: string,
  callbacks: LLMStreamCallbacks,
): { abort: () => void } {
  const systemPrompt = buildExplainerSystemPrompt(language);
  const userPrompt = buildExplainerUserPrompt(word, contextPhrase);

  const messages: LLMChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const tools = getExplainerTools();

  // Wrap callbacks to cache the result
  const wrappedCallbacks: LLMStreamCallbacks = {
    ...callbacks,
    onDone: (finalContent, allToolCalls, stats) => {
      setCachedExplanation(word, contextPhrase, allToolCalls, finalContent);
      callbacks.onDone(finalContent, allToolCalls, stats);
    },
  };

  return streamChat(messages, tools, wrappedCallbacks);
}

// ============================================================================
// Explainer prompt & tools
// ============================================================================

function buildExplainerSystemPrompt(language: string): string {
  return `You are a language learning assistant that explains words and phrases in ${language}.

IMPORTANT: You MUST use ONLY the provided tool calls to structure your response. Do NOT write any raw text.
Use these tools in order:
1. show_translation — Provide the full sentence/phrase translation
2. show_explanation — Explain the target word's meaning and usage in context
3. show_grammar_points — List relevant grammar points found in the phrase

Call each tool exactly once. Do not output any text outside of tool calls.`;
}

function buildExplainerUserPrompt(word: string, contextPhrase: string): string {
  return `Explain the word "${word}" in the context of this phrase: "${contextPhrase}"`;
}

function getExplainerTools(): LLMToolDefinition[] {
  return [
    {
      name: 'show_translation',
      description: 'Display the translation of the full phrase/sentence.',
      parameters: {
        type: 'object',
        properties: {
          phrase: {
            type: 'string',
            description: 'The original phrase being translated.',
          },
          translation: {
            type: 'string',
            description: 'The English translation of the phrase.',
          },
        },
        required: ['phrase', 'translation'],
      },
    },
    {
      name: 'show_explanation',
      description: 'Explain the meaning and usage of the target word in context.',
      parameters: {
        type: 'object',
        properties: {
          word: {
            type: 'string',
            description: 'The word being explained.',
          },
          explanation: {
            type: 'string',
            description: 'A clear explanation of the word meaning and its usage in this context.',
          },
        },
        required: ['word', 'explanation'],
      },
    },
    {
      name: 'show_grammar_points',
      description: 'List grammar points found in the phrase that are relevant for the learner.',
      parameters: {
        type: 'object',
        properties: {
          points: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                term: {
                  type: 'string',
                  description: 'The grammar pattern or term.',
                },
                description: {
                  type: 'string',
                  description: 'Explanation of the grammar point.',
                },
              },
              required: ['term', 'description'],
            },
            description: 'Array of grammar points.',
          },
        },
        required: ['points'],
      },
    },
  ];
}
