/**
 * Calendar conversion for management analytics. The backend owns the selected
 * school timezone; callers pass UTC only when that explicit backend fallback
 * was returned. Browser-local time is never used for a school date boundary.
 */
export function schoolDateInput(timestamp: number, timeZone: string): string {
  const parts = dateParts(new Date(timestamp), timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function schoolDayStart(value: string, timeZone: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = Date.UTC(year, month - 1, day);
  // Resolve the zone offset at the target local midnight twice to account for
  // a DST transition between the UTC candidate and that midnight.
  let result = utc - zoneOffset(utc, timeZone);
  result = utc - zoneOffset(result, timeZone);
  return result;
}

export function schoolNextDayStart(value: string, timeZone: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return null;
  const next = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1));
  return schoolDayStart(next.toISOString().slice(0, 10), timeZone);
}

export function formatSchoolDate(timestamp: number, timeZone: string, options: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat(undefined, { timeZone, ...options }).format(new Date(timestamp));
}

function zoneOffset(timestamp: number, timeZone: string): number {
  const parts = dateParts(new Date(timestamp), timeZone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - timestamp;
}

function dateParts(date: Date, timeZone: string): Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number> {
  const values = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: string) => Number(values.find((entry) => entry.type === type)?.value ?? '0');
  return { year: part('year'), month: part('month'), day: part('day'), hour: part('hour'), minute: part('minute'), second: part('second') };
}
