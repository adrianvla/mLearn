import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';

import { createSuggestedVirtualRowItems, getSuggestedCardHeight } from './flashcardsSuggestedVirtualRows';

describe('createSuggestedVirtualRowItems', () => {
  it('allocates more vertical space when cards are narrow enough for four columns', () => {
    expect(getSuggestedCardHeight(3)).toBe(250);
    expect(getSuggestedCardHeight(4)).toBe(280);
  });

  it('updates an existing virtual row when the filtered suggestions change', () => {
    createRoot((dispose) => {
      const [items, setItems] = createSignal(['first', 'second', 'third']);
      const rowItems = createSuggestedVirtualRowItems(items, () => 0, () => 2);

      expect(rowItems()).toEqual(['first', 'second']);
      setItems(['second', 'third']);
      expect(rowItems()).toEqual(['second', 'third']);
      dispose();
    });
  });
});
