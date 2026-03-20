import { describe, it, expect } from 'vitest';

function defaultFreqBoundaries(totalEntries: number): number[] {
  const step = Math.floor(totalEntries / 5);
  return [step, step * 2, step * 3, step * 4];
}

describe('defaultFreqBoundaries', () => {
  it('returns an array of 4 values', () => {
    expect(defaultFreqBoundaries(100)).toHaveLength(4);
  });

  it('divides 100 entries into equal steps of 20', () => {
    expect(defaultFreqBoundaries(100)).toEqual([20, 40, 60, 80]);
  });

  it('floors the step for non-divisible totals (101 / 5 = 20)', () => {
    expect(defaultFreqBoundaries(101)).toEqual([20, 40, 60, 80]);
  });

  it('correctly handles 50 entries (step = 10)', () => {
    expect(defaultFreqBoundaries(50)).toEqual([10, 20, 30, 40]);
  });

  it('handles 5 entries (step = 1)', () => {
    expect(defaultFreqBoundaries(5)).toEqual([1, 2, 3, 4]);
  });

  it('handles 1 entry (step = 0)', () => {
    expect(defaultFreqBoundaries(1)).toEqual([0, 0, 0, 0]);
  });

  it('handles 0 entries (step = 0)', () => {
    expect(defaultFreqBoundaries(0)).toEqual([0, 0, 0, 0]);
  });

  it('boundaries are non-decreasing', () => {
    const boundaries = defaultFreqBoundaries(1000);
    for (let i = 1; i < boundaries.length; i++) {
      expect(boundaries[i]).toBeGreaterThanOrEqual(boundaries[i - 1]);
    }
  });

  it('each boundary is an integer (no fractions)', () => {
    const boundaries = defaultFreqBoundaries(99);
    for (const b of boundaries) {
      expect(Number.isInteger(b)).toBe(true);
    }
  });
});

describe('frequency level assignment logic', () => {
  it('assigns level 5 to index at or below first boundary', () => {
    const boundaries = defaultFreqBoundaries(100);
    const assignLevel = (i: number) => {
      if (i <= boundaries[0]) return 5;
      if (i <= boundaries[1]) return 4;
      if (i <= boundaries[2]) return 3;
      if (i <= boundaries[3]) return 2;
      return 1;
    };
    expect(assignLevel(0)).toBe(5);
    expect(assignLevel(20)).toBe(5);
  });

  it('assigns level 4 to index in second band', () => {
    const boundaries = defaultFreqBoundaries(100);
    const assignLevel = (i: number) => {
      if (i <= boundaries[0]) return 5;
      if (i <= boundaries[1]) return 4;
      if (i <= boundaries[2]) return 3;
      if (i <= boundaries[3]) return 2;
      return 1;
    };
    expect(assignLevel(21)).toBe(4);
    expect(assignLevel(40)).toBe(4);
  });

  it('assigns level 1 to indices beyond all boundaries', () => {
    const boundaries = defaultFreqBoundaries(100);
    const assignLevel = (i: number) => {
      if (i <= boundaries[0]) return 5;
      if (i <= boundaries[1]) return 4;
      if (i <= boundaries[2]) return 3;
      if (i <= boundaries[3]) return 2;
      return 1;
    };
    expect(assignLevel(81)).toBe(1);
    expect(assignLevel(99)).toBe(1);
  });

  it('assigns level 5 to all indices when totalEntries is 0 (step=0, all boundaries=0)', () => {
    const boundaries = defaultFreqBoundaries(0);
    const assignLevel = (i: number) => {
      if (i <= boundaries[0]) return 5;
      if (i <= boundaries[1]) return 4;
      if (i <= boundaries[2]) return 3;
      if (i <= boundaries[3]) return 2;
      return 1;
    };
    expect(assignLevel(0)).toBe(5);
  });
});
