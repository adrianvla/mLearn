import { describe, expect, it } from 'vitest';
import { materialPracticeContext } from './materialPracticeContext';

describe('material practice handoff', () => {
  it('keeps the source language and deduplicates the selected words', () => {
    expect(materialPracticeContext({ language: 'arbitrary', label: 'Chapter', words: [' one ', 'one', 'two', ''] }, 'arbitrary'))
      .toEqual({ language: 'arbitrary', label: 'Chapter', words: ['one', 'two'] });
  });
  it('does not reinterpret a different language or malformed selection as material practice', () => {
    expect(materialPracticeContext({ language: 'other', label: 'Chapter', words: ['one'] }, 'active')).toBeUndefined();
    expect(materialPracticeContext({ language: 'active', label: 'Chapter', words: ['one', 7] }, 'active')).toBeUndefined();
    expect(materialPracticeContext({ language: 'active', label: 'Chapter', words: [] }, 'active')).toBeUndefined();
  });
});
