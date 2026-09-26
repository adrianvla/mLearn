import type { LanguageData } from '../../../shared/types';
import {
  compareFrequencyLevelsByDifficulty,
  isFrequencyLevelAtOrEasierThanTarget,
} from '../../../shared/languageFeatures';

/** Put the selected curriculum level first, then nearby levels in the
 * package's difficulty order. Entries without package frequency stay browsable
 * after scoped material; their original order is preserved. */
export function sortByStudyScope<T extends { level: number | null }>(
  entries: readonly T[],
  target: number | null,
  languageData: LanguageData | null | undefined,
  compareWithinLevel?: (left: T, right: T) => number,
): T[] {
  const tier = (level: number | null): number => {
    if (level === null || !Number.isFinite(level)) return 3;
    if (target === null) return 0;
    if (level === target) return 0;
    return isFrequencyLevelAtOrEasierThanTarget(level, target, languageData) ? 1 : 2;
  };
  return entries.map((entry, index) => ({ entry, index })).sort((left, right) => {
    const leftTier = tier(left.entry.level);
    const rightTier = tier(right.entry.level);
    if (leftTier !== rightTier) return leftTier - rightTier;
    if (left.entry.level !== null && right.entry.level !== null) {
      const byDifficulty = compareFrequencyLevelsByDifficulty(
        left.entry.level, right.entry.level, languageData,
        target === null || leftTier === 2 ? 'easiest-to-hardest' : 'hardest-to-easiest',
      );
      if (byDifficulty !== 0) return byDifficulty;
    }
    return compareWithinLevel?.(left.entry, right.entry) || left.index - right.index;
  }).map(({ entry }) => entry);
}
