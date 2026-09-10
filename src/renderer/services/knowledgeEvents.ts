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

/** Derived per-key learner states (checkpoint folds + archive summaries). */
export async function getKnowledgeStates(keys: readonly string[]): Promise<Record<string, import('../../shared/knowledge/historyQueries').KeyKnowledgeState>> {
  ensureInitialized();
  return getBridge().knowledgeEvents.getKnowledgeStates([...keys]);
}

/** Per-key multi-resolution archive (LOD history, retention continuation). */
export async function getKnowledgeArchive(key: string): Promise<import('../../shared/knowledge/historyQueries').KnowledgeArchiveEnvelope> {
  ensureInitialized();
  return getBridge().knowledgeEvents.getKnowledgeArchive(key);
}

/** Analytics/overview summaries for one language (bounded by key count). */
export async function queryKnowledgeSummaries(language: string): Promise<Record<string, import('../../shared/knowledge/historyQueries').KeyHistorySummary>> {
  ensureInitialized();
  return getBridge().knowledgeEvents.queryKnowledgeSummaries(language);
}

/** Journal keys for a language, optionally prefix-filtered. */
export async function queryLanguageKeys(language: string, prefix?: string): Promise<string[]> {
  ensureInitialized();
  return getBridge().knowledgeEvents.queryLanguageKeys(language, prefix);
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
