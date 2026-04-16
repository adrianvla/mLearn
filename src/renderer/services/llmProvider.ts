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
import { ensureCloudAccessToken, getCloudSessionSettings, handleCloudSessionError, isCloudSessionError } from './cloudSessionManager';

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

export type ExplainerMode = 'word' | 'phrase';

export interface StreamExplanationOptions {
  mode?: ExplainerMode;
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

function getCacheKey(word: string, context: string, mode: ExplainerMode = 'word'): string {
  const normalizedWord = word.toLowerCase().trim();
  const normalizedContext = context.substring(0, 100).toLowerCase().trim();
  return `${mode}|||${normalizedWord}|||${normalizedContext}`;
}

export function getCachedExplanation(word: string, context: string, mode: ExplainerMode = 'word'): CacheEntry | null {
  const key = getCacheKey(word, context, mode);
  const entry = explanationCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    explanationCache.delete(key);
    return null;
  }
  return entry;
}

function setCachedExplanation(
  word: string,
  context: string,
  mode: ExplainerMode,
  toolCalls: LLMToolCall[],
  rawText: string,
): void {
  const key = getCacheKey(word, context, mode);
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
  let hasRecoveredCloudSession = false;

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
        const chunkError = chunk.error;
        if (
          activeSettings?.llmProvider === 'cloud'
          && !hasRecoveredCloudSession
          && accumulated.length === 0
          && collectedToolCalls.length === 0
          && isCloudSessionError(chunkError)
        ) {
          hasRecoveredCloudSession = true;
          cleanupListener();

          // Force-refresh the token silently (via refresh token) instead of
          // wiping the session and immediately opening a re-login modal.
          // This prevents a duplicate modal when the main process read stale
          // settings from disk before the async save completed.
          void ensureCloudAccessToken({ forceRefresh: true }).then((accessToken) => {
            if (aborted) {
              return;
            }

            if (!accessToken) {
              callbacks.onError(chunkError);
              return;
            }

            startStream();
          }).catch((error) => {
            console.error(error);
            if (!aborted) {
              callbacks.onError((error as Error).message || chunkError);
            }
          });
          return;
        }

        if (activeSettings?.llmProvider === 'cloud') {
          handleCloudSessionError(chunkError);
        }
        callbacks.onError(chunkError);
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
  let hasRecoveredCloudSession = false;

  // Determine the cloud URL: tethered via desktop's forwarding endpoint
  let url: string;

  if (settings.backendMode === 'tethered' && settings.backendUrl) {
    // Tethered: forward through the desktop's web server
    url = settings.backendUrl.replace(/\/+$/, '');
  } else {
    callbacks.onError('No LLM endpoint configured for mobile');
    return { abort: () => {} };
  }

  const startMobileStream = (token: string) => {
    mobileCloudAdapter = new CloudLLMAdapter(url, token);

    mobileCloudAdapter.streamChat(messages, tools, {
      onChunk: (chunk) => {
        if (chunk.error) {
          const chunkError = chunk.error;
          if (
            !hasRecoveredCloudSession
            && accumulated.length === 0
            && collectedToolCalls.length === 0
            && handleCloudSessionError(chunkError)
          ) {
            hasRecoveredCloudSession = true;

            void ensureCloudAccessToken().then((recoveredToken) => {
              if (aborted) {
                return;
              }

              if (!recoveredToken) {
                callbacks.onError(chunkError);
                return;
              }

              startMobileStream(recoveredToken);
            }).catch((error) => {
              console.error(error);
              if (!aborted) {
                callbacks.onError((error as Error).message || chunkError);
              }
            });
            return;
          }

          handleCloudSessionError(chunkError);
          callbacks.onError(chunkError);
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
  };

  void ensureCloudAccessToken().then((token) => {
    if (aborted) {
      return;
    }

    if (!token) {
      callbacks.onError('Cloud session expired. Please sign in again.');
      return;
    }

    startMobileStream(token);
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

const WORD_EXPLAINER_TOOL_NAMES = ['show_translation', 'show_explanation', 'show_grammar_points'] as const;
const PHRASE_EXPLAINER_TOOL_NAMES = ['show_translation', 'show_grammar_points'] as const;

type ExplainerToolName = (typeof WORD_EXPLAINER_TOOL_NAMES)[number];

interface ParsedExplainerToolCalls {
  cleanedContent: string;
  toolCalls: LLMToolCall[];
}

type ToolParseResult =
  | { kind: 'success'; toolCall: LLMToolCall; endIndex: number }
  | { kind: 'invalid'; nextIndex: number }
  | { kind: 'incomplete' };

function isRenderableExplainerToolCall(toolCall: LLMToolCall): boolean {
  if (!toolCall.name) {
    return false;
  }

  const args = toolCall.arguments as Record<string, unknown>;

  switch (toolCall.name) {
    case 'show_translation':
      return typeof args.translation === 'string' && args.translation.trim().length > 0;
    case 'show_explanation':
      return typeof args.explanation === 'string' && args.explanation.trim().length > 0;
    case 'show_grammar_points':
      return Array.isArray(args.points) && args.points.some((point) => {
        const candidate = point as { description?: unknown };
        return typeof candidate.description === 'string' && candidate.description.trim().length > 0;
      });
    default:
      return Object.values(args).some((value) => {
        if (typeof value === 'string') {
          return value.trim().length > 0;
        }

        if (Array.isArray(value)) {
          return value.length > 0;
        }

        return value != null;
      });
  }
}

/**
 * Stream a word explanation using tool calls.
 * The LLM is instructed to use only tool calls (show_translation, show_explanation, show_grammar_points).
 */
export function streamExplanation(
  word: string,
  contextPhrase: string,
  language: string,
  callbacks: LLMStreamCallbacks,
  options: StreamExplanationOptions = {},
): { abort: () => void } {
  const mode = options.mode ?? 'word';
  const systemPrompt = buildExplainerSystemPrompt(language, mode);
  const userPrompt = buildExplainerUserPrompt(word, contextPhrase, mode);

  const messages: LLMChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const tools = getExplainerTools(mode);
  const allowedToolNames = getExplainerToolNames(mode);
  const mergedToolCalls: LLMToolCall[] = [];
  const seenToolCalls = new Set<string>();

  const registerToolCall = (toolCall: LLMToolCall, emit: boolean): void => {
    if (!isRenderableExplainerToolCall(toolCall)) {
      return;
    }

    const signature = `${toolCall.name}:${JSON.stringify(toolCall.arguments)}`;
    if (seenToolCalls.has(signature)) {
      return;
    }

    seenToolCalls.add(signature);
    mergedToolCalls.push(toolCall);

    if (emit) {
      callbacks.onToolCall(toolCall);
    }
  };

  const wrappedCallbacks: LLMStreamCallbacks = {
    onChunk: (content, accumulated) => {
      const parsed = parseExplainerToolCallsFromContent(accumulated, allowedToolNames);

      for (const toolCall of parsed.toolCalls) {
        registerToolCall(toolCall, true);
      }

      callbacks.onChunk(content, parsed.cleanedContent);
    },
    onToolCall: (toolCall) => {
      registerToolCall(toolCall, true);
    },
    onDone: (finalContent, allToolCalls, stats) => {
      const parsed = parseExplainerToolCallsFromContent(finalContent, allowedToolNames);

      for (const toolCall of allToolCalls) {
        registerToolCall(toolCall, false);
      }

      for (const toolCall of parsed.toolCalls) {
        registerToolCall(toolCall, false);
      }

      if (mergedToolCalls.length > 0 || parsed.cleanedContent.trim().length > 0) {
        setCachedExplanation(word, contextPhrase, mode, mergedToolCalls, parsed.cleanedContent);
      }

      callbacks.onDone(parsed.cleanedContent, mergedToolCalls, stats);
    },
    onError: callbacks.onError,
  };

  return streamChat(messages, tools, wrappedCallbacks);
}

// ============================================================================
// Explainer prompt & tools
// ============================================================================

function buildExplainerSystemPrompt(language: string, mode: ExplainerMode): string {
  const requiresWordPanel = mode === 'word';
  const requiredTools = requiresWordPanel
    ? '1. show_translation\n2. show_explanation\n3. show_grammar_points'
    : '1. show_translation\n2. show_grammar_points';
  const fallbackSyntax = requiresWordPanel
    ? 'show_translation({...})\nshow_explanation({...})\nshow_grammar_points({...})'
    : 'show_translation({...})\nshow_grammar_points({...})';

  return `You are a language-learning explainer for ${language}. Your job is to fill the explanation cards in the app.

Required tools, in order:
${requiredTools}

Rules:
- The response is incomplete unless every required tool has been called.
- Do NOT stop after the translation.
- show_translation must translate the full phrase naturally and learner-friendly.
${requiresWordPanel
  ? '- show_explanation must explain what the target word means in this exact phrase, including the nuance or role it has here. Do not give a generic dictionary gloss divorced from the sentence.'
  : '- Do not add a separate word-focused explanation. This request is phrase-only.'}
- show_grammar_points must contain 1 to 4 concise grammar points when the phrase has meaningful grammar. For short/simple phrases, explain particles, endings, tense, politeness, aspect, or sentence structure instead of skipping the tool.
- Keep each explanation concise and clear for a learner.
- Do not output markdown or headings.
- Prefer structured tool calls.
- If tool calling is unavailable, emit the same tool calls as plain text using this exact syntax so the UI can still parse them while streaming:
${fallbackSyntax}`;
}

function buildExplainerUserPrompt(word: string, contextPhrase: string, mode: ExplainerMode): string {
  if (mode === 'phrase') {
    return `Explain this phrase for a learner. Only provide the translation and grammar cards. Phrase: "${contextPhrase}"`;
  }

  return `Explain the word "${word}" in the context of this phrase: "${contextPhrase}"`;
}

function getExplainerToolNames(mode: ExplainerMode): ReadonlyArray<ExplainerToolName> {
  return mode === 'word' ? WORD_EXPLAINER_TOOL_NAMES : PHRASE_EXPLAINER_TOOL_NAMES;
}

function getExplainerTools(mode: ExplainerMode): LLMToolDefinition[] {
  const tools: LLMToolDefinition[] = [
    {
      name: 'show_translation',
      description: 'Display the translation of the full phrase or sentence.',
      parameters: {
        type: 'object',
        properties: {
          phrase: {
            type: 'string',
            description: 'The original phrase being translated.',
          },
          translation: {
            type: 'string',
            description: 'A natural learner-friendly translation of the phrase.',
          },
        },
        required: ['phrase', 'translation'],
      },
    },
  ];

  if (mode === 'word') {
    tools.push({
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
    });
  }

  tools.push({
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
  });

  return tools;
}

function parseExplainerToolCallsFromContent(
  content: string,
  allowedToolNames: ReadonlyArray<ExplainerToolName>,
): ParsedExplainerToolCalls {
  const toolCalls: LLMToolCall[] = [];
  let cleanedContent = '';
  let cursor = 0;

  while (cursor < content.length) {
    const match = findNextExplainerToolStart(content, cursor, allowedToolNames);
    if (!match) {
      cleanedContent += content.slice(cursor);
      break;
    }

    cleanedContent += content.slice(cursor, match.startIndex);

    const parsed = tryParseExplainerToolCallAt(content, match.startIndex, match.name);
    if (parsed.kind === 'success') {
      toolCalls.push(parsed.toolCall);
      cursor = parsed.endIndex;
      continue;
    }

    if (parsed.kind === 'incomplete') {
      cleanedContent += content.slice(match.startIndex);
      break;
    }

    cleanedContent += content.slice(match.startIndex, parsed.nextIndex);
    cursor = parsed.nextIndex;
  }

  return {
    cleanedContent: cleanedContent.replace(/\n{3,}/g, '\n\n').trim(),
    toolCalls,
  };
}

function findNextExplainerToolStart(
  content: string,
  fromIndex: number,
  allowedToolNames: ReadonlyArray<ExplainerToolName>,
): { name: ExplainerToolName; startIndex: number } | null {
  for (let index = fromIndex; index < content.length; index++) {
    for (const name of allowedToolNames) {
      if (!content.startsWith(name, index)) {
        continue;
      }

      const prevChar = index === 0 ? '' : content[index - 1];
      const nextChar = content[index + name.length] ?? '';

      if (/[A-Za-z0-9_]/.test(prevChar) || /[A-Za-z0-9_]/.test(nextChar)) {
        continue;
      }

      return { name, startIndex: index };
    }
  }

  return null;
}

function tryParseExplainerToolCallAt(
  content: string,
  startIndex: number,
  name: ExplainerToolName,
): ToolParseResult {
  let index = startIndex + name.length;

  while (index < content.length && /\s/.test(content[index])) {
    index += 1;
  }

  let hasOpeningParen = false;
  if (content[index] === '(') {
    hasOpeningParen = true;
    index += 1;
    while (index < content.length && /\s/.test(content[index])) {
      index += 1;
    }
  }

  if (index >= content.length) {
    return { kind: 'incomplete' };
  }

  if (content[index] !== '{') {
    return { kind: 'invalid', nextIndex: startIndex + name.length };
  }

  const parsedObject = parseBalancedJsonObject(content, index);
  if (!parsedObject) {
    return { kind: 'incomplete' };
  }

  let endIndex = parsedObject.endIndex;
  while (endIndex < content.length && /\s/.test(content[endIndex])) {
    endIndex += 1;
  }

  if (hasOpeningParen) {
    if (endIndex >= content.length) {
      return { kind: 'incomplete' };
    }
    if (content[endIndex] !== ')') {
      return { kind: 'invalid', nextIndex: startIndex + name.length };
    }
    endIndex += 1;
  }

  try {
    const args = JSON.parse(parsedObject.jsonText) as Record<string, unknown>;
    return {
      kind: 'success',
      toolCall: {
        id: `parsed_${Date.now()}_${startIndex}`,
        name,
        arguments: args,
      },
      endIndex,
    };
  } catch (error) {
    console.error(error);
    return { kind: 'invalid', nextIndex: startIndex + name.length };
  }
}

function parseBalancedJsonObject(content: string, startIndex: number): { jsonText: string; endIndex: number } | null {
  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let index = startIndex; index < content.length; index++) {
    const char = content[index];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
        continue;
      }

      if (char === '\\') {
        isEscaped = true;
        continue;
      }

      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return {
          jsonText: content.slice(startIndex, index + 1),
          endIndex: index + 1,
        };
      }
    }
  }

  return null;
}
