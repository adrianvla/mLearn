import { fitLearningModel } from '../../../shared/learningModel';
// @vitest-environment happy-dom

/**
 * The Generate tab's "Regenerate all" mode rewrote content that was already
 * there, on one click, with nothing asked.
 *
 * Observed in the running app before this existed: with "Regenerate all
 * (replace existing)" selected, pressing "Generate Examples" would have
 * rewritten 448 of 449 real cards — 447 of which also had a meaning, and nine
 * of which carried an `exampleMeaning` the learner had edited by hand. The
 * button is labelled "Generate Examples" either way, so the destructive mode
 * was indistinguishable from the safe one behind the same picker.
 *
 * The same tab also offered "Regenerate older than date" above the Examples
 * button, which the run silently ignored: `getCardsNeedingBulkExamples` only
 * ever branched on `replaceAll`, so the date mode fell through to "only empty"
 * while the screen claimed a date filter was applied.
 *
 * These render the real Generate tab and assert the dialog is in the way, and
 * that the Examples section never offers a mode it cannot honour. An
 * implementation that calls the confirm and overwrites anyway fails here.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { type Component } from 'solid-js';
import type { Flashcard } from '../../../shared/types';

const store = vi.hoisted(() => ({ flashcards: {} as Record<string, unknown> }));
const updateFlashcardContent = vi.fn();

const card = (id: string, front: string, example?: string): Flashcard => ({
  id,
  content: { type: 'word', front, back: 'sense', example },
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
      // Name the count so the test can prove the prompt describes this run.
      if (params && 'count' in params) return `${key} (${String(params.count)})`;
      return key;
    },
  }),
  useSettings: () => ({ settings: { language: 'ja', uiLanguage: 'en', colour_codes: {} }, updateSettings: vi.fn() }),
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
    store: { flashcards: store.flashcards },
    getAllCards: () => Object.values(store.flashcards) as Flashcard[],
    getCardById: (id: string) => (store.flashcards[id] as Flashcard) ?? null,
    queueCounts: () => ({ new: 0, learning: 0, review: 0, relearning: 0, total: 0 }),
    removeFlashcard: vi.fn(),
    addFlashcard: vi.fn(),
    updateFlashcardContent,
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
  // A real <select> so the mode picker can actually be driven.
  const Select: Component<Record<string, unknown>> = (props) => (
    <select
      id={props?.id as string}
      value={props?.value as string}
      onChange={(e) => (props?.onChange as ((e: unknown) => void) | undefined)?.(e)}
    >
      {((props?.options ?? []) as { value: string; label: string }[]).map((option) => (
        <option value={option.value}>{option.label}</option>
      ))}
    </select>
  );
  const TabContainer = (props: Record<string, unknown>) => {
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
  };
  const modal = await vi.importActual<typeof import('../../components/common/Modal')>('../../components/common/Modal');
  return {
    useConfirmDialog: modal.useConfirmDialog,
    Button,
    Select,
    TabContainer,
    Modal: passthrough,
    Input: passthrough,
    Badge: passthrough,
    EmptyState: passthrough,
    SearchIcon: passthrough,
    // Must render children: the tab picker lives inside the sidebar, so a
    // stub that swallowed them would hide the very control under test.
    ResponsiveSidebar: (props: Record<string, unknown>) => (
      <div class="responsive-sidebar">{(props?.children ?? null) as never}</div>
    ),
    SelectableCard: passthrough,
    EditIcon: passthrough,
    BookIcon: passthrough,
    BarChartIcon: passthrough,
    SparklesIcon: passthrough,
    PlusIcon: passthrough,
    ProgressBar: passthrough,
    MicrophoneIcon: passthrough,
    VoiceSamplePicker: passthrough,
    CollapsibleStickyHeader: passthrough,
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
vi.mock('../../hooks/useLearningModel', () => ({ useLearningModel: () => ({ model: () => fitLearningModel([], Date.now()), snapshot: () => ({ events: [] }), ready: () => true, failed: () => false, retry: vi.fn() }) }));
vi.mock('../../../shared/bridges', () => ({ getBridge: () => ({ flashcards: {}, window: { onWindowContext: () => () => {}, getWindowContext: vi.fn() } }) }));
vi.mock('../../../shared/backends', () => ({ resolveCloudApiUrl: () => '' }));
vi.mock('../../../shared/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../shared/platform')>()),
  isElectron: () => true,
}));
vi.mock('../../utils/languageTokenization', () => ({ colorizeTokenizedText: (s: string) => s }));
vi.mock('../../utils/wordLevelStats', () => ({ getLevelStudyLevelNames: () => ({}) }));
vi.mock('../../hooks/useFlashcardTts', () => ({ useFlashcardTts: () => ({ playTts: vi.fn(), playingField: () => null, isGenerating: () => false, stop: vi.fn() }) }));
// The real selection hook: it is not the subject under test here, and stubbing
// it would hide whether the Generate tab composes with it correctly.
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

// The real policy, so the test exercises selection and gating together.
vi.mock('../../utils/flashcardBulkExamples', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/flashcardBulkExamples')>();
  return { ...actual, buildBulkExampleUpdates: () => [] };
});

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

const selectMode = async (container: HTMLElement, selectId: string, value: string) => {
  const select = container.querySelector(`#${selectId}`) as HTMLSelectElement | null;
  if (!select) throw new Error(`no mode picker ${selectId}`);
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await flush();
};

describe('Generate tab: replacing existing content is confirmed first', () => {
  let container: HTMLDivElement;

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    document.querySelectorAll('[role=dialog]').forEach((d) => d.remove());
    updateFlashcardContent.mockClear();
    for (const id of Object.keys(store.flashcards)) delete store.flashcards[id];
    store.flashcards.c1 = card('c1', 'one', 'already generated');
    store.flashcards.c2 = card('c2', 'two', 'already generated');
  });

  afterEach(() => container.remove());

  const openGenerate = async () => {
    let thrown: unknown = null;
    try {
      render(() => <FlashcardsContent />, container);
    } catch (e) { thrown = e; }
    await flush();
    if (thrown) throw new Error('render threw: ' + String(thrown));
    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent?.trim());
    if (!buttons.some((b) => b?.endsWith('mlearn.Flashcards.UI.Tabs.Generate'))) {
      throw new Error(`Generate tab not rendered. buttons=${JSON.stringify(buttons)} html=${container.innerHTML.slice(0, 300)}`);
    }
    clickKey(container, 'mlearn.Flashcards.UI.Tabs.Generate');
    await flush();
  };

  it('does not overwrite a single example until the learner agrees', async () => {
    await openGenerate();
    await selectMode(container, 'flashcards-generate-examples-mode', 'replaceAll');

    clickKey(container, 'mlearn.Flashcards.Bulk.ExamplesButton');
    await flush();

    expect(updateFlashcardContent, 'the examples were rewritten without asking').not.toHaveBeenCalled();
    // The prompt must name how many cards are actually at stake.
    expect(dialogText()).toContain('mlearn.Flashcards.Bulk.ReplaceAllExamplesConfirm (2)');
  });

  it('goes through once the learner confirms', async () => {
    await openGenerate();
    await selectMode(container, 'flashcards-generate-examples-mode', 'replaceAll');
    clickKey(container, 'mlearn.Flashcards.Bulk.ExamplesButton');
    await flush();

    // The button must offer the action, not the dialog's default "Delete":
    // nothing is deleted by a regeneration.
    const confirm = dialogButton('mlearn.Flashcards.Bulk.ReplaceAllConfirmAction');
    expect(confirm, 'the confirm button did not name the action').not.toBeNull();
    confirm!.click();
    await flush();

    // The run proceeds past the prompt. Whether the mock generator yields
    // updates is not what this test is about.
    expect(dialogText()).toBeNull();
  });

  it('leaves every example alone when the learner cancels', async () => {
    await openGenerate();
    await selectMode(container, 'flashcards-generate-examples-mode', 'replaceAll');
    clickKey(container, 'mlearn.Flashcards.Bulk.ExamplesButton');
    await flush();

    dialogButton('mlearn.Global.Cancel')!.click();
    await flush();

    expect(updateFlashcardContent).not.toHaveBeenCalled();
    expect(store.flashcards.c1).toBeDefined();
    expect(store.flashcards.c2).toBeDefined();
  });

  it('stays one click in the mode that cannot lose anything', async () => {
    await openGenerate();
    store.flashcards.c2 = card('c2', 'two', '');

    // Default mode is "only cards without existing data", which selects only
    // the empty card. There is nothing to overwrite, so no dialog.
    clickKey(container, 'mlearn.Flashcards.Bulk.ExamplesButton');
    await flush();

    expect(dialogText()).toBeNull();
  });
});

describe('Generate tab: the mode pickers match what each run can honour', () => {
  let container: HTMLDivElement;

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    document.querySelectorAll('[role=dialog]').forEach((d) => d.remove());
    for (const id of Object.keys(store.flashcards)) delete store.flashcards[id];
    store.flashcards.c1 = card('c1', 'one', 'already generated');
  });

  afterEach(() => container.remove());

  const openGenerate = async () => {
    render(() => <FlashcardsContent />, container);
    await flush();
    clickKey(container, 'mlearn.Flashcards.UI.Tabs.Generate');
    await flush();
  };

  const optionLabels = (selectId: string) => {
    const select = container.querySelector(`#${selectId}`) as HTMLSelectElement | null;
    if (!select) return null;
    return Array.from(select.options).map((o) => o.value);
  };

  it('offers the Examples run no date mode, because an example has no generation stamp', async () => {
    await openGenerate();

    // This option used to be offered here by a picker shared with TTS, and the
    // run ignored it: the date input appeared, the selection silently fell
    // back to "only empty", and the screen claimed a date filter was applied.
    expect(optionLabels('flashcards-generate-examples-mode')).toEqual(['onlyEmpty', 'replaceAll']);
  });

  it('still offers the date mode for TTS, which does record one per field', async () => {
    await openGenerate();

    expect(optionLabels('flashcards-generate-tts-mode')).toEqual(['onlyEmpty', 'replaceAll', 'olderThan']);
  });

  it('gives the two sections their own pickers instead of one shared control', async () => {
    await openGenerate();

    // One picker for two operations with different capabilities is what let the
    // Examples button offer a mode it could not run.
    expect(container.querySelector('#flashcards-generate-mode')).toBeNull();
    expect(container.querySelector('#flashcards-generate-examples-mode')).not.toBeNull();
    expect(container.querySelector('#flashcards-generate-tts-mode')).not.toBeNull();
  });

  it('describes the Examples section by the mode actually selected', async () => {
    await openGenerate();

    // Both sections are mounted, so compare the set rather than the first node:
    // the TTS section's description comes first in the DOM.
    expect(Array.from(container.querySelectorAll('.flashcards-generate-section-desc')).map((el) => el.textContent))
      .toContain('mlearn.Flashcards.Bulk.ExamplesTooltip');

    await selectMode(container, 'flashcards-generate-examples-mode', 'replaceAll');
    const descriptions = Array.from(container.querySelectorAll('.flashcards-generate-section-desc'))
      .map((el) => el.textContent);
    // "for cards without examples" would describe the mode just turned off.
    expect(descriptions).toContain('mlearn.Flashcards.Bulk.ExamplesReplaceAllTooltip');
    expect(descriptions).not.toContain('mlearn.Flashcards.Bulk.ExamplesTooltip');
  });
});
