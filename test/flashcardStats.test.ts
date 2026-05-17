import { describe, it, expect } from 'vitest';
import type { Flashcard, DailyStudyStats } from '../src/shared/types';
import {
  computeStateDistribution,
  computeEaseDistribution,
  computeIntervalDistribution,
  computeMaturityBreakdown,
  computeRetentionStats,
  computeAverageEase,
  computeDailyActivity,
  computeDueCounts,
  computeStreaks,
  getTodayStats,
} from '../src/renderer/services/flashcardStats';

function makeCard(overrides: Partial<Flashcard> = {}): Flashcard {
  return {
    id: 'test-id',
    content: { front: 'test', back: 'back' },
    state: 'new',
    ease: 2.5,
    interval: 0,
    dueDate: Date.now() + 86400000,
    createdAt: Date.now(),
    lastUpdated: Date.now(),
    lastReviewed: 0,
    reviews: 0,
    lapses: 0,
    learningStep: 0,
    suspended: false,
    buried: false,
    language: 'en',
    ...overrides,
  };
}

describe('computeStateDistribution', () => {
  it('counts all states correctly', () => {
    const cards: Flashcard[] = [
      makeCard({ state: 'new' }),
      makeCard({ state: 'learning' }),
      makeCard({ state: 'review' }),
      makeCard({ state: 'relearning' }),
      makeCard({ suspended: true, state: 'review' }),
      makeCard({ buried: true, state: 'new' }),
    ];
    const dist = computeStateDistribution(cards);
    expect(dist.new).toBe(1);
    expect(dist.learning).toBe(2); // learning + relearning
    expect(dist.review).toBe(1);
    expect(dist.suspended).toBe(1);
    expect(dist.buried).toBe(1);
    expect(dist.total).toBe(6);
  });

  it('handles empty array', () => {
    const dist = computeStateDistribution([]);
    expect(dist.total).toBe(0);
    expect(dist.new).toBe(0);
    expect(dist.learning).toBe(0);
    expect(dist.review).toBe(0);
    expect(dist.suspended).toBe(0);
    expect(dist.buried).toBe(0);
  });
});

describe('computeEaseDistribution', () => {
  it('buckets graduated cards correctly', () => {
    const cards: Flashcard[] = [
      makeCard({ state: 'review', ease: 1.3 }),
      makeCard({ state: 'review', ease: 1.6 }),
      makeCard({ state: 'review', ease: 1.9 }),
      makeCard({ state: 'review', ease: 2.3 }),
      makeCard({ state: 'review', ease: 2.7 }),
      makeCard({ state: 'review', ease: 3.1 }),
      makeCard({ state: 'new', ease: 2.5 }),           // ignored
      makeCard({ state: 'review', ease: 2.5, suspended: true }), // ignored
    ];
    const dist = computeEaseDistribution(cards);
    expect(dist[0].count).toBe(1); // <1.5
    expect(dist[1].count).toBe(1); // 1.5-1.8
    expect(dist[2].count).toBe(1); // 1.8-2.1
    expect(dist[3].count).toBe(1); // 2.1-2.5
    expect(dist[4].count).toBe(1); // 2.5-3.0
    expect(dist[5].count).toBe(1); // 3.0+
  });

  it('returns zero counts for no graduated cards', () => {
    const dist = computeEaseDistribution([makeCard({ state: 'new' })]);
    expect(dist.every(b => b.count === 0)).toBe(true);
  });
});

describe('computeIntervalDistribution', () => {
  it('buckets review cards by interval', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const cards: Flashcard[] = [
      makeCard({ state: 'review', interval: 0.5 * DAY }),
      makeCard({ state: 'review', interval: 2 * DAY }),
      makeCard({ state: 'review', interval: 5 * DAY }),
      makeCard({ state: 'review', interval: 10 * DAY }),
      makeCard({ state: 'review', interval: 20 * DAY }),
      makeCard({ state: 'review', interval: 60 * DAY }),
      makeCard({ state: 'review', interval: 120 * DAY }),
      makeCard({ state: 'review', interval: 200 * DAY }),
      makeCard({ state: 'new' }), // ignored
    ];
    const dist = computeIntervalDistribution(cards);
    expect(dist[0].count).toBe(1); // <1d
    expect(dist[1].count).toBe(1); // 1-3d
    expect(dist[2].count).toBe(1); // 3-7d
    expect(dist[3].count).toBe(1); // 1-2w
    expect(dist[4].count).toBe(1); // 2w-1m
    expect(dist[5].count).toBe(1); // 1-3m
    expect(dist[6].count).toBe(1); // 3-6m
    expect(dist[7].count).toBe(1); // 6m+
  });
});

describe('computeMaturityBreakdown', () => {
  it('classifies mature vs young correctly', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const cards: Flashcard[] = [
      makeCard({ state: 'review', interval: 10 * DAY }),
      makeCard({ state: 'review', interval: 21 * DAY }),
      makeCard({ state: 'review', interval: 100 * DAY }),
      makeCard({ state: 'new' }),
      makeCard({ state: 'learning', interval: 100 * DAY }),
    ];
    const maturity = computeMaturityBreakdown(cards);
    expect(maturity.young).toBe(1);
    expect(maturity.mature).toBe(2);
    expect(maturity.total).toBe(3);
  });
});

describe('computeRetentionStats', () => {
  it('computes retention over last 30 days', () => {
    const dailyStats: Record<string, DailyStudyStats> = {
      '2024-01-01': { date: '2024-01-01', newCardsStudied: 5, reviewCardsStudied: 20, lapses: 2, timeSpent: 60000, graduated: 3 },
      '2024-01-02': { date: '2024-01-02', newCardsStudied: 3, reviewCardsStudied: 15, lapses: 1, timeSpent: 45000, graduated: 2 },
    };
    const stats = computeRetentionStats(dailyStats);
    expect(stats.retention).toBeCloseTo(((35 - 3) / 35) * 100, 1);
    expect(stats.totalReviews).toBe(35);
    expect(stats.totalLapses).toBe(3);
    expect(stats.totalNew).toBe(8);
    expect(stats.totalGraduated).toBe(5);
    expect(stats.totalTime).toBe(105000);
    expect(stats.daysStudied).toBe(2);
    expect(stats.totalDays).toBe(2);
  });

  it('returns 0 retention when no reviews', () => {
    const stats = computeRetentionStats({});
    expect(stats.retention).toBe(0);
    expect(stats.totalReviews).toBe(0);
  });

  it('limits to specified days', () => {
    const dailyStats: Record<string, DailyStudyStats> = {
      '2024-01-01': { date: '2024-01-01', newCardsStudied: 0, reviewCardsStudied: 10, lapses: 0, timeSpent: 0, graduated: 0 },
      '2024-01-02': { date: '2024-01-02', newCardsStudied: 0, reviewCardsStudied: 20, lapses: 0, timeSpent: 0, graduated: 0 },
      '2024-01-03': { date: '2024-01-03', newCardsStudied: 0, reviewCardsStudied: 30, lapses: 0, timeSpent: 0, graduated: 0 },
    };
    const stats = computeRetentionStats(dailyStats, 2);
    expect(stats.totalReviews).toBe(50);
    expect(stats.totalDays).toBe(2);
  });
});

describe('computeAverageEase', () => {
  it('averages ease of graduated cards', () => {
    const cards: Flashcard[] = [
      makeCard({ state: 'review', ease: 2.0 }),
      makeCard({ state: 'review', ease: 3.0 }),
      makeCard({ state: 'new', ease: 1.0 }),
    ];
    expect(computeAverageEase(cards)).toBe(2.5);
  });

  it('returns 0 for no graduated cards', () => {
    expect(computeAverageEase([makeCard({ state: 'new' })])).toBe(0);
  });
});

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('computeDailyActivity', () => {
  it('returns last N days with correct totals', () => {
    const today = new Date();
    const todayKey = dateKey(today);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = dateKey(yesterday);

    const dailyStats: Record<string, DailyStudyStats> = {
      [todayKey]: { date: todayKey, newCardsStudied: 5, reviewCardsStudied: 10, lapses: 0, timeSpent: 1000, graduated: 0 },
    };
    const activity = computeDailyActivity(dailyStats, 2);
    expect(activity.length).toBe(2);
    // First day should be yesterday with 0s
    expect(activity[0].date).toBe(yesterdayKey);
    expect(activity[0].total).toBe(0);
    expect(activity[0].newCards).toBe(0);
    expect(activity[0].reviews).toBe(0);
    // Second day should be today
    expect(activity[1].date).toBe(todayKey);
    expect(activity[1].total).toBe(15);
    expect(activity[1].newCards).toBe(5);
    expect(activity[1].reviews).toBe(10);
    expect(activity[1].timeSpent).toBe(1000);
  });
});

describe('computeDueCounts', () => {
  it('counts new and due cards', () => {
    const now = Date.now();
    const cards: Flashcard[] = [
      makeCard({ state: 'new' }),
      makeCard({ state: 'new' }),
      makeCard({ state: 'review', dueDate: now - 1000 }),
      makeCard({ state: 'review', dueDate: now + 86400000 }),
      makeCard({ state: 'learning', dueDate: now - 1000 }),
      makeCard({ state: 'relearning', dueDate: now - 1000 }),
      makeCard({ state: 'review', dueDate: now - 1000, suspended: true }),
      makeCard({ state: 'review', dueDate: now - 1000, buried: true }),
    ];
    const due = computeDueCounts(cards, 4);
    expect(due.new).toBe(2);
    expect(due.review).toBe(1);
    expect(due.learning).toBe(1);
    expect(due.relearning).toBe(1);
    expect(due.total).toBe(5);
  });
});

describe('computeStreaks', () => {
  it('computes current and max streak', () => {
    const today = new Date();
    const todayKey = dateKey(today);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = dateKey(yesterday);
    const twoDaysAgo = new Date(today);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const twoDaysAgoKey = dateKey(twoDaysAgo);

    const dailyStats: Record<string, DailyStudyStats> = {
      [twoDaysAgoKey]: { date: twoDaysAgoKey, newCardsStudied: 1, reviewCardsStudied: 0, lapses: 0, timeSpent: 0, graduated: 0 },
      [yesterdayKey]: { date: yesterdayKey, newCardsStudied: 1, reviewCardsStudied: 0, lapses: 0, timeSpent: 0, graduated: 0 },
      [todayKey]: { date: todayKey, newCardsStudied: 0, reviewCardsStudied: 5, lapses: 0, timeSpent: 0, graduated: 0 },
    };

    const streaks = computeStreaks(dailyStats);
    expect(streaks.current).toBe(3);
    expect(streaks.max).toBe(3);
  });

  it('returns 0 for empty stats', () => {
    const streaks = computeStreaks({});
    expect(streaks.current).toBe(0);
    expect(streaks.max).toBe(0);
  });
});

describe('getTodayStats', () => {
  it('returns stats for today', () => {
    const today = dateKey(new Date());
    const dailyStats: Record<string, DailyStudyStats> = {
      [today]: { date: today, newCardsStudied: 3, reviewCardsStudied: 7, lapses: 1, timeSpent: 120000, graduated: 2 },
    };
    const stats = getTodayStats(dailyStats);
    expect(stats.newCards).toBe(3);
    expect(stats.reviews).toBe(7);
    expect(stats.lapses).toBe(1);
    expect(stats.timeSpent).toBe(120000);
    expect(stats.graduated).toBe(2);
  });

  it('returns zeros when no stats for today', () => {
    const stats = getTodayStats({});
    expect(stats.newCards).toBe(0);
    expect(stats.reviews).toBe(0);
    expect(stats.lapses).toBe(0);
    expect(stats.timeSpent).toBe(0);
    expect(stats.graduated).toBe(0);
  });
});
