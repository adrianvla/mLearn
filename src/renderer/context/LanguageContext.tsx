/**
 * Language Data Context
 * Manages language data and supported languages
 */

import { createContext, useContext, ParentComponent, onMount, onCleanup, createSignal } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import type { LanguageDataMap, LanguageData, WordFrequencyMap, WordFrequencyEntry, Settings } from '../../shared/types';

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
}

// Create context
const LanguageContext = createContext<LanguageContextValue>();

export const LanguageProvider: ParentComponent<{ language?: string }> = (props) => {
  const [langData, setLangData] = createStore<LanguageDataMap>({});
  const [wordFrequency, setWordFrequency] = createStore<WordFrequencyMap>({});
  const [isLoading, setIsLoading] = createSignal(true);
  const [currentLang] = createSignal<string>(props.language || 'ja');
  const ipcCleanups: Array<() => void> = [];

  // Load language data
  const loadLangData = () => {
    if (typeof window !== 'undefined' && window.mLearnIPC) {
      window.mLearnIPC.getLangData();
      ipcCleanups.push(window.mLearnIPC.onLangData((data) => {
        setLangData(reconcile(data as unknown as LanguageDataMap));
        parseWordFrequency(data as unknown as LanguageDataMap);
        setIsLoading(false);
      }));
    } else {
      // Tethered mode
      fetch('/api/lang-data')
        .then(res => res.json())
        .then(data => {
          setLangData(reconcile(data));
          parseWordFrequency(data);
          setIsLoading(false);
        })
        .catch(() => {
          setIsLoading(false);
        });
    }
  };

  // Parse word frequency data
  const parseWordFrequency = (data: LanguageDataMap) => {
    const lang = currentLang();
    const langInfo = data[lang];
    if (!langInfo?.freq) return;

    const freqMap: WordFrequencyMap = {};
    const freq = langInfo.freq;
    const levelNames = langInfo.freq_level_names || {};

    for (let i = 0; i < freq.length; i++) {
      const entry = freq[i];
      if (!entry || entry.length < 2) continue;

      let level = 1;
      if (i <= 1500) level = 5;
      else if (i <= 5000) level = 4;
      else if (i <= 15000) level = 3;
      else if (i <= 30000) level = 2;

      const levelName = levelNames[String(level)] || `Level ${level}`;

      freqMap[entry[0]] = {
        reading: entry[1],
        level: levelName,
        raw_level: level,
      };
    }

    setWordFrequency(reconcile(freqMap));
  };

  // Get supported languages
  const supportedLanguages = () => Object.keys(langData);

  // Get current language data
  const currentLangData = () => langData[currentLang()] || null;

  // Get frequency for a word
  const getFrequency = (word: string): WordFrequencyEntry | null => {
    return wordFrequency[word] || null;
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

  // Get translatable POS types
  const translatableTypes = (): string[] => {
    const data = currentLangData();
    return data?.translatable || [];
  };

  // Get language feature capabilities based on fixed_settings and language code
  const getLanguageFeatures = (): LanguageFeatures => {
    const data = currentLangData();
    const lang = currentLang();
    const fixedSettings = data?.fixed_settings || {};
    const fixedKeys = Object.keys(fixedSettings) as (keyof Settings)[];
    
    // Language-specific defaults
    const isJapanese = lang === 'ja';
    const isChinese = lang === 'zh' || lang === 'zh-CN' || lang === 'zh-TW';
    const isKorean = lang === 'ko';
    const isArabic = lang === 'ar';
    const isHebrew = lang === 'he';
    
    // CJK languages are logographic (use characters that may need readings)
    const isLogographic = isJapanese || isChinese || isKorean;
    
    // RTL languages
    const isRTL = isArabic || isHebrew;
    
    return {
      // Japanese and Chinese support readings (furigana/pinyin)
      supportsReadings: fixedSettings.furigana !== false && (isJapanese || isChinese),
      // Only Japanese has pitch accent data in this app
      supportsPitchAccent: fixedSettings.showPitchAccent !== false && isJapanese,
      isLogographic,
      isRTL,
      // All languages can potentially have color codes if defined
      supportsColorCodes: Boolean(data?.colour_codes && Object.keys(data.colour_codes).length > 0),
      // Frequency levels are usually for Japanese (JLPT) but can be configured for any language
      supportsFrequencyLevels: Boolean(data?.freq && data.freq.length > 0),
      hasFixedSettings: fixedKeys.length > 0,
      fixedSettingKeys: fixedKeys,
      // Character name detection primarily for Japanese anime subtitles
      supportsCharacterNames: isJapanese,
      // Vertical text support for CJK languages (Japanese, Chinese, Korean)
      supportsVerticalText: isJapanese || isChinese || isKorean,
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

  onMount(() => {
    loadLangData();
  });

  onCleanup(() => {
    for (const cleanup of ipcCleanups) cleanup();
    ipcCleanups.length = 0;
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
