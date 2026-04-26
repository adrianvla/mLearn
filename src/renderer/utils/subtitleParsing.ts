/**
 * Subtitle Parsing Utilities
 * Handles furigana extraction and subtitle processing
 *
 * NOTE: This is simplified - we no longer store/parse character names.
 * Parentheses are only used for temporary reading overrides in the current subtitle.
 */

import {
  containsKanji,
  isAllKana,
  normalizeReading,
} from '../../shared/utils/textUtils';
import type { Token } from '../../shared/types';

// ============================================================================
// Types
// ============================================================================

export interface ParsedSubtitle {
  /** The subtitle text (optionally cleaned) */
  text: string;
  /** Whether furigana annotations were found in the text */
  hasFurigana: boolean;
}

export interface FuriganaSegment {
  /** The kanji/base text */
  text: string;
  /** The reading (furigana) if available */
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
 * Format: 漢字(かんじ) - the parentheses provide a temporary reading
 * This reading is used for the current subtitle only, not stored permanently.
 *
 * @returns The cleaned text and any reading overrides found
 */
export function parseSubtitle(text: string, language: string): {
  text: string;
  readingOverrides: ReadingOverride[];
} {
  if (!text) {
    return { text: '', readingOverrides: [] };
  }

  const readingOverrides: ReadingOverride[] = [];

  // Pattern: word(reading) - captures the word before parens and reading inside
  // Handles both ASCII and Japanese parentheses
  const furiganaPattern = /([^\s(（]+)\(([^)）]+)\)|([^\s(（]+)（([^)）]+)）/g;

  let match;
  while ((match = furiganaPattern.exec(text)) !== null) {
    const word = match[1] || match[3];
    const reading = match[2] || match[4];
    if (word && reading && containsKanji(word)) {
      readingOverrides.push({ word, reading });
    }
  }

  const shouldStripReadingParentheses = language === 'ja';

  let cleanedText = text;
  if (shouldStripReadingParentheses) {
    cleanedText = text
      .replace(/([^\s(（]+)\([^)）]+\)/g, '$1')
      .replace(/([^\s(（]+)（[^)）]+）/g, '$1');
  }

  return {
    text: cleanedText,
    readingOverrides,
  };
}

/**
 * Extract furigana annotations from text
 * Handles patterns like: 百夜(ひゃくや)優一郎(ゆういちろう)
 *
 * @returns Array of segments with text and optional reading
 */
export function extractFurigana(text: string): FuriganaSegment[] {
  if (!text) return [];

  const segments: FuriganaSegment[] = [];

  // Pattern: kanji(reading) or text without parentheses
  const regex = /([^(（\s]+)\(([^)）]+)\)|([^(（\s]+)（([^)）]+)）|([^(（\s]+)/g;

  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match[1] && match[2]) {
      // Kanji with ASCII-paren furigana
      segments.push({
        text: match[1],
        reading: match[2],
      });
    } else if (match[3] && match[4]) {
      // Kanji with JP-paren furigana
      segments.push({
        text: match[3],
        reading: match[4],
      });
    } else if (match[5]) {
      // Text without furigana
      segments.push({
        text: match[5],
      });
    }
  }

  return segments;
}

/**
 * Build furigana ruby HTML from segments
 */
export function buildFuriganaHtml(segments: FuriganaSegment[]): string {
  return segments.map(segment => {
    if (segment.reading) {
      return `<ruby>${segment.text}<rt>${segment.reading}</rt></ruby>`;
    }
    return segment.text;
  }).join('');
}

// ============================================================================
// Re-export shared text utilities for backwards compatibility
// ============================================================================

export { containsKanji, isAllKana, normalizeReading, escapeHtml, stripFurigana } from '../../shared/utils/textUtils';

/**
 * Extract only the kana reading from a translation entry
 * This is for the LiveWordTranslator which should show only kana, not kanji with ruby
 *
 * Handles multiple formats:
 * - Plain kana: "かんじ" -> "かんじ"
 * - Ruby markup: "<ruby>漢字<rt>かんじ</rt></ruby>" -> "かんじ"
 * - Mixed content: "漢字かな" -> extracts only kana portions
 */
export function extractKanaReading(reading: string | undefined): string {
  if (!reading) return '';

  // First try to extract from ruby <rt> tags - this is the most reliable
  const rtMatches = reading.match(/<rt>([^<]+)<\/rt>/g);
  if (rtMatches && rtMatches.length > 0) {
    // Extract content from all <rt> tags and join
    return rtMatches
        .map(m => m.replace(/<\/?rt>/g, ''))
        .join('');
  }

  // Remove HTML tags and normalize
  let normalized = normalizeReading(reading);

  // If the reading is already all kana, return it
  if (isAllKana(normalized)) return normalized;

  // Try to extract just the kana characters
  const kanaOnly = normalized.replace(/[^\u3040-\u309f\u30a0-\u30ff]/g, '');
  if (kanaOnly) return kanaOnly;

  return normalized;
}

export function shouldRemoveParentheticalContent(language: string): boolean {
  return language === 'ja';
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
export function parseWorkName(name: string): string {
  if (!name) return '';

  // Step 1: Remove only short extensions (like .srt, .ass, .sub, .pdf, .cbz, .cbr)
  let cleaned = name.replace(/\.[^.]{1,4}$/, '');

  // Step 2: Normalize separators (replace . and _ with spaces)
  cleaned = cleaned.replace(/[._]/g, ' ');

  // Step 3: Remove junk tags (common release tags, codecs, sources, etc.)
  cleaned = cleaned.replace(/\b(WEBRip|BluRay|HDTV|Netflix|AMZN|x264|x265|HEVC|AVC|AAC|DDP|1080p|720p|480p|2160p|4K|Subtitles|REPACK|PROPER|WEB-DL|BDRip|DVDRip|HDRip)\b/gi, '');

  // Step 4: Keep season/episode identifiers like S01E02 intact
  // Normalize "S01E02" to "S01E2" (remove leading 0 in episode number)
  cleaned = cleaned.replace(/S(\d{1,2})E0?(\d{1,2})/gi, (_m, s, e) => `S${s}E${parseInt(e)}`);

  // Step 5: Remove common language codes as standalone words
  cleaned = cleaned.replace(/\b(ja|en|fr|es|de|it|pt|ru|zh|ko|jpn|eng|jap|deu|fra|spa|ita|por|rus|kor|chi)\b/gi, '');

  // Step 6: Remove bracketed/parenthesized junk (e.g. [720p], (BD), {WEB})
  cleaned = cleaned.replace(/\[[^\]]*\]|\{[^}]*\}|\([^)]*\)/g, '');

  // Step 7: Collapse multiple spaces, trim
  return cleaned.replace(/ {2,}/g, ' ').trim();
}
