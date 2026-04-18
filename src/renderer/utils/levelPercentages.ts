/**
 * Level Percentages Utility
 * Computes level distribution from media stats + frequency/grammar data.
 */

import type {
  LevelPercentages,
  LevelPercentageEntry,
  MediaStats,
} from '../../shared/types';

interface WordFreqLookup {
  getFrequency: (word: string) => { raw_level: number; level: string } | null;
  getFreqLevelNames: () => Record<string, string>;
}

interface GrammarLookup {
  getGrammarPoint: (pattern: string) => { level: number; levelName: string } | null | undefined;
  getGrammarLevelNames: () => Record<string, string>;
}

/**
 * Compute level distribution percentages for words encountered in a media.
 * Returns both unique-item percentages and occurrence-weighted percentages.
 */
export function computeWordLevelPercentages(
  stats: MediaStats,
  freqLookup: WordFreqLookup,
): LevelPercentages {
  const levelNames = freqLookup.getFreqLevelNames();
  const levels = Object.keys(levelNames).map(Number).sort((a, b) => b - a);
  if (levels.length === 0) {
    return { entries: [], totalUnique: 0, totalOccurrences: 0 };
  }

  // Count unique items and occurrences per level
  const uniqueCounts = new Map<number, number>();
  const occurrenceCounts = new Map<number, number>();
  let totalUnique = 0;
  let totalOccurrences = 0;

  for (const [word, entry] of Object.entries(stats.wordsEncountered)) {
    const freq = freqLookup.getFrequency(word);
    if (!freq) continue; // Skip words not in frequency list

    const level = freq.raw_level;
    uniqueCounts.set(level, (uniqueCounts.get(level) || 0) + 1);
    occurrenceCounts.set(level, (occurrenceCounts.get(level) || 0) + entry.timesSeen);
    totalUnique++;
    totalOccurrences += entry.timesSeen;
  }

  const entries: LevelPercentageEntry[] = levels.map(level => {
    const uCount = uniqueCounts.get(level) || 0;
    const oCount = occurrenceCounts.get(level) || 0;
    return {
      level,
      levelName: levelNames[String(level)] || `Level ${level}`,
      uniquePercent: totalUnique > 0 ? (uCount / totalUnique) * 100 : 0,
      occurrencePercent: totalOccurrences > 0 ? (oCount / totalOccurrences) * 100 : 0,
      uniqueCount: uCount,
      occurrenceCount: oCount,
    };
  });

  return { entries, totalUnique, totalOccurrences };
}

/**
 * Compute level distribution percentages for grammar encountered in a media.
 */
export function computeGrammarLevelPercentages(
  stats: MediaStats,
  grammarLookup: GrammarLookup,
): LevelPercentages {
  const levelNames = grammarLookup.getGrammarLevelNames();
  const levels = Object.keys(levelNames).map(Number).sort((a, b) => b - a);
  if (levels.length === 0) {
    return { entries: [], totalUnique: 0, totalOccurrences: 0 };
  }

  const uniqueCounts = new Map<number, number>();
  // For grammar, we use timesFailed as "occurrence weight" in addition to count
  const occurrenceCounts = new Map<number, number>();
  let totalUnique = 0;
  let totalOccurrences = 0;

  for (const [pattern, entry] of Object.entries(stats.grammarEncountered)) {
    const point = grammarLookup.getGrammarPoint(pattern);
    if (!point) continue;

    const level = point.level;
    uniqueCounts.set(level, (uniqueCounts.get(level) || 0) + 1);
    // Weight by 1 per encounter (unique appearance counts)
    const weight = 1 + entry.timesFailed;
    occurrenceCounts.set(level, (occurrenceCounts.get(level) || 0) + weight);
    totalUnique++;
    totalOccurrences += weight;
  }

  const entries: LevelPercentageEntry[] = levels.map(level => {
    const uCount = uniqueCounts.get(level) || 0;
    const oCount = occurrenceCounts.get(level) || 0;
    return {
      level,
      levelName: levelNames[String(level)] || `Level ${level}`,
      uniquePercent: totalUnique > 0 ? (uCount / totalUnique) * 100 : 0,
      occurrencePercent: totalOccurrences > 0 ? (oCount / totalOccurrences) * 100 : 0,
      uniqueCount: uCount,
      occurrenceCount: oCount,
    };
  });

  return { entries, totalUnique, totalOccurrences };
}

/**
 * Assess the difficulty level of a media based on word frequency distribution.
 *
 * Weights each level exponentially so that a single advanced word counts for
 * far more than a beginner word. Levels are sorted in descending raw_level
 * order (e.g. for JLPT: N5 rank=0 → weight 1, N4 rank=1 → weight 2, N3 rank=2
 * → weight 4, …). The assessed level is the highest level whose cumulative
 * weighted share, counted from hardest to easiest, reaches the 50% threshold.
 *
 * This prevents media with a long tail of advanced vocabulary from being
 * misclassified as beginner just because the high-frequency top of the
 * distribution is dominated by easy function words.
 */
export function assessMediaLevel(wordPercentages: LevelPercentages): number | null {
  const entries = wordPercentages.entries;
  if (wordPercentages.totalUnique === 0 || entries.length === 0) return null;

  // Entries are already sorted highest raw_level first (easiest first).
  // Build weighted totals: rank 0 (easiest) → weight 1, then doubling.
  const weights: number[] = entries.map((_, idx) => 2 ** idx);
  let weightedTotal = 0;
  const weightedCounts: number[] = entries.map((e, idx) => {
    const w = e.uniqueCount * weights[idx];
    weightedTotal += w;
    return w;
  });

  if (weightedTotal === 0) return null;

  // Accumulate from hardest to easiest — return the first level whose
  // cumulative weighted percentage reaches the 50% threshold.
  let cumulative = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    cumulative += weightedCounts[i];
    if ((cumulative / weightedTotal) * 100 >= 50) {
      return entries[i].level;
    }
  }

  // Fallback: hardest present level
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].uniqueCount > 0) return entries[i].level;
  }
  return entries[entries.length - 1]?.level ?? null;
}
