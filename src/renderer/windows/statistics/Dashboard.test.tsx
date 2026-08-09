// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import type { Flashcard } from '../../../shared/types';

const localizationMock = vi.fn((key: string) => key);
let flashcardStoreMock: {
  flashcards: Record<string, Flashcard>;
  dailyStats: Record<string, Record<string, { newCardsStudied: number; reviewCardsStudied: number; lapses: number; timeSpent: number; graduated: number }>>;
  wordKnowledge: Record<string, { statusChangedAtSeen?: number }>;
};
let settingsMock: { language: string; newDayHour: number; known_ease_threshold: number; srsLearningThreshold: number };

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
  }),
}));

vi.mock('../../components/common', () => ({
  StatCard: (props: { label: string; value: string | number }) => (
    <div class="mock-statcard"><span>{props.label}</span><b>{props.value}</b></div>
  ),
  Panel: (props: { children?: JSX.Element; class?: string }) => <div class={`mock-panel ${props.class ?? ''}`}>{props.children}</div>,
  BookIcon: () => <span>book</span>,
}));

vi.mock('./charts', () => ({
  PieChart: () => <div>pie</div>,
  BarChart: () => <div>bar</div>,
  Heatmap: () => <div>heat</div>,
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
});
