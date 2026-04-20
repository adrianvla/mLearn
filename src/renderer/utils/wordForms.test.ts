import { describe, expect, it } from 'vitest';
import { getWordFormCandidates } from './wordForms';

describe('getWordFormCandidates', () => {
  it('prefers language-provided variants when available', () => {
    expect(
      getWordFormCandidates(
        'おしいれ',
        (word) => word === 'おしいれ' ? '押し入れ' : word,
        () => ['押し入れ', '押入れ', 'おしいれ'],
      ),
    ).toEqual(['押し入れ', '押入れ', 'おしいれ']);
  });

  it('falls back to canonical plus original word without variants', () => {
    expect(
      getWordFormCandidates('おしいれ', (word) => word === 'おしいれ' ? '押し入れ' : word),
    ).toEqual(['押し入れ', 'おしいれ']);
  });
});
