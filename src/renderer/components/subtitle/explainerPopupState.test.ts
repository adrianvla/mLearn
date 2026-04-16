import { describe, expect, it } from 'vitest';
import type { LLMToolCall } from '../../../shared/types';
import { hasExplainerGenerationOutput, normalizeExplainerErrorMessage } from './explainerPopupState';

describe('explainerPopupState', () => {
  it('falls back to the provided error message when the provider error is blank', () => {
    expect(normalizeExplainerErrorMessage('   ', 'Fallback message')).toBe('Fallback message');
    expect(normalizeExplainerErrorMessage(undefined, 'Fallback message')).toBe('Fallback message');
  });

  it('preserves a non-empty provider error message', () => {
    expect(normalizeExplainerErrorMessage('Model refused the request', 'Fallback message')).toBe('Model refused the request');
  });

  it('treats an empty completion with no tool calls as a failed generation', () => {
    expect(hasExplainerGenerationOutput('', [])).toBe(false);
    expect(hasExplainerGenerationOutput('   ', [])).toBe(false);
  });

  it('treats incomplete tool calls as a failed generation', () => {
    expect(hasExplainerGenerationOutput('', [
      { id: 'tc-blank', name: '', arguments: {} },
      { id: 'tc-empty', name: 'show_translation', arguments: {} },
    ])).toBe(false);
  });

  it('treats structured tool output as valid even when the final text is empty', () => {
    const toolCalls: LLMToolCall[] = [
      {
        id: 'tc-1',
        name: 'show_translation',
        arguments: {
          phrase: '殺すつもりはない',
          translation: 'I do not intend to kill.',
        },
      },
    ];

    expect(hasExplainerGenerationOutput('', toolCalls)).toBe(true);
  });
});