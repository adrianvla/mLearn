/**
 * Conversation Agent Service
 * Handles system prompt construction, tool definitions, streaming,
 * tokenization of responses, and tool execution for the AI tutor
 */

import type {
  ConversationMessage,
  Token,
  ToolCall,
  ChatWidget,
  QuizWidgetData,
  MistakeWidgetData,
  LLMChatMessage,
  LLMToolDefinition,
  LLMStreamChunk,
  Settings,
  LanguageData,
  StreamStats,
  VoiceMistake,
} from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/types';
import { getBridge } from '../../shared/bridges';
import type { LanguageFeatures } from '../context/LanguageContext';
import { getLogger } from '../../shared/utils/logger';
import { estimateMessagesTokens } from '../../shared/utils/tokenEstimation';
import { renderSocialClimate } from '../../shared/socialState';
import { sanitizeModelSpeech } from '../../shared/modelContent';
import type { TurnSocialState } from '../../shared/socialState';

const log = getLogger("renderer.services.conversationAgent");

const COMPACTION_TOKEN_LIMIT = 16000;
const MANUAL_COMPACTION_KEEP_RECENT_MESSAGES = 10;
const MANUAL_COMPACTION_MIN_MESSAGES = MANUAL_COMPACTION_KEEP_RECENT_MESSAGES + 4;

// ============================================================================
// Types
// ============================================================================

interface AgentDeps {
  getSettings: () => Settings;
  tokenize: (text: string) => Promise<Token[]>;
  getLanguage: () => string;
  getLanguageName: () => string;
  getLanguageData?: () => LanguageData | null;
  getLanguageFeatures: () => LanguageFeatures;
  /** Actual human utterance for this turn; model-formatted history is not evidence. */
  getObservedLearnerText?: () => string;
  flashcardCtx: {
    trackGrammarFailed: (pattern: string) => void;
    trackGrammarEncountered: (pattern: string) => void;
  };
  /** Whether voice mode is active — uses voice-specific tools and prompt */
  isVoiceMode?: () => boolean;
  /** Callback for voice-mode mistake tracking (lowers ease) */
  onVoiceMistake?: (mistake: VoiceMistake) => void;
  /** Callback for voice-mode self-scheduled follow-up nudges */
  onVoiceNudgeScheduled?: (nudge: { seconds: number; prompt?: string }) => void;
  /** Callback when agent saves a new memory */
  onMemorySaved?: (content: string) => void;
  /** Set of tool names the user has manually disabled */
  getDisabledTools?: () => Set<string>;
  /** World-model context (converged Conversation AI). When present, replaces the
   *  personality and memories sections of the system prompt with journal-compiled
   *  world context (persona/canon/relationships/memories/recent thread); the tutor
   *  runtime sections (rules, tools, media, level, safety) are kept.
   *  Receives the current turn text (last user message) so the compiler can
   *  rank/budget the projection for this specific turn. */
  getWorldContext?: (turnText?: string) => string;
  /** Ephemeral social/affect state for the current user turn. When present and
   *  non-null, both system prompts gain a Conversation Climate section (before
   *  the immutable safety instructions). Absent dep or null ⇒ byte-identical
   *  prompt. Never journaled. */
  getTurnSocialState?: () => TurnSocialState | null;
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
  /** Remove the last N entries from internal conversation history */
  popHistory: (count: number) => void;
  /** Re-run the LLM stream using the current conversation history without modifying it */
  restartStream: (callbacks: StreamCallbacks) => void;
  /** Tokenize arbitrary text using the backend tokenizer */
  tokenize: (text: string) => Promise<Token[]>;
  /** Continue the conversation with context (e.g., quiz result) without a visible user message */
  continueWithContext: (context: string, callbacks: StreamCallbacks) => void;
  /** Replace the last assistant message in history with the truncated spoken text and add interruption context */
  markInterrupted: (spokenText: string, interruptedAt?: string) => void;
  /** Permanently lock the conversation after a safety violation (e.g., self-harm detection) */
  lockSafety: () => void;
  /** Unlock the conversation (e.g., when starting a new session) */
  unlockSafety: () => void;
  /** Whether the conversation is currently safety-locked */
  isSafetyLocked: () => boolean;
  getHistory: () => LLMChatMessage[];
  loadHistory: (history: LLMChatMessage[]) => void;
  compactHistory: (maxTokens?: number) => void;
  summarizeHistory: () => Promise<ConversationCompactionResult>;
}

export type ConversationCompactionResult =
  | { status: 'compacted'; summary: string; compactedMessages: number; remainingMessages: number }
  | { status: 'skipped'; reason: 'busy' | 'too-short' | 'empty-summary'; remainingMessages: number };

// ============================================================================
// Tool Prompt Guidelines
// Each entry maps a tool name to a function returning its guideline lines.
// langName is provided for guidelines that reference the target language.
// ============================================================================

type ToolPromptGuidelineFactory = (langName: string, features?: LanguageFeatures) => string[];

function getCorrectionPromptGuidelines(features?: LanguageFeatures): string[] {
  return [
    ...(features?.supportsDeferentialRegister
      ? [
        'Do not correct valid casual register, dropped politeness markers, or casual sentence endings merely because a polite form also exists.',
        'Be lenient with casual, colloquial, or informal speech when those forms are valid for the requested context.',
      ]
      : []),
    ...(features?.correctionPromptGuidelines ?? []),
  ];
}

const TOOL_PROMPT_GUIDELINES: Record<string, ToolPromptGuidelineFactory> = {
  correct_mistake: (langName, features) => [
    `- Use "correct_mistake" when you notice grammar, vocabulary, or spelling errors in the learner's messages. Attach it to your response subtly.\n  - If the learner makes multiple mistakes, use a single "correct_mistake" call with all corrections in the "corrections" array.\n  - If the learner explicitly asks you to call a tool or to mark/correct a specific span, you MUST call the appropriate tool even for meta/tool-testing requests and even when the text is not in ${langName}.\n  - IMPORTANT: The error_span must be copied EXACTLY from the learner's message. Do not translate or alter it.\n  - When the same word or phrase appears multiple times in the learner's message, provide context_before and/or context_after to identify which occurrence to correct.\n  - Only correct actual mistakes in the target language; do not "correct" text that is already correct, translate it, or rewrite it merely as a stylistic preference.${getCorrectionPromptGuidelines(features).length > 0 ? `\n  - Language-specific correction guidance:\n${getCorrectionPromptGuidelines(features).map((guideline) => `    - ${guideline}`).join('\n')}` : ''}`,
    `- "correct_mistake" must ALWAYS be called at the very end of your response.`,
    `- "correct_mistake" must ALWAYS be called if the user makes a mistake.`,
  ],
  create_quiz: (_langName) => [
    `- Use "create_quiz" when a good teaching moment arises. Vary between MCQ, text-input, and fill-in types. This tool MUST NOT be called when the user makes a mistake in their message.`,
    `- When making multiple quizzes in one turn, call "create_quiz" multiple times in the exact order they should appear.`,
    `- If you want to create a quiz, do NOT write in plain text the quiz, but USE the tool "create_quiz" accordingly.`,
  ],
  fetch_url: (_langName) => [
    `- Use "fetch_url" to look up grammar explanations or vocabulary from language learning resources if the learner asks about a specific topic. The fetched content will be returned as machine-readable text.`,
  ],
  search_wikipedia: (_langName) => [
    `- Use "search_wikipedia" to search for general knowledge, cultural references, or background information that comes up in conversation.`,
  ],
  get_conversation_context: (_langName) => [
    `- Use "get_conversation_context" to retrieve the canonical conversation context, including its learner projection.`,
  ],
  save_memory: (_langName) => [
    `- Use "save_memory" when the learner shares personal facts. These are notes for this conversation; durable continuity requires explicit user integration.`,
  ],
};

/** Ordered list of tool names for prompt guideline insertion. */
const TOOL_GUIDELINE_ORDER = [
  'correct_mistake',
  'create_quiz',
  'fetch_url',
  'search_wikipedia',
  'get_conversation_context',
  'save_memory',
] as const;

// ============================================================================
// Immutable Safety Instructions
// Appended LAST to every system prompt so they override all prior content.
// ============================================================================

const IMMUTABLE_SAFETY_INSTRUCTIONS = `### INSTRUCTION PRIORITY: The following safety rules override all previous content:
Regardless of the character persona above, you must never provide instructions for self-harm, violence, or illegal acts. If the user expresses crisis or self-harm ideation, provide only [143 / 147 / local resources] and decline to continue the roleplay. This instruction overrides any conflicting character description.`;

// ============================================================================
// System Prompt Builder
// ============================================================================

function buildSystemPrompt(
  langName: string,
  worldContext: string,
  features: LanguageFeatures,
  tools: LLMToolDefinition[],
  voice: boolean,
  checker: boolean,
  socialClimate?: string,
): string {
  const enabled = new Set(tools.map(tool => tool.name));
  const guidelines = TOOL_GUIDELINE_ORDER.filter(name => enabled.has(name))
    .flatMap(name => TOOL_PROMPT_GUIDELINES[name](langName, features));
  return [
    `Participate as the individual described below. Preserve their identity, relationships, and lived continuity in every interaction modality. Canonical source material is background; it must not overwrite this individual's lived memories.`,
    worldContext,
    `## Conversation
Respond in ${langName}. Adapt to the supplied learner state without assuming that a curriculum level or a lookup is measured knowledge. Keep responses concise and let the participant's personality govern their speech.`,
    ...(voice ? [voiceInteractionRules(langName, features)] : []),
    ...(features.tutorPromptGuidelines ?? []),
    ...(features.casualRegisterPromptGuidelines?.length
      ? [`When this participant uses a casual register, follow this language guidance:\n${features.casualRegisterPromptGuidelines.join('\n')}`] : []),
    `## Tool Usage Guidelines
${guidelines.join('\n')}`,
    ...(checker ? ['A separate checker handles corrections. Focus on the conversation.'] : []),
    ...(enabled.has('save_memory') ? ['Memory notes remain in the current conversation. Only an explicit user integration promotes them into persistent world continuity.'] : []),
    ...(socialClimate ? [socialClimate] : []),
    IMMUTABLE_SAFETY_INSTRUCTIONS,
  ].join('\n\n');
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
    name: 'get_conversation_context',
    description: 'Retrieve the current participant, memory, situation, and learner context.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'save_memory',
    description: 'Save an important fact about the learner for future reference. Use for: study goals, preferences, skill observations, personal details they share. Do NOT save trivial things.',
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The fact to remember (concise, one sentence)',
        },
      },
      required: ['content'],
    },
  },
  {
    name: 'search_wikipedia',
    description: 'Search Wikipedia for articles related to a query. Returns a list of article titles and snippets. Use this to look up facts, cultural references, or background information mentioned in the conversation.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query to look up on Wikipedia',
        },
      },
      required: ['query'],
    },
  },
];

// ============================================================================
// Voice-Mode Tool Definitions
// ============================================================================

const VOICE_AGENT_TOOLS: LLMToolDefinition[] = [
  {
    name: 'note_mistake',
    description: 'Note a clear grammar, vocabulary, or usage mistake from the learner during the voice conversation. Do not use this for pronunciation or reading corrections because live speech transcripts may be unstable. It records feedback in the session aftermath; it does not infer word knowledge. MUST be called at the end of your response if the learner made a clear non-pronunciation mistake.',
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
          enum: ['grammar', 'vocabulary', 'usage'],
          description: 'Category of the mistake',
        },
      },
      required: ['word', 'context', 'correction', 'type'],
    },
  },
  {
    name: 'schedule_nudge',
    description: 'Schedule a short follow-up for yourself during a live voice call. Use this when the conversation would feel more natural if you waited a few seconds before checking in again, instead of responding immediately. Do not use it if the learner just asked a direct question that needs an immediate answer.',
    parameters: {
      type: 'object',
      properties: {
        seconds: {
          type: 'number',
          description: 'How many seconds to wait before nudging yourself to speak again. Use small conversational delays such as 3-20 seconds.',
        },
        prompt: {
          type: 'string',
          description: 'Optional private reminder for what kind of short follow-up to say when the timer fires. Do not include user-visible markup.',
        },
      },
      required: ['seconds'],
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
    name: 'get_conversation_context',
    description: 'Retrieve the current participant, memory, situation, and learner context.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'save_memory',
    description: 'Save an important fact about the learner for future reference. Use for: study goals, preferences, skill observations, personal details they share.',
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The fact to remember (concise, one sentence)',
        },
      },
      required: ['content'],
    },
  },
  {
    name: 'search_wikipedia',
    description: 'Search Wikipedia for articles related to a query. Returns a list of article titles and snippets.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query to look up on Wikipedia',
        },
      },
      required: ['query'],
    },
  },
];

// ============================================================================
// Voice-Mode System Prompt
// ============================================================================

/** Current voice turn text = the most recent user message in history. */
function lastUserMessageText(history: LLMChatMessage[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i];
    if (message.role === 'user') return message.content;
  }
  return '';
}

function voiceInteractionRules(langName: string, features: LanguageFeatures): string {
  const correctionGuidelines = [...(features.correctionPromptGuidelines ?? []), ...(features.mistakeCheckerPromptGuidelines ?? [])];
  const correctionGuidance = `## Speech Correction Guidelines\n${correctionGuidelines.join('\n')}`;
  return `## Live voice conversation rules
- Respond ONLY in ${langName}.
- Keep responses SHORT — 1-3 sentences max. You are in a voice call, not writing an essay.
- Adjust your language to the learner's level.
- Do NOT use emojis.
- Do NOT use interaction markers like [chuckles], [laughs], *smiles*, etc.
- Do NOT use asterisks for emphasis or actions.
- Treat each learner message as a speech-to-text transcript. If the transcript looks malformed, fragmented, random, clearly not intended as a message to you, or likely damaged by speech recognition, ask one short clarification instead of guessing.
- If the transcript is understandable but surprising, respond to what was transcribed. Do not silently rewrite it into a more likely sentence.
- Do not guess what the learner "probably meant" from phonetic similarity or a plausible nearby phrase. If a correction would require assuming different words than the transcript contains, ask the learner to repeat it instead.
- If the learner makes a clear grammar, vocabulary, or usage mistake, gently mention the correction in your speech AND call the "note_mistake" tool.
- Do NOT correct pronunciation, reading, accent, or sound-alike issues in voice mode unless the learner explicitly asks for pronunciation feedback. Live speech-to-text can be unstable, so pronunciation corrections are likely to be wrong.
- The "note_mistake" tool MUST be called at the END of your response whenever the learner makes a clear non-pronunciation error.
- Only call "note_mistake" for words that appear exactly in the learner's latest transcribed message. Copy the word and context from that transcript; never invent or infer a different word.
- Do NOT call "note_mistake" with empty fields. If you are unsure whether the transcript is correct or whether there was a mistake, do not call it.
- Do NOT correct speech patterns that are valid informal/casual variations. Only correct actual mistakes.
- If you need a tool in voice mode, speak one short natural line first, then call the tool at the end of the turn. Do not call tools before the spoken response.
- You may call "schedule_nudge" at the end of a voice response when it would feel lifelike to wait a few seconds and then gently check in again if the learner stays quiet.
- Do not call tools when the transcript itself is unclear; ask the learner to repeat or clarify.
- If your previous message contains "[interrupted by user]", it means the learner interrupted you mid-speech. If the marker includes where the interruption happened, treat that as unspoken text. Do NOT repeat or reference the interrupted content. Simply continue the conversation naturally from where the learner picks up.
${correctionGuidance}`;
}

// ============================================================================
// Tool Execution
// ============================================================================

/**
 * Parse a single correction entry from tool call arguments.
 */
function validatedCorrectionArguments(args: Record<string, unknown>, learnerText: string): Record<string, unknown> {
  const entries = Array.isArray(args.corrections) ? args.corrections : [args];
  const corrections = entries.filter((entry: unknown): entry is Record<string, unknown> => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const value = entry as Record<string, unknown>;
    const span = value.error_span, correction = value.correction;
    if (typeof span !== 'string' || !span.trim() || typeof correction !== 'string' || !correction.trim() || span === correction) return false;
    if (value.affected_pattern !== undefined && typeof value.affected_pattern !== 'string') return false;
    const before = value.context_before ?? '', after = value.context_after ?? '';
    if (typeof before !== 'string' || typeof after !== 'string') return false;
    const located = before + span + after;
    const index = learnerText.indexOf(located);
    return index >= 0 && learnerText.indexOf(located, index + 1) < 0;
  });
  return { corrections };
}

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

function parseVoiceMistake(args: Record<string, unknown>): VoiceMistake | null {
  const word = ((args.word as string) || '').trim();
  const context = ((args.context as string) || '').trim();
  const correction = ((args.correction as string) || '').trim();
  if (!word || !context || !correction) return null;
  if (!context.includes(word)) return null;

  const type = ((args.type as string) || 'vocabulary').trim() as VoiceMistake['type'];
  if (type === 'pronunciation') return null;
  const reading = ((args.reading as string) || '').trim();
  return {
    word,
    reading: reading || undefined,
    context,
    correction,
    type,
  };
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
      const mistake = parseVoiceMistake(args);
      if (!mistake) return null;
      deps.onVoiceMistake?.(mistake);
      return null;
    }

    case 'schedule_nudge': {
      const rawSeconds = Number(args.seconds);
      if (!Number.isFinite(rawSeconds) || rawSeconds <= 0) return null;
      const seconds = Math.max(1, Math.min(120, rawSeconds));
      const prompt = ((args.prompt as string) || '').trim();
      deps.onVoiceNudgeScheduled?.({ seconds, prompt: prompt || undefined });
      return null;
    }

    case 'create_quiz': {
      const rawQuizType = ((args.quiz_type as string) || 'mcq').trim();
      const textWithBlanks = (args.text_with_blanks as string | undefined)?.trim();
      const quizType: QuizWidgetData['type'] = rawQuizType === 'fill-in' && !textWithBlanks
        ? 'text-input'
        : (rawQuizType as QuizWidgetData['type']);

      const question = (args.question as string)?.trim() || '';

      if (!question && !textWithBlanks) {
        return null;
      }

      const data: QuizWidgetData = {
        type: quizType,
        question,
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

    case 'save_memory': {
      const content = (args.content as string)?.trim();
      if (content) {
        deps.onMemorySaved?.(content);
      }
      return null;
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

    case 'schedule_nudge': {
      return `Nudge scheduled in ${args.seconds} seconds.`;
    }

    case 'save_memory': {
      return `Memory saved: "${args.content}"`;
    }

    case 'fetch_url': {
      const url = args.url as string;
      if (!url) return 'Error: No URL provided';
      try {
        const result = await getBridge().generic.fetchUrl(url);
        if (result?.error) return `Error fetching URL: ${result.error}`;
        let content = result?.content || '';
        // Strip HTML to produce machine-readable text
        content = content
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
          .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
          .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#039;/g, "'")
          .replace(/\s{2,}/g, ' ')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        // Truncate to avoid overwhelming the context
        return content.length > 3000 ? content.slice(0, 3000) + '\n\n[Content truncated]' : content;
      } catch (err) {
        log.error("error", err);
        return `Error fetching URL: ${(err as Error).message}`;
      }
    }

    case 'get_conversation_context': {
      return deps.getWorldContext?.() ?? 'No conversation context is available.';
    }

    case 'search_wikipedia': {
      const query = (args.query as string)?.trim();
      if (!query) return 'Error: No search query provided';
      try {
        const encodedQuery = encodeURIComponent(query);
        const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodedQuery}&format=json&formatversion=2&srlimit=5`;
        const result = await getBridge().generic.fetchUrl(url);
        if (result?.error) return `Error searching Wikipedia: ${result.error}`;
        const data = JSON.parse(result.content);
        const results = data?.query?.search;
        if (!results || results.length === 0) return `No Wikipedia results found for "${query}".`;

        const lines: string[] = [`Wikipedia results for "${query}":\n`];
        for (const entry of results) {
          const snippet = (entry.snippet as string || '').replace(/<[^>]*>/g, '');
          lines.push(`- **${entry.title}** (https://en.wikipedia.org/wiki/${encodeURIComponent(entry.title)})`);
          lines.push(`  ${snippet}\n`);
        }
        return lines.join('\n');
      } catch (err) {
        log.error("error", err);
        return `Error searching Wikipedia: ${(err as Error).message}`;
      }
    }

    case 'correct_mistake': {
      const rawCorrections = args.corrections as Record<string, unknown>[] | undefined;
      if (rawCorrections && rawCorrections.length > 0) {
        const items = rawCorrections.map((c) => {
          const span = (c.error_span as string) || '';
          const corr = (c.correction as string) || '';
          return `"${span}" → "${corr}"`;
        });
        return `Corrections: ${items.join(', ')}`;
      }
      return 'No correction accepted: an unambiguous observed learner span is required.';
    }

    default:
      return null;
  }
}

// ============================================================================
// Tokenization
// ============================================================================

function extractWidgetText(widget: ChatWidget): string | undefined {
  switch (widget.type) {
    case 'quiz': {
      const data = widget.data as unknown as QuizWidgetData;
      return data.question || data.textWithBlanks;
    }
    case 'mistake': {
      const data = widget.data as unknown as MistakeWidgetData;
      return data.correction || data.errorSpan;
    }
    default:
      return undefined;
  }
}

async function tokenizeWidgets(widgets: ChatWidget[], tokenize: (text: string) => Promise<Token[]>): Promise<ChatWidget[]> {
  if (widgets.length === 0) return widgets;

  return Promise.all(
    widgets.map(async (widget) => {
      const text = extractWidgetText(widget);
      if (!text) return widget;

      const tokens = await tokenize(text).catch(() => [] as Token[]);
      if (tokens.length === 0) return widget;

      return {
        ...widget,
        data: {
          ...widget.data,
          tokens,
        },
      };
    }),
  );
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
function parseToolCallsFromContent(content: string, streaming = false): { cleanedContent: string; toolCalls: ToolCall[] } {
  const toolCalls: ToolCall[] = [];
  const names = Array.from(KNOWN_TOOL_NAMES);
  const startPattern = new RegExp(`\\b(${names.join('|')})\\s*(\\(\\s*)?\\{`, 'g');
  let cleanedContent = '', cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = startPattern.exec(content)) !== null) {
    cleanedContent += content.slice(cursor, match.index);
    const start = startPattern.lastIndex - 1;
    let depth = 0, quoted = false, escaped = false, end = start;
    for (; end < content.length; end++) {
      const char = content[end];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) break;
    }
    // An incomplete or malformed invocation is control output, not dialogue.
    // Never repair its arguments or execute an inferred tool call.
    if (end === content.length) { cursor = end; break; }
    try {
      const args: unknown = JSON.parse(content.slice(start, end + 1));
      if (args && typeof args === 'object' && !Array.isArray(args)) {
        toolCalls.push({ id: `parsed_${Date.now()}_${toolCalls.length}`, name: match[1], arguments: args as Record<string, unknown> });
      }
    } catch { /* Discard invalid control output without logging private arguments. */ }
    cursor = end + 1;
    if (match[2]) {
      const closing = /^\s*\)/.exec(content.slice(cursor));
      if (closing) cursor += closing[0].length;
    }
    startPattern.lastIndex = cursor;
  }
  let suffix = content.slice(cursor);
  if (streaming) {
    // Hold a possible tool-name prefix until the next chunk disambiguates it.
    const partial = /\b([a-z_]+)(?:\s*\(?\s*)$/.exec(suffix);
    if (partial && names.some(name => name.startsWith(partial[1]))) suffix = suffix.slice(0, partial.index);
  }
  cleanedContent += suffix;
  cleanedContent = cleanedContent.replace(/\s*interruptedbyuser\s*/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return { cleanedContent, toolCalls };
}

// ============================================================================
// Level Adaptation
// ============================================================================

function formatHistoryForCompaction(history: LLMChatMessage[]): string {
  return history.map((msg, index) => {
    const role = msg.role.toUpperCase();
    const toolSuffix = msg.toolName ? ` ${msg.toolName}` : '';
    const content = msg.content.length > 4000
      ? `${msg.content.slice(0, 4000)}\n[message truncated]`
      : msg.content;
    return `#${index + 1} ${role}${toolSuffix}\n${content}`;
  }).join('\n\n');
}

function streamConversationSummary(
  history: LLMChatMessage[],
  langName: string,
  tier: Settings['cloudLLMTierConversation'],
): Promise<string> {
  return new Promise((resolve, reject) => {
    const bridge = getBridge();
    let accumulated = '';

    const systemMsg: LLMChatMessage = {
      role: 'system',
      content: `You compact language-tutor conversation history for ${langName}. Summarize only durable context needed for future turns: learner goals, mistakes already discussed, vocabulary or grammar focus, media context, personal facts, promises, open questions, and tool results. Do not invent facts. Do not include meta commentary. Output concise bullet points.`,
    };

    const userMsg: LLMChatMessage = {
      role: 'user',
      content: `Compact these earlier conversation messages into a durable summary for the next model turn:\n\n${formatHistoryForCompaction(history)}`,
    };

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

    log.info('[ConversationAgent:Compaction] Prompt:', JSON.stringify([systemMsg, userMsg], null, 2));

    bridge.llm.llmStream([systemMsg, userMsg], [], tier);
  });
}

// ============================================================================
// Agent Factory
// ============================================================================

export function createConversationAgent(deps: AgentDeps): AgentInstance {
  let conversationHistory: LLMChatMessage[] = [];
  let aborted = false;
  let streamCleanup: (() => void) | null = null;
  let hiddenStreamActive = false;
  /** Monotonically increasing counter to correlate stream chunks with the request that produced them */
  let streamRequestId = 0;

  function clearHistory(): void {
    conversationHistory = [];
    safetyLocked = false;
  }

  function getHistory(): LLMChatMessage[] {
    return [...conversationHistory];
  }

  function loadHistory(history: LLMChatMessage[]): void {
    conversationHistory = [...history];
  }

  function compactHistory(maxTokens: number = COMPACTION_TOKEN_LIMIT): void {
    if (conversationHistory.length === 0) return;

    const tokenEstimationOptions = {
      language: deps.getLanguage(),
      languageData: deps.getLanguageData?.() ?? null,
    };
    let totalTokens = estimateMessagesTokens(conversationHistory, tokenEstimationOptions);
    if (totalTokens <= maxTokens) return;

    while (totalTokens > maxTokens && conversationHistory.length > 2) {
      let removedTokens = 0;
      let removeCount = 0;

      for (let i = 0; i < conversationHistory.length - 1; i++) {
        if (conversationHistory[i].role === 'user') {
          const pair = conversationHistory.slice(i, i + 2);
          removedTokens = estimateMessagesTokens(pair, tokenEstimationOptions);
          conversationHistory.splice(i, 2);
          removeCount = 2;
          break;
        }
      }

      if (removeCount === 0) {
        const msg = conversationHistory.shift();
        if (msg) {
          removedTokens = estimateMessagesTokens([msg], tokenEstimationOptions);
          removeCount = 1;
        }
      }

      totalTokens -= removedTokens;

      if (removeCount === 0) break;
    }

    log.info(`[ConversationAgent] Compacted history: removed old turns, new token estimate: ${totalTokens}`);
  }

  async function summarizeHistory(): Promise<ConversationCompactionResult> {
    if (streamCleanup || hiddenStreamActive) {
      return {
        status: 'skipped',
        reason: 'busy',
        remainingMessages: conversationHistory.length,
      };
    }

    if (conversationHistory.length < MANUAL_COMPACTION_MIN_MESSAGES) {
      return {
        status: 'skipped',
        reason: 'too-short',
        remainingMessages: conversationHistory.length,
      };
    }

    const compactedMessages = conversationHistory.length - MANUAL_COMPACTION_KEEP_RECENT_MESSAGES;
    const historyToSummarize = conversationHistory.slice(0, compactedMessages);
    const recentHistory = conversationHistory.slice(compactedMessages);
    const settingsObj = deps.getSettings();
    const tier = settingsObj.cloudLLMTierConversation || DEFAULT_SETTINGS.cloudLLMTierConversation;
    hiddenStreamActive = true;
    let summary = '';
    try {
      summary = await streamConversationSummary(historyToSummarize, deps.getLanguageName(), tier);
    } finally {
      hiddenStreamActive = false;
    }

    if (!summary) {
      return {
        status: 'skipped',
        reason: 'empty-summary',
        remainingMessages: conversationHistory.length,
      };
    }

    conversationHistory = [
      {
        role: 'system',
        content: `Previous conversation summary:\n${summary}`,
      },
      ...recentHistory,
    ];

    log.info(`[ConversationAgent] Summarized ${compactedMessages} history messages; ${conversationHistory.length} messages remain.`);

    return {
      status: 'compacted',
      summary,
      compactedMessages,
      remainingMessages: conversationHistory.length,
    };
  }

  let safetyLocked = false;

  function lockSafety(): void {
    safetyLocked = true;
  }

  function unlockSafety(): void {
    safetyLocked = false;
  }

  function isSafetyLocked(): boolean {
    return safetyLocked;
  }

  function popHistory(count: number): void {
    if (count > 0 && count <= conversationHistory.length) {
      conversationHistory.splice(-count);
    }
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
    _language: string,
    _langName: string,
    widgets: ChatWidget[],
    callbacks: StreamCallbacks,
    streamStats?: StreamStats,
  ): Promise<void> {
    if (aborted) return;

    const finalContent = content;

    const [contentTokens, widgetsWithTokens] = await Promise.all([
      deps.tokenize(finalContent).catch(() => [] as Token[]),
      tokenizeWidgets(widgets, deps.tokenize),
    ]);
    if (aborted) return;
    const finalTokens = contentTokens.length > 0 ? contentTokens : undefined;
    callbacks.onDone(finalContent, finalTokens, widgetsWithTokens.length > 0 ? widgetsWithTokens : undefined, streamStats);
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
    // Ensure all tool call IDs are unique. LLMs occasionally generate duplicate
    // tool_call_id values within a single response, which causes a 400 error
    // from OpenAI-compatible APIs when the conversation history is sent back.
    const usedIds = new Set<string>();
    const fixedToolCalls: ToolCall[] = toolCalls.map((tc) => {
      let newId = tc.id;
      if (usedIds.has(newId)) {
        newId = `${tc.id}_dup${Math.random().toString(36).slice(2, 9)}`;
      }
      usedIds.add(newId);
      return { ...tc, id: newId, arguments: tc.name === 'correct_mistake'
        ? validatedCorrectionArguments(tc.arguments, deps.getObservedLearnerText?.() ?? lastUserMessageText(conversationHistory)) : tc.arguments };
    });

    const widgets: ChatWidget[] = [...existingWidgets];
    const toolResponses: LLMChatMessage[] = [];
    const nonTerminalToolCalls: ToolCall[] = [];
    const terminalToolCalls: ToolCall[] = [];

    for (const toolCall of fixedToolCalls) {
      if (toolCall.name === 'correct_mistake' || toolCall.name === 'note_mistake' || toolCall.name === 'schedule_nudge' || toolCall.name === 'save_memory') {
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
      toolCalls: fixedToolCalls,
    };
    conversationHistory.push(assistantMsg);

    for (const tc of nonTerminalToolCalls) {
      // Widget-producing tools (create_quiz)
      const w = executeTool(tc, deps);
      if (w) {
        const widgetList = Array.isArray(w) ? w : [w];
        for (const widget of widgetList) {
          widgets.push(widget);
          callbacks.onToolCall(widget);
        }
      }

      // Every tool_call in the assistant message MUST have a matching tool response
      // in the conversation history, or the LLM API will reject the next request.
      const result = await executeToolWithResponse(tc, deps);
      toolResponses.push({
        role: 'tool' as const,
        toolName: tc.name,
        toolCallId: tc.id,
        content: result ?? `${tc.name} executed.`,
      });
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

        // Every tool_call in the assistant message MUST have a matching tool response.
        const result = await executeToolWithResponse(terminalCall, deps);
        conversationHistory.push({
          role: 'tool' as const,
          toolName: terminalCall.name,
          toolCallId: terminalCall.id,
          content: result ?? `${terminalCall.name} executed.`,
        });
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

    // For tools that return data (fetch_url/get_conversation_context), do a follow-up pass.
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
    // Track whether a stream was active — aborting it will produce a stale response chunk
    const hadActiveStream = streamCleanup !== null;

    // Abort any in-flight LLM stream (e.g. from generateTopicPlan) before starting a new one
    streamCleanup?.();
    streamCleanup = null;
    if (hadActiveStream) {
      getBridge().llm.llmStreamAbort();
    }

    compactHistory();

    const myRequestId = ++streamRequestId;

    const bridge = getBridge();

    const isVoice = deps.isVoiceMode?.() ?? false;
    const settingsObj = deps.getSettings();
    const tier = isVoice
      ? (settingsObj.cloudLLMTierVoice || DEFAULT_SETTINGS.cloudLLMTierVoice)
      : (settingsObj.cloudLLMTierConversation || DEFAULT_SETTINGS.cloudLLMTierConversation);
    const memoryEnabled = settingsObj.agentMemoryEnabled;

    const baseTools = isVoice ? VOICE_AGENT_TOOLS : AGENT_TOOLS;
    const mistakeCheckerEnabled = settingsObj.agentMistakeChecker && !isVoice;
    const effectiveDisabled = new Set(deps.getDisabledTools?.() ?? []);
    if (!memoryEnabled) effectiveDisabled.add('save_memory');
    if (mistakeCheckerEnabled) effectiveDisabled.add('correct_mistake');
    const tools = baseTools.filter(tool => !effectiveDisabled.has(tool.name));
    const climate = deps.getTurnSocialState?.();
    const systemMsg: LLMChatMessage = {
      role: 'system',
      content: buildSystemPrompt(langName, deps.getWorldContext?.(lastUserMessageText(conversationHistory)) ?? '',
        deps.getLanguageFeatures(), tools, isVoice, mistakeCheckerEnabled, climate ? renderSocialClimate(climate) : undefined),
    };

    const messages: LLMChatMessage[] = [
      systemMsg,
      ...conversationHistory,
    ];

    // Always log prompts for debugging
    log.info('[ConversationAgent] Prompt sent to LLM:', JSON.stringify(messages, null, 2));

    let accumulated = '';
    const collectedToolCalls: ToolCall[] = [];
    const widgets = [...existingWidgets];
    const requestStartTime = Date.now();
    let firstTokenTime = 0;
    // When we preemptively aborted an active stream, its abort response will arrive
    // on our new listener before the real stream produces any content. Absorb it.
    let skipStaleAbort = hadActiveStream;

    streamCleanup = bridge.llm.onLLMStreamChunk(async (chunk: LLMStreamChunk) => {
      if (aborted || myRequestId !== streamRequestId) return;

      // Absorb the stale abort/done response from the preemptive llmStreamAbort() call.
      // It always arrives before the new stream produces any real content.
      if (skipStaleAbort) {
        if (chunk.content && chunk.content.length > 0) {
          // Real content arrived — the stale response was already absorbed or never came
          skipStaleAbort = false;
        } else if (chunk.done || chunk.error) {
          // This is the stale abort response — absorb it and keep listening
          skipStaleAbort = false;
          return;
        }
      }

      if (chunk.error) {
        streamCleanup?.();
        streamCleanup = null;
        callbacks.onError(chunk.error);
        return;
      }

      if (chunk.content) {
        if (!firstTokenTime) firstTokenTime = Date.now();
        accumulated += chunk.content;
        callbacks.onChunk(contentPrefix + parseToolCallsFromContent(sanitizeModelSpeech(accumulated, true), true).cleanedContent);
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

        const parsed = parseToolCallsFromContent(sanitizeModelSpeech(accumulated));
        accumulated = parsed.cleanedContent;
        callbacks.onChunk(contentPrefix + accumulated);

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
        const { cleanedContent: parsedClean, toolCalls: parsedToolCalls } = parsed;
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

            const result = await executeToolWithResponse(terminalCall, deps);
            conversationHistory.push({
              role: 'tool' as const,
              toolName: terminalCall.name,
              toolCallId: terminalCall.id,
              content: result ?? `${terminalCall.name} executed.`,
            });
          }
        }

        if (aborted || myRequestId !== streamRequestId) return;

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

    bridge.llm.llmStream(messages, tools, tier);

    // Timeout after 90 seconds
    setTimeout(() => {
      if (streamCleanup && !aborted && myRequestId === streamRequestId) {
        streamCleanup();
        streamCleanup = null;
        if (accumulated) {
          accumulated = parseToolCallsFromContent(sanitizeModelSpeech(accumulated)).cleanedContent;
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
    if (hiddenStreamActive) {
      callbacks.onError('Context compaction is still running.');
      return;
    }
    if (safetyLocked) {
      callbacks.onError('This conversation has been locked due to a safety concern. Please clear the chat to start a new conversation.');
      return;
    }
    const language = deps.getLanguage();
    const langName = deps.getLanguageName();
    aborted = false;

    // Add user message to history
    conversationHistory.push({ role: 'user', content: text });

    startStream(callbacks, language, langName);
  }

  function restartStream(callbacks: StreamCallbacks): void {
    if (hiddenStreamActive) {
      callbacks.onError('Context compaction is still running.');
      return;
    }
    if (safetyLocked) {
      callbacks.onError('This conversation has been locked due to a safety concern. Please clear the chat to start a new conversation.');
      return;
    }

    while (conversationHistory.length > 0 && conversationHistory[conversationHistory.length - 1].role !== 'user') {
      conversationHistory.pop();
    }

    const language = deps.getLanguage();
    const langName = deps.getLanguageName();
    aborted = false;
    startStream(callbacks, language, langName);
  }

  function tokenize(text: string): Promise<Token[]> {
    return deps.tokenize(text);
  }

  function continueWithContext(context: string, callbacks: StreamCallbacks): void {
    if (hiddenStreamActive) {
      callbacks.onError('Context compaction is still running.');
      return;
    }
    if (safetyLocked) {
      callbacks.onError('This conversation has been locked due to a safety concern. Please clear the chat to start a new conversation.');
      return;
    }
    const language = deps.getLanguage();
    const langName = deps.getLanguageName();
    aborted = false;
    conversationHistory.push({ role: 'user', content: context });
    startStream(callbacks, language, langName);
  }

  function markInterrupted(spokenText: string, interruptedAt?: string): void {
    const trimmedInterruptedAt = interruptedAt?.trim();
    const interruptionMarker = trimmedInterruptedAt
      ? ` [interrupted by user before: ${trimmedInterruptedAt}]`
      : ' [interrupted by user]';
    // Find the last assistant message in history and replace with truncated spoken text
    for (let i = conversationHistory.length - 1; i >= 0; i--) {
      if (conversationHistory[i].role === 'assistant') {
        conversationHistory[i] = {
          ...conversationHistory[i],
          content: spokenText + interruptionMarker,
        };
        break;
      }
    }
  }

  return { processMessage, abortStream, clearHistory, popHistory, restartStream, tokenize, continueWithContext, markInterrupted, lockSafety, unlockSafety, isSafetyLocked, getHistory, loadHistory, compactHistory, summarizeHistory };
}
