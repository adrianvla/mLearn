import type { LLMToolCall } from '../../../shared/types';

export function normalizeExplainerErrorMessage(value: string | null | undefined, fallbackMessage: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallbackMessage;
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