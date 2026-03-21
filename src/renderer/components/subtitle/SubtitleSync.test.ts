import { describe, it, expect } from 'vitest';
import { findCurrentOrPreviousSub, findNextSub, findPreviousSubForSync } from './SubtitleSync';

const SUBTITLES = [
  { start: 1, end: 3, text: 'First' },
  { start: 5, end: 8, text: 'Second' },
  { start: 10, end: 12, text: 'Third' },
];

describe('findCurrentOrPreviousSub', () => {
  it('returns the subtitle when time is inside it', () => {
    const result = findCurrentOrPreviousSub(SUBTITLES, 6);
    expect(result).toBe(SUBTITLES[1]);
  });

  it('returns the subtitle at exact start time', () => {
    const result = findCurrentOrPreviousSub(SUBTITLES, 5);
    expect(result).toBe(SUBTITLES[1]);
  });

  it('returns the subtitle at exact end time', () => {
    const result = findCurrentOrPreviousSub(SUBTITLES, 8);
    expect(result).toBe(SUBTITLES[1]);
  });

  it('returns the previous subtitle when in a gap between subs', () => {
    const result = findCurrentOrPreviousSub(SUBTITLES, 4);
    expect(result).toBe(SUBTITLES[0]);
  });

  it('returns the last subtitle when time is after all subs', () => {
    const result = findCurrentOrPreviousSub(SUBTITLES, 15);
    expect(result).toBe(SUBTITLES[2]);
  });

  it('returns null when time is before all subtitles', () => {
    const result = findCurrentOrPreviousSub(SUBTITLES, 0.5);
    expect(result).toBeNull();
  });

  it('returns null for empty subtitle array', () => {
    const result = findCurrentOrPreviousSub([], 5);
    expect(result).toBeNull();
  });

  it('returns null for undefined subtitles', () => {
    const result = findCurrentOrPreviousSub(undefined, 5);
    expect(result).toBeNull();
  });

  it('returns the second sub when in the gap after it', () => {
    const result = findCurrentOrPreviousSub(SUBTITLES, 9);
    expect(result).toBe(SUBTITLES[1]);
  });
});

describe('findNextSub', () => {
  it('returns the next subtitle when in a gap', () => {
    const result = findNextSub(SUBTITLES, 4);
    expect(result).toBe(SUBTITLES[1]);
  });

  it('returns the next subtitle when inside a subtitle', () => {
    const result = findNextSub(SUBTITLES, 6);
    expect(result).toBe(SUBTITLES[2]);
  });

  it('returns the first subtitle when time is before all subs', () => {
    const result = findNextSub(SUBTITLES, 0);
    expect(result).toBe(SUBTITLES[0]);
  });

  it('returns null when time is after all subtitles', () => {
    const result = findNextSub(SUBTITLES, 15);
    expect(result).toBeNull();
  });

  it('returns null for empty subtitle array', () => {
    const result = findNextSub([], 5);
    expect(result).toBeNull();
  });

  it('returns null for undefined subtitles', () => {
    const result = findNextSub(undefined, 5);
    expect(result).toBeNull();
  });

  it('returns the third subtitle when at exact end of second', () => {
    const result = findNextSub(SUBTITLES, 8);
    expect(result).toBe(SUBTITLES[2]);
  });
});

describe('findPreviousSubForSync', () => {
  it('returns the previous subtitle when inside a subtitle', () => {
    const result = findPreviousSubForSync(SUBTITLES, 6);
    expect(result).toBe(SUBTITLES[0]);
  });

  it('returns null when inside the first subtitle', () => {
    const result = findPreviousSubForSync(SUBTITLES, 2);
    expect(result).toBeNull();
  });

  it('returns the last subtitle before a gap', () => {
    const result = findPreviousSubForSync(SUBTITLES, 4);
    expect(result).toBe(SUBTITLES[0]);
  });

  it('returns the previous subtitle when at exact start of a subtitle', () => {
    const result = findPreviousSubForSync(SUBTITLES, 5);
    expect(result).toBe(SUBTITLES[0]);
  });

  it('returns the previous subtitle when at exact end of a subtitle', () => {
    const result = findPreviousSubForSync(SUBTITLES, 8);
    expect(result).toBe(SUBTITLES[0]);
  });

  it('returns the second subtitle when in the gap after it', () => {
    const result = findPreviousSubForSync(SUBTITLES, 9);
    expect(result).toBe(SUBTITLES[1]);
  });

  it('returns the last subtitle when time is after all subs', () => {
    const result = findPreviousSubForSync(SUBTITLES, 15);
    expect(result).toBe(SUBTITLES[2]);
  });

  it('returns null when time is before all subtitles', () => {
    const result = findPreviousSubForSync(SUBTITLES, 0.5);
    expect(result).toBeNull();
  });

  it('returns null for empty subtitle array', () => {
    const result = findPreviousSubForSync([], 5);
    expect(result).toBeNull();
  });

  it('returns null for undefined subtitles', () => {
    const result = findPreviousSubForSync(undefined, 5);
    expect(result).toBeNull();
  });

  it('steps backward through subtitles on repeated calls', () => {
    // Simulate repeated backward presses: start at sub[2], go to sub[1], then sub[0]
    const videoTime = 11; // Inside third subtitle

    // First press: inside sub[2] → returns sub[1]
    const first = findPreviousSubForSync(SUBTITLES, videoTime);
    expect(first).toBe(SUBTITLES[1]);

    // Second press: adjustedTime would be sub[1].start = 5 → inside sub[1] → returns sub[0]
    const second = findPreviousSubForSync(SUBTITLES, 5);
    expect(second).toBe(SUBTITLES[0]);

    // Third press: adjustedTime would be sub[0].start = 1 → inside sub[0] → returns null
    const third = findPreviousSubForSync(SUBTITLES, 1);
    expect(third).toBeNull();
  });
});
