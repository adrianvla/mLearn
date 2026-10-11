// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import type { Flashcard, DailyStudyStats } from '../../shared/types';
import {
  computeDueForecast,
  computeLapseStats,
  computeIntervalDistribution,
} from './flashcardStats';
import { getEndOfSRSDay } from './srsAlgorithm';

const NEW_DAY_HOUR = 4;
const DAY = 24 * 60 * 60 * 1000;

function makeFlashcard(overrides: Partial<Flashcard> = {}): Flashcard {
  return {
    id: 'card-id-1',
    content: { type: 'word', front: 'test', back: 'テスト' },
    state: 'new',
    ease: 2.5,
    interval: 0,
    dueDate: 0,
    reviews: 0,
    lapses: 0,
    learningStep: 0,
    createdAt: 1000,
    lastReviewed: 0,
    lastUpdated: 1000,
    language: 'ja',
    ...overrides,
  };
}

function makeDayStats(date: string, overrides: Partial<DailyStudyStats> = {}): DailyStudyStats {
  return {
    date,
    newCardsStudied: 0,
    reviewCardsStudied: 0,
    lapses: 0,
    timeSpent: 0,
    graduated: 0,
    ...overrides,
  };
}

describe('computeDueForecast', () => {
  const dayEnd = getEndOfSRSDay(NEW_DAY_HOUR);

  it('counts new cards in every cumulative bucket', () => {
    const cards = [makeFlashcard({ id: 'a', state: 'new' }), makeFlashcard({ id: 'b', state: 'new' })];
    const f = computeDueForecast(cards, NEW_DAY_HOUR);
    expect(f.today).toBe(2);
    expect(f.tomorrow).toBe(2);
    expect(f.next7).toBe(2);
    expect(f.next30).toBe(2);
  });

  it('excludes suspended and buried cards everywhere', () => {
    const cards = [
      makeFlashcard({ id: 'a', state: 'new' }),
      makeFlashcard({ id: 'b', state: 'new', suspended: true }),
      makeFlashcard({ id: 'c', state: 'new', buried: true }),
      makeFlashcard({ id: 'd', state: 'review', dueDate: 0, suspended: true }),
    ];
    const f = computeDueForecast(cards, NEW_DAY_HOUR);
    expect(f.today).toBe(1);
    expect(f.tomorrow).toBe(1);
    expect(f.next7).toBe(1);
    expect(f.next30).toBe(1);
  });

  it('includes dueDate === dayEnd in today and excludes dayEnd + 1ms', () => {
    const cards = [
      makeFlashcard({ id: 'at-end', state: 'review', dueDate: dayEnd }),
      makeFlashcard({ id: 'past-end', state: 'review', dueDate: dayEnd + 1 }),
    ];
    const f = computeDueForecast(cards, NEW_DAY_HOUR);
    expect(f.today).toBe(1);
    expect(f.tomorrow).toBe(2);
  });

  it('grows cumulatively across +1/+7/+30 horizons', () => {
    const cards = [
      makeFlashcard({ id: 'a', state: 'review', dueDate: dayEnd + 2 * DAY }),
      makeFlashcard({ id: 'b', state: 'review', dueDate: dayEnd + 10 * DAY }),
      makeFlashcard({ id: 'c', state: 'review', dueDate: dayEnd + 40 * DAY }),
    ];
    const f = computeDueForecast(cards, NEW_DAY_HOUR);
    expect(f.today).toBe(0);
    expect(f.tomorrow).toBe(0);
    expect(f.next7).toBe(1);
    expect(f.next30).toBe(2);
  });
});

describe('computeLapseStats', () => {
  it('returns no measured rate when the requested window has no review records', () => {
    const stats = computeLapseStats({}, 30, Date.parse('2024-01-30T12:00:00'));
    expect(stats.totalDays).toBe(30);
    expect(stats.lapseRate).toBe(0);
    expect(stats.totalReviews).toBe(0);
  });

  it('uses the last 30 calendar dates rather than 30 sparse stored records', () => {
    const daily: Record<string, DailyStudyStats> = {
      '2023-12-31': makeDayStats('2023-12-31', { reviewCardsStudied: 100, lapses: 100 }),
      '2024-01-01': makeDayStats('2024-01-01', { reviewCardsStudied: 10, lapses: 1 }),
      '2024-01-30': makeDayStats('2024-01-30', { reviewCardsStudied: 10, lapses: 1 }),
    };
    const stats = computeLapseStats(daily, 30, Date.parse('2024-01-30T12:00:00'));
    expect(stats.totalDays).toBe(30);
    expect(stats.daysStudied).toBe(2);
    expect(stats.totalReviews).toBe(20);
    expect(stats.totalLapses).toBe(2);
    expect(stats.lapseRate).toBe(10);
  });

  it('counts recorded lapses as numerator and reviewed cards as denominator', () => {
    const daily = { '2024-01-30': makeDayStats('2024-01-30', { reviewCardsStudied: 5, lapses: 1 }) };
    const stats = computeLapseStats(daily, 30, Date.parse('2024-01-30T12:00:00'));
    expect(stats.totalReviews).toBe(5);
    expect(stats.totalLapses).toBe(1);
    expect(stats.lapseRate).toBe(20);
  });

  it('does not interpret zero lapses without review samples as full retention', () => {
    const daily = { '2024-01-30': makeDayStats('2024-01-30', { newCardsStudied: 5 }) };
    const stats = computeLapseStats(daily, 30, Date.parse('2024-01-30T12:00:00'));
    expect(stats.totalReviews).toBe(0);
    expect(stats.lapseRate).toBe(0);
  });
});

describe('computeIntervalDistribution', () => {
  it('produces exact bucket keys in order', () => {
    const buckets = computeIntervalDistribution([]);
    expect(buckets.map((b) => b.key)).toEqual([
      'Lt1d', '1t3d', '3t7d', '1t2w', '2w1m', '1t3m', '3t6m', 'Gt6m',
    ]);
  });
});
