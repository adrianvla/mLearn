import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LanguageData } from '../../shared/types';

const mockGetAnkiWords = vi.fn<() => Promise<string[]>>();
const mockGetAnkiWordStatuses = vi.fn<() => Promise<Array<{ word: string; factor?: number; queue?: number; type?: number }>>>();

vi.mock('../../shared/backends', () => ({
  getBackend: () => ({
    getAnkiWords: mockGetAnkiWords,
    getAnkiWordStatuses: mockGetAnkiWordStatuses,
  }),
}));

describe('ankiWordsCache', () => {
  const latinLanguage: LanguageData = {
    name: 'Latin Language',
    colour_codes: {},
    settings: { fixed: {} },
    textProcessing: {
      scriptProfile: { acceptedScripts: ['Latn'] },
      lexemeNormalization: {
        type: 'identity',
      },
      readingAnnotation: {
        type: 'none',
        stripParentheticalReadings: false,
      },
    },
  };

  const hanPinyinLanguage: LanguageData = {
    name: 'Han Pinyin Language',
    colour_codes: {},
    settings: { fixed: {} },
    textProcessing: {
      lexemeNormalization: {
        type: 'reading',
        surfaceScripts: ['Han'],
        readingScripts: ['Latn'],
      },
      readingAnnotation: {
        type: 'script-reading',
        annotationScripts: ['Han'],
        stripParentheticalReadings: true,
      },
    },
  };

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
      lookupKey: '仲間',
      cards: [{ word: '仲間', factor: 1300, queue: 0, type: 0 }],
    });
  });

  it('matches normalized lookup variants from the shared cache', async () => {
    mockGetAnkiWordStatuses.mockResolvedValueOnce([{ word: '押し入れ', factor: 2300, queue: 2, type: 2 }]);

    const { refreshAnkiWordsCache, findAnkiWordMatchInCache, isWordInAnkiCache } = await import('./ankiWordsCache');
    await refreshAnkiWordsCache();

    expect(findAnkiWordMatchInCache(['<ruby>押<rt>お</rt></ruby>し入れ'])).toEqual({
      word: '押し入れ',
      lookupKey: '押し入れ',
      cards: [{ word: '押し入れ', factor: 2300, queue: 2, type: 2 }],
    });
    expect(isWordInAnkiCache('押し入れ\u200b')).toBe(true);
  });

  it('does not apply legacy Japanese parenthetical stripping when language metadata disables it', async () => {
    mockGetAnkiWordStatuses.mockResolvedValueOnce([{ word: 'Example(かな)', factor: 2300, queue: 2, type: 2 }]);

    const { refreshAnkiWordsCache, findWordInAnkiCache } = await import('./ankiWordsCache');
    const options = { language: 'de', languageData: latinLanguage };
    await refreshAnkiWordsCache(options);

    expect(findWordInAnkiCache(['Example(かな)'], options)).toBe('Example(かな)');
    expect(findWordInAnkiCache(['Example'], options)).toBeNull();
  });

  it('indexes metadata-configured reading annotations by the surface word', async () => {
    mockGetAnkiWordStatuses.mockResolvedValueOnce([{ word: '你好(ni hao)', factor: 2300, queue: 2, type: 2 }]);

    const { refreshAnkiWordsCache, findAnkiWordMatchInCache } = await import('./ankiWordsCache');
    const options = { language: 'zh', languageData: hanPinyinLanguage };
    await refreshAnkiWordsCache(options);

    expect(findAnkiWordMatchInCache(['你好'], options)).toEqual({
      word: '你好(ni hao)',
      lookupKey: '你好',
      cards: [{ word: '你好(ni hao)', factor: 2300, queue: 2, type: 2 }],
    });
    expect(findAnkiWordMatchInCache(['你好(ni hao)'], options)).toEqual({
      word: '你好(ni hao)',
      lookupKey: '你好(ni hao)',
      cards: [{ word: '你好(ni hao)', factor: 2300, queue: 2, type: 2 }],
    });
  });

  it('returns the original Anki expression when matching by metadata-stripped reading annotations', async () => {
    mockGetAnkiWordStatuses.mockResolvedValueOnce([{ word: '你好(ni hao)', factor: 2300, queue: 2, type: 2 }]);

    const { refreshAnkiWordsCache, findAnkiWordMatchInCache, findWordInAnkiCache } = await import('./ankiWordsCache');
    const options = { language: 'zh', languageData: hanPinyinLanguage };
    await refreshAnkiWordsCache(options);

    expect(findWordInAnkiCache(['你好'], options)).toBe('你好(ni hao)');
    expect(findAnkiWordMatchInCache(['你好'], options)).toEqual({
      word: '你好(ni hao)',
      lookupKey: '你好',
      cards: [{ word: '你好(ni hao)', factor: 2300, queue: 2, type: 2 }],
    });
  });

  it('treats language metadata changes as a different cache signature', async () => {
    const {
      fetchAnkiWordsCache,
      getActiveAnkiWordsCacheSignature,
      getAnkiWordsCacheSignature,
    } = await import('./ankiWordsCache');
    const legacyOptions = { language: 'de', languageData: null };
    const metadataOptions = { language: 'de', languageData: latinLanguage };

    await fetchAnkiWordsCache(legacyOptions);
    expect(getActiveAnkiWordsCacheSignature()).toBe(getAnkiWordsCacheSignature(legacyOptions));

    mockGetAnkiWordStatuses.mockResolvedValueOnce([{ word: 'Example(かな)', factor: 2300, queue: 2, type: 2 }]);
    await fetchAnkiWordsCache(metadataOptions);

    expect(mockGetAnkiWordStatuses).toHaveBeenCalledTimes(2);
    expect(getActiveAnkiWordsCacheSignature()).toBe(getAnkiWordsCacheSignature(metadataOptions));
  });

  it('does not clear a fetched language cache when probing another language synchronously', async () => {
    mockGetAnkiWordStatuses.mockResolvedValueOnce([{ word: 'Example(かな)', factor: 2300, queue: 2, type: 2 }]);

    const { refreshAnkiWordsCache, findWordInAnkiCache } = await import('./ankiWordsCache');
    const latinOptions = { language: 'de', languageData: latinLanguage };
    const hanOptions = { language: 'zh', languageData: hanPinyinLanguage };
    await refreshAnkiWordsCache(latinOptions);

    expect(findWordInAnkiCache(['Example(かな)'], latinOptions)).toBe('Example(かな)');
    expect(findWordInAnkiCache(['Example'], hanOptions)).toBeNull();
    expect(findWordInAnkiCache(['Example(かな)'], latinOptions)).toBe('Example(かな)');
    expect(mockGetAnkiWordStatuses).toHaveBeenCalledTimes(1);
  });

  it('keeps fetched indexes for multiple language metadata signatures', async () => {
    mockGetAnkiWordStatuses
      .mockResolvedValueOnce([{ word: 'Example(かな)', factor: 2300, queue: 2, type: 2 }])
      .mockResolvedValueOnce([{ word: '你好(ni hao)', factor: 2500, queue: 2, type: 2 }]);

    const { refreshAnkiWordsCache, findAnkiWordMatchInCache } = await import('./ankiWordsCache');
    const latinOptions = { language: 'de', languageData: latinLanguage };
    const hanOptions = { language: 'zh', languageData: hanPinyinLanguage };
    await refreshAnkiWordsCache(latinOptions);
    await refreshAnkiWordsCache(hanOptions);

    expect(findAnkiWordMatchInCache(['Example(かな)'], latinOptions)).toEqual({
      word: 'Example(かな)',
      lookupKey: 'Example(かな)',
      cards: [{ word: 'Example(かな)', factor: 2300, queue: 2, type: 2 }],
    });
    expect(findAnkiWordMatchInCache(['你好'], hanOptions)).toEqual({
      word: '你好(ni hao)',
      lookupKey: '你好',
      cards: [{ word: '你好(ni hao)', factor: 2500, queue: 2, type: 2 }],
    });
    expect(mockGetAnkiWordStatuses).toHaveBeenCalledTimes(2);
  });

  it('does not include reading annotation display toggles in the cache signature', async () => {
    const { getAnkiWordsCacheSignature } = await import('./ankiWordsCache');
    const withLegacyFlag: LanguageData = {
      ...latinLanguage,
    };

    expect(getAnkiWordsCacheSignature({ language: 'de', languageData: withLegacyFlag }))
      .toBe(getAnkiWordsCacheSignature({ language: 'de', languageData: latinLanguage }));
  });
});
