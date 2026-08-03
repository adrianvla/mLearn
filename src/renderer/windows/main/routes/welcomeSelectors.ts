/**
 * Welcome feature-card selectors.
 * Pure helpers for deriving the real state shown in welcome previews.
 */

import type { DailyStudyStats, Flashcard, TranslationEntry, TranslationResponse } from '../../../../shared/types';
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
 * Merge two row lists word-deduplicated (case-insensitive), primary first, capped at max.
 */
export function mergeRowLists(
  primary: RecentWordRow[],
  additional: RecentWordRow[],
  max = 4,
): RecentWordRow[] {
  const seen = new Set<string>();
  const merged: RecentWordRow[] = [];
  for (const row of [...primary, ...additional]) {
    const key = row.word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
    if (merged.length >= max) break;
  }
  return merged;
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
  return mergeRowLists(
    flashcardRows,
    ankiWords.map((word) => ({ word, reading: undefined, back: '' })),
    max,
  );
}

/** Dictionary rows for the welcome lookup card; slot 1 of `data` is the structured/full-HTML entry and slot 2 a prosody payload — neither is a preview row. */
export function selectDictionaryRows(
  response: TranslationResponse | null,
  fallbackWord: string,
  max = 4,
): RecentWordRow[] {
  if (!response) return [];
  const rows: RecentWordRow[] = [];
  for (const raw of response.data) {
    if (typeof raw !== 'object' || raw === null) continue;
    if (!('definitions' in raw)) continue;
    const entry = raw as TranslationEntry;
    const definitions = Array.isArray(entry.definitions)
      ? entry.definitions
      : [entry.definitions];
    if (!entry.word && !entry.reading && definitions.length === 0) continue;
    // The preview shows plain-text definitions only; skip entries whose
    // definitions carry HTML markup (e.g. the structured slot-1 entry).
    if (definitions.some((definition) => definition.includes('<'))) continue;
    rows.push({
      word: entry.word || fallbackWord,
      reading: entry.reading || undefined,
      back: definitions.join(', '),
    });
    if (rows.length >= max) break;
  }
  return rows;
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
