/**
 * Token Estimation Utilities
 *
 * Rough estimation of context-window tokens for LLM usage.
 * These are NOT linguistic tokens — they are a heuristic for
 * counting how much of a model's context window text occupies.
 *
 * Heuristic:
 *   - ASCII/Latin (0x00-0x7F): ~4 chars per token
 *   - CJK (Hiragana, Katakana, Hangul, CJK Unified Ideographs): ~1.5 chars per token
 *   - Emoji / surrogate pairs: 2 tokens each
 *   - Other Unicode: ~2 chars per token
 */

// ============================================================================
// Character Detection Helpers
// ============================================================================

/**
 * Check if a Unicode code point belongs to CJK script ranges:
 * Hiragana, Katakana, Hangul Jamo/Syllables, CJK Unified Ideographs,
 * CJK Extension A/B, CJK Compatibility Ideographs.
 */
function isCJK(codePoint: number): boolean {
  return (
    (codePoint >= 0x3040 && codePoint <= 0x309F) ||   // Hiragana
    (codePoint >= 0x30A0 && codePoint <= 0x30FF) ||   // Katakana
    (codePoint >= 0x3130 && codePoint <= 0x318F) ||   // Hangul Compatibility Jamo
    (codePoint >= 0xAC00 && codePoint <= 0xD7AF) ||   // Hangul Syllables
    (codePoint >= 0x1100 && codePoint <= 0x11FF) ||   // Hangul Jamo
    (codePoint >= 0x3400 && codePoint <= 0x4DBF) ||   // CJK Extension A
    (codePoint >= 0x4E00 && codePoint <= 0x9FFF) ||   // CJK Unified Ideographs
    (codePoint >= 0xF900 && codePoint <= 0xFAFF)       // CJK Compatibility Ideographs
  );
}

/**
 * Check if a character is an emoji.
 * Handles surrogate pairs (emoji are outside the BMP).
 */
function isEmoji(codePoint: number): boolean {
  return (
    // Emoticons, Dingbats, Transport & Map, Enclosed, Misc Symbols
    (codePoint >= 0x1F300 && codePoint <= 0x1F9FF) ||
    // Supplemental Symbols and Pictographs
    (codePoint >= 0x1FA00 && codePoint <= 0x1FA6F) ||
    // Miscellaneous Symbols
    (codePoint >= 0x2600 && codePoint <= 0x26FF) ||
    // Dingbats
    (codePoint >= 0x2700 && codePoint <= 0x27BF) ||
    // Enclosed Alphanumerics and Geometric Shapes
    (codePoint >= 0x24C2 && codePoint <= 0x2BFF) ||
    // Regional Indicator Symbols (flags)
    (codePoint >= 0x1F1E6 && codePoint <= 0x1F1FF) ||
    // Keycap, Tags, Variation Selectors, combining sequences are handled
    // at the character level via codePoint > 0xFFFF check
    codePoint > 0xFFFF
  );
}

// ============================================================================
// Token Estimation
// ============================================================================

const ASCII_CHARS_PER_TOKEN = 4;
const CJK_CHARS_PER_TOKEN = 1.5;
const EMOJI_TOKENS = 2;
const OTHER_CHARS_PER_TOKEN = 2;

/**
 * Estimate the number of context-window tokens for a given text string.
 *
 * This is a rough heuristic, NOT a precise linguistic tokenizer.
 * Useful for estimating how much of an LLM's context window is used.
 *
 * @param text - The input text to estimate tokens for.
 * @returns Estimated number of tokens.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  let asciiCount = 0;
  let cjkCount = 0;
  let emojiCount = 0;
  let otherCount = 0;

  let i = 0;
  while (i < text.length) {
    const codePoint = text.codePointAt(i)!;

    if (codePoint > 0xFFFF) {
      emojiCount++;
      i += 2;
      continue;
    }

    if (codePoint <= 0x7F) {
      asciiCount++;
      i++;
      continue;
    }

    if (isEmoji(codePoint)) {
      emojiCount++;
      i++;
      continue;
    }

    if (isCJK(codePoint)) {
      cjkCount++;
      i++;
      continue;
    }

    otherCount++;
    i++;
  }

  const tokens =
    asciiCount / ASCII_CHARS_PER_TOKEN +
    cjkCount / CJK_CHARS_PER_TOKEN +
    emojiCount * EMOJI_TOKENS +
    otherCount / OTHER_CHARS_PER_TOKEN;

  return Math.ceil(tokens);
}

/**
 * Estimate the total number of tokens for an array of message objects.
 *
 * @param messages - Array of objects with a `content` string property.
 * @returns Sum of estimated tokens across all messages.
 */
export function estimateMessagesTokens(
  messages: Array<{ content: string }>,
): number {
  let total = 0;
  for (let i = 0; i < messages.length; i++) {
    total += estimateTokens(messages[i].content);
  }
  return total;
}
