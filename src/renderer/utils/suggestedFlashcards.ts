import { DEFAULT_SETTINGS } from '../../shared/types';
import { hashWordSync } from '../services/srsAlgorithm';
import { getCachedTranslation, warmTranslationCache } from '../hooks/useTranslation';
import { hasDefinition } from './translationCacheParsers';

export interface SuggestedFlashcardFilterSettings {
  autoSuggestFlashcards: boolean;
  autoSuggestUnknownWords: boolean;
  learningLanguageLevel?: number | null;
}

export interface SuggestedFlashcardInput {
  word: string;
  reading?: string;
  pos?: string;
  level?: number | null;
  language: string;
}

export type ComprehensiveWordStatus = 'known' | 'learning' | 'unknown' | null;

export function isWordInDictionary(
  word: string,
  language: string,
): boolean {
  const cached = getCachedTranslation(word, language);
  if (cached?.data) {
    return hasDefinition(cached.data);
  }
  return false;
}

/**
 * Pure, synchronous predicate for whether a suggested flashcard should be kept/created.
 *
 * `userLevel`: pass `null` to skip the level check, or `undefined` to use
 * `settings.learningLanguageLevel`.
 */
export function shouldKeepSuggestion(
  input: SuggestedFlashcardInput,
  settings: SuggestedFlashcardFilterSettings,
  knownWordSet: Set<string>,
  userLevel?: number | null,
  comprehensiveStatus?: ComprehensiveWordStatus,
): boolean {
  const autoSuggest = settings.autoSuggestFlashcards ?? DEFAULT_SETTINGS.autoSuggestFlashcards;
  if (!autoSuggest) return false;

  const allowUnknown = settings.autoSuggestUnknownWords ?? DEFAULT_SETTINGS.autoSuggestUnknownWords;
  if (!allowUnknown && !isWordInDictionary(input.word, input.language)) return false;

  const settingsLevel = settings.learningLanguageLevel === undefined
    ? DEFAULT_SETTINGS.learningLanguageLevel
    : settings.learningLanguageLevel;
  const effectiveUserLevel = userLevel === undefined ? settingsLevel : userLevel;
  if (effectiveUserLevel != null && (input.level == null || input.level < effectiveUserLevel)) {
    return false;
  }

  const wordHash = hashWordSync(input.word);
  const lk = `${input.language}:${wordHash}`;
  if (knownWordSet.has(lk)) return false;
  if (comprehensiveStatus === 'known') return false;

  return true;
}

export function shouldCaptureSuggestedFlashcard(
  word: string,
  language: string,
  settings: SuggestedFlashcardFilterSettings,
): boolean {
  return shouldKeepSuggestion(
    { word, language },
    settings,
    new Set<string>(),
    null,
    null,
  );
}

export async function warmDictionaryStatus(
  words: string[],
  language: string,
): Promise<void> {
  await warmTranslationCache(words, undefined, undefined, language);
}

export async function filterSuggestedWords(
  words: string[],
  language: string,
  settings: SuggestedFlashcardFilterSettings,
): Promise<Set<string>> {
  if (!(settings.autoSuggestFlashcards ?? DEFAULT_SETTINGS.autoSuggestFlashcards)) {
    return new Set<string>();
  }

  const allowedWords = Array.from(
    new Set(words.map((word) => word.trim()).filter(Boolean)),
  );

  if (!(settings.autoSuggestUnknownWords ?? DEFAULT_SETTINGS.autoSuggestUnknownWords)) {
    await warmDictionaryStatus(allowedWords, language);
  }

  return new Set(
    allowedWords.filter((word) =>
      shouldKeepSuggestion(
        { word, language },
        settings,
        new Set<string>(),
        null,
        null,
      ),
    ),
  );
}
