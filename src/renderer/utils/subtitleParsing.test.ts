import { describe, it, expect } from 'vitest';
import {
  parseSubtitle,
  extractFurigana,
  buildFuriganaHtml,
  extractKanaReading,
  parseWorkName,
  shouldRemoveParentheticalContent,
} from './subtitleParsing';

describe('parseSubtitle', () => {
  it('returns empty text and no overrides for empty string', () => {
    expect(parseSubtitle('', 'ja')).toEqual({ text: '', readingOverrides: [] });
  });

  it('returns empty text and no overrides for null-ish value', () => {
    // @ts-expect-error testing falsy input
    expect(parseSubtitle(null, 'ja')).toEqual({ text: '', readingOverrides: [] });
  });

  it('returns plain text unchanged when no furigana present', () => {
    const result = parseSubtitle('こんにちは', 'ja');
    expect(result.text).toBe('こんにちは');
    expect(result.readingOverrides).toEqual([]);
  });

  it('extracts reading override from ASCII-paren furigana', () => {
    const result = parseSubtitle('漢字(かんじ)', 'ja');
    expect(result.readingOverrides).toEqual([{ word: '漢字', reading: 'かんじ' }]);
  });

  it('cleans ASCII-paren furigana from text, keeping only kanji', () => {
    const result = parseSubtitle('漢字(かんじ)です', 'ja');
    expect(result.text).toBe('漢字です');
  });

  it('extracts reading override from full-width JP-paren furigana', () => {
    const result = parseSubtitle('漢字（かんじ）', 'ja');
    expect(result.readingOverrides).toEqual([{ word: '漢字', reading: 'かんじ' }]);
  });

  it('cleans JP-paren furigana from text, keeping only kanji', () => {
    const result = parseSubtitle('漢字（かんじ）です', 'ja');
    expect(result.text).toBe('漢字です');
  });

  it('extracts multiple reading overrides from a single line', () => {
    const result = parseSubtitle('百夜(ひゃくや)優一郎(ゆういちろう)', 'ja');
    expect(result.readingOverrides).toContainEqual({ word: '百夜', reading: 'ひゃくや' });
    expect(result.readingOverrides).toContainEqual({ word: '優一郎', reading: 'ゆういちろう' });
    expect(result.readingOverrides).toHaveLength(2);
  });

  it('cleans multiple furigana annotations, preserving base text', () => {
    const result = parseSubtitle('百夜(ひゃくや)優一郎(ゆういちろう)', 'ja');
    expect(result.text).toBe('百夜優一郎');
  });

  it('does NOT create override for plain kana word before parens (no kanji)', () => {
    const result = parseSubtitle('きのう(yesterday)', 'ja');
    expect(result.readingOverrides).toEqual([]);
  });

  it('does NOT create override for Latin word before parens', () => {
    const result = parseSubtitle('hello(world)', 'ja');
    expect(result.readingOverrides).toEqual([]);
  });

  it('preserves parenthetical content for German subtitles', () => {
    const result = parseSubtitle('Hallo (leise)', 'de');
    expect(result.text).toBe('Hallo (leise)');
    expect(result.readingOverrides).toEqual([]);
  });

  it('handles mixed text: kanji+furigana alongside plain kana', () => {
    const result = parseSubtitle('今日(きょう) 天気(てんき)ですね', 'ja');
    expect(result.readingOverrides).toContainEqual({ word: '今日', reading: 'きょう' });
    expect(result.readingOverrides).toContainEqual({ word: '天気', reading: 'てんき' });
    expect(result.text).toBe('今日 天気ですね');
  });

  it('handles mixed ASCII and JP parens in same text', () => {
    const result = parseSubtitle('漢字（かんじ）文字(もじ)', 'ja');
    expect(result.readingOverrides).toContainEqual({ word: '漢字', reading: 'かんじ' });
    expect(result.readingOverrides).toContainEqual({ word: '文字', reading: 'もじ' });
  });
});

describe('extractFurigana', () => {
  it('returns empty array for empty string', () => {
    expect(extractFurigana('')).toEqual([]);
  });

  it('returns empty array for falsy input', () => {
    // @ts-expect-error testing falsy input
    expect(extractFurigana(null)).toEqual([]);
  });

  it('extracts single segment with ASCII-paren reading', () => {
    const result = extractFurigana('漢字(かんじ)');
    expect(result).toEqual([{ text: '漢字', reading: 'かんじ' }]);
  });

  it('extracts single segment with JP-paren reading', () => {
    const result = extractFurigana('漢字（かんじ）');
    expect(result).toEqual([{ text: '漢字', reading: 'かんじ' }]);
  });

  it('extracts multiple segments from compound furigana text', () => {
    const result = extractFurigana('百夜(ひゃくや)優一郎(ゆういちろう)');
    expect(result).toEqual([
      { text: '百夜', reading: 'ひゃくや' },
      { text: '優一郎', reading: 'ゆういちろう' },
    ]);
  });

  it('returns a segment without reading for plain text with no parens', () => {
    const result = extractFurigana('こんにちは');
    expect(result).toEqual([{ text: 'こんにちは' }]);
  });

  it('returns segments without reading for text that has no furigana', () => {
    const result = extractFurigana('hello world');
    expect(result.every(s => s.reading === undefined)).toBe(true);
  });

  it('handles mixed furigana and plain segments', () => {
    const result = extractFurigana('今日(きょう)は');
    expect(result).toContainEqual({ text: '今日', reading: 'きょう' });
    expect(result).toContainEqual({ text: 'は' });
  });

  it('returns reading undefined (not empty string) for plain segments', () => {
    const result = extractFurigana('テスト');
    expect(result[0].reading).toBeUndefined();
  });

  it('handles text with only kanji and no readings', () => {
    const result = extractFurigana('漢字文字');
    expect(result).toEqual([{ text: '漢字文字' }]);
  });
});

describe('buildFuriganaHtml', () => {
  it('returns empty string for empty array', () => {
    expect(buildFuriganaHtml([])).toBe('');
  });

  it('returns ruby HTML for segment with reading', () => {
    expect(buildFuriganaHtml([{ text: '漢字', reading: 'かんじ' }]))
      .toBe('<ruby>漢字<rt>かんじ</rt></ruby>');
  });

  it('returns plain text for segment without reading', () => {
    expect(buildFuriganaHtml([{ text: 'こんにちは' }])).toBe('こんにちは');
  });

  it('concatenates multiple segments correctly', () => {
    const segments = [
      { text: '百夜', reading: 'ひゃくや' },
      { text: '優一郎', reading: 'ゆういちろう' },
    ];
    expect(buildFuriganaHtml(segments)).toBe(
      '<ruby>百夜<rt>ひゃくや</rt></ruby><ruby>優一郎<rt>ゆういちろう</rt></ruby>'
    );
  });

  it('handles mixed segments (with and without reading)', () => {
    const segments = [
      { text: '今日', reading: 'きょう' },
      { text: 'は' },
      { text: '天気', reading: 'てんき' },
    ];
    expect(buildFuriganaHtml(segments)).toBe(
      '<ruby>今日<rt>きょう</rt></ruby>は<ruby>天気<rt>てんき</rt></ruby>'
    );
  });

  it('produces valid ruby tag format with rt inside ruby', () => {
    const html = buildFuriganaHtml([{ text: 'X', reading: 'Y' }]);
    expect(html).toMatch(/^<ruby>.*<rt>.*<\/rt><\/ruby>$/);
  });
});

describe('extractKanaReading', () => {
  it('returns empty string for undefined', () => {
    expect(extractKanaReading(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(extractKanaReading('')).toBe('');
  });

  it('extracts kana from a single rt tag', () => {
    expect(extractKanaReading('<ruby>漢字<rt>かんじ</rt></ruby>')).toBe('かんじ');
  });

  it('joins multiple rt tags into one string', () => {
    expect(
      extractKanaReading('<ruby>百夜<rt>ひゃくや</rt></ruby><ruby>優一郎<rt>ゆういちろう</rt></ruby>')
    ).toBe('ひゃくやゆういちろう');
  });

  it('returns plain kana as-is (no ruby markup)', () => {
    expect(extractKanaReading('かんじ')).toBe('かんじ');
  });

  it('returns plain katakana as-is', () => {
    expect(extractKanaReading('カンジ')).toBe('カンジ');
  });

  it('extracts kana characters from mixed kanji+kana text', () => {
    const result = extractKanaReading('漢字かな');
    expect(result).toBe('かな');
  });

  it('handles HTML without rt tags by normalizing with normalizeReading', () => {
    const result = extractKanaReading('<b>かんじ</b>');
    expect(result).toBe('かんじ');
  });

  it('handles reading with only kanji and no kana gracefully', () => {
    const result = extractKanaReading('漢字');
    expect(typeof result).toBe('string');
  });

  it('preserves non-kana readings when no kana is present', () => {
    expect(extractKanaReading('hallo')).toBe('hallo');
  });
});

describe('shouldRemoveParentheticalContent', () => {
  it('returns true for Japanese', () => {
    expect(shouldRemoveParentheticalContent('ja')).toBe(true);
  });

  it('returns false for German', () => {
    expect(shouldRemoveParentheticalContent('de')).toBe(false);
  });
});

describe('parseWorkName', () => {
  it('returns empty string for empty input', () => {
    expect(parseWorkName('')).toBe('');
  });

  it('returns empty string for null-ish input', () => {
    // @ts-expect-error testing falsy input
    expect(parseWorkName(null)).toBe('');
  });

  it('strips .srt extension', () => {
    expect(parseWorkName('My.Show.srt')).not.toContain('.srt');
  });

  it('strips .ass extension', () => {
    expect(parseWorkName('My.Show.ass')).not.toContain('.ass');
  });

  it('strips .pdf extension', () => {
    expect(parseWorkName('My.Manga.pdf')).not.toContain('.pdf');
  });

  it('strips .cbz extension', () => {
    expect(parseWorkName('My.Manga.cbz')).not.toContain('.cbz');
  });

  it('replaces dots with spaces', () => {
    expect(parseWorkName('My.Show.Title')).toBe('My Show Title');
  });

  it('replaces underscores with spaces', () => {
    expect(parseWorkName('My_Show_Name')).toBe('My Show Name');
  });

  it('removes WEBRip release tag', () => {
    expect(parseWorkName('Show.S01E01.WEBRip.srt')).not.toMatch(/WEBRip/i);
  });

  it('removes BluRay release tag', () => {
    expect(parseWorkName('Show.S01E01.BluRay.srt')).not.toMatch(/BluRay/i);
  });

  it('removes 1080p quality tag', () => {
    expect(parseWorkName('Show.1080p.srt')).not.toContain('1080p');
  });

  it('removes 720p quality tag', () => {
    expect(parseWorkName('Show.720p.srt')).not.toContain('720p');
  });

  it('removes x264 codec tag', () => {
    expect(parseWorkName('Show.x264.srt')).not.toMatch(/x264/i);
  });

  it('removes x265 codec tag', () => {
    expect(parseWorkName('Show.x265.srt')).not.toMatch(/x265/i);
  });

  it('preserves season/episode pattern like S01E02', () => {
    const result = parseWorkName('My.Show.S01E02.srt');
    expect(result).toContain('S01E2');
  });

  it('normalizes episode leading zero: S01E02 -> S01E2', () => {
    expect(parseWorkName('Show.S01E02')).toContain('S01E2');
  });

  it('removes language code "ja"', () => {
    const result = parseWorkName('Show.S01E01.ja.srt');
    expect(result.split(' ')).not.toContain('ja');
  });

  it('removes language code "en"', () => {
    const result = parseWorkName('Show.S01E01.en.srt');
    expect(result.split(' ')).not.toContain('en');
  });

  it('removes language code "jpn"', () => {
    const result = parseWorkName('Show.jpn.srt');
    expect(result.split(' ')).not.toContain('jpn');
  });

  it('removes language code "eng"', () => {
    const result = parseWorkName('Show.eng.srt');
    expect(result.split(' ')).not.toContain('eng');
  });

  it('removes bracketed junk [720p]', () => {
    expect(parseWorkName('Show [720p]')).not.toContain('[720p]');
  });

  it('removes parenthesized junk (BD)', () => {
    expect(parseWorkName('Show (BD)')).not.toContain('(BD)');
  });

  it('removes curly-braced junk {WEB}', () => {
    expect(parseWorkName('Show {WEB}')).not.toContain('{WEB}');
  });

  it('collapses multiple spaces into one', () => {
    const result = parseWorkName('Show   Name');
    expect(result).not.toMatch(/ {2,}/);
  });

  it('trims leading and trailing whitespace', () => {
    const result = parseWorkName('  Show  ');
    expect(result).toBe(result.trim());
  });

  it('handles a complex real-world filename', () => {
    const result = parseWorkName('My.Show.S02E03.1080p.WEBRip.x265.ja.srt');
    expect(result).toContain('My');
    expect(result).toContain('Show');
    expect(result).toContain('S02E3');
    expect(result).not.toMatch(/1080p/i);
    expect(result).not.toMatch(/WEBRip/i);
    expect(result).not.toMatch(/x265/i);
    expect(result).not.toMatch(/\.srt/);
  });

  it('handles folder name without extension', () => {
    const result = parseWorkName('My_Manga_Vol_01');
    expect(result).toBe('My Manga Vol 01');
  });
});
