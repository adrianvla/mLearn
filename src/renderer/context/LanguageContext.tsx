/**
 * Language Data Context
 * Manages language data and supported languages
 */

import { createContext, useContext, ParentComponent, onMount, createSignal } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import type { LanguageDataMap, LanguageData, WordFrequencyMap, WordFrequencyEntry } from '../../shared/types';

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
}

// Create context
const LanguageContext = createContext<LanguageContextValue>();

export const LanguageProvider: ParentComponent<{ language?: string }> = (props) => {
  const [langData, setLangData] = createStore<LanguageDataMap>({});
  const [wordFrequency, setWordFrequency] = createStore<WordFrequencyMap>({});
  const [isLoading, setIsLoading] = createSignal(true);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [currentLang, setCurrentLang] = createSignal<string>(props.language || 'ja');

  // Load language data
  const loadLangData = () => {
    if (typeof window !== 'undefined' && window.mLearnIPC) {
      window.mLearnIPC.getLangData();
      window.mLearnIPC.onLangData((data) => {
        setLangData(reconcile(data as unknown as LanguageDataMap));
        parseWordFrequency(data as unknown as LanguageDataMap);
        setIsLoading(false);
      });
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

  onMount(() => {
    loadLangData();
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
