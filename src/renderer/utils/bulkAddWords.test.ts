import { describe, it, expect, vi } from 'vitest';
import { bulkAddWords } from './bulkAddWords';

describe('bulkAddWords', () => {
  it('adds every requested mLearn card independently of existing Anki integration', async () => {
    const entries = [{ word: 'first', anki: true }, { word: 'second', anki: false }];
    const addFlashcard = vi.fn(async () => {});
    await bulkAddWords({ entries, addFlashcard, onEntryError: vi.fn() });
    expect(addFlashcard.mock.calls).toEqual([[entries[0]], [entries[1]]]);
  });

  it('skips existing cards and continues after an individual creation failure', async () => {
    const failure = new Error('cannot create card');
    const entries = ['existing', 'failed', 'added'];
    const added: string[] = [];
    const onEntryError = vi.fn();
    await bulkAddWords({
      entries,
      skip: (entry) => entry === 'existing',
      addFlashcard: async (entry) => {
        if (entry === 'failed') throw failure;
        added.push(entry);
      },
      onEntryError,
    });
    expect(added).toEqual(['added']);
    expect(onEntryError).toHaveBeenCalledExactlyOnceWith('failed', failure);
  });
});
