import { expect, it } from 'vitest';
import { analyticsRangeError } from './AnalyticsFilters';

it('accepts at most 366 days and rejects reversed or longer custom ranges', () => {
  const day = 86_400_000;

  expect(analyticsRangeError({ from: 1_700_000_000_000, to: 1_700_000_000_000 + 366 * day })).toBeNull();
  expect(analyticsRangeError({ from: 1_700_000_000_000, to: 1_700_000_000_000 })).toBe('Choose a range from one to 366 days.');
  expect(analyticsRangeError({ from: 1_700_000_000_000, to: 1_700_000_000_000 + 366 * day + 1 })).toBe('Choose a range from one to 366 days.');
});
