import { getCachedTranslation, warmTranslationCache } from '../hooks/useTranslation';
import { hasDefinition } from './translationCacheParsers';

export interface SuggestedFlashcardFilterSettings {
  autoSuggestFlashcards: boolean;
  autoSuggestUnknownWords: boolean;
}

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

export function shouldCaptureSuggestedFlashcard(
  word: string,
  language: string,
  settings: SuggestedFlashcardFilterSettings,
): boolean {
  if (!settings.autoSuggestFlashcards) return false;
  if (settings.autoSuggestUnknownWords) return true;
  return isWordInDictionary(word, language);
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
  if (!settings.autoSuggestFlashcards) {
    return new Set<string>();
  }

  const allowedWords = Array.from(
    new Set(words.map((word) => word.trim()).filter(Boolean)),
  );

  if (!settings.autoSuggestUnknownWords) {
    await warmDictionaryStatus(allowedWords, language);
  }

  return new Set(
    allowedWords.filter((word) => shouldCaptureSuggestedFlashcard(word, language, settings)),
  );
}
