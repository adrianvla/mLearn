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
  AgentConfig,
  AgentMemoryEntry,
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
  /** Agent config (name, personality, roleplay, etc.) */
  getAgentConfig?: () => AgentConfig | null;
  /** Agent memories */
  getAgentMemories?: () => AgentMemoryEntry[];
  /** Callback when agent saves a new memory */
  onMemorySaved?: (content: string) => void;
  /** Callback when topic plan is generated */
  onTopicPlan?: (topics: string[]) => void;
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
  /** Generate a list of conversation topics based on current context, returned via onTopicPlan callback */
  generateTopicPlan: () => void;
}

// ============================================================================
// System Prompt Builder
// ============================================================================

function buildSystemPrompt(
  _langCode: string,
  langName: string,
  mediaCtx: ConversationAgentContext | null,
  userSceneContext?: string,
  targetLevelName?: string,
  tutorConfig?: TutorSessionConfig | null,
  agentConfig?: AgentConfig | null,
  memories?: AgentMemoryEntry[],
  topicPlan?: string[],
): string {
  // Build personality section
  let personalitySection: string;
  if (agentConfig?.personality === 'polite') {
    personalitySection = `## Personality
- Polite, professional, and structured.
- Use formal ${langName} — proper grammar and respectful language.
- Give clear explanations and structured feedback.
- Celebrate progress respectfully.
- When the learner struggles, offer structured guidance.`;
  } else if (agentConfig?.personality === 'roleplay' && agentConfig.roleplayName) {
    const formalityNote = agentConfig.roleplayFormality === 'polite'
      ? `- Use formal, polite ${langName} — proper grammar and respectful language.`
      : `- Use casual, informal ${langName} only. NEVER use formal or polite register — no honorifics, no deferential verb forms, no polite sentence endings. Speak like a close friend.`;
    const quotesSection = agentConfig.roleplayQuotes && agentConfig.roleplayQuotes.length > 0
      ? `\nSample quotes (match the style, don't repeat these lines verbatim):\n${agentConfig.roleplayQuotes.map((q) => `- "${q}"`).join('\n')}`
      : '';
    const contextSection = agentConfig.roleplayContext
      ? `\n\n## Story Context\n${agentConfig.roleplayContext}`
      : '';
    personalitySection = `## Personality & Character
You are roleplaying as "${agentConfig.roleplayName}".
${agentConfig.roleplayLore ? `Character description: ${agentConfig.roleplayLore}` : ''}
- Stay in character at all times while still fulfilling your role as a language tutor.
- Speak and act as this character would.
${formalityNote}
- Correct mistakes and quiz the learner as part of the roleplay scenario.${quotesSection}${contextSection}`;
  } else {
    personalitySection = `## Personality
- Patient, encouraging, and warm.
- Use casual, colloquial ${langName} — speak like a close friend, NOT like a teacher or textbook.
- NEVER use formal or polite register. Use informal verb forms, contractions, and casual sentence endings. Avoid honorific or deferential language entirely.
- Celebrate progress and good usage.
- When the learner struggles, simplify rather than switch languages entirely.`;
  }

  // Agent name/user name section
  let identitySection = '';
  if (agentConfig?.agentName) {
    identitySection += `\nYour name is "${agentConfig.agentName}".`;
  }
  if (agentConfig?.userName) {
    identitySection += `\nThe learner's name is "${agentConfig.userName}".`;
  }
  if (agentConfig?.aboutMe) {
    identitySection += `\nAbout the learner: ${agentConfig.aboutMe}`;
  }

  let prompt = `You are a friendly and encouraging language tutor for ${langName}.
Your primary role is to have natural conversations in ${langName} with the learner.${identitySection}

## Rules
- Respond ONLY in ${langName} for all user-visible assistant messages.
- Adjust your language level based on the learner's apparent proficiency.
- Keep responses concise (2-4 sentences typically) to maintain conversational flow.
- Naturally correct mistakes the learner makes using the "correct_mistake" tool.
- Periodically quiz the learner using the "create_quiz" tool based on vocabulary or grammar used in the conversation.
- If the learner writes in another language, reply in ${langName} and gently guide them back to ${langName}.
- Base conversation topics on the media the learner is consuming — discuss scenes, character actions, plot, and themes rather than generic topics like weather or hobbies.
- Do not quiz the reader on character readings if ${langName} has any. 

${personalitySection}

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
- Use "fetch_url" to look up grammar explanations or vocabulary from language learning resources if the learner asks about a specific topic. The fetched content will be returned as machine-readable text.
- Use "search_wikipedia" to search for general knowledge, cultural references, or background information that comes up in conversation.
- Use "search_fandom" to search the configured Fandom wiki for media-specific characters, lore, episodes, or plot details. Only works if the learner has set a Fandom wiki URL.
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

  // Inject agent memories
  if (memories && memories.length > 0) {
    const memoryLines = memories.map((m) => `- ${m.content}`).join('\n');
    prompt += `\n\n## Things You Remember About the Learner
You have saved these facts from previous conversations. Use them naturally — do not explicitly mention that you "remember" them, just act on the knowledge:
${memoryLines}`;
  }

  // Inject topic plan
  if (topicPlan && topicPlan.length > 0) {
    const topicLines = topicPlan.map((t, i) => `${i + 1}. ${t}`).join('\n');
    prompt += `\n\n## Conversation Plan
You have planned the following topics to cover during this conversation. Move through them naturally as the conversation flows — do not announce them or list them out. Transition between topics smoothly.
${topicLines}`;
  }

  // Memory tool instruction
  if (memories !== undefined) {
    prompt += `\n\n## Memory
You have a "save_memory" tool. Use it to save important facts about the learner (preferences, goals, study habits, life details, skill level observations). Save sparingly — only genuinely useful facts. Do NOT save trivial conversation details.`;
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
  {
    name: 'search_fandom',
    description: 'Search a Fandom wiki for articles related to a query. Use this when discussing media-specific characters, lore, episodes, or plot points. Only available when the learner has configured a Fandom wiki URL for the current agent.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query to look up on the Fandom wiki',
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
  {
    name: 'search_fandom',
    description: 'Search a Fandom wiki for articles related to a query. Only available when the learner has configured a Fandom wiki URL.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query to look up on the Fandom wiki',
        },
      },
      required: ['query'],
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
        return `Error searching Wikipedia: ${(err as Error).message}`;
      }
    }

    case 'search_fandom': {
      const query = (args.query as string)?.trim();
      if (!query) return 'Error: No search query provided';

      const agentCfg = deps.getAgentConfig?.();
      const fandomUrl = agentCfg?.roleplayFandomUrl?.replace(/\/+$/, '');
      if (!fandomUrl) return 'Error: No Fandom wiki URL configured for this agent. The learner needs to set a Fandom wiki URL in the agent settings.';

      try {
        const encodedQuery = encodeURIComponent(query);
        const apiUrl = `${fandomUrl}/api.php?action=query&list=search&srsearch=${encodedQuery}&format=json&formatversion=2&srlimit=5`;
        const result = await getBridge().generic.fetchUrl(apiUrl);
        if (result?.error) return `Error searching Fandom: ${result.error}`;
        const data = JSON.parse(result.content);
        const results = data?.query?.search;
        if (!results || results.length === 0) return `No Fandom results found for "${query}".`;

        const lines: string[] = [`Fandom wiki results for "${query}":\n`];
        for (const entry of results) {
          const snippet = (entry.snippet as string || '').replace(/<[^>]*>/g, '');
          const pageUrl = `${fandomUrl}/wiki/${encodeURIComponent(entry.title)}`;
          lines.push(`- **${entry.title}** (${pageUrl})`);
          if (snippet) lines.push(`  ${snippet}\n`);
        }
        return lines.join('\n');
      } catch (err) {
        return `Error searching Fandom: ${(err as Error).message}`;
      }
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
  devMode?: boolean,
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

    if (devMode) {
      console.log('[ConversationAgent:Reformulation] Prompt sent to LLM:', JSON.stringify([systemMsg, userMsg], null, 2));
    }

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
  let currentTopicPlan: string[] | undefined;

  function clearHistory(): void {
    conversationHistory = [];
    currentTopicPlan = undefined;
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
            deps.getSettings().devMode,
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
      if (toolCall.name === 'correct_mistake' || toolCall.name === 'note_mistake' || toolCall.name === 'save_memory') {
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
    const settingsObj = deps.getSettings();
    const memoryEnabled = settingsObj.agentMemoryEnabled;

    const tutorCfg = deps.getTutorConfig?.() ?? null;
    const agentCfg = deps.getAgentConfig?.() ?? null;
    const memories = memoryEnabled ? (deps.getAgentMemories?.() ?? []) : [];

    // Filter tools: only include save_memory if memory is enabled, exclude search_fandom if no URL configured
    const baseTools = isVoice ? VOICE_AGENT_TOOLS : AGENT_TOOLS;
    const hasFandomUrl = !!agentCfg?.roleplayFandomUrl;
    let tools = baseTools;
    if (!memoryEnabled) tools = tools.filter((t) => t.name !== 'save_memory');
    if (!hasFandomUrl) tools = tools.filter((t) => t.name !== 'search_fandom');

    const targetLevel = deps.getTargetLevel?.() ?? null;
    const targetLevelName = targetLevel !== null ? (deps.getLevelName?.(targetLevel) ?? undefined) : undefined;

    const systemMsg: LLMChatMessage = {
      role: 'system',
      content: isVoice
        ? buildVoiceSystemPrompt(langName, mediaCtx)
        : buildSystemPrompt(language, langName, mediaCtx, sceneCtx || undefined, targetLevelName, tutorCfg, agentCfg, memoryEnabled ? memories : undefined, currentTopicPlan),
    };

    const messages: LLMChatMessage[] = [
      systemMsg,
      ...conversationHistory,
    ];

    // Debug logging when devMode is enabled
    if (settingsObj.devMode) {
      console.log('[ConversationAgent] Prompt sent to LLM:', JSON.stringify(messages, null, 2));
    }

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

  /**
   * Generate a list of conversation topics based on current context.
   * The topics are injected into the system prompt for the agent to naturally cover.
   */
  function generateTopicPlan(): void {
    const bridge = getBridge();
    const langName = deps.getLanguageName();
    const mediaCtx = deps.getMediaContext();
    const tutorCfg = deps.getTutorConfig?.() ?? null;
    const memories = deps.getAgentMemories?.() ?? [];

    let contextDesc = `The learner is studying ${langName}.`;
    if (mediaCtx) {
      contextDesc += ` They are ${mediaCtx.mediaType === 'video' ? 'watching' : 'reading'} "${mediaCtx.mediaName}".`;
      if (mediaCtx.failedWords.length > 0) {
        const words = mediaCtx.failedWords.slice(0, 10).map((w) => w.word).join(', ');
        contextDesc += ` They struggle with: ${words}.`;
      }
    }
    if (tutorCfg?.selectedGrammar.length) {
      contextDesc += ` Grammar focus: ${tutorCfg.selectedGrammar.map((g) => g.pattern).join(', ')}.`;
    }
    if (memories.length > 0) {
      contextDesc += ` Known about learner: ${memories.map((m) => m.content).join('; ')}.`;
    }

    const systemMsg: LLMChatMessage = {
      role: 'system',
      content: `You are a conversation planner for a ${langName} language tutor. Generate a list of 3-5 conversation topics that would be natural and educational. Each topic should be a brief phrase. Output ONLY a JSON array of strings, nothing else. Example: ["Discussing weekend plans", "Practicing restaurant vocabulary", "Talking about a movie scene"]`,
    };

    const userMsg: LLMChatMessage = {
      role: 'user',
      content: contextDesc,
    };

    let accumulated = '';

    const cleanup = bridge.llm.onLLMStreamChunk((chunk: LLMStreamChunk) => {
      if (chunk.content) {
        accumulated += chunk.content;
      }
      if (chunk.done) {
        cleanup();
        try {
          // Extract JSON array from accumulated text
          const match = accumulated.match(/\[[\s\S]*\]/);
          if (match) {
            const topics = JSON.parse(match[0]) as string[];
            if (Array.isArray(topics) && topics.length > 0) {
              currentTopicPlan = topics;
              deps.onTopicPlan?.(topics);
            }
          }
        } catch {
          // Failed to parse — ignore
        }
      }
      if (chunk.error) {
        cleanup();
      }
    });

    if (deps.getSettings().devMode) {
      console.log('[ConversationAgent:TopicPlan] Prompt sent to LLM:', JSON.stringify([systemMsg, userMsg], null, 2));
    }

    bridge.llm.llmStream([systemMsg, userMsg], []);
  }

  return { processMessage, abortStream, clearHistory, tokenize, continueWithContext, markInterrupted, generateTopicPlan };
}
