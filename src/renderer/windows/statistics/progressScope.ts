import type { DailyStudyStats, Flashcard, MediaStats } from '../../../shared/types';

/** A missing legacy language remains visible only in the explicit all-activity scope. */
export function progressCards(cards: Flashcard[], language: string | null): Flashcard[] {
  return language === null ? cards : cards.filter(card => card.language === language);
}

export function progressMedia(media: MediaStats[], language: string | null): MediaStats[] {
  return language === null ? media : media.filter(item => item.language === language);
}

export function progressDailyStats(
  daily: Record<string, Record<string, DailyStudyStats>>,
  language: string | null,
): Record<string, Record<string, DailyStudyStats>> {
  if (language === null) return daily;
  return Object.fromEntries(Object.entries(daily)
    .filter(([, entries]) => entries[language])
    .map(([date, entries]) => [date, { [language]: entries[language] }]));
}

export { recordedMediaDuration, recordedMediaSessions } from '../../../shared/mediaUsage';

/** UTC reporting dates match the persisted daily study date convention. */
export function mediaSessionsByDate(media: MediaStats): Record<string, import('../../../shared/types').MediaSession[]> {
  const result: Record<string, import('../../../shared/types').MediaSession[]> = {};
  const sessions = media.usageSessions ? Object.values(media.usageSessions) : media.sessions;
  for (const session of sessions) {
    const segments = session.engagedIntervals ?? (session.startTime !== undefined && session.endTime !== undefined
      ? [{ startTime: session.startTime, endTime: session.endTime }] : undefined);
    if (!segments) { (result[session.date] ??= []).push(session); continue; }
    for (const segment of segments) {
      if (!Number.isFinite(segment.startTime) || !Number.isFinite(segment.endTime)) continue;
      let start = segment.startTime;
      while (start < segment.endTime) {
        const date = new Date(start).toISOString().split('T')[0];
        const boundary = Date.parse(`${date}T00:00:00.000Z`) + 86400000;
        const end = Math.min(boundary, segment.endTime);
        (result[date] ??= []).push({ ...session, date, duration: end - start, engagedIntervals: [{ startTime: start, endTime: end }] });
        start = end;
      }
    }
  }
  return result;
}
