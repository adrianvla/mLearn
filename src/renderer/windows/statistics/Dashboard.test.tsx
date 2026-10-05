// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import type { Flashcard, MediaStats } from '../../../shared/types';
import type { KnowledgeEvent } from '../../../shared/knowledgeEvents';
import type { KeyHistorySummary } from '../../../shared/knowledge/historyQueries';

const localizationMock = vi.fn((key: string) => key);
let flashcardStoreMock: {
  flashcards: Record<string, Flashcard>;
  dailyStats: Record<string, Record<string, { newCardsStudied: number; reviewCardsStudied: number; lapses: number; timeSpent: number; graduated: number }>>;
  wordKnowledge: Record<string, { word?: string; statusChangedAtSeen?: number }>;
};
let studyExcludedIds = new Set<string>();
let settingsMock: { language: string; newDayHour: number; easeThresholdKnown: number; easeThresholdLearning: number };
let summariesMock: Record<string, KeyHistorySummary> = {};
let knowledgeEventsChanged: (() => void) | null = null;
let flashcardsLoading = false;
let knownWords = 0;
let unknownWords = 0;
let unmeasuredWords = 0;
let mediaStatsMock: MediaStats[] = [];

vi.mock('../../context', () => ({
  useFlashcards: () => ({ store: flashcardStoreMock, getStudyableCards: () => Object.fromEntries(Object.entries(flashcardStoreMock.flashcards).filter(([id]) => !studyExcludedIds.has(id))), isKnowledgeReady: () => true, isLoading: () => flashcardsLoading }),
  useSettings: () => ({ settings: settingsMock }),
  useLanguage: () => ({
    getWordFrequency: () => ({}),
    currentLangData: () => ({}),
    getFreqLevelNames: () => ({}),
    getLanguageFeatures: () => ({ supportsFrequencyLevels: false }),
    getCanonicalFormForLanguage: () => null,
    getWordVariantsForLanguage: () => [],
  }),
  useLocalization: () => ({ t: localizationMock }),
}));

vi.mock('../../services/statsService', () => ({
  initTimeWatched: () => {},
}));

vi.mock('../../utils/wordLevelStats', () => ({
  computeWordLevelStats: () => ({
    allEncountered: { known: knownWords, learning: 0, unknown: unknownWords, untracked: unmeasuredWords, total: knownWords + unknownWords + unmeasuredWords },
    byLevel: [],
    outsideLevels: { total: 0, known: 0, learning: 0, unknown: 0, untracked: 0 },
  }),
}));

vi.mock('../../../shared/bridges', () => ({
  getBridge: () => ({
    mediaStats: {
      onMediaStatsList: (callback: (stats: unknown[]) => void) => { callback(mediaStatsMock); return () => {}; },
      listMediaStats: () => {},
    },
    knowledgeEvents: {
      queryKnowledgeSummaries: () => Promise.resolve(summariesMock),
      onKnowledgeEventsChanged: (callback: () => void) => { knowledgeEventsChanged = callback; return () => {}; },
    },
  }),
}));

vi.mock('../../components/common', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../components/common')>();
  return ({
  KnowledgeGate: actual.KnowledgeGate,
  KnowledgeLoadError: actual.KnowledgeLoadError,
  KnowledgeSkeleton: actual.KnowledgeSkeleton,
  SkeletonCard: actual.SkeletonCard,
  SkeletonStatGrid: actual.SkeletonStatGrid,
  StatCard: (props: { label: string; value: string | number }) => (
    <div class="mock-statcard"><span>{props.label}</span><b>{props.value}</b></div>
  ),
  Panel: (props: { children?: JSX.Element; class?: string }) => <div class={`mock-panel ${props.class ?? ''}`}>{props.children}</div>,
  BookIcon: () => <span>book</span>,
  Input: (props: { placeholder?: string }) => <input placeholder={props.placeholder} />,
  });
});

vi.mock('../../hooks/useKnowledgeHistory', () => ({
  useKnowledgeHistory: () => ({
    events: () => [],
    replay: () => ({ points: [], bands: [] }),
  }),
}));

vi.mock('./charts', () => ({
  PieChart: () => <div>pie</div>,
  BarChart: () => <div>bar</div>,
  Heatmap: () => <div>heat</div>,
  LineChart: () => <div data-testid="mock-line-chart" />,
}));

function makeFlashcard(id: string): Flashcard {
  return {
    id,
    language: 'ja',
    content: { type: 'word', front: id, back: 'x' },
    state: 'review',
    ease: 2.5,
    interval: 0,
    dueDate: 0,
    reviews: 1,
    lapses: 0,
    learningStep: 0,
    createdAt: 1000,
    lastReviewed: 0,
    lastUpdated: 1000,
  };
}

describe('Dashboard', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    studyExcludedIds = new Set();
    flashcardStoreMock = { flashcards: {}, dailyStats: {}, wordKnowledge: {} };
    settingsMock = { language: 'ja', newDayHour: 4, easeThresholdKnown: 1.8, easeThresholdLearning: 3 };
    summariesMock = {};
    flashcardsLoading = false;
    knownWords = 0;
    unknownWords = 0;
    unmeasuredWords = 0;
    mediaStatsMock = [];
    // Exercise the production invalidation path: the knowledge log cache is
    // keyed by the events version, and swapping the mock without a bump must
    // look exactly like an external change to the log.
    knowledgeEventsChanged?.();
  });

  afterEach(() => {
    container.remove();
    document.querySelectorAll('.tooltip-content').forEach((element) => { element.remove(); });
    vi.clearAllMocks();
  });

  it('keeps review totals and forecasts in the selected language and offers explicit all activity', async () => {
    flashcardStoreMock.flashcards = { a: makeFlashcard('a'), b: { ...makeFlashcard('b'), language: 'future' }, legacy: { ...makeFlashcard('legacy'), language: undefined } };
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const stats = (count: number) => ({ date, newCardsStudied: 0, reviewCardsStudied: count, lapses: 0, timeSpent: 0, graduated: 0 });
    flashcardStoreMock.dailyStats = { [date]: { ja: stats(2), future: stats(9) } };
    const { Dashboard } = await import('./Dashboard');
    const dispose = render(() => <Dashboard />, container);
    (Array.from(container.querySelectorAll('nav button')).find(button => button.textContent?.endsWith('.reviews')) as HTMLButtonElement).click();
    const value = (key: string) => Array.from(container.querySelectorAll('.mock-statcard')).find(card => card.textContent?.includes(key))?.querySelector('b')?.textContent;
    expect(value('Dashboard.TotalCards')).toBe('1');
    expect(value('DueForecast.Today')).toBe('1');
    expect(value('Dashboard.Reviews')).toBe('2');
    const scope = container.querySelector('.analytics-scope select') as HTMLSelectElement;
    scope.value = 'all'; scope.dispatchEvent(new Event('change', { bubbles: true }));
    expect(value('Dashboard.TotalCards')).toBe('3');
    expect(value('DueForecast.Today')).toBe('3');
    expect(value('Dashboard.Reviews')).toBe('11');
    expect(Array.from(container.querySelectorAll('nav button')).some(button => button.textContent?.endsWith('.knowledge'))).toBe(false);
    expect(container.textContent).toContain('mlearn.Statistics.Scope.AllActivityDescription');
    dispose();
  });

  it('uses the same language boundary for recorded immersion and keeps durations separate', async () => {
    const date = new Date().toISOString().split('T')[0];
    const media = (language: string, mediaType: 'video' | 'book', duration: number): MediaStats => ({
      mediaHash: `${language}-${mediaType}`, mediaName: 'Saved source', mediaType, language,
      wordsEncountered: {}, grammarEncountered: {}, assessedLevel: null,
      sessions: [{ date, duration, wordsLearned: 0 }], totalTimeSpent: duration, lastAccessed: 1,
    });
    mediaStatsMock = [media('ja', 'video', 60000), media('future', 'video', 180000), media('future', 'book', 120000)];
    const { Dashboard } = await import('./Dashboard');
    const dispose = render(() => <Dashboard />, container);
    (Array.from(container.querySelectorAll('nav button')).find(button => button.textContent?.endsWith('.activity')) as HTMLButtonElement).click();
    const times = () => Array.from(container.querySelectorAll('.session-time-value-sm')).map(node => node.textContent);
    expect(times()).toEqual(['0m', '1m', '0m']);
    expect(container.querySelector('.session-time-total')).toBeNull();
    const scope = container.querySelector('.analytics-scope select') as HTMLSelectElement;
    scope.value = 'all'; scope.dispatchEvent(new Event('change', { bubbles: true }));
    expect(times()).toEqual(['0m', '4m', '2m']);
    dispose();
  });

  it('retains scope selection when the selected language has no data', async () => {
    flashcardStoreMock.flashcards = { other: { ...makeFlashcard('other'), language: 'future' } };
    const { Dashboard } = await import('./Dashboard');
    const dispose = render(() => <Dashboard />, container);
    expect(container.querySelector('.dashboard-empty-state')).not.toBeNull();
    const scope = container.querySelector('.analytics-scope select') as HTMLSelectElement;
    scope.value = 'all'; scope.dispatchEvent(new Event('change', { bubbles: true }));
    expect(container.querySelector('.dashboard-empty-state')).toBeNull();
    expect(container.textContent).not.toContain('mlearn.Statistics.Legend.Learned');
    dispose();
  });

  it('renders the empty state when there is no card or study data', async () => {
    const { Dashboard } = await import('./Dashboard');
    const dispose = render(() => <Dashboard />, container);

    await vi.waitFor(() => {
      expect(container.querySelector('.dashboard-empty-state')).not.toBeNull();
      expect(container.textContent).toContain('mlearn.Statistics.Dashboard.EmptyState.Title');
    });
    expect(container.textContent).not.toContain('mlearn.Statistics.Dashboard.DueForecast.Title');

    dispose();
  });

  it('shows learner knowledge without requiring cards or immersion activity', async () => {
    knownWords = 12;
    const { Dashboard } = await import('./Dashboard');
    const dispose = render(() => <Dashboard />, container);
    expect(container.querySelector('.dashboard-empty-state')).toBeNull();
    expect(container.textContent).toContain('mlearn.Statistics.Legend.Learned');
    expect(container.textContent).not.toContain('mlearn.Statistics.Dashboard.TotalCards');
    dispose();
  });

  it('keeps unassessed curriculum entries separate from measured gaps instead of claiming they were viewed', async () => {
    knownWords = 2;
    unknownWords = 3;
    unmeasuredWords = 8;
    const { Dashboard } = await import('./Dashboard');
    const dispose = render(() => <Dashboard />, container);
    await vi.waitFor(() => expect(container.querySelector('.analytics-summary')).not.toBeNull());
    const summary = container.querySelector('.analytics-summary')!;
    const values = Array.from(summary.querySelectorAll('.mock-statcard')).map(card => card.textContent);
    expect(values).toContain('mlearn.Statistics.Legend.Unknown3');
    expect(values).toContain('mlearn.Statistics.Legend.Unmeasured8');
    expect(summary.textContent).not.toContain('mlearn.Statistics.Legend.Viewed');
    expect(summary.textContent).not.toContain('NaN');
    dispose();
  });

  it('shows the boot skeleton instead of a false empty state while the learner store hydrates', async () => {
    flashcardsLoading = true;
    const { Dashboard } = await import('./Dashboard');
    const dispose = render(() => <Dashboard />, container);

    await vi.waitFor(() => {
      expect(container.querySelector('.dashboard-boot')).not.toBeNull();
      expect(container.querySelector('.skeleton-stat')).not.toBeNull();
    });
    // During hydration the zeros are not real values: neither the empty
    // state nor any populated panel may be shown.
    expect(container.textContent).not.toContain('mlearn.Statistics.Dashboard.EmptyState.Title');
    expect(container.textContent).not.toContain('mlearn.Statistics.Dashboard.DueForecast.Title');

    dispose();
  });

  it('forecasts eligible work while retaining excluded authored cards in totals', async () => {
    flashcardStoreMock.flashcards = { a: makeFlashcard('a'), b: makeFlashcard('b') };
    studyExcludedIds.add('a');
    const { Dashboard } = await import('./Dashboard');
    const dispose = render(() => <Dashboard />, container);
    const reviews = Array.from(container.querySelectorAll('nav button')).find(button => button.textContent?.endsWith('.reviews')) as HTMLButtonElement;
    reviews.click();
    await vi.waitFor(() => expect(container.textContent).toContain('DueForecast.Today'));
    const forecast = Array.from(container.querySelectorAll('.mock-statcard'))
      .find(node => node.textContent?.includes('DueForecast.Today'));
    expect(forecast?.querySelector('b')?.textContent).toBe('1');
    expect(Object.keys(flashcardStoreMock.flashcards)).toHaveLength(2);
    dispose();
  });

  it('renders the due forecast panel with 4 stat cards for populated data', async () => {
    flashcardStoreMock = {
      flashcards: { a: makeFlashcard('a'), b: makeFlashcard('b') },
      dailyStats: {},
      wordKnowledge: {},
    };

    const { Dashboard } = await import('./Dashboard');
    const dispose = render(() => <Dashboard />, container);

    const reviews = Array.from(container.querySelectorAll('nav button')).find((button) => button.textContent?.endsWith('.reviews')) as HTMLButtonElement;
    expect(container.textContent).not.toContain('mlearn.Statistics.Dashboard.DueForecast.Title');
    reviews.click();
    await vi.waitFor(() => {
      const panels = Array.from(container.querySelectorAll('.mock-panel'));
      const forecast = panels.find((p) => p.textContent?.includes('mlearn.Statistics.Dashboard.DueForecast.Title'));
      expect(forecast).toBeDefined();
      expect(forecast!.querySelectorAll('.mock-statcard')).toHaveLength(4);
    });

    dispose();
  });

  it('renders the learning velocity charts with cohort data', async () => {
    const DAY = 24 * 60 * 60 * 1000;
    const start = Date.UTC(2024, 0, 1);
    const makeEvent = (day: number, overrides: Partial<KnowledgeEvent> = {}): KnowledgeEvent => ({
      t: start + day * DAY,
      kind: 'status',
      source: 'manual',
      aspect: 'meaning',
      ...overrides,
    });
    // Same cohort story the old whole-language log told, expressed as per-key
    // store summaries: 'one' stabilizes at +5d; 'two' lapses after its +9d
    // known, so it never stabilizes (stableKnownT stays absent).
    summariesMock = {
      'ja:one': {
        firstT: start,
        lastT: start + 5 * DAY,
        exactRows: 2,
        archivedRows: 0,
        firstSenseT: start,
        firstKnownT: start + 5 * DAY,
        stableKnownT: start + 5 * DAY,
        lapsedAfterFirstKnown: false,
        acquisitionRows: [
          { event: makeEvent(0, { easeAfter: 1.3 }), seq: 0 },
          { event: makeEvent(5, { toStatus: 'known', easeAfter: 1.8 }), seq: 1 },
        ],
      },
      'ja:two': {
        firstT: start,
        lastT: start + 12 * DAY,
        exactRows: 3,
        archivedRows: 0,
        firstSenseT: start,
        firstKnownT: start + 9 * DAY,
        lapsedAfterFirstKnown: true,
        acquisitionRows: [
          { event: makeEvent(0, { easeAfter: 1.3 }), seq: 0 },
          { event: makeEvent(9, { toStatus: 'known', easeAfter: 1.8 }), seq: 1 },
          { event: makeEvent(12, { fromStatus: 'known', toStatus: 'learning' }), seq: 2 },
        ],
      },
    };
    flashcardStoreMock = {
      flashcards: { a: makeFlashcard('a') },
      dailyStats: {},
      // Summary grouping resolves each journal key to its word text.
      wordKnowledge: { 'ja:one': { word: 'one' }, 'ja:two': { word: 'two' } },
    };

    const { Dashboard } = await import('./Dashboard');
    const dispose = render(() => <Dashboard />, container);

    await vi.waitFor(() => {
      const panels = Array.from(container.querySelectorAll('.mock-panel'));
      const velocity = panels.find((p) => p.textContent?.includes('mlearn.Statistics.LearningVelocity.Title'));
      expect(velocity).toBeDefined();
      expect(velocity!.querySelectorAll('[data-testid="mock-line-chart"]')).toHaveLength(2);
      expect(velocity!.textContent).toContain('bar');
      expect(velocity!.textContent).toContain('mlearn.Statistics.LearningVelocity.DaysToKnown');
      expect(velocity!.textContent).toContain('mlearn.Statistics.LearningVelocity.AcquisitionSlope');
      expect(velocity!.textContent).toContain('mlearn.Statistics.LearningVelocity.RetentionAfterKnown');
    });

    dispose();
  });

  it('renders the empty state when the event store has no history', async () => {
    flashcardStoreMock = {
      flashcards: { a: makeFlashcard('a') },
      dailyStats: {},
      wordKnowledge: {},
    };

    const { Dashboard } = await import('./Dashboard');
    const dispose = render(() => <Dashboard />, container);

    await vi.waitFor(() => {
      const panels = Array.from(container.querySelectorAll('.mock-panel'));
      const velocity = panels.find((p) => p.textContent?.includes('mlearn.Statistics.LearningVelocity.Title'));
      expect(velocity).toBeDefined();
      expect(velocity!.textContent).toContain('mlearn.Statistics.LearningVelocity.Empty');
      expect(velocity!.querySelectorAll('[data-testid="mock-line-chart"]')).toHaveLength(0);
    });

    dispose();
  });

  it('uses the localized section title and chart labels', async () => {
    flashcardStoreMock = {
      flashcards: { a: makeFlashcard('a') },
      dailyStats: {},
      wordKnowledge: {},
    };

    const { Dashboard } = await import('./Dashboard');
    const dispose = render(() => <Dashboard />, container);

    await vi.waitFor(() => {
      const panels = Array.from(container.querySelectorAll('.mock-panel'));
      const velocity = panels.find((p) => p.textContent?.includes('mlearn.Statistics.LearningVelocity.Title'));
      expect(velocity).toBeDefined();
      expect(velocity!.querySelector('.dashboard-section-title')!.textContent)
        .toBe('mlearn.Statistics.LearningVelocity.Title');
    });

    dispose();
  });
});

vi.mock('../../hooks/useEvidenceLinkedProjections', () => ({ useEvidenceLinkedProjections: () => ({ ready: () => true, failed: () => false, retry: vi.fn(), resolveState: () => ({ status: 'unknown', basis: 'unmeasured' }) }) }));
