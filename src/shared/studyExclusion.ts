import type { IgnoredWordEntry } from './types';

/** A withdrawn preference remains stored, but does not exclude the target. */
export function isStudyExcluded(entry: IgnoredWordEntry | null | undefined): boolean {
  return entry != null && entry.excluded !== false;
}

/** Stable metadata ordering makes equal-status ties converge in either sync direction. */
function preferenceKey(entry: IgnoredWordEntry): string {
  return JSON.stringify(Object.entries(entry).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
}

/** Per-key preference merge. Withdrawal wins a timestamp tie, including against legacy exclusions. */
export function mergeStudyExclusion(
  current: IgnoredWordEntry | undefined,
  incoming: IgnoredWordEntry,
): IgnoredWordEntry {
  if (!current) return incoming;
  const currentAt = current.updatedAt ?? current.ignoredAt;
  const incomingAt = incoming.updatedAt ?? incoming.ignoredAt;
  if (incomingAt !== currentAt) return incomingAt > currentAt ? incoming : current;
  const currentExcluded = isStudyExcluded(current);
  const incomingExcluded = isStudyExcluded(incoming);
  if (currentExcluded !== incomingExcluded) return incomingExcluded ? current : incoming;
  return preferenceKey(incoming) > preferenceKey(current) ? incoming : current;
}
