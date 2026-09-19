/**
 * Word Level Statistics Utility
 * Computes per-language-level word knowledge statistics from the modern
 * FlashcardStore (wordKnowledge, flashcards, knownUntracked, ignoredWords).
 *
 * Replaces the legacy statsService level breakdown which was based on the
 * deprecated wordsLearnedInApp signal store.
 */

import type {
  FlashcardStore,
  LanguageData,
  WordFrequencyEntry,
  WordFrequencyMap,
} from '../../shared/types';
import {
  buildWordFrequencyMapFromLanguageData,
  compareFrequencyLevelsForDisplay,
  getFrequencyLevelLabel,
  isDisplayableFrequencyLevel,
} from '../../shared/languageFeatures';
import { hashWordSync } from '../services/srsAlgorithm';
import { buildTrackedWordSet } from './knowledgeUtils';
import { getComprehensiveWordStatusWithSource, getEffectiveWordStateForKeys, type ComprehensiveWordStatusResult } from './comprehensiveKnowledge';


export { buildWordFrequencyMapFromLanguageData };

export type CanonicalizeWordForLanguage = (language: string, word: string) => string;

export interface LevelWordStats {
  level: number;
  name: string;
  totalDictionaryWords: number;
  known: number;
  learning: number;
  unknown: number;
  untracked: number;
  knownPct: number;
}

export interface OutsideLevelStats {
  known: number;
  learning: number;
  unknown: number;
  untracked: number;
  total: number;
}

export interface ComprehensiveWordStats {
  byLevel: LevelWordStats[];
  outsideLevels: OutsideLevelStats;
  allEncountered: {
    known: number;
    learning: number;
    unknown: number;
    untracked: number;
    total: number;
  };
}

export interface LevelStats {
  level: number;
  name: string;
  total: number;
  known: number;
  learning: number;
  unknown: number;
  untracked: number;
  knownPct: number;
  learningPct: number;
  unknownPct: number;
  untrackedPct: number;
}

function langKey(language: string, wordHash: string): string {
  return language + ':' + wordHash;
}

/** The canonical storage key a word's evidence is written under (writer-side
 *  derivation: canonical form → hash → language-scoped key). Used to bound
 *  projection requests to evidence-bearing surfaces only (F-N1 lead). */
export function wordStorageKey(language: string, word: string, canonicalizeWord?: CanonicalizeWordForLanguage): string {
  return wordKey(language, word, canonicalizeWord);
}

function wordKey(language: string, word: string, canonicalizeWord?: CanonicalizeWordForLanguage): string {
  const storageWord = canonicalizeWord ? canonicalizeWord(language, word) : word;
  return langKey(language, hashWordSync(storageWord));
}

export type ResolveLearnerState = (word: string, language: string) => Pick<ComprehensiveWordStatusResult, 'status' | 'basis'>;

/** Materialized-key index, resolved by the same API as Reader and Word Sync. */
function buildStateSets(
  store: FlashcardStore,
  wordFrequency: WordFrequencyMap,
  language: string,
  knownThreshold: number,
  learningThreshold: number,
  canonicalizeWord?: CanonicalizeWordForLanguage,
  resolveState?: ResolveLearnerState,
) {
  const known = new Set<string>();
  const learning = new Set<string>();
  const measured = new Set<string>();
  const add = (key: string, state: Pick<ComprehensiveWordStatusResult, 'status' | 'basis'>) => {
    known.delete(key);
    learning.delete(key);
    measured.delete(key);
    if (state.basis !== 'unmeasured') measured.add(key);
    if (state.status === 'known') known.add(key);
    if (state.status === 'learning') learning.add(key);
  };
  const resolve = resolveState ?? ((word: string) => getComprehensiveWordStatusWithSource(word, {
    getCanonicalForm: value => canonicalizeWord?.(language, value) ?? value,
    hashWordSync, langKey, language, wordKnowledge: store.wordKnowledge, ignoredWords: store.ignoredWords,
    knownEaseThreshold: knownThreshold / 1000, learningThreshold: learningThreshold / 1000,
  }));
  for (const key of resolveState ? [] : buildTrackedWordSet(store, language)) {
    const word = store.wordKnowledge[key]?.word;
    add(key, word && resolveState ? resolve(word, language) : getEffectiveWordStateForKeys([key], store.wordKnowledge, {
      known: knownThreshold / 1000, learning: learningThreshold / 1000,
    }));
  }
  for (const word of Object.keys(wordFrequency)) add(wordKey(language, word, canonicalizeWord), resolve(word, language));
  return { known, learning, measured };
}

/**
 * Build a Set of all language-prefixed hashes present in the frequency list.
 */
function buildFrequencyHashSet(
  wordFrequency: WordFrequencyMap,
  language: string,
  canonicalizeWord?: CanonicalizeWordForLanguage,
): Set<string> {
  const set = new Set<string>();
  for (const word of Object.keys(wordFrequency)) {
    set.add(wordKey(language, word, canonicalizeWord));
  }
  return set;
}

export type WordLevelStatus = 'known' | 'learning' | 'unknown' | 'untracked';

/** Untracked is the existing filter label for canonical Unmeasured. */
export function getWordLevelStatus(state: Pick<ComprehensiveWordStatusResult, 'status' | 'basis'>): WordLevelStatus {
  return state.basis === 'unmeasured' ? 'untracked' : state.status;
}

function roundPct(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
}

function buildLevelBuckets(
  wordFrequency: WordFrequencyMap,
  levelNames: Record<string, string>,
  languageData?: LanguageData | null,
): Map<number, Array<[string, WordFrequencyEntry]>> {
  const buckets = new Map<number, Array<[string, WordFrequencyEntry]>>();

  for (const [word, entry] of Object.entries(wordFrequency)) {
    if (!isDisplayableFrequencyLevel(entry.raw_level, levelNames, languageData)) continue;
    const bucket = buckets.get(entry.raw_level) ?? [];
    bucket.push([word, entry]);
    buckets.set(entry.raw_level, bucket);
  }

  return buckets;
}

export function resolveLevelStudyWordFrequency(
  wordFrequency: WordFrequencyMap,
  languageData?: LanguageData | null,
): WordFrequencyMap {
  return Object.keys(wordFrequency).length > 0
    ? wordFrequency
    : buildWordFrequencyMapFromLanguageData(languageData);
}

export function getLevelStudyFrequency(languageData: LanguageData | null) {
  return resolveLevelStudyWordFrequency({}, languageData);
}

export function getLevelStudyLevelNames(
  languageData: LanguageData | null,
  frequency: WordFrequencyMap = getLevelStudyFrequency(languageData),
): Record<string, string> {
  const names: Record<string, string> = { ...(languageData?.frequencyLevels?.names ?? {}) };
  for (const entry of Object.values(frequency)) {
    if (!isDisplayableFrequencyLevel(entry.raw_level, names, languageData)) continue;
    const key = String(entry.raw_level);
    names[key] = names[key] || entry.level || getFrequencyLevelLabel(entry.raw_level, names, languageData);
  }
  return names;
}

export interface LevelCoverageSummary {
  total: number;
  tracked: number;
  pct: number;
  complete: boolean;
}

export function summarizeLevelCoverage(levels: readonly LevelStats[]): LevelCoverageSummary {
  const total = levels.reduce((sum, level) => sum + level.total, 0);
  const tracked = levels.reduce(
    (sum, level) => sum + level.known + level.learning + level.unknown,
    0,
  );
  const complete = total > 0 && tracked === total;
  const pct = total === 0
    ? 0
    : complete
      ? 100
      : Math.min(Math.round((tracked / total) * 100), 99);
  return { total, tracked, pct, complete };
}

function getSortedFrequencyLevels(
  wordFrequency: WordFrequencyMap,
  levelNames: Record<string, string>,
  languageData?: LanguageData | null,
): number[] {
  const levels = new Set<number>();
  for (const level of Object.keys(levelNames).map(Number)) {
    if (isDisplayableFrequencyLevel(level, levelNames, languageData)) levels.add(level);
  }
  for (const entry of Object.values(wordFrequency)) {
    if (isDisplayableFrequencyLevel(entry.raw_level, levelNames, languageData)) levels.add(entry.raw_level);
  }
  return Array.from(levels).sort((a, b) => compareFrequencyLevelsForDisplay(a, b, languageData));
}

export function computeLevelStats(
  store: FlashcardStore,
  wordFrequency: WordFrequencyMap,
  language: string,
  knownThreshold: number,
  learningThreshold: number,
  levelNames: Record<string, string>,
  languageData?: LanguageData | null,
  canonicalizeWord?: CanonicalizeWordForLanguage,
  resolveState?: ResolveLearnerState,
): LevelStats[] {
  const levelBuckets = buildLevelBuckets(wordFrequency, levelNames, languageData);
  if (levelBuckets.size === 0) return [];

  const { known: knownSet, learning: learningSet, measured: measuredSet } = buildStateSets(
    store, wordFrequency, language, knownThreshold, learningThreshold, canonicalizeWord, resolveState,
  );

  return [...levelBuckets.entries()]
    .sort(([a], [b]) => compareFrequencyLevelsForDisplay(a, b, languageData))
    .map(([level, entries]) => {
      let known = 0;
      let learning = 0;
      let unknown = 0;

      for (const [word] of entries) {
        const lk = wordKey(language, word, canonicalizeWord);

        if (knownSet.has(lk)) {
          known++;
        } else if (learningSet.has(lk)) {
          learning++;
        } else if (measuredSet.has(lk)) {
          unknown++;
        }
      }

      const total = entries.length;
      const untracked = Math.max(total - known - learning - unknown, 0);

      return {
        level,
        name: getFrequencyLevelLabel(level, levelNames, languageData),
        total,
        known,
        learning,
        unknown,
        untracked,
        knownPct: roundPct(known, total),
        learningPct: roundPct(learning, total),
        unknownPct: roundPct(unknown, total),
        untrackedPct: roundPct(untracked, total),
      };
    });
}

/**
 * Compute comprehensive word statistics broken down by language level.
 *
 * @param store          The full FlashcardStore
 * @param wordFrequency  Language frequency map from LanguageContext
 * @param language       Current language code
 * @param knownThreshold known_ease_threshold setting (integer 0-5000)
 * @param learningThreshold srsLearningThreshold setting (integer 0-5000)
 * @param levelNames     Record<levelString, levelName> from LanguageContext
 */
export function computeWordLevelStats(
  store: FlashcardStore,
  wordFrequency: WordFrequencyMap,
  language: string,
  knownThreshold: number,
  learningThreshold: number,
  levelNames: Record<string, string>,
  languageData?: LanguageData | null,
  canonicalizeWord?: CanonicalizeWordForLanguage,
  resolveState?: ResolveLearnerState,
): ComprehensiveWordStats {
  const { known: knownSet, learning: learningSet, measured: measuredSet } = buildStateSets(
    store, wordFrequency, language, knownThreshold, learningThreshold, canonicalizeWord, resolveState,
  );
  const freqHashSet = buildFrequencyHashSet(wordFrequency, language, canonicalizeWord);

  // Bucket frequency words by level
  const levelBuckets = new Map<number, { total: number; known: number; learning: number; unknown: number; untracked: number }>();
  const sortedLevels = getSortedFrequencyLevels(wordFrequency, levelNames, languageData);

  for (const level of sortedLevels) {
    levelBuckets.set(level, { total: 0, known: 0, learning: 0, unknown: 0, untracked: 0 });
  }

  for (const [word, entry] of Object.entries(wordFrequency)) {
    const lk = wordKey(language, word, canonicalizeWord);
    const bucket = levelBuckets.get(entry.raw_level);
    if (!bucket) continue;

    bucket.total++;
    if (knownSet.has(lk)) {
      bucket.known++;
    } else if (learningSet.has(lk)) {
      bucket.learning++;
    } else if (measuredSet.has(lk)) {
      bucket.unknown++;
    } else {
      bucket.untracked++;
    }
  }

  const byLevel: LevelWordStats[] = sortedLevels.map((level) => {
    const b = levelBuckets.get(level) ?? { total: 0, known: 0, learning: 0, unknown: 0, untracked: 0 };
    return {
      level,
      name: getFrequencyLevelLabel(level, levelNames, languageData),
      totalDictionaryWords: b.total,
      known: b.known,
      learning: b.learning,
      unknown: b.unknown,
      untracked: b.untracked,
      knownPct: b.total > 0 ? Math.round((b.known / b.total) * 100) : 0,
    };
  });

  // Outside levels: tracked words not in the frequency list
  const outside: OutsideLevelStats = { known: 0, learning: 0, unknown: 0, untracked: 0, total: 0 };
  const allTracked = buildTrackedWordSet(store, language);

  for (const lk of allTracked) {
    if (freqHashSet.has(lk)) continue;
    outside.total++;
    if (knownSet.has(lk)) {
      outside.known++;
    } else if (learningSet.has(lk)) {
      outside.learning++;
    } else if (measuredSet.has(lk)) {
      outside.unknown++;
    } else {
      outside.untracked++;
    }
  }

  // All encountered words (tracked + dictionary, for the pie chart)
  const allEncountered = new Set<string>(freqHashSet);
  for (const lk of allTracked) {
    allEncountered.add(lk);
  }

  const allStats = { known: 0, learning: 0, unknown: 0, untracked: 0, total: allEncountered.size };
  for (const lk of allEncountered) {
    if (knownSet.has(lk)) {
      allStats.known++;
    } else if (learningSet.has(lk)) {
      allStats.learning++;
    } else if (measuredSet.has(lk)) {
      allStats.unknown++;
    } else {
      allStats.untracked++;
    }
  }

  return {
    byLevel,
    outsideLevels: outside,
    allEncountered: allStats,
  };
}

/**
 * Synthetic level id for the "Beyond exam" bucket: frequency-listed words with
 * no displayable exam level (unleveled languages, or words past the exam range).
 * LevelStudyTab renders it as a pseudo-card; LevelDetailModal filters on it.
 */
export const BEYOND_EXAM_LEVEL = -1;

export function computeBeyondExamLevelStats(
  store: FlashcardStore,
  wordFrequency: WordFrequencyMap,
  language: string,
  knownThreshold: number,
  learningThreshold: number,
  levelNames: Record<string, string>,
  languageData?: LanguageData | null,
  canonicalizeWord?: CanonicalizeWordForLanguage,
  resolveState?: ResolveLearnerState,
): LevelStats | null {
  const { known: knownSet, learning: learningSet, measured: measuredSet } = buildStateSets(
    store, wordFrequency, language, knownThreshold, learningThreshold, canonicalizeWord, resolveState,
  );

  let known = 0;
  let learning = 0;
  let unknown = 0;
  let untracked = 0;
  let total = 0;

  for (const [word, entry] of Object.entries(wordFrequency)) {
    if (isDisplayableFrequencyLevel(entry.raw_level, levelNames, languageData)) continue;
    total++;

    const lk = wordKey(language, word, canonicalizeWord);
    if (knownSet.has(lk)) {
      known++;
    } else if (learningSet.has(lk)) {
      learning++;
    } else if (measuredSet.has(lk)) {
      unknown++;
    } else {
      untracked++;
    }
  }

  if (total === 0) return null;

  return {
    level: BEYOND_EXAM_LEVEL,
    name: '',
    total,
    known,
    learning,
    unknown,
    untracked,
    knownPct: roundPct(known, total),
    learningPct: roundPct(learning, total),
    unknownPct: roundPct(unknown, total),
    untrackedPct: roundPct(untracked, total),
  };
}

/**
 * Lightweight variant that only computes per-level totals and known counts.
 * Useful for quick coverage percentages without full breakdown.
 */
export function computeLevelCoverage(
  store: FlashcardStore,
  wordFrequency: WordFrequencyMap,
  language: string,
  knownThreshold: number,
  levelNames: Record<string, string>,
  languageData?: LanguageData | null,
  canonicalizeWord?: CanonicalizeWordForLanguage,
  resolveState?: ResolveLearnerState,
): Array<{ level: number; name: string; total: number; known: number; pct: number }> {
  const { known: knownSet } = buildStateSets(
    store, wordFrequency, language, knownThreshold, knownThreshold, canonicalizeWord, resolveState,
  );

  const levelTotals = new Map<number, number>();
  const levelKnown = new Map<number, number>();
  const sortedLevels = getSortedFrequencyLevels(wordFrequency, levelNames, languageData);

  for (const level of sortedLevels) {
    levelTotals.set(level, 0);
    levelKnown.set(level, 0);
  }

  for (const [word, entry] of Object.entries(wordFrequency)) {
    const lk = wordKey(language, word, canonicalizeWord);
    const total = levelTotals.get(entry.raw_level);
    if (total === undefined) continue;

    levelTotals.set(entry.raw_level, total + 1);
    if (knownSet.has(lk)) {
      levelKnown.set(entry.raw_level, (levelKnown.get(entry.raw_level) ?? 0) + 1);
    }
  }

  return sortedLevels.map((level) => {
    const total = levelTotals.get(level) ?? 0;
    const known = levelKnown.get(level) ?? 0;
    return {
      level,
      name: getFrequencyLevelLabel(level, levelNames, languageData),
      total,
      known,
      pct: total > 0 ? Math.round((known / total) * 100) : 0,
    };
  });
}
