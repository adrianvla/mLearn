import { describe, it, expect } from 'vitest';
import {
  formatDurationShort,
  formatDurationHM,
  formatDurationHMFromSeconds,
  formatInterval,
  formatDueDate,
  formatClockTime,
  formatLogTimestamp,
  formatDate,
  formatDateTime,
  formatDateMedium,
  formatDateShort,
  formatDateNumeric,
  formatWeekday,
  formatWeekdayLong,
  formatMonthShort,
  formatRelativeLastOpened,
} from '@renderer/utils/timeFormatting';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

const t: TranslateFn = (key, params) => {
  if (!params) return key;
  return `${key}:${JSON.stringify(params)}`;
};

describe('formatRelativeLastOpened', () => {
  const now = Date.UTC(2026, 9, 7, 12);

  it('uses localized relative labels for recent past timestamps', () => {
    expect(formatRelativeLastOpened(now - 86_400_000, 'en', now)?.label).toBe('yesterday');
  });

  it('reports future timestamps in the future instead of calling them recent', () => {
    expect(formatRelativeLastOpened(now + 2 * 3_600_000, 'en', now)?.label).toBe('in 2 hours');
  });

  it('uses a localized absolute date for older items and an exact-date tooltip', () => {
    const result = formatRelativeLastOpened(now - 45 * 86_400_000, 'en', now);
    expect(result?.label).toBe(formatDateMedium(now - 45 * 86_400_000, 'en'));
    expect(result?.title).toBe(formatDateTime(now - 45 * 86_400_000, 'en'));
  });

  it('omits invalid timestamps', () => {
    expect(formatRelativeLastOpened(Number.NaN, 'en', now)).toBeNull();
    expect(formatRelativeLastOpened(Number.POSITIVE_INFINITY, 'en', now)).toBeNull();
  });
});

describe('formatDurationShort', () => {
  it('returns ShortSecond key when under a minute', () => {
    const result = formatDurationShort(45_000, t);
    expect(result).toBe('mlearn.Global.Time.ShortSecond:{"value":45}');
  });

  it('returns MinutesSeconds key when over a minute', () => {
    const result = formatDurationShort(225_000, t);
    expect(result).toBe('mlearn.Global.Time.MinutesSeconds:{"minutes":3,"seconds":45}');
  });

  it('returns ShortSecond for zero milliseconds', () => {
    const result = formatDurationShort(0, t);
    expect(result).toBe('mlearn.Global.Time.ShortSecond:{"value":0}');
  });

  it('rounds fractional seconds correctly — 499ms rounds to 0s', () => {
    const result = formatDurationShort(499, t);
    expect(result).toBe('mlearn.Global.Time.ShortSecond:{"value":0}');
  });

  it('rounds fractional seconds correctly — 500ms rounds to 1s', () => {
    const result = formatDurationShort(500, t);
    expect(result).toBe('mlearn.Global.Time.ShortSecond:{"value":1}');
  });

  it('returns ShortSecond for exactly 59 seconds', () => {
    const result = formatDurationShort(59_000, t);
    expect(result).toBe('mlearn.Global.Time.ShortSecond:{"value":59}');
  });

  it('returns MinutesSeconds for exactly 60 seconds', () => {
    const result = formatDurationShort(60_000, t);
    expect(result).toBe('mlearn.Global.Time.MinutesSeconds:{"minutes":1,"seconds":0}');
  });

  it('handles large durations — 1 hour 30 min 15 sec', () => {
    const ms = (90 * 60 + 15) * 1000;
    const result = formatDurationShort(ms, t);
    expect(result).toBe('mlearn.Global.Time.MinutesSeconds:{"minutes":90,"seconds":15}');
  });
});

describe('formatDurationHM', () => {
  it('returns ShortMinute key when under an hour', () => {
    const result = formatDurationHM(15 * 60_000, t);
    expect(result).toBe('mlearn.Global.Time.ShortMinute:{"value":15}');
  });

  it('returns HoursMinutes key when over an hour', () => {
    const result = formatDurationHM(3 * 3_600_000 + 15 * 60_000, t);
    expect(result).toBe('mlearn.Global.Time.HoursMinutes:{"hours":3,"minutes":15}');
  });

  it('returns ShortMinute with value 0 for zero milliseconds', () => {
    const result = formatDurationHM(0, t);
    expect(result).toBe('mlearn.Global.Time.ShortMinute:{"value":0}');
  });

  it('returns ShortMinute for exactly 59 minutes', () => {
    const result = formatDurationHM(59 * 60_000, t);
    expect(result).toBe('mlearn.Global.Time.ShortMinute:{"value":59}');
  });

  it('returns HoursMinutes for exactly 60 minutes', () => {
    const result = formatDurationHM(3_600_000, t);
    expect(result).toBe('mlearn.Global.Time.HoursMinutes:{"hours":1,"minutes":0}');
  });

  it('floors minutes and does not round up to an extra hour', () => {
    const result = formatDurationHM(3_600_000 + 59 * 60_000 + 59_999, t);
    expect(result).toBe('mlearn.Global.Time.HoursMinutes:{"hours":1,"minutes":59}');
  });

  it('handles a large duration — 24 hours', () => {
    const result = formatDurationHM(24 * 3_600_000, t);
    expect(result).toBe('mlearn.Global.Time.HoursMinutes:{"hours":24,"minutes":0}');
  });
});

describe('formatDurationHMFromSeconds', () => {
  it('converts seconds to ms and delegates to formatDurationHM — under one hour', () => {
    const result = formatDurationHMFromSeconds(45 * 60, t);
    expect(result).toBe('mlearn.Global.Time.ShortMinute:{"value":45}');
  });

  it('converts seconds to ms and delegates to formatDurationHM — over one hour', () => {
    const result = formatDurationHMFromSeconds(2 * 3600 + 30 * 60, t);
    expect(result).toBe('mlearn.Global.Time.HoursMinutes:{"hours":2,"minutes":30}');
  });

  it('handles zero seconds', () => {
    const result = formatDurationHMFromSeconds(0, t);
    expect(result).toBe('mlearn.Global.Time.ShortMinute:{"value":0}');
  });

  it('handles fractional seconds — 90.5 seconds is 1 minute 30s, shown as 1m', () => {
    const result = formatDurationHMFromSeconds(90.5, t);
    expect(result).toBe('mlearn.Global.Time.ShortMinute:{"value":1}');
  });

  it('handles large value — 10 hours exactly', () => {
    const result = formatDurationHMFromSeconds(10 * 3600, t);
    expect(result).toBe('mlearn.Global.Time.HoursMinutes:{"hours":10,"minutes":0}');
  });
});

describe('formatInterval', () => {
  const MINUTE = 60_000;
  const HOUR = 3_600_000;
  const DAY = 86_400_000;
  const YEAR = 365 * DAY;

  it('returns LessThanMinute for 0ms', () => {
    expect(formatInterval(0, t)).toBe('mlearn.Global.Time.LessThanMinute');
  });

  it('returns LessThanMinute for negative values (clamped to 0)', () => {
    expect(formatInterval(-10_000, t)).toBe('mlearn.Global.Time.LessThanMinute');
  });

  it('returns LessThanMinute for values just under a minute', () => {
    expect(formatInterval(MINUTE - 1, t)).toBe('mlearn.Global.Time.LessThanMinute');
  });

  it('returns ShortMinute for exactly 1 minute', () => {
    expect(formatInterval(MINUTE, t)).toBe('mlearn.Global.Time.ShortMinute:{"value":1}');
  });

  it('returns ShortMinute for 5 minutes', () => {
    expect(formatInterval(5 * MINUTE, t)).toBe('mlearn.Global.Time.ShortMinute:{"value":5}');
  });

  it('returns ShortMinute for values just under one hour', () => {
    expect(formatInterval(HOUR - 1, t)).toBe('mlearn.Global.Time.ShortMinute:{"value":60}');
  });

  it('returns ShortHour for exactly 1 hour', () => {
    expect(formatInterval(HOUR, t)).toBe('mlearn.Global.Time.ShortHour:{"value":1}');
  });

  it('returns ShortHour for 3 hours', () => {
    expect(formatInterval(3 * HOUR, t)).toBe('mlearn.Global.Time.ShortHour:{"value":3}');
  });

  it('returns ShortHour for values just under one day', () => {
    expect(formatInterval(DAY - 1, t)).toBe('mlearn.Global.Time.ShortHour:{"value":24}');
  });

  it('returns ShortDay for exactly 1 day', () => {
    expect(formatInterval(DAY, t)).toBe('mlearn.Global.Time.ShortDay:{"value":1}');
  });

  it('returns ShortDay for 14 days', () => {
    expect(formatInterval(14 * DAY, t)).toBe('mlearn.Global.Time.ShortDay:{"value":14}');
  });

  it('returns ShortDay for values just under one year', () => {
    expect(formatInterval(YEAR - 1, t)).toBe('mlearn.Global.Time.ShortDay:{"value":365}');
  });

  it('returns ShortYear for exactly 1 year', () => {
    expect(formatInterval(YEAR, t)).toBe('mlearn.Global.Time.ShortYear:{"value":"1.0"}');
  });

  it('returns ShortYear with 1 decimal place for 1.5 years', () => {
    expect(formatInterval(1.5 * YEAR, t)).toBe('mlearn.Global.Time.ShortYear:{"value":"1.5"}');
  });

  it('returns ShortYear for a very large interval', () => {
    expect(formatInterval(10 * YEAR, t)).toBe('mlearn.Global.Time.ShortYear:{"value":"10.0"}');
  });
});

describe('formatDueDate', () => {
  it('returns Now key when due date is in the past', () => {
    const past = Date.now() - 10_000;
    expect(formatDueDate(past, t)).toBe('mlearn.Global.Time.Now');
  });

  it('returns Now key when due date equals current time (diff == 0)', () => {
    const now = Date.now();
    expect(formatDueDate(now, t)).toBe('mlearn.Global.Time.Now');
  });

  it('returns interval string for a future due date within minutes', () => {
    const future = Date.now() + 5 * 60_000;
    const result = formatDueDate(future, t);
    expect(result).toContain('mlearn.Global.Time.ShortMinute');
  });

  it('returns interval string for a future due date in hours', () => {
    const future = Date.now() + 2 * 3_600_000;
    const result = formatDueDate(future, t);
    expect(result).toContain('mlearn.Global.Time.ShortHour');
  });

  it('returns interval string for a future due date in days', () => {
    const future = Date.now() + 14 * 86_400_000;
    const result = formatDueDate(future, t);
    expect(result).toContain('mlearn.Global.Time.ShortDay');
  });

  it('returns LessThanMinute for a due date 30 seconds in the future', () => {
    const future = Date.now() + 30_000;
    expect(formatDueDate(future, t)).toBe('mlearn.Global.Time.LessThanMinute');
  });
});

describe('formatClockTime', () => {
  it('returns a non-empty string for a valid timestamp with en-US locale', () => {
    const ts = new Date('2024-01-15T14:30:00').getTime();
    const result = formatClockTime(ts, 'en-US');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('includes hour and minute digits for en-US locale', () => {
    const ts = new Date('2024-01-15T14:30:00').getTime();
    const result = formatClockTime(ts, 'en-US');
    expect(result).toMatch(/\d/);
    expect(result).toContain(':');
  });

  it('returns a string containing a colon separator for ja locale', () => {
    const ts = new Date('2024-01-15T14:30:00').getTime();
    const result = formatClockTime(ts, 'ja');
    expect(result).toContain(':');
  });

  it('returns different formatted strings for different timestamps', () => {
    const ts1 = new Date('2024-01-15T09:00:00').getTime();
    const ts2 = new Date('2024-01-15T21:00:00').getTime();
    const result1 = formatClockTime(ts1, 'en-US');
    const result2 = formatClockTime(ts2, 'en-US');
    expect(result1).not.toBe(result2);
  });

  it('returns a string with only 2-digit hour and minute (no seconds) for en-US', () => {
    const ts = new Date('2024-01-15T08:05:00').getTime();
    const result = formatClockTime(ts, 'en-US');
    expect(result.length).toBeLessThan(20);
  });
});

describe('formatLogTimestamp', () => {
  it('returns empty string for undefined input', () => {
    expect(formatLogTimestamp(undefined, 'en-US')).toBe('');
  });

  it('returns empty string for 0 (falsy number)', () => {
    expect(formatLogTimestamp(0, 'en-US')).toBe('');
  });

  it('returns empty string for empty string input', () => {
    expect(formatLogTimestamp('', 'en-US')).toBe('');
  });

  it('formats a Date object to HH:MM:SS', () => {
    const date = new Date('2024-01-15T14:30:45');
    const result = formatLogTimestamp(date, 'en-US');
    expect(result).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it('formats a numeric timestamp correctly', () => {
    const ts = new Date('2024-01-15T09:05:03').getTime();
    const result = formatLogTimestamp(ts, 'en-US');
    expect(result).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it('formats an ISO string correctly', () => {
    const iso = '2024-01-15T23:59:59.000Z';
    const result = formatLogTimestamp(iso, 'en-US');
    expect(result).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it('uses 24-hour format — hour does not exceed 23', () => {
    const date = new Date('2024-01-15T23:00:00');
    const result = formatLogTimestamp(date, 'en-US');
    const hour = parseInt(result.split(':')[0], 10);
    expect(hour).toBeLessThanOrEqual(23);
  });

  it('returns a 8-character string HH:MM:SS for any valid input', () => {
    const date = new Date('2024-06-01T08:05:03');
    const result = formatLogTimestamp(date, 'en-US');
    expect(result).toHaveLength(8);
  });

  it('handles different locales without throwing', () => {
    const date = new Date('2024-01-15T14:30:45');
    expect(() => formatLogTimestamp(date, 'ja')).not.toThrow();
    expect(() => formatLogTimestamp(date, 'de')).not.toThrow();
    expect(() => formatLogTimestamp(date, 'fr')).not.toThrow();
  });
});

// ============================================================================
// Date formatters
// ============================================================================

/** A Saturday, chosen because en-US and de disagree on its abbreviation. */
const SATURDAY = new Date(2026, 2, 14, 12, 0, 0);

describe('locale-aware date formatters', () => {
  it('formatDate matches the explicit-locale Intl output', () => {
    expect(formatDate(SATURDAY, 'de')).toBe(SATURDAY.toLocaleDateString('de'));
    expect(formatDate(SATURDAY, 'ja')).toBe(SATURDAY.toLocaleDateString('ja'));
  });

  it('formatDateMedium matches dateStyle: medium', () => {
    expect(formatDateMedium(SATURDAY, 'en-US')).toBe(
      SATURDAY.toLocaleDateString('en-US', { dateStyle: 'medium' }),
    );
  });

  it('formatDateShort includes the day and an abbreviated month', () => {
    const result = formatDateShort(SATURDAY, 'en-US');
    expect(result).toBe(SATURDAY.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    expect(result).toContain('14');
  });

  it('formatDateNumeric renders bare month and day numbers', () => {
    expect(formatDateNumeric(SATURDAY, 'en-US')).toBe(
      SATURDAY.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }),
    );
    expect(formatDateNumeric(SATURDAY, 'en-US')).toBe('3/14');
  });

  it('formatWeekday shortens the weekday name', () => {
    expect(formatWeekday(SATURDAY, 'en-US')).toBe('Sat');
    expect(formatWeekday(SATURDAY, 'de')).toBe('Sa');
  });

  it('formatWeekdayLong spells the weekday out', () => {
    expect(formatWeekdayLong(SATURDAY, 'en-US')).toBe('Saturday');
    expect(formatWeekdayLong(SATURDAY, 'de')).toBe('Samstag');
  });

  it('formatMonthShort abbreviates the month', () => {
    expect(formatMonthShort(SATURDAY, 'en-US')).toBe('Mar');
    expect(formatMonthShort(SATURDAY, 'de')).toBe('Mär');
  });

  it('follows the requested locale rather than the host locale', () => {
    // The bug these helpers exist to prevent: an OS pinned to en-US rendered
    // "Sat" even when the user picked German as the UI language.
    expect(formatWeekday(SATURDAY, 'de')).not.toBe(formatWeekday(SATURDAY, 'en-US'));
    expect(formatWeekdayLong(SATURDAY, 'de')).not.toBe(formatWeekdayLong(SATURDAY, 'en-US'));
    expect(formatMonthShort(SATURDAY, 'de')).not.toBe(formatMonthShort(SATURDAY, 'en-US'));
  });

  it('formatDateTime matches the explicit-locale date+time output', () => {
    expect(formatDateTime(SATURDAY, 'de')).toBe(SATURDAY.toLocaleString('de'));
    expect(formatDateTime(SATURDAY, 'ja')).toBe(SATURDAY.toLocaleString('ja'));
  });

  it('formatDateTime renders both the date and the time', () => {
    const result = formatDateTime(SATURDAY, 'en-US');
    expect(result).toContain('14');
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });

  it('formatDateTime follows the requested locale rather than the host locale', () => {
    expect(formatDateTime(SATURDAY, 'de')).not.toBe(formatDateTime(SATURDAY, 'en-US'));
  });

  it('formatDateTime accepts ISO strings and epoch milliseconds like the date helpers', () => {
    expect(formatDateTime(SATURDAY.toISOString(), 'en-US')).toBe(formatDateTime(SATURDAY, 'en-US'));
    expect(formatDateTime(SATURDAY.getTime(), 'en-US')).toBe(formatDateTime(SATURDAY, 'en-US'));
  });

  it('accepts ISO date strings, which is how timestamps are persisted', () => {
    const iso = SATURDAY.toISOString();
    expect(formatDate(iso, 'en-US')).toBe(formatDate(SATURDAY, 'en-US'));
    expect(formatWeekday(iso, 'en-US')).toBe('Sat');
  });

  it('accepts both Date objects and epoch milliseconds', () => {
    const ms = SATURDAY.getTime();
    expect(formatDate(ms, 'en-US')).toBe(formatDate(SATURDAY, 'en-US'));
    expect(formatWeekday(ms, 'en-US')).toBe(formatWeekday(SATURDAY, 'en-US'));
  });

  it('handles every supported UI language without throwing', () => {
    for (const locale of ['en', 'ja', 'de', 'es', 'fr']) {
      expect(() => formatDate(SATURDAY, locale)).not.toThrow();
      expect(() => formatDateShort(SATURDAY, locale)).not.toThrow();
      expect(() => formatWeekday(SATURDAY, locale)).not.toThrow();
      expect(() => formatMonthShort(SATURDAY, locale)).not.toThrow();
    }
  });
});
