// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createEffect, type JSX } from 'solid-js';
import type { LanguageData } from '../../../shared/types';

const mockAddFlashcard = vi.fn();
const mockHasWordSync = vi.fn(() => true);
const mockGetCardByWordSync = vi.fn(() => ({ id: 'card-1', ease: 2.5, content: { front: '赤い' } }));
const mockGetComprehensiveWordStatusSync = vi.fn(() => 'known');
const mockFetchTranslation = vi.fn<() => Promise<{ data: unknown[] }>>(async () => ({ data: [] }));
let mockWindowWord = '赤い';
let mockLanguageData: LanguageData | null = null;
const prosodyOverlayProps: Array<{ word: string; reading?: string; prosodyPosition?: number | null; prosodyType?: string }> = [];
const wordStatusPillProps: Array<{ word: string; language?: string }> = [];

vi.mock('../../context', () => ({
  WindowWrapper: (props: { children?: JSX.Element }) => <div>{props.children}</div>,
  useSettings: () => ({
    settings: {
      language: 'ja',
      uiLanguage: 'en',
      dictionaryTargetLanguages: {},
      showProsody: false,
      show_pos: false,
      srsLearningThreshold: 1500,
      known_ease_threshold: 2500,
    },
  }),
  useFlashcards: () => ({
    addFlashcard: mockAddFlashcard,
    hasWordSync: mockHasWordSync,
    getCardByWordSync: mockGetCardByWordSync,
    getComprehensiveWordStatusSync: mockGetComprehensiveWordStatusSync,
  }),
  useLanguage: () => ({
    getFrequency: () => ({ raw_level: 5, level: 'N5', reading: 'あかい' }),
    getFreqLevelNames: () => ['N1', 'N2', 'N3', 'N4', 'N5'],
    getLanguageFeatures: () => ({ prosodyRenderer: undefined, supportsProsody: false }),
    currentLangData: () => mockLanguageData,
    getCanonicalForm: (word: string) => word,
    getWordVariants: (word: string) => [word],
    getReadingVariants: (word: string) => [word],
  }),
  useLocalization: () => ({
    t: (key: string, params?: Record<string, string>) => {
      if (key === 'mlearn.Flashcards.Card.Ease') return 'Ease';
      if (key === 'mlearn.Flashcards.Card.Tracked') return 'Tracked';
      return params?.error ?? key;
    },
  }),
}));

vi.mock('../../../shared/bridges', () => ({
  getBridge: () => ({
    window: {
      onWindowContext: (callback: (ctx: { word: string }) => void) => {
        callback({ word: mockWindowWord });
        return () => undefined;
      },
      getWindowContext: vi.fn(),
    },
  }),
}));

vi.mock('../../hooks/useTranslation', () => ({
  fetchTranslation: mockFetchTranslation,
  getCachedTranslation: vi.fn(() => null),
  useTokenizer: () => ({ tokenize: vi.fn(() => []) }),
}));

vi.mock('../../services/statsService', () => ({
  toUniqueIdentifier: vi.fn(async () => 'word-id'),
}));

vi.mock('../../components/common', () => ({
  ClockIcon: () => <span />,
  PillBtn: (props: { label?: string; children?: JSX.Element }) => <button>{props.label ?? props.children}</button>,
  PillLabel: (props: { children?: JSX.Element }) => <span>{props.children}</span>,
  Spinner: () => <span />,
}));

vi.mock('../../components/language-specific', () => ({
  ProsodyOverlay: (props: { word: string; reading?: string; prosodyPosition?: number | null; prosodyType?: string }) => {
    createEffect(() => {
      prosodyOverlayProps.push({
        word: props.word,
        reading: props.reading,
        prosodyPosition: props.prosodyPosition,
        prosodyType: props.prosodyType,
      });
    });
    return <span />;
  },
}));

vi.mock('../../components/common/Smart', () => ({
  WordStatusPill: (props: { word: string; language?: string }) => {
    createEffect(() => {
      wordStatusPillProps.push({ word: props.word, language: props.language });
    });
    return <span>{`status:${props.word}`}</span>;
  },
}));

vi.mock('../../components/subtitle/wordHoverHelpers', () => ({
  buildWordHoverFlashcardContent: vi.fn(async () => ({ content: { front: '赤い' }, ease: 1 })),
  resolveProsodyForHover: vi.fn(() => null),
}));

vi.mock('../../services/wordLookupService', () => ({
  openWordLookup: vi.fn(),
}));

describe('WordDefinitionApp', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    mockAddFlashcard.mockClear();
    mockHasWordSync.mockClear();
    mockGetCardByWordSync.mockClear();
    mockGetComprehensiveWordStatusSync.mockClear();
    mockFetchTranslation.mockReset();
    mockFetchTranslation.mockResolvedValue({ data: [] });
    mockWindowWord = '赤い';
    mockLanguageData = null;
    prosodyOverlayProps.length = 0;
    wordStatusPillProps.length = 0;
  });

  afterEach(() => {
    container.remove();
  });

  it('scopes flashcard and status lookups to the definition language', async () => {
    const { WordDefinitionApp } = await import('./App');

    const dispose = render(() => <WordDefinitionApp />, container);
    await Promise.resolve();

    expect(mockGetCardByWordSync).toHaveBeenCalledWith('赤い', 'ja');
    expect(mockHasWordSync).toHaveBeenCalledWith('赤い', 'ja');
    expect(mockGetComprehensiveWordStatusSync).toHaveBeenCalledWith('赤い', 'ja');
    expect(wordStatusPillProps).toContainEqual({ word: '赤い', language: 'ja' });
    dispose();
  });

  it('renders package-declared dictionary readings in the definition body', async () => {
    mockWindowWord = '你好';
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
    mockFetchTranslation.mockResolvedValue({
      data: [{
        word: '你好',
        pinyin: { value: 'nǐ hǎo' },
        definitions: ['hello'],
      }],
    });
    const { WordDefinitionApp } = await import('./App');

    const dispose = render(() => <WordDefinitionApp />, container);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(container.querySelector('.word-definition__translation')?.textContent).toContain('hello');
    expect(container.querySelector('.word-definition__reading')?.textContent).toBe('nǐ hǎo');
    dispose();
  });

  it('does not mount the Japanese pitch renderer for languages without Japanese pitch accents', async () => {
    mockWindowWord = 'Haus';
    mockLanguageData = {
      name: 'German',
      settings: { fixed: {} },
      textProcessing: { scriptProfile: { acceptedScripts: ['Latn'] } },
    };
    mockFetchTranslation.mockResolvedValue({
      data: [{
        word: 'Haus',
        definitions: ['house'],
      }],
    });
    const { WordDefinitionApp } = await import('./App');

    const dispose = render(() => <WordDefinitionApp />, container);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(prosodyOverlayProps).toHaveLength(0);
    dispose();
  });
});
