// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import type { WordEntry } from './components';
import type { Flashcard } from '../../../shared/types';

const mockHasWordSync = vi.fn(() => false);
const mockGetCardByWordSync = vi.fn<() => Flashcard | null>(() => null);
const mockGetComprehensiveWordStatusWithSourceSync = vi.fn(() => ({
  status: 'unknown',
  source: 'None',
  timesSeen: 0,
}));
const renderedEntries: WordEntry[] = [];
const renderedEditDialogs: Array<{ word: string; initialData: unknown }> = [];
const mockFetchAnkiWordsCache = vi.fn(() => Promise.resolve(new Set<string>()));
const mockIsAnkiCacheFetched = vi.fn(() => true);
const mockFindAnkiWordMatchInCache = vi.fn((): { word: string; lookupKey: string; cards: never[] } | null => null);
let mockUseAnki = false;

vi.mock('../../hooks/useVirtualizer', () => ({
  createVirtualizer: () => ({
    getVirtualItems: () => [{ index: 0, start: 0 }],
    getTotalSize: () => 56,
    measureElement: vi.fn(),
    measure: vi.fn(),
  }),
}));

vi.mock('../../context', () => ({
  WindowWrapper: (props: { children?: JSX.Element }) => <div>{props.children}</div>,
  useLanguage: () => ({
    wordFrequency: {
      '赤い': {
        reading: 'あかい',
        raw_level: 5,
        level: 'N5',
      },
    },
    getWordFrequency: () => ({
      '赤い': {
        reading: 'あかい',
        raw_level: 5,
        level: 'N5',
      },
    }),
    currentLangData: () => null,
    getFreqLevelNames: () => ({ 5: 'N5' }),
    getCanonicalForm: (word: string) => word,
    getWordVariants: (word: string) => [word],
  }),
  useFlashcards: () => ({
    addFlashcard: vi.fn(),
    hasWordSync: mockHasWordSync,
    removeFlashcard: vi.fn(),
    getCardByWord: vi.fn(async () => null),
    getCardByWordSync: mockGetCardByWordSync,
    updateFlashcardContent: vi.fn(),
    updateFlashcard: vi.fn(),
    isLoading: () => false,
    getIgnoredWordsSync: () => [],
    unignoreWordForLanguage: vi.fn(),
    getComprehensiveWordStatusWithSourceSync: mockGetComprehensiveWordStatusWithSourceSync,
  }),
  useLocalization: () => ({ t: (key: string) => key }),
  useSettings: () => ({
    settings: {
      language: 'ja',
      get use_anki() {
        return mockUseAnki;
      },
    },
  }),
}));

vi.mock('../../services/statsService', () => ({
  loadWordsFromStorage: vi.fn(async () => undefined),
}));

vi.mock('../../hooks/useAnki', () => ({
  useAnki: () => ({
    checkConnection: vi.fn(async () => false),
    checkDuplicate: vi.fn(async () => false),
    addNote: vi.fn(async () => null),
  }),
}));

vi.mock('../../services/ankiWordsCache', () => ({
  fetchAnkiWordsCache: mockFetchAnkiWordsCache,
  findAnkiWordMatchInCache: mockFindAnkiWordMatchInCache,
  isAnkiCacheFetched: mockIsAnkiCacheFetched,
  refreshAnkiWordsCache: vi.fn(async () => undefined),
}));

vi.mock('./components', () => ({
  SearchBar: () => <div />,
  EntriesHeader: () => <div />,
  WordEntryRow: (props: { entry: WordEntry; onEdit?: (entry: WordEntry) => void }) => {
    renderedEntries.push(props.entry);
    return (
      <button type="button" data-testid={`edit-${props.entry.word}`} onClick={() => props.onEdit?.(props.entry)}>
        {props.entry.word}
      </button>
    );
  },
  EditTranslationDialog: (props: { word: string; initialData?: unknown }) => {
    renderedEditDialogs.push({ word: props.word, initialData: props.initialData });
    return <div data-testid="edit-dialog" />;
  },
  AnkiCardPreviewModal: () => <div />,
}));

vi.mock('../../components/common', () => ({
  ModalLoadingOverlay: () => <div />,
  Spinner: () => <div />,
  CollapsibleStickyHeader: (props: { children?: JSX.Element; ref?: (el: HTMLDivElement) => void; class?: string }) => {
    let el!: HTMLDivElement;
    queueMicrotask(() => props.ref?.(el));
    return <div ref={el} class={props.class}>{props.children}</div>;
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

describe('WordDbEditorContent', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    mockHasWordSync.mockClear();
    mockHasWordSync.mockReturnValue(false);
    mockGetCardByWordSync.mockClear();
    mockGetCardByWordSync.mockReturnValue(null);
    mockGetComprehensiveWordStatusWithSourceSync.mockClear();
    mockFetchAnkiWordsCache.mockReset();
    mockFetchAnkiWordsCache.mockResolvedValue(new Set<string>());
    mockIsAnkiCacheFetched.mockReset();
    mockIsAnkiCacheFetched.mockReturnValue(true);
    mockFindAnkiWordMatchInCache.mockReset();
    mockFindAnkiWordMatchInCache.mockReturnValue(null);
    mockUseAnki = false;
    renderedEntries.length = 0;
    renderedEditDialogs.length = 0;
  });

  afterEach(() => {
    container.remove();
  });

  it('scopes row flashcard and status lookups to the active language', async () => {
    const { WordDbEditorContent } = await import('./App');

    const dispose = render(() => <WordDbEditorContent />, container);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockHasWordSync).toHaveBeenCalledWith('赤い', 'ja');
    expect(mockGetComprehensiveWordStatusWithSourceSync).toHaveBeenCalledWith('赤い', 'ja');
    dispose();
  });

  it('enriches tracked rows from saved flashcard reading and prosody', async () => {
    mockGetCardByWordSync.mockReturnValue({
      id: 'card-1',
      language: 'ja',
      state: 'new',
      ease: 2.5,
      interval: 0,
      dueDate: 0,
      reviews: 0,
      lapses: 0,
      learningStep: 0,
      createdAt: 0,
      lastReviewed: 0,
      lastUpdated: 0,
      content: {
        type: 'word',
        front: '赤い',
        back: 'red',
        reading: 'あかい',
        prosody: {
          type: 'japanese-pitch-accent',
          position: 2,
          raw: { type: 'japanese-pitch-accent', position: 2 },
        },
      },
    });
    const { WordDbEditorContent } = await import('./App');

    const dispose = render(() => <WordDbEditorContent />, container);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const entry = renderedEntries.find((candidate) => candidate.word === '赤い');
    expect(entry).toMatchObject({
      word: '赤い',
      tracker: 'flashcards',
      reading: 'あかい',
      translation: 'red',
      fullTranslation: 'red',
      prosodyPosition: 2,
      prosody: {
        type: 'japanese-pitch-accent',
        position: 2,
      },
    });
    dispose();
  });

  it('opens normal dictionary rows without fake initial override data', async () => {
    const { WordDbEditorContent } = await import('./App');

    const dispose = render(() => <WordDbEditorContent />, container);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const editButton = container.querySelector<HTMLButtonElement>('[data-testid="edit-赤い"]');
    expect(editButton).not.toBeNull();
    editButton!.click();
    await Promise.resolve();

    expect(renderedEditDialogs.at(-1)).toEqual({
      word: '赤い',
      initialData: null,
    });
    dispose();
  });

  it('loads the base word database while optional Anki enrichment is still pending', async () => {
    mockUseAnki = true;
    mockIsAnkiCacheFetched.mockReturnValue(false);
    mockFetchAnkiWordsCache.mockReturnValue(new Promise<Set<string>>(() => undefined));
    const { WordDbEditorContent } = await import('./App');

    const dispose = render(() => <WordDbEditorContent />, container);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockFetchAnkiWordsCache).toHaveBeenCalledOnce();
    expect(renderedEntries.some((entry) => entry.word === '赤い')).toBe(true);
    dispose();
  });

  it('adds Anki tracking after deferred enrichment completes', async () => {
    mockUseAnki = true;
    mockIsAnkiCacheFetched.mockReturnValue(false);
    let resolveAnkiCache!: (words: Set<string>) => void;
    mockFetchAnkiWordsCache.mockReturnValue(new Promise<Set<string>>((resolve) => {
      resolveAnkiCache = resolve;
    }));
    const { WordDbEditorContent } = await import('./App');

    const dispose = render(() => <WordDbEditorContent />, container);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(renderedEntries.at(-1)).toMatchObject({ word: '赤い', tracker: 'nothing' });

    mockFindAnkiWordMatchInCache.mockReturnValue({
      word: '赤い',
      lookupKey: '赤い',
      cards: [],
    });
    resolveAnkiCache(new Set(['赤い']));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(renderedEntries.at(-1)).toMatchObject({
      word: '赤い',
      tracker: 'anki',
      ankiLookupWord: '赤い',
    });
    dispose();
  });
});
