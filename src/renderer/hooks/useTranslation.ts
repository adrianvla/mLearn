/**
 * Translation Hook
 * Handles word translation and dictionary lookups
 */

import { createSignal, createResource } from 'solid-js';
import type { TranslationResponse } from '../../shared/types';
import { useSettings } from '../context';

// Translation cache
const translationCache = new Map<string, TranslationResponse>();

// Local overrides storage key
const OVERRIDE_KEY = 'ml_translation_overrides';

// Read overrides from localStorage
function readOverrides(): Record<string, TranslationResponse> {
  try {
    const raw = localStorage.getItem(OVERRIDE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// Write overrides to localStorage
function writeOverrides(map: Record<string, TranslationResponse>): void {
  try {
    localStorage.setItem(OVERRIDE_KEY, JSON.stringify(map));
  } catch {
    // Ignore quota errors
  }
}

// Fetch translation from backend
async function fetchTranslation(word: string, url: string): Promise<TranslationResponse> {
  // Check override first
  const overrides = readOverrides();
  if (overrides[word]) {
    return overrides[word];
  }

  // Check cache
  if (translationCache.has(word)) {
    return translationCache.get(word)!;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ word }),
  });

  if (!response.ok) {
    throw new Error(`Translation request failed: ${response.status}`);
  }

  const data = await response.json() as TranslationResponse;
  translationCache.set(word, data);
  return data;
}

export interface UseTranslationOptions {
  immediate?: boolean;
}

export function useTranslation(options: UseTranslationOptions = {}) {
  const { settings } = useSettings();
  const [currentWord, setCurrentWord] = createSignal<string | null>(null);

  const [translation, { refetch }] = createResource(
    () => currentWord(),
    async (word) => {
      if (!word) return null;
      return fetchTranslation(word, settings.getTranslationUrl);
    }
  );

  const translate = async (word: string): Promise<TranslationResponse | null> => {
    setCurrentWord(word);
    if (options.immediate) {
      await refetch();
    }
    return translation() ?? null;
  };

  const setOverride = (word: string, value: TranslationResponse | null) => {
    const overrides = readOverrides();
    if (value === null) {
      delete overrides[word];
    } else {
      overrides[word] = value;
    }
    writeOverrides(overrides);
    translationCache.delete(word);
  };

  const clearCache = () => {
    translationCache.clear();
  };

  return {
    translation,
    translate,
    setOverride,
    clearCache,
    isLoading: () => translation.loading,
    error: () => translation.error,
  };
}

export function useTokenizer() {
  const { settings } = useSettings();

  const tokenize = async (text: string) => {
    const response = await fetch(settings.tokeniserUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      throw new Error(`Tokenization failed: ${response.status}`);
    }

    const data = await response.json();
    return data.tokens;
  };

  return { tokenize };
}

import type { DictionaryEntry } from '../../shared/types';

export function useDictionary() {
  const { settings } = useSettings();
  
  const lookup = async (word: string, reading?: string): Promise<DictionaryEntry[]> => {
    try {
      const response = await fetch(settings.getCardUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word, reading }),
      });
      
      if (!response.ok) {
        return [];
      }
      
      const data = await response.json();
      // Transform backend response to DictionaryEntry array
      if (data.data && Array.isArray(data.data)) {
        return data.data
          .filter((entry: unknown): entry is { definitions?: string[]; reading?: string } => 
            entry !== null && typeof entry === 'object'
          )
          .map((entry: { definitions?: string[]; reading?: string; word?: string }) => ({
            word: entry.word || word,
            reading: entry.reading || '',
            meanings: entry.definitions || [],
          }));
      }
      return [];
    } catch (e) {
      console.error('Dictionary lookup error:', e);
      return [];
    }
  };
  
  return { lookup };
}
