import type { LLMToolCall } from '../../../shared/types';

type ExplainerOutputMode = 'word' | 'phrase';

const REQUIRED_EXPLAINER_TOOLS_BY_MODE: Record<ExplainerOutputMode, string[]> = {
  word: ['show_translation', 'show_explanation', 'show_grammar_points'],
  phrase: ['show_translation', 'show_grammar_points'],
};

export function normalizeExplainerErrorMessage(value: string | null | undefined, fallbackMessage: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return fallbackMessage;
  }

  const jsonStart = trimmed.indexOf('{');
  if (jsonStart !== -1) {
    try {
      const parsed = JSON.parse(trimmed.slice(jsonStart)) as Record<string, unknown>;
      const message = typeof parsed.error === 'string' ? parsed.error
        : typeof parsed.message === 'string' ? parsed.message
        : typeof parsed.detail === 'string' ? parsed.detail
        : null;
      if (message) {
        return message;
      }
    } catch {

    }
  }

  return trimmed;
}

export function isQuotaError(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  const lower = value.toLowerCase();
  return lower.includes('quota')
    || lower.includes('rate limit')
    || lower.includes('insufficient')
    || lower.includes('billing')
    || lower.includes('credit')
    || lower.includes('usage limit');
}

function hasRenderableExplainerToolCall(toolCall: LLMToolCall): boolean {
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

export function hasExplainerGenerationOutput(finalContent: string, toolCalls: LLMToolCall[]): boolean {
  return finalContent.trim().length > 0 || toolCalls.some(hasRenderableExplainerToolCall);
}

export function hasCompleteStructuredExplainerOutput(toolCalls: LLMToolCall[], mode: ExplainerOutputMode): boolean {
  const renderableToolNames = new Set(
    toolCalls
      .filter(hasRenderableExplainerToolCall)
      .map((toolCall) => toolCall.name),
  );

  return REQUIRED_EXPLAINER_TOOLS_BY_MODE[mode].every((name) => renderableToolNames.has(name));
}

export function hasCompleteExplainerGenerationOutput(
  finalContent: string,
  toolCalls: LLMToolCall[],
  mode: ExplainerOutputMode,
): boolean {
  const hasRawFallback = finalContent.trim().length > 0 && toolCalls.length === 0;
  return hasRawFallback || hasCompleteStructuredExplainerOutput(toolCalls, mode);
}
