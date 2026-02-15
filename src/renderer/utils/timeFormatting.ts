/**
 * Localized Time Formatting Utilities
 *
 * All duration / interval / timestamp formatting goes through localization
 * so each language can express time units in its own way
 * (e.g. Japanese 分/秒/時間, German Min./Sek., etc.).
 *
 * Every function accepts a translation function `t` obtained from `useLocalization()`.
 */

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

// ============================================================================
// Duration formatters
// ============================================================================

/**
 * Short duration with minutes and seconds — used for call / session durations.
 * Examples (en): "3m 45s", "45s"
 * Examples (ja): "3分 45秒", "45秒"
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
 * Examples (en): "3h 15m", "15m", "0m"
 * Examples (ja): "3時間 15分", "15分", "0分"
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
 * < 1 min → "< 1m" / "< 1分"
 * minutes → "5m" / "5分"
 * hours   → "3h" / "3時間"
 * days    → "14d" / "14日"
 * years   → "1.5y" / "1.5年"
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
 * Examples (en-US): "2:30 PM"
 * Examples (ja): "午後2:30"
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
