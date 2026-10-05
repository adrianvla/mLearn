import { describe, expect, it } from 'vitest';
import { progressDailyStats, progressMedia, recordedMediaDuration } from './progressScope';
import type { DailyStudyStats, MediaStats } from '../../../shared/types';

describe('Progress scope', () => {
  it('uses exact language identities for media and date-language review aggregates', () => {
    const stats: DailyStudyStats = { date: '2026-10-05', newCardsStudied: 1, reviewCardsStudied: 3, lapses: 0, graduated: 0, timeSpent: 1000 };
    const daily = { [stats.date]: { 'third.party': stats, other: { ...stats, reviewCardsStudied: 50 } }, '2026-10-04': { other: stats } };
    expect(progressDailyStats(daily, 'third.party')).toEqual({ [stats.date]: { 'third.party': stats } });
    expect(progressDailyStats(daily, null)).toBe(daily);
    const media = ['third.party', 'other', ''].map(language => ({ language } as MediaStats));
    expect(progressMedia(media, 'third.party')).toEqual([media[0]]);
    expect(progressMedia(media, null)).toBe(media);
  });
  it('counts overlapping recorded sessions once while retaining legacy durations', () => {
    const sessions = [
      { startTime: 0, endTime: 1000, duration: 1000 },
      { startTime: 500, endTime: 2000, duration: 1500 },
      { startTime: 3000, endTime: 4000, duration: 1000 },
      { duration: 700 },
    ];
    expect(recordedMediaDuration(sessions)).toBe(3700);
    expect(recordedMediaDuration([])).toBe(0);
    expect(sessions[0].startTime).toBe(0);
  });
});
