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

import type { LanguageData, Token } from '../../shared/types';
import { escapeHtml, stripReadingAnnotations, stripRubyAnnotations } from '../../shared/utils/textUtils';
import { getPartOfSpeechColor, getTokenJoinSeparator } from '../../shared/languageFeatures';

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
    targetWord?: string,
    data?: LanguageData | null,
): string {
    if (!tokens || tokens.length === 0) return '';

    const parts: string[] = [];

    for (const token of tokens) {
        const word = token.surface ?? token.word ?? '';
        if (!word) continue;

        const pos = token.partOfSpeech ?? token.type ?? '';
        const color = getPartOfSpeechColor(pos, colourCodes, data);
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

    return parts.join(getTokenJoinSeparator(data));
}

/**
 * Clean a raw context phrase by stripping reading annotations and normalizing whitespace
 *
 * @param text Raw text that may contain reading annotations
 * @returns Clean text suitable for display or LLM input
 */
export function cleanContextPhrase(text: string, data?: LanguageData | null): string {
    if (!text) return '';

    // Strip ruby markup and metadata-configured reading annotations.
    let cleaned = data ? stripReadingAnnotations(text, data) : stripRubyAnnotations(text);

    // Normalize whitespace (collapse multiple spaces, trim)
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    return cleaned;
}

/**
 * Format a context phrase for clipboard copy
 * Ensures consistent formatting across all copy operations
 *
 * @param phrase The phrase to format
 * @returns Formatted phrase ready for clipboard
 */
export function formatForClipboard(phrase: string, data?: LanguageData | null): string {
    // Clean and normalize
    let formatted = cleanContextPhrase(phrase, data);

    // Remove any HTML tags that might have slipped through
    formatted = formatted.replace(/<[^>]*>/g, '');

    // Normalize line breaks
    formatted = formatted.replace(/[\r\n]+/g, '\n').trim();

    return formatted;
}

