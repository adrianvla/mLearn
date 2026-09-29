/**
 * One vocabulary for the "Add all" confirmation, so the two surfaces that show
 * it read as the same decision instead of two translations of it.
 *
 * The reader and the video sidebars share the same Add All control, but the
 * video's used to skip the confirm entirely and create the cards on the spot.
 * Sharing the labels keeps the two from drifting apart in tone as well as in
 * behaviour, without either surface hardcoding the other's wording.
 */
import type { AddAllFlashcardsModalLabels } from './AddAllFlashcardsModal';

type TranslateKey = (key: string, params?: Record<string, string>) => string;

/**
 * The confirm step for an unknown-words sidebar. `source` names the material
 * the words came from, so the prompt says what is about to become flashcards
 * rather than referring to an abstract list.
 */
export function addAllFlashcardsLabels(
  t: TranslateKey,
  source: 'reader' | 'video',
): AddAllFlashcardsModalLabels {
  const base = `mlearn.AddAllFlashcards.${source}`;
  const count = (n: number) => String(n);
  return {
    title: t(`${base}.Title`),
    wordListTitle: t(`${base}.WordListTitle`),
    levelFilter: t(`${base}.LevelFilter`),
    levelFilterDescription: t(`${base}.LevelFilterDescription`),
    dictionaryFilter: t(`${base}.DictionaryFilter`),
    dictionaryFilterDescription: t(`${base}.DictionaryFilterDescription`),
    deselectAll: t(`${base}.DeselectAll`),
    selectAll: t(`${base}.SelectAll`),
    addSelected: (n) => t(`${base}.AddSelected`, { count: count(n) }),
    addAll: (n) => t(`${base}.AddAll`, { count: count(n) }),
    addChecked: (n) => t(`${base}.AddChecked`, { count: count(n) }),
  };
}
