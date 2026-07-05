// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import type { LanguageData } from '../../../shared/types';

const mockLanguageData: LanguageData = {
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
const prosodyOverlayProps: Array<{ word: string; reading?: string; prosodyPosition?: number | null; prosodyType?: string }> = [];
let mockUseAnki = false;
let mockCurrentLanguageData: LanguageData = mockLanguageData;
const findAnkiWordMatchInCacheMock = vi.fn((_candidates: string[], _options?: unknown) => null);

vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
  callback(0);
  return 1;
});

vi.stubGlobal('ResizeObserver', class MockResizeObserver {
  observe() {}
  disconnect() {}
});

vi.mock('../../context', () => ({
  useSettings: () => ({
    settings: {
      language: 'zh',
      theme: 'dark',
      showProsody: false,
      show_pos: false,
      use_anki: mockUseAnki,
      skipAnkiDuplicateWarning: false,
      flashcardMediaType: 'image',
      srsLearningThreshold: 1500,
      known_ease_threshold: 2500,
    },
    updateSettings: vi.fn(),
  }),
  useFlashcards: () => ({
    addFlashcard: vi.fn(),
    hasWordSync: () => false,
    getCardByWordSync: () => null,
    getComprehensiveWordStatusSync: () => 'unknown',
  }),
  useLanguage: () => ({
    getFrequency: () => null,
    getLevelName: (level: number) => `Level ${level}`,
    getFreqLevelNames: () => [],
    getLanguageFeatures: () => ({
      prosodyRenderer: undefined,
      supportsProsody: false,
      tokenizerCapabilities: {},
    }),
    currentLangData: () => mockCurrentLanguageData,
    getCanonicalForm: (word: string) => word,
    getWordVariants: () => [],
  }),
  useLocalization: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTokenizer: () => ({ tokenize: vi.fn(async () => []) }),
  getCachedTranslation: () => null,
}));

vi.mock('../../services/statsService', () => ({
  toUniqueIdentifier: vi.fn(async () => 'word-id'),
}));

vi.mock('../../services/llmProvider', () => ({
  getCachedExplanation: () => null,
}));

vi.mock('../../services/ankiWordsCache', () => ({
  fetchAnkiWordsCache: vi.fn(async () => undefined),
  findAnkiWordMatchInCache: (candidates: string[], options?: unknown) => findAnkiWordMatchInCacheMock(candidates, options),
  isAnkiCacheFetched: () => true,
}));

vi.mock('../common', () => ({
  Btn: (props: { children?: JSX.Element; label?: string; onClick?: () => void }) => (
    <button type="button" onClick={props.onClick}>{props.label ?? props.children}</button>
  ),
  Modal: (props: { children?: JSX.Element }) => <div>{props.children}</div>,
  PillBtn: (props: { label?: string; children?: JSX.Element }) => <button type="button">{props.label ?? props.children}</button>,
  PillLabel: (props: { children?: JSX.Element }) => <span>{props.children}</span>,
  ToggleSwitch: () => <input type="checkbox" />,
}));

vi.mock('../language-specific', () => ({
  ProsodyOverlay: (props: { word: string; reading?: string; prosodyPosition?: number | null; prosodyType?: string }) => {
    prosodyOverlayProps.push({
      word: props.word,
      reading: props.reading,
      prosodyPosition: props.prosodyPosition,
      prosodyType: props.prosodyType,
    });
    return <span />;
  },
}));

vi.mock('../common/Smart', () => ({
  ResourcePill: () => <span />,
  WordStatusPill: () => <span />,
}));

vi.mock('../../services/wordLookupService', () => ({
  openWordLookup: vi.fn(),
}));

vi.mock('../../services/videoClipService', () => ({
  clipVideo: vi.fn(),
}));

vi.mock('../../../shared/bridges', () => ({
  getBridge: () => ({
    flashcards: {
      saveFlashcardImage: vi.fn(async () => ''),
    },
  }),
}));

vi.mock('../common/Feedback/Toast', () => ({
  showToast: vi.fn(),
}));

describe('WordHover', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    prosodyOverlayProps.length = 0;
    mockUseAnki = false;
    mockCurrentLanguageData = mockLanguageData;
    findAnkiWordMatchInCacheMock.mockClear();
    findAnkiWordMatchInCacheMock.mockReturnValue(null);
  });

  afterEach(() => {
    container.remove();
  });

  it('renders package-declared dictionary readings in translation entries', async () => {
    const { WordHover } = await import('./WordHover');

    const dispose = render(() => (
      <WordHover
        token={{ word: '你好', surface: '你好', actual_word: '你好', type: 'word' }}
        word="你好"
        position={{ x: 120, y: 120 }}
        translationData={{
          data: [{
            word: '你好',
            pinyin: { value: 'nǐ hǎo' },
            definitions: ['hello'],
          }],
        }}
        visible={true}
      />
    ), container);

    expect(container.querySelector('.hover_translation')?.textContent).toContain('hello');
    expect(container.querySelector('.hover_reading')?.textContent).toBe('nǐ hǎo');
    dispose();
  });

  it('does not mount the Japanese pitch renderer when the language does not use Japanese pitch accents', async () => {
    const { WordHover } = await import('./WordHover');

    const dispose = render(() => (
      <WordHover
        token={{ word: '你好', surface: '你好', actual_word: '你好', type: 'word' }}
        word="你好"
        position={{ x: 120, y: 120 }}
        translationData={{
          data: [{
            word: '你好',
            pinyin: { value: 'nǐ hǎo' },
            definitions: ['hello'],
          }],
        }}
        visible={true}
      />
    ), container);

    expect(prosodyOverlayProps).toHaveLength(0);
    dispose();
  });

  it('uses language metadata normalizers when matching token hover words against the Anki cache', async () => {
    mockUseAnki = true;
    mockCurrentLanguageData = {
      name: 'Persian',
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Arab'] },
        lexemeNormalization: {
          type: 'surface',
          surfaceScripts: ['Arab'],
          surfaceNormalizers: ['persian-arabic'],
        },
      },
    };
    const { WordHover } = await import('./WordHover');

    const dispose = render(() => (
      <WordHover
        token={{ word: 'كِتــاب', surface: 'كِتــاب', actual_word: 'كِتــاب', type: 'word' }}
        word="كِتــاب"
        position={{ x: 120, y: 120 }}
        translationData={{
          data: [{
            word: 'كِتــاب',
            definitions: ['book'],
          }],
        }}
        visible={true}
      />
    ), container);

    const candidateCalls = findAnkiWordMatchInCacheMock.mock.calls.map((call: [string[], unknown?]) => call[0]);
    expect(candidateCalls).toContainEqual(['كِتــاب', 'كِتاب', 'كتاب', 'کتاب']);

    dispose();
  });
});
