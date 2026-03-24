/**
 * Checker Agent Service
 * A separate LLM agent that scans user messages for unnaturalness
 * and corrects mistakes independently from the conversation agent.
 */

import type {
  MistakeWidgetData,
  LLMChatMessage,
  LLMToolDefinition,
  LLMStreamChunk,
  ToolCall,
} from '../../shared/types';
import { getBridge } from '../../shared/bridges';

// ============================================================================
// Types
// ============================================================================

export interface CheckerResult {
  corrections: MistakeWidgetData[];
}

export interface CheckerAgentInstance {
  /** Check a user message for mistakes and return corrections */
  checkMessage: (userText: string, langName: string, customInstructions?: string) => Promise<CheckerResult>;
  /** Abort the current check */
  abort: () => void;
}

// ============================================================================
// Tool Definition
// ============================================================================

const CHECKER_TOOL: LLMToolDefinition = {
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

// ============================================================================
// System Prompt
// ============================================================================

function buildCheckerPrompt(langName: string, customInstructions?: string): string {
  let prompt = `You are a language correction assistant for ${langName}. Your ONLY job is to review the learner's message and identify any grammatical, vocabulary, spelling, or stylistic issues.

## Rules
- Analyze (silently) the learner's message for mistakes, unnatural phrasing, or awkward expressions.
- If you find issues, call the "suggest_corrections" tool with all corrections.
- If the message is correct and natural, respond with an empty message (no tool call).
- Do NOT add any visible text in your response. Only call the tool or produce nothing.
- The error_span must be copied EXACTLY from the learner's message. Do not translate or alter it.
- When the same word or phrase appears multiple times, provide context_before and/or context_after for disambiguation.
- Provide alternatives when there are multiple valid ways to express the same thing.
- Do NOT correct text that is not in ${langName} — the learner may mix languages occasionally.
- Do NOT correct names.
- Do NOT correct formality.
- Do NOT correct anything if it's just to rewrite the sentence.
- If you believe that there is nothing to correct, respond with an empty message (no tool call).

## Casual Speech Policy
- Be LENIENT with casual, colloquial, or informal speech. Casual register is VALID and should NOT be corrected.
- Do NOT correct informal contractions, slang, casual sentence endings, omission of particles in casual speech, or dropping of politeness markers.
- Only correct things that are actually WRONG (incorrect grammar, wrong word usage, typos) — not things that are simply informal.
- A native speaker using casual speech with friends would say it the same way? Then it is NOT a mistake.

## Error Types
- Use "grammar" for grammatical errors (wrong conjugation, particles, word order, etc.).
- Use "word" for wrong word choice or vocabulary errors.
- Use "typo" for obvious spelling mistakes or typos.
- Use "unnatural" for phrasing that is technically correct but sounds awkward or unnatural to a native speaker. Only flag clearly unnatural phrasing, not stylistic preferences. Do NOT flag casual speech as "unnatural".
- Use "other" only when none of the above categories fit.`;

  if (customInstructions) {
    prompt += `\n\n## Session Instructions (from the learner)
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

  function checkMessage(userText: string, langName: string, customInstructions?: string): Promise<CheckerResult> {
    return new Promise((resolve) => {
      aborted = false;
      const bridge = getBridge();

      const systemMsg: LLMChatMessage = {
        role: 'system',
        content: buildCheckerPrompt(langName, customInstructions),
      };

      const userMsg: LLMChatMessage = {
        role: 'user',
        content: userText,
      };

      const messages: LLMChatMessage[] = [systemMsg, userMsg];
      const tools: LLMToolDefinition[] = [CHECKER_TOOL];

      console.log('[CheckerAgent] Prompt:', JSON.stringify(messages, null, 2));

      const collectedToolCalls: ToolCall[] = [];
      let accumulated = '';

      streamCleanup = bridge.llm.onLLMStreamChunk((chunk: LLMStreamChunk) => {
        if (aborted) return;

        if (chunk.error) {
          streamCleanup?.();
          streamCleanup = null;
          resolve({ corrections: [] });
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
            resolve({ corrections: [] });
            return;
          }

          const corrections = parseCheckerToolCalls(collectedToolCalls, accumulated);
          resolve({ corrections });
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

function parseCheckerToolCalls(toolCalls: ToolCall[], content: string): MistakeWidgetData[] {
  const corrections: MistakeWidgetData[] = [];

  // Process structured tool calls
  for (const tc of toolCalls) {
    if (tc.name === 'suggest_corrections') {
      const rawCorrections = tc.arguments.corrections as Record<string, unknown>[] | undefined;
      if (rawCorrections && Array.isArray(rawCorrections)) {
        for (const entry of rawCorrections) {
          const correction = parseCorrectionEntry(entry);
          if (correction) corrections.push(correction);
        }
      }
    }
  }

  // Fallback: parse tool calls from plain text content
  if (corrections.length === 0 && content) {
    const parsed = parseToolCallsFromContent(content);
    for (const tc of parsed) {
      if (tc.name === 'suggest_corrections') {
        const rawCorrections = tc.arguments.corrections as Record<string, unknown>[] | undefined;
        if (rawCorrections && Array.isArray(rawCorrections)) {
          for (const entry of rawCorrections) {
            const correction = parseCorrectionEntry(entry);
            if (correction) corrections.push(correction);
          }
        }
      }
    }
  }

  return corrections;
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

/** Parse tool calls from plain text content (some models output them inline) */
function parseToolCallsFromContent(content: string): ToolCall[] {
  const toolCalls: ToolCall[] = [];

  const pattern = /suggest_corrections\s*\(\s*(\{[\s\S]*?\})\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    try {
      const args = JSON.parse(match[1]) as Record<string, unknown>;
      toolCalls.push({
        id: `checker_parsed_${Date.now()}_${toolCalls.length}`,
        name: 'suggest_corrections',
        arguments: args,
      });
    } catch {
      // JSON parse failed
    }
  }

  // Pattern without parentheses
  if (toolCalls.length === 0) {
    const noParen = /suggest_corrections\s*(\{[\s\S]*?\})/g;
    while ((match = noParen.exec(content)) !== null) {
      try {
        const args = JSON.parse(match[1]) as Record<string, unknown>;
        toolCalls.push({
          id: `checker_parsed_${Date.now()}_${toolCalls.length}`,
          name: 'suggest_corrections',
          arguments: args,
        });
      } catch {
        // JSON parse failed
      }
    }
  }

  return toolCalls;
}
