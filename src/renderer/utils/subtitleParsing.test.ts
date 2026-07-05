import { describe, it, expect } from 'vitest';
import {
  parseSubtitle,
  extractReadingAnnotations,
  buildReadingAnnotationHtml,
  extractDisplayReading,
  parseWorkName,
  shouldRemoveParentheticalContent,
  stripSpeakerNamePrefixes,
} from './subtitleParsing';
import * as subtitleParsingModule from './subtitleParsing';
import type { LanguageData } from '../../shared/types';

const jaReadingData: LanguageData = {
  name: 'Japanese',
  colour_codes: {},
  settings: { fixed: {} },
  textProcessing: {
    scriptProfile: { acceptedScripts: ['Hira', 'Kana', 'Han'] },
    lexemeNormalization: {
      type: 'surface-reading',
      surfaceScripts: ['Han'],
      readingScripts: ['Hira', 'Kana'],
      readingNormalizer: 'kana-to-hiragana',
      preserveNonPrimaryReadingScript: true,
    },
    readingAnnotation: {
      type: 'script-reading',
      annotationScripts: ['Han'],
      surfaceSuffixScripts: ['Hira', 'Kana'],
      readingSeparator: '',
      stripParentheticalReadings: true,
    },
    tokenJoinSeparator: '',
  },
};

const arabicRomanizationData: LanguageData = {
  name: 'Arabic',
  colour_codes: {},
  settings: { fixed: {} },
  textProcessing: {
    scriptProfile: { acceptedScripts: ['Arab'] },
    lexemeNormalization: {
      type: 'reading',
      surfaceScripts: ['Arab'],
      readingScripts: ['Latn'],
      readingExtraCharacters: ['ʿ', 'ʾ'],
    },
    readingAnnotation: {
      type: 'script-reading',
      annotationScripts: ['Arab'],
      stripParentheticalReadings: true,
    },
  },
};

describe('parseSubtitle', () => {
  it('does not expose deprecated furigana-named parsing aliases', () => {
    expect('extractFurigana' in subtitleParsingModule).toBe(false);
    expect('buildFuriganaHtml' in subtitleParsingModule).toBe(false);
  });

  it('does not expose the deprecated kana-specific display-reading alias', () => {
    expect('extractKanaReading' in subtitleParsingModule).toBe(false);
  });

  it('returns empty text and no overrides for empty string', () => {
    expect(parseSubtitle('', 'ja')).toEqual({ text: '', readingOverrides: [] });
  });

  it('returns empty text and no overrides for null-ish value', () => {
    // @ts-expect-error testing falsy input
    expect(parseSubtitle(null, 'ja')).toEqual({ text: '', readingOverrides: [] });
  });

  it('returns plain text unchanged when no furigana present', () => {
    const result = parseSubtitle('こんにちは', 'ja', jaReadingData);
    expect(result.text).toBe('こんにちは');
    expect(result.readingOverrides).toEqual([]);
  });

  it('extracts reading override from ASCII-paren furigana', () => {
    const result = parseSubtitle('漢字(かんじ)', 'ja', jaReadingData);
    expect(result.readingOverrides).toEqual([{ word: '漢字', reading: 'かんじ' }]);
  });

  it('cleans ASCII-paren furigana from text, keeping only kanji', () => {
    const result = parseSubtitle('漢字(かんじ)です', 'ja', jaReadingData);
    expect(result.text).toBe('漢字です');
  });

  it('extracts reading override from full-width JP-paren furigana', () => {
    const result = parseSubtitle('漢字（かんじ）', 'ja', jaReadingData);
    expect(result.readingOverrides).toEqual([{ word: '漢字', reading: 'かんじ' }]);
  });

  it('cleans JP-paren furigana from text, keeping only kanji', () => {
    const result = parseSubtitle('漢字（かんじ）です', 'ja', jaReadingData);
    expect(result.text).toBe('漢字です');
  });

  it('extracts multiple reading overrides from a single line', () => {
    const result = parseSubtitle('百夜(ひゃくや)優一郎(ゆういちろう)', 'ja', jaReadingData);
    expect(result.readingOverrides).toContainEqual({ word: '百夜', reading: 'ひゃくや' });
    expect(result.readingOverrides).toContainEqual({ word: '優一郎', reading: 'ゆういちろう' });
    expect(result.readingOverrides).toHaveLength(2);
  });

  it('cleans multiple reading annotations, preserving base text', () => {
    const result = parseSubtitle('百夜(ひゃくや)優一郎(ゆういちろう)', 'ja', jaReadingData);
    expect(result.text).toBe('百夜優一郎');
  });

  it('does NOT create override for plain kana word before parens (no kanji)', () => {
    const result = parseSubtitle('きのう(yesterday)', 'ja', jaReadingData);
    expect(result.readingOverrides).toEqual([]);
  });

  it('does NOT create override for Latin word before parens', () => {
    const result = parseSubtitle('hello(world)', 'ja', jaReadingData);
    expect(result.readingOverrides).toEqual([]);
  });

  it('preserves parenthetical content for German subtitles', () => {
    const result = parseSubtitle('Hallo (leise)', 'de');
    expect(result.text).toBe('Hallo (leise)');
    expect(result.readingOverrides).toEqual([]);
  });

  it('uses language metadata to consume parenthetical readings for non-Japanese packages', () => {
    const result = parseSubtitle('你好(ni hao)', 'zh', {
      textProcessing: {
        scriptProfile: {
          acceptedScripts: ['Han', 'Latn'],
        },
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
    });
    expect(result.text).toBe('你好');
    expect(result.readingOverrides).toEqual([{ word: '你好', reading: 'ni hao' }]);
  });

  it('lets language metadata keep parenthetical text even with reading scripts configured', () => {
    const result = parseSubtitle('你好(ni hao)', 'zh', {
      textProcessing: {
        scriptProfile: {
          acceptedScripts: ['Han', 'Latn'],
        },
        lexemeNormalization: {
          type: 'reading',
          surfaceScripts: ['Han'],
          readingScripts: ['Latn'],
        },
        readingAnnotation: {
          type: 'script-reading',
          annotationScripts: ['Han'],
          stripParentheticalReadings: false,
        },
      },
    });
    expect(result.text).toBe('你好(ni hao)');
    expect(result.readingOverrides).toEqual([{ word: '你好', reading: 'ni hao' }]);
  });

  it('rejects parenthetical readings outside the configured reading scripts', () => {
    const result = parseSubtitle('你好(に hao)', 'zh', {
      textProcessing: {
        scriptProfile: {
          acceptedScripts: ['Han', 'Latn'],
        },
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
    });
    expect(result.text).toBe('你好(に hao)');
    expect(result.readingOverrides).toEqual([]);
  });

  it('preserves parenthetical text that is outside configured reading scripts', () => {
    const result = parseSubtitle('你好(静かに)', 'zh', {
      textProcessing: {
        scriptProfile: {
          acceptedScripts: ['Han', 'Latn'],
        },
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
    });
    expect(result.text).toBe('你好(静かに)');
    expect(result.readingOverrides).toEqual([]);
  });

  it('does not assume Japanese scripts when parenthetical stripping is enabled without script metadata', () => {
    const result = parseSubtitle('你好(ni hao) 漢字(かんじ)', 'third-party', {
      textProcessing: {
        readingAnnotation: {
          type: 'script-reading',
          stripParentheticalReadings: true,
        },
      },
    });
    expect(result.text).toBe('你好(ni hao) 漢字(かんじ)');
    expect(result.readingOverrides).toEqual([]);
  });

  it('accepts package-declared transliteration marks in parenthetical readings', () => {
    const result = parseSubtitle('العربية(al-ʿarabiyya)', 'ar', arabicRomanizationData);
    expect(result.text).toBe('العربية');
    expect(result.readingOverrides).toEqual([{ word: 'العربية', reading: 'al-ʿarabiyya' }]);
  });

  it('rejects undeclared transliteration marks in parenthetical readings', () => {
    const result = parseSubtitle('العربية(al-ʿarabiyya)', 'ar', {
      ...arabicRomanizationData,
      textProcessing: {
        ...arabicRomanizationData.textProcessing,
        lexemeNormalization: {
          ...arabicRomanizationData.textProcessing?.lexemeNormalization,
          readingExtraCharacters: [],
        },
      },
    });
    expect(result.text).toBe('العربية(al-ʿarabiyya)');
    expect(result.readingOverrides).toEqual([]);
  });

  it('handles mixed text: kanji+furigana alongside plain kana', () => {
    const result = parseSubtitle('今日(きょう) 天気(てんき)ですね', 'ja', jaReadingData);
    expect(result.readingOverrides).toContainEqual({ word: '今日', reading: 'きょう' });
    expect(result.readingOverrides).toContainEqual({ word: '天気', reading: 'てんき' });
    expect(result.text).toBe('今日 天気ですね');
  });

  it('handles mixed ASCII and JP parens in same text', () => {
    const result = parseSubtitle('漢字（かんじ）文字(もじ)', 'ja', jaReadingData);
    expect(result.readingOverrides).toContainEqual({ word: '漢字', reading: 'かんじ' });
    expect(result.readingOverrides).toContainEqual({ word: '文字', reading: 'もじ' });
  });
});

describe('extractReadingAnnotations', () => {
  it('returns empty array for empty string', () => {
    expect(extractReadingAnnotations('')).toEqual([]);
  });

  it('returns empty array for falsy input', () => {
    // @ts-expect-error testing falsy input
    expect(extractReadingAnnotations(null)).toEqual([]);
  });

  it('keeps ASCII-parenthetical text as plain text without language metadata', () => {
    const result = extractReadingAnnotations('漢字(かんじ)');
    expect(result).toEqual([{ text: '漢字(かんじ)' }]);
  });

  it('keeps non-reading parenthetical text as plain text without language metadata', () => {
    const result = extractReadingAnnotations('hello(world)');
    expect(result).toEqual([{ text: 'hello(world)' }]);
  });

  it('extracts single segment with ASCII-paren reading when language metadata opts in', () => {
    const result = extractReadingAnnotations('漢字(かんじ)', jaReadingData);
    expect(result).toEqual([{ text: '漢字', reading: 'かんじ' }]);
  });

  it('extracts single segment with JP-paren reading when language metadata opts in', () => {
    const result = extractReadingAnnotations('漢字（かんじ）', jaReadingData);
    expect(result).toEqual([{ text: '漢字', reading: 'かんじ' }]);
  });

  it('extracts script-configured readings for non-Japanese language packages', () => {
    const result = extractReadingAnnotations('你好(ni hao)', {
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
    });
    expect(result).toEqual([{ text: '你好', reading: 'ni hao' }]);
  });

  it('extracts multiple segments from compound furigana text', () => {
    const result = extractReadingAnnotations('百夜(ひゃくや)優一郎(ゆういちろう)', jaReadingData);
    expect(result).toEqual([
      { text: '百夜', reading: 'ひゃくや' },
      { text: '優一郎', reading: 'ゆういちろう' },
    ]);
  });

  it('returns a segment without reading for plain text with no parens', () => {
    const result = extractReadingAnnotations('こんにちは');
    expect(result).toEqual([{ text: 'こんにちは' }]);
  });

  it('returns segments without reading for text that has no furigana', () => {
    const result = extractReadingAnnotations('hello world');
    expect(result.every(s => s.reading === undefined)).toBe(true);
  });

  it('handles mixed furigana and plain segments', () => {
    const result = extractReadingAnnotations('今日(きょう)は', jaReadingData);
    expect(result).toContainEqual({ text: '今日', reading: 'きょう' });
    expect(result).toContainEqual({ text: 'は' });
  });

  it('returns reading undefined (not empty string) for plain segments', () => {
    const result = extractReadingAnnotations('テスト');
    expect(result[0].reading).toBeUndefined();
  });

  it('handles text with only kanji and no readings', () => {
    const result = extractReadingAnnotations('漢字文字');
    expect(result).toEqual([{ text: '漢字文字' }]);
  });
});

describe('buildReadingAnnotationHtml', () => {
  it('returns empty string for empty array', () => {
    expect(buildReadingAnnotationHtml([])).toBe('');
  });

  it('returns ruby HTML for segment with reading', () => {
    expect(buildReadingAnnotationHtml([{ text: '漢字', reading: 'かんじ' }]))
      .toBe('<ruby>漢字<rt>かんじ</rt></ruby>');
  });

  it('returns plain text for segment without reading', () => {
    expect(buildReadingAnnotationHtml([{ text: 'こんにちは' }])).toBe('こんにちは');
  });

  it('concatenates multiple segments correctly', () => {
    const segments = [
      { text: '百夜', reading: 'ひゃくや' },
      { text: '優一郎', reading: 'ゆういちろう' },
    ];
    expect(buildReadingAnnotationHtml(segments)).toBe(
      '<ruby>百夜<rt>ひゃくや</rt></ruby><ruby>優一郎<rt>ゆういちろう</rt></ruby>'
    );
  });

  it('handles mixed segments (with and without reading)', () => {
    const segments = [
      { text: '今日', reading: 'きょう' },
      { text: 'は' },
      { text: '天気', reading: 'てんき' },
    ];
    expect(buildReadingAnnotationHtml(segments)).toBe(
      '<ruby>今日<rt>きょう</rt></ruby>は<ruby>天気<rt>てんき</rt></ruby>'
    );
  });

  it('produces valid ruby tag format with rt inside ruby', () => {
    const html = buildReadingAnnotationHtml([{ text: 'X', reading: 'Y' }]);
    expect(html).toMatch(/^<ruby>.*<rt>.*<\/rt><\/ruby>$/);
  });
});

describe('extractDisplayReading', () => {
  it('returns empty string for undefined', () => {
    expect(extractDisplayReading(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(extractDisplayReading('')).toBe('');
  });

  it('extracts kana from a single rt tag', () => {
    expect(extractDisplayReading('<ruby>漢字<rt>かんじ</rt></ruby>')).toBe('かんじ');
  });

  it('joins multiple rt tags into one string', () => {
    expect(
      extractDisplayReading('<ruby>百夜<rt>ひゃくや</rt></ruby><ruby>優一郎<rt>ゆういちろう</rt></ruby>')
    ).toBe('ひゃくやゆういちろう');
  });

  it('joins multiple rt tags with spaces for romanized reading metadata', () => {
    expect(
      extractDisplayReading('<ruby>你<rt>ni</rt></ruby><ruby>好<rt>hao</rt></ruby>', {
        textProcessing: {
          lexemeNormalization: {
            type: 'reading',
            surfaceScripts: ['Han'],
            readingScripts: ['Latn'],
          },
        },
      })
    ).toBe('ni hao');
  });

  it('returns plain kana as-is (no ruby markup)', () => {
    expect(extractDisplayReading('かんじ')).toBe('かんじ');
  });

  it('returns plain katakana as-is', () => {
    expect(extractDisplayReading('カンジ')).toBe('カンジ');
  });

  it('does not extract kana characters from mixed kanji+kana text without metadata', () => {
    const result = extractDisplayReading('漢字かな');
    expect(result).toBe('漢字かな');
  });

  it('extracts kana characters from mixed kanji+kana text when metadata declares kana readings', () => {
    const result = extractDisplayReading('漢字かな', jaReadingData);
    expect(result).toBe('かな');
  });

  it('extracts configured Latin reading text from mixed Chinese surface plus pinyin', () => {
    const result = extractDisplayReading('你好 ni3 hao3', {
      textProcessing: {
        lexemeNormalization: {
          type: 'reading',
          surfaceScripts: ['Han'],
          readingScripts: ['Latn'],
        },
      },
    });
    expect(result).toBe('ni3 hao3');
  });

  it('preserves spaces and tone marks for configured Latin readings', () => {
    const result = extractDisplayReading('你好 nǐ hǎo', {
      textProcessing: {
        lexemeNormalization: {
          type: 'reading',
          surfaceScripts: ['Han'],
          readingScripts: ['Latn'],
        },
      },
    });
    expect(result).toBe('nǐ hǎo');
  });

  it('extracts configured Latin transliteration from Arabic-script mixed readings', () => {
    const result = extractDisplayReading('کتاب ketab', {
      textProcessing: {
        lexemeNormalization: {
          type: 'reading',
          surfaceScripts: ['Arab'],
          readingScripts: ['Latn'],
        },
      },
    });
    expect(result).toBe('ketab');
  });

  it('preserves package-declared modifier letters in Arabic romanization readings', () => {
    const result = extractDisplayReading('العربية al-ʿarabiyya', arabicRomanizationData);
    expect(result).toBe('al-ʿarabiyya');
  });

  it('drops undeclared modifier letters from Arabic romanization readings', () => {
    const result = extractDisplayReading('العربية al-ʿarabiyya', {
      ...arabicRomanizationData,
      textProcessing: {
        ...arabicRomanizationData.textProcessing,
        lexemeNormalization: {
          ...arabicRomanizationData.textProcessing?.lexemeNormalization,
          readingExtraCharacters: [],
        },
      },
    });
    expect(result).toBe('al-arabiyya');
  });

  it('handles HTML without rt tags by normalizing with normalizeReading', () => {
    const result = extractDisplayReading('<b>かんじ</b>');
    expect(result).toBe('かんじ');
  });

  it('handles reading with only kanji and no kana gracefully', () => {
    const result = extractDisplayReading('漢字');
    expect(typeof result).toBe('string');
  });

  it('preserves non-kana readings when no kana is present', () => {
    expect(extractDisplayReading('hallo')).toBe('hallo');
  });

  it('does not use legacy kana extraction for installed languages without reading scripts', () => {
    expect(extractDisplayReading('漢字かな', {
      name: 'Chinese',
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Han'] },
        readingAnnotation: {
          type: 'script-reading',
          annotationScripts: ['Han'],
        },
      },
    })).toBe('漢字かな');
  });
});

describe('shouldRemoveParentheticalContent', () => {
  it('returns false without language metadata', () => {
    expect(shouldRemoveParentheticalContent('ja')).toBe(false);
  });

  it('returns true when language metadata enables parenthetical readings', () => {
    expect(shouldRemoveParentheticalContent('ja', jaReadingData)).toBe(true);
  });

  it('returns false for German', () => {
    expect(shouldRemoveParentheticalContent('de')).toBe(false);
  });
});

describe('stripSpeakerNamePrefixes', () => {
  it('strips Latin speaker names for Latin-script languages', () => {
    expect(stripSpeakerNamePrefixes('Alice: Hello\nBob: Hi', 'en')).toBe('Hello\nHi');
  });

  it('strips Cyrillic speaker names using language script metadata', () => {
    expect(stripSpeakerNamePrefixes('Анна: Привет', 'ru', {
      name: 'Russian',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Cyrl'] },
      },
    })).toBe('Привет');
  });

  it('strips Arabic-script speaker names using language script metadata', () => {
    expect(stripSpeakerNamePrefixes('سارة: مرحبا', 'ar', {
      name: 'Arabic',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Arab'] },
      },
    })).toBe('مرحبا');
  });

  it('strips full-width colon speaker names for Han subtitles', () => {
    expect(stripSpeakerNamePrefixes('太郎：こんにちは', 'ja', {
      name: 'Japanese',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Hira', 'Kana', 'Han'] },
      },
    })).toBe('こんにちは');
  });

  it('does not strip Latin speaker names for non-Latin packages unless metadata opts in', () => {
    const languageData: LanguageData = {
      name: 'Japanese',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Hira', 'Kana', 'Han'] },
      },
    };

    expect(stripSpeakerNamePrefixes('Alice: こんにちは', 'ja', languageData)).toBe('Alice: こんにちは');
    expect(stripSpeakerNamePrefixes('Alice: こんにちは', 'ja', {
      ...languageData,
      textProcessing: {
        subtitle: {
          speakerNamePrefix: {
            allowLatinFallback: true,
          },
        },
      },
    })).toBe('こんにちは');
  });

  it('does not strip URLs or sentence-like labels', () => {
    expect(stripSpeakerNamePrefixes('https://example.com/video', 'en')).toBe('https://example.com/video');
    expect(stripSpeakerNamePrefixes('This is not a speaker: keep it', 'en')).toBe('This is not a speaker: keep it');
  });

  it('allows language metadata to disable speaker-name stripping', () => {
    expect(stripSpeakerNamePrefixes('Alice: Hello', 'en', {
      name: 'English',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Latn'] },
        subtitle: {
          speakerNamePrefix: {
            enabled: false,
          },
        },
      },
    })).toBe('Alice: Hello');
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

  it('removes generic trailing BCP47-style language tags without a bundled language list', () => {
    expect(parseWorkName('Show.S01E01.fa.IR.srt')).toBe('Show S01E1');
    expect(parseWorkName('Drama.zh.Hant.srt')).toBe('Drama');
    expect(parseWorkName('Movie.sr.Latn.RS.srt')).toBe('Movie');
  });

  it('does not remove short title words that are not trailing lowercase tags', () => {
    expect(parseWorkName('It.Crowd.S01E01.srt')).toBe('It Crowd S01E1');
    expect(parseWorkName('No.Country.For.Old.Men.srt')).toBe('No Country For Old Men');
  });

  it('removes caller-provided language tags for third-party language packages', () => {
    const result = parseWorkName('Show.S01E01.fa.IR.srt', {
      languageCodes: ['fa', 'IR'],
    });
    expect(result.split(' ')).not.toContain('fa');
    expect(result.split(' ')).not.toContain('IR');
    expect(result).toContain('Show');
  });

  it('expands caller-provided BCP47 language tags during display-name cleanup', () => {
    const result = parseWorkName('Show.S01E01.fa.IR.srt', {
      languageCodes: ['fa-IR'],
    });
    expect(result.split(' ')).not.toContain('fa');
    expect(result.split(' ')).not.toContain('IR');
    expect(result).toBe('Show S01E1');
  });

  it('removes script subtags from caller-provided language codes', () => {
    const result = parseWorkName('Drama.zh.Hant.srt', {
      languageCodes: ['zh-Hant'],
    });
    expect(result.split(' ')).not.toContain('zh');
    expect(result.split(' ')).not.toContain('Hant');
    expect(result).toBe('Drama');
  });

  it('removes caller-provided release tags', () => {
    expect(parseWorkName('Show.CustomGroup.srt', {
      releaseTags: ['CustomGroup'],
    })).toBe('Show');
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
