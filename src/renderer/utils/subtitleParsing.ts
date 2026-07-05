/**
 * Subtitle Parsing Utilities
 * Handles temporary reading-annotation extraction and subtitle processing.
 *
 * NOTE: This is simplified - we no longer store/parse character names.
 * Parentheses are only used for temporary reading overrides in the current subtitle.
 */

import {
  findConfiguredParentheticalReadings,
  getReadingExtraCharacters,
  isTextOnlyInScripts,
  normalizeReading,
  replaceConfiguredParentheticalReadings,
} from '../../shared/utils/textUtils';
import { getResolvedScriptProfile, hasLettersInAnyScript, hasLettersInScript, normalizeScriptCodes } from '../../shared/languageScriptProfile';
import { getReadingAnnotationScripts, getReadingJoinSeparator, getReadingScripts } from '../../shared/languageFeatures';
import type { LanguageData, Token } from '../../shared/types';

// ============================================================================
// Types
// ============================================================================

export interface ParsedSubtitle {
  /** The subtitle text (optionally cleaned) */
  text: string;
  /** Whether reading annotations were found in the text. */
  hasReadingAnnotations: boolean;
}

export interface ReadingAnnotationSegment {
  /** The base text */
  text: string;
  /** The reading if available */
  reading?: string;
}

export interface ReadingOverride {
  /** The word/text to override */
  word: string;
  /** The reading to use */
  reading: string;
}

// ============================================================================
// Subtitle Parsing
// ============================================================================

/**
 * Parse a subtitle line to extract any temporary reading overrides from parentheses
 *
 * Format: word(reading) - the parentheses provide a temporary reading
 * This reading is used for the current subtitle only, not stored permanently.
 *
 * @returns The cleaned text and any reading overrides found
 */
function usesReadingOverrideParentheses(language: string, data?: LanguageData | null): boolean {
  void language;
  const config = data?.textProcessing?.readingAnnotation;
  if (typeof config?.stripParentheticalReadings === 'boolean') {
    return config.stripParentheticalReadings;
  }

  return false;
}

function replaceValidParentheticalReadings(
  text: string,
  surfaceScripts: readonly string[],
  readingScripts: readonly string[],
  readingExtraCharacters: readonly string[],
): string {
  if (surfaceScripts.length === 0 || readingScripts.length === 0) return text;

  return text.replace(
    /([^\s(（]+)\(([^)）]+)\)|([^\s(（]+)（([^)）]+)）/g,
    (raw: string, asciiWord: string | undefined, asciiReading: string | undefined, fullWidthWord: string | undefined, fullWidthReading: string | undefined) => {
      const word = asciiWord || fullWidthWord || '';
      const reading = asciiReading || fullWidthReading || '';
      return word
        && reading
        && hasLettersInAnyScript(word, surfaceScripts)
        && isTextOnlyInScripts(reading, readingScripts, readingExtraCharacters)
        ? word
        : raw;
    },
  );
}

export function parseSubtitle(text: string, language: string, data?: LanguageData | null): {
  text: string;
  readingOverrides: ReadingOverride[];
} {
  if (!text) {
    return { text: '', readingOverrides: [] };
  }

  const readingOverrides: ReadingOverride[] = [];

  const shouldStripReadingParentheses = usesReadingOverrideParentheses(language, data);
  const configuredReadingMatches = findConfiguredParentheticalReadings(text, data);
  for (const match of configuredReadingMatches) {
    readingOverrides.push({ word: match.word, reading: match.reading });
  }

  const configuredReadingScripts = getReadingAnnotationScripts(data);
  const readingAnnotationScripts = configuredReadingScripts.length > 0
    ? configuredReadingScripts
    : [];
  const configuredReadingOverrideScripts = getReadingScripts(data);
  const readingOverrideScripts = configuredReadingOverrideScripts.length > 0
    ? configuredReadingOverrideScripts
    : [];
  const readingExtraCharacters = getReadingExtraCharacters(data);

  // Pattern: word(reading) - captures the word before parens and reading inside.
  const readingPattern = /([^\s(（]+)\(([^)）]+)\)|([^\s(（]+)（([^)）]+)）/g;

  if (configuredReadingMatches.length === 0) {
    let match;
    while ((match = readingPattern.exec(text)) !== null) {
      const word = match[1] || match[3];
      const reading = match[2] || match[4];
      if (
        word
        && reading
        && hasLettersInAnyScript(word, readingAnnotationScripts)
        && isTextOnlyInScripts(reading, readingOverrideScripts, readingExtraCharacters)
      ) {
        readingOverrides.push({ word, reading });
      }
    }
  }

  let cleanedText = text;
  if (shouldStripReadingParentheses) {
    const metadataCleanedText = replaceConfiguredParentheticalReadings(text, data, 'surface');
    cleanedText = metadataCleanedText !== text
      ? metadataCleanedText
      : replaceValidParentheticalReadings(text, readingAnnotationScripts, readingOverrideScripts, readingExtraCharacters);
  }

  return {
    text: cleanedText,
    readingOverrides,
  };
}

/**
 * Extract reading annotations from text
 * Handles patterns like: 百夜(ひゃくや)優一郎(ゆういちろう)
 *
 * @returns Array of segments with text and optional reading
 */
export function extractReadingAnnotations(text: string, data?: LanguageData | null): ReadingAnnotationSegment[] {
  if (!text) return [];

  const segments: ReadingAnnotationSegment[] = [];
  const matches = findConfiguredParentheticalReadings(text, data);

  if (matches.length === 0) {
    return [{ text }];
  }

  let cursor = 0;
  for (const match of matches) {
    if (match.index > cursor) {
      segments.push({ text: text.slice(cursor, match.index) });
    }
    segments.push({ text: match.word, reading: match.reading });
    cursor = match.index + match.raw.length;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor) });
  }
  return segments;
}

/**
 * Build ruby HTML from reading annotation segments.
 */
export function buildReadingAnnotationHtml(segments: ReadingAnnotationSegment[]): string {
  return segments.map(segment => {
    if (segment.reading) {
      return `<ruby>${segment.text}<rt>${segment.reading}</rt></ruby>`;
    }
    return segment.text;
  }).join('');
}

export { containsHanCharacters, normalizeReading, escapeHtml, stripRubyAnnotations } from '../../shared/utils/textUtils';

function cleanReadingMarkup(reading: string, preserveSpaces: boolean): string {
  const markerIdx = reading.indexOf('<!-- accent_start -->');
  const withoutAccent = markerIdx === -1 ? reading : reading.substring(0, markerIdx);
  const withoutTags = withoutAccent.replace(/<[^>]*>/g, '');
  const normalizedSpaces = withoutTags.replace(/\u00a0/g, ' ').trim();
  return preserveSpaces ? normalizedSpaces.replace(/\s+/g, ' ') : normalizedSpaces.replace(/\s+/g, '');
}

function extractTextInScripts(
  text: string,
  scripts: readonly string[],
  extraCharacters: readonly string[] = [],
): string {
  let result = '';
  let sawReadingLetter = false;
  const chars = Array.from(text);
  const extraCharacterSet = new Set(extraCharacters);

  const hasUpcomingReadingLetter = (start: number): boolean => {
    for (let i = start; i < chars.length; i += 1) {
      const char = chars[i];
      if (/\p{L}/u.test(char)) {
        return hasLettersInAnyScript(char, scripts);
      }
    }
    return false;
  };

  chars.forEach((char, index) => {
    if (/\p{L}/u.test(char)) {
      if (hasLettersInAnyScript(char, scripts)) {
        result += char;
        sawReadingLetter = true;
      } else if (extraCharacterSet.has(char)) {
        result += char;
      }
      return;
    }

    if ((sawReadingLetter || hasUpcomingReadingLetter(index + 1)) && /[\p{N}\p{M}\s'’.\-]/u.test(char)) {
      result += char;
    }
  });

  return result.replace(/\s+/g, ' ').trim();
}

/**
 * Extract the display reading from a translation entry.
 * Ruby <rt> content is preferred when present.
 *
 * Handles multiple formats:
 * - Plain reading: "かんじ" -> "かんじ"
 * - Ruby markup: "<ruby>漢字<rt>かんじ</rt></ruby>" -> "かんじ"
 * - Mixed script readings when configured by language metadata
 * - Metadata-driven readings: "你好 ni hao" -> extracts configured reading scripts
 */
export function extractDisplayReading(reading: string | undefined, data?: LanguageData | null): string {
  if (!reading) return '';

  // First try to extract from ruby <rt> tags - this is the most reliable
  const rtMatches = reading.match(/<rt>([^<]+)<\/rt>/g);
  if (rtMatches && rtMatches.length > 0) {
    // Extract content from all <rt> tags and join using the language's reading separator.
    return rtMatches
        .map(m => m.replace(/<\/?rt>/g, ''))
        .join(getReadingJoinSeparator(data));
  }

  const readingScripts = getReadingScripts(data);
  const readingExtraCharacters = getReadingExtraCharacters(data);
  if (readingScripts.length > 0) {
    const cleaned = cleanReadingMarkup(reading, true);
    if (isTextOnlyInScripts(cleaned, readingScripts, readingExtraCharacters)) return cleaned;

    const extracted = extractTextInScripts(cleaned, readingScripts, readingExtraCharacters);
    if (extracted) return extracted;

    return cleaned;
  }

  // Remove HTML tags and normalize. Installed language packages must declare
  // their reading scripts instead of inheriting language-specific extraction.
  const normalized = normalizeReading(reading, data);

  return normalized;
}

export function shouldRemoveParentheticalContent(language: string, data?: LanguageData | null): boolean {
  return usesReadingOverrideParentheses(language, data);
}

function isSpeakerLabelCandidate(label: string, language: string, data?: LanguageData | null): boolean {
  const trimmed = label.trim();
  if (!trimmed || !/\p{L}/u.test(trimmed)) return false;

  const config = data?.textProcessing?.subtitle?.speakerNamePrefix;
  if (config?.enabled === false) return false;

  const maxCodePoints = config?.maxCodePoints ?? 40;
  if (Array.from(trimmed).length > maxCodePoints) return false;

  // Keep this intentionally name-like. It prevents stripping regular sentences
  // that merely happen to contain a colon.
  if (!/^[\p{L}\p{M}\p{N}\s.'’_\-・·ー]+$/u.test(trimmed)) return false;
  if (trimmed.split(/\s+/).filter(Boolean).length > 4) return false;

  const configuredScripts = normalizeScriptCodes(config?.scripts);
  const scripts = configuredScripts.length > 0
    ? configuredScripts
    : getResolvedScriptProfile(language, data).acceptedScripts;
  if (scripts.length === 0) return true;
  if (hasLettersInAnyScript(trimmed, scripts)) return true;

  const allowLatinFallback = config?.allowLatinFallback === true;
  return allowLatinFallback && hasLettersInScript(trimmed, 'Latn');
}

function escapeRegexChar(char: string): string {
  return char.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

export function stripSpeakerNamePrefixes(text: string, language: string, data?: LanguageData | null): string {
  if (!text) return '';

  const delimiters = data?.textProcessing?.subtitle?.speakerNamePrefix?.delimiters ?? [':', '：'];
  const delimiterPattern = delimiters.length > 0
    ? delimiters.map(escapeRegexChar).join('')
    : ':：';
  const speakerPrefixPattern = new RegExp(`^([^\\n${delimiterPattern}]{1,80})([${delimiterPattern}])([ \\t]*)`, 'gmu');

  return text.replace(speakerPrefixPattern, (match, label: string, delimiter: string, _spacing: string, offset: number, fullText: string) => {
    const afterDelimiter = fullText.slice(offset + match.length, offset + match.length + 2);
    if (delimiter === ':' && afterDelimiter === '//') return match;
    return isSpeakerLabelCandidate(label, language, data) ? '' : match;
  });
}

// ============================================================================
// Token Coloring
// ============================================================================

/** @deprecated Use Token from shared/types instead */
export type ColorToken = Token;

// Re-export tokensToColoredHtml from phraseExtraction to avoid duplication
// All phrase-related utilities are now centralized in phraseExtraction.ts
export { tokensToColoredHtml, cleanContextPhrase, formatForClipboard } from './phraseExtraction';

// ============================================================================
// Work Name Parsing
// ============================================================================

/**
 * Parse and clean a work name (manga/book/video title) from filename or folder name.
 * Strips common release tags, codecs, sources, language codes, and bracketed junk.
 * Preserves season/episode identifiers like S01E02.
 *
 * @param name The raw filename or folder name
 * @returns Cleaned, human-readable title
 */
export interface ParseWorkNameOptions {
  languageCodes?: readonly string[];
  releaseTags?: readonly string[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeStandaloneTags(tags: readonly string[] | undefined): string[] {
  if (!tags) return [];
  const normalized: string[] = [];
  for (const tag of tags) {
    const cleaned = tag.trim();
    if (!/^[\p{L}\p{N}_-]{2,16}$/u.test(cleaned)) continue;
    if (!normalized.some((item) => item.toLowerCase() === cleaned.toLowerCase())) {
      normalized.push(cleaned);
    }
  }
  return normalized;
}

function normalizeStandaloneLanguageTags(tags: readonly string[] | undefined): string[] {
  if (!tags) return [];
  const normalized: string[] = [];
  const add = (tag: string) => {
    const cleaned = tag.trim();
    if (!/^[\p{L}\p{N}_ -]{2,32}$/u.test(cleaned)) return;
    if (!normalized.some((item) => item.toLowerCase() === cleaned.toLowerCase())) {
      normalized.push(cleaned);
    }
  };

  for (const tag of tags) {
    const cleaned = tag.trim();
    if (!/^[\p{L}\p{N}_-]{2,32}$/u.test(cleaned)) continue;
    add(cleaned);

    const parts = cleaned.split(/[-_]+/).filter(Boolean);
    if (parts.length > 1) {
      add(parts.join(' '));
      for (const part of parts) add(part);
    }
  }

  return normalized;
}

function stripTrailingLanguageTag(value: string): string {
  // After separator normalization, common subtitle suffixes look like:
  //   Show S01E1 fa IR
  //   Drama zh Hant
  //   Movie jpn
  // Keep this trailing-only so title words elsewhere are not stripped.
  return value.replace(
    /(?:^|\s)[a-z]{2,3}(?:\s+(?:[A-Z][a-z]{3}|[A-Z]{2}|\d{3}|[a-z]{2,3})){0,2}$/u,
    '',
  );
}

export function parseWorkName(name: string, options: ParseWorkNameOptions = {}): string {
  if (!name) return '';

  // Step 0: Strip any directory path (handle both / and \ separators)
  // This is critical on Windows where dragged file names can include the full
  // path like C:\Users\...\filename.ext
  let cleaned = name.replace(/^.*[/\\]/, '');

  // Step 1: Remove only short extensions (like .srt, .ass, .sub, .pdf, .cbz, .cbr, .mkv, .mp4)
  cleaned = cleaned.replace(/\.[^.]{1,4}$/, '');

  // Step 2: Remove dot-separated codec versions (e.g. DDP2.0, AAC5.1) before normalizing dots
  cleaned = cleaned.replace(/\b(DDP|AAC|DD\+)\d+(?:\.\d+)?\b/gi, '');

  // Step 3: Normalize separators (replace . and _ with spaces)
  cleaned = cleaned.replace(/[._]/g, ' ');

  // Step 4: Remove junk tags (common release tags, codecs, sources, etc.)
  const releaseTags = [
    'WEBRip', 'BluRay', 'HDTV', 'Netflix', 'AMZN', 'NF', 'HBO', 'HMAX', 'DSNP', 'DSNY', 'HULU', 'APTV', 'PCOK', 'PMTP',
    'x264', 'x265', 'h264', 'h265', 'HEVC', 'AVC', 'AC3', 'EAC3', 'FLAC', 'TRUEHD', 'DTS-HD', 'DTS', 'MP3',
    '1080p', '720p', '480p', '2160p', '4K', 'UHD', 'FHD', 'HD', 'SD',
    'Subtitles', 'SUBBED', 'DUBBED', 'REPACK', 'PROPER', 'READNFO', 'INTERNAL', 'LIMITED',
    'WEB-DL', 'BDRip', 'DVDRip', 'HDRip', 'WEB',
    ...normalizeStandaloneTags(options.releaseTags),
  ];
  cleaned = cleaned.replace(new RegExp(`\\b(?:${releaseTags.map(escapeRegExp).join('|')})\\b`, 'gi'), '');

  // Step 5: Keep season/episode identifiers like S01E02 intact
  // Normalize "S01E02" to "S01E2" (remove leading 0 in episode number)
  cleaned = cleaned.replace(/S(\d{1,2})E0?(\d{1,2})/gi, (_m, s, e) => `S${s}E${parseInt(e)}`);

  // Step 6: Remove language tags. Runtime callers pass installed language codes,
  // while the generic trailing fallback keeps third-party catalogs from requiring
  // code changes for every new BCP-47 language/script/region tag.
  const languageTags = normalizeStandaloneLanguageTags(options.languageCodes);
  if (languageTags.length > 0) {
    cleaned = cleaned.replace(new RegExp(`\\b(?:${languageTags.map(escapeRegExp).join('|')})\\b`, 'gi'), '');
  }
  cleaned = stripTrailingLanguageTag(cleaned);

  // Step 7: Remove bracketed/parenthesized junk (e.g. [720p], (BD), {WEB})
  cleaned = cleaned.replace(/\[[^\]]*\]|\{[^}]*\}|\([^)]*\)/g, '');

  // Step 8: Collapse multiple spaces, trim
  cleaned = cleaned.replace(/ {2,}/g, ' ').trim();

  // Step 9: Strip orphaned leading/trailing hyphens or punctuation artifacts
  cleaned = cleaned.replace(/(^[-–—]+|[-–—]+$)/g, '');

  // Final trim after hyphen removal
  return cleaned.trim();
}
