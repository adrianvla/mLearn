import type { FlashcardContent, FlashcardStore, LanguageData, LanguageDataCatalogStatus, Settings, TranslationResponse, WordFrequencyEntry } from '../../../shared/types';
import type { WordLookupCandidateOptions } from '../../hooks/useTranslation';
import type { SuggestedFlashcard } from '../../../shared/types';
import { extractFirstDefinition } from '../../utils/translationCacheParsers';
import { extractProsodyFromTranslationData } from '../../utils/readingProsody';
import { getDictionaryTargetLanguageForSettings, installedDictionaryTargetLanguages } from '../../utils/dictionaryTargetLanguage';
import { getFrequencyLevelLabel, isDisplayableFrequencyLevel, sortFrequencyLevelsForDisplay } from '../../../shared/languageFeatures';
import { getLocalizedLanguageName, type TranslateLanguageName } from '../../utils/languageDisplayName';
import { getLanguageDisplayName } from '../../../shared/utils/textUtils';

export interface SuggestedLookupLanguageTools {
  getCanonicalFormForLanguage: (language: string, word: string) => string;
  getWordVariantsForLanguage: (language: string, word: string) => string[];
  getReadingVariantsForLanguage: (language: string, reading: string) => string[];
  langData: Record<string, LanguageData>;
  currentLangData: () => LanguageData | null;
}

export interface SuggestedPreviewDependencies {
  getCachedTranslation: (
    word: string,
    language?: string,
    lookupOptions?: WordLookupCandidateOptions,
  ) => TranslationResponse | null;
  getCachedReading: (
    word: string,
    language?: string,
    lookupOptions?: WordLookupCandidateOptions,
  ) => string | null;
  getLanguageData: (language: string) => LanguageData | null;
}

export interface SuggestedLevelFilterOption {
  value: string;
  label: string;
}

interface SuggestedLevelFilterOptions {
  suggestions: readonly SuggestedFlashcard[];
  languageDataFor: (language: string) => LanguageData | null | undefined;
  getFrequencyForLanguage?: (language: string, word: string) => WordFrequencyEntry | null;
  t: TranslateLanguageName;
  displayLocale?: string;
}

const LEVEL_FILTER_PREFIX = 'level:';

/** Languages represented in the learner's own flashcard material or history. */
export function getSuggestedFilterLanguages(
  store: Partial<Pick<FlashcardStore,
    'flashcards' | 'suggestedFlashcards' | 'wordCandidates' | 'wordKnowledge' | 'grammarKnowledge'
    | 'dailyStats' | 'ignoredWords' | 'knownUntracked' | 'wordStatsMap'>>,
  selectedLanguages: readonly string[] = [],
  fallbackLanguage?: string,
): string[] {
  const languages = new Set<string>();
  const add = (language?: string) => {
    const normalized = language?.trim();
    if (normalized) languages.add(normalized);
  };
  const addFromKey = (key: string) => {
    const separator = key.indexOf(':');
    if (separator > 0) add(key.slice(0, separator));
    else add(fallbackLanguage);
  };
  const addEntryLanguage = (language: string | undefined, key: string) => {
    if (language) add(language);
    else addFromKey(key);
  };

  for (const card of Object.values(store.flashcards ?? {})) add(card.language ?? fallbackLanguage);
  for (const suggestion of Object.values(store.suggestedFlashcards ?? {})) add(suggestion.language);
  for (const [key, candidate] of Object.entries(store.wordCandidates ?? {})) addEntryLanguage(candidate.language, key);
  for (const [key, entry] of Object.entries(store.wordKnowledge ?? {})) addEntryLanguage(entry.language, key);
  for (const [key, entry] of Object.entries(store.grammarKnowledge ?? {})) addEntryLanguage(entry.language, key);
  for (const [key, entry] of Object.entries(store.ignoredWords ?? {})) addEntryLanguage(entry.language, key);
  for (const [date, byLanguage] of Object.entries(store.dailyStats ?? {})) {
    if (!date) continue;
    for (const language of Object.keys(byLanguage)) add(language);
  }
  for (const key of Object.keys(store.knownUntracked ?? {})) addFromKey(key);
  for (const key of Object.keys(store.wordStatsMap ?? {})) addFromKey(key);
  for (const language of selectedLanguages) add(language);

  return [...languages].sort((left, right) => left.localeCompare(right));
}

/** Adds display labels only after the learner-relevant language set is known. */
export function buildSuggestedFilterLanguageNames(
  store: Partial<Pick<FlashcardStore,
    'flashcards' | 'suggestedFlashcards' | 'wordCandidates' | 'wordKnowledge' | 'grammarKnowledge'
    | 'dailyStats' | 'ignoredWords' | 'knownUntracked' | 'wordStatsMap'>>,
  installedLanguageData: Record<string, LanguageData | null | undefined>,
  displayLocale: string,
  selectedLanguages: readonly string[] = [],
  fallbackLanguage?: string,
): Record<string, string> {
  return Object.fromEntries(getSuggestedFilterLanguages(store, selectedLanguages, fallbackLanguage).map(language => [
    language,
    getLanguageDisplayName(language, installedLanguageData[language] ?? null, displayLocale),
  ]));
}

function buildSuggestedLevelFilterValue(language: string, level: number): string {
  return `${LEVEL_FILTER_PREFIX}${encodeURIComponent(language)}:${level}`;
}

function parseSuggestedLevelFilterValue(value: string): { language: string; level: number } | null {
  if (!value.startsWith(LEVEL_FILTER_PREFIX)) return null;
  const payload = value.slice(LEVEL_FILTER_PREFIX.length);
  const separator = payload.lastIndexOf(':');
  if (separator <= 0) return null;
  const language = decodeURIComponent(payload.slice(0, separator));
  const level = Number(payload.slice(separator + 1));
  if (!language || !Number.isFinite(level)) return null;
  return { language, level };
}

export function groupSuggestedWordsByLanguageForWarmCache(
  suggestions: Iterable<SuggestedFlashcard>,
  fallbackLanguage: string,
): Array<{ language: string; words: string[] }> {
  const grouped = new Map<string, Set<string>>();
  for (const suggestion of suggestions) {
    if (!suggestion.word.trim()) continue;
    const language = suggestion.language || fallbackLanguage;
    const words = grouped.get(language) ?? new Set<string>();
    words.add(suggestion.word);
    grouped.set(language, words);
  }

  return Array.from(grouped.entries(), ([language, words]) => ({
    language,
    words: Array.from(words),
  }));
}

export function buildSuggestedLevelFilterOptions(options: SuggestedLevelFilterOptions): SuggestedLevelFilterOption[] {
  const levelsByLanguage = new Map<string, Set<number>>();
  for (const suggestion of options.suggestions) {
    const languageData = options.languageDataFor(suggestion.language) ?? null;
    const level = resolveSuggestedLevel(suggestion, options.getFrequencyForLanguage, languageData);
    if (level === null) continue;
    const languageLevels = levelsByLanguage.get(suggestion.language) ?? new Set<number>();
    languageLevels.add(level);
    levelsByLanguage.set(suggestion.language, languageLevels);
  }

  const languages = Array.from(levelsByLanguage.keys()).sort((left, right) => left.localeCompare(right));
  const includeLanguageName = languages.length > 1;
  const result: SuggestedLevelFilterOption[] = [
    { value: 'all', label: options.t('mlearn.Flashcards.Suggested.Filter.AllLevels') },
  ];

  for (const language of languages) {
    const languageData = options.languageDataFor(language) ?? null;
    const levelNames = languageData?.frequencyLevels?.names ?? {};
    const sortedLevels = sortFrequencyLevelsForDisplay(Array.from(levelsByLanguage.get(language) ?? []), languageData);
    const languageName = includeLanguageName
      ? getLocalizedLanguageName(language, languageData, options.t, language, options.displayLocale)
      : '';

    for (const level of sortedLevels) {
      const levelLabel = getFrequencyLevelLabel(level, levelNames, languageData);
      result.push({
        value: buildSuggestedLevelFilterValue(language, level),
        label: includeLanguageName ? `${languageName} ${levelLabel}` : levelLabel,
      });
    }
  }

  result.push({ value: 'unknown', label: options.t('mlearn.Flashcards.Suggested.Filter.Unknown') });
  return result;
}

export function resolveSuggestedLevel(
  suggestion: SuggestedFlashcard,
  getFrequencyForLanguage?: (language: string, word: string) => WordFrequencyEntry | null,
  languageData?: LanguageData | null,
): number | null {
  const levelNames = languageData?.frequencyLevels?.names ?? {};
  if (typeof suggestion.level === 'number' && Number.isFinite(suggestion.level)) {
    return isDisplayableFrequencyLevel(suggestion.level, levelNames, languageData) ? suggestion.level : null;
  }

  const frequency = getFrequencyForLanguage?.(suggestion.language, suggestion.word);
  return typeof frequency?.raw_level === 'number'
    && Number.isFinite(frequency.raw_level)
    && isDisplayableFrequencyLevel(frequency.raw_level, levelNames, languageData)
    ? frequency.raw_level
    : null;
}

export function suggestedLevelFilterMatches(
  suggestion: SuggestedFlashcard,
  filterValue: string,
  getFrequencyForLanguage?: (language: string, word: string) => WordFrequencyEntry | null,
  languageData?: LanguageData | null,
): boolean {
  if (filterValue === 'all') return true;
  const level = resolveSuggestedLevel(suggestion, getFrequencyForLanguage, languageData);
  if (filterValue === 'unknown') return level === null;
  const parsed = parseSuggestedLevelFilterValue(filterValue);
  return Boolean(
    parsed
    && suggestion.language === parsed.language
    && level === parsed.level,
  );
}

export function buildSuggestedWordLookupOptions(
  settings: Pick<Settings, 'dictionaryTargetLanguages' | 'language' | 'uiLanguage'>,
  language: string,
  tools: SuggestedLookupLanguageTools,
  languageDataCatalog: () => readonly LanguageDataCatalogStatus[],
): WordLookupCandidateOptions {
  return {
    getCanonicalForm: (word: string) => tools.getCanonicalFormForLanguage(language, word),
    getWordVariants: (word: string) => tools.getWordVariantsForLanguage(language, word),
    getReadingVariants: (reading: string) => tools.getReadingVariantsForLanguage(language, reading),
    // Reactive: reading the catalog here keeps a pack that finishes installing
    // mid-session from leaving this surface pinned to the package default.
    dictionaryTargetLanguage: () => getDictionaryTargetLanguageForSettings(
      settings,
      language,
      installedDictionaryTargetLanguages(languageDataCatalog(), language),
    ),
    languageData: () => tools.langData[language] ?? (language === settings.language ? tools.currentLangData() : null),
  };
}

export function buildSuggestedFlashcardPreviewContent(
  suggestion: SuggestedFlashcard,
  lookupOptions: WordLookupCandidateOptions,
  deps: SuggestedPreviewDependencies,
): FlashcardContent {
  const languageData = deps.getLanguageData(suggestion.language);
  const cachedTranslation = deps.getCachedTranslation(suggestion.word, suggestion.language, lookupOptions);
  const cachedReading = deps.getCachedReading(suggestion.word, suggestion.language, lookupOptions) || undefined;
  const prosody = cachedTranslation?.data
    ? extractProsodyFromTranslationData(cachedTranslation, languageData, suggestion.reading || cachedReading)
    : undefined;
  const translation = cachedTranslation?.data
    ? extractFirstDefinition(cachedTranslation.data, languageData) || ''
    : '';

  return {
    front: suggestion.word,
    reading: suggestion.reading || cachedReading,
    back: translation,
    type: 'word',
    prosody,
    pos: suggestion.pos,
  };
}
