import { describe, it, expect } from 'vitest';
import { getAnkiDueDisplayValue, shouldShowAnkiEase } from './ankiHoverPreviewLogic';

describe('shouldShowAnkiEase', () => {
  it('returns true for a positive factor', () => {
    expect(shouldShowAnkiEase(2500)).toBe(true);
  });

  it('returns false for factor of 0 (new card)', () => {
    expect(shouldShowAnkiEase(0)).toBe(false);
  });

  it('returns false for null', () => {
    expect(shouldShowAnkiEase(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(shouldShowAnkiEase(undefined)).toBe(false);
  });

  it('returns true for minimum Anki ease of 1300', () => {
    expect(shouldShowAnkiEase(1300)).toBe(true);
  });

  it('returns true for a high ease factor', () => {
    expect(shouldShowAnkiEase(3000)).toBe(true);
  });
});

describe('getAnkiDueDisplayValue', () => {
  it('returns the unseen label for new cards', () => {
    expect(getAnkiDueDisplayValue(
      { queue: 0, type: 0, due: 1 },
      () => 'never-called',
      'Unseen',
    )).toBe('Unseen');
  });

  it('formats learning card due values as epoch seconds', () => {
    expect(getAnkiDueDisplayValue(
      { queue: 1, type: 1, due: 1_700_000_000 },
      (timestamp) => String(timestamp),
      'Unseen',
    )).toBe('1700000000000');
  });

  it('formats review cards using mod plus interval when due is collection-relative', () => {
    expect(getAnkiDueDisplayValue(
      { queue: 2, type: 2, due: 770, interval: 413, mod: 1_740_096_356 },
      (timestamp) => String(timestamp),
      'Unseen',
    )).toBe(String(1_740_096_356_000 + 413 * 24 * 60 * 60 * 1000));
  });
});
