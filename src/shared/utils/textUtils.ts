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
 * Extract only kana characters from mixed text
 */
export function extractKana(text: string): string {
  if (!text) return '';
  const matches = text.match(KANA_EXTRACT_REGEX);
  return matches ? matches.join('') : '';
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
export function isWordInLanguageScript(word: string, language: string): boolean {
  if (!word || word.length <= 1) return false;

  // Reject words that are purely numbers, punctuation, or symbols (universal)
  if (/^[\d.,;:%$€£¥₩\-–—\s]+$/.test(word)) return false;
  if (/^[^\p{L}\p{N}]+$/u.test(word)) return false;

  switch (language) {
    case 'ja':
      // Japanese: must contain kana or CJK ideographs
      return HIRAGANA_REGEX.test(word) || KATAKANA_REGEX.test(word) || CJK_IDEOGRAPH_REGEX.test(word);

    case 'zh':
    case 'zh-CN':
    case 'zh-TW':
      // Chinese: must contain CJK ideographs
      return CJK_IDEOGRAPH_REGEX.test(word);

    case 'ko':
      // Korean: must contain Hangul (Hanja/CJK also acceptable)
      return HANGUL_REGEX.test(word) || CJK_IDEOGRAPH_REGEX.test(word);

    default: {
      // For all other languages: check via Intl.Locale.maximize() to discover
      // the expected script, then verify the word contains letters of that
      // script. Falls back to "has any letter" for unknown scripts.
      let expectedScript = '';
      try {
        const locale = new Intl.Locale(language).maximize();
        expectedScript = (locale.script || '').toLowerCase();
      } catch (e) {
        console.error(e);
        // Unknown locale — accept any word that has letters
      }

      // Must contain at least one Unicode letter
      if (!/\p{L}/u.test(word)) return false;

      // If we couldn't determine script, accept anything with letters
      if (!expectedScript) return true;

      // Script-specific checks
      switch (expectedScript) {
        case 'latn':
          return LATIN_LETTER_REGEX.test(word);
        case 'cyrl':
          return /[\u0400-\u04FF\u0500-\u052F]/u.test(word);
        case 'arab':
          return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/u.test(word);
        case 'deva':
          return /[\u0900-\u097F]/u.test(word);
        case 'thai':
          return /[\u0E00-\u0E7F]/u.test(word);
        case 'grek':
          return /[\u0370-\u03FF\u1F00-\u1FFF]/u.test(word);
        case 'hebr':
          return /[\u0590-\u05FF\uFB1D-\uFB4F]/u.test(word);
        case 'geor':
          return /[\u10A0-\u10FF\u2D00-\u2D2F]/u.test(word);
        case 'armn':
          return /[\u0530-\u058F]/u.test(word);
        case 'khmr':
          return /[\u1780-\u17FF]/u.test(word);
        case 'mymr':
          return /[\u1000-\u109F]/u.test(word);
        case 'beng':
          return /[\u0980-\u09FF]/u.test(word);
        case 'guru':
          return /[\u0A00-\u0A7F]/u.test(word);
        case 'taml':
          return /[\u0B80-\u0BFF]/u.test(word);
        case 'telu':
          return /[\u0C00-\u0C7F]/u.test(word);
        case 'knda':
          return /[\u0C80-\u0CFF]/u.test(word);
        case 'mlym':
          return /[\u0D00-\u0D7F]/u.test(word);
        case 'sinh':
          return /[\u0D80-\u0DFF]/u.test(word);
        case 'ethi':
          return /[\u1200-\u137F]/u.test(word);
        default:
          // Unknown script — accept any word with letters
          return true;
      }
    }
  }
}

// ============================================================================
// STT Script Validation
// ============================================================================

/**
 * Regex to detect Hangul characters (Korean)
 */
const HANGUL_REGEX = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/;

/**
 * Regex to detect hiragana characters
 */
const HIRAGANA_REGEX = /[\u3040-\u309F]/;

/**
 * Regex to detect katakana characters
 */
const KATAKANA_REGEX = /[\u30A0-\u30FF]/;

/**
 * Regex to detect CJK Unified Ideographs (shared by Chinese/Japanese/Korean)
 */
const CJK_IDEOGRAPH_REGEX = /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/;

/**
 * Common Chinese filler/interjection characters that STT models produce from
 * non-speech noise (e.g., "ahh", ambient sounds). These are almost always
 * false positives when the target language is not Chinese.
 */
const CHINESE_NOISE_CHARS = new Set([
  '哦', '嗯', '啊', '呢', '吧', '嘛', '哎', '哈', '嗨', '喂',
  '哇', '唉', '嘿', '呀', '哟', '噢', '呐', '喔', '嚯', '咦',
  '咳', '嘁', '噫', '咩', '呃', '额', '哼', '嗷', '嚎', '呜',
]);

/**
 * Validate an STT transcription result against the target language.
 * Returns true if the result appears to be valid speech in the target language,
 * false if it looks like noise or text in the wrong language/script.
 *
 * This is designed to filter out garbage transcriptions from multilingual or
 * wrong-language STT models (e.g., a Chinese model producing "哦" from noise
 * when the user is learning Japanese).
 */
export function isValidSTTResult(text: string, language: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  // Single-character results are almost always noise
  if ([...trimmed].length === 1) return false;

  // Check for Chinese noise particles (regardless of language — these are
  // false positives from the STT model, not real speech)
  if (language !== 'zh' && CHINESE_NOISE_CHARS.has(trimmed)) return false;

  // For non-Chinese CJK languages: validate script consistency
  switch (language) {
    case 'ja': {
      // Japanese speech transcribed by a proper model should contain kana.
      // If using a Chinese-English model, all output is in CJK ideographs
      // without any kana — which means it's probably Chinese, not Japanese.
      // Allow text that contains at least one kana character.
      // Also allow pure Latin (romaji) or mixed content.
      const hasKana = HIRAGANA_REGEX.test(trimmed) || KATAKANA_REGEX.test(trimmed);
      const hasCJK = CJK_IDEOGRAPH_REGEX.test(trimmed);
      const hasLatin = LATIN_LETTER_REGEX.test(trimmed);

      // If it contains kana, it's valid Japanese
      if (hasKana) return true;

      // If it's pure Latin, it could be valid (romaji input)
      if (hasLatin && !hasCJK) return true;

      // Pure CJK without kana: likely a Chinese false positive.
      // Short pure-CJK strings (≤ 3 chars) are very likely noise.
      if (hasCJK && !hasKana) {
        const cjkCount = [...trimmed].filter(ch => CJK_IDEOGRAPH_REGEX.test(ch)).length;
        if (cjkCount <= 3) return false;
      }

      return true;
    }

    case 'ko': {
      // Korean should contain Hangul. Pure CJK without Hangul from a
      // Chinese model is almost certainly wrong.
      const hasHangul = HANGUL_REGEX.test(trimmed);
      const hasCJK = CJK_IDEOGRAPH_REGEX.test(trimmed);
      const hasLatin = LATIN_LETTER_REGEX.test(trimmed);

      if (hasHangul) return true;
      if (hasLatin && !hasCJK) return true;

      // Pure CJK without Hangul is not Korean
      if (hasCJK && !hasHangul) return false;

      return true;
    }

    case 'zh':
      // Chinese model output is valid for Chinese target
      return true;

    default: {
      // For Latin-script languages (en, fr, de, es, etc.):
      // Reject if the text is entirely CJK characters
      const hasCJK = CJK_IDEOGRAPH_REGEX.test(trimmed);
      const hasLatin = LATIN_LETTER_REGEX.test(trimmed);

      if (hasCJK && !hasLatin) return false;

      return true;
    }
  }
}

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

/**
 * Replace ruby-annotated text with their readings, stripping remaining HTML.
 * Used for "use readings" TTS mode.
 * Example: "<ruby>漢字<rt>かんじ</rt></ruby>です" -> "かんじです"
 */
export function applyRubyReadings(text: string): string {
  if (!text) return '';

  // For each <ruby>...</ruby> block, extract the <rt> content as the replacement
  let result = text.replace(/<ruby[^>]*>([\s\S]*?)<\/ruby>/gi, (_match, inner: string) => {
    const rtMatch = inner.match(/<rt[^>]*>([\s\S]*?)<\/rt>/i);
    if (rtMatch) return rtMatch[1];
    // No <rt> found, strip tags from inner content
    return inner.replace(/<[^>]*>/g, '');
  });

  // Strip any remaining HTML tags
  result = result.replace(/<[^>]*>/g, '');
  return result.trim();
}

/**
 * Strip all HTML from text for TTS consumption.
 * Handles ruby annotations based on `useReadings`:
 *   - true:  replace kanji with their <rt> readings, then strip remaining HTML
 *   - false: remove <rt> readings, keep kanji, then strip remaining HTML
 */
export function stripHtmlForTts(text: string, useReadings = false): string {
  if (!text) return '';
  if (useReadings) return applyRubyReadings(text);

  // Remove readings first (preserving kanji), then strip all remaining tags
  let result = stripFurigana(text);
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

// ============================================================================
// Language Display Names
// ============================================================================

/** Language code → English display name mapping (for LLM prompts and display) */
const LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
  en: 'English', de: 'German', fr: 'French', ja: 'Japanese', ru: 'Russian',
  zh: 'Chinese', ko: 'Korean', es: 'Spanish', it: 'Italian', pt: 'Portuguese',
  ar: 'Arabic', he: 'Hebrew', hi: 'Hindi', th: 'Thai', vi: 'Vietnamese',
  tr: 'Turkish', pl: 'Polish', nl: 'Dutch', sv: 'Swedish', uk: 'Ukrainian',
};

/** Map a language code to its English display name (for LLM prompts, display) */
export function getLanguageDisplayName(code: string): string {
  return LANGUAGE_DISPLAY_NAMES[code] || code;
}
