// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal, type Accessor } from 'solid-js';
import type { JSX } from 'solid-js';
import type { Flashcard, LanguageData, ReviewQueue, Settings } from '../../../shared/types';
import { DEFAULT_SETTINGS } from '../../../shared/types';
import { FlashcardReview } from './FlashcardReview';
import { knowledgeInspection, closeKnowledgeInspector } from '../../services/openKnowledgeInspector';
import { inProcessStudySessionLocks } from '../../learning/studySessionController';
import { surfaceEntityId } from '../../../shared/graph/load';
import { getNextCard, hashWordSync } from '../../services/srsAlgorithm';
import type { KnowledgeProjection } from '../../../shared/graph/ipc';

const toastMocks = vi.hoisted(() => ({ showToast: vi.fn(() => 0) }));

let mockCard: Accessor<Flashcard | null> = () => null;
let setMockCard: (card: Flashcard | null) => void = () => {};
let mockIgnoredWords: Accessor<Set<string>> = () => new Set();
let mockReviewCards: Record<string, Flashcard> = {};
let mockReviewPresentations: Accessor<Record<string, unknown>> = () => ({});
let mockReviewQueue: Accessor<ReviewQueue> = () => ({ newQueue: [], scheduledQueue: [] });
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
const mockPlayedTts = vi.fn();
const mockSetAccessStatus = vi.fn();
const mockBuryCard = vi.fn();
const mockSubmitRating = vi.fn(async (..._callArgs: unknown[]) => ({ attemptId: 'attempt-1', completed: false }));
const mockAppendRetractions = vi.fn();
const mockUndoLastAction = vi.fn<() => Promise<string | null>>();
const mockCanUndo = vi.fn(() => false);
const mockRemoveFlashcard = vi.fn(async (_id: string, _neverShowAgain?: boolean) => true);
const defaultProjection: KnowledgeProjection = {
  status: 'ready', surfaceKnown: true,
  targets: [{ targetRef: { kind: 'surface', id: 'card-surface' },
    applicableCapabilities: ALL_CAPABILITIES, states: [] }],
};
let mockProjection: Accessor<KnowledgeProjection | undefined> = () => defaultProjection;
const mockProjectionRetry = vi.fn();
let mockRatingPersistenceState: Accessor<'idle' | 'pending' | 'failed'> = () => 'idle';
const mockRetryRatingPersistence = vi.fn().mockResolvedValue(undefined);

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
    projection: () => mockKnowledgeLoading() ? undefined : mockProjection(),
    loading: () => mockKnowledgeLoading() || mockProjection() === undefined,
    capabilities: () => mockProjection() === defaultProjection ? mockKnowledgeMeasured() : [...new Set(mockProjection()?.targets?.flatMap(target => target.applicableCapabilities) ?? [])],
    retry: mockProjectionRetry,
  }),
}));

vi.mock('../../context', () => ({
  useFlashcards: () => ({
    isKnowledgeReady: () => true,
    isWordIgnoredSync: (word: string) => mockIgnoredWords().has(word),
    store: { get flashcards() { return mockReviewCards; }, get meta() { return { reviewPresentations: mockReviewPresentations() }; } },
    queue: () => mockReviewQueue(),
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
    ratingPersistenceState: () => mockRatingPersistenceState(),
    retryRatingPersistence: mockRetryRatingPersistence,
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
    playTts: vi.fn(async (id: string, _text: string, language: string, field: string, options?: { onStarted?: () => void; beforePlay?: () => boolean | Promise<boolean> }) => {
      if (!mockTtsAvailable) return;
      if (options?.beforePlay && !await options.beforePlay()) return;
      mockPlayedTts(id, language, field);
      options?.onStarted?.();
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
    ref?: (element: HTMLButtonElement) => void;
  }) => (
    <button ref={props.ref} type="button" class={props.class} classList={props.classList} onClick={props.onClick} title={props.title} disabled={props.disabled}>
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
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.clearAllMocks();
    mockProjection = () => defaultProjection;
    mockRatingPersistenceState = () => 'idle';
    mockTtsAvailable = true;
    mockIgnoredWords = () => new Set();
    mockPlayedTts.mockClear();
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
    mockReviewCards = {};
    mockReviewPresentations = () => ({});
    mockReviewQueue = () => ({ newQueue: [], scheduledQueue: [] });
    container.remove();
  });

  it.each(['pointer', 'keyboard'] as const)('keeps %s reveal and rating outside the card scroll owner and resets both positions for the next encounter', async revealMethod => {
    setMockCard(makeCard({ content: { type: 'word', front: 'Long prompt', back: 'Answer',
      example: 'Long example '.repeat(100), imageUrl: 'flashcard-image://unavailable.png' } }));
    const dispose = render(() => <FlashcardReview />, container);
    try {
      await flushEffects();
      const content = container.querySelector<HTMLElement>('.flashcard-review-content');
      const actions = container.querySelector<HTMLElement>('.flashcard-buttons-container')!;
      const reveal = container.querySelector<HTMLButtonElement>('.flashcard-show-answer-btn')!;
      expect(content).not.toBeNull();
      expect(content!.contains(container.querySelector('.flashcard-container'))).toBe(true);
      expect(content!.contains(reveal)).toBe(false);
      expect(content!.contains(container.querySelector('.flashcard-review-header'))).toBe(false);
      expect(actions.contains(reveal)).toBe(true);
      content!.scrollTop = 240;
      if (revealMethod === 'pointer') clickShowAnswer(container);
      else document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
      expect(content!.scrollTop).toBe(0);
      expect(actions.querySelector('.rating-matrix')).not.toBeNull();
      expect(content!.contains(actions)).toBe(false);
      content!.scrollTop = 240;
      actions.scrollTop = 170;
      setMockCard(makeCard({ id: 'next-layout-card', content: { type: 'word', front: 'Next prompt', back: 'Next answer' } }));
      await flushEffects();
      expect(content!.scrollTop).toBe(0);
      expect(actions.scrollTop).toBe(0);
      expect(actions.querySelector('.flashcard-show-answer-btn')).not.toBeNull();
      expect(container.querySelector('.flashcard-front')!.textContent).toContain('Next prompt');
    } finally { dispose(); }
  });

  it('keeps the revealed encounter and rating identity when a flush changes the scheduler fallback', async () => {
    const first = makeCard({ id: 'first', state: 'review', interval: 1, dueDate: Date.now() - 1000 });
    const second = makeCard({ id: 'second', state: 'review', interval: 1, dueDate: Date.now() - 1000,
      content: { type: 'word', front: '猫', reading: 'ねこ', back: 'cat' } });
    mockReviewCards = { [first.id]: first, [second.id]: second };
    const [queue, setQueue] = createSignal<ReviewQueue>({ newQueue: [], scheduledQueue: [first.id, second.id] });
    mockReviewQueue = queue;
    setMockCard(first);
    const random = vi.spyOn(Math, 'random').mockReturnValueOnce(0.9).mockReturnValueOnce(0.1);
    const dispose = render(() => <FlashcardReview />, container);
    try {
      clickShowAnswer(container);
      const prompt = container.querySelector('.flashcard-front')!.textContent;
      const scrollRegion = container.querySelector<HTMLElement>('.flashcard-review-content')!;
      scrollRegion.scrollTop = 240;
      // The acknowledgment rebuilds the queue; the scheduler may return a
      // different fallback although the displayed card is still admitted.
      random.mockReturnValueOnce(0.1).mockReturnValueOnce(0.9);
      setMockCard(second);
      setQueue({ newQueue: [], scheduledQueue: [first.id, second.id] });
      await flushEffects();
      expect(container.querySelector('.flashcard-front')!.textContent).toBe(prompt);
      expect(container.querySelector('.flashcard-back')!.classList.contains('flashcard-face--hidden')).toBe(false);
      expect(scrollRegion.scrollTop).toBe(240);
      expect(random).toHaveBeenCalledTimes(2);
      container.querySelector<HTMLButtonElement>('.rating-matrix__quality')!.click();
      await flushEffects();
      expect(mockSubmitRating).toHaveBeenCalledWith(first.content.front, expect.any(Array),
        expect.objectContaining({ scheduler: expect.objectContaining({ cardId: first.id }) }));
      expect(container.querySelector('.flashcard-front')!.textContent).toBe(second.content.front);
      expect(container.querySelector('.flashcard-back')!.classList.contains('flashcard-face--hidden')).toBe(true);
    } finally {
      dispose();
    }
  });

  it('holds the displayed card across acknowledgment with the real scheduler random interleaving', async () => {
    const review = makeCard({ id: 'review', state: 'review', interval: 1, dueDate: Date.now() - 1000 });
    const fresh = makeCard({ id: 'fresh', state: 'new', dueDate: Date.now() - 1000,
      content: { type: 'word', front: '猫', reading: 'ねこ', back: 'cat' } });
    mockReviewCards = { [review.id]: review, [fresh.id]: fresh };
    const [queue, setQueue] = createSignal<ReviewQueue>({ newQueue: [fresh.id], scheduledQueue: [review.id] });
    mockReviewQueue = queue;
    mockCard = () => getNextCard(queue(), mockReviewCards);
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5)
      .mockReturnValueOnce(0.5) // Scheduler fallback: review.
      .mockReturnValueOnce(0.1).mockReturnValueOnce(0.9); // Policy: review.
    const dispose = render(() => <FlashcardReview />, container);
    try {
      expect(container.querySelector('.flashcard-front')!.textContent).toBe(review.content.front);
      clickShowAnswer(container);
      random.mockReturnValue(0.01); // Scheduler now chooses the new card.
      expect(mockCard()?.id).toBe(fresh.id);
      const callsBeforeAcknowledgment = random.mock.calls.length;
      setQueue({ newQueue: [fresh.id], scheduledQueue: [review.id] });
      await flushEffects();
      expect(container.querySelector('.flashcard-front')!.textContent).toBe(review.content.front);
      expect(container.querySelector('.flashcard-back')!.classList.contains('flashcard-face--hidden')).toBe(false);
      // One scheduler read; no new policy draw for the active encounter.
      expect(random).toHaveBeenCalledTimes(callsBeforeAcknowledgment + 1);
    } finally {
      dispose();
    }
  });

  it.each(['unqueued', 'suspended', 'buried', 'deleted', 'excluded'] as const)(
    'releases the displayed encounter when another window makes it %s', async (change) => {
      const first = makeCard({ id: 'first', state: 'review', interval: 1, dueDate: Date.now() - 1000 });
      const second = makeCard({ id: 'second', state: 'review', interval: 1, dueDate: Date.now() - 1000,
        content: { type: 'word', front: '猫', reading: 'ねこ', back: 'cat' } });
      mockReviewCards = { [first.id]: first, [second.id]: second };
      const [queue, setQueue] = createSignal<ReviewQueue>({ newQueue: [], scheduledQueue: [first.id, second.id] });
      mockReviewQueue = queue;
      setMockCard(first);
      vi.spyOn(Math, 'random').mockReturnValueOnce(0.9).mockReturnValueOnce(0.1).mockReturnValue(0.5);
      const dispose = render(() => <FlashcardReview />, container);
      try {
        clickShowAnswer(container);
        if (change === 'deleted') delete mockReviewCards[first.id];
        if (change === 'suspended' || change === 'buried') {
          mockReviewCards[first.id] = { ...first, [change]: true };
        }
        if (change === 'excluded') mockIgnoredWords = () => new Set([first.content.front]);
        // A peer commit updates the card store and rebuilds the workload.
        setMockCard(second);
        setQueue({ newQueue: [], scheduledQueue: change === 'unqueued' ? [second.id] : [first.id, second.id] });
        await flushEffects();
        expect(container.querySelector('.flashcard-front')!.textContent).toBe(second.content.front);
        expect(container.querySelector('.flashcard-back')!.classList.contains('flashcard-face--hidden')).toBe(true);
      } finally {
        dispose();
      }
    },
  );

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
    const trace = inspection.policyTrace!;
    expect(trace.ranking[0].task?.requested).toEqual(expect.arrayContaining(['sense-recognition', 'surface-reading']));
    expect(trace.ranking[0].targets).toEqual(expect.arrayContaining([
      { entityId: surfaceEntityId('ja', hashWordSync('犬')), capability: 'sense-recognition' },
      { entityId: surfaceEntityId('ja', hashWordSync('犬')), capability: 'surface-reading' },
    ]));
    expect(mockSubmitRating).not.toHaveBeenCalled();
    dispose();
  });

  it('persists consulted answers before opening and carries the supplied accesses into review after restart', async () => {
    let dispose = render(() => <FlashcardReview />, container);
    const actions = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'mlearn.Flashcards.Review.CardActions')!;
    actions.click();
    Array.from(document.body.querySelectorAll('button')).find(button => button.textContent === 'mlearn.Knowledge.Popup.Inspect')!.click();
    expect(knowledgeInspection()).toBeUndefined();
    await flushEffects();
    expect(knowledgeInspection()?.surface).toBe('犬');
    closeKnowledgeInspector();
    dispose();
    dispose = render(() => <FlashcardReview />, container);
    clickShowAnswer(container);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await flushEffects();
    expect(mockSubmitRating).toHaveBeenCalledWith('犬', expect.any(Array), expect.objectContaining({
      persistence: 'immediate',
      scaffolds: expect.objectContaining({ 'provided-access:sense-recognition': true, 'provided-access:surface-reading': true }),
    }));
    dispose();
  });

  it('refuses to open reference content when its assistance record cannot be saved', async () => {
    const dispose = render(() => <FlashcardReview />, container);
    const failure = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'mlearn.Flashcards.Review.CardActions')!.click();
    Array.from(document.body.querySelectorAll('button')).find(button => button.textContent === 'mlearn.Knowledge.Popup.Inspect')!.click();
    await flushEffects();
    expect(knowledgeInspection()).toBeUndefined();
    expect(container.textContent).toContain('AssistanceSaveFailed');
    failure.mockRestore();
    dispose();
  });

  it('retries a legacy card in the language captured by its original assisted encounter', async () => {
    setMockCard(makeCard({ language: undefined }));
    const dispose = render(() => <FlashcardReview />, container);
    Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'mlearn.Flashcards.Review.CardActions')!.click();
    Array.from(document.body.querySelectorAll('button')).find(button => button.textContent === 'mlearn.Knowledge.Popup.Inspect')!.click();
    await flushEffects();
    closeKnowledgeInspector();
    mockSubmitRating.mockRejectedValueOnce(new Error('journal unavailable'));
    clickShowAnswer(container);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await flushEffects();
    mockSettings.language = 'other-package';
    Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'mlearn.Global.TryAgain')!.click();
    await flushEffects();
    expect(mockSubmitRating).toHaveBeenCalledTimes(2);
    expect(mockSubmitRating.mock.calls[1][2]).toMatchObject({ language: 'ja', attemptId: (mockSubmitRating.mock.calls[0][2] as { attemptId: string }).attemptId });
    dispose();
  });

  it('keeps reference exposure through a pending durable rating and clears it only on acknowledgment', async () => {
    const dispose = render(() => <FlashcardReview />, container);
    Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'mlearn.Flashcards.Review.CardActions')!.click();
    Array.from(document.body.querySelectorAll('button')).find(button => button.textContent === 'mlearn.Knowledge.Popup.Inspect')!.click();
    await flushEffects();
    closeKnowledgeInspector();
    const key = `mlearn-review-assistance:${encodeURIComponent(JSON.stringify(['ja', 'card-1']))}`;
    const retained = localStorage.getItem(key);
    expect(retained).not.toBeNull();
    let acknowledge!: () => void;
    mockSubmitRating.mockImplementationOnce(() => new Promise(resolve => {
      acknowledge = () => resolve({ attemptId: 'acknowledged', completed: false });
    }));
    clickShowAnswer(container);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await flushEffects();
    expect(localStorage.getItem(key)).toBe(retained);
    acknowledge();
    await flushEffects();
    expect(localStorage.getItem(key)).toBeNull();
    dispose();
  });

  it('drops delayed reference admission after the displayed card changes', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const lock = vi.spyOn(inProcessStudySessionLocks, 'request').mockImplementation(async (_name, callback) => {
      await gate;
      await callback();
    });
    const dispose = render(() => <FlashcardReview />, container);
    Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'mlearn.Flashcards.Review.CardActions')!.click();
    Array.from(document.body.querySelectorAll('button')).find(button => button.textContent === 'mlearn.Knowledge.Popup.Inspect')!.click();
    setMockCard(makeCard({ id: 'another', content: { type: 'word', front: 'another-surface', back: 'different' } }));
    await flushEffects();
    release();
    await flushEffects();
    expect(knowledgeInspection()).toBeUndefined();
    expect(localStorage.getItem(`mlearn-review-assistance:${encodeURIComponent(JSON.stringify(['ja', 'card-1']))}`)).toBeNull();
    lock.mockRestore();
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
    const scrollRegion = container.querySelector<HTMLElement>('.flashcard-review-content')!;
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
    mockProjection = () => defaultProjection;
    mockRatingPersistenceState = () => 'idle';
    mockTtsAvailable = true;
    mockIgnoredWords = () => new Set();
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
    mockReviewCards = {};
    mockReviewPresentations = () => ({});
    mockReviewQueue = () => ({ newQueue: [], scheduledQueue: [] });
    container.remove();
  });

  it('rates an authored card missing from the installed graph, including package-defined tested accesses', async () => {
    mockProjection = () => ({ status: 'ready', surfaceKnown: false, targets: [] });
    mockLanguageData = { ...jaLanguageData, learning: { capabilities: {
      'future-package::novel-access': { label: 'Novel access', testableIn: ['srs-review'] },
    } } };
    mockLangMap = { ja: mockLanguageData };
    setMockCard(makeCard({ content: { type: 'word', front: 'おかげさま', back: "(someone's) assistance, help, aid" } }));
    const dispose = render(() => <FlashcardReview />, container);
    clickShowAnswer(container);
    const rate = container.querySelector<HTMLButtonElement>('.rating-matrix__quality')!;
    expect(rate.disabled).toBe(false);
    rate.click();
    await flushEffects();
    expect(mockSubmitRating).toHaveBeenCalledWith('おかげさま', [
      { capability: 'sense-recognition', quality: 'missed' },
      { capability: 'surface-recognition', quality: 'missed' },
      { capability: 'future-package::novel-access', quality: 'missed' },
    ], expect.objectContaining({ origin: 'flashcard-review:unmapped', scheduler: expect.objectContaining({ cardId: 'card-1' }) }));
    dispose();
  });

  it('continues to intersect mapped cards with graph-attested capabilities', async () => {
    mockProjection = () => ({ status: 'ready', surfaceKnown: true, targets: [{
      targetRef: { kind: 'surface', id: 'mapped' }, applicableCapabilities: ['surface-recognition'], states: [],
    }] });
    const dispose = render(() => <FlashcardReview />, container);
    clickShowAnswer(container);
    container.querySelector<HTMLButtonElement>('.rating-matrix__quality')!.click();
    await flushEffects();
    expect(mockSubmitRating.mock.calls[0][1]).toEqual([{ capability: 'surface-recognition', quality: 'missed' }]);
    dispose();
  });

  it('explains a pending or failed capability query and permits retry without submitting a rating', async () => {
    const [projection, setProjection] = createSignal<KnowledgeProjection>();
    mockProjection = projection;
    const dispose = render(() => <FlashcardReview />, container);
    clickShowAnswer(container);
    expect(container.querySelector<HTMLButtonElement>('.rating-matrix__quality')!.disabled).toBe(true);
    expect(container.querySelector('[role="status"]')?.textContent).toContain('mlearn.Knowledge.Loading');
    setProjection({ status: 'error', surfaceKnown: false, targets: [{
      targetRef: { kind: 'surface', id: 'stale-target' }, applicableCapabilities: ['sense-recognition'], states: [],
    }] });
    await flushEffects();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('mlearn.Knowledge.LoadError');
    expect(container.querySelector<HTMLButtonElement>('.rating-matrix__quality')!.disabled).toBe(true);
    const retry = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'mlearn.Global.TryAgain');
    expect(retry).toBeDefined();
    retry!.click();
    expect(mockProjectionRetry).toHaveBeenCalledTimes(1);
    expect(mockSubmitRating).not.toHaveBeenCalled();
    setProjection({ status: 'ready', surfaceKnown: false, targets: [] });
    await flushEffects();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector<HTMLButtonElement>('.rating-matrix__quality')!.disabled).toBe(false);
    dispose();
  });

  it('keeps rating computations owned when click and keyboard handlers read the armed state', async () => {
    const warn = vi.spyOn(console, 'warn');
    const dispose = render(() => <FlashcardReview />, container);
    clickShowAnswer(container);
    container.querySelector<HTMLButtonElement>('.rating-matrix__quality')!.click();
    await flushEffects();
    clickShowAnswer(container);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '2' }));
    await flushEffects();
    expect(warn.mock.calls.filter(([message]) => String(message).includes('will never be disposed'))).toEqual([]);
    dispose();
  });

  it('allows pending persistence and visibly blocks a failed background batch until retry', async () => {
    const [state, setState] = createSignal<'idle' | 'pending' | 'failed'>('pending');
    mockRatingPersistenceState = state;
    const dispose = render(() => <FlashcardReview />, container);
    clickShowAnswer(container);
    expect(container.querySelector<HTMLButtonElement>('.rating-matrix__quality')!.disabled).toBe(false);
    setState('failed');
    await flushEffects();
    expect(container.querySelector<HTMLButtonElement>('.rating-matrix__quality')!.disabled).toBe(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('mlearn.Flashcards.Review.PendingRatingsSaveFailed');
    Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'mlearn.Global.TryAgain')!.click();
    expect(mockRetryRatingPersistence).toHaveBeenCalledTimes(1);
    expect(mockSubmitRating).not.toHaveBeenCalled();
    setState('pending');
    await flushEffects();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector<HTMLButtonElement>('.rating-matrix__quality')!.disabled).toBe(false);
    dispose();
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
      persistence: 'immediate',
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
    const scrollRegion = container.querySelector<HTMLElement>('.flashcard-review-content')!;
    clickShowAnswer(container);
    scrollRegion.scrollTop = 240;

    container.querySelector<HTMLButtonElement>('.rating-matrix__quality')!.click();
    await flushEffects();

    expect(scrollRegion.scrollTop).toBe(0);
    expect(container.querySelector('.flashcard-show-answer-btn')).not.toBeNull();
    dispose();
  });

  it('starts fresh timing when an acknowledged review genuinely requeues the same card', async () => {
    let now = 10_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const dispose = render(() => <FlashcardReview />, container);
    try {
      now += 500;
      clickShowAnswer(container);
      container.querySelector<HTMLButtonElement>('.rating-matrix__quality')!.click();
      await flushEffects();
      expect(mockSubmitRating.mock.calls[0][2]).toMatchObject({ timing: { wallLatencyMs: 500 } });
      now += 750;
      clickShowAnswer(container);
      container.querySelector<HTMLButtonElement>('.rating-matrix__quality')!.click();
      await flushEffects();
      expect(mockSubmitRating.mock.calls[1][2]).toMatchObject({ timing: { wallLatencyMs: 750 } });
    } finally { dispose(); }
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

  it('keeps rating rows visible but waits for the knowledge projection before accepting a rating', async () => {
    // An unmeasured/pending projection must not empty the rating rows: doing so
    // renders a revealed card with no way to record an outcome.
    setMockKnowledgeLoading(true);
    setMockKnowledgeMeasured([]);
    const dispose = render(() => <FlashcardReview />, container);
    clickShowAnswer(container);
    await flushEffects();
    const quality = () => Array.from(container.querySelectorAll<HTMLButtonElement>('.rating-matrix__quality'));
    expect(quality().length).toBeGreaterThan(0);
    expect(quality().every((button) => button.disabled)).toBe(true);
    quality()[2].click();
    expect(mockSubmitRating).not.toHaveBeenCalled();

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

  it('closing card actions with Escape preserves the expanded rating draft and pending chord', async () => {
    setMockKnowledgeMeasured(['sense-recognition', 'surface-reading']);
    const dispose = render(() => <FlashcardReview />, container);
    try {
      clickShowAnswer(container);
      container.querySelector<HTMLButtonElement>('.rating-matrix__adjust')!.click();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '2' }));
      expect(container.querySelector('.rating-matrix__cell--selected')).not.toBeNull();
      expect(container.querySelector('.rating-matrix__col--pending')).not.toBeNull();
      const actions = container.querySelector<HTMLButtonElement>('.flashcard-actions-trigger')!;
      actions.click();
      const child = document.body.querySelector<HTMLButtonElement>('.popover-panel button')!;
      child.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      expect(document.body.querySelector('.popover-panel')).toBeNull();
      expect(document.activeElement).toBe(actions);
      expect(container.querySelector('.rating-matrix__unfold')).not.toBeNull();
      expect(container.querySelector('.rating-matrix__cell--selected')).not.toBeNull();
      expect(container.querySelector('.rating-matrix__col--pending')).not.toBeNull();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      expect(container.querySelector('.rating-matrix__col--pending')).toBeNull();
      expect(container.querySelector('.rating-matrix__unfold')).not.toBeNull();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      expect(container.querySelector('.rating-matrix__unfold')).toBeNull();
      container.querySelector<HTMLButtonElement>('.rating-matrix__adjust')!.click();
      expect(container.querySelector('.rating-matrix__cell--selected')).not.toBeNull();
      await flushEffects();
      expect(mockSubmitRating).not.toHaveBeenCalled();
    } finally { dispose(); }
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

  it.each(['word', 'example'] as const)('retains pre-answer %s audio through restart without replaying it', async field => {
    setMockCard(makeCard({ content: { type: 'word', front: '犬', reading: 'いぬ', back: 'dog', example: '犬の例' } }));
    let dispose = render(() => <FlashcardReview />, container);
    const key = `mlearn-review-assistance:${encodeURIComponent(JSON.stringify(['ja', 'card-1']))}`;
    const play = container.querySelector<HTMLButtonElement>(`.flashcard-front button[title="mlearn.Flashcards.Card.${field === 'word' ? 'PlayWord' : 'PlayExample'}"]`)!;
    expect(play).not.toBeNull();
    play.click();
    await flushEffects();
    expect(mockPlayedTts).toHaveBeenCalledWith('card-1', 'ja', field);
    expect(JSON.parse(localStorage.getItem(key)!).scaffolds).toMatchObject({ audio: true });
    dispose();
    dispose = render(() => <FlashcardReview />, container);
    clickShowAnswer(container);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await flushEffects();
    expect(mockPlayedTts).toHaveBeenCalledTimes(1);
    expect(mockSubmitRating).toHaveBeenCalledWith('犬', expect.any(Array), expect.objectContaining({
      persistence: 'immediate', scaffolds: expect.objectContaining({ audio: true }),
    }));
    expect(localStorage.getItem(key)).toBeNull();
    dispose();
  });

  it('carries arbitrary package-declared supplied aspects from audio into the attempt', async () => {
    mockLanguageData = { ...mockLanguageData!, learning: { capabilities: {
      'future:contour': { testableIn: ['srs-review'], providedBy: ['example-audio'] },
    } } };
    mockLangMap = { ja: mockLanguageData };
    mockProjection = () => ({ ...defaultProjection, targets: [{ targetRef: { kind: 'surface', id: 'card-surface' },
      applicableCapabilities: [...ALL_CAPABILITIES, 'future:contour'], states: [] }] });
    setMockCard(makeCard({ content: { type: 'word', front: '犬', reading: 'いぬ', back: 'dog', example: '犬の例' } }));
    const dispose = render(() => <FlashcardReview />, container);
    container.querySelector<HTMLButtonElement>('.flashcard-front button[title="mlearn.Flashcards.Card.PlayExample"]')!.click();
    await flushEffects();
    expect(container.textContent).toContain('AssistanceRecorded');
    expect(container.textContent).not.toContain('ReferenceConsulted');
    clickShowAnswer(container);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await flushEffects();
    expect(mockSubmitRating).toHaveBeenCalledWith('犬', expect.any(Array), expect.objectContaining({
      scaffolds: { audio: true, 'provided-access:future:contour': true },
    }));
    dispose();
  });

  it('does not retroactively supply recall when audio is requested after reveal', async () => {
    const dispose = render(() => <FlashcardReview />, container);
    clickShowAnswer(container);
    container.querySelector<HTMLButtonElement>('.flashcard-back button[title="mlearn.Flashcards.Card.PlayWord"]')!.click();
    await flushEffects();
    expect(mockPlayedTts).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(`mlearn-review-assistance:${encodeURIComponent(JSON.stringify(['ja', 'card-1']))}`)).toBeNull();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await flushEffects();
    expect(mockSubmitRating.mock.calls[0][2]).not.toHaveProperty('scaffolds');
    dispose();
  });

  it('refuses pre-answer audio on storage failure and retries the original cue', async () => {
    const dispose = render(() => <FlashcardReview />, container);
    const failure = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    container.querySelector<HTMLButtonElement>('.flashcard-front button[title="mlearn.Flashcards.Card.PlayWord"]')!.click();
    await flushEffects();
    expect(mockPlayedTts).not.toHaveBeenCalled();
    expect(container.textContent).toContain('AssistanceSaveFailed');
    clickShowAnswer(container);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    expect(mockSubmitRating).not.toHaveBeenCalled();
    failure.mockRestore();
    Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'mlearn.Global.TryAgain')!.click();
    await flushEffects();
    expect(mockPlayedTts).toHaveBeenCalledWith('card-1', 'ja', 'word');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await flushEffects();
    expect(mockSubmitRating).toHaveBeenCalledWith('犬', expect.any(Array), expect.objectContaining({ scaffolds: { audio: true } }));
    dispose();
  });

  it('admits front video as durable reference assistance before making playback available', async () => {
    setMockCard(makeCard({ content: { type: 'word', front: '犬', reading: 'いぬ', back: 'dog', videoUrl: 'local-media://clip.mp4' } }));
    let dispose = render(() => <FlashcardReview />, container);
    expect(container.querySelector('.flashcard-front video')).toBeNull();
    const play = container.querySelector<HTMLButtonElement>('.flashcard-front .flashcard-media-admission')!;
    expect(play).not.toBeNull();
    play.click();
    expect(container.querySelector('.flashcard-front video')).toBeNull();
    await flushEffects();
    expect(container.querySelector('.flashcard-front video')).not.toBeNull();
    dispose();
    dispose = render(() => <FlashcardReview />, container);
    clickShowAnswer(container);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await flushEffects();
    expect(mockSubmitRating).toHaveBeenCalledWith('犬', expect.any(Array), expect.objectContaining({
      persistence: 'immediate', scaffolds: expect.objectContaining({ media: true,
        'provided-access:sense-recognition': true, 'provided-access:surface-reading': true }),
    }));
    dispose();
  });

  it('requires new video admission when an assisted rating returns to the same due card', async () => {
    setMockCard(makeCard({ content: { type: 'word', front: '犬', reading: 'いぬ', back: 'dog', videoUrl: 'local-media://clip.mp4' } }));
    const dispose = render(() => <FlashcardReview />, container);
    container.querySelector<HTMLButtonElement>('.flashcard-front .flashcard-media-admission')!.click();
    await flushEffects();
    expect(container.querySelector('.flashcard-front video')).not.toBeNull();
    clickShowAnswer(container);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await flushEffects();
    expect(mockSubmitRating).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.flashcard-front video')).toBeNull();
    expect(container.querySelector('.flashcard-front .flashcard-media-admission')).not.toBeNull();
    expect(localStorage.getItem(`mlearn-review-assistance:${encodeURIComponent(JSON.stringify(['ja', 'card-1']))}`)).toBeNull();
    dispose();
  });

  it('keeps front video unavailable when reference admission is refused', async () => {
    setMockCard(makeCard({ content: { type: 'word', front: '犬', back: 'dog', videoUrl: 'local-media://clip.mp4' } }));
    const dispose = render(() => <FlashcardReview />, container);
    const failure = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    container.querySelector<HTMLButtonElement>('.flashcard-front .flashcard-media-admission')!.click();
    await flushEffects();
    expect(container.querySelector('.flashcard-front video')).toBeNull();
    expect(container.textContent).toContain('AssistanceSaveFailed');
    failure.mockRestore();
    Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'mlearn.Global.TryAgain')!.click();
    await flushEffects();
    expect(container.querySelector('.flashcard-front video')).not.toBeNull();
    dispose();
  });

  it('reports malformed cue metadata as a retryable admission failure', async () => {
    mockLanguageData = { ...mockLanguageData!, learning: { capabilities: {
      'surface-reading': { providedBy: {} },
    } } } as unknown as LanguageData;
    mockLangMap = { ja: mockLanguageData };
    const dispose = render(() => <FlashcardReview />, container);
    container.querySelector<HTMLButtonElement>('.flashcard-front button[title="mlearn.Flashcards.Card.PlayWord"]')!.click();
    await flushEffects();
    expect(mockPlayedTts).not.toHaveBeenCalled();
    expect(container.textContent).toContain('AssistanceSaveFailed');
    expect(container.textContent).not.toContain('SavingAssistance');
    mockLanguageData = { ...mockLanguageData, learning: { capabilities: {} } };
    mockLangMap.ja = mockLanguageData;
    Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'mlearn.Global.TryAgain')!.click();
    await flushEffects();
    expect(mockPlayedTts).toHaveBeenCalledTimes(1);
    dispose();
  });

  it.each([false, true])('holds the original card and plays once for the next encounter after rating acknowledgment (restored=%s)', async restored => {
    mockSettings.flashcardAutoTts = true;
    const first = makeCard();
    const second = makeCard({ id: 'second', content: { type: 'word', front: 'other', back: 'different' } });
    mockReviewCards = { [first.id]: first, [second.id]: second };
    const [queue, setQueue] = createSignal<ReviewQueue>({ newQueue: [], scheduledQueue: [first.id] });
    mockReviewQueue = queue;
    const [presentations, setPresentations] = createSignal<Record<string, unknown>>(restored
      ? { ja: { id: 'original-undo', cardId: first.id, scaffolds: { 'provided-access:surface-reading': true } } } : {});
    mockReviewPresentations = presentations;
    let acknowledge!: () => void;
    mockSubmitRating.mockImplementationOnce(() => new Promise(resolve => {
      setMockCard(second);
      setQueue({ newQueue: [], scheduledQueue: [second.id] });
      setPresentations({});
      acknowledge = () => resolve({ attemptId: 'acknowledged', completed: true });
    }));
    const dispose = render(() => <FlashcardReview />, container);
    await flushEffects();
    expect(mockPlayedTts).toHaveBeenCalledTimes(1);
    clickShowAnswer(container);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await flushEffects();
    expect(mockPlayedTts).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.flashcard-front')!.textContent).toBe(first.content.front);
    expect(container.textContent).toContain('mlearn.Flashcards.Review.SavingRating');
    expect(mockSubmitRating).toHaveBeenCalledWith(first.content.front, expect.any(Array), expect.objectContaining({ persistence: 'immediate' }));
    acknowledge();
    await flushEffects();
    expect(container.querySelector('.flashcard-front')!.textContent).toBe(second.content.front);
    expect(mockPlayedTts.mock.calls).toEqual([['card-1', 'ja', 'word'], ['second', 'ja', 'word']]);
    const key = `mlearn-review-assistance:${encodeURIComponent(JSON.stringify(['ja', 'second']))}`;
    expect(JSON.parse(localStorage.getItem(key)!).scaffolds.audio).toBe(true);
    dispose();
  });

  it('does not play or persist a delayed audio cue for a departed card', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const lock = vi.spyOn(inProcessStudySessionLocks, 'request').mockImplementation(async (_name, callback) => {
      await gate;
      await callback();
    });
    const dispose = render(() => <FlashcardReview />, container);
    container.querySelector<HTMLButtonElement>('.flashcard-front button[title="mlearn.Flashcards.Card.PlayWord"]')!.click();
    setMockCard(makeCard({ id: 'departed', content: { type: 'word', front: 'other', back: 'different' } }));
    await flushEffects();
    release();
    await flushEffects();
    expect(mockPlayedTts).not.toHaveBeenCalled();
    expect(localStorage.getItem(`mlearn-review-assistance:${encodeURIComponent(JSON.stringify(['ja', 'card-1']))}`)).toBeNull();
    lock.mockRestore();
    dispose();
  });

  it('audio supplied before reveal still offers Reading and records the scaffold with the attempt', async () => {
    mockSettings.flashcardAutoTts = true;
    const dispose = render(() => <FlashcardReview />, container);
    await flushEffects();
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

  it.each([false, true])('keeps the card visible on a refused rating command and retries the same command (last=%s)', async last => {
    const onComplete = vi.fn();
    mockSubmitRating.mockImplementationOnce(async () => {
      if (last) { setMockCard(null); setMockQueueTotal(0); }
      throw new Error('journal unavailable');
    });
    const dispose = render(() => <FlashcardReview onComplete={onComplete} />, container);
    clickShowAnswer(container);
    container.querySelector<HTMLButtonElement>('.rating-matrix__quality')!.click();
    await flushEffects();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('mlearn.Flashcards.Review.SaveFailed');
    expect(container.querySelector('.flashcard-front')!.textContent).toBe('犬');
    expect(onComplete).not.toHaveBeenCalled();
    const retry = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'mlearn.Global.TryAgain');
    expect(retry).toBeDefined();
    retry!.click();
    await flushEffects();

    expect(mockSubmitRating).toHaveBeenCalledTimes(2);
    expect(mockSubmitRating.mock.calls[0]).toEqual(mockSubmitRating.mock.calls[1]);
    if (last) expect(onComplete).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('returns to the actual undone card and retains its assistance after remount', async () => {
    const first = makeCard();
    const next = makeCard({ id: 'next', content: { type: 'word', front: 'next', back: 'different' } });
    mockReviewCards = { [first.id]: first, [next.id]: next };
    const [queue, setQueue] = createSignal<ReviewQueue>({ newQueue: [], scheduledQueue: [next.id] });
    const [presentations, setPresentations] = createSignal<Record<string, unknown>>({});
    mockReviewQueue = queue;
    mockReviewPresentations = presentations;
    setMockCard(next);
    mockCanUndo.mockReturnValue(true);
    mockUndoLastAction.mockImplementationOnce(async () => {
      setQueue({ newQueue: [], scheduledQueue: [first.id, next.id] });
      setPresentations({ ja: { id: 'original-encounter', cardId: first.id,
        scaffolds: { audio: true, 'provided-access:future:relationship': true } } });
      return 'answer';
    });
    let dispose = render(() => <FlashcardReview />, container);
    try {
      expect(container.querySelector('.flashcard-front')!.textContent).toBe('next');
      Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'mlearn.Flashcards.Review.Undo')!.click();
      await flushEffects();
      expect(container.querySelector('.flashcard-front')!.textContent).toBe('犬');
      dispose();
      dispose = render(() => <FlashcardReview />, container);
      expect(container.querySelector('.flashcard-front')!.textContent).toBe('犬');
      expect(container.textContent).toContain('AssistanceRecorded');
      clickShowAnswer(container);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
      await flushEffects();
      expect(mockSubmitRating).toHaveBeenCalledWith('犬', expect.any(Array), expect.objectContaining({
        persistence: 'immediate', scaffolds: { audio: true, 'provided-access:future:relationship': true },
      }));
    } finally { dispose(); }
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
    mockIgnoredWords = () => new Set();
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
    mockReviewCards = { [mockCard()!.id]: mockCard()! };
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
    mockReviewCards = {};
    document.querySelectorAll('[role=dialog]').forEach((node) => node.remove());
    container.remove();
  });

  const openRemove = async (withDraft = false) => {
    const dispose = render(() => <FlashcardReview />, container);
    if (withDraft) {
      clickShowAnswer(container);
      container.querySelector<HTMLButtonElement>('.rating-matrix__adjust')!.click();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }));
      expect(container.querySelector('.rating-matrix__cell--selected')).not.toBeNull();
    }
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

  it('keeps a revealed card through pending and refused removal and retries only that card', async () => {
    setMockCard(makeCard({ content: { type: 'word', front: 'target', back: 'answer', example: 'existing authored example' } }));
    mockReviewCards = { [mockCard()!.id]: mockCard()! };
    const dispose = await openRemove();
    const first = mockCard()!;
    let finish!: (result: boolean) => void;
    mockRemoveFlashcard.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    try {
      dialogButton('Cancel')!.click();
      await flushEffects();
      clickShowAnswer(container);
      Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'mlearn.Flashcards.Review.CardActions')!.click();
      Array.from(document.body.querySelectorAll('button')).find(button => button.textContent === 'mlearn.Flashcards.Review.Remove')!.click();
      await flushEffects();
      dialogButton('Delete')!.click();
      await flushEffects();
      expect(mockRemoveFlashcard).toHaveBeenCalledTimes(1);
      expect(container.querySelector('.flashcard-back')!.classList.contains('flashcard-face--hidden')).toBe(false);
      expect(container.textContent).toContain('mlearn.Flashcards.Review.SavingRemoval');
      expect(container.querySelector('.flashcard-regenerate-btn')).toBeNull();
      container.querySelector<HTMLButtonElement>('.rating-matrix__quality')!.click();
      expect(mockSubmitRating).not.toHaveBeenCalled();
      finish(false);
      await flushEffects();
      expect(container.querySelector('.flashcard-front')!.textContent).toContain(first.content.front);
      expect(container.querySelector('.flashcard-back')!.classList.contains('flashcard-face--hidden')).toBe(false);
      expect(container.textContent).toContain('mlearn.Flashcards.Review.RemovalSaveFailed');
      const retry = container.querySelector<HTMLButtonElement>('[data-testid=review-removal-retry]');
      expect(retry).not.toBeNull();
      mockRemoveFlashcard.mockResolvedValueOnce(true);
      retry!.click();
      await flushEffects();
      expect(mockRemoveFlashcard.mock.calls.map(call => call[0])).toEqual([first.id, first.id]);
    } finally { if (finish) finish(false); mockRemoveFlashcard.mockReset().mockResolvedValue(true); dispose(); }
  });

  it('retires a removal confirmation when the active study language changes', async () => {
    const [language, setLanguage] = createSignal('ja');
    Object.defineProperty(mockSettings, 'language', { configurable: true, get: language });
    const dispose = await openRemove();
    try {
      const next = makeCard({ id: 'other-language', language: 'package-x', content: { type: 'word', front: 'other prompt', back: 'other answer' } });
      mockReviewCards[next.id] = next;
      setMockCard(next);
      setLanguage('package-x');
      await flushEffects();
      dialogButton('Delete')!.click();
      await flushEffects();
      expect(mockRemoveFlashcard).not.toHaveBeenCalled();
      expect(container.querySelector('.flashcard-front')!.textContent).toContain('other prompt');
    } finally { dispose(); }
  });

  it('preserves an expanded partial rating draft through removal confirmation and cancellation', async () => {
    const dispose = await openRemove(true);
    try {
      expect(container.querySelector('.rating-matrix__unfold')).not.toBeNull();
      expect(container.querySelector('.rating-matrix__cell--selected')).not.toBeNull();
      dialogButton('Cancel')!.click();
      await flushEffects();
      expect(container.querySelector('.rating-matrix__unfold')).not.toBeNull();
      expect(container.querySelector('.rating-matrix__cell--selected')).not.toBeNull();
      expect(container.querySelector('.flashcard-back')!.classList.contains('flashcard-face--hidden')).toBe(false);
      expect(mockRemoveFlashcard).not.toHaveBeenCalled();
      expect(mockSubmitRating).not.toHaveBeenCalled();
    } finally { dispose(); }
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
