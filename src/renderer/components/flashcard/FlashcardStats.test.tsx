// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { Flashcard, DailyStudyStats } from '../../../shared/types';
import { FlashcardStats } from './FlashcardStats';

const mocks = vi.hoisted(() => {
  const store = {
    dailyStats: {} as Record<string, Record<string, DailyStudyStats>>,
    meta: {
      maxNewCardsPerDayLearning: 20,
      maxReviewsPerDay: 100,
      newCardsToday: 0,
      reviewsToday: 0,
    },
  };
  return {
    store,
    getAllCards: vi.fn((): Flashcard[] => []),
    updateMeta: vi.fn(),
    t: vi.fn((key: string) => key),
  };
});

vi.mock('../../context', () => ({
  useFlashcards: () => ({
    store: mocks.store,
    getAllCards: mocks.getAllCards,
    updateMeta: mocks.updateMeta,
  }),
  useSettings: () => ({
    settings: {
      newDayHour: 4,
      easeThresholdUnknown: 1.5,
      easeThresholdLearning: 2.0,
      easeThresholdKnown: 2.5,
      easeThresholdMastered: 3.0,
    },
  }),
  useLocalization: () => ({ t: mocks.t }),
}));

function dayStats(overrides: Partial<DailyStudyStats>): DailyStudyStats {
  return {
    date: '2026-08-01',
    newCardsStudied: 0,
    reviewCardsStudied: 0,
    lapses: 0,
    timeSpent: 0,
    graduated: 0,
    ...overrides,
  };
}

function mount(): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  render(() => <FlashcardStats />, container);
  return container;
}

describe('FlashcardStats', () => {
  beforeEach(() => {
    mocks.store.dailyStats = {};
    mocks.store.meta = {
      maxNewCardsPerDayLearning: 20,
      maxReviewsPerDay: 100,
      newCardsToday: 0,
      reviewsToday: 0,
    };
    mocks.getAllCards.mockReturnValue([]);
    mocks.t.mockImplementation((key: string) => key);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders an em-dash retention value when there are no reviews', () => {
    const container = mount();
    const value = container.querySelector('.stats-metric-retention--default');
    expect(value).not.toBeNull();
    expect(value?.textContent?.trim()).toBe('—');
    expect(container.querySelector('.stats-metric-retention--success')).toBeNull();
  });

  it('applies the success modifier class for a high retention rate', () => {
    mocks.store.dailyStats = {
      '2026-08-01': { en: dayStats({ reviewCardsStudied: 10, lapses: 0 }) },
    };
    const container = mount();
    const value = container.querySelector('.stats-metric-retention--success');
    expect(value).not.toBeNull();
    expect(value?.textContent?.trim()).toBe('100.0%');
  });

  it('applies the error modifier class for a low retention rate', () => {
    mocks.store.dailyStats = {
      '2026-08-01': { en: dayStats({ reviewCardsStudied: 10, lapses: 5 }) },
    };
    const container = mount();
    const value = container.querySelector('.stats-metric-retention--error');
    expect(value).not.toBeNull();
    expect(value?.textContent?.trim()).toBe('50.0%');
  });

  it('marks all five canvases as accessible images with non-empty labels', () => {
    const container = mount();
    const canvases = container.querySelectorAll('canvas');
    expect(canvases.length).toBe(5);
    canvases.forEach((canvas) => {
      expect(canvas.getAttribute('role')).toBe('img');
      const label = canvas.getAttribute('aria-label');
      expect(label).not.toBeNull();
      expect((label ?? '').length).toBeGreaterThan(0);
    });
  });

  it('renders a visually hidden data list beside every chart', () => {
    const container = mount();
    const lists = container.querySelectorAll('.visually-hidden');
    expect(lists.length).toBe(5);
    lists.forEach((list) => {
      expect(list.querySelectorAll('li').length).toBeGreaterThan(0);
    });
  });

  it('renders daily activity hidden entries as date plus review/new counts', () => {
    mocks.store.dailyStats = {
      '2026-08-01': { en: dayStats({ newCardsStudied: 3, reviewCardsStudied: 7 }) },
    };
    const container = mount();
    expect(container.textContent).toContain('2026-08-01: 7/3');
  });

  it('uses the localized key for interval bucket labels in the hidden list', () => {
    mocks.t.mockImplementation((key: string) => (key === 'mlearn.Statistics.Intervals.Gt6m' ? '6 months+' : key));
    const container = mount();
    const text = container.textContent ?? '';
    expect(text).toContain('6 months+');
  });

  it('renders all titled cards with an h2', () => {
    const container = mount();
    expect(container.querySelectorAll('h2').length).toBe(7);
    expect(container.querySelectorAll('h3').length).toBe(0);
  });
});
