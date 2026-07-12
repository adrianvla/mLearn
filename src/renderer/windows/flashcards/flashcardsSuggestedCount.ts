export function getSuggestedFlashcardBadgeCount(
  getSuggestedFlashcardsSync: () => readonly unknown[],
): number {
  return getSuggestedFlashcardsSync().length;
}
