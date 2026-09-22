// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal, type JSX } from 'solid-js';
import { WORD_STATUS } from '../../../shared/constants';
import type { AnkiWordStatusRecord } from '../../../shared/backends/types';
import type { FilterToken } from '../../components/common/FilterBuilder/filterExpr';
import { clearAnkiWordsCache } from '../../services/ankiWordsCache';

const mockGetAnkiWordStatuses = vi.fn<() => Promise<AnkiWordStatusRecord[]>>(() => Promise.resolve([]));
const mockGetCard = vi.fn(async () => ({ error: true, poor: false, cards: [] }));
const mockShowToast = vi.fn();
const mockSearchBarProps: { current?: { setFilterTokens?: (tokens: FilterToken[]) => void } } = {};
const [mockUseAnkiEnabled, setMockUseAnkiEnabled] = createSignal(false);
const mockWordFrequency: Record<string, { reading: string; raw_level: number; level: string }> = {
  '赤い': { reading: 'あかい', raw_level: 5, level: 'N5' },
  '青い': { reading: 'あおい', raw_level: 5, level: 'N5' },
};

vi.mock('../../../shared/backends', () => ({
  getBackend: () => ({
    getAnkiWordStatuses: mockGetAnkiWordStatuses,
    getCard: mockGetCard,
  }),
}));
vi.mock('../../services/dictionaryUniverse', () => ({
  loadDictionaryUniverse: vi.fn(async () => []),
  clearDictionaryUniverseCache: vi.fn(),
}));


vi.mock('../../components/common/Feedback/Toast', () => ({
  showToast: (...args: unknown[]) => mockShowToast(...args),
}));

vi.mock('../../hooks/useVirtualizer', () => ({
  createVirtualizer: (options: { count: number }) => ({
    getVirtualItems: () => Array.from({ length: options.count }, (_, index) => ({ index, start: index * 56 })),
    getTotalSize: () => options.count * 56,
    measureElement: () => undefined,
    measure: () => undefined,
  }),
}));

vi.mock('../../context', async () => {
  const ankiCache = await import('../../services/ankiWordsCache');
  return {
    WindowWrapper: (props: { children?: JSX.Element }) => <div>{props.children}</div>,
    useLanguage: () => ({
      wordFrequency: mockWordFrequency,
      getWordFrequency: () => mockWordFrequency,
      currentLangData: () => null,
      getFreqLevelNames: () => ({ 5: 'N5' }),
      getCanonicalForm: (word: string) => word,
      getWordVariants: (word: string) => [word],
      getReadingVariants: (word: string) => [word],
    }),
    useFlashcards: () => ({
      getComprehensiveWordStatusWithSourceSync: (word: string) => {
        ankiCache.ankiCacheVersion();
        if (mockUseAnkiEnabled() && ankiCache.findAnkiWordMatchInCache([word], { language: 'ja', languageData: null })) {
          return { status: 'known' as const, source: 'Anki', timesSeen: 0 };
        }
        return { status: 'unknown' as const, source: 'None', timesSeen: 0 };
      },
      addFlashcard: vi.fn(),
      hasWordSync: () => false,
      removeFlashcard: vi.fn(),
      getCardByWord: vi.fn(async () => null),
      getCardByWordSync: () => null,
      updateFlashcardContent: vi.fn(),
      updateFlashcard: vi.fn(),
      isLoading: () => false,
      getIgnoredWordsSync: () => [],
      isWordIgnoredSync: () => false,
      unignoreWordForLanguage: vi.fn(),
    }),
    useLocalization: () => ({ t: (key: string) => key }),
    useSettings: () => ({
      settings: {
        language: 'ja',
        get use_anki() {
          return mockUseAnkiEnabled();
        },
      },
    }),
  };
});

vi.mock('../../hooks/useAnki', () => ({
  useAnki: () => ({
    checkConnection: vi.fn(async () => false),
    checkDuplicate: vi.fn(async () => false),
    addNote: vi.fn(async () => null),
  }),
}));

vi.mock('../../../shared/bridges', () => ({
  getBridge: () => ({
    graph: { getKnowledgeProjection: () => Promise.resolve({ status: 'unavailable', targets: [] }) },
    window: {
      onWindowContext: () => undefined,
      getWindowContext: () => undefined,
    },
  }),
}));

vi.mock('../../services/openKnowledgeInspector', () => ({ openKnowledgeInspector: () => undefined }));

vi.mock('../../services/openGraphInspector', () => ({ openGraphInspector: () => undefined }));

vi.mock('../../components/common', async () => {
  const { Show } = await import('solid-js');
  const presets = await import('../../components/common/FilterBuilder/presets');
  const expr = await import('../../components/common/FilterBuilder/filterExpr');
  return {
    Modal: (props: { isOpen?: boolean; children?: JSX.Element }) => (
      <Show when={props.isOpen}><div>{props.children}</div></Show>
    ),
    ModalLoadingOverlay: () => <div />,
    Spinner: () => <div />,
    SkeletonRows: (props: { rows?: number }) => <div data-testid="skeleton-rows" data-rows={props.rows} />,
    CollapsibleStickyHeader: (props: { children?: JSX.Element; ref?: (el: HTMLDivElement) => void; class?: string }) => {
      let el!: HTMLDivElement;
      queueMicrotask(() => props.ref?.(el));
      return <div ref={el} class={props.class}>{props.children}</div>;
    },
    Btn: (props: { children?: JSX.Element; onClick?: () => void }) => (
      <button type="button" onClick={props.onClick}>{props.children}</button>
    ),
    PillLabel: (props: { children?: JSX.Element; class?: string }) => (
      <span class={props.class}>{props.children}</span>
    ),
    AnkiHoverPreview: (props: { children?: JSX.Element }) => <span>{props.children}</span>,
    KnowledgeCapabilityChips: () => null,
    KnowledgeProjectionDrawer: () => null,
    buildEmptyPreset: presets.buildEmptyPreset,
    buildWordDbEditorFields: presets.buildWordDbEditorFields,
    validateTokens: expr.validateTokens,
    evaluateAst: expr.evaluateAst,
    parseTokens: expr.parseTokens,
  };
});

vi.mock('../../components/common/Smart', () => ({
  WordStatusPill: () => <span data-testid="word-status-pill" />,
}));

vi.mock('../../components/language-specific', () => ({
  ProsodyOverlay: (props: { children?: JSX.Element; word?: string }) => <span>{props.children ?? props.word}</span>,
  WordWithReading: (props: { word: string }) => <span class="word-text">{props.word}</span>,
}));

vi.mock('../../components/flashcard', () => ({
  FlashcardEditModal: () => <div />,
}));

vi.mock('../../utils/wordForms', () => ({
  getWordFormCandidates: (word: string) => [word],
}));

vi.mock('../../hooks/useTranslation', () => ({
  cacheVersion: () => 0,
  getCachedTranslation: () => null,
  getCachedReading: () => null,
  fetchTranslation: vi.fn(async () => ({ data: [] })),
}));

vi.mock('./components', async () => {
  const { WordEntryRow } = await import('./components/WordEntryRow');
  return {
    WordEntryRow,
    SearchBar: (props: { setFilterTokens?: (tokens: FilterToken[]) => void }) => {
      mockSearchBarProps.current = props;
      return <div />;
    },
    EntriesHeader: () => <div />,
    EditTranslationDialog: () => <div />,
    AnkiCardPreviewModal: () => <div />,
  };
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function integrationCellTexts(): Record<string, string> {
  const result: Record<string, string> = {};
  document.querySelectorAll('.entry').forEach((entryEl) => {
    const word = entryEl.querySelector('.col.word .word-text')?.textContent ?? '';
    result[word] = entryEl.querySelector('.col.integrations')?.textContent ?? '';
  });
  return result;
}

describe('WordDbEditorContent Anki tracking', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    setMockUseAnkiEnabled(false);
    mockGetAnkiWordStatuses.mockReset();
    mockGetAnkiWordStatuses.mockResolvedValue([]);
    mockGetCard.mockReset();
    mockGetCard.mockResolvedValue({ error: true, poor: false, cards: [] });
    mockShowToast.mockClear();
    mockSearchBarProps.current = undefined;
    clearAnkiWordsCache();
  });

  afterEach(() => {
    container.remove();
  });

  it('updates integration cells and status filters reactively when Anki enables after load', async () => {
    const { WordDbEditorContent } = await import('./App');

    const dispose = render(() => <WordDbEditorContent />, container);
    await flush();
    await flush();

    expect(integrationCellTexts()['赤い']).toContain('mlearn.WordDbEditor.Integrations.AddFlashcard');
    expect(integrationCellTexts()['青い']).toContain('mlearn.WordDbEditor.Integrations.AddFlashcard');

    mockGetAnkiWordStatuses.mockResolvedValue([{ word: '赤い', queue: 2, type: 2 }]);
    setMockUseAnkiEnabled(true);
    await flush();
    await flush();

    // Integration cell reacts to the async Anki enablement without reloading words
    expect(integrationCellTexts()['赤い']).toContain('mlearn.WordDbEditor.Integrations.Anki');
    expect(integrationCellTexts()['青い']).toContain('mlearn.WordDbEditor.Integrations.AddFlashcard');

    // Status filter uses the live status chain and matches the same rows
    mockSearchBarProps.current?.setFilterTokens?.([
      { instanceId: 'test-status-known', kind: 'operand', field: 'status', op: 'eq', value: String(WORD_STATUS.KNOWN) },
    ]);
    await flush();

    const texts = integrationCellTexts();
    expect(Object.keys(texts)).toEqual(['赤い']);
    expect(texts['赤い']).toContain('mlearn.WordDbEditor.Integrations.Anki');

    dispose();
  });

  it('refetches on window focus when the Anki cache fetch fails', async () => {
    setMockUseAnkiEnabled(true);
    mockGetAnkiWordStatuses.mockRejectedValue(new Error('anki down'));
    const { WordDbEditorContent } = await import('./App');

    const dispose = render(() => <WordDbEditorContent />, container);
    await flush();
    await flush();

    expect(integrationCellTexts()['赤い']).toContain('mlearn.WordDbEditor.Integrations.AddFlashcard');

    mockGetAnkiWordStatuses.mockResolvedValue([{ word: '赤い', queue: 2, type: 2 }]);
    window.dispatchEvent(new Event('focus'));
    await flush();
    await flush();

    expect(mockGetAnkiWordStatuses.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(integrationCellTexts()['赤い']).toContain('mlearn.WordDbEditor.Integrations.Anki');

    dispose();
  });
});

vi.mock('../../hooks/useKnowledgeProjections', async () => {
  const { projectionFixture } = await import('../../../../test/projectionFixture');
  return { useKnowledgeProjections: (query: () => { surfaces: string[] } | undefined) => ({
    loading: () => false,
    ready: () => true,
    failed: () => false,
    retry: vi.fn(),
    projections: () => new Map((query()?.surfaces ?? []).map(word => [word, projectionFixture(word === '赤い' ? 'known' : 'unknown', word === '赤い' ? 'evidence' : 'unmeasured')])),
  }) };
});
