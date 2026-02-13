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
  OllamaChatMessage,
  OllamaToolDefinition,
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
- Respond primarily in ${langName}, mixing in the learner's native language only when necessary for explanations.
- Adjust your language level based on the learner's apparent proficiency.
- Keep responses concise (2-4 sentences typically) to maintain conversational flow.
- Naturally correct mistakes the learner makes using the "correct_mistake" tool.
- Periodically quiz the learner using the "create_quiz" tool based on vocabulary or grammar used in the conversation.
- If the learner writes in their native language, gently encourage switching to ${langName}.
- Base conversation topics on the media the learner is consuming — discuss scenes, character actions, plot, and themes rather than generic topics like weather or hobbies.

## Personality
- Patient, encouraging, and warm.
- Use natural, colloquial ${langName} — not textbook language.
- Celebrate progress and good usage.
- When the learner struggles, simplify rather than switch languages entirely.

## Tool Usage Guidelines
- Use "correct_mistake" when you notice grammar, vocabulary, or spelling errors in the learner's messages. Attach it to your response subtly.
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

// ============================================================================
// Tool Definitions
// ============================================================================

const AGENT_TOOLS: OllamaToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'correct_mistake',
      description: 'Correct a grammatical, vocabulary, or spelling mistake the learner made in their message.',
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
          affected_pattern: {
            type: 'string',
            description: 'The grammar pattern related to this error, if any (e.g., "てform", "は vs が")',
          },
        },
        required: ['error_span', 'correction', 'error_type'],
      },
    },
  },
  {
    type: 'function',
    function: {
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
  },
  {
    type: 'function',
    function: {
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
  },
  {
    type: 'function',
    function: {
      name: 'get_media_stats',
      description: 'Retrieve the learner\'s analytics and statistics for the media they are currently consuming. Returns failed words, grammar points, level percentages, and assessed difficulty.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
];

// ============================================================================
// Inline Tool Call Parser
// ============================================================================

/**
 * Parse inline tool calls from LLM text output.
 * Many models (especially smaller ones) don't produce structured tool_calls in
 * the Ollama response. Instead they embed calls directly in the text, e.g.:
 *
 *   [correct_mistake original="test" correction="テスト"]
 *   [create_quiz quiz_type="mcq" question="..." options=["a","b","c"] correct_answer="a"]
 *
 * This parser extracts them, returning the cleaned text and parsed tool calls.
 */
function parseInlineToolCalls(text: string): { cleanedText: string; toolCalls: ToolCall[] } {
  const toolCalls: ToolCall[] = [];
  const toolNames = ['correct_mistake', 'create_quiz', 'fetch_url', 'get_media_stats'];

  // Build a pattern that matches [tool_name key="value" key="value" ...] or
  // [tool_namekey="value"key="value"] (no spaces between name and keys)
  // Also handles JSON-style values like options=["a","b"]
  const toolPattern = new RegExp(
    `\\[\\s*(${toolNames.join('|')})([^\\]]*?)\\]`,
    'g',
  );

  const cleanedText = text.replace(toolPattern, (_match, name: string, argsStr: string) => {
    const args: Record<string, unknown> = {};

    // Parse key="value" or key='value' pairs
    // Handle JSON array values like options=["a","b","c"]
    const kvPattern = /(\w+)\s*=\s*(?:\[([^\]]*)\]|"([^"]*)"|'([^']*)'|(\S+))/g;
    let kvMatch: RegExpExecArray | null;

    while ((kvMatch = kvPattern.exec(argsStr)) !== null) {
      const key = kvMatch[1];
      if (kvMatch[2] !== undefined) {
        // Array value: parse JSON-like ["a","b","c"]
        try {
          args[key] = JSON.parse(`[${kvMatch[2]}]`);
        } catch {
          args[key] = kvMatch[2];
        }
      } else {
        args[key] = kvMatch[3] ?? kvMatch[4] ?? kvMatch[5];
      }
    }

    // Map common key variants to the expected parameter names
    const normalized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args)) {
      const normalizedKey = k
        .replace(/^original$/, 'error_span')
        .replace(/^errorSpan$/, 'error_span')
        .replace(/^errorType$/, 'error_type')
        .replace(/^affectedPattern$/, 'affected_pattern')
        .replace(/^quizType$/, 'quiz_type')
        .replace(/^correctAnswer$/, 'correct_answer');
      normalized[normalizedKey] = v;
    }

    toolCalls.push({
      id: `tc_inline_${Date.now()}_${toolCalls.length}`,
      name,
      arguments: normalized,
    });

    return ''; // Remove the inline tool call from text
  });

  return { cleanedText: cleanedText.trim(), toolCalls };
}

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

async function tokenizeText(text: string, langCode: string): Promise<Token[]> {
  try {
    const response = await fetch(API_ENDPOINTS.tokenize, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, language: langCode }),
    });

    if (!response.ok) return [];

    const data = await response.json();
    return (data.tokens || data) as Token[];
  } catch {
    return [];
  }
}

// ============================================================================
// Agent Factory
// ============================================================================

export function createConversationAgent(deps: AgentDeps): AgentInstance {
  let conversationHistory: OllamaChatMessage[] = [];
  let aborted = false;
  let streamCleanup: (() => void) | null = null;

  function clearHistory(): void {
    conversationHistory = [];
  }

  function abortStream(): void {
    aborted = true;
    streamCleanup?.();
    streamCleanup = null;
    window.mLearnIPC?.ollamaChatStreamAbort();
  }

  /**
   * Process tool calls from the Ollama response.
   * Widget-producing tools return a widget; response-producing tools
   * add their results to the conversation history and trigger a follow-up request.
   */
  async function handleToolCalls(
    rawToolCalls: Array<{ function: { name: string; arguments: Record<string, unknown> } }>,
    accumulatedContent: string,
    callbacks: StreamCallbacks,
    language: string,
    langName: string,
  ): Promise<void> {
    let widget: ChatWidget | undefined;
    const toolResponses: OllamaChatMessage[] = [];

    // Add the assistant message (with tool_calls and any text content) to history
    const assistantMsg: OllamaChatMessage = {
      role: 'assistant',
      content: accumulatedContent,
      tool_calls: rawToolCalls,
    };
    conversationHistory.push(assistantMsg);

    for (const tc of rawToolCalls) {
      const parsed: ToolCall = {
        id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: tc.function.name,
        arguments: tc.function.arguments || {},
      };

      // Try widget-producing tools first
      const w = executeTool(parsed, deps);
      if (w) {
        widget = w;
        callbacks.onToolCall(w);
        // Add a tool response acknowledging the widget was created
        toolResponses.push({
          role: 'tool',
          content: `Tool ${parsed.name} executed successfully.`,
          tool_name: parsed.name,
        });
      } else {
        // Response-producing tools (fetch_url, get_media_stats)
        const result = await executeToolWithResponse(parsed, deps);
        if (result !== null) {
          toolResponses.push({
            role: 'tool',
            content: result,
            tool_name: parsed.name,
          });
        }
      }
    }

    // Add tool responses to history
    for (const tr of toolResponses) {
      conversationHistory.push(tr);
    }

    // If we have tool responses that need a follow-up (response-producing tools),
    // send another request so the model can incorporate the tool results
    if (aborted) return;

    // Always do a follow-up after tool calls so the model can respond naturally
    startStream(callbacks, language, langName, widget);
  }

  /**
   * Start a streaming request to Ollama
   */
  function startStream(
    callbacks: StreamCallbacks,
    language: string,
    langName: string,
    existingWidget?: ChatWidget,
  ): void {
    const mediaCtx = deps.getMediaContext();
    const sceneCtx = deps.getSceneContext();

    const systemMsg: OllamaChatMessage = {
      role: 'system',
      content: buildSystemPrompt(language, langName, mediaCtx, sceneCtx || undefined),
    };

    const ollamaMessages: OllamaChatMessage[] = [
      systemMsg,
      ...conversationHistory,
    ];

    let accumulated = '';
    let toolCalls: Array<{ function: { name: string; arguments: Record<string, unknown> } }> | undefined;
    let widget = existingWidget;
    const requestStartTime = Date.now();
    let firstTokenTime = 0;

    streamCleanup = window.mLearnIPC!.onOllamaChatStream((chunk) => {
      if (aborted) return;

      if (chunk.content) {
        if (!firstTokenTime) firstTokenTime = Date.now();
        accumulated += chunk.content;
        callbacks.onChunk(accumulated);
      }
      if (chunk.tool_calls) {
        toolCalls = chunk.tool_calls as Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
      }
      if (chunk.done) {
        streamCleanup?.();
        streamCleanup = null;

        if (aborted) return;

        // Build stream stats from Ollama response or local timing
        const doneTime = Date.now();
        const timeToFirstToken = firstTokenTime ? firstTokenTime - requestStartTime : doneTime - requestStartTime;
        const totalTime = doneTime - requestStartTime;
        let tokensPerSecond = 0;
        if (chunk.eval_count && chunk.eval_duration) {
          // eval_duration is in nanoseconds
          tokensPerSecond = chunk.eval_count / (chunk.eval_duration / 1e9);
        }
        const streamStats: StreamStats = { timeToFirstToken, totalTime, tokensPerSecond };

        // Handle structured tool calls
        if (toolCalls && toolCalls.length > 0) {
          handleToolCalls(toolCalls, accumulated, callbacks, language, langName).catch((err) => {
            callbacks.onError(`Tool execution failed: ${(err as Error).message}`);
          });
          return;
        }

        // Parse inline tool calls from text (fallback for models that don't produce structured tool_calls)
        if (!widget) {
          const { cleanedText, toolCalls: inlineToolCalls } = parseInlineToolCalls(accumulated);
          if (inlineToolCalls.length > 0) {
            accumulated = cleanedText;
            callbacks.onChunk(accumulated);
            for (const tc of inlineToolCalls) {
              const w = executeTool(tc, deps);
              if (w) {
                widget = w;
                callbacks.onToolCall(w);
              }
            }
            // Handle response-producing inline tools
            (async () => {
              for (const tc of inlineToolCalls) {
                const result = await executeToolWithResponse(tc, deps);
                if (result !== null) {
                  conversationHistory.push({
                    role: 'tool',
                    content: result,
                    tool_name: tc.name,
                  });
                }
              }
            })();
          }
        }

        // Add assistant response to history
        conversationHistory.push({ role: 'assistant', content: accumulated });

        // Tokenize the response for interactive rendering
        tokenizeText(accumulated, language).then((tokens) => {
          if (aborted) return;
          const finalTokens = tokens.length > 0 ? tokens : undefined;
          callbacks.onDone(accumulated, finalTokens, widget, streamStats);
        }).catch(() => {
          if (!aborted) {
            callbacks.onDone(accumulated, undefined, widget, streamStats);
          }
        });
      }
    });

    window.mLearnIPC!.ollamaChatStream(ollamaMessages, AGENT_TOOLS);

    // Timeout after 90 seconds
    setTimeout(() => {
      if (streamCleanup && !aborted) {
        streamCleanup();
        streamCleanup = null;
        if (accumulated) {
          conversationHistory.push({ role: 'assistant', content: accumulated });
          tokenizeText(accumulated, language).then((tokens) => {
            callbacks.onDone(accumulated, tokens.length > 0 ? tokens : undefined, widget);
          }).catch(() => {
            callbacks.onDone(accumulated, undefined, widget);
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
