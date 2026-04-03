import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetAnkiWords = vi.fn<() => Promise<string[]>>();

vi.mock('../../shared/backends', () => ({
  getBackend: () => ({
    getAnkiWords: mockGetAnkiWords,
  }),
}));

describe('ankiWordsCache', () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetAnkiWords.mockReset();
    mockGetAnkiWords.mockResolvedValue(['仲間']);
  });

  it('returns the first matching candidate word from the cache', async () => {
    const { refreshAnkiWordsCache, findWordInAnkiCache } = await import('./ankiWordsCache');
    await refreshAnkiWordsCache();

    expect(findWordInAnkiCache(['なかま', '仲間'])).toBe('仲間');
    expect(findWordInAnkiCache(['仲間', 'なかま'])).toBe('仲間');
  });

  it('returns null when none of the candidate forms exist in Anki', async () => {
    const { refreshAnkiWordsCache, findWordInAnkiCache } = await import('./ankiWordsCache');
    await refreshAnkiWordsCache();

    expect(findWordInAnkiCache(['なかま', 'ともだち'])).toBeNull();
  });
});