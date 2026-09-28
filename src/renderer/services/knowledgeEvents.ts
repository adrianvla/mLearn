import { createSignal } from 'solid-js';
import { getBridge } from '../../shared/bridges';
import type { KnowledgeEvent, KnowledgeEventLog } from '../../shared/knowledgeEvents';

const [eventsVersion, setEventsVersion] = createSignal(0);
const [wordEventsVersion, setWordEventsVersion] = createSignal(0);
const queryCache = new Map<string, Promise<KnowledgeEventLog>>();

let channel: BroadcastChannel | null | undefined;
let bridgeListenerRegistered = false;

function bumpVersion(keys?: readonly string[]): void {
  queryCache.clear();
  setEventsVersion((version) => version + 1);
  // Grammar evidence has its own package-declared curriculum view. A grammar
  // rating cannot change lexical projections, so do not invalidate thousands
  // of word projections for that append. Missing change details remain a
  // conservative full invalidation for older bridge senders.
  if (keys === undefined || keys.some((key) => !/^[^:]+:grammar:/.test(key))) {
    setWordEventsVersion((version) => version + 1);
  }
}

// Lazy: module import must stay side-effect free (renderer AGENTS.md); tests also mock only partial bridges.
function ensureInitialized(): void {
  if (channel === undefined) {
    channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('mlearn-knowledge-events');
    if (channel) {
      // happy-dom's BroadcastChannel stub has no addEventListener; onmessage works everywhere.
      channel.onmessage = (event) => bumpVersion(Array.isArray(event.data) ? event.data as string[] : undefined);
    }
  }
  if (!bridgeListenerRegistered) {
    bridgeListenerRegistered = true;
    getBridge().knowledgeEvents.onKnowledgeEventsChanged(bumpVersion);
  }
}

export { eventsVersion, wordEventsVersion };

/** Keys must be precomputed `${language}:${hash}` form keys; all supplied forms are merged. */
export async function getEvents(keys: readonly string[]): Promise<KnowledgeEvent[]> {
  ensureInitialized();
  const uniqueKeys = [...new Set(keys)].sort();
  const cacheKey = uniqueKeys.join('|');
  let request = queryCache.get(cacheKey);
  if (!request) {
    request = Promise.resolve().then(() => getBridge().knowledgeEvents.queryKnowledgeEvents(uniqueKeys));
    queryCache.set(cacheKey, request);
  }
  let log: KnowledgeEventLog;
  try {
    log = await request;
  } catch (error) {
    // A failed request must not poison future reads. An invalidation may have
    // already replaced this entry with a newer request for the same keys.
    if (queryCache.get(cacheKey) === request) queryCache.delete(cacheKey);
    throw error;
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

/** Appends a journal batch and reports whether the durable store accepted it. */
export async function appendEventsAcknowledged(eventsByKey: KnowledgeEventLog): Promise<boolean> {
  ensureInitialized();
  if (!await getBridge().knowledgeEvents.appendKnowledgeEvents(eventsByKey)) return false;
  const changedKeys = Object.entries(eventsByKey).filter(([, events]) => events.length > 0).map(([key]) => key);
  bumpVersion(changedKeys);
  channel?.postMessage(changedKeys);
  return true;
}

/**
 * Restart-safe append for attempts whose stable id is persisted by the
 * caller before the bridge write. A retry after an interrupted IPC response
 * observes the already-durable attempt and succeeds without duplicating it.
 */
export async function appendEventsIdempotentAcknowledged(eventsByKey: KnowledgeEventLog): Promise<boolean> {
  ensureInitialized();
  const keys = Object.keys(eventsByKey).filter((key) => eventsByKey[key]?.length > 0);
  if (keys.length === 0) return false;
  const existing = await getBridge().knowledgeEvents.queryKnowledgeEvents(keys);
  const pending: KnowledgeEventLog = {};
  for (const key of keys) {
    const existingAttemptIds = new Set(
      (existing[key] ?? []).flatMap((event) => event.kind === 'retraction' && event.retracts !== undefined
        ? [`retraction:${event.retracts}`]
        : event.attemptId === undefined ? [] : [`attempt:${event.attemptId}`]),
    );
    const events = (eventsByKey[key] ?? []).filter(
      (event) => event.kind === 'retraction'
        ? event.retracts === undefined || !existingAttemptIds.has(`retraction:${event.retracts}`)
        : event.attemptId === undefined || !existingAttemptIds.has(`attempt:${event.attemptId}`),
    );
    if (events.length > 0) pending[key] = events;
  }
  if (Object.keys(pending).length === 0) return true;
  return appendEventsAcknowledged(pending);
}

/** Legacy fire-and-forget-compatible append surface. */
export async function appendEvents(eventsByKey: KnowledgeEventLog): Promise<void> {
  await appendEventsAcknowledged(eventsByKey);
}

export function getVersion(): number {
  return eventsVersion();
}
