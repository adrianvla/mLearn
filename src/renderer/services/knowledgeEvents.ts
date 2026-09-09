import { createSignal } from 'solid-js';
import { getBridge } from '../../shared/bridges';
import type { KnowledgeEvent, KnowledgeEventLog } from '../../shared/knowledgeEvents';

const [eventsVersion, setEventsVersion] = createSignal(0);
const queryCache = new Map<string, KnowledgeEventLog>();

// Versioned per-language log cache: the full language log is a heavyweight
// IPC payload, and several consumers re-read it within one events version
// (projection recompute, grammar projection, statistics). Cache keyed by
// (language, version) with in-flight dedupe; bumpVersion (local append or
// remote change broadcast) invalidates it so the next read refetches once.
interface LanguageLogCacheEntry {
  version: number;
  log: KnowledgeEventLog;
  inFlight?: Promise<KnowledgeEventLog>;
}
const languageLogCache = new Map<string, LanguageLogCacheEntry>();

let channel: BroadcastChannel | null | undefined;
let bridgeListenerRegistered = false;

function bumpVersion(): void {
  queryCache.clear();
  languageLogCache.clear();
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
  return Object.values(await getEventLogForLanguage(language)).flat();
}

export async function getEventLogForLanguage(language: string): Promise<KnowledgeEventLog> {
  ensureInitialized();
  const version = eventsVersion();
  const cached = languageLogCache.get(language);
  if (cached && cached.version === version) {
    return cached.log;
  }
  if (cached?.inFlight) {
    return cached.inFlight;
  }
  const entry: LanguageLogCacheEntry = { version, log: {} };
  entry.inFlight = getBridge().knowledgeEvents.queryKnowledgeEventsForLanguage(language).then((log) => {
    // Stale-response guard: keep this payload only if no newer version
    // (local append or remote broadcast) replaced the cache entry meanwhile.
    if (languageLogCache.get(language) === entry) {
      entry.log = log;
      entry.inFlight = undefined;
    }
    return log;
  });
  languageLogCache.set(language, entry);
  return entry.inFlight;
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
