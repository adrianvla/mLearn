import { fitLearningModel } from '../../../shared/learningModel';
import { beginReviewSession, completeReviewEncounter, type ReviewSession } from '../../../shared/reviewSession';
import { createReviewAssistanceStore } from '../../learning/reviewAssistance';
// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal, type Accessor } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { JSX } from 'solid-js';
import type { Flashcard, LanguageData, ReviewPresentation, ReviewQueue, Settings } from '../../../shared/types';
import { DEFAULT_SETTINGS } from '../../../shared/types';
import { FlashcardReview } from './FlashcardReview';
import type { LearningDecision } from '../../../shared/learningDecision';
import { eligibleReviewActivities, type ReviewActivity } from './reviewActivities';
import { flashcardReviewPolicyEntry, selectFlashcardReviewDecision } from './flashcardReviewDecision';
import { knowledgeInspection, closeKnowledgeInspector } from '../../services/openKnowledgeInspector';
import { inProcessStudySessionLocks } from '../../learning/studySessionController';
import { surfaceEntityId } from '../../../shared/graph/load';
import { getNextCard, hashWordSync } from '../../services/srsAlgorithm';
import type { KnowledgeProjection } from '../../../shared/graph/ipc';

const toastMocks = vi.hoisted(() => ({ showToast: vi.fn(() => 0) }));
const decisionBridge = vi.hoisted(() => ({ record: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../../shared/bridges', () => ({ getBridge: () => ({ knowledgeEvents: { recordLearningDecision: decisionBridge.record }, flashcards: { getFlashcardTts: async () => mockTtsAvailable ? 'flashcard-audio://test' : null } }) }));
afterEach(() => { decisionBridge.record.mockReset().mockResolvedValue(undefined); });

let mockCard: Accessor<Flashcard | null> = () => null;
let setMockCard: (card: Flashcard | null) => void = () => {};
let mockIgnoredWords: Accessor<Set<string>> = () => new Set();
let mockReviewCards: Record<string, Flashcard> = {};
let mockReviewPresentations: Accessor<Record<string, unknown>> = () => ({});
let mockReviewQueue: Accessor<ReviewQueue> = () => ({ newQueue: [], scheduledQueue: [] });
let mockLangMap: Record<string, LanguageData> = {};
let mockLanguageData: LanguageData | null = null;
let mockLanguageLoading: Accessor<boolean> = () => false;
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
const mockSaveReviewPresentation = vi.fn(async (_language: string, presentation: ReviewPresentation, _expectedId: string | null) => {
  await decisionBridge.record(presentation.decision);
});
const mockReleaseReviewPosition = vi.fn(async (_command: import('../../../shared/reviewPresentationWrite').ReviewPositionRelease) => {
  mockReviewPresentations = () => ({});
  mockReviewSessions = () => ({});
});
const mockSubmitRating = vi.fn<(...args: unknown[]) => Promise<{ attemptId: string; completed: boolean; persisted?: Promise<boolean> }>>(async () => ({ attemptId: 'attempt-1', completed: false }));
const mockAppendRetractions = vi.fn();
const mockUndoLastAction = vi.fn<() => Promise<string | null>>();
const mockCanUndo = vi.fn(() => false);
const mockRemoveFlashcard = vi.fn(async (_id: string, _neverShowAgain?: boolean) => true);
const defaultProjection: KnowledgeProjection = {
  status: 'ready', surfaceKnown: true,
  targets: [{ targetRef: { kind: 'surface', id: 'card-surface' },
    applicableCapabilities: ALL_CAPABILITIES, states: [] }],
};
let mockReviewSessions: Accessor<Record<string, ReviewSession>> = () => ({});
let mockLearningReady: Accessor<boolean> = () => true;
let mockSuspendedReviews: Record<string, Record<string, { presentation?: ReviewPresentation }>> = {};
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
    getAccessStatus: () => ({ status: 'unknown', ease: 0, source: 'None' }),
    isWordIgnoredSync: (word: string) => mockIgnoredWords().has(word),
    store: { ignoredWords: {}, get flashcards() { return mockReviewCards; }, get meta() { return { reviewPresentations: mockReviewPresentations(), reviewSessions: mockReviewSessions(), suspendedReviews: mockSuspendedReviews }; } },
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
    submitRating: async (...args: unknown[]) => {
      const result = await mockSubmitRating(...args);
      const options = args[2] as { language?: string; decision?: { id: string } };
      const cursors = mockReviewPresentations() as Record<string, ReviewPresentation>;
      if (options.language && cursors[options.language]?.decision?.id === options.decision?.id) {
        const next = { ...cursors };
        delete next[options.language];
        mockReviewPresentations = () => next;
      }
      return result;
    },
    saveReviewPresentation: mockSaveReviewPresentation,
    releaseReviewPosition: mockReleaseReviewPosition,
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
    isLoading: () => mockLanguageLoading(),
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
    playTts: vi.fn(async (id: string, _text: string, language: string, field: string, options?: { onCompleted?: () => void; onStarted?: () => void; beforePlay?: () => boolean | Promise<boolean> }) => {
      if (!mockTtsAvailable) return;
      if (options?.beforePlay && !await options.beforePlay()) return;
      mockPlayedTts(id, language, field);
      options?.onStarted?.();
      options?.onCompleted?.();
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
    KnowledgeSkeleton: actual.KnowledgeSkeleton,
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
    StudyEncounter: actual.StudyEncounter,
    StudySessionHUD: actual.StudySessionHUD,
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

function reviewOffer(card: Flashcard, activity: ReviewActivity): LearningDecision {
  const entry = flashcardReviewPolicyEntry(card, 'ja', jaLanguageData, activity);
  return { id: 'home-task-offer', at: 10, policyVersion: 'home-learning-controller@12', selected: {
    key: `review:${card.id}:${activity.id}`, action: 'review',
    targets: entry.targets.map(target => ({ kind: 'surface', id: target.entityId, capability: target.capability })),
    task: { ...entry.task!, inputModality: 'activity-handoff', responseModality: 'none' },
    presentation: { ...entry.presentation, reviewActivityId: activity.id, retrievalTask: entry.task },
  }, baseline: null, detail: {} };
}

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

function restoreSavedReviewCursor(): void {
  const [language, presentation] = mockSaveReviewPresentation.mock.calls.at(-1)!;
  const card = mockCard()!;
  mockReviewCards = { ...mockReviewCards, [card.id]: card };
  const saved = JSON.parse(JSON.stringify(presentation)) as ReviewPresentation;
  mockReviewPresentations = () => ({ [language]: saved });
}

async function clickShowAnswer(container: HTMLDivElement): Promise<void> {
  const button = container.querySelector<HTMLButtonElement>('.flashcard-show-answer-btn');
  if (!button) throw new Error('Show Answer button missing');
  button.click();
  await flushEffects();
}

describe('FlashcardReview', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    mockLearningReady = () => true;
    mockSuspendedReviews = {};
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.clearAllMocks();
    mockLanguageLoading = () => false;
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
    mockReviewSessions = () => ({});
    mockReviewPresentations = () => ({});
    mockReviewQueue = () => ({ newQueue: [], scheduledQueue: [] });
    container.remove();
  });

  it('does not turn a moving scheduler queue into a learner-facing session denominator', async () => {
    const dispose = render(() => <FlashcardReview />, container);
    try {
      await flushEffects();
      setMockQueueTotal(9);
      await flushEffects();
      expect(container.querySelector('.flashcard-review-session-hud')?.textContent).toContain('mlearn.StudyEncounter.VisitProgress');
      expect(container.querySelector('.flashcard-review-session-hud .progress-bar-container')).toBeNull();
    } finally { dispose(); }
  });

  it('ends a bounded session even when a failed item remains in the scheduler queue', async () => {
    const [sessions, setSessions] = createSignal<Record<string, ReviewSession>>({});
    mockReviewSessions = sessions;
    mockSaveReviewPresentation.mockImplementationOnce(async (_language, presentation) => {
      if (presentation.session) setSessions({ ja: presentation.session });
    });
    mockSubmitRating.mockImplementationOnce(async (...args) => {
      const options = args[2] as { reviewSessionId: string };
      expect(options.reviewSessionId).toBe(mockReviewSessions().ja.id);
      const session = completeReviewEncounter(mockReviewSessions().ja, mockCard()!.id);
      setSessions({ ja: session });
      return { attemptId: 'bounded', completed: false };
    });
    const dispose = render(() => <FlashcardReview encounterLimit={1} />, container);
    await flushEffects(); await clickShowAnswer(container);
    expect(container.querySelector('.flashcard-review-session-hud')?.textContent).toContain('mlearn.StudyEncounter.Progress');
    expect(container.querySelector('.flashcard-review-session-hud .progress-bar-container')).not.toBeNull();
    container.querySelector<HTMLButtonElement>('.rating-matrix__quality')!.click();
    await flushEffects();
    expect(container.querySelector('[data-review-phase]')?.getAttribute('data-review-phase')).toBe('complete');
    expect(mockQueueTotal()).toBe(1);
    expect(mockSubmitRating).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('keeps the admitted chunk when an inferred limit disappears during evidence refresh', async () => {
    const [sessions, setSessions] = createSignal<Record<string, ReviewSession>>({});
    const [limit, setLimit] = createSignal<number | undefined>(1);
    mockReviewSessions = sessions;
    mockSaveReviewPresentation.mockImplementationOnce(async (_language, presentation) => {
      if (presentation.session) setSessions({ ja: presentation.session });
    });
    mockSubmitRating.mockImplementationOnce(async (...args) => {
      const options = args[2] as { reviewSessionId?: string };
      expect(options.reviewSessionId).toBe(mockReviewSessions().ja.id);
      setSessions({ ja: completeReviewEncounter(mockReviewSessions().ja, mockCard()!.id) });
      return { attemptId: 'frozen-chunk', completed: false };
    });
    const dispose = render(() => <FlashcardReview encounterLimit={limit()} />, container);
    await flushEffects(); await clickShowAnswer(container);
    setLimit(undefined); await flushEffects();
    container.querySelector<HTMLButtonElement>('.rating-matrix__quality')!.click(); await flushEffects();
    expect(mockSubmitRating).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-review-phase]')?.getAttribute('data-review-phase')).toBe('complete');
    setLimit(2); await flushEffects();
    expect(container.querySelector('[data-review-phase]')?.getAttribute('data-review-phase')).toBe('complete');
    expect(mockReviewSessions().ja.encounterLimit).toBe(1);
    dispose();
  });

  it('waits for the final durable write, exposes retry, and avoids a false asset warning at finite completion', async () => {
    const [sessions, setSessions] = createSignal<Record<string, ReviewSession>>({});
    const [state, setState] = createSignal<'idle' | 'pending' | 'failed'>('idle');
    mockReviewSessions = sessions; mockRatingPersistenceState = state;
    mockSaveReviewPresentation.mockImplementationOnce(async (_language, presentation) => {
      if (presentation.session) setSessions({ ja: presentation.session });
    });
    mockSubmitRating.mockImplementationOnce(async () => {
      setSessions({ ja: completeReviewEncounter(mockReviewSessions().ja, mockCard()!.id) }); setState('failed');
      return { attemptId: 'last-queued', completed: false };
    });
    const complete = vi.fn();
    const dispose = render(() => <FlashcardReview encounterLimit={1} onComplete={complete} />, container);
    await flushEffects(); await clickShowAnswer(container);
    container.querySelector<HTMLButtonElement>('.rating-matrix__quality')!.click(); await flushEffects();
    expect(container.querySelector('[data-review-phase]')?.getAttribute('data-review-phase')).toBe('save-failed');
    expect(container.textContent).toContain('PendingRatingsSaveFailed');
    expect(container.textContent).not.toContain('NoEligibleActivity');
    expect(container.querySelector('.flashcard-completion')).toBeNull(); expect(complete).not.toHaveBeenCalled();
    Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'mlearn.Global.TryAgain')!.click();
    expect(mockRetryRatingPersistence).toHaveBeenCalledTimes(1);
    setState('pending'); await flushEffects(); expect(container.textContent).toContain('SavingRating');
    setState('idle'); await flushEffects(); expect(container.querySelector('.flashcard-completion')).not.toBeNull();
    expect(complete).toHaveBeenCalledTimes(1); expect(mockSubmitRating).toHaveBeenCalledTimes(1); dispose();
  });

  it('starts a fresh Home visit with its selected card beyond the local planning prefix', async () => {
    const cards = Array.from({ length: 40 }, (_, index) => makeCard({ id: `home-${index}`,
      content: { type: 'word', front: `selected surface ${index}`, back: 'answer' } }));
    mockReviewCards = Object.fromEntries(cards.map(card => [card.id, card]));
    mockReviewQueue = () => ({ newQueue: [], scheduledQueue: cards.map(card => card.id) });
    setMockCard(cards[0]);
    const dispose = render(() => <FlashcardReview encounterLimit={2} sessionRequestId="home-full-pool" initialCardId="home-39" />, container);
    await flushEffects();
    expect(container.querySelector('.study-encounter')?.textContent).toContain('selected surface 39');
    expect(mockSaveReviewPresentation.mock.calls[0][1].session).toMatchObject({ initialCardId: 'home-39', requestId: 'home-full-pool' });
    dispose();
  });

  it('reports loading while fresh admission waits for evidence instead of claiming no eligible activity', async () => {
    const [ready, setReady] = createSignal(false); mockLearningReady = ready;
    const dispose = render(() => <FlashcardReview />, container);
    await flushEffects();
    expect(container.querySelector('[data-review-phase]')?.getAttribute('data-review-phase')).toBe('loading');
    expect(container.textContent).not.toContain('mlearn.Flashcards.Review.NoEligibleActivity');
    setReady(true); await flushEffects();
    expect(container.querySelector('.flashcard-front')).not.toBeNull();
    dispose();
  });

  it('a new task cannot present a suspended exposed cue as fresh cold retrieval', async () => {
    const card = mockCard()!;
    mockSuspendedReviews = { ja: { old: { presentation: { id: 'exposed-choice', cardId: card.id } } } };
    const scope = JSON.stringify(['ja', card.id]);
    localStorage.setItem(createReviewAssistanceStore(localStorage, null).exposureKey(scope, 'exposed-choice'), JSON.stringify({ revision: 'exposed-before-start' }));
    const dispose = render(() => <FlashcardReview />, container);
    await flushEffects(); await clickShowAnswer(container);
    expect(container.textContent).toContain('mlearn.WordSync.ReferenceConsulted');
    container.querySelector<HTMLButtonElement>('.rating-matrix__quality')!.click();
    await flushEffects();
    expect(mockSubmitRating).toHaveBeenCalledWith(card.content.front, expect.any(Array), expect.objectContaining({
      scaffolds: expect.objectContaining({ 'prior-cue-exposure': true }),
    }));
    dispose();
  });

  it('exact Resume retains the admitted finite boundary without a new launch limit', async () => {
    const first = mockCard()!;
    mockReviewSessions = () => ({ ja: { id: 'resume-boundary', cardIds: [first.id], completedCardIds: [], encounterLimit: 1, startedAt: 1 } });
    const dispose = render(() => <FlashcardReview resumeSessionId="resume-boundary" />, container);
    await flushEffects();
    expect(mockSaveReviewPresentation.mock.calls[0][1].session).toMatchObject({ id: 'resume-boundary', encounterLimit: 1 });
    dispose();
  });

  it('preserves an admitted session when a later Home request names another card', async () => {
    const first = mockCard()!;
    const other = makeCard({ id: 'later-home', content: { type: 'word', front: 'later requested surface', back: 'answer' } });
    mockReviewCards = { [first.id]: first, [other.id]: other };
    mockReviewQueue = () => ({ newQueue: [], scheduledQueue: [first.id, other.id] });
    mockReviewSessions = () => ({ ja: { id: 'held-session', requestId: 'original-home', initialCardId: first.id,
      cardIds: [first.id], completedCardIds: [], encounterLimit: 1, startedAt: 1 } });
    const dispose = render(() => <FlashcardReview encounterLimit={2} sessionRequestId="later-home" initialCardId={other.id} />, container);
    await flushEffects();
    expect(container.querySelector('.study-encounter')?.textContent).not.toContain('later requested surface');
    expect(mockSaveReviewPresentation.mock.calls[0][1].session).toMatchObject({ id: 'held-session', requestId: 'original-home' });
    dispose();
  });

  it('presents the exact written task offered by Home despite newly available audio competitors', async () => {
    const card = mockCard()!;
    const activity = eligibleReviewActivities(card, jaLanguageData, { holistic: true, focused: false, audio: false }, false)[0];
    const handoff = reviewOffer(card, activity);
    const dispose = render(() => <FlashcardReview encounterLimit={1} sessionRequestId={handoff.id} initialCardId={card.id} handoff={handoff} />, container);
    await flushEffects();
    const saved = mockSaveReviewPresentation.mock.calls[0][1];
    expect(saved.decision!.selected.task).toEqual(handoff.selected.presentation!.retrievalTask);
    expect(saved.decision!.detail.handoffRef).toEqual({ id: handoff.id });
    expect(saved.session!.initialHandoff).toEqual(handoff);
    expect(container.querySelector('.flashcard-word')?.textContent).toContain(card.content.front);
    expect(container.textContent).not.toContain('Play recording');
    dispose();
  });

  it('presents the offered package audio task after resource discovery and preserves it across restart', async () => {
    const card = mockCard()!; mockReviewCards = { [card.id]: card };
    const data: LanguageData = { ...jaLanguageData, learning: { reviewActivities: { 'future::audio': {
      kind: 'audio-recognition', label: 'Sound task', prompt: 'Identify the package sound', targets: ['spoken-recognition'] } } } };
    mockLangMap = { ja: data }; mockLanguageData = data;
    const activity = eligibleReviewActivities(card, data, { holistic: false, focused: false, audio: true }, true)[0];
    const handoff = reviewOffer(card, activity);
    const firstDispose = render(() => <FlashcardReview encounterLimit={1} sessionRequestId={handoff.id} initialCardId={card.id} handoff={handoff} />, container);
    await flushEffects();
    const saved = mockSaveReviewPresentation.mock.calls[0][1];
    expect(saved.decision!.selected.task).toEqual(handoff.selected.presentation!.retrievalTask);
    expect(saved.decision!.detail.handoffRef).toEqual({ id: handoff.id });
    expect(container.textContent).toContain('Identify the package sound');
    expect(container.querySelector<HTMLButtonElement>('.flashcard-show-answer-btn')?.disabled).toBe(true);
    firstDispose(); mockSaveReviewPresentation.mockClear();
    mockReviewSessions = () => ({ ja: JSON.parse(JSON.stringify(saved.session)) });
    mockReviewPresentations = () => ({ ja: JSON.parse(JSON.stringify(saved)) });
    mockSettings.reviewActivities = { holistic: true, focused: false, audio: false };
    mockTtsAvailable = false;
    const dispose = render(() => <FlashcardReview encounterLimit={10} sessionRequestId="later-request" />, container);
    await flushEffects();
    expect(container.textContent).toContain('Identify the package sound');
    expect(container.querySelector<HTMLButtonElement>('.flashcard-show-answer-btn')?.disabled).toBe(true);
    expect(mockSaveReviewPresentation.mock.calls[0][1].decision?.id).toBe(saved.decision!.id);
    dispose();
  });

  it('refuses an altered Home cue without substituting a different default retrieval', async () => {
    const card = mockCard()!;
    const activity = eligibleReviewActivities(card, jaLanguageData, { holistic: true, focused: false, audio: false }, false)[0];
    const handoff = reviewOffer(card, activity); handoff.selected.presentation!.contentVersion = 'changed-content';
    const dispose = render(() => <FlashcardReview encounterLimit={1} sessionRequestId={handoff.id} initialCardId={card.id} handoff={handoff} />, container);
    await flushEffects();
    expect(mockSaveReviewPresentation).not.toHaveBeenCalled();
    expect(container.querySelector('.flashcard-show-answer-btn')).toBeNull();
    dispose();
  });

  it('starts new work only after an explicit unavailable-offer release succeeds, retaining the failed command for retry', async () => {
    const card = mockCard()!;
    const activity = eligibleReviewActivities(card, jaLanguageData, { holistic: true, focused: false, audio: false }, false)[0];
    const handoff = reviewOffer(card, activity); handoff.selected.presentation!.contentVersion = 'changed-content';
    const session: ReviewSession = { ...beginReviewSession('old-session', [card.id], 1, 20),
      requestId: handoff.id, initialCardId: card.id, initialHandoff: handoff };
    mockReviewSessions = () => ({ ja: session });
    mockReleaseReviewPosition.mockRejectedValueOnce(new Error('disk unavailable'));
    const dispose = render(() => <FlashcardReview encounterLimit={1} sessionRequestId={handoff.id} initialCardId={card.id} handoff={handoff} />, container);
    await flushEffects();
    expect(mockSaveReviewPresentation).not.toHaveBeenCalled();
    const button = () => Array.from(container.querySelectorAll('button')).find(item => item.textContent === 'mlearn.Flashcards.Review.StartNew')!;
    button().click(); await flushEffects();
    expect(container.querySelector('[role=alert]')?.textContent).toContain('StartNewFailed');
    expect(mockSaveReviewPresentation).not.toHaveBeenCalled();
    button().click(); await flushEffects(); await flushEffects();
    expect(mockReleaseReviewPosition.mock.calls).toHaveLength(2);
    expect(mockReleaseReviewPosition.mock.calls[1][0]).toEqual(mockReleaseReviewPosition.mock.calls[0][0]);
    expect(mockSaveReviewPresentation).toHaveBeenCalled();
    const saved = mockSaveReviewPresentation.mock.calls.at(-1)![1];
    expect(saved.session!.id).not.toBe(session.id);
    expect(saved.session!.initialHandoff).toBeUndefined();
    expect(saved.decision!.detail.handoffRef).toBeUndefined();
    expect(mockSubmitRating).not.toHaveBeenCalled();
    dispose();
  });

  it('requires another explicit action to release refreshed peer work after a stale release was refused', async () => {
    const card = mockCard()!;
    const activity = eligibleReviewActivities(card, jaLanguageData, { holistic: true, focused: false, audio: false }, false)[0];
    const handoff = reviewOffer(card, activity); handoff.selected.presentation!.contentVersion = 'changed-content';
    const session: ReviewSession = { ...beginReviewSession('old-session', [card.id], 1, 20),
      requestId: handoff.id, initialCardId: card.id, initialHandoff: handoff };
    mockReviewSessions = () => ({ ja: session });
    mockReleaseReviewPosition.mockImplementationOnce(async () => {
      mockReviewSessions = () => ({ ja: { ...session, id: 'peer-session' } });
      throw new Error('The review position was replaced by another window');
    });
    const dispose = render(() => <FlashcardReview encounterLimit={1} sessionRequestId={handoff.id} initialCardId={card.id} handoff={handoff} />, container);
    await flushEffects();
    const button = () => Array.from(container.querySelectorAll('button')).find(item => item.textContent === 'mlearn.Flashcards.Review.StartNew')!;
    button().click(); await flushEffects();
    expect(mockReleaseReviewPosition.mock.calls.at(-1)![0].expectedSession!.id).toBe('old-session');
    expect(mockSaveReviewPresentation).not.toHaveBeenCalled();
    button().click(); await flushEffects(); await flushEffects();
    expect(mockReleaseReviewPosition.mock.calls.at(-1)![0].expectedSession!.id).toBe('peer-session');
    expect(mockSaveReviewPresentation).toHaveBeenCalled();
    expect(mockSubmitRating).not.toHaveBeenCalled();
    dispose();
  });

  it('does not let an old-language pending release block or reset successor work', async () => {
    const card = mockCard()!;
    const activity = eligibleReviewActivities(card, jaLanguageData, { holistic: true, focused: false, audio: false }, false)[0];
    const handoff = reviewOffer(card, activity); handoff.selected.presentation!.contentVersion = 'changed-content';
    const [settings, updateSettings] = createStore(mockSettings); mockSettings = settings;
    let finish!: () => void;
    mockReleaseReviewPosition.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const dispose = render(() => <FlashcardReview encounterLimit={1} sessionRequestId={handoff.id} initialCardId={card.id} handoff={handoff} />, container);
    await flushEffects();
    const button = () => Array.from(container.querySelectorAll('button')).find(item => item.textContent === 'mlearn.Flashcards.Review.StartNew')!;
    button().click(); await flushEffects(); expect(button().disabled).toBe(true);
    const next = { ...card, id: 'future-card', language: 'future-package' };
    mockReviewCards = { [next.id]: next }; mockReviewQueue = () => ({ newQueue: [], scheduledQueue: [next.id] });
    mockLangMap = { ...mockLangMap, 'future-package': jaLanguageData };
    updateSettings('language', 'future-package'); setMockCard(next); await flushEffects();
    expect(button().disabled).toBe(false);
    finish(); await flushEffects();
    expect(mockSaveReviewPresentation).not.toHaveBeenCalled();
    expect(button().disabled).toBe(false);
    dispose();
  });

  it('does not substitute another queued card when the offered card was withdrawn', async () => {
    const card = mockCard()!;
    const withdrawn = makeCard({ id: 'withdrawn', suspended: true });
    const activity = eligibleReviewActivities(withdrawn, jaLanguageData, { holistic: true, focused: false, audio: false }, false)[0];
    const handoff = reviewOffer(withdrawn, activity);
    mockReviewCards = { [card.id]: card, [withdrawn.id]: withdrawn };
    mockReviewQueue = () => ({ newQueue: [], scheduledQueue: [card.id, withdrawn.id] });
    const dispose = render(() => <FlashcardReview encounterLimit={1} sessionRequestId={handoff.id} initialCardId={withdrawn.id} handoff={handoff} />, container);
    await flushEffects(); expect(mockSaveReviewPresentation).not.toHaveBeenCalled();
    expect(container.querySelector('.flashcard-show-answer-btn')).toBeNull(); dispose();
  });

  it('does not retag a local admitted chunk while its first durable cursor write is pending', async () => {
    const first = mockCard()!;
    const second = makeCard({ id: 'later-offer', content: { type: 'word', front: 'later offered surface', back: 'answer' } });
    mockReviewCards = { [first.id]: first, [second.id]: second };
    mockReviewQueue = () => ({ newQueue: [], scheduledQueue: [first.id, second.id] });
    const firstActivity = eligibleReviewActivities(first, jaLanguageData, { holistic: true, focused: false, audio: false }, false)[0];
    const secondActivity = eligibleReviewActivities(second, jaLanguageData, { holistic: true, focused: false, audio: false }, false)[0];
    const firstOffer = reviewOffer(first, firstActivity);
    const secondOffer = { ...reviewOffer(second, secondActivity), id: 'later-home-offer' };
    const [offer, setOffer] = createSignal(firstOffer);
    let acknowledge!: () => void;
    mockSaveReviewPresentation.mockImplementationOnce(() => new Promise<void>(resolve => { acknowledge = resolve; }));
    const dispose = render(() => <FlashcardReview encounterLimit={1} sessionRequestId={offer().id}
      initialCardId={offer().selected.presentation!.cardId as string} handoff={offer()} />, container);
    await flushEffects(); const original = mockSaveReviewPresentation.mock.calls[0][1];
    setOffer(secondOffer); await flushEffects();
    expect(container.querySelector('.flashcard-word')?.textContent).toContain(first.content.front);
    expect(container.textContent).not.toContain(second.content.front);
    expect(original.session?.requestId).toBe(firstOffer.id);
    expect(mockSaveReviewPresentation).toHaveBeenCalledOnce();
    acknowledge(); await flushEffects(); dispose();
  });

  it('restores the finished result when a window repeats its original Home request', async () => {
    mockReviewSessions = () => ({ ja: { id: 'done', requestId: 'home-intent', cardIds: [mockCard()!.id], completedCardIds: [mockCard()!.id], encounterLimit: 1, startedAt: 1 } });
    const dispose = render(() => <FlashcardReview encounterLimit={10} sessionRequestId="home-intent" />, container);
    await flushEffects(); expect(container.querySelector('.flashcard-completion')).not.toBeNull();
    expect(container.querySelector('.flashcard-show-answer-btn')).toBeNull();
    expect(mockSaveReviewPresentation).not.toHaveBeenCalled(); dispose();
  });

  it('uses the shared encounter card and preserves the four scheduler grades', async () => {
    const dispose = render(() => <FlashcardReview />, container);
    await flushEffects();
    expect(container.querySelector('.study-encounter')).not.toBeNull();
    await clickShowAnswer(container);
    expect(container.querySelectorAll('.rating-matrix__quality')).toHaveLength(4);
    dispose();
  });

  it('anchors Review activities outside the card flow', async () => {
    const dispose = render(() => <FlashcardReview />, container);
    await flushEffects();
    Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.includes('Review.Activities'))!.click();
    expect(container.querySelector('.review-activity-preferences [role="dialog"]')).toBeNull();
    expect(document.body.querySelector('[role="dialog"][aria-label="mlearn.Flashcards.Review.Activities"]')).not.toBeNull();
    dispose();
  });

  it('keeps the revealed encounter when preferences change until rating advances it', async () => {
    const dispose = render(() => <FlashcardReview />, container);
    await flushEffects(); await clickShowAnswer(container);
    const id = container.querySelector('[data-encounter-id]')?.getAttribute('data-encounter-id');
    mockSettings.reviewActivities = { holistic: false, focused: false, audio: false };
    setMockQueueTotal(2);
    setMockCard({ ...mockCard()! });
    await flushEffects();
    expect(container.querySelector('[data-encounter-id]')?.getAttribute('data-encounter-id')).toBe(id);
    expect(container.querySelector('.rating-matrix')).not.toBeNull();
    dispose();
  });

  it('keeps earlier answers hidden, durably resumes the next cue, and rates a staged encounter once', async () => {
    mockLanguageData = { ...jaLanguageData, learning: { reviewActivities: {
      'future:staged': { kind: 'written-reading-recall', label: 'Combined', prompt: 'Combined',
        targets: ['surface-reading', 'prosodic-pattern'], stages: [
          { id: 'first', kind: 'holistic', label: 'Reading', prompt: 'Recall reading first', targets: ['surface-reading'], suppliedAccesses: [] },
          { id: 'second', kind: 'written-reading-recall', label: 'Pattern', prompt: 'Recall pattern second', targets: ['prosodic-pattern'], suppliedAccesses: ['surface-reading'] },
        ] },
    } } };
    mockLangMap = { ja: mockLanguageData };
    mockSettings.reviewActivities = { holistic: false, focused: true, audio: false };
    setMockCard(makeCard({ content: { type: 'word', front: '犬', reading: 'いぬ', back: 'SECRET meaning', prosody: { type: 'japanese-pitch-accent', position: 2 } } }));
    let dispose = render(() => <FlashcardReview />, container);
    await flushEffects(); restoreSavedReviewCursor();
    expect(container.textContent).toContain('Recall reading first');
    expect(container.textContent).not.toContain('いぬ');
    expect(container.textContent).not.toContain('SECRET meaning');
    await clickShowAnswer(container); restoreSavedReviewCursor();
    expect(mockSaveReviewPresentation.mock.calls.at(-1)![1].stageIndex).toBe(1);
    expect(container.textContent).toContain('Recall pattern second');
    expect(container.textContent).toContain('いぬ');
    expect(container.textContent).not.toContain('SECRET meaning');
    expect(container.querySelector('.rating-matrix')).toBeNull();
    dispose(); container.replaceChildren();
    dispose = render(() => <FlashcardReview />, container);
    await flushEffects();
    expect(container.textContent).toContain('Recall pattern second');
    await clickShowAnswer(container);
    expect(container.textContent).toContain('SECRET meaning');
    container.querySelectorAll<HTMLButtonElement>('.rating-matrix__quality')[2]!.click();
    await flushEffects();
    expect(mockSubmitRating).toHaveBeenCalledTimes(1);
    expect((mockSubmitRating.mock.calls[0][1] as Array<{ capability: string }>).map(o => o.capability)).toEqual(['surface-reading', 'prosodic-pattern']);
    expect((mockSubmitRating.mock.calls[0][2] as { decision: { selected: { task: { stages: unknown[] } } } }).decision.selected.task.stages).toHaveLength(2);
    dispose();
  });

  it('renders a focused prompt without leaking meaning or the answer and submits only its target', async () => {
    mockLanguageData = { ...jaLanguageData, learning: { reviewActivities: {
      'future:recall': { kind: 'written-reading-recall', label: 'Pattern recall', prompt: 'Recall the pattern', targets: ['prosodic-pattern'] },
    } } };
    mockLangMap = { ja: mockLanguageData };
    mockSettings.reviewActivities = { holistic: false, focused: true, audio: false };
    setMockCard(makeCard({ content: { type: 'word', front: '犬', reading: 'いぬ', back: 'SECRET meaning', prosody: { type: 'japanese-pitch-accent', position: 2 } } }));
    const dispose = render(() => <FlashcardReview />, container);
    await flushEffects();
    expect(container.textContent).toContain('Recall the pattern');
    expect(container.textContent).toContain('いぬ');
    expect(container.textContent).not.toContain('SECRET meaning');
    expect(container.querySelector('.review-activity-answer')).toBeNull();
    await clickShowAnswer(container);
    expect(container.querySelector('.review-activity-answer')).not.toBeNull();
    const allFluent = container.querySelectorAll<HTMLButtonElement>('.rating-matrix__quality')[2];
    allFluent!.click();
    await flushEffects();
    expect((mockSubmitRating.mock.calls[0][1] as Array<{ capability: string }>).map(o => o.capability)).toEqual(['prosodic-pattern']);
    expect((mockSubmitRating.mock.calls[0][2] as { scaffolds: Record<string, boolean> }).scaffolds.reading).toBe(true);
    dispose();
  });

  it('requires successful audio playback before reveal and omits the written answer from the question', async () => {
    mockLanguageData = { ...jaLanguageData, learning: { reviewActivities: {
      'future:listen': { kind: 'audio-recognition', label: 'Listen', prompt: 'Identify the spoken word', targets: ['spoken-recognition'] },
    } } };
    mockLangMap = { ja: mockLanguageData };
    mockSettings.reviewActivities = { holistic: false, focused: false, audio: true };
    setMockKnowledgeMeasured(['spoken-recognition']);
    mockProjection = () => ({ ...defaultProjection, targets: [{ targetRef: { kind: 'surface', id: 'card-surface' }, applicableCapabilities: ['spoken-recognition'], states: [] }] });
    const dispose = render(() => <FlashcardReview />, container);
    await flushEffects();
    expect(container.textContent).not.toContain('犬');
    expect(container.querySelector<HTMLButtonElement>('.flashcard-show-answer-btn')?.disabled).toBe(true);
    container.querySelector<HTMLButtonElement>('.review-activity-play')!.click();
    await flushEffects();
    expect(container.querySelector<HTMLButtonElement>('.flashcard-show-answer-btn')?.disabled).toBe(false);
    await clickShowAnswer(container);
    expect(container.textContent).toContain('犬');
    const allFluent = container.querySelectorAll<HTMLButtonElement>('.rating-matrix__quality')[2];
    allFluent!.click();
    await flushEffects();
    expect((mockSubmitRating.mock.calls[0][1] as Array<{ capability: string }>).map(o => o.capability)).toEqual(['spoken-recognition']);
    dispose();
  });

  it('restores a revealed audio task as supplied evidence rather than a new cold recognition', async () => {
    mockLanguageData = { ...jaLanguageData, learning: { reviewActivities: {
      'future:listen': { kind: 'audio-recognition', label: 'Listen', prompt: 'Identify the spoken word', targets: ['spoken-recognition'] },
    } } };
    mockLangMap = { ja: mockLanguageData };
    mockSettings.reviewActivities = { holistic: false, focused: false, audio: true };
    setMockKnowledgeMeasured(['spoken-recognition']);
    mockProjection = () => ({ ...defaultProjection, targets: [{ targetRef: { kind: 'surface', id: 'card-surface' }, applicableCapabilities: ['spoken-recognition'], states: [] }] });
    const first = render(() => <FlashcardReview />, container);
    await flushEffects();
    container.querySelector<HTMLButtonElement>('.review-activity-play')!.click();
    await flushEffects();
    await clickShowAnswer(container);
    const decisionId = mockSaveReviewPresentation.mock.calls.at(-1)![1].decision!.id;
    restoreSavedReviewCursor();
    first(); container.replaceChildren();
    const second = render(() => <FlashcardReview />, container);
    await flushEffects();
    expect(mockSaveReviewPresentation.mock.calls.at(-1)![1].decision!.id).toBe(decisionId);
    expect(container.querySelector('.review-activity-answer')).not.toBeNull();
    container.querySelectorAll<HTMLButtonElement>('.rating-matrix__quality')[2].click();
    await flushEffects();
    expect((mockSubmitRating.mock.calls.at(-1)![2] as { scaffolds: Record<string, boolean> }).scaffolds['provided-access:spoken-recognition']).toBe(true);
    second();
  });

  it.each([true, false])('keeps the saved audio task when whole-word preference returns and recording availability is %s', async available => {
    mockLanguageData = { ...jaLanguageData, learning: { reviewActivities: {
      'future:listen': { kind: 'audio-recognition', label: 'Listen', prompt: 'Identify the spoken word', targets: ['spoken-recognition'] },
    } } };
    mockLangMap = { ja: mockLanguageData };
    mockSettings.reviewActivities = { holistic: false, focused: false, audio: true };
    setMockKnowledgeMeasured(['spoken-recognition']);
    const first = render(() => <FlashcardReview />, container);
    await flushEffects();
    const saved = mockSaveReviewPresentation.mock.calls.at(-1)![1];
    const decisionId = saved.decision!.id;
    expect(saved.decision!.selected.task.taskTemplateId).toBe('future:listen');
    restoreSavedReviewCursor();
    first(); container.replaceChildren();
    mockSettings.reviewActivities = { holistic: true, focused: false, audio: true };
    mockTtsAvailable = available;
    const second = render(() => <FlashcardReview />, container);
    await flushEffects();
    expect(container.querySelector('.review-activity-play')).not.toBeNull();
    expect(container.textContent).not.toContain('犬');
    expect(container.querySelector<HTMLButtonElement>('.flashcard-show-answer-btn')?.disabled).toBe(true);
    expect(mockSaveReviewPresentation.mock.calls.at(-1)![1].decision!.id).toBe(decisionId);
    expect(mockSubmitRating).not.toHaveBeenCalled();
    second();
  });

  it('retries the same focused command identity and targets after a refused submission', async () => {
    mockLanguageData = { ...jaLanguageData, learning: { reviewActivities: {
      'future:recall': { kind: 'written-reading-recall', label: 'Pattern', prompt: 'Recall pattern', targets: ['prosodic-pattern'] },
    } } };
    mockLangMap = { ja: mockLanguageData };
    mockSettings.reviewActivities = { holistic: false, focused: true, audio: false };
    setMockCard(makeCard({ content: { type: 'word', front: '犬', reading: 'いぬ', back: 'dog', prosody: { type: 'japanese-pitch-accent', position: 2 } } }));
    mockSubmitRating.mockRejectedValueOnce(new Error('refused'));
    const dispose = render(() => <FlashcardReview />, container);
    await flushEffects(); await clickShowAnswer(container);
    container.querySelectorAll<HTMLButtonElement>('.rating-matrix__quality')[2].click();
    await flushEffects();
    const original = mockSubmitRating.mock.calls[0];
    Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.includes('TryAgain'))!.click();
    await flushEffects();
    expect(mockSubmitRating.mock.calls[1]).toEqual(original);
    dispose();
  });

  it('cannot turn a revealed answer into cold evidence by changing activity', async () => {
    mockLanguageData = { ...jaLanguageData, learning: { reviewActivities: {
      'future:recall': { kind: 'written-reading-recall', label: 'Pattern', prompt: 'Recall pattern', targets: ['prosodic-pattern'] },
      'future:listen': { kind: 'audio-recognition', label: 'Listen', prompt: 'Identify the spoken word', targets: ['spoken-recognition'] },
    } } };
    mockLangMap = { ja: mockLanguageData };
    mockSettings.reviewActivities = { holistic: false, focused: true, audio: false };
    setMockCard(makeCard({ content: { type: 'word', front: '犬', reading: 'いぬ', back: 'dog', prosody: { type: 'japanese-pitch-accent', position: 2 } } }));
    const first = render(() => <FlashcardReview />, container);
    await flushEffects(); await clickShowAnswer(container); restoreSavedReviewCursor();
    first(); container.replaceChildren();
    mockSettings.reviewActivities = { holistic: false, focused: false, audio: true };
    const second = render(() => <FlashcardReview />, container);
    await flushEffects();
    expect(mockSaveReviewPresentation.mock.calls.at(-1)![1].decision!.selected.task.taskTemplateId).toBe('future:recall');
    expect(container.querySelector('.review-activity-play')).toBeNull();
    expect(container.querySelector('.review-activity-answer')).not.toBeNull();
    container.querySelectorAll<HTMLButtonElement>('.rating-matrix__quality')[2].click();
    await flushEffects();
    expect((mockSubmitRating.mock.calls.at(-1)![2] as { scaffolds: Record<string, boolean> }).scaffolds['provided-access:prosodic-pattern']).toBe(true);
    second();
  });

  it('records an audio target as supplied when reference content reveals the lexical answer', async () => {
    mockLanguageData = { ...jaLanguageData, learning: { reviewActivities: {
      'future:listen': { kind: 'audio-recognition', label: 'Listen', prompt: 'Identify the spoken word', targets: ['spoken-recognition'] },
    } } };
    mockLangMap = { ja: mockLanguageData };
    mockSettings.reviewActivities = { holistic: false, focused: false, audio: true };
    setMockKnowledgeMeasured(['spoken-recognition']);
    mockProjection = () => ({ ...defaultProjection, targets: [{ targetRef: { kind: 'surface', id: 'card-surface' }, applicableCapabilities: ['spoken-recognition'], states: [] }] });
    const dispose = render(() => <FlashcardReview />, container);
    await flushEffects();
    Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'mlearn.Flashcards.Review.CardActions')!.click();
    Array.from(document.body.querySelectorAll('button')).find(button => button.textContent === 'mlearn.Knowledge.Popup.Inspect')!.click();
    await flushEffects(); closeKnowledgeInspector();
    container.querySelector<HTMLButtonElement>('.review-activity-play')!.click();
    await flushEffects(); await clickShowAnswer(container);
    container.querySelectorAll<HTMLButtonElement>('.rating-matrix__quality')[2].click();
    await flushEffects();
    expect((mockSubmitRating.mock.calls.at(-1)![2] as { scaffolds: Record<string, boolean> }).scaffolds['provided-access:spoken-recognition']).toBe(true);
    dispose();
  });

  it('retains the audio task and supplied cue when future preferences switch to written recall', async () => {
    mockLanguageData = { ...jaLanguageData, learning: { reviewActivities: {
      'future:recall': { kind: 'written-reading-recall', label: 'Pattern', prompt: 'Recall pattern', targets: ['prosodic-pattern'] },
      'future:listen': { kind: 'audio-recognition', label: 'Listen', prompt: 'Identify the spoken word', targets: ['spoken-recognition'] },
    } } };
    mockLangMap = { ja: mockLanguageData };
    mockSettings.reviewActivities = { holistic: false, focused: false, audio: true };
    setMockKnowledgeMeasured([...ALL_CAPABILITIES, 'spoken-recognition']);
    setMockCard(makeCard({ content: { type: 'word', front: '犬', reading: 'いぬ', back: 'dog', prosody: { type: 'japanese-pitch-accent', position: 2 } } }));
    const first = render(() => <FlashcardReview />, container);
    await flushEffects();
    container.querySelector<HTMLButtonElement>('.review-activity-play')!.click();
    await flushEffects(); restoreSavedReviewCursor(); first(); container.replaceChildren();
    mockSettings.reviewActivities = { holistic: false, focused: true, audio: false };
    const second = render(() => <FlashcardReview />, container);
    await flushEffects();
    expect(mockSaveReviewPresentation.mock.calls.at(-1)![1].decision!.selected.task.taskTemplateId).toBe('future:listen');
    expect(container.querySelector<HTMLButtonElement>('.flashcard-show-answer-btn')?.disabled).toBe(true);
    container.querySelector<HTMLButtonElement>('.review-activity-play')!.click();
    await flushEffects(); await clickShowAnswer(container);
    container.querySelectorAll<HTMLButtonElement>('.rating-matrix__quality')[2].click();
    await flushEffects();
    expect((mockSubmitRating.mock.calls.at(-1)![1] as Array<{ capability: string }>).map(row => row.capability)).toEqual(['spoken-recognition']);
    expect((mockSubmitRating.mock.calls.at(-1)![2] as { scaffolds: Record<string, boolean> }).scaffolds.audio).toBe(true);
    second();
  });

  it('retains one encounter when its background cursor acknowledgment reaches the store', async () => {
    mockReviewCards = { 'card-1': mockCard()! };
    const [presentations, setPresentations] = createSignal<Record<string, unknown>>({});
    mockReviewPresentations = presentations;
    const dispose = render(() => <FlashcardReview />, container);
    await flushEffects();
    await clickShowAnswer(container);
    const saved = mockSaveReviewPresentation.mock.calls[0][1];
    const calls = mockSaveReviewPresentation.mock.calls.length;
    setPresentations({ ja: saved });
    await flushEffects();
    expect(mockSaveReviewPresentation).toHaveBeenCalledTimes(calls);
    expect(container.querySelector('.rating-matrix')).not.toBeNull();
    dispose();
  });

  it('keeps an already presented rating profile stable across knowledge refreshes', async () => {
    setMockKnowledgeMeasured(['sense-recognition', 'surface-reading']);
    const dispose = render(() => <FlashcardReview />, container);
    await flushEffects();
    await clickShowAnswer(container);
    container.querySelector<HTMLButtonElement>('.rating-matrix__adjust')!.click();
    const before = container.querySelector('.rating-matrix')!.textContent;
    setMockKnowledgeLoading(true);
    setMockKnowledgeMeasured([]);
    await flushEffects();
    expect(container.querySelector('.rating-matrix')!.textContent).toBe(before);
    expect(container.textContent).not.toContain('mlearn.Knowledge.Loading');
    setMockKnowledgeLoading(false);
    setMockKnowledgeMeasured(['sense-recognition']);
    await flushEffects();
    expect(container.querySelector('.rating-matrix')!.textContent).toBe(before);
    dispose();
  });

  it('reopens the original saved choice without a new random draw and rates against its original provenance', async () => {
    const card = mockCard()!;
    mockReviewCards = { [card.id]: card };
    const original = selectFlashcardReviewDecision({ id: 'reopen-choice', at: 20,
      entries: [flashcardReviewPolicyEntry(card, 'ja', jaLanguageData)], rng: () => 0.7 })!.provenance;
    mockReviewPresentations = () => ({ ja: { id: original.id, cardId: card.id, decision: original } });
    const random = vi.spyOn(Math, 'random');
    const dispose = render(() => <FlashcardReview />, container);
    try {
      await flushEffects();
      expect(decisionBridge.record.mock.calls[0][0]).toEqual(original);
      expect(random).not.toHaveBeenCalled();
      await clickShowAnswer(container);
      container.querySelector<HTMLButtonElement>('.rating-matrix__quality')!.click();
      await flushEffects();
      expect(mockSubmitRating.mock.calls.at(-1)?.[2]).toMatchObject({ decision: original });
    } finally { random.mockRestore(); dispose(); }
  });

  it('waits for package metadata before deciding whether a saved opaque task can resume', async () => {
    const card = mockCard()!;
    const packageData: LanguageData = { ...jaLanguageData, learning: { capabilities: {
      'future::unknown-task': { testableIn: ['srs-review'] },
    } } };
    const original = selectFlashcardReviewDecision({ id: 'metadata-resume-choice', at: 20,
      entries: [flashcardReviewPolicyEntry(card, 'ja', packageData)] })!.provenance;
    mockReviewCards = { [card.id]: card };
    mockReviewPresentations = () => ({ ja: { id: original.id, cardId: card.id, decision: original } });
    const [loading, setLoading] = createSignal(true);
    mockLanguageLoading = loading;
    mockLangMap = {};
    mockLanguageData = null;
    const dispose = render(() => <FlashcardReview />, container);
    try {
      await flushEffects();
      expect(decisionBridge.record).not.toHaveBeenCalled();
      expect(container.querySelector('.flashcard-front')).toBeNull();
      expect(container.textContent).not.toContain('mlearn.Flashcards.Review.CompleteDescription');
      mockLangMap = { ja: packageData };
      mockLanguageData = packageData;
      setLoading(false);
      await flushEffects();
      expect(decisionBridge.record).toHaveBeenCalledTimes(1);
      expect(decisionBridge.record.mock.calls[0][0]).toEqual(original);
      expect(container.querySelector('.flashcard-front')).not.toBeNull();
    } finally { dispose(); }
  });

  it('reopens a revealed answer as supplied rather than a second independent recall', async () => {
    const card = mockCard()!;
    mockReviewCards = { [card.id]: card };
    const original = selectFlashcardReviewDecision({ id: 'exposed-choice', at: 20, entries: [flashcardReviewPolicyEntry(card, 'ja', jaLanguageData)] })!.provenance;
    mockReviewPresentations = () => ({ ja: { id: original.id, cardId: card.id, decision: original } });
    const scope = JSON.stringify(['ja', card.id]);
    localStorage.setItem(`mlearn-review-assistance:${encodeURIComponent(scope)}`,
      JSON.stringify({ revision: 'exposed-before-closing', scaffolds: {}, choices: { [original.id]: { scaffolds: {}, revealed: true } } }));
    const dispose = render(() => <FlashcardReview />, container);
    try {
      await flushEffects();
      expect(container.querySelector('.flashcard-show-answer-btn')).toBeNull();
      expect(container.querySelector('.rating-matrix')).not.toBeNull();
      expect(container.querySelector('[data-review-phase]')?.getAttribute('data-review-phase')).toBe('revealed');
      container.querySelector<HTMLButtonElement>('.rating-matrix__quality')!.click();
      await flushEffects();
      expect(mockSubmitRating.mock.calls.at(-1)?.[2]).toMatchObject({ scaffolds: {
        'provided-access:sense-recognition': true, 'provided-access:surface-recognition': true,
        'provided-access:surface-reading': true,
      } });
    } finally { dispose(); }
  });

  it('does not inherit a revealed answer from a replaced choice on the same card', async () => {
    const scope = JSON.stringify(['ja', mockCard()!.id]);
    localStorage.setItem(`mlearn-review-assistance:${encodeURIComponent(scope)}`,
      JSON.stringify({ revision: 'old-exposure', scaffolds: {}, choices: { 'replaced-choice': { scaffolds: {}, revealed: true } } }));
    const dispose = render(() => <FlashcardReview />, container);
    try {
      await flushEffects();
      expect(container.querySelector('.rating-matrix')).toBeNull();
      expect(container.querySelector('.flashcard-show-answer-btn')).not.toBeNull();
    } finally { dispose(); }
  });

  it('keeps the answer hidden when its exposure cannot be saved and retries that reveal', async () => {
    const dispose = render(() => <FlashcardReview />, container);
    let fail = true;
    const setItem = localStorage.setItem.bind(localStorage);
    const write = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (fail && key.startsWith('mlearn-review-assistance:')) throw new Error('quota');
      setItem(key, value);
    });
    try {
      await flushEffects();
      await clickShowAnswer(container);
      expect(container.querySelector('.rating-matrix')).toBeNull();
      expect(container.querySelector('.flashcard-show-answer-btn')).not.toBeNull();
      expect(container.textContent).toContain('mlearn.WordSync.AssistanceSaveFailed');
      fail = false;
      Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
        .find(button => button.textContent === 'mlearn.Global.TryAgain')!.click();
      await flushEffects();
      expect(container.querySelector('.rating-matrix')).not.toBeNull();
    } finally { write.mockRestore(); dispose(); }
  });

  it('presents and rates the same choice while its background cursor is being written', async () => {
    let acknowledge!: () => void;
    decisionBridge.record.mockImplementationOnce(() => new Promise<void>(resolve => { acknowledge = resolve; }));
    const dispose = render(() => <FlashcardReview />, container);
    try {
      await flushEffects();
      // The durable cursor exists for crash resume, not as permission to show:
      // a pending acknowledgement must not stand between the learner and the
      // card it already selected.
      expect(container.querySelector('.flashcard-front')).not.toBeNull();
      expect(container.textContent).not.toContain('mlearn.Flashcards.Review.QuestionSaveFailed');
      const recorded = decisionBridge.record.mock.calls[0][0];
      acknowledge();
      await flushEffects();
      await clickShowAnswer(container);
      container.querySelector<HTMLButtonElement>('.rating-matrix__quality')!.click();
      await flushEffects();
      // The question still rates against the exact provenance it was recorded
      // with, whether or not its cursor had landed by then.
      expect(mockSubmitRating.mock.calls.at(-1)?.[2]).toMatchObject({ decision: recorded });
    } finally { dispose(); }
  });

  it('keeps the question visible and blocks rating honestly when its background cursor fails', async () => {
    decisionBridge.record.mockRejectedValueOnce(new Error('storage unavailable'));
    const dispose = render(() => <FlashcardReview />, container);
    try {
      await flushEffects();
      // A persistence failure is actionable without removing the question.
      expect(container.querySelector('.flashcard-front')).not.toBeNull();
      expect(container.textContent).toContain('mlearn.Flashcards.Review.QuestionSaveFailed');
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
      expect(mockSubmitRating).not.toHaveBeenCalled();
      expect(mockPlayedTts).not.toHaveBeenCalled();
    } finally { dispose(); }
  });

  it('keeps a refused choice visible and retries the same pinned choice', async () => {
    decisionBridge.record.mockRejectedValueOnce(new Error('storage unavailable'));
    const dispose = render(() => <FlashcardReview />, container);
    try {
      await flushEffects();
      expect(container.querySelector('.flashcard-front')).not.toBeNull();
      expect(container.textContent).toContain('mlearn.Flashcards.Review.QuestionSaveFailed');
      const recorded = decisionBridge.record.mock.calls[0][0];
      const retry = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
        .find(button => button.textContent === 'mlearn.Global.TryAgain');
      expect(retry).toBeDefined();
      retry!.click();
      await flushEffects();
      expect(decisionBridge.record.mock.calls[1][0]).toEqual(recorded);
      expect(container.querySelector('.flashcard-front')).not.toBeNull();
      expect(mockSubmitRating).not.toHaveBeenCalled();
    } finally { dispose(); }
  });

  it('retries the same question against an absent authority after its predecessor was cleared', async () => {
    mockReviewPresentations = () => ({ ja: { id: 'withdrawn-cursor', cardId: 'withdrawn-card' } });
    mockSaveReviewPresentation.mockImplementationOnce(async () => {
      mockReviewPresentations = () => ({});
      throw new Error('The review position was replaced by another window');
    });
    const dispose = render(() => <FlashcardReview />, container);
    try {
      await flushEffects();
      const first = mockSaveReviewPresentation.mock.calls[0];
      expect(first[2]).toBe('withdrawn-cursor');
      expect(container.textContent).toContain('mlearn.Flashcards.Review.QuestionSaveFailed');
      const retry = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
        .find(button => button.textContent === 'mlearn.Global.TryAgain')!;
      retry.click(); await flushEffects();
      const next = mockSaveReviewPresentation.mock.calls.at(-1)!;
      expect(next[2]).toBeNull();
      expect(next[1]).toEqual(first[1]);
      expect(mockSubmitRating).not.toHaveBeenCalled();
    } finally { dispose(); }
  });

  it('keeps a peer cursor update out of the displayed question and explicitly adopts it on recovery', async () => {
    const first = mockCard()!;
    const second = makeCard({ id: 'peer-card', content: { type: 'word', front: 'peer question', back: 'answer' } });
    mockReviewCards = { [first.id]: first, [second.id]: second };
    const [reviewQueue, setReviewQueue] = createSignal<ReviewQueue>({ newQueue: [], scheduledQueue: [first.id] });
    mockReviewQueue = reviewQueue;
    const [presentations, setPresentations] = createSignal<Record<string, unknown>>({});
    mockReviewPresentations = presentations;
    decisionBridge.record.mockRejectedValueOnce(new Error('peer owns the cursor'));
    const dispose = render(() => <FlashcardReview />, container);
    try {
      await flushEffects();
      const peer = selectFlashcardReviewDecision({ id: 'peer-physical-choice', at: 20,
        entries: [flashcardReviewPolicyEntry(second, 'ja', jaLanguageData)] })!.provenance;
      setReviewQueue({ newQueue: [], scheduledQueue: [first.id, second.id] });
      setPresentations({ ja: { id: peer.id, cardId: second.id, decision: peer } });
      await flushEffects();
      expect(container.querySelector('.flashcard-word')!.textContent).toBe(first.content.front);
      const retry = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
        .find(button => button.textContent === 'mlearn.Global.TryAgain')!;
      retry.click();
      await flushEffects();
      expect(container.querySelector('.flashcard-word')!.textContent).toBe('peer question');
      expect(mockSaveReviewPresentation.mock.calls.at(-1)?.[1].id).toBe(peer.id);
      expect(mockSubmitRating).not.toHaveBeenCalled();
    } finally { dispose(); }
  });

  it('admits a fresh choice when a peer changes the same card prompt before the older choice acknowledges', async () => {
    let acknowledgeOld!: () => void;
    decisionBridge.record.mockImplementationOnce(() => new Promise<void>(resolve => { acknowledgeOld = resolve; }));
    const dispose = render(() => <FlashcardReview />, container);
    try {
      await flushEffects();
      const first = decisionBridge.record.mock.calls[0][0];
      const card = mockCard()!;
      setMockCard({ ...card, content: { ...card.content, front: 'replacement prompt' } });
      await flushEffects();
      const replacement = decisionBridge.record.mock.calls[1][0];
      expect(replacement.id).not.toBe(first.id);
      expect(replacement.selected.presentation.surface).toBe('replacement prompt');
      expect(container.querySelector('.flashcard-front')?.textContent).toContain('replacement prompt');
      acknowledgeOld();
      await flushEffects();
      expect(container.querySelector('.flashcard-front')?.textContent).toContain('replacement prompt');
      expect(decisionBridge.record).toHaveBeenCalledTimes(2);
    } finally { dispose(); }
  });

  it.each(['pointer', 'keyboard'] as const)('keeps %s reveal and rating with the card interaction and resets the card scroll for the next encounter', async revealMethod => {
    setMockCard(makeCard({ content: { type: 'word', front: 'Long prompt', back: 'Answer',
      example: 'Long example '.repeat(100), imageUrl: 'flashcard-image://unavailable.png' } }));
    const dispose = render(() => <FlashcardReview />, container);
    await flushEffects();
    try {
      await flushEffects();
      const content = container.querySelector<HTMLElement>('.flashcard-review-content');
      const actions = container.querySelector<HTMLElement>('.flashcard-buttons-container')!;
      const reveal = container.querySelector<HTMLButtonElement>('.flashcard-show-answer-btn')!;
      expect(content).not.toBeNull();
      expect(content!.contains(container.querySelector('.flashcard-container'))).toBe(true);
      expect(content!.contains(reveal)).toBe(true);
      expect(content!.contains(container.querySelector('.flashcard-review-header'))).toBe(false);
      expect(actions.contains(reveal)).toBe(false);
      content!.scrollTop = 240;
      if (revealMethod === 'pointer') await clickShowAnswer(container);
      else { document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' })); await flushEffects(); }
      expect(content!.scrollTop).toBe(0);
      expect(content!.querySelector('.rating-matrix')).not.toBeNull();
      expect(actions.querySelector('.rating-matrix')).toBeNull();
      content!.scrollTop = 240;
      setMockCard(makeCard({ id: 'next-layout-card', content: { type: 'word', front: 'Next prompt', back: 'Next answer' } }));
      await flushEffects();
      expect(content!.scrollTop).toBe(0);
      expect(content!.querySelector('.flashcard-show-answer-btn')).not.toBeNull();
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
    await flushEffects();
    try {
      await clickShowAnswer(container);
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
      expect(random).not.toHaveBeenCalled();
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
      .mockReturnValueOnce(0.5); // Scheduler fallback: review; policy has no random draw.
    const dispose = render(() => <FlashcardReview />, container);
    await flushEffects();
    try {
      expect(container.querySelector('.flashcard-front')!.textContent).toBe(review.content.front);
      await clickShowAnswer(container);
      random.mockReturnValue(0.01); // Scheduler now chooses the new card.
      expect(mockCard()?.id).toBe(fresh.id);
      const callsBeforeAcknowledgment = random.mock.calls.length;
      setQueue({ newQueue: [fresh.id], scheduledQueue: [review.id] });
      await flushEffects();
      expect(container.querySelector('.flashcard-front')!.textContent).toBe(review.content.front);
      expect(container.querySelector('.flashcard-back')!.classList.contains('flashcard-face--hidden')).toBe(false);
      // One scheduler read; no new policy draw for the active encounter.
      expect(random.mock.calls.length).toBeGreaterThan(callsBeforeAcknowledgment);
    } finally {
      dispose();
    }
  });

  it.each(['unqueued', 'suspended', 'buried', 'deleted', 'excluded', 'rated'] as const)(
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
      await flushEffects();
      try {
        await clickShowAnswer(container);
        const originalEncounter = container.querySelector('[data-encounter-id]')!.getAttribute('data-encounter-id');
        if (change === 'deleted') delete mockReviewCards[first.id];
        if (change === 'suspended' || change === 'buried') {
          mockReviewCards[first.id] = { ...first, [change]: true };
        }
        if (change === 'excluded') mockIgnoredWords = () => new Set([first.content.front]);
        if (change === 'rated') mockReviewCards[first.id] = { ...first, lastReviewed: Date.now(), reviews: first.reviews + 1 };
        // A peer commit updates the card store and rebuilds the workload.
        setMockCard(second);
        setQueue({ newQueue: [], scheduledQueue: change === 'unqueued' ? [second.id] : [first.id, second.id] });
        await flushEffects();
        if (change === 'rated') expect(container.querySelector('[data-encounter-id]')!.getAttribute('data-encounter-id')).not.toBe(originalEncounter);
        else expect(container.querySelector('.flashcard-front')!.textContent).toBe(second.content.front);
        expect(container.querySelector('.flashcard-back')!.classList.contains('flashcard-face--hidden')).toBe(true);
      } finally {
        dispose();
      }
    },
  );

  it('opens the shared inspector on the reviewed card identity without recording an outcome', async () => {
    const dispose = render(() => <FlashcardReview />, container);
    await flushEffects();
    await clickShowAnswer(container);
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
    await flushEffects();
    const actions = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'mlearn.Flashcards.Review.CardActions')!;
    actions.click();
    Array.from(document.body.querySelectorAll('button')).find(button => button.textContent === 'mlearn.Knowledge.Popup.Inspect')!.click();
    expect(knowledgeInspection()).toBeUndefined();
    await flushEffects();
    expect(knowledgeInspection()?.surface).toBe('犬');
    closeKnowledgeInspector();
    dispose();
    restoreSavedReviewCursor();
    dispose = render(() => <FlashcardReview />, container);
    await flushEffects();
    await clickShowAnswer(container);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await flushEffects();
    expect(mockSubmitRating).toHaveBeenCalledWith('犬', expect.any(Array), expect.objectContaining({
      persistence: 'background',
      scaffolds: expect.objectContaining({ 'provided-access:sense-recognition': true, 'provided-access:surface-reading': true }),
    }));
    dispose();
  });

  it('refuses to open reference content when its assistance record cannot be saved', async () => {
    const dispose = render(() => <FlashcardReview />, container);
    await flushEffects();
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
    await flushEffects();
    Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'mlearn.Flashcards.Review.CardActions')!.click();
    Array.from(document.body.querySelectorAll('button')).find(button => button.textContent === 'mlearn.Knowledge.Popup.Inspect')!.click();
    await flushEffects();
    closeKnowledgeInspector();
    mockSubmitRating.mockRejectedValueOnce(new Error('journal unavailable'));
    await clickShowAnswer(container);
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
    await flushEffects();
    Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'mlearn.Flashcards.Review.CardActions')!.click();
    Array.from(document.body.querySelectorAll('button')).find(button => button.textContent === 'mlearn.Knowledge.Popup.Inspect')!.click();
    await flushEffects();
    closeKnowledgeInspector();
    const key = `mlearn-review-assistance:${encodeURIComponent(JSON.stringify(['ja', 'card-1']))}`;
    expect(localStorage.getItem(key)).not.toBeNull();
    let acknowledge!: () => void;
    mockSubmitRating.mockImplementationOnce(() => new Promise(resolve => {
      acknowledge = () => resolve({ attemptId: 'acknowledged', completed: false });
    }));
    await clickShowAnswer(container);
    const retained = localStorage.getItem(key);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await flushEffects();
    expect(localStorage.getItem(key)).toBe(retained);
    acknowledge();
    await flushEffects();
    expect(localStorage.getItem(key)).toBeNull();
    dispose();
  });

  it('advances before durability and never waits for a blocked assistance cleanup lock', async () => {
    const first = mockCard()!;
    const second = makeCard({ id: 'next', content: { type: 'word', front: 'next question', back: 'answer' } });
    mockReviewCards = { [first.id]: first, [second.id]: second };
    const [reviewQueue, setReviewQueue] = createSignal<ReviewQueue>({ newQueue: [], scheduledQueue: [first.id] });
    mockReviewQueue = reviewQueue;
    let persist!: (saved: boolean) => void;
    const persisted = new Promise<boolean>(resolve => { persist = resolve; });
    mockSubmitRating.mockImplementationOnce(async () => {
      setMockCard(second);
      setReviewQueue({ newQueue: [], scheduledQueue: [second.id] });
      return { attemptId: 'durable-later', completed: true, persisted };
    });
    const dispose = render(() => <FlashcardReview />, container);
    await flushEffects();
    await clickShowAnswer(container);
    const key = createReviewAssistanceStore(localStorage, null).exposureKey(JSON.stringify(['ja', first.id]), mockSaveReviewPresentation.mock.calls[0][1].id);
    const retained = localStorage.getItem(key);
    expect(retained).not.toBeNull();
    let release!: () => void;
    const lock = vi.spyOn(inProcessStudySessionLocks, 'request').mockImplementation(async (_name, callback) => {
      await new Promise<void>(resolve => { release = resolve; });
      await callback();
    });
    try {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
      await flushEffects();
      expect(container.querySelector('.flashcard-word')!.textContent).toBe('next question');
      expect(container.querySelector('.flashcard-show-answer-btn')).not.toBeNull();
      expect(localStorage.getItem(key)).toBe(retained);
      persist(true);
      await flushEffects();
      expect(container.querySelector('.flashcard-show-answer-btn')).not.toBeNull();
      expect(localStorage.getItem(key)).toBe(retained);
      release();
      await flushEffects();
      expect(localStorage.getItem(key)).toBeNull();
    } finally { lock.mockRestore(); dispose(); }
  });

  it('reveals immediately while automatic audio admission waits and never fabricates an unplayed cue', async () => {
    mockSettings.flashcardAutoTts = true;
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const lock = vi.spyOn(inProcessStudySessionLocks, 'request').mockImplementation(async (_name, callback) => {
      await blocked;
      await callback();
    });
    const dispose = render(() => <FlashcardReview />, container);
    try {
      await flushEffects();
      expect(mockPlayedTts).not.toHaveBeenCalled();
      await clickShowAnswer(container);
      expect(container.querySelector('.rating-matrix')).not.toBeNull();
      expect(container.textContent).not.toContain('SavingAssistance');
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
      await flushEffects();
      expect(mockSubmitRating).toHaveBeenCalledTimes(1);
      expect(mockSubmitRating.mock.calls[0][2]).not.toHaveProperty('scaffolds.audio');
    } finally { release(); await flushEffects(); lock.mockRestore(); dispose(); }
  });

  it('drops delayed reference admission after the displayed card changes', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const lock = vi.spyOn(inProcessStudySessionLocks, 'request').mockImplementation(async (_name, callback) => {
      await gate;
      await callback();
    });
    const dispose = render(() => <FlashcardReview />, container);
    await flushEffects();
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
    await flushEffects();
    // Both faces are always mounted; the unrevealed back carries `--hidden`.
    expect(backHidden()).toBe(true);
    await clickShowAnswer(container);
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
    await flushEffects();
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
    mockLanguageLoading = () => false;
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
    mockReviewSessions = () => ({});
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
    await flushEffects();
    await clickShowAnswer(container);
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
    await flushEffects();
    await clickShowAnswer(container);
    container.querySelector<HTMLButtonElement>('.rating-matrix__quality')!.click();
    await flushEffects();
    expect(mockSubmitRating.mock.calls[0][1]).toEqual([{ capability: 'surface-recognition', quality: 'missed' }]);
    dispose();
  });

  it('explains a pending or failed capability query and permits retry without submitting a rating', async () => {
    const [projection, setProjection] = createSignal<KnowledgeProjection>();
    mockProjection = projection;
    const dispose = render(() => <FlashcardReview />, container);
    await flushEffects();
    await clickShowAnswer(container);
    expect(container.querySelector<HTMLButtonElement>('.rating-matrix__quality')!.disabled).toBe(true);
    expect(container.textContent).not.toContain('mlearn.Knowledge.Loading');
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
    await flushEffects();
    await clickShowAnswer(container);
    container.querySelector<HTMLButtonElement>('.rating-matrix__quality')!.click();
    await flushEffects();
    await clickShowAnswer(container);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '2' }));
    await flushEffects();
    expect(warn.mock.calls.filter(([message]) => String(message).includes('will never be disposed'))).toEqual([]);
    dispose();
  });

  it('allows pending persistence and visibly blocks a failed background batch until retry', async () => {
    const [state, setState] = createSignal<'idle' | 'pending' | 'failed'>('pending');
    mockRatingPersistenceState = state;
    const dispose = render(() => <FlashcardReview />, container);
    await flushEffects();
    await clickShowAnswer(container);
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

  it('persists every tested capability as one whole-word attempt', async () => {
    const dispose = render(() => <FlashcardReview />, container);
    await flushEffects();
    expect(container.querySelector('.rating-matrix')).toBeNull();
    await clickShowAnswer(container);
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
      // An unassisted response consumed no cue, so the write is handed to the
      // main process's background queue instead of blocking the transition.
      persistence: 'background',
      scheduler: { cardId: 'card-1', rating: 'again', timeSpentMs: expect.any(Number), tested: ['sense-recognition', 'surface-reading'] },
    }));
    dispose();
  });

  it('keeps selection details in Inspect without a generic inline Why panel', async () => {
    const dispose = render(() => <FlashcardReview />, container);
    await flushEffects();
    expect(container.querySelector('[data-testid="policy-why"]')).toBeNull();
    await clickShowAnswer(container);
    expect(container.querySelector('[data-testid="policy-why"]')).toBeNull();
    dispose();
  });

  it('prefers other queued work when supplied evidence changes only timestamps and the retention cache', async () => {
    const first = mockCard()!;
    const other = makeCard({ id: 'other-card', content: { type: 'word', front: '猫', reading: 'ねこ', back: 'cat' } });
    mockReviewCards = { [first.id]: first, [other.id]: other };
    mockReviewQueue = () => ({ newQueue: [], scheduledQueue: [first.id, other.id] });
    const original = selectFlashcardReviewDecision({ id: 'cache-choice', at: 20,
      entries: [flashcardReviewPolicyEntry(first, 'ja', jaLanguageData)] })!.provenance;
    mockReviewPresentations = () => ({ ja: { id: original.id, cardId: first.id, decision: original } });
    mockSubmitRating.mockImplementationOnce(async () => {
      const cached = { ...first, lastReviewed: Date.now(), lastUpdated: Date.now(), retentionCache: { state: first.state, ease: first.ease,
        interval: first.interval, dueAt: first.dueDate, reviews: first.reviews, lapses: first.lapses,
        learningStep: first.learningStep, lastReviewed: first.lastReviewed,
        provenance: 'derived-scheduler-cache' as const } };
      mockReviewCards = { [first.id]: cached, [other.id]: other };
      setMockCard(cached);
      return { attemptId: 'cache-attempt', completed: true };
    });
    const dispose = render(() => <FlashcardReview />, container);
    try {
      await flushEffects();
      await clickShowAnswer(container);
      container.querySelector<HTMLButtonElement>('.rating-matrix__quality')!.click();
      await flushEffects();
      expect(mockSubmitRating).toHaveBeenCalledTimes(1);
      expect(mockSaveReviewPresentation.mock.calls.at(-1)?.[1].cardId).toBe(other.id);
    } finally { dispose(); }
  });

  it('resets scroll when the same learning card is queued again after rating', async () => {
    const dispose = render(() => <FlashcardReview />, container);
    await flushEffects();
    const scrollRegion = container.querySelector<HTMLElement>('.flashcard-review-content')!;
    await clickShowAnswer(container);
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
    await flushEffects();
    try {
      now += 500;
      await clickShowAnswer(container);
      container.querySelector<HTMLButtonElement>('.rating-matrix__quality')!.click();
      await flushEffects();
      expect(mockSubmitRating.mock.calls[0][2]).toMatchObject({ timing: { wallLatencyMs: 500 } });
      now += 750;
      await clickShowAnswer(container);
      container.querySelector<HTMLButtonElement>('.rating-matrix__quality')!.click();
      await flushEffects();
      expect(mockSubmitRating.mock.calls[1][2]).toMatchObject({ timing: { wallLatencyMs: 750 } });
    } finally { dispose(); }
  });

  it('Space reveals without submitting; the compact bar mounts armed on reveal', async () => {
    const dispose = render(() => <FlashcardReview />, container);
    await flushEffects();
    const compactActions = () => Array.from(container.querySelectorAll<HTMLButtonElement>('.rating-matrix__quality'));
    // No rating surface exists before the reveal.
    expect(container.querySelector('.rating-matrix')).toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await flushEffects();
    expect(compactActions().length).toBeGreaterThan(0);
    expect(compactActions().every((action) => action.disabled)).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    expect(mockSubmitRating).not.toHaveBeenCalled();
    dispose();
  });

  it('reports completion once the queue drains, and resumes a studyable face when work returns', async () => {
    const onComplete = vi.fn();
    const dispose = render(() => <FlashcardReview onComplete={onComplete} />, container);
    await flushEffects();
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
    await flushEffects();
    await clickShowAnswer(container);
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

  it('keeps study shortcuts out of the card actions popover', async () => {
    const dispose = render(() => <FlashcardReview />, container);
    await flushEffects();
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
    await flushEffects();
    try {
      await clickShowAnswer(container);
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
    await flushEffects();
    await clickShowAnswer(container);
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
    await flushEffects();
    const key = `mlearn-review-assistance:${encodeURIComponent(JSON.stringify(['ja', 'card-1']))}`;
    const play = container.querySelector<HTMLButtonElement>(`.flashcard-front button[title="mlearn.Flashcards.Card.${field === 'word' ? 'PlayWord' : 'PlayExample'}"]`)!;
    expect(play).not.toBeNull();
    play.click();
    await flushEffects();
    expect(mockPlayedTts).toHaveBeenCalledWith('card-1', 'ja', field);
    expect(Object.values(JSON.parse(localStorage.getItem(key)!).choices)).toEqual([expect.objectContaining({ scaffolds: expect.objectContaining({ audio: true }) })]);
    dispose();
    restoreSavedReviewCursor();
    dispose = render(() => <FlashcardReview />, container);
    await flushEffects();
    await clickShowAnswer(container);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await flushEffects();
    expect(mockPlayedTts).toHaveBeenCalledTimes(1);
    // Requested cues retain their provenance on the background command.
    expect(mockSubmitRating).toHaveBeenCalledWith('犬', expect.any(Array), expect.objectContaining({
      persistence: 'background', scaffolds: expect.objectContaining({ audio: true }),
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
    await flushEffects();
    container.querySelector<HTMLButtonElement>('.flashcard-front button[title="mlearn.Flashcards.Card.PlayExample"]')!.click();
    await flushEffects();
    expect(container.textContent).toContain('AssistanceRecorded');
    expect(container.textContent).not.toContain('ReferenceConsulted');
    await clickShowAnswer(container);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await flushEffects();
    expect(mockSubmitRating).toHaveBeenCalledWith('犬', expect.any(Array), expect.objectContaining({
      scaffolds: { audio: true, 'provided-access:future:contour': true },
    }));
    dispose();
  });

  it('does not retroactively supply recall when audio is requested after reveal', async () => {
    const dispose = render(() => <FlashcardReview />, container);
    await flushEffects();
    await clickShowAnswer(container);
    container.querySelector<HTMLButtonElement>('.flashcard-back button[title="mlearn.Flashcards.Card.PlayWord"]')!.click();
    await flushEffects();
    expect(mockPlayedTts).toHaveBeenCalledTimes(1);
    const exposure = createReviewAssistanceStore(localStorage, null).read(JSON.stringify(['ja', 'card-1']), mockSaveReviewPresentation.mock.calls[0][1].id);
    expect(exposure).toMatchObject({ scaffolds: {}, revealed: true });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await flushEffects();
    expect(mockSubmitRating.mock.calls[0][2]).not.toHaveProperty('scaffolds');
    dispose();
  });

  it('refuses pre-answer audio on storage failure and retries the original cue', async () => {
    const dispose = render(() => <FlashcardReview />, container);
    await flushEffects();
    const failure = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    container.querySelector<HTMLButtonElement>('.flashcard-front button[title="mlearn.Flashcards.Card.PlayWord"]')!.click();
    await flushEffects();
    expect(mockPlayedTts).not.toHaveBeenCalled();
    expect(container.textContent).toContain('AssistanceSaveFailed');
    await clickShowAnswer(container);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    expect(mockSubmitRating).not.toHaveBeenCalled();
    failure.mockRestore();
    Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'mlearn.Global.TryAgain')!.click();
    await flushEffects();
    expect(mockPlayedTts).toHaveBeenCalledWith('card-1', 'ja', 'word');
    await clickShowAnswer(container);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await flushEffects();
    expect(mockSubmitRating).toHaveBeenCalledWith('犬', expect.any(Array), expect.objectContaining({ scaffolds: { audio: true } }));
    dispose();
  });

  it('admits front video as durable reference assistance before making playback available', async () => {
    setMockCard(makeCard({ content: { type: 'word', front: '犬', reading: 'いぬ', back: 'dog', videoUrl: 'local-media://clip.mp4' } }));
    let dispose = render(() => <FlashcardReview />, container);
    await flushEffects();
    expect(container.querySelector('.flashcard-front video')).toBeNull();
    const play = container.querySelector<HTMLButtonElement>('.flashcard-front .flashcard-media-admission')!;
    expect(play).not.toBeNull();
    play.click();
    expect(container.querySelector('.flashcard-front video')).toBeNull();
    await flushEffects();
    expect(container.querySelector('.flashcard-front video')).not.toBeNull();
    dispose();
    restoreSavedReviewCursor();
    dispose = render(() => <FlashcardReview />, container);
    await flushEffects();
    await clickShowAnswer(container);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await flushEffects();
    expect(mockSubmitRating).toHaveBeenCalledWith('犬', expect.any(Array), expect.objectContaining({
      persistence: 'background', scaffolds: expect.objectContaining({ media: true,
        'provided-access:sense-recognition': true, 'provided-access:surface-reading': true }),
    }));
    dispose();
  });

  it('requires new video admission when an assisted rating returns to the same due card', async () => {
    setMockCard(makeCard({ content: { type: 'word', front: '犬', reading: 'いぬ', back: 'dog', videoUrl: 'local-media://clip.mp4' } }));
    const dispose = render(() => <FlashcardReview />, container);
    await flushEffects();
    container.querySelector<HTMLButtonElement>('.flashcard-front .flashcard-media-admission')!.click();
    await flushEffects();
    expect(container.querySelector('.flashcard-front video')).not.toBeNull();
    await clickShowAnswer(container);
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
    await flushEffects();
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
    await flushEffects();
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
    await flushEffects();
    expect(mockPlayedTts).toHaveBeenCalledTimes(1);
    await clickShowAnswer(container);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await flushEffects();
    expect(mockPlayedTts).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.flashcard-front')!.textContent).toBe(first.content.front);
    expect(container.textContent).not.toContain('mlearn.Flashcards.Review.SavingRating');
    expect(container.querySelector('[data-review-phase]')?.getAttribute('data-review-phase')).toBe('revealed');
    // Automatic front TTS is an unattended cue: the transition does not wait
    // on the acknowledgement, but the scaffold still travels with the attempt.
    expect(mockSubmitRating).toHaveBeenCalledWith(first.content.front, expect.any(Array), expect.objectContaining({
      persistence: 'background', scaffolds: expect.objectContaining({ audio: true }),
    }));
    acknowledge();
    await flushEffects();
    expect(container.querySelector('.flashcard-front')!.textContent).toBe(second.content.front);
    expect(mockPlayedTts.mock.calls).toEqual([['card-1', 'ja', 'word'], ['second', 'ja', 'word']]);
    const key = `mlearn-review-assistance:${encodeURIComponent(JSON.stringify(['ja', 'second']))}`;
    expect(Object.values(JSON.parse(localStorage.getItem(key)!).choices)).toEqual([expect.objectContaining({ scaffolds: expect.objectContaining({ audio: true }) })]);
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
    await flushEffects();
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
    await flushEffects();
    await clickShowAnswer(container);
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
      // The consumed cue is attributed to the attempt, and it travels on the
      // command either way. Automatic playback is unattended, so the response
      // does not wait on the durable write to leave the screen.
      scaffolds: { audio: true },
      persistence: 'background',
      scheduler: expect.objectContaining({ cardId: 'card-1', rating: 'again', tested: ['sense-recognition', 'surface-reading'] }),
    }));
    dispose();
  });

  it('does not attribute an audio cue when automatic playback has no recording', async () => {
    mockTtsAvailable = false;
    mockSettings.flashcardAutoTts = true;
    const dispose = render(() => <FlashcardReview />, container);
    await flushEffects();
    await clickShowAnswer(container);
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
    await flushEffects();
    await clickShowAnswer(container);
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

  it('opens an Undo correction on the answer side and advances with one retrospective rating', async () => {
    const first = makeCard();
    const next = makeCard({ id: 'after-correction', content: { type: 'word', front: 'next cue', back: 'next answer' } });
    mockReviewCards = { [first.id]: first, [next.id]: next };
    const decision = selectFlashcardReviewDecision({ id: 'original-choice', at: 1,
      entries: [flashcardReviewPolicyEntry(first, 'ja', jaLanguageData)], rng: () => 0.7 })!.provenance;
    const [presentations, setPresentations] = createSignal<Record<string, unknown>>({ ja: {
      id: decision.id, cardId: first.id, decision,
      scaffolds: { 'prior-cue-exposure': true },
      correction: { attemptId: 'withdrawn-report', at: 1, decision, scaffolds: { 'package:unknown': true } },
    } });
    mockReviewPresentations = presentations;
    const [queue, setQueue] = createSignal<ReviewQueue>({ newQueue: [], scheduledQueue: [first.id, next.id] });
    mockReviewQueue = queue;
    mockSubmitRating.mockImplementationOnce(async () => {
      setPresentations({}); setQueue({ newQueue: [], scheduledQueue: [next.id] }); setMockCard(next);
      return { attemptId: 'replacement-report', completed: true };
    });
    const dispose = render(() => <FlashcardReview />, container);
    try {
      await flushEffects();
      expect(container.querySelector('[data-review-phase]')?.getAttribute('data-review-phase')).toBe('revealed');
      expect(container.textContent).toContain('mlearn.Flashcards.Review.CorrectingReport');
      expect(container.textContent).not.toContain('mlearn.WordSync.ReferenceConsulted');
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
      await flushEffects();
      expect(mockSubmitRating).toHaveBeenCalledOnce();
      expect(mockSubmitRating).toHaveBeenCalledWith(first.content.front, expect.any(Array), expect.objectContaining({
        decision, scaffolds: { 'package:unknown': true },
      }));
      expect(container.querySelector('.flashcard-front')!.textContent).toBe(next.content.front);
    } finally { dispose(); }
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
    await flushEffects();
    try {
      expect(container.querySelector('.flashcard-front')!.textContent).toBe('next');
      Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'mlearn.Flashcards.Review.Undo')!.click();
      await flushEffects();
      expect(container.querySelector('.flashcard-front')!.textContent).toBe('犬');
      dispose();
      dispose = render(() => <FlashcardReview />, container);
      await flushEffects();
      expect(container.querySelector('.flashcard-front')!.textContent).toBe('犬');
      expect(container.textContent).toContain('AssistanceRecorded');
      await clickShowAnswer(container);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
      await flushEffects();
      expect(mockSubmitRating).toHaveBeenCalledWith('犬', expect.any(Array), expect.objectContaining({
        persistence: 'background', scaffolds: { audio: true, 'provided-access:future:relationship': true },
      }));
    } finally { dispose(); }
  });

  it('keeps a failed Undo visible and retries the same Undo command', async () => {
    mockCanUndo.mockReturnValue(true);
    mockUndoLastAction.mockRejectedValueOnce(new Error('disk full')).mockResolvedValueOnce('answer');
    const dispose = render(() => <FlashcardReview />, container);
    await flushEffects();
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

  it('renders card actions in the shared anchored popover', async () => {
    const dispose = render(() => <FlashcardReview />, container);
    await flushEffects();
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
    mockLanguageLoading = () => false;
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
    await flushEffects();
    if (withDraft) {
      await clickShowAnswer(container);
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
      await clickShowAnswer(container);
      Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'mlearn.Flashcards.Review.CardActions')!.click();
      Array.from(document.body.querySelectorAll('button')).find(button => button.textContent === 'mlearn.Flashcards.Review.Remove')!.click();
      await flushEffects();
      dialogButton('Delete')!.click();
      await flushEffects();
      expect(mockRemoveFlashcard).toHaveBeenCalledTimes(1);
      expect(container.querySelector('.flashcard-back')!.classList.contains('flashcard-face--hidden')).toBe(false);
      expect(container.textContent).not.toContain('mlearn.Flashcards.Review.SavingRemoval');
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


// ── Rating interaction latency (perf guard) ───────────────────────────────
// The learner-facing rating transition is an optimistic local transaction: a
// durable rating or cursor write may take hundreds of milliseconds on a real
// library, and none of that belongs between the keypress and the next card.
// These run against a realistically large persisted queue - unit fixtures with
// one or two cards cannot see the O(queue) work this guards.
//
// The stub below mirrors the real provider's routing: it blocks for the
// simulated disk latency ONLY on the acknowledged path, and returns
// immediately on the background path (which hands ownership to the
// main-process write queue). That is what makes these assertions about the
// ROUTE the surface chose, not just about a wall-clock number.
describe('FlashcardReview rating latency', () => {
  let container: HTMLDivElement;

  /** A durable rating write on a real library, as a whole-store commit costs. */
  const DURABLE_WRITE_MS = 300;

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.clearAllMocks();
    mockLanguageLoading = () => false;
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
    mockSaveReviewPresentation.mockImplementation(async (_language, presentation, _expectedId) => {
      await decisionBridge.record(presentation.decision);
    });
    // `persistence` is the route: only 'immediate' waits on the durable write.
    mockSubmitRating.mockImplementation(async (...args: unknown[]) => {
      const options = args[2] as { persistence?: string; language?: string; decision?: { id: string } };
      if (options.persistence !== 'background') {
        await new Promise<void>((resolve) => { setTimeout(resolve, DURABLE_WRITE_MS); });
      }
      const cursors = mockReviewPresentations() as Record<string, ReviewPresentation>;
      if (options.language && cursors[options.language]?.decision?.id === options.decision?.id) {
        const next = { ...cursors };
        delete next[options.language];
        mockReviewPresentations = () => next;
      }
      return { attemptId: 'attempt-1', completed: false };
    });
  });

  afterEach(() => {
    mockReviewCards = {};
    mockReviewSessions = () => ({});
    mockReviewPresentations = () => ({});
    mockReviewQueue = () => ({ newQueue: [], scheduledQueue: [] });
    container.remove();
  });

  /** Large enough to expose per-card O(queue) work; small enough for CI. */
  const LARGE_QUEUE = 1500;

  function largeQueueCards(): Record<string, Flashcard> {
    const now = Date.now();
    const cards: Record<string, Flashcard> = {};
    for (let i = 0; i < LARGE_QUEUE; i++) {
      cards[`big-${i}`] = makeCard({
        id: `big-${i}`,
        content: { type: 'word', front: `単語${i}`, reading: `たんご${i}`, back: `meaning ${i}` },
        state: 'review', reviews: i % 9, dueDate: now - (i % 300) * 60_000,
      });
    }
    return cards;
  }

  function useLargeQueue(): void {
    const cards = largeQueueCards();
    mockReviewCards = cards;
    const [queue] = createSignal<ReviewQueue>({
      newQueue: Object.keys(cards).slice(0, LARGE_QUEUE / 2),
      scheduledQueue: Object.keys(cards).slice(LARGE_QUEUE / 2),
    });
    mockReviewQueue = queue;
    mockQueueTotal = () => LARGE_QUEUE;
    setMockQueueTotal(LARGE_QUEUE);
    const [card] = createSignal<Flashcard | null>(cards['big-0']!);
    mockCard = card;
    setMockCard(cards['big-0']!);
  }

  /**
   * How long until a DIFFERENT card is interactive after the rating keypress.
   * This is the number a learner feels; persistence cost is deliberately
   * excluded from the surface (it runs behind the transition) but must not be
   * waited on to render the next card.
   */
  async function rateAndAwaitNextCard(): Promise<number> {
    const before = container.querySelector('.flashcard-word')?.textContent ?? '';
    const started = performance.now();
    container.querySelector<HTMLButtonElement>('.rating-matrix__quality')!.click();
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      await flushEffects();
      const shown = container.querySelector('.flashcard-word')?.textContent ?? '';
      if (shown && shown !== before && container.querySelector('.flashcard-show-answer-btn')) break;
    }
    return performance.now() - started;
  }

  // The DEFAULT configuration. `flashcardAutoTts` is on in a normal install and
  // it records an `audio` cue on every single review, so a persistence rule
  // keyed on "did this consume a cue" matches the ordinary workflow and puts a
  // durable store write between the keypress and the next card. These two are
  // the regression guard for exactly that.
  it.each([true, false])('advances immediately with auto-TTS %s while the durable write is still in flight', async autoTts => {
    mockSettings.flashcardAutoTts = autoTts;
    useLargeQueue();
    // The next card's durable cursor write also takes a disk round-trip.
    let presentationSettled = false;
    mockSaveReviewPresentation.mockImplementation(async (_language, presentation, _expectedId) => {
      await new Promise<void>((resolve) => { setTimeout(resolve, DURABLE_WRITE_MS); });
      await decisionBridge.record(presentation.decision);
      presentationSettled = true;
    });
    const dispose = render(() => <FlashcardReview />, container);
    try {
      await flushEffects();
      await clickShowAnswer(container);
      await rateAndAwaitNextCard();
      const shown = container.querySelector('.flashcard-word')?.textContent;
      expect(shown, 'a different card should be interactive').toBeTruthy();
      expect(mockSubmitRating).toHaveBeenCalledWith(expect.any(String), expect.any(Array),
        expect.objectContaining({ persistence: 'background' }));
      // The user-visible transition must happen while the durable cursor write
      // is still unresolved. This directly guards the behavior without making
      // CI machine speed part of the product contract.
      expect(presentationSettled).toBe(false);
    } finally { dispose(); }
  });

  it('still attributes the automatic TTS cue to the attempt on the background route', async () => {
    mockSettings.flashcardAutoTts = true;
    useLargeQueue();
    const dispose = render(() => <FlashcardReview />, container);
    try {
      await flushEffects();
      expect(mockPlayedTts).toHaveBeenCalledTimes(1);
      await clickShowAnswer(container);
      container.querySelector<HTMLButtonElement>('.rating-matrix__quality')!.click();
      await flushEffects();
      // Taking the background route must not cost the provenance: the cue is
      // still recorded as consumed, on the command's own events.
      expect(mockSubmitRating).toHaveBeenCalledWith(expect.any(String), expect.any(Array), expect.objectContaining({
        persistence: 'background', scaffolds: expect.objectContaining({ audio: true }),
      }));
    } finally { dispose(); }
  });

  it('carries learner-requested cues on the same background command as ordinary ratings', async () => {
    useLargeQueue();
    const dispose = render(() => <FlashcardReview />, container);
    try {
      await flushEffects();
      // The learner opens the knowledge inspector, not the automatic effect.
      Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'mlearn.Flashcards.Review.CardActions')!.click();
      Array.from(document.body.querySelectorAll('button')).find(button => button.textContent === 'mlearn.Knowledge.Popup.Inspect')!.click();
      await flushEffects();
      await clickShowAnswer(container);
      container.querySelector<HTMLButtonElement>('.rating-matrix__quality')!.click();
      await flushEffects();
      expect(mockSubmitRating).toHaveBeenCalledWith(expect.any(String), expect.any(Array), expect.objectContaining({
        persistence: 'background',
      }));
    } finally { dispose(); }
  });

  it('does not re-derive the whole scheduler pool twice for one selection', async () => {
    useLargeQueue();
    const derived: string[] = [];
    const actual = flashcardReviewPolicyEntry;
    const spy = vi.spyOn(
      await import('./flashcardReviewDecision'),
      'flashcardReviewPolicyEntry',
    ).mockImplementation((card, language, languageData) => {
      derived.push(card.id);
      return actual(card, language, languageData);
    });
    const dispose = render(() => <FlashcardReview />, container);
    try {
      await flushEffects();
      await clickShowAnswer(container);
      derived.length = 0;
      await rateAndAwaitNextCard();
      // One selection needs the pool once. A second full pass means an
      // unrelated reactive update rebuilt the whole workload again.
      expect(derived.length).toBeLessThanOrEqual(LARGE_QUEUE + 1);
    } finally { spy.mockRestore(); dispose(); }
  });
});

vi.mock('../../hooks/useLearningModel', () => ({ useLearningModel: () => ({ model: () => fitLearningModel([], Date.now()), snapshot: () => ({ events: [] }), ready: () => mockLearningReady(), failed: () => false, retry: () => {} }) }));
