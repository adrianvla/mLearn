import { describe, it, expect } from 'vitest'
import {
  KANJI_REGEX,
  KANA_ONLY_REGEX,
  KANA_EXTRACT_REGEX,
  SMALL_KANA,
  containsKanji,
  isAllKana,
  katakanaToHiragana,
  extractKanjiChars,
  extractKana,
  isLatinOnly,
  isWordInLanguageScript,
  isValidSTTResult,
  normalizeReading,
  escapeHtml,
  stripFurigana,
  applyRubyReadings,
  stripHtmlForTts,
  getLanguageDisplayName,
} from '@shared/utils/textUtils'

describe('KANJI_REGEX', () => {
  it('matches a common kanji', () => {
    expect(KANJI_REGEX.test('日')).toBe(true)
  })

  it('matches kanji in mixed text', () => {
    expect(KANJI_REGEX.test('今日はいい天気です')).toBe(true)
  })

  it('does not match hiragana', () => {
    expect(KANJI_REGEX.test('あいうえお')).toBe(false)
  })

  it('does not match katakana', () => {
    expect(KANJI_REGEX.test('アイウエオ')).toBe(false)
  })

  it('does not match Latin text', () => {
    expect(KANJI_REGEX.test('hello world')).toBe(false)
  })
})

describe('KANA_ONLY_REGEX', () => {
  it('matches pure hiragana', () => {
    expect(KANA_ONLY_REGEX.test('あいうえお')).toBe(true)
  })

  it('matches pure katakana', () => {
    expect(KANA_ONLY_REGEX.test('アイウエオ')).toBe(true)
  })

  it('matches mixed hiragana and katakana', () => {
    expect(KANA_ONLY_REGEX.test('あいアイ')).toBe(true)
  })

  it('does not match text with kanji', () => {
    expect(KANA_ONLY_REGEX.test('漢字あいう')).toBe(false)
  })

  it('does not match Latin text', () => {
    expect(KANA_ONLY_REGEX.test('hello')).toBe(false)
  })

  it('matches kana with whitespace', () => {
    expect(KANA_ONLY_REGEX.test('あいう えお')).toBe(true)
  })
})

describe('KANA_EXTRACT_REGEX', () => {
  it('is a global regex', () => {
    expect(KANA_EXTRACT_REGEX.flags).toContain('g')
  })

  it('matches hiragana characters', () => {
    const matches = 'あ日う'.match(KANA_EXTRACT_REGEX)
    expect(matches).toEqual(['あ', 'う'])
  })

  it('matches katakana characters', () => {
    const matches = 'アBイ'.match(KANA_EXTRACT_REGEX)
    expect(matches).toEqual(['ア', 'イ'])
  })

  it('returns null when no kana present', () => {
    expect('hello 123'.match(KANA_EXTRACT_REGEX)).toBeNull()
  })
})

describe('SMALL_KANA', () => {
  it('is a Set', () => {
    expect(SMALL_KANA).toBeInstanceOf(Set)
  })

  it('contains small hiragana ya', () => {
    expect(SMALL_KANA.has('ゃ')).toBe(true)
  })

  it('contains small katakana yu', () => {
    expect(SMALL_KANA.has('ュ')).toBe(true)
  })

  it('contains small hiragana a', () => {
    expect(SMALL_KANA.has('ぁ')).toBe(true)
  })

  it('does not contain regular hiragana a', () => {
    expect(SMALL_KANA.has('あ')).toBe(false)
  })

  it('does not contain kanji', () => {
    expect(SMALL_KANA.has('漢')).toBe(false)
  })
})

// ============================================================================
// containsKanji
// ============================================================================

describe('containsKanji', () => {
  it('returns true for a single kanji', () => {
    expect(containsKanji('字')).toBe(true)
  })

  it('returns true for kanji in mixed text', () => {
    expect(containsKanji('東京に行きます')).toBe(true)
  })

  it('returns true for Chinese text', () => {
    expect(containsKanji('北京是中国的首都')).toBe(true)
  })

  it('returns false for pure hiragana', () => {
    expect(containsKanji('ひらがな')).toBe(false)
  })

  it('returns false for pure katakana', () => {
    expect(containsKanji('カタカナ')).toBe(false)
  })

  it('returns false for Latin text', () => {
    expect(containsKanji('hello')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(containsKanji('')).toBe(false)
  })
})

// ============================================================================
// isAllKana
// ============================================================================

describe('isAllKana', () => {
  it('returns true for pure hiragana', () => {
    expect(isAllKana('あいうえお')).toBe(true)
  })

  it('returns true for pure katakana', () => {
    expect(isAllKana('アイウエオ')).toBe(true)
  })

  it('returns true for mixed kana with whitespace', () => {
    expect(isAllKana('あいう アイウ')).toBe(true)
  })

  it('returns false for text with kanji', () => {
    expect(isAllKana('漢字')).toBe(false)
  })

  it('returns false for text with Latin letters', () => {
    expect(isAllKana('あいuえお')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isAllKana('')).toBe(false)
  })

  it('returns true for katakana phonetic extension characters', () => {
    expect(isAllKana('ヲァィ')).toBe(true)
  })
})

// ============================================================================
// katakanaToHiragana
// ============================================================================

describe('katakanaToHiragana', () => {
  it('converts basic katakana to hiragana', () => {
    expect(katakanaToHiragana('アイウエオ')).toBe('あいうえお')
  })

  it('converts a full katakana word', () => {
    expect(katakanaToHiragana('コンピュータ')).toBe('こんぴゅーた')
  })

  it('passes hiragana through unchanged', () => {
    expect(katakanaToHiragana('あいうえお')).toBe('あいうえお')
  })

  it('passes Latin characters through unchanged', () => {
    expect(katakanaToHiragana('ABC')).toBe('ABC')
  })

  it('handles mixed katakana and other characters', () => {
    expect(katakanaToHiragana('アBCあ123')).toBe('あBCあ123')
  })

  it('returns empty string for empty input', () => {
    expect(katakanaToHiragana('')).toBe('')
  })

  it('converts boundary katakana ァ correctly', () => {
    expect(katakanaToHiragana('ァ')).toBe('ぁ')
  })

  it('converts boundary katakana ヶ correctly', () => {
    expect(katakanaToHiragana('ヶ')).toBe('ヶ'.charCodeAt(0) >= 0x30A1 ? 'ゖ' : 'ヶ')
  })
})

// ============================================================================
// extractKanjiChars
// ============================================================================

describe('extractKanjiChars', () => {
  it('extracts distinct kanji from mixed text', () => {
    expect(extractKanjiChars('東京に行きます')).toEqual(new Set(['東', '京', '行']))
  })

  it('returns empty set for pure hiragana', () => {
    expect(extractKanjiChars('あいうえお')).toEqual(new Set())
  })

  it('returns empty set for pure katakana', () => {
    expect(extractKanjiChars('アイウエオ')).toEqual(new Set())
  })

  it('returns empty set for Latin text', () => {
    expect(extractKanjiChars('hello')).toEqual(new Set())
  })

  it('returns empty set for empty string', () => {
    expect(extractKanjiChars('')).toEqual(new Set())
  })

  it('deduplicates repeated kanji', () => {
    expect(extractKanjiChars('漢漢漢')).toEqual(new Set(['漢']))
  })

  it('handles Chinese text', () => {
    expect(extractKanjiChars('北京是中国的首都')).toEqual(new Set(['北', '京', '是', '中', '国', '的', '首', '都']))
  })

  it('ignores kana mixed with kanji', () => {
    const result = extractKanjiChars('漢あ字い')
    expect(result).toEqual(new Set(['漢', '字']))
    expect(result.has('あ')).toBe(false)
    expect(result.has('い')).toBe(false)
  })

  it('handles CJK Extension A characters', () => {
    expect(extractKanjiChars('\u3400')).toEqual(new Set(['\u3400']))
  })

  it('handles CJK Compatibility Ideographs', () => {
    expect(extractKanjiChars('\uF900')).toEqual(new Set(['\uF900']))
  })
})

// ============================================================================
// extractKana
// ============================================================================

describe('extractKana', () => {
  it('extracts hiragana from mixed text', () => {
    expect(extractKana('東京あいう')).toBe('あいう')
  })

  it('extracts katakana from mixed text', () => {
    expect(extractKana('TokyoアイウEFG')).toBe('アイウ')
  })

  it('extracts both hiragana and katakana from mixed text', () => {
    expect(extractKana('日本語あいアイ漢字')).toBe('あいアイ')
  })

  it('returns empty string when no kana present', () => {
    expect(extractKana('hello 123 漢字')).toBe('')
  })

  it('returns empty string for empty input', () => {
    expect(extractKana('')).toBe('')
  })

  it('returns all kana when input is pure kana', () => {
    expect(extractKana('あいうえお')).toBe('あいうえお')
  })
})

// ============================================================================
// isLatinOnly
// ============================================================================

describe('isLatinOnly', () => {
  it('returns true for basic English text', () => {
    expect(isLatinOnly('hello world')).toBe(true)
  })

  it('returns true for text with accented Latin chars', () => {
    expect(isLatinOnly('café résumé')).toBe(true)
  })

  it('returns true for mixed Latin and digits', () => {
    expect(isLatinOnly('hello123')).toBe(true)
  })

  it('returns false for text with kanji', () => {
    expect(isLatinOnly('hello 漢字')).toBe(false)
  })

  it('returns false for text with hiragana', () => {
    expect(isLatinOnly('hello あいう')).toBe(false)
  })

  it('returns false for pure digits and punctuation (no Latin letters)', () => {
    expect(isLatinOnly('123!?')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isLatinOnly('')).toBe(false)
  })

  it('returns false for whitespace-only string', () => {
    expect(isLatinOnly('   ')).toBe(false)
  })

  it('returns false for Korean text', () => {
    expect(isLatinOnly('안녕하세요')).toBe(false)
  })
})

// ============================================================================
// isWordInLanguageScript
// ============================================================================

describe('isWordInLanguageScript', () => {
  describe('Japanese (ja)', () => {
    it('returns true for a hiragana word', () => {
      expect(isWordInLanguageScript('あいうえお', 'ja')).toBe(true)
    })

    it('returns true for a katakana word', () => {
      expect(isWordInLanguageScript('コンピュータ', 'ja')).toBe(true)
    })

    it('returns true for a kanji word', () => {
      expect(isWordInLanguageScript('東京都', 'ja')).toBe(true)
    })

    it('returns false for pure Latin in Japanese', () => {
      expect(isWordInLanguageScript('hello', 'ja')).toBe(false)
    })

    it('returns false for pure Korean in Japanese', () => {
      expect(isWordInLanguageScript('안녕하세요', 'ja')).toBe(false)
    })
  })

  describe('Chinese (zh)', () => {
    it('returns true for CJK ideographs', () => {
      expect(isWordInLanguageScript('北京', 'zh')).toBe(true)
    })

    it('returns true for zh-CN variant', () => {
      expect(isWordInLanguageScript('中文', 'zh-CN')).toBe(true)
    })

    it('returns true for zh-TW variant', () => {
      expect(isWordInLanguageScript('台灣', 'zh-TW')).toBe(true)
    })

    it('returns false for Latin in Chinese', () => {
      expect(isWordInLanguageScript('hello', 'zh')).toBe(false)
    })
  })

  describe('Korean (ko)', () => {
    it('returns true for Hangul text', () => {
      expect(isWordInLanguageScript('안녕하세요', 'ko')).toBe(true)
    })

    it('returns true for Hanja/CJK in Korean', () => {
      expect(isWordInLanguageScript('漢字', 'ko')).toBe(true)
    })

    it('returns false for pure Latin in Korean', () => {
      expect(isWordInLanguageScript('hello', 'ko')).toBe(false)
    })
  })

  describe('Edge cases', () => {
    it('returns false for empty string', () => {
      expect(isWordInLanguageScript('', 'ja')).toBe(false)
    })

    it('returns false for single character', () => {
      expect(isWordInLanguageScript('あ', 'ja')).toBe(false)
    })

    it('returns false for pure numbers', () => {
      expect(isWordInLanguageScript('1234', 'ja')).toBe(false)
    })

    it('returns false for pure punctuation', () => {
      expect(isWordInLanguageScript('...', 'ja')).toBe(false)
    })

    it('handles unknown language by accepting words with letters', () => {
      expect(isWordInLanguageScript('hello', 'xx')).toBe(true)
    })

    it('accepts Latin-script words for German', () => {
      expect(isWordInLanguageScript('Straße', 'de')).toBe(true)
    })

    it('accepts Cyrillic-script words for Russian', () => {
      expect(isWordInLanguageScript('привет', 'ru')).toBe(true)
    })

    it('rejects pure Latin words for Russian', () => {
      expect(isWordInLanguageScript('hello', 'ru')).toBe(false)
    })
  })
})

// ============================================================================
// isValidSTTResult
// ============================================================================

describe('isValidSTTResult', () => {
  describe('empty / trivial inputs', () => {
    it('returns false for empty string', () => {
      expect(isValidSTTResult('', 'ja')).toBe(false)
    })

    it('returns false for whitespace only', () => {
      expect(isValidSTTResult('   ', 'ja')).toBe(false)
    })

    it('returns false for single character', () => {
      expect(isValidSTTResult('あ', 'ja')).toBe(false)
    })
  })

  describe('Japanese (ja)', () => {
    it('returns true for text with hiragana', () => {
      expect(isValidSTTResult('こんにちは', 'ja')).toBe(true)
    })

    it('returns true for text with katakana', () => {
      expect(isValidSTTResult('コンピュータ', 'ja')).toBe(true)
    })

    it('returns true for mixed kanji and kana', () => {
      expect(isValidSTTResult('東京に行く', 'ja')).toBe(true)
    })

    it('returns true for Latin-only (romaji)', () => {
      expect(isValidSTTResult('konnichiwa', 'ja')).toBe(true)
    })

    it('returns false for short pure-CJK without kana (Chinese noise)', () => {
      expect(isValidSTTResult('哦呢', 'ja')).toBe(false)
    })

    it('returns false for Chinese noise particle', () => {
      expect(isValidSTTResult('哦', 'ja')).toBe(false)
    })
  })

  describe('Korean (ko)', () => {
    it('returns true for Hangul text', () => {
      expect(isValidSTTResult('안녕하세요', 'ko')).toBe(true)
    })

    it('returns true for Latin text in Korean context', () => {
      expect(isValidSTTResult('hello', 'ko')).toBe(true)
    })

    it('returns false for pure CJK without Hangul', () => {
      expect(isValidSTTResult('北京', 'ko')).toBe(false)
    })
  })

  describe('Chinese (zh)', () => {
    it('returns true for CJK text', () => {
      expect(isValidSTTResult('你好世界', 'zh')).toBe(true)
    })

    it('returns true for Chinese noise chars when target is zh', () => {
      expect(isValidSTTResult('哦呢', 'zh')).toBe(true)
    })
  })

  describe('Latin-script languages (default)', () => {
    it('returns true for English text', () => {
      expect(isValidSTTResult('hello world', 'en')).toBe(true)
    })

    it('returns false for pure CJK in English context', () => {
      expect(isValidSTTResult('北京', 'en')).toBe(false)
    })

    it('returns true for Latin with some CJK mixed in', () => {
      expect(isValidSTTResult('hello 漢字', 'en')).toBe(true)
    })
  })

  describe('other locale-script languages', () => {
    it('returns true for Cyrillic text in Russian context', () => {
      expect(isValidSTTResult('привет мир', 'ru')).toBe(true)
    })

    it('returns false for pure Latin text in Russian context', () => {
      expect(isValidSTTResult('hello world', 'ru')).toBe(false)
    })

    it('returns true for Arabic text in Arabic context', () => {
      expect(isValidSTTResult('مرحبا بالعالم', 'ar')).toBe(true)
    })

    it('returns false for pure CJK text in German context', () => {
      expect(isValidSTTResult('北京', 'de')).toBe(false)
    })
  })
})

// ============================================================================
// normalizeReading
// ============================================================================

describe('normalizeReading', () => {
  it('strips HTML tags', () => {
    expect(normalizeReading('<b>きょう</b>')).toBe('きょう')
  })

  it('removes text after accent_start marker', () => {
    const input = 'きょう<!-- accent_start --><!-- some accent data -->'
    expect(normalizeReading(input)).toBe('きょう')
  })

  it('collapses whitespace', () => {
    expect(normalizeReading('  き  ょ  う  ')).toBe('きょう')
  })

  it('replaces non-breaking spaces', () => {
    expect(normalizeReading('き\u00A0ょう')).toBe('きょう')
  })

  it('returns empty string for non-string input', () => {
    expect(normalizeReading(null as unknown as string)).toBe('')
  })

  it('returns empty string for empty string', () => {
    expect(normalizeReading('')).toBe('')
  })

  it('handles complex HTML with multiple tags', () => {
    expect(normalizeReading('<span class="x">にほん<b>ご</b></span>')).toBe('にほんご')
  })
})

// ============================================================================
// escapeHtml
// ============================================================================

describe('escapeHtml', () => {
  it('escapes ampersands', () => {
    expect(escapeHtml('foo & bar')).toBe('foo &amp; bar')
  })

  it('escapes less-than', () => {
    expect(escapeHtml('a < b')).toBe('a &lt; b')
  })

  it('escapes greater-than', () => {
    expect(escapeHtml('a > b')).toBe('a &gt; b')
  })

  it('escapes double quotes', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;')
  })

  it('escapes single quotes', () => {
    expect(escapeHtml("it's")).toBe('it&#039;s')
  })

  it('escapes all special chars together', () => {
    expect(escapeHtml('<script>alert("xss&\'injection\'");</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&amp;&#039;injection&#039;&quot;);&lt;/script&gt;'
    )
  })

  it('returns empty string for empty input', () => {
    expect(escapeHtml('')).toBe('')
  })

  it('passes plain text through unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world')
  })
})

// ============================================================================
// stripFurigana
// ============================================================================

describe('stripFurigana', () => {
  it('removes rt content from ruby markup', () => {
    expect(stripFurigana('<ruby>漢字<rt>かんじ</rt></ruby>')).toBe('漢字')
  })

  it('removes ruby tags but keeps base text', () => {
    expect(stripFurigana('<ruby>主<rt>おも</rt></ruby>に')).toBe('主に')
  })

  it('removes parenthesized hiragana readings', () => {
    expect(stripFurigana('漢字(かんじ)')).toBe('漢字')
  })

  it('removes parenthesized katakana readings', () => {
    expect(stripFurigana('漢字(カンジ)')).toBe('漢字')
  })

  it('removes full-width parenthesized readings', () => {
    expect(stripFurigana('漢字（かんじ）')).toBe('漢字')
  })

  it('removes rp tags', () => {
    expect(stripFurigana('<ruby>字<rp>(</rp><rt>じ</rt><rp>)</rp></ruby>')).toBe('字()')
  })

  it('returns empty string for empty input', () => {
    expect(stripFurigana('')).toBe('')
  })

  it('passes plain text through unchanged', () => {
    expect(stripFurigana('こんにちは')).toBe('こんにちは')
  })
})

// ============================================================================
// applyRubyReadings
// ============================================================================

describe('applyRubyReadings', () => {
  it('replaces ruby block with rt reading', () => {
    expect(applyRubyReadings('<ruby>漢字<rt>かんじ</rt></ruby>です')).toBe('かんじです')
  })

  it('handles multiple ruby blocks', () => {
    const input = '<ruby>東<rt>ひがし</rt></ruby><ruby>京<rt>きょう</rt></ruby>'
    expect(applyRubyReadings(input)).toBe('ひがしきょう')
  })

  it('strips remaining HTML tags after ruby replacement', () => {
    expect(applyRubyReadings('<b>hello</b>')).toBe('hello')
  })

  it('returns empty string for empty input', () => {
    expect(applyRubyReadings('')).toBe('')
  })

  it('handles ruby block with no rt tag by stripping inner tags', () => {
    expect(applyRubyReadings('<ruby><b>漢字</b></ruby>')).toBe('漢字')
  })

  it('trims leading/trailing whitespace from result', () => {
    expect(applyRubyReadings('  <ruby>字<rt>じ</rt></ruby>  ')).toBe('じ')
  })
})

// ============================================================================
// stripHtmlForTts
// ============================================================================

describe('stripHtmlForTts', () => {
  it('strips ruby and keeps kanji when useReadings=false (default)', () => {
    expect(stripHtmlForTts('<ruby>漢字<rt>かんじ</rt></ruby>です')).toBe('漢字です')
  })

  it('replaces kanji with readings when useReadings=true', () => {
    expect(stripHtmlForTts('<ruby>漢字<rt>かんじ</rt></ruby>です', true)).toBe('かんじです')
  })

  it('strips all HTML tags from plain HTML', () => {
    expect(stripHtmlForTts('<b>hello</b> <i>world</i>')).toBe('hello world')
  })

  it('returns empty string for empty input', () => {
    expect(stripHtmlForTts('')).toBe('')
  })

  it('handles text without any HTML unchanged', () => {
    expect(stripHtmlForTts('こんにちは世界')).toBe('こんにちは世界')
  })

  it('handles useReadings=false on plain text', () => {
    expect(stripHtmlForTts('日本語', false)).toBe('日本語')
  })
})

// ============================================================================
// getLanguageDisplayName
// ============================================================================

describe('getLanguageDisplayName', () => {
  it('returns English for en', () => {
    expect(getLanguageDisplayName('en')).toBe('English')
  })

  it('returns Japanese for ja', () => {
    expect(getLanguageDisplayName('ja')).toBe('Japanese')
  })

  it('returns Chinese for zh', () => {
    expect(getLanguageDisplayName('zh')).toBe('Chinese')
  })

  it('returns Korean for ko', () => {
    expect(getLanguageDisplayName('ko')).toBe('Korean')
  })

  it('returns German for de', () => {
    expect(getLanguageDisplayName('de')).toBe('German')
  })

  it('returns the code itself for unknown codes', () => {
    expect(getLanguageDisplayName('xx')).toBe('xx')
  })

  it('returns the code itself for empty string', () => {
    expect(getLanguageDisplayName('')).toBe('')
  })

  it('returns Arabic for ar', () => {
    expect(getLanguageDisplayName('ar')).toBe('Arabic')
  })
})

// ============================================================================
// limitConsecutiveDots
// ============================================================================

describe('limitConsecutiveDots', () => {
  let limitConsecutiveDots: typeof import('./textUtils').limitConsecutiveDots

  beforeAll(async () => {
    const mod = await import('./textUtils')
    limitConsecutiveDots = mod.limitConsecutiveDots
  })

  it('returns empty string for empty input', () => {
    expect(limitConsecutiveDots('')).toBe('')
  })

  it('leaves text without dots unchanged', () => {
    expect(limitConsecutiveDots('hello world')).toBe('hello world')
  })

  it('preserves up to 3 consecutive dots', () => {
    expect(limitConsecutiveDots('wait...')).toBe('wait...')
  })

  it('collapses more than 3 consecutive ASCII dots', () => {
    expect(limitConsecutiveDots('wait......')).toBe('wait...')
  })

  it('collapses fullwidth dots (．)', () => {
    expect(limitConsecutiveDots('wait．．．．．')).toBe('wait...')
  })

  it('collapses mixed ASCII and fullwidth dots', () => {
    expect(limitConsecutiveDots('wait..．．．..')).toBe('wait...')
  })

  it('expands ellipsis character (…) and collapses', () => {
    expect(limitConsecutiveDots('wait……')).toBe('wait...')
  })

  it('handles multiple groups of dots in one string', () => {
    expect(limitConsecutiveDots('a.....b......c')).toBe('a...b...c')
  })

  it('respects custom max parameter', () => {
    expect(limitConsecutiveDots('a.....b', 2)).toBe('a..b')
  })

  it('preserves single dots (sentence endings)', () => {
    expect(limitConsecutiveDots('Hello. World.')).toBe('Hello. World.')
  })
})
