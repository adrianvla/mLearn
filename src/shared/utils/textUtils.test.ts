import { describe, it, expect } from 'vitest'
import * as textUtilsModule from '@shared/utils/textUtils'
import type { LanguageData } from '@shared/types'
import {
  HAN_IDEOGRAPH_REGEX,
  containsHanCharacters,
  isTextOnlyInScripts,
  katakanaToHiragana,
  extractHanCharacters,
  isLatinOnly,
  isWordInLanguageScript,
  isValidSTTResult,
  normalizeReading,
  normalizeWordLookupText,
  escapeHtml,
  stripRubyAnnotations,
  stripReadingAnnotations,
  findConfiguredParentheticalReadings,
  applyRubyReadings,
  stripHtmlForTts,
  getLanguageDisplayName,
} from '@shared/utils/textUtils'

describe('HAN_IDEOGRAPH_REGEX', () => {
  it('matches a common Han ideograph', () => {
    expect(HAN_IDEOGRAPH_REGEX.test('日')).toBe(true)
  })

  it('matches Han ideographs in mixed text', () => {
    expect(HAN_IDEOGRAPH_REGEX.test('今日はいい天気です')).toBe(true)
  })

  it('does not match hiragana', () => {
    expect(HAN_IDEOGRAPH_REGEX.test('あいうえお')).toBe(false)
  })

  it('does not match katakana', () => {
    expect(HAN_IDEOGRAPH_REGEX.test('アイウエオ')).toBe(false)
  })

  it('does not match Latin text', () => {
    expect(HAN_IDEOGRAPH_REGEX.test('hello world')).toBe(false)
  })

  it('does not expose the deprecated kanji regex alias', () => {
    expect('KANJI_REGEX' in textUtilsModule).toBe(false)
  })
})

// ============================================================================
// containsHanCharacters
// ============================================================================

describe('containsHanCharacters', () => {
  it('detects Han ideographs through the neutral helper', () => {
    expect(containsHanCharacters('北京')).toBe(true)
    expect(containsHanCharacters('ひらがな')).toBe(false)
  })

  it('does not expose the deprecated kanji helper alias', () => {
    expect('containsKanji' in textUtilsModule).toBe(false)
  })

  it('returns true for a single Han ideograph', () => {
    expect(containsHanCharacters('字')).toBe(true)
  })

  it('returns true for Han ideographs in mixed text', () => {
    expect(containsHanCharacters('東京に行きます')).toBe(true)
  })

  it('returns true for Chinese text', () => {
    expect(containsHanCharacters('北京是中国的首都')).toBe(true)
  })

  it('returns false for pure hiragana', () => {
    expect(containsHanCharacters('ひらがな')).toBe(false)
  })

  it('returns false for pure katakana', () => {
    expect(containsHanCharacters('カタカナ')).toBe(false)
  })

  it('returns false for Latin text', () => {
    expect(containsHanCharacters('hello')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(containsHanCharacters('')).toBe(false)
  })
})

describe('isTextOnlyInScripts', () => {
  it('allows non-letter tone markers around matching script letters', () => {
    expect(isTextOnlyInScripts('nǐ hǎo 3', ['Latn'])).toBe(true)
  })

  it('rejects letters outside the configured scripts', () => {
    expect(isTextOnlyInScripts('nǐ 好', ['Latn'])).toBe(false)
  })

  it('allows package-declared transliteration letters outside the base script', () => {
    expect(isTextOnlyInScripts('al-ʿarabiyya', ['Latn'], ['ʿ'])).toBe(true)
    expect(isTextOnlyInScripts('al-ʿarabiyya', ['Latn'])).toBe(false)
  })

  it('does not count extra transliteration characters as script letters by themselves', () => {
    expect(isTextOnlyInScripts('ʿʾ', ['Latn'], ['ʿ', 'ʾ'])).toBe(false)
  })

  it('requires at least one letter', () => {
    expect(isTextOnlyInScripts('123 - ', ['Latn'])).toBe(false)
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
// extractHanCharacters
// ============================================================================

describe('extractHanCharacters', () => {
  it('extracts Han ideographs through the neutral helper', () => {
    expect(extractHanCharacters('北京是中国')).toEqual(new Set(['北', '京', '是', '中', '国']))
  })

  it('does not expose the deprecated kanji extractor alias', () => {
    expect('extractKanjiChars' in textUtilsModule).toBe(false)
  })

  it('extracts distinct Han ideographs from mixed text', () => {
    expect(extractHanCharacters('東京に行きます')).toEqual(new Set(['東', '京', '行']))
  })

  it('returns empty set for pure hiragana', () => {
    expect(extractHanCharacters('あいうえお')).toEqual(new Set())
  })

  it('returns empty set for pure katakana', () => {
    expect(extractHanCharacters('アイウエオ')).toEqual(new Set())
  })

  it('returns empty set for Latin text', () => {
    expect(extractHanCharacters('hello')).toEqual(new Set())
  })

  it('returns empty set for empty string', () => {
    expect(extractHanCharacters('')).toEqual(new Set())
  })

  it('deduplicates repeated Han ideographs', () => {
    expect(extractHanCharacters('漢漢漢')).toEqual(new Set(['漢']))
  })

  it('handles Chinese text', () => {
    expect(extractHanCharacters('北京是中国的首都')).toEqual(new Set(['北', '京', '是', '中', '国', '的', '首', '都']))
  })

  it('ignores kana mixed with Han ideographs', () => {
    const result = extractHanCharacters('漢あ字い')
    expect(result).toEqual(new Set(['漢', '字']))
    expect(result.has('あ')).toBe(false)
    expect(result.has('い')).toBe(false)
  })

  it('handles CJK Extension A characters', () => {
    expect(extractHanCharacters('\u3400')).toEqual(new Set(['\u3400']))
  })

  it('handles CJK Compatibility Ideographs', () => {
    expect(extractHanCharacters('\uF900')).toEqual(new Set(['\uF900']))
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
  const thirdPartyArabicScriptLanguage: LanguageData = {
    name: 'Third Party Arabic Script',
    colour_codes: {},
    settings: { fixed: {} },
    textProcessing: {
      scriptProfile: {
        acceptedScripts: ['Arab'],
        minWordCodePoints: 2,
      },
    },
  }

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

    it('uses installed metadata for unknown third-party language codes', () => {
      expect(isWordInLanguageScript('سلام', 'x-mlearn-third-party', thirdPartyArabicScriptLanguage)).toBe(true)
      expect(isWordInLanguageScript('hello', 'x-mlearn-third-party', thirdPartyArabicScriptLanguage)).toBe(false)
    })

    it('does not fail open when a package uses a script outside the built-in table', () => {
      const thirdPartySyriacLanguage: LanguageData = {
        name: 'Third Party Syriac',
        colour_codes: {},
        settings: { fixed: {} },
        textProcessing: {
          scriptProfile: {
            acceptedScripts: ['Syrc'],
            minWordCodePoints: 2,
          },
        },
      }

      expect(isWordInLanguageScript('ܫܠܡܐ', 'x-mlearn-third-party', thirdPartySyriacLanguage)).toBe(true)
      expect(isWordInLanguageScript('hello', 'x-mlearn-third-party', thirdPartySyriacLanguage)).toBe(false)
    })

    it('keeps mixed-script words valid by default when they contain the required script', () => {
      expect(isWordInLanguageScript('سلامhello', 'x-mlearn-third-party', thirdPartyArabicScriptLanguage)).toBe(true)
    })

    it('can require every letter to be in accepted scripts for strict language packages', () => {
      const strictArabicScriptLanguage: LanguageData = {
        ...thirdPartyArabicScriptLanguage,
        textProcessing: {
          scriptProfile: {
            acceptedScripts: ['Arab'],
            minWordCodePoints: 2,
            wordScriptValidation: 'only-accepted',
          },
        },
      }

      expect(isWordInLanguageScript('سلام', 'x-mlearn-third-party', strictArabicScriptLanguage)).toBe(true)
      expect(isWordInLanguageScript('سلامhello', 'x-mlearn-third-party', strictArabicScriptLanguage)).toBe(false)
    })

    it('accepts romanized Latin words when package metadata allows romanization', () => {
      const pinyinAwareLanguage: LanguageData = {
        name: 'Pinyin Aware Chinese',
        colour_codes: {},
        settings: { fixed: {} },
        textProcessing: {
          scriptProfile: {
            acceptedScripts: ['Han'],
            requiredScripts: ['Han'],
            allowsRomanization: true,
            minWordCodePoints: 2,
          },
        },
      }

      expect(isWordInLanguageScript('北京', 'x-mlearn-pinyin', pinyinAwareLanguage)).toBe(true)
      expect(isWordInLanguageScript('nǐ hǎo', 'x-mlearn-pinyin', pinyinAwareLanguage)).toBe(true)
      expect(isWordInLanguageScript('ni3 hao3', 'x-mlearn-pinyin', pinyinAwareLanguage)).toBe(true)
      expect(isWordInLanguageScript('helloسلام', 'x-mlearn-pinyin', pinyinAwareLanguage)).toBe(false)
    })

    it('keeps strict script validation strict even when romanization is enabled', () => {
      const strictRomanizedArabicLanguage: LanguageData = {
        ...thirdPartyArabicScriptLanguage,
        textProcessing: {
          scriptProfile: {
            acceptedScripts: ['Arab'],
            allowsRomanization: true,
            minWordCodePoints: 2,
            wordScriptValidation: 'only-accepted',
          },
        },
      }

      expect(isWordInLanguageScript('سلام', 'x-mlearn-strict-ar', strictRomanizedArabicLanguage)).toBe(true)
      expect(isWordInLanguageScript('salaam', 'x-mlearn-strict-ar', strictRomanizedArabicLanguage)).toBe(false)
    })
  })
})

// ============================================================================
// isValidSTTResult
// ============================================================================

describe('isValidSTTResult', () => {
  const thirdPartyCyrillicLanguage: LanguageData = {
    name: 'Third Party Cyrillic',
    colour_codes: {},
    settings: { fixed: {} },
    textProcessing: {
      scriptProfile: {
        acceptedScripts: ['Cyrl'],
        minWordCodePoints: 2,
      },
    },
  }

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
    const japaneseMetadata: LanguageData = {
      name: 'Japanese',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: {
          acceptedScripts: ['Hira', 'Kana', 'Han'],
          requiredScripts: ['Hira', 'Kana', 'Han'],
          allowsRomanization: true,
          sttRejectPureScripts: ['Han'],
        },
      },
    }

    it('returns true for text with hiragana', () => {
      expect(isValidSTTResult('こんにちは', 'ja', japaneseMetadata)).toBe(true)
    })

    it('returns true for text with katakana', () => {
      expect(isValidSTTResult('コンピュータ', 'ja', japaneseMetadata)).toBe(true)
    })

    it('returns true for mixed kanji and kana', () => {
      expect(isValidSTTResult('東京に行く', 'ja', japaneseMetadata)).toBe(true)
    })

    it('returns true for Latin-only (romaji)', () => {
      expect(isValidSTTResult('konnichiwa', 'ja', japaneseMetadata)).toBe(true)
    })

    it('does not infer romanized Latin acceptance from the language code alone', () => {
      const metadataWithoutRomanization: LanguageData = {
        ...japaneseMetadata,
        textProcessing: {
          scriptProfile: {
            acceptedScripts: ['Hira', 'Kana', 'Han'],
            requiredScripts: ['Hira', 'Kana', 'Han'],
            sttRejectPureScripts: ['Han'],
          },
        },
      }

      expect(isValidSTTResult('konnichiwa', 'ja', metadataWithoutRomanization)).toBe(false)
    })

    it('lets package metadata reject short pure-Han noise for Japanese STT', () => {
      expect(isValidSTTResult('哦呢', 'ja', japaneseMetadata)).toBe(false)
    })

    it('does not reject pure-Han STT snippets for Japanese unless metadata declares it', () => {
      const metadataWithoutPureScriptReject: LanguageData = {
        ...japaneseMetadata,
        textProcessing: {
          scriptProfile: {
            acceptedScripts: ['Hira', 'Kana', 'Han'],
            requiredScripts: ['Hira', 'Kana', 'Han'],
          },
        },
      }

      expect(isValidSTTResult('哦呢', 'ja', metadataWithoutPureScriptReject)).toBe(true)
    })
  })

  describe('Korean (ko)', () => {
    const koreanMetadata: LanguageData = {
      name: 'Korean',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: {
          acceptedScripts: ['Hang', 'Han'],
          requiredScripts: ['Hang', 'Han'],
          allowsRomanization: true,
          sttRejectPureScripts: ['Han'],
        },
      },
    }

    it('returns true for Hangul text', () => {
      expect(isValidSTTResult('안녕하세요', 'ko', koreanMetadata)).toBe(true)
    })

    it('returns true for Latin text in Korean context', () => {
      expect(isValidSTTResult('hello', 'ko', koreanMetadata)).toBe(true)
    })

    it('lets package metadata reject pure Han without Hangul', () => {
      expect(isValidSTTResult('北京', 'ko', koreanMetadata)).toBe(false)
    })
  })

  describe('Chinese (zh)', () => {
    it('returns true for CJK text', () => {
      expect(isValidSTTResult('你好世界', 'zh')).toBe(true)
    })

    it('returns true for Chinese noise chars when target is zh', () => {
      expect(isValidSTTResult('哦呢', 'zh')).toBe(true)
    })

    it('lets language metadata declare exact CJK STT noise strings', () => {
      const metadata: LanguageData = {
        name: 'Chinese',
        colour_codes: {},
        settings: { fixed: {} },
        textProcessing: {
          scriptProfile: {
            acceptedScripts: ['Han'],
            sttNoiseCharacters: ['哦呢'],
          },
        },
      }

      expect(isValidSTTResult('哦呢', 'zh', metadata)).toBe(false)
      expect(isValidSTTResult('你好世界', 'zh', metadata)).toBe(true)
    })
  })

  describe('Latin-script languages (default)', () => {
    it('returns true for English text', () => {
      expect(isValidSTTResult('hello world', 'en')).toBe(true)
    })

    it('does not reject exact STT noise strings unless language metadata declares them', () => {
      expect(isValidSTTResult('um', 'en')).toBe(true)
    })

    it('lets language metadata declare exact STT noise strings', () => {
      const metadata: LanguageData = {
        name: 'English',
        colour_codes: {},
        settings: { fixed: {} },
        textProcessing: {
          scriptProfile: {
            acceptedScripts: ['Latn'],
            sttNoiseCharacters: ['um'],
          },
        },
      }

      expect(isValidSTTResult('um', 'en', metadata)).toBe(false)
      expect(isValidSTTResult('umbrella', 'en', metadata)).toBe(true)
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

    it('uses installed metadata for unknown third-party language codes', () => {
      expect(isValidSTTResult('привет мир', 'x-mlearn-third-party', thirdPartyCyrillicLanguage)).toBe(true)
      expect(isValidSTTResult('hello world', 'x-mlearn-third-party', thirdPartyCyrillicLanguage)).toBe(false)
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

  it('preserves collapsed reading spaces for metadata-declared spaced readings', () => {
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
        },
      },
    }

    expect(normalizeReading('<span>nǐ\u00A0\u00A0hǎo</span>', hanPinyinLanguage)).toBe('nǐ hǎo')
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
// stripRubyAnnotations
// ============================================================================

describe('stripRubyAnnotations', () => {
  it('does not expose the deprecated furigana-named alias', () => {
    expect('stripFurigana' in textUtilsModule).toBe(false)
  })

  it('removes rt content from ruby markup', () => {
    expect(stripRubyAnnotations('<ruby>漢字<rt>かんじ</rt></ruby>')).toBe('漢字')
  })

  it('removes ruby tags but keeps base text', () => {
    expect(stripRubyAnnotations('<ruby>主<rt>おも</rt></ruby>に')).toBe('主に')
  })

  it('keeps parenthesized hiragana without language metadata', () => {
    expect(stripRubyAnnotations('漢字(かんじ)')).toBe('漢字(かんじ)')
  })

  it('keeps parenthesized katakana without language metadata', () => {
    expect(stripRubyAnnotations('漢字(カンジ)')).toBe('漢字(カンジ)')
  })

  it('keeps full-width parenthesized readings without language metadata', () => {
    expect(stripRubyAnnotations('漢字（かんじ）')).toBe('漢字（かんじ）')
  })

  it('removes rp tags', () => {
    expect(stripRubyAnnotations('<ruby>字<rp>(</rp><rt>じ</rt><rp>)</rp></ruby>')).toBe('字()')
  })

  it('returns empty string for empty input', () => {
    expect(stripRubyAnnotations('')).toBe('')
  })

  it('passes plain text through unchanged', () => {
    expect(stripRubyAnnotations('こんにちは')).toBe('こんにちは')
  })
})

describe('stripReadingAnnotations', () => {
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
  }
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
  }

  it('keeps parenthetical readings without metadata', () => {
    expect(stripReadingAnnotations('漢字(かんじ)')).toBe('漢字(かんじ)')
  })

  it('keeps parenthetical kana when language metadata has no reading annotation stripping', () => {
    expect(stripReadingAnnotations('Example(かな)', latinLanguage)).toBe('Example(かな)')
  })

  it('keeps parenthetical notes for non-reading metadata', () => {
    expect(stripReadingAnnotations('word(noun)', latinLanguage)).toBe('word(noun)')
  })

  it('still strips ruby markup with non-reading metadata', () => {
    expect(stripReadingAnnotations('<ruby>word<rt>reading</rt></ruby>', latinLanguage)).toBe('word')
  })

  it('strips metadata-configured parenthetical readings', () => {
    expect(stripReadingAnnotations('你好(ni hao)', hanPinyinLanguage)).toBe('你好')
  })

  it('does not strip parenthetical text when scripts do not match metadata', () => {
    expect(stripReadingAnnotations('hello(world)', hanPinyinLanguage)).toBe('hello(world)')
  })

  it('does not strip metadata readings unless the package opts in', () => {
    expect(stripReadingAnnotations('你好(ni hao)', {
      ...hanPinyinLanguage,
      textProcessing: {
        ...hanPinyinLanguage.textProcessing,
        readingAnnotation: {
          ...hanPinyinLanguage.textProcessing?.readingAnnotation,
          stripParentheticalReadings: false,
        },
      },
    })).toBe('你好(ni hao)')
  })

  it('finds metadata-configured parenthetical readings without requiring stripping', () => {
    expect(findConfiguredParentheticalReadings('你好(ni hao)', {
      ...hanPinyinLanguage,
      textProcessing: {
        ...hanPinyinLanguage.textProcessing,
        readingAnnotation: {
          ...hanPinyinLanguage.textProcessing?.readingAnnotation,
          stripParentheticalReadings: false,
        },
      },
    })).toEqual([
      { raw: '你好(ni hao)', word: '你好', reading: 'ni hao', index: 0 },
    ])
    expect(findConfiguredParentheticalReadings('hello(world)', hanPinyinLanguage)).toEqual([])
  })
})

describe('normalizeWordLookupText', () => {
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
  }
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
  }

  it('keeps parenthetical kana when the language package disables reading stripping', () => {
    expect(normalizeWordLookupText('Example(かな)', latinLanguage)).toBe('Example(かな)')
  })

  it('keeps metadata-free parenthetical readings in lookup keys', () => {
    expect(normalizeWordLookupText('漢字(かんじ)')).toBe('漢字(かんじ)')
  })

  it('strips configured parenthetical readings for languages that declare them', () => {
    expect(normalizeWordLookupText('你好(ni hao)', hanPinyinLanguage)).toBe('你好')
  })

  it('strips default zero-width junk when no language tokenizer preserves it', () => {
    expect(normalizeWordLookupText('word\u200b\u200c\u200d')).toBe('word')
  })

  it('preserves tokenizer-declared format characters for dictionary lookup', () => {
    const persianLanguage: LanguageData = {
      name: 'Persian-like',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: { scriptProfile: { acceptedScripts: ['Arab'] } },
      runtime: {
        nlp: {
          tokenizer: {
            type: 'unicode-word',
            innerTokenCharacters: ['\u200c'],
          },
        },
      },
    }

    expect(normalizeWordLookupText('خانه\u200cها\u200b', persianLanguage)).toBe('خانه\u200cها')
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

  it('joins adjacent ruby readings with spaces for romanized reading metadata', () => {
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
      },
    }
    const input = '<ruby>你<rt>ni</rt></ruby><ruby>好<rt>hao</rt></ruby>'
    expect(applyRubyReadings(input, hanPinyinLanguage)).toBe('ni hao')
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

  it('applies metadata-configured parenthetical readings', () => {
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
    }
    expect(applyRubyReadings('你好(ni hao)', hanPinyinLanguage)).toBe('ni hao')
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

  it('keeps metadata-free parenthetical readings for surface TTS text', () => {
    expect(stripHtmlForTts('漢字(かんじ)', false)).toBe('漢字(かんじ)')
  })

  it('keeps metadata-free parenthetical readings for reading TTS text', () => {
    expect(stripHtmlForTts('漢字(かんじ)', true)).toBe('漢字(かんじ)')
  })

  it('strips metadata-configured parenthetical readings for TTS surface text', () => {
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
    }
    expect(stripHtmlForTts('你好(ni hao)', false, hanPinyinLanguage)).toBe('你好')
  })

  it('uses metadata-configured parenthetical readings for TTS reading text', () => {
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
    }
    expect(stripHtmlForTts('你好(ni hao)', true, hanPinyinLanguage)).toBe('ni hao')
  })

  it('uses language reading separators for adjacent ruby TTS reading text', () => {
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
      },
    }
    expect(
      stripHtmlForTts('<ruby>你<rt>ni</rt></ruby><ruby>好<rt>hao</rt></ruby>', true, hanPinyinLanguage)
    ).toBe('ni hao')
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

  it('uses the requested display locale for built-in language names', () => {
    expect(getLanguageDisplayName('de', null, 'fr')).toBe('allemand')
    expect(getLanguageDisplayName('ru', null, 'de')).toBe('Russisch')
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

  it('prefers installed language metadata names for custom language codes', () => {
    expect(getLanguageDisplayName('x-third-party', {
      name: 'Example Language',
      colour_codes: {},
      settings: { fixed: {} },
    }, 'fr')).toBe('Example Language')
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
