import { describe, expect, it } from 'vitest';

import { getSessionProgress } from './flashcardReviewSession';

describe('getSessionProgress', () => {
  it('returns 100 when there is no active session workload', () => {
    expect(getSessionProgress(0, 0)).toBe(100);
  });

  it('accounts for queued follow-up reviews created during the session', () => {
    expect(getSessionProgress(1, 1)).toBe(50);
    expect(getSessionProgress(1, 2)).toBe(33);
  });

  it('clamps negative inputs before calculating progress', () => {
    expect(getSessionProgress(-2, 3)).toBe(0);
    expect(getSessionProgress(3, -2)).toBe(100);
  });
});