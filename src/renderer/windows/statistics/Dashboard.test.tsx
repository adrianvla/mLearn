// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import type { Flashcard } from '../../../shared/types';
import type { KnowledgeEvent } from '../../../shared/knowledgeEvents';

const localizationMock = vi.fn((key: string) => key);
let flashcardStoreMock: {
  flashcards: Record<string, Flashcard>;
  dailyStats: Record<string, Record<string, { newCardsStudied: number; reviewCardsStudied: number; lapses: number; timeSpent: number; graduated: number }>>;
  wordKnowledge: Record<string, { statusChangedAtSeen?: number }>;
};
let settingsMock: { language: string; newDayHour: number; known_ease_threshold: number; srsLearningThreshold: number };
let eventLogMock: Record<string, KnowledgeEvent[]> = {};

vi.mock('../../context', () => ({
  useFlashcards: () => ({ store: flashcardStoreMock }),
  useSettings: () => ({ settings: settingsMock }),
  useLanguage: () => ({
    getWordFrequency: () => ({}),
    currentLangData: () => ({}),
    getFreqLevelNames: () => ({}),
    getLanguageFeatures: () => ({ supportsFrequencyLevels: false }),
    getCanonicalFormForLanguage: () => null,
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
      onMediaStatsList: () => () => {},
      listMediaStats: () => {},
    },
    knowledgeEvents: {
      queryKnowledgeEventsForLanguage: () => Promise.resolve(eventLogMock),
      onKnowledgeEventsChanged: () => () => {},
    },
  }),
}));

vi.mock('../../components/common', () => ({
  StatCard: (props: { label: string; value: string | number }) => (
    <div class="mock-statcard"><span>{props.label}</span><b>{props.value}</b></div>
  ),
  Panel: (props: { children?: JSX.Element; class?: string }) => <div class={`mock-panel ${props.class ?? ''}`}>{props.children}</div>,
  BookIcon: () => <span>book</span>,
  Input: (props: { placeholder?: string }) => <input placeholder={props.placeholder} />,
  KnowledgeHistoryGraph: () => <div data-testid="mock-knowledge-history-graph" />,
}));

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
    settingsMock = { language: 'ja', newDayHour: 4, known_ease_threshold: 1.8, srsLearningThreshold: 3 };
    eventLogMock = {};
    localizationMock.mockImplementation((key: string) => key);
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
    eventLogMock = {
      'ja:one': [
        makeEvent(0, { easeAfter: 1.3 }),
        makeEvent(5, { toStatus: 'known', easeAfter: 1.8 }),
      ],
      'ja:two': [
        makeEvent(0, { easeAfter: 1.3 }),
        makeEvent(9, { toStatus: 'known', easeAfter: 1.8 }),
        makeEvent(12, { fromStatus: 'known', toStatus: 'learning' }),
      ],
    };
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
    eventLogMock = {
      'ja:one': [
        { t: Date.UTC(2024, 0, 1), kind: 'status', source: 'manual', aspect: 'meaning', easeAfter: 1.3 },
        { t: Date.UTC(2024, 0, 6), kind: 'status', source: 'manual', aspect: 'meaning', toStatus: 'known', easeAfter: 1.8 },
      ],
    };
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
