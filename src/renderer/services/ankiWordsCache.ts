/**
 * Anki Words Cache Service
 * 
 * Global singleton cache of words existing in Anki.
 * Fetched once from the backend when Anki is enabled,
 * then checked synchronously by WordHover and other components.
 */

import { createSignal } from 'solid-js';
import { getBackend } from '../../shared/backends';
import type { AnkiWordStatusRecord } from '../../shared/backends/types';
import type { LanguageData } from '../../shared/types';
import { getResolvedScriptProfile } from '../../shared/languageScriptProfile';
import { normalizeWordLookupText } from '../../shared/utils/textUtils';
import { statusToEase } from '../../shared/utils/knowledgeStrength';
import { getLogger } from '../../shared/utils/logger';
import type { WordStatus } from '../../shared/constants';
import { hashWordSync } from './srsAlgorithm';
import { getBridge } from '../../shared/bridges';
import { stripRetractions } from '../../shared/knowledgeEvents';
import type { KnowledgeEvent } from '../../shared/knowledgeEvents';
import { getAnkiWordKnowledgeStatus } from '../components/subtitle/wordHoverHelpers';
import { appendEvents } from './knowledgeEvents';

const log = getLogger("renderer.services.ankiWordsCache");

const [ankiCacheVersion, setAnkiCacheVersion] = createSignal(0);
export { ankiCacheVersion };

let activeCacheSignature = '';

interface AnkiWordsCacheEntry {
  wordsSet: Set<string>;
  wordCardsMap: Map<string, AnkiWordStatusRecord[]>;
  fetched: boolean;
  fetchPromise: Promise<Set<string>> | null;
  languageData: LanguageData | null | undefined;
  lastError: string | null;
}

const cachesBySignature = new Map<string, AnkiWordsCacheEntry>();

export interface AnkiWordsCacheOptions {
  language?: string;
  languageData?: LanguageData | null;
  ankiLearningThreshold?: number;
  ankiKnownThreshold?: number;
}

interface DiffConfig {
  learning: number;
  known: number;
}
const diffConfigBySignature = new Map<string, DiffConfig>();
const lastAnkiStatusByLk = new Map<string, WordStatus>();

const AUTO_REFETCH_BACKOFF_MS = 30_000;
const lastAutoFetchAtBySignature = new Map<string, number>();

function getCacheSignature(options?: AnkiWordsCacheOptions): string {
  const language = options?.language ?? '';
  const data = options?.languageData;
  const metadataSignature = data
    ? JSON.stringify({
      acceptedScripts: getResolvedScriptProfile(language, data).acceptedScripts,
      textProcessing: data.textProcessing ?? null,
    })
    : 'legacy';
  return `${language}:${metadataSignature}`;
}

function createCacheEntry(options?: AnkiWordsCacheOptions): AnkiWordsCacheEntry {
  return {
    wordsSet: new Set(),
    wordCardsMap: new Map(),
    fetched: false,
    fetchPromise: null,
    languageData: options && 'languageData' in options ? options.languageData : undefined,
    lastError: null,
  };
}

function getCacheEntry(options?: AnkiWordsCacheOptions): AnkiWordsCacheEntry {
  const signature = getCacheSignature(options);
  let entry = cachesBySignature.get(signature);
  if (!entry) {
    entry = createCacheEntry(options);
    cachesBySignature.set(signature, entry);
  }
  activeCacheSignature = signature;
  if (options && 'languageData' in options) {
    entry.languageData = options.languageData;
  }
  if (options?.ankiLearningThreshold != null && options?.ankiKnownThreshold != null) {
    diffConfigBySignature.set(signature, {
      learning: options.ankiLearningThreshold,
      known: options.ankiKnownThreshold,
    });
  }
  // Reads own cache population (no per-surface wiring): the first read on an
  // unfetched entry starts the fetch; the version bump on completion re-runs
  // reactive readers. Failed fetches auto-retry at most once per backoff
  // window; explicit fetch/refresh are never backoff-gated.
  ankiCacheVersion();
  if (!entry.fetched && !entry.fetchPromise) {
    const lastAttempt = lastAutoFetchAtBySignature.get(signature) ?? 0;
    if (Date.now() - lastAttempt >= AUTO_REFETCH_BACKOFF_MS) {
      void startEntryFetch(entry, options, signature);
    }
  }
  return entry;
}

function getActiveCacheEntry(): AnkiWordsCacheEntry {
  if (activeCacheSignature) {
    const active = cachesBySignature.get(activeCacheSignature);
    if (active) return active;
  }
  return getCacheEntry();
}

async function diffAnkiStatuses(signature: string, language: string, cards: AnkiWordStatusRecord[]): Promise<void> {
  const cfg = diffConfigBySignature.get(signature);
  if (!cfg) return;
  const byWord = new Map<string, AnkiWordStatusRecord[]>();
  for (const card of cards) {
    const existing = byWord.get(card.word);
    if (existing) existing.push(card);
    else byWord.set(card.word, [card]);
  }
  const computed = new Map<string, WordStatus>();
  const lksByWord = new Map<string, string>();
  for (const [word, wordCards] of byWord) {
    const toStatus = getAnkiWordKnowledgeStatus(wordCards, cfg.learning, cfg.known);
    if (!toStatus || toStatus === 'unknown') continue;
    computed.set(word, toStatus);
    lksByWord.set(word, `${language}:${hashWordSync(word)}`);
  }
  if (computed.size === 0) return;
  // Baseline from the journal: the durable record of the last asserted Anki
  // status. Without it every restart would re-assert unknown→known for the
  // whole bank (thousands of duplicate rows per launch).
  const missingPriors = [...new Set(lksByWord.values())].filter((lk) => !lastAnkiStatusByLk.has(lk));
  if (missingPriors.length > 0) {
    try {
      const priorLog = await getBridge().knowledgeEvents.queryKnowledgeEvents(missingPriors);
      for (const [lk, events] of Object.entries(priorLog)) {
        const prior = stripRetractions(events)
          .filter((event) => event.source === 'anki' && event.kind === 'status' && event.toStatus !== undefined)
          .at(-1)?.toStatus;
        if (prior !== undefined) lastAnkiStatusByLk.set(lk, prior);
      }
    } catch (e) {
      log.warn('anki status prior lookup failed:', e);
    }
  }
  const eventsByKey: Record<string, KnowledgeEvent[]> = {};
  const now = Date.now();
  for (const [word, toStatus] of computed) {
    const lk = lksByWord.get(word)!;
    const fromStatus = lastAnkiStatusByLk.get(lk) ?? 'unknown';
    lastAnkiStatusByLk.set(lk, toStatus);
    if (fromStatus !== toStatus) {
      eventsByKey[lk] = [{
        t: now, kind: 'status', source: 'anki', aspect: 'meaning',
        fromStatus, toStatus,
        easeAfter: statusToEase(toStatus),
      }];
    }
  }
  if (Object.keys(eventsByKey).length > 0) {
    appendEvents(eventsByKey).catch((e) => log.warn('anki status diff append failed:', e));
  }
}

function getLookupKeys(word: string, entry: AnkiWordsCacheEntry): string[] {
  const languageData = entry.languageData;
  const normalized = normalizeWordLookupText(word, languageData);
  if (!normalized) {
    return [];
  }

  return normalized === word ? [word] : [word, normalized];
}

function addWordLookup(
  entry: AnkiWordsCacheEntry,
  word: string,
  card: AnkiWordStatusRecord,
): void {
  for (const key of getLookupKeys(word, entry)) {
    entry.wordsSet.add(key);
    const existing = entry.wordCardsMap.get(key);
    if (existing) {
      existing.push(card);
    } else {
      entry.wordCardsMap.set(key, [card]);
    }
  }
}

export interface AnkiWordCacheMatch {
  /** Original Anki expression value to use for AnkiConnect card lookups/updates. */
  word: string;
  /** Normalized cache key that matched the hovered/candidate form. */
  lookupKey: string;
  cards: readonly AnkiWordStatusRecord[];
}

/** Fetch (or return cached) the set of all words in Anki */
export async function fetchAnkiWordsCache(options?: AnkiWordsCacheOptions): Promise<Set<string>> {
  const entry = getCacheEntry(options);
  if (entry.fetched) return entry.wordsSet;
  if (entry.fetchPromise) return entry.fetchPromise;
  return startEntryFetch(entry, options);
}

function startEntryFetch(
  entry: AnkiWordsCacheEntry,
  options?: AnkiWordsCacheOptions,
  signature = getCacheSignature(options),
): Promise<Set<string>> {
  lastAutoFetchAtBySignature.set(signature, Date.now());
  entry.fetchPromise = (async () => {
    try {
      const cards = await getBackend().getAnkiWordStatuses();
      const nextSet = new Set<string>();
      const nextMap = new Map<string, AnkiWordStatusRecord[]>();
      const nextEntry: AnkiWordsCacheEntry = {
        ...entry,
        wordsSet: nextSet,
        wordCardsMap: nextMap,
      };

      for (const card of cards) {
        const lookupWord = normalizeWordLookupText(card.word, entry.languageData);
        if (!lookupWord) {
          continue;
        }

        addWordLookup(nextEntry, card.word, card);
      }

      entry.wordsSet = nextSet;
      entry.wordCardsMap = nextMap;
      entry.fetched = true;
      entry.lastError = null;
      await diffAnkiStatuses(getCacheSignature(options), options?.language ?? '', cards);
    } catch (e) {
      log.error("error", e);
      // Silently fail — this cache entry stays empty
      entry.lastError = e instanceof Error ? e.message : String(e);
    }
    entry.fetchPromise = null;
    setAnkiCacheVersion(v => v + 1);
    return entry.wordsSet;
  })();

  return entry.fetchPromise;
}

/** Synchronously check if a word exists in the Anki cache */
export function isWordInAnkiCache(word: string, options?: AnkiWordsCacheOptions): boolean {
  const entry = options ? getCacheEntry(options) : getActiveCacheEntry();
  const keys = getLookupKeys(word, entry);
  return keys.some((key) => entry.wordsSet.has(key));
}

/**
 * Case-insensitive search over cached Anki words. Prefix matches rank first,
 * then includes matches; capped at max. Empty until the cache entry has fetched.
 */
export function searchAnkiWordsCache(
  query: string,
  max = 6,
  options?: AnkiWordsCacheOptions,
): string[] {
  const entry = options ? getCacheEntry(options) : getActiveCacheEntry();
  if (!entry.fetched) return [];
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const prefixMatches: string[] = [];
  const includesMatches: string[] = [];
  for (const key of entry.wordCardsMap.keys()) {
    const lower = key.toLowerCase();
    if (lower.startsWith(q)) {
      prefixMatches.push(key);
      if (prefixMatches.length >= max) break;
    } else if (lower.includes(q) && includesMatches.length < max * 2) {
      includesMatches.push(key);
    }
  }
  return [...prefixMatches, ...includesMatches].slice(0, max);
}

/** Return the first matched Anki cache entry, preserving candidate priority. */
export function findAnkiWordMatchInCache(words: readonly string[], options?: AnkiWordsCacheOptions): AnkiWordCacheMatch | null {
  const entry = options ? getCacheEntry(options) : getActiveCacheEntry();
  for (const word of words) {
    for (const key of getLookupKeys(word, entry)) {
      const cards = entry.wordCardsMap.get(key);
      if (cards && cards.length > 0) {
        return { word: cards[0].word, lookupKey: key, cards };
      }
    }
  }

  return null;
}

/** Return the first candidate word that exists in the Anki cache */
export function findWordInAnkiCache(words: readonly string[], options?: AnkiWordsCacheOptions): string | null {
  return findAnkiWordMatchInCache(words, options)?.word ?? null;
}

/**
 * Bulk anki-bank status keys for the O(n) set builders (level stats, suggestion
 * filtering) that aggregate over every word at once and can't call the per-word
 * resolver. Reads the cache version signal, so reactive callers rebuild on anki
 * syncs. Keys follow the `${language}:${hash}` shape each caller queries with —
 * pass the caller's own form expansion (canonical-only where queries canonicalize;
 * the full form family where queries cover surface variants).
 */
export function buildAnkiStatusKeySets(
  language: string,
  ankiLearningThreshold: number,
  ankiKnownThreshold: number,
  formsForWord: (word: string) => readonly string[],
  languageData?: LanguageData | null,
): { known: ReadonlySet<string>; learning: ReadonlySet<string> } {
  ankiCacheVersion();
  const known = new Set<string>();
  const learning = new Set<string>();
  // Fetches are per-signature (language + language metadata) and not every caller
  // fetches with full options — fall back to the last-fetched entry rather than
  // reading an empty one.
  const active = getActiveCacheEntry();
  const preferred = getCacheEntry({ language, languageData, ankiLearningThreshold, ankiKnownThreshold });
  const entry = preferred.fetched ? preferred : active;
  if (!entry.fetched) return { known, learning };

  const byWord = new Map<string, AnkiWordStatusRecord[]>();
  for (const cards of entry.wordCardsMap.values()) {
    for (const card of cards) {
      const existing = byWord.get(card.word);
      if (existing) existing.push(card);
      else byWord.set(card.word, [card]);
    }
  }
  for (const [word, cards] of byWord) {
    const status = getAnkiWordKnowledgeStatus(cards, ankiLearningThreshold, ankiKnownThreshold);
    if (!status || status === 'unknown') continue;
    const target = status === 'known' ? known : learning;
    for (const form of formsForWord(word)) {
      target.add(`${language}:${hashWordSync(form)}`);
    }
  }
  return { known, learning };
}

/** Check whether the cache has been populated */
export function isAnkiCacheFetched(options?: AnkiWordsCacheOptions): boolean {
  const signature = options ? getCacheSignature(options) : activeCacheSignature;
  return cachesBySignature.get(signature)?.fetched === true;
}

/** Return the last fetch error recorded for the cache entry, or null when healthy */
export function getAnkiCacheLastError(options?: AnkiWordsCacheOptions): string | null {
  const signature = options ? getCacheSignature(options) : activeCacheSignature;
  return cachesBySignature.get(signature)?.lastError ?? null;
}

export function getAnkiWordsCacheSignature(options?: AnkiWordsCacheOptions): string {
  return getCacheSignature(options);
}

export function getActiveAnkiWordsCacheSignature(): string {
  return activeCacheSignature;
}

export async function refreshAnkiWordsCache(options?: AnkiWordsCacheOptions): Promise<Set<string>> {
  if (options) {
    cachesBySignature.delete(getCacheSignature(options));
    if (activeCacheSignature === getCacheSignature(options)) activeCacheSignature = '';
  } else {
    clearAnkiWordsCache();
  }
  const wordsSet = await fetchAnkiWordsCache(options);
  setAnkiCacheVersion(v => v + 1);
  return wordsSet;
}

export function clearAnkiWordsCache(): void {
  cachesBySignature.clear();
  lastAutoFetchAtBySignature.clear();
  activeCacheSignature = '';
  setAnkiCacheVersion(v => v + 1);
}
