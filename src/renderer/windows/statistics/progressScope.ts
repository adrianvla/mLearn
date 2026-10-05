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

/** Missing legacy interval timestamps cannot be reconstructed. Keep their recorded durations. */
export function recordedMediaDuration(sessions: Array<{ duration: number; startTime?: number; endTime?: number }>): number {
  const intervals = sessions.filter(session => session.startTime !== undefined && session.endTime !== undefined)
    .map(session => ({ start: session.startTime!, end: session.endTime! })).sort((a, b) => a.start - b.start);
  let total = sessions.filter(session => session.startTime === undefined || session.endTime === undefined)
    .reduce((sum, session) => sum + session.duration, 0);
  let start: number | undefined;
  let end = 0;
  for (const interval of intervals) {
    if (start === undefined) { start = interval.start; end = interval.end; }
    else if (interval.start <= end) end = Math.max(end, interval.end);
    else { total += end - start; start = interval.start; end = interval.end; }
  }
  return total + (start === undefined ? 0 : end - start);
}
