// @vitest-environment happy-dom

/**
 * The Browse bulk bar removes a hand-built selection of flashcards, and nothing
 * in the app can put a removed card back: the sentences, images and audio it
 * was built from go with it. The single-row Delete on the same surface already
 * asked. The bulk bar did not — observed in the running app, Select all over
 * 449 cards then Delete removed all 449 with no dialog at all, while the row
 * action two buttons away asked.
 *
 * These tests render the real Browse surface and assert the dialog is actually
 * in the way, rather than that some helper was consulted. An implementation
 * that calls the confirm and deletes anyway fails here.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { type Component } from 'solid-js';
import type { Flashcard } from '../../../shared/types';

const store = vi.hoisted(() => ({ flashcards: {} as Record<string, unknown> }));

const removeFlashcard = vi.fn(async (id: string) => {
  delete store.flashcards[id];
  return true;
});

const card = (id: string, front: string): Flashcard => ({
  id,
  content: { type: 'word', front, back: 'sense' },
  state: 'review',
  ease: 2.5,
  interval: 86_400_000,
  dueDate: Date.now() + 86_400_000,
  reviews: 1,
  lapses: 0,
  learningStep: 0,
  createdAt: 1,
  lastReviewed: 1,
  lastUpdated: 1,
  language: 'ja',
});

vi.mock('../../context', () => ({
  WindowWrapper: (props: Record<string, unknown>) => (props?.children ?? null) as never,
  useLocalization: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key.endsWith('SelectedCount')) return `${String(params?.count)} selected`;
      if (key.endsWith('ConfirmMany')) return `Delete ${String(params?.count)} selected flashcard(s)?`;
      return key;
    },
  }),
  useSettings: () => ({ settings: { language: 'ja', uiLanguage: 'en' }, updateSettings: vi.fn() }),
  useLowPowerGate: () => ({ requestAccess: vi.fn(async () => true) }),
  useLanguage: () => ({
    langData: {},
    currentLangData: () => undefined,
    languageDataCatalog: {},
    getFrequencyForLanguage: () => undefined,
    getLanguageDataFor: () => undefined,
    getFreqLevelNames: () => ({}),
  }),
  useFlashcards: () => ({
    getAllCards: () => Object.values(store.flashcards) as Flashcard[],
    getCardById: (id: string) => (store.flashcards[id] as Flashcard) ?? null,
    queueCounts: () => ({ new: 0, learning: 0, review: 0, relearning: 0, total: 0 }),
    removeFlashcard,
    addFlashcard: vi.fn(),
    updateFlashcardContent: vi.fn(),
    updateFlashcard: vi.fn(),
    getSuggestedFlashcardsSync: () => [],
    intervalToString: (ms: number) => `${ms}ms`,
    generateExampleSentencesWithLLM: vi.fn(),
    translateExampleSentence: vi.fn(),
    isLoading: () => false,
    isKnowledgeReady: () => true,
  }),
}));

vi.mock('../../components/flashcard', () => ({
  FlashcardReview: () => <span />,
  FlashcardEditModal: () => <span />,
  FlashcardSyncModal: () => <span />,
  FlashcardStats: () => <span />,
  FlashcardWordTitle: () => <span />,
  OtherLanguageDueHint: () => <span />,
}));
vi.mock('../../components/flashcard/FlashcardCreateModal', () => ({ FlashcardCreateModal: () => <span /> }));
vi.mock('../../components/flashcard/FlashcardInspectButton', () => ({ FlashcardInspectButton: () => <span /> }));
vi.mock('../../components/common/KnowledgeGate/KnowledgeGate', () => ({ KnowledgeGate: (p: Record<string, unknown>) => (p?.children ?? null) as never }));
vi.mock('./FlashcardsSuggested', () => ({ FlashcardsSuggested: () => <span /> }));

vi.mock('../../components/common/Modal', async () => {
  const actual = await vi.importActual<typeof import('../../components/common/Modal/ConfirmDialog')>(
    '../../components/common/Modal/ConfirmDialog',
  );
  return { useConfirmDialog: actual.useConfirmDialog, ConfirmDialog: actual.ConfirmDialog };
});

vi.mock('../../components/common', async () => {
  const passthrough = () => {
    const C: Component<Record<string, unknown>> = (props) => (props?.children ?? null) as never;
    return C;
  };
  const Button: Component<Record<string, unknown>> = (props) => (
    <button type="button" disabled={Boolean(props?.disabled)} onClick={() => (props?.onClick as (() => void) | undefined)?.()}>
      {props?.children as never}
    </button>
  );
  const SelectableCard: Component<Record<string, unknown>> = (props) => (
    <div>
      <button type="button" class="row-select" onClick={() => (props?.onClick as (() => void) | undefined)?.()}>
        {props?.title as never}
      </button>
    </div>
  );
  const modal = await vi.importActual<typeof import('../../components/common/Modal')>('../../components/common/Modal');
  return {
    useConfirmDialog: modal.useConfirmDialog,
    Button,
    SelectableCard,
    Modal: passthrough,
    Input: passthrough,
    Badge: passthrough,
    EmptyState: passthrough,
    SearchIcon: passthrough,
    // The real TabContainer owns which tab body is mounted, so the test has to
    // render the tabs to reach Browse at all. Replacing it with a passthrough
    // would hide the very surface under test.
    TabContainer: (props: Record<string, unknown>) => {
      const tabs = (props?.tabs ?? []) as { id: string; label: string }[];
      const active = props?.activeTab as string;
      const onTabChange = props?.onTabChange as ((id: string) => void) | undefined;
      return (
        <div>
          {tabs.map((tab) => (
            <button type="button" class="tab" onClick={() => onTabChange?.(tab.id)}>{tab.label}</button>
          ))}
          {tabs.some((tab) => tab.id === active) && <div class="tab-body">{props?.children as never}</div>}
        </div>
      );
    },
    Select: passthrough,
    EditIcon: passthrough,
    BookIcon: passthrough,
    BarChartIcon: passthrough,
    SparklesIcon: passthrough,
    PlusIcon: passthrough,
    ProgressBar: passthrough,
    ResponsiveSidebar: (props: Record<string, unknown>) => (props?.children ?? null) as never,
    MicrophoneIcon: passthrough,
    VoiceSamplePicker: passthrough,
    CollapsibleStickyHeader: (props: Record<string, unknown>) => (props?.children ?? null) as never,
    FilterBuilder: passthrough,
    TrashIcon: passthrough,
    buildFlashcardBrowseFields: () => ({ fields: [], paletteItems: [] }),
    buildEmptyPreset: () => [],
    evaluateAst: () => true,
    parseTokens: () => null,
    validateTokens: () => [],
  };
});

vi.mock('../../components/common/Feedback/Toast', () => ({ showToast: vi.fn(), updateToast: vi.fn(), removeToast: vi.fn() }));
vi.mock('../../../shared/bridges', () => ({ getBridge: () => ({}) }));
vi.mock('../../../shared/backends', () => ({ resolveCloudApiUrl: () => '' }));
vi.mock('../../../shared/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../shared/platform')>()),
  isElectron: () => false,
}));
vi.mock('../../utils/languageTokenization', () => ({ colorizeTokenizedText: (s: string) => s }));
vi.mock('../../utils/wordLevelStats', () => ({ getLevelStudyLevelNames: () => ({}) }));
vi.mock('../../hooks/useFlashcardTts', () => ({ useFlashcardTts: () => ({ speak: vi.fn(), isSpeaking: () => false, stop: vi.fn() }) }));
vi.mock('../../services/cloudSessionManager', () => ({
  CloudSessionCancelledError: class extends Error {},
  CloudUnreachableError: class extends Error {},
  withCloudAuth: vi.fn(),
}));
vi.mock('../../services/llmProvider', () => ({ isLLMReady: () => false }));
vi.mock('./FlashcardsLayout.css', () => ({}));
vi.mock('./FlashcardsBrowse.css', () => ({}));
vi.mock('./FlashcardsGenerate.css', () => ({}));
vi.mock('./repairTtsJobs', () => ({ runTtsRepairJobs: vi.fn() }));
vi.mock('../../utils/flashcardBulkExamples', () => ({
  buildBulkExampleUpdates: () => [],
  getCardsNeedingBulkExamples: () => [],
}));

import { FlashcardsContent } from './App';

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

const clickKey = (container: HTMLElement, key: string) => {
  const button = Array.from(container.querySelectorAll('button'))
    .find((b) => (b.textContent ?? '').trim().endsWith(key));
  if (!button) throw new Error(`no button ending in ${key}`);
  button.click();
};

const dialogText = () => {
  const dialog = document.querySelector('[role=dialog]');
  return dialog ? dialog.textContent!.replace(/\s+/g, ' ').trim() : null;
};

const dialogButton = (label: string) => {
  const dialog = document.querySelector('[role=dialog]');
  if (!dialog) return null;
  return Array.from(dialog.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === label) ?? null;
};

describe('Browse bulk delete is confirmed before it removes anything', () => {
  let container: HTMLDivElement;

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    removeFlashcard.mockClear();
    for (const id of Object.keys(store.flashcards)) delete store.flashcards[id];
    store.flashcards.c1 = card('c1', 'one');
    store.flashcards.c2 = card('c2', 'two');
  });

  afterEach(() => container.remove());

  const openBrowse = async () => {
    render(() => <FlashcardsContent />, container);
    await flush();
    clickKey(container, 'mlearn.Flashcards.UI.Tabs.Browse');
    await flush();
  };

  it('puts a confirmation in front of the removal and removes nothing until it is confirmed', async () => {
    await openBrowse();

    clickKey(container, 'mlearn.Flashcards.Browse.SelectAll');
    await flush();
    expect(container.querySelector('.flashcards-browse-selected-count')?.textContent).toBe('2 selected');

    clickKey(container, 'mlearn.Flashcards.Browse.DeleteSelected');
    await flush();

    expect(removeFlashcard, 'the cards were removed without asking').not.toHaveBeenCalled();
    expect(dialogText()).toContain('Delete 2 selected flashcard(s)?');
    expect(Object.keys(store.flashcards).sort()).toEqual(['c1', 'c2']);

    dialogButton('mlearn.Global.Delete')!.click();
    await flush();

    expect(removeFlashcard.mock.calls.map((call) => call[0]).sort()).toEqual(['c1', 'c2']);
    expect(Object.keys(store.flashcards)).toEqual([]);
  });

  it('cancelling leaves every card and keeps the selection for a retry', async () => {
    await openBrowse();

    clickKey(container, 'mlearn.Flashcards.Browse.SelectAll');
    await flush();
    clickKey(container, 'mlearn.Flashcards.Browse.DeleteSelected');
    await flush();

    dialogButton('mlearn.Global.Cancel')!.click();
    await flush();

    expect(removeFlashcard).not.toHaveBeenCalled();
    expect(Object.keys(store.flashcards).sort()).toEqual(['c1', 'c2']);
    // The rows are all still listed, so the selection has to be still there
    // for the learner to press Delete again without rebuilding it.
    expect(container.querySelector('.flashcards-browse-selected-count')?.textContent).toBe('2 selected');
  });
});
