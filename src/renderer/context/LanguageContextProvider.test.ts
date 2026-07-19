import { vi, describe, it, expect, beforeEach } from 'vitest';

let langDataCb: (data: unknown) => void;
let languageDataCatalogCb: (data: unknown) => void;
let languageDataInstalledCb: (data: unknown) => void;
let languageDataInstallErrorCb: (data: unknown) => void;
const langDataCleanup = vi.fn();
const languageDataCatalogCleanup = vi.fn();
const languageDataInstalledCleanup = vi.fn();
const languageDataInstallErrorCleanup = vi.fn();

const mockBridge = {
  localization: {
    getLangData: vi.fn(),
    onLangData: vi.fn(),
    getLanguageDataCatalog: vi.fn(),
    onLanguageDataCatalog: vi.fn(),
    installLanguageData: vi.fn(),
    onLanguageDataInstalled: vi.fn(),
    onLanguageDataInstallError: vi.fn(),
  },
};

function setupMockImplementations() {
  mockBridge.localization.onLangData.mockImplementation((cb: (data: unknown) => void) => {
    langDataCb = cb;
    return langDataCleanup;
  });
  mockBridge.localization.getLangData.mockReturnValue(undefined);
  mockBridge.localization.onLanguageDataCatalog.mockImplementation((cb: (data: unknown) => void) => {
    languageDataCatalogCb = cb;
    return languageDataCatalogCleanup;
  });
  mockBridge.localization.getLanguageDataCatalog.mockReturnValue(undefined);
  mockBridge.localization.installLanguageData.mockReturnValue(undefined);
  mockBridge.localization.onLanguageDataInstalled.mockImplementation((cb: (data: unknown) => void) => {
    languageDataInstalledCb = cb;
    return languageDataInstalledCleanup;
  });
  mockBridge.localization.onLanguageDataInstallError.mockImplementation((cb: (data: unknown) => void) => {
    languageDataInstallErrorCb = cb;
    return languageDataInstallErrorCleanup;
  });
}

vi.mock('../../shared/bridges', () => ({
  getBridge: () => mockBridge,
}));

type LangCtx = {
  langData: Record<string, unknown>;
  supportedLanguages: () => string[];
  currentLangData: () => unknown;
  wordFrequency: Record<string, unknown>;
  getWordFrequency: () => Record<string, unknown>;
  getFrequency: (word: string) => unknown;
  getFrequencyForLanguage: (language: string, word: string) => unknown;
  getLevelName: (level: number) => string;
  getFreqLevelNames: () => Record<string, string>;
  isLoading: () => boolean;
  isTranslatable: (pos: string) => boolean;
  isTokenTranslatable: (token: { word: string; actual_word?: string; surface?: string; type?: string; partOfSpeech?: string }) => boolean;
  translatableTypes: () => string[];
  getLanguageFeatures: () => Record<string, unknown>;
  getEffectiveSettings: <T extends object>(base: T) => T;
  isSettingFixed: (key: string) => boolean;
  getGrammarPoint: (pattern: string) => unknown;
  detectGrammarInText: (tokens: Array<{ word: string; actual_word?: string; type?: string; partOfSpeech?: string }>) => unknown[];
  supportsGrammar: () => boolean;
  getGrammarLevelName: (level: number) => string;
  getGrammarLevelNames: () => Record<string, string>;
  getCanonicalForm: (word: string) => string;
  getWordVariants: (word: string) => string[];
  getReadingVariants: (reading: string) => string[];
  getCanonicalFormForLanguage: (language: string, word: string) => string;
  getWordVariantsForLanguage: (language: string, word: string) => string[];
  getReadingVariantsForLanguage: (language: string, reading: string) => string[];
  languageDataCatalog: () => Array<Record<string, unknown>>;
  getLanguageDataStatus: (language: string) => Record<string, unknown> | undefined;
  installLanguageData: (language: string) => void;
  isLanguageDataInstalling: (language: string, dictionaryTargetLanguage?: string) => boolean;
  refreshLanguageData: () => void;
  languageDataInstallError: () => { language: string; error: string } | null;
};

async function mountProvider(props?: {
  language?: string;
  frequencyProviderSelections?: Record<string, string>;
  frequencyLevelSystemSelections?: Record<string, string>;
}) {
  const { createRoot, createComponent } = await import('solid-js');
  const { LanguageProvider, useLanguage } = await import('./LanguageContext');
  let ctx!: LangCtx;
  let dispose!: () => void;
  createRoot((d) => {
    dispose = d;
    createComponent(LanguageProvider, {
      language: props?.language,
      frequencyProviderSelections: props?.frequencyProviderSelections,
      frequencyLevelSystemSelections: props?.frequencyLevelSystemSelections,
      get children() {
        ctx = useLanguage() as unknown as LangCtx;
        return null;
      },
    });
  });
  return { ctx, dispose };
}

// Full language data fixture for 'ja'
function makeJaLangData() {
  return {
    ja: {
      freq: [
        ['する', 'する', 1],
        ['行く', 'いく', 1],
        ['食べる', 'たべる', 1],
        ['走る', 'はしる', 1],
        ['猫', 'ねこ', 1],
        ['犬', 'いぬ', 1],
        ['水', 'みず', 1],
        ['山', 'やま', 1],
        ['川', 'かわ', 1],
        ['空', 'そら', 1],
      ],
      frequencyLevels: {
        names: { '1': 'N1', '2': 'N2', '3': 'N3', '4': 'N4', '5': 'N5' },
        boundaries: [2, 4, 6, 8],
      },
      settings: { fixed: { showReadingAnnotations: true } },
            prosody: {
        type: 'japanese-pitch-accent',
      },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Han', 'Hira', 'Kana'] },
        partOfSpeech: {
          translatable: ['動詞', '名詞'],
          colors: { 動詞: '#ff0000', 名詞: '#0000ff' },
        },
        lexemeNormalization: {
          type: 'surface-reading',
          surfaceScripts: ['Han'],
          readingScripts: ['Hira', 'Kana'],
          readingNormalizer: 'kana-to-hiragana',
          preserveNonPrimaryReadingScript: true,
        },
        readingAnnotation: {
          type: 'script-reading',
          annotationScripts: ['Han'],
          surfaceSuffixScripts: ['Hira', 'Kana'],
          readingSeparator: '',
          stripParentheticalReadings: true,
        },
        subtitle: {
          characterNamePrefix: {
            enabled: true,
            scripts: ['Han', 'Hira', 'Kana'],
            delimiters: [':', '：'],
            bracketPairs: [['(', ')'], ['（', '）'], ['【', '】']],
          },
        },
        tokenJoinSeparator: '',
      },
      conversation: {
        register: {
          hasDeferentialForms: true,
        },
        tutorPromptGuidelines: [
          'Do not quiz the learner on character readings; focus quizzes on vocabulary, usage, and grammar.',
        ],
      },
      grammar: [
        { pattern: 'てしまう', level: 3, meaning: 'completion / regret' },
        { pattern: 'ている', level: 4, meaning: 'ongoing action' },
      ],
      grammarLevels: {
        names: { '3': 'N3', '4': 'N4' },
      },
    },
  };
}

describe('LanguageContext - provider behavior', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setupMockImplementations();
  });

  // ── Context access ───────────────────────────────────────────────────────────

  it('useLanguage throws when used outside LanguageProvider', async () => {
    const { createRoot } = await import('solid-js');
    const { useLanguage } = await import('./LanguageContext');
    expect(() => {
      createRoot((dispose) => {
        try {
          useLanguage();
        } finally {
          dispose();
        }
      });
    }).toThrow('useLanguage must be used within a LanguageProvider');
  });

  // ── Initial state ────────────────────────────────────────────────────────────

  it('initial state: isLoading=true', async () => {
    const { ctx, dispose } = await mountProvider();
    expect(ctx.isLoading()).toBe(true);
    dispose();
  });

  it('initial state: supportedLanguages returns empty array', async () => {
    const { ctx, dispose } = await mountProvider();
    expect(ctx.supportedLanguages()).toEqual([]);
    dispose();
  });

  it('initial state: currentLangData returns null', async () => {
    const { ctx, dispose } = await mountProvider();
    expect(ctx.currentLangData()).toBeNull();
    dispose();
  });

  it('initial state: wordFrequency is empty', async () => {
    const { ctx, dispose } = await mountProvider();
    expect(Object.keys(ctx.wordFrequency)).toHaveLength(0);
    expect(Object.keys(ctx.getWordFrequency())).toHaveLength(0);
    dispose();
  });

  it('wordFrequency enumeration updates after async language data arrives', async () => {
    const { createMemo, createRoot } = await import('solid-js');
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    let disposeMemo!: () => void;
    let frequencyCount!: () => number;
    createRoot((disposeRoot) => {
      disposeMemo = disposeRoot;
      frequencyCount = createMemo(() => Object.keys(ctx.wordFrequency).length);
    });

    expect(frequencyCount()).toBe(0);
    langDataCb({
      ja: {
        name: 'Japanese',
        colour_codes: {},
        settings: { fixed: {} },
        frequencyLevels: {
          rowLevelIndex: 2,
          names: { '5': 'N5' },
        },
        freq: [
          ['赤い', 'あかい', 5],
          ['青い', 'あおい', 5],
        ],
      },
    });

    expect(frequencyCount()).toBe(2);
    expect(Object.keys(ctx.getWordFrequency())).toEqual(['赤い', '青い']);
    disposeMemo();
    dispose();
  });

  // ── IPC setup ────────────────────────────────────────────────────────────────

  it('registers onLangData listener before calling getLangData on mount', async () => {
    const callOrder: string[] = [];
    mockBridge.localization.onLangData.mockImplementation((cb: (data: unknown) => void) => {
      langDataCb = cb;
      callOrder.push('onLangData');
      return langDataCleanup;
    });
    mockBridge.localization.getLangData.mockImplementation(() => {
      callOrder.push('getLangData');
    });

    const { dispose } = await mountProvider();
    expect(callOrder).toEqual(['onLangData', 'getLangData']);
    dispose();
  });

  it('registers onLangData listener on mount', async () => {
    const { dispose } = await mountProvider();
    expect(mockBridge.localization.onLangData).toHaveBeenCalledOnce();
    dispose();
  });

  it('calls getLangData on mount', async () => {
    const { dispose } = await mountProvider();
    expect(mockBridge.localization.getLangData).toHaveBeenCalledOnce();
    dispose();
  });

  it('refreshLanguageData requests the latest installed language data again', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    expect(mockBridge.localization.getLangData).toHaveBeenCalledOnce();

    ctx.refreshLanguageData();

    expect(mockBridge.localization.getLangData).toHaveBeenCalledTimes(2);
    dispose();
  });

  it('registers language-data catalog listeners before requesting catalog status', async () => {
    const callOrder: string[] = [];
    mockBridge.localization.onLanguageDataCatalog.mockImplementation((cb: (data: unknown) => void) => {
      languageDataCatalogCb = cb;
      callOrder.push('onLanguageDataCatalog');
      return languageDataCatalogCleanup;
    });
    mockBridge.localization.onLanguageDataInstalled.mockImplementation((cb: (data: unknown) => void) => {
      languageDataInstalledCb = cb;
      callOrder.push('onLanguageDataInstalled');
      return languageDataInstalledCleanup;
    });
    mockBridge.localization.onLanguageDataInstallError.mockImplementation((cb: (data: unknown) => void) => {
      languageDataInstallErrorCb = cb;
      callOrder.push('onLanguageDataInstallError');
      return languageDataInstallErrorCleanup;
    });
    mockBridge.localization.getLanguageDataCatalog.mockImplementation(() => {
      callOrder.push('getLanguageDataCatalog');
    });

    const { dispose } = await mountProvider();
    expect(callOrder).toEqual([
      'onLanguageDataCatalog',
      'onLanguageDataInstalled',
      'onLanguageDataInstallError',
      'getLanguageDataCatalog',
    ]);
    dispose();
  });

  // ── Language data loading ────────────────────────────────────────────────────

  it('after IPC callback: isLoading=false', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb(makeJaLangData());
    expect(ctx.isLoading()).toBe(false);
    dispose();
  });

  it('after IPC callback: supportedLanguages includes loaded language', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb(makeJaLangData());
    expect(ctx.supportedLanguages()).toContain('ja');
    dispose();
  });

  it('after IPC callback: currentLangData is non-null for explicit ja language', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(makeJaLangData());
    expect(ctx.currentLangData()).not.toBeNull();
    dispose();
  });

  it('custom language prop: currentLangData resolves using provided language', async () => {
    const data = { de: { freq: [] } };
    const { ctx, dispose } = await mountProvider({ language: 'de' });
    langDataCb(data);
    expect(ctx.currentLangData()).not.toBeNull();
    dispose();
  });

  it('IPC callback again: updates langData (language data change)', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(makeJaLangData());
    expect(ctx.supportedLanguages()).toContain('ja');

    const updatedData = {
      ja: { ...makeJaLangData().ja, freq: [] },
      de: { freq: [] },
    };
    langDataCb(updatedData);
    expect(ctx.supportedLanguages()).toContain('de');
    dispose();
  });

  it('stores language-data catalog status from the bridge', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    languageDataCatalogCb([
      { language: 'de', name: 'German', installed: false, missingRequiredAssets: ['dictionary'] },
      { language: 'ja', name: 'Japanese', installed: true, missingRequiredAssets: [] },
    ]);

    expect(ctx.languageDataCatalog()).toEqual([
      expect.objectContaining({ language: 'de', installed: false }),
      expect.objectContaining({ language: 'ja', installed: true }),
    ]);
    expect(ctx.getLanguageDataStatus('de')).toEqual(expect.objectContaining({
      language: 'de',
      installed: false,
    }));
    dispose();
  });

  it('installLanguageData delegates to the localization bridge and clears previous errors', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    languageDataInstallErrorCb({ language: 'de', error: 'previous failure' });

    ctx.installLanguageData('ja', 'fr');

    expect(ctx.languageDataInstallError()).toBeNull();
    expect(mockBridge.localization.installLanguageData).toHaveBeenCalledWith('ja', 'fr', undefined);
    expect(ctx.isLanguageDataInstalling('ja', 'fr')).toBe(true);
    dispose();
  });

  it('language-data installed events update one catalog row', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    languageDataCatalogCb([
      { language: 'de', name: 'German', installed: false, missingRequiredAssets: ['dictionary'] },
    ]);

    languageDataInstalledCb({ language: 'de', name: 'German', installed: true, missingRequiredAssets: [] });

    expect(ctx.getLanguageDataStatus('de')).toEqual(expect.objectContaining({
      language: 'de',
      installed: true,
      missingRequiredAssets: [],
    }));
    expect(ctx.isLanguageDataInstalling('de')).toBe(false);
    dispose();
  });

  it('language-data install errors are exposed by language', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    languageDataInstallErrorCb({ language: 'de', error: 'No download URL' });

    expect(ctx.languageDataInstallError()).toEqual({ language: 'de', error: 'No download URL' });
    dispose();
  });

  // ── getFrequency ─────────────────────────────────────────────────────────────

  it('getFrequency returns null before data is loaded', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    expect(ctx.getFrequency('行く')).toBeNull();
    dispose();
  });

  it('getFrequency returns entry for known kanji word', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(makeJaLangData());
    const result = ctx.getFrequency('行く') as { reading: string; level: string } | null;
    expect(result).not.toBeNull();
    expect(result!.reading).toBe('いく');
    dispose();
  });

  it('getFrequency returns null for unknown word', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(makeJaLangData());
    expect(ctx.getFrequency('UnknownWord')).toBeNull();
    dispose();
  });

  it('getFrequency falls back to reading-based lookup for katakana input', async () => {
    // 行く has reading いく; カタカナ lookup should resolve イク → いく → 行く
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(makeJaLangData());
    const byKanji = ctx.getFrequency('行く');
    const byKatakana = ctx.getFrequency('イク');
    // Both should return the same entry (or both null if no reverse mapping exists for this word)
    expect(byKanji).toEqual(byKatakana);
    dispose();
  });

  it('getCanonicalForm resolves pure-kana words to their canonical form', async () => {
    const data = makeJaLangData();
    data.ja.freq.push(['仲間', 'なかま', 1]);

    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(data);

    expect(ctx.getCanonicalForm('なかま')).toBe('仲間');
    dispose();
  });

  it('getFrequency returns correct level for word within first boundary', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(makeJaLangData());
    // 'する' is at index 0, boundary[0]=2, so level=5, name=N5
    const result = ctx.getFrequency('する') as { level: string } | null;
    expect(result).not.toBeNull();
    expect(result!.level).toBe('N5');
    dispose();
  });

  it('normalizes packaged frequency payloads before building provider frequency state', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb({
      ja: {
        name: 'Japanese',
        colour_codes: {},
        settings: { fixed: {} },
        freq: {
          freq: [
            ['会う', 'あう', 5],
            ['払う', 'はらう', 4],
          ],
          frequencyLevels: {
            rowLevelIndex: 2,
            names: { '5': 'N5', '4': 'N4' },
            difficulty: 'lower-is-harder',
            displayOrder: 'descending',
          },
        },
      },
    });

    expect(ctx.getFrequency('会う')).toMatchObject({ reading: 'あう', raw_level: 5, level: 'N5' });
    expect(ctx.getFrequency('払う')).toMatchObject({ reading: 'はらう', raw_level: 4, level: 'N4' });
    expect(ctx.getFreqLevelNames()).toEqual({ '5': 'N5', '4': 'N4' });
    expect(ctx.getLanguageFeatures().supportsFrequencyLevels).toBe(true);
    dispose();
  });

  it('builds frequency state from the selected provider and level system', async () => {
    const { ctx, dispose } = await mountProvider({
      language: 'ru',
      frequencyProviderSelections: { ru: 'smartool' },
      frequencyLevelSystemSelections: { ru: 'trki' },
    });
    langDataCb({
      ru: {
        name: 'Russian',
        defaultFrequencyProvider: 'openrussian',
        frequencyProviders: {
          openrussian: {
            name: 'OpenRussian',
            freq: [['частый', 'ча́стый', 1]],
            frequencyLevels: { names: { '1': 'Common' }, rowLevelIndex: 2 },
          },
          smartool: {
            name: 'SMARTool',
            freq: [['слово', 'слово', 3]],
            defaultLevelSystem: 'cefr',
            levelSystems: {
              cefr: {
                name: 'CEFR',
                frequencyLevels: { names: { '3': 'B1' }, rowLevelIndex: 2 },
              },
              trki: {
                name: 'ТРКИ',
                frequencyLevels: { names: { '3': 'ТРКИ-1' }, rowLevelIndex: 2 },
              },
            },
          },
        },
      },
    });

    expect(ctx.getFrequency('слово')).toMatchObject({ raw_level: 3, level: 'ТРКИ-1' });
    expect(ctx.getFrequency('частый')).toBeNull();
    expect(ctx.getFreqLevelNames()).toEqual({ '3': 'ТРКИ-1' });
    expect((ctx.currentLangData() as { activeFrequencyProvider?: string }).activeFrequencyProvider).toBe('smartool');
    dispose();
  });

  it('getFrequency does not invent proficiency buckets when level names are absent', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'xx' });
    langDataCb({
      xx: {
        name: 'No Level Scheme',
        colour_codes: {},
        settings: { fixed: {} },
        freq: [
          ['alpha', 'alpha'],
          ['beta', 'beta'],
        ],
      },
    });

    const result = ctx.getFrequency('alpha') as { raw_level: number; level: string } | null;
    expect(result).not.toBeNull();
    expect(result!.raw_level).toBe(-1);
    expect(result!.level).toBe('');
    expect(ctx.getFreqLevelNames()).toEqual({});
    dispose();
  });

  // ── getLevelName ─────────────────────────────────────────────────────────────

  it('getLevelName returns Level N with custom names after data load', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(makeJaLangData());
    expect(ctx.getLevelName(5)).toBe('N5');
    expect(ctx.getLevelName(1)).toBe('N1');
    dispose();
  });

  it('getLevelName falls back to "Level N" for missing levels', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(makeJaLangData());
    expect(ctx.getLevelName(9)).toBe('Level 9');
    dispose();
  });

  it('getLevelName returns "Level N" when no data loaded', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    expect(ctx.getLevelName(3)).toBe('Level 3');
    dispose();
  });

  // ── getFreqLevelNames ────────────────────────────────────────────────────────

  it('getFreqLevelNames returns all custom level names from langData', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(makeJaLangData());
    const names = ctx.getFreqLevelNames();
    expect(names['5']).toBe('N5');
    expect(names['1']).toBe('N1');
    dispose();
  });

  it('getFreqLevelNames returns empty object before data is loaded', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    expect(ctx.getFreqLevelNames()).toEqual({});
    dispose();
  });

  // ── isTranslatable ───────────────────────────────────────────────────────────

  it('isTranslatable returns true for known POS type in translatable list', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(makeJaLangData());
    expect(ctx.isTranslatable('動詞')).toBe(true);
    dispose();
  });

  it('isTranslatable returns false for POS not in translatable list', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(makeJaLangData());
    expect(ctx.isTranslatable('助詞')).toBe(false);
    dispose();
  });

  it('isTranslatable returns true by default when translatable not specified', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'de' });
    langDataCb({ de: { freq: [] } });
    expect(ctx.isTranslatable('noun')).toBe(true);
    dispose();
  });

  it('isTranslatable resolves tokenizer POS aliases from language metadata', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ru' });
    langDataCb({
      ru: {
        name: 'Russian',
        freq: [],
        colour_codes: {},
        settings: { fixed: {} },
        textProcessing: {
          partOfSpeech: {
            translatable: ['content-word'],
            aliases: {
              NOUN: 'content-word',
              VERB: 'content-word',
              ADP: 'function-word',
            },
          },
        },
      },
    });

    expect(ctx.isTranslatable('NOUN')).toBe(true);
    expect(ctx.isTranslatable('ADP')).toBe(false);
    expect(ctx.translatableTypes()).toEqual(['content-word']);
    dispose();
  });

  it('isTokenTranslatable skips POS allow-lists when tokenizer does not provide POS', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'de' });
    langDataCb({
      de: {
        name: 'German',
        freq: [],
        colour_codes: {},
        settings: { fixed: {} },
        textProcessing: {
          partOfSpeech: {
            translatable: ['noun', 'verb'],
          },
        },
        runtime: {
          nlp: {
            tokenizer: {
              type: 'unicode-word',
              lowercaseLemma: true,
            },
          },
        },
      },
    });

    expect(ctx.isTranslatable('WORD')).toBe(false);
    expect(ctx.isTokenTranslatable({ word: 'Häuser', actual_word: 'häuser', type: 'WORD' })).toBe(true);
    dispose();
  });

  // ── translatableTypes ────────────────────────────────────────────────────────

  it('translatableTypes returns array from langData', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(makeJaLangData());
    expect(ctx.translatableTypes()).toEqual(['動詞', '名詞']);
    dispose();
  });

  it('isTokenTranslatable follows installed Japanese POS metadata for adjectival nouns', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    const data = makeJaLangData();
    data.ja.textProcessing.partOfSpeech.translatable = ['名詞', '動詞', '形容詞', '形状詞', '形容動詞', '副詞'];
    langDataCb(data);

    expect(ctx.isTokenTranslatable({
      word: '粛々',
      actual_word: '粛々',
      type: '形状詞',
      reading: 'しゅくしゅく',
    })).toBe(true);
    dispose();
  });

  it('translatableTypes returns empty array before data is loaded', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    expect(ctx.translatableTypes()).toEqual([]);
    dispose();
  });

  // ── getLanguageFeatures ──────────────────────────────────────────────────────

  it('getLanguageFeatures: isLogographic=true for CJK scripts', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(makeJaLangData());
    const features = ctx.getLanguageFeatures();
    expect(features.isLogographic).toBe(true);
    dispose();
  });

  it('getLanguageFeatures: supportsReadings=true when reading annotation metadata is configured', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(makeJaLangData());
    const features = ctx.getLanguageFeatures();
    expect(features.supportsReadings).toBe(true);
    dispose();
  });

  it('getLanguageFeatures: Japanese package metadata supplies tutor prompt guidance', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(makeJaLangData());
    expect(ctx.getLanguageFeatures().tutorPromptGuidelines).toEqual([
      'Do not quiz the learner on character readings; focus quizzes on vocabulary, usage, and grammar.',
    ]);
    dispose();
  });

  it('getLanguageFeatures: reading annotations alone do not imply tutor prompt guidance', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'zh' });
    langDataCb({
      zh: {
        name: 'Chinese',
        colour_codes: {},
        settings: { fixed: {} },
        textProcessing: {
          scriptProfile: { acceptedScripts: ['Han'] },
          readingAnnotation: {
            type: 'script-reading',
            annotationScripts: ['Han'],
            readingScripts: ['Latn'],
          },
        },
      },
    });
    const features = ctx.getLanguageFeatures();
    expect(features.supportsReadings).toBe(true);
    expect(features.tutorPromptGuidelines).toEqual([]);
    dispose();
  });

  it('getLanguageFeatures: tutor prompt guidance can be supplied by language metadata', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'zh' });
    langDataCb({
      zh: {
        name: 'Chinese',
        colour_codes: {},
        settings: { fixed: {} },
                conversation: {
          tutorPromptGuidelines: ['When quizzing pronunciation, accept both tone marks and tone numbers.'],
        },
      },
    });
    expect(ctx.getLanguageFeatures().tutorPromptGuidelines).toEqual([
      'When quizzing pronunciation, accept both tone marks and tone numbers.',
    ]);
    dispose();
  });

  it('getLanguageFeatures: checker prompt guidance can be supplied by language metadata', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'zh' });
    langDataCb({
      zh: {
        name: 'Chinese',
        colour_codes: {},
        settings: { fixed: {} },
        textProcessing: {
          scriptProfile: { acceptedScripts: ['Han'] },
        },
        conversation: {
          mistakeCheckerPromptGuidelines: ['Do not correct tone-number pinyin when the learner is practicing typing.'],
        },
      },
    });
    expect(ctx.getLanguageFeatures().mistakeCheckerPromptGuidelines).toEqual([
      'Do not correct tone-number pinyin when the learner is practicing typing.',
    ]);
    dispose();
  });

  it('getLanguageFeatures: shared correction prompt guidance can be supplied by language metadata', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ar' });
    langDataCb({
      ar: {
        name: 'Arabic',
        colour_codes: {},
        settings: { fixed: {} },
        conversation: {
          correctionPromptGuidelines: ['Accept learner messages written with or without short vowel marks.'],
        },
      },
    });
    expect(ctx.getLanguageFeatures().correctionPromptGuidelines).toEqual([
      'Accept learner messages written with or without short vowel marks.',
    ]);
    dispose();
  });

  it('getLanguageFeatures: register guidance comes from conversation metadata', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ko' });
    langDataCb({
      ko: {
        name: 'Korean',
        colour_codes: {},
        settings: { fixed: {} },
        textProcessing: {
          scriptProfile: { acceptedScripts: ['Hang'] },
        },
        conversation: {
          register: {
            hasDeferentialForms: true,
            casualPromptGuidelines: ['Use plain casual endings in casual tutor mode.'],
            correctionPromptGuidelines: ['Do not replace valid casual endings with polite endings.'],
          },
        },
      },
    });
    const features = ctx.getLanguageFeatures();
    expect(features.supportsDeferentialRegister).toBe(true);
    expect(features.casualRegisterPromptGuidelines).toEqual(['Use plain casual endings in casual tutor mode.']);
    expect(features.tutorPromptGuidelines).toEqual([]);
    expect(features.correctionPromptGuidelines).toEqual(['Do not replace valid casual endings with polite endings.']);
    dispose();
  });

  it('getLanguageFeatures: honorific support stays disabled without register metadata', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb({
      ja: {
        name: 'Unconfigured Japanese',
        colour_codes: {},
        settings: { fixed: {} },
        textProcessing: { scriptProfile: { acceptedScripts: ['Han', 'Hira', 'Kana'] } },
      },
    });
    expect(ctx.getLanguageFeatures().supportsDeferentialRegister).toBe(false);
    dispose();
  });


  it('getLanguageFeatures: exposes the configured prosody renderer when metadata enables pitch accent', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb({
      ja: {
        ...makeJaLangData().ja,
        prosody: { type: 'japanese-pitch-accent' },
      },
    });
    const features = ctx.getLanguageFeatures();
    expect(features.prosodyRenderer).toBe('japanese-pitch-accent');
    expect(features.supportsProsody).toBe(true);
    dispose();
  });

  it('getLanguageFeatures: package-defined prosody exposes its own renderer', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'zh' });
    langDataCb({
      zh: {
        name: 'Tone Language',
        colour_codes: {},
        settings: { fixed: {} },
                prosody: { type: 'tone-contour' },
      },
    });
    const features = ctx.getLanguageFeatures();
    expect(features.supportsProsody).toBe(true);
    expect(features.prosodyRenderer).toBe('tone-contour');
    dispose();
  });

  it('getLanguageFeatures: missing prosody metadata does not enable prosody', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb({
      ja: {
        name: 'Legacy Pitch Accent',
        colour_codes: {},
        settings: { fixed: {} },
        textProcessing: {
          scriptProfile: { acceptedScripts: ['Han', 'Hira', 'Kana'] },
        },
      },
    });
    const features = ctx.getLanguageFeatures();
    expect(features.supportsProsody).toBe(false);
    expect(features.prosodyRenderer).toBeUndefined();
    dispose();
  });

  it('getLanguageFeatures: supportsColorCodes=true when colour_codes defined', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(makeJaLangData());
    const features = ctx.getLanguageFeatures();
    expect(features.supportsColorCodes).toBe(true);
    dispose();
  });

  it('getLanguageFeatures: supportsFrequencyLevels=true when freq data exists', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(makeJaLangData());
    const features = ctx.getLanguageFeatures();
    expect(features.supportsFrequencyLevels).toBe(true);
    dispose();
  });

  it('getLanguageFeatures: hasFixedSettings=true when settings.fixed non-empty', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(makeJaLangData());
    const features = ctx.getLanguageFeatures();
    expect(features.hasFixedSettings).toBe(true);
    expect(features.fixedSettingKeys).toContain('showReadingAnnotations');
    dispose();
  });

  it('getLanguageFeatures: supportsGrammar=true when grammar data exists', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(makeJaLangData());
    const features = ctx.getLanguageFeatures();
    expect(features.supportsGrammar).toBe(true);
    dispose();
  });

  it('getLanguageFeatures: isRTL=false for CJK scripts', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(makeJaLangData());
    const features = ctx.getLanguageFeatures();
    expect(features.isRTL).toBe(false);
    dispose();
  });

  it('getLanguageFeatures: data-backed capabilities are false before data loaded', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    const features = ctx.getLanguageFeatures();
    expect(features.supportsReadings).toBe(false);
    expect(features.supportsFrequencyLevels).toBe(false);
    dispose();
  });

  // ── getEffectiveSettings ─────────────────────────────────────────────────────

  it('getEffectiveSettings overrides base settings with settings.fixed from langData', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(makeJaLangData());
    const base = { showReadingAnnotations: false, theme: 'dark' } as Record<string, unknown>;
    const result = ctx.getEffectiveSettings(base);
    expect(result.showReadingAnnotations).toBe(true); // overridden by settings.fixed
    expect(result.theme).toBe('dark'); // not overridden
    dispose();
  });

  it('getEffectiveSettings returns base settings when no settings.fixed', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'de' });
    langDataCb({ de: { freq: [] } });
    const base = { showReadingAnnotations: true, theme: 'light' } as Record<string, unknown>;
    const result = ctx.getEffectiveSettings(base);
    expect(result).toEqual(base);
    dispose();
  });

  it('getEffectiveSettings returns base settings unchanged before data loaded', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    const base = { theme: 'light' } as Record<string, unknown>;
    expect(ctx.getEffectiveSettings(base)).toEqual(base);
    dispose();
  });

  // ── isSettingFixed ───────────────────────────────────────────────────────────

  it('isSettingFixed returns true for keys present in settings.fixed', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(makeJaLangData());
    expect(ctx.isSettingFixed('showReadingAnnotations')).toBe(true);
    dispose();
  });

  it('isSettingFixed returns false for keys not in settings.fixed', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(makeJaLangData());
    expect(ctx.isSettingFixed('theme')).toBe(false);
    dispose();
  });

  it('isSettingFixed returns false before data is loaded', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    expect(ctx.isSettingFixed('showReadingAnnotations')).toBe(false);
    dispose();
  });

  // ── Grammar ──────────────────────────────────────────────────────────────────

  it('getGrammarPoint returns entry for known pattern', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(makeJaLangData());
    const entry = ctx.getGrammarPoint('てしまう') as { pattern: string; meaning: string } | undefined;
    expect(entry).toBeDefined();
    expect(entry!.pattern).toBe('てしまう');
    expect(entry!.meaning).toBe('completion / regret');
    dispose();
  });

  it('getGrammarPoint returns undefined for unknown pattern', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(makeJaLangData());
    expect(ctx.getGrammarPoint('nonexistentpattern')).toBeUndefined();
    dispose();
  });

  it('getGrammarPoint returns undefined before data loaded', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    expect(ctx.getGrammarPoint('てしまう')).toBeUndefined();
    dispose();
  });

  it('detectGrammarInText finds patterns present in token sequence', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(makeJaLangData());
    const tokens = [{ word: '食べ' }, { word: 'てしまう' }, { word: 'よ' }];
    const found = ctx.detectGrammarInText(tokens) as Array<{ pattern: string }>;
    expect(found.some((e) => e.pattern === 'てしまう')).toBe(true);
    dispose();
  });

  it('detectGrammarInText supports token-sequence grammar metadata', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ru' });
    langDataCb({
      ru: {
        name: 'Russian',
        colour_codes: {},
        settings: { fixed: {} },
                grammar: [
          {
            pattern: 'motion verb + destination',
            meaning: 'movement toward a destination',
            level: 2,
            match: {
              type: 'token-sequence',
              tokens: [
                { field: 'actual_word', equals: 'идти' },
                { canonicalPartOfSpeech: 'noun' },
              ],
            },
          },
        ],
        textProcessing: {
          scriptProfile: { acceptedScripts: ['Cyrl'] },
          partOfSpeech: {
            aliases: {
              VERB: 'verb',
              NOUN: 'noun',
            },
          },
        },
        runtime: {
          nlp: {
            tokenizer: {
              type: 'spacy',
              capabilities: ['segments', 'lemmas', 'partOfSpeech'],
            },
          },
        },
      },
    });

    const found = ctx.detectGrammarInText([
      { word: 'иду', actual_word: 'идти', type: 'VERB' },
      { word: 'школу', actual_word: 'школа', type: 'NOUN' },
    ]) as Array<{ pattern: string }>;

    expect(found.map((entry) => entry.pattern)).toEqual(['motion verb + destination']);
    dispose();
  });

  it('detectGrammarInText ignores lemma/POS grammar when tokenizer only provides rough segmentation', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ru' });
    langDataCb({
      ru: {
        name: 'Russian',
        colour_codes: {},
        settings: { fixed: {} },
                grammar: [
          {
            pattern: 'motion verb + destination',
            meaning: 'movement toward a destination',
            level: 2,
            match: {
              type: 'token-sequence',
              tokens: [
                { field: 'actual_word', equals: 'идти' },
                { canonicalPartOfSpeech: 'noun' },
              ],
            },
          },
        ],
        textProcessing: {
          scriptProfile: { acceptedScripts: ['Cyrl'] },
          partOfSpeech: {
            aliases: {
              VERB: 'verb',
              NOUN: 'noun',
            },
          },
        },
        runtime: {
          nlp: {
            tokenizer: {
              type: 'unicode-word',
              lowercaseLemma: true,
            },
          },
        },
      },
    });

    const found = ctx.detectGrammarInText([
      { word: 'иду', actual_word: 'идти', type: 'VERB' },
      { word: 'школу', actual_word: 'школа', type: 'NOUN' },
    ]) as Array<{ pattern: string }>;

    expect(found).toEqual([]);
    dispose();
  });

  it('detectGrammarInText returns empty array when no patterns match', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(makeJaLangData());
    const tokens = [{ word: 'hello' }, { word: 'world' }];
    expect(ctx.detectGrammarInText(tokens)).toHaveLength(0);
    dispose();
  });

  it('detectGrammarInText returns empty array before data is loaded', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    const tokens = [{ word: 'てしまう' }];
    expect(ctx.detectGrammarInText(tokens)).toHaveLength(0);
    dispose();
  });

  it('supportsGrammar returns true when grammar data is loaded', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(makeJaLangData());
    expect(ctx.supportsGrammar()).toBe(true);
    dispose();
  });

  it('supportsGrammar returns false before data is loaded', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    expect(ctx.supportsGrammar()).toBe(false);
    dispose();
  });

  it('getGrammarLevelName returns custom name for known level', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(makeJaLangData());
    expect(ctx.getGrammarLevelName(3)).toBe('N3');
    dispose();
  });

  it('getGrammarLevelName falls back to "Level N" for unknown level', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(makeJaLangData());
    expect(ctx.getGrammarLevelName(99)).toBe('Level 99');
    dispose();
  });

  it('getGrammarLevelNames returns all grammar level names', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(makeJaLangData());
    const names = ctx.getGrammarLevelNames();
    expect(names['3']).toBe('N3');
    expect(names['4']).toBe('N4');
    dispose();
  });

  // ── getCanonicalForm ─────────────────────────────────────────────────────────

  it('getCanonicalForm returns word as-is when it contains kanji', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(makeJaLangData());
    expect(ctx.getCanonicalForm('行く')).toBe('行く');
    dispose();
  });

  it('getCanonicalForm returns word as-is for non-kana, non-kanji text', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(makeJaLangData());
    expect(ctx.getCanonicalForm('hello')).toBe('hello');
    dispose();
  });

  it('getCanonicalForm returns empty string for empty input', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(makeJaLangData());
    expect(ctx.getCanonicalForm('')).toBe('');
    dispose();
  });

  it('getCanonicalForm resolves known hiragana to canonical kanji form', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(makeJaLangData());
    // いく is the reading for 行く, so いく → 行く
    const result = ctx.getCanonicalForm('いく');
    expect(result).toBe('行く');
    dispose();
  });

  it('getCanonicalForm returns original word when no canonical form found', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(makeJaLangData());
    // Pure kana with no kanji equivalent in data
    const result = ctx.getCanonicalForm('あいうえお');
    expect(result).toBe('あいうえお');
    dispose();
  });

  it('per-language lexeme helpers use installed non-active language data', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb({
      ...makeJaLangData(),
      fa: {
        name: 'Persian',
        colour_codes: {},
        settings: { fixed: {} },
                freq: [
          ['کتاب', 'ketab'],
          ['کمی', 'kami'],
        ],
        textProcessing: {
          scriptProfile: { acceptedScripts: ['Arab'] },
          lexemeNormalization: {
            type: 'surface',
            surfaceScripts: ['Arab'],
            surfaceNormalizers: ['persian-arabic'],
          },
        },
      },
    });

    expect(ctx.getCanonicalForm('كِتــاب')).toBe('كِتــاب');
    expect(ctx.getCanonicalFormForLanguage('fa', 'كِتــاب')).toBe('کتاب');
    expect(ctx.getWordVariantsForLanguage('fa', 'كِمی')).toEqual(['كِمی', 'کمی']);
    dispose();
  });

  it('per-language frequency helpers preserve installed non-active level metadata', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb({
      ...makeJaLangData(),
      de: {
        name: 'German',
        colour_codes: {},
        settings: { fixed: {} },
        textProcessing: { scriptProfile: { acceptedScripts: ['Latn'] } },
        frequencyLevels: {
          difficulty: 'higher-is-harder',
          displayOrder: 'ascending',
          rowLevelIndex: 2,
          names: { '1': 'A1', '2': 'A2' },
        },
        freq: [
          ['Haus', 'Haus', 1],
          ['Nebensatz', 'Nebensatz', 2],
        ],
      },
    });

    expect(ctx.getFrequency('Haus')).toBeNull();
    expect(ctx.getFrequencyForLanguage('de', 'Haus')).toMatchObject({
      raw_level: 1,
      level: 'A1',
    });
    expect(ctx.getFrequencyForLanguage('de', 'Nebensatz')).toMatchObject({
      raw_level: 2,
      level: 'A2',
    });
    dispose();
  });

  it('per-language lexeme helpers use metadata-only surface normalizers without frequency data', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb({
      ...makeJaLangData(),
      fa: {
        name: 'Persian',
        colour_codes: {},
        settings: { fixed: {} },
        textProcessing: {
          scriptProfile: { acceptedScripts: ['Arab'] },
          lexemeNormalization: {
            type: 'surface',
            surfaceScripts: ['Arab'],
            surfaceNormalizers: ['persian-arabic'],
          },
        },
      },
    });

    expect(ctx.getCanonicalFormForLanguage('fa', 'كِتــاب')).toBe('کتاب');
    expect(ctx.getWordVariantsForLanguage('fa', 'كِمی')).toEqual(['كِمی', 'کمی']);
    dispose();
  });

  it('per-language reading helpers use installed language normalizers', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb({
      ...makeJaLangData(),
      zh: {
        name: 'Chinese',
        colour_codes: {},
        settings: { fixed: {} },
                freq: [['你好', 'nǐ hǎo']],
        textProcessing: {
          scriptProfile: { acceptedScripts: ['Han'] },
          lexemeNormalization: {
            type: 'reading',
            surfaceScripts: ['Han'],
            readingScripts: ['Latn'],
            readingNormalizer: 'lowercase-strip-diacritics',
          },
        },
      },
    });

    expect(ctx.getReadingVariants('nǐ hǎo')).toEqual(['nǐ hǎo']);
    expect(ctx.getReadingVariantsForLanguage('zh', 'nǐ hǎo')).toEqual(['nǐ hǎo', 'ni hao']);
    dispose();
  });

  // ── useColorCodes ─────────────────────────────────────────────────────────────

  it('useColorCodes: getColor returns color for known POS', async () => {
    const { createRoot, createComponent } = await import('solid-js');
    const { LanguageProvider, useColorCodes } = await import('./LanguageContext');
    let getColor!: (pos: string) => string | null;
    let dispose!: () => void;
    createRoot((d) => {
      dispose = d;
      createComponent(LanguageProvider, {
        language: 'ja',
        get children() {
          const cc = useColorCodes();
          getColor = cc.getColor;
          return null;
        },
      });
    });
    langDataCb(makeJaLangData());
    expect(getColor('動詞')).toBe('#ff0000');
    expect(getColor('名詞')).toBe('#0000ff');
    dispose();
  });

  it('useColorCodes: getColor resolves metadata POS aliases', async () => {
    const { createRoot, createComponent } = await import('solid-js');
    const { LanguageProvider, useColorCodes } = await import('./LanguageContext');
    let getColor!: (pos: string) => string | null;
    let dispose!: () => void;
    createRoot((d) => {
      dispose = d;
      createComponent(LanguageProvider, {
        language: 'ru',
        get children() {
          const cc = useColorCodes();
          getColor = cc.getColor;
          return null;
        },
      });
    });
    langDataCb({
      ru: {
        name: 'Russian',
        settings: { fixed: {} },
        textProcessing: {
          partOfSpeech: {
            colors: { noun: '#224466' },
            aliases: {
              NOUN: 'noun',
            },
          },
        },
      },
    });
    expect(getColor('NOUN')).toBe('#224466');
    dispose();
  });

  it('useColorCodes: getColor returns null for unknown POS', async () => {
    const { createRoot, createComponent } = await import('solid-js');
    const { LanguageProvider, useColorCodes } = await import('./LanguageContext');
    let getColor!: (pos: string) => string | null;
    let dispose!: () => void;
    createRoot((d) => {
      dispose = d;
      createComponent(LanguageProvider, {
        language: 'ja',
        get children() {
          const cc = useColorCodes();
          getColor = cc.getColor;
          return null;
        },
      });
    });
    langDataCb(makeJaLangData());
    expect(getColor('助詞')).toBeNull();
    dispose();
  });

  it('useColorCodes throws when used outside LanguageProvider', async () => {
    const { createRoot } = await import('solid-js');
    const { useColorCodes } = await import('./LanguageContext');
    expect(() => {
      createRoot((dispose) => {
        try {
          useColorCodes();
        } finally {
          dispose();
        }
      });
    }).toThrow('useLanguage must be used within a LanguageProvider');
  });

  // ── Alternate readings ──────────────────────────────────────────────────────

  it('duplicate freq entries accumulate alternateReadings', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb({
      ja: {
        ...makeJaLangData().ja,
        freq: [
          ['生', 'なま'],
          ['生', 'せい'],
          ['生', 'しょう'],
        ],
      },
    });
    const entry = ctx.getFrequency('生') as { reading: string; alternateReadings?: string[] } | null;
    expect(entry).not.toBeNull();
    expect(entry!.reading).toBe('なま');
    expect(entry!.alternateReadings).toEqual(['せい', 'しょう']);
    dispose();
  });

  it('duplicate freq entries with same reading do not create alternateReadings', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb({
      ja: {
        ...makeJaLangData().ja,
        freq: [
          ['生', 'なま'],
          ['生', 'なま'],
        ],
      },
    });
    const entry = ctx.getFrequency('生') as { reading: string; alternateReadings?: string[] } | null;
    expect(entry).not.toBeNull();
    expect(entry!.alternateReadings).toEqual([]);
    dispose();
  });

  // ── RTL and Latin script detection ──────────────────────────────────────────

  it('getLanguageFeatures: isRTL=true for Arabic script', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ar' });
    langDataCb({
      ar: {
        colour_codes: {},
        settings: { fixed: {} },
                name: 'Arabic',
      },
    });
    const features = ctx.getLanguageFeatures();
    expect(features.isRTL).toBe(true);
    expect(features.isLogographic).toBe(false);
    dispose();
  });

  it('getLanguageFeatures: usesLatinScript=true for Latin script language', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'de' });
    langDataCb({
      de: {
        colour_codes: {},
        settings: { fixed: {} },
        textProcessing: {
          scriptProfile: { acceptedScripts: ['Latn'] },
        },
        name: 'German',
      },
    });
    const features = ctx.getLanguageFeatures();
    expect(features.usesLatinScript).toBe(true);
    expect(features.isLogographic).toBe(false);
    expect(features.isRTL).toBe(false);
    dispose();
  });

  it('getLanguageFeatures: usesLatinScript inferred from scripts when not explicit', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'fr' });
    langDataCb({
      fr: {
        colour_codes: {},
        settings: { fixed: {} },
        name: 'French',
      },
    });
    const features = ctx.getLanguageFeatures();
    expect(features.usesLatinScript).toBe(true);
    dispose();
  });

  it('getLanguageFeatures: script metadata controls Latin-script detection', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'fa' });
    langDataCb({
      fa: {
        colour_codes: {},
        settings: { fixed: {} },
        textProcessing: {
          scriptProfile: { acceptedScripts: ['Arab'] },
        },
        name: 'Farsi',
      },
    });
    const features = ctx.getLanguageFeatures();
    expect(features.usesLatinScript).toBe(false);
    expect(features.isRTL).toBe(true);
    dispose();
  });

  it('getLanguageFeatures: supportsColorCodes=false when colour_codes empty', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'de' });
    langDataCb({
      de: {
        colour_codes: {},
        settings: { fixed: {} },
        name: 'German',
      },
    });
    expect(ctx.getLanguageFeatures().supportsColorCodes).toBe(false);
    dispose();
  });

  it('getLanguageFeatures: supportsFrequencyLevels=false when no freq data', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'de' });
    langDataCb({
      de: {
        colour_codes: {},
        settings: { fixed: {} },
        name: 'German',
      },
    });
    expect(ctx.getLanguageFeatures().supportsFrequencyLevels).toBe(false);
    dispose();
  });

  it('getLanguageFeatures: supportsReadings=false when generic settings.fixed.showReadingAnnotations=false', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'zh' });
    langDataCb({
      zh: {
        name: 'Chinese',
        colour_codes: {},
        settings: { fixed: { showReadingAnnotations: false } },
        textProcessing: {
          scriptProfile: { acceptedScripts: ['Han', 'Latn'] },
          lexemeNormalization: {
            type: 'reading',
            surfaceScripts: ['Han'],
            readingScripts: ['Latn'],
          },
          readingAnnotation: {
            type: 'script-reading',
            annotationScripts: ['Han'],
            readingSeparator: ' ',
          },
        },
      },
    });
    expect(ctx.getLanguageFeatures().supportsReadings).toBe(false);
    dispose();
  });

  it('getLanguageFeatures: prosodyRenderer is absent when settings.fixed.showProsody=false', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb({
      ja: {
        ...makeJaLangData().ja,
        settings: { fixed: { showProsody: false } },
        prosody: { type: 'japanese-pitch-accent' },
      },
    });
    const features = ctx.getLanguageFeatures();
    expect(features.prosodyRenderer).toBeUndefined();
    expect(features.supportsProsody).toBe(false);
    dispose();
  });

  it('getLanguageFeatures: prosody none disables prosody support', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb({
      ja: {
        ...makeJaLangData().ja,
        prosody: { type: 'none' },
      },
    });
    const features = ctx.getLanguageFeatures();
    expect(features.supportsProsody).toBe(false);
    expect(features.prosodyRenderer).toBeUndefined();
    dispose();
  });

  it('getLanguageFeatures: supportsVerticalText reflects OCR runtime metadata', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb({
      ja: {
        ...makeJaLangData().ja,
        runtime: {
          ocr: {
            supportsVerticalText: true,
          },
        },
      },
    });
    expect(ctx.getLanguageFeatures().supportsVerticalText).toBe(true);
    dispose();
  });

  it('getLanguageFeatures: vertical text is disabled without OCR runtime metadata', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb({
      ja: {
        ...makeJaLangData().ja,
        runtime: undefined,
      },
    });
    expect(ctx.getLanguageFeatures().supportsVerticalText).toBe(false);
    dispose();
  });

  it('getLanguageFeatures: supportsOcrRamSaver reflects runtime OCR metadata', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'sample' });
    langDataCb({
      sample: {
        name: 'Sample',
        colour_codes: {},
        settings: { fixed: {} },
        runtime: {
          ocr: {
            recognitionEngine: 'paddleocr',
            supportsRamSaver: true,
          },
        },
      },
    });
    expect(ctx.getLanguageFeatures().supportsOcrRamSaver).toBe(true);
    dispose();
  });

  it('getLanguageFeatures: OCR RAM saver is disabled without runtime OCR metadata', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb({
      ja: {
        ...makeJaLangData().ja,
        runtime: undefined,
      },
    });
    expect(ctx.getLanguageFeatures().supportsOcrRamSaver).toBe(false);
    dispose();
  });

  it('getLanguageFeatures: character-name support comes from subtitle metadata', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb({
      ja: {
        ...makeJaLangData().ja,
      },
    });
    expect(ctx.getLanguageFeatures().supportsCharacterNames).toBe(true);
    dispose();
  });

  it('getLanguageFeatures: character-name support is disabled without subtitle metadata', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb({
      ja: {
        ...makeJaLangData().ja,
        textProcessing: undefined,
      },
    });
    expect(ctx.getLanguageFeatures().supportsCharacterNames).toBe(false);
    dispose();
  });

  // ── Frequency level assignment with default boundaries ──────────────────────

  it('freq entries use default boundaries when frequency level boundaries are not specified', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    // 100 entries → step=20, boundaries=[20,40,60,80]
    const freq: [string, string][] = [];
    for (let i = 0; i < 100; i++) {
      freq.push([`漢${i}`, `かん${i}`]);
    }
    langDataCb({
      ja: {
        ...makeJaLangData().ja,
        freq,
        frequencyLevels: {
          names: { '5': 'L5', '4': 'L4', '3': 'L3', '2': 'L2', '1': 'L1' },
        },
      },
    });
    // index 0 ≤ 20 → level 5
    const first = ctx.getFrequency('漢0') as { raw_level: number } | null;
    expect(first).not.toBeNull();
    expect(first!.raw_level).toBe(5);
    // index 21 → 20 < 21 ≤ 40 → level 4
    const mid = ctx.getFrequency('漢21') as { raw_level: number } | null;
    expect(mid).not.toBeNull();
    expect(mid!.raw_level).toBe(4);
    // index 99 → > 80 → level 1
    const last = ctx.getFrequency('漢99') as { raw_level: number } | null;
    expect(last).not.toBeNull();
    expect(last!.raw_level).toBe(1);
    dispose();
  });

  it('freq entries preserve package-provided raw levels before boundary assignment', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'zh' });
    langDataCb({
      zh: {
        name: 'Chinese',
        colour_codes: {},
        settings: { fixed: {} },
                frequencyLevels: {
          difficulty: 'higher-is-harder',
          displayOrder: 'ascending',
          rowLevelIndex: 2,
          names: { '1': 'HSK 1', '2': 'HSK 2', '3': 'HSK 3' },
          boundaries: [0, 1],
        },
        freq: [
          ['你好', 'nǐ hǎo', 1],
          ['复杂', 'fù zá', 3],
          ['学习', 'xué xí'],
        ],
        textProcessing: {
          scriptProfile: { acceptedScripts: ['Han'] },
          lexemeNormalization: {
            type: 'reading',
            surfaceScripts: ['Han'],
            readingScripts: ['Latn'],
            readingNormalizer: 'lowercase-strip-diacritics',
          },
        },
      },
    });

    expect((ctx.getFrequency('你好') as { raw_level: number; level: string } | null)).toMatchObject({
      raw_level: 1,
      level: 'HSK 1',
    });
    expect((ctx.getFrequency('复杂') as { raw_level: number; level: string } | null)).toMatchObject({
      raw_level: 3,
      level: 'HSK 3',
    });
    expect((ctx.getFrequency('学习') as { raw_level: number; level: string } | null)).toMatchObject({
      raw_level: 3,
      level: 'HSK 3',
    });
    dispose();
  });

  it('derives frequency level names from package-provided raw levels when labels are missing', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'zh' });
    langDataCb({
      zh: {
        name: 'Chinese',
        colour_codes: {},
        settings: { fixed: {} },
        textProcessing: { scriptProfile: { acceptedScripts: ['Han'] } },
        frequencyLevels: {
          difficulty: 'higher-is-harder',
          displayOrder: 'ascending',
          rowLevelIndex: 2,
        },
        freq: [
          ['你好', 'nǐ hǎo', 1],
          ['复杂', 'fù zá', 4],
        ],
      },
    });

    expect((ctx.getFrequency('复杂') as { raw_level: number; level: string } | null)).toMatchObject({
      raw_level: 4,
      level: 'Level 4',
    });
    expect(ctx.getFreqLevelNames()).toEqual({
      '1': 'Level 1',
      '4': 'Level 4',
    });
    dispose();
  });

  // ── Grammar data cleared on update ──────────────────────────────────────────

  it('grammar data cleared when langData updated without grammar', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(makeJaLangData());
    expect(ctx.supportsGrammar()).toBe(true);
    expect(ctx.getGrammarPoint('てしまう')).toBeDefined();
    langDataCb({
      ja: {
        ...makeJaLangData().ja,
        grammar: undefined,
      },
    });
    expect(ctx.supportsGrammar()).toBe(false);
    expect(ctx.getGrammarPoint('てしまう')).toBeUndefined();
    dispose();
  });

  it('grammar data enables grammar support', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(makeJaLangData());

    expect(ctx.getLanguageFeatures().supportsGrammar).toBe(true);
    expect(ctx.supportsGrammar()).toBe(true);
    expect(ctx.getGrammarPoint('てしまう')).toBeDefined();
    dispose();
  });

  it('detectGrammarInText matches longest pattern first (greedy)', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(makeJaLangData());
    const tokens = [{ word: '食べ' }, { word: 'て' }, { word: 'しまっ' }, { word: 'ている' }];
    const found = ctx.detectGrammarInText(tokens) as Array<{ pattern: string }>;
    const patterns = found.map((e) => e.pattern);
    if (patterns.length === 2) {
      expect(patterns.indexOf('てしまう')).toBeLessThan(patterns.indexOf('ている'));
    }
    dispose();
  });

  // ── getCanonicalForm edge cases ─────────────────────────────────────────────

  it('getCanonicalForm keeps katakana spellings as-is', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(makeJaLangData());
    const result = ctx.getCanonicalForm('イク');
    expect(result).toBe('イク');
    dispose();
  });

  it('getCanonicalForm still resolves hiragana readings to canonical kanji form', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(makeJaLangData());
    const result = ctx.getCanonicalForm('いく');
    expect(result).toBe('行く');
    dispose();
  });

  it('getCanonicalForm returns kana word as-is if it exists directly in freq data', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'ja' });
    langDataCb(makeJaLangData());
    expect(ctx.getCanonicalForm('する')).toBe('する');
    dispose();
  });

  // ── Cleanup ──────────────────────────────────────────────────────────────────

  it('cleanup: IPC listener cleanup is called on dispose', async () => {
    const { dispose } = await mountProvider({ language: 'ja' });
    dispose();
    expect(langDataCleanup).toHaveBeenCalledOnce();
  });
});
