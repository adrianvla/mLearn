import { createRoot } from 'solid-js';
import type { TranslationResponse, DictionaryEntry, LanguageData } from '../../shared/types';

type MockTranslateOptions = { dictionaryTargetLanguage?: string };
const mockTranslate = vi.fn<(word: string, language?: string, options?: MockTranslateOptions) => Promise<TranslationResponse>>();
const mockTokenize = vi.fn<(text: string, language?: string) => Promise<unknown[]>>();
const mockKvGet = vi.fn<(key: string) => Promise<string | null>>().mockResolvedValue(null);
const mockKvSet = vi.fn<(key: string, value: string) => Promise<void>>().mockResolvedValue(undefined);

vi.mock('../../shared/backends', () => ({
  getBackend: () => ({
    translate: (...args: unknown[]) => mockTranslate(...(args as [string, string?, MockTranslateOptions?])),
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

const mockGetCachedTranslationByLanguageDB = vi.fn<(word: string, language?: string) => Promise<TranslationResponse | null>>().mockResolvedValue(null);
const mockSetCachedTranslationByLanguageDB = vi.fn<(word: string, data: TranslationResponse, language?: string) => Promise<void>>().mockResolvedValue(undefined);
const mockSetCachedTranslationBatchByLanguageDB = vi.fn().mockResolvedValue(undefined);
const mockGetCachedDictionaryByLanguageDB = vi.fn<(word: string, reading: string, language?: string) => Promise<DictionaryEntry[] | null>>().mockResolvedValue(null);
const mockSetCachedDictionaryByLanguageDB = vi.fn().mockResolvedValue(undefined);
const mockGetCachedTokensByLanguageDB = vi.fn<(text: string, language?: string, namespace?: string) => Promise<unknown[] | null>>().mockResolvedValue(null);
const mockSetCachedTokensByLanguageDB = vi.fn().mockResolvedValue(undefined);

vi.mock('../services/offlineCache', () => ({
  getCachedTranslationByLanguageDB: (...args: unknown[]) => mockGetCachedTranslationByLanguageDB(...(args as [string, string?])),
  setCachedTranslationByLanguageDB: (...args: unknown[]) => mockSetCachedTranslationByLanguageDB(...(args as [string, TranslationResponse, string?])),
  setCachedTranslationBatchByLanguageDB: (...args: unknown[]) => mockSetCachedTranslationBatchByLanguageDB(...args),
  getCachedDictionaryByLanguageDB: (...args: unknown[]) => mockGetCachedDictionaryByLanguageDB(...(args as [string, string, string?])),
  setCachedDictionaryByLanguageDB: (...args: unknown[]) => mockSetCachedDictionaryByLanguageDB(...args),
  getCachedTokensByLanguageDB: (...args: unknown[]) => mockGetCachedTokensByLanguageDB(...(args as [string, string?, string?])),
  setCachedTokensByLanguageDB: (...args: unknown[]) => mockSetCachedTokensByLanguageDB(...args),
}));

function makeTranslationResponse(word: string): TranslationResponse {
  return {
    data: [
      {
        reading: `${word}reading`,
        definitions: [`meaning of ${word}`],
      },
    ],
  };
}

const pinyinLanguageData: LanguageData = {
  name: 'Chinese',
  colour_codes: {},
  settings: { fixed: {} },
  textProcessing: { scriptProfile: { acceptedScripts: ['Han', 'Latn'] } },
  runtime: {
    nlp: {
      dictionary: {
        readingPath: ['pinyin', 'value'],
      },
    },
  },
};

const nestedGlossLanguageData = {
  name: 'Nested Gloss Language',
  colour_codes: {},
  settings: { fixed: {} },
  runtime: {
    nlp: {
      dictionary: {
        readingPath: ['pinyin', 'value'],
        definitionsPath: ['glosses', 'english'],
      },
    },
  },
} as unknown as LanguageData;

describe('useTranslation', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockKvGet.mockResolvedValue(null);
    mockGetCachedTranslationByLanguageDB.mockResolvedValue(null);
    mockTranslate.mockImplementation(async (word: string) => makeTranslationResponse(word));
    vi.resetModules();
  });

  async function getHook() {
    const { useTranslation } = await import('./useTranslation');
    return useTranslation;
  }

  it('initial translation signal is undefined', async () => {
    const useTranslation = await getHook();
    createRoot((dispose) => {
      const hook = useTranslation();
      expect(hook.translation()).toBeUndefined();
      dispose();
    });
  });

  it('initial isLoading is false', async () => {
    const useTranslation = await getHook();
    createRoot((dispose) => {
      const hook = useTranslation();
      expect(hook.isLoading()).toBe(false);
      dispose();
    });
  });

  it('initial error is undefined', async () => {
    const useTranslation = await getHook();
    createRoot((dispose) => {
      const hook = useTranslation();
      expect(hook.error()).toBeUndefined();
      dispose();
    });
  });

  it('hook returns all expected methods', async () => {
    const useTranslation = await getHook();
    createRoot((dispose) => {
      const hook = useTranslation();
      expect(typeof hook.translate).toBe('function');
      expect(typeof hook.translateWord).toBe('function');
      expect(typeof hook.setOverride).toBe('function');
      expect(typeof hook.clearCache).toBe('function');
      expect(typeof hook.isLoading).toBe('function');
      expect(typeof hook.error).toBe('function');
      dispose();
    });
  });
});

describe('fetchTranslation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockKvGet.mockResolvedValue(null);
    mockGetCachedTranslationByLanguageDB.mockResolvedValue(null);
    mockTranslate.mockImplementation(async (word: string) => makeTranslationResponse(word));
    vi.resetModules();
  });

  it('calls backend.translate for an uncached word', async () => {
    const { fetchTranslation } = await import('./useTranslation');
    await fetchTranslation('hello');
    expect(mockTranslate).toHaveBeenCalledWith('hello', undefined);
  });

  it('returns the translation from the backend', async () => {
    const expected = makeTranslationResponse('hello');
    mockTranslate.mockResolvedValue(expected);
    const { fetchTranslation } = await import('./useTranslation');
    const result = await fetchTranslation('hello');
    expect(result).toEqual(expected);
  });

  it('caches result — second call does not call backend again', async () => {
    const { fetchTranslation } = await import('./useTranslation');
    await fetchTranslation('hello');
    await fetchTranslation('hello');
    expect(mockTranslate).toHaveBeenCalledTimes(1);
  });

  it('returns cached result on second call', async () => {
    const expected = makeTranslationResponse('cached');
    mockTranslate.mockResolvedValueOnce(expected);
    const { fetchTranslation } = await import('./useTranslation');
    const first = await fetchTranslation('cached');
    const second = await fetchTranslation('cached');
    expect(first).toEqual(second);
    expect(second).toEqual(expected);
  });

  it('checks IndexedDB before calling backend', async () => {
    const dbResult = makeTranslationResponse('dbword');
    mockGetCachedTranslationByLanguageDB.mockResolvedValueOnce(dbResult);
    const { fetchTranslation } = await import('./useTranslation');
    const result = await fetchTranslation('dbword');
    expect(result).toEqual(dbResult);
    expect(mockTranslate).not.toHaveBeenCalled();
  });

  it('stores backend result in IndexedDB', async () => {
    const data = makeTranslationResponse('store');
    mockTranslate.mockResolvedValue(data);
    const { fetchTranslation } = await import('./useTranslation');
    await fetchTranslation('store');
    expect(mockSetCachedTranslationByLanguageDB).toHaveBeenCalledWith('store', data, undefined);
  });

  it('respects overrides from KV store over backend', async () => {
    const override = makeTranslationResponse('overridden');
    mockKvGet.mockResolvedValueOnce(JSON.stringify({ 'default::hello': override }));
    const { fetchTranslation } = await import('./useTranslation');
    const result = await fetchTranslation('hello');
    expect(result).toEqual(override);
    expect(mockTranslate).not.toHaveBeenCalled();
  });

  it('falls back to empty overrides when KV get fails', async () => {
    mockKvGet.mockRejectedValueOnce(new Error('KV error'));
    const data = makeTranslationResponse('fallback');
    mockTranslate.mockResolvedValue(data);
    const { fetchTranslation } = await import('./useTranslation');
    const result = await fetchTranslation('fallback');
    expect(result).toEqual(data);
  });

  it('different words each call backend once', async () => {
    const { fetchTranslation } = await import('./useTranslation');
    await fetchTranslation('word1');
    await fetchTranslation('word2');
    await fetchTranslation('word3');
    expect(mockTranslate).toHaveBeenCalledTimes(3);
    expect(mockTranslate).toHaveBeenCalledWith('word1', undefined);
    expect(mockTranslate).toHaveBeenCalledWith('word2', undefined);
    expect(mockTranslate).toHaveBeenCalledWith('word3', undefined);
  });

  it('uses language-aware cache and backend keys', async () => {
    const { fetchTranslation } = await import('./useTranslation');
    await fetchTranslation('haus', 'de');
    expect(mockGetCachedTranslationByLanguageDB).toHaveBeenCalledWith('haus', 'de');
    expect(mockTranslate).toHaveBeenCalledWith('haus', 'de');
    expect(mockSetCachedTranslationByLanguageDB).toHaveBeenCalledWith('haus', expect.any(Object), 'de');
  });

  it('versions translation cache keys by installed language and dictionary package metadata', async () => {
    const languageData: LanguageData = {
      name: 'Japanese',
      languageData: {
        version: 'ja-package-2026.06.29',
        assets: [],
        dictionaryPacks: {
          en: {
            targetLanguage: 'en',
            name: 'English',
            version: 'ja-en-dictionary-2026.06.29',
            assets: [],
          },
        },
      },
    };
    const { fetchTranslation, getCachedTranslation } = await import('./useTranslation');

    await fetchTranslation('開く', 'ja', {
      dictionaryTargetLanguage: 'en',
      languageData,
    });

    const cacheLanguage = 'ja@language:ja-package-2026.06.29@dictionary:en:ja-en-dictionary-2026.06.29';
    expect(mockGetCachedTranslationByLanguageDB).toHaveBeenCalledWith('開く', cacheLanguage, 'en');
    expect(mockSetCachedTranslationByLanguageDB).toHaveBeenCalledWith('開く', expect.any(Object), cacheLanguage, 'en');
    expect(getCachedTranslation('開く', 'ja', { dictionaryTargetLanguage: 'en' })).toBeNull();
    expect(getCachedTranslation('開く', 'ja', { dictionaryTargetLanguage: 'en', languageData })).toEqual(makeTranslationResponse('開く'));
  });

  it('keeps translation cache lanes separate for different dictionary target languages', async () => {
    const english = { data: [{ definitions: ['red'], reading: 'あかい' }] } as TranslationResponse;
    const french = { data: [{ definitions: ['rouge'], reading: 'あかい' }] } as TranslationResponse;
    mockTranslate
      .mockResolvedValueOnce(english)
      .mockResolvedValueOnce(french);

    const { fetchTranslation, getCachedTranslation } = await import('./useTranslation');
    await fetchTranslation('赤い', 'ja', { dictionaryTargetLanguage: 'en' });
    await fetchTranslation('赤い', 'ja', { dictionaryTargetLanguage: 'fr' });

    expect(mockTranslate).toHaveBeenCalledTimes(2);
    expect(mockTranslate).toHaveBeenNthCalledWith(1, '赤い', 'ja', { dictionaryTargetLanguage: 'en' });
    expect(mockTranslate).toHaveBeenNthCalledWith(2, '赤い', 'ja', { dictionaryTargetLanguage: 'fr' });
    expect(mockGetCachedTranslationByLanguageDB).toHaveBeenNthCalledWith(1, '赤い', 'ja', 'en');
    expect(mockGetCachedTranslationByLanguageDB).toHaveBeenNthCalledWith(2, '赤い', 'ja', 'fr');
    expect(mockSetCachedTranslationByLanguageDB).toHaveBeenNthCalledWith(1, '赤い', english, 'ja', 'en');
    expect(mockSetCachedTranslationByLanguageDB).toHaveBeenNthCalledWith(2, '赤い', french, 'ja', 'fr');
    expect(getCachedTranslation('赤い', 'ja', { dictionaryTargetLanguage: 'en' })).toEqual(english);
    expect(getCachedTranslation('赤い', 'ja', { dictionaryTargetLanguage: 'fr' })).toEqual(french);
  });

  it('buildTranslationLookupCandidates keeps direct lookup first before canonical and variant forms', async () => {
    const { buildTranslationLookupCandidates } = await import('./useTranslation');
    const candidates = buildTranslationLookupCandidates(
      'идут',
      (word) => word === 'идут' ? 'идти' : word,
      (word) => word === 'идут' ? ['идти', 'идти', 'ходить'] : [],
    );
    expect(candidates).toEqual(['идут', 'идти', 'ходить']);
  });

  it('buildTranslationLookupCandidates includes metadata-normalized dictionary candidates', async () => {
    const { buildTranslationLookupCandidates } = await import('./useTranslation');
    const languageData: LanguageData = {
      name: 'German',
      targetLanguage: 'de',
      runtime: {
        nlp: {
          dictionary: {
            lookup: {
              normalizers: ['casefold'],
            },
          },
        },
      },
    };

    const candidates = buildTranslationLookupCandidates(
      'Straße',
      (word) => word,
      undefined,
      languageData,
    );

    expect(candidates).toEqual(['Straße', 'strasse']);
  });

  it('fetchTranslation tries reading-script input before canonical surface forms', async () => {
    const languageData: LanguageData = {
      name: 'Japanese',
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Han', 'Hira', 'Kana'] },
        lexemeNormalization: {
          type: 'surface-reading',
          surfaceScripts: ['Han'],
          readingScripts: ['Hira', 'Kana'],
          readingNormalizer: 'kana-to-hiragana',
        },
      },
    };
    const readingSpecific = {
      data: [{ reading: 'ひらく', definitions: ['to open'] }],
    } satisfies TranslationResponse;
    mockTranslate.mockImplementation(async (word: string) => (
      word === 'ひらく' ? readingSpecific : makeTranslationResponse(word)
    ));

    const { fetchTranslation } = await import('./useTranslation');
    const result = await fetchTranslation('ひらく', 'ja', {
      getCanonicalForm: (word) => word === 'ひらく' ? '開く' : word,
      languageData,
    });

    expect(result).toEqual(readingSpecific);
    expect(mockTranslate).toHaveBeenCalledTimes(1);
    expect(mockTranslate).toHaveBeenCalledWith('ひらく', 'ja');
    expect(mockTranslate).not.toHaveBeenCalledWith('開く', 'ja');
  });

  it('fetchTranslation falls back to canonical forms for inflected words', async () => {
    mockTranslate.mockImplementation(async (word: string) => {
      if (word === 'идут') return { data: [] };
      return makeTranslationResponse(word);
    });

    const { fetchTranslation, getCachedTranslation } = await import('./useTranslation');
    const result = await fetchTranslation('идут', 'ru', {
      getCanonicalForm: (word) => word === 'идут' ? 'идти' : word,
    });

    expect(mockTranslate).toHaveBeenNthCalledWith(1, 'идут', 'ru');
    expect(mockTranslate).toHaveBeenNthCalledWith(2, 'идти', 'ru');
    expect(result).toEqual(makeTranslationResponse('идти'));
    expect(getCachedTranslation('идут', 'ru')).toEqual(result);
    expect(mockSetCachedTranslationByLanguageDB).toHaveBeenCalledWith('идут', result, 'ru');
  });

  it('fetchTranslation does not let a cached empty surface miss block variant metadata', async () => {
    const variantTranslation = makeTranslationResponse('كتب');
    mockGetCachedTranslationByLanguageDB.mockImplementation(async (word: string) => {
      if (word === 'يكتب') return { data: [] };
      if (word === 'كتب') return variantTranslation;
      return null;
    });

    const { fetchTranslation } = await import('./useTranslation');
    const result = await fetchTranslation('يكتب', 'ar', {
      getWordVariants: (word) => word === 'يكتب' ? ['كتب'] : [],
    });

    expect(result).toEqual(variantTranslation);
    expect(mockTranslate).not.toHaveBeenCalled();
  });
});

describe('getCachedTranslation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockKvGet.mockResolvedValue(null);
    mockGetCachedTranslationByLanguageDB.mockResolvedValue(null);
    mockTranslate.mockImplementation(async (word: string) => makeTranslationResponse(word));
    vi.resetModules();
  });

  it('returns null for an uncached word', async () => {
    const { getCachedTranslation } = await import('./useTranslation');
    expect(getCachedTranslation('unknown')).toBeNull();
  });

  it('returns cached translation after fetchTranslation', async () => {
    const { getCachedTranslation, fetchTranslation } = await import('./useTranslation');
    const data = makeTranslationResponse('test');
    mockTranslate.mockResolvedValue(data);
    await fetchTranslation('test');
    expect(getCachedTranslation('test')).toEqual(data);
  });

  it('candidate-aware cache reads skip exact empty misses when a variant has data', async () => {
    const { getCachedTranslation, fetchTranslation } = await import('./useTranslation');
    mockTranslate.mockImplementation(async (word: string) => word === 'يكتب'
      ? { data: [] }
      : makeTranslationResponse(word));

    await fetchTranslation('يكتب', 'ar');
    await fetchTranslation('كتب', 'ar');

    expect(getCachedTranslation('يكتب', 'ar')).toEqual({ data: [] });
    expect(getCachedTranslation('يكتب', 'ar', {
      getWordVariants: (word) => word === 'يكتب' ? ['كتب'] : [],
    })).toEqual(makeTranslationResponse('كتب'));
  });
});

describe('getCachedReading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockKvGet.mockResolvedValue(null);
    mockGetCachedTranslationByLanguageDB.mockResolvedValue(null);
    mockTranslate.mockImplementation(async (word: string) => makeTranslationResponse(word));
    vi.resetModules();
  });

  it('returns null for uncached word', async () => {
    const { getCachedReading } = await import('./useTranslation');
    expect(getCachedReading('nope')).toBeNull();
  });

  it('returns reading after word is fetched', async () => {
    const { fetchTranslation, getCachedReading } = await import('./useTranslation');
    mockTranslate.mockResolvedValue({
      data: [{ reading: 'よみ', definitions: ['read'] }],
    });
    await fetchTranslation('読み');
    expect(getCachedReading('読み')).toBe('よみ');
  });

  it('returns package-declared dictionary readings from cached translations', async () => {
    const { fetchTranslation, getCachedReading } = await import('./useTranslation');
    mockTranslate.mockResolvedValue({
      data: [{
        word: '你好',
        pinyin: { value: 'nǐ hǎo' },
        definitions: ['hello'],
      }],
    });
    await fetchTranslation('你好', 'zh', { languageData: pinyinLanguageData });

    expect(getCachedReading('你好', 'zh', { languageData: pinyinLanguageData })).toBe('nǐ hǎo');
  });

  it('candidate-aware reading cache reads use variant metadata after exact empty misses', async () => {
    const { fetchTranslation, getCachedReading } = await import('./useTranslation');
    mockTranslate.mockImplementation(async (word: string) => word === 'يكتب'
      ? { data: [] }
      : { data: [{ reading: 'kataba', definitions: ['to write'] }] });

    await fetchTranslation('يكتب', 'ar');
    await fetchTranslation('كتب', 'ar');

    expect(getCachedReading('يكتب', 'ar')).toBeNull();
    expect(getCachedReading('يكتب', 'ar', {
      getWordVariants: (word) => word === 'يكتب' ? ['كتب'] : [],
    })).toBe('kataba');
  });

  it('strips HTML from reading', async () => {
    const { fetchTranslation, getCachedReading } = await import('./useTranslation');
    mockTranslate.mockResolvedValue({
      data: [{ reading: '<b>よみ</b>', definitions: ['read'] }],
    });
    await fetchTranslation('読み');
    expect(getCachedReading('読み')).toBe('よみ');
  });

  it('strips accent markers from reading', async () => {
    const { fetchTranslation, getCachedReading } = await import('./useTranslation');
    mockTranslate.mockResolvedValue({
      data: [{ reading: 'よみ<!-- accent_start -->◌̈<!-- accent_end -->', definitions: ['read'] }],
    });
    await fetchTranslation('読み');
    expect(getCachedReading('読み')).toBe('よみ');
  });

  it('returns null when cached data has no reading field', async () => {
    const { fetchTranslation, getCachedReading } = await import('./useTranslation');
    mockTranslate.mockResolvedValue({
      data: [{ definitions: ['something'] }],
    });
    await fetchTranslation('word');
    expect(getCachedReading('word')).toBeNull();
  });
});

describe('useTranslation.clearCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockKvGet.mockResolvedValue(null);
    mockGetCachedTranslationByLanguageDB.mockResolvedValue(null);
    mockTranslate.mockImplementation(async (word: string) => makeTranslationResponse(word));
    vi.resetModules();
  });

  it('clearCache removes all entries so backend is called again', async () => {
    const { useTranslation, fetchTranslation } = await import('./useTranslation');
    await fetchTranslation('hello');
    expect(mockTranslate).toHaveBeenCalledTimes(1);

    createRoot((dispose) => {
      const hook = useTranslation();
      hook.clearCache();
      dispose();
    });

    mockGetCachedTranslationByLanguageDB.mockResolvedValue(null);
    await fetchTranslation('hello');
    expect(mockTranslate).toHaveBeenCalledTimes(2);
  });
});

describe('useTranslation.setOverride', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockKvGet.mockResolvedValue(null);
    mockGetCachedTranslationByLanguageDB.mockResolvedValue(null);
    mockTranslate.mockImplementation(async (word: string) => makeTranslationResponse(word));
    vi.resetModules();
  });

  it('setOverride stores custom value that takes precedence over backend', async () => {
    const { useTranslation, fetchTranslation } = await import('./useTranslation');
    const customResponse = makeTranslationResponse('custom');

    let setOverrideFn!: ReturnType<typeof useTranslation>['setOverride'];
    createRoot((dispose) => {
      const hook = useTranslation();
      setOverrideFn = hook.setOverride;
      dispose();
    });

    await setOverrideFn('hello', customResponse);
    const result = await fetchTranslation('hello');
    expect(result).toEqual(customResponse);
    expect(mockTranslate).not.toHaveBeenCalled();
  });

  it('setOverride updates the in-memory cache immediately', async () => {
    const { cacheVersion, getCachedReading, useTranslation } = await import('./useTranslation');
    const customResponse = makeTranslationResponse('custom');

    let setOverrideFn!: ReturnType<typeof useTranslation>['setOverride'];
    createRoot((dispose) => {
      const hook = useTranslation();
      setOverrideFn = hook.setOverride;
      dispose();
    });

    const before = cacheVersion();
    await setOverrideFn('hello', customResponse);

    expect(getCachedReading('hello')).toBe('customreading');
    expect(cacheVersion()).toBe(before + 1);
    expect(mockTranslate).not.toHaveBeenCalled();
  });

  it('setOverride with null removes the override', async () => {
    const { useTranslation, fetchTranslation } = await import('./useTranslation');
    const customResponse = makeTranslationResponse('custom');
    const backendResponse = makeTranslationResponse('backend');
    mockTranslate.mockResolvedValue(backendResponse);

    let setOverrideFn!: ReturnType<typeof useTranslation>['setOverride'];
    createRoot((dispose) => {
      const hook = useTranslation();
      setOverrideFn = hook.setOverride;
      dispose();
    });

    await setOverrideFn('hello', customResponse);
    await setOverrideFn('hello', null);
    const result = await fetchTranslation('hello');
    expect(result).toEqual(backendResponse);
  });

  it('setOverride writes to KV store', async () => {
    const { useTranslation } = await import('./useTranslation');
    const customResponse = makeTranslationResponse('kv');

    let setOverrideFn!: ReturnType<typeof useTranslation>['setOverride'];
    createRoot((dispose) => {
      const hook = useTranslation();
      setOverrideFn = hook.setOverride;
      dispose();
    });

    await setOverrideFn('hello', customResponse);
    expect(mockKvSet).toHaveBeenCalledWith('ml_translation_overrides', expect.any(String));
  });
});

describe('useTranslation.translate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockKvGet.mockResolvedValue(null);
    mockGetCachedTranslationByLanguageDB.mockResolvedValue(null);
    mockTranslate.mockImplementation(async (word: string) => makeTranslationResponse(word));
    vi.resetModules();
  });

  it('translate sets currentWord and triggers resource', async () => {
    const { useTranslation } = await import('./useTranslation');
    createRoot(async (dispose) => {
      const hook = useTranslation();
      const result = await hook.translate('word');
      expect(result).toBeNull();
      dispose();
    });
  });

  it('translate with immediate option awaits refetch', async () => {
    const { useTranslation } = await import('./useTranslation');
    const expected = makeTranslationResponse('imm');
    mockTranslate.mockResolvedValue(expected);

    await new Promise<void>((resolve) => {
      createRoot(async (dispose) => {
        const hook = useTranslation({ immediate: true });
        await hook.translate('imm');
        dispose();
        resolve();
      });
    });

    expect(mockTranslate).toHaveBeenCalledWith('imm', undefined);
  });
});

describe('useTranslation.translateWord', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockKvGet.mockResolvedValue(null);
    mockGetCachedTranslationByLanguageDB.mockResolvedValue(null);
    mockTranslate.mockImplementation(async (word: string) => makeTranslationResponse(word));
    vi.resetModules();
  });

  it('translateWord fetches and returns the translation', async () => {
    const { useTranslation } = await import('./useTranslation');
    const expected = makeTranslationResponse('test');
    mockTranslate.mockResolvedValue(expected);

    let translateWordFn!: ReturnType<typeof useTranslation>['translateWord'];
    createRoot((dispose) => {
      const hook = useTranslation();
      translateWordFn = hook.translateWord;
      dispose();
    });

    const result = await translateWordFn('test');
    expect(result).toEqual(expected);
    expect(mockTranslate).toHaveBeenCalledWith('test', undefined);
  });
});

describe('warmTranslationCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockKvGet.mockResolvedValue(null);
    mockGetCachedTranslationByLanguageDB.mockResolvedValue(null);
    mockTranslate.mockImplementation(async (word: string) => makeTranslationResponse(word));
    vi.resetModules();
  });

  it('pre-warms cache for provided words', async () => {
    const { warmTranslationCache } = await import('./useTranslation');
    await warmTranslationCache(['foo', 'bar', 'baz']);
    expect(mockTranslate).toHaveBeenCalledTimes(3);
    expect(mockTranslate).toHaveBeenCalledWith('foo', undefined);
    expect(mockTranslate).toHaveBeenCalledWith('bar', undefined);
    expect(mockTranslate).toHaveBeenCalledWith('baz', undefined);
  });

  it('deduplicates identical words', async () => {
    const { warmTranslationCache } = await import('./useTranslation');
    await warmTranslationCache(['dup', 'dup', 'dup']);
    expect(mockTranslate).toHaveBeenCalledTimes(1);
  });

  it('skips empty or whitespace-only words', async () => {
    const { warmTranslationCache } = await import('./useTranslation');
    await warmTranslationCache(['', '  ', 'valid']);
    expect(mockTranslate).toHaveBeenCalledTimes(1);
    expect(mockTranslate).toHaveBeenCalledWith('valid', undefined);
  });

  it('skips already-cached words', async () => {
    const { warmTranslationCache, fetchTranslation } = await import('./useTranslation');
    await fetchTranslation('pre-cached');
    mockTranslate.mockClear();
    await warmTranslationCache(['pre-cached', 'new-word']);
    expect(mockTranslate).toHaveBeenCalledTimes(1);
    expect(mockTranslate).toHaveBeenCalledWith('new-word', undefined);
  });

  it('stores batch results in IndexedDB', async () => {
    const { warmTranslationCache } = await import('./useTranslation');
    await warmTranslationCache(['w1', 'w2']);
    expect(mockSetCachedTranslationBatchByLanguageDB).toHaveBeenCalledTimes(1);
  });

  it('pre-warms versioned cache lanes when language package metadata is supplied', async () => {
    const languageData: LanguageData = {
      name: 'Japanese',
      languageData: {
        version: 'ja-package-2026.06.29',
        assets: [],
        dictionaryPacks: {
          en: {
            targetLanguage: 'en',
            name: 'English',
            version: 'ja-en-dictionary-2026.06.29',
            assets: [],
          },
        },
      },
    };
    const { warmTranslationCache, getCachedTranslation } = await import('./useTranslation');

    await warmTranslationCache(['開く'], undefined, undefined, 'ja', 'en', languageData);

    const cacheLanguage = 'ja@language:ja-package-2026.06.29@dictionary:en:ja-en-dictionary-2026.06.29';
    expect(mockSetCachedTranslationBatchByLanguageDB).toHaveBeenCalledWith(
      [{ word: '開く', data: makeTranslationResponse('開く') }],
      cacheLanguage,
      'en',
    );
    expect(getCachedTranslation('開く', 'ja', { dictionaryTargetLanguage: 'en', languageData })).toEqual(makeTranslationResponse('開く'));
  });

  it('ignores individual translation errors silently', async () => {
    const { warmTranslationCache } = await import('./useTranslation');
    mockTranslate.mockRejectedValueOnce(new Error('network error'));
    mockTranslate.mockResolvedValueOnce(makeTranslationResponse('good'));
    await expect(warmTranslationCache(['bad', 'good'])).resolves.toBeUndefined();
  });
});

describe('useTokenizer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCachedTokensByLanguageDB.mockResolvedValue(null);
    vi.resetModules();
  });

  it('tokenize calls backend.tokenize for uncached text', async () => {
    const tokens = [{ actual_word: 'hello', word: 'hello', type: 'noun' }];
    mockTokenize.mockResolvedValue(tokens);
    const { useTokenizer } = await import('./useTranslation');
    const { tokenize } = useTokenizer();
    const result = await tokenize('hello world');
    expect(mockTokenize).toHaveBeenCalledWith('hello world', undefined);
    expect(result).toEqual(tokens);
  });

  it('tokenize returns default token for empty text', async () => {
    const { useTokenizer } = await import('./useTranslation');
    const { tokenize } = useTokenizer();
    const result = await tokenize('');
    expect(mockTokenize).not.toHaveBeenCalled();
    expect(result).toEqual([{ actual_word: '', word: '', type: 'UNKNOWN' }]);
  });

  it('tokenize returns default token for whitespace-only text', async () => {
    const { useTokenizer } = await import('./useTranslation');
    const { tokenize } = useTokenizer();
    const result = await tokenize('   ');
    expect(mockTokenize).not.toHaveBeenCalled();
    expect(result).toEqual([{ actual_word: '   ', word: '   ', type: 'UNKNOWN' }]);
  });

  it('tokenize caches result to avoid redundant backend calls', async () => {
    const tokens = [{ actual_word: 'test', word: 'test', type: 'noun' }];
    mockTokenize.mockResolvedValue(tokens);
    const { useTokenizer } = await import('./useTranslation');
    const { tokenize } = useTokenizer();
    await tokenize('hello');
    await tokenize('hello');
    expect(mockTokenize).toHaveBeenCalledTimes(1);
  });

  it('tokenize uses IndexedDB cache when available', async () => {
    const dbTokens = [{ actual_word: 'cached', word: 'cached', type: 'noun' }];
    mockGetCachedTokensByLanguageDB.mockResolvedValueOnce(dbTokens);
    const { useTokenizer } = await import('./useTranslation');
    const { tokenize } = useTokenizer();
    const result = await tokenize('cached text');
    expect(result).toEqual(dbTokens);
    expect(mockTokenize).not.toHaveBeenCalled();
  });

  it('tokenize saves result to IndexedDB', async () => {
    const tokens = [{ actual_word: 'save', word: 'save', type: 'verb' }];
    mockTokenize.mockResolvedValue(tokens);
    const { useTokenizer } = await import('./useTranslation');
    const { tokenize } = useTokenizer();
    await tokenize('save this');
    expect(mockSetCachedTokensByLanguageDB).toHaveBeenCalledWith('save this', tokens, undefined, undefined);
  });

  it('tokenize rethrows backend errors without language fallback metadata', async () => {
    mockTokenize.mockRejectedValue(new Error('network error'));
    const { useTokenizer } = await import('./useTranslation');
    const { tokenize } = useTokenizer();
    await expect(tokenize('fail text')).rejects.toThrow('network error');
  });

  it('tokenize returns a fallback token when language metadata allows unicode-word fallback', async () => {
    mockTokenize.mockRejectedValue(new Error('network error'));
    const { useTokenizer } = await import('./useTranslation');
    const { tokenize } = useTokenizer({
      language: 'en',
      languageData: {
        name: 'English',
        colour_codes: {},
        settings: { fixed: {} },
        runtime: {
          nlp: {
            tokenizer: {
              type: 'unicode-word',
            },
          },
        },
      },
    });
    const result = await tokenize('fail text');
    expect(result).toEqual([
      { actual_word: 'fail', word: 'fail', type: 'WORD', surface: 'fail' },
      { actual_word: 'text', word: 'text', type: 'WORD', surface: 'text' },
    ]);
  });

  it('tokenize rethrows backend errors when language metadata requires the tokenizer', async () => {
    mockTokenize.mockRejectedValue(new Error('required tokenizer missing'));
    const { useTokenizer } = await import('./useTranslation');
    const { tokenize } = useTokenizer({
      language: 'ja',
      languageData: {
        name: 'Japanese',
        colour_codes: {},
        settings: { fixed: {} },
        runtime: {
          nlp: {
            tokenizer: {
              type: 'sudachi',
              required: true,
            },
          },
        },
      },
    });

    await expect(tokenize('漢字')).rejects.toThrow('required tokenizer missing');
  });

  it('tokenize rethrows backend errors when rough fallback would drop all letters', async () => {
    mockTokenize.mockRejectedValue(new Error('network error'));
    const { useTokenizer } = await import('./useTranslation');
    const { tokenize } = useTokenizer({
      language: 'xx',
      languageData: {
        name: 'Latin fallback language',
        colour_codes: {},
        settings: { fixed: {} },
        textProcessing: { scriptProfile: { acceptedScripts: ['Latn'] } },
        runtime: {
          nlp: {
            tokenizer: {
              type: 'unicode-word',
            },
          },
        },
      },
    });

    await expect(tokenize('漢字')).rejects.toThrow('network error');
  });

  it('concurrent tokenize calls for same text are deduplicated', async () => {
    let resolveTokens!: (v: unknown[]) => void;
    const pending = new Promise<unknown[]>((r) => { resolveTokens = r; });
    mockTokenize.mockReturnValue(pending);

    const { useTokenizer } = await import('./useTranslation');
    const { tokenize } = useTokenizer();

    const p1 = tokenize('concurrent');
    const p2 = tokenize('concurrent');

    resolveTokens([{ actual_word: 'concurrent', word: 'concurrent', type: 'noun' }]);
    await Promise.all([p1, p2]);

    expect(mockTokenize).toHaveBeenCalledTimes(1);
  });

  it('tokenize uses language-aware cache and backend keys', async () => {
    const tokens = [{ actual_word: 'Haus', word: 'Haus', type: 'noun' }];
    mockTokenize.mockResolvedValue(tokens);
    const { useTokenizer } = await import('./useTranslation');
    const { tokenize } = useTokenizer({ language: 'de' });
    await tokenize('Haus');
    expect(mockGetCachedTokensByLanguageDB).toHaveBeenCalledWith('Haus', 'de', undefined);
    expect(mockTokenize).toHaveBeenCalledWith('Haus', 'de');
    expect(mockSetCachedTokensByLanguageDB).toHaveBeenCalledWith('Haus', tokens, 'de', undefined);
  });

  it('tokenize separates cache lanes when the same language installs a new tokenizer package', async () => {
    const oldTokens = [{ actual_word: '旧', word: '旧', type: 'OLD' }];
    const newTokens = [{ actual_word: '新', word: '新', type: 'NEW' }];
    mockTokenize
      .mockResolvedValueOnce(oldTokens)
      .mockResolvedValueOnce(newTokens);

    const oldLanguageData: LanguageData = {
      name: 'Japanese',
      colour_codes: {},
      settings: { fixed: {} },
      languageData: { version: 'ja-package-v1', assets: [] },
      runtime: { nlp: { tokenizer: { type: 'sudachi', required: true } } },
    };
    const newLanguageData: LanguageData = {
      ...oldLanguageData,
      languageData: { version: 'ja-package-v2', assets: [] },
    };

    const { useTokenizer } = await import('./useTranslation');
    const { getTokenizerCacheNamespace } = await import('../../shared/languageFeatures');
    const first = useTokenizer({ language: 'ja', languageData: oldLanguageData });
    const second = useTokenizer({ language: 'ja', languageData: newLanguageData });

    await first.tokenize('日本語');
    await second.tokenize('日本語');

    expect(mockTokenize).toHaveBeenCalledTimes(2);
    expect(mockGetCachedTokensByLanguageDB).toHaveBeenNthCalledWith(
      1,
      '日本語',
      'ja',
      getTokenizerCacheNamespace(oldLanguageData),
    );
    expect(mockGetCachedTokensByLanguageDB).toHaveBeenNthCalledWith(
      2,
      '日本語',
      'ja',
      getTokenizerCacheNamespace(newLanguageData),
    );
  });
});

describe('cacheVersion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockKvGet.mockResolvedValue(null);
    mockGetCachedTranslationByLanguageDB.mockResolvedValue(null);
    mockTranslate.mockImplementation(async (word: string) => makeTranslationResponse(word));
    vi.resetModules();
  });

  it('cacheVersion increments after fetchTranslation adds a new word', async () => {
    const { cacheVersion, fetchTranslation } = await import('./useTranslation');
    const before = cacheVersion();
    await fetchTranslation('new-word');
    expect(cacheVersion()).toBe(before + 1);
  });

  it('cacheVersion increments when IndexedDB cache is used', async () => {
    mockGetCachedTranslationByLanguageDB.mockResolvedValueOnce(makeTranslationResponse('db'));
    const { cacheVersion, fetchTranslation } = await import('./useTranslation');
    const before = cacheVersion();
    await fetchTranslation('db');
    expect(cacheVersion()).toBe(before + 1);
  });

  it('cacheVersion does not increment on cached in-memory hit', async () => {
    const { cacheVersion, fetchTranslation } = await import('./useTranslation');
    await fetchTranslation('word');
    const after = cacheVersion();
    await fetchTranslation('word');
    expect(cacheVersion()).toBe(after);
  });
});

describe('warmTranslationCache edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockKvGet.mockResolvedValue(null);
    mockGetCachedTranslationByLanguageDB.mockResolvedValue(null);
    mockTranslate.mockImplementation(async (word: string) => makeTranslationResponse(word));
    vi.resetModules();
  });

  it('does not call setCachedTranslationBatchByLanguageDB when all translations fail', async () => {
    mockTranslate.mockRejectedValue(new Error('all fail'));
    const { warmTranslationCache } = await import('./useTranslation');
    await warmTranslationCache(['a', 'b', 'c']);
    expect(mockSetCachedTranslationBatchByLanguageDB).not.toHaveBeenCalled();
  });

  it('handles empty words array', async () => {
    const { warmTranslationCache } = await import('./useTranslation');
    await warmTranslationCache([]);
    expect(mockTranslate).not.toHaveBeenCalled();
    expect(mockSetCachedTranslationBatchByLanguageDB).not.toHaveBeenCalled();
  });
});

describe('getCachedReading edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockKvGet.mockResolvedValue(null);
    mockGetCachedTranslationByLanguageDB.mockResolvedValue(null);
    mockTranslate.mockImplementation(async (word: string) => makeTranslationResponse(word));
    vi.resetModules();
  });

  it('returns null when cached data has empty data array', async () => {
    const { fetchTranslation, getCachedReading } = await import('./useTranslation');
    mockTranslate.mockResolvedValue({ data: [] });
    await fetchTranslation('empty');
    expect(getCachedReading('empty')).toBeNull();
  });

  it('returns null when reading is only HTML tags', async () => {
    const { fetchTranslation, getCachedReading } = await import('./useTranslation');
    mockTranslate.mockResolvedValue({
      data: [{ reading: '<span></span>', definitions: ['test'] }],
    });
    await fetchTranslation('html-only');
    expect(getCachedReading('html-only')).toBeNull();
  });

  it('returns null when data property is missing', async () => {
    const { fetchTranslation, getCachedReading } = await import('./useTranslation');
    mockTranslate.mockResolvedValue({});
    await fetchTranslation('no-data');
    expect(getCachedReading('no-data')).toBeNull();
  });
});

describe('useDictionary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockKvGet.mockResolvedValue(null);
    mockGetCachedDictionaryByLanguageDB.mockResolvedValue(null);
    mockTranslate.mockImplementation(async (word: string) => ({
      data: [
        { reading: `${word}reading`, definitions: [`definition of ${word}`] },
      ],
    }));
    vi.resetModules();
  });

  it('lookup returns DictionaryEntry array', async () => {
    const { useDictionary } = await import('./useTranslation');
    const { lookup } = useDictionary();
    const result = await lookup('word');
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].word).toBe('word');
    expect(result[0].meanings).toContain('definition of word');
  });

  it('lookup calls backend.translate', async () => {
    const { useDictionary } = await import('./useTranslation');
    const { lookup } = useDictionary();
    await lookup('test');
    expect(mockTranslate).toHaveBeenCalledWith('test', undefined);
  });

  it('lookup uses IndexedDB cache when available', async () => {
    const dbEntries: DictionaryEntry[] = [{ word: 'cached', reading: 'よみ', meanings: ['cached meaning'] }];
    mockGetCachedDictionaryByLanguageDB.mockResolvedValueOnce(dbEntries);
    const { useDictionary } = await import('./useTranslation');
    const { lookup } = useDictionary();
    const result = await lookup('cached');
    expect(result).toEqual(dbEntries);
    expect(mockTranslate).not.toHaveBeenCalled();
  });

  it('lookup caches result in memory for same word+reading', async () => {
    const { useDictionary } = await import('./useTranslation');
    const { lookup } = useDictionary();
    await lookup('hello');
    await lookup('hello');
    expect(mockTranslate).toHaveBeenCalledTimes(1);
  });

  it('lookup saves result to IndexedDB', async () => {
    const { useDictionary } = await import('./useTranslation');
    const { lookup } = useDictionary();
    await lookup('save');
    expect(mockSetCachedDictionaryByLanguageDB).toHaveBeenCalled();
  });

  it('lookup returns empty array on backend error', async () => {
    mockTranslate.mockRejectedValue(new Error('backend error'));
    const { useDictionary } = await import('./useTranslation');
    const { lookup } = useDictionary();
    const result = await lookup('error');
    expect(result).toEqual([]);
  });

  it('lookup returns empty array when backend data has no definitions', async () => {
    mockTranslate.mockResolvedValue({ data: [null, undefined, {}] });
    const { useDictionary } = await import('./useTranslation');
    const { lookup } = useDictionary();
    const result = await lookup('no-defs');
    expect(result).toEqual([]);
  });

  it('lookup supports optional reading parameter for cache key', async () => {
    const { useDictionary } = await import('./useTranslation');
    const { lookup } = useDictionary();
    await lookup('world', 'せかい');
    expect(mockGetCachedDictionaryByLanguageDB).toHaveBeenCalledWith('world', 'せかい', undefined);
  });

  it('lookup with different readings caches separately', async () => {
    const { useDictionary } = await import('./useTranslation');
    const { lookup } = useDictionary();
    await lookup('word', 'reading1');
    await lookup('word', 'reading2');
    expect(mockTranslate).toHaveBeenCalledTimes(2);
  });

  it('lookup returns multiple entries when data has multiple TranslationEntries', async () => {
    mockTranslate.mockResolvedValue({
      data: [
        { reading: 'よみ1', definitions: ['meaning 1'] },
        { reading: 'よみ2', definitions: ['meaning 2', 'meaning 3'] },
      ],
    });
    const { useDictionary } = await import('./useTranslation');
    const { lookup } = useDictionary();
    const result = await lookup('multi');
    expect(result).toHaveLength(2);
    expect(result[0].meanings).toEqual(['meaning 1']);
    expect(result[1].meanings).toEqual(['meaning 2', 'meaning 3']);
  });

  it('lookup returns empty array when data is not an array', async () => {
    mockTranslate.mockResolvedValue({ data: 'not-an-array' });
    const { useDictionary } = await import('./useTranslation');
    const { lookup } = useDictionary();
    const result = await lookup('bad-data');
    expect(result).toEqual([]);
  });

  it('lookup handles string definitions by wrapping in array', async () => {
    mockTranslate.mockResolvedValue({
      data: [{ reading: 'よみ', definitions: 'single string definition' }],
    });
    const { useDictionary } = await import('./useTranslation');
    const { lookup } = useDictionary();
    const result = await lookup('string-def');
    expect(result).toHaveLength(1);
    expect(result[0].meanings).toEqual(['single string definition']);
  });

  it('lookup maps package-declared dictionary readings into dictionary entries', async () => {
    mockTranslate.mockResolvedValue({
      data: [{
        word: '你好',
        pinyin: { value: 'nǐ hǎo' },
        definitions: ['hello'],
      }],
    });
    const { useDictionary } = await import('./useTranslation');
    const { lookup } = useDictionary({ language: 'zh', languageData: pinyinLanguageData });
    const result = await lookup('你好');

    expect(result).toEqual([{ word: '你好', reading: 'nǐ hǎo', meanings: ['hello'] }]);
  });

  it('lookup maps package-declared dictionary definitions into dictionary entries', async () => {
    mockTranslate.mockResolvedValue({
      data: [{
        word: '你好',
        pinyin: { value: 'nǐ hǎo' },
        glosses: { english: ['hello', 'hi'] },
      }],
    });
    const { useDictionary } = await import('./useTranslation');
    const { lookup } = useDictionary({ language: 'zh', languageData: nestedGlossLanguageData });
    const result = await lookup('你好');

    expect(result).toEqual([{ word: '你好', reading: 'nǐ hǎo', meanings: ['hello', 'hi'] }]);
  });

  it('lookup uses empty string as default reading key', async () => {
    const { useDictionary } = await import('./useTranslation');
    const { lookup } = useDictionary();
    await lookup('word');
    expect(mockGetCachedDictionaryByLanguageDB).toHaveBeenCalledWith('word', '', undefined);
  });

  it('lookup uses language-aware dictionary cache and backend keys', async () => {
    const { useDictionary } = await import('./useTranslation');
    const { lookup } = useDictionary({ language: 'de' });
    await lookup('Haus');
    expect(mockGetCachedDictionaryByLanguageDB).toHaveBeenCalledWith('Haus', '', 'de');
    expect(mockTranslate).toHaveBeenCalledWith('Haus', 'de');
    expect(mockSetCachedDictionaryByLanguageDB).toHaveBeenCalledWith('Haus', '', expect.any(Array), 'de');
  });

  it('versions dictionary cache keys by installed language and dictionary package metadata', async () => {
    const languageData: LanguageData = {
      name: 'Japanese',
      languageData: {
        version: 'ja-package-2026.06.29',
        assets: [],
        dictionaryPacks: {
          en: {
            targetLanguage: 'en',
            name: 'English',
            version: 'ja-en-dictionary-2026.06.29',
            assets: [],
          },
        },
      },
    };
    const { useDictionary } = await import('./useTranslation');
    const { lookup } = useDictionary({
      language: 'ja',
      dictionaryTargetLanguage: 'en',
      languageData,
    });

    await lookup('開く', 'ひらく');

    const cacheLanguage = 'ja@language:ja-package-2026.06.29@dictionary:en:ja-en-dictionary-2026.06.29';
    expect(mockGetCachedDictionaryByLanguageDB).toHaveBeenCalledWith('開く', 'ひらく', cacheLanguage, 'en');
    expect(mockSetCachedDictionaryByLanguageDB).toHaveBeenCalledWith(
      '開く',
      'ひらく',
      [{ word: '開く', reading: '開くreading', meanings: ['definition of 開く'] }],
      cacheLanguage,
      'en',
    );
  });

  it('lookup keeps dictionary cache lanes separate for different dictionary target languages', async () => {
    mockTranslate
      .mockResolvedValueOnce({ data: [{ word: '赤い', reading: 'あかい', definitions: ['red'] }] })
      .mockResolvedValueOnce({ data: [{ word: '赤い', reading: 'あかい', definitions: ['rouge'] }] });

    const { useDictionary } = await import('./useTranslation');
    const english = useDictionary({ language: 'ja', dictionaryTargetLanguage: 'en' });
    const french = useDictionary({ language: 'ja', dictionaryTargetLanguage: 'fr' });

    expect(await english.lookup('赤い')).toEqual([{ word: '赤い', reading: 'あかい', meanings: ['red'] }]);
    expect(await french.lookup('赤い')).toEqual([{ word: '赤い', reading: 'あかい', meanings: ['rouge'] }]);
    expect(mockTranslate).toHaveBeenCalledTimes(2);
    expect(mockTranslate).toHaveBeenNthCalledWith(1, '赤い', 'ja', { dictionaryTargetLanguage: 'en' });
    expect(mockTranslate).toHaveBeenNthCalledWith(2, '赤い', 'ja', { dictionaryTargetLanguage: 'fr' });
    expect(mockGetCachedDictionaryByLanguageDB).toHaveBeenNthCalledWith(1, '赤い', '', 'ja', 'en');
    expect(mockGetCachedDictionaryByLanguageDB).toHaveBeenNthCalledWith(2, '赤い', '', 'ja', 'fr');
    expect(mockSetCachedDictionaryByLanguageDB).toHaveBeenNthCalledWith(
      1,
      '赤い',
      '',
      [{ word: '赤い', reading: 'あかい', meanings: ['red'] }],
      'ja',
      'en',
    );
    expect(mockSetCachedDictionaryByLanguageDB).toHaveBeenNthCalledWith(
      2,
      '赤い',
      '',
      [{ word: '赤い', reading: 'あかい', meanings: ['rouge'] }],
      'ja',
      'fr',
    );
  });

  it('buildDictionaryLookupCandidates keeps direct lookup first before canonical and variant forms', async () => {
    const { buildDictionaryLookupCandidates } = await import('./useTranslation');
    const candidates = buildDictionaryLookupCandidates(
      'идут',
      (word) => word === 'идут' ? 'идти' : word,
      (word) => word === 'идут' ? ['идти', 'идти', 'ходить'] : [],
    );
    expect(candidates).toEqual(['идут', 'идти', 'ходить']);
  });

  it('lookup falls back to canonical forms for inflected words', async () => {
    mockTranslate.mockImplementation(async (word: string) => {
      if (word === 'идут') return { data: [] };
      return { data: [{ word, reading: '', definitions: [`definition of ${word}`] }] };
    });

    const { useDictionary } = await import('./useTranslation');
    const { lookup } = useDictionary({
      language: 'ru',
      getCanonicalForm: (word) => word === 'идут' ? 'идти' : word,
    });

    const result = await lookup('идут');
    expect(mockTranslate).toHaveBeenNthCalledWith(1, 'идут', 'ru');
    expect(mockTranslate).toHaveBeenNthCalledWith(2, 'идти', 'ru');
    expect(result).toEqual([{ word: 'идти', reading: '', meanings: ['definition of идти'] }]);
    expect(mockSetCachedDictionaryByLanguageDB).toHaveBeenCalledWith('идут', '', result, 'ru');
  });

  it('lookup does not let a cached empty surface miss block variant dictionary entries', async () => {
    const variantEntries: DictionaryEntry[] = [{ word: 'كتب', reading: '', meanings: ['to write'] }];
    mockGetCachedDictionaryByLanguageDB.mockImplementation(async (word: string) => {
      if (word === 'يكتب') return [];
      if (word === 'كتب') return variantEntries;
      return null;
    });

    const { useDictionary } = await import('./useTranslation');
    const { lookup } = useDictionary({
      language: 'ar',
      getWordVariants: (word) => word === 'يكتب' ? ['كتب'] : [],
    });

    const result = await lookup('يكتب');
    expect(result).toEqual(variantEntries);
    expect(mockTranslate).not.toHaveBeenCalled();
  });

  it('lookup checks normalized reading cache variants before calling the backend', async () => {
    const cachedEntries: DictionaryEntry[] = [{ word: '你好', reading: 'ni hao', meanings: ['hello'] }];
    mockGetCachedDictionaryByLanguageDB.mockImplementation(async (_word: string, reading: string) => (
      reading === 'ni hao' ? cachedEntries : null
    ));

    const { useDictionary } = await import('./useTranslation');
    const { lookup } = useDictionary({
      language: 'zh',
      getReadingVariants: (reading) => [reading, reading.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC')],
    });

    const result = await lookup('你好', 'nǐ hǎo');

    expect(result).toEqual(cachedEntries);
    expect(mockGetCachedDictionaryByLanguageDB).toHaveBeenNthCalledWith(1, '你好', 'nǐ hǎo', 'zh');
    expect(mockGetCachedDictionaryByLanguageDB).toHaveBeenNthCalledWith(2, '你好', 'ni hao', 'zh');
    expect(mockTranslate).not.toHaveBeenCalled();
  });

  it('translationCache evicts oldest entries past cap (FIFO, prevents unbounded growth)', async () => {
    const { fetchTranslation } = await import('./useTranslation');
    const cap = 5000;
    for (let i = 0; i < cap + 5; i++) {
      await fetchTranslation(`word-${i}`);
    }
    expect(mockTranslate).toHaveBeenCalledTimes(cap + 5);

    mockTranslate.mockClear();
    await fetchTranslation('word-0');
    expect(mockTranslate).toHaveBeenCalledTimes(1);

    mockTranslate.mockClear();
    await fetchTranslation(`word-${cap + 4}`);
    expect(mockTranslate).not.toHaveBeenCalled();
  }, 20000);

  it('dictionaryCache evicts oldest entries past cap (FIFO, prevents unbounded growth)', async () => {
    const { useDictionary } = await import('./useTranslation');
    const { lookup } = useDictionary();
    const cap = 5000;
    for (let i = 0; i < cap + 5; i++) {
      await lookup(`dict-${i}`);
    }
    expect(mockTranslate).toHaveBeenCalledTimes(cap + 5);

    mockTranslate.mockClear();
    await lookup('dict-0');
    expect(mockTranslate).toHaveBeenCalledTimes(1);

    mockTranslate.mockClear();
    await lookup(`dict-${cap + 4}`);
    expect(mockTranslate).not.toHaveBeenCalled();
  }, 20000);

  it('tokenCache evicts oldest entries past cap (FIFO, regression test for prune helper refactor)', async () => {
    mockTokenize.mockImplementation(async (text: string) => [
      { word: text, actual_word: text, type: 'NOUN' },
    ]);
    const { useTokenizer } = await import('./useTranslation');
    const { tokenize } = useTokenizer();
    const cap = 1000;
    for (let i = 0; i < cap + 5; i++) {
      await tokenize(`tok-${i}`);
    }
    expect(mockTokenize).toHaveBeenCalledTimes(cap + 5);

    mockTokenize.mockClear();
    await tokenize('tok-0');
    expect(mockTokenize).toHaveBeenCalledTimes(1);

    mockTokenize.mockClear();
    await tokenize(`tok-${cap + 4}`);
    expect(mockTokenize).not.toHaveBeenCalled();
  }, 20000);
});
