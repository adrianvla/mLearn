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
import { buildKnownWordSet, buildTrackedWordSet, type AnkiWordStatusKeys } from './knowledgeUtils';

export type { AnkiWordStatusKeys };

export { buildWordFrequencyMapFromLanguageData };

export type CanonicalizeWordForLanguage = (language: string, word: string) => string;

export interface LevelWordStats {
  level: number;
  name: string;
  totalDictionaryWords: number;
  known: number;
  learning: number;
  unknown: number;
  knownPct: number;
}

export interface OutsideLevelStats {
  known: number;
  learning: number;
  unknown: number;
  total: number;
}

export interface ComprehensiveWordStats {
  byLevel: LevelWordStats[];
  outsideLevels: OutsideLevelStats;
  allEncountered: {
    known: number;
    learning: number;
    unknown: number;
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

function wordKey(language: string, word: string, canonicalizeWord?: CanonicalizeWordForLanguage): string {
  const storageWord = canonicalizeWord ? canonicalizeWord(language, word) : word;
  return langKey(language, hashWordSync(storageWord));
}

/**
 * Build a Set of word hashes that are considered "learning".
 *
 * A word is learning if:
 * - It has flashcards in 'learning' or 'relearning' state
 * - OR its resolved effective state is 'learning' (mirrors
 *   effectiveKnowledge.effectiveStateFromEntry: an explicit claim decides the
 *   classification — only a 'learning' claim admits the word; without a claim,
 *   evidence ease classifies, with passive-only exposure capped at Learning)
 * - OR it exists as a word candidate (auto-tracked for potential flashcards)
 */
export function buildLearningWordSet(
  store: FlashcardStore,
  learningThreshold: number,
  knownThreshold: number,
  ankiLearningKeys?: ReadonlySet<string>,
): Set<string> {
  const learning = new Set<string>();
  const knownEase = knownThreshold / 1000;
  const learningEase = learningThreshold / 1000;

  // Flashcards in learning or relearning state
  for (const [lk, cardIds] of Object.entries(store.wordToCardMap)) {
    for (const id of cardIds) {
      const card = store.flashcards[id];
      if (card && (card.state === 'learning' || card.state === 'relearning')) {
        learning.add(lk);
        break;
      }
    }
  }

  // Passive knowledge — the canonical effective-state rule (no raw ease band
  // inference): a claim decides ('learning' admits the word; 'known'/'unknown'
  // claims keep it out), otherwise evidence ease classifies with the known band
  // gated on hasActiveEvidence — passive-only high ease caps at Learning.
  for (const [lk, knowledge] of Object.entries(store.wordKnowledge)) {
    if (knowledge.claim !== undefined) {
      if (knowledge.claim === 'learning') learning.add(lk);
    } else if (knowledge.ease >= learningEase && (knowledge.ease < knownEase || knowledge.hasActiveEvidence !== true)) {
      learning.add(lk);
    }
  }

  // Word candidates (auto-tracked but not yet flashcards)
  for (const lk of Object.keys(store.wordCandidates)) {
    learning.add(lk);
  }

  if (ankiLearningKeys) for (const lk of ankiLearningKeys) learning.add(lk);

  return learning;
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

export function getWordLevelStatus(
  word: string,
  language: string,
  knownSet: Set<string>,
  learningSet: Set<string>,
  trackedSet: Set<string>,
  canonicalizeWord?: CanonicalizeWordForLanguage,
): WordLevelStatus {
  const lk = wordKey(language, word, canonicalizeWord);

  if (knownSet.has(lk)) return 'known';
  if (learningSet.has(lk)) return 'learning';
  if (trackedSet.has(lk)) return 'unknown';
  return 'untracked';
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
  ankiKeys?: AnkiWordStatusKeys,
): LevelStats[] {
  const levelBuckets = buildLevelBuckets(wordFrequency, levelNames, languageData);
  if (levelBuckets.size === 0) return [];

  const knownSet = buildKnownWordSet(
    store.flashcards,
    store.wordToCardMap,
    store.knownUntracked,
    store.ignoredWords,
    store.wordKnowledge,
    knownThreshold,
    ankiKeys?.known,
  );
  const learningSet = buildLearningWordSet(store, learningThreshold, knownThreshold, ankiKeys?.learning);
  const trackedSet = buildTrackedWordSet(store, language, ankiKeys);

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
        } else if (trackedSet.has(lk)) {
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
  ankiKeys?: AnkiWordStatusKeys,
): ComprehensiveWordStats {
  const knownSet = buildKnownWordSet(
    store.flashcards,
    store.wordToCardMap,
    store.knownUntracked,
    store.ignoredWords,
    store.wordKnowledge,
    knownThreshold,
    ankiKeys?.known,
  );

  const learningSet = buildLearningWordSet(store, learningThreshold, knownThreshold, ankiKeys?.learning);
  const freqHashSet = buildFrequencyHashSet(wordFrequency, language, canonicalizeWord);

  // Bucket frequency words by level
  const levelBuckets = new Map<number, { total: number; known: number; learning: number; unknown: number }>();
  const sortedLevels = getSortedFrequencyLevels(wordFrequency, levelNames, languageData);

  for (const level of sortedLevels) {
    levelBuckets.set(level, { total: 0, known: 0, learning: 0, unknown: 0 });
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
    } else {
      bucket.unknown++;
    }
  }

  const byLevel: LevelWordStats[] = sortedLevels.map((level) => {
    const b = levelBuckets.get(level) ?? { total: 0, known: 0, learning: 0, unknown: 0 };
    return {
      level,
      name: getFrequencyLevelLabel(level, levelNames, languageData),
      totalDictionaryWords: b.total,
      known: b.known,
      learning: b.learning,
      unknown: b.unknown,
      knownPct: b.total > 0 ? Math.round((b.known / b.total) * 100) : 0,
    };
  });

  // Outside levels: tracked words not in the frequency list
  const outside: OutsideLevelStats = { known: 0, learning: 0, unknown: 0, total: 0 };
  const allTracked = buildTrackedWordSet(store, language);

  for (const lk of allTracked) {
    if (freqHashSet.has(lk)) continue;
    outside.total++;
    if (knownSet.has(lk)) {
      outside.known++;
    } else if (learningSet.has(lk)) {
      outside.learning++;
    } else {
      outside.unknown++;
    }
  }

  // All encountered words (tracked + dictionary, for the pie chart)
  const allEncountered = new Set<string>(freqHashSet);
  for (const lk of allTracked) {
    allEncountered.add(lk);
  }

  const allStats = { known: 0, learning: 0, unknown: 0, total: allEncountered.size };
  for (const lk of allEncountered) {
    if (knownSet.has(lk)) {
      allStats.known++;
    } else if (learningSet.has(lk)) {
      allStats.learning++;
    } else {
      allStats.unknown++;
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
  ankiKeys?: AnkiWordStatusKeys,
): LevelStats | null {
  const knownSet = buildKnownWordSet(
    store.flashcards,
    store.wordToCardMap,
    store.knownUntracked,
    store.ignoredWords,
    store.wordKnowledge,
    knownThreshold,
    ankiKeys?.known,
  );
  const learningSet = buildLearningWordSet(store, learningThreshold, knownThreshold, ankiKeys?.learning);
  const trackedSet = buildTrackedWordSet(store, language, ankiKeys);

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
    } else if (trackedSet.has(lk)) {
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
  ankiKeys?: AnkiWordStatusKeys,
): Array<{ level: number; name: string; total: number; known: number; pct: number }> {
  const knownSet = buildKnownWordSet(
    store.flashcards,
    store.wordToCardMap,
    store.knownUntracked,
    store.ignoredWords,
    store.wordKnowledge,
    knownThreshold,
    ankiKeys?.known,
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
