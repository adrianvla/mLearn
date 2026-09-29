// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal, type Accessor } from 'solid-js';
import type { JSX } from 'solid-js';
import type { Flashcard, LanguageData, Settings } from '../../../shared/types';
import { DEFAULT_SETTINGS } from '../../../shared/types';
import { FlashcardReview } from './FlashcardReview';
import { knowledgeInspection, closeKnowledgeInspector } from '../../services/openKnowledgeInspector';
import { surfaceEntityId } from '../../../shared/graph/load';
import { hashWordSync } from '../../services/srsAlgorithm';

const toastMocks = vi.hoisted(() => ({ showToast: vi.fn(() => 0) }));

let mockCard: Accessor<Flashcard | null> = () => null;
let setMockCard: (card: Flashcard | null) => void = () => {};
let mockLangMap: Record<string, LanguageData> = {};
let mockLanguageData: LanguageData | null = null;
let mockSettings: Settings = { ...DEFAULT_SETTINGS };
let mockQueueTotal: Accessor<number> = () => 1;
// What the async knowledge projection currently reports: pending lookups and
// unmeasured surfaces must not be able to strip a card of its rating rows.
const ALL_CAPABILITIES = ['sense-recognition', 'surface-reading', 'prosodic-pattern'];
let mockKnowledgeLoading: Accessor<boolean> = () => false;
let setMockKnowledgeLoading: (loading: boolean) => void = () => {};
let mockKnowledgeMeasured: Accessor<string[]> = () => ALL_CAPABILITIES;
let setMockKnowledgeMeasured: (measured: string[]) => void = () => {};
let setMockQueueTotal: (total: number) => void = () => {};
let mockTtsAvailable = true;
const mockSetAccessStatus = vi.fn();
const mockBuryCard = vi.fn();
const mockSubmitRating = vi.fn(async (..._callArgs: unknown[]) => ({ attemptId: 'attempt-1', completed: false }));
const mockAppendRetractions = vi.fn();
const mockUndoLastAction = vi.fn<() => Promise<string | null>>();
const mockCanUndo = vi.fn(() => false);
const mockRemoveFlashcard = vi.fn(async (_id: string, _neverShowAgain?: boolean) => true);

const flushEffects = () => new Promise<void>((resolve) => {
  const channel = new MessageChannel();
  channel.port1.onmessage = () => resolve();
  channel.port2.postMessage(null);
});

const mockT = (key: string, params?: Record<string, unknown>): string => {
  switch (key) {
    case 'mlearn.Flashcards.Review.Attribution.WrongReading': return 'Wrong reading';
    case 'mlearn.Flashcards.Review.Attribution.WrongOrthography': return 'Unrecognized form';
    case 'mlearn.Flashcards.Review.Attribution.WrongProsody': return 'Wrong prosody';
    case 'mlearn.Flashcards.Review.Attribution.Marked': return `Marked ${String(params?.aspect ?? '')} as unknown`;
    case 'mlearn.Knowledge.Capability.sense-recognition': return 'Meaning';
    case 'mlearn.Knowledge.Capability.surface-reading': return 'Reading';
    case 'mlearn.Knowledge.Capability.surface-recognition': return 'Recognize this spelling';
    case 'mlearn.Rating.Matrix.Missed': return 'Missed';
    case 'mlearn.Rating.Matrix.Struggled': return 'Struggled';
    case 'mlearn.Rating.Matrix.Fluent': return 'Fluent';
    case 'mlearn.Rating.Matrix.AllFluent': return 'All tested fluent';
    case 'mlearn.Rating.Compact.AllFluent': return 'All fluent';
    case 'mlearn.Rating.Compact.AllEasy': return 'All easy';
    case 'mlearn.Rating.Compact.Adjust': return 'Adjust';
    case 'mlearn.Knowledge.Capability.prosodic-pattern': return 'Prosody';
    case 'mlearn.Flashcards.Review.Again': return 'Again';
    case 'mlearn.Flashcards.Review.Hard': return 'Hard';
    case 'mlearn.Flashcards.Review.Ok': return 'Ok';
    case 'mlearn.Flashcards.Review.ShowAnswer': return 'Show Answer';
    case 'mlearn.Flashcards.Review.PressKeyTooltip': return `Press ${String(params?.key ?? '')}`;
    case 'mlearn.Flashcards.Modals.DeleteCard.Title': return 'Delete Flashcard';
    case 'mlearn.Flashcards.Modals.DeleteCard.Confirm': return 'Are you sure you want to delete this flashcard? This action cannot be undone.';
    case 'mlearn.Global.Delete': return 'Delete';
    case 'mlearn.Global.Cancel': return 'Cancel';
    default: return key;
  }
};

vi.mock('../../hooks/useKnowledgeProjection', () => ({
  useKnowledgeProjection: () => ({
    loading: () => mockKnowledgeLoading(),
    capabilities: () => mockKnowledgeMeasured(),
  }),
}));

vi.mock('../../context', () => ({
  useFlashcards: () => ({
    isKnowledgeReady: () => true,
    store: { flashcards: {} },
    queue: () => ({ newQueue: [], scheduledQueue: [] }),
    queueCounts: () => ({ new: mockQueueTotal(), learning: 0, review: 0, total: mockQueueTotal() }),
    getCurrentCard: () => mockCard(),
    getPreviewDueDates: () => ({ again: 1, hard: 2, good: 3, easy: 4 }),
    buryCard: mockBuryCard,
    removeFlashcard: mockRemoveFlashcard,
    undoLastAction: mockUndoLastAction,
    canUndo: mockCanUndo,
    refreshQueue: vi.fn(),
    dueDateToString: () => '1d',
    generateExampleSentenceWithLLM: vi.fn(),
    updateFlashcardContent: vi.fn(),
    updateFlashcard: vi.fn(),
    setAccessStatus: mockSetAccessStatus,
    submitRating: mockSubmitRating,
    appendRetractions: mockAppendRetractions,
    recomputeWordKnowledgeFromEvidence: mockAppendRetractions,
    getComprehensiveWordStatusWithSourceSync: () => ({ status: 'unknown', source: 'None', timesSeen: 0, ease: 0 }),
    getWordKnowledge: () => ({}),
  }),
  useLanguage: () => ({
    langData: mockLangMap,
    currentLangData: () => mockLanguageData,
    getLanguageFeatures: () => ({}),
    getCanonicalForm: (word: string) => word,
    getWordVariants: (word: string) => [word],
    getCanonicalFormForLanguage: (language: string, word: string) => `${language}:${word}`,
    getWordVariantsForLanguage: (language: string, word: string) => [`${language}-variant:${word}`],
    getReadingVariantsForLanguage: (language: string, reading: string) => [`${language}:${reading}:variant`],
    getFrequencyForLanguage: () => null,
    getLevelName: (level: number) => `Level ${level}`,
  }),
  useLocalization: () => ({
    t: mockT,
  }),
  useSettings: () => ({
    settings: mockSettings,
    updateSetting: vi.fn(),
  }),
}));

vi.mock('../../hooks/useFlashcardTts', () => ({
  useFlashcardTts: () => ({
    playTts: vi.fn((_id: string, _text: string, _language: string, _field: string, options?: { onStarted?: () => void }) => {
      if (mockTtsAvailable) options?.onStarted?.();
    }),
    isGenerating: () => false,
    stop: vi.fn(),
    metadata: () => null,
    playingField: () => null,
  }),
}));

vi.mock('../../hooks/useTranslation', () => ({
  cacheVersion: () => 0,
  getCachedTranslation: () => null,
}));

vi.mock('../../services/ankiWordsCache', () => ({
  ankiCacheVersion: () => 0,
  fetchAnkiWordsCache: () => Promise.resolve(),
  findWordInAnkiCache: () => false,
  isAnkiCacheFetched: () => true,
}));

vi.mock('../../../shared/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/platform')>();
  return { ...actual, isElectron: () => false };
});

vi.mock('../common/Feedback/Toast', () => ({
  showToast: toastMocks.showToast,
}));

vi.mock('../common', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../common')>();
  const Button = (props: {
    children?: JSX.Element;
    class?: string;
    classList?: Record<string, boolean>;
    onClick?: (e: MouseEvent) => void;
    title?: string;
    disabled?: boolean;
  }) => (
    <button type="button" class={props.class} classList={props.classList} onClick={props.onClick} title={props.title} disabled={props.disabled}>
      {props.children}
    </button>
  );
  const Panel = (props: { children?: JSX.Element; class?: string; classList?: Record<string, boolean> }) => (
    <section class={props.class} classList={props.classList}>{props.children}</section>
  );
  const Badge = (props: { children?: JSX.Element; class?: string }) => <span class={props.class}>{props.children}</span>;
  const ProgressBar = () => <div class="progress-bar" />;
  const Select = (props: {
    options?: Array<{ value: string; label: string; disabled?: boolean }>;
    value?: string;
    onChange?: (e: Event) => void;
    class?: string;
    id?: string;
  }) => (
    <select id={props.id} class={props.class} value={props.value ?? ''} onChange={props.onChange}>
      {props.options?.map((option) => <option value={option.value} disabled={option.disabled}>{option.label}</option>)}
    </select>
  );
  const ToggleSwitch = (props: { title?: string }) => <button type="button" title={props.title} />;
  const IconStub = () => <span />;
  const PillLabel = (props: { children?: JSX.Element; class?: string; level?: number }) => (
    <span class={props.class} data-level={props.level}>{props.children}</span>
  );
  const IconBtn = (props: {
    class?: string;
    classList?: Record<string, boolean>;
    onClick?: (e: MouseEvent) => void;
    title?: string;
    disabled?: boolean;
  }) => (
    <button type="button" class={props.class} classList={props.classList} onClick={props.onClick} title={props.title} disabled={props.disabled} />
  );
  const HoverReveal = (props: { label?: string; class?: string }) => <span class={props.class}>{props.label}</span>;
  const SafeHtml = (props: { tag: string; class?: string; html?: string }) => {
    const el = document.createElement(props.tag);
    if (props.class) el.className = props.class;
    el.innerHTML = props.html ?? '';
    return el;
  };
  return {
    Button,
    Panel,
    Badge,
    ProgressBar,
    Select,
    ToggleSwitch,
    StealthIcon: IconStub,
    VolumeOffIcon: IconStub,
    MicrophoneIcon: IconStub,
    EditIcon: IconStub,
    AnkiIcon: IconStub,
    RefreshIcon: IconStub,
    PillLabel,
    IconBtn,
    HoverReveal,
    SafeHtml,
    RatingMatrix: actual.RatingMatrix,
    Popover: actual.Popover,
    // Real banner: the save-failure tests read its role/label contract.
    WriteStatusBanner: actual.WriteStatusBanner,
    // Real confirm dialog: the removal tests assert the prompt is actually in
    // the way, which a stubbed prompt would make impossible to observe.
    useConfirmDialog: actual.useConfirmDialog,
  };
});

vi.mock('./FlashcardEditModal', () => ({
  FlashcardEditModal: () => null,
}));

vi.mock('./TtsGenerateModal', () => ({
  TtsGenerateModal: () => null,
}));

vi.mock('./OtherLanguageDueHint', () => ({
  OtherLanguageDueHint: () => null,
}));

const jaLanguageData: LanguageData = {
  name: 'Japanese',
  settings: { fixed: {} },
  textProcessing: {
    scriptProfile: { acceptedScripts: ['Hira', 'Han'] },
    readingAnnotation: { display: 'ruby' },
  },
  prosody: { type: 'tone' },
};

function makeCard(overrides: Partial<Flashcard> = {}): Flashcard {
  return {
    id: 'card-1',
    language: 'ja',
    content: { type: 'word', front: '犬', reading: 'いぬ', back: 'dog' },
    state: 'learning',
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

function clickShowAnswer(container: HTMLDivElement): void {
  const button = container.querySelector<HTMLButtonElement>('.flashcard-show-answer-btn');
  if (!button) throw new Error('Show Answer button missing');
  button.click();
}

describe('FlashcardReview', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.clearAllMocks();
    mockTtsAvailable = true;
    mockSettings = {
      ...DEFAULT_SETTINGS,
      language: 'ja',
      flashcardAutoTts: false,
      flashcardFlipAnimation: false,
      use_anki: false,
      flashcardStealthMode: false,
      flashcardMuteAudio: false,
    };
    mockLangMap = { ja: jaLanguageData };
    mockLanguageData = jaLanguageData;
    const [card, setCard] = createSignal<Flashcard | null>(null);
    mockCard = card;
    setMockCard = setCard;
    setMockCard(makeCard());
    const [queueTotal, setQueueTotal] = createSignal(1);
    mockQueueTotal = queueTotal;
    setMockQueueTotal = setQueueTotal;
    const [knowledgeLoading, setKnowledgeLoading] = createSignal(false);
    mockKnowledgeLoading = knowledgeLoading;
    setMockKnowledgeLoading = setKnowledgeLoading;
    const [knowledgeMeasured, setKnowledgeMeasured] = createSignal<string[]>([...ALL_CAPABILITIES]);
    mockKnowledgeMeasured = knowledgeMeasured;
    setMockKnowledgeMeasured = setKnowledgeMeasured;
  });

  afterEach(() => {
    closeKnowledgeInspector();
    container.remove();
  });

  it('opens the shared inspector on the reviewed card identity without recording an outcome', () => {
    const dispose = render(() => <FlashcardReview />, container);
    clickShowAnswer(container);
    const actions = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'mlearn.Flashcards.Review.CardActions');
    expect(actions).toBeDefined();
    actions!.click();
    const inspect = Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent === 'mlearn.Knowledge.Popup.Inspect');
    expect(inspect).toBeDefined();
    inspect!.click();
    // R20: the SAME pinned decision that selected the card rides into the
    // drawer — the identity fields are unchanged and the emitted trace +
    // brief reason are carried verbatim.
    const inspection = knowledgeInspection()!;
    expect(inspection.language).toBe('ja');
    expect(inspection.surface).toBe('犬');
    expect(inspection.target).toEqual({ kind: 'surface', id: surfaceEntityId('ja', hashWordSync('犬')) });
    expect(inspection.policyBrief).toBeTypeOf('string');
    expect(inspection.policyTrace?.version).toBeTypeOf('string');
    expect(inspection.policyTrace?.selectedKey).toBeTypeOf('string');
    expect(mockSubmitRating).not.toHaveBeenCalled();
    dispose();
  });

  it('starts the next displayed card face-down once the reveal belonged to the previous one (R20)', async () => {
    const backFace = () => container.querySelector<HTMLElement>('.flashcard-back');
    const backHidden = () => backFace()?.classList.contains('flashcard-face--hidden');
    const dispose = render(() => <FlashcardReview />, container);
    // Both faces are always mounted; the unrevealed back carries `--hidden`.
    expect(backHidden()).toBe(true);
    clickShowAnswer(container);
    expect(backHidden()).toBe(false);

    // The context advances to a different card: the reveal must not leak
    // onto it (pre-fix, the revealed answer stayed armed on the next card).
    setMockCard(makeCard({ id: 'card-2', content: { type: 'word', front: '猫', reading: 'ねこ', back: 'cat' } }));
    await flushEffects();

    expect(backHidden()).toBe(true);
    dispose();
  });

  it('starts a different card at the top of the review scroll region', async () => {
    const dispose = render(() => <FlashcardReview />, container);
    const scrollRegion = container.querySelector<HTMLElement>('.flashcard-review-container')!;
    scrollRegion.scrollTop = 240;

    setMockCard(makeCard({ id: 'card-2', content: { type: 'word', front: '猫', reading: 'ねこ', back: 'cat' } }));
    await flushEffects();

    expect(scrollRegion.scrollTop).toBe(0);
    dispose();
  });

});

describe('FlashcardReview failure attribution', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.clearAllMocks();
    mockTtsAvailable = true;
    mockSettings = {
      ...DEFAULT_SETTINGS,
      language: 'ja',
      flashcardAutoTts: false,
      flashcardFlipAnimation: false,
      use_anki: false,
      flashcardStealthMode: false,
      flashcardMuteAudio: false,
    };
    mockLangMap = { ja: jaLanguageData };
    mockLanguageData = jaLanguageData;
    const [card, setCard] = createSignal<Flashcard | null>(null);
    mockCard = card;
    setMockCard = setCard;
    setMockCard(makeCard());
    const [queueTotal, setQueueTotal] = createSignal(1);
    mockQueueTotal = queueTotal;
    setMockQueueTotal = setQueueTotal;
    const [knowledgeLoading, setKnowledgeLoading] = createSignal(false);
    mockKnowledgeLoading = knowledgeLoading;
    setMockKnowledgeLoading = setKnowledgeLoading;
    const [knowledgeMeasured, setKnowledgeMeasured] = createSignal<string[]>([...ALL_CAPABILITIES]);
    mockKnowledgeMeasured = knowledgeMeasured;
    setMockKnowledgeMeasured = setKnowledgeMeasured;
  });

  afterEach(() => {
    container.remove();
  });

  it('persists every tested capability as one acknowledged whole-word attempt', async () => {
    const dispose = render(() => <FlashcardReview />, container);
    expect(container.querySelector('.rating-matrix')).toBeNull();
    clickShowAnswer(container);
    // Canonical collapsed digit: the whole tested word rates at once —
    // every tested capability, one logical attempt; strays are absorbed.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
    await flushEffects();
    expect(mockSubmitRating).toHaveBeenCalledTimes(1);
    expect(mockSubmitRating).toHaveBeenCalledWith('犬', [
      { capability: 'sense-recognition', quality: 'missed' },
      { capability: 'surface-reading', quality: 'missed' },
    ], expect.objectContaining({
      taskType: 'srs-review',
      scheduler: { cardId: 'card-1', rating: 'again', timeSpentMs: expect.any(Number), tested: ['sense-recognition', 'surface-reading'] },
    }));
    dispose();
  });

  it('keeps selection details in Inspect without a generic inline Why panel', () => {
    const dispose = render(() => <FlashcardReview />, container);
    expect(container.querySelector('[data-testid="policy-why"]')).toBeNull();
    clickShowAnswer(container);
    expect(container.querySelector('[data-testid="policy-why"]')).toBeNull();
    dispose();
  });

  it('resets scroll when the same learning card is queued again after rating', async () => {
    const dispose = render(() => <FlashcardReview />, container);
    const scrollRegion = container.querySelector<HTMLElement>('.flashcard-review-container')!;
    clickShowAnswer(container);
    scrollRegion.scrollTop = 240;

    container.querySelector<HTMLButtonElement>('.rating-matrix__quality')!.click();
    await flushEffects();

    expect(scrollRegion.scrollTop).toBe(0);
    expect(container.querySelector('.flashcard-show-answer-btn')).not.toBeNull();
    dispose();
  });

  it('Space reveals without submitting; the compact bar mounts armed on reveal', () => {
    const dispose = render(() => <FlashcardReview />, container);
    const compactActions = () => Array.from(container.querySelectorAll<HTMLButtonElement>('.rating-matrix__quality'));
    // No rating surface exists before the reveal.
    expect(container.querySelector('.rating-matrix')).toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    expect(compactActions().length).toBeGreaterThan(0);
    expect(compactActions().every((action) => action.disabled)).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    expect(mockSubmitRating).not.toHaveBeenCalled();
    dispose();
  });

  it('reports completion once the queue drains, and resumes a studyable face when work returns', async () => {
    const onComplete = vi.fn();
    const dispose = render(() => <FlashcardReview onComplete={onComplete} />, container);
    expect(container.querySelector('.flashcard-show-answer-btn')).not.toBeNull();
    expect(onComplete).not.toHaveBeenCalled();

    // Draining the last card empties the reviewable queue: the shared study
    // contract reports `complete` and the surface hands completion upward.
    setMockCard(null);
    setMockQueueTotal(0);
    await flushEffects();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.flashcard-show-answer-btn')).toBeNull();

    // Completion is derived, not latched: new work restores a normal review.
    setMockCard(makeCard());
    setMockQueueTotal(1);
    await flushEffects();
    expect(container.querySelector('.flashcard-show-answer-btn')).not.toBeNull();
    dispose();
  });

  it('keeps a revealed card rateable while its knowledge projection is pending or unmeasured', async () => {
    // An unmeasured/pending projection must not empty the rating rows: doing so
    // renders a revealed card with no way to record an outcome.
    setMockKnowledgeLoading(true);
    setMockKnowledgeMeasured([]);
    const dispose = render(() => <FlashcardReview />, container);
    clickShowAnswer(container);
    await flushEffects();
    const quality = () => Array.from(container.querySelectorAll<HTMLButtonElement>('.rating-matrix__quality'));
    expect(quality().length).toBeGreaterThan(0);
    expect(quality().every((button) => !button.disabled)).toBe(true);

    // A resolved projection still narrows what the submission records: the
    // collapsed bar is unchanged, but only the measured capability is rated.
    setMockKnowledgeLoading(false);
    setMockKnowledgeMeasured(['sense-recognition']);
    await flushEffects();
    expect(quality().length).toBe(4);
    expect(quality().every((button) => !button.disabled)).toBe(true);

    quality()[2].click();
    await flushEffects();
    expect(mockSubmitRating).toHaveBeenCalledTimes(1);
    expect(mockSubmitRating.mock.calls[0][1]).toEqual([
      { capability: 'sense-recognition', quality: 'fluent' },
    ]);
    dispose();
  });

  it('keeps study shortcuts out of the card actions popover', () => {
    const dispose = render(() => <FlashcardReview />, container);
    const actions = container.querySelector<HTMLButtonElement>('.flashcard-actions-trigger')!;
    actions.click();
    const bury = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === 'mlearn.Flashcards.Review.Bury');
    expect(bury).toBeDefined();

    bury!.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));

    expect(mockBuryCard).not.toHaveBeenCalled();
    expect(container.querySelector('.flashcard-show-answer-btn')).not.toBeNull();
    dispose();
  });
  it('a mixed drafted profile schedules on its weakest evidence under one attempt', async () => {
    const dispose = render(() => <FlashcardReview />, container);
    clickShowAnswer(container);
    container.querySelector<HTMLButtonElement>('.rating-matrix__adjust')!.click();
    // sense fluent, reading missed — the weaker LATER row must dominate
    // scheduling, so this fails against an observations[0]-quality bug.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
    await flushEffects();
    expect(mockSubmitRating).toHaveBeenCalledTimes(1);
    expect(mockSubmitRating).toHaveBeenCalledWith('犬', [
      { capability: 'sense-recognition', quality: 'fluent' },
      { capability: 'surface-reading', quality: 'missed' },
    ], expect.objectContaining({
      taskType: 'srs-review',
      scheduler: { cardId: 'card-1', rating: 'again', timeSpentMs: expect.any(Number), tested: ['sense-recognition', 'surface-reading'] },
    }));
    dispose();
  });

  it('audio supplied before reveal still offers Reading and records the scaffold with the attempt', async () => {
    mockSettings.flashcardAutoTts = true;
    const dispose = render(() => <FlashcardReview />, container);
    clickShowAnswer(container);
    // A revealed cue changes the evidence condition, not the rating surface:
    // the Reading row stays ratable and the audio scaffold travels with the
    // attempt so the projection can weigh it. Collapsed digit = whole word.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
    await flushEffects();
    expect(mockSubmitRating).toHaveBeenCalledTimes(1);
    expect(mockSubmitRating).toHaveBeenCalledWith('犬', [
      { capability: 'sense-recognition', quality: 'missed' },
      { capability: 'surface-reading', quality: 'missed' },
    ], expect.objectContaining({
      taskType: 'srs-review',
      scaffolds: { audio: true },
      scheduler: expect.objectContaining({ cardId: 'card-1', rating: 'again', tested: ['sense-recognition', 'surface-reading'] }),
    }));
    dispose();
  });

  it('does not attribute an audio cue when automatic playback has no recording', async () => {
    mockTtsAvailable = false;
    mockSettings.flashcardAutoTts = true;
    const dispose = render(() => <FlashcardReview />, container);
    clickShowAnswer(container);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
    await flushEffects();
    expect(mockSubmitRating).toHaveBeenCalledTimes(1);
    expect(mockSubmitRating.mock.calls[0][2]).not.toHaveProperty('scaffolds');
    dispose();
  });

  it('keeps the card visible on a refused rating command and retries the same command', async () => {
    mockSubmitRating.mockRejectedValueOnce(new Error('journal unavailable'));
    const dispose = render(() => <FlashcardReview />, container);
    clickShowAnswer(container);
    container.querySelector<HTMLButtonElement>('.rating-matrix__quality')!.click();
    await flushEffects();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('mlearn.Flashcards.Review.SaveFailed');
    const retry = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'mlearn.Global.TryAgain');
    expect(retry).toBeDefined();
    retry!.click();
    await flushEffects();

    expect(mockSubmitRating).toHaveBeenCalledTimes(2);
    expect(mockSubmitRating.mock.calls[0]).toEqual(mockSubmitRating.mock.calls[1]);
    dispose();
  });

  it('keeps a failed Undo visible and retries the same Undo command', async () => {
    mockCanUndo.mockReturnValue(true);
    mockUndoLastAction.mockRejectedValueOnce(new Error('disk full')).mockResolvedValueOnce('answer');
    const dispose = render(() => <FlashcardReview />, container);
    const undo = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'mlearn.Flashcards.Review.Undo');
    expect(undo).toBeDefined();
    undo!.click();
    await flushEffects();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('mlearn.Flashcards.Review.UndoSaveFailed');
    const retry = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'mlearn.Global.TryAgain');
    expect(retry).toBeDefined();
    retry!.click();
    await flushEffects();

    expect(mockUndoLastAction).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    dispose();
  });

  it('renders card actions in the shared anchored popover', () => {
    const dispose = render(() => <FlashcardReview />, container);
    const trigger = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'mlearn.Flashcards.Review.CardActions');
    expect(trigger).toBeDefined();
    trigger!.click();
    expect(document.body.querySelector('.flashcard-actions-popover')).not.toBeNull();
    expect(document.body.textContent).toContain('mlearn.Flashcards.Review.Bury');
    dispose();
  });
});

/**
 * Remove in Review is the same irreversible act as Delete in Browse: the card,
 * its word mapping, its stats and any media it was built from are gone, and
 * nothing in the app can put them back.
 *
 * Observed in the running app: pressing Remove here took the store from 450 to
 * 449 with no dialog and no undo, while the Browse row action two windows over
 * opened a confirmation. Whether a flashcard could be destroyed without
 * warning depended on which surface the learner happened to be in.
 *
 * These tests drive the real review surface and the real confirm dialog, so an
 * implementation that removes and asks afterwards — or asks on one entry point
 * but not the other — fails here.
 */
describe('FlashcardReview Remove asks before it destroys the card', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.clearAllMocks();
    mockTtsAvailable = true;
    mockSettings = {
      ...DEFAULT_SETTINGS,
      language: 'ja',
      flashcardAutoTts: false,
      flashcardFlipAnimation: false,
      use_anki: false,
      flashcardStealthMode: false,
      flashcardMuteAudio: false,
    };
    mockLangMap = { ja: jaLanguageData };
    mockLanguageData = jaLanguageData;
    const [card, setCard] = createSignal<Flashcard | null>(null);
    mockCard = card;
    setMockCard = setCard;
    setMockCard(makeCard());
    const [queueTotal, setQueueTotal] = createSignal(1);
    mockQueueTotal = queueTotal;
    setMockQueueTotal = setQueueTotal;
    const [knowledgeLoading] = createSignal(false);
    mockKnowledgeLoading = knowledgeLoading;
    const [knowledgeMeasured] = createSignal<string[]>([...ALL_CAPABILITIES]);
    mockKnowledgeMeasured = knowledgeMeasured;
  });

  afterEach(() => {
    closeKnowledgeInspector();
    document.querySelectorAll('[role=dialog]').forEach((node) => node.remove());
    container.remove();
  });

  const openRemove = async () => {
    const dispose = render(() => <FlashcardReview />, container);
    const actions = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent === 'mlearn.Flashcards.Review.CardActions');
    expect(actions, 'card actions control is missing').toBeDefined();
    actions!.click();
    const remove = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent === 'mlearn.Flashcards.Review.Remove');
    expect(remove, 'Remove control is missing').toBeDefined();
    remove!.click();
    await flushEffects();
    return dispose;
  };

  // The card-actions popover is also a dialog, so the confirm is located by
  // the one string only it can contain.
  const dialog = () => Array.from(document.querySelectorAll('[role=dialog]'))
    .find((node) => node.textContent?.includes('Are you sure you want to delete this flashcard?')
      || node.textContent?.includes('mlearn.Flashcards.Modals.DeleteCard.Confirm'))
    ?? null;
  const dialogText = () => dialog()?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
  const dialogButton = (label: string) =>
    Array.from(dialog()?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent?.trim() === label) ?? null;

  it('keeps the card and shows the same prompt Browse uses', async () => {
    await openRemove();

    expect(mockRemoveFlashcard, 'the card was removed without asking').not.toHaveBeenCalled();
    expect(dialogText()).toContain('Delete Flashcard');
    expect(dialogText()).toContain('Are you sure you want to delete this flashcard?');
  });

  it('removes the card only once the prompt is confirmed', async () => {
    await openRemove();

    const confirm = dialogButton('Delete');
    expect(confirm, 'the prompt has no confirm control').not.toBeNull();
    confirm!.click();
    await flushEffects();

    expect(mockRemoveFlashcard).toHaveBeenCalledTimes(1);
    expect(mockRemoveFlashcard.mock.calls[0]?.[0]).toBe(mockCard()?.id);
  });

  it('cancelling leaves the card in place', async () => {
    await openRemove();

    const cancel = dialogButton('Cancel');
    expect(cancel, 'the prompt has no cancel control').not.toBeNull();
    cancel!.click();
    await flushEffects();

    expect(mockRemoveFlashcard).not.toHaveBeenCalled();
  });
});
