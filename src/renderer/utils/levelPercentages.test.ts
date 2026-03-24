import { describe, it, expect } from 'vitest';
import type { MediaStats, LevelPercentages } from '@shared/types';
import {
  computeWordLevelPercentages,
  computeGrammarLevelPercentages,
  assessMediaLevel,
} from './levelPercentages';

function createMediaStats(
  wordsEncountered: MediaStats['wordsEncountered'] = {},
  grammarEncountered: MediaStats['grammarEncountered'] = {},
): MediaStats {
  return {
    mediaHash: 'testhash',
    mediaName: 'Test Media',
    mediaType: 'video',
    language: 'xx',
    assessedLevel: null,
    sessions: [],
    totalTimeSpent: 0,
    lastAccessed: 0,
    wordsEncountered,
    grammarEncountered,
  };
}

function createFreqLookup(mapping: Record<string, { raw_level: number; level: string }>) {
  return {
    getFrequency: (word: string) => mapping[word] ?? null,
    getFreqLevelNames: () => {
      const names: Record<string, string> = {};
      for (const v of Object.values(mapping)) {
        names[String(v.raw_level)] = v.level;
      }
      return names;
    },
  };
}

function createFreqLookupWithLevelNames(
  mapping: Record<string, { raw_level: number; level: string }>,
  levelNames: Record<string, string>,
) {
  return {
    getFrequency: (word: string) => mapping[word] ?? null,
    getFreqLevelNames: () => levelNames,
  };
}

function createGrammarLookup(
  mapping: Record<string, { level: number; levelName: string } | null | undefined>,
  levelNames: Record<string, string>,
) {
  return {
    getGrammarPoint: (pattern: string) => mapping[pattern],
    getGrammarLevelNames: () => levelNames,
  };
}

describe('computeWordLevelPercentages', () => {
  it('returns empty result when wordsEncountered is empty', () => {
    const stats = createMediaStats({});
    const lookup = createFreqLookupWithLevelNames({}, { '1': 'A1', '2': 'A2' });
    const result = computeWordLevelPercentages(stats, lookup);
    expect(result.entries).toHaveLength(2);
    expect(result.totalUnique).toBe(0);
    expect(result.totalOccurrences).toBe(0);
  });

  it('returns empty result when level names are empty', () => {
    const stats = createMediaStats({ hello: { word: 'hello', ease: 1, timesSeen: 3, timesHovered: 0 } });
    const lookup = createFreqLookupWithLevelNames({ hello: { raw_level: 1, level: 'A1' } }, {});
    const result = computeWordLevelPercentages(stats, lookup);
    expect(result).toEqual({ entries: [], totalUnique: 0, totalOccurrences: 0 });
  });

  it('handles single word at one level', () => {
    const stats = createMediaStats({
      hello: { word: 'hello', ease: 1, timesSeen: 4, timesHovered: 0 },
    });
    const lookup = createFreqLookup({ hello: { raw_level: 1, level: 'A1' } });
    const result = computeWordLevelPercentages(stats, lookup);
    expect(result.totalUnique).toBe(1);
    expect(result.totalOccurrences).toBe(4);
    const entry = result.entries.find(e => e.level === 1);
    expect(entry).toBeDefined();
    expect(entry!.uniquePercent).toBeCloseTo(100);
    expect(entry!.occurrencePercent).toBeCloseTo(100);
    expect(entry!.uniqueCount).toBe(1);
    expect(entry!.occurrenceCount).toBe(4);
  });

  it('handles multiple words at different levels with correct distribution', () => {
    const stats = createMediaStats({
      apple: { word: 'apple', ease: 1, timesSeen: 3, timesHovered: 0 },
      banana: { word: 'banana', ease: 1, timesSeen: 1, timesHovered: 0 },
      cherry: { word: 'cherry', ease: 1, timesSeen: 6, timesHovered: 0 },
    });
    const lookup = createFreqLookup({
      apple: { raw_level: 1, level: 'A1' },
      banana: { raw_level: 2, level: 'A2' },
      cherry: { raw_level: 1, level: 'A1' },
    });
    const result = computeWordLevelPercentages(stats, lookup);
    expect(result.totalUnique).toBe(3);
    expect(result.totalOccurrences).toBe(10);

    const l1 = result.entries.find(e => e.level === 1)!;
    const l2 = result.entries.find(e => e.level === 2)!;

    expect(l1.uniqueCount).toBe(2);
    expect(l1.occurrenceCount).toBe(9);
    expect(l1.uniquePercent).toBeCloseTo((2 / 3) * 100);
    expect(l1.occurrencePercent).toBeCloseTo((9 / 10) * 100);

    expect(l2.uniqueCount).toBe(1);
    expect(l2.occurrenceCount).toBe(1);
    expect(l2.uniquePercent).toBeCloseTo((1 / 3) * 100);
    expect(l2.occurrencePercent).toBeCloseTo((1 / 10) * 100);
  });

  it('skips words not in the frequency list', () => {
    const stats = createMediaStats({
      known: { word: 'known', ease: 1, timesSeen: 5, timesHovered: 0 },
      unknown: { word: 'unknown', ease: 1, timesSeen: 10, timesHovered: 0 },
    });
    const lookup = createFreqLookup({ known: { raw_level: 1, level: 'A1' } });
    const result = computeWordLevelPercentages(stats, lookup);
    expect(result.totalUnique).toBe(1);
    expect(result.totalOccurrences).toBe(5);
    const entry = result.entries.find(e => e.level === 1)!;
    expect(entry.uniqueCount).toBe(1);
    expect(entry.occurrenceCount).toBe(5);
  });

  it('sorts entries by level descending (highest first)', () => {
    const stats = createMediaStats({
      a: { word: 'a', ease: 1, timesSeen: 1, timesHovered: 0 },
      b: { word: 'b', ease: 1, timesSeen: 1, timesHovered: 0 },
      c: { word: 'c', ease: 1, timesSeen: 1, timesHovered: 0 },
    });
    const lookup = createFreqLookup({
      a: { raw_level: 3, level: 'C1' },
      b: { raw_level: 1, level: 'A1' },
      c: { raw_level: 2, level: 'A2' },
    });
    const result = computeWordLevelPercentages(stats, lookup);
    const levels = result.entries.map(e => e.level);
    expect(levels).toEqual([3, 2, 1]);
  });

  it('uniquePercent values sum to ~100 when all words are in the frequency list', () => {
    const stats = createMediaStats({
      a: { word: 'a', ease: 1, timesSeen: 2, timesHovered: 0 },
      b: { word: 'b', ease: 1, timesSeen: 3, timesHovered: 0 },
      c: { word: 'c', ease: 1, timesSeen: 1, timesHovered: 0 },
    });
    const lookup = createFreqLookup({
      a: { raw_level: 1, level: 'A1' },
      b: { raw_level: 2, level: 'A2' },
      c: { raw_level: 3, level: 'B1' },
    });
    const result = computeWordLevelPercentages(stats, lookup);
    const totalUniquePct = result.entries.reduce((s, e) => s + e.uniquePercent, 0);
    const totalOccurrencePct = result.entries.reduce((s, e) => s + e.occurrencePercent, 0);
    expect(totalUniquePct).toBeCloseTo(100);
    expect(totalOccurrencePct).toBeCloseTo(100);
  });

  it('uniquePercent does not reach 100 when some words are skipped', () => {
    const stats = createMediaStats({
      known: { word: 'known', ease: 1, timesSeen: 1, timesHovered: 0 },
      skip1: { word: 'skip1', ease: 1, timesSeen: 5, timesHovered: 0 },
      skip2: { word: 'skip2', ease: 1, timesSeen: 5, timesHovered: 0 },
    });
    const lookup = createFreqLookup({ known: { raw_level: 1, level: 'A1' } });
    const result = computeWordLevelPercentages(stats, lookup);
    const totalUniquePct = result.entries.reduce((s, e) => s + e.uniquePercent, 0);
    expect(totalUniquePct).toBeCloseTo(100);
    expect(result.totalUnique).toBe(1);
  });

  it('uses raw_level for bucket not string level', () => {
    const stats = createMediaStats({
      word1: { word: 'word1', ease: 1, timesSeen: 1, timesHovered: 0 },
      word2: { word: 'word2', ease: 1, timesSeen: 1, timesHovered: 0 },
    });
    const lookup = createFreqLookup({
      word1: { raw_level: 5, level: 'High' },
      word2: { raw_level: 5, level: 'High' },
    });
    const result = computeWordLevelPercentages(stats, lookup);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].level).toBe(5);
    expect(result.entries[0].uniqueCount).toBe(2);
  });

  it('uses levelName from levelNames map with fallback to Level {n}', () => {
    const stats = createMediaStats({
      word1: { word: 'word1', ease: 1, timesSeen: 1, timesHovered: 0 },
    });
    const lookup = createFreqLookupWithLevelNames(
      { word1: { raw_level: 99, level: 'special' } },
      { '99': 'MyCustomLevel' },
    );
    const result = computeWordLevelPercentages(stats, lookup);
    expect(result.entries[0].levelName).toBe('MyCustomLevel');
  });

  it('falls back to Level {n} when level name not in map', () => {
    const stats = createMediaStats({
      word1: { word: 'word1', ease: 1, timesSeen: 1, timesHovered: 0 },
    });
    const lookup = createFreqLookupWithLevelNames(
      { word1: { raw_level: 7, level: 'x' } },
      { '7': '' },
    );
    const result = computeWordLevelPercentages(stats, lookup);
    expect(result.entries[0].levelName).toBe('Level 7');
  });

  it('includes all defined levels in entries even when count is zero', () => {
    const stats = createMediaStats({
      word1: { word: 'word1', ease: 1, timesSeen: 2, timesHovered: 0 },
    });
    const lookup = createFreqLookupWithLevelNames(
      { word1: { raw_level: 1, level: 'A1' } },
      { '1': 'A1', '2': 'A2', '3': 'B1' },
    );
    const result = computeWordLevelPercentages(stats, lookup);
    expect(result.entries).toHaveLength(3);
    const empty = result.entries.find(e => e.level === 2)!;
    expect(empty.uniqueCount).toBe(0);
    expect(empty.occurrenceCount).toBe(0);
    expect(empty.uniquePercent).toBe(0);
    expect(empty.occurrencePercent).toBe(0);
  });
});

describe('computeGrammarLevelPercentages', () => {
  it('returns empty result when grammarEncountered is empty', () => {
    const stats = createMediaStats({}, {});
    const lookup = createGrammarLookup({}, { '1': 'G1', '2': 'G2' });
    const result = computeGrammarLevelPercentages(stats, lookup);
    expect(result.entries).toHaveLength(2);
    expect(result.totalUnique).toBe(0);
    expect(result.totalOccurrences).toBe(0);
  });

  it('returns empty result when level names are empty', () => {
    const stats = createMediaStats(
      {},
      { pat1: { pattern: 'pat1', ease: 1, timesFailed: 0 } },
    );
    const lookup = createGrammarLookup({ pat1: { level: 1, levelName: 'G1' } }, {});
    const result = computeGrammarLevelPercentages(stats, lookup);
    expect(result).toEqual({ entries: [], totalUnique: 0, totalOccurrences: 0 });
  });

  it('handles grammar points at various levels', () => {
    const stats = createMediaStats(
      {},
      {
        pat1: { pattern: 'pat1', ease: 1, timesFailed: 0 },
        pat2: { pattern: 'pat2', ease: 1, timesFailed: 2 },
        pat3: { pattern: 'pat3', ease: 1, timesFailed: 1 },
      },
    );
    const lookup = createGrammarLookup(
      {
        pat1: { level: 1, levelName: 'G1' },
        pat2: { level: 2, levelName: 'G2' },
        pat3: { level: 1, levelName: 'G1' },
      },
      { '1': 'G1', '2': 'G2' },
    );
    const result = computeGrammarLevelPercentages(stats, lookup);
    expect(result.totalUnique).toBe(3);

    const l1 = result.entries.find(e => e.level === 1)!;
    const l2 = result.entries.find(e => e.level === 2)!;

    expect(l1.uniqueCount).toBe(2);
    expect(l2.uniqueCount).toBe(1);
  });

  it('skips grammar point when getGrammarPoint returns null', () => {
    const stats = createMediaStats(
      {},
      {
        pat1: { pattern: 'pat1', ease: 1, timesFailed: 0 },
        pat2: { pattern: 'pat2', ease: 1, timesFailed: 0 },
      },
    );
    const lookup = createGrammarLookup(
      { pat1: { level: 1, levelName: 'G1' }, pat2: null },
      { '1': 'G1' },
    );
    const result = computeGrammarLevelPercentages(stats, lookup);
    expect(result.totalUnique).toBe(1);
  });

  it('skips grammar point when getGrammarPoint returns undefined', () => {
    const stats = createMediaStats(
      {},
      {
        pat1: { pattern: 'pat1', ease: 1, timesFailed: 0 },
        pat2: { pattern: 'pat2', ease: 1, timesFailed: 0 },
      },
    );
    const lookup = createGrammarLookup(
      { pat1: { level: 1, levelName: 'G1' }, pat2: undefined },
      { '1': 'G1' },
    );
    const result = computeGrammarLevelPercentages(stats, lookup);
    expect(result.totalUnique).toBe(1);
  });

  it('weights occurrences by 1 + timesFailed', () => {
    const stats = createMediaStats(
      {},
      {
        pat1: { pattern: 'pat1', ease: 1, timesFailed: 0 },
        pat2: { pattern: 'pat2', ease: 1, timesFailed: 4 },
      },
    );
    const lookup = createGrammarLookup(
      {
        pat1: { level: 1, levelName: 'G1' },
        pat2: { level: 1, levelName: 'G1' },
      },
      { '1': 'G1' },
    );
    const result = computeGrammarLevelPercentages(stats, lookup);
    const l1 = result.entries.find(e => e.level === 1)!;
    expect(l1.occurrenceCount).toBe((1 + 0) + (1 + 4));
    expect(result.totalOccurrences).toBe(6);
  });

  it('sorts entries by level descending', () => {
    const stats = createMediaStats(
      {},
      {
        pat1: { pattern: 'pat1', ease: 1, timesFailed: 0 },
        pat2: { pattern: 'pat2', ease: 1, timesFailed: 0 },
        pat3: { pattern: 'pat3', ease: 1, timesFailed: 0 },
      },
    );
    const lookup = createGrammarLookup(
      {
        pat1: { level: 1, levelName: 'G1' },
        pat2: { level: 3, levelName: 'G3' },
        pat3: { level: 2, levelName: 'G2' },
      },
      { '1': 'G1', '2': 'G2', '3': 'G3' },
    );
    const result = computeGrammarLevelPercentages(stats, lookup);
    const levels = result.entries.map(e => e.level);
    expect(levels).toEqual([3, 2, 1]);
  });

  it('computes uniquePercent and occurrencePercent correctly', () => {
    const stats = createMediaStats(
      {},
      {
        pat1: { pattern: 'pat1', ease: 1, timesFailed: 1 },
        pat2: { pattern: 'pat2', ease: 1, timesFailed: 3 },
      },
    );
    const lookup = createGrammarLookup(
      {
        pat1: { level: 1, levelName: 'G1' },
        pat2: { level: 2, levelName: 'G2' },
      },
      { '1': 'G1', '2': 'G2' },
    );
    const result = computeGrammarLevelPercentages(stats, lookup);
    expect(result.totalUnique).toBe(2);
    expect(result.totalOccurrences).toBe(2 + 4);

    const l1 = result.entries.find(e => e.level === 1)!;
    const l2 = result.entries.find(e => e.level === 2)!;

    expect(l1.uniquePercent).toBeCloseTo(50);
    expect(l2.uniquePercent).toBeCloseTo(50);
    expect(l1.occurrencePercent).toBeCloseTo((2 / 6) * 100);
    expect(l2.occurrencePercent).toBeCloseTo((4 / 6) * 100);
  });

  it('includes zero-count entries for all defined levels', () => {
    const stats = createMediaStats(
      {},
      { pat1: { pattern: 'pat1', ease: 1, timesFailed: 0 } },
    );
    const lookup = createGrammarLookup(
      { pat1: { level: 1, levelName: 'G1' } },
      { '1': 'G1', '2': 'G2', '3': 'G3' },
    );
    const result = computeGrammarLevelPercentages(stats, lookup);
    expect(result.entries).toHaveLength(3);
    const empty = result.entries.find(e => e.level === 3)!;
    expect(empty.uniqueCount).toBe(0);
    expect(empty.uniquePercent).toBe(0);
  });
});

describe('assessMediaLevel', () => {
  it('returns null when totalUnique is 0', () => {
    const data: LevelPercentages = { entries: [], totalUnique: 0, totalOccurrences: 0 };
    expect(assessMediaLevel(data)).toBeNull();
  });

  it('returns null when totalUnique is 0 even with entries', () => {
    const data: LevelPercentages = {
      entries: [{ level: 5, levelName: 'High', uniquePercent: 100, occurrencePercent: 100, uniqueCount: 0, occurrenceCount: 0 }],
      totalUnique: 0,
      totalOccurrences: 0,
    };
    expect(assessMediaLevel(data)).toBeNull();
  });

  it('returns null when entries array is empty and totalUnique > 0', () => {
    const data: LevelPercentages = { entries: [], totalUnique: 5, totalOccurrences: 5 };
    expect(assessMediaLevel(data)).toBeNull();
  });

  it('returns the single entry level when it is at 100%', () => {
    const data: LevelPercentages = {
      entries: [{ level: 3, levelName: 'B1', uniquePercent: 100, occurrencePercent: 100, uniqueCount: 5, occurrenceCount: 10 }],
      totalUnique: 5,
      totalOccurrences: 10,
    };
    expect(assessMediaLevel(data)).toBe(3);
  });

  it('returns the level where cumulative uniquePercent first hits 50%', () => {
    const data: LevelPercentages = {
      entries: [
        { level: 5, levelName: 'E5', uniquePercent: 30, occurrencePercent: 30, uniqueCount: 3, occurrenceCount: 3 },
        { level: 4, levelName: 'E4', uniquePercent: 25, occurrencePercent: 25, uniqueCount: 2, occurrenceCount: 2 },
        { level: 3, levelName: 'E3', uniquePercent: 20, occurrencePercent: 20, uniqueCount: 2, occurrenceCount: 2 },
        { level: 2, levelName: 'E2', uniquePercent: 15, occurrencePercent: 15, uniqueCount: 1, occurrenceCount: 1 },
        { level: 1, levelName: 'E1', uniquePercent: 10, occurrencePercent: 10, uniqueCount: 1, occurrenceCount: 1 },
      ],
      totalUnique: 10,
      totalOccurrences: 10,
    };
    expect(assessMediaLevel(data)).toBe(4);
  });

  it('returns last entry level when cumulative never reaches 50% (percentages do not sum to 100)', () => {
    const data: LevelPercentages = {
      entries: [
        { level: 3, levelName: 'B1', uniquePercent: 10, occurrencePercent: 10, uniqueCount: 1, occurrenceCount: 1 },
        { level: 2, levelName: 'A2', uniquePercent: 10, occurrencePercent: 10, uniqueCount: 1, occurrenceCount: 1 },
        { level: 1, levelName: 'A1', uniquePercent: 10, occurrencePercent: 10, uniqueCount: 1, occurrenceCount: 1 },
      ],
      totalUnique: 3,
      totalOccurrences: 3,
    };
    expect(assessMediaLevel(data)).toBe(1);
  });

  it('returns first entry level when it alone exceeds 50%', () => {
    const data: LevelPercentages = {
      entries: [
        { level: 5, levelName: 'E5', uniquePercent: 80, occurrencePercent: 80, uniqueCount: 8, occurrenceCount: 8 },
        { level: 2, levelName: 'A2', uniquePercent: 20, occurrencePercent: 20, uniqueCount: 2, occurrenceCount: 2 },
      ],
      totalUnique: 10,
      totalOccurrences: 10,
    };
    expect(assessMediaLevel(data)).toBe(5);
  });

  it('returns the exact entry at 50% (boundary)', () => {
    const data: LevelPercentages = {
      entries: [
        { level: 3, levelName: 'B1', uniquePercent: 50, occurrencePercent: 50, uniqueCount: 5, occurrenceCount: 5 },
        { level: 1, levelName: 'A1', uniquePercent: 50, occurrencePercent: 50, uniqueCount: 5, occurrenceCount: 5 },
      ],
      totalUnique: 10,
      totalOccurrences: 10,
    };
    expect(assessMediaLevel(data)).toBe(3);
  });

  it('entries iterate from highest level first (cumulative logic)', () => {
    const data: LevelPercentages = {
      entries: [
        { level: 10, levelName: 'X10', uniquePercent: 5, occurrencePercent: 5, uniqueCount: 5, occurrenceCount: 5 },
        { level: 5, levelName: 'X5', uniquePercent: 5, occurrencePercent: 5, uniqueCount: 5, occurrenceCount: 5 },
        { level: 1, levelName: 'X1', uniquePercent: 90, occurrencePercent: 90, uniqueCount: 90, occurrenceCount: 90 },
      ],
      totalUnique: 100,
      totalOccurrences: 100,
    };
    expect(assessMediaLevel(data)).toBe(1);
  });
});
