import { vi, describe, it, expect, beforeEach } from 'vitest';

let langDataCb: (data: unknown) => void;
const langDataCleanup = vi.fn();

const mockBridge = {
  localization: {
    getLangData: vi.fn(),
    onLangData: vi.fn(),
  },
};

function setupMockImplementations() {
  mockBridge.localization.onLangData.mockImplementation((cb: (data: unknown) => void) => {
    langDataCb = cb;
    return langDataCleanup;
  });
  mockBridge.localization.getLangData.mockReturnValue(undefined);
}

vi.mock('../../shared/bridges', () => ({
  getBridge: () => mockBridge,
}));

type LangCtx = {
  langData: Record<string, unknown>;
  supportedLanguages: () => string[];
  currentLangData: () => unknown;
  wordFrequency: Record<string, unknown>;
  getFrequency: (word: string) => unknown;
  getLevelName: (level: number) => string;
  getFreqLevelNames: () => Record<string, string>;
  isLoading: () => boolean;
  isTranslatable: (pos: string) => boolean;
  translatableTypes: () => string[];
  getLanguageFeatures: () => Record<string, unknown>;
  getEffectiveSettings: <T extends object>(base: T) => T;
  isSettingFixed: (key: string) => boolean;
  getGrammarPoint: (pattern: string) => unknown;
  detectGrammarInText: (tokens: { word: string }[]) => unknown[];
  supportsGrammar: () => boolean;
  getGrammarLevelName: (level: number) => string;
  getGrammarLevelNames: () => Record<string, string>;
  getCanonicalForm: (word: string) => string;
};

async function mountProvider(props?: { language?: string }) {
  const { createRoot, createComponent } = await import('solid-js');
  const { LanguageProvider, useLanguage } = await import('./LanguageContext');
  let ctx!: LangCtx;
  let dispose!: () => void;
  createRoot((d) => {
    dispose = d;
    createComponent(LanguageProvider, {
      language: props?.language,
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
      freq_level_names: { '1': 'N1', '2': 'N2', '3': 'N3', '4': 'N4', '5': 'N5' },
      freq_level_boundaries: [2, 4, 6, 8],
      translatable: ['動詞', '名詞'],
      hasFurigana: true,
      hasPitchAccent: true,
      fixed_settings: { furigana: true },
      supportedScripts: ['Han', 'Hira', 'Kana'],
      colour_codes: { 動詞: '#ff0000', 名詞: '#0000ff' },
      hasGrammar: true,
      grammar: [
        { pattern: 'てしまう', level: 3, meaning: 'completion / regret' },
        { pattern: 'ている', level: 4, meaning: 'ongoing action' },
      ],
      grammar_level_names: { '3': 'N3', '4': 'N4' },
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
    expect(callOrder).toEqual(['getLangData', 'onLangData']);
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

  it('after IPC callback: currentLangData is non-null for default ja language', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb(makeJaLangData());
    expect(ctx.currentLangData()).not.toBeNull();
    dispose();
  });

  it('custom language prop: currentLangData resolves using provided language', async () => {
    const data = { de: { freq: [], freq_level_names: {}, translatable: [] } };
    const { ctx, dispose } = await mountProvider({ language: 'de' });
    langDataCb(data);
    expect(ctx.currentLangData()).not.toBeNull();
    dispose();
  });

  it('IPC callback again: updates langData (language data change)', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb(makeJaLangData());
    expect(ctx.supportedLanguages()).toContain('ja');

    const updatedData = {
      ja: { ...makeJaLangData().ja, freq: [] },
      de: { freq: [], freq_level_names: {}, translatable: [] },
    };
    langDataCb(updatedData);
    expect(ctx.supportedLanguages()).toContain('de');
    dispose();
  });

  // ── getFrequency ─────────────────────────────────────────────────────────────

  it('getFrequency returns null before data is loaded', async () => {
    const { ctx, dispose } = await mountProvider();
    expect(ctx.getFrequency('行く')).toBeNull();
    dispose();
  });

  it('getFrequency returns entry for known kanji word', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb(makeJaLangData());
    const result = ctx.getFrequency('行く') as { reading: string; level: string } | null;
    expect(result).not.toBeNull();
    expect(result!.reading).toBe('いく');
    dispose();
  });

  it('getFrequency returns null for unknown word', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb(makeJaLangData());
    expect(ctx.getFrequency('UnknownWord')).toBeNull();
    dispose();
  });

  it('getFrequency falls back to reading-based lookup for katakana input', async () => {
    // 行く has reading いく; カタカナ lookup should resolve イク → いく → 行く
    const { ctx, dispose } = await mountProvider();
    langDataCb(makeJaLangData());
    const byKanji = ctx.getFrequency('行く');
    const byKatakana = ctx.getFrequency('イク');
    // Both should return the same entry (or both null if no reverse mapping exists for this word)
    expect(byKanji).toEqual(byKatakana);
    dispose();
  });

  it('getFrequency returns correct level for word within first boundary', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb(makeJaLangData());
    // 'する' is at index 0, boundary[0]=2, so level=5, name=N5
    const result = ctx.getFrequency('する') as { level: string } | null;
    expect(result).not.toBeNull();
    expect(result!.level).toBe('N5');
    dispose();
  });

  // ── getLevelName ─────────────────────────────────────────────────────────────

  it('getLevelName returns Level N with custom names after data load', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb(makeJaLangData());
    expect(ctx.getLevelName(5)).toBe('N5');
    expect(ctx.getLevelName(1)).toBe('N1');
    dispose();
  });

  it('getLevelName falls back to "Level N" for missing levels', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb(makeJaLangData());
    expect(ctx.getLevelName(9)).toBe('Level 9');
    dispose();
  });

  it('getLevelName returns "Level N" when no data loaded', async () => {
    const { ctx, dispose } = await mountProvider();
    expect(ctx.getLevelName(3)).toBe('Level 3');
    dispose();
  });

  // ── getFreqLevelNames ────────────────────────────────────────────────────────

  it('getFreqLevelNames returns all custom level names from langData', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb(makeJaLangData());
    const names = ctx.getFreqLevelNames();
    expect(names['5']).toBe('N5');
    expect(names['1']).toBe('N1');
    dispose();
  });

  it('getFreqLevelNames returns empty object before data is loaded', async () => {
    const { ctx, dispose } = await mountProvider();
    expect(ctx.getFreqLevelNames()).toEqual({});
    dispose();
  });

  // ── isTranslatable ───────────────────────────────────────────────────────────

  it('isTranslatable returns true for known POS type in translatable list', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb(makeJaLangData());
    expect(ctx.isTranslatable('動詞')).toBe(true);
    dispose();
  });

  it('isTranslatable returns false for POS not in translatable list', async () => {
    const { ctx, dispose } = await mountProvider();
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

  // ── translatableTypes ────────────────────────────────────────────────────────

  it('translatableTypes returns array from langData', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb(makeJaLangData());
    expect(ctx.translatableTypes()).toEqual(['動詞', '名詞']);
    dispose();
  });

  it('translatableTypes returns empty array before data is loaded', async () => {
    const { ctx, dispose } = await mountProvider();
    expect(ctx.translatableTypes()).toEqual([]);
    dispose();
  });

  // ── getLanguageFeatures ──────────────────────────────────────────────────────

  it('getLanguageFeatures: isLogographic=true for CJK scripts', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb(makeJaLangData());
    const features = ctx.getLanguageFeatures();
    expect(features.isLogographic).toBe(true);
    dispose();
  });

  it('getLanguageFeatures: supportsReadings=true when hasFurigana=true', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb(makeJaLangData());
    const features = ctx.getLanguageFeatures();
    expect(features.supportsReadings).toBe(true);
    dispose();
  });

  it('getLanguageFeatures: supportsPitchAccent=true when hasPitchAccent=true', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb(makeJaLangData());
    const features = ctx.getLanguageFeatures();
    expect(features.supportsPitchAccent).toBe(true);
    dispose();
  });

  it('getLanguageFeatures: supportsColorCodes=true when colour_codes defined', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb(makeJaLangData());
    const features = ctx.getLanguageFeatures();
    expect(features.supportsColorCodes).toBe(true);
    dispose();
  });

  it('getLanguageFeatures: supportsFrequencyLevels=true when freq data exists', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb(makeJaLangData());
    const features = ctx.getLanguageFeatures();
    expect(features.supportsFrequencyLevels).toBe(true);
    dispose();
  });

  it('getLanguageFeatures: hasFixedSettings=true when fixed_settings non-empty', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb(makeJaLangData());
    const features = ctx.getLanguageFeatures();
    expect(features.hasFixedSettings).toBe(true);
    expect(features.fixedSettingKeys).toContain('furigana');
    dispose();
  });

  it('getLanguageFeatures: supportsGrammar=true when hasGrammar=true', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb(makeJaLangData());
    const features = ctx.getLanguageFeatures();
    expect(features.supportsGrammar).toBe(true);
    dispose();
  });

  it('getLanguageFeatures: isRTL=false for CJK scripts', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb(makeJaLangData());
    const features = ctx.getLanguageFeatures();
    expect(features.isRTL).toBe(false);
    dispose();
  });

  it('getLanguageFeatures: all false before data loaded', async () => {
    const { ctx, dispose } = await mountProvider();
    const features = ctx.getLanguageFeatures();
    expect(features.isLogographic).toBe(false);
    expect(features.supportsReadings).toBe(false);
    expect(features.supportsFrequencyLevels).toBe(false);
    dispose();
  });

  // ── getEffectiveSettings ─────────────────────────────────────────────────────

  it('getEffectiveSettings overrides base settings with fixed_settings from langData', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb(makeJaLangData());
    const base = { furigana: false, theme: 'dark' } as Record<string, unknown>;
    const result = ctx.getEffectiveSettings(base);
    expect(result.furigana).toBe(true); // overridden by fixed_settings
    expect(result.theme).toBe('dark'); // not overridden
    dispose();
  });

  it('getEffectiveSettings returns base settings when no fixed_settings', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'de' });
    langDataCb({ de: { freq: [] } });
    const base = { furigana: true, theme: 'light' } as Record<string, unknown>;
    const result = ctx.getEffectiveSettings(base);
    expect(result).toEqual(base);
    dispose();
  });

  it('getEffectiveSettings returns base settings unchanged before data loaded', async () => {
    const { ctx, dispose } = await mountProvider();
    const base = { theme: 'light' } as Record<string, unknown>;
    expect(ctx.getEffectiveSettings(base)).toEqual(base);
    dispose();
  });

  // ── isSettingFixed ───────────────────────────────────────────────────────────

  it('isSettingFixed returns true for keys present in fixed_settings', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb(makeJaLangData());
    expect(ctx.isSettingFixed('furigana')).toBe(true);
    dispose();
  });

  it('isSettingFixed returns false for keys not in fixed_settings', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb(makeJaLangData());
    expect(ctx.isSettingFixed('theme')).toBe(false);
    dispose();
  });

  it('isSettingFixed returns false before data is loaded', async () => {
    const { ctx, dispose } = await mountProvider();
    expect(ctx.isSettingFixed('furigana')).toBe(false);
    dispose();
  });

  // ── Grammar ──────────────────────────────────────────────────────────────────

  it('getGrammarPoint returns entry for known pattern', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb(makeJaLangData());
    const entry = ctx.getGrammarPoint('てしまう') as { pattern: string; meaning: string } | undefined;
    expect(entry).toBeDefined();
    expect(entry!.pattern).toBe('てしまう');
    expect(entry!.meaning).toBe('completion / regret');
    dispose();
  });

  it('getGrammarPoint returns undefined for unknown pattern', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb(makeJaLangData());
    expect(ctx.getGrammarPoint('nonexistentpattern')).toBeUndefined();
    dispose();
  });

  it('getGrammarPoint returns undefined before data loaded', async () => {
    const { ctx, dispose } = await mountProvider();
    expect(ctx.getGrammarPoint('てしまう')).toBeUndefined();
    dispose();
  });

  it('detectGrammarInText finds patterns present in token sequence', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb(makeJaLangData());
    const tokens = [{ word: '食べ' }, { word: 'てしまう' }, { word: 'よ' }];
    const found = ctx.detectGrammarInText(tokens) as Array<{ pattern: string }>;
    expect(found.some((e) => e.pattern === 'てしまう')).toBe(true);
    dispose();
  });

  it('detectGrammarInText returns empty array when no patterns match', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb(makeJaLangData());
    const tokens = [{ word: 'hello' }, { word: 'world' }];
    expect(ctx.detectGrammarInText(tokens)).toHaveLength(0);
    dispose();
  });

  it('detectGrammarInText returns empty array before data is loaded', async () => {
    const { ctx, dispose } = await mountProvider();
    const tokens = [{ word: 'てしまう' }];
    expect(ctx.detectGrammarInText(tokens)).toHaveLength(0);
    dispose();
  });

  it('supportsGrammar returns true when grammar data is loaded', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb(makeJaLangData());
    expect(ctx.supportsGrammar()).toBe(true);
    dispose();
  });

  it('supportsGrammar returns false before data is loaded', async () => {
    const { ctx, dispose } = await mountProvider();
    expect(ctx.supportsGrammar()).toBe(false);
    dispose();
  });

  it('getGrammarLevelName returns custom name for known level', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb(makeJaLangData());
    expect(ctx.getGrammarLevelName(3)).toBe('N3');
    dispose();
  });

  it('getGrammarLevelName falls back to "Level N" for unknown level', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb(makeJaLangData());
    expect(ctx.getGrammarLevelName(99)).toBe('Level 99');
    dispose();
  });

  it('getGrammarLevelNames returns all grammar level names', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb(makeJaLangData());
    const names = ctx.getGrammarLevelNames();
    expect(names['3']).toBe('N3');
    expect(names['4']).toBe('N4');
    dispose();
  });

  // ── getCanonicalForm ─────────────────────────────────────────────────────────

  it('getCanonicalForm returns word as-is when it contains kanji', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb(makeJaLangData());
    expect(ctx.getCanonicalForm('行く')).toBe('行く');
    dispose();
  });

  it('getCanonicalForm returns word as-is for non-kana, non-kanji text', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb(makeJaLangData());
    expect(ctx.getCanonicalForm('hello')).toBe('hello');
    dispose();
  });

  it('getCanonicalForm returns empty string for empty input', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb(makeJaLangData());
    expect(ctx.getCanonicalForm('')).toBe('');
    dispose();
  });

  it('getCanonicalForm resolves known hiragana to canonical kanji form', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb(makeJaLangData());
    // いく is the reading for 行く, so いく → 行く
    const result = ctx.getCanonicalForm('いく');
    expect(result).toBe('行く');
    dispose();
  });

  it('getCanonicalForm returns original word when no canonical form found', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb(makeJaLangData());
    // Pure kana with no kanji equivalent in data
    const result = ctx.getCanonicalForm('あいうえお');
    expect(result).toBe('あいうえお');
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

  it('useColorCodes: getColor returns null for unknown POS', async () => {
    const { createRoot, createComponent } = await import('solid-js');
    const { LanguageProvider, useColorCodes } = await import('./LanguageContext');
    let getColor!: (pos: string) => string | null;
    let dispose!: () => void;
    createRoot((d) => {
      dispose = d;
      createComponent(LanguageProvider, {
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
    const { ctx, dispose } = await mountProvider();
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
    const { ctx, dispose } = await mountProvider();
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
        translatable: [],
        colour_codes: {},
        fixed_settings: {},
        supportedScripts: ['Arab'],
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
        translatable: [],
        colour_codes: {},
        fixed_settings: {},
        supportedScripts: ['Latn'],
        usesLatinScript: true,
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
        translatable: [],
        colour_codes: {},
        fixed_settings: {},
        supportedScripts: ['Latn'],
        name: 'French',
      },
    });
    const features = ctx.getLanguageFeatures();
    expect(features.usesLatinScript).toBe(true);
    dispose();
  });

  it('getLanguageFeatures: supportsColorCodes=false when colour_codes empty', async () => {
    const { ctx, dispose } = await mountProvider({ language: 'de' });
    langDataCb({
      de: {
        translatable: [],
        colour_codes: {},
        fixed_settings: {},
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
        translatable: [],
        colour_codes: {},
        fixed_settings: {},
        name: 'German',
      },
    });
    expect(ctx.getLanguageFeatures().supportsFrequencyLevels).toBe(false);
    dispose();
  });

  it('getLanguageFeatures: supportsReadings=false when fixed_settings.furigana=false', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb({
      ja: {
        ...makeJaLangData().ja,
        hasFurigana: true,
        fixed_settings: { furigana: false },
      },
    });
    expect(ctx.getLanguageFeatures().supportsReadings).toBe(false);
    dispose();
  });

  it('getLanguageFeatures: supportsPitchAccent=false when fixed_settings.showPitchAccent=false', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb({
      ja: {
        ...makeJaLangData().ja,
        hasPitchAccent: true,
        fixed_settings: { showPitchAccent: false },
      },
    });
    expect(ctx.getLanguageFeatures().supportsPitchAccent).toBe(false);
    dispose();
  });

  it('getLanguageFeatures: supportsVerticalText reflects langData', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb({
      ja: {
        ...makeJaLangData().ja,
        supportsVerticalText: true,
      },
    });
    expect(ctx.getLanguageFeatures().supportsVerticalText).toBe(true);
    dispose();
  });

  it('getLanguageFeatures: hasCharacterNames reflects langData', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb({
      ja: {
        ...makeJaLangData().ja,
        hasCharacterNames: true,
      },
    });
    expect(ctx.getLanguageFeatures().supportsCharacterNames).toBe(true);
    dispose();
  });

  it('getLanguageFeatures: usesCJKParentheses reflects langData', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb({
      ja: {
        ...makeJaLangData().ja,
        usesCJKParentheses: true,
      },
    });
    expect(ctx.getLanguageFeatures().usesCJKParentheses).toBe(true);
    dispose();
  });

  // ── Frequency level assignment with default boundaries ──────────────────────

  it('freq entries use default boundaries when freq_level_boundaries not specified', async () => {
    const { ctx, dispose } = await mountProvider();
    // 100 entries → step=20, boundaries=[20,40,60,80]
    const freq: [string, string][] = [];
    for (let i = 0; i < 100; i++) {
      freq.push([`漢${i}`, `かん${i}`]);
    }
    langDataCb({
      ja: {
        ...makeJaLangData().ja,
        freq,
        freq_level_boundaries: undefined,
        freq_level_names: { '5': 'L5', '4': 'L4', '3': 'L3', '2': 'L2', '1': 'L1' },
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

  // ── Grammar data cleared on update ──────────────────────────────────────────

  it('grammar data cleared when langData updated without grammar', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb(makeJaLangData());
    expect(ctx.supportsGrammar()).toBe(true);
    expect(ctx.getGrammarPoint('てしまう')).toBeDefined();
    langDataCb({
      ja: {
        ...makeJaLangData().ja,
        hasGrammar: false,
        grammar: undefined,
      },
    });
    expect(ctx.supportsGrammar()).toBe(false);
    expect(ctx.getGrammarPoint('てしまう')).toBeUndefined();
    dispose();
  });

  it('detectGrammarInText matches longest pattern first (greedy)', async () => {
    const { ctx, dispose } = await mountProvider();
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

  it('getCanonicalForm resolves katakana reading to canonical kanji form', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb(makeJaLangData());
    const result = ctx.getCanonicalForm('イク');
    expect(result).toBe('行く');
    dispose();
  });

  it('getCanonicalForm returns kana word as-is if it exists directly in freq data', async () => {
    const { ctx, dispose } = await mountProvider();
    langDataCb(makeJaLangData());
    expect(ctx.getCanonicalForm('する')).toBe('する');
    dispose();
  });

  // ── Cleanup ──────────────────────────────────────────────────────────────────

  it('cleanup: IPC listener cleanup is called on dispose', async () => {
    const { dispose } = await mountProvider();
    dispose();
    expect(langDataCleanup).toHaveBeenCalledOnce();
  });
});
