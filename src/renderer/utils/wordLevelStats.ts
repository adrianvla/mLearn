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
  WordFrequencyEntry,
  WordFrequencyMap,
} from '../../shared/types';
import { hashWordSync } from '../services/srsAlgorithm';
import { buildKnownWordSet, buildTrackedWordSet } from './knowledgeUtils';

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

export interface ExamLevelStats {
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

/**
 * Build a Set of word hashes that are considered "learning".
 *
 * A word is learning if:
 * - It has flashcards in 'learning' or 'relearning' state
 * - OR its passive knowledge ease >= learning threshold but < known threshold
 * - OR it exists as a word candidate (auto-tracked for potential flashcards)
 */
export function buildLearningWordSet(
  store: FlashcardStore,
  learningThreshold: number,
  knownThreshold: number,
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

  // Passive knowledge ease in learning range
  for (const [lk, knowledge] of Object.entries(store.wordKnowledge)) {
    if (knowledge.ease >= learningEase && knowledge.ease < knownEase) {
      learning.add(lk);
    }
  }

  // Word candidates (auto-tracked but not yet flashcards)
  for (const lk of Object.keys(store.wordCandidates)) {
    learning.add(lk);
  }

  return learning;
}

/**
 * Build a Set of all language-prefixed hashes present in the frequency list.
 */
function buildFrequencyHashSet(
  wordFrequency: WordFrequencyMap,
  language: string,
): Set<string> {
  const set = new Set<string>();
  for (const word of Object.keys(wordFrequency)) {
    set.add(langKey(language, hashWordSync(word)));
  }
  return set;
}

export type WordExamStatus = 'known' | 'learning' | 'unknown' | 'untracked';

export function getWordExamStatus(
  word: string,
  language: string,
  knownSet: Set<string>,
  learningSet: Set<string>,
  trackedSet: Set<string>,
): WordExamStatus {
  const lk = langKey(language, hashWordSync(word));

  if (knownSet.has(lk)) return 'known';
  if (learningSet.has(lk)) return 'learning';
  if (trackedSet.has(lk)) return 'unknown';
  return 'untracked';
}

function roundPct(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
}

function buildExamLevelBuckets(
  wordFrequency: WordFrequencyMap,
): Map<number, Array<[string, WordFrequencyEntry]>> {
  const buckets = new Map<number, Array<[string, WordFrequencyEntry]>>();

  for (const [word, entry] of Object.entries(wordFrequency)) {
    const bucket = buckets.get(entry.raw_level) ?? [];
    bucket.push([word, entry]);
    buckets.set(entry.raw_level, bucket);
  }

  return buckets;
}

export function computeExamLevelStats(
  store: FlashcardStore,
  wordFrequency: WordFrequencyMap,
  language: string,
  knownThreshold: number,
  learningThreshold: number,
  levelNames: Record<string, string>,
): ExamLevelStats[] {
  const levelBuckets = buildExamLevelBuckets(wordFrequency);
  if (levelBuckets.size === 0) return [];

  const knownSet = buildKnownWordSet(
    store.flashcards,
    store.wordToCardMap,
    store.knownUntracked,
    store.ignoredWords,
    store.wordKnowledge,
    knownThreshold,
  );
  const learningSet = buildLearningWordSet(store, learningThreshold, knownThreshold);
  const trackedSet = buildTrackedWordSet(store, language);

  return [...levelBuckets.entries()]
    .sort(([a], [b]) => b - a)
    .map(([level, entries]) => {
      let known = 0;
      let learning = 0;
      let unknown = 0;

      for (const [word] of entries) {
        const lk = langKey(language, hashWordSync(word));

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
        name: levelNames[String(level)] || `Level ${level}`,
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
): ComprehensiveWordStats {
  const knownSet = buildKnownWordSet(
    store.flashcards,
    store.wordToCardMap,
    store.knownUntracked,
    store.ignoredWords,
    store.wordKnowledge,
    knownThreshold,
  );

  const learningSet = buildLearningWordSet(store, learningThreshold, knownThreshold);
  const freqHashSet = buildFrequencyHashSet(wordFrequency, language);

  // Bucket frequency words by level
  const levelBuckets = new Map<number, { total: number; known: number; learning: number; unknown: number }>();
  const sortedLevels = Object.keys(levelNames)
    .map(Number)
    .sort((a, b) => b - a);

  for (const level of sortedLevels) {
    levelBuckets.set(level, { total: 0, known: 0, learning: 0, unknown: 0 });
  }

  for (const [word, entry] of Object.entries(wordFrequency)) {
    const lk = langKey(language, hashWordSync(word));
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
      name: levelNames[String(level)] || `Level ${level}`,
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
 * Lightweight variant that only computes per-level totals and known counts.
 * Useful for quick coverage percentages without full breakdown.
 */
export function computeLevelCoverage(
  store: FlashcardStore,
  wordFrequency: WordFrequencyMap,
  language: string,
  knownThreshold: number,
  levelNames: Record<string, string>,
): Array<{ level: number; name: string; total: number; known: number; pct: number }> {
  const knownSet = buildKnownWordSet(
    store.flashcards,
    store.wordToCardMap,
    store.knownUntracked,
    store.ignoredWords,
    store.wordKnowledge,
    knownThreshold,
  );

  const levelTotals = new Map<number, number>();
  const levelKnown = new Map<number, number>();
  const sortedLevels = Object.keys(levelNames)
    .map(Number)
    .sort((a, b) => b - a);

  for (const level of sortedLevels) {
    levelTotals.set(level, 0);
    levelKnown.set(level, 0);
  }

  for (const [word, entry] of Object.entries(wordFrequency)) {
    const lk = langKey(language, hashWordSync(word));
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
      name: levelNames[String(level)] || `Level ${level}`,
      total,
      known,
      pct: total > 0 ? Math.round((known / total) * 100) : 0,
    };
  });
}
