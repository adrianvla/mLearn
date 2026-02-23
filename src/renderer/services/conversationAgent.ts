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
  WordFrequencyEntry,
  VoiceMistake,
  TutorSessionConfig,
} from '../../shared/types';
import { getBridge } from '../../shared/bridges';
import { getBackend } from '../../shared/backends';

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
  /** Look up the frequency level of a word (returns null if no data) */
  getFrequency?: (word: string) => WordFrequencyEntry | null;
  /** Target proficiency level (1-5) for output adaptation, or null if disabled */
  getTargetLevel?: () => number | null;
  /** Get the display name for a frequency level number */
  getLevelName?: (level: number) => string;
  /** Whether voice mode is active — uses voice-specific tools and prompt */
  isVoiceMode?: () => boolean;
  /** Callback for voice-mode mistake tracking (lowers ease) */
  onVoiceMistake?: (mistake: VoiceMistake) => void;
  /** Tutor session configuration (grammar, words, media, custom instructions) */
  getTutorConfig?: () => TutorSessionConfig | null;
}

/** Callback for streaming chunks to the UI */
export interface StreamCallbacks {
  onChunk: (accumulated: string) => void;
  onToolCall: (widget: ChatWidget) => void;
  onDone: (finalContent: string, tokens: Token[] | undefined, widgets: ChatWidget[] | undefined, streamStats?: StreamStats) => void;
  onError: (error: string) => void;
}

export interface AgentInstance {
  processMessage: (text: string, history: ConversationMessage[], callbacks: StreamCallbacks) => void;
  abortStream: () => void;
  clearHistory: () => void;
  /** Tokenize arbitrary text using the backend tokenizer */
  tokenize: (text: string) => Promise<Token[]>;
  /** Continue the conversation with context (e.g., quiz result) without a visible user message */
  continueWithContext: (context: string, callbacks: StreamCallbacks) => void;
  /** Replace the last assistant message in history with the truncated spoken text and add interruption context */
  markInterrupted: (spokenText: string) => void;
}

// ============================================================================
// System Prompt Builder
// ============================================================================

function buildSystemPrompt(_langCode: string, langName: string, mediaCtx: ConversationAgentContext | null, userSceneContext?: string, targetLevelName?: string, tutorConfig?: TutorSessionConfig | null): string {
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
- Do not quiz the reader on character readings if ${langName} has any. 

## Personality
- Patient, encouraging, and warm.
- Use natural, colloquial ${langName} — not textbook language.
- Celebrate progress and good usage.
- When the learner struggles, simplify rather than switch languages entirely.

## Tool Usage Guidelines
- Use "correct_mistake" when you notice grammar, vocabulary, or spelling errors in the learner's messages. Attach it to your response subtly.
  - If the learner makes multiple mistakes, use a single "correct_mistake" call with all corrections in the "corrections" array.
  - If the learner explicitly asks you to call a tool or to mark/correct a specific span, you MUST call the appropriate tool even for meta/tool-testing requests and even when the text is not in ${langName}.
  - IMPORTANT: The error_span must be copied EXACTLY from the learner's message. Do not translate or alter it.
  - When the same word or phrase appears multiple times in the learner's message, provide context_before and/or context_after to identify which occurrence to correct.
  - Only correct actual mistakes in the target language; do not "correct" text that is already correct or translate it.
- Use "create_quiz" when a good teaching moment arises. Vary between MCQ, text-input, and fill-in types. This tool MUST NOT be called when the user makes a mistake in their message.
- When making multiple quizzes in one turn, call "create_quiz" multiple times in the exact order they should appear.
- "correct_mistake" must ALWAYS be called at the very end of your response.
- "correct_mistake" must ALWAYS be called if the user makes a mistake.
- If you want to create a quiz, do NOT write in plain text the quiz, but USE the tool "create_quiz" accordingly.
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

  // Level adaptation: instruct the model to restrict vocabulary
  if (targetLevelName) {
    prompt += `\n\n## Vocabulary Level Restriction
IMPORTANT: The learner's proficiency level is set to "${targetLevelName}". You MUST restrict your vocabulary to words at or below this level. Do not use words that are above this proficiency level. If you need to express a complex idea, rephrase it using simpler vocabulary that fits within the "${targetLevelName}" level. This applies to all your responses in ${langName}.`;
  }

  // Tutor session configuration (from welcome page setup)
  if (tutorConfig) {
    if (tutorConfig.selectedGrammar.length > 0) {
      const grammarList = tutorConfig.selectedGrammar
        .map((g) => `- ${g.pattern}${g.meaning ? ` (${g.meaning})` : ''}${g.level ? ` [${g.level}]` : ''}`)
        .join('\n');
      prompt += `\n\n## Grammar Focus
The learner wants to practice these grammar points. Incorporate them naturally into the conversation and quiz on them:
${grammarList}`;
    }

    if (tutorConfig.selectedWords.length > 0) {
      const wordList = tutorConfig.selectedWords
        .map((w) => `- ${w.word}${w.reading ? ` (${w.reading})` : ''} — ease: ${w.ease.toFixed(1)}`)
        .join('\n');
      prompt += `\n\n## Vocabulary Focus
The learner wants to practice these words. Use them in conversation and quiz on the ones with lower ease:
${wordList}`;
    }

    if (tutorConfig.selectedMedia.length > 0) {
      for (const media of tutorConfig.selectedMedia) {
        prompt += `\n\n## Media: "${media.mediaName}" (${media.mediaType})`;

        if (media.failedWords.length > 0) {
          const words = media.failedWords.map((w) => w.word).join(', ');
          prompt += `\nStruggled words from this media: ${words}`;
        }

        if (media.failedGrammar.length > 0) {
          const grammar = media.failedGrammar.map((g) => g.pattern).join(', ');
          prompt += `\nStruggled grammar from this media: ${grammar}`;
        }
      }
    }

    if (tutorConfig.customInstructions) {
      prompt += `\n\n## Session Instructions (provided by the learner)
The learner has specific instructions for this session. Follow them:
${tutorConfig.customInstructions}`;
    }
  }

  return prompt;
}

// ============================================================================
// Tool Definitions
// ============================================================================

const AGENT_TOOLS: LLMToolDefinition[] = [
  {
    name: 'correct_mistake',
    description: 'Correct one or more grammatical, vocabulary, or spelling mistakes the learner made in their message. Use the "corrections" array to batch multiple corrections into a single call.',
    parameters: {
      type: 'object',
      properties: {
        corrections: {
          type: 'array',
          description: 'Array of corrections. Each item corrects one mistake in the learner\'s message.',
          items: {
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
                description: 'The grammar pattern related to this error, if any',
              },
            },
            required: ['error_span', 'correction', 'error_type'],
          },
        },
      },
      required: ['corrections'],
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
          enum: ['mcq', 'text-input', 'fill-in'],
          description: 'Type of quiz: multiple choice, text-input, or fill-in-the-blank phrase',
        },
        question: {
          type: 'string',
          description: 'The quiz question',
        },
        text_with_blanks: {
          type: 'string',
          description: 'For fill-in quizzes only: phrase with [] placeholder(s), e.g., "I am eating an []"',
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
// Voice-Mode Tool Definitions
// ============================================================================

const VOICE_AGENT_TOOLS: LLMToolDefinition[] = [
  {
    name: 'note_mistake',
    description: 'Note a spoken mistake the learner made during the voice conversation. Call this for every pronunciation, grammar, or vocabulary error. It will lower the ease of the affected word and show in the session aftermath. MUST be called at the end of your response if the learner made a mistake.',
    parameters: {
      type: 'object',
      properties: {
        word: {
          type: 'string',
          description: 'The word or short phrase the learner said incorrectly',
        },
        reading: {
          type: 'string',
          description: 'The correct reading/pronunciation if applicable (for languages with phonetic readings)',
        },
        context: {
          type: 'string',
          description: 'The full sentence or phrase the learner was trying to say',
        },
        correction: {
          type: 'string',
          description: 'What the learner should have said instead',
        },
        type: {
          type: 'string',
          enum: ['pronunciation', 'grammar', 'vocabulary', 'usage'],
          description: 'Category of the mistake',
        },
      },
      required: ['word', 'context', 'correction', 'type'],
    },
  },
  {
    name: 'fetch_url',
    description: 'Fetch and retrieve content from a URL. Use this to look up grammar explanations or language resources online if the learner asks about a specific topic.',
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
    description: 'Retrieve the learner\'s analytics and statistics for the media they are currently consuming.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

// ============================================================================
// Voice-Mode System Prompt
// ============================================================================

function buildVoiceSystemPrompt(langName: string, mediaCtx: ConversationAgentContext | null): string {
  let prompt = `You are a friendly, natural-sounding language tutor for ${langName} in a live voice conversation.

## Rules
- Respond ONLY in ${langName}.
- Keep responses SHORT — 1-3 sentences max. You are in a voice call, not writing an essay.
- Adjust your language to the learner's level.
- Do NOT use emojis.
- Do NOT use interaction markers like [chuckles], [laughs], *smiles*, etc.
- Do NOT use asterisks for emphasis or actions.
- Speak naturally and conversationally, as if chatting with a friend.
- If the learner makes a mistake, gently mention the correction in your speech AND call the "note_mistake" tool.
- The "note_mistake" tool MUST be called at the END of your response whenever the learner makes an error.
- Do NOT correct speech patterns that are valid informal/casual variations. Only correct actual mistakes.
- If your previous message contains "[interrupted by user]", it means the learner interrupted you mid-speech. Do NOT repeat or reference the interrupted content. Simply continue the conversation naturally from where the learner picks up.

## Personality
- Patient, warm, encouraging.
- Use natural spoken ${langName}, not textbook language.
- Keep the conversation flowing — ask follow-up questions.`;

  if (mediaCtx) {
    prompt += `\n\n## Current Media Context
The learner is ${mediaCtx.mediaType === 'video' ? 'watching' : 'reading'}: "${mediaCtx.mediaName}"`;

    if (mediaCtx.failedWords.length > 0) {
      const topFailed = mediaCtx.failedWords
        .sort((a, b) => a.ease - b.ease)
        .slice(0, 10)
        .map((w) => w.word);
      prompt += `\nWords the learner struggles with: ${topFailed.join(', ')}`;
    }
  }

  return prompt;
}

// ============================================================================
// Tool Execution
// ============================================================================

/**
 * Parse a single correction entry from tool call arguments.
 */
function parseCorrectionEntry(
  entry: Record<string, unknown>,
  deps: AgentDeps,
): MistakeWidgetData {
  const data: MistakeWidgetData = {
    userMessageIndex: -1,
    errorSpan: (entry.error_span as string) || '',
    correction: (entry.correction as string) || '',
    errorType: (entry.error_type as 'grammar' | 'word' | 'typo' | 'other') || 'other',
    affectedPattern: entry.affected_pattern as string | undefined,
    contextBefore: entry.context_before as string | undefined,
    contextAfter: entry.context_after as string | undefined,
  };

  if (data.affectedPattern) {
    deps.flashcardCtx.trackGrammarFailed(data.affectedPattern);
  }

  return data;
}

function executeTool(toolCall: ToolCall, deps: AgentDeps): ChatWidget | ChatWidget[] | null {
  const args = toolCall.arguments;

  switch (toolCall.name) {
    case 'correct_mistake': {
      const rawCorrections = args.corrections as Record<string, unknown>[] | undefined;

      // Support the batched corrections array
      if (rawCorrections && Array.isArray(rawCorrections) && rawCorrections.length > 0) {
        return rawCorrections.map((entry) => ({
          type: 'mistake' as const,
          data: parseCorrectionEntry(entry, deps) as unknown as Record<string, unknown>,
        }));
      }

      // Fallback: LLM sent flat single-correction fields (backward compat)
      const data = parseCorrectionEntry(args, deps);
      if (!data.errorSpan) return null;

      return { type: 'mistake', data: data as unknown as Record<string, unknown> };
    }

    case 'note_mistake': {
      // Voice mode mistake — report to the callback for aftermath tracking
      const mistake: VoiceMistake = {
        word: (args.word as string) || '',
        reading: args.reading as string | undefined,
        context: (args.context as string) || '',
        correction: (args.correction as string) || '',
        type: (args.type as VoiceMistake['type']) || 'vocabulary',
      };
      deps.onVoiceMistake?.(mistake);
      return null;
    }

    case 'create_quiz': {
      const rawQuizType = ((args.quiz_type as string) || 'mcq').trim();
      const textWithBlanks = (args.text_with_blanks as string | undefined)?.trim();
      const quizType: QuizWidgetData['type'] = rawQuizType === 'fill-in' && !textWithBlanks
        ? 'text-input'
        : (rawQuizType as QuizWidgetData['type']);

      const data: QuizWidgetData = {
        type: quizType,
        question: (args.question as string) || '',
        textWithBlanks,
        options: args.options as string[] | undefined,
        correctAnswer: (args.correct_answer as string) || '',
        affectedPattern: args.affected_pattern as string | undefined,
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
    case 'create_quiz': {
      const question = (args.question as string | undefined)?.trim();
      return question
        ? `Quiz created for learner: ${question}`
        : 'Quiz created for learner.';
    }

    case 'note_mistake': {
      return `Mistake noted: "${args.word}" → "${args.correction}"`;
    }

    case 'fetch_url': {
      const url = args.url as string;
      if (!url) return 'Error: No URL provided';
      try {
        const result = await getBridge().generic.fetchUrl(url);
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

const TOKENIZE_TIMEOUT_MS = 5000;

async function tokenizeText(text: string, langCode: string): Promise<Token[]> {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TOKENIZE_TIMEOUT_MS);

  try {
    const tokens = await getBackend().tokenize(text, langCode);
    return tokens;
  } catch {
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============================================================================
// Content-based Tool Call Parsing
// ============================================================================

/** Known tool names that the agent can call */
const KNOWN_TOOL_NAMES = new Set([...AGENT_TOOLS.map((t) => t.name), ...VOICE_AGENT_TOOLS.map((t) => t.name)]);

/**
 * Parse tool calls that appear as plain text in the model's response.
 * Some models output tool calls as `function_name({ ... })` in their content
 * instead of using structured tool calling. This parser detects and extracts them.
 *
 * Returns the cleaned content (with tool call text removed) and any parsed tool calls.
 */
function parseToolCallsFromContent(content: string): { cleanedContent: string; toolCalls: ToolCall[] } {
  const toolCalls: ToolCall[] = [];

  let cleanedContent = content;
  let match: RegExpExecArray | null;

  // Strip `interruptedbyuser` markers (emitted inline when the user interrupts TTS)
  cleanedContent = cleanedContent.replace(/\s*interruptedbyuser\s*/g, ' ');

  // Pattern 1: tool_name({ ... }) — with parentheses
  const toolCallPattern = new RegExp(
    `(${Array.from(KNOWN_TOOL_NAMES).join('|')})\\s*\\(\\s*(\\{[\\s\\S]*?\\})\\s*\\)`,
    'g',
  );

  const matches: { fullMatch: string; name: string; argsStr: string }[] = [];
  while ((match = toolCallPattern.exec(cleanedContent)) !== null) {
    matches.push({ fullMatch: match[0], name: match[1], argsStr: match[2] });
  }

  // Pattern 2: tool_name{ ... } — without parentheses (some models emit this)
  const toolCallNoParen = new RegExp(
    `(${Array.from(KNOWN_TOOL_NAMES).join('|')})\\s*(\\{[\\s\\S]*?\\})`,
    'g',
  );
  while ((match = toolCallNoParen.exec(cleanedContent)) !== null) {
    // Avoid duplicates from pattern 1 (which would include parentheses)
    if (!matches.some((m) => m.fullMatch.includes(match![0]))) {
      matches.push({ fullMatch: match[0], name: match[1], argsStr: match[2] });
    }
  }

  for (const { fullMatch, name, argsStr } of matches) {
    try {
      const args = JSON.parse(argsStr) as Record<string, unknown>;
      toolCalls.push({
        id: `parsed_${Date.now()}_${toolCalls.length}`,
        name,
        arguments: args,
      });
      cleanedContent = cleanedContent.replace(fullMatch, '');
    } catch {
      // If JSON parsing fails, leave the text in place
    }
  }

  // Clean up residual whitespace from removed tool calls
  cleanedContent = cleanedContent.replace(/\n{3,}/g, '\n\n').trim();

  return { cleanedContent, toolCalls };
}

// ============================================================================
// Level Adaptation
// ============================================================================

const MAX_REFORMULATION_ATTEMPTS = 3;

/**
 * Find words in the tokenized response that exceed the target proficiency level.
 * Returns an array of { word, level } entries for words that are too difficult.
 */
function findDifficultWords(
  tokens: Token[],
  targetLevel: number,
  getFrequency: (word: string) => WordFrequencyEntry | null,
): Array<{ word: string; level: number; levelName: string }> {
  const seen = new Set<string>();
  const difficult: Array<{ word: string; level: number; levelName: string }> = [];

  for (const token of tokens) {
    const lookupWord = token.actual_word || token.word;
    if (!lookupWord || seen.has(lookupWord)) continue;
    seen.add(lookupWord);

    const freq = getFrequency(lookupWord);
    if (!freq) continue; // Unknown frequency — don't flag

    // Higher raw_level = easier (5 = easiest, 1 = hardest)
    // If the word's level is below the target, it's too difficult
    if (freq.raw_level < targetLevel) {
      difficult.push({ word: lookupWord, level: freq.raw_level, levelName: freq.level });
    }
  }

  return difficult;
}

/**
 * Stream a reformulation request to simplify difficult words.
 * Returns the reformulated text via a promise.
 */
function streamReformulation(
  originalText: string,
  difficultWords: Array<{ word: string; levelName: string }>,
  targetLevelName: string,
  langName: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const bridge = getBridge();

    const wordList = difficultWords.map((w) => `"${w.word}"`).join(', ');

    const systemMsg: LLMChatMessage = {
      role: 'system',
      content: `You are a text simplifier for ${langName} language learning. Your ONLY job is to rewrite the given text, replacing words that are too advanced with simpler alternatives appropriate for the specified proficiency level. Keep the meaning, tone, and structure as close to the original as possible. Do NOT add explanations, commentary, or anything else — output ONLY the rewritten text.`,
    };

    const userMsg: LLMChatMessage = {
      role: 'user',
      content: `Rewrite the following ${langName} text so it only uses vocabulary at or below "${targetLevelName}" level. Replace these words that are too difficult: ${wordList}.\n\nOriginal text:\n${originalText}`,
    };

    let accumulated = '';

    const cleanup = bridge.llm.onLLMStreamChunk((chunk: LLMStreamChunk) => {
      if (chunk.error) {
        cleanup();
        reject(new Error(chunk.error));
        return;
      }
      if (chunk.content) {
        accumulated += chunk.content;
      }
      if (chunk.done) {
        cleanup();
        resolve(accumulated.trim());
      }
    });

    bridge.llm.llmStream([systemMsg, userMsg], []);
  });
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
    getBridge().llm.llmStreamAbort();
  }

  /**
   * After the LLM produces its final content, check if level adaptation is needed.
   * If target level is set and difficult words are found, iteratively reformulate.
   * Then tokenize and call the done callback.
   */
  async function finalizeResponse(
    content: string,
    language: string,
    langName: string,
    widgets: ChatWidget[],
    callbacks: StreamCallbacks,
    streamStats?: StreamStats,
  ): Promise<void> {
    if (aborted) return;

    const targetLevel = deps.getTargetLevel?.() ?? null;
    const getFrequency = deps.getFrequency;
    let finalContent = content;

    if (targetLevel !== null && getFrequency) {
      const targetLevelName = deps.getLevelName?.(targetLevel) ?? `Level ${targetLevel}`;

      for (let attempt = 0; attempt < MAX_REFORMULATION_ATTEMPTS; attempt++) {
        if (aborted) return;

        const tokens = await tokenizeText(finalContent, language);
        if (tokens.length === 0) break;

        const difficult = findDifficultWords(tokens, targetLevel, getFrequency);
        if (difficult.length === 0) break;

        try {
          const reformulated = await streamReformulation(
            finalContent,
            difficult,
            targetLevelName,
            langName,
          );
          if (reformulated && reformulated !== finalContent) {
            finalContent = reformulated;
            callbacks.onChunk(finalContent);
          } else {
            break; // No change — stop iterating
          }
        } catch {
          break; // Reformulation failed — use what we have
        }
      }

      // Update conversation history with the adapted content
      const lastMsg = conversationHistory[conversationHistory.length - 1];
      if (lastMsg?.role === 'assistant') {
        lastMsg.content = finalContent;
      }
    }

    const tokens = await tokenizeText(finalContent, language).catch(() => [] as Token[]);
    if (aborted) return;
    const finalTokens = tokens.length > 0 ? tokens : undefined;
    callbacks.onDone(finalContent, finalTokens, widgets.length > 0 ? widgets : undefined, streamStats);
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
    existingWidgets: ChatWidget[] = [],
    deferredTerminalToolCalls: ToolCall[] = [],
  ): Promise<void> {
    const widgets: ChatWidget[] = [...existingWidgets];
    const toolResponses: LLMChatMessage[] = [];
    const nonTerminalToolCalls: ToolCall[] = [];
    const terminalToolCalls: ToolCall[] = [];

    for (const toolCall of toolCalls) {
      if (toolCall.name === 'correct_mistake' || toolCall.name === 'note_mistake') {
        terminalToolCalls.push(toolCall);
      } else {
        nonTerminalToolCalls.push(toolCall);
      }
    }

    const allDeferredTerminalCalls = [...deferredTerminalToolCalls, ...terminalToolCalls];

    // Add the assistant message to history
    const assistantMsg: LLMChatMessage = {
      role: 'assistant',
      content: assistantSegmentContent,
      toolCalls,
    };
    conversationHistory.push(assistantMsg);

    for (const tc of nonTerminalToolCalls) {
      // Try widget-producing tools first
      const w = executeTool(tc, deps);
      if (w) {
        const widgetList = Array.isArray(w) ? w : [w];
        for (const widget of widgetList) {
          widgets.push(widget);
          callbacks.onToolCall(widget);
        }
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

    // Non-terminal tools require a follow-up model pass after execution.
    // Only terminal-only (correct_mistake) flow can finalize immediately.
    if (nonTerminalToolCalls.length === 0) {
      for (const terminalCall of allDeferredTerminalCalls) {
        const terminalWidget = executeTool(terminalCall, deps);
        if (terminalWidget) {
          const widgetList = Array.isArray(terminalWidget) ? terminalWidget : [terminalWidget];
          for (const w of widgetList) {
            widgets.push(w);
            callbacks.onToolCall(w);
          }
        }
      }

      // Finalize with level adaptation if needed
      finalizeResponse(visibleContent, language, langName, widgets, callbacks, streamStats).catch(() => {
        if (!aborted) {
          callbacks.onDone(visibleContent, undefined, widgets.length > 0 ? widgets : undefined, streamStats);
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
    startStream(callbacks, language, langName, widgets, visibleContent, allDeferredTerminalCalls);
  }

  /**
   * Start a streaming request through the unified LLM router
   */
  function startStream(
    callbacks: StreamCallbacks,
    language: string,
    langName: string,
    existingWidgets: ChatWidget[] = [],
    contentPrefix = '',
    deferredTerminalToolCalls: ToolCall[] = [],
  ): void {
    const bridge = getBridge();

    const mediaCtx = deps.getMediaContext();
    const sceneCtx = deps.getSceneContext();

    const isVoice = deps.isVoiceMode?.() ?? false;
    const tools = isVoice ? VOICE_AGENT_TOOLS : AGENT_TOOLS;

    const targetLevel = deps.getTargetLevel?.() ?? null;
    const targetLevelName = targetLevel !== null ? (deps.getLevelName?.(targetLevel) ?? undefined) : undefined;

    const tutorCfg = deps.getTutorConfig?.() ?? null;

    const systemMsg: LLMChatMessage = {
      role: 'system',
      content: isVoice
        ? buildVoiceSystemPrompt(langName, mediaCtx)
        : buildSystemPrompt(language, langName, mediaCtx, sceneCtx || undefined, targetLevelName, tutorCfg),
    };

    const messages: LLMChatMessage[] = [
      systemMsg,
      ...conversationHistory,
    ];

    let accumulated = '';
    const collectedToolCalls: ToolCall[] = [];
    const widgets = [...existingWidgets];
    const requestStartTime = Date.now();
    let firstTokenTime = 0;

    streamCleanup = bridge.llm.onLLMStreamChunk((chunk: LLMStreamChunk) => {
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
            widgets,
            deferredTerminalToolCalls,
          ).catch((err) => {
            callbacks.onError(`Tool execution failed: ${(err as Error).message}`);
          });
          return;
        }

        // Fallback: detect tool calls emitted as plain text in the content
        const { cleanedContent: parsedClean, toolCalls: parsedToolCalls } = parseToolCallsFromContent(accumulated);
        if (parsedToolCalls.length > 0) {
          // Update the UI with the cleaned content (tool call text removed)
          const visibleContent = contentPrefix + parsedClean;
          callbacks.onChunk(visibleContent);

          handleToolCalls(
            parsedToolCalls,
            visibleContent,
            callbacks,
            language,
            langName,
            streamStats,
            parsedClean,
            widgets,
            deferredTerminalToolCalls,
          ).catch((err) => {
            callbacks.onError(`Tool execution failed: ${(err as Error).message}`);
          });
          return;
        }

        if (deferredTerminalToolCalls.length > 0) {
          for (const terminalCall of deferredTerminalToolCalls) {
            const terminalWidget = executeTool(terminalCall, deps);
            if (terminalWidget) {
              const widgetList = Array.isArray(terminalWidget) ? terminalWidget : [terminalWidget];
              for (const w of widgetList) {
                widgets.push(w);
                callbacks.onToolCall(w);
              }
            }
          }
        }

        // Add assistant response to history
        conversationHistory.push({ role: 'assistant', content: accumulated });

        const finalVisibleContent = contentPrefix + accumulated;

        // Finalize with level adaptation and tokenization
        finalizeResponse(finalVisibleContent, language, langName, widgets, callbacks, streamStats).catch(() => {
          if (!aborted) {
            callbacks.onDone(finalVisibleContent, undefined, widgets.length > 0 ? widgets : undefined, streamStats);
          }
        });
      }
    });

    bridge.llm.llmStream(messages, tools);

    // Timeout after 90 seconds
    setTimeout(() => {
      if (streamCleanup && !aborted) {
        streamCleanup();
        streamCleanup = null;
        if (accumulated) {
          conversationHistory.push({ role: 'assistant', content: accumulated });
          const finalVisibleContent = contentPrefix + accumulated;
          finalizeResponse(finalVisibleContent, language, langName, widgets, callbacks).catch(() => {
            callbacks.onDone(finalVisibleContent, undefined, widgets.length > 0 ? widgets : undefined);
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

  function continueWithContext(context: string, callbacks: StreamCallbacks): void {
    const language = deps.getLanguage();
    const langName = deps.getLanguageName();
    aborted = false;
    conversationHistory.push({ role: 'user', content: context });
    startStream(callbacks, language, langName);
  }

  function markInterrupted(spokenText: string): void {
    // Find the last assistant message in history and replace with truncated spoken text
    for (let i = conversationHistory.length - 1; i >= 0; i--) {
      if (conversationHistory[i].role === 'assistant') {
        conversationHistory[i] = {
          ...conversationHistory[i],
          content: spokenText + ' [interrupted by user]',
        };
        break;
      }
    }
  }

  return { processMessage, abortStream, clearHistory, tokenize, continueWithContext, markInterrupted };
}
