// @vitest-environment happy-dom

/**
 * The Suggested bulk bar owns a selection the learner built deliberately, by
 * hand or with Select all. A bulk action that cannot land its write must not
 * silently discard that selection — the rows are all still on screen, so an
 * empty selection reads as "nothing is selected" and the learner has to
 * rebuild it before retrying.
 *
 * This exercises the real component with a refusing promotion, so the
 * invariant is checked against the DOM the learner sees.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { type Component } from 'solid-js';
import type { SuggestedFlashcard } from '../../../shared/types';

const flashcards = vi.hoisted(() => ({
  promoteSuggestedFlashcards: vi.fn(),
  removeSuggestedFlashcards: vi.fn(),
  removeSuggestedFlashcard: vi.fn(),
  garbageCollectSuggestedFlashcards: vi.fn(async () => 0),
  ignoreWordForLanguage: vi.fn(async () => {}),
}));

const suggestion = (id: string, word: string): SuggestedFlashcard => ({
  id,
  word,
  reading: '',
  language: 'ja',
  count: 1,
  createdAt: 1,
  source: 'test',
} as unknown as SuggestedFlashcard);

const SUGGESTIONS = [suggestion('a', 'alpha'), suggestion('b', 'beta')];

vi.mock('../../context', () => ({
  useLocalization: () => ({ t: (key: string, params?: Record<string, unknown>) => {
    if (key.endsWith('SelectedCount')) return `${String(params?.count)} selected`;
    if (key.endsWith('PromoteFailed')) return 'Failed to promote suggestions.';
    if (key.endsWith('Promoted')) return `${String(params?.count)} created`;
    return key;
  } }),
  useSettings: () => ({
    settings: { language: 'ja', flashcardLLMExamples: false, flashcardAutoGenerateAudio: false },
    updateSetting: vi.fn(),
    updateSettings: vi.fn(),
  }),
  useLanguage: () => ({
    langData: {},
    isLoading: () => false,
    refreshLanguageData: vi.fn(),
    getCanonicalFormForLanguage: (_l: string, w: string) => w,
    getFreqLevelNames: () => ({}),
    currentLangData: () => undefined,
    languageDataCatalog: {},
    getFrequencyForLanguage: () => undefined,
    getLanguageDataFor: () => undefined,
  }),
  useFlashcards: () => ({
    getSuggestedFlashcardsSync: () => SUGGESTIONS,
    removeSuggestedFlashcard: flashcards.removeSuggestedFlashcard,
    removeSuggestedFlashcards: flashcards.removeSuggestedFlashcards,
    promoteSuggestedFlashcards: flashcards.promoteSuggestedFlashcards,
    garbageCollectSuggestedFlashcards: flashcards.garbageCollectSuggestedFlashcards,
    ignoreWordForLanguage: flashcards.ignoreWordForLanguage,
    store: {
      flashcards: {},
      suggestedFlashcards: {},
      wordStatsMap: {},
      dailyStats: {},
      wordKnowledge: {},
      grammarKnowledge: {},
      wordCandidates: {},
      wordToCardMap: {},
      knownUntracked: {},
      ignoredWords: {},
      meta: { graduatingInterval: 1, easyInterval: 4 },
    },
  }),
}));

vi.mock('../../components/common', () => {
  // Renders children without imposing a shape the real component must match.
  const passthrough = () => {
    const C: Component<Record<string, unknown>> = (props) =>
      (props?.children ?? null) as never;
    return C;
  };
  const Button: Component<Record<string, unknown>> = (props) => {
    const onClick = props?.onClick as (() => void) | undefined;
    return (
      <button type="button" disabled={Boolean(props?.disabled)} onClick={() => onClick?.()}>
        {props?.children as never}
      </button>
    );
  };
  const SelectableCard: Component<Record<string, unknown>> = (props) => (
    <div>
      <button type="button" class="row-select" onClick={() => (props?.onClick as (() => void) | undefined)?.()}>
        {props?.title as never}
      </button>
    </div>
  );
  return {
    Button,
    SelectableCard,
    Input: passthrough,
    Select: passthrough,
    EmptyState: passthrough,
    PillLabel: passthrough,
    ProgressBar: passthrough,
    ToggleSwitch: passthrough,
    SparklesIcon: passthrough,
    SearchIcon: passthrough,
    TrashIcon: passthrough,
    PlusIcon: passthrough,
    CheckIcon: passthrough,
    EyeOffIcon: passthrough,
    Tooltip: passthrough,
    CollapsibleStickyHeader: (props: Record<string, unknown>) => (props?.children ?? null) as never,
    FilterBuilder: passthrough,
    buildEmptyPreset: () => [],
    buildSuggestedFlashcardFields: () => ({ fields: [], paletteItems: [] }),
    validateTokens: () => [],
    parseTokens: () => null,
    evaluateAst: () => true,
    ImageIcon: passthrough,
    SkeletonCard: passthrough,
  };
});

vi.mock('../../components/common/Smart', () => ({ WordStatusPill: () => <span /> }));
vi.mock('../../components/flashcard', () => ({ FlashcardWordTitle: () => <span /> }));
vi.mock('../../components/common/Feedback/Toast', () => ({ showToast: vi.fn() }));
vi.mock('../../hooks/useTranslation', () => ({
  cacheVersion: () => 0,
  getCachedReading: () => undefined,
  getCachedTranslation: () => undefined,
}));
vi.mock('@shared/utils/passiveWordTracking', () => ({ isWordMarkedFailed: () => false }));
vi.mock('../../hooks/useVirtualizer', () => ({
  createVirtualizer: () => ({
    setScrollElement: () => {},
    getVirtualItems: () => SUGGESTIONS.map((s, index) => ({ index, start: index * 200, size: 200, key: s.id })),
    getTotalSize: () => SUGGESTIONS.length * 200,
  }),
}));
vi.mock('../../utils/wordLevelStats', () => ({ getLevelStudyLevelNames: () => ({}) }));
vi.mock('@shared/languageFeatures', () => ({
  getFrequencyLevelLabel: () => null,
  getFrequencyLevelVisualRank: () => undefined,
}));
vi.mock('./FlashcardsSuggested.css', () => ({}));

import { FlashcardsSuggested } from './FlashcardsSuggested';

const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

const clickKey = (container: HTMLElement, key: string) => {
  const button = Array.from(container.querySelectorAll('button'))
    .find((b) => b.textContent === key || (b.textContent ?? '').includes(key));
  if (!button) throw new Error(`no button for ${key}`);
  button.click();
};

const selectedCount = (container: HTMLElement) =>
  container.querySelector('.flashcards-suggested-selected-count')?.textContent;

describe('Suggested bulk selection survives a refused promotion', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    flashcards.promoteSuggestedFlashcards.mockReset();
  });

  afterEach(() => container.remove());

  it('keeps the learner selection when no suggestion was promoted', async () => {
    // The refusal: promotion lands nothing.
    flashcards.promoteSuggestedFlashcards.mockResolvedValue(0);
    render(() => <FlashcardsSuggested />, container);
    await flush();

    clickKey(container, 'Suggested.SelectAll');
    await flush();
    expect(selectedCount(container)).toBe('2 selected');

    clickKey(container, 'Suggested.PromoteSelected');
    await flush();

    expect(flashcards.promoteSuggestedFlashcards).toHaveBeenCalledOnce();
    // The rows are all still listed, so the selection must be too.
    expect(selectedCount(container)).toBe('2 selected');
  });

  it('clears the selection once a promotion actually landed', async () => {
    flashcards.promoteSuggestedFlashcards.mockImplementation(async (ids: string[]) => ids.length);
    render(() => <FlashcardsSuggested />, container);
    await flush();

    clickKey(container, 'Suggested.SelectAll');
    await flush();
    expect(selectedCount(container)).toBe('2 selected');

    clickKey(container, 'Suggested.PromoteSelected');
    await flush();

    expect(selectedCount(container)).toBe('0 selected');
  });
});
