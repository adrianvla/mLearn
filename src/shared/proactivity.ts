import type { Settings } from './types';

type QuietHoursSettings = Pick<Settings, 'proactiveQuietHoursEnabled' | 'proactiveQuietHoursStart' | 'proactiveQuietHoursEnd'>;

function minutesSinceMidnight(value: string): number | undefined {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return undefined;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return undefined;
  return hours * 60 + minutes;
}

export function isInQuietHours(settings: QuietHoursSettings, now: number): boolean {
  if (!settings.proactiveQuietHoursEnabled) return false;

  const start = minutesSinceMidnight(settings.proactiveQuietHoursStart);
  const end = minutesSinceMidnight(settings.proactiveQuietHoursEnd);
  if (start === undefined || end === undefined || start === end) return false;

  const date = new Date(now);
  const current = date.getHours() * 60 + date.getMinutes();
  return start < end ? current >= start && current < end : current >= start || current < end;
}
