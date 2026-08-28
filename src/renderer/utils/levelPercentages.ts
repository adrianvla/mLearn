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
  compareGrammarLevelsByDifficulty,
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
 * Core weighted-level estimator: the 2^n-weighted cumulative difficulty rule.
 *
 * Sorts percentage entries from easiest to hardest using the supplied level
 * comparator, then weights each level exponentially by difficulty rank
 * (easiest rank = 1, next = 2, next = 4, …). Returns the hardest level whose
 * cumulative weighted share, counted hardest → easiest, reaches 50%, with the
 * hardest present level as fallback. This is an *objective* content-difficulty
 * measure: it consumes only the media's level distribution and the language's
 * level metadata — never learner state (no ease, claims, or projections).
 *
 * This function is the exact lexical estimator formerly inlined in
 * `assessMediaLevel`; moving it here changes no computed values.
 */
export function estimateWeightedLevel(
  percentages: LevelPercentages,
  compareLevels: (left: number, right: number, data?: LanguageData | null) => number,
  languageData?: LanguageData | null,
): number | null {
  const entries = [...percentages.entries].sort((left, right) =>
    compareLevels(left.level, right.level, languageData),
  );
  if (percentages.totalUnique === 0 || entries.length === 0) return null;

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

/**
 * Assess the difficulty level of a media based on word frequency distribution.
 *
 * Delegates to `estimateWeightedLevel` with frequency-level ordering — the
 * historical 2^n-weighted lexical estimator, preserved verbatim.
 */
export function assessMediaLevel(wordPercentages: LevelPercentages, languageData?: LanguageData | null): number | null {
  return estimateWeightedLevel(wordPercentages, compareFrequencyLevelsByDifficulty, languageData);
}

/**
 * Component breakdown of a media difficulty estimate.
 *
 * Components are deliberately kept separate from the headline `lexical`
 * number so future difficulty sources can be fused without changing today's
 * assessed value. No component is ever a learner-relative projection: every
 * slot is an objective property of the media content (level distributions +
 * language metadata only).
 */
export interface MediaDifficultyComponents {
  /** Lexical (vocabulary frequency) difficulty — the current headline. */
  lexical: number | null;
  /**
   * Grammar difficulty (level distribution of the grammar points used in the
   * media), computed with the same weighted rule when grammar distribution
   * data is supplied. Currently an observation slot: it is computed at call
   * sites that already carry `grammarLevelPercentages`, but is NOT fused into
   * the headline `lexical` number, so current assessed values are unchanged.
   */
  grammar: number | null;
  /**
   * Reserved for future structural (sentence-complexity / syntax) difficulty.
   * No such estimator exists yet — always null today.
   */
  structural: null;
}

export interface MediaDifficultyEstimate {
  /** Headline difficulty. Today this equals the lexical component. */
  lexical: number | null;
  components: MediaDifficultyComponents;
}

/**
 * Assess media difficulty with a documented component breakdown.
 *
 * `lexical` reproduces `assessMediaLevel` exactly (same inputs → same value).
 * `components.grammar` is populated from the optional grammar distribution
 * (objective unique counts only — the weighted rule never consumes learner
 * failure weights), while the headline stays unchanged to preserve current
 * behavior. No projection/learner inputs are accepted.
 */
export function assessMediaDifficulty(
  wordPercentages: LevelPercentages,
  grammarPercentages?: LevelPercentages | null,
  languageData?: LanguageData | null,
): MediaDifficultyEstimate {
  const lexical = estimateWeightedLevel(wordPercentages, compareFrequencyLevelsByDifficulty, languageData);
  const grammar = grammarPercentages
    ? estimateWeightedLevel(grammarPercentages, compareGrammarLevelsByDifficulty, languageData)
    : null;
  return {
    lexical,
    components: {
      lexical,
      grammar,
      structural: null,
    },
  };
}
