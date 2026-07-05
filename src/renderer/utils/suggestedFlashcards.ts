import { getLearningLanguageLevelForLanguage, isFrequencyLevelAtOrEasierThanTarget } from '../../shared/languageFeatures';
import { DEFAULT_SETTINGS, type LanguageData } from '../../shared/types';
import { isWordInLanguageScript } from '../../shared/utils/textUtils';
import { hashWordSync } from '../services/srsAlgorithm';
import { getCachedTranslation, warmTranslationCache } from '../hooks/useTranslation';
import { hasDefinition } from './translationCacheParsers';

export interface SuggestedFlashcardFilterSettings {
  autoSuggestFlashcards: boolean;
  autoSuggestUnknownWords: boolean;
  learningLanguageLevel?: number | null;
  learningLanguageLevels?: Record<string, number | null>;
}

export interface SuggestedFlashcardInput {
  word: string;
  reading?: string;
  pos?: string;
  level?: number | null;
  language: string;
}

export type ComprehensiveWordStatus = 'known' | 'learning' | 'unknown' | null;

export interface SuggestedFlashcardWordFormOptions {
  getWordForms?: (word: string) => string[];
  dictionaryTargetLanguage?: string;
  languageData?: LanguageData | null;
}

function getDictionaryCandidateWords(
  word: string,
  options: SuggestedFlashcardWordFormOptions = {},
): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const append = (candidate: string | null | undefined) => {
    const normalized = candidate?.trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push(normalized);
  };

  append(word);
  for (const candidate of options.getWordForms?.(word) ?? []) {
    append(candidate);
  }

  return candidates;
}

export function isWordInDictionary(
  word: string,
  language: string,
  options: SuggestedFlashcardWordFormOptions = {},
): boolean {
  for (const candidate of getDictionaryCandidateWords(word, options)) {
    const cached = getCachedTranslation(candidate, language, {
      dictionaryTargetLanguage: options.dictionaryTargetLanguage,
      languageData: options.languageData,
    });
    if (cached?.data && hasDefinition(cached.data, options.languageData)) {
      return true;
    }
  }
  return false;
}

/**
 * Pure, synchronous predicate for whether a suggested flashcard should be kept/created.
 *
 * `userLevel`: pass `null` to skip the level check, or `undefined` to use
 * `settings.learningLanguageLevels[input.language]`.
 */
export function shouldKeepSuggestion(
  input: SuggestedFlashcardInput,
  settings: SuggestedFlashcardFilterSettings,
  knownWordSet: Set<string>,
  userLevel?: number | null,
  comprehensiveStatus?: ComprehensiveWordStatus,
  languageData?: LanguageData | null,
  wordFormOptions: SuggestedFlashcardWordFormOptions = {},
): boolean {
  const autoSuggest = settings.autoSuggestFlashcards ?? DEFAULT_SETTINGS.autoSuggestFlashcards;
  if (!autoSuggest) return false;

  const allowUnknown = settings.autoSuggestUnknownWords ?? DEFAULT_SETTINGS.autoSuggestUnknownWords;
  const dictionaryOptions = {
    ...wordFormOptions,
    languageData: wordFormOptions.languageData ?? languageData,
  };
  if (!allowUnknown && !isWordInDictionary(input.word, input.language, dictionaryOptions)) return false;

  if (languageData && !isWordInLanguageScript(input.word, input.language, languageData)) return false;

  const settingsLevel = getLearningLanguageLevelForLanguage(
    {
      learningLanguageLevel: settings.learningLanguageLevel === undefined
        ? DEFAULT_SETTINGS.learningLanguageLevel
        : settings.learningLanguageLevel,
      learningLanguageLevels: settings.learningLanguageLevels,
    },
    input.language,
  );
  const effectiveUserLevel = userLevel === undefined ? settingsLevel : userLevel;
  if (
    effectiveUserLevel != null
    && (input.level == null || !isFrequencyLevelAtOrEasierThanTarget(input.level, effectiveUserLevel, languageData))
  ) {
    return false;
  }

  for (const candidate of getDictionaryCandidateWords(input.word, dictionaryOptions)) {
    const wordHash = hashWordSync(candidate);
    const lk = `${input.language}:${wordHash}`;
    if (knownWordSet.has(lk)) return false;
  }
  if (comprehensiveStatus === 'known') return false;

  return true;
}

export function shouldCaptureSuggestedFlashcard(
  word: string,
  language: string,
  settings: SuggestedFlashcardFilterSettings,
  languageData?: LanguageData | null,
  wordFormOptions: SuggestedFlashcardWordFormOptions = {},
): boolean {
  return shouldKeepSuggestion(
    { word, language },
    settings,
    new Set<string>(),
    null,
    null,
    languageData,
    wordFormOptions,
  );
}

export async function warmDictionaryStatus(
  words: string[],
  language: string,
  options: SuggestedFlashcardWordFormOptions = {},
): Promise<void> {
  const wordsToWarm = Array.from(
    new Set(words.flatMap((word) => getDictionaryCandidateWords(word, options))),
  );
  if (options.dictionaryTargetLanguage || options.languageData) {
    await warmTranslationCache(wordsToWarm, undefined, undefined, language, options.dictionaryTargetLanguage, options.languageData);
  } else {
    await warmTranslationCache(wordsToWarm, undefined, undefined, language);
  }
}

export async function filterSuggestedWords(
  words: string[],
  language: string,
  settings: SuggestedFlashcardFilterSettings,
  languageData?: LanguageData | null,
  wordFormOptions: SuggestedFlashcardWordFormOptions = {},
): Promise<Set<string>> {
  if (!(settings.autoSuggestFlashcards ?? DEFAULT_SETTINGS.autoSuggestFlashcards)) {
    return new Set<string>();
  }

  const allowedWords = Array.from(
    new Set(words.map((word) => word.trim()).filter(Boolean)),
  );

  if (!(settings.autoSuggestUnknownWords ?? DEFAULT_SETTINGS.autoSuggestUnknownWords)) {
    await warmDictionaryStatus(allowedWords, language, wordFormOptions);
  }

  return new Set(
    allowedWords.filter((word) =>
      shouldKeepSuggestion(
        { word, language },
        settings,
        new Set<string>(),
        null,
        null,
        languageData,
        wordFormOptions,
      ),
    ),
  );
}
