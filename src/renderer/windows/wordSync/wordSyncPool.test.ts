import { describe, it, expect } from 'vitest';
import {
  wasExplicitlySyncRated,
  shouldIncludeForLevel,
  calculateKanjiBoost,
  calculateWordWeight,
  isWordEligible,
  THIRTY_DAYS_MS,
} from './wordSyncPool';

// ---------------------------------------------------------------------------
// wasExplicitlySyncRated
// ---------------------------------------------------------------------------

describe('wasExplicitlySyncRated', () => {
  it('returns false for undefined knowledge', () => {
    expect(wasExplicitlySyncRated(undefined)).toBe(false);
  });

  it('returns true when wordSyncRatedAt is set', () => {
    expect(wasExplicitlySyncRated({ wordSyncRatedAt: 1000, ease: 1.3 } as never)).toBe(true);
  });

  it('returns true for legacy: lastStatusChange set, statusChangedAtSeen absent', () => {
    expect(wasExplicitlySyncRated({ lastStatusChange: 1000 })).toBe(true);
  });

  it('returns false for legacy: both lastStatusChange and statusChangedAtSeen set', () => {
    expect(wasExplicitlySyncRated({ lastStatusChange: 1000, statusChangedAtSeen: 500 })).toBe(false);
  });

  it('returns false when only statusChangedAtSeen is set', () => {
    expect(wasExplicitlySyncRated({ statusChangedAtSeen: 500 })).toBe(false);
  });

  it('returns false for empty object (passive-only)', () => {
    expect(wasExplicitlySyncRated({})).toBe(false);
  });

  it('prefers wordSyncRatedAt over legacy heuristic', () => {
    expect(wasExplicitlySyncRated({
      wordSyncRatedAt: 1000,
      lastStatusChange: 500,
      statusChangedAtSeen: 200,
    })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// shouldIncludeForLevel
// ---------------------------------------------------------------------------

describe('shouldIncludeForLevel', () => {
  it('includes all levels when target is 0', () => {
    expect(shouldIncludeForLevel(1, 0)).toBe(true);
    expect(shouldIncludeForLevel(5, 0)).toBe(true);
  });

  it('target=2 includes levels 2,3,4,5 (at or easier than target)', () => {
    expect(shouldIncludeForLevel(2, 2)).toBe(true);
    expect(shouldIncludeForLevel(3, 2)).toBe(true);
    expect(shouldIncludeForLevel(4, 2)).toBe(true);
    expect(shouldIncludeForLevel(5, 2)).toBe(true);
  });

  it('target=2 excludes level 1 (harder than target)', () => {
    expect(shouldIncludeForLevel(1, 2)).toBe(false);
  });

  it('target=5 includes only level 5', () => {
    expect(shouldIncludeForLevel(5, 5)).toBe(true);
    expect(shouldIncludeForLevel(4, 5)).toBe(false);
    expect(shouldIncludeForLevel(1, 5)).toBe(false);
  });

  it('target=1 includes all levels 1-5', () => {
    for (let lvl = 1; lvl <= 5; lvl++) {
      expect(shouldIncludeForLevel(lvl, 1)).toBe(true);
    }
  });

  it('negative target behaves like no filter', () => {
    expect(shouldIncludeForLevel(1, -1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// calculateKanjiBoost
// ---------------------------------------------------------------------------

describe('calculateKanjiBoost', () => {
  it('returns 1.0 when knownKanjiSet is empty', () => {
    expect(calculateKanjiBoost('漢字', new Set())).toBe(1.0);
  });

  it('returns 1.0 when word has no matching kanji', () => {
    expect(calculateKanjiBoost('あいう', new Set(['漢', '字']))).toBe(1.0);
  });

  it('returns 1.0 for word with kanji not in known set', () => {
    expect(calculateKanjiBoost('天気', new Set(['漢', '字']))).toBe(1.0);
  });

  it('boosts by 0.25 for 1 matching kanji', () => {
    expect(calculateKanjiBoost('漢字', new Set(['漢']))).toBe(1.25);
  });

  it('boosts by 0.50 for 2 matching kanji', () => {
    expect(calculateKanjiBoost('漢字', new Set(['漢', '字']))).toBe(1.5);
  });

  it('boosts by 0.75 for 3 matching kanji', () => {
    expect(calculateKanjiBoost('漢字学', new Set(['漢', '字', '学']))).toBe(1.75);
  });

  it('caps boost at 3 kanji (1.75x) even with 4+ matches', () => {
    expect(calculateKanjiBoost('漢字学校', new Set(['漢', '字', '学', '校']))).toBe(1.75);
  });

  it('handles empty word', () => {
    expect(calculateKanjiBoost('', new Set(['漢']))).toBe(1.0);
  });

  it('ignores kana characters', () => {
    expect(calculateKanjiBoost('漢あ字い', new Set(['漢', '字']))).toBe(1.5);
  });

  it('counts each distinct kanji only once', () => {
    expect(calculateKanjiBoost('漢漢漢', new Set(['漢']))).toBe(1.25);
  });
});

// ---------------------------------------------------------------------------
// isWordEligible
// ---------------------------------------------------------------------------

describe('isWordEligible', () => {
  const now = Date.now();
  const staleDaysMs = 30 * 24 * 60 * 60 * 1000;

  it('includes words with no knowledge (never seen)', () => {
    expect(isWordEligible(undefined, false, true, staleDaysMs, now)).toBe(true);
  });

  it('includes passive-only words (high ease but not sync-rated)', () => {
    const passive = { ease: 2.5 };
    expect(isWordEligible(passive, false, true, staleDaysMs, now)).toBe(true);
  });

  it('excludes recently rated known words (check-in staleness)', () => {
    const known = { ease: 1.8, wordSyncRatedAt: now - 1000 };
    expect(isWordEligible(known, false, true, staleDaysMs, now)).toBe(false);
  });

  it('includes stale known words as check-in', () => {
    const known = { ease: 1.8, wordSyncRatedAt: now - staleDaysMs - 1 };
    expect(isWordEligible(known, false, true, staleDaysMs, now)).toBe(true);
  });

  it('excludes recently rated known words via legacy heuristic', () => {
    const known = { ease: 1.8, lastStatusChange: now - 1000 };
    expect(isWordEligible(known, false, true, staleDaysMs, now)).toBe(false);
  });

  it('includes stale known words via legacy heuristic', () => {
    const known = { ease: 1.8, lastStatusChange: now - staleDaysMs - 1 };
    expect(isWordEligible(known, false, true, staleDaysMs, now)).toBe(true);
  });

  it('excludes recently rated learning words', () => {
    const learning = { ease: 1.55, wordSyncRatedAt: now - 1000 };
    expect(isWordEligible(learning, false, true, staleDaysMs, now)).toBe(false);
  });

  it('includes stale learning words', () => {
    const stale = { ease: 1.55, wordSyncRatedAt: now - staleDaysMs - 1 };
    expect(isWordEligible(stale, false, true, staleDaysMs, now)).toBe(true);
  });

  it('excludes explicitly rated unknown words during sync-seen cooldown', () => {
    const unknown = { ease: 1.3, wordSyncRatedAt: now - 1000 };
    expect(isWordEligible(unknown, true, true, staleDaysMs, now)).toBe(false);
  });

  it('includes explicitly rated unknown words after cooldown expires', () => {
    const unknown = { ease: 1.3, wordSyncRatedAt: now - 1000 };
    expect(isWordEligible(unknown, false, true, staleDaysMs, now)).toBe(true);
  });

  it('includes unknown words when ignoring seen filter', () => {
    const unknown = { ease: 1.3, wordSyncRatedAt: now - 1000 };
    expect(isWordEligible(unknown, true, false, staleDaysMs, now)).toBe(true);
  });

  it('excludes passive words seen recently when skipSeen is true', () => {
    const passive = { ease: 2.5 };
    expect(isWordEligible(passive, true, true, staleDaysMs, now)).toBe(false);
  });

  it('includes passive words seen recently when skipSeen is false', () => {
    const passive = { ease: 2.5 };
    expect(isWordEligible(passive, true, false, staleDaysMs, now)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// calculateWordWeight
// ---------------------------------------------------------------------------

describe('calculateWordWeight', () => {
  it('returns 2.0 for no knowledge (undefined ease)', () => {
    expect(calculateWordWeight(undefined, 1.0)).toBe(2.0);
  });

  it('returns 1.7 for unknown ease (1.3)', () => {
    expect(calculateWordWeight(1.3, 1.0)).toBeCloseTo(1.7);
  });

  it('returns 1.45 for learning ease (1.55)', () => {
    expect(calculateWordWeight(1.55, 1.0)).toBeCloseTo(1.45);
  });

  it('returns 1.2 for known ease (1.8)', () => {
    expect(calculateWordWeight(1.8, 1.0)).toBeCloseTo(1.2);
  });

  it('returns 0.5 for high passive ease (2.5)', () => {
    expect(calculateWordWeight(2.5, 1.0)).toBeCloseTo(0.5);
  });

  it('floors at 0.5 for very high ease', () => {
    expect(calculateWordWeight(4.0, 1.0)).toBe(0.5);
  });

  it('multiplies by kanji boost', () => {
    expect(calculateWordWeight(undefined, 1.5)).toBeCloseTo(3.0);
    expect(calculateWordWeight(1.3, 1.25)).toBeCloseTo(2.125);
  });

  it('unknown ease > passive high ease (priority ordering)', () => {
    const unknownWeight = calculateWordWeight(1.3, 1.0);
    const passiveWeight = calculateWordWeight(2.5, 1.0);
    expect(unknownWeight).toBeGreaterThan(passiveWeight);
  });

  it('no knowledge > explicitly rated unknown (priority ordering)', () => {
    const noKnowledge = calculateWordWeight(undefined, 1.0);
    const unknown = calculateWordWeight(1.3, 1.0);
    expect(noKnowledge).toBeGreaterThan(unknown);
  });
});

// ---------------------------------------------------------------------------
// THIRTY_DAYS_MS constant
// ---------------------------------------------------------------------------

describe('THIRTY_DAYS_MS', () => {
  it('equals 30 days in milliseconds', () => {
    expect(THIRTY_DAYS_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
