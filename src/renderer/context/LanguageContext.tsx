/**
 * Language Data Context
 * Manages language data and supported languages
 */

import { createContext, useContext, ParentComponent, onMount, onCleanup, createMemo, createEffect, createSignal } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { DEFAULT_SETTINGS, type LanguageDataMap, type LanguageData, type WordFrequencyMap, type WordFrequencyEntry, type Settings, type GrammarPoint, type Token, type LanguageFrequencyEntry } from '../../shared/types';
import { getBridge } from '../../shared/bridges';
import { isAllKana, katakanaToHiragana, containsKanji } from '../../shared/utils/textUtils';
import { getNLPBackendRegistry } from '../../shared/nlp-backend-registry';
import type { LanguageCode } from '../../shared/language-abstraction';
import type { NLPBackend, TokenizationResult } from '../../shared/nlp-backend-abstraction';

// Grammar entry with parsed data for lookup
export interface GrammarEntry extends GrammarPoint {
  /** Level display name (e.g., "JLPT N5") */
  levelName: string;
}

// Language feature capabilities - derived from fixed_settings and language properties
export interface LanguageFeatures {
  /** Whether the language supports readings/furigana (different pronunciation from writing) */
  supportsReadings: boolean;
  /** Whether the language has pitch accent data */
  supportsPitchAccent: boolean;
  /** Whether the language uses logographic characters (CJK) that may need readings */
  isLogographic: boolean;
  /** Whether the language is written right-to-left */
  isRTL: boolean;
  /** Whether the language supports color-coded parts of speech */
  supportsColorCodes: boolean;
  /** Whether the primary writing system is Latin script */
  usesLatinScript: boolean;
  /** Whether the language supports frequency/JLPT-style level indicators */
  supportsFrequencyLevels: boolean;
  /** Whether settings are overridden by language data */
  hasFixedSettings: boolean;
  /** The list of fixed settings keys that are overridden */
  fixedSettingKeys: (keyof Settings)[];
  /** Whether the language supports character name detection in subtitles */
  supportsCharacterNames: boolean;
  /** Whether the language can be written vertically (CJK vertical text) */
  supportsVerticalText: boolean;
  /** Whether the language has grammar point data */
  supportsGrammar: boolean;
  /** Whether the language uses CJK-style parentheses */
  usesCJKParentheses: boolean;
}

// Context interface
interface LanguageContextValue {
  langData: LanguageDataMap;
  supportedLanguages: () => string[];
  currentLangData: () => LanguageData | null;
  wordFrequency: WordFrequencyMap;
  getFrequency: (word: string) => WordFrequencyEntry | null;
  getLevelName: (level: number) => string;
  getFreqLevelNames: () => Record<string, string>;
  isLoading: () => boolean;
  isTranslatable: (pos: string) => boolean;
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
  /** Resolve a pure-kana word to its canonical (kanji) form using frequency data */
  getCanonicalForm: (word: string) => string;
  /** Return canonical + same-reading variants for a word, ordered by frequency */
  getWordVariants: (word: string) => string[];
  /** Tokenize text using the best available backend for the language */
  tokenizeText: (text: string, language: LanguageCode) => Promise<TokenizationResult>;
  /** Get the best backend for a given language */
  getBestBackendForLanguage: (language: LanguageCode) => NLPBackend | null;
  /** Initialize all available NLP backends */
  initializeNLPBackends: () => Promise<void>;
  /** Cleanup all NLP backends */
  cleanupNLPBackends: () => Promise<void>;
}

// Create context
const LanguageContext = createContext<LanguageContextValue>();

/** Compute default frequency level boundaries by dividing evenly into 5 levels */
function defaultFreqBoundaries(totalEntries: number): number[] {
  const step = Math.floor(totalEntries / 5);
  return [step, step * 2, step * 3, step * 4];
}

export const LanguageProvider: ParentComponent<{ language?: string }> = (props) => {
  const [langData, setLangData] = createStore<LanguageDataMap>({});
  const [wordFrequency, setWordFrequency] = createStore<WordFrequencyMap>({});
  const [isLoading, setIsLoading] = createSignal(true);
  // Maps hiragana reading → canonical kanji form (first/most-common entry from freq data)
  let readingToCanonical: Record<string, string> = {};
  let readingToVariants: Record<string, string[]> = {};
  const currentLang = createMemo<string>(() => props.language || DEFAULT_SETTINGS.language);
  const ipcCleanups: Array<() => void> = [];

  // Grammar lookup structures
  let grammarMap = new Map<string, GrammarEntry>();
  let grammarPatternsSorted: GrammarEntry[] = [];

  const supportsReadingCanonicalization = (langInfo: LanguageData | null | undefined): boolean => {
    if (!langInfo) return false;
    const scripts = langInfo.supportedScripts || [];
    const isLogographic = scripts.some((script) => ['Han', 'Hira', 'Kana', 'Hang', 'Bopo'].includes(script));
    return isLogographic && langInfo.hasFurigana === true && langInfo.fixed_settings?.furigana !== false;
  };

  // Load language data
  const loadLangData = () => {
    const bridge = getBridge();
    console.log('[LanguageContext] Loading language data...');
    ipcCleanups.push(bridge.localization.onLangData((data) => {
      console.log('[LanguageContext] Language data received');
      setLangData(reconcile(data as unknown as LanguageDataMap));
      parseWordFrequency(data as unknown as LanguageDataMap);
      parseGrammarData(data as unknown as LanguageDataMap);
      setIsLoading(false);
    }));
    bridge.localization.getLangData();
  };

  // Parse word frequency data
  const parseWordFrequency = (data: LanguageDataMap) => {
    const lang = currentLang();
    const langInfo = data[lang];
    if (!langInfo?.freq) {
      readingToCanonical = {};
      readingToVariants = {};
      setWordFrequency(reconcile({}));
      return;
    }

    const freqMap: WordFrequencyMap = {};
    const freq = langInfo.freq;
    const levelNames = langInfo.freq_level_names || {};
    const shouldCanonicalizeReadings = supportsReadingCanonicalization(langInfo);
    // Use per-language frequency boundaries, or spread evenly across 5 levels
    const boundaries = langInfo.freq_level_boundaries || defaultFreqBoundaries(freq.length);

    for (let i = 0; i < freq.length; i++) {
      const entry = freq[i] as LanguageFrequencyEntry | undefined;
      if (!entry?.[0]) continue;

      const word = entry[0];
      const reading = entry[1] ?? '';
      if (!word) continue;

      let level = 1;
      if (i <= boundaries[0]) level = 5;
      else if (i <= boundaries[1]) level = 4;
      else if (i <= boundaries[2]) level = 3;
      else if (i <= boundaries[3]) level = 2;

      const levelName = levelNames[String(level)] || `Level ${level}`;

      // Preserve first occurrence as primary (earlier = more common in frequency-ordered lists)
      // and collect subsequent readings as alternates
      const existing = freqMap[word];
      if (existing) {
        if (!existing.alternateReadings) {
          existing.alternateReadings = [];
        }
        if (reading && reading !== existing.reading && !existing.alternateReadings.includes(reading)) {
          existing.alternateReadings.push(reading);
        }
      } else {
        freqMap[word] = {
          reading,
          level: levelName,
          raw_level: level,
        };
      }
    }

    // Build reverse map: hiragana reading → canonical kanji form
    // Only the first (most common) form for each reading is kept
    const rMap: Record<string, string> = {};
    const variantsMap: Record<string, string[]> = {};
    for (let i = 0; i < freq.length; i++) {
      const entry = freq[i] as LanguageFrequencyEntry | undefined;
      if (!entry?.[0]) continue;
      const word = entry[0];
      const reading = entry[1] ?? '';
      // Skip if the word itself is pure kana (no kanji to normalize to)
      if (!shouldCanonicalizeReadings || !reading || !containsKanji(word)) continue;
      const hiragana = katakanaToHiragana(reading);
      if (hiragana && !rMap[hiragana]) {
        rMap[hiragana] = word;
      }
      if (hiragana) {
        const variants = variantsMap[hiragana] ?? [];
        if (!variants.includes(word)) {
          variants.push(word);
        }
        variantsMap[hiragana] = variants;
      }
    }
    readingToCanonical = rMap;
    readingToVariants = variantsMap;

    setWordFrequency(reconcile(freqMap));
  };

  // Get supported languages
  const supportedLanguages = () => Object.keys(langData);

  // Get current language data
  const currentLangData = () => langData[currentLang()] || null;

  // Get frequency for a word, with fallback to reading-based lookup
  const getFrequency = (word: string): WordFrequencyEntry | null => {
    const direct = wordFrequency[word];
    if (direct) return direct;
    if (!supportsReadingCanonicalization(currentLangData())) return null;
    // If word is pure kana, try to find its canonical kanji form in freq data
    if (isAllKana(word)) {
      const hiragana = katakanaToHiragana(word);
      const canonical = readingToCanonical[hiragana];
      if (canonical) return wordFrequency[canonical] || null;
    }
    return null;
  };

  // Resolve a pure-hiragana word to its canonical (kanji) form using freq data.
  // Katakana spellings stay as-is because they often represent distinct usage
  // and should not inherit the canonical kanji source automatically.
  const getCanonicalForm = (word: string): string => {
    if (!word) return word;
    if (!supportsReadingCanonicalization(currentLangData())) return word;
    // Already contains kanji — no normalization needed
    if (containsKanji(word)) return word;
    // Already in freq data as-is (some words are natively kana, e.g. ところ)
    if (wordFrequency[word]) return word;
    // Not pure kana (e.g. Latin text) — skip
    if (!isAllKana(word)) return word;
    // Do not resolve katakana spellings to a kanji headword.
    const hiragana = katakanaToHiragana(word);
    if (hiragana !== word) return word;

    // Look up canonical form via reading
    const canonical = readingToCanonical[hiragana];
    return canonical || word;
  };

  const getWordVariants = (word: string): string[] => {
    if (!word) return [];

    const variants = new Set<string>();
    variants.add(word);

    const canonical = getCanonicalForm(word);
    if (canonical) {
      variants.add(canonical);
    }

    const freqEntry = wordFrequency[word] || (canonical ? wordFrequency[canonical] : undefined);
    const reading = freqEntry?.reading;
    if (reading) {
      const hiragana = katakanaToHiragana(reading);
      for (const variant of readingToVariants[hiragana] ?? []) {
        variants.add(variant);
      }
    }

    return Array.from(variants);
  };

  // Get level name from langdata (e.g., "JLPT N5" for level 5)
  const getLevelName = (level: number): string => {
    const data = currentLangData();
    const levelNames = data?.freq_level_names || {};
    return levelNames[String(level)] || `Level ${level}`;
  };

  // Get all frequency level names from langdata
  const getFreqLevelNames = (): Record<string, string> => {
    const data = currentLangData();
    return data?.freq_level_names || {};
  };

  // Check if POS type is translatable
  const isTranslatable = (pos: string): boolean => {
    const data = currentLangData();
    if (!data?.translatable) return true; // Default to translatable if not specified
    return data.translatable.includes(pos);
  };

  // Parse grammar data into lookup structures
  const parseGrammarData = (data: LanguageDataMap) => {
    const lang = currentLang();
    const langInfo = data[lang];
    if (!langInfo?.grammar || !langInfo.hasGrammar) {
      grammarMap = new Map();
      grammarPatternsSorted = [];
      return;
    }

    const levelNames = langInfo.grammar_level_names || {};
    const newMap = new Map<string, GrammarEntry>();

    for (const point of langInfo.grammar) {
      const entry: GrammarEntry = {
        ...point,
        levelName: levelNames[String(point.level)] || `Level ${point.level}`,
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

    // Build full text from tokens
    const fullText = tokens.map(t => t.word).join('');
    const matched: GrammarEntry[] = [];
    const matchedPatterns = new Set<string>();

    for (const entry of grammarPatternsSorted) {
      if (matchedPatterns.has(entry.pattern)) continue;
      if (fullText.includes(entry.pattern)) {
        matched.push(entry);
        matchedPatterns.add(entry.pattern);
      }
    }

    return matched;
  };

  // Whether current language supports grammar
  const supportsGrammar = (): boolean => {
    const data = currentLangData();
    return data?.hasGrammar === true && grammarPatternsSorted.length > 0;
  };

  // Get grammar level name
  const getGrammarLevelName = (level: number): string => {
    const data = currentLangData();
    const levelNames = data?.grammar_level_names || {};
    return levelNames[String(level)] || `Level ${level}`;
  };

  // Get all grammar level names
  const getGrammarLevelNames = (): Record<string, string> => {
    const data = currentLangData();
    return data?.grammar_level_names || {};
  };

  // Get translatable POS types
  const translatableTypes = (): string[] => {
    const data = currentLangData();
    return data?.translatable || [];
  };

  // Get language feature capabilities based on fixed_settings and language code
  const getLanguageFeatures = (): LanguageFeatures => {
    const data = currentLangData();
    const fixedSettings = data?.fixed_settings || {};
    const fixedKeys = Object.keys(fixedSettings) as (keyof Settings)[];
    const scripts = data?.supportedScripts || [];
    
    // Derive script-based capabilities from language data
    const CJK_SCRIPTS = ['Han', 'Hira', 'Kana', 'Hang', 'Bopo'];
    const RTL_SCRIPTS = ['Arab', 'Hebr', 'Syrc', 'Thaa'];
    const isLogographic = scripts.some(s => CJK_SCRIPTS.includes(s));
    const isRTL = scripts.some(s => RTL_SCRIPTS.includes(s));

    let usesLatinScript: boolean;
    if (typeof data?.usesLatinScript === 'boolean') {
      usesLatinScript = data.usesLatinScript;
    } else if (scripts.length > 0) {
      usesLatinScript = scripts.includes('Latn');
    } else {
      usesLatinScript = !isLogographic && !isRTL;
    }
    
    return {
      // Languages with readings (furigana/pinyin) — driven by language data
      supportsReadings: fixedSettings.furigana !== false && data?.hasFurigana === true,
      // Pitch accent data — driven by language data
      supportsPitchAccent: fixedSettings.showPitchAccent !== false && data?.hasPitchAccent === true,
      isLogographic,
      isRTL,
      usesLatinScript,
      // All languages can potentially have color codes if defined
      supportsColorCodes: Boolean(data?.colour_codes && Object.keys(data.colour_codes).length > 0),
      // Frequency levels are usually for Japanese (JLPT) but can be configured for any language
      supportsFrequencyLevels: Boolean(data?.freq && data.freq.length > 0),
      hasFixedSettings: fixedKeys.length > 0,
      fixedSettingKeys: fixedKeys,
      // Character name detection — driven by language data
      supportsCharacterNames: data?.hasCharacterNames === true,
      // Vertical text support — driven by language data
      supportsVerticalText: data?.supportsVerticalText === true,
      // Grammar data available
      supportsGrammar: data?.hasGrammar === true,
      // CJK parentheses for character names
      usesCJKParentheses: data?.usesCJKParentheses === true,
    };
  };

  // Get effective settings with language overrides applied
  const getEffectiveSettings = <T extends Partial<Settings>>(baseSettings: T): T => {
    const data = currentLangData();
    if (!data?.fixed_settings) return baseSettings;
    
    // Merge base settings with language-fixed settings (fixed_settings take precedence)
    return { ...baseSettings, ...data.fixed_settings } as T;
  };

  // Check if a specific setting is fixed by language data
  const isSettingFixed = (key: keyof Settings): boolean => {
    const data = currentLangData();
    if (!data?.fixed_settings) return false;
    return key in data.fixed_settings;
  };

  // Tokenize text using the best available backend for the language
  const tokenizeText = async (text: string, language: LanguageCode): Promise<TokenizationResult> => {
    const registry = getNLPBackendRegistry();
    const backends = registry.getBackendsForLanguage(language);
    
    if (backends.length === 0) {
      throw new Error(`No NLP backend available for language: ${language}`);
    }
    
    // Use the first (highest-priority) backend
    const backend = backends[0];
    
    if (!backend.isReady()) {
      throw new Error(`NLP backend for ${language} is not initialized`);
    }
    
    return backend.tokenize(text, language);
  };

  // Get the best backend for a given language
  const getBestBackendForLanguage = (language: LanguageCode): NLPBackend | null => {
    const registry = getNLPBackendRegistry();
    const backends = registry.getBackendsForLanguage(language);
    return backends.length > 0 ? backends[0] : null;
  };

  // Initialize all available NLP backends
  const initializeNLPBackends = async (): Promise<void> => {
    const registry = getNLPBackendRegistry();
    await registry.initializeAll();
  };

  // Cleanup all NLP backends
  const cleanupNLPBackends = async (): Promise<void> => {
    const registry = getNLPBackendRegistry();
    await registry.cleanupAll();
  };

  onMount(() => {
    loadLangData();
    // Initialize NLP backends on mount
    void initializeNLPBackends().catch(err => {
      console.error('[LanguageContext] Failed to initialize NLP backends:', err);
    });
  });

  createEffect(() => {
    const lang = currentLang();
    void lang;
    parseWordFrequency(langData as LanguageDataMap);
    parseGrammarData(langData as LanguageDataMap);
  });

  onCleanup(() => {
    for (const cleanup of ipcCleanups) cleanup();
    ipcCleanups.length = 0;
    // Cleanup NLP backends
    void cleanupNLPBackends().catch(err => {
      console.error('[LanguageContext] Failed to cleanup NLP backends:', err);
    });
  });

  const value: LanguageContextValue = {
    langData,
    supportedLanguages,
    currentLangData,
    wordFrequency,
    getFrequency,
    getLevelName,
    getFreqLevelNames,
    isLoading,
    isTranslatable,
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
    tokenizeText,
    getBestBackendForLanguage,
    initializeNLPBackends,
    cleanupNLPBackends,
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
      return data?.colour_codes[pos] || null;
    },
  };
}
