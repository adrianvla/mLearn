import { describe, expect, it, vi } from 'vitest';
import { resolveRendererWordKnowledge } from './wordKnowledge';

vi.mock('./statsService', () => ({
  getWordStatus: vi.fn(),
}));

vi.mock('./ankiWordsCache', () => ({
  findAnkiWordMatchInCache: vi.fn(),
}));

const { getWordStatus } = await import('./statsService');
const { findAnkiWordMatchInCache } = await import('./ankiWordsCache');

describe('resolveRendererWordKnowledge', () => {
  it('uses canonical and alias forms for manual and Anki knowledge lookups', () => {
    vi.mocked(getWordStatus).mockReturnValue(2);
    vi.mocked(findAnkiWordMatchInCache).mockReturnValue({
      word: '押し入れ',
      cards: [{ word: '押し入れ', factor: 2300, queue: 2, type: 2 }],
    });

    const result = resolveRendererWordKnowledge({
      word: 'おしいれ',
      getCanonicalForm: (word) => word === 'おしいれ' ? '押し入れ' : word,
      getWordVariants: (word) => word === 'おしいれ' ? ['押し入れ', '押入れ', 'おしいれ'] : [word],
      getCardByWordSync: () => null,
      useAnki: true,
      ankiLearningThreshold: 1550,
      ankiKnownThreshold: 1800,
      knowledgeSourceOrder: ['anki', 'manual', 'srs'],
      knowledgeResolutionMode: 'highest',
    });

    expect(getWordStatus).toHaveBeenCalledWith('押し入れ', ['押入れ', 'おしいれ']);
    expect(findAnkiWordMatchInCache).toHaveBeenCalledWith(['押し入れ', '押入れ', 'おしいれ']);
    expect(result.primaryWord).toBe('押し入れ');
    expect(result.aliasWords).toEqual(['押入れ', 'おしいれ']);
    expect(result.ankiMatch?.word).toBe('押し入れ');
    expect(result.manualStatus).toBe('known');
    expect(result.ankiStatus).toBe('known');
    expect(result.status).toBe('known');
  });

  it('skips Anki lookup when disabled while keeping canonical manual resolution', () => {
    vi.mocked(getWordStatus).mockReturnValue(1);
    vi.mocked(findAnkiWordMatchInCache).mockReturnValue(null);

    const result = resolveRendererWordKnowledge({
      word: 'おしいれ',
      getCanonicalForm: (word) => word === 'おしいれ' ? '押し入れ' : word,
      getWordVariants: (word) => word === 'おしいれ' ? ['押し入れ', '押入れ', 'おしいれ'] : [word],
      getCardByWordSync: () => null,
      useAnki: false,
      ankiLearningThreshold: 1550,
      ankiKnownThreshold: 1800,
      knowledgeSourceOrder: ['anki', 'manual', 'srs'],
      knowledgeResolutionMode: 'highest',
    });

    expect(findAnkiWordMatchInCache).not.toHaveBeenCalled();
    expect(result.manualStatus).toBe('learning');
    expect(result.ankiStatus).toBeNull();
    expect(result.status).toBe('learning');
  });
});
