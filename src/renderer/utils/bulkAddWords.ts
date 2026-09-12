export interface BulkAddWordsOptions<E> {
  entries: readonly E[];
  addFlashcard: (entry: E) => Promise<void>;
  skip?: (entry: E) => boolean;
  onEntryError: (entry: E, err: unknown) => void;
}

export async function bulkAddWords<E>(opts: BulkAddWordsOptions<E>): Promise<void> {
  for (const entry of opts.entries) {
    if (opts.skip?.(entry)) continue;
    try {
      await opts.addFlashcard(entry);
    } catch (err) {
      opts.onEntryError(entry, err);
    }
  }
}
