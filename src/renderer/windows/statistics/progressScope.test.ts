import { describe, expect, it } from 'vitest';
import { progressDailyStats, progressMedia, recordedMediaDuration, mediaSessionsByDate } from './progressScope';
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
  it('uses explicit engagement intervals rather than the enclosing paused session wall clock', () => {
    expect(recordedMediaDuration([{ duration: 2000, startTime: 10000, endTime: 22000, engagedIntervals: [{ startTime: 10000, endTime: 11000 }, { startTime: 21000, endTime: 22000 }] }])).toBe(2000);
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

it('includes acknowledged interrupted engagement and splits it at UTC midnight', () => {
  const start = Date.parse('2026-10-09T23:59:00Z'); const end = start + 120000;
  const media = { sessions: [], usageSessions: { interrupted: { id: 'interrupted', sequence: 1, finalized: false, date: '2026-10-09', wordsLearned: 0,
    duration: 120000, engagedIntervals: [{ startTime: start, endTime: end }], wordsEncountered: {}, grammarEncountered: {} } } } as unknown as MediaStats;
  const days = mediaSessionsByDate(media);
  expect(recordedMediaDuration(days['2026-10-09'])).toBe(60000);
  expect(recordedMediaDuration(days['2026-10-10'])).toBe(60000);
});
