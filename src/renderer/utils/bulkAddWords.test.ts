import { describe, it, expect, vi } from 'vitest';
import { bulkAddWords } from './bulkAddWords';

interface Entry {
  word: string;
}

function makeOpts(overrides: Partial<Parameters<typeof bulkAddWords<Entry>>[0]> = {}) {
  const tracked = new Map<string, string>([['脂', '脂']]);
  const updated: Array<[string, number]> = [];
  const added: string[] = [];
  return {
    opts: {
      entries: [{ word: '脂' }, { word: '油' }] as Entry[],
      wordOf: (e: Entry) => e.word,
      trackedAnkiWordOf: (word: string) => tracked.get(word) ?? null,
      formsOf: (word: string) => [word],
      statusOf: () => 0,
      updateWordCards: async (ankiWord: string, ease: number) => { updated.push([ankiWord, ease]); },
      addFlashcard: async (e: Entry) => { added.push(e.word); },
      onEntryError: vi.fn(),
      ...overrides,
    },
    updated,
    added,
  };
}

describe('bulkAddWords', () => {
  it('routes anki-tracked words to card updates and the rest to flashcards', async () => {
    const { opts, updated, added } = makeOpts();
    const updatedAny = await bulkAddWords(opts);

    expect(updatedAny).toBe(true);
    expect(updated).toEqual([['脂', 1550]]);
    expect(added).toEqual(['油']);
  });

  it('returns false and skips updates when nothing is anki-tracked', async () => {
    const { opts } = makeOpts({ trackedAnkiWordOf: () => null });
    expect(await bulkAddWords(opts)).toBe(false);
  });

  it('honors the skip predicate and continues past per-entry failures', async () => {
    const { opts, updated, added } = makeOpts({
      entries: [{ word: '脂' }, { word: '油' }, { word: '山' }] as Entry[],
      skip: (e) => e.word === '脂',
      updateWordCards: async () => { throw new Error('anki down'); },
      onEntryError: vi.fn(),
      trackedAnkiWordOf: (word: string) => (word === '山' ? word : null),
    });
    const updatedAny = await bulkAddWords(opts);

    expect(updatedAny).toBe(false);
    expect(opts.onEntryError).toHaveBeenCalledTimes(1);
    expect(updated).toEqual([]);
    expect(added).toEqual(['油']);
  });
});
