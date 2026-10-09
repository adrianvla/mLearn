import { describe, expect, it } from 'vitest';
import { homeLifetimeReviewTotals, goalDeadlineDayDifference } from './homeLearningSummary';
describe('Home uses recorded owners without inventing learning', () => {
  it('counts every saved daily review for the requested language rather than a rolling 30-day window', () => {
    const daily = Object.fromEntries(Array.from({ length: 45 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 7, index + 1)).toISOString().slice(0, 10);
      return [date, { future: { date, newCardsStudied: 1, reviewCardsStudied: 2, lapses: 0, timeSpent: 3, graduated: 0 },
        other: { date, newCardsStudied: 100, reviewCardsStudied: 100, lapses: 0, timeSpent: 100, graduated: 0 } }];
    }));
    expect(homeLifetimeReviewTotals(daily, 'future')).toEqual({ reviews: 90, newCardResponses: 45 });
    expect(homeLifetimeReviewTotals({}, 'future')).toEqual({ reviews: 0, newCardResponses: 0 });
  });
  it('uses the goal assessment date without treating due-today as overdue or invalid dates as zero', () => {
    const now = Date.parse('2026-10-09T14:00:00Z');
    expect(goalDeadlineDayDifference('2026-10-09', now)).toBe(0);
    expect(goalDeadlineDayDifference('2026-10-10', now)).toBe(1);
    expect(goalDeadlineDayDifference('2026-10-08', now)).toBe(-1);
    expect(goalDeadlineDayDifference('2026-02-31', now)).toBeUndefined();
    expect(goalDeadlineDayDifference(undefined, now)).toBeUndefined();
  });
});
