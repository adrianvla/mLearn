import type { FlashcardProsody, LanguageData } from '../../shared/types';
import { extractProsodyPayloadPosition, hasProsodyPayloadPositionExtractor } from './prosodyPayloadExtractors';

interface DefinitionExtractionOptions {
  stripHtml?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getPositionFromRecord(record: Record<string, unknown>): number | null {
  return typeof record.position === 'number' ? record.position : null;
}

function extractNumberAtPath(value: unknown, path: readonly string[] | undefined): number | null {
  if (!Array.isArray(path) || path.length === 0) return null;
  if (path.includes('*')) {
    for (const candidate of collectValuesAtPath(value, path)) {
      if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
    }
    return null;
  }
  let current = value;
  for (const segment of path) {
    if (typeof segment !== 'string' || segment.length === 0 || !isRecord(current)) return null;
    current = current[segment];
  }
  return typeof current === 'number' && Number.isFinite(current) ? current : null;
}

function extractStringAtPath(value: unknown, path: readonly string[] | undefined): string | null {
  if (!Array.isArray(path) || path.length === 0) return null;
  if (path.includes('*')) {
    for (const candidate of collectValuesAtPath(value, path)) {
      if (typeof candidate === 'string' && candidate) return candidate;
    }
    return null;
  }
  let current = value;
  for (const segment of path) {
    if (typeof segment !== 'string' || segment.length === 0 || !isRecord(current)) return null;
    current = current[segment];
  }
  return typeof current === 'string' && current ? current : null;
}

function extractDisplayValueAtPath(value: unknown, path: readonly string[] | undefined): string | null {
  if (!Array.isArray(path) || path.length === 0) return null;
  if (path.includes('*')) {
    for (const candidate of collectValuesAtPath(value, path)) {
      const display = normalizeDisplayValue(candidate);
      if (display) return display;
    }
    return null;
  }
  let current = value;
  for (const segment of path) {
    if (typeof segment !== 'string' || segment.length === 0 || !isRecord(current)) return null;
    current = current[segment];
  }
  return normalizeDisplayValue(current);
}

function normalizeDisplayValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function extractStringListAtPath(value: unknown, path: readonly string[] | undefined): string[] {
  if (!Array.isArray(path) || path.length === 0) return [];
  if (path.includes('*')) {
    return collectValuesAtPath(value, path).flatMap((item) => {
      if (typeof item === 'string') return [item];
      if (Array.isArray(item)) return item.filter((child): child is string => typeof child === 'string');
      return [];
    });
  }
  let current = value;
  for (const segment of path) {
    if (typeof segment !== 'string' || segment.length === 0 || !isRecord(current)) return [];
    current = current[segment];
  }
  if (typeof current === 'string') return [current];
  if (!Array.isArray(current)) return [];
  return current.filter((item): item is string => typeof item === 'string');
}

function collectValuesAtPath(value: unknown, path: readonly string[]): unknown[] {
  if (path.length === 0) return [value];
  const [segment, ...rest] = path;
  if (segment === '*') {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => collectValuesAtPath(item, rest));
  }
  if (typeof segment !== 'string' || segment.length === 0 || !isRecord(value)) return [];
  return collectValuesAtPath(value[segment], rest);
}

export function extractProsodyPosition(value: unknown): number | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractProsodyPosition(item);
      if (found !== null) {
        return found;
      }
    }
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const directPosition = getPositionFromRecord(value);
  if (directPosition !== null) {
    return directPosition;
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === 'pitches') continue;
    const found = extractProsodyPosition(child);
    if (found !== null) {
      return found;
    }
  }

  return null;
}

export function extractProsodyData(value: unknown, languageData?: LanguageData | null): FlashcardProsody | undefined {
  const prosodyType = languageData?.prosody?.type;
  if (!prosodyType || prosodyType === 'none') return undefined;
  if (value === undefined || value === null) return undefined;
  const configuredPosition = extractNumberAtPath(value, languageData?.prosody?.positionPath);
  const configuredDisplay = extractDisplayValueAtPath(value, languageData?.prosody?.displayPath);
  const hasModelSpecificExtractor = hasProsodyPayloadPositionExtractor(prosodyType);
  const position = configuredPosition
    ?? (hasModelSpecificExtractor
      ? extractProsodyPayloadPosition(value, prosodyType)
      : extractProsodyPosition(value));
  if (hasModelSpecificExtractor && position === null && !configuredDisplay) {
    return undefined;
  }

  return {
    type: prosodyType,
    ...(position !== null ? { position } : {}),
    ...(configuredDisplay ? { display: configuredDisplay } : {}),
    raw: value,
  };
}

export function extractProsodyDataForReading(
  value: unknown,
  languageData: LanguageData | null | undefined,
  readingMatches: (reading: string) => boolean,
): FlashcardProsody | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const prosody = extractProsodyDataForReading(item, languageData, readingMatches);
      if (prosody) return prosody;
    }
    return undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const reading = extractReadingValue(value, languageData);
  const prosody = extractProsodyData(value, languageData);
  if (prosody && reading && readingMatches(reading)) {
    return prosody;
  }

  for (const child of Object.values(value)) {
    const childProsody = extractProsodyDataForReading(child, languageData, readingMatches);
    if (childProsody) return childProsody;
  }

  return undefined;
}

export function extractProsodyPositionFromProsody(prosody: FlashcardProsody | undefined): number | undefined {
  return prosody?.position;
}

export function extractReadingValue(value: unknown, languageData?: LanguageData | null): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const reading = extractReadingValue(item, languageData);
      if (reading) {
        return reading;
      }
    }
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const configuredReading = extractStringAtPath(value, languageData?.runtime?.nlp?.dictionary?.readingPath);
  if (configuredReading) {
    return configuredReading;
  }

  if (typeof value.reading === 'string' && value.reading) {
    return value.reading;
  }

  for (const child of Object.values(value)) {
    const reading = extractReadingValue(child, languageData);
    if (reading) {
      return reading;
    }
  }

  return null;
}

function stripHtmlTags(raw: string): string {
  return raw.replace(/<[^>]*>/g, '').trim();
}

export function hasDefinition(value: unknown, languageData?: LanguageData | null): boolean {
  return extractFirstDefinition(value, languageData) !== null;
}

function cleanDefinitions(raw: string[], options?: DefinitionExtractionOptions): string[] {
  return raw
    .map((definition) => options?.stripHtml === false ? definition.trim() : stripHtmlTags(definition))
    .filter((definition) => definition.length > 0);
}

function collectDefinitions(
  record: Record<string, unknown>,
  languageData?: LanguageData | null,
  options?: DefinitionExtractionOptions,
): string[] {
  const configured = extractStringListAtPath(record, languageData?.runtime?.nlp?.dictionary?.definitionsPath);
  if (configured.length > 0) {
    return cleanDefinitions(configured, options);
  }

  const definitions = record.definitions;
  if (!definitions) return [];

  const raw: string[] = [];
  if (typeof definitions === 'string') {
    raw.push(definitions);
  } else if (Array.isArray(definitions)) {
    for (const item of definitions) {
      if (typeof item === 'string') raw.push(item);
    }
  }

  return cleanDefinitions(raw, options);
}

export function extractDefinitionValues(
  value: unknown,
  languageData?: LanguageData | null,
  options?: DefinitionExtractionOptions,
): string[] {
  if (Array.isArray(value)) {
    for (const item of value) {
      const defs = extractDefinitionValues(item, languageData, options);
      if (defs.length > 0) return defs;
    }
    return [];
  }

  if (!isRecord(value)) {
    return [];
  }

  const direct = collectDefinitions(value, languageData, options);
  if (direct.length > 0) return direct;

  for (const child of Object.values(value)) {
    const defs = extractDefinitionValues(child, languageData, options);
    if (defs.length > 0) return defs;
  }

  return [];
}

export function extractFirstDefinition(value: unknown, languageData?: LanguageData | null): string | null {
  return extractDefinitionValues(value, languageData)[0] ?? null;
}
