import type { FlashcardProsody, LanguageData } from '../../shared/types';
import { extractDisplayReading } from './subtitleParsing';
import { extractProsodyData, extractProsodyDataForReading, extractReadingValue } from './translationCacheParsers';

export interface TranslationDataWithItems {
  data?: unknown[];
}

export interface ResolveStoredProsodyForDisplayedReadingOptions {
  prosody?: FlashcardProsody;
  displayedReading: string | undefined | null;
  savedReadings?: readonly (string | undefined | null)[];
  languageData?: LanguageData | null;
}

export function normalizeDictionaryReading(reading: string | undefined | null, data?: LanguageData | null): string {
  if (!reading) return '';
  return extractDisplayReading(reading, data);
}

function readingsMatch(
  candidateReading: string | undefined | null,
  normalizedDisplayedReading: string,
  languageData?: LanguageData | null,
): boolean {
  return normalizeDictionaryReading(candidateReading, languageData) === normalizedDisplayedReading;
}

export function extractProsodyFromTranslationData(
  data?: TranslationDataWithItems,
  languageData?: LanguageData | null,
  reading?: string | null,
): FlashcardProsody | undefined {
  const translationItems = data?.data;
  if (!translationItems) return undefined;

  const normalizedReading = normalizeDictionaryReading(reading, languageData);
  if (normalizedReading) {
    const matchedProsody = extractProsodyDataForReading(translationItems, languageData, (candidateReading) => (
      readingsMatch(candidateReading, normalizedReading, languageData)
    ));
    if (matchedProsody) return matchedProsody;
  }

  const explicitProsody = extractProsodyData(translationItems[2], languageData);
  if (!explicitProsody) return undefined;

  const explicitReading = normalizeDictionaryReading(extractReadingValue(translationItems[2], languageData), languageData);
  if (!explicitReading || !normalizedReading || explicitReading === normalizedReading) {
    return explicitProsody;
  }

  return undefined;
}

export function resolveStoredProsodyForDisplayedReading(
  options: ResolveStoredProsodyForDisplayedReadingOptions,
): FlashcardProsody | undefined {
  const { prosody, displayedReading, savedReadings = [], languageData } = options;
  if (!prosody || !displayedReading) return undefined;

  const normalizedDisplayedReading = normalizeDictionaryReading(displayedReading, languageData);
  if (!normalizedDisplayedReading) return undefined;

  const matchedStoredProsody = extractProsodyDataForReading(
    prosody.raw,
    languageData,
    (candidateReading) => readingsMatch(candidateReading, normalizedDisplayedReading, languageData)
  );
  if (matchedStoredProsody) return matchedStoredProsody;

  const storedReading = extractReadingValue(prosody.raw, languageData);
  if (storedReading) return undefined;

  return savedReadings.some((savedReading) => (
    readingsMatch(savedReading, normalizedDisplayedReading, languageData)
  ))
    ? prosody
    : undefined;
}
