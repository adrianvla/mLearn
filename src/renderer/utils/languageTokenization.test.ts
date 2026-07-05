import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LanguageData, Settings, Token } from '../../shared/types';

const mockTokenize = vi.fn();

vi.mock('../../shared/backends', () => ({
  getBackend: vi.fn(() => ({
    tokenize: mockTokenize,
  })),
}));

const backendSettings = {
  backendMode: 'local',
  backendUrl: 'http://localhost:7752',
  cloudAuthAccessToken: '',
  cloudAuthToken: '',
} satisfies Pick<Settings, 'backendMode' | 'backendUrl' | 'cloudAuthAccessToken' | 'cloudAuthToken'>;

const pinyinLanguage: LanguageData = {
  name: 'Chinese',
  colour_codes: {},
  settings: { fixed: {} },
  textProcessing: {
    scriptProfile: { acceptedScripts: ['Han', 'Latn'] },
    lexemeNormalization: {
      type: 'reading',
      surfaceScripts: ['Han'],
      readingScripts: ['Latn'],
    },
    readingAnnotation: {
      type: 'script-reading',
      annotationScripts: ['Han'],
      readingSeparator: ' ',
    },
    tokenJoinSeparator: ' ',
  },
};

describe('language tokenization helpers', () => {
  beforeEach(() => {
    mockTokenize.mockReset();
  });

  it('colorizes generated text using language token spacing metadata', async () => {
    mockTokenize.mockResolvedValue([
      { word: '你', actual_word: '你', type: 'word', surface: '你' },
      { word: '好', actual_word: '好', type: 'word', surface: '好' },
    ] satisfies Token[]);
    const { colorizeTokenizedText } = await import('./languageTokenization');

    const html = await colorizeTokenizedText({
      text: '你好',
      language: 'zh',
      languageData: pinyinLanguage,
      settings: backendSettings,
      colourCodes: { word: '#fff' },
      targetWord: '你',
    });

    expect(html).toContain('>你</span> <span');
    expect(html).toContain('>好</span>');
    expect(mockTokenize).toHaveBeenCalledWith('你好', 'zh');
  });

  it('returns the original text when tokenization fails', async () => {
    mockTokenize.mockRejectedValue(new Error('required tokenizer missing'));
    const { colorizeTokenizedText } = await import('./languageTokenization');

    await expect(colorizeTokenizedText({
      text: '你好',
      language: 'zh',
      languageData: pinyinLanguage,
      settings: backendSettings,
      colourCodes: {},
      targetWord: '你',
    })).resolves.toBe('你好');
  });

  it('uses rough colorization fallback when metadata allows a safe word tokenizer', async () => {
    mockTokenize.mockRejectedValue(new Error('backend unavailable'));
    const germanLanguage: LanguageData = {
      name: 'German',
      colour_codes: {},
      settings: { fixed: {} },
            runtime: {
        nlp: {
          tokenizer: {
            type: 'unicode-word',
            lowercaseLemma: true,
          },
        },
      },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Latn'] },
        tokenJoinSeparator: ' ',
      },
    };
    const { colorizeTokenizedText } = await import('./languageTokenization');

    const html = await colorizeTokenizedText({
      text: 'Das Haus steht.',
      language: 'de',
      languageData: germanLanguage,
      settings: backendSettings,
      colourCodes: { WORD: '#abc' },
      targetWord: 'haus',
    });

    expect(html).toContain('>Das</span>');
    expect(html).toContain('class="subtitle_word defined"');
    expect(html).toContain('>Haus</span>');
    expect(html).toContain('>steht</span>');
  });

  it('does not rough-colorize when fallback tokenization would drop foreign-script letters', async () => {
    mockTokenize.mockRejectedValue(new Error('backend unavailable'));
    const germanLanguage: LanguageData = {
      name: 'German',
      colour_codes: {},
      settings: { fixed: {} },
            runtime: {
        nlp: {
          tokenizer: {
            type: 'unicode-word',
            lowercaseLemma: true,
          },
        },
      },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Latn'] },
        tokenJoinSeparator: ' ',
      },
    };
    const { colorizeTokenizedText } = await import('./languageTokenization');

    await expect(colorizeTokenizedText({
      text: 'Das Haus 中文',
      language: 'de',
      languageData: germanLanguage,
      settings: backendSettings,
      colourCodes: { WORD: '#abc' },
      targetWord: 'haus',
    })).resolves.toBe('Das Haus 中文');
  });

  it('does not rough-colorize segmentless text unless metadata explicitly allows it', async () => {
    mockTokenize.mockRejectedValue(new Error('required tokenizer missing'));
    const unsafeChineseLanguage: LanguageData = {
      ...pinyinLanguage,
      runtime: {
        nlp: {
          tokenizer: {
            type: 'unicode-word',
          },
        },
      },
    };
    const { colorizeTokenizedText } = await import('./languageTokenization');

    await expect(colorizeTokenizedText({
      text: '你好',
      language: 'zh',
      languageData: unsafeChineseLanguage,
      settings: backendSettings,
      colourCodes: { WORD: '#abc' },
      targetWord: '你',
    })).resolves.toBe('你好');
  });

  it('converts token readings using language reading separators', async () => {
    mockTokenize.mockResolvedValue([
      { word: '你', actual_word: '你', type: 'word', reading: 'ni' },
      { word: '好', actual_word: '好', type: 'word', reading: 'hao' },
    ] satisfies Token[]);
    const { textToReadingText } = await import('./languageTokenization');

    await expect(textToReadingText({
      text: '你好',
      language: 'zh',
      languageData: pinyinLanguage,
      settings: backendSettings,
    })).resolves.toBe('ni hao');
  });

  it('rejects reading text conversion when tokenizer metadata does not allow rough fallback', async () => {
    mockTokenize.mockRejectedValue(new Error('required tokenizer missing'));
    const { textToReadingText } = await import('./languageTokenization');

    await expect(textToReadingText({
      text: '你好',
      language: 'zh',
      languageData: pinyinLanguage,
      settings: backendSettings,
    })).rejects.toThrow('required tokenizer missing');
  });

  it('uses rough reading text fallback only when language metadata explicitly allows it', async () => {
    mockTokenize.mockRejectedValue(new Error('backend unavailable'));
    const fallbackLanguage: LanguageData = {
      name: 'Chinese with explicit degraded tokenizer',
      colour_codes: {},
      settings: { fixed: {} },
            runtime: {
        nlp: {
          tokenizer: {
            type: 'unicode-word',
            allowRoughSegmentationForSegmentlessScripts: true,
          },
        },
      },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Han', 'Latn'] },
        readingAnnotation: {
          type: 'script-reading',
          annotationScripts: ['Han'],
          readingSeparator: ' ',
        },
      },
    };
    const { textToReadingText } = await import('./languageTokenization');

    await expect(textToReadingText({
      text: '你好 世界',
      language: 'zh',
      languageData: fallbackLanguage,
      settings: backendSettings,
    })).resolves.toBe('你好 世界');
  });

  it('rejects reading text fallback when rough segmentation is unsafe for segmentless scripts', async () => {
    mockTokenize.mockRejectedValue(new Error('backend unavailable'));
    const unsafeFallbackLanguage: LanguageData = {
      name: 'Chinese with unsafe degraded tokenizer',
      colour_codes: {},
      settings: { fixed: {} },
            runtime: {
        nlp: {
          tokenizer: {
            type: 'unicode-word',
          },
        },
      },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Han'] },
        readingAnnotation: {
          type: 'script-reading',
          annotationScripts: ['Han'],
          readingSeparator: ' ',
        },
      },
    };
    const { textToReadingText } = await import('./languageTokenization');

    await expect(textToReadingText({
      text: '你好世界',
      language: 'zh',
      languageData: unsafeFallbackLanguage,
      settings: backendSettings,
    })).rejects.toThrow('backend unavailable');
  });

  it('rejects reading text fallback instead of returning blank when rough fallback drops all letters', async () => {
    mockTokenize.mockRejectedValue(new Error('backend unavailable'));
    const latinFallbackLanguage: LanguageData = {
      name: 'Latin fallback language',
      colour_codes: {},
      settings: { fixed: {} },
            runtime: {
        nlp: {
          tokenizer: {
            type: 'unicode-word',
          },
        },
      },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Latn'] },
        tokenJoinSeparator: ' ',
      },
    };
    const { textToReadingText } = await import('./languageTokenization');

    await expect(textToReadingText({
      text: '你好',
      language: 'xx',
      languageData: latinFallbackLanguage,
      settings: backendSettings,
    })).rejects.toThrow('backend unavailable');
  });
});
