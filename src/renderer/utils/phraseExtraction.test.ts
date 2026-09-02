import { describe, it, expect } from 'vitest';
import type { LanguageData, Token } from '../../shared/types';
import {
    tokensToColoredHtml,
    cleanContextPhrase,
    formatForClipboard,
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

