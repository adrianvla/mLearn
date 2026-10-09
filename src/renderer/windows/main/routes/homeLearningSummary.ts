import type { DailyStudyStats } from '../../../../shared/types';
import { progressDailyStats } from '../../statistics/progressScope';
export { goalDeadlineDayDifference } from '../../../../shared/learningGoals';

/** Recorded responses over all persisted daily records; never a mastery count. */
export function homeLifetimeReviewTotals(daily: Record<string, Record<string, DailyStudyStats>>, language: string): { reviews: number; newCardResponses: number } {
  return Object.values(progressDailyStats(daily, language)).reduce((totals, day) => ({
    reviews: totals.reviews + day[language].reviewCardsStudied,
    newCardResponses: totals.newCardResponses + day[language].newCardsStudied,
  }), { reviews: 0, newCardResponses: 0 });
}
