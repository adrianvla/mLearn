/**
 * Level Percentages Utility
 * Computes level distribution from media stats + frequency/grammar data.
 */

import type {
  LanguageData,
  LevelPercentages,
  LevelPercentageEntry,
  MediaStats,
} from '../../shared/types';
import {
  compareFrequencyLevelsByDifficulty,
  getFrequencyLevelLabel,
  getGrammarLevelLabel,
  isDisplayableFrequencyLevel,
  sortFrequencyLevelsByDifficulty,
  sortGrammarLevelsByDifficulty,
} from '../../shared/languageFeatures';

interface WordFreqLookup {
  getFrequency: (word: string) => { raw_level: number; level: string } | null;
  getFreqLevelNames: () => Record<string, string>;
}

interface GrammarLookup {
  getGrammarPoint: (pattern: string) => { level: number; levelName: string } | null | undefined;
  getGrammarLevelNames: () => Record<string, string>;
}

function validLevel(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Compute level distribution percentages for words encountered in a media.
 * Returns both unique-item percentages and occurrence-weighted percentages.
 */
export function computeWordLevelPercentages(
  stats: MediaStats,
  freqLookup: WordFreqLookup,
  languageData?: LanguageData | null,
): LevelPercentages {
  const levelNames = freqLookup.getFreqLevelNames();
  const uniqueCounts = new Map<number, number>();
  const occurrenceCounts = new Map<number, number>();
  const discoveredLevels = new Set<number>();
  let totalUnique = 0;
  let totalOccurrences = 0;

  for (const [word, entry] of Object.entries(stats.wordsEncountered)) {
    const freq = freqLookup.getFrequency(word);
    if (!freq || !isDisplayableFrequencyLevel(freq.raw_level, levelNames, languageData)) continue;

    const level = freq.raw_level;
    discoveredLevels.add(level);
    uniqueCounts.set(level, (uniqueCounts.get(level) || 0) + 1);
    occurrenceCounts.set(level, (occurrenceCounts.get(level) || 0) + entry.timesSeen);
    totalUnique++;
    totalOccurrences += entry.timesSeen;
  }

  const namedLevels = Object.keys(levelNames)
    .map(Number)
    .filter((level) => isDisplayableFrequencyLevel(level, levelNames, languageData));
  const levels = sortFrequencyLevelsByDifficulty(
    Array.from(new Set([...namedLevels, ...discoveredLevels])),
    languageData,
  );
  if (levels.length === 0) {
    return { entries: [], totalUnique: 0, totalOccurrences: 0 };
  }

  const entries: LevelPercentageEntry[] = levels.map(level => {
    const uCount = uniqueCounts.get(level) || 0;
    const oCount = occurrenceCounts.get(level) || 0;
    return {
      level,
      levelName: getFrequencyLevelLabel(level, levelNames, languageData),
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
  languageData?: LanguageData | null,
): LevelPercentages {
  const levelNames = grammarLookup.getGrammarLevelNames();
  const uniqueCounts = new Map<number, number>();
  // For grammar, we use timesFailed as "occurrence weight" in addition to count
  const occurrenceCounts = new Map<number, number>();
  const discoveredLevels = new Set<number>();
  let totalUnique = 0;
  let totalOccurrences = 0;

  for (const [pattern, entry] of Object.entries(stats.grammarEncountered)) {
    const point = grammarLookup.getGrammarPoint(pattern);
    if (!point || !validLevel(point.level)) continue;

    const level = point.level;
    discoveredLevels.add(level);
    uniqueCounts.set(level, (uniqueCounts.get(level) || 0) + 1);
    // Weight by 1 per encounter (unique appearance counts)
    const weight = 1 + entry.timesFailed;
    occurrenceCounts.set(level, (occurrenceCounts.get(level) || 0) + weight);
    totalUnique++;
    totalOccurrences += weight;
  }

  const namedLevels = Object.keys(levelNames).map(Number).filter(validLevel);
  const levels = sortGrammarLevelsByDifficulty(
    Array.from(new Set([...namedLevels, ...discoveredLevels])),
    languageData,
  );
  if (levels.length === 0) {
    return { entries: [], totalUnique: 0, totalOccurrences: 0 };
  }

  const entries: LevelPercentageEntry[] = levels.map(level => {
    const uCount = uniqueCounts.get(level) || 0;
    const oCount = occurrenceCounts.get(level) || 0;
    return {
      level,
      levelName: getGrammarLevelLabel(level, levelNames, languageData),
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
 * far more than a beginner word. Levels are sorted from easiest to hardest
 * using the language's frequency-level metadata (e.g. easiest rank=0,
 * next-easiest rank=1, next rank=2 → weight 4, …). The assessed level is the level whose cumulative
 * weighted share, counted from hardest to easiest, reaches the 50% threshold.
 *
 * This prevents media with a long tail of advanced vocabulary from being
 * misclassified as beginner just because the high-frequency top of the
 * distribution is dominated by easy function words.
 */
export function assessMediaLevel(wordPercentages: LevelPercentages, languageData?: LanguageData | null): number | null {
  const entries = [...wordPercentages.entries].sort((left, right) =>
    compareFrequencyLevelsByDifficulty(left.level, right.level, languageData),
  );
  if (wordPercentages.totalUnique === 0 || entries.length === 0) return null;

  // Entries are sorted easiest first. Build weighted totals: rank 0 (easiest)
  // → weight 1, then doubling.
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
