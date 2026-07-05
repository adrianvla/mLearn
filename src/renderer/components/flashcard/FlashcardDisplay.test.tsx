// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import type { Flashcard, LanguageData } from '../../../shared/types';
import { FlashcardDisplay } from './FlashcardDisplay';

const ankiMocks = vi.hoisted(() => ({
  fetchAnkiWordsCacheMock: vi.fn(() => Promise.resolve()),
  findWordInAnkiCacheMock: vi.fn(() => true),
  isAnkiCacheFetchedMock: vi.fn(() => true),
}));

const germanLanguageData: LanguageData = {
  name: 'German',
  settings: { fixed: {} },
  textProcessing: {
    scriptProfile: { acceptedScripts: ['Latn'] },
  },
  frequencyLevels: {
    names: {
      '1': 'German A1',
    },
  },
};

const japaneseLanguageData: LanguageData = {
  name: 'Japanese',
  settings: { fixed: {} },
  textProcessing: {
    scriptProfile: { acceptedScripts: ['Hira', 'Kana', 'Han'] },
  },
  frequencyLevels: {
    names: {
      '1': 'Japanese N5',
    },
  },
};

vi.mock('../../context', () => ({
  useSettings: () => ({
    settings: {
      language: 'ja',
      use_anki: true,
      flashcardStealthMode: false,
      flashcardFlipAnimation: false,
      devMode: false,
    },
  }),
  useLanguage: () => ({
    langData: {
      de: germanLanguageData,
      ja: japaneseLanguageData,
    },
    currentLangData: () => japaneseLanguageData,
    getFrequencyForLanguage: (language: string, word: string) => (
      language === 'de' && word === 'Haus'
        ? { raw_level: 1, level: germanLanguageData.frequencyLevels?.names?.['1'] }
        : null
    ),
    getLevelName: (level: number) => japaneseLanguageData.frequencyLevels?.names?.[String(level)] ?? `Level ${level}`,
    getCanonicalForm: (word: string) => `ja:${word}`,
    getWordVariants: (word: string) => [`ja-variant:${word}`],
    getCanonicalFormForLanguage: (language: string, word: string) => `${language}:${word}`,
    getWordVariantsForLanguage: (language: string, word: string) => [`${language}-variant:${word}`],
  }),
  useLocalization: () => ({
    t: (key: string) => {
      if (key === 'mlearn.Flashcards.Card.AnkiDuplicate') return 'Anki duplicate';
      return key;
    },
  }),
}));

vi.mock('../common', () => ({
  Panel: (props: { children?: JSX.Element; class?: string; classList?: Record<string, boolean> }) => (
    <section class={props.class} classList={props.classList}>{props.children}</section>
  ),
  PillLabel: (props: { children?: JSX.Element; level?: number; class?: string }) => (
    <span class={props.class} data-level={props.level}>{props.children}</span>
  ),
  IconBtn: () => <button type="button" />,
  HoverReveal: (props: { label: string; class?: string }) => <span class={props.class}>{props.label}</span>,
  AnkiIcon: () => <span />,
  RefreshIcon: () => <span />,
}));

vi.mock('./FlashcardWordTitle', () => ({
  FlashcardWordTitle: (props: { content: { front: string }; language?: string }) => (
    <span data-flashcard-language={props.language}>{props.content.front}</span>
  ),
}));

vi.mock('../../services/ankiWordsCache', () => ({
  fetchAnkiWordsCache: ankiMocks.fetchAnkiWordsCacheMock,
  findWordInAnkiCache: ankiMocks.findWordInAnkiCacheMock,
  isAnkiCacheFetched: ankiMocks.isAnkiCacheFetchedMock,
}));

vi.mock('../../../shared/platform', () => ({
  isElectron: () => false,
}));

function makeCard(overrides: Partial<Flashcard> = {}): Flashcard {
  return {
    id: 'card-1',
    language: 'de',
    content: {
      type: 'word',
      front: 'Haus',
      back: 'house',
      level: 1,
    },
    state: 'new',
    dueDate: Date.now(),
    interval: 0,
    ease: 2.5,
    reviews: 0,
    lapses: 0,
    learningStep: 0,
    createdAt: Date.now(),
    lastReviewed: Date.now(),
    lastUpdated: Date.now(),
    ...overrides,
  };
}

describe('FlashcardDisplay', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.clearAllMocks();
    germanLanguageData.frequencyLevels = {
      names: {
        '1': 'German A1',
      },
    };
    ankiMocks.fetchAnkiWordsCacheMock.mockResolvedValue(undefined);
    ankiMocks.findWordInAnkiCacheMock.mockReturnValue(true);
    ankiMocks.isAnkiCacheFetchedMock.mockReturnValue(true);
  });

  afterEach(() => {
    container.remove();
  });

  it('uses saved card language metadata for level labels and Anki duplicate lookup', () => {
    const dispose = render(() => (
      <FlashcardDisplay flashcard={makeCard()} />
    ), container);

    expect(container.textContent).toContain('German A1');
    expect(container.textContent).not.toContain('Japanese N5');
    expect(container.textContent).toContain('Anki duplicate');
    expect(ankiMocks.findWordInAnkiCacheMock).toHaveBeenCalledWith(['de-variant:Haus'], expect.objectContaining({
      language: 'de',
      languageData: germanLanguageData,
    }));

    dispose();
  });

  it('derives level labels from the saved card language when the card has no copied level', () => {
    const card = makeCard({
      content: {
        type: 'word',
        front: 'Haus',
        back: 'house',
      },
    });

    const dispose = render(() => (
      <FlashcardDisplay flashcard={card} />
    ), container);

    expect(container.textContent).toContain('German A1');
    expect(container.textContent).not.toContain('Japanese N5');

    dispose();
  });

  it('does not render undeclared zero levels from saved cards', () => {
    const card = makeCard({
      content: {
        type: 'word',
        front: 'Haus',
        back: 'house',
        level: 0,
      },
    });

    const dispose = render(() => (
      <FlashcardDisplay flashcard={card} />
    ), container);

    expect(container.textContent).not.toContain('Level 0');
    expect(container.textContent).not.toContain('German A1');

    dispose();
  });

  it('renders zero levels when the saved card language declares zero as a real band', () => {
    const card = makeCard({
      language: 'de',
      content: {
        type: 'word',
        front: 'Haus',
        back: 'house',
        level: 0,
      },
    });
    germanLanguageData.frequencyLevels = {
      names: {
        '0': 'German Starter',
        '1': 'German A1',
      },
    };

    const dispose = render(() => (
      <FlashcardDisplay flashcard={card} />
    ), container);

    expect(container.textContent).toContain('German Starter');

    dispose();
  });
});
