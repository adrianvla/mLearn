import { describe, expect, it, vi } from 'vitest';

import { getSuggestedFlashcardBadgeCount } from './flashcardsSuggestedCount';

describe('getSuggestedFlashcardBadgeCount', () => {
  it('counts only suggestions returned by the visible-suggestions selector', () => {
    const getSuggestedFlashcardsSync = vi.fn(() => Array.from({ length: 7 }, (_, index) => ({ id: `visible-${index}` })));

    expect(getSuggestedFlashcardBadgeCount(getSuggestedFlashcardsSync)).toBe(7);
    expect(getSuggestedFlashcardsSync).toHaveBeenCalledOnce();
  });
});
