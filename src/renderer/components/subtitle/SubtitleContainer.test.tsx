/**
 * SubtitleContainer Tests
 */

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSignal } from 'solid-js';
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
const mockIsWordSettledSync = vi.fn((word: string, language?: string) => mockIsWordKnownComprehensiveSync(word, language));
const mockTrackWordSeen = vi.fn();
const mockCancelWordHover = vi.fn();
const mockSupportsGrammar = vi.fn(() => false);
const mockTrackGrammarFailed = vi.fn();
const mockTrackGrammarEncountered = vi.fn();
const mockTranslateWord = vi.fn().mockResolvedValue({
  data: [{ definitions: ['test definition'], reading: 'test reading' }],
});

vi.mock('../../context', () => ({
  useSettings: () => ({ settings: mockSettings }),
  useLanguage: () => ({
    isTranslatable: () => true,
    isTokenTranslatable: () => true,
    detectGrammarInText: () => [],
    supportsGrammar: () => mockSupportsGrammar(),
    currentLangData: () => mockLanguageData,
    getCanonicalForm: mockGetCanonicalForm,
    getLanguageFeatures: () => ({ supportsReadings: false, prosodyRenderer: undefined, supportsProsody: false }),
    getFrequency: () => null,
  }),
  useFlashcards: () => ({
    isKnowledgeReady: () => true,
    getWordTrackingSync: () => ({ tracker: 'nothing' as const }),
    isWordKnownByText: () => false,
    isWordKnownComprehensiveSync: mockIsWordKnownComprehensiveSync,
    isWordSettledSync: (word: string, language?: string) => mockIsWordSettledSync(word, language),
    getComprehensiveWordStatusWithSourceSync: (word: string, language?: string) => ({
      status: mockIsWordKnownComprehensiveSync(word, language) ? 'known' : 'unknown',
      source: 'None',
      timesSeen: 0,
    }),
    getComprehensiveWordStatusSync: () => 'unknown',
    trackWordHovered: vi.fn(),
    cancelWordHover: mockCancelWordHover,
    trackWordSeen: mockTrackWordSeen,
    trackGrammarFailed: mockTrackGrammarFailed,
    trackGrammarEncountered: mockTrackGrammarEncountered,
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
    mockTrackGrammarFailed.mockClear();
    mockTrackGrammarEncountered.mockClear();
    mockSupportsGrammar.mockReturnValue(false);
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

  it('prefers the token reading (subtitle bracket override) over the dictionary reading in live translator cards', async () => {
    mockSettings.showLiveTranslator = true;
    mockTranslateWord.mockResolvedValue({
      data: [{ word: '無性', reading: 'むせい', definitions: ['asexual'] }],
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
            { word: '無性', surface: '無性', actual_word: '無性', reading: 'むしょう', type: 'word', partOfSpeech: 'word' },
          ]}
          originalText="無性(むしょう)"
          isLoading={false}
        />
      ),
      container,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(addCardMock).toHaveBeenCalledWith('無性', 'むしょう', 'asexual');
    dispose();

    delete (window as unknown as Record<string, unknown>).mLearnLiveTranslator;
  });

  it('hardcore mode hides subtitles by default but reveals them while hovering the subtitle area', () => {
    mockSettings.showSubtitles = true;
    mockSettings.hardcoreMode = true;

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

    const subtitlesEl = container.querySelector('.subtitles') as HTMLElement;
    expect(subtitlesEl.classList.contains('hardcore-hidden')).toBe(true);
    // Subtitles keep processing in hardcore mode: not-shown (full disable) must not apply
    expect(subtitlesEl.classList.contains('not-shown')).toBe(false);

    subtitlesEl.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    expect(subtitlesEl.classList.contains('hardcore-hidden')).toBe(false);

    subtitlesEl.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
    expect(subtitlesEl.classList.contains('hardcore-hidden')).toBe(true);

    dispose();
    mockSettings.hardcoreMode = false;
  });

  // REQ39: grammar immersion loop — occurrences detected during normal
  // immersion are journaled as factual-exposure encounters (rollups), one per
  // pattern per subtitle display.
  const grammarLanguageData: LanguageData = {
    name: 'English',
    textProcessing: { tokenJoinSeparator: ' ' },
    runtime: { nlp: { tokenizer: { type: 'spacy', capabilities: ['segments'] } } },
    grammar: [
      { pattern: 'hello world', meaning: 'greeting', level: 1 },
    ],
  };

  const renderSubtitle = (tokens: () => Token[]) => render(
    () => (
      <SubtitleContainer
        tokens={tokens()}
        originalText="hello world"
        isLoading={false}
      />
    ),
    container,
  );

  it('journals a grammar encounter with span and confidence when a subtitle with a pattern is shown', async () => {
    mockSupportsGrammar.mockReturnValue(true);
    mockLanguageData = grammarLanguageData;

    const dispose = renderSubtitle(() => mockTokens);

    await vi.waitFor(() => expect(mockTrackGrammarEncountered).toHaveBeenCalledTimes(1));
    expect(mockTrackGrammarEncountered).toHaveBeenCalledWith('hello world', {
      confidence: 0.65,
      span: { start: 0, end: 2 },
      origin: 'subtitle:literal',
    });

    dispose();
  });

  it('aggregates repeated detections of the same pattern within one subtitle into a single encounter', async () => {
    mockSupportsGrammar.mockReturnValue(true);
    mockLanguageData = grammarLanguageData;
    const [tokens, setTokens] = createSignal<Token[]>(mockTokens);

    const dispose = renderSubtitle(tokens);

    await vi.waitFor(() => expect(mockTrackGrammarEncountered).toHaveBeenCalledTimes(1));

    // Same subtitle line re-detected via a fresh token array (identical content)
    setTokens([...mockTokens]);
    const flush = Promise.withResolvers<void>();
    setTimeout(flush.resolve, 0);
    await flush.promise;
    expect(mockTrackGrammarEncountered).toHaveBeenCalledTimes(1);

    dispose();
  });

  it('journals a new encounter when the pattern reappears in a later subtitle line', async () => {
    mockSupportsGrammar.mockReturnValue(true);
    mockLanguageData = grammarLanguageData;
    const [tokens, setTokens] = createSignal<Token[]>(mockTokens);

    const dispose = renderSubtitle(tokens);

    await vi.waitFor(() => expect(mockTrackGrammarEncountered).toHaveBeenCalledTimes(1));

    setTokens([
      { word: 'well', surface: 'well', actual_word: 'well', type: 'adverb', partOfSpeech: 'adverb' },
      { word: 'hello', surface: 'hello', actual_word: 'hello', type: 'noun', partOfSpeech: 'noun' },
      { word: 'world', surface: 'world', actual_word: 'world', type: 'noun', partOfSpeech: 'noun' },
    ]);

    await vi.waitFor(() => expect(mockTrackGrammarEncountered).toHaveBeenCalledTimes(2));
    expect(mockTrackGrammarEncountered).toHaveBeenLastCalledWith('hello world', {
      confidence: 0.65,
      span: { start: 1, end: 3 },
      origin: 'subtitle:literal',
    });

    dispose();
  });

  it('does not create mastery evidence from passive subtitle exposure', async () => {
    mockSupportsGrammar.mockReturnValue(true);
    mockLanguageData = grammarLanguageData;

    const dispose = renderSubtitle(() => mockTokens);

    await vi.waitFor(() => expect(mockTrackGrammarEncountered).toHaveBeenCalledTimes(1));
    expect(mockTrackGrammarFailed).not.toHaveBeenCalled();

    dispose();
  });

  it('does not journal grammar encounters when grammar recognition is unsupported', async () => {
    mockSupportsGrammar.mockReturnValue(false);
    mockLanguageData = grammarLanguageData;

    const dispose = renderSubtitle(() => mockTokens);

    const flush = Promise.withResolvers<void>();
    setTimeout(flush.resolve, 0);
    await flush.promise;
    expect(mockTrackGrammarEncountered).not.toHaveBeenCalled();

    dispose();
  });

});
