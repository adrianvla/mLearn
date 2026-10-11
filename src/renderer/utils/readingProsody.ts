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

  const selectedReading = normalizeDictionaryReading(reading, languageData)
    || normalizeDictionaryReading(extractReadingValue(translationItems[0], languageData), languageData);
  const candidates = collectReadingBoundProsody(translationItems, languageData);
  const readings = [...new Set(candidates.map((candidate) => candidate.reading))];
  const associatedReading = selectedReading || (readings.length === 1 ? readings[0] : '');
  if (!associatedReading) return undefined;

  const matching = candidates.filter((candidate) => (
    readingsMatch(candidate.reading, associatedReading, languageData)
  ));
  if (matching.length === 0) return undefined;

  // A response may contain several source records for one reading. Keep their
  // raw payloads together, but do not let response order choose between
  // conflicting positions.
  const positions = [...new Set(matching.map((candidate) => candidate.prosody.position))];
  const displays = [...new Set(matching.map((candidate) => candidate.prosody.display))];
  if (positions.length !== 1 || displays.length !== 1) return undefined;
  if (positions[0] === undefined && !displays[0]) return undefined;
  const first = matching[0].prosody;
  return {
    ...first,
    ...(positions[0] !== undefined ? { position: positions[0] } : {}),
    raw: matching.length === 1 ? first.raw : matching.map((candidate) => candidate.prosody.raw),
  };
}

interface ReadingBoundProsody {
  reading: string;
  prosody: FlashcardProsody;
}

function collectReadingBoundProsody(
  value: unknown,
  languageData?: LanguageData | null,
): ReadingBoundProsody[] {
  const result: ReadingBoundProsody[] = [];
  const seen = new Set<unknown>();
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (typeof candidate !== 'object' || candidate === null) return;

    const record = candidate as Record<string, unknown>;
    const candidateReading = extractReadingValue(record, languageData);
    const prosody = extractProsodyData(record, languageData);
    if (candidateReading && prosody && (prosody.position !== undefined || prosody.display) && !seen.has(candidate)) {
      seen.add(candidate);
      result.push({ reading: candidateReading, prosody });
    }
    Object.values(record).forEach(visit);
  };
  visit(value);
  return result;
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
