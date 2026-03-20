import { describe, it, expect } from 'vitest';
import type { Token } from '../../shared/types';
import {
    tokensToPlainText,
    tokensToColoredHtml,
    cleanContextPhrase,
    getContextPhrase,
    formatForClipboard,
    truncatePhrase,
} from './phraseExtraction';

function token(word: string, type: string = '', overrides: Partial<Token> = {}): Token {
    return { word, actual_word: word, type, ...overrides };
}

describe('tokensToPlainText', () => {
    it('returns empty string for empty array', () => {
        expect(tokensToPlainText([])).toBe('');
    });

    it('returns empty string for null-ish input', () => {
        expect(tokensToPlainText(null as unknown as Token[])).toBe('');
    });

    it('returns surface value when token has surface', () => {
        expect(tokensToPlainText([token('word', '', { surface: 'surf' })])).toBe('surf');
    });

    it('returns word value when token has no surface', () => {
        expect(tokensToPlainText([token('hello')])).toBe('hello');
    });

    it('joins multiple tokens without separator', () => {
        expect(tokensToPlainText([token('foo'), token('bar'), token('baz')])).toBe('foobarbaz');
    });

    it('mixes surface and word across tokens', () => {
        const tokens: Token[] = [
            token('word1', '', { surface: 'surf1' }),
            token('word2'),
        ];
        expect(tokensToPlainText(tokens)).toBe('surf1word2');
    });

    it('contributes empty string for token with neither surface nor word', () => {
        const tokens: Token[] = [
            token('', '', {}),
            token('end'),
        ];
        expect(tokensToPlainText(tokens)).toBe('end');
    });
});

describe('tokensToColoredHtml', () => {
    it('returns empty string for empty array', () => {
        expect(tokensToColoredHtml([])).toBe('');
    });

    it('returns empty string for null-ish input', () => {
        expect(tokensToColoredHtml(null as unknown as Token[])).toBe('');
    });

    it('renders span with subtitle_word class only when no color and no target', () => {
        const result = tokensToColoredHtml([token('hello', 'NOUN')]);
        expect(result).toBe('<span class="subtitle_word">hello</span>');
    });

    it('renders inline style when POS matches colourCodes', () => {
        const result = tokensToColoredHtml([token('走る', '動詞')], { '動詞': '#ff0000' });
        expect(result).toBe('<span class="subtitle_word" style="color: #ff0000;">走る</span>');
    });

    it('adds defined class when targetWord matches actual_word', () => {
        const t = token('走る', '動詞');
        const result = tokensToColoredHtml([t], {}, '走る');
        expect(result).toContain('class="subtitle_word defined"');
    });

    it('adds defined class when targetWord matches word (surface)', () => {
        const t = token('run', 'VERB', { surface: 'running' });
        const result = tokensToColoredHtml([t], {}, 'running');
        expect(result).toContain('class="subtitle_word defined"');
    });

    it('does not add defined class when targetWord does not match', () => {
        const result = tokensToColoredHtml([token('走る', '動詞')], {}, '食べる');
        expect(result).not.toContain('defined');
    });

    it('renders multiple tokens concatenated', () => {
        const tokens = [token('foo', ''), token('bar', '')];
        const result = tokensToColoredHtml(tokens);
        expect(result).toBe(
            '<span class="subtitle_word">foo</span><span class="subtitle_word">bar</span>'
        );
    });

    it('skips tokens with empty word and no surface', () => {
        const tokens: Token[] = [token('', ''), token('visible', '')];
        const result = tokensToColoredHtml(tokens);
        expect(result).toBe('<span class="subtitle_word">visible</span>');
    });

    it('uses surface over word when surface is set', () => {
        const t = token('walk', 'VERB', { surface: 'walked' });
        const result = tokensToColoredHtml([t]);
        expect(result).toContain('walked');
        expect(result).not.toContain('>walk<');
    });

    it('escapes angle brackets in word content', () => {
        const t = token('<b>bold</b>', '');
        const result = tokensToColoredHtml([t]);
        expect(result).toContain('&lt;b&gt;bold&lt;/b&gt;');
        expect(result).not.toContain('<b>');
    });

    it('escapes ampersands in word content', () => {
        const t = token('foo & bar', '');
        const result = tokensToColoredHtml([t]);
        expect(result).toContain('foo &amp; bar');
    });

    it('escapes double quotes in word content', () => {
        const t = token('say "hi"', '');
        const result = tokensToColoredHtml([t]);
        expect(result).toContain('say &quot;hi&quot;');
    });

    it('combines color and defined class correctly', () => {
        const t = token('走る', '動詞');
        const result = tokensToColoredHtml([t], { '動詞': '#00f' }, '走る');
        expect(result).toBe('<span class="subtitle_word defined" style="color: #00f;">走る</span>');
    });

    it('ignores unknown POS keys in colourCodes', () => {
        const t = token('hello', 'NOUN');
        const result = tokensToColoredHtml([t], { VERB: '#red' });
        expect(result).toBe('<span class="subtitle_word">hello</span>');
    });
});

describe('cleanContextPhrase', () => {
    it('returns empty string for empty input', () => {
        expect(cleanContextPhrase('')).toBe('');
    });

    it('returns empty string for falsy input', () => {
        expect(cleanContextPhrase(null as unknown as string)).toBe('');
    });

    it('strips parenthesized hiragana furigana', () => {
        expect(cleanContextPhrase('漢字(かんじ)')).toBe('漢字');
    });

    it('strips parenthesized katakana furigana', () => {
        expect(cleanContextPhrase('漢字（かんじ）')).toBe('漢字');
    });

    it('normalizes multiple spaces to single space', () => {
        expect(cleanContextPhrase('foo   bar')).toBe('foo bar');
    });

    it('trims leading and trailing whitespace', () => {
        expect(cleanContextPhrase('  hello world  ')).toBe('hello world');
    });

    it('returns the text unchanged when already clean', () => {
        expect(cleanContextPhrase('simple text')).toBe('simple text');
    });

    it('handles mixed furigana and whitespace together', () => {
        const result = cleanContextPhrase('  漢字(かんじ)  を  読む(よむ)  ');
        expect(result).toBe('漢字 を 読む');
    });
});

describe('getContextPhrase', () => {
    it('returns empty string when both context and fallback are undefined', () => {
        expect(getContextPhrase(undefined)).toBe('');
    });

    it('returns cleaned fallback when context is undefined', () => {
        expect(getContextPhrase(undefined, '  hello  ')).toBe('hello');
    });

    it('returns cleaned context when context is provided', () => {
        expect(getContextPhrase('漢字(かんじ)')).toBe('漢字');
    });

    it('prefers context over fallback when both are provided', () => {
        expect(getContextPhrase('context text', 'fallback text')).toBe('context text');
    });

    it('falls back to fallback when context is empty string', () => {
        expect(getContextPhrase('', 'fallback')).toBe('fallback');
    });

    it('returns empty string when both are empty strings', () => {
        expect(getContextPhrase('', '')).toBe('');
    });
});

describe('formatForClipboard', () => {
    it('cleans furigana from phrase', () => {
        expect(formatForClipboard('漢字(かんじ)')).toBe('漢字');
    });

    it('removes HTML tags', () => {
        expect(formatForClipboard('<b>bold</b> text')).toBe('bold text');
    });

    it('normalizes multiple newlines to single space (cleanContextPhrase runs first)', () => {
        expect(formatForClipboard('line1\n\n\nline2')).toBe('line1 line2');
    });

    it('normalizes carriage returns to space (cleanContextPhrase runs first)', () => {
        expect(formatForClipboard('line1\r\nline2')).toBe('line1 line2');
    });

    it('trims surrounding whitespace', () => {
        expect(formatForClipboard('  hello  ')).toBe('hello');
    });

    it('returns empty string for empty input', () => {
        expect(formatForClipboard('')).toBe('');
    });

    it('strips nested HTML tags', () => {
        expect(formatForClipboard('<span class="foo"><em>text</em></span>')).toBe('text');
    });
});

describe('truncatePhrase', () => {
    it('returns phrase as-is when null', () => {
        const result = truncatePhrase(null as unknown as string);
        expect(result).toBeNull();
    });

    it('returns phrase as-is when undefined', () => {
        const result = truncatePhrase(undefined as unknown as string);
        expect(result).toBeUndefined();
    });

    it('returns phrase as-is when shorter than maxLength', () => {
        expect(truncatePhrase('short', 100)).toBe('short');
    });

    it('returns phrase as-is when exactly equal to maxLength', () => {
        const phrase = 'a'.repeat(100);
        expect(truncatePhrase(phrase, 100)).toBe(phrase);
    });

    it('truncates CJK text at maxLength and appends ellipsis', () => {
        const phrase = 'あ'.repeat(110);
        const result = truncatePhrase(phrase, 100);
        expect(result).toBe('あ'.repeat(100) + '…');
    });

    it('uses single ellipsis character not three dots', () => {
        const phrase = 'あ'.repeat(110);
        const result = truncatePhrase(phrase, 100);
        expect(result).toContain('…');
        expect(result).not.toContain('...');
    });

    it('breaks Latin text at word boundary when last space is after 70% of maxLength', () => {
        // Build: 75 a's + space + 25 b's = 101 chars, space at position 75 (> 70)
        const phrase = 'a'.repeat(75) + ' ' + 'b'.repeat(25);
        const result = truncatePhrase(phrase, 100);
        expect(result).toBe('a'.repeat(75) + '…');
    });

    it('truncates Latin text at hard limit when no good word boundary exists', () => {
        // No space at all — falls through to hard truncation
        const phrase = 'a'.repeat(110);
        const result = truncatePhrase(phrase, 100);
        expect(result).toBe('a'.repeat(100) + '…');
    });

    it('truncates Latin text at hard limit when last space is before 70% of maxLength', () => {
        // Space at position 10 (< 70% of 100), then 100 more chars
        const phrase = 'a'.repeat(10) + ' ' + 'b'.repeat(100);
        const result = truncatePhrase(phrase, 100);
        expect(result).toBe('a'.repeat(10) + ' ' + 'b'.repeat(89) + '…');
    });

    it('uses default maxLength of 100', () => {
        const phrase = 'a'.repeat(110);
        const result = truncatePhrase(phrase);
        expect(result?.length).toBe(101);
    });
});
