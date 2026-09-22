// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal, type JSX } from 'solid-js';
import type { WordEntry } from './components';
import type { Flashcard } from '../../../shared/types';

const mockGetCardByWordSync = vi.fn<() => Flashcard | null>(() => null);
const mockGetComprehensiveWordStatusWithSourceSync = vi.fn(() => ({
  status: 'unknown',
  source: 'None',
  timesSeen: 0,
}));
const renderedEntries: WordEntry[] = [];
const [activeLanguage, setActiveLanguage] = createSignal('ja');
let trackedStore: { wordKnowledge: Record<string, { word: string; language?: string }>; flashcards: Record<string, { language: string; content: { front: string } }> } = { wordKnowledge: {}, flashcards: {} };
let projectionQuery: (() => { surfaces: string[] } | undefined) | undefined;
const renderedEditDialogs: Array<{ word: string; initialData: unknown }> = [];
const mockFetchAnkiWordsCache = vi.fn(() => Promise.resolve(new Set<string>()));
const mockIsAnkiCacheFetched = vi.fn(() => true);
let mockUseAnki = false;
let mockWordFrequency: Record<string, { reading: string; raw_level: number; level: string }> = {
  '赤い': {
    reading: 'あかい',
    raw_level: 5,
    level: 'N5',
  },
};

vi.mock('../../hooks/useVirtualizer', () => ({
  createVirtualizer: () => ({
    getVirtualItems: () => [{ index: 0, start: 0 }],
    getTotalSize: () => 56,
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
    wordFrequency: mockWordFrequency,
    getWordFrequency: () => mockWordFrequency,
    currentLangData: () => null,
    getFreqLevelNames: () => ({ 5: 'N5' }),
    getCanonicalForm: (word: string) => word,
    getWordVariants: (word: string) => [word],
  }),
  useFlashcards: () => ({
    store: trackedStore,
    addFlashcard: vi.fn(),
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
      get language() { return activeLanguage(); },
      get use_anki() {
        return mockUseAnki;
      },
    },
  }),
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
  fetchAnkiWordsCache: mockFetchAnkiWordsCache,
  isAnkiCacheFetched: mockIsAnkiCacheFetched,
  getAnkiCacheLastError: vi.fn(() => null),
  refreshAnkiWordsCache: vi.fn(async () => undefined),
}));

vi.mock('./components', () => ({
  SearchBar: (props: { searchQuery: () => string; setSearchQuery: (value: string) => void }) => <input aria-label="Search vocabulary" value={props.searchQuery()} onInput={event => props.setSearchQuery(event.currentTarget.value)} />,
  EntriesHeader: (props: { onSort: (key: string) => void }) => <button onClick={() => props.onSort('status')}>Sort knowledge</button>,
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
  Btn: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  ModalLoadingOverlay: () => <div />,
  Spinner: () => <div />,
  SkeletonRows: (props: { rows?: number }) => <div data-testid="skeleton-rows" data-rows={props.rows} />,
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
    mockGetCardByWordSync.mockClear();
    mockGetCardByWordSync.mockReturnValue(null);
    mockGetComprehensiveWordStatusWithSourceSync.mockClear();
    mockFetchAnkiWordsCache.mockReset();
    mockFetchAnkiWordsCache.mockResolvedValue(new Set<string>());
    mockIsAnkiCacheFetched.mockReset();
    mockIsAnkiCacheFetched.mockReturnValue(true);
    mockUseAnki = false;
    setActiveLanguage('ja');
    trackedStore = { wordKnowledge: {}, flashcards: {} };
    mockWordFrequency = {
      '赤い': {
        reading: 'あかい',
        raw_level: 5,
        level: 'N5',
      },
    };
    renderedEntries.length = 0;
    renderedEditDialogs.length = 0;
  });

  afterEach(() => {
    container.remove();
  });

  it('keeps saved vocabulary scoped to its owning language', async () => {
    mockWordFrequency = {};
    trackedStore = {
      wordKnowledge: { 'other:key': { word: 'foreign knowledge', language: 'other' }, 'ja:key': { word: 'local knowledge' } },
      flashcards: { other: { language: 'other', content: { front: 'foreign card' } } },
    };
    const { WordDbEditorContent } = await import('./App');
    const dispose = render(() => <WordDbEditorContent />, container);
    await vi.waitFor(() => expect(container.textContent).toContain('local knowledge'));
    expect(container.textContent).not.toContain('foreign');
    dispose();
  });

  it('ignores a late dictionary response after changing languages', async () => {
    mockWordFrequency = {};
    const { loadDictionaryUniverse } = await import('../../services/dictionaryUniverse');
    let resolveOld!: (rows: [string, string][]) => void;
    vi.mocked(loadDictionaryUniverse).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    vi.mocked(loadDictionaryUniverse).mockResolvedValueOnce([['current language word', '']]);
    const { WordDbEditorContent } = await import('./App');
    const dispose = render(() => <WordDbEditorContent />, container);
    await vi.waitFor(() => expect(resolveOld).toBeDefined());
    setActiveLanguage('third-party');
    await vi.waitFor(() => expect(container.textContent).toContain('current language word'));
    resolveOld([['stale language word', '']]);
    await Promise.resolve();
    expect(container.textContent).toContain('current language word');
    expect(container.textContent).not.toContain('stale language word');
    dispose();
  });

  it('scopes row flashcard lookups to the active language', async () => {
    const { WordDbEditorContent } = await import('./App');

    const dispose = render(() => <WordDbEditorContent />, container);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockGetCardByWordSync).toHaveBeenCalledWith('赤い', 'ja');
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
    const { WordDbEditorContent } = await import('./App');

    const dispose = render(() => <WordDbEditorContent />, container);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(renderedEntries.some((entry) => entry.word === '赤い')).toBe(true);
    dispose();
  });

  it('queries knowledge for status sorting only and bounds it to the text search', async () => {
    const { loadDictionaryUniverse } = await import('../../services/dictionaryUniverse');
    vi.mocked(loadDictionaryUniverse).mockResolvedValueOnce([['dictionary-only', '']]);
    const { WordDbEditorContent } = await import('./App');
    const dispose = render(() => <WordDbEditorContent />, container);
    await vi.waitFor(() => expect(container.querySelector('input[aria-label="Search vocabulary"]')).not.toBeNull());
    expect(projectionQuery?.()).toBeUndefined();
    const input = container.querySelector('input[aria-label="Search vocabulary"]') as HTMLInputElement;
    input.value = 'dictionary';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Sort knowledge')?.click();
    await vi.waitFor(() => expect(projectionQuery?.()?.surfaces).toEqual(['dictionary-only']));
    dispose();
  });

  it('loads dictionary-only vocabulary even when the package has no frequency rows', async () => {
    mockWordFrequency = {};
    const { loadDictionaryUniverse } = await import('../../services/dictionaryUniverse');
    vi.mocked(loadDictionaryUniverse).mockResolvedValueOnce([['dictionary-only', '']]);
    const { WordDbEditorContent } = await import('./App');
    const dispose = render(() => <WordDbEditorContent />, container);
    await vi.waitFor(() => expect(container.textContent).toContain('dictionary-only'));
    expect(container.textContent).not.toContain('mlearn.WordDbEditor.EmptyState');
    dispose();
  });

  it('labels a failed dictionary read as incomplete and retries without claiming empty vocabulary', async () => {
    mockWordFrequency = {};
    const { loadDictionaryUniverse } = await import('../../services/dictionaryUniverse');
    vi.mocked(loadDictionaryUniverse).mockRejectedValueOnce(new Error('unavailable'));
    const { WordDbEditorContent } = await import('./App');
    const dispose = render(() => <WordDbEditorContent />, container);
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
    expect(container.textContent).toContain('mlearn.WordDbEditor.DictionaryUnavailable');
    expect(container.textContent).not.toContain('mlearn.WordDbEditor.EmptyState');
    (container.querySelector('[role="alert"] button') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).toBeNull());
    expect(container.textContent).toContain('mlearn.WordDbEditor.EmptyState');
    dispose();
  });

  it('shows an empty database instead of loading forever when frequency data is unavailable', async () => {
    mockWordFrequency = {};
    const { WordDbEditorContent } = await import('./App');

    const dispose = render(() => <WordDbEditorContent />, container);
    await Promise.resolve();
    await Promise.resolve();

    expect(container.textContent).toContain('mlearn.WordDbEditor.EmptyState');
    expect(container.textContent).not.toContain('mlearn.WordDbEditor.Loading');
    dispose();
  });
});

vi.mock('../../hooks/useKnowledgeProjections', async () => {
  const { projectionFixture } = await import('../../../../test/projectionFixture');
  return { useKnowledgeProjections: (query: () => { surfaces: string[] } | undefined) => { projectionQuery = query; return ({
    loading: () => false,
    ready: () => true,
    failed: () => false,
    retry: vi.fn(),
    projections: () => new Map((query()?.surfaces ?? []).map(word => [word, projectionFixture(word === '赤い' ? 'known' : 'unknown', word === '赤い' ? 'evidence' : 'unmeasured')])),
  }); } };
});
