/**
 * Translation Hook
 * Handles word translation and dictionary lookups
 */

import { createSignal, createResource } from 'solid-js';
import type { TranslationResponse, TranslationEntry, DictionaryEntry, Token, LanguageData, WordLookupContext } from '../../shared/types';
import { getBackend } from '../../shared/backends';
import { getBridge } from '../../shared/bridges';
import { createRoughTokenizerTokens, getTokenizerCacheNamespace, tokenizerAllowsFallback } from '../../shared/languageFeatures';
import { getWordFormCandidates } from '../utils/wordForms';
import { extractDefinitionValues, extractReadingValue } from '../utils/translationCacheParsers';
import {
  getCachedTranslationByLanguageDB,
  setCachedTranslationByLanguageDB,
  setCachedTranslationBatchByLanguageDB,
  getCachedDictionaryByLanguageDB,
  setCachedDictionaryByLanguageDB,
  getCachedTokensByLanguageDB,
  setCachedTokensByLanguageDB,
  setCachedTokensBatchByLanguageDB,
} from '../services/offlineCache';
import { getLogger } from '../../shared/utils/logger';
import { hashWordSync } from '../services/srsAlgorithm';
import type { BackendAdapter } from '../../shared/backends/types';

const log = getLogger("renderer.hooks.useTranslation");
const TRANSLATION_CACHE_MAX = 5000;
const TRANSLATION_WARM_CONCURRENCY = 10;
import { perfCount } from '../utils/perfCounters';
const translationCache = new Map<string, TranslationResponse>();
const [cacheVersion, setCacheVersion] = createSignal(0);
let selectionChannel: BroadcastChannel | undefined;
function ensureSelectionChannel(): void {
  if (selectionChannel || typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;
  selectionChannel = new BroadcastChannel('mlearn-dictionary-selections');
  selectionChannel.onmessage = event => {
    const message = event.data as { cacheKey?: unknown; selectionKey?: unknown };
    if (typeof message?.cacheKey !== 'string' || typeof message.selectionKey !== 'string' || !/^ml_lookup_selection::[a-f0-9]{64}$/.test(message.selectionKey)) return;
    void readLookupSelection(message.selectionKey).then(selection => {
      if (!selection?.response || selection.cacheKey !== message.cacheKey) return;
      setTranslationCache(message.cacheKey as string, selection.response);
      setCacheVersion(value => value + 1);
    }).catch(error => log.warn('Could not refresh dictionary selection:', error));
  };
  window.addEventListener('beforeunload', () => selectionChannel?.close(), { once: true });
}
const hotModule = (import.meta as ImportMeta & { hot?: { dispose: (callback: () => void) => void } }).hot;
hotModule?.dispose(() => { selectionChannel?.close(); selectionChannel = undefined; });
const [warmInFlightCount, setWarmInFlightCount] = createSignal(0);

export { cacheVersion };

/** True while any warmTranslationCache run is fetching translations (status bar). */
export const isTranslationWarming = (): boolean => warmInFlightCount() > 0;
const tokenCache = new Map<string, { tokens: Token[]; ts: number }>();
const tokenInFlight = new Map<string, Promise<{ tokens: Token[]; fresh: boolean }>>();
const TOKEN_CACHE_MAX = 1000;

const DICTIONARY_CACHE_MAX = 5000;
const dictionaryCache = new Map<string, DictionaryEntry[]>();

function pruneMapFIFO<K, V>(map: Map<K, V>, max: number): void {
  while (map.size > max) {
    const firstKey = map.keys().next().value as K | undefined;
    if (firstKey === undefined) return;
    map.delete(firstKey);
  }
}

function setTranslationCache(key: string, value: TranslationResponse): void {
  translationCache.set(key, value);
  pruneMapFIFO(translationCache, TRANSLATION_CACHE_MAX);
}

function setDictionaryCache(key: string, value: DictionaryEntry[]): void {
  dictionaryCache.set(key, value);
  pruneMapFIFO(dictionaryCache, DICTIONARY_CACHE_MAX);
}

const OVERRIDE_KEY = 'ml_translation_overrides';

function buildLookupScope(language?: string, dictionaryTargetLanguage?: string): string {
  const base = language || 'default';
  return dictionaryTargetLanguage ? `${base}->${dictionaryTargetLanguage}` : base;
}

function buildVersionedLanguageCacheId(
  language?: string,
  languageData?: LanguageData | null,
  dictionaryTargetLanguage?: string,
): string | undefined {
  const base = language || 'default';
  const packageManifest = languageData?.languageData;
  const dictionaryPack = dictionaryTargetLanguage
    ? packageManifest?.dictionaryPacks?.[dictionaryTargetLanguage]
    : undefined;
  const packageAssetHash = packageManifest?.assets?.map((asset) => asset.sha256).filter(Boolean).join(',');
  const dictionaryAssetHash = dictionaryPack?.assets?.map((asset) => asset.sha256).filter(Boolean).join(',');
  const packageVersion = packageManifest?.activationGeneration || packageManifest?.bundle?.sha256 || packageAssetHash || packageManifest?.version;
  const dictionaryVersion = dictionaryPack?.bundle?.sha256 || dictionaryAssetHash || dictionaryPack?.version;

  if (!packageVersion && !dictionaryVersion && languageData?.resolvedVariantId === undefined) {
    return language;
  }

  const parts = [base];
  if (languageData?.resolvedVariantId !== undefined) parts.push(`variant:${JSON.stringify(languageData.resolvedVariantId)}`);
  if (packageVersion) {
    parts.push(`language:${packageVersion}`);
  }
  if (dictionaryTargetLanguage && dictionaryVersion) {
    parts.push(`dictionary:${dictionaryTargetLanguage}:${dictionaryVersion}`);
  }

  return parts.join('@');
}

function buildTranslationCacheKey(word: string, language?: string, dictionaryTargetLanguage?: string): string {
  return `${buildLookupScope(language, dictionaryTargetLanguage)}::${word}`;
}

function contextualLookupWord(word: string, context: WordLookupContext): string {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
  return `${word}::context:${JSON.stringify(canonical(context))}`;
}

function lookupSelectionKey(word: string, context: WordLookupContext, language?: string, dictionaryTargetLanguage?: string): string {
  return `ml_lookup_selection::${hashWordSync(buildTranslationCacheKey(contextualLookupWord(word, context), language, dictionaryTargetLanguage))}`;
}

interface LookupSelection { selectionId: string; packageCacheId?: string; cacheKey?: string; response?: TranslationResponse; raw: string }
async function readLookupSelection(key: string): Promise<LookupSelection | null> {
  const raw = await getBridge().kvStore.kvGet(key);
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as Partial<LookupSelection>;
    if (typeof stored.selectionId === 'string') {
      return { selectionId: stored.selectionId, raw,
        ...(typeof stored.packageCacheId === 'string' ? { packageCacheId: stored.packageCacheId } : {}),
        ...(typeof stored.cacheKey === 'string' ? { cacheKey: stored.cacheKey } : {}),
        ...(Array.isArray(stored.response?.data) && stored.response?.resolution?.selectedId === stored.selectionId ? { response: stored.response } : {}) };
    }
  } catch { /* Prior correction records contained only the opaque ID. */ }
  return { selectionId: raw, raw };
}

export { tokenLookupContext } from '../utils/wordForms';

function buildDictionaryCacheKey(
  word: string,
  reading: string,
  language?: string,
  dictionaryTargetLanguage?: string,
): string {
  return `${buildLookupScope(language, dictionaryTargetLanguage)}::${word}::${reading}`;
}

function buildTokenCacheKey(text: string, language?: string, namespace?: string): string {
  return `${language || 'default'}::${namespace || 'default'}::${text}`;
}

function getCachedTranslationScopedDB(
  word: string,
  language?: string,
  dictionaryTargetLanguage?: string,
): Promise<TranslationResponse | null> {
  return dictionaryTargetLanguage
    ? getCachedTranslationByLanguageDB(word, language, dictionaryTargetLanguage)
    : getCachedTranslationByLanguageDB(word, language);
}

function setCachedTranslationScopedDB(
  word: string,
  data: TranslationResponse,
  language?: string,
  dictionaryTargetLanguage?: string,
): Promise<void> {
  return dictionaryTargetLanguage
    ? setCachedTranslationByLanguageDB(word, data, language, dictionaryTargetLanguage)
    : setCachedTranslationByLanguageDB(word, data, language);
}

function setCachedTranslationBatchScopedDB(
  entries: Array<{ word: string; data: TranslationResponse }>,
  language?: string,
  dictionaryTargetLanguage?: string,
): Promise<void> {
  return dictionaryTargetLanguage
    ? setCachedTranslationBatchByLanguageDB(entries, language, dictionaryTargetLanguage)
    : setCachedTranslationBatchByLanguageDB(entries, language);
}

function getCachedDictionaryScopedDB(
  word: string,
  reading: string,
  language?: string,
  dictionaryTargetLanguage?: string,
): Promise<DictionaryEntry[] | null> {
  return dictionaryTargetLanguage
    ? getCachedDictionaryByLanguageDB(word, reading, language, dictionaryTargetLanguage)
    : getCachedDictionaryByLanguageDB(word, reading, language);
}

function setCachedDictionaryScopedDB(
  word: string,
  reading: string,
  entries: DictionaryEntry[],
  language?: string,
  dictionaryTargetLanguage?: string,
): Promise<void> {
  return dictionaryTargetLanguage
    ? setCachedDictionaryByLanguageDB(word, reading, entries, language, dictionaryTargetLanguage)
    : setCachedDictionaryByLanguageDB(word, reading, entries, language);
}

export function getCachedTranslation(
  word: string,
  language?: string,
  lookupOptions: WordLookupCandidateOptions = {},
): TranslationResponse | null {
  // Intentional bare read: makes every caller reactive to cache writes.
  cacheVersion();
  const languageData = resolveLanguageData(lookupOptions.languageData);
  const candidates = buildTranslationLookupCandidates(
    word,
    lookupOptions.getCanonicalForm ?? identityWordForm,
    lookupOptions.getWordVariants,
    languageData,
    language,
  );
  const dictionaryTargetLanguage = resolveDictionaryTargetLanguage(lookupOptions.dictionaryTargetLanguage);
  const cacheLanguage = buildVersionedLanguageCacheId(language, languageData, dictionaryTargetLanguage);
  const originalCacheKey = buildTranslationCacheKey(word, cacheLanguage, dictionaryTargetLanguage);
  if (lookupOptions.context) {
    ensureSelectionChannel();
    const override = overridesCache?.[buildTranslationCacheKey(word, language, dictionaryTargetLanguage)];
    if (override) return override;
    return translationCache.get(buildTranslationCacheKey(contextualLookupWord(word, lookupOptions.context), cacheLanguage, dictionaryTargetLanguage)) ?? null;
  }

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const cacheKey = buildTranslationCacheKey(candidate, cacheLanguage, dictionaryTargetLanguage);
    const cached = translationCache.get(cacheKey);
    if (!cached) continue;

    if (translationHasEntries(cached) || i === candidates.length - 1) {
      if (cacheKey !== originalCacheKey && translationHasEntries(cached)) {
        setTranslationCache(originalCacheKey, cached);
      }
      return cached;
    }
  }

  return null;
}

export function getCachedReading(
  word: string,
  language?: string,
  lookupOptions: WordLookupCandidateOptions = {},
): string | null {
  const cached = getCachedTranslation(word, language, lookupOptions);
  if (!cached?.data) return null;

  const firstEntry = cached.data[0] as TranslationEntry | undefined;
  const extractedReading = extractReadingValue(firstEntry, resolveLanguageData(lookupOptions.languageData));
  if (!extractedReading) return null;

  let reading = extractedReading;
  const markerIdx = reading.indexOf('<!-- accent_start -->');
  if (markerIdx !== -1) reading = reading.substring(0, markerIdx);
  reading = reading.replace(/<[^>]*>/g, '').trim();
  return reading || null;
}

let overridesCache: Record<string, TranslationResponse> | null = null;

async function readOverrides(): Promise<Record<string, TranslationResponse>> {
  if (overridesCache) return overridesCache;
  try {
    const raw = await getBridge().kvStore.kvGet(OVERRIDE_KEY);
    overridesCache = raw ? JSON.parse(raw) : {};
  } catch (e) {
    log.error("error", e);
    overridesCache = {};
  }
  return overridesCache ?? {};
}

function writeOverrides(map: Record<string, TranslationResponse>): void {
  overridesCache = map;
  getBridge().kvStore.kvSet(OVERRIDE_KEY, JSON.stringify(map));
}

export interface WordLookupCandidateOptions {
  /** Publication lifetime of the source occurrence, independent of reusable NLP caches. */
  sourceKey?: string | (() => string | undefined);
  context?: WordLookupContext;
  getCanonicalForm?: (word: string) => string;
  getWordVariants?: (word: string) => string[];
  getReadingVariants?: (reading: string) => string[];
  dictionaryTargetLanguage?: string | (() => string | undefined);
  languageData?: LanguageData | null | (() => LanguageData | null);
  /** Language code — required for package mapping-table normalizer steps to apply. */
  language?: string | (() => string);
}

function resolveLanguage(value: string | (() => string) | undefined): string | undefined {
  return typeof value === 'function' ? value() : value;
}

function resolveDictionaryTargetLanguage(value: WordLookupCandidateOptions['dictionaryTargetLanguage']): string | undefined {
  return typeof value === 'function' ? value() : value;
}

function resolveLanguageData(value: WordLookupCandidateOptions['languageData']): LanguageData | null {
  return typeof value === 'function' ? value() : value ?? null;
}

function snapshotLanguageData(value: WordLookupCandidateOptions['languageData']): LanguageData | null {
  const data = resolveLanguageData(value);
  return data ? JSON.parse(JSON.stringify(data)) as LanguageData : null;
}

export class NlpContextChangedError extends Error {
  constructor() {
    super('The source or language processing context changed.');
    this.name = 'NlpContextChangedError';
  }
}

function nlpExecutionKey(options: WordLookupCandidateOptions): string {
  const language = resolveLanguage(options.language);
  const languageData = resolveLanguageData(options.languageData);
  const target = resolveDictionaryTargetLanguage(options.dictionaryTargetLanguage);
  const source = typeof options.sourceKey === 'function' ? options.sourceKey() : options.sourceKey;
  return JSON.stringify([source, language, target,
    buildVersionedLanguageCacheId(language, languageData, target), getTokenizerCacheNamespace(languageData)]);
}

function assertNlpContext(key: string, options: WordLookupCandidateOptions): void {
  if (key !== nlpExecutionKey(options)) throw new NlpContextChangedError();
}

function translateWithDictionaryTarget(
  backend: BackendAdapter,
  word: string,
  language?: string,
  dictionaryTargetLanguage?: string,
  variant?: string | null,
): Promise<TranslationResponse> {
  if (variant !== undefined) return backend.translate(word, language, { variant, ...(dictionaryTargetLanguage ? { dictionaryTargetLanguage } : {}) });
  return dictionaryTargetLanguage
    ? backend.translate(word, language, { dictionaryTargetLanguage })
    : backend.translate(word, language);
}

function identityWordForm(word: string): string {
  return word;
}

function buildWordLookupCandidates(
  word: string,
  getCanonicalForm: (word: string) => string = identityWordForm,
  getWordVariants?: (word: string) => string[],
  languageData?: LanguageData | null,
  language?: string,
): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const append = (candidate: string | null | undefined) => {
    const normalized = candidate?.trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push(normalized);
  };

  append(word);
  for (const candidate of getWordFormCandidates(word, getCanonicalForm, getWordVariants, { languageData, language })) {
    append(candidate);
  }

  return candidates;
}

function translationHasEntries(value: TranslationResponse): boolean {
  return Array.isArray(value.data) && value.data.length > 0;
}

export function buildTranslationLookupCandidates(
  word: string,
  getCanonicalForm: (word: string) => string = identityWordForm,
  getWordVariants?: (word: string) => string[],
  languageData?: LanguageData | null,
  language?: string,
): string[] {
  return buildWordLookupCandidates(word, getCanonicalForm, getWordVariants, languageData, language);
}

export async function fetchTranslation(
  word: string,
  language?: string,
  lookupOptions: WordLookupCandidateOptions = {},
): Promise<TranslationResponse> {
  const languageData = snapshotLanguageData(lookupOptions.languageData);
  const candidates = buildTranslationLookupCandidates(
    word,
    lookupOptions.getCanonicalForm ?? identityWordForm,
    lookupOptions.getWordVariants,
    languageData,
    language,
  );
  const dictionaryTargetLanguage = resolveDictionaryTargetLanguage(lookupOptions.dictionaryTargetLanguage);
  const cacheLanguage = buildVersionedLanguageCacheId(language, languageData, dictionaryTargetLanguage);
  const originalCacheKey = buildTranslationCacheKey(word, cacheLanguage, dictionaryTargetLanguage);
  const overrides = await readOverrides();
  if (lookupOptions.context) {
    const override = overrides[buildTranslationCacheKey(word, language, dictionaryTargetLanguage)];
    if (override) return override;
    const scopedWord = contextualLookupWord(word, lookupOptions.context);
    const key = buildTranslationCacheKey(scopedWord, cacheLanguage, dictionaryTargetLanguage);
    const selectionKey = lookupSelectionKey(word, lookupOptions.context, language, dictionaryTargetLanguage);
    const selection = await readLookupSelection(selectionKey);
    const selectionId = selection?.selectionId;
    if (selection?.response && selection.packageCacheId === cacheLanguage) {
      setTranslationCache(key, selection.response); setCacheVersion(value => value + 1); return selection.response;
    }
    const agreesWithSelection = (cached: TranslationResponse) => !selectionId || cached.resolution?.selectedId === selectionId
      || (cached.resolution?.selectionUnavailable === true && cached.resolution.requestedSelectionId === selectionId);
    if (translationCache.has(key) && agreesWithSelection(translationCache.get(key)!)) return translationCache.get(key)!;
    const cached = await getCachedTranslationScopedDB(scopedWord, cacheLanguage, dictionaryTargetLanguage);
    if (cached && agreesWithSelection(cached)) { setTranslationCache(key, cached); setCacheVersion(value => value + 1); return cached; }
    const result = await getBackend().translate(word, language, { variant: languageData?.resolvedVariantId, context: { ...lookupOptions.context, ...(selectionId ? { selectionId } : {}) },
      ...(dictionaryTargetLanguage ? { dictionaryTargetLanguage } : {}) });
    if ((await readLookupSelection(selectionKey))?.raw !== selection?.raw) {
      return fetchTranslation(word, language, lookupOptions);
    }
    if (result.resolution?.selectionUnavailable && selectionId) result.resolution.requestedSelectionId = selectionId;
    setTranslationCache(key, result);
    setCacheVersion(value => value + 1);
    await setCachedTranslationScopedDB(scopedWord, result, cacheLanguage, dictionaryTargetLanguage);
    return result;
  }

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const cacheKey = buildTranslationCacheKey(candidate, cacheLanguage, dictionaryTargetLanguage);
    const overrideKey = buildTranslationCacheKey(candidate, language, dictionaryTargetLanguage);
    const isLastCandidate = i === candidates.length - 1;

    if (overrides[overrideKey]) {
      const override = overrides[overrideKey];
      if (cacheKey !== originalCacheKey && translationHasEntries(override)) {
        setTranslationCache(originalCacheKey, override);
      }
      return override;
    }

    if (translationCache.has(cacheKey)) {
      const cached = translationCache.get(cacheKey)!;
      if (translationHasEntries(cached) || isLastCandidate) {
        if (cacheKey !== originalCacheKey && translationHasEntries(cached)) {
          setTranslationCache(originalCacheKey, cached);
        }
        return cached;
      }
      continue;
    }

    const dbCached = await getCachedTranslationScopedDB(candidate, cacheLanguage, dictionaryTargetLanguage);
    if (dbCached) {
      setTranslationCache(cacheKey, dbCached);
      setCacheVersion((v) => v + 1);
      if (translationHasEntries(dbCached) || isLastCandidate) {
        if (cacheKey !== originalCacheKey && translationHasEntries(dbCached)) {
          setTranslationCache(originalCacheKey, dbCached);
        }
        return dbCached;
      }
      continue;
    }

    const data = await translateWithDictionaryTarget(getBackend(), candidate, language, dictionaryTargetLanguage, languageData?.resolvedVariantId);
    setTranslationCache(cacheKey, data);
    setCacheVersion((v) => v + 1);
    void setCachedTranslationScopedDB(candidate, data, cacheLanguage, dictionaryTargetLanguage);
    if (translationHasEntries(data) || isLastCandidate) {
      if (cacheKey !== originalCacheKey && translationHasEntries(data)) {
        setTranslationCache(originalCacheKey, data);
        void setCachedTranslationScopedDB(word, data, cacheLanguage, dictionaryTargetLanguage);
      }
      return data;
    }
  }

  return { data: [] };
}

/** A correction is scoped to this encountered form and context, never every homograph. */
export async function selectTranslationCandidate(word: string, selectionId: string, language: string,
  options: WordLookupCandidateOptions): Promise<TranslationResponse> {
  const dictionaryTargetLanguage = resolveDictionaryTargetLanguage(options.dictionaryTargetLanguage);
  const cacheLanguage = buildVersionedLanguageCacheId(language, resolveLanguageData(options.languageData), dictionaryTargetLanguage);
  const context = options.context ?? {};
  const result = await getBackend().translate(word, language, { variant: resolveLanguageData(options.languageData)?.resolvedVariantId, context: { ...context, selectionId },
    ...(dictionaryTargetLanguage ? { dictionaryTargetLanguage } : {}) });
  if (result.resolution?.selectedId !== selectionId || result.resolution.selectionUnavailable) throw new Error('Dictionary selection unavailable');
  const selectionKey = lookupSelectionKey(word, context, language, dictionaryTargetLanguage);
  const scopedWord = contextualLookupWord(word, context);
  const cacheKey = buildTranslationCacheKey(scopedWord, cacheLanguage, dictionaryTargetLanguage);
  const record = JSON.stringify({ version: 1, selectionId, packageCacheId: cacheLanguage, cacheKey, response: result });
  await getBridge().kvStore.kvSet(selectionKey, record);
  if (await getBridge().kvStore.kvGet(selectionKey) !== record) throw new Error('Dictionary selection was not acknowledged');
  await setCachedTranslationScopedDB(scopedWord, result, cacheLanguage, dictionaryTargetLanguage);
  if (await getBridge().kvStore.kvGet(selectionKey) !== record) return fetchTranslation(word, language, { ...options, context });
  setTranslationCache(cacheKey, result);
  setCacheVersion(value => value + 1);
  ensureSelectionChannel();
  selectionChannel?.postMessage({ cacheKey, selectionKey });
  return result;
}

export interface UseTranslationOptions {
  sourceKey?: WordLookupCandidateOptions['sourceKey'];
  immediate?: boolean;
  language?: string | (() => string);
  getCanonicalForm?: (word: string) => string;
  getWordVariants?: (word: string) => string[];
  getReadingVariants?: (reading: string) => string[];
  dictionaryTargetLanguage?: string | (() => string | undefined);
  languageData?: LanguageData | null | (() => LanguageData | null);
}

export function useTranslation(options: UseTranslationOptions = {}) {
  const [currentWord, setCurrentWord] = createSignal<string | null>(null);

  const [translation, { refetch }] = createResource(
    () => {
      const word = currentWord();
      return word ? { word, key: nlpExecutionKey(options) } : null;
    },
    async ({ word, key }) => {
      if (!word) return null;
      const result = await fetchTranslation(word, resolveLanguage(options.language), options);
      assertNlpContext(key, options);
      return result;
    },
  );

  const translate = async (word: string): Promise<TranslationResponse | null> => {
    setCurrentWord(word);
    if (options.immediate) {
      await refetch();
    }
    return translation() ?? null;
  };

  const translateWord = async (word: string, context?: WordLookupContext): Promise<TranslationResponse> => {
    const key = nlpExecutionKey(options);
    const result = await fetchTranslation(word, resolveLanguage(options.language), { ...options, ...(context ? { context } : {}) });
    assertNlpContext(key, options);
    return result;
  };

  const setOverride = async (word: string, value: TranslationResponse | null) => {
    const language = resolveLanguage(options.language);
    const dictionaryTargetLanguage = resolveDictionaryTargetLanguage(options.dictionaryTargetLanguage);
    const overrides = await readOverrides();
    const cacheKey = buildTranslationCacheKey(
      word,
      language,
      dictionaryTargetLanguage,
    );
    if (value === null) {
      delete overrides[cacheKey];
      translationCache.delete(cacheKey);
    } else {
      overrides[cacheKey] = value;
      setTranslationCache(cacheKey, value);
    }
    writeOverrides(overrides);
    setCacheVersion((v) => v + 1);
  };

  const clearCache = () => {
    translationCache.clear();
  };

  return {
    translation,
    translate,
    translateWord,
    setOverride,
    clearCache,
    isLoading: () => translation.loading,
    error: () => translation.error,
  };
}

export async function warmTranslationCache(
  words: string[],
  _translationUrl?: string,
  _translatableTypes?: string[],
  language?: string,
  dictionaryTargetLanguage?: string,
  languageData?: LanguageData | null,
  options?: { throwOnFailure?: boolean },
): Promise<void> {
  const backend = getBackend();
  const variant = languageData?.resolvedVariantId;
  const unique = [...new Set(words)];
  const cacheLanguage = buildVersionedLanguageCacheId(language, languageData, dictionaryTargetLanguage);
  const failures: unknown[] = [];
  const batchEntries: Array<{ word: string; data: TranslationResponse }> = [];
  const wordsToWarm = unique
    .filter((w) => w && w.trim())
    .filter((w) => !translationCache.has(buildTranslationCacheKey(w, cacheLanguage, dictionaryTargetLanguage)));
  if (wordsToWarm.length === 0) return;

  setWarmInFlightCount((c) => c + 1);
  try {
    for (let i = 0; i < wordsToWarm.length; i += TRANSLATION_WARM_CONCURRENCY) {
      let chunkHits = 0;
      const chunk = wordsToWarm.slice(i, i + TRANSLATION_WARM_CONCURRENCY).map(async (word) => {
        try {
          const data = await translateWithDictionaryTarget(backend, word, language, dictionaryTargetLanguage, variant);
          setTranslationCache(buildTranslationCacheKey(word, cacheLanguage, dictionaryTargetLanguage), data);
          chunkHits += 1;
          batchEntries.push({ word, data });
        } catch (error) {
          failures.push(error);
        }
      });

      await Promise.all(chunk);
      // One invalidation per chunk: every subscribed word memo re-runs on each
      // bump, so per-word bumps turned a page warm into waves of full-page
      // recomputes. The chunk's entries are all in the map before the bump.
      if (chunkHits > 0) {
        setCacheVersion((v) => v + 1);
      }
    }

    if (batchEntries.length > 0) {
      void setCachedTranslationBatchScopedDB(batchEntries, cacheLanguage, dictionaryTargetLanguage);
    }
    if (options?.throwOnFailure && failures.length > 0) throw failures[0];
  } finally {
    setWarmInFlightCount((c) => c - 1);
  }
}

export interface UseTokenizerOptions {
  dictionaryTargetLanguage?: WordLookupCandidateOptions['dictionaryTargetLanguage'];
  sourceKey?: WordLookupCandidateOptions['sourceKey'];
  language?: string | (() => string);
  languageData?: LanguageData | null | (() => LanguageData | null);
}

function resolveTokenizerLanguageData(value: UseTokenizerOptions['languageData']): LanguageData | null {
  return typeof value === 'function' ? value() : value ?? null;
}

function createEmptyFallbackToken(text: string): Token[] {
  return [{ actual_word: text, word: text, type: 'UNKNOWN' }];
}

export function useTokenizer(options: UseTokenizerOptions = {}) {
  const resolveUncached = async (
    key: string,
    namespace: string | undefined,
    cacheKey: string,
    persist: boolean,
    language: string | undefined,
    target?: string,
    variant?: string | null,
  ): Promise<{ tokens: Token[]; fresh: boolean }> => {
    const dbCached = await getCachedTokensByLanguageDB(key, language, namespace);
    if (dbCached) {
      tokenCache.set(cacheKey, { tokens: dbCached, ts: Date.now() });
      return { tokens: dbCached, fresh: false };
    }

    const tokens = variant !== undefined ? await getBackend().tokenize(key, language, target, variant) : target ? await getBackend().tokenize(key, language, target) : await getBackend().tokenize(key, language);
    tokenCache.set(cacheKey, { tokens, ts: Date.now() });
    pruneMapFIFO(tokenCache, TOKEN_CACHE_MAX);
    if (persist) {
      void setCachedTokensByLanguageDB(key, tokens, language, namespace);
    }
    return { tokens, fresh: true };
  };

  const tokenizeUncached = async (
    key: string,
    namespace: string | undefined,
    cacheKey: string,
    persist: boolean,
    language: string | undefined,
    target?: string,
    variant?: string | null,
  ): Promise<{ tokens: Token[]; fresh: boolean }> => {
    const p = resolveUncached(key, namespace, cacheKey, persist, language, target, variant);
    tokenInFlight.set(cacheKey, p);
    try {
      return await p;
    } finally {
      tokenInFlight.delete(cacheKey);
    }
  };

  const roughFallbackOrThrow = (key: string, languageData: LanguageData | null, error: unknown, language: string | undefined): Token[] => {
    log.error("error", error);
    if (!tokenizerAllowsFallback(languageData)) {
      throw error;
    }
    const fallbackTokens = createRoughTokenizerTokens(key, languageData, language);
    if (fallbackTokens.length === 0) {
      throw error;
    }
    return fallbackTokens.map(token => ({ ...token, analysisAuthority: 'display-only' as const }));
  };

  const cachedOrFlight = (key: string, namespace: string | undefined, language: string | undefined): Promise<Token[]> | undefined => {
    const cacheKey = buildTokenCacheKey(key, language, namespace);
    if (tokenCache.has(cacheKey)) return Promise.resolve(tokenCache.get(cacheKey)!.tokens);
    if (tokenInFlight.has(cacheKey)) return tokenInFlight.get(cacheKey)!.then((result) => result.tokens);
    return undefined;
  };

  const tokenizeAdmitted = async (text: string): Promise<Token[]> => {
    const language = typeof options.language === 'function' ? options.language() : options.language;
    const key = typeof text === 'string' ? text : String(text);
    if (!key.trim()) return createEmptyFallbackToken(key);
    const currentData = resolveTokenizerLanguageData(options.languageData);
    const languageData = currentData ? JSON.parse(JSON.stringify(currentData)) as LanguageData : null;
    const target = resolveDictionaryTargetLanguage(options.dictionaryTargetLanguage);
    const namespace = [getTokenizerCacheNamespace(languageData), target].filter(Boolean).join('::') || undefined;
    const fast = cachedOrFlight(key, namespace, language);
    perfCount(fast ? 'tokenize.cacheHit' : 'tokenize.miss');
    if (fast) return fast;
    const cacheKey = buildTokenCacheKey(key, language, namespace);
    try {
      const { tokens } = await tokenizeUncached(key, namespace, cacheKey, true, language, target, languageData?.resolvedVariantId);
      return tokens;
    } catch (e) {
      return roughFallbackOrThrow(key, languageData, e, language);
    }
  };

  // Page-level entry: identical per-text semantics (memory cache, in-flight
  // dedupe, DB cache, rough fallback), but fresh backend results persist in
  const tokenizeManyAdmitted = async (texts: string[]): Promise<Token[][]> => {
    const language = typeof options.language === 'function' ? options.language() : options.language;
    perfCount('tokenizeMany.calls', 1);
    perfCount('tokenizeMany.texts', texts.length);
    const tmStart = performance.now();
    const currentData = resolveTokenizerLanguageData(options.languageData);
    const languageData = currentData ? JSON.parse(JSON.stringify(currentData)) as LanguageData : null;
    const target = resolveDictionaryTargetLanguage(options.dictionaryTargetLanguage);
    const namespace = [getTokenizerCacheNamespace(languageData), target].filter(Boolean).join('::') || undefined;
    const fresh: Array<{ text: string; tokens: Token[] }> = [];
    const results = await Promise.all(texts.map(async (text) => {
      const key = typeof text === 'string' ? text : String(text);
      if (!key.trim()) return createEmptyFallbackToken(key);
      const fast = cachedOrFlight(key, namespace, language);
      if (fast) return fast;
      const cacheKey = buildTokenCacheKey(key, language, namespace);
      let result: { tokens: Token[]; fresh: boolean };
      try {
        result = await tokenizeUncached(key, namespace, cacheKey, false, language, target, languageData?.resolvedVariantId);
      } catch (e) {
        // Rough fallbacks are display-only and never persisted (same as `tokenize`).
        return roughFallbackOrThrow(key, languageData, e, language);
      }
      // Only backend misses enter the batch: DB-cache hits and rough fallbacks
      // are already stored (or display-only) and must not be rewritten.
      if (result.fresh) {
        fresh.push({ text: key, tokens: result.tokens });
      }
      return result.tokens;
    }));
    perfCount('tokenizeMany.ms', performance.now() - tmStart);
    if (fresh.length > 0) {
      void setCachedTokensBatchByLanguageDB(fresh, language, namespace);
    }
    return results;
  };

  const tokenize = async (text: string): Promise<Token[]> => {
    const key = nlpExecutionKey(options);
    const result = await tokenizeAdmitted(text);
    assertNlpContext(key, options);
    return result;
  };
  const tokenizeMany = async (texts: string[]): Promise<Token[][]> => {
    const key = nlpExecutionKey(options);
    const result = await tokenizeManyAdmitted(texts);
    assertNlpContext(key, options);
    return result;
  };
  return { tokenize, tokenizeMany };
}

export interface UseDictionaryOptions {
  sourceKey?: WordLookupCandidateOptions['sourceKey'];
  language?: string | (() => string);
  getCanonicalForm?: (word: string) => string;
  getWordVariants?: (word: string) => string[];
  getReadingVariants?: (reading: string) => string[];
  dictionaryTargetLanguage?: string | (() => string | undefined);
  languageData?: LanguageData | null | (() => LanguageData | null);
}

export function buildDictionaryLookupCandidates(
  word: string,
  getCanonicalForm: (word: string) => string = identityWordForm,
  getWordVariants?: (word: string) => string[],
  languageData?: LanguageData | null,
  language?: string,
): string[] {
  return buildWordLookupCandidates(word, getCanonicalForm, getWordVariants, languageData, language);
}

export function buildDictionaryReadingCandidates(
  reading: string,
  getReadingVariants?: (reading: string) => string[],
): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const append = (candidate: string | null | undefined) => {
    const normalized = candidate?.trim() ?? '';
    if (seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push(normalized);
  };

  append(reading);
  for (const candidate of getReadingVariants?.(reading) ?? []) {
    append(candidate);
  }

  return candidates;
}

export function useDictionary(options: UseDictionaryOptions = {}) {
  const lookupAdmitted = async (word: string, reading?: string): Promise<DictionaryEntry[]> => {
    try {
      const language = resolveLanguage(options.language);
      const readingKey = reading || '';
      const languageData = snapshotLanguageData(options.languageData);
      const candidates = buildDictionaryLookupCandidates(
        word,
        options.getCanonicalForm ?? identityWordForm,
        options.getWordVariants,
        languageData,
        language,
      );
      const readingCandidates = buildDictionaryReadingCandidates(readingKey, options.getReadingVariants);
      const dictionaryTargetLanguage = resolveDictionaryTargetLanguage(options.dictionaryTargetLanguage);
      const cacheLanguage = buildVersionedLanguageCacheId(language, languageData, dictionaryTargetLanguage);
      const originalCacheKey = buildDictionaryCacheKey(word, readingKey, cacheLanguage, dictionaryTargetLanguage);

      for (const candidate of candidates) {
        let hasCachedEmptyMiss = false;
        const candidateOriginalReadingCacheKey = buildDictionaryCacheKey(
          candidate,
          readingKey,
          cacheLanguage,
          dictionaryTargetLanguage,
        );
        for (const readingCandidate of readingCandidates) {
          const cacheKey = buildDictionaryCacheKey(candidate, readingCandidate, cacheLanguage, dictionaryTargetLanguage);
          if (dictionaryCache.has(cacheKey)) {
            const cached = dictionaryCache.get(cacheKey)!;
            if (cached.length > 0) {
              if (cacheKey !== originalCacheKey) setDictionaryCache(originalCacheKey, cached);
              return cached;
            }
            hasCachedEmptyMiss = true;
          }

          const dbCached = await getCachedDictionaryScopedDB(
            candidate,
            readingCandidate,
            cacheLanguage,
            dictionaryTargetLanguage,
          );
          if (dbCached !== null) {
            setDictionaryCache(cacheKey, dbCached);
            if (dbCached.length > 0) {
              if (cacheKey !== originalCacheKey) setDictionaryCache(originalCacheKey, dbCached);
              return dbCached;
            }
            hasCachedEmptyMiss = true;
          }
        }
        if (hasCachedEmptyMiss) continue;

        const data = await translateWithDictionaryTarget(
          getBackend(),
          candidate,
          language,
          dictionaryTargetLanguage,
          languageData?.resolvedVariantId,
        );
        if (data.data && Array.isArray(data.data)) {
          const entries: DictionaryEntry[] = [];

          for (const entry of data.data) {
            if (!entry || typeof entry !== 'object') continue;

            const typedEntry = entry as TranslationEntry;
            const meanings = extractDefinitionValues(typedEntry, languageData);
            if (meanings.length > 0) {
              entries.push({
                word: typedEntry.word || candidate,
                reading: extractReadingValue(typedEntry, languageData) || '',
                meanings,
              });
            }
          }

          setDictionaryCache(candidateOriginalReadingCacheKey, entries);
          void setCachedDictionaryScopedDB(
            candidate,
            readingKey,
            entries,
            cacheLanguage,
            dictionaryTargetLanguage,
          );
          if (entries.length > 0) {
            if (candidateOriginalReadingCacheKey !== originalCacheKey) {
              setDictionaryCache(originalCacheKey, entries);
              void setCachedDictionaryScopedDB(
                word,
                readingKey,
                entries,
                cacheLanguage,
                dictionaryTargetLanguage,
              );
            }
            return entries;
          }
        } else {
          setDictionaryCache(candidateOriginalReadingCacheKey, []);
          void setCachedDictionaryScopedDB(
            candidate,
            readingKey,
            [],
            cacheLanguage,
            dictionaryTargetLanguage,
          );
        }
      }

      setDictionaryCache(originalCacheKey, []);
      void setCachedDictionaryScopedDB(
        word,
        readingKey,
        [],
        cacheLanguage,
        dictionaryTargetLanguage,
      );
      return [];
    } catch (e) {
      log.error('Dictionary lookup error:', e);
      throw e;
    }
  };

  const lookup = async (word: string, reading?: string): Promise<DictionaryEntry[]> => {
    const key = nlpExecutionKey(options);
    const result = await lookupAdmitted(word, reading);
    assertNlpContext(key, options);
    return result;
  };
  return { lookup };
}
