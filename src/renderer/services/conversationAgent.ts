/**
 * Conversation Agent Service
 * Handles system prompt construction, tool definitions, streaming,
 * tokenization of responses, and tool execution for the AI tutor
 */

import type {
  ConversationMessage,
  ConversationAgentContext,
  Token,
  ToolCall,
  ChatWidget,
  QuizWidgetData,
  MistakeWidgetData,
  LLMChatMessage,
  LLMToolDefinition,
  LLMStreamChunk,
  Settings,
  StreamStats,
} from '../../shared/types';
import { API_ENDPOINTS } from '../../shared/constants';

// ============================================================================
// Types
// ============================================================================

interface AgentDeps {
  getSettings: () => Settings;
  getLanguage: () => string;
  getLanguageName: () => string;
  getMediaContext: () => ConversationAgentContext | null;
  getSceneContext: () => string;
  flashcardCtx: {
    getWordKnowledge: (word: string) => { ease: number; timesSeen: number } | undefined;
    trackGrammarFailed: (pattern: string) => void;
    trackGrammarEncountered: (pattern: string) => void;
  };
}

/** Callback for streaming chunks to the UI */
export interface StreamCallbacks {
  onChunk: (accumulated: string) => void;
  onToolCall: (widget: ChatWidget) => void;
  onDone: (finalContent: string, tokens: Token[] | undefined, widget: ChatWidget | undefined, streamStats?: StreamStats) => void;
  onError: (error: string) => void;
}

export interface AgentInstance {
  processMessage: (text: string, history: ConversationMessage[], callbacks: StreamCallbacks) => void;
  abortStream: () => void;
  clearHistory: () => void;
  /** Tokenize arbitrary text using the backend tokenizer */
  tokenize: (text: string) => Promise<Token[]>;
}

// ============================================================================
// System Prompt Builder
// ============================================================================

function buildSystemPrompt(_langCode: string, langName: string, mediaCtx: ConversationAgentContext | null, userSceneContext?: string): string {
  let prompt = `You are a friendly and encouraging language tutor for ${langName}.
Your primary role is to have natural conversations in ${langName} with the learner.

## Rules
- Respond ONLY in ${langName} for all user-visible assistant messages.
- Adjust your language level based on the learner's apparent proficiency.
- Keep responses concise (2-4 sentences typically) to maintain conversational flow.
- Naturally correct mistakes the learner makes using the "correct_mistake" tool.
- Periodically quiz the learner using the "create_quiz" tool based on vocabulary or grammar used in the conversation.
- If the learner writes in another language, reply in ${langName} and gently guide them back to ${langName}.
- Base conversation topics on the media the learner is consuming — discuss scenes, character actions, plot, and themes rather than generic topics like weather or hobbies.

## Personality
- Patient, encouraging, and warm.
- Use natural, colloquial ${langName} — not textbook language.
- Celebrate progress and good usage.
- When the learner struggles, simplify rather than switch languages entirely.

## Tool Usage Guidelines
- Use "correct_mistake" when you notice grammar, vocabulary, or spelling errors in the learner's messages. Attach it to your response subtly.
  - If the learner explicitly asks you to call a tool or to mark/correct a specific span, you MUST call the appropriate tool even for meta/tool-testing requests and even when the text is not in ${langName}.
  - IMPORTANT: The error_span must be copied EXACTLY from the learner's message. Do not translate or alter it.
  - When the same word or phrase appears multiple times in the learner's message, provide context_before and/or context_after to identify which occurrence to correct.
  - Only correct actual mistakes in the target language; do not "correct" text that is already correct or translate it.
- Use "create_quiz" every 4-6 exchanges or when a good teaching moment arises. Vary between MCQ and fill-in types.
- Use "fetch_url" to look up grammar explanations or vocabulary from language learning resources if the learner asks about a specific topic.
- Use "get_media_stats" to retrieve the learner's analytics for their current media to personalize your teaching.
- Do NOT overuse tools — the conversation should feel natural, not like a test.`;

  if (mediaCtx) {
    prompt += `\n\n## Current Media Context
The learner is currently ${mediaCtx.mediaType === 'video' ? 'watching' : 'reading'}: "${mediaCtx.mediaName}"`;

    if (mediaCtx.assessedLevelName) {
      prompt += `\nAssessed difficulty level: ${mediaCtx.assessedLevelName}`;
    }

    if (mediaCtx.failedWords.length > 0) {
      const topFailed = mediaCtx.failedWords
        .sort((a, b) => a.ease - b.ease)
        .slice(0, 15)
        .map((w) => w.word);
      prompt += `\nWords the learner is struggling with: ${topFailed.join(', ')}`;
      prompt += `\nConsider naturally incorporating these words into the conversation or quizzing on them.`;
    }

    if (mediaCtx.failedGrammar.length > 0) {
      const topGrammar = mediaCtx.failedGrammar
        .sort((a, b) => a.ease - b.ease)
        .slice(0, 10)
        .map((g) => g.pattern);
      prompt += `\nGrammar points the learner has struggled with: ${topGrammar.join(', ')}`;
    }

    if (mediaCtx.characterContext) {
      prompt += `\n\n## Characters
${mediaCtx.characterContext}`;
    }

    // Include recent subtitle history for video context
    if (mediaCtx.subtitleHistory && mediaCtx.subtitleHistory.length > 0) {
      prompt += `\n\n## Recent Dialogue (from subtitles)
The following are recent subtitle lines from what the learner is watching. Use this as context for discussion — ask about character actions, opinions, or plot points rather than generic topics.
${mediaCtx.subtitleHistory.join('\n')}`;
    }
  }

  // User-provided scene context (may be in a different language than the target)
  if (userSceneContext) {
    prompt += `\n\n## Scene Context (provided by the learner)
The learner has provided additional context about what is happening in the media. Note: this context may be written in a language other than ${langName}.
${userSceneContext}`;
  }
  return prompt;
}

function inferExplicitToolCallsFromLastUserMessage(history: LLMChatMessage[]): ToolCall[] {
  let lastUserIndex = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'user') {
      lastUserIndex = i;
      break;
    }
  }

  if (lastUserIndex === -1) return [];

  const followUpsAfterLastUser = history.slice(lastUserIndex + 1);
  const mistakeAlreadyHandled = followUpsAfterLastUser.some((msg) => {
    if (msg.role === 'tool' && msg.toolName === 'correct_mistake') {
      return true;
    }
    if (msg.role === 'assistant' && msg.toolCalls?.some((tc) => tc.name === 'correct_mistake')) {
      return true;
    }
    return false;
  });

  if (mistakeAlreadyHandled) return [];

  const lastUser = history[lastUserIndex];
  if (!lastUser?.content) return [];

  const text = lastUser.content.trim();
  if (!text) return [];

  const markWordPattern = /mark\s+(?:the\s+)?word\s+["“”'](.+?)["“”']\s+as\s+a\s+mistake(?:\s+in\s+(?:the\s+)?(?:following\s+)?phrase\s*:|\s*:)?\s*([\s\S]+)$/i;

  const match = text.match(markWordPattern);
  if (!match) return [];

  const rawWord = (match[1] || '').trim();
  const phrase = (match[2] || '').trim();
  if (!rawWord || !phrase) return [];

  const correctionQuotedMatch = text.match(/correct(?:\s+it)?\s+with(?:\s+the\s+word)?\s+["“”'](.+?)["“”']/i);
  const correctionUnquotedMatch = text.match(/correct(?:\s+it)?\s+with(?:\s+the\s+word)?\s+([^\s"“”',.?!:;]+)/i);
  const requestedCorrection = (correctionQuotedMatch?.[1] || correctionUnquotedMatch?.[1] || rawWord).trim();

  const lowerPhrase = phrase.toLowerCase();
  const lowerWord = rawWord.toLowerCase();
  const index = lowerPhrase.indexOf(lowerWord);
  if (index === -1) return [];

  const errorSpan = phrase.slice(index, index + rawWord.length);
  const contextBefore = phrase.slice(Math.max(0, index - 20), index).trim() || undefined;
  const contextAfter = phrase.slice(index + errorSpan.length, index + errorSpan.length + 20).trim() || undefined;

  return [
    {
      id: `forced_call_${Date.now()}`,
      name: 'correct_mistake',
      arguments: {
        error_span: errorSpan,
        correction: requestedCorrection,
        error_type: 'word',
        context_before: contextBefore,
        context_after: contextAfter,
      },
    },
  ];
}

// ============================================================================
// Tool Definitions
// ============================================================================

const AGENT_TOOLS: LLMToolDefinition[] = [
  {
    name: 'correct_mistake',
    description: 'Correct a grammatical, vocabulary, or spelling mistake the learner made in their message. You must provide surrounding context to identify which occurrence of the error span to correct.',
    parameters: {
      type: 'object',
      properties: {
        error_span: {
          type: 'string',
          description: 'The exact text that contains the error from the learner\'s message',
        },
        correction: {
          type: 'string',
          description: 'The corrected version of the error span',
        },
        error_type: {
          type: 'string',
          enum: ['grammar', 'word', 'typo', 'other'],
          description: 'The category of error',
        },
        context_before: {
          type: 'string',
          description: 'A few characters or words appearing immediately before the error span in the learner\'s message, to disambiguate when the same text appears multiple times',
        },
        context_after: {
          type: 'string',
          description: 'A few characters or words appearing immediately after the error span in the learner\'s message, to disambiguate when the same text appears multiple times',
        },
        affected_pattern: {
          type: 'string',
          description: 'The grammar pattern related to this error, if any (e.g., "てform", "は vs が")',
        },
      },
      required: ['error_span', 'correction', 'error_type'],
    },
  },
  {
    name: 'create_quiz',
    description: 'Create a quiz question to test the learner on vocabulary or grammar from the conversation.',
    parameters: {
      type: 'object',
      properties: {
        quiz_type: {
          type: 'string',
          enum: ['mcq', 'fill-in'],
          description: 'Type of quiz: multiple choice or fill-in-the-blank',
        },
        question: {
          type: 'string',
          description: 'The quiz question',
        },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: 'Answer options for MCQ (3-4 options, one correct)',
        },
        correct_answer: {
          type: 'string',
          description: 'The correct answer',
        },
        affected_pattern: {
          type: 'string',
          description: 'The grammar pattern being tested, if any',
        },
      },
      required: ['quiz_type', 'question', 'correct_answer'],
    },
  },
  {
    name: 'fetch_url',
    description: 'Fetch and retrieve content from a URL. Use this to look up grammar explanations or language resources online when the learner asks about a specific topic.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to fetch content from',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'get_media_stats',
    description: 'Retrieve the learner\'s analytics and statistics for the media they are currently consuming. Returns failed words, grammar points, level percentages, and assessed difficulty.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

// ============================================================================
// Tool Execution
// ============================================================================

function executeTool(toolCall: ToolCall, deps: AgentDeps): ChatWidget | null {
  const args = toolCall.arguments;

  switch (toolCall.name) {
    case 'correct_mistake': {
      const data: MistakeWidgetData = {
        userMessageIndex: -1,
        errorSpan: (args.error_span as string) || '',
        correction: (args.correction as string) || '',
        errorType: (args.error_type as 'grammar' | 'word' | 'typo' | 'other') || 'other',
        affectedPattern: args.affected_pattern as string | undefined,
        contextBefore: args.context_before as string | undefined,
        contextAfter: args.context_after as string | undefined,
      };

      // Track grammar failure
      if (data.affectedPattern) {
        deps.flashcardCtx.trackGrammarFailed(data.affectedPattern);
      }

      return { type: 'mistake', data: data as unknown as Record<string, unknown> };
    }

    case 'create_quiz': {
      const data: QuizWidgetData = {
        type: (args.quiz_type as 'mcq' | 'fill-in') || 'mcq',
        question: (args.question as string) || '',
        options: args.options as string[] | undefined,
        correctAnswer: (args.correct_answer as string) || '',
      };

      // Track grammar encounter
      if (args.affected_pattern) {
        deps.flashcardCtx.trackGrammarEncountered(args.affected_pattern as string);
      }

      return { type: 'quiz', data: data as unknown as Record<string, unknown> };
    }

    default:
      return null;
  }
}

/** Execute tools that return text results (injected back into conversation) */
async function executeToolWithResponse(toolCall: ToolCall, deps: AgentDeps): Promise<string | null> {
  const args = toolCall.arguments;

  switch (toolCall.name) {
    case 'fetch_url': {
      const url = args.url as string;
      if (!url) return 'Error: No URL provided';
      try {
        const result = await window.mLearnIPC?.fetchUrl(url);
        if (result?.error) return `Error fetching URL: ${result.error}`;
        const content = result?.content || '';
        // Truncate to avoid overwhelming the context
        return content.length > 3000 ? content.slice(0, 3000) + '\n\n[Content truncated]' : content;
      } catch (err) {
        return `Error fetching URL: ${(err as Error).message}`;
      }
    }

    case 'get_media_stats': {
      const ctx = deps.getMediaContext();
      if (!ctx) return 'No media is currently loaded. The learner has not opened a video or book yet.';

      const lines: string[] = [
        `Media: "${ctx.mediaName}" (${ctx.mediaType})`,
      ];

      if (ctx.assessedLevelName) {
        lines.push(`Assessed level: ${ctx.assessedLevelName}`);
      }

      if (ctx.failedWords.length > 0) {
        lines.push(`\nFailed words (${ctx.failedWords.length}):`);
        for (const w of ctx.failedWords.slice(0, 20)) {
          lines.push(`  - ${w.word} (ease: ${w.ease.toFixed(2)}, seen: ${w.timesSeen}x, hovered: ${w.timesHovered}x)`);
        }
        if (ctx.failedWords.length > 20) {
          lines.push(`  ... and ${ctx.failedWords.length - 20} more`);
        }
      } else {
        lines.push('No failed words so far.');
      }

      if (ctx.failedGrammar.length > 0) {
        lines.push(`\nFailed grammar (${ctx.failedGrammar.length}):`);
        for (const g of ctx.failedGrammar.slice(0, 15)) {
          lines.push(`  - ${g.pattern} (ease: ${g.ease.toFixed(2)}, failed: ${g.timesFailed}x)`);
        }
      }

      if (ctx.wordLevelPercentages.entries.length > 0) {
        lines.push('\nWord level distribution:');
        for (const e of ctx.wordLevelPercentages.entries) {
          if (e.uniqueCount > 0) {
            lines.push(`  ${e.levelName}: ${e.uniquePercent.toFixed(0)}% (${e.uniqueCount} unique)`);
          }
        }
      }

      return lines.join('\n');
    }

    default:
      return null;
  }
}

// ============================================================================
// Tokenization
// ============================================================================

const TOKENIZE_TIMEOUT_MS = 1500;

async function tokenizeText(text: string, langCode: string): Promise<Token[]> {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TOKENIZE_TIMEOUT_MS);

  try {
    const response = await fetch(API_ENDPOINTS.tokenize, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, language: langCode }),
      signal: controller.signal,
    });

    if (!response.ok) return [];

    const data = await response.json();
    return (data.tokens || data) as Token[];
  } catch {
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============================================================================
// Agent Factory
// ============================================================================

export function createConversationAgent(deps: AgentDeps): AgentInstance {
  let conversationHistory: LLMChatMessage[] = [];
  let aborted = false;
  let streamCleanup: (() => void) | null = null;

  function clearHistory(): void {
    conversationHistory = [];
  }

  function abortStream(): void {
    aborted = true;
    streamCleanup?.();
    streamCleanup = null;
    window.mLearnIPC?.llmStreamAbort();
  }

  /**
   * Process tool calls from the LLM response.
   * Widget-producing tools return a widget; response-producing tools
   * add their results to the conversation history and trigger a follow-up request.
   */
  async function handleToolCalls(
    toolCalls: ToolCall[],
    visibleContent: string,
    callbacks: StreamCallbacks,
    language: string,
    langName: string,
    streamStats?: StreamStats,
    assistantSegmentContent = visibleContent,
  ): Promise<void> {
    let widget: ChatWidget | undefined;
    const toolResponses: LLMChatMessage[] = [];

    // Add the assistant message to history
    const assistantMsg: LLMChatMessage = {
      role: 'assistant',
      content: assistantSegmentContent,
      toolCalls,
    };
    conversationHistory.push(assistantMsg);

    for (const tc of toolCalls) {
      // Try widget-producing tools first
      const w = executeTool(tc, deps);
      if (w) {
        widget = w;
        callbacks.onToolCall(w);
      } else {
        // Response-producing tools (fetch_url, get_media_stats)
        const result = await executeToolWithResponse(tc, deps);
        if (result !== null) {
          toolResponses.push({
            role: 'tool' as const,
            toolName: tc.name,
            content: result,
          });
        }
      }
    }

    // Widget-only tools do not need a second model pass.
    // Finalize immediately to avoid replacing already-streamed content.
    if (toolResponses.length === 0) {
      tokenizeText(visibleContent, language).then((tokens) => {
        if (aborted) return;
        const finalTokens = tokens.length > 0 ? tokens : undefined;
        callbacks.onDone(visibleContent, finalTokens, widget, streamStats);
      }).catch(() => {
        if (!aborted) {
          callbacks.onDone(visibleContent, undefined, widget, streamStats);
        }
      });
      return;
    }

    // Add tool responses to history
    for (const tr of toolResponses) {
      conversationHistory.push(tr);
    }

    if (aborted) return;

    // For tools that return data (fetch_url/get_media_stats), do a follow-up pass.
    // Keep the already streamed text visible and append follow-up text to it.
    startStream(callbacks, language, langName, widget, visibleContent);
  }

  /**
   * Start a streaming request through the unified LLM router
   */
  function startStream(
    callbacks: StreamCallbacks,
    language: string,
    langName: string,
    existingWidget?: ChatWidget,
    contentPrefix = '',
  ): void {
    const ipc = window.mLearnIPC;
    if (!ipc) {
      callbacks.onError('IPC not available');
      return;
    }

    const mediaCtx = deps.getMediaContext();
    const sceneCtx = deps.getSceneContext();

    const systemMsg: LLMChatMessage = {
      role: 'system',
      content: buildSystemPrompt(language, langName, mediaCtx, sceneCtx || undefined),
    };

    const messages: LLMChatMessage[] = [
      systemMsg,
      ...conversationHistory,
    ];

    let accumulated = '';
    const collectedToolCalls: ToolCall[] = [];
    let widget = existingWidget;
    const requestStartTime = Date.now();
    let firstTokenTime = 0;

    streamCleanup = ipc.onLLMStreamChunk((chunk: LLMStreamChunk) => {
      if (aborted) return;

      if (chunk.error) {
        streamCleanup?.();
        streamCleanup = null;
        callbacks.onError(chunk.error);
        return;
      }

      if (chunk.content) {
        if (!firstTokenTime) firstTokenTime = Date.now();
        accumulated += chunk.content;
        callbacks.onChunk(contentPrefix + accumulated);
      }

      if (chunk.toolCalls) {
        for (const tc of chunk.toolCalls) {
          collectedToolCalls.push(tc);
        }
      }

      if (chunk.done) {
        streamCleanup?.();
        streamCleanup = null;

        if (aborted) return;

        // Build stream stats
        const doneTime = Date.now();
        const timeToFirstToken = firstTokenTime ? firstTokenTime - requestStartTime : doneTime - requestStartTime;
        const totalTime = doneTime - requestStartTime;
        let tokensPerSecond = 0;
        if (chunk.evalCount && chunk.evalDuration) {
          tokensPerSecond = chunk.evalCount / (chunk.evalDuration / 1e9);
        }
        const streamStats: StreamStats = { timeToFirstToken, totalTime, tokensPerSecond };

        // Handle tool calls
        if (collectedToolCalls.length === 0) {
          const forcedToolCalls = inferExplicitToolCallsFromLastUserMessage(conversationHistory);
          if (forcedToolCalls.length > 0) {
            collectedToolCalls.push(...forcedToolCalls);
          }
        }

        if (collectedToolCalls.length > 0) {
          const visibleContent = contentPrefix + accumulated;
          handleToolCalls(
            collectedToolCalls,
            visibleContent,
            callbacks,
            language,
            langName,
            streamStats,
            accumulated,
          ).catch((err) => {
            callbacks.onError(`Tool execution failed: ${(err as Error).message}`);
          });
          return;
        }

        // Add assistant response to history
        conversationHistory.push({ role: 'assistant', content: accumulated });

        const finalVisibleContent = contentPrefix + accumulated;

        // Tokenize the response for interactive rendering
        tokenizeText(finalVisibleContent, language).then((tokens) => {
          if (aborted) return;
          const finalTokens = tokens.length > 0 ? tokens : undefined;
          callbacks.onDone(finalVisibleContent, finalTokens, widget, streamStats);
        }).catch(() => {
          if (!aborted) {
            callbacks.onDone(finalVisibleContent, undefined, widget, streamStats);
          }
        });
      }
    });

    ipc.llmStream(messages, AGENT_TOOLS);

    // Timeout after 90 seconds
    setTimeout(() => {
      if (streamCleanup && !aborted) {
        streamCleanup();
        streamCleanup = null;
        if (accumulated) {
          conversationHistory.push({ role: 'assistant', content: accumulated });
          const finalVisibleContent = contentPrefix + accumulated;
          tokenizeText(finalVisibleContent, language).then((tokens) => {
            callbacks.onDone(finalVisibleContent, tokens.length > 0 ? tokens : undefined, widget);
          }).catch(() => {
            callbacks.onDone(finalVisibleContent, undefined, widget);
          });
        } else {
          callbacks.onError('Response timed out');
        }
      }
    }, 90_000);
  }

  function processMessage(
    text: string,
    _displayHistory: ConversationMessage[],
    callbacks: StreamCallbacks,
  ): void {
    const language = deps.getLanguage();
    const langName = deps.getLanguageName();
    aborted = false;

    // Add user message to history
    conversationHistory.push({ role: 'user', content: text });

    startStream(callbacks, language, langName);
  }

  function tokenize(text: string): Promise<Token[]> {
    return tokenizeText(text, deps.getLanguage());
  }

  return { processMessage, abortStream, clearHistory, tokenize };
}
