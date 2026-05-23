/**
 * Unified LLM Provider Service
 * Single abstraction for all LLM interactions (Explainer + Conversation Agent).
 * Routes to built-in (node-llama-cpp) or Ollama based on user settings.
 */

import type { LLMChatMessage, LLMToolDefinition, LLMStreamChunk, LLMToolCall, Settings, CloudLLMTier } from '../../shared/types';
import { getBridge } from '../../shared/bridges';
import { isMobile } from '../../shared/platform';
import { CloudLLMAdapter } from '../../shared/backends/cloudLLMAdapter';
import { resolveCloudApiUrl } from '../../shared/backends';
import {
  CloudSessionCancelledError,
  CloudUnreachableError,
  ensureCloudAccessToken,
  getCloudSessionSettings,
  isCloudSessionError,
  withCloudAuth,
} from './cloudSessionManager';
import { hasCompleteStructuredExplainerOutput } from '../components/subtitle/explainerPopupState';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger("renderer.services.llmProvider");

// ============================================================================
// Types
// ============================================================================

export interface LLMStreamCallbacks {
  onChunk: (content: string, accumulated: string) => void;
  onToolCall: (toolCall: LLMToolCall) => void;
  onDone: (finalContent: string, allToolCalls: LLMToolCall[], stats?: LLMStreamStats) => void;
  onError: (error: unknown) => void;
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

  if (!hasCacheableExplainerOutput(entry.rawText, entry.toolCalls, mode)) {
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
  tier?: CloudLLMTier,
  think?: boolean,
): { abort: () => void } {
  const activeSettings = settings ?? getCloudSessionSettings() ?? undefined;

  // Mobile: stream directly via HTTP (no IPC bridge)
  if (isMobile() && activeSettings) {
    return streamChatMobile(messages, tools, callbacks, activeSettings, tier, think);
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

  const runStreamAttempt = () => new Promise<void>((resolve, reject) => {
    if (aborted) {
      resolve();
      return;
    }

    cleanup = bridge.llm.onLLMStreamChunk((chunk: LLMStreamChunk) => {
      if (chunk.error) {
        cleanupListener();
        reject(chunk.error);
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

        logCompletedLLMStream(activeSettings, accumulated, collectedToolCalls, stats);
        callbacks.onDone(accumulated, collectedToolCalls, stats);
        cleanupListener();
        resolve();
      }
    });

    activeCleanup = cleanupListener;

    if (activeSettings?.devMode) {
      log.info('[LLMProvider] Prompt sent to LLM:', JSON.stringify(messages, null, 2));
    }
    bridge.llm.llmStream(messages, tools, tier, think);
  });

  const startStream = async () => {
    if (activeSettings?.llmProvider !== 'cloud') {
      await runStreamAttempt();
      return;
    }

    await withCloudAuth(
      async () => {
        await runStreamAttempt();
      },
      {
        alreadyEmittedOutput: () => accumulated.length > 0 || collectedToolCalls.length > 0,
      },
    );
  };

  void startStream().catch((error) => {
    log.error("error", error);
    if (!aborted) {
      callbacks.onError(error);
    }
  });

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
  tier?: CloudLLMTier,
  think?: boolean,
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

  const startMobileStream = (token: string) => new Promise<void>((resolve, reject) => {
    mobileCloudAdapter = new CloudLLMAdapter(url, token);

    mobileCloudAdapter.streamChat(messages, tools, {
      onChunk: (chunk) => {
        if (chunk.error) {
          reject(chunk.error);
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
        logCompletedLLMStream(settings, accumulated, collectedToolCalls, stats);
        callbacks.onDone(accumulated, collectedToolCalls, stats);
        resolve();
      },
      onError: (error) => {
        reject(error);
      },
    }, tier, think);
  });

  void withCloudAuth(
    async (token) => {
      await startMobileStream(token);
    },
    {
      alreadyEmittedOutput: () => accumulated.length > 0 || collectedToolCalls.length > 0,
    },
  ).catch((error) => {
    log.error("error", error);
    if (!aborted) {
      callbacks.onError(error);
    }
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
 * Diagnostics only. Real cloud operations should use withCloudAuth, not preflight via checkAvailability.
 * Check if the LLM is ready to use (provider-specific checks).
 */
export async function checkAvailability(settings: Settings): Promise<{ available: boolean; reason?: string }> {
  const bridge = getBridge();

  if (!settings.llmConfigured) {
    return { available: false, reason: 'not_configured' };
  }

  if (settings.llmProvider === 'cloud') {
    try {
      const accessToken = await ensureCloudAccessToken({ interactive: false, openModalOnExpiry: false });
      if (!accessToken) {
        return { available: false, reason: 'auth_required' };
      }

      const cloudApiUrl = resolveCloudApiUrl(settings);
      const adapter = new CloudLLMAdapter(
        cloudApiUrl,
        accessToken,
      );
      const reachable = await adapter.checkAvailability();
      return reachable
        ? { available: true }
        : { available: false, reason: 'cloud_unreachable' };
    } catch (error) {
      log.error("error", error);
      if (error instanceof CloudSessionCancelledError || isCloudSessionError(error)) {
        return { available: false, reason: 'auth_required' };
      }
      if (error instanceof CloudUnreachableError) {
        return { available: false, reason: 'cloud_unreachable' };
      }
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
      log.error("error", e);
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
    log.error("error", e);
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
  const requiredToolNames = getExplainerToolNames(mode);

  const messages: LLMChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const tools = getExplainerTools(mode);
  const mergedToolCalls: LLMToolCall[] = [];
  const seenToolCalls = new Set<string>();
  const cleanedContentParts: string[] = [];
  const maxRepairAttempts = requiredToolNames.length;
  let repairAttempts = 0;
  let aborted = false;
  let activeHandle: { abort: () => void } | null = null;

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

  const finish = (stats?: LLMStreamStats): void => {
    if (aborted) {
      return;
    }

    const finalContent = cleanedContentParts.filter((part) => part.trim().length > 0).join('\n\n');

    if (hasCacheableExplainerOutput(finalContent, mergedToolCalls, mode)) {
      setCachedExplanation(word, contextPhrase, mode, mergedToolCalls, finalContent);
    }

    callbacks.onDone(finalContent, mergedToolCalls, stats);
  };

  const startAttempt = (
    attemptMessages: LLMChatMessage[],
    attemptToolNames: ReadonlyArray<ExplainerToolName>,
  ): void => {
    const attemptTools = tools.filter((tool) => attemptToolNames.includes(tool.name as ExplainerToolName));

    const wrappedCallbacks: LLMStreamCallbacks = {
      onChunk: (content, accumulated) => {
        if (aborted) {
          return;
        }

        const parsed = parseExplainerToolCallsFromContent(accumulated, attemptToolNames);

        for (const toolCall of parsed.toolCalls) {
          registerToolCall(toolCall, true);
        }

        callbacks.onChunk(content, parsed.cleanedContent);
      },
      onToolCall: (toolCall) => {
        if (aborted) {
          return;
        }

        registerToolCall(toolCall, true);
      },
      onDone: (finalContent, allToolCalls, stats) => {
        if (aborted) {
          return;
        }

        const parsed = parseExplainerToolCallsFromContent(finalContent, attemptToolNames);

        for (const toolCall of allToolCalls) {
          registerToolCall(toolCall, false);
        }

        for (const toolCall of parsed.toolCalls) {
          registerToolCall(toolCall, false);
        }

        if (parsed.cleanedContent.trim().length > 0) {
          cleanedContentParts.push(parsed.cleanedContent);
        }

        const missingToolNames = getMissingExplainerToolNames(mergedToolCalls, requiredToolNames);
        const hasGeneratedSomething = cleanedContentParts.length > 0 || mergedToolCalls.length > 0;
        if (!aborted && hasGeneratedSomething && missingToolNames.length > 0 && repairAttempts < maxRepairAttempts) {
          repairAttempts += 1;
          startAttempt(
            buildExplainerRepairMessages(word, contextPhrase, language, mode, missingToolNames, mergedToolCalls),
            missingToolNames,
          );
          return;
        }

        finish(stats);
      },
      onError: callbacks.onError,
    };

    activeHandle = streamChat(attemptMessages, attemptTools, wrappedCallbacks, getCloudSessionSettings() ?? undefined, getCloudSessionSettings()?.cloudLLMTierExplanation, false);
  };

  startAttempt(messages, requiredToolNames);

  return {
    abort: () => {
      aborted = true;
      activeHandle?.abort();
    },
  };
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
  const fallbackExample = requiresWordPanel
    ? 'show_translation({"phrase":"...","translation":"..."})\nshow_explanation({"word":"...","explanation":"..."})\nshow_grammar_points({"points":[{"term":"...","description":"..."}]})'
    : 'show_translation({"phrase":"...","translation":"..."})\nshow_grammar_points({"points":[{"term":"...","description":"..."}]})';

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
- Do not think or use <think> tags. Output tool calls immediately.
- Prefer structured tool calls.
- If tool calling is unavailable, emit the same tool calls as plain text using this exact syntax so the UI can still parse them while streaming:
${fallbackSyntax}

Plain-text fallback example:
${fallbackExample}`;
}

function buildExplainerUserPrompt(word: string, contextPhrase: string, mode: ExplainerMode): string {
  if (mode === 'phrase') {
    return `Explain this phrase for a learner. Only provide the translation and grammar cards. Phrase: "${contextPhrase}"`;
  }

  return `Explain the word "${word}" in the context of this phrase: "${contextPhrase}"`;
}

function buildExplainerRepairMessages(
  word: string,
  contextPhrase: string,
  language: string,
  mode: ExplainerMode,
  missingToolNames: ReadonlyArray<ExplainerToolName>,
  existingToolCalls: LLMToolCall[],
): LLMChatMessage[] {
  const requiredCards = missingToolNames.join(', ');
  const existingOutput = existingToolCalls.length > 0
    ? JSON.stringify(existingToolCalls.map((toolCall) => ({ name: toolCall.name, arguments: toolCall.arguments })), null, 2)
    : 'No explainer cards have been generated yet.';
  const wordInstruction = mode === 'word'
    ? `Target word: "${word}". Explain this target word in context when show_explanation is missing.`
    : 'This is phrase mode. Do not add show_explanation.';

  return [
    {
      role: 'system',
      content: `You are completing missing language-learning explainer cards for ${language}.
Only call the missing tool functions requested by the user.
Do not repeat cards already generated.
Do not output markdown, prose, or headings.
Every missing card must be returned as its own tool call.`,
    },
    {
      role: 'user',
      content: `The previous response was incomplete.
Missing required tool calls: ${requiredCards}
Phrase: "${contextPhrase}"
${wordInstruction}

Already generated cards:
${existingOutput}

Call every missing tool exactly once now.`,
    },
  ];
}

function getExplainerToolNames(mode: ExplainerMode): ReadonlyArray<ExplainerToolName> {
  return mode === 'word' ? WORD_EXPLAINER_TOOL_NAMES : PHRASE_EXPLAINER_TOOL_NAMES;
}

function getMissingExplainerToolNames(
  toolCalls: LLMToolCall[],
  requiredToolNames: ReadonlyArray<ExplainerToolName>,
): ExplainerToolName[] {
  const renderableToolNames = new Set(
    toolCalls
      .filter(isRenderableExplainerToolCall)
      .map((toolCall) => toolCall.name),
  );

  return requiredToolNames.filter((name) => !renderableToolNames.has(name));
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

function hasCacheableExplainerOutput(rawText: string, toolCalls: LLMToolCall[], mode: ExplainerMode): boolean {
  const hasRawFallback = rawText.trim().length > 0 && toolCalls.length === 0;
  return hasRawFallback || hasCompleteStructuredExplainerOutput(toolCalls, mode);
}

function logCompletedLLMStream(
  settings: Settings | undefined,
  finalContent: string,
  toolCalls: LLMToolCall[],
  stats: LLMStreamStats,
): void {
  if (!settings?.devMode) {
    return;
  }

  log.info('[LLMProvider] LLM stream completed:', JSON.stringify({
    finalContent,
    toolCalls,
    stats,
  }, null, 2));
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
  if (content[index] === ':') {
    index += 1;
    while (index < content.length && /\s/.test(content[index])) {
      index += 1;
    }
  }

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
    const args = parseToolCallArguments(parsedObject.jsonText);
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
    return { kind: 'invalid', nextIndex: startIndex + name.length };
  }
}

function parseToolCallArguments(jsonText: string): Record<string, unknown> {
  try {
    return JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    const normalized = normalizeJsonLikeObject(jsonText);
    return JSON.parse(normalized) as Record<string, unknown>;
  }
}

function normalizeJsonLikeObject(jsonText: string): string {
  return transformJsonLikeObject(jsonText);
}

function transformJsonLikeObject(jsonText: string): string {
  let converted = '';
  let index = 0;
  let expectObjectKey = false;

  while (index < jsonText.length) {
    const char = jsonText[index];

    if (char === '"') {
      const doubleQuotedString = readDoubleQuotedString(jsonText, index);
      if (!doubleQuotedString) {
        return jsonText;
      }

      converted += jsonText.slice(index, doubleQuotedString.endIndex);
      index = doubleQuotedString.endIndex;
      expectObjectKey = false;
      continue;
    }

    if (char === "'") {
      const singleQuotedString = readSingleQuotedString(jsonText, index, expectObjectKey);
      if (!singleQuotedString) {
        return jsonText;
      }

      converted += JSON.stringify(singleQuotedString.value);
      index = singleQuotedString.endIndex;
      expectObjectKey = false;
      continue;
    }

    if ((char === '{' || char === ',') && readObjectKey(jsonText, index + 1)) {
      converted += char;
      index += 1;
      expectObjectKey = true;
      continue;
    }

    if (expectObjectKey) {
      const objectKey = readObjectKey(jsonText, index);
      if (objectKey) {
        converted += `${objectKey.leadingWhitespace}"${objectKey.key}"`;
        index = objectKey.endIndex;
        expectObjectKey = false;
        continue;
      }
    }

    if (char === ',' && isTrailingJsonComma(jsonText, index)) {
      index += 1;
      continue;
    }

    converted += char;
    index += 1;
  }

  return converted;
}

function readDoubleQuotedString(jsonText: string, startIndex: number): { endIndex: number } | null {
  let index = startIndex + 1;
  let isEscaped = false;

  while (index < jsonText.length) {
    const char = jsonText[index];

    if (isEscaped) {
      isEscaped = false;
      index += 1;
      continue;
    }

    if (char === '\\') {
      isEscaped = true;
      index += 1;
      continue;
    }

    if (char === '"') {
      return { endIndex: index + 1 };
    }

    index += 1;
  }

  return null;
}

function readSingleQuotedString(jsonText: string, startIndex: number, isObjectKey: boolean): { value: string; endIndex: number } | null {
  let value = '';
  let index = startIndex + 1;

  while (index < jsonText.length) {
    const char = jsonText[index];

    if (char === "'") {
      if (!isObjectKey && isApostropheInsideWord(jsonText, index)) {
        value += char;
        index += 1;
        continue;
      }

      return { value, endIndex: index + 1 };
    }

    if (char === '\\') {
      const nextChar = jsonText[index + 1];
      if (!nextChar) {
        return null;
      }

      value += decodeJsonLikeEscape(nextChar);
      index += 2;
      continue;
    }

    value += char;
    index += 1;
  }

  return null;
}

function isApostropheInsideWord(jsonText: string, index: number): boolean {
  const previousChar = jsonText[index - 1] ?? '';
  const nextChar = jsonText[index + 1] ?? '';
  return /[\p{L}\p{N}]/u.test(previousChar) && /[\p{L}\p{N}]/u.test(nextChar);
}

function readObjectKey(jsonText: string, startIndex: number): { leadingWhitespace: string; key: string; endIndex: number } | null {
  let index = startIndex;
  let leadingWhitespace = '';

  while (index < jsonText.length && /\s/.test(jsonText[index])) {
    leadingWhitespace += jsonText[index];
    index += 1;
  }

  const keyStart = index;
  const firstChar = jsonText[index] ?? '';
  if (!/[A-Za-z_$]/.test(firstChar)) {
    return null;
  }

  index += 1;
  while (index < jsonText.length && /[A-Za-z0-9_$-]/.test(jsonText[index])) {
    index += 1;
  }

  let colonIndex = index;
  while (colonIndex < jsonText.length && /\s/.test(jsonText[colonIndex])) {
    colonIndex += 1;
  }

  if (jsonText[colonIndex] !== ':') {
    return null;
  }

  return {
    leadingWhitespace,
    key: jsonText.slice(keyStart, index),
    endIndex: index,
  };
}

function isTrailingJsonComma(jsonText: string, commaIndex: number): boolean {
  let index = commaIndex + 1;
  while (index < jsonText.length && /\s/.test(jsonText[index])) {
    index += 1;
  }

  return jsonText[index] === '}' || jsonText[index] === ']';
}

function decodeJsonLikeEscape(char: string): string {
  switch (char) {
    case 'b':
      return '\b';
    case 'f':
      return '\f';
    case 'n':
      return '\n';
    case 'r':
      return '\r';
    case 't':
      return '\t';
    default:
      return char;
  }
}

function parseBalancedJsonObject(content: string, startIndex: number): { jsonText: string; endIndex: number } | null {
  let depth = 0;
  let stringQuote: '"' | "'" | null = null;
  let isEscaped = false;

  for (let index = startIndex; index < content.length; index++) {
    const char = content[index];

    if (stringQuote) {
      if (isEscaped) {
        isEscaped = false;
        continue;
      }

      if (char === '\\') {
        isEscaped = true;
        continue;
      }

      if (char === stringQuote && !(stringQuote === "'" && isApostropheInsideWord(content, index))) {
        stringQuote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      stringQuote = char;
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
