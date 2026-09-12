import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnkiWordStatusRecord } from '../../shared/backends/types';
import type { LanguageData } from '../../shared/types';

const mockGetAnkiWords = vi.fn<() => Promise<string[]>>();
const mockGetAnkiWordStatuses = vi.fn<() => Promise<AnkiWordStatusRecord[]>>();
const mockQueryKnowledgeEvents = vi.fn<(keys: string[]) => Promise<Record<string, unknown[]>>>();
const mockGetKnowledgeStates = vi.fn<(keys: string[]) => Promise<Record<string, unknown>>>();
const mockAppendKnowledgeEvents = vi.fn<(events: Record<string, unknown[]>) => Promise<boolean>>();

vi.mock('../../shared/backends', () => ({
  getBackend: () => ({
    getAnkiWords: mockGetAnkiWords,
    getAnkiWordStatuses: mockGetAnkiWordStatuses,
  }),
}));
vi.mock('../../shared/bridges', () => ({
  getBridge: () => ({
    knowledgeEvents: { queryKnowledgeEvents: mockQueryKnowledgeEvents, getKnowledgeStates: mockGetKnowledgeStates },
  }),
}));
vi.mock('./knowledgeEvents', () => ({
  appendEvents: mockAppendKnowledgeEvents,
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
    mockQueryKnowledgeEvents.mockReset();
    mockQueryKnowledgeEvents.mockResolvedValue({});
    mockGetKnowledgeStates.mockReset();
    mockGetKnowledgeStates.mockResolvedValue({});
    mockAppendKnowledgeEvents.mockReset();
    mockAppendKnowledgeEvents.mockResolvedValue(true);
  });

  it('returns the first matching candidate word from the cache', async () => {
    const { refreshAnkiWordsCache, findWordInAnkiCache } = await import('./ankiWordsCache');
    await refreshAnkiWordsCache();
    expect(findWordInAnkiCache(['なかま', '仲間'])).toBe('仲間');
    expect(findWordInAnkiCache(['仲間', 'なかま'])).toBe('仲間');
  });

  it('refreshes Anki source metadata without manufacturing learner evidence', async () => {
    mockGetAnkiWordStatuses.mockResolvedValue([{ word: '仲間', factor: 2300, queue: 2, type: 2 }]);
    const { refreshAnkiWordsCache } = await import('./ankiWordsCache');
    await refreshAnkiWordsCache({ language: 'ja', languageData: latinLanguage, ankiLearningThreshold: 1500, ankiKnownThreshold: 1800 });
    expect(mockAppendKnowledgeEvents).not.toHaveBeenCalled();
    expect(mockGetKnowledgeStates).not.toHaveBeenCalled();
  });

  it('syncs real reviews only for changed cards on cache refresh', async () => {
    const card = { word: 'entry', cardId: 42, mod: 1, factor: 2300, queue: 2, type: 2 };
    mockGetAnkiWordStatuses.mockResolvedValue([card]);
    const { refreshAnkiWordsCache, registerAnkiReviewSync, findWordInAnkiCache } = await import('./ankiWordsCache');
    const sync = vi.fn().mockResolvedValue(undefined);
    const unregister = registerAnkiReviewSync(sync);
    await refreshAnkiWordsCache({ language: 'example', languageData: latinLanguage });
    expect(sync).toHaveBeenCalledWith('example', [card]);
    findWordInAnkiCache(['entry']);
    await refreshAnkiWordsCache({ language: 'example', languageData: latinLanguage });
    expect(sync).toHaveBeenCalledTimes(1);
    mockGetAnkiWordStatuses.mockResolvedValue([{ ...card, mod: 2 }]);
    await refreshAnkiWordsCache({ language: 'example', languageData: latinLanguage });
    expect(sync).toHaveBeenCalledTimes(2);
    mockGetAnkiWordStatuses.mockRejectedValue(new Error('disconnected'));
    await refreshAnkiWordsCache({ language: 'example', languageData: latinLanguage });
    expect(sync).toHaveBeenCalledTimes(2);
    expect(mockAppendKnowledgeEvents).not.toHaveBeenCalled();
    unregister();
  });

  it('retries a failed evidence sync on the next explicit cache refresh', async () => {
    mockGetAnkiWordStatuses.mockResolvedValue([{ word: 'retry', cardId: 43, mod: 1 }]);
    const { refreshAnkiWordsCache, registerAnkiReviewSync } = await import('./ankiWordsCache');
    const sync = vi.fn().mockRejectedValueOnce(new Error('revlog unavailable')).mockResolvedValue(undefined);
    const unregister = registerAnkiReviewSync(sync);
    await refreshAnkiWordsCache({ language: 'example' });
    await refreshAnkiWordsCache({ language: 'example' });
    expect(sync).toHaveBeenCalledTimes(2);
    unregister();
  });

  it('returns null when none of the candidate forms exist in Anki', async () => {
    const { refreshAnkiWordsCache, findWordInAnkiCache } = await import('./ankiWordsCache');
    await refreshAnkiWordsCache();

    expect(findWordInAnkiCache(['なかま', 'ともだち'])).toBeNull();
  });

  it('auto-fetches on the first read without explicit wiring', async () => {
    mockGetAnkiWordStatuses.mockResolvedValue([{ word: '仲間', factor: 2300, queue: 2, type: 2 }]);

    const { findAnkiWordMatchInCache } = await import('./ankiWordsCache');
    expect(findAnkiWordMatchInCache(['仲間'])).toBeNull();

    await Promise.resolve();
    await Promise.resolve();

    expect(findAnkiWordMatchInCache(['仲間'])?.word).toBe('仲間');
  });

  it('does not retry a failed auto-fetch within the backoff window', async () => {
    mockGetAnkiWordStatuses.mockRejectedValue(new Error('AnkiConnect unreachable'));

    const { findAnkiWordMatchInCache, getAnkiCacheLastError } = await import('./ankiWordsCache');
    expect(findAnkiWordMatchInCache(['仲間'])).toBeNull();
    await Promise.resolve();
    await Promise.resolve();

    findAnkiWordMatchInCache(['仲間']);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockGetAnkiWordStatuses).toHaveBeenCalledTimes(1);
    expect(getAnkiCacheLastError()).toContain('AnkiConnect unreachable');
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
    // The han probe auto-fetches its own unfetched entry (one background call);
    // it must not disturb the already-fetched latin entry.
    expect(mockGetAnkiWordStatuses).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    await Promise.resolve();
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

describe('ankiCacheVersion and lastError', () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetAnkiWords.mockReset();
    mockGetAnkiWords.mockResolvedValue(['仲間']);
    mockGetAnkiWordStatuses.mockReset();
    mockGetAnkiWordStatuses.mockResolvedValue([{ word: '仲間', factor: 1300, queue: 0, type: 0 }]);
  });

  it('bumps ankiCacheVersion on fetch success', async () => {
    const { ankiCacheVersion, fetchAnkiWordsCache } = await import('./ankiWordsCache');
    expect(ankiCacheVersion()).toBe(0);

    await fetchAnkiWordsCache();

    expect(ankiCacheVersion()).toBeGreaterThan(0);
  });

  it('bumps ankiCacheVersion and records lastError on fetch failure', async () => {
    mockGetAnkiWordStatuses.mockRejectedValueOnce(new Error('anki down'));

    const { ankiCacheVersion, fetchAnkiWordsCache, getAnkiCacheLastError, isAnkiCacheFetched } = await import('./ankiWordsCache');
    await fetchAnkiWordsCache();

    expect(ankiCacheVersion()).toBeGreaterThan(0);
    expect(getAnkiCacheLastError()).toBe('anki down');
    expect(isAnkiCacheFetched()).toBe(false);
  });

  it('records non-Error rejection reasons as strings', async () => {
    mockGetAnkiWordStatuses.mockRejectedValueOnce('plain failure');

    const { fetchAnkiWordsCache, getAnkiCacheLastError } = await import('./ankiWordsCache');
    await fetchAnkiWordsCache();

    expect(getAnkiCacheLastError()).toBe('plain failure');
  });

  it('clears lastError on subsequent fetch success', async () => {
    mockGetAnkiWordStatuses.mockRejectedValueOnce(new Error('boom'));

    const { fetchAnkiWordsCache, refreshAnkiWordsCache, getAnkiCacheLastError } = await import('./ankiWordsCache');
    await fetchAnkiWordsCache();
    expect(getAnkiCacheLastError()).toBe('boom');

    await refreshAnkiWordsCache();

    expect(getAnkiCacheLastError()).toBeNull();
  });

  it('scopes lastError to the cache entry addressed by options', async () => {
    mockGetAnkiWordStatuses.mockRejectedValueOnce(new Error('scoped'));

    const { fetchAnkiWordsCache, getAnkiCacheLastError } = await import('./ankiWordsCache');
    const options = { language: 'de', languageData: null };
    await fetchAnkiWordsCache(options);

    expect(getAnkiCacheLastError(options)).toBe('scoped');
    expect(getAnkiCacheLastError({ language: 'zh', languageData: null })).toBeNull();
  });

  it('bumps ankiCacheVersion on refreshAnkiWordsCache completion', async () => {
    const { ankiCacheVersion, fetchAnkiWordsCache, refreshAnkiWordsCache } = await import('./ankiWordsCache');
    await fetchAnkiWordsCache();
    const before = ankiCacheVersion();

    await refreshAnkiWordsCache();

    expect(ankiCacheVersion()).toBeGreaterThan(before);
  });

  it('bumps ankiCacheVersion on clearAnkiWordsCache', async () => {
    const { ankiCacheVersion, fetchAnkiWordsCache, clearAnkiWordsCache } = await import('./ankiWordsCache');
    await fetchAnkiWordsCache();
    const before = ankiCacheVersion();

    clearAnkiWordsCache();

    expect(ankiCacheVersion()).toBeGreaterThan(before);
  });
});

describe('searchAnkiWordsCache', () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetAnkiWords.mockReset();
    mockGetAnkiWords.mockResolvedValue(['仲間']);
    mockGetAnkiWordStatuses.mockReset();
    mockGetAnkiWordStatuses.mockResolvedValue([
      { word: 'Apple', factor: 1300, queue: 0, type: 0 },
      { word: 'Pineapple', factor: 1300, queue: 0, type: 0 },
      { word: 'applesauce', factor: 1300, queue: 0, type: 0 },
      { word: 'Banana', factor: 1300, queue: 0, type: 0 },
    ]);
  });

  it('returns [] when the cache entry has not fetched yet', async () => {
    const { searchAnkiWordsCache } = await import('./ankiWordsCache');
    expect(searchAnkiWordsCache('Apple')).toEqual([]);
  });

  it('returns [] for an empty or whitespace-only query', async () => {
    const { searchAnkiWordsCache, fetchAnkiWordsCache } = await import('./ankiWordsCache');
    await fetchAnkiWordsCache();
    expect(searchAnkiWordsCache('')).toEqual([]);
    expect(searchAnkiWordsCache('   ')).toEqual([]);
  });

  it('ranks prefix matches before contains matches, case-insensitively', async () => {
    const { searchAnkiWordsCache, fetchAnkiWordsCache } = await import('./ankiWordsCache');
    await fetchAnkiWordsCache();
    expect(searchAnkiWordsCache('apple')).toEqual(['Apple', 'applesauce', 'Pineapple']);
  });

  it('caps the result count at max', async () => {
    const { searchAnkiWordsCache, fetchAnkiWordsCache } = await import('./ankiWordsCache');
    await fetchAnkiWordsCache();
    expect(searchAnkiWordsCache('apple', 2)).toEqual(['Apple', 'applesauce']);
  });

  it('searches only the cache entry addressed by options', async () => {
    const { searchAnkiWordsCache, fetchAnkiWordsCache } = await import('./ankiWordsCache');
    const options = { language: 'de', languageData: null };
    await fetchAnkiWordsCache(options);
    expect(searchAnkiWordsCache('Apple', 6, options)).toEqual(['Apple', 'applesauce', 'Pineapple']);
    expect(searchAnkiWordsCache('Apple', 6, { language: 'zh', languageData: null })).toEqual([]);
  });
});
