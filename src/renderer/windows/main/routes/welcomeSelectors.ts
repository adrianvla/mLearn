/**
 * Welcome feature-card selectors.
 * Pure helpers for deriving the real state shown in welcome previews.
 */

import type { DailyStudyStats, Flashcard } from '../../../../shared/types';
import type { LevelStats } from '../../../utils/wordLevelStats';

/** Newest populated card for the given language, or null. */
export function selectNewestFlashcard(
  cards: Record<string, Flashcard>,
  language: string,
): Flashcard | null {
  let newest: Flashcard | null = null;
  for (const card of Object.values(cards)) {
    if (card.language !== language || card.content.unpopulated) continue;
    if (newest === null || card.createdAt > newest.createdAt) newest = card;
  }
  return newest;
}

export interface RecentWordRow {
  word: string;
  reading?: string;
  back: string;
}

/** Newest populated word rows for the language, sorted by creation, capped at max. */
export function selectRecentWordRows(
  cards: Record<string, Flashcard>,
  language: string,
  max = 3,
): RecentWordRow[] {
  const matched: Array<{ createdAt: number; row: RecentWordRow }> = [];
  for (const card of Object.values(cards)) {
    if (card.language !== language || card.content.unpopulated) continue;
    if (!card.content.front) continue;
    matched.push({
      createdAt: card.createdAt,
      row: {
        word: card.content.front,
        reading: card.content.reading,
        back: card.content.back,
      },
    });
  }
  matched.sort((a, b) => b.createdAt - a.createdAt);
  return matched.slice(0, max).map((entry) => entry.row);
}

/**
 * Live quick-search over the user's flashcards. Empty/whitespace query yields [].
 * Case-insensitive `includes` match against front, reading, and back; front-prefix
 * matches rank first, then newest first; capped at max.
 */
export function selectWordSearchRows(
  cards: Record<string, Flashcard>,
  language: string,
  query: string,
  max = 4,
): RecentWordRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const matched: Array<{ createdAt: number; prefix: boolean; row: RecentWordRow }> = [];
  for (const card of Object.values(cards)) {
    if (card.language !== language || card.content.unpopulated) continue;
    if (!card.content.front) continue;
    const front = card.content.front;
    const reading = card.content.reading ?? '';
    const back = card.content.back;
    const haystack = `${front} ${reading} ${back}`.toLowerCase();
    if (!haystack.includes(q)) continue;
    matched.push({
      createdAt: card.createdAt,
      prefix: front.toLowerCase().startsWith(q),
      row: { word: front, reading: card.content.reading, back },
    });
  }
  matched.sort((a, b) => {
    if (a.prefix !== b.prefix) return a.prefix ? -1 : 1;
    return b.createdAt - a.createdAt;
  });
  return matched.slice(0, max).map((entry) => entry.row);
}

/**
 * Merge flashcard search rows with Anki cache words. Flashcard rows keep their
 * position; Anki words fill the remaining slots, deduped case-insensitively on word.
 */
export function mergeWordRows(
  flashcardRows: RecentWordRow[],
  ankiWords: string[],
  max = 4,
): RecentWordRow[] {
  const seen = new Set(flashcardRows.map((row) => row.word.toLowerCase()));
  const merged = [...flashcardRows];
  for (const word of ankiWords) {
    if (merged.length >= max) break;
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ word, reading: undefined, back: '' });
  }
  return merged.slice(0, max);
}

export interface WeekStatDay {
  /** Local date key in YYYY-MM-DD form, matching the flashcard store's dailyStats keys. */
  date: string;
  newCards: number;
  reviews: number;
  total: number;
}

/** Seven days ending at `now` (oldest first) with per-language study counts, missing days zeroed. */
export function selectWeekStats(
  dailyStats: Record<string, Record<string, DailyStudyStats>>,
  language: string,
  now: Date,
): WeekStatDay[] {
  const days: WeekStatDay[] = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setDate(date.getDate() - offset);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const entry = dailyStats[key]?.[language];
    const newCards = entry?.newCardsStudied ?? 0;
    const reviews = entry?.reviewCardsStudied ?? 0;
    days.push({ date: key, newCards, reviews, total: newCards + reviews });
  }
  return days;
}

export interface LevelChips {
  active: LevelStats | null;
  chips: LevelStats[];
}

/** Active level = first with unknown words, else last; chips window centered on active. */
export function selectLevelChips(
  levels: readonly LevelStats[],
  count = 5,
): LevelChips {
  if (levels.length === 0) return { active: null, chips: [] };
  const active = levels.find((level) => level.known < level.total) ?? levels[levels.length - 1];
  const activeIndex = levels.indexOf(active);
  const start = Math.max(
    0,
    Math.min(activeIndex - Math.floor((count - 1) / 2), levels.length - count),
  );
  return { active, chips: levels.slice(start, start + count) };
}
