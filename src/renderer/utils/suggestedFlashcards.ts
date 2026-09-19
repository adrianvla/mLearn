import { getLearningLanguageLevelForLanguage, isDisplayableFrequencyLevel, isFrequencyLevelAtOrEasierThanTarget, sortFrequencyLevelsByDifficulty } from '../../shared/languageFeatures';
import { MEDIA_MIN_ENCOUNTERS } from '../learning/candidateSources';
import { DEFAULT_SETTINGS, type LanguageData } from '../../shared/types';
import { isWordInLanguageScript } from '../../shared/utils/textUtils';
import { hashWordSync } from '../services/srsAlgorithm';
import { getCachedTranslation, warmTranslationCache } from '../hooks/useTranslation';
import { hasDefinition } from './translationCacheParsers';
import { selectEncounterBatch } from '../learning/engine';

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
  /**
   * Recorded passive exposures of this word in the learner's CURRENT
   * content (R21). A recurring current-media term stays suggestible even
   * when it sits outside the target frequency level — the media, not the
   * exam list, is demanding it. Coverage heuristic only, never knowledge;
   * below MEDIA_MIN_ENCOUNTERS it is a one-off and gains no exception.
   */
  mediaRecurrence?: number;
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
  excludedWordSet?: ReadonlySet<string>,
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
  if (effectiveUserLevel != null) {
    const levelAdmits = (() => {
      if (input.level == null || !isDisplayableFrequencyLevel(input.level, undefined, languageData)) {
        // Off-list/beyond-exam words are kept only when the target is the hardest
        // displayable level — there, off-list vocabulary is the learner's frontier.
        const displayable = sortFrequencyLevelsByDifficulty(
          Object.keys(languageData?.frequencyLevels?.names ?? {}).map(Number),
          languageData,
        );
        return effectiveUserLevel === displayable.at(-1);
      }
      return isFrequencyLevelAtOrEasierThanTarget(input.level, effectiveUserLevel, languageData);
    })();
    // Current-media recurrence exception (R21): the SAME one-off threshold
    // as the policy's media-fit source; diminishing returns stay in the
    // policy's saturating media-relevance score, not here. Dictionary,
    // script, known and exclusion checks above are never bypassed.
    if (!levelAdmits && (input.mediaRecurrence ?? 0) < MEDIA_MIN_ENCOUNTERS) return false;
  }

  for (const candidate of getDictionaryCandidateWords(input.word, dictionaryOptions)) {
    const wordHash = hashWordSync(candidate);
    const lk = `${input.language}:${wordHash}`;
    // Exclusion is teaching policy ("never select/teach"), independent of knowledge status.
    if (knownWordSet.has(lk)) return false;
    if (excludedWordSet?.has(lk)) return false;
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
  filterOptions: {
    /** Recorded passive exposures per word in the learner's CURRENT content (R21). */
    mediaRecurrence?: ReadonlyMap<string, number>;
  } = {},
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

  const eligible = allowedWords.filter((word) =>
    shouldKeepSuggestion(
      { word, language, mediaRecurrence: filterOptions.mediaRecurrence?.get(word) },
      settings,
      new Set<string>(),
      null,
      null,
      languageData,
      wordFormOptions,
    ),
  );
  return new Set(selectEncounterBatch({
    preset: 'MEDIA',
    nowMs: 0,
    mediaItems: eligible.map((word) => ({ key: `${language}:${word}`, word, language })),
  }).map((decision) => decision.candidate.word!));
}

/**
 * Component-held state across subtitle runs of the current-content capture
 * producer (R21). Owned by the media route; consumed by
 * `planSubtitleCapture`/`recordCaptureAttempt`.
 */
export interface SubtitleCaptureState {
  /** Words already accumulated into the sidebar (first-sighting dedupe). */
  seenWords: Set<string>;
  /** Words whose async filter/persistence attempt has started but not finished. */
  inFlight: Set<string>;
  /**
   * Per completed attempt: the current-content recurrence a rejection
   * consumed, or positive infinity after a successful capture. A word with
   * no completed attempt remains retryable after temporary unavailability.
   */
  attemptedRecurrence: Map<string, number>;
}

/**
 * Plans one subtitle run's suggestion capture (R21 producer lifecycle).
 *
 * A FIRST sighting is always fresh: it accumulates into the sidebar and
 * attempts capture. A word that was already seen retries while no attempt
 * completed (capture disabled/failed), or when exposure grew past the last
 * rejected attempt. Thus continuous playback can promote a recurring
 * off-list term while a completed one-off rejection is not re-filtered on
 * every subtitle and a captured word is never re-attempted. Pure over its
 * inputs; the route owns the mutable state across runs.
 */
export function planSubtitleCapture<T extends { word: string }>(
  gated: readonly T[],
  state: SubtitleCaptureState,
  currentRecurrence: ReadonlyMap<string, number>,
): { fresh: T[]; retry: T[] } {
  const fresh: T[] = [];
  const retry: T[] = [];
  const plannedWords = new Set<string>();
  for (const entry of gated) {
    if (plannedWords.has(entry.word)) continue;
    plannedWords.add(entry.word);
    if (!state.seenWords.has(entry.word)) {
      state.seenWords.add(entry.word);
      fresh.push(entry);
      continue;
    }
    if (state.inFlight.has(entry.word)) continue;
    const attempted = state.attemptedRecurrence.get(entry.word);
    if (attempted === undefined || (currentRecurrence.get(entry.word) ?? 0) > attempted) {
      retry.push(entry);
    }
  }
  return { fresh, retry };
}

/**
 * Records a completed capture attempt's outcome (R21): a rejected word stores
 * the recurrence it consumed so a later growth retries; a captured word gets
 * a terminal marker. Unavailable or failed attempts are deliberately not
 * recorded and therefore remain retryable.
 */
export function recordCaptureAttempt(
  state: SubtitleCaptureState,
  word: string,
  captured: boolean,
  currentRecurrence: number,
): void {
  state.inFlight.delete(word);
  if (captured) {
    state.attemptedRecurrence.set(word, Number.POSITIVE_INFINITY);
    return;
  }
  state.attemptedRecurrence.set(word, currentRecurrence);
}
