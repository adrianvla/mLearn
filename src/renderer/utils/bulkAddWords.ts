import { ANKI_EASE, WORD_STATUS } from '../../shared/constants';
import { getAnkiEaseForStatus, numericToWordStatus } from '../components/subtitle/wordHoverHelpers';

export interface BulkAddWordsOptions<E> {
  entries: readonly E[];
  wordOf: (entry: E) => string;
  trackedAnkiWordOf: (word: string) => string | null;
  formsOf: (word: string) => string[];
  statusOf: (word: string, aliases: readonly string[]) => number;
  updateWordCards: (ankiWord: string, ease: number) => Promise<unknown>;
  addFlashcard: (entry: E) => Promise<void>;
  skip?: (entry: E) => boolean;
  onEntryError: (entry: E, err: unknown) => void;
}

/**
 * Route each sidebar word to its tracker: Anki-tracked words get their cards
 * updated to the app's stored status; the rest get in-app flashcards.
 * Returns true when any Anki card was updated — the caller refreshes the anki
 * words cache once afterwards (never per-entry).
 */
export async function bulkAddWords<E>(opts: BulkAddWordsOptions<E>): Promise<boolean> {
  let updatedAny = false;
  for (const entry of opts.entries) {
    if (opts.skip?.(entry)) continue;
    const word = opts.wordOf(entry);
    const trackedAnkiWord = opts.trackedAnkiWordOf(word);
    if (trackedAnkiWord) {
      const forms = opts.formsOf(word);
      const storedStatus = opts.statusOf(forms[0] ?? word, forms.slice(1));
      const status = numericToWordStatus(storedStatus === WORD_STATUS.UNKNOWN ? WORD_STATUS.LEARNING : storedStatus);
      const ankiEase = getAnkiEaseForStatus(status, ANKI_EASE.DEFAULT_LEARNING, ANKI_EASE.DEFAULT_KNOWN);
      try {
        await opts.updateWordCards(trackedAnkiWord, ankiEase);
        updatedAny = true;
      } catch (err) {
        opts.onEntryError(entry, err);
      }
    } else {
      await opts.addFlashcard(entry);
    }
  }
  return updatedAny;
}
