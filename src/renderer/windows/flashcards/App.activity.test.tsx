import { describe, expect, it } from 'vitest';

import { getFlashcardsAppActivity } from './App';

describe('getFlashcardsAppActivity', () => {
  it('returns flashcards activity for review mode', () => {
    expect(getFlashcardsAppActivity('review')).toEqual({ kind: 'flashcards' });
  });

  it('returns idle for non-review tabs', () => {
    expect(getFlashcardsAppActivity('browse')).toEqual({ kind: 'idle' });
  });
});
