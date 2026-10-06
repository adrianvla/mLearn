/**
 * Localized Time Formatting Utilities
 *
 * All duration / interval / timestamp formatting goes through localization
 * so each locale can express time units in its own way.
 *
 * Every function accepts a translation function `t` obtained from `useLocalization()`.
 */

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

// ============================================================================
// Duration formatters
// ============================================================================

/**
 * Short duration with minutes and seconds — used for call / session durations.
 * Examples: "3m 45s", "45s"
 */
export function formatDurationShort(ms: number, t: TranslateFn): string {
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min > 0) {
    return t('mlearn.Global.Time.MinutesSeconds', { minutes: min, seconds: sec });
  }
  return t('mlearn.Global.Time.ShortSecond', { value: sec });
}

/**
 * Duration expressed in hours and minutes — used for watch-time / study-time.
 * Examples: "3h 15m", "15m", "0m"
 */
export function formatDurationHM(ms: number, t: TranslateFn): string {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (hours > 0) {
    return t('mlearn.Global.Time.HoursMinutes', { hours, minutes });
  }
  return t('mlearn.Global.Time.ShortMinute', { value: minutes });
}

/**
 * Duration expressed in hours and minutes from raw seconds — used for stats.
 * Examples (en): "2h 30m"
 */
export function formatDurationHMFromSeconds(seconds: number, t: TranslateFn): string {
  return formatDurationHM(seconds * 1000, t);
}

/**
 * Compact SRS-style interval — used for flashcard scheduling labels.
 * < 1 min → localized "< 1 minute"
 * minutes → localized short minutes
 * hours   → localized short hours
 * days    → localized short days
 * years   → localized short years
 */
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const YEAR = 365 * DAY;

export function formatInterval(intervalMs: number, t: TranslateFn): string {
  if (intervalMs < 0) intervalMs = 0;

  if (intervalMs < MINUTE) return t('mlearn.Global.Time.LessThanMinute');
  if (intervalMs < HOUR) return t('mlearn.Global.Time.ShortMinute', { value: Math.round(intervalMs / MINUTE) });
  if (intervalMs < DAY) return t('mlearn.Global.Time.ShortHour', { value: Math.round(intervalMs / HOUR) });
  if (intervalMs < YEAR) return t('mlearn.Global.Time.ShortDay', { value: Math.round(intervalMs / DAY) });
  return t('mlearn.Global.Time.ShortYear', { value: (intervalMs / YEAR).toFixed(1) });
}

/**
 * Due-date label — "now" or a relative interval string.
 */
export function formatDueDate(dueTimestamp: number, t: TranslateFn): string {
  const diff = dueTimestamp - Date.now();
  if (diff <= 0) return t('mlearn.Global.Time.Now');
  return formatInterval(diff, t);
}

/**
 * Clock time from a timestamp — uses the app locale for proper AM/PM or 24h.
 * Examples: "2:30 PM", "14:30"
 */
export function formatClockTime(timestamp: number, locale: string): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

/**
 * Timestamp for log consoles — 24-hour HH:MM:SS using app locale.
 */
export function formatLogTimestamp(
  ts: Date | string | number | undefined,
  locale: string,
): string {
  if (!ts) return '';
  const date = ts instanceof Date ? ts : new Date(ts);
  return date.toLocaleTimeString(locale, {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// ============================================================================
// Date formatters
// ============================================================================
//
// `Date.prototype.toLocaleDateString(undefined)` follows the *host* locale, not
// the user's chosen UI language. On a machine set to en-US, that renders
// "Sat" even when the app's `settings.uiLanguage` is "de" (which expects "Sa").
// Every date render therefore goes through these helpers, which require an
// explicit locale from `settings.uiLanguage`.

/**
 * Full date in the app locale — "3/14/2026", "14.03.2026".
 *
 * Accepts ISO date strings as well as `Date`/epoch values, because persisted
 * records store timestamps as strings.
 *
 * `locale` is optional only so generic components can fall back to the host
 * locale when no UI language is in scope. Callers that render for a user
 * should always pass `settings.uiLanguage`.
 */
export function formatDate(value: Date | number | string, locale?: string): string {
  return new Date(value).toLocaleDateString(locale);
}

/**
 * Medium date with an explicit month/day — "Mar 14", "14. März".
 */
export function formatDateMedium(value: Date | number | string, locale?: string): string {
  return new Date(value).toLocaleDateString(locale, { dateStyle: 'medium' });
}

/**
 * Date and time together in the app locale — the default shape produced by
 * `Date.prototype.toLocaleString()`.
 *
 * Owned here so the handful of surfaces that genuinely need a combined
 * date+time render (export/import summaries, log and event timelines, exam
 * attempt headers) follow the same locale as the date-only and time-only
 * helpers instead of each falling back to the host-locale default.
 *
 * Accepts ISO date strings as well as `Date`/epoch values, because persisted
 * records store timestamps as strings.
 */
export function formatDateTime(value: Date | number | string, locale?: string): string {
  return new Date(value).toLocaleString(locale);
}

export interface RelativeLastOpened {
  label: string;
  title: string;
}

/**
 * Relative timestamp for recent material. Older items use a compact absolute
 * date, while the title always retains the exact localized date and time.
 * Invalid persisted timestamps are omitted instead of rendering "Invalid Date".
 */
export function formatRelativeLastOpened(
  timestamp: number,
  locale: string,
  now = Date.now(),
): RelativeLastOpened | null {
  if (!Number.isFinite(timestamp) || !Number.isFinite(now)) return null;
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;

  const difference = timestamp - now;
  const absoluteDifference = Math.abs(difference);
  const title = formatDateTime(timestamp, locale);
  if (absoluteDifference >= 30 * DAY) {
    return { label: formatDateMedium(timestamp, locale), title };
  }

  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (absoluteDifference < MINUTE) {
    return { label: relative.format(Math.round(difference / 1000), 'second'), title };
  }
  if (absoluteDifference < HOUR) {
    return { label: relative.format(Math.round(difference / MINUTE), 'minute'), title };
  }
  if (absoluteDifference < DAY) {
    return { label: relative.format(Math.round(difference / HOUR), 'hour'), title };
  }
  return { label: relative.format(Math.round(difference / DAY), 'day'), title };
}

/**
 * Day and month with a short month name — "Mar 14".
 */
export function formatDateShort(value: Date | number | string, locale?: string): string {
  return new Date(value).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

/**
 * Day and month as bare numbers — "3/14".
 */
export function formatDateNumeric(value: Date | number | string, locale?: string): string {
  return new Date(value).toLocaleDateString(locale, { month: 'numeric', day: 'numeric' });
}

/**
 * Abbreviated weekday — "Sat", "Sa".
 */
export function formatWeekday(value: Date | number | string, locale?: string): string {
  return new Date(value).toLocaleDateString(locale, { weekday: 'short' });
}

/**
 * Full weekday — "Saturday", "Samstag".
 */
export function formatWeekdayLong(value: Date | number | string, locale?: string): string {
  return new Date(value).toLocaleDateString(locale, { weekday: 'long' });
}

/**
 * Abbreviated month — "Mar", "März".
 */
export function formatMonthShort(value: Date | number | string, locale?: string): string {
  return new Date(value).toLocaleDateString(locale, { month: 'short' });
}
