/**
 * Flashcard Stats Service
 * Unified, pure functions for calculating flashcard statistics.
 * Both the in-app FlashcardStats panel and the standalone Statistics Dashboard
 * consume these functions so numbers are always consistent.
 */

import type { Flashcard, DailyStudyStats } from '../../shared/types';
import { getEndOfSRSDay } from './srsAlgorithm';

const DAY = 24 * 60 * 60 * 1000;
const MATURE_THRESHOLD_DAYS = 21;
const MATURE_THRESHOLD_MS = MATURE_THRESHOLD_DAYS * DAY;

/** Build a YYYY-MM-DD key from a Date using local components (matches getTodayDateString). */
function getDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ============================================================================
// Types
// ============================================================================

export interface StateDistribution {
  new: number;
  learning: number;
  review: number;
  suspended: number;
  buried: number;
  total: number;
}

export interface IntervalBucket {
  label: string;
  max: number;
  count: number;
}

export interface EaseBucket {
  label: string;
  count: number;
}

export interface MaturityBreakdown {
  young: number;
  mature: number;
  total: number;
}

export interface RetentionStats {
  retention: number;
  totalReviews: number;
  totalLapses: number;
  totalNew: number;
  totalGraduated: number;
  avgTimePerDay: number;
  daysStudied: number;
  totalDays: number;
  totalTime: number;
}

export interface DailyActivityEntry {
  date: string;
  total: number;
  newCards: number;
  reviews: number;
  timeSpent: number;
}

export interface DueCounts {
  new: number;
  learning: number;
  review: number;
  relearning: number;
  total: number;
}

export interface StreakInfo {
  current: number;
  max: number;
}

export interface TodayStats {
  reviews: number;
  newCards: number;
  lapses: number;
  graduated: number;
  timeSpent: number;
}

// ============================================================================
// Helpers
// ============================================================================

function getSortedDateKeys(dailyStats: Record<string, DailyStudyStats>): string[] {
  return Object.keys(dailyStats).sort();
}

/**
 * Flatten nested per-language daily stats into a single aggregated record per date.
 */
export function aggregateDailyStats(
  dailyStats: Record<string, Record<string, DailyStudyStats>>
): Record<string, DailyStudyStats> {
  const result: Record<string, DailyStudyStats> = {};
  for (const [date, langMap] of Object.entries(dailyStats)) {
    const aggregated: DailyStudyStats = {
      date,
      newCardsStudied: 0,
      reviewCardsStudied: 0,
      lapses: 0,
      timeSpent: 0,
      graduated: 0,
    };
    for (const stats of Object.values(langMap)) {
      aggregated.newCardsStudied += stats.newCardsStudied;
      aggregated.reviewCardsStudied += stats.reviewCardsStudied;
      aggregated.lapses += stats.lapses;
      aggregated.timeSpent += stats.timeSpent;
      aggregated.graduated += stats.graduated;
    }
    result[date] = aggregated;
  }
  return result;
}

function getTodayKey(): string {
  return getDateKey(new Date());
}

// ============================================================================
// State Distribution
// ============================================================================

/**
 * Count cards by state. Buried cards are excluded from active states.
 * Learning and relearning are grouped together under `learning`.
 */
export function computeStateDistribution(cards: Flashcard[]): StateDistribution {
  const result: StateDistribution = {
    new: 0,
    learning: 0,
    review: 0,
    suspended: 0,
    buried: 0,
    total: cards.length,
  };

  for (const card of cards) {
    if (card.buried) {
      result.buried++;
      continue;
    }
    if (card.suspended) {
      result.suspended++;
      continue;
    }
    if (card.state === 'new') {
      result.new++;
    } else if (card.state === 'learning' || card.state === 'relearning') {
      result.learning++;
    } else if (card.state === 'review') {
      result.review++;
    }
  }

  return result;
}

// ============================================================================
// Ease Distribution
// ============================================================================

/**
 * Ease-factor buckets for graduated cards (review + relearning).
 * Buckets are half-open intervals [min, max).
 */
export function computeEaseDistribution(cards: Flashcard[]): EaseBucket[] {
  const buckets: EaseBucket[] = [
    { label: '<1.5', count: 0 },
    { label: '1.5-1.8', count: 0 },
    { label: '1.8-2.1', count: 0 },
    { label: '2.1-2.5', count: 0 },
    { label: '2.5-3.0', count: 0 },
    { label: '3.0+', count: 0 },
  ];

  const active = cards.filter(
    (c) => !c.suspended && !c.buried && (c.state === 'review' || c.state === 'relearning')
  );

  for (const card of active) {
    const e = card.ease;
    if (e < 1.5) buckets[0].count++;
    else if (e < 1.8) buckets[1].count++;
    else if (e < 2.1) buckets[2].count++;
    else if (e < 2.5) buckets[3].count++;
    else if (e < 3.0) buckets[4].count++;
    else buckets[5].count++;
  }

  return buckets;
}

// ============================================================================
// Interval Distribution
// ============================================================================

/**
 * Interval buckets for review-state cards.
 * Matches Anki-style granularity.
 */
export function computeIntervalDistribution(cards: Flashcard[]): IntervalBucket[] {
  const buckets: IntervalBucket[] = [
    { label: '<1d', max: DAY, count: 0 },
    { label: '1-3d', max: 3 * DAY, count: 0 },
    { label: '3-7d', max: 7 * DAY, count: 0 },
    { label: '1-2w', max: 14 * DAY, count: 0 },
    { label: '2w-1m', max: 30 * DAY, count: 0 },
    { label: '1-3m', max: 90 * DAY, count: 0 },
    { label: '3-6m', max: 180 * DAY, count: 0 },
    { label: '6m+', max: Infinity, count: 0 },
  ];

  const reviewed = cards.filter((c) => !c.suspended && !c.buried && c.state === 'review');

  for (const card of reviewed) {
    for (const bucket of buckets) {
      if (card.interval < bucket.max) {
        bucket.count++;
        break;
      }
    }
  }

  return buckets;
}

// ============================================================================
// Maturity
// ============================================================================

/**
 * Young vs mature breakdown for review-state cards.
 * Mature threshold = 21 days (Anki default).
 */
export function computeMaturityBreakdown(cards: Flashcard[]): MaturityBreakdown {
  const reviewed = cards.filter(
    (c) => !c.suspended && !c.buried && c.state === 'review'
  );
  const mature = reviewed.filter((c) => c.interval >= MATURE_THRESHOLD_MS).length;
  return {
    young: reviewed.length - mature,
    mature,
    total: reviewed.length,
  };
}

// ============================================================================
// Retention (rolling window)
// ============================================================================

/**
 * Retention stats over the last N days from dailyStats.
 * Retention = (reviewCardsStudied - lapses) / reviewCardsStudied
 */
export function computeRetentionStats(
  dailyStats: Record<string, DailyStudyStats>,
  days: number = 30
): RetentionStats {
  const keys = getSortedDateKeys(dailyStats).slice(-days);
  let totalReviews = 0;
  let totalLapses = 0;
  let totalTime = 0;
  let totalNew = 0;
  let totalGraduated = 0;

  for (const key of keys) {
    const d = dailyStats[key];
    totalReviews += d.reviewCardsStudied;
    totalLapses += d.lapses;
    totalTime += d.timeSpent;
    totalNew += d.newCardsStudied;
    totalGraduated += d.graduated;
  }

  const retention = totalReviews > 0 ? ((totalReviews - totalLapses) / totalReviews) * 100 : 0;
  const avgTimePerDay = keys.length > 0 ? totalTime / keys.length : 0;

  return {
    retention: Math.round(retention * 10) / 10,
    totalReviews,
    totalLapses,
    totalNew,
    totalGraduated,
    avgTimePerDay,
    daysStudied: keys.filter((k) => {
      const d = dailyStats[k];
      return d.reviewCardsStudied + d.newCardsStudied > 0;
    }).length,
    totalDays: keys.length,
    totalTime,
  };
}

// ============================================================================
// Average Ease
// ============================================================================

/**
 * Average ease factor for graduated cards.
 */
export function computeAverageEase(cards: Flashcard[]): number {
  const active = cards.filter(
    (c) => !c.suspended && !c.buried && (c.state === 'review' || c.state === 'relearning')
  );
  if (active.length === 0) return 0;
  const sum = active.reduce((s, c) => s + c.ease, 0);
  return Math.round((sum / active.length) * 100) / 100;
}

// ============================================================================
// Daily Activity
// ============================================================================

/**
 * Daily activity for the last N days.
 */
export function computeDailyActivity(
  dailyStats: Record<string, DailyStudyStats>,
  days: number = 30
): DailyActivityEntry[] {
  const result: DailyActivityEntry[] = [];
  const now = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = getDateKey(d);
    const stats = dailyStats[key];
    result.push({
      date: key,
      total: stats ? stats.newCardsStudied + stats.reviewCardsStudied : 0,
      newCards: stats?.newCardsStudied ?? 0,
      reviews: stats?.reviewCardsStudied ?? 0,
      timeSpent: stats?.timeSpent ?? 0,
    });
  }

  return result;
}

// ============================================================================
// Due Counts (actual, not session-limited)
// ============================================================================

/**
 * Count how many cards are actually due by the end of the current SRS day.
 * This is NOT session-limited; it reflects the true workload.
 */
export function computeDueCounts(cards: Flashcard[], newDayHour: number = 4): DueCounts {
  const dayEnd = getEndOfSRSDay(newDayHour);
  let newCards = 0;
  let learning = 0;
  let review = 0;
  let relearning = 0;

  for (const card of cards) {
    if (card.suspended || card.buried) continue;

    if (card.state === 'new') {
      newCards++;
    } else if (card.dueDate <= dayEnd) {
      if (card.state === 'learning') learning++;
      else if (card.state === 'review') review++;
      else if (card.state === 'relearning') relearning++;
    }
  }

  return {
    new: newCards,
    learning,
    review,
    relearning,
    total: newCards + learning + review + relearning,
  };
}

// ============================================================================
// Streaks
// ============================================================================

/**
 * Current streak (from today backwards) and max streak ever.
 */
export function computeStreaks(dailyStats: Record<string, DailyStudyStats>): StreakInfo {
  const keys = getSortedDateKeys(dailyStats);
  if (keys.length === 0) return { current: 0, max: 0 };

  // Current streak
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let current = 0;
  const streakDate = new Date(today);
  while (true) {
    const key = getDateKey(streakDate);
    const dayStat = dailyStats[key];
    if (dayStat && (dayStat.newCardsStudied + dayStat.reviewCardsStudied) > 0) {
      current++;
      streakDate.setDate(streakDate.getDate() - 1);
    } else {
      break;
    }
  }

  // Max streak
  let max = 0;
  for (let i = 0; i < keys.length; i++) {
    let s = 0;
    const d = new Date(keys[i]);
    for (;;) {
      const k = getDateKey(d);
      const st = dailyStats[k];
      if (st && (st.newCardsStudied + st.reviewCardsStudied) > 0) {
        s++;
        d.setDate(d.getDate() + 1);
      } else {
        break;
      }
    }
    if (s > max) max = s;
  }

  return { current, max };
}

// ============================================================================
// Today Stats
// ============================================================================

/**
 * Stats for the current calendar day.
 */
export function getTodayStats(dailyStats: Record<string, DailyStudyStats>): TodayStats {
  const today = getTodayKey();
  const stat = dailyStats[today];
  return {
    reviews: stat?.reviewCardsStudied ?? 0,
    newCards: stat?.newCardsStudied ?? 0,
    lapses: stat?.lapses ?? 0,
    graduated: stat?.graduated ?? 0,
    timeSpent: stat?.timeSpent ?? 0,
  };
}

// ============================================================================
// Comprehensive Card Stats (convenience for Dashboard)
// ============================================================================

export interface ComprehensiveCardStats {
  total: number;
  newCards: number;
  learning: number;
  review: number;
  suspended: number;
  buried: number;
  retentionRate: number;
  totalReviews: number;
  totalLapses: number;
  matureCount: number;
  youngCount: number;
  dueCount: number;
  intervalBuckets: IntervalBucket[];
}

/**
 * Compute all card-derived stats in one pass.
 */
export function computeComprehensiveCardStats(
  cards: Flashcard[],
  dailyStats: Record<string, DailyStudyStats>,
  newDayHour: number = 4
): ComprehensiveCardStats {
  const stateDist = computeStateDistribution(cards);
  const maturity = computeMaturityBreakdown(cards);
  const intervals = computeIntervalDistribution(cards);
  const retention = computeRetentionStats(dailyStats);
  const due = computeDueCounts(cards, newDayHour);

  return {
    total: stateDist.total,
    newCards: stateDist.new,
    learning: stateDist.learning,
    review: stateDist.review,
    suspended: stateDist.suspended,
    buried: stateDist.buried,
    retentionRate: retention.retention,
    totalReviews: retention.totalReviews,
    totalLapses: retention.totalLapses,
    matureCount: maturity.mature,
    youngCount: maturity.young,
    dueCount: due.total,
    intervalBuckets: intervals,
  };
}
