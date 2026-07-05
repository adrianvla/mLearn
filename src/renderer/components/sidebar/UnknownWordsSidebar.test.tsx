// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import type { TranslationResponse } from '../../../shared/types';

const translationByWord = new Map<string, TranslationResponse | null | undefined>();
const trackedWords = new Set<string>();
const flashcardsByWord = new Map<string, { ease: number }>();
const ankiMatchesByWord = new Map<string, { word: string; cards: Array<{ factor?: number; queue?: number; type?: number }> }>();
const wordStatusPillProps: Array<{ word: string; language?: string }> = [];
const mockHasWordSync = vi.fn((word: string) => trackedWords.has(word));
const mockGetCardByWordSync = vi.fn((word: string) => flashcardsByWord.get(word) ?? null);
const mockGetComprehensiveWordStatusSync = vi.fn(() => 'unknown');
const mockIsWordIgnoredSync = vi.fn(() => false);
const mockResolveProsodyForHover = vi.fn(() => null as {
  renderer: 'inline-overlay' | 'label';
  overlayRenderer?: string;
  label: string;
  value: string;
  position?: number;
  type: string;
} | null);
let mockShowProsody = false;
let mockLanguageFeatures = { prosodyRenderer: undefined, supportsProsody: false };

vi.mock('../common', () => ({
  Btn: (props: { label?: string; onClick?: () => void; disabled?: boolean }) => (
    <button disabled={props.disabled} onClick={props.onClick}>{props.label}</button>
  ),
  CollapsibleStickyHeader: (props: { children?: JSX.Element; class?: string }) => <div class={props.class}>{props.children}</div>,
  PillBtn: (props: { label?: string; children?: JSX.Element; onClick?: () => void; disabled?: boolean; ['aria-pressed']?: boolean }) => (
    <button
      aria-pressed={props['aria-pressed']}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.label ?? props.children}
    </button>
  ),
  PillLabel: (props: { children?: JSX.Element; class?: string }) => <span class={props.class}>{props.children}</span>,
  Select: (props: { value: string; onChange?: (event: Event & { currentTarget: HTMLSelectElement }) => void; options: Array<{ value: string; label: string }> }) => (
    <select value={props.value} onChange={props.onChange}>
      {props.options.map((option) => (
        <option value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));

vi.mock('../language-specific', () => ({
  ProsodyOverlay: (props: { children?: JSX.Element }) => <span>{props.children}</span>,
  WordWithReading: (props: { word: string; reading?: string | null }) => (
    <span
      class="mock-word-with-reading"
      data-word={props.word}
      data-reading={props.reading ?? ''}
    >
      {props.reading ? `${props.word}:${props.reading}` : props.word}
    </span>
  ),
}));

vi.mock('../common/Smart', () => ({
  ResourcePill: (props: { word: string }) => <span class="mock-resource-pill">{`resource:${props.word}`}</span>,
  WordStatusPill: (props: { word: string; language?: string }) => {
    wordStatusPillProps.push({ word: props.word, language: props.language });
    return <span class="mock-status-pill">{`status:${props.word}`}</span>;
  },
}));

vi.mock('../../context', () => ({
  useLocalization: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      switch (key) {
        case 'mlearn.AITutorSetup.AllLevels':
          return 'All';
        case 'mlearn.ConversationAgent.Stats.FailedWords':
          return 'Failed Words';
        case 'mlearn.ConversationAgent.Stats.NoFailedWords':
          return 'No failed words yet';
        case 'mlearn.Sidebar.AddAll':
          return 'Add All';
        case 'mlearn.Sidebar.AddingAll':
          return 'Adding...';
        case 'mlearn.Sidebar.DictionaryOnly':
          return 'Dictionary only';
        case 'mlearn.Sidebar.Ignore':
          return 'Ignore';
        case 'mlearn.Sidebar.SortBy.Word':
          return 'Word';
        case 'mlearn.Sidebar.UnknownWords':
          return 'Unknown Words';
        case 'mlearn.Sidebar.WordCount':
          return `${params?.count ?? 0} words`;
        default:
          return key;
      }
    },
  }),
  useSettings: () => ({
    settings: {
      use_anki: true,
      language: 'ja',
      enable_flashcard_creation: true,
      show_pos: false,
      showProsody: mockShowProsody,
      ankiLearningThreshold: 1500,
      ankiKnownThreshold: 1800,
      ankiLearningEase: 1500,
      ankiKnownEase: 1800,
      knowledgeSourceOrder: ['srs', 'anki', 'manual'],
      knowledgeResolutionMode: 'highest',
    },
  }),
  useFlashcards: () => ({
    hasWordSync: mockHasWordSync,
    getCardByWordSync: mockGetCardByWordSync,
    getComprehensiveWordStatusSync: mockGetComprehensiveWordStatusSync,
    isWordIgnoredSync: mockIsWordIgnoredSync,
  }),
  useLanguage: () => ({
    getFrequency: () => null,
    getLevelName: (level: number) => `Level ${level}`,
    getLanguageFeatures: () => mockLanguageFeatures,
    getCanonicalForm: (word: string) => word,
    getWordVariants: (word: string) => [word],
    getReadingVariants: (word: string) => [word],
    currentLangData: () => null,
  }),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({
    translateWord: vi.fn(async (word: string) => translationByWord.get(word) ?? null),
  }),
  getCachedTranslation: (word: string) => translationByWord.get(word),
}));

vi.mock('../subtitle/wordHoverHelpers', () => ({
  extractReadingFromEntries: (entries: Array<{ reading?: string }>) => entries.find((entry) => entry.reading)?.reading ?? '',
  resolveProsodyForHover: mockResolveProsodyForHover,
  getAnkiWordKnowledgeStatus: (cards: Array<{ factor?: number }> | null | undefined) => cards && cards.length > 0 ? 'learning' : null,
  numericToWordStatus: (status: number) => {
    if (status === 1) return 'learning';
    if (status === 2) return 'known';
    return 'unknown';
  },
}));

vi.mock('../../utils/readingProsody', () => ({
  normalizeDictionaryReading: (reading: string) => reading,
}));

vi.mock('../../services/statsService', () => ({
  getWordStatus: () => 0,
}));

vi.mock('../../services/ankiWordsCache', () => ({
  fetchAnkiWordsCache: vi.fn(async () => undefined),
  findAnkiWordMatchInCache: (words: readonly string[]) => {
    for (const word of words) {
      const match = ankiMatchesByWord.get(word);
      if (match) {
        return match;
      }
    }
    return null;
  },
  isAnkiCacheFetched: () => true,
}));

vi.mock('../../utils/wordForms', () => ({
  getWordFormCandidates: (word: string) => [word],
}));

describe('UnknownWordsSidebar', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    translationByWord.clear();
    trackedWords.clear();
    flashcardsByWord.clear();
    ankiMatchesByWord.clear();
    wordStatusPillProps.length = 0;
    mockHasWordSync.mockClear();
    mockGetCardByWordSync.mockClear();
    mockGetComprehensiveWordStatusSync.mockClear();
    mockIsWordIgnoredSync.mockClear();
    mockResolveProsodyForHover.mockReset();
    mockResolveProsodyForHover.mockReturnValue(null);
    mockShowProsody = false;
    mockLanguageFeatures = { prosodyRenderer: undefined, supportsProsody: false };

    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('filters the list by failed words and scopes add-all to the active category', async () => {
    translationByWord.set('apple', {
      data: [{ definitions: ['fruit'], reading: 'apple' }],
    } as TranslationResponse);
    translationByWord.set('banana', null);

    const onAddAllClick = vi.fn();
    const words = [
      {
        key: 'word-1',
        word: 'apple',
        token: { word: 'apple', actual_word: 'apple', partOfSpeech: 'noun', type: 'word' },
        contextPhrase: 'apple context',
      },
      {
        key: 'word-2',
        word: 'banana',
        token: { word: 'banana', actual_word: 'banana', partOfSpeech: 'noun', type: 'word' },
        contextPhrase: 'banana context',
      },
    ];

    const { UnknownWordsSidebar } = await import('./UnknownWordsSidebar');

    const dispose = render(() => (
      <UnknownWordsSidebar
        words={() => words}
        addingWordKeys={() => new Set<string>()}
        isAddingAll={() => false}
        failedWordSet={() => new Set<string>(['banana'])}
        failedEmptyMessage="No failed words yet"
        onAddWord={() => undefined}
        onIgnoreWord={() => undefined}
        sortOptions={() => [{ value: 'word', label: 'Word' }]}
        defaultSort="word"
        emptyMessage="No unknown words"
        onAddAllClick={onAddAllClick}
      />
    ), container);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(container.textContent).toContain('apple');
    expect(container.textContent).toContain('banana');

    const failedButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Failed Words');
    failedButton?.click();

    expect(container.textContent).not.toContain('apple context');
    expect(container.textContent).toContain('banana');
    expect(container.textContent).toContain('1 words');

    const addAllButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Add All');
    addAllButton?.click();

    expect(onAddAllClick).toHaveBeenCalledTimes(1);
    expect(onAddAllClick.mock.calls[0][0]).toEqual([
      expect.objectContaining({ word: 'banana' }),
    ]);
    expect(onAddAllClick.mock.calls[0][1]).toEqual([]);

    dispose();
  });

  it('passes dictionary readings to the shared word renderer when pitch accent is disabled', async () => {
    translationByWord.set('漢字', {
      data: [{ definitions: ['characters'], reading: 'かんじ' }],
    } as TranslationResponse);

    const words = [
      {
        key: 'word-1',
        word: '漢字',
        token: { word: '漢字', actual_word: '漢字', partOfSpeech: 'noun', type: 'word' },
        contextPhrase: '漢字 context',
      },
    ];

    const { UnknownWordsSidebar } = await import('./UnknownWordsSidebar');

    const dispose = render(() => (
      <UnknownWordsSidebar
        words={() => words}
        addingWordKeys={() => new Set<string>()}
        isAddingAll={() => false}
        onAddWord={() => undefined}
        onIgnoreWord={() => undefined}
        sortOptions={() => [{ value: 'word', label: 'Word' }]}
        defaultSort="word"
        emptyMessage="No unknown words"
        onAddAllClick={() => undefined}
      />
    ), container);

    await Promise.resolve();

    const renderedWord = container.querySelector('.mock-word-with-reading');
    expect(renderedWord?.getAttribute('data-word')).toBe('漢字');
    expect(renderedWord?.getAttribute('data-reading')).toBe('かんじ');

    dispose();
  });

  it('renders generic package prosody pills for non-Japanese languages', async () => {
    mockShowProsody = true;
    mockLanguageFeatures = { prosodyRenderer: undefined, supportsProsody: true };
    mockResolveProsodyForHover.mockReturnValue({
      renderer: 'label',
      label: 'Tone contour',
      value: 'falling',
      type: 'tone-contour',
    });
    translationByWord.set('سلام', {
      data: [{ definitions: ['peace'], reading: 'salaam' }, undefined, { tone: 'falling' }],
    } as TranslationResponse);

    const words = [
      {
        key: 'word-1',
        word: 'سلام',
        token: { word: 'سلام', actual_word: 'سلام', partOfSpeech: 'noun', type: 'word' },
        contextPhrase: 'سلام context',
      },
    ];

    const { UnknownWordsSidebar } = await import('./UnknownWordsSidebar');

    const dispose = render(() => (
      <UnknownWordsSidebar
        words={() => words}
        addingWordKeys={() => new Set<string>()}
        isAddingAll={() => false}
        onAddWord={() => undefined}
        onIgnoreWord={() => undefined}
        sortOptions={() => [{ value: 'word', label: 'Word' }]}
        defaultSort="word"
        emptyMessage="No unknown words"
        onAddAllClick={() => undefined}
      />
    ), container);

    await Promise.resolve();

    expect(container.querySelector('.prosody-position-pill')?.textContent).toContain('Tone contour');
    expect(container.querySelector('.prosody-position-pill')?.textContent).toContain('falling');
    expect(mockResolveProsodyForHover).toHaveBeenCalledWith(expect.objectContaining({
      word: 'سلام',
      showProsody: true,
      language: 'ja',
    }));

    dispose();
  });

  it('scopes row status and addability checks to the active language', async () => {
    translationByWord.set('赤い', {
      data: [{ definitions: ['red'], reading: 'あかい' }],
    } as TranslationResponse);

    const words = [{
      key: 'word-1',
      word: '赤い',
      token: { word: '赤い', actual_word: '赤い', partOfSpeech: 'adjective', type: 'adjective' },
      contextPhrase: '赤い花',
    }];

    const { UnknownWordsSidebar } = await import('./UnknownWordsSidebar');

    const dispose = render(() => (
      <UnknownWordsSidebar
        words={() => words}
        addingWordKeys={() => new Set<string>()}
        isAddingAll={() => false}
        onAddWord={() => undefined}
        onIgnoreWord={() => undefined}
        sortOptions={() => [{ value: 'word', label: 'Word' }]}
        defaultSort="word"
        emptyMessage="No unknown words"
        onAddAllClick={() => undefined}
      />
    ), container);

    await Promise.resolve();

    expect(mockGetCardByWordSync).toHaveBeenCalledWith('赤い', 'ja');
    expect(mockGetComprehensiveWordStatusSync).toHaveBeenCalledWith('赤い', 'ja');
    expect(mockHasWordSync).toHaveBeenCalledWith('赤い', 'ja');
    expect(mockIsWordIgnoredSync).toHaveBeenCalledWith('赤い', 'ja');
    expect(wordStatusPillProps).toContainEqual({ word: '赤い', language: 'ja' });
    dispose();
  });
});
