/**
 * SubtitleContainer Tests
 */

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { SubtitleContainer } from './SubtitleContainer';
import type { CapabilityKey, LanguageData, Token } from '../../../shared/types';
import type { HoverData } from '../../hooks/useWordHover';

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
const mockGetAccessStatus = vi.fn((_word: string, capability: CapabilityKey, language?: string) => ({
  status: language === 'ar' && (capability === 'surface-recognition' || capability === 'sense-recognition') ? 'known' as const : 'unknown' as const,
  ease: 0, source: 'None' as const,
}));
const mockIsWordSettledSync = vi.fn((word: string, language?: string) => mockIsWordKnownComprehensiveSync(word, language));
const mockTrackWordSeen = vi.fn();
const mockTrackWordHovered = vi.fn();
const mockCancelWordHover = vi.fn();
const mockSupportsGrammar = vi.fn(() => false);
const mockDetectGrammar = vi.fn(() => [] as { pattern: string; level: number }[]);
const mockTrackGrammarFailed = vi.fn();
const mockTrackGrammarEncountered = vi.fn();
const mockTranslateWord = vi.fn().mockResolvedValue({
  data: [{ definitions: ['test definition'], reading: 'test reading' }],
});
const mockHoverState: {
  data: HoverData | null;
  visible: boolean;
  admitted: boolean;
  onDismiss: ((data: HoverData) => void) | null;
} = { data: null, visible: false, admitted: false, onDismiss: null };
const mockLookup = vi.fn().mockResolvedValue([]);

vi.mock('../../context', () => ({
  useSettings: () => ({ settings: mockSettings }),
  useLanguage: () => ({
    isTranslatable: () => true,
    isTokenTranslatable: () => true,
    detectGrammarInText: mockDetectGrammar,
    supportsGrammar: () => mockSupportsGrammar(),
    currentLangData: () => mockLanguageData,
    getCanonicalForm: mockGetCanonicalForm,
    getLanguageFeatures: () => ({ supportsReadings: false, prosodyRenderer: undefined, supportsProsody: false }),
    getFrequency: () => null,
  }),
  useFlashcards: () => ({
    isKnowledgeReady: () => true,
    getAccessStatus: mockGetAccessStatus,
    isWordKnownByText: () => false,
    isWordKnownComprehensiveSync: mockIsWordKnownComprehensiveSync,
    isWordSettledSync: (word: string, language?: string) => mockIsWordSettledSync(word, language),
    getComprehensiveWordStatusWithSourceSync: (word: string, language?: string) => ({
      status: mockIsWordKnownComprehensiveSync(word, language) ? 'known' : 'unknown',
      source: 'None',
      timesSeen: 0,
    }),
    getComprehensiveWordStatusSync: () => 'unknown',
    trackWordHovered: mockTrackWordHovered,
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
  useWordHover: (lifecycle?: { onDismiss?: (data: HoverData) => void }) => {
    mockHoverState.onDismiss = lifecycle?.onDismiss ?? null;
    return {
      hoverData: () => mockHoverState.data,
      isVisible: () => mockHoverState.visible,
      showHover: (data: HoverData) => {
        const sameOpen = mockHoverState.visible && mockHoverState.data?.element === data.element
          && mockHoverState.data?.token === data.token
          && mockHoverState.data?.lookupWord === data.lookupWord
          && mockHoverState.data?.language === data.language
          && mockHoverState.data?.contextIdentity === data.contextIdentity;
        mockHoverState.data = data;
        mockHoverState.visible = true;
        if (!sameOpen) mockHoverState.admitted = false;
        return !sameOpen;
      },
      hideHover: vi.fn(),
      cancelHide: vi.fn(),
      forceHide: (...args: unknown[]) => {
        mockForceHide(...args);
        if (mockHoverState.data) mockHoverState.onDismiss?.(mockHoverState.data);
        mockHoverState.data = null;
        mockHoverState.visible = false;
        mockHoverState.admitted = false;
      },
      admitVisibleReveal: (onAdmit: (data: HoverData) => void) => {
        if (!mockHoverState.visible || !mockHoverState.data || mockHoverState.admitted) return false;
        mockHoverState.admitted = true;
        onAdmit(mockHoverState.data);
        return true;
      },
      isCurrentHover: (data: HoverData) => mockHoverState.visible && mockHoverState.data === data,
    };
  },
  useDictionary: () => ({
    lookup: mockLookup,
  }),
  useTranslation: () => ({
    translateWord: mockTranslateWord,
  }),
  getCachedTranslation: () => null,
}));

vi.mock('./WordHover', () => ({
  WordHover: (props: { word?: string; onOpenExplainer?: (word: string, context: string, position: { x: number; y: number }) => void }) =>
    <button data-testid="explanation-request" onClick={() => props.onOpenExplainer?.(props.word ?? '', 'context', { x: 0, y: 0 })}>Explain</button>,
}));

vi.mock('../../services/wordLookupService', () => ({
  initWordLookupBridge: () => () => {},
}));

describe('SubtitleContainer', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    container = document.createElement('div');
    document.body.appendChild(container);
    mockSettings.showSubtitles = true;
    mockSettings.showDictionary = false;
    mockSettings.blur_known_subtitles = false;
    mockSettings.showLiveTranslator = false;
    mockSettings.language = 'ja';
    mockSettings.readerWordHoverTrigger = 'hover';
    mockSettings.readerWordHoverKey = 'Alt';
    mockLanguageData = null;
    mockGetCanonicalForm.mockImplementation((word: string) => word);
    mockIsWordKnownComprehensiveSync.mockClear();
    mockGetAccessStatus.mockClear();
    mockTrackWordSeen.mockClear();
    mockTrackWordHovered.mockClear();
    mockCancelWordHover.mockClear();
    mockHoverState.data = null;
    mockHoverState.visible = false;
    mockHoverState.admitted = false;
    mockHoverState.onDismiss = null;
    mockLookup.mockReset();
    mockLookup.mockResolvedValue([]);
    mockDetectGrammar.mockReturnValue([]);
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
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const mockTokens: Token[] = [
    { word: 'hello', surface: 'hello', actual_word: 'hello', type: 'noun', partOfSpeech: 'noun' },
    { word: 'world', surface: 'world', actual_word: 'world', type: 'noun', partOfSpeech: 'noun' },
  ];

  it('waits for useful lookup content before starting familiarity tracking', async () => {
    let resolveTranslation!: (value: { data: Array<{ definitions: string[]; reading: string }> }) => void;
    mockTranslateWord.mockReturnValueOnce(new Promise((resolve) => { resolveTranslation = resolve; }));
    const token: Token = { word: 'hello', surface: 'hello', actual_word: 'hello', type: 'noun' };
    const dispose = render(() => (
      <SubtitleContainer tokens={[token]} originalText="hello" isLoading={false} />
    ), container);

    container.querySelector('.subtitle-word')?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(mockTrackWordHovered).not.toHaveBeenCalled();

    resolveTranslation({ data: [{ definitions: ['hello: greeting'], reading: '' }] });
    await vi.waitFor(() => expect(mockTrackWordHovered).toHaveBeenCalledWith('hello', undefined, 'ja', undefined));

    dispose();
  });

  it('does not admit a useful response after the window blurs', async () => {
    let resolveTranslation!: (value: { data: Array<{ definitions: string[]; reading: string }> }) => void;
    mockTranslateWord.mockReturnValueOnce(new Promise((resolve) => { resolveTranslation = resolve; }));
    const token: Token = { word: 'hello', surface: 'hello', actual_word: 'hello', type: 'noun' };
    const dispose = render(() => (
      <SubtitleContainer tokens={[token]} originalText="hello" isLoading={false} />
    ), container);

    container.querySelector('.subtitle-word')?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    window.dispatchEvent(new Event('blur'));
    resolveTranslation({ data: [{ definitions: ['hello: greeting'], reading: '' }] });
    await Promise.resolve();
    await Promise.resolve();

    expect(mockTrackWordHovered).not.toHaveBeenCalled();
    dispose();
  });

  it('does not admit a subtitle long-hover cancelled at 400 ms before the reveal', () => {
    vi.useFakeTimers();
    mockSettings.readerWordHoverTrigger = 'long-hover';
    const token: Token = { word: 'hello', surface: 'hello', actual_word: 'hello', type: 'noun' };
    const dispose = render(() => (
      <SubtitleContainer tokens={[token]} originalText="hello" isLoading={false} />
    ), container);

    const word = container.querySelector('.subtitle-word')!;
    word.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    vi.advanceTimersByTime(400);
    word.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    vi.advanceTimersByTime(200);

    expect(mockTrackWordHovered).not.toHaveBeenCalled();
    expect(mockCancelWordHover).not.toHaveBeenCalled();
    dispose();
    vi.useRealTimers();
  });

  it('does not admit key-hover while its key is not held, even past the reveal delay', () => {
    vi.useFakeTimers();
    mockSettings.readerWordHoverTrigger = 'key-hover';
    const token: Token = { word: 'hello', surface: 'hello', actual_word: 'hello', type: 'noun' };
    const dispose = render(() => (
      <SubtitleContainer tokens={[token]} originalText="hello" isLoading={false} />
    ), container);

    container.querySelector('.subtitle-word')?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    vi.advanceTimersByTime(700);

    expect(mockTrackWordHovered).not.toHaveBeenCalled();
    dispose();
    vi.useRealTimers();
  });

  it('admits only one familiarity record when translation and dictionary both provide content', async () => {
    mockSettings.showDictionary = true;
    mockLookup.mockResolvedValueOnce([{ word: 'hello', reading: '', meanings: ['dictionary meaning'] }]);
    const token: Token = { word: 'hello', surface: 'hello', actual_word: 'hello', type: 'noun' };
    const dispose = render(() => (
      <SubtitleContainer tokens={[token]} originalText="hello" isLoading={false} />
    ), container);

    container.querySelector('.subtitle-word')?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await vi.waitFor(() => expect(mockTrackWordHovered).toHaveBeenCalledOnce());

    expect(mockTrackWordHovered).toHaveBeenCalledWith('hello', undefined, 'ja', undefined);
    dispose();
  });

  it('records only eligible cue encounters and accepts a repeated line at a new cue', () => {
    const [cue, setCue] = createSignal('video:pass1:cue1');
    const [eligible, setEligible] = createSignal(false);
    const dispose = render(() => (
      <SubtitleContainer
        tokens={mockTokens}
        originalText="hello world"
        isLoading={false}
        encounterId={cue()}
        passiveObservationEligible={eligible()}
      />
    ), container);
    expect(mockTrackWordSeen).not.toHaveBeenCalled();

    setEligible(true);
    expect(mockTrackWordSeen).toHaveBeenCalledTimes(2);
    expect(mockTrackWordSeen.mock.calls[0][4]).toContain('video:pass1:cue1');
    setEligible(false);
    setEligible(true);
    expect(mockTrackWordSeen).toHaveBeenCalledTimes(2);

    setCue('video:pass1:cue2');
    expect(mockTrackWordSeen).toHaveBeenCalledTimes(4);
    dispose();
  });

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

  it('an explanation request does not invent a failed grammar recall', () => {
    mockSupportsGrammar.mockReturnValue(true);
    mockDetectGrammar.mockReturnValue([{ pattern: 'package:construction', level: 1 }]);
    mockHoverState.data = { word: 'hello', token: mockTokens[0], translation: null,
      position: { x: 0, y: 0 }, element: container, language: 'ja' };
    mockHoverState.visible = true;
    const dispose = render(() => <SubtitleContainer tokens={mockTokens} originalText="hello world" isLoading={false} />, container);
    try {
      const explain = container.querySelector('[data-testid="explanation-request"]') as HTMLButtonElement;
      expect(explain).toBeTruthy();
      explain.click();
      expect(mockTrackGrammarFailed).not.toHaveBeenCalled();
    } finally { dispose(); }
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
    expect(mockGetAccessStatus).toHaveBeenCalledWith('يكتب', 'surface-recognition', 'ar');
    expect(mockGetAccessStatus).toHaveBeenCalledWith('يكتب', 'sense-recognition', 'ar');
    expect(container.querySelector('.subtitles')?.classList.contains('subtitle-line-blur')).toBe(true);
    dispose();
  });

  it('uses the raw lookup word when the owning hover is dismissed', () => {
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
    expect(mockCancelWordHover).not.toHaveBeenCalled();
    mockHoverState.onDismiss?.(mockHoverState.data!);

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

  it('journals grammar only for an eligible cue visit and ignores UI reactivity', async () => {
    mockSupportsGrammar.mockReturnValue(true);
    mockLanguageData = grammarLanguageData;
    const [eligible, setEligible] = createSignal(false);
    const [encounterId, setEncounterId] = createSignal('visit-1:cue-1');
    const [tokens, setTokens] = createSignal<Token[]>(mockTokens);
    const dispose = render(() => <SubtitleContainer tokens={tokens()} originalText="hello world"
      isLoading={false} encounterId={encounterId()} passiveObservationEligible={eligible()} />, container);
    await Promise.resolve();
    expect(mockTrackGrammarEncountered).not.toHaveBeenCalled();
    setEligible(true);
    await vi.waitFor(() => expect(mockTrackGrammarEncountered).toHaveBeenCalledTimes(1));
    expect(mockTrackGrammarEncountered).toHaveBeenLastCalledWith('hello world', expect.objectContaining({ encounterId: 'visit-1:cue-1' }));
    setTokens([...mockTokens]);
    setEligible(false);
    setEligible(true);
    await Promise.resolve();
    expect(mockTrackGrammarEncountered).toHaveBeenCalledTimes(1);
    setEncounterId('visit-2:cue-1');
    await vi.waitFor(() => expect(mockTrackGrammarEncountered).toHaveBeenCalledTimes(2));
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

  // Regression: while a new cue tokenizes, the container used to blank out —
  // it hid stale tokens AND the new cue's already-known raw text, so every
  // cue change flashed empty for the tokenization round-trip. Raw text must
  // stay visible (and unblurred on stale-token knowledge) until tokens land.
  it('keeps raw cue text visible and unblurred while the new cue is tokenizing', () => {
    // 'ar' words resolve known in the mock, so a loaded all-known cue WOULD
    // blur: the loading gate below is what keeps the raw text readable.
    mockSettings.language = 'ar';
    mockSettings.blur_known_subtitles = true;

    const loading = render(
      () => (
        <SubtitleContainer
          tokens={mockTokens}
          originalText="新しい行"
          isLoading={true}
        />
      ),
      container,
    );

    const subtitlesEl = container.querySelector('.subtitles');
    expect(subtitlesEl).not.toBeNull();
    expect(subtitlesEl!.classList.contains('not-shown')).toBe(false);
    expect(subtitlesEl!.classList.contains('subtitle-line-blur')).toBe(false);
    expect(subtitlesEl!.textContent).toContain('新しい行');
    // Stale tokens from the previous cue must not render.
    expect(subtitlesEl!.textContent).not.toContain('hello');
    loading();
    container.innerHTML = '';

    // Positive control: once tokens land, the all-known ar cue blurs again.
    const loaded = render(
      () => (
        <SubtitleContainer
          tokens={mockTokens}
          originalText="hello world"
          isLoading={false}
        />
      ),
      container,
    );
    const loadedEl = container.querySelector('.subtitles');
    expect(loadedEl!.classList.contains('subtitle-line-blur')).toBe(true);
    loaded();
  });

});
