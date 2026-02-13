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
 * Returns the level that covers ~50% of unique words (weighted toward harder levels).
 */
export function assessMediaLevel(wordPercentages: LevelPercentages): number | null {
  if (wordPercentages.totalUnique === 0) return null;

  let cumulative = 0;
  // Entries are sorted highest level first (e.g., JLPT N5=5 first, N1=1 last)
  for (const entry of wordPercentages.entries) {
    cumulative += entry.uniquePercent;
    if (cumulative >= 50) {
      return entry.level;
    }
  }

  // If we got here, use the last level
  const last = wordPercentages.entries[wordPercentages.entries.length - 1];
  return last?.level ?? null;
}
