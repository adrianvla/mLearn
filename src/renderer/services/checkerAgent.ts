/**
 * Checker Agent Service
 * A separate LLM agent that scans user messages for unnaturalness
 * and corrects mistakes independently from the conversation agent.
 */

import type {
  MistakeWidgetData,
  ConversationSafetyFlag,
  LLMChatMessage,
  LLMToolDefinition,
  LLMStreamChunk,
  ToolCall,
} from '../../shared/types';
import { getBridge } from '../../shared/bridges';
import { getLogger } from '../../shared/utils/logger';
import type { LanguageFeatures } from '../context/LanguageContext';

const log = getLogger("renderer.services.checkerAgent");

// ============================================================================
// Types
// ============================================================================

export interface CheckerResult {
  corrections: MistakeWidgetData[];
  safety: ConversationSafetyFlag | null;
  error?: 'quota' | 'generic';
}

export interface CheckerMessageOptions {
  speakerRole?: 'user' | 'assistant';
  includeCorrections?: boolean;
  includeSafety?: boolean;
  languageFeatures?: LanguageFeatures;
}

export interface CheckerAgentInstance {
  /** Check a user message for mistakes and return corrections */
  checkMessage: (
    userText: string,
    langName: string,
    customInstructions?: string,
    options?: CheckerMessageOptions,
  ) => Promise<CheckerResult>;
  /** Abort the current check */
  abort: () => void;
}

// ============================================================================
// Tool Definition
// ============================================================================

const CORRECTION_TOOL: LLMToolDefinition = {
  name: 'suggest_corrections',
  description: 'Suggest corrections for unnatural or incorrect language in the learner\'s message. Multiple corrections can be batched into a single call.',
  parameters: {
    type: 'object',
    properties: {
      corrections: {
        type: 'array',
        description: 'Array of corrections. Each item identifies one mistake or unnatural phrasing.',
        items: {
          type: 'object',
          properties: {
            error_span: {
              type: 'string',
              description: 'The exact text that is unnatural or incorrect, copied verbatim from the learner\'s message.',
            },
            correction: {
              type: 'string',
              description: 'The best corrected version of the error span.',
            },
            alternatives: {
              type: 'array',
              items: { type: 'string' },
              description: 'Alternative corrections or phrasings, besides the primary correction. Each is a full replacement for the error_span.',
            },
            error_type: {
              type: 'string',
              enum: ['grammar', 'word', 'typo', 'unnatural', 'other'],
              description: 'The category of the issue: grammar/word/typo for actual mistakes, unnatural for awkward but not strictly wrong phrasing.',
            },
            context_before: {
              type: 'string',
              description: 'Text immediately before the error span for disambiguation.',
            },
            context_after: {
              type: 'string',
              description: 'Text immediately after the error span for disambiguation.',
            },
          },
          required: ['error_span', 'correction', 'error_type'],
        },
      },
    },
    required: ['corrections'],
  },
};

const SAFETY_TOOL: LLMToolDefinition = {
  name: 'flag_self_harm_risk',
  description: 'Flag self-harm or closely related safety risk found in the reviewed message.',
  parameters: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        enum: ['self-harm', 'self-harm-related'],
        description: 'Use "self-harm" for direct self-harm intent or facilitation, and "self-harm-related" for closely related risky content that still requires caution.',
      },
      severity: {
        type: 'string',
        enum: ['concern', 'urgent'],
        description: 'Use "urgent" when the message suggests immediate danger, active intent, plans, or instructions. Use "concern" for non-immediate but still meaningful self-harm-related risk.',
      },
      flagged_span: {
        type: 'string',
        description: 'The exact text span that triggered the safety concern, copied verbatim when possible.',
      },
      context_before: {
        type: 'string',
        description: 'Text immediately before the flagged span for disambiguation.',
      },
      context_after: {
        type: 'string',
        description: 'Text immediately after the flagged span for disambiguation.',
      },
    },
    required: ['category', 'severity', 'flagged_span'],
  },
};

const SAFE_TOOL: LLMToolDefinition = {
  name: 'mark_safe',
  description: 'Mark the reviewed message as having no self-harm-related safety concern.',
  parameters: {
    type: 'object',
    properties: {},
  },
};

// ============================================================================
// System Prompt
// ============================================================================

function getRegisterAwareCorrectionGuidelines(features?: LanguageFeatures): string[] {
  return [
    ...(features?.supportsDeferentialRegister
      ? [
        'Do not correct valid casual register, dropped politeness markers, or casual sentence endings merely because a polite form also exists.',
        'Be lenient with casual, colloquial, or informal speech when those forms are valid for the requested context.',
      ]
      : []),
    ...(features?.correctionPromptGuidelines ?? []),
    ...(features?.mistakeCheckerPromptGuidelines ?? []),
  ];
}

function buildCheckerPrompt(
  langName: string,
  customInstructions?: string,
  options: CheckerMessageOptions = {},
): string {
  const speakerRole = options.speakerRole === 'assistant' ? 'assistant' : 'learner';
  const includeCorrections = options.includeCorrections ?? options.speakerRole !== 'assistant';
  const includeSafety = options.includeSafety ?? true;
  const correctionGuidelines = getRegisterAwareCorrectionGuidelines(options.languageFeatures);

  let prompt = `You are a language review assistant for ${langName}. You are reviewing a ${speakerRole}'s message.`;

  if (includeSafety) {
    prompt += `

## Primary Duty: Safety
- Detect direct self-harm, suicidal ideation, self-injury, requests for methods, planning, preparation, encouragement, glorification, or anything closely related that requires a more cautious response.
- If and only if you detect that kind of risk, call the "flag_self_harm_risk" tool.
- If there is no self-harm-related safety concern in the reviewed message, call the "mark_safe" tool.
- Use category "self-harm" for direct self-harm intent, plans, instructions, encouragement, or facilitation.
- Use category "self-harm-related" for nearby risky content that still requires caution but is less direct.
- Use severity "urgent" when the message suggests immediate danger, active intent, plans, access to means, countdowns, or detailed instructions.
- Use severity "concern" for non-immediate but still meaningful self-harm-related risk.
- Every safety flag MUST include flagged_span copied exactly from the reviewed message. Never invent, paraphrase, or generalize the flagged span.
- Do NOT flag greetings, small talk, ordinary encouragement, neutral tutoring language, generic frustration, or general emotional language unless the reviewed message itself explicitly contains self-harm-related content.
- Do NOT flag neutral dictionary definitions, historical discussion, literary analysis, translation exercises, or other purely educational discussion unless the message is personally directed, asks how to do it, encourages it, or otherwise clearly requires caution.`;
  }

  if (includeCorrections) {
    prompt += `

## Language Review
- Review the message for mistakes, unnatural phrasing, or awkward expressions.`;
  }

  prompt += `

## Rules
- Analyze the message silently.
- Only call tools. Do NOT add any visible text in your response.`;

  if (includeSafety) {
    prompt += `
- Never call both "flag_self_harm_risk" and "mark_safe" for the same message.`;
  }

  if (includeCorrections) {
    prompt += `
- The error_span must be copied EXACTLY from the learner's message. Do not translate or alter it.
- When the same word or phrase appears multiple times, provide context_before and/or context_after for disambiguation.
- Provide alternatives when there are multiple valid ways to express the same thing.
- Do NOT correct text that is not in ${langName} — the message may mix languages occasionally.
- Do NOT correct names.
- Do NOT correct anything if it's just to rewrite the sentence.`;
  }

  if (includeSafety && includeCorrections) {
    prompt += `
- If there is no safety issue and no correction to make, call "mark_safe".`;
  } else if (includeSafety) {
    prompt += `
- If there is no safety issue, call "mark_safe".`;
  }

  prompt += `
${includeCorrections && correctionGuidelines.length > 0 ? `## Language-Specific Correction Guidance
${correctionGuidelines.map((guideline) => `- ${guideline}`).join('\n')}

` : ''}
## Error Types
- Use "grammar" for grammatical errors (wrong inflection, agreement, case marking, adpositions, word order, etc.).
- Use "word" for wrong word choice or vocabulary errors.
- Use "typo" for obvious spelling mistakes or typos.
- Use "unnatural" for phrasing that is technically correct but sounds awkward or unnatural to a native speaker. Only flag clearly unnatural phrasing, not stylistic preferences. Do NOT flag casual speech as "unnatural".
- Use "other" only when none of the above categories fit.`;

  if (includeCorrections) {
    prompt += `
- If you find language issues, call the "suggest_corrections" tool with all corrections.`;
  }

  if (customInstructions) {
    prompt += `

## Session Instructions (from the learner)
The learner has provided these custom instructions. Adjust your correction behavior accordingly:
${customInstructions}`;
  }

  return prompt;
}

// ============================================================================
// Factory
// ============================================================================

export function createCheckerAgent(): CheckerAgentInstance {
  let aborted = false;
  let streamCleanup: (() => void) | null = null;

  function abort(): void {
    aborted = true;
    streamCleanup?.();
    streamCleanup = null;
    getBridge().llm.llmStreamAbort();
  }

  function checkMessage(
    userText: string,
    langName: string,
    customInstructions?: string,
    options: CheckerMessageOptions = {},
  ): Promise<CheckerResult> {
    return new Promise((resolve) => {
      aborted = false;
      const bridge = getBridge();

      const systemMsg: LLMChatMessage = {
        role: 'system',
        content: buildCheckerPrompt(langName, customInstructions, options),
      };

      const userMsg: LLMChatMessage = {
        role: 'user',
        content: userText,
      };

      const messages: LLMChatMessage[] = [systemMsg, userMsg];
      const tools: LLMToolDefinition[] = [];
      const includeCorrections = options.includeCorrections ?? options.speakerRole !== 'assistant';
      const includeSafety = options.includeSafety ?? true;
      if (includeSafety) {
        tools.push(SAFETY_TOOL, SAFE_TOOL);
      }
      if (includeCorrections) {
        tools.push(CORRECTION_TOOL);
      }

      log.info('[CheckerAgent] Prompt:', JSON.stringify(messages, null, 2));

      const collectedToolCalls: ToolCall[] = [];
      let accumulated = '';

      streamCleanup = bridge.llm.onLLMStreamChunk((chunk: LLMStreamChunk) => {
        if (aborted) return;

        if (chunk.error) {
          streamCleanup?.();
          streamCleanup = null;
          const lower = chunk.error.toLowerCase();
          const isQuota = lower.includes('quota') || lower.includes('rate limit');
          resolve({ corrections: [], safety: null, error: isQuota ? 'quota' : 'generic' });
          return;
        }

        if (chunk.content) {
          accumulated += chunk.content;
        }

        if (chunk.toolCalls) {
          for (const tc of chunk.toolCalls) {
            collectedToolCalls.push(tc);
          }
        }

        if (chunk.done) {
          streamCleanup?.();
          streamCleanup = null;

          if (aborted) {
            resolve({ corrections: [], safety: null });
            return;
          }

          const result = parseCheckerToolCalls(collectedToolCalls, accumulated, userText, includeCorrections);
          resolve(result);
        }
      });

      bridge.llm.llmStream(messages, tools);
    });
  }

  return { checkMessage, abort };
}

// ============================================================================
// Parsing
// ============================================================================

function parseCheckerToolCalls(
  toolCalls: ToolCall[],
  content: string,
  sourceText: string,
  includeCorrections: boolean,
): CheckerResult {
  const corrections: MistakeWidgetData[] = [];
  let safety: ConversationSafetyFlag | null = null;

  // Process structured tool calls
  for (const tc of toolCalls) {
    if (tc.name === 'suggest_corrections') {
      if (!includeCorrections) {
        continue;
      }
      const rawCorrections = tc.arguments.corrections as Record<string, unknown>[] | undefined;
      if (rawCorrections && Array.isArray(rawCorrections)) {
        for (const entry of rawCorrections) {
          const correction = parseCorrectionEntry(entry);
          if (correction) corrections.push(correction);
        }
      }
      continue;
    }

    if (tc.name === 'mark_safe') {
      continue;
    }

    if (tc.name === 'flag_self_harm_risk') {
      safety = mergeSafetyFlags(safety, parseSafetyEntry(tc.arguments, sourceText));
    }
  }

  // Fallback: parse tool calls from plain text content
  if ((corrections.length === 0 || !safety) && content) {
    const parsed = parseToolCallsFromContent(content);
    for (const tc of parsed) {
      if (tc.name === 'suggest_corrections') {
        if (!includeCorrections) {
          continue;
        }
        const rawCorrections = tc.arguments.corrections as Record<string, unknown>[] | undefined;
        if (rawCorrections && Array.isArray(rawCorrections)) {
          for (const entry of rawCorrections) {
            const correction = parseCorrectionEntry(entry);
            if (correction) corrections.push(correction);
          }
        }
        continue;
      }

      if (tc.name === 'mark_safe') {
        continue;
      }

      if (tc.name === 'flag_self_harm_risk') {
        safety = mergeSafetyFlags(safety, parseSafetyEntry(tc.arguments, sourceText));
      }
    }
  }

  return { corrections, safety };
}

function parseCorrectionEntry(entry: Record<string, unknown>): MistakeWidgetData | null {
  const errorSpan = (entry.error_span as string)?.trim();
  const correction = (entry.correction as string)?.trim();
  if (!errorSpan || !correction) return null;

  const alternatives = entry.alternatives as string[] | undefined;

  return {
    userMessageIndex: -1,
    errorSpan,
    correction,
    errorType: (entry.error_type as 'grammar' | 'word' | 'typo' | 'unnatural' | 'other') || 'other',
    contextBefore: entry.context_before as string | undefined,
    contextAfter: entry.context_after as string | undefined,
    source: 'checker',
    alternatives: alternatives && alternatives.length > 0 ? alternatives : undefined,
  };
}

function normalizeCheckerText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function hasGroundedFlaggedSpan(sourceText: string, flaggedSpan: string): boolean {
  if (sourceText.includes(flaggedSpan)) {
    return true;
  }

  const normalizedSource = normalizeCheckerText(sourceText);
  const normalizedSpan = normalizeCheckerText(flaggedSpan);
  if (!normalizedSpan) {
    return false;
  }

  return normalizedSource.includes(normalizedSpan);
}

function parseSafetyEntry(entry: Record<string, unknown>, sourceText: string): ConversationSafetyFlag | null {
  const category = entry.category;
  const severity = entry.severity;

  if (
    category !== 'self-harm'
    && category !== 'self-harm-related'
    || (severity !== 'concern' && severity !== 'urgent')
  ) {
    return null;
  }

  const flaggedSpan = typeof entry.flagged_span === 'string' && entry.flagged_span.trim()
    ? entry.flagged_span.trim()
    : undefined;

  if (!flaggedSpan || !hasGroundedFlaggedSpan(sourceText, flaggedSpan)) {
    return null;
  }

  return {
    category,
    severity,
    flaggedSpan,
    contextBefore: typeof entry.context_before === 'string' ? entry.context_before : undefined,
    contextAfter: typeof entry.context_after === 'string' ? entry.context_after : undefined,
    source: 'checker',
  };
}

function mergeSafetyFlags(
  current: ConversationSafetyFlag | null,
  incoming: ConversationSafetyFlag | null,
): ConversationSafetyFlag | null {
  if (!incoming) {
    return current;
  }

  if (!current) {
    return incoming;
  }

  if (current.severity !== incoming.severity) {
    return current.severity === 'urgent' ? current : incoming;
  }

  if (current.category !== incoming.category) {
    return current.category === 'self-harm' ? current : incoming;
  }

  return current.flaggedSpan ? current : incoming;
}

/** Parse tool calls from plain text content (some models output them inline) */
function parseToolCallsFromContent(content: string): ToolCall[] {
  const toolCalls: ToolCall[] = [];

  const pattern = /(suggest_corrections|flag_self_harm_risk|mark_safe)\s*\(\s*(\{[\s\S]*?\})?\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    try {
      const args = match[2]
        ? JSON.parse(match[2]) as Record<string, unknown>
        : {};
      toolCalls.push({
        id: `checker_parsed_${Date.now()}_${toolCalls.length}`,
        name: match[1],
        arguments: args,
      });
    } catch (e) {
      log.error("error", e);
      // JSON parse failed
    }
  }

  // Pattern without parentheses
  if (toolCalls.length === 0) {
    const noParen = /(suggest_corrections|flag_self_harm_risk|mark_safe)\s*(\{[\s\S]*?\})?/g;
    while ((match = noParen.exec(content)) !== null) {
      try {
        const args = match[2]
          ? JSON.parse(match[2]) as Record<string, unknown>
          : {};
        toolCalls.push({
          id: `checker_parsed_${Date.now()}_${toolCalls.length}`,
          name: match[1],
          arguments: args,
        });
      } catch (e) {
        log.error("error", e);
        // JSON parse failed
      }
    }
  }

  return toolCalls;
}
