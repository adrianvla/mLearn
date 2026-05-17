import { describe, expect, it } from 'vitest';
import type { LLMToolCall } from '../../../shared/types';
import {
  hasCompleteExplainerGenerationOutput,
  hasCompleteStructuredExplainerOutput,
  hasExplainerGenerationOutput,
  isQuotaError,
  normalizeExplainerErrorMessage,
} from './explainerPopupState';

describe('explainerPopupState', () => {
  it('falls back to the provided error message when the provider error is blank', () => {
    expect(normalizeExplainerErrorMessage('   ', 'Fallback message')).toBe('Fallback message');
    expect(normalizeExplainerErrorMessage(undefined, 'Fallback message')).toBe('Fallback message');
  });

  it('preserves a non-empty provider error message', () => {
    expect(normalizeExplainerErrorMessage('Model refused the request', 'Fallback message')).toBe('Model refused the request');
  });

  it('extracts the error field from a JSON payload in the error string', () => {
    expect(normalizeExplainerErrorMessage('Cloud LLM error: 429 {"error":"You have ran out of quota"}', 'Fallback')).toBe('You have ran out of quota');
  });

  it('extracts the message field when error is not present', () => {
    expect(normalizeExplainerErrorMessage('{"message":"Something went wrong"}', 'Fallback')).toBe('Something went wrong');
  });

  it('extracts the detail field when error and message are not present', () => {
    expect(normalizeExplainerErrorMessage('{"detail":"Not found"}', 'Fallback')).toBe('Not found');
  });

  it('falls back to the full string when JSON has no recognized fields', () => {
    expect(normalizeExplainerErrorMessage('Cloud LLM error: 500 {"code":"unknown"}', 'Fallback')).toBe('Cloud LLM error: 500 {"code":"unknown"}');
  });

  it('falls back to the full string when JSON is malformed', () => {
    expect(normalizeExplainerErrorMessage('Cloud LLM error: 500 {broken', 'Fallback')).toBe('Cloud LLM error: 500 {broken');
  });

  it('detects quota errors by keyword', () => {
    expect(isQuotaError('You have ran out of quota')).toBe(true);
    expect(isQuotaError('Rate limit exceeded')).toBe(true);
    expect(isQuotaError('Insufficient credits')).toBe(true);
    expect(isQuotaError('Usage limit reached')).toBe(true);
    expect(isQuotaError('Something else went wrong')).toBe(false);
    expect(isQuotaError(null)).toBe(false);
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

  it('treats word explanation and grammar tool output as valid without final text', () => {
    expect(hasExplainerGenerationOutput('', [
      {
        id: 'tc-explanation',
        name: 'show_explanation',
        arguments: {
          word: 'つもり',
          explanation: 'In this phrase, it marks intention.',
        },
      },
    ])).toBe(true);

    expect(hasExplainerGenerationOutput('', [
      {
        id: 'tc-grammar',
        name: 'show_grammar_points',
        arguments: {
          points: [
            {
              term: 'つもり',
              description: 'A noun-like expression for intention or plan.',
            },
          ],
        },
      },
    ])).toBe(true);
  });

  it('requires all structured word explanation cards for complete word output', () => {
    const translationOnly: LLMToolCall[] = [
      {
        id: 'tc-translation',
        name: 'show_translation',
        arguments: {
          phrase: '殺すつもりはない',
          translation: 'I do not intend to kill.',
        },
      },
    ];
    const completeWordOutput: LLMToolCall[] = [
      ...translationOnly,
      {
        id: 'tc-explanation',
        name: 'show_explanation',
        arguments: {
          word: 'つもり',
          explanation: 'In this phrase, it marks intention.',
        },
      },
      {
        id: 'tc-grammar',
        name: 'show_grammar_points',
        arguments: {
          points: [{ term: 'つもり', description: 'A noun-like expression for intention or plan.' }],
        },
      },
    ];

    expect(hasCompleteStructuredExplainerOutput(translationOnly, 'word')).toBe(false);
    expect(hasCompleteExplainerGenerationOutput('', translationOnly, 'word')).toBe(false);
    expect(hasCompleteStructuredExplainerOutput(completeWordOutput, 'word')).toBe(true);
    expect(hasCompleteExplainerGenerationOutput('', completeWordOutput, 'word')).toBe(true);
  });

  it('requires translation and grammar for complete phrase output', () => {
    const phraseOutput: LLMToolCall[] = [
      {
        id: 'tc-translation',
        name: 'show_translation',
        arguments: { phrase: 'Bonjour le monde', translation: 'Hello world' },
      },
      {
        id: 'tc-grammar',
        name: 'show_grammar_points',
        arguments: { points: [{ term: 'Declarative phrase', description: 'A basic statement structure.' }] },
      },
    ];

    expect(hasCompleteStructuredExplainerOutput(phraseOutput.slice(0, 1), 'phrase')).toBe(false);
    expect(hasCompleteStructuredExplainerOutput(phraseOutput, 'phrase')).toBe(true);
  });

  it('treats raw fallback text as complete only when there are no structured sections', () => {
    const translationOnly: LLMToolCall[] = [
      {
        id: 'tc-translation',
        name: 'show_translation',
        arguments: { phrase: 'Hi there', translation: 'Salut' },
      },
    ];

    expect(hasCompleteExplainerGenerationOutput('Plain explanation fallback.', [], 'word')).toBe(true);
    expect(hasCompleteExplainerGenerationOutput('show_explanation({"word":"hi"', translationOnly, 'word')).toBe(false);
    expect(hasExplainerGenerationOutput('show_explanation({"word":"hi"', translationOnly)).toBe(true);
  });
});
