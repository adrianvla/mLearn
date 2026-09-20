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
const mockAnswerCard = vi.fn(() => false);
const mockSetAccessStatus = vi.fn();
const mockRecordAttempt = vi.fn((..._callArgs: unknown[]) => ({ attemptId: 'attempt-1' }));
const mockAppendRetractions = vi.fn();

const flushEffects = () => new Promise<void>((resolve) => {
  const channel = new MessageChannel();
  channel.port1.onmessage = () => resolve();
  channel.port2.postMessage(null);
});

const mockT = (key: string, params?: Record<string, unknown>): string => {
  switch (key) {
    case 'mlearn.Flashcards.Review.Modes.Label': return 'Focus';
    case 'mlearn.Flashcards.Review.Modes.Meaning': return 'Meaning';
    case 'mlearn.Flashcards.Review.Modes.Reading': return 'Reading';
    case 'mlearn.Flashcards.Review.Modes.Prosody': return 'Prosody';
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
    case 'mlearn.Flashcards.Review.Easy': return 'Easy';
    case 'mlearn.Flashcards.Review.ShowAnswer': return 'Show Answer';
    case 'mlearn.Flashcards.Review.PressKeyTooltip': return `Press ${String(params?.key ?? '')}`;
    default: return key;
  }
};

vi.mock('../../hooks/useKnowledgeProjection', () => ({
  useKnowledgeProjection: () => ({ loading: () => false, capabilities: () => ['sense-recognition', 'surface-reading', 'prosodic-pattern'] }),
}));

vi.mock('../../context', () => ({
  useFlashcards: () => ({
    isKnowledgeReady: () => true,
    store: { flashcards: {} },
    queue: () => ({ newQueue: [], scheduledQueue: [] }),
    queueCounts: () => ({ new: 1, learning: 0, review: 0, total: 1 }),
    getCurrentCard: () => mockCard(),
    getPreviewDueDates: () => ({ again: 1, hard: 2, good: 3, easy: 4 }),
    answerCard: mockAnswerCard,
    buryCard: vi.fn(),
    removeFlashcard: vi.fn(),
    undoLastAction: vi.fn(),
    canUndo: () => false,
    refreshQueue: vi.fn(),
    dueDateToString: () => '1d',
    generateExampleSentenceWithLLM: vi.fn(),
    updateFlashcardContent: vi.fn(),
    updateFlashcard: vi.fn(),
    setAccessStatus: mockSetAccessStatus,
    recordAttempt: mockRecordAttempt,
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
    playTts: vi.fn(),
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

const deLanguageData: LanguageData = {
  name: 'German',
  settings: { fixed: {} },
  textProcessing: {
    scriptProfile: { acceptedScripts: ['Latn'] },
  },
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

function modeSelectOptions(container: HTMLDivElement): string[] {
  return Array.from(container.querySelectorAll('.flashcard-mode-select__control option'))
    .map((option) => option.getAttribute('value'))
    .filter((value): value is string => value !== null);
}

function clickShowAnswer(container: HTMLDivElement): void {
  const button = container.querySelector<HTMLButtonElement>('.flashcard-show-answer-btn');
  if (!button) throw new Error('Show Answer button missing');
  button.click();
}

describe('FlashcardReview review modes', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.clearAllMocks();
    mockSettings = {
      ...DEFAULT_SETTINGS,
      language: 'ja',
      flashcardAutoTts: false,
      flashcardFlipAnimation: false,
      use_anki: false,
      flashcardStealthMode: false,
      flashcardMuteAudio: false,
    };
    mockLangMap = { ja: jaLanguageData, de: deLanguageData };
    mockLanguageData = jaLanguageData;
    const [card, setCard] = createSignal<Flashcard | null>(null);
    mockCard = card;
    setMockCard = setCard;
    setMockCard(makeCard());
  });

  afterEach(() => {
    closeKnowledgeInspector();
    container.remove();
  });

  it('opens the shared inspector on the reviewed card identity without recording an outcome', () => {
    const dispose = render(() => <FlashcardReview />, container);
    clickShowAnswer(container);
    const inspect = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'mlearn.Knowledge.Popup.Inspect');
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
    expect(mockRecordAttempt).not.toHaveBeenCalled();
    expect(mockAnswerCard).not.toHaveBeenCalled();
    dispose();
  });

  it('hides the mode selector when only the meaning aspect is available', () => {
    mockLanguageData = deLanguageData;
    setMockCard(makeCard({ language: 'de' }));

    const dispose = render(() => <FlashcardReview />, container);

    expect(container.querySelector('.flashcard-mode-select')).toBeNull();
    dispose();
  });

  it('filters modes by language capability and per-card prosody data', () => {
    setMockCard(makeCard({
      content: { type: 'word', front: '犬', reading: 'いぬ', back: 'dog', prosody: { type: 'tone', display: 'HL' } },
    }));

    const dispose = render(() => <FlashcardReview />, container);

    expect(modeSelectOptions(container)).toEqual(['meaning', 'reading', 'prosody']);
    dispose();
  });

  it('omits the prosody mode when the current card carries no prosody data', () => {
    setMockCard(makeCard({ content: { type: 'word', front: '犬', reading: 'いぬ', back: 'dog' } }));

    const dispose = render(() => <FlashcardReview />, container);

    expect(modeSelectOptions(container)).toEqual(['meaning', 'reading']);
    dispose();
  });

  it('falls back to meaning when the active mode becomes unavailable on the next card', async () => {
    setMockCard(makeCard({
      content: { type: 'word', front: '犬', reading: 'いぬ', back: 'dog', prosody: { type: 'tone', display: 'HL' } },
    }));
    const onModeChange = vi.fn();

    const dispose = render(() => (
      <FlashcardReview reviewMode="prosody" onReviewModeChange={onModeChange} />
    ), container);

    expect(onModeChange).not.toHaveBeenCalled();

    setMockCard(makeCard({ id: 'card-2', content: { type: 'word', front: '犬', reading: 'いぬ', back: 'dog' } }));
    await flushEffects();

    expect(onModeChange).toHaveBeenCalledWith('meaning');
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

  it('reveals the reading annotation on the back face in reading mode without leaking it on the front', () => {
    const dispose = render(() => (
      <FlashcardReview reviewMode="reading" />
    ), container);

    expect(container.querySelector('.flashcard-front ruby')).toBeNull();
    expect(container.querySelector('.flashcard-back ruby')).not.toBeNull();
    expect(container.querySelector('.flashcard-back')?.textContent).toContain('いぬ');
    dispose();
  });

  it('does not force the reading annotation on the back face in meaning mode', () => {
    const dispose = render(() => <FlashcardReview reviewMode="meaning" />, container);

    expect(container.querySelector('.flashcard-back ruby')).toBeNull();
    dispose();
  });
});

describe('FlashcardReview failure attribution', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.clearAllMocks();
    mockSettings = {
      ...DEFAULT_SETTINGS,
      language: 'ja',
      flashcardAutoTts: false,
      flashcardFlipAnimation: false,
      use_anki: false,
      flashcardStealthMode: false,
      flashcardMuteAudio: false,
    };
    mockLangMap = { ja: jaLanguageData, de: deLanguageData };
    mockLanguageData = jaLanguageData;
    const [card, setCard] = createSignal<Flashcard | null>(null);
    mockCard = card;
    setMockCard = setCard;
    setMockCard(makeCard());
  });

  afterEach(() => {
    container.remove();
  });

  it('collapsed digit rates every tested capability under one whole-word attempt', () => {
    const dispose = render(() => <FlashcardReview reviewMode="reading" />, container);
    expect(container.querySelector('.rating-matrix')).toBeNull();
    clickShowAnswer(container);
    // Canonical collapsed digit: the whole tested word rates at once —
    // every tested capability, one logical attempt; strays are absorbed.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
    expect(mockRecordAttempt).toHaveBeenCalledTimes(2);
    expect(mockRecordAttempt).toHaveBeenCalledWith('犬', 'sense-recognition', 'missed', expect.objectContaining({ taskType: 'srs-review' }));
    expect(mockRecordAttempt).toHaveBeenCalledWith('犬', 'surface-reading', 'missed', expect.objectContaining({ taskType: 'srs-review' }));
    expect(mockAnswerCard).toHaveBeenCalledWith('again', expect.any(String), expect.any(Number), expect.objectContaining({ tested: ['sense-recognition', 'surface-reading'] }));
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
    expect(mockRecordAttempt).not.toHaveBeenCalled();
    expect(mockAnswerCard).not.toHaveBeenCalled();
    dispose();
  });
  it('a mixed drafted profile schedules on its weakest evidence under one attempt', () => {
    const dispose = render(() => <FlashcardReview reviewMode="reading" />, container);
    clickShowAnswer(container);
    container.querySelector<HTMLButtonElement>('.rating-matrix__adjust')!.click();
    // sense fluent, reading missed — the weaker LATER row must dominate
    // scheduling, so this fails against an observations[0]-quality bug.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
    expect(mockRecordAttempt).toHaveBeenCalledTimes(2);
    expect(mockRecordAttempt).toHaveBeenCalledWith('犬', 'sense-recognition', 'fluent', expect.objectContaining({ taskType: 'srs-review' }));
    expect(mockRecordAttempt).toHaveBeenCalledWith('犬', 'surface-reading', 'missed', expect.objectContaining({ taskType: 'srs-review' }));
    expect(mockAnswerCard).toHaveBeenCalledWith('again', expect.any(String), expect.any(Number), expect.objectContaining({ tested: ['sense-recognition', 'surface-reading'] }));
    dispose();
  });

  it('audio supplied before reveal still offers Reading and records the scaffold with the attempt', () => {
    mockSettings.flashcardAutoTts = true;
    const dispose = render(() => <FlashcardReview reviewMode="reading" />, container);
    clickShowAnswer(container);
    // A revealed cue changes the evidence condition, not the rating surface:
    // the Reading row stays ratable and the audio scaffold travels with the
    // attempt so the projection can weigh it. Collapsed digit = whole word.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
    expect(mockRecordAttempt).toHaveBeenCalledTimes(2);
    expect(mockRecordAttempt).toHaveBeenCalledWith('犬', 'sense-recognition', 'missed', expect.objectContaining({
      taskType: 'srs-review',
      scaffolds: { audio: true },
    }));
    expect(mockRecordAttempt).toHaveBeenCalledWith('犬', 'surface-reading', 'missed', expect.objectContaining({
      taskType: 'srs-review',
      scaffolds: { audio: true },
    }));
    dispose();
  });
});
