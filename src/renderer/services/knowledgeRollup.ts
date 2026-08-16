import type { KnowledgeEvent } from '../../shared/knowledgeEvents';
import { appendEvents } from './knowledgeEvents';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger('renderer.services.knowledgeRollup');

interface RollupBucket {
  easeAfter: number;
  timesSeenDelta: number;
}

const buckets = new Map<string, RollupBucket>();
let currentDay: string | null = null;
let todayFn: () => string = () => new Date().toISOString().slice(0, 10);
let flushInFlight: Promise<void> | null = null;

/** Test seam: the SRS-day boundary follows the app's newDayHour, not UTC. */
export function setKnowledgeRollupTodayFn(fn: () => string): void {
  todayFn = fn;
}

export function accumulateWordSeen(lk: string, easeAfter: number, timesSeenDelta: number): void {
  const today = todayFn();
  if (currentDay !== today && buckets.size > 0) {
    // Day rolled with a pending bucket — flush before accepting new data.
    void flushKnowledgeRollup();
  }
  currentDay = today;
  const bucket = buckets.get(lk) ?? { easeAfter, timesSeenDelta: 0 };
  bucket.easeAfter = easeAfter;
  bucket.timesSeenDelta += timesSeenDelta;
  buckets.set(lk, bucket);
}

export async function flushKnowledgeRollup(): Promise<void> {
  if (flushInFlight) return flushInFlight;
  if (buckets.size === 0) {
    currentDay = todayFn();
    return;
  }
  const eventsByKey: Record<string, KnowledgeEvent[]> = {};
  const now = Date.now();
  for (const [lk, bucket] of buckets) {
    if (bucket.timesSeenDelta <= 0) continue;
    eventsByKey[lk] = [{
      t: now,
      kind: 'rollup',
      source: 'passiveTracking',
      aspect: 'meaning',
      easeAfter: bucket.easeAfter,
      timesSeenDelta: bucket.timesSeenDelta,
    }];
  }
  buckets.clear();
  currentDay = todayFn();
  if (Object.keys(eventsByKey).length === 0) return;
  flushInFlight = appendEvents(eventsByKey)
    .catch((e) => { log.warn('knowledge rollup flush failed:', e); })
    .finally(() => { flushInFlight = null; });
  return flushInFlight;
}

/** Test hook — resets all module state. */
export function resetKnowledgeRollupForTests(): void {
  buckets.clear();
  currentDay = null;
  todayFn = () => new Date().toISOString().slice(0, 10);
  flushInFlight = null;
}
