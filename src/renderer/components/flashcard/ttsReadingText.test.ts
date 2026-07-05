/**
 * Tests for TTS reading text extraction logic used by TtsGenerateModal.
 *
 * When "Use readings" is enabled for example TTS, the flow is:
 * 1. Strip all HTML and reading annotations → plain text
 * 2. Re-tokenize plain text with the backend
 * 3. Map each token to its reading (fallback to surface word)
 * 4. Join readings using the language's reading separator
 */

import { describe, it, expect } from 'vitest';
import { stripHtmlForTts } from '../../../shared/utils/textUtils';
import { tokensToReadingText } from '../../../shared/languageFeatures';
import type { LanguageData, Token } from '../../../shared/types';

describe('TTS reading text extraction', () => {
  const kanaKanjiLanguage: LanguageData = {
    name: 'Japanese-like',
    colour_codes: {},
    settings: { fixed: {} },
    textProcessing: {
      scriptProfile: { acceptedScripts: ['Hira', 'Kana', 'Han'] },
      lexemeNormalization: {
        type: 'surface-reading',
        surfaceScripts: ['Han'],
        readingScripts: ['Hira', 'Kana'],
      },
      readingAnnotation: {
        type: 'script-reading',
        annotationScripts: ['Han'],
        stripParentheticalReadings: true,
      },
    },
  };

  const hanPinyinLanguage: LanguageData = {
    name: 'Chinese-like',
    colour_codes: {},
    settings: { fixed: {} },
    textProcessing: {
      scriptProfile: { acceptedScripts: ['Han'] },
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

  describe('stripHtmlForTts removes HTML for TTS input', () => {
    it('strips colored span HTML from tokenized example', () => {
      const html = '<span class="subtitle_word" style="color: #ff0000;">食べ</span><span class="subtitle_word" style="color: #00ff00;">た</span>';
      expect(stripHtmlForTts(html)).toBe('食べた');
    });

    it('strips ruby reading annotations (keeps surface text)', () => {
      const html = '<ruby>漢字<rt>かんじ</rt></ruby>です';
      expect(stripHtmlForTts(html)).toBe('漢字です');
    });

    it('handles plain text without HTML', () => {
      expect(stripHtmlForTts('日本語を勉強する')).toBe('日本語を勉強する');
    });

    it('returns empty string for empty input', () => {
      expect(stripHtmlForTts('')).toBe('');
    });
  });

  describe('tokensToReadingText maps tokens to readings', () => {
    it('extracts readings from Japanese tokens', () => {
      const tokens: Token[] = [
        { word: '日本', actual_word: '日本', type: '名詞', reading: 'にほん' },
        { word: '語', actual_word: '語', type: '名詞', reading: 'ご' },
        { word: 'を', actual_word: 'を', type: '助詞', reading: 'を' },
        { word: '勉強', actual_word: '勉強', type: '名詞', reading: 'べんきょう' },
        { word: 'する', actual_word: 'する', type: '動詞', reading: 'する' },
      ];
      expect(tokensToReadingText(tokens, kanaKanjiLanguage)).toBe('にほんごをべんきょうする');
    });

    it('separates romanized readings for languages that require spaces', () => {
      const tokens: Token[] = [
        { word: '你', actual_word: '你', type: 'word', reading: 'ni' },
        { word: '好', actual_word: '好', type: 'word', reading: 'hao' },
      ];
      expect(tokensToReadingText(tokens, hanPinyinLanguage)).toBe('ni hao');
    });

    it('falls back to word when reading is absent', () => {
      const tokens: Token[] = [
        { word: 'hello', actual_word: 'hello', type: 'noun' },
        { word: 'world', actual_word: 'world', type: 'noun' },
      ];
      expect(tokensToReadingText(tokens)).toBe('helloworld');
    });

    it('handles mixed tokens with and without readings', () => {
      const tokens: Token[] = [
        { word: '食べ', actual_word: '食べる', type: '動詞', reading: 'たべ' },
        { word: 'た', actual_word: 'た', type: '助動詞' },
      ];
      expect(tokensToReadingText(tokens, kanaKanjiLanguage)).toBe('たべた');
    });

    it('returns empty string for empty token array', () => {
      expect(tokensToReadingText([])).toBe('');
    });
  });

  describe('full flow: HTML → plain text → reading text', () => {
    it('converts colored HTML example to readings via tokens', () => {
      const html = '<span class="subtitle_word defined" style="color: #ff0000;">食べ</span><span class="subtitle_word" style="color: #00ff00;">た</span>';

      // Step 1: strip HTML
      const plainText = stripHtmlForTts(html);
      expect(plainText).toBe('食べた');

      // Step 2-3: tokenize + map to readings (simulated)
      const tokens: Token[] = [
        { word: '食べ', actual_word: '食べる', type: '動詞', reading: 'たべ' },
        { word: 'た', actual_word: 'た', type: '助動詞', reading: 'た' },
      ];
      const readingText = tokensToReadingText(tokens, kanaKanjiLanguage);
      expect(readingText).toBe('たべた');
    });

    it('produces different text with readings ON vs OFF', () => {
      const html = '<span class="subtitle_word" style="color: red;">漢字</span>';

      const textWithoutReadings = stripHtmlForTts(html);
      expect(textWithoutReadings).toBe('漢字');

      const tokens: Token[] = [
        { word: '漢字', actual_word: '漢字', type: '名詞', reading: 'かんじ' },
      ];
      const textWithReadings = tokensToReadingText(tokens, kanaKanjiLanguage);
      expect(textWithReadings).toBe('かんじ');

      expect(textWithReadings).not.toBe(textWithoutReadings);
    });

    it('handles LLM-generated plain text example (no HTML)', () => {
      const plainSentence = '日本語を勉強する';

      const stripped = stripHtmlForTts(plainSentence);
      expect(stripped).toBe('日本語を勉強する');

      const tokens: Token[] = [
        { word: '日本', actual_word: '日本', type: '名詞', reading: 'にほん' },
        { word: '語', actual_word: '語', type: '名詞', reading: 'ご' },
        { word: 'を', actual_word: 'を', type: '助詞', reading: 'を' },
        { word: '勉強', actual_word: '勉強', type: '名詞', reading: 'べんきょう' },
        { word: 'する', actual_word: 'する', type: '動詞', reading: 'する' },
      ];
      expect(tokensToReadingText(tokens, kanaKanjiLanguage)).toBe('にほんごをべんきょうする');
    });
  });
});
