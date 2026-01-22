/**
 * Subtitle Parsing Utilities
 * Handles furigana extraction and subtitle processing
 * 
 * NOTE: This is simplified - we no longer store/parse character names.
 * Parentheses are only used for temporary reading overrides in the current subtitle.
 */

// ============================================================================
// Constants
// ============================================================================

// Kanji detection regex
const KANJI_REGEX = /[\u3400-\u9FFF\uF900-\uFAFF]/;
const KANA_REGEX = /^[\u3040-\u309f\u30a0-\u30ff\u31f0-\u31ff]+$/;

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
export function parseSubtitle(text: string, _language: string = 'ja'): {
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
  
  // Clean the text by removing the furigana annotations, keeping just the kanji
  // 漢字(かんじ) -> 漢字
  let cleanedText = text
    .replace(/([^\s(（]+)\([^)）]+\)/g, '$1')
    .replace(/([^\s(（]+)（[^)）]+）/g, '$1');
  
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
// Helper Functions
// ============================================================================

/**
 * Check if text contains kanji
 */
export function containsKanji(text: string): boolean {
  return KANJI_REGEX.test(text);
}

/**
 * Check if text is all kana (hiragana or katakana)
 */
export function isAllKana(text: string): boolean {
  if (!text) return false;
  return KANA_REGEX.test(text);
}

/**
 * Normalize reading by removing HTML and accent markers
 */
export function normalizeReading(raw: string): string {
  if (typeof raw !== 'string') return '';
  let text = raw;
  const markerIdx = text.indexOf('<!-- accent_start -->');
  if (markerIdx !== -1) text = text.substring(0, markerIdx);
  // Strip HTML tags
  text = text.replace(/<[^>]*>/g, '');
  text = text.replace(/\u00a0/g, ' ').trim();
  return text.replace(/\s+/g, '');
}

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

/**
 * Strip furigana from text to get clean kanji/text only
 * Used for OCR context phrase stitching where we don't want ruby readings
 * 
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

/**
 * Clean text for use as context phrase by stripping furigana and normalizing
 */
export function cleanContextPhrase(text: string): string {
  if (!text) return '';
  
  // Strip furigana first
  let cleaned = stripFurigana(text);
  
  // Normalize whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  return cleaned;
}

// ============================================================================
// Token Coloring
// ============================================================================

/**
 * Token interface for coloring (matches Token from types.ts)
 */
export interface ColorToken {
  word: string;
  surface?: string;
  type?: string;
  partOfSpeech?: string;
  actual_word?: string;
}

/**
 * Generate colored HTML from tokens based on part-of-speech
 * Used for OCR context phrases to match subtitle styling
 * 
 * @param tokens Array of tokens from tokenizer
 * @param colourCodes POS-to-color mapping from settings/langData
 * @param targetWord Optional word to highlight with 'defined' class
 * @returns HTML string with colored spans
 */
export function tokensToColoredHtml(
  tokens: ColorToken[],
  colourCodes: Record<string, string> = {},
  targetWord?: string
): string {
  if (!tokens || tokens.length === 0) return '';
  
  const parts: string[] = [];
  
  for (const token of tokens) {
    const word = token.surface ?? token.word ?? '';
    if (!word) continue;
    
    const pos = token.partOfSpeech ?? token.type ?? '';
    const color = pos ? colourCodes[pos] : undefined;
    const isTarget = targetWord && (token.actual_word === targetWord || word === targetWord);
    
    // Build class list
    const classes = ['subtitle_word'];
    if (isTarget) classes.push('defined');
    
    // Build style
    const style = color ? `color: ${color};` : '';
    
    parts.push(
      `<span class="${classes.join(' ')}"${style ? ` style="${style}"` : ''}>${escapeHtml(word)}</span>`
    );
  }
  
  return parts.join('');
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
