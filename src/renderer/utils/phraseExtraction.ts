/**
 * Phrase Extraction Utilities
 * Standardized utilities for extracting and formatting context phrases
 * Used by both LLM explain feature and clipboard copy functionality
 *
 * This module centralizes phrase handling to avoid code duplication between:
 * - WordHover component (flashcard example generation)
 * - Reader context menu (copy phrase)
 * - LLM service (context for explanations)
 */

import type { Token } from '../../shared/types';
import { escapeHtml, stripFurigana } from '../../shared/utils/textUtils';

/**
 * Extract a plain text context phrase from tokens
 * Joins token surface forms into a single string
 *
 * @param tokens Array of tokens from tokenizer
 * @returns Plain text phrase
 */
export function tokensToPlainText(tokens: Token[]): string {
    if (!tokens || tokens.length === 0) return '';
    return tokens.map(t => t.surface ?? t.word ?? '').join('');
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
    tokens: Token[],
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
 * Clean a raw context phrase by stripping furigana annotations and normalizing whitespace
 *
 * @param text Raw text that may contain furigana annotations
 * @returns Clean text suitable for display or LLM input
 */
export function cleanContextPhrase(text: string): string {
    if (!text) return '';

    // Strip furigana annotations (e.g., 漢字(かんじ) -> 漢字)
    let cleaned = stripFurigana(text);

    // Normalize whitespace (collapse multiple spaces, trim)
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    return cleaned;
}

/**
 * Extract context phrase from OCR context map or direct text
 * This is the primary method to use when getting a phrase for LLM or clipboard
 *
 * @param contextFromMap Context string from OCR context map (already stitched from boxes)
 * @param fallbackText Fallback text if context map is empty
 * @returns Cleaned context phrase
 */
export function getContextPhrase(contextFromMap: string | undefined, fallbackText?: string): string {
    const raw = contextFromMap || fallbackText || '';
    return cleanContextPhrase(raw);
}

/**
 * Format a context phrase for clipboard copy
 * Ensures consistent formatting across all copy operations
 *
 * @param phrase The phrase to format
 * @returns Formatted phrase ready for clipboard
 */
export function formatForClipboard(phrase: string): string {
    // Clean and normalize
    let formatted = cleanContextPhrase(phrase);

    // Remove any HTML tags that might have slipped through
    formatted = formatted.replace(/<[^>]*>/g, '');

    // Normalize line breaks
    formatted = formatted.replace(/[\r\n]+/g, '\n').trim();

    return formatted;
}

/**
 * Truncate a phrase to a maximum length while preserving word boundaries
 * Used for cache keys and display previews
 *
 * @param phrase The phrase to truncate
 * @param maxLength Maximum length (default 100)
 * @returns Truncated phrase
 */
export function truncatePhrase(phrase: string, maxLength: number = 100): string {
    if (!phrase || phrase.length <= maxLength) return phrase;

    // For CJK text (no spaces), just truncate at the limit
    const hasCJK = /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]/.test(phrase);
    if (hasCJK) {
        return phrase.slice(0, maxLength) + '…';
    }

    // For space-separated text, try to break at a word boundary
    const truncated = phrase.slice(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');

    if (lastSpace > maxLength * 0.7) {
        return truncated.slice(0, lastSpace) + '…';
    }

    return truncated + '…';
}

// Re-export tokensToColoredHtml from subtitleParsing for backwards compatibility
// This ensures existing imports continue to work
export { tokensToColoredHtml as generateColoredHtml };
