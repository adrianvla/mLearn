import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetAnkiWords = vi.fn<() => Promise<string[]>>();
const mockGetAnkiWordStatuses = vi.fn<() => Promise<Array<{ word: string; factor?: number; queue?: number; type?: number }>>>();

vi.mock('../../shared/backends', () => ({
  getBackend: () => ({
    getAnkiWords: mockGetAnkiWords,
    getAnkiWordStatuses: mockGetAnkiWordStatuses,
  }),
}));

describe('ankiWordsCache', () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetAnkiWords.mockReset();
    mockGetAnkiWords.mockResolvedValue(['仲間']);
    mockGetAnkiWordStatuses.mockReset();
    mockGetAnkiWordStatuses.mockResolvedValue([{ word: '仲間', factor: 1300, queue: 0, type: 0 }]);
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

  it('returns the matched card metadata for the first matching candidate', async () => {
    const { refreshAnkiWordsCache, findAnkiWordMatchInCache } = await import('./ankiWordsCache');
    await refreshAnkiWordsCache();

    expect(findAnkiWordMatchInCache(['なかま', '仲間'])).toEqual({
      word: '仲間',
      cards: [{ word: '仲間', factor: 1300, queue: 0, type: 0 }],
    });
  });
});