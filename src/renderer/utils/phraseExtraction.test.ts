import { describe, it, expect } from 'vitest';
import type { LanguageData, Token } from '../../shared/types';
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

const hanPinyinLanguage: LanguageData = {
    name: 'Han Pinyin Language',
    colour_codes: {},
    settings: { fixed: {} },
    textProcessing: {
        lexemeNormalization: {
            type: 'reading',
            surfaceScripts: ['Han'],
            readingScripts: ['Latn'],
        },
        readingAnnotation: {
            type: 'script-reading',
            annotationScripts: ['Han'],
            stripParentheticalReadings: true,
        },
    },
};

const latinLanguage: LanguageData = {
    name: 'Latin Language',
    colour_codes: {},
    settings: { fixed: {} },
    textProcessing: {
      scriptProfile: { acceptedScripts: ['Latn'] },
        lexemeNormalization: {
            type: 'identity',
        },
        readingAnnotation: {
            type: 'none',
            stripParentheticalReadings: false,
        },
    },
};

const thaiLanguage: LanguageData = {
    name: 'Thai Language',
    colour_codes: {},
    settings: { fixed: {} },
    textProcessing: {
      scriptProfile: { acceptedScripts: ['Thai'] },
    },
    };

const kanaKanjiLanguage: LanguageData = {
    name: 'Kana Kanji Language',
    colour_codes: {},
    settings: { fixed: {} },
    textProcessing: {
      scriptProfile: { acceptedScripts: ['Hira', 'Kana', 'Han'] },
        lexemeNormalization: {
            type: 'surface-reading',
            surfaceScripts: ['Han'],
            readingScripts: ['Hira', 'Kana'],
            readingNormalizer: 'kana-to-hiragana',
        },
    },
};

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

    it('joins multiple tokens with language metadata separators', () => {
        expect(tokensToPlainText([token('foo'), token('bar'), token('baz')], latinLanguage)).toBe('foo bar baz');
        expect(tokensToPlainText([token('日本'), token('語'), token('を')], kanaKanjiLanguage)).toBe('日本語を');
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

    it('renders inline style through metadata POS aliases', () => {
        const result = tokensToColoredHtml(
            [token('hello', 'NOUN')],
            { noun: '#112233' },
            undefined,
            {
                ...latinLanguage,
                textProcessing: {
                    ...latinLanguage.textProcessing,
                    partOfSpeech: {
                        aliases: {
                            NOUN: 'noun',
                        },
                    },
                },
            },
        );

        expect(result).toBe('<span class="subtitle_word" style="color: #112233;">hello</span>');
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

    it('renders multiple tokens with language metadata separators', () => {
        const tokens = [token('foo', ''), token('bar', '')];
        expect(tokensToColoredHtml(tokens, {}, undefined, latinLanguage)).toBe(
            '<span class="subtitle_word">foo</span> <span class="subtitle_word">bar</span>'
        );
        expect(tokensToColoredHtml([token('日本', ''), token('語', '')], {}, undefined, kanaKanjiLanguage)).toBe(
            '<span class="subtitle_word">日本</span><span class="subtitle_word">語</span>'
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

    it('keeps parenthesized hiragana without language metadata', () => {
        expect(cleanContextPhrase('漢字(かんじ)')).toBe('漢字(かんじ)');
    });

    it('keeps full-width parenthesized readings without language metadata', () => {
        expect(cleanContextPhrase('漢字（かんじ）')).toBe('漢字（かんじ）');
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

    it('handles metadata-free parenthetical readings and whitespace together', () => {
        const result = cleanContextPhrase('  漢字(かんじ)  を  読む(よむ)  ');
        expect(result).toBe('漢字(かんじ) を 読む(よむ)');
    });

    it('uses language metadata to strip non-kana reading annotations', () => {
        expect(cleanContextPhrase('你好(ni hao)', hanPinyinLanguage)).toBe('你好');
    });

    it('preserves parenthetical text when language metadata disables reading stripping', () => {
        expect(cleanContextPhrase('hello (friendly note)', latinLanguage)).toBe('hello (friendly note)');
        expect(cleanContextPhrase('Example(かな)', latinLanguage)).toBe('Example(かな)');
    });
});

describe('getContextPhrase', () => {
    it('returns empty string when both context and fallback are undefined', () => {
        expect(getContextPhrase(undefined)).toBe('');
    });

    it('returns cleaned fallback when context is undefined', () => {
        expect(getContextPhrase(undefined, '  hello  ')).toBe('hello');
    });

    it('returns metadata-free context without stripping parenthetical readings', () => {
        expect(getContextPhrase('漢字(かんじ)')).toBe('漢字(かんじ)');
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
    it('formats metadata-free parenthetical readings without stripping them', () => {
        expect(formatForClipboard('漢字(かんじ)')).toBe('漢字(かんじ)');
    });

    it('preserves parenthetical text for languages without reading annotations', () => {
        expect(formatForClipboard('word(noun)', latinLanguage)).toBe('word(noun)');
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

    it('truncates segmentless languages at maxLength from metadata', () => {
        const phrase = 'ก'.repeat(75) + ' ' + 'ข'.repeat(40);
        const result = truncatePhrase(phrase, 100, thaiLanguage, 'th');
        expect(result).toBe(phrase.slice(0, 100) + '…');
    });

    it('infers segmentless script truncation when metadata is unavailable', () => {
        const phrase = 'က'.repeat(75) + ' ' + 'ခ'.repeat(40);
        const result = truncatePhrase(phrase, 100);
        expect(result).toBe(phrase.slice(0, 100) + '…');
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

    it('uses the language profile over incidental segmentless characters', () => {
        const phrase = 'a'.repeat(75) + ' 漢字 ' + 'b'.repeat(25);
        const result = truncatePhrase(phrase, 100, latinLanguage, 'en');
        expect(result).toBe('a'.repeat(75) + ' 漢字…');
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
