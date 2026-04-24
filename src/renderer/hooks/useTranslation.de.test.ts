import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranslationResponse } from '../../shared/types';

const mockTranslate = vi.fn<(word: string, language?: string) => Promise<TranslationResponse>>();
const mockTokenize = vi.fn<(text: string, language?: string) => Promise<unknown[]>>();
const mockKvGet = vi.fn<(key: string) => Promise<string | null>>().mockResolvedValue(null);
const mockKvSet = vi.fn<(key: string, value: string) => Promise<void>>().mockResolvedValue(undefined);
const mockGetCachedTranslationByLanguageDB = vi.fn<(word: string, language?: string) => Promise<TranslationResponse | null>>().mockResolvedValue(null);
const mockSetCachedTranslationByLanguageDB = vi.fn<(word: string, data: TranslationResponse, language?: string) => Promise<void>>().mockResolvedValue(undefined);
const mockSetCachedTranslationBatchByLanguageDB = vi.fn().mockResolvedValue(undefined);
const mockGetCachedDictionaryByLanguageDB = vi.fn().mockResolvedValue(null);
const mockSetCachedDictionaryByLanguageDB = vi.fn().mockResolvedValue(undefined);
const mockGetCachedTokensByLanguageDB = vi.fn().mockResolvedValue(null);
const mockSetCachedTokensByLanguageDB = vi.fn().mockResolvedValue(undefined);

vi.mock('../../shared/backends', () => ({
  getBackend: () => ({
    translate: (...args: unknown[]) => mockTranslate(...(args as [string, string?])),
    tokenize: (...args: unknown[]) => mockTokenize(...(args as [string, string?])),
  }),
}));

vi.mock('../../shared/bridges', () => ({
  getBridge: () => ({
    kvStore: {
      kvGet: (...args: unknown[]) => mockKvGet(...(args as [string])),
      kvSet: (...args: unknown[]) => mockKvSet(...(args as [string, string])),
    },
  }),
}));

vi.mock('../services/offlineCache', () => ({
  getCachedTranslationByLanguageDB: (...args: unknown[]) => mockGetCachedTranslationByLanguageDB(...(args as [string, string?])),
  setCachedTranslationByLanguageDB: (...args: unknown[]) => mockSetCachedTranslationByLanguageDB(...(args as [string, TranslationResponse, string?])),
  setCachedTranslationBatchByLanguageDB: (...args: unknown[]) => mockSetCachedTranslationBatchByLanguageDB(...args),
  getCachedDictionaryByLanguageDB: (...args: unknown[]) => mockGetCachedDictionaryByLanguageDB(...args),
  setCachedDictionaryByLanguageDB: (...args: unknown[]) => mockSetCachedDictionaryByLanguageDB(...args),
  getCachedTokensByLanguageDB: (...args: unknown[]) => mockGetCachedTokensByLanguageDB(...args),
  setCachedTokensByLanguageDB: (...args: unknown[]) => mockSetCachedTokensByLanguageDB(...args),
}));

function makeGermanResponse(reading: string, shortDef: string, fullDef: string): TranslationResponse {
  return {
    data: [
      { reading, definitions: shortDef },
      { reading, definitions: fullDef },
    ],
  };
}

describe('useTranslation German integration cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockKvGet.mockResolvedValue(null);
    mockGetCachedTranslationByLanguageDB.mockResolvedValue(null);
    mockTranslate.mockImplementation(async (word: string, language?: string) => {
      if (language === 'de' && (word === 'Haus' || word === 'haus')) {
        return makeGermanResponse('Haus', 'house', '<div class="de-entry"><h3>Haus <span class="pos">n</span></h3></div>');
      }
      if (language === 'de' && word === 'xyzzynotaword') {
        return { data: [] };
      }
      if (language === 'ja' && word === 'Haus') {
        return {
          data: [
            { reading: 'ハウス', definitions: 'house (ja cache lane)' },
            { reading: 'ハウス', definitions: '<div>house (ja cache lane)</div>' },
            { pitches: [{ position: 1 }] },
          ],
        };
      }
      return makeGermanResponse(word, `short-${word}`, `<div>${word}</div>`);
    });
    vi.resetModules();
  });

  it('known German word returns short + full entries and caches under de::<word>', async () => {
    const { fetchTranslation, getCachedTranslation } = await import('./useTranslation');
    const result = await fetchTranslation('Haus', 'de');
    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toEqual({ reading: 'Haus', definitions: 'house' });
    expect(String(result.data[1]?.definitions)).toContain('de-entry');
    expect(getCachedTranslation('Haus', 'de')).toEqual(result);
    expect(mockTranslate).toHaveBeenCalledWith('Haus', 'de');
    expect(mockSetCachedTranslationByLanguageDB).toHaveBeenCalledWith('Haus', result, 'de');
  });

  it('unknown German word returns empty data and still caches the response', async () => {
    const { fetchTranslation, getCachedTranslation } = await import('./useTranslation');
    const result = await fetchTranslation('xyzzynotaword', 'de');
    expect(result).toEqual({ data: [] });
    expect(getCachedTranslation('xyzzynotaword', 'de')).toEqual({ data: [] });
    expect(mockSetCachedTranslationByLanguageDB).toHaveBeenCalledWith('xyzzynotaword', { data: [] }, 'de');
  });

  it('case variants keep separate cache keys and backend calls for German', async () => {
    const { fetchTranslation, getCachedTranslation } = await import('./useTranslation');
    const upper = await fetchTranslation('Haus', 'de');
    const lower = await fetchTranslation('haus', 'de');
    expect(mockTranslate).toHaveBeenNthCalledWith(1, 'Haus', 'de');
    expect(mockTranslate).toHaveBeenNthCalledWith(2, 'haus', 'de');
    expect(getCachedTranslation('Haus', 'de')).toEqual(upper);
    expect(getCachedTranslation('haus', 'de')).toEqual(lower);
    expect(upper).toEqual(lower);
  });

  it('language switching keeps German and Japanese cache entries isolated', async () => {
    const { fetchTranslation, getCachedTranslation } = await import('./useTranslation');
    const german = await fetchTranslation('Haus', 'de');
    const japanese = await fetchTranslation('Haus', 'ja');
    expect(german).not.toEqual(japanese);
    expect(getCachedTranslation('Haus', 'de')).toEqual(german);
    expect(getCachedTranslation('Haus', 'ja')).toEqual(japanese);
    expect(mockTranslate).toHaveBeenNthCalledWith(1, 'Haus', 'de');
    expect(mockTranslate).toHaveBeenNthCalledWith(2, 'Haus', 'ja');
  });
});
