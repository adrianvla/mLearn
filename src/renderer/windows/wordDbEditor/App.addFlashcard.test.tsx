// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal, type JSX } from 'solid-js';
import type { WordEntry } from './components';
import type { Flashcard, FlashcardContent } from '../../../shared/types';

/**
 * The vocabulary browser, the subtitle hover, and the word definition popup are
 * three entry points into one product action: "put this word in my deck".
 * They must all build the card through the same owner, otherwise the row a user
 * reads is not the card they get.
 */

const mockAddFlashcard = vi.fn<(...args: unknown[]) => Promise<string>>(async () => 'card-id');
const mockGetCardByWordSync = vi.fn<() => Flashcard | null>(() => null);
const mockGetCachedTranslation = vi.fn();
const mockFetchTranslation = vi.fn();
const mockBuildWordHoverFlashcardContent = vi.fn();
const mockProjectedWordStatus = vi.fn(() => ({ status: 'known' as const, basis: 'claim' as const }));
const renderedEntries: WordEntry[] = [];
const [activeLanguage] = createSignal('ja');
let mockWordFrequency: Record<string, { reading: string; raw_level: number; level: string }> = {
  あそこ: { reading: 'あそこ', raw_level: 5, level: 'N5' },
};

vi.mock('../../hooks/useVirtualizer', () => ({
  createVirtualizer: (options: { count: number }) => ({
    getVirtualItems: () => Array.from({ length: options.count }, (_, index) => ({ index, start: index * 56 })),
    getTotalSize: () => options.count * 56,
    measureElement: vi.fn(),
    measure: vi.fn(),
  }),
}));

vi.mock('../../services/dictionaryUniverse', () => ({
  loadDictionaryUniverse: vi.fn(async () => []),
  clearDictionaryUniverseCache: vi.fn(),
}));

vi.mock('../../context', () => ({
  WindowWrapper: (props: { children?: JSX.Element }) => <div>{props.children}</div>,
  useLanguage: () => ({
    getWordFrequency: () => mockWordFrequency,
    currentLangData: () => null,
    getFreqLevelNames: () => ({ 5: 'N5' }),
    getCanonicalForm: (word: string) => word,
    getWordVariants: (word: string) => [word],
    getReadingVariants: (reading: string) => [reading],
  }),
  useFlashcards: () => ({
    store: { wordKnowledge: {}, flashcards: {} },
    addFlashcard: mockAddFlashcard,
    removeFlashcard: vi.fn(),
    getCardByWord: vi.fn(async () => null),
    getCardByWordSync: mockGetCardByWordSync,
    updateFlashcardContent: vi.fn(),
    updateFlashcard: vi.fn(),
    isLoading: () => false,
    getIgnoredWordsSync: () => [],
    unignoreWordForLanguage: vi.fn(),
    getComprehensiveWordStatusWithSourceSync: vi.fn(() => ({ status: 'unknown', source: 'None', timesSeen: 0 })),
  }),
  useLocalization: () => ({ t: (key: string) => key }),
  useSettings: () => ({
    settings: {
      get language() { return activeLanguage(); },
      get use_anki() { return false; },
      colour_codes: {},
      srsLearningThreshold: 1300,
      known_ease_threshold: 1800,
    },
  }),
}));

vi.mock('../../hooks/useDictionaryTargetLanguage', () => ({
  useDictionaryTargetLanguage: () => 'en',
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTokenizer: () => ({ tokenize: vi.fn(async () => []) }),
  getCachedTranslation: mockGetCachedTranslation,
  fetchTranslation: mockFetchTranslation,
}));

vi.mock('../../components/subtitle/wordHoverHelpers', () => ({
  buildWordHoverFlashcardContent: mockBuildWordHoverFlashcardContent,
  wordStatusToNumeric: (status: string) => (status === 'known' ? 3 : status === 'learning' ? 2 : 1),
}));

vi.mock('../../../shared/graph/targets', () => ({
  projectedWordStatus: mockProjectedWordStatus,
}));

vi.mock('../../hooks/useKnowledgeProjections', () => ({
  useKnowledgeProjections: () => ({ projections: () => new Map() }),
}));

vi.mock('../../hooks/useAnki', () => ({
  useAnki: () => ({
    checkConnection: vi.fn(async () => false),
    checkDuplicate: vi.fn(async () => false),
    addNote: vi.fn(async () => null),
  }),
}));

vi.mock('../../services/ankiWordsCache', () => ({
  ankiCacheVersion: () => 0,
  fetchAnkiWordsCache: vi.fn(async () => new Set<string>()),
  isAnkiCacheFetched: () => true,
  getAnkiCacheLastError: () => null,
  refreshAnkiWordsCache: vi.fn(async () => undefined),
}));

vi.mock('./components', () => ({
  SearchBar: () => <input aria-label="Search vocabulary" />,
  EntriesHeader: () => <div />,
  WordEntryRow: (props: { entry: WordEntry; onAddFlashcard?: (entry: WordEntry) => void }) => {
    renderedEntries.push(props.entry);
    return (
      <button
        type="button"
        data-testid={`add-${props.entry.word}`}
        onClick={() => props.onAddFlashcard?.(props.entry)}
      >
        {props.entry.word}
      </button>
    );
  },
  EditTranslationDialog: () => <div />,
  AnkiCardPreviewModal: () => <div />,
}));

vi.mock('../../components/common', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../components/common')>()),
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  ModalLoadingOverlay: () => <div />,
  Spinner: () => <div />,
  SkeletonRows: () => <div />,
  CollapsibleStickyHeader: (props: { children?: JSX.Element; ref?: (el: HTMLDivElement) => void }) => {
    let el!: HTMLDivElement;
    queueMicrotask(() => props.ref?.(el));
    return <div ref={el}>{props.children}</div>;
  },
  buildEmptyPreset: () => [],
  buildWordDbEditorFields: () => ({ fields: [], paletteItems: [] }),
  validateTokens: () => ({ ok: true }),
  evaluateAst: () => true,
  parseTokens: () => null,
}));

vi.mock('../../components/flashcard', () => ({
  FlashcardEditModal: () => <div />,
}));

vi.mock('../../utils/wordForms', () => ({
  getWordFormCandidates: (word: string) => [word],
}));

describe('word-db-editor adds cards through the shared word-card owner', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    mockWordFrequency = { あそこ: { reading: 'あそこ', raw_level: 5, level: 'N5' } };
    renderedEntries.length = 0;
    mockAddFlashcard.mockClear();
    mockGetCardByWordSync.mockReset();
    mockGetCardByWordSync.mockReturnValue(null);
    mockGetCachedTranslation.mockReset();
    mockFetchTranslation.mockReset();
    mockProjectedWordStatus.mockClear();
    mockProjectedWordStatus.mockReturnValue({ status: 'known' as const, basis: 'claim' as const });
    mockBuildWordHoverFlashcardContent.mockReset();
    mockBuildWordHoverFlashcardContent.mockImplementation(async (params: { word: string }) => ({
      content: {
        type: 'word',
        front: params.word,
        back: 'there, over there, that place',
        word: params.word,
        translation: ['there, over there, that place'],
      } as FlashcardContent,
      ease: 1.8,
    }));
  });

  afterEach(() => {
    container.remove();
    vi.resetModules();
  });

  it('builds the card with the shared owner instead of an inline literal', async () => {
    mockGetCachedTranslation.mockReturnValue({ data: [{ definitions: ['there, over there, that place'] }] });
    const { WordDbEditorContent } = await import('./App');
    const dispose = render(() => <WordDbEditorContent />, container);

    await vi.waitFor(() => expect(renderedEntries.length).toBeGreaterThan(0));
    container.querySelector<HTMLButtonElement>('[data-testid="add-あそこ"]')!.click();
    await vi.waitFor(() => expect(mockBuildWordHoverFlashcardContent).toHaveBeenCalled());

    expect(mockBuildWordHoverFlashcardContent).toHaveBeenCalledWith(
      expect.objectContaining({ word: 'あそこ', level: 5, wordStatus: 'known' }),
    );
    dispose();
  });

  it('never writes a card whose answer is the untranslated word', async () => {
    mockGetCachedTranslation.mockReturnValue(undefined);
    mockFetchTranslation.mockResolvedValue({ data: [{ definitions: ['there, over there, that place'] }] });
    const { WordDbEditorContent } = await import('./App');
    const dispose = render(() => <WordDbEditorContent />, container);

    await vi.waitFor(() => expect(renderedEntries.length).toBeGreaterThan(0));
    container.querySelector<HTMLButtonElement>('[data-testid="add-あそこ"]')!.click();
    await vi.waitFor(() => expect(mockAddFlashcard).toHaveBeenCalled());

    const [content, ease] = mockAddFlashcard.mock.calls[0] as [FlashcardContent, number];
    // The old inline literal fell back to entry.word here and shipped
    // back: 'あそこ' together with a reading identical to the word.
    expect(content.back).not.toBe('あそこ');
    expect(content.back).toBe('there, over there, that place');
    expect(content.word).toBe('あそこ');
    expect(ease).toBe(1.8);
    expect(content.reading).toBeUndefined();
    dispose();
  });

  it('adds one card when the same row is clicked repeatedly while the build is in flight', async () => {
    // Regression: five clicks on one "Add mLearn card" button created five
    // identical cards. The row awaits a translation fetch before writing, so a
    // second click starts before the first has written, and nothing serialized
    // the two. Every other capture surface guards this the same way.
    // One resolver per lookup, so the test can settle every click.
    const pendingTranslations: Array<() => void> = [];
    mockGetCachedTranslation.mockReturnValue(undefined);
    mockFetchTranslation.mockImplementation(() => new Promise((resolve) => {
      pendingTranslations.push(() => resolve({ data: [{ definitions: ['there, over there, that place'] }] }));
    }));
    const { WordDbEditorContent } = await import('./App');
    const dispose = render(() => <WordDbEditorContent />, container);

    await vi.waitFor(() => expect(renderedEntries.length).toBeGreaterThan(0));
    const addButton = container.querySelector<HTMLButtonElement>('[data-testid="add-あそこ"]')!;
    addButton.click();
    addButton.click();
    addButton.click();
    addButton.click();
    addButton.click();

    // The guard refuses the repeat clicks before they start any work, so only
    // the first click ever looks a translation up.
    expect(pendingTranslations.length).toBe(1);
    for (const settle of pendingTranslations) settle();
    await vi.waitFor(() => expect(mockAddFlashcard).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));

    // The clicks that landed while the first was in flight must be refused,
    // exactly as the subtitle hover and word-definition surfaces refuse them.
    expect(mockAddFlashcard).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('resolves the translation through the cache the row already warmed', async () => {
    const cached = { data: [{ definitions: ['there, over there, that place'] }] };
    mockGetCachedTranslation.mockReturnValue(cached);
    const { WordDbEditorContent } = await import('./App');
    const dispose = render(() => <WordDbEditorContent />, container);

    await vi.waitFor(() => expect(renderedEntries.length).toBeGreaterThan(0));
    container.querySelector<HTMLButtonElement>('[data-testid="add-あそこ"]')!.click();
    await vi.waitFor(() => expect(mockAddFlashcard).toHaveBeenCalled());

    expect(mockGetCachedTranslation).toHaveBeenCalledWith('あそこ', 'ja', expect.anything());
    expect(mockFetchTranslation).not.toHaveBeenCalled();
    dispose();
  });
});
