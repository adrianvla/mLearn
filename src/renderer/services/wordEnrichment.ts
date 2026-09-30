/**
 * Card content enrichment: the ONE place that turns a bare word surface into
 * flashcard content (meaning, reading, prosody) from the language package's
 * dictionary.
 *
 * Why this exists: cards created from a bare word (Level Study bulk add, exam
 * seeds) carry only a surface. Every surface that fills such a card must go
 * through here so the dictionary contract, the dictionary target language, and
 * the package-declared reading/prosody extraction stay in one place. This
 * consolidates existing behaviour (promoteSuggestedFlashcards did this inline);
 * it adds no new linguistic knowledge — the language package declares which
 * reading/prosody fields exist, and this module only reads what the dictionary
 * returns for those declared paths.
 */

import { getBackend } from '../../shared/backends';
import type { FlashcardContent, FlashcardProsody, LanguageData, TranslationEntry } from '../../shared/types';
import { getDictionaryTargetLanguageForSettings } from '../utils/dictionaryTargetLanguage';
import { extractProsodyFromTranslationData } from '../utils/readingProsody';
import { extractReadingValue } from '../utils/translationCacheParsers';

/** Settings subset that decides which dictionary the lookup queries. */
export type DictionaryTargetSettings = Parameters<typeof getDictionaryTargetLanguageForSettings>[0];

export interface EnrichWordInput {
  word: string;
  language: string;
  /** The language package that owns this surface (reading/prosody semantics). */
  languageData?: LanguageData | null;
  /** Resolves the dictionary target language. Defaults to the current settings. */
  settings?: DictionaryTargetSettings;
  /** Dictionary entry index used for the meaning; the next entry holds extra definitions. */
  definitionIndex?: number;
  /** Overrides the settings-derived dictionary target language. */
  dictionaryTargetLanguage?: string;
  /** Existing card content: facts the card already has (e.g. a captured reading) win. */
  currentContent?: Partial<FlashcardContent>;
}

export interface EnrichedWordContent {
  back: string;
  reading?: string;
  prosody?: FlashcardProsody;
  definition?: string[];
  translation?: string[];
}

type TranslateFn = (
  word: string,
  sourceLanguage: string,
  options?: { dictionaryTargetLanguage?: string },
) => Promise<{ data?: unknown[] } | undefined>;

export interface EnrichWordDeps {
  translate?: TranslateFn;
}

async function defaultTranslate(
  word: string,
  from: string,
  options?: { dictionaryTargetLanguage?: string },
): Promise<{ data?: unknown[] } | undefined> {
  return getBackend().translate(word, from, options) as Promise<{ data?: unknown[] } | undefined>;
}

/** The dictionary-only content for a word, or null when the package has no entry. */
export async function enrichWord(
  input: EnrichWordInput,
  deps: EnrichWordDeps = {},
): Promise<EnrichedWordContent | null> {
  const word = input.word.trim();
  if (!word) return null;

  const translate = deps.translate ?? defaultTranslate;
  const dictionaryTargetLanguage = input.dictionaryTargetLanguage
    ?? (input.settings
      ? getDictionaryTargetLanguageForSettings(input.settings, input.language)
      : undefined);

  const response = await translate(
    word,
    input.language,
    dictionaryTargetLanguage ? { dictionaryTargetLanguage } : undefined,
  );
  const data = response?.data;
  if (!Array.isArray(data) || data.length === 0) return null;

  const primaryIndex = input.definitionIndex ?? 0;
  const primaryEntry = data[primaryIndex] as TranslationEntry | undefined;
  const definitions = primaryEntry?.definitions;
  const back = Array.isArray(definitions) ? definitions.join('; ') : (definitions ? String(definitions) : '');
  if (!back) return null;

  // A reading the card already carries (e.g. captured from media) is authoritative.
  const currentReading = input.currentContent?.reading;
  const reading = (currentReading && currentReading.trim())
    || extractReadingValue(primaryEntry, input.languageData ?? null)
    || '';

  const prosody = extractProsodyFromTranslationData(response, input.languageData ?? null, reading);

  const secondaryDefinitions = (data[primaryIndex + 1] as TranslationEntry | undefined)?.definitions;
  const definition = secondaryDefinitions
    ? (Array.isArray(secondaryDefinitions) ? secondaryDefinitions : [String(secondaryDefinitions)])
    : undefined;

  return {
    back,
    ...(reading ? { reading } : {}),
    ...(prosody ? { prosody } : {}),
    ...(definition && definition.length > 0 ? { definition } : {}),
    translation: [back],
  };
}
