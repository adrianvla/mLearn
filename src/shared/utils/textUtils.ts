/**
 * Shared Text Utilities
 * Centralized functions for Japanese text processing
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * Regex to detect kanji characters (CJK Unified Ideographs)
 * Covers: CJK Extension A, CJK Unified Ideographs, CJK Compatibility Ideographs
 */
export const KANJI_REGEX = /[\u3400-\u9FFF\uF900-\uFAFF]/;

/**
 * Regex to match strings containing only kana characters
 * Covers: Hiragana, Katakana, Katakana Phonetic Extensions
 */
export const KANA_ONLY_REGEX = /^[\u3040-\u309f\u30a0-\u30ff\u31f0-\u31ff\s]+$/;

/**
 * Regex to extract only kana characters from mixed text
 */
export const KANA_EXTRACT_REGEX = /[\u3040-\u309f\u30a0-\u30ff]/g;

/**
 * Small kana characters that follow the previous character's pitch in accent patterns
 */
export const SMALL_KANA = new Set([
  'ゃ', 'ゅ', 'ょ', 'ャ', 'ュ', 'ョ',
  'ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ', 'ァ', 'ィ', 'ゥ', 'ェ', 'ォ',
  'ゎ', 'ゕ', 'ゖ',
]);

// ============================================================================
// Text Detection Functions
// ============================================================================

/**
 * Check if text contains any kanji characters
 */
export function containsKanji(text: string): boolean {
  if (!text) return false;
  return KANJI_REGEX.test(text);
}

/**
 * Check if text is composed entirely of kana (hiragana/katakana)
 * Allows whitespace characters
 */
export function isAllKana(text: string): boolean {
  if (!text) return false;
  return KANA_ONLY_REGEX.test(text);
}

/**
 * Extract only kana characters from mixed text
 */
export function extractKana(text: string): string {
  if (!text) return '';
  const matches = text.match(KANA_EXTRACT_REGEX);
  return matches ? matches.join('') : '';
}

// ============================================================================
// Text Normalization Functions
// ============================================================================

/**
 * Normalize reading by removing HTML tags and accent markers
 * Used to extract clean reading text from formatted dictionary entries
 */
export function normalizeReading(raw: string): string {
  if (typeof raw !== 'string') return '';
  let text = raw;
  
  // Remove accent markers
  const markerIdx = text.indexOf('<!-- accent_start -->');
  if (markerIdx !== -1) text = text.substring(0, markerIdx);
  
  // Strip HTML tags
  text = text.replace(/<[^>]*>/g, '');
  
  // Normalize whitespace
  text = text.replace(/\u00a0/g, ' ').trim();
  return text.replace(/\s+/g, '');
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
 * Strip furigana (ruby) annotations from text
 * Example: "<ruby>主<rt>おも</rt></ruby>に" -> "主に"
 */
export function stripFurigana(text: string): string {
  if (!text) return '';
  
  // Remove <rt>...</rt> tags and their content
  let result = text.replace(/<rt[^>]*>.*?<\/rt>/gi, '');
  
  // Remove <ruby> and </ruby> tags but keep content
  result = result.replace(/<\/?ruby>/gi, '');
  
  // Remove <rp> tags (ruby parentheses)
  result = result.replace(/<\/?rp>/gi, '');
  
  // Remove parenthesized readings: 漢字(かんじ) -> 漢字
  result = result.replace(/\([ぁ-んァ-ン]+\)/g, '');
  result = result.replace(/（[ぁ-んァ-ン]+）/g, '');
  
  return result.trim();
}
