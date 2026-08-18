// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal, type Accessor } from 'solid-js';
import type { JSX } from 'solid-js';
import type { Flashcard, LanguageData, Settings } from '../../../shared/types';
import { DEFAULT_SETTINGS } from '../../../shared/types';
import { FlashcardReview } from './FlashcardReview';

const toastMocks = vi.hoisted(() => ({ showToast: vi.fn(() => 0) }));

let mockCard: Accessor<Flashcard | null> = () => null;
let setMockCard: (card: Flashcard | null) => void = () => {};
let mockLangMap: Record<string, LanguageData> = {};
let mockLanguageData: LanguageData | null = null;
let mockSettings: Settings = { ...DEFAULT_SETTINGS };
const mockAnswerCard = vi.fn(() => false);
const mockSetAspectStatus = vi.fn();
const mockAttributeKnowledgeFailure = vi.fn();

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
    case 'mlearn.Flashcards.Review.Attribution.WrongProsody': return 'Wrong prosody';
    case 'mlearn.Flashcards.Review.Attribution.Marked': return `Marked ${String(params?.aspect ?? '')} as unknown`;
    case 'mlearn.Knowledge.Aspect.Reading': return 'Reading';
    case 'mlearn.Knowledge.Aspect.Prosody': return 'Prosody';
    case 'mlearn.Flashcards.Review.Again': return 'Again';
    case 'mlearn.Flashcards.Review.Hard': return 'Hard';
    case 'mlearn.Flashcards.Review.Ok': return 'Ok';
    case 'mlearn.Flashcards.Review.Easy': return 'Easy';
    case 'mlearn.Flashcards.Review.ShowAnswer': return 'Show Answer';
    case 'mlearn.Flashcards.Review.PressKeyTooltip': return `Press ${String(params?.key ?? '')}`;
    default: return key;
  }
};

vi.mock('../../context', () => ({
  useFlashcards: () => ({
    store: { flashcards: {} },
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
    setAspectStatus: mockSetAspectStatus,
    attributeKnowledgeFailure: mockAttributeKnowledgeFailure,
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

vi.mock('../common', () => {
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

function attributionButton(container: HTMLDivElement, label: string): HTMLButtonElement | null {
  const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('.flashcard-attribution-btn'));
  return buttons.find((button) => button.textContent === label) ?? null;
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
    container.remove();
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

  it('shows the wrong-reading button only after the answer is revealed', () => {
    const dispose = render(() => <FlashcardReview />, container);

    expect(attributionButton(container, 'Wrong reading')).toBeNull();

    clickShowAnswer(container);

    expect(attributionButton(container, 'Wrong reading')).not.toBeNull();
    dispose();
  });

  it('hides the wrong-reading button when the language lacks a reading aspect', () => {
    setMockCard(makeCard({ language: 'de' }));
    mockLanguageData = deLanguageData;

    const dispose = render(() => <FlashcardReview />, container);

    clickShowAnswer(container);

    expect(attributionButton(container, 'Wrong reading')).toBeNull();
    dispose();
  });

  it('hides the wrong-reading button when the card has no distinct reading', () => {
    setMockCard(makeCard({ content: { type: 'word', front: '犬', reading: '犬', back: 'dog' } }));

    const dispose = render(() => <FlashcardReview />, container);

    clickShowAnswer(container);

    expect(attributionButton(container, 'Wrong reading')).toBeNull();
    dispose();
  });

  it('shows the wrong-prosody button when the card carries prosody data', () => {
    setMockCard(makeCard({
      content: { type: 'word', front: '犬', reading: 'いぬ', back: 'dog', prosody: { type: 'tone', display: 'HL' } },
    }));

    const dispose = render(() => <FlashcardReview />, container);

    clickShowAnswer(container);

    expect(attributionButton(container, 'Wrong prosody')).not.toBeNull();
    dispose();
  });

  it('calls setAspectStatus and shows a toast on wrong-reading', () => {
    const dispose = render(() => <FlashcardReview />, container);

    clickShowAnswer(container);
    const button = attributionButton(container, 'Wrong reading');
    if (!button) throw new Error('Wrong reading button missing');
    button.click();

    expect(mockAttributeKnowledgeFailure).toHaveBeenCalledWith('犬', 'reading', 'ja');
    expect(toastMocks.showToast).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Marked Reading as unknown',
      variant: 'success',
    }));
    dispose();
  });

  it('calls setAspectStatus and shows a toast on wrong-prosody', () => {
    setMockCard(makeCard({
      content: { type: 'word', front: '犬', reading: 'いぬ', back: 'dog', prosody: { type: 'tone', display: 'HL' } },
    }));

    const dispose = render(() => <FlashcardReview />, container);

    clickShowAnswer(container);
    const button = attributionButton(container, 'Wrong prosody');
    if (!button) throw new Error('Wrong prosody button missing');
    button.click();

    expect(mockAttributeKnowledgeFailure).toHaveBeenCalledWith('犬', 'prosody', 'ja');
    expect(toastMocks.showToast).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Marked Prosody as unknown',
      variant: 'success',
    }));
    dispose();
  });

  it('keeps the existing rating flow unchanged', () => {
    const dispose = render(() => <FlashcardReview />, container);

    clickShowAnswer(container);
    const okButton = Array.from(container.querySelectorAll<HTMLButtonElement>('.flashcard-rating-btn'))
      .find((button) => button.textContent?.includes('Ok'));
    if (!okButton) throw new Error('Ok rating button missing');
    okButton.click();

    expect(mockAnswerCard).toHaveBeenCalledWith('good', 'card-1', expect.any(Number));
    dispose();
  });
});
