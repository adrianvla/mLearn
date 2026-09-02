import { describe, expect, it } from 'vitest';
import {
  estimateTokens,
  rankRecentThreadEvents,
  recentTailWithinBudget,
  scoreMemoryEntries,
  selectWithinBudget,
  tokenize,
} from './contextRanking';

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

describe('tokenize', () => {
  it('lowercases spaced-script word runs and drops tokens shorter than 2 chars', () => {
    expect(tokenize('Hello, WORLD! a I 42')).toEqual(['hello', 'world', '42']);
  });

  it('tokenizes unspaced Japanese per character, never as one multi-char token', () => {
    expect(tokenize('花生アレルギーがあります')).toEqual([
      '花',
      '生',
      'ア',
      'レ',
      'ル',
      'ギ',
      'が',
      'あ',
      'り',
      'ま',
      'す',
    ]);
  });

  it('splits CJK code points out of mixed-script runs individually', () => {
    expect(tokenize('ABC漢字DEF')).toEqual(['abc', '漢', '字', 'def']);
  });
});

describe('estimateTokens', () => {
  it('counts four characters per token for non-CJK text, rounding up', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abc')).toBe(1);
    expect(estimateTokens('abcdefgh')).toBe(2);
  });

  it('counts each CJK code point as one token', () => {
    expect(estimateTokens('東京タワー')).toBe(5);
    expect(estimateTokens('한국어')).toBe(3);
    expect(estimateTokens('abc東京')).toBe(3);
  });
});

describe('scoreMemoryEntries', () => {
  it('ranks a turn-relevant old memory above a newer irrelevant one', () => {
    const entries = [
      { kind: 'belief' as const, text: 'She loved her trip to Tokyo.', createdAt: NOW - 60 * DAY },
      { kind: 'belief' as const, text: 'Notes about the accounting meeting.', createdAt: NOW },
    ];

    const ranked = scoreMemoryEntries(entries, 'What did she say about Tokyo?', NOW);
    expect(ranked.map((r) => r.entry.text)).toEqual([
      'She loved her trip to Tokyo.',
      'Notes about the accounting meeting.',
    ]);
  });

  it('retrieves an old Japanese memory by a CJK query substring', () => {
    const entries = [
      { text: '花生アレルギーがあります', createdAt: NOW - 60 * DAY },
      { text: 'About the accounting meeting', createdAt: NOW },
    ];

    const ranked = scoreMemoryEntries(entries, '花生', NOW);
    expect(ranked[0].entry.text).toBe('花生アレルギーがあります');
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it('retrieves a Chinese memory by individual CJK terms from the query', () => {
    const entries = [
      { text: '我对花生过敏', createdAt: NOW - 30 * DAY },
      { text: 'recent unrelated note', createdAt: NOW },
    ];

    expect(scoreMemoryEntries(entries, '花生', NOW)[0].entry.text).toBe('我对花生过敏');
    expect(scoreMemoryEntries(entries, '过敏', NOW)[0].entry.text).toBe('我对花生过敏');
  });

  it('keeps Latin matching behavior: full words match, single letters drop', () => {
    expect(tokenize('a peanuts')).toEqual(['peanuts']);
    const entries = [
      { text: 'allergic to peanuts', createdAt: NOW - DAY },
      { text: 'grocery list', createdAt: NOW },
    ];

    expect(scoreMemoryEntries(entries, 'peanuts', NOW)[0].entry.text).toBe('allergic to peanuts');
  });

  it('awards the exact-substring bonus only when one text contains the other', () => {
    const entries = [
      { text: 'photos of tokyo and trip planning', createdAt: NOW },
      { text: 'tokyo trip', createdAt: NOW },
    ];

    const ranked = scoreMemoryEntries(entries, 'tokyo trip', NOW);
    // Coverage is equal (both hold both turn tokens); only the bonus differs.
    expect(ranked[0].entry.text).toBe('tokyo trip');
    expect(ranked[0].score - ranked[1].score).toBeCloseTo(0.5, 6);
  });

  it('counts recency with a 14-day half-life', () => {
    const fresh = scoreMemoryEntries([{ text: 'same words here', createdAt: NOW }], 'same words', NOW);
    const halfLifeOld = scoreMemoryEntries(
      [{ text: 'same words here', createdAt: NOW - 14 * DAY }],
      'same words',
      NOW,
    );
    expect(fresh[0].score - halfLifeOld[0].score).toBeCloseTo(0.5, 6);
  });

  it('applies the small kind weight: open-loop > relationship > belief > episode > fact', () => {
    const kinds = ['open-loop', 'relationship', 'belief', 'episode', 'fact'] as const;
    const entries = kinds.map((kind, i) => ({ kind, text: `entry ${i}`, createdAt: NOW }));

    const ranked = scoreMemoryEntries(entries, 'nothing matches this', NOW);
    expect(ranked.map((r) => r.entry.kind)).toEqual([...kinds]);
  });

  it('is deterministic across repeated calls', () => {
    const entries = [
      { kind: 'belief' as const, text: 'tokyo trip notes', createdAt: NOW - DAY },
      { kind: 'fact' as const, text: 'ledger totals', createdAt: NOW },
    ];

    expect(scoreMemoryEntries(entries, 'tokyo trip', NOW)).toEqual(
      scoreMemoryEntries(entries, 'tokyo trip', NOW),
    );
  });

  it('treats a blank turn as zero lexical signal, ordering by recency only', () => {
    const entries = [
      { text: 'older entry', createdAt: NOW - DAY },
      { text: 'newer entry', createdAt: NOW },
    ];

    const ranked = scoreMemoryEntries(entries, '   ', NOW);
    expect(ranked.map((r) => r.entry.text)).toEqual(['newer entry', 'older entry']);
  });
});

describe('selectWithinBudget', () => {
  it('takes highest-scored entries first and skips entries that no longer fit', () => {
    const ranked = [
      { entry: { text: 'aaaa', createdAt: NOW }, score: 9 }, // 1 token
      { entry: { text: 'bbbb', createdAt: NOW }, score: 8 }, // 1 token
      { entry: { text: 'cccccccccccccccc', createdAt: NOW }, score: 7 }, // 4 tokens
      { entry: { text: 'dd', createdAt: NOW }, score: 6 }, // 1 token
    ];

    expect(selectWithinBudget(ranked, 5).map((e) => e.text)).toEqual(['aaaa', 'bbbb', 'dd']);
  });

  it('keeps nothing when the budget is zero', () => {
    const ranked = [{ entry: { text: 'words', createdAt: NOW }, score: 1 }];
    expect(selectWithinBudget(ranked, 0)).toEqual([]);
  });
});

describe('rankRecentThreadEvents', () => {
  it('always keeps the newest keepLatest events and rescues turn-relevant older ones', () => {
    const events = Array.from({ length: 10 }, (_, i) => ({
      text: i % 2 === 0 ? `filler number ${i}` : `special topic ${i}`,
      createdAt: NOW - (10 - i) * DAY,
    }));

    const kept = rankRecentThreadEvents(events, 'special topic', 3);
    expect(kept.map((e) => e.text)).toEqual([
      events[1].text,
      events[3].text,
      events[5].text,
      events[7].text,
      events[8].text,
      events[9].text,
    ]);
  });

  it('keeps only the newest tail when nothing matches the turn', () => {
    const events = Array.from({ length: 6 }, (_, i) => ({ text: `filler ${i}`, createdAt: NOW - i }));

    expect(rankRecentThreadEvents(events, 'unmatched query', 2)).toEqual([events[4], events[5]]);
  });

  it('keeps everything when keepLatest covers the whole stream', () => {
    const events = [{ text: 'only one', createdAt: NOW }];
    expect(rankRecentThreadEvents(events, 'anything', 5)).toEqual(events);
  });

  it('treats a blank turn as no relevance signal', () => {
    const events = [
      { text: 'special topic old', createdAt: NOW - 2 * DAY },
      { text: 'filler new', createdAt: NOW },
    ];
    expect(rankRecentThreadEvents(events, '   ', 1)).toEqual([events[1]]);
  });
});

describe('recentTailWithinBudget', () => {
  it('keeps the newest contiguous tail that fits the budget', () => {
    const events = [
      { text: 'aaaa', createdAt: NOW }, // 1 token
      { text: 'bbbb', createdAt: NOW }, // 1 token
      { text: 'cccc', createdAt: NOW }, // 1 token
      { text: 'dddd', createdAt: NOW }, // 1 token
    ];

    expect(recentTailWithinBudget(events, 2).map((e) => e.text)).toEqual(['cccc', 'dddd']);
    expect(recentTailWithinBudget(events, 99).map((e) => e.text)).toEqual([
      'aaaa',
      'bbbb',
      'cccc',
      'dddd',
    ]);
    expect(recentTailWithinBudget(events, 0)).toEqual([]);
  });
});
