/**
 * SubtitleContainer Tests
 */

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'solid-js/web';
import { SubtitleContainer } from './SubtitleContainer';
import type { LanguageData, Token } from '../../../shared/types';

const mockSettings: Record<string, unknown> = {
  showSubtitles: true,
  subtitle_font_size: 32,
  subtitle_font_weight: 700,
  subtitleTheme: 'shadow',
  showTranslation: false,
  showDictionary: false,
  showLiveTranslator: false,
  language: 'ja',
  blur_known_subtitles: false,
  removeSpeakerNames: false,
  removeParentheses: false,
  do_colour_codes: false,
  liveTranslatorIncludeKnown: false,
};

let mockLanguageData: LanguageData | null = null;
const mockGetCanonicalForm = vi.fn((word: string) => word);
const mockIsWordKnownComprehensiveSync = vi.fn((_word: string, language?: string) => language === 'ar');
const mockTrackWordSeen = vi.fn();
const mockCancelWordHover = vi.fn();
const mockTranslateWord = vi.fn().mockResolvedValue({
  data: [{ definitions: ['test definition'], reading: 'test reading' }],
});

vi.mock('../../context', () => ({
  useSettings: () => ({ settings: mockSettings }),
  useLanguage: () => ({
    isTranslatable: () => true,
    isTokenTranslatable: () => true,
    detectGrammarInText: () => [],
    supportsGrammar: () => false,
    currentLangData: () => mockLanguageData,
    getCanonicalForm: mockGetCanonicalForm,
    getLanguageFeatures: () => ({ supportsReadings: false, prosodyRenderer: undefined, supportsProsody: false }),
    getFrequency: () => null,
  }),
  useFlashcards: () => ({
    isWordKnownByText: () => false,
    isWordKnownComprehensiveSync: mockIsWordKnownComprehensiveSync,
    getComprehensiveWordStatusSync: () => 'unknown',
    trackWordHovered: vi.fn(),
    cancelWordHover: mockCancelWordHover,
    trackWordSeen: mockTrackWordSeen,
    trackGrammarFailed: vi.fn(),
    trackGrammarEncountered: vi.fn(),
    ignoreWordForLanguage: vi.fn(),
    store: { wordKnowledge: {} },
  }),
  useLocalization: () => ({
    t: (key: string) => key,
  }),
  useLowPowerGate: () => ({
    requestAccess: vi.fn().mockResolvedValue(true),
  }),
}));

const mockForceHide = vi.fn();

vi.mock('../../hooks', () => ({
  useWordHover: () => ({
    hoverData: () => null,
    isVisible: () => false,
    showHover: vi.fn(),
    hideHover: vi.fn(),
    cancelHide: vi.fn(),
    forceHide: mockForceHide,
  }),
  useDictionary: () => ({
    lookup: vi.fn().mockResolvedValue([]),
  }),
  useTranslation: () => ({
    translateWord: mockTranslateWord,
  }),
  getCachedTranslation: () => null,
}));

vi.mock('../../services/wordLookupService', () => ({
  initWordLookupBridge: () => () => {},
}));

describe('SubtitleContainer', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    mockSettings.showSubtitles = true;
    mockSettings.blur_known_subtitles = false;
    mockSettings.showLiveTranslator = false;
    mockSettings.language = 'ja';
    delete mockSettings.subtitleFont;
    mockLanguageData = null;
    mockGetCanonicalForm.mockImplementation((word: string) => word);
    mockIsWordKnownComprehensiveSync.mockClear();
    mockTrackWordSeen.mockClear();
    mockCancelWordHover.mockClear();
    mockTranslateWord.mockReset();
    mockTranslateWord.mockResolvedValue({
      data: [{ definitions: ['test definition'], reading: 'test reading' }],
    });
  });

  afterEach(() => {
    container.remove();
  });

  const mockTokens: Token[] = [
    { word: 'hello', surface: 'hello', actual_word: 'hello', type: 'noun', partOfSpeech: 'noun' },
    { word: 'world', surface: 'world', actual_word: 'world', type: 'noun', partOfSpeech: 'noun' },
  ];

  it('renders subtitle text with subtitle theme class', () => {
    const dispose = render(
      () => (
        <SubtitleContainer
          tokens={mockTokens}
          originalText="hello world"
          isLoading={false}
        />
      ),
      container,
    );

    const subtitlesEl = container.querySelector('.subtitles');
    expect(subtitlesEl).not.toBeNull();
    expect(subtitlesEl!.classList.contains('theme-shadow')).toBe(true);
    dispose();
  });

  it('uses a script-aware subtitle font when the user has no custom subtitle font', () => {
    mockLanguageData = {
      name: 'Arabic',
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Arab'] },
      },
    };

    const dispose = render(
      () => (
        <SubtitleContainer
          tokens={mockTokens}
          originalText="مرحبا"
          isLoading={false}
        />
      ),
      container,
    );

    const subtitleText = container.querySelector('.subtitles > div') as HTMLElement | null;
    expect(subtitleText?.style.getPropertyValue('font-family')).toBe('var(--font-family-arabic)');
    expect(subtitleText?.style.getPropertyValue('direction')).toBe('rtl');
    dispose();
  });

  it('uses package text direction above script defaults for subtitles', () => {
    mockLanguageData = {
      name: 'Arabic transliteration package',
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Arab'] },
      },
      typography: {
        textDirection: 'ltr',
      },
    };

    const dispose = render(
      () => (
        <SubtitleContainer
          tokens={mockTokens}
          originalText="marhaba"
          isLoading={false}
        />
      ),
      container,
    );

    const subtitleText = container.querySelector('.subtitles > div') as HTMLElement | null;
    expect(subtitleText?.style.getPropertyValue('direction')).toBe('ltr');
    dispose();
  });

  it('keeps the user subtitle font above language script defaults', () => {
    mockSettings.subtitleFont = '"User Subtitle Font"';
    mockLanguageData = {
      name: 'Arabic',
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Arab'] },
      },
    };

    const dispose = render(
      () => (
        <SubtitleContainer
          tokens={mockTokens}
          originalText="مرحبا"
          isLoading={false}
        />
      ),
      container,
    );

    const subtitleText = container.querySelector('.subtitles > div') as HTMLElement | null;
    expect(subtitleText?.style.getPropertyValue('font-family')).toBe('"User Subtitle Font"');
    dispose();
  });

  it('renders tokens when provided', () => {
    const dispose = render(
      () => (
        <SubtitleContainer
          tokens={mockTokens}
          originalText="hello world"
          isLoading={false}
        />
      ),
      container,
    );

    expect(container.textContent).toContain('hello');
    expect(container.textContent).toContain('world');
    dispose();
  });

  it('renders token separators from spaced language metadata', () => {
    mockLanguageData = {
      name: 'Latin Language',
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Latn'] },
        lexemeNormalization: {
          type: 'identity',
        },
      },
    };

    const dispose = render(
      () => (
        <SubtitleContainer
          tokens={mockTokens}
          originalText="hello world"
          isLoading={false}
        />
      ),
      container,
    );

    expect(container.textContent).toContain('hello world');
    dispose();
  });

  it('keeps compact language metadata without inserting spaces between tokens', () => {
    mockLanguageData = {
      name: 'Kana Kanji Language',
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Hira', 'Kana', 'Han'] },
        lexemeNormalization: {
          type: 'surface-reading',
          surfaceScripts: ['Han'],
          readingScripts: ['Hira', 'Kana'],
        },
      },
    };
    const compactTokens: Token[] = [
      { word: '日本', surface: '日本', actual_word: '日本', type: '名詞', partOfSpeech: '名詞' },
      { word: '語', surface: '語', actual_word: '語', type: '名詞', partOfSpeech: '名詞' },
    ];

    const dispose = render(
      () => (
        <SubtitleContainer
          tokens={compactTokens}
          originalText="日本語"
          isLoading={false}
        />
      ),
      container,
    );

    expect(container.textContent).toContain('日本語');
    expect(container.textContent).not.toContain('日本 語');
    dispose();
  });

  it('hides container when isLoading is true and no content is available', () => {
    const dispose = render(
      () => (
        <SubtitleContainer
          tokens={[]}
          originalText=""
          isLoading={true}
        />
      ),
      container,
    );

    const subtitlesEl = container.querySelector('.subtitles');
    expect(subtitlesEl!.classList.contains('not-shown')).toBe(true);
    dispose();
  });

  it('applies not-shown class when showSubtitles is disabled', () => {
    mockSettings.showSubtitles = false;

    const dispose = render(
      () => (
        <SubtitleContainer
          tokens={mockTokens}
          originalText="hello world"
          isLoading={false}
        />
      ),
      container,
    );

    const subtitlesEl = container.querySelector('.subtitles');
    expect(subtitlesEl!.classList.contains('not-shown')).toBe(true);
    dispose();
  });

  it('checks known subtitle words using the current learning language', () => {
    mockSettings.language = 'ar';
    mockSettings.blur_known_subtitles = true;
    const arabicTokens: Token[] = [
      { word: 'يكتب', surface: 'يكتب', actual_word: 'يكتب', type: 'noun', partOfSpeech: 'noun' },
    ];

    const dispose = render(
      () => (
        <SubtitleContainer
          tokens={arabicTokens}
          originalText="يكتب"
          isLoading={false}
        />
      ),
      container,
    );

    expect(mockIsWordKnownComprehensiveSync).toHaveBeenCalledWith('يكتب', 'ar');
    expect(container.querySelector('.subtitles')?.classList.contains('subtitle-line-blur')).toBe(true);
    dispose();
  });

  it('cancels hover tracking with the raw lookup word instead of pre-canonicalizing it', () => {
    mockGetCanonicalForm.mockImplementation((word: string) => word === 'يكتب' ? 'كتب' : word);
    const arabicTokens: Token[] = [
      { word: 'يكتب', surface: 'يكتب', actual_word: 'يكتب', type: 'noun', partOfSpeech: 'noun' },
    ];

    const dispose = render(
      () => (
        <SubtitleContainer
          tokens={arabicTokens}
          originalText="يكتب"
          isLoading={false}
        />
      ),
      container,
    );

    const wordEl = container.querySelector('.subtitle-word') as HTMLElement | null;
    expect(wordEl).not.toBeNull();

    wordEl!.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    wordEl!.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));

    expect(mockCancelWordHover).toHaveBeenCalledWith('يكتب', 'ja');
    dispose();
  });

  it('calls forceHide when tokens change', () => {
    mockSettings.showLiveTranslator = false;
    mockForceHide.mockClear();

    const dispose = render(
      () => (
        <SubtitleContainer
          tokens={mockTokens}
          originalText="hello world"
          isLoading={false}
        />
      ),
      container,
    );

    expect(mockForceHide).toHaveBeenCalled();
    mockForceHide.mockClear();

    dispose();
    const dispose2 = render(
      () => (
        <SubtitleContainer
          tokens={[
            { word: 'new', surface: 'new', actual_word: 'new', type: 'noun', partOfSpeech: 'noun' },
          ]}
          originalText="new"
          isLoading={false}
        />
      ),
      container,
    );

    expect(mockForceHide).toHaveBeenCalled();
    dispose2();
  });

  it('adds unknown words to live translator when subtitles change', async () => {
    mockSettings.showLiveTranslator = true;
    const addCardMock = vi.fn();
    (window as unknown as Record<string, unknown>).mLearnLiveTranslator = {
      addCard: addCardMock,
      removeCard: vi.fn(),
      show: vi.fn(),
      hide: vi.fn(),
      isVisible: vi.fn(),
    };

    const dispose = render(
      () => (
        <SubtitleContainer
          tokens={mockTokens}
          originalText="hello world"
          isLoading={false}
        />
      ),
      container,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(addCardMock).toHaveBeenCalled();
    dispose();

    delete (window as unknown as Record<string, unknown>).mLearnLiveTranslator;
  });

  it('uses package-declared dictionary reading paths for live translator cards', async () => {
    mockSettings.showLiveTranslator = true;
    mockLanguageData = {
      name: 'Chinese',
      settings: { fixed: {} },
      textProcessing: { scriptProfile: { acceptedScripts: ['Han', 'Latn'] } },
      runtime: {
        nlp: {
          dictionary: {
            readingPath: ['pinyin', 'value'],
          },
        },
      },
    };
    mockTranslateWord.mockResolvedValue({
      data: [{
        word: '你好',
        pinyin: { value: 'nǐ hǎo' },
        definitions: ['hello'],
      }],
    });
    const addCardMock = vi.fn();
    (window as unknown as Record<string, unknown>).mLearnLiveTranslator = {
      addCard: addCardMock,
      removeCard: vi.fn(),
      show: vi.fn(),
      hide: vi.fn(),
      isVisible: vi.fn(),
    };

    const dispose = render(
      () => (
        <SubtitleContainer
          tokens={[
            { word: '你好', surface: '你好', actual_word: '你好', type: 'word', partOfSpeech: 'word' },
          ]}
          originalText="你好"
          isLoading={false}
        />
      ),
      container,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(addCardMock).toHaveBeenCalledWith('你好', 'nǐ hǎo', 'hello');
    dispose();

    delete (window as unknown as Record<string, unknown>).mLearnLiveTranslator;
  });
});
