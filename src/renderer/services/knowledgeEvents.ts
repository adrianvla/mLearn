import { createSignal } from 'solid-js';
import { getBridge } from '../../shared/bridges';
import type { KnowledgeEvent, KnowledgeEventLog } from '../../shared/knowledgeEvents';

const [eventsVersion, setEventsVersion] = createSignal(0);
const queryCache = new Map<string, KnowledgeEventLog>();

let channel: BroadcastChannel | null | undefined;
let bridgeListenerRegistered = false;

function bumpVersion(): void {
  queryCache.clear();
  setEventsVersion((version) => version + 1);
}

// Lazy: module import must stay side-effect free (renderer AGENTS.md); tests also mock only partial bridges.
function ensureInitialized(): void {
  if (channel === undefined) {
    channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('mlearn-knowledge-events');
    if (channel) {
      // happy-dom's BroadcastChannel stub has no addEventListener; onmessage works everywhere.
      channel.onmessage = bumpVersion;
    }
  }
  if (!bridgeListenerRegistered) {
    bridgeListenerRegistered = true;
    getBridge().knowledgeEvents.onKnowledgeEventsChanged(bumpVersion);
  }
}

export { eventsVersion };

/** Keys must be precomputed `${language}:${hash}` form keys; all supplied forms are merged. */
export async function getEvents(keys: readonly string[]): Promise<KnowledgeEvent[]> {
  ensureInitialized();
  const uniqueKeys = [...new Set(keys)].sort();
  const cacheKey = uniqueKeys.join('|');
  let log = queryCache.get(cacheKey);
  if (!log) {
    log = await getBridge().knowledgeEvents.queryKnowledgeEvents(uniqueKeys);
    queryCache.set(cacheKey, log);
  }
  return Object.values(log).flat().sort((a, b) => a.t - b.t);
}

export async function getEventsInRange(keys: readonly string[], from: number, to: number): Promise<KnowledgeEvent[]> {
  return (await getEvents(keys)).filter((event) => event.t >= from && event.t <= to);
}

export async function getEventsForLanguage(language: string): Promise<KnowledgeEvent[]> {
  ensureInitialized();
  return Object.values(await getBridge().knowledgeEvents.queryKnowledgeEventsForLanguage(language)).flat();
}

export async function getEventLogForLanguage(language: string): Promise<KnowledgeEventLog> {
  ensureInitialized();
  return getBridge().knowledgeEvents.queryKnowledgeEventsForLanguage(language);
}

export async function appendEvents(eventsByKey: KnowledgeEventLog): Promise<void> {
  ensureInitialized();
  if (!await getBridge().knowledgeEvents.appendKnowledgeEvents(eventsByKey)) return;
  bumpVersion();
  channel?.postMessage(null);
}

export function getVersion(): number {
  return eventsVersion();
}
