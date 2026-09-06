/**
 * Language Data Context
 * Manages language data and supported languages
 */

import { createContext, useContext, ParentComponent, onMount, onCleanup, createMemo, createEffect, createSignal } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import type { FlashcardProsody, InstallOptions, LanguageDataCatalogStatus, LanguageDataInstallError, LanguageDataMap, LanguageData, WordFrequencyMap, WordFrequencyEntry, Settings, GrammarPoint, Token } from '../../shared/types';
import { getBridge } from '../../shared/bridges';
import {
  createEmptyLexemeIndex,
  getCanonicalLexeme,
  getFrequencyForLexeme,
  getFrequencyLevelLabel,
  getGrammarLevelLabel,
  getPartOfSpeechColor,
  getTranslatablePartOfSpeechTypes,
  grammarPointMatchesTokens,
  getReadingAnnotationScripts,
  getCasualRegisterPromptGuidelines,
  getGrammarLevelVisualRank,
  getLanguageFeatureFlags,
  getLanguageFixedSettings,
  getLanguageProsodyType,
  getLexemeReadingVariants,
  getLexemeVariants,
  getRegisterCorrectionPromptGuidelines,
  getTokenizerCapabilities,
  isDisplayableFrequencyLevel,
  isTranslatablePartOfSpeech,
  isTranslatableToken,
  languageSupportsCharacterNamePrefixes,
  languageSupportsDeferentialRegister,
  ocrRuntimeSupportsRamSaver,
  ocrRuntimeSupportsVerticalText,
  resolveLanguageFrequencyPayload,
  registerMappingTable,
  type LanguageLexemeIndex,
  type LanguageTokenizerCapabilities,
} from '../../shared/languageFeatures';
import { resolveActiveVariantId, resolveEffectiveLanguageData } from '../../shared/languageVariants';
import { prosodyVisible } from '../../shared/prosodySettings';
import { buildLanguageFrequencyState, type LanguageFrequencyState } from '../../shared/utils/wordForms';
import { getLogger } from '../../shared/utils/logger';
import { useSettings } from './SettingsContext';

const log = getLogger("renderer.context.language");

// Grammar entry with parsed data for lookup
export interface GrammarEntry extends GrammarPoint {
  /** Level display name from language metadata */
  levelName: string;
  /** Bounded visual rank derived from grammar-level metadata. */
  visualLevel: number;
}

// Language feature capabilities - derived from package settings and language properties
export interface LanguageFeatures {
  /** Whether the language supports reading annotations alongside written text */
  supportsReadings: boolean;
  /** Configured prosody renderer/model from language metadata, when enabled. */
  prosodyRenderer?: NonNullable<FlashcardProsody['type']>;
  /** Whether the language declares any prosody/accent model */
  supportsProsody: boolean;
  /** Whether the language uses logographic characters that may need readings */
  isLogographic: boolean;
  /** Whether the language is written right-to-left */
  isRTL: boolean;
  /** Whether the language supports color-coded parts of speech */
  supportsColorCodes: boolean;
  /** Whether the primary writing system is Latin script */
  usesLatinScript: boolean;
  /** Whether the language supports frequency/level indicators */
  supportsFrequencyLevels: boolean;
  /** Whether settings are overridden by language data */
  hasFixedSettings: boolean;
  /** The list of fixed settings keys that are overridden */
  fixedSettingKeys: (keyof Settings)[];
  /** Whether the language supports character name detection in subtitles */
  supportsCharacterNames: boolean;
  /** Whether the language package declares vertical text support */
  supportsVerticalText: boolean;
  /** Whether the language OCR pipeline supports lightweight region detection before recognition */
  supportsOcrRamSaver: boolean;
  /** Whether the language has grammar point data */
  supportsGrammar: boolean;
  /** Whether the language has a distinct deferential/formal register model. */
  supportsDeferentialRegister: boolean;
  /** What the configured tokenizer can be trusted to provide. Rough segmentation is not morphology. */
  tokenizerCapabilities: LanguageTokenizerCapabilities;
  /** Register/style guidance for natural casual tutor speech declared by the language package. */
  casualRegisterPromptGuidelines: string[];
  /** Extra tutor prompt guidance declared by the language package. */
  tutorPromptGuidelines: string[];
  /** Extra correction guidance shared by tutor and checker prompts. */
  correctionPromptGuidelines: string[];
  /** Extra checker prompt guidance declared by the language package. */
  mistakeCheckerPromptGuidelines: string[];
}

// Context interface
interface LanguageContextValue {
  langData: LanguageDataMap;
  supportedLanguages: () => string[];
  currentLangData: () => LanguageData | null;
  wordFrequency: WordFrequencyMap;
  getWordFrequency: () => WordFrequencyMap;
  getFrequency: (word: string) => WordFrequencyEntry | null;
  /** Get frequency metadata for any installed language, without borrowing the active language. */
  getFrequencyForLanguage: (language: string, word: string) => WordFrequencyEntry | null;
  getLevelName: (level: number) => string;
  getFreqLevelNames: () => Record<string, string>;
  isLoading: () => boolean;
  languageDataCatalog: () => LanguageDataCatalogStatus[];
  getLanguageDataStatus: (language: string) => LanguageDataCatalogStatus | undefined;
  installLanguageData: (language: string, dictionaryTargetLanguage?: string, installOptions?: InstallOptions) => void;
  isLanguageDataInstalling: (language: string, dictionaryTargetLanguage?: string) => boolean;
  refreshLanguageData: () => void;
  languageDataInstallError: () => LanguageDataInstallError | null;
  isTranslatable: (pos: string) => boolean;
  isTokenTranslatable: (token: Pick<Token, 'word'> & Partial<Pick<Token, 'surface' | 'actual_word' | 'type' | 'partOfSpeech'>>) => boolean;
  translatableTypes: () => string[];
  /** Get language feature capabilities */
  getLanguageFeatures: () => LanguageFeatures;
  /** Get effective settings with language overrides applied */
  getEffectiveSettings: <T extends Partial<Settings>>(baseSettings: T) => T;
  /** Check if a setting is fixed by language data */
  isSettingFixed: (key: keyof Settings) => boolean;
  /** Look up a grammar point by pattern */
  getGrammarPoint: (pattern: string) => GrammarEntry | undefined;
  /** Detect grammar points present in a token sequence */
  detectGrammarInText: (tokens: Token[]) => GrammarEntry[];
  /** Whether current language supports grammar detection */
  supportsGrammar: () => boolean;
  /** Get grammar level name */
  getGrammarLevelName: (level: number) => string;
  /** Get all grammar level names */
  getGrammarLevelNames: () => Record<string, string>;
  /** Resolve a word/readable form to its canonical frequency-list form when configured */
  getCanonicalForm: (word: string) => string;
  /** Return canonical + same-reading variants for a word, ordered by frequency */
  getWordVariants: (word: string) => string[];
  /** Return raw + normalized reading variants for dictionary/cache lookup */
  getReadingVariants: (reading: string) => string[];
  /** Resolve a word/readable form for an installed language, without borrowing the active language. */
  getCanonicalFormForLanguage: (language: string, word: string) => string;
  /** Return canonical + same-reading variants for an installed language, without borrowing the active language. */
  getWordVariantsForLanguage: (language: string, word: string) => string[];
  /** Return raw + normalized reading variants for an installed language, without borrowing the active language. */
  getReadingVariantsForLanguage: (language: string, reading: string) => string[];
  /** Provider/level-system-resolved metadata for an installed language — the ONLY data derivation may consult. */
  getEffectiveLanguageData: (language: string) => LanguageData | null;
}

// Create context
const LanguageContext = createContext<LanguageContextValue>();


interface LanguageProviderProps {
  language?: string;
  frequencyProviderSelections?: Record<string, string>;
  frequencyLevelSystemSelections?: Record<string, string>;
}

export const LanguageProvider: ParentComponent<LanguageProviderProps> = (props) => {
  const { settings } = useSettings();
  const [baseLangData, setBaseLangData] = createStore<LanguageDataMap>({});
  const [langData, setLangData] = createStore<LanguageDataMap>({});
  const [wordFrequency, setWordFrequency] = createSignal<WordFrequencyMap>({});
  const [isLoading, setIsLoading] = createSignal(true);
  const [languageDataCatalog, setLanguageDataCatalog] = createSignal<LanguageDataCatalogStatus[]>([]);
  const [languageDataInstallError, setLanguageDataInstallError] = createSignal<LanguageDataInstallError | null>(null);
  const [languageDataInstalls, setLanguageDataInstalls] = createSignal<Record<string, boolean>>({});
  let lexemeIndex: LanguageLexemeIndex = createEmptyLexemeIndex();
  const perLanguageFrequencyState = new Map<string, {
    data: LanguageData | null;
    providerId?: string;
    levelSystemId?: string;
    state: LanguageFrequencyState;
  }>();
  const currentLang = createMemo<string>(() => props.language ?? '');
  const ipcCleanups: Array<() => void> = [];

  // Grammar lookup structures
  let grammarMap = new Map<string, GrammarEntry>();
  let grammarPatternsSorted: GrammarEntry[] = [];

  // Load language data
  const loadLangData = () => {
    const bridge = getBridge();
    log.info('[LanguageContext] Loading language data...');
    ipcCleanups.push(bridge.localization.onLangData((data) => {
      log.info('[LanguageContext] Language data received');
      setBaseLangData(reconcile(data as unknown as LanguageDataMap));
      setIsLoading(false);
    }));
    bridge.localization.getLangData();
  };

  const loadLanguageDataCatalog = () => {
    const bridge = getBridge();
    ipcCleanups.push(bridge.localization.onLanguageDataCatalog((data) => {
      setLanguageDataCatalog(data);
    }));
    ipcCleanups.push(bridge.localization.onLanguageDataInstalled((status) => {
      if (!status) return;
      setLanguageDataInstalls((previous) => {
        const next = { ...previous };
        for (const key of Object.keys(next)) {
          if (key === status.language || key.startsWith(`${status.language}:`)) {
            delete next[key];
          }
        }
        return next;
      });
      setLanguageDataCatalog((previous) => {
        const next = previous.filter((item) => item.language !== status.language);
        next.push(status);
        return next.sort((left, right) => left.language.localeCompare(right.language));
      });
      setLanguageDataInstallError(null);
      bridge.localization.getLangData();
    }));
    ipcCleanups.push(bridge.localization.onLanguageDataInstallError((payload) => {
      setLanguageDataInstalls((previous) => {
        const next = { ...previous };
        delete next[getLanguageDataInstallKey(payload.language, payload.dictionaryTargetLanguage)];
        return next;
      });
      setLanguageDataInstallError(payload);
    }));
    bridge.localization.getLanguageDataCatalog();
  };

  // Parse word frequency data
  const parseWordFrequency = (data: LanguageDataMap) => {
    const lang = currentLang();
    const langInfo = data[lang];
    const providerId = props.frequencyProviderSelections?.[lang];
    const levelSystemId = props.frequencyLevelSystemSelections?.[lang];
    perLanguageFrequencyState.clear();
    const state = buildLanguageFrequencyState(langInfo, lang, providerId, levelSystemId);
    lexemeIndex = state.lexemeIndex;
    setWordFrequency(state.frequency);
  };

  // Get supported languages
  const supportedLanguages = () => Object.keys(langData);

  const getLanguageDataStatus = (language: string): LanguageDataCatalogStatus | undefined =>
    languageDataCatalog().find((status) => status.language === language);

  const getLanguageDataInstallKey = (language: string, dictionaryTargetLanguage?: string): string =>
    dictionaryTargetLanguage ? `${language}:${dictionaryTargetLanguage}` : language;

  const installLanguageData = (language: string, dictionaryTargetLanguage?: string, installOptions?: InstallOptions): void => {
    setLanguageDataInstallError(null);
    setLanguageDataInstalls((previous) => ({
      ...previous,
      [getLanguageDataInstallKey(language, dictionaryTargetLanguage)]: true,
    }));
    getBridge().localization.installLanguageData(language, dictionaryTargetLanguage, installOptions);
  };

  const isLanguageDataInstalling = (language: string, dictionaryTargetLanguage?: string): boolean =>
    languageDataInstalls()[getLanguageDataInstallKey(language, dictionaryTargetLanguage)] === true;

  const refreshLanguageData = (): void => {
    getBridge().localization.getLangData();
  };

  // Get current language data
  const resolvedLanguageData = (language: string): LanguageData | null => {
    const resolved = resolveLanguageFrequencyPayload(
      langData[language] ?? null,
      props.frequencyProviderSelections?.[language],
      props.frequencyLevelSystemSelections?.[language],
    );
    return resolved.languageData ?? null;
  };

  const currentLangData = createMemo(() => resolvedLanguageData(currentLang()));

  // Get frequency for a word, with fallback to reading-based lookup
  const getFrequency = (word: string): WordFrequencyEntry | null => {
    return getFrequencyForLexeme(word, wordFrequency(), lexemeIndex, currentLangData(), currentLang());
  };

  const getFrequencyStateForLanguage = (language: string): LanguageFrequencyState => {
    if (language === currentLang()) {
      return { frequency: wordFrequency(), lexemeIndex, languageData: resolvedLanguageData(language) };
    }
    const data = langData[language] ?? null;
    const providerId = props.frequencyProviderSelections?.[language];
    const levelSystemId = props.frequencyLevelSystemSelections?.[language];
    const cached = perLanguageFrequencyState.get(language);
    if (
      cached
      && cached.data === data
      && cached.providerId === providerId
      && cached.levelSystemId === levelSystemId
    ) return cached.state;
    const state = buildLanguageFrequencyState(data, language, providerId, levelSystemId);
    perLanguageFrequencyState.set(language, { data, providerId, levelSystemId, state });
    return state;
  };

  const getFrequencyForLanguage = (language: string, word: string): WordFrequencyEntry | null => {
    const data = resolvedLanguageData(language);
    const state = getFrequencyStateForLanguage(language);
    return getFrequencyForLexeme(word, state.frequency, state.lexemeIndex, data, language);
  };

  // Resolve a word/readable form to its canonical frequency-list form using
  // language-defined lexeme normalization.
  const getCanonicalForm = (word: string): string => {
    return getCanonicalLexeme(word, wordFrequency(), lexemeIndex, currentLangData(), currentLang());
  };

  const getWordVariants = (word: string): string[] => {
    return getLexemeVariants(word, wordFrequency(), lexemeIndex, currentLangData(), currentLang());
  };

  const getReadingVariants = (reading: string): string[] => {
    return getLexemeReadingVariants(reading, currentLangData(), currentLang());
  };

  const getCanonicalFormForLanguage = (language: string, word: string): string => {
    if (language === currentLang()) return getCanonicalForm(word);
    const data = resolvedLanguageData(language);
    const state = getFrequencyStateForLanguage(language);
    return getCanonicalLexeme(word, state.frequency, state.lexemeIndex, data, language);
  };

  const getWordVariantsForLanguage = (language: string, word: string): string[] => {
    if (language === currentLang()) return getWordVariants(word);
    const data = resolvedLanguageData(language);
    const state = getFrequencyStateForLanguage(language);
    return getLexemeVariants(word, state.frequency, state.lexemeIndex, data, language);
  };

  const getReadingVariantsForLanguage = (language: string, reading: string): string[] => {
    if (language === currentLang()) return getReadingVariants(reading);
    return getLexemeReadingVariants(reading, resolvedLanguageData(language), language);
  };

  // Get level name from language metadata.
  const getLevelName = (level: number): string => {
    const data = currentLangData();
    const levelNames = data?.frequencyLevels?.names || {};
    return getFrequencyLevelLabel(level, levelNames, data);
  };

  // Get all frequency level names from metadata and parsed frequency entries.
  const getFreqLevelNames = (): Record<string, string> => {
    const data = currentLangData();
    const names: Record<string, string> = { ...(data?.frequencyLevels?.names ?? {}) };
    for (const entry of Object.values(wordFrequency())) {
      if (!isDisplayableFrequencyLevel(entry.raw_level, names, data)) continue;
      const key = String(entry.raw_level);
      names[key] = names[key] || entry.level || getFrequencyLevelLabel(entry.raw_level, names, data);
    }
    return names;
  };

  // Check if POS type is translatable
  const isTranslatable = (pos: string): boolean => {
    return isTranslatablePartOfSpeech(pos, currentLangData());
  };

  // Parse grammar data into lookup structures
  const parseGrammarData = (data: LanguageDataMap) => {
    const lang = currentLang();
    const langInfo = data[lang];
    if (!langInfo?.grammar?.length) {
      grammarMap = new Map();
      grammarPatternsSorted = [];
      return;
    }

    const levelNames = langInfo.grammarLevels?.names || {};
    const newMap = new Map<string, GrammarEntry>();

    for (const point of langInfo.grammar) {
      const entry: GrammarEntry = {
        ...point,
        levelName: getGrammarLevelLabel(point.level, levelNames, langInfo),
        visualLevel: getGrammarLevelVisualRank(point.level, levelNames, langInfo),
      };
      newMap.set(point.pattern, entry);
    }

    grammarMap = newMap;
    // Sort by pattern length descending (longest first for greedy matching)
    grammarPatternsSorted = Array.from(newMap.values()).sort(
      (a, b) => b.pattern.length - a.pattern.length
    );
  };

  // Look up a grammar point by pattern
  const getGrammarPoint = (pattern: string): GrammarEntry | undefined => {
    return grammarMap.get(pattern);
  };

  // Detect grammar points in a token sequence
  const detectGrammarInText = (tokens: Token[]): GrammarEntry[] => {
    if (grammarPatternsSorted.length === 0) return [];

    const data = currentLangData();
    const matched: GrammarEntry[] = [];
    const matchedPatterns = new Set<string>();

    for (const entry of grammarPatternsSorted) {
      if (matchedPatterns.has(entry.pattern)) continue;
      if (grammarPointMatchesTokens(entry, tokens, data)) {
        matched.push(entry);
        matchedPatterns.add(entry.pattern);
      }
    }

    return matched;
  };

  // Whether current language supports grammar
  const supportsGrammar = (): boolean => {
    return grammarPatternsSorted.length > 0;
  };

  // Get grammar level name
  const getGrammarLevelName = (level: number): string => {
    const data = currentLangData();
    const levelNames = data?.grammarLevels?.names || {};
    return getGrammarLevelLabel(level, levelNames, data);
  };

  // Get all grammar level names
  const getGrammarLevelNames = (): Record<string, string> => {
    const data = currentLangData();
    return data?.grammarLevels?.names || {};
  };

  // Get translatable POS types
  const translatableTypes = (): string[] => {
    return getTranslatablePartOfSpeechTypes(currentLangData());
  };

  const isTokenTranslatableForCurrentLanguage = (
    token: Pick<Token, 'word'> & Partial<Pick<Token, 'surface' | 'actual_word' | 'type' | 'partOfSpeech'>>,
  ): boolean => {
    return isTranslatableToken(token, currentLangData());
  };

  // Get language feature capabilities from installed language metadata.
  const getLanguageFeatures = (): LanguageFeatures => {
    const data = currentLangData();
    const fixedSettings = getLanguageFixedSettings(data);
    const fixedKeys = Object.keys(fixedSettings) as (keyof Settings)[];
    const { isLogographic, isRTL, usesLatinScript } = getLanguageFeatureFlags(currentLang(), data);
    const readingAnnotationsFixedOff = fixedSettings.showReadingAnnotations === false;
    const prosodyFixedVisible = prosodyVisible(fixedSettings);
    const prosodyRenderer = prosodyFixedVisible ? getLanguageProsodyType(data) : undefined;
    const supportsReadings = !readingAnnotationsFixedOff && getReadingAnnotationScripts(data).length > 0;
    const configuredTutorGuidelines = data?.conversation?.tutorPromptGuidelines;
    const configuredCorrectionGuidelines = data?.conversation?.correctionPromptGuidelines;
    const configuredCheckerGuidelines = data?.conversation?.mistakeCheckerPromptGuidelines;
    const registerTutorGuidelines = getCasualRegisterPromptGuidelines(data);
    const registerCorrectionGuidelines = getRegisterCorrectionPromptGuidelines(data);
    
    return {
      // Languages with reading annotations — driven by language data
      supportsReadings,
      // Specific renderer selection and generic prosody support are separate.
      ...(prosodyRenderer ? { prosodyRenderer } : {}),
      supportsProsody: Boolean(prosodyRenderer),
      isLogographic,
      isRTL,
      usesLatinScript,
      // POS color defaults are configured by part-of-speech metadata.
      supportsColorCodes: Boolean(data?.textProcessing?.partOfSpeech?.colors && Object.keys(data.textProcessing.partOfSpeech.colors).length > 0),
      // Frequency levels are configured by language metadata.
      supportsFrequencyLevels: resolveLanguageFrequencyPayload(data).rows.length > 0,
      hasFixedSettings: fixedKeys.length > 0,
      fixedSettingKeys: fixedKeys,
      // Character name detection — driven by language subtitle metadata
      supportsCharacterNames: languageSupportsCharacterNamePrefixes(data),
      // Vertical OCR/layout support — driven by runtime OCR metadata.
      supportsVerticalText: ocrRuntimeSupportsVerticalText(data),
      supportsOcrRamSaver: ocrRuntimeSupportsRamSaver(data),
      // Grammar data is source of truth.
      supportsGrammar: Array.isArray(data?.grammar) && data.grammar.length > 0,
      // Deferential register — drives casual-register directives in the conversation agent
      supportsDeferentialRegister: languageSupportsDeferentialRegister(data),
      tokenizerCapabilities: getTokenizerCapabilities(data),
      casualRegisterPromptGuidelines: registerTutorGuidelines,
      tutorPromptGuidelines: Array.isArray(configuredTutorGuidelines)
        ? configuredTutorGuidelines
        : [],
      correctionPromptGuidelines: Array.isArray(configuredCorrectionGuidelines)
        ? [...configuredCorrectionGuidelines, ...registerCorrectionGuidelines]
        : registerCorrectionGuidelines,
      mistakeCheckerPromptGuidelines: Array.isArray(configuredCheckerGuidelines)
        ? configuredCheckerGuidelines
        : [],
    };
  };

  // Get effective settings with language overrides applied
  const getEffectiveSettings = <T extends Partial<Settings>>(baseSettings: T): T => {
    const data = currentLangData();
    const fixedSettings = getLanguageFixedSettings(data);
    if (Object.keys(fixedSettings).length === 0) return baseSettings;
    
    // Merge base settings with language-fixed settings (package settings take precedence)
    return { ...baseSettings, ...fixedSettings } as T;
  };

  // Check if a specific setting is fixed by language data
  const isSettingFixed = (key: keyof Settings): boolean => {
    const data = currentLangData();
    return key in getLanguageFixedSettings(data);
  };

  onMount(() => {
    loadLangData();
    loadLanguageDataCatalog();
  });

  const effectiveLanguageData = createMemo<LanguageDataMap>(() => Object.fromEntries(
    Object.entries(baseLangData).map(([language, data]) => [
      language,
      resolveEffectiveLanguageData(data, settings, language),
    ]),
  ));

  createEffect(() => {
    const data = effectiveLanguageData();
    const lang = currentLang();
    const variantId = resolveActiveVariantId(settings, lang);
    const mappingAsset = variantId ? baseLangData[lang]?.variants?.[variantId]?.scriptConversion?.mappingAsset : undefined;

    setLangData(reconcile(data));
    parseWordFrequency(data);
    parseGrammarData(data);

    if (!mappingAsset) return;
    void fetch(mappingAsset)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`Failed to load ${mappingAsset}`)))
      .then((table) => registerMappingTable(lang, table))
      .catch((error: unknown) => log.warn('[LanguageContext] Failed to load mapping table:', error));
  });

  createEffect(() => {
    const lang = currentLang();
    props.frequencyProviderSelections?.[lang];
    props.frequencyLevelSystemSelections?.[lang];
    parseWordFrequency(langData as LanguageDataMap);
    parseGrammarData(langData as LanguageDataMap);
  });

  onCleanup(() => {
    for (const cleanup of ipcCleanups) cleanup();
    ipcCleanups.length = 0;
  });

  const value: LanguageContextValue = {
    langData,
    supportedLanguages,
    currentLangData,
    get wordFrequency() {
      return wordFrequency();
    },
    getWordFrequency: wordFrequency,
    getFrequency,
    getFrequencyForLanguage,
    getLevelName,
    getFreqLevelNames,
    isLoading,
    languageDataCatalog,
    getLanguageDataStatus,
    installLanguageData,
    isLanguageDataInstalling,
    refreshLanguageData,
    languageDataInstallError,
    isTranslatable,
    isTokenTranslatable: isTokenTranslatableForCurrentLanguage,
    translatableTypes,
    getLanguageFeatures,
    getEffectiveSettings,
    isSettingFixed,
    getGrammarPoint,
    detectGrammarInText,
    supportsGrammar,
    getGrammarLevelName,
    getGrammarLevelNames,
    getCanonicalForm,
    getWordVariants,
    getReadingVariants,
    getCanonicalFormForLanguage,
    getWordVariantsForLanguage,
    getReadingVariantsForLanguage,
    getEffectiveLanguageData: resolvedLanguageData,
  };

  return (
    <LanguageContext.Provider value={value}>
      {props.children}
    </LanguageContext.Provider>
  );
};

// Hook to use language data
export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return ctx;
}

// Get color for part of speech
export function useColorCodes() {
  const { currentLangData } = useLanguage();
  
  return {
    getColor: (pos: string): string | null => {
      const data = currentLangData();
      return getPartOfSpeechColor(pos, undefined, data) || null;
    },
  };
}
