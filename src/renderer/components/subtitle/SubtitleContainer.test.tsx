/**
 * SubtitleContainer Tests
 */

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'solid-js/web';
import { SubtitleContainer } from './SubtitleContainer';
import type { Token } from '../../../shared/types';

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

vi.mock('../../context', () => ({
  useSettings: () => ({ settings: mockSettings }),
  useLanguage: () => ({
    isTranslatable: () => true,
    detectGrammarInText: () => [],
    supportsGrammar: () => false,
    getCanonicalForm: (w: string) => w,
    getLanguageFeatures: () => ({ supportsReadings: false, supportsPitchAccent: false }),
    getFrequency: () => null,
  }),
  useFlashcards: () => ({
    isWordKnownByText: () => false,
    isWordKnownComprehensiveSync: () => false,
    getComprehensiveWordStatusSync: () => 'unknown',
    trackWordHovered: vi.fn(),
    cancelWordHover: vi.fn(),
    trackWordSeen: vi.fn(),
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
    translateWord: vi.fn().mockResolvedValue({
      data: [{ definitions: ['test definition'], reading: 'test reading' }],
    }),
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
});
