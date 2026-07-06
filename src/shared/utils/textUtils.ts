import { getLogger } from './logger';
import type { LanguageData } from '../types';
import {
  getLanguageDisplayName as getLanguageDisplayNameFromProfile,
  getResolvedScriptProfile,
  hasLettersInAnyScript,
  hasOnlyLettersInScripts,
  isValidSttResultForProfile,
  isWordInLanguageProfile,
} from '../languageScriptProfile';

const log = getLogger("shared.utils.textUtils");
/**
 * Shared Text Utilities
 * Centralized functions for text processing across languages
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * Regex to match Latin letter characters (Basic + Extended-A/B + supplements)
 */
const LATIN_LETTER_REGEX = /[\u0041-\u005A\u0061-\u007A\u00C0-\u024F\u1E00-\u1EFF]/;

/**
 * Regex to detect Han ideographs (CJK Unified Ideographs).
 * Covers: CJK Extension A, CJK Unified Ideographs, CJK Compatibility Ideographs.
 */
export const HAN_IDEOGRAPH_REGEX = /[\u3400-\u9FFF\uF900-\uFAFF]/;

const COMPACT_READING_SCRIPTS = ['Hira', 'Kana', 'Bopo'];
const DEFAULT_STRIPPED_FORMAT_CHARACTERS = new Set(['\u200B', '\u200C', '\u200D', '\uFEFF']);

function getReadingSeparatorFromMetadata(data?: LanguageData | null): string {
  const configured = data?.textProcessing?.readingAnnotation?.readingSeparator;
  if (typeof configured === 'string') return configured;

  const readingScripts = data?.textProcessing?.lexemeNormalization?.readingScripts ?? [];
  if (readingScripts.length === 0) return '';
  return readingScripts.every((script) => COMPACT_READING_SCRIPTS.includes(script)) ? '' : ' ';
}

function getTokenizerPreservedFormatCharacters(data?: LanguageData | null): Set<string> {
  const tokenizer = data?.runtime?.nlp?.tokenizer;
  const configured = [
    ...(Array.isArray(tokenizer?.extraTokenCharacters) ? tokenizer.extraTokenCharacters : []),
    ...(Array.isArray(tokenizer?.innerTokenCharacters) ? tokenizer.innerTokenCharacters : []),
  ];
  return new Set(
    configured.filter((char) => typeof char === 'string' && Array.from(char).length === 1),
  );
}

function stripIgnorableFormatCharacters(text: string, data?: LanguageData | null): string {
  const preserved = getTokenizerPreservedFormatCharacters(data);
  return Array.from(text)
    .filter((char) => !DEFAULT_STRIPPED_FORMAT_CHARACTERS.has(char) || preserved.has(char))
    .join('');
}

// ============================================================================
// Text Detection Functions
// ============================================================================

/**
 * Check if text contains any Han ideographs.
 */
export function containsHanCharacters(text: string): boolean {
  if (!text) return false;
  return HAN_IDEOGRAPH_REGEX.test(text);
}

function normalizeSingleCodePointCharacters(characters: readonly string[] | undefined): string[] {
  if (!Array.isArray(characters)) return [];
  const normalized: string[] = [];
  for (const character of characters) {
    if (typeof character !== 'string') continue;
    const chars = Array.from(character);
    if (chars.length !== 1) continue;
    if (!normalized.includes(chars[0])) normalized.push(chars[0]);
  }
  return normalized;
}

export function getReadingExtraCharacters(data?: LanguageData | null): string[] {
  return normalizeSingleCodePointCharacters(data?.textProcessing?.lexemeNormalization?.readingExtraCharacters);
}

/**
 * Check if all letter characters in text belong to the configured scripts.
 * Non-letter characters such as spaces, punctuation, and tone numbers are allowed.
 */
export function isTextOnlyInScripts(
  text: string,
  scripts: readonly string[],
  extraCharacters: readonly string[] = [],
): boolean {
  const allowedExtra = new Set(normalizeSingleCodePointCharacters(extraCharacters));
  if (allowedExtra.size === 0) {
    return hasOnlyLettersInScripts(text, scripts);
  }

  let sawScriptLetter = false;
  for (const char of text) {
    if (allowedExtra.has(char)) continue;
    if (!/\p{L}/u.test(char)) continue;
    if (!hasLettersInAnyScript(char, scripts)) return false;
    sawScriptLetter = true;
  }

  return sawScriptLetter;
}

/**
 * Convert katakana characters to hiragana.
 * Non-katakana characters (including hiragana) are passed through unchanged.
 */
export function katakanaToHiragana(text: string): string {
  if (!text) return '';
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const cp = text.charCodeAt(i);
    // Katakana range ァ(0x30A1)–ヶ(0x30F6) → shift to hiragana
    if (cp >= 0x30A1 && cp <= 0x30F6) {
      result += String.fromCharCode(cp - 0x60);
    } else {
      result += text[i];
    }
  }
  return result;
}

/**
 * Extract distinct Han ideographs from text.
 * Returns a Set of unique characters in the CJK Unified Ideographs /
 * CJK Compatibility Ideographs ranges.
 */
export function extractHanCharacters(text: string): Set<string> {
  const result = new Set<string>();
  if (!text) return result;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if ((cp >= 0x3400 && cp <= 0x9FFF) || (cp >= 0xF900 && cp <= 0xFAFF)) {
      result.add(ch);
    }
  }
  return result;
}

/**
 * Check if text is composed entirely of Latin-script characters,
 * digits, punctuation, and whitespace — i.e. no non-Latin letters.
 * Used to detect when a user typed romanized / English text in a
 * non-Latin language session.
 */
export function isLatinOnly(text: string): boolean {
  if (!text.trim()) return false;
  // Check every character: allow Latin letters, digits, ASCII punctuation,
  // common symbols, and whitespace. Reject if any non-Latin letter is found.
  for (const char of text) {
    const code = char.codePointAt(0)!;
    // ASCII printable + common Latin Extended ranges
    if (code <= 0x024F) continue;
    // Latin Extended Additional
    if (code >= 0x1E00 && code <= 0x1EFF) continue;
    // General punctuation, currency symbols, etc.
    if (code >= 0x2000 && code <= 0x206F) continue;
    // Non-Latin character found
    return false;
  }
  // Must contain at least one letter (not just numbers/punctuation)
  return LATIN_LETTER_REGEX.test(text);
}

// ============================================================================
// Text Normalization Functions
// ============================================================================

/**
 * Check whether a word contains at least one character belonging to the scripts
 * used by the given language. Useful for filtering out OCR garbage / tokenizer
 * artifacts that are written in an entirely foreign script.
 *
 * Returns `true` if the word contains letters appropriate for the language,
 * or `false` if it consists entirely of characters from unrelated scripts.
 * Words that are purely numeric or punctuation return `false`.
 */
export function isWordInLanguageScript(word: string, language: string, data?: LanguageData | null): boolean {
  return isWordInLanguageProfile(word, getResolvedScriptProfile(language, data));
}

// ============================================================================
// STT Script Validation
// ============================================================================

/**
 * Validate an STT transcription result against the target language.
 * Returns true if the result appears to be valid speech in the target language,
 * false if it looks like noise or text in the wrong language/script.
 *
 * This filters garbage transcriptions from multilingual or wrong-language STT
 * models through the language script profile. Packages can declare exact noise
 * strings with textProcessing.scriptProfile.sttNoiseCharacters.
 */
export function isValidSTTResult(text: string, language: string, data?: LanguageData | null): boolean {
  return isValidSttResultForProfile(text, getResolvedScriptProfile(language, data));
}

/**
 * Normalize reading by removing HTML tags and accent markers
 * Used to extract clean reading text from formatted dictionary entries
 */
export function normalizeReading(raw: string, data?: LanguageData | null): string {
  if (typeof raw !== 'string') return '';
  let text = raw;
  
  // Remove accent markers
  const markerIdx = text.indexOf('<!-- accent_start -->');
  if (markerIdx !== -1) text = text.substring(0, markerIdx);
  
  // Strip HTML tags
  text = text.replace(/<[^>]*>/g, '');
  
  // Normalize whitespace
  text = text.replace(/\u00a0/g, ' ').trim();
  if (!data || getReadingSeparatorFromMetadata(data) === '') {
    return text.replace(/\s+/g, '');
  }
  return text.replace(/\s+/g, ' ');
}

/**
 * Normalize a word/expression for cache lookups without changing its meaning.
 * Keeps the spelling intact while removing formatting and Unicode variance.
 */
export function normalizeWordLookupText(raw: string, data?: LanguageData | null): string {
  if (typeof raw !== 'string') return '';

  let text = data ? stripReadingAnnotations(raw, data) : stripRubyAnnotations(raw);

  try {
    text = text.normalize('NFC');
  } catch (e) {
    log.error("error", e);
  }

  text = text
    .split('\n')
    .map((line) => stripIgnorableFormatCharacters(line, data))
    .join('\n')
    .replace(/\u00a0/g, ' ')
    .trim();

  return text;
}

/**
 * Escape HTML special characters for safe rendering
 */
export function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Strip ruby annotations from text without assuming a language-specific
 * parenthetical reading convention. Parenthetical readings are removed only by
 * stripReadingAnnotations when a language package opts into that behavior.
 */
export function stripRubyAnnotations(text: string): string {
  if (!text) return '';

  return stripRubyMarkup(text).trim();
}

function stripRubyMarkup(text: string): string {
  if (!text) return '';

  // Remove <rt>...</rt> tags and their content
  let result = text.replace(/<rt[^>]*>.*?<\/rt>/gi, '');

  // Remove <ruby> and </ruby> tags but keep content
  result = result.replace(/<\/?ruby>/gi, '');

  // Remove <rp> tags (ruby parentheses)
  result = result.replace(/<\/?rp>/gi, '');

  return result;
}

function configuredReadingAnnotationParts(data?: LanguageData | null): {
  surfaceScripts: string[];
  readingScripts: string[];
  readingExtraCharacters: string[];
  stripParentheticalReadings: boolean;
} | null {
  const readingAnnotation = data?.textProcessing?.readingAnnotation;
  const lexemeNormalization = data?.textProcessing?.lexemeNormalization;
  if (!data || !readingAnnotation || readingAnnotation.type === 'none') return null;

  const surfaceScripts = readingAnnotation.annotationScripts?.length
    ? readingAnnotation.annotationScripts
    : lexemeNormalization?.surfaceScripts ?? [];
  const readingScripts = lexemeNormalization?.readingScripts ?? [];

  if (surfaceScripts.length === 0 || readingScripts.length === 0) return null;
  return {
    surfaceScripts,
    readingScripts,
    readingExtraCharacters: getReadingExtraCharacters(data),
    stripParentheticalReadings: readingAnnotation?.stripParentheticalReadings === true,
  };
}

export interface ParentheticalReadingMatch {
  raw: string;
  word: string;
  reading: string;
  index: number;
}

export function findConfiguredParentheticalReadings(text: string, data?: LanguageData | null): ParentheticalReadingMatch[] {
  const config = configuredReadingAnnotationParts(data);
  if (!config) return [];

  const matches: ParentheticalReadingMatch[] = [];
  text.replace(
    /([^\s(（]+)\(([^)）]+)\)|([^\s(（]+)（([^)）]+)）/g,
    (raw: string, asciiWord: string | undefined, asciiReading: string | undefined, fullWidthWord: string | undefined, fullWidthReading: string | undefined, index: number) => {
      const word = asciiWord || fullWidthWord || '';
      const reading = asciiReading || fullWidthReading || '';
      if (
        word
        && reading
        && hasLettersInAnyScript(word, config.surfaceScripts)
        && isTextOnlyInScripts(reading, config.readingScripts, config.readingExtraCharacters)
      ) {
        matches.push({ raw, word, reading, index });
      }
      return raw;
    },
  );
  return matches;
}

export function replaceConfiguredParentheticalReadings(
  text: string,
  data: LanguageData | null | undefined,
  replacement: 'surface' | 'reading',
): string {
  const config = configuredReadingAnnotationParts(data);
  if (!config?.stripParentheticalReadings) return text;

  return text.replace(
    /([^\s(（]+)\(([^)）]+)\)|([^\s(（]+)（([^)）]+)）/g,
    (match, asciiWord: string | undefined, asciiReading: string | undefined, fullWidthWord: string | undefined, fullWidthReading: string | undefined) => {
      const word = asciiWord || fullWidthWord || '';
      const reading = asciiReading || fullWidthReading || '';
      if (
        word
        && reading
        && hasLettersInAnyScript(word, config.surfaceScripts)
        && isTextOnlyInScripts(reading, config.readingScripts, config.readingExtraCharacters)
      ) {
        return replacement === 'reading' ? reading : word;
      }
      return match;
    },
  );
}

/**
 * Strip ruby and metadata-configured parenthetical reading annotations.
 * Parenthetical readings require explicit language metadata.
 */
export function stripReadingAnnotations(text: string, data?: LanguageData | null): string {
  const stripped = stripRubyMarkup(text);
  return replaceConfiguredParentheticalReadings(stripped, data, 'surface').trim();
}

/**
 * Replace ruby-annotated text with their readings, stripping remaining HTML.
 * Used for "use readings" TTS mode.
 * Example: "<ruby>漢字<rt>かんじ</rt></ruby>です" -> "かんじです"
 */
export function applyRubyReadings(text: string, data?: LanguageData | null): string {
  if (!text) return '';

  const readingSeparator = getReadingSeparatorFromMetadata(data);
  const rubyPattern = /<ruby[^>]*>([\s\S]*?)<\/ruby>/gi;
  let result = '';
  let lastIndex = 0;
  let previousWasReading = false;
  let match: RegExpExecArray | null;

  while ((match = rubyPattern.exec(text)) !== null) {
    const between = text.slice(lastIndex, match.index);
    if (between) {
      result += between;
      if (between.trim()) previousWasReading = false;
    }

    const inner = match[1] ?? '';
    const rtMatch = inner.match(/<rt[^>]*>([\s\S]*?)<\/rt>/i);
    const reading = rtMatch ? rtMatch[1] : inner.replace(/<[^>]*>/g, '');
    if (previousWasReading && readingSeparator) {
      result += readingSeparator;
    }
    result += reading;
    previousWasReading = true;
    lastIndex = rubyPattern.lastIndex;
  }

  result += text.slice(lastIndex);

  result = data ? replaceConfiguredParentheticalReadings(result, data, 'reading') : stripRubyAnnotations(result);

  // Strip any remaining HTML tags
  result = result.replace(/<[^>]*>/g, '');
  return result.trim();
}

/**
 * Strip all HTML from text for TTS consumption.
 * Handles ruby annotations based on `useReadings`:
 *   - true:  replace annotated base text with <rt> readings, then strip remaining HTML
 *   - false: remove <rt> readings, keep base text, then strip remaining HTML
 */
export function stripHtmlForTts(text: string, useReadings = false, data?: LanguageData | null): string {
  if (!text) return '';
  if (useReadings) return applyRubyReadings(text, data);

  // Remove readings first (preserving base text), then strip all remaining tags
  let result = data ? stripReadingAnnotations(text, data) : stripRubyAnnotations(text);
  result = result.replace(/<[^>]*>/g, '');
  return result.trim();
}

/**
 * Limit consecutive dots/periods to a maximum count.
 * Handles ASCII `.`, fullwidth `．`, and ellipsis `…` (expanded to 3 dots first).
 * Prevents TTS backend failures caused by long runs of punctuation.
 */
export function limitConsecutiveDots(text: string, max = 3): string {
  if (!text) return '';
  // Expand ellipsis characters into 3 dots so the regex below can normalize them
  let result = text.replace(/…/g, '...');
  // Collapse runs of ASCII dot and fullwidth dot to at most `max`
  const pattern = new RegExp(`[.．]{${max + 1},}`, 'g');
  const replacement = '.'.repeat(max);
  result = result.replace(pattern, replacement);
  return result;
}

/**
 * Remove short bracketed reading/aside annotations before sending text to TTS.
 */
export function stripBracketedTtsAnnotations(text: string): string {
  if (!text) return '';
  return text
    .replace(/（[^（）]*）|\([^()]*\)|［[^［］]*］|\[[^\[\]]*\]/g, '')
    .replace(/\s+([,.!?。！？؟؛])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// ============================================================================
// Language Display Names
// ============================================================================

/** Map a language code to a display name for LLM prompts and UI copy. */
export function getLanguageDisplayName(code: string, data?: LanguageData | null, displayLocale?: string): string {
  return getLanguageDisplayNameFromProfile(code, data, displayLocale);
}
