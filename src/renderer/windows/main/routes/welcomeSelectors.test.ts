// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { mergeWordRows, selectLevelChips, selectNewestFlashcard, selectRecentWordRows, selectWeekStats, selectWordSearchRows } from './welcomeSelectors';
import type { Flashcard } from '../../../../shared/types';

const makeCard = (overrides: Partial<Flashcard> & { id: string; createdAt: number }): Flashcard => ({
  content: { type: 'word', front: 'front', back: 'back' },
  state: 'new',
  ease: 2.5,
  interval: 0,
  dueDate: 0,
  reviews: 0,
  lapses: 0,
  learningStep: 0,
  lastReviewed: 0,
  lastUpdated: 0,
  language: 'ja',
  ...overrides,
});

describe('selectNewestFlashcard', () => {
  it('returns the newest populated card for the language', () => {
    const cards = {
      a: makeCard({ id: 'a', createdAt: 100 }),
      b: makeCard({ id: 'b', createdAt: 300 }),
      c: makeCard({ id: 'c', createdAt: 200 }),
    };
    expect(selectNewestFlashcard(cards, 'ja')?.id).toBe('b');
  });

  it('ignores other languages and unpopulated shells', () => {
    const cards = {
      other: makeCard({ id: 'other', createdAt: 999, language: 'de' }),
      shell: makeCard({ id: 'shell', createdAt: 500, content: { type: 'word', front: 'f', back: 'b', unpopulated: true } }),
      real: makeCard({ id: 'real', createdAt: 300 }),
    };
    expect(selectNewestFlashcard(cards, 'ja')?.id).toBe('real');
  });

  it('returns null when nothing matches', () => {
    expect(selectNewestFlashcard({}, 'ja')).toBeNull();
    expect(selectNewestFlashcard({ a: makeCard({ id: 'a', createdAt: 1, language: 'de' }) }, 'ja')).toBeNull();
  });
});

describe('selectRecentWordRows', () => {
  it('filters language and unpopulated shells, sorts newest first, caps at max', () => {
    const cards = {
      old: makeCard({ id: 'old', createdAt: 100, content: { type: 'word', front: 'aaa', back: 'b1', reading: 'r1' } }),
      other: makeCard({ id: 'other', createdAt: 900, language: 'de', content: { type: 'word', front: 'deu', back: 'b2' } }),
      shell: makeCard({ id: 'shell', createdAt: 800, content: { type: 'word', front: 'sh', back: 'b3', unpopulated: true } }),
      mid: makeCard({ id: 'mid', createdAt: 300, content: { type: 'word', front: 'bbb', back: 'b4' } }),
      newest: makeCard({ id: 'newest', createdAt: 500, content: { type: 'word', front: 'ccc', back: 'b5' } }),
    };
    const rows = selectRecentWordRows(cards, 'ja', 2);
    expect(rows).toEqual([
      { word: 'ccc', back: 'b5' },
      { word: 'bbb', back: 'b4' },
    ]);
  });

  it('skips cards without a front', () => {
    const cards = {
      empty: makeCard({ id: 'empty', createdAt: 1, content: { type: 'word', front: '', back: 'x' } }),
      real: makeCard({ id: 'real', createdAt: 2 }),
    };
    expect(selectRecentWordRows(cards, 'ja', 3)).toEqual([{ word: 'front', back: 'back' }]);
  });
});

describe('selectWordSearchRows', () => {
  it('returns [] for an empty or whitespace-only query', () => {
    const cards = { a: makeCard({ id: 'a', createdAt: 1 }) };
    expect(selectWordSearchRows(cards, 'ja', '')).toEqual([]);
    expect(selectWordSearchRows(cards, 'ja', '   ')).toEqual([]);
  });

  it('filters by language and skips unpopulated shells', () => {
    const cards = {
      other: makeCard({ id: 'other', createdAt: 900, language: 'de', content: { type: 'word', front: 'cat', back: 'Katze' } }),
      shell: makeCard({ id: 'shell', createdAt: 800, content: { type: 'word', front: 'cat', back: 'x', unpopulated: true } }),
      real: makeCard({ id: 'real', createdAt: 100, content: { type: 'word', front: 'cat', back: 'neko' } }),
    };
    const rows = selectWordSearchRows(cards, 'ja', 'cat');
    expect(rows).toEqual([{ word: 'cat', back: 'neko' }]);
  });

  it('matches case-insensitively across front, reading, and back', () => {
    const cards = {
      front: makeCard({ id: 'front', createdAt: 1, content: { type: 'word', front: 'Pineapple', back: 'b1' } }),
      reading: makeCard({ id: 'reading', createdAt: 2, content: { type: 'word', front: 'x', reading: 'APPLE', back: 'b2' } }),
      back: makeCard({ id: 'back', createdAt: 3, content: { type: 'word', front: 'y', back: 'apple pie' } }),
      none: makeCard({ id: 'none', createdAt: 4, content: { type: 'word', front: 'zzz', back: 'yyy' } }),
    };
    const rows = selectWordSearchRows(cards, 'ja', 'APPLE');
    expect(rows.map((r) => r.word)).toEqual(['y', 'x', 'Pineapple']);
  });

  it('ranks front-prefix matches first, then newest first', () => {
    const cards = {
      prefixNewer: makeCard({ id: 'prefixNewer', createdAt: 200, content: { type: 'word', front: 'kitten', back: 'b1' } }),
      containsOlder: makeCard({ id: 'containsOlder', createdAt: 900, content: { type: 'word', front: 'the kitchen sink', back: 'b2' } }),
      prefixOlder: makeCard({ id: 'prefixOlder', createdAt: 50, content: { type: 'word', front: 'kit', back: 'b3' } }),
      prefixNewest: makeCard({ id: 'prefixNewest', createdAt: 800, content: { type: 'word', front: 'kitty', back: 'b4' } }),
    };
    const rows = selectWordSearchRows(cards, 'ja', 'kit');
    expect(rows.map((r) => r.word)).toEqual(['kitty', 'kitten', 'kit', 'the kitchen sink']);
  });

  it('caps the result count at max', () => {
    const cards: Record<string, Flashcard> = {};
    for (let i = 0; i < 6; i += 1) {
      cards[`c${i}`] = makeCard({ id: `c${i}`, createdAt: i, content: { type: 'word', front: `word${i}`, back: 'b' } });
    }
    const rows = selectWordSearchRows(cards, 'ja', 'word', 3);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.word)).toEqual(['word5', 'word4', 'word3']);
  });
});

describe('selectWeekStats', () => {
  it('returns exactly seven oldest-first days with per-language values and zeroed gaps', () => {
    const now = new Date(2026, 0, 10, 12, 0, 0); // 2026-01-10
    const dailyStats = {
      '2026-01-04': { ja: { date: '2026-01-04', newCardsStudied: 5, reviewCardsStudied: 2, timeSpent: 0, lapses: 0, graduated: 0 } },
      '2026-01-10': { ja: { date: '2026-01-10', newCardsStudied: 1, reviewCardsStudied: 9, timeSpent: 0, lapses: 0, graduated: 0 } },
      '2026-01-05': { de: { date: '2026-01-05', newCardsStudied: 99, reviewCardsStudied: 99, timeSpent: 0, lapses: 0, graduated: 0 } },
    };

    const days = selectWeekStats(dailyStats, 'ja', now);

    expect(days).toHaveLength(7);
    expect(days.map((d) => d.date)).toEqual([
      '2026-01-04', '2026-01-05', '2026-01-06', '2026-01-07',
      '2026-01-08', '2026-01-09', '2026-01-10',
    ]);
    expect(days[0]).toEqual({ date: '2026-01-04', newCards: 5, reviews: 2, total: 7 });
    expect(days[1]).toEqual({ date: '2026-01-05', newCards: 0, reviews: 0, total: 0 }); // other language ignored
    expect(days[6]).toEqual({ date: '2026-01-10', newCards: 1, reviews: 9, total: 10 });
  });

  it('is deterministic for a fixed now', () => {
    const now = new Date(2026, 5, 1, 0, 0, 0);
    const a = selectWeekStats({}, 'ja', now);
    const b = selectWeekStats({}, 'ja', now);
    expect(a).toEqual(b);
    expect(a.map((d) => d.date)).toEqual([
      '2026-05-26', '2026-05-27', '2026-05-28', '2026-05-29',
      '2026-05-30', '2026-05-31', '2026-06-01',
    ]);
  });
});

describe('mergeWordRows', () => {
  it('keeps flashcard rows first and fills the remaining slots with anki words', () => {
    const rows = mergeWordRows(
      [
        { word: 'cat', reading: 'neko', back: 'animal' },
        { word: 'dog', back: 'pet' },
      ],
      ['cat', 'bird', 'fish'],
      4,
    );
    expect(rows).toEqual([
      { word: 'cat', reading: 'neko', back: 'animal' },
      { word: 'dog', back: 'pet' },
      { word: 'bird', reading: undefined, back: '' },
      { word: 'fish', reading: undefined, back: '' },
    ]);
  });

  it('dedupes anki words against flashcard rows case-insensitively', () => {
    const rows = mergeWordRows(
      [{ word: 'Cat', back: 'b1' }],
      ['cat', 'CAT', 'Dog'],
      4,
    );
    expect(rows.map((r) => r.word)).toEqual(['Cat', 'Dog']);
  });

  it('caps the merged result at max', () => {
    const rows = mergeWordRows(
      [
        { word: 'a', back: '' },
        { word: 'b', back: '' },
      ],
      ['c', 'd', 'e'],
      3,
    );
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.word)).toEqual(['a', 'b', 'c']);
  });
});

describe('selectLevelChips', () => {
  const makeLevel = (level: number, knownPct: number) => ({
    level,
    name: `L${level}`,
    total: 100,
    known: Math.round((knownPct / 100) * 100),
    learning: 0,
    unknown: 0,
    untracked: 0,
    knownPct,
    learningPct: 0,
    unknownPct: 0,
    untrackedPct: 0,
  });

  it('picks the first incomplete level as active and centers a window of chips', () => {
    const levels = [
      makeLevel(1, 100),
      makeLevel(2, 100),
      makeLevel(3, 60),
      makeLevel(4, 40),
      makeLevel(5, 10),
      makeLevel(6, 0),
    ];
    const { active, chips } = selectLevelChips(levels, 5);
    expect(active?.level).toBe(3);
    expect(chips.map((c) => c.level)).toEqual([1, 2, 3, 4, 5]);
  });

  it('falls back to the last level when all are complete, and handles empty input', () => {
    const allDone = [makeLevel(1, 100), makeLevel(2, 100)];
    expect(selectLevelChips(allDone, 5).active?.level).toBe(2);
    expect(selectLevelChips([], 5)).toEqual({ active: null, chips: [] });
  });

  it('keeps a level active when rounded display percentage is 100 but words remain', () => {
    const roundedIncomplete = {
      ...makeLevel(1, 100),
      total: 2000,
      known: 1999,
    };
    const complete = makeLevel(2, 100);

    expect(selectLevelChips([roundedIncomplete, complete], 5).active?.level).toBe(1);
  });
});
