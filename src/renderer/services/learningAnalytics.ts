import type { KnowledgeEvent, KnowledgeEventLog } from '../../shared/knowledgeEvents';
import { stripRetractedLog } from '../../shared/knowledgeEvents';
import { ANKI_EASE } from '../../shared/constants';
import { replayKnowledgeHistory } from '../utils/knowledgeHistory';

const DAY = 24 * 60 * 60 * 1000;
const STABLE_WINDOW = 30 * DAY;
const SLOPE_WINDOW = 14 * DAY;

export interface CohortPoint {
  month: string;
  medianDays: number;
  wordCount: number;
}

export interface SlopeCohortPoint {
  month: string;
  medianSlope: number;
  wordCount: number;
}

export interface RetentionCohortPoint {
  month: string;
  lapseRate: number;
  knownWordCount: number;
}

// One word spans several `${language}:${hash}` keys when surface variants exist (さすが vs 流石).
// Multi-hash writes emit one event per form hash, so per-key aggregation would count a single
// learning event once per variant. Keys sharing a form family merge into one group, id = the
// smallest family key present in the log (stable without needing the word text).
export function unifyEventLogByWord(
  log: KnowledgeEventLog,
  familyKeysFor: (key: string) => readonly string[] | undefined,
): Map<string, KnowledgeEvent[]> {
  // Undone attempts must not feed cohort metrics.
  const effectiveLog = stripRetractedLog(log);
  const logKeys = new Set(Object.keys(effectiveLog));
  const groups = new Map<string, KnowledgeEvent[]>();
  for (const [key, events] of Object.entries(effectiveLog)) {
    const family = familyKeysFor(key)?.filter((familyKey) => logKeys.has(familyKey));
    const group = family && family.length > 0 ? [...family].sort()[0] : key;
    const existing = groups.get(group);
    if (existing) existing.push(...events);
    else groups.set(group, [...events]);
  }
  return groups;
}

function meaningEvents(events: readonly KnowledgeEvent[]): KnowledgeEvent[] {
  return events.filter((event) => event.aspect === 'meaning').sort((a, b) => a.t - b.t);
}

function monthFor(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

// Anki review events carry no toStatus — derive transitions from ease/rating,
// otherwise anki-only words are invisible to the cohort metrics below.
function reachesKnown(event: KnowledgeEvent): boolean {
  if (event.kind === 'rollup') return false;
  if (event.toStatus === 'known') return true;
  return event.kind === 'review' && event.source === 'anki' && (event.easeAfter ?? 0) >= ANKI_EASE.DEFAULT_KNOWN;
}

function downgradesBelowKnown(event: KnowledgeEvent): boolean {
  if (event.kind === 'rollup') return false;
  if (event.toStatus === 'unknown' || event.toStatus === 'learning') return true;
  return event.kind === 'review' && event.rating === 'again';
}

function hasLapseWithin(events: readonly KnowledgeEvent[], knownAt: number): boolean {
  return events.some((event) => event.t > knownAt && event.t <= knownAt + STABLE_WINDOW && downgradesBelowKnown(event));
}

function cohortValues<T>(values: readonly { month: string; value: T }[]): Map<string, T[]> {
  const cohorts = new Map<string, T[]>();
  for (const { month, value } of values) {
    const cohort = cohorts.get(month);
    if (cohort) cohort.push(value);
    else cohorts.set(month, [value]);
  }
  return cohorts;
}

export function daysToStableKnown(eventsByWord: ReadonlyMap<string, readonly KnowledgeEvent[]>): CohortPoint[] {
  const values: { month: string; value: number }[] = [];
  for (const events of eventsByWord.values()) {
    const meaning = meaningEvents(events);
    const first = meaning[0];
    if (!first) continue;
    const stableKnown = meaning.find((event) => reachesKnown(event) && !hasLapseWithin(meaning, event.t));
    if (stableKnown) values.push({ month: monthFor(first.t), value: (stableKnown.t - first.t) / DAY });
  }
  return [...cohortValues(values)].sort(([a], [b]) => a.localeCompare(b)).map(([month, cohort]) => ({
    month,
    medianDays: median(cohort),
    wordCount: cohort.length,
  }));
}

export function acquisitionSlope(eventsByWord: ReadonlyMap<string, readonly KnowledgeEvent[]>): SlopeCohortPoint[] {
  const values: { month: string; value: number }[] = [];
  for (const events of eventsByWord.values()) {
    const meaning = meaningEvents(events);
    const first = meaning[0];
    if (!first) continue;
    const windowed = meaning.filter((event) => event.t <= first.t + SLOPE_WINDOW);
    const points = replayKnowledgeHistory(windowed, { now: first.t + SLOPE_WINDOW }).points;
    if (points.length > 0) values.push({ month: monthFor(first.t), value: points[points.length - 1].strength - points[0].strength });
  }
  return [...cohortValues(values)].sort(([a], [b]) => a.localeCompare(b)).map(([month, cohort]) => ({
    month,
    medianSlope: median(cohort),
    wordCount: cohort.length,
  }));
}

export function retentionAfterKnown(
  eventsByWord: ReadonlyMap<string, readonly KnowledgeEvent[]>,
  now: number,
): RetentionCohortPoint[] {
  const values: { month: string; value: boolean }[] = [];
  for (const events of eventsByWord.values()) {
    const meaning = meaningEvents(events);
    const first = meaning[0];
    const firstKnown = meaning.find(reachesKnown);
    if (!first || !firstKnown || firstKnown.t > now - STABLE_WINDOW) continue;
    values.push({ month: monthFor(first.t), value: hasLapseWithin(meaning, firstKnown.t) });
  }
  return [...cohortValues(values)].sort(([a], [b]) => a.localeCompare(b)).map(([month, cohort]) => ({
    month,
    lapseRate: cohort.filter(Boolean).length / cohort.length,
    knownWordCount: cohort.length,
  }));
}
