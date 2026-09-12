// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import type { Flashcard } from '../../../shared/types';
import type { KnowledgeEvent } from '../../../shared/knowledgeEvents';
import type { KeyHistorySummary } from '../../../shared/knowledge/historyQueries';

const localizationMock = vi.fn((key: string) => key);
let flashcardStoreMock: {
  flashcards: Record<string, Flashcard>;
  dailyStats: Record<string, Record<string, { newCardsStudied: number; reviewCardsStudied: number; lapses: number; timeSpent: number; graduated: number }>>;
  wordKnowledge: Record<string, { word?: string; statusChangedAtSeen?: number }>;
};
let settingsMock: { language: string; newDayHour: number; easeThresholdKnown: number; easeThresholdLearning: number };
let summariesMock: Record<string, KeyHistorySummary> = {};
let knowledgeEventsChanged: (() => void) | null = null;
let flashcardsLoading = false;

vi.mock('../../context', () => ({
  useFlashcards: () => ({ store: flashcardStoreMock, isKnowledgeReady: () => true, isLoading: () => flashcardsLoading }),
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
    allEncountered: { known: 0, learning: 0, unknown: 0, total: 0 },
    byLevel: [],
    outsideLevels: { total: 0, known: 0, learning: 0, unknown: 0 },
  }),
}));

vi.mock('../../../shared/bridges', () => ({
  getBridge: () => ({
    mediaStats: {
      onMediaStatsList: (callback: (stats: unknown[]) => void) => { callback([]); return () => {}; },
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
  KnowledgeSkeleton: actual.KnowledgeSkeleton,
  SkeletonCard: actual.SkeletonCard,
  SkeletonStatGrid: actual.SkeletonStatGrid,
  StatCard: (props: { label: string; value: string | number }) => (
    <div class="mock-statcard"><span>{props.label}</span><b>{props.value}</b></div>
  ),
  Panel: (props: { children?: JSX.Element; class?: string }) => <div class={`mock-panel ${props.class ?? ''}`}>{props.children}</div>,
  BookIcon: () => <span>book</span>,
  Input: (props: { placeholder?: string }) => <input placeholder={props.placeholder} />,
  KnowledgeHistoryGraph: () => <div data-testid="mock-knowledge-history-graph" />,
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
    flashcardStoreMock = { flashcards: {}, dailyStats: {}, wordKnowledge: {} };
    settingsMock = { language: 'ja', newDayHour: 4, easeThresholdKnown: 1.8, easeThresholdLearning: 3 };
    summariesMock = {};
    flashcardsLoading = false;
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

  it('renders the due forecast panel with 4 stat cards for populated data', async () => {
    flashcardStoreMock = {
      flashcards: { a: makeFlashcard('a'), b: makeFlashcard('b') },
      dailyStats: {},
      wordKnowledge: {},
    };

    const { Dashboard } = await import('./Dashboard');
    const dispose = render(() => <Dashboard />, container);

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
