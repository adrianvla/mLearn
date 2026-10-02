// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { type Component } from 'solid-js';
import type { SuggestedFlashcard } from '../../../shared/types';

const flashcards = vi.hoisted(() => ({
  ignoreWordForLanguage: vi.fn(async (_word: string, _reading?: string, _language?: string) => {}),
  removeSuggestedFlashcard: vi.fn(),
  removeSuggestedFlashcards: vi.fn(),
  promoteSuggestedFlashcards: vi.fn(async () => 0),
  garbageCollectSuggestedFlashcards: vi.fn(async () => 0),
  /** Words that own at least one real flashcard. */
  wordsWithCards: new Set<string>(),
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
  useLocalization: () => ({ t: (key: string) => key }),
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
    getCardsByWordSync: (word: string) =>
      flashcards.wordsWithCards.has(word)
        ? [{ id: `card-for-${word}` } as unknown as Record<string, unknown>]
        : [],
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

vi.mock('../../components/common', async () => {
  const passthrough = () => {
    const C: Component<Record<string, unknown>> = (props) =>
      (props?.children ?? null) as never;
    return C;
  };
  const Button: Component<Record<string, unknown>> = (props) => {
    const onClick = props?.onClick as ((e: unknown) => void) | undefined;
    const title = props?.title as string | undefined;
    return (
      <button type="button" title={title} onClick={() => onClick?.({ stopPropagation: () => {} })}>
        {title ?? (props?.children as never)}
      </button>
    );
  };
  const modal = await vi.importActual<typeof import('../../components/common/Modal')>('../../components/common/Modal');
  return {
    useConfirmDialog: modal.useConfirmDialog,
    Button,
    SelectableCard: (props: Record<string, unknown>) => (
      <div>
        <button type="button" class="row-select" onClick={() => (props?.onClick as (() => void) | undefined)?.()}>
          {props?.title as never}
        </button>
        {props?.children as never}
      </div>
    ),
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
    // The real Tooltip renders its child (the card) and only hides `content`
    // behind a hover. A bare passthrough drops the card entirely.
    Tooltip: (props: Record<string, unknown>) => (props?.children ?? null) as never,
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

import { showToast } from '../../components/common/Feedback/Toast';
import { FlashcardsSuggested } from './FlashcardsSuggested';

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

/** The Ignore button is an icon button, identified by its title. */
const clickIgnore = (container: HTMLElement) => {
  const button = Array.from(container.querySelectorAll('button'))
    .find((b) => (b.getAttribute('title') ?? '').includes('Global.Ignore'));
  if (!button) throw new Error('no Ignore button');
  button.click();
};

describe('ignoring a suggested word that owns a flashcard', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    // A modal renders through a Portal onto document.body, so it outlives the
    // container cleanup. Clear it, or a prompt from an earlier case is read as
    // this case's.
    for (const d of Array.from(document.querySelectorAll('[role=dialog]'))) d.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    flashcards.ignoreWordForLanguage.mockReset();
    flashcards.ignoreWordForLanguage.mockResolvedValue(undefined);
    vi.mocked(showToast).mockClear();
    flashcards.removeSuggestedFlashcard.mockClear();
  });

  afterEach(() => container.remove());

  it('saves a study preference without implying that authored cards are deleted', async () => {
    flashcards.wordsWithCards.add('alpha');
    render(() => <FlashcardsSuggested />, container);
    await flush(); clickIgnore(container); await flush();
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(flashcards.ignoreWordForLanguage).toHaveBeenCalledWith('alpha', '', 'ja');
    expect(flashcards.removeSuggestedFlashcard).toHaveBeenCalledWith('a');
  });
  it('keeps the suggestion while its preference save is pending', async () => {
    let accept!: () => void;
    flashcards.ignoreWordForLanguage.mockImplementationOnce(() => new Promise<void>(resolve => { accept = resolve; }));
    render(() => <FlashcardsSuggested />, container);
    await flush(); clickIgnore(container); await flush();
    expect(flashcards.removeSuggestedFlashcard).not.toHaveBeenCalled();
    accept(); await flush();
    expect(flashcards.removeSuggestedFlashcard).toHaveBeenCalledWith('a');
  });
  it('keeps the suggestion and explains a refused preference save', async () => {
    flashcards.ignoreWordForLanguage.mockRejectedValueOnce(new Error('disk full'));
    render(() => <FlashcardsSuggested />, container);
    await flush(); clickIgnore(container); await flush();
    expect(flashcards.removeSuggestedFlashcard).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith({ message: 'mlearn.Knowledge.StudyPreferenceSaveFailed', variant: 'error' });
    clickIgnore(container); await flush();
    expect(flashcards.removeSuggestedFlashcard).toHaveBeenCalledWith('a');
  });
});
