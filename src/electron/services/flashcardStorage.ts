/**
 * Flashcard Storage Service
 * Handles persistence and IPC for flashcard data
 */

import fs from 'fs';
import path from 'path';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { createProsodyForPosition, getLanguageProsodyType, registerMappingTable, buildLexemeIndex, buildWordFrequencyMapFromLanguageData, getFrequencyForLexeme, resolveLanguageFrequencyPayload } from '../../shared/languageFeatures';
import { CURRENT_NORMALIZATION_VERSION } from '../../shared/utils/normalizationVersion';
import type { FlashcardStore, WordStats, Flashcard, WordCandidate, FlashcardContent, DailyStudyStats, LanguageData, LanguageDataMap, PassiveWordKnowledge, GrammarKnowledgeEntry, IgnoredWordEntry, SuggestedFlashcard, Settings } from '../../shared/types';
import { canonicalKeyHash } from '../../shared/utils/canonicalWordKey';
import { calculateWordStats } from '../../shared/utils/wordStats';
import { createWordFormDeriver } from '../../shared/utils/wordForms';
import { getUserDataPath } from '../utils/platform';
import { extractBase64Images } from './flashcardImageStorage';
import { loadLangData, loadSettings } from './settings';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger('electron.flashcardStorage');

const CURRENT_VERSION = 3;


let migrationInfo: { occurred: boolean; backupPath: string | null; fromVersion: number | null } = {
  occurred: false,
  backupPath: null,
  fromVersion: null,
};

const DEFAULT_FLASHCARD_STORE: FlashcardStore = {
  flashcards: {},
  wordCandidates: {},
  wordToCardMap: {},
  wordStatsMap: {},
  knownUntracked: {},
  ignoredWords: {},
  wordKnowledge: {},
  grammarKnowledge: {},
  suggestedFlashcards: {},
  meta: {
    perLanguage: {},
    maxNewCardsPerDay: 10,
    maxNewCardsPerDayLearning: 20,
    maxReviewsPerDay: -1,
    learningSteps: [1, 10],
    relearnSteps: [10],
    graduatingInterval: 1,
    easyInterval: 4,
    newIntervalModifier: 100,
    reviewIntervalModifier: 100,
    maxInterval: 36500,
  },
  dailyStats: {},
  version: CURRENT_VERSION,
};

let writeQueue: Promise<void> = Promise.resolve();
function enqueueWrite(fn: () => Promise<void>): Promise<void> {
  writeQueue = writeQueue.then(fn, fn);
  return writeQueue;
}

function getFlashcardsPath(): string {
  return path.join(getUserDataPath(), 'flashcards.json');
}

const languageProsodyMigrationCache = new Map<string, NonNullable<FlashcardContent['prosody']>['type'] | null>();

/**
 * @deprecated Compatibility helper for flashcards created before language packages
 * stored generic prosody payloads. New flashcards should carry `content.prosody`
 * from dictionary/language data directly.
 */
function getInstalledLanguageProsodyType(language: string | undefined): NonNullable<FlashcardContent['prosody']>['type'] | null {
  const normalizedLanguage = language?.trim();
  if (!normalizedLanguage) return null;

  const cached = languageProsodyMigrationCache.get(normalizedLanguage);
  if (cached !== undefined) return cached;

  try {
    const languagePath = path.join(getUserDataPath(), 'language-data', 'languages', `${normalizedLanguage}.json`);
    const data = JSON.parse(fs.readFileSync(languagePath, 'utf-8')) as LanguageData;
    const result = getLanguageProsodyType(data) ?? null;
    languageProsodyMigrationCache.set(normalizedLanguage, result);
    return result;
  } catch {
    return null;
  }
}

/**
 * @deprecated Used only while upgrading legacy `pitchAccent`/`pitchAccentPosition`
 * flashcard payloads into generic `FlashcardContent.prosody`.
 */
function resolveLegacyProsodyMigrationType(
  language: string | undefined,
  legacyProsody: FlashcardContent['prosody'] | undefined,
): NonNullable<FlashcardContent['prosody']>['type'] | undefined {
  return legacyProsody?.type ?? getInstalledLanguageProsodyType(language) ?? undefined;
}

/**
 * @deprecated One-way migration from old Japanese-specific pitch fields to the
 * package-defined generic prosody model. Do not call for newly created cards.
 */
function migrateLegacyFlashcardContent(content: FlashcardContent, language?: string): FlashcardContent {
  const legacyContent = content as FlashcardContent & { pitchAccent?: unknown };
  const legacyPitchAccent = legacyContent.pitchAccent;
  const { pitchAccent: _pitchAccent, ...contentWithoutPitchAccent } = legacyContent;
  const normalized: FlashcardContent = { ...contentWithoutPitchAccent };
  const legacyProsody = normalized.prosody as (FlashcardContent['prosody'] & { pitchAccentPosition?: unknown }) | undefined;
  const legacyProsodyPosition = legacyProsody?.pitchAccentPosition;

  if (legacyProsody && 'pitchAccentPosition' in legacyProsody) {
    const { pitchAccentPosition: _legacyProsodyPosition, ...prosodyWithoutLegacyPosition } = legacyProsody;
    normalized.prosody = prosodyWithoutLegacyPosition;
  }

  const migratedPosition = typeof legacyPitchAccent === 'number' && Number.isFinite(legacyPitchAccent)
    ? legacyPitchAccent
    : typeof legacyProsodyPosition === 'number' && Number.isFinite(legacyProsodyPosition)
      ? legacyProsodyPosition
      : undefined;

  if (
    migratedPosition !== undefined &&
    normalized.prosody?.position === undefined
  ) {
    const migratedProsody = createProsodyForPosition(
      resolveLegacyProsodyMigrationType(language, normalized.prosody),
      migratedPosition,
      normalized.prosody
    );
    if (migratedProsody) normalized.prosody = migratedProsody;
  }

  return normalized;
}

/**
 * @deprecated One-way cleanup for stores that still contain legacy pitch fields.
 * New stores should already persist normalized `FlashcardContent.prosody`.
 */
function migrateLegacyFlashcardStore(store: FlashcardStore): FlashcardStore {
  const flashcards: Record<string, Flashcard> = {};
  for (const [id, card] of Object.entries(store.flashcards)) {
    flashcards[id] = {
      ...card,
      content: migrateLegacyFlashcardContent(card.content, card.language),
    };
  }
  return { ...store, flashcards };
}

function generateWordHashSync(word: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodeCrypto = require('crypto') as typeof import('crypto');
  return nodeCrypto.createHash('sha256').update(Buffer.from(word)).digest('hex');
}

/** Creates a rollback copy before a one-time flashcard data migration. */
function createBackup(originalPath: string, version: number): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = originalPath.replace('.json', `-backup-v${version}-${timestamp}.json`);
  
  if (fs.existsSync(originalPath)) {
    const data = fs.readFileSync(originalPath, 'utf-8');
    fs.writeFileSync(backupPath, data);
    log.info(`Created backup at: ${backupPath}`);
  }
  
  return backupPath;
}

const ZH_VARIANT_PREFIXES = ['zh-Hans:', 'zh-Hant:'] as const;

type ZhMappingTable = { words?: Record<string, string>; chars?: Record<string, string> };

interface ZhMigrationReport {
  timestamp: string;
  migratedKeyCounts: Record<string, number>;
  collisionCounts: Record<string, number>;
  orphanCounts: { knownUntracked: number; };
  loserSnapshots: Array<{ survivorId: string; loser: Flashcard; oldMapKeys: string[] }>;
}

function isLegacyZhKey(key: string): boolean {
  return ZH_VARIANT_PREFIXES.some(prefix => key.startsWith(prefix));
}

function legacyZhSource(key: string, fallback?: string): string | undefined {
  return ZH_VARIANT_PREFIXES.find(prefix => key.startsWith(prefix))?.slice(0, -1)
    ?? (fallback && ZH_VARIANT_PREFIXES.includes(`${fallback}:` as typeof ZH_VARIANT_PREFIXES[number]) ? fallback : undefined);
}

function containsLegacyZhData(store: FlashcardStore): boolean {
  const maps = [
    store.wordToCardMap,
    store.wordStatsMap,
    store.wordKnowledge,
    store.wordCandidates,
    store.knownUntracked,
    store.ignoredWords,
    store.suggestedFlashcards,
    store.grammarKnowledge,
  ];
  return Object.values(store.flashcards).some(card => legacyZhSource('', card.language) !== undefined)
    || maps.some(map => Object.keys(map).some(isLegacyZhKey))
    || Boolean(store.meta.perLanguage['zh-Hans'] || store.meta.perLanguage['zh-Hant'])
    || Object.values(store.dailyStats).some(stats => Boolean(stats['zh-Hans'] || stats['zh-Hant']));
}

function loadZhMigrationPackage(): LanguageData | null {
  try {
    const languagesDir = path.join(getUserDataPath(), 'language-data', 'languages');
    const metadata = JSON.parse(fs.readFileSync(path.join(languagesDir, 'zh.json'), 'utf-8')) as LanguageData;
    const table = JSON.parse(fs.readFileSync(path.join(languagesDir, 'zh.t2s.json'), 'utf-8')) as ZhMappingTable;
    registerMappingTable('zh', { words: table.words ?? {}, chars: table.chars ?? {} });
    return metadata;
  } catch (error) {
    log.warn('[flashcardStorage] Deferring zh variant merge until languages/zh.json and languages/zh.t2s.json are installed:', error);
    return null;
  }
}

function mergeCards(a: Flashcard, b: Flashcard): { survivor: Flashcard; loser: Flashcard } {
  const aReviewed = a.lastReviewed || 0;
  const bReviewed = b.lastReviewed || 0;
  const survivor = aReviewed !== bReviewed
    ? (aReviewed > bReviewed ? a : b)
    : a.reviews !== b.reviews
      ? (a.reviews > b.reviews ? a : b)
      : (a.id < b.id ? a : b);
  const loser = survivor === a ? b : a;
  return {
    survivor: {
      ...survivor,
      language: 'zh',
      dueDate: Math.min(a.dueDate, b.dueDate),
      lastReviewed: Math.max(aReviewed, bReviewed),
      createdAt: Math.min(a.createdAt, b.createdAt),
      lastUpdated: Date.now(),
      reviews: a.reviews + b.reviews,
      lapses: a.lapses + b.lapses,
      tags: [...new Set([...(a.tags ?? []), ...(b.tags ?? [])])],
      suspended: Boolean(a.suspended || b.suspended),
    },
    loser,
  };
}

/**
 * Merges two script-form entries of one word identity. Per-form WrittenForm
 * sub-skill snapshots are no longer GENERATED (the per-access overlay owns
 * recognition semantics) — existing `forms` provenance from older stores is
 * carried through untouched so stored user data survives merges.
 */
function mergeWordKnowledge(a: PassiveWordKnowledge, b: PassiveWordKnowledge): PassiveWordKnowledge {
  const winner = (b.lastStatusChange ?? 0) > (a.lastStatusChange ?? 0) ? b : a;
  // Legacy per-form provenance carries through only when it actually exists —
  // no empty snapshots are manufactured.
  const forms = { ...a.forms, ...b.forms };
  return {
    ...winner,
    language: 'zh',
    lastSeen: Math.max(a.lastSeen, b.lastSeen),
    timesSeen: a.timesSeen + b.timesSeen,
    timesHovered: a.timesHovered + b.timesHovered,
    ...(Object.keys(forms).length > 0 ? { forms } : {}),
  };
}

function canonicalZhKey(word: string, metadata: LanguageData): string {
  return canonicalKeyHash('zh', word, {
    hashWord: generateWordHashSync,
    languageData: metadata,
    legacyLanguageCodes: Object.fromEntries((metadata.legacyCodes ?? []).map(code => [code, 'zh'])),
  });
}

function collectZhCorpus(store: FlashcardStore, metadata: LanguageData): Map<string, string> {
  const corpus = new Map<string, string>();
  const add = (word: string | undefined, source?: string) => {
    if (!word) return;
    const sources = source && legacyZhSource('', source) ? [source] : ['zh-Hans', 'zh-Hant'];
    for (const language of sources) corpus.set(`${language}:${generateWordHashSync(word)}`, canonicalZhKey(word, metadata));
  };
  for (const card of Object.values(store.flashcards)) add(card.content.front, card.language);
  for (const [key, entry] of Object.entries(store.wordKnowledge)) add(entry.word, legacyZhSource(key, entry.language));
  for (const [key, entry] of Object.entries(store.wordCandidates)) add(entry.word, legacyZhSource(key, entry.language));
  for (const [key, entry] of Object.entries(store.suggestedFlashcards)) add(entry.word, legacyZhSource(key, entry.language));
  for (const [key, entry] of Object.entries(store.ignoredWords)) add(entry.word, legacyZhSource(key, entry.language));
  for (const [key, entry] of Object.entries(store.grammarKnowledge)) add(entry.pattern, legacyZhSource(key, entry.language));
  return corpus;
}

function migrateV2ToV3(store: FlashcardStore, metadata: LanguageData, backupPath: string): FlashcardStore {
  const report: ZhMigrationReport = {
    timestamp: new Date().toISOString(),
    migratedKeyCounts: {},
    collisionCounts: {},
    orphanCounts: { knownUntracked: 0, },
    loserSnapshots: [],
  };
  const count = (map: string) => { report.migratedKeyCounts[map] = (report.migratedKeyCounts[map] ?? 0) + 1; };
  const collision = (map: string) => { report.collisionCounts[map] = (report.collisionCounts[map] ?? 0) + 1; };
  const oldMapKeysFor = (id: string) => Object.entries(store.wordToCardMap)
    .filter(([, ids]) => Array.isArray(ids) ? ids.includes(id) : ids === id)
    .map(([key]) => key);

  const flashcards: Record<string, Flashcard> = {};
  const zhCardsByKey = new Map<string, Flashcard>();
  for (const card of Object.values(store.flashcards)) {
    if (!legacyZhSource('', card.language)) {
      flashcards[card.id] = card;
      continue;
    }
    const key = canonicalZhKey(card.content.front, metadata);
    const normalized = { ...card, language: 'zh' };
    const existing = zhCardsByKey.get(key);
    if (!existing) {
      zhCardsByKey.set(key, normalized);
      continue;
    }
    const { survivor, loser } = mergeCards(existing, normalized);
    zhCardsByKey.set(key, survivor);
    report.loserSnapshots.push({ survivorId: survivor.id, loser: store.flashcards[loser.id], oldMapKeys: [...oldMapKeysFor(existing.id), ...oldMapKeysFor(normalized.id)] });
    collision('flashcards');
  }
  for (const card of zhCardsByKey.values()) flashcards[card.id] = card;

  const migrateKeyed = <T>(map: Record<string, T>, name: string, wordFor: (entry: T) => string | undefined, transform: (entry: T) => T, merge: (a: T, b: T) => T): Record<string, T> => {
    const result: Record<string, T> = {};
    for (const [key, entry] of Object.entries(map)) {
      if (!isLegacyZhKey(key)) {
        result[key] = entry;
        continue;
      }
      const word = wordFor(entry);
      if (!word) continue;
      const canonical = canonicalZhKey(word, metadata);
      const normalized = transform(entry);
      if (result[canonical]) {
        result[canonical] = merge(result[canonical], normalized);
        collision(name);
      } else result[canonical] = normalized;
      count(name);
    }
    return result;
  };

  const wordKnowledge = migrateKeyed(store.wordKnowledge, 'wordKnowledge', entry => entry.word, entry => ({ ...entry, language: 'zh' }), (a, b) => mergeWordKnowledge(a, b));
  const wordCandidates = migrateKeyed(store.wordCandidates, 'wordCandidates', entry => entry.word, entry => ({ ...entry, language: 'zh' }), (a, b) => ({ ...((b.lastSeen > a.lastSeen) ? b : a), count: a.count + b.count, lastSeen: Math.max(a.lastSeen, b.lastSeen) }));
  const ignoredWords = migrateKeyed(store.ignoredWords, 'ignoredWords', entry => entry.word, entry => ({ ...entry, language: 'zh' }), (a, b) => a.ignoredAt <= b.ignoredAt ? a : b);
  const suggestedFlashcards = migrateKeyed(store.suggestedFlashcards, 'suggestedFlashcards', entry => entry.word, entry => ({ ...entry, language: 'zh' }), (a, b) => {
    const richer = a.imageUrl && !b.imageUrl ? a : b.imageUrl && !a.imageUrl ? b : (a.lastSeen >= b.lastSeen ? a : b);
    return { ...richer, count: a.count + b.count, lastSeen: Math.max(a.lastSeen, b.lastSeen) };
  });
  const grammarKnowledge = migrateKeyed(store.grammarKnowledge, 'grammarKnowledge', entry => entry.pattern, entry => ({ ...entry, language: 'zh' }), (a, b): GrammarKnowledgeEntry => ({ ...((a.lastSeen >= b.lastSeen) ? a : b), ease: Math.max(a.ease, b.ease), timesEncountered: a.timesEncountered + b.timesEncountered, timesFailed: a.timesFailed + b.timesFailed, lastSeen: Math.max(a.lastSeen, b.lastSeen), language: 'zh' }));

  const corpus = collectZhCorpus(store, metadata);
  const migrateInverted = <T>(map: Record<string, T>, name: 'knownUntracked', merge: (a: T, b: T) => T): Record<string, T> => {
    const result: Record<string, T> = {};
    for (const [key, value] of Object.entries(map)) {
      if (!isLegacyZhKey(key)) {
        result[key] = value;
        continue;
      }
      const canonical = corpus.get(key);
      const nextKey = canonical ?? `zh:${key.slice(key.indexOf(':') + 1)}`;
      if (!canonical) report.orphanCounts[name] += 1;
      result[nextKey] = result[nextKey] === undefined ? value : merge(result[nextKey], value);
      count(name);
    }
    return result;
  };
  const knownUntracked = migrateInverted(store.knownUntracked, 'knownUntracked', (a, b) => Boolean(a || b));

  const meta = { ...store.meta, perLanguage: { ...store.meta.perLanguage } };
  const hansMeta = meta.perLanguage['zh-Hans'];
  const hantMeta = meta.perLanguage['zh-Hant'];
  if (hansMeta || hantMeta) {
    const newest = !hantMeta || (hansMeta && hansMeta.newCardsDate >= hantMeta.newCardsDate) ? hansMeta! : hantMeta;
    meta.perLanguage.zh = hansMeta && hantMeta && hansMeta.newCardsDate === hantMeta.newCardsDate
      ? { newCardsDate: hansMeta.newCardsDate, newCardsToday: hansMeta.newCardsToday + hantMeta.newCardsToday, reviewsToday: hansMeta.reviewsToday + hantMeta.reviewsToday }
      : newest;
    delete meta.perLanguage['zh-Hans'];
    delete meta.perLanguage['zh-Hant'];
    count('meta.perLanguage');
  }

  const dailyStats: Record<string, Record<string, DailyStudyStats>> = {};
  for (const [date, languages] of Object.entries(store.dailyStats)) {
    const next = { ...languages };
    const hans = next['zh-Hans'];
    const hant = next['zh-Hant'];
    if (hans || hant) {
      const left = hans ?? hant!;
      const right = hant ?? hans!;
      next.zh = { date: left.date, newCardsStudied: left.newCardsStudied + right.newCardsStudied, reviewCardsStudied: left.reviewCardsStudied + right.reviewCardsStudied, lapses: left.lapses + right.lapses, timeSpent: left.timeSpent + right.timeSpent, graduated: left.graduated + right.graduated };
      delete next['zh-Hans'];
      delete next['zh-Hant'];
      count('dailyStats');
    }
    dailyStats[date] = next;
  }

  const wordToCardMap: Record<string, string[]> = {};
  for (const [key, ids] of Object.entries(store.wordToCardMap)) if (!isLegacyZhKey(key)) wordToCardMap[key] = Array.isArray(ids) ? ids.filter(id => flashcards[id]) : [ids].filter(id => flashcards[id]);
  for (const card of Object.values(flashcards)) if (card.language === 'zh') {
    const key = canonicalZhKey(card.content.front, metadata);
    if (!wordToCardMap[key]) wordToCardMap[key] = [];
    wordToCardMap[key].push(card.id);
  }
  const wordStatsMap: Record<string, WordStats> = {};
  for (const [key, ids] of Object.entries(wordToCardMap)) wordStatsMap[key] = calculateWordStats(ids.map(id => flashcards[id]).filter((card): card is Flashcard => Boolean(card)));

  const migrated: FlashcardStore = { ...store, flashcards, wordToCardMap, wordStatsMap, wordKnowledge, wordCandidates, knownUntracked, ignoredWords, suggestedFlashcards, grammarKnowledge, meta, dailyStats, version: CURRENT_VERSION };
  fs.writeFileSync(path.join(path.dirname(backupPath), 'flashcards.zh-variant-merge-report.json'), JSON.stringify(report, null, 2));
  migrationInfo = { occurred: true, backupPath, fromVersion: 2 };
  return migrated;
}

function isValidFlashcardStore(value: unknown): value is FlashcardStore {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    'flashcards' in v && typeof v.flashcards === 'object' && v.flashcards !== null &&
    typeof v.version === 'number'
  );
}

/**
 * Idempotent repair: stamp `content.level` on flashcards that lack it, using
 * the installed language frequency data (identical resolution to the
 * renderer's word-level lookups). Runs on every load; skips words that don't
 * resolve so it self-heals when language data is installed later.
 */
function backfillMissingFlashcardLevels(store: FlashcardStore): FlashcardStore {
  const levelLess = Object.values(store.flashcards).filter((card) => card.content?.level === undefined);
  if (levelLess.length === 0) return store;

  const langData = loadLangData();
  if (!langData) return store;

  const byLanguage = new Map<string, Flashcard[]>();
  for (const card of levelLess) {
    if (!card.language) continue;
    const bucket = byLanguage.get(card.language);
    if (bucket) bucket.push(card);
    else byLanguage.set(card.language, [card]);
  }

  const updated: Record<string, Flashcard> = {};
  for (const [lang, cards] of byLanguage) {
    const data = langData[lang];
    if (!data) continue;
    const { rows, languageData: effective } = resolveLanguageFrequencyPayload(data);
    if (rows.length === 0) continue;
    const freqMap = buildWordFrequencyMapFromLanguageData(effective);
    const lexemeIndex = buildLexemeIndex(rows, effective, lang);
    for (const card of cards) {
      const word = card.content?.word ?? card.content?.front;
      if (!word) continue;
      const entry = getFrequencyForLexeme(word, freqMap, lexemeIndex, effective, lang);
      if (entry && typeof entry.raw_level === 'number') {
        updated[card.id] = { ...card, content: { ...card.content, level: entry.raw_level } };
      }
    }
  }

  if (Object.keys(updated).length === 0) return store;
  return { ...store, flashcards: { ...store.flashcards, ...updated } };
}

/**
 * Key derivation for one legacy record: the language comes from the record
 * when present, else from the legacy `lang:hash` key prefix. Returns null for
 * key-only records (no recoverable raw surface) — those keep their legacy key.
 */
function deriveRecordKey(
  deriverFor: (language: string) => ((word: string) => string) | null,
  langData: LanguageDataMap,
  language: string | undefined,
  word: string | undefined,
  legacyKey: string,
): string | null {
  const lang = (language?.trim() || legacyKey.split(':')[0] || '').trim();
  const raw = word?.trim();
  if (!lang || !raw) return null;
  const deriver = deriverFor(lang);
  const primary = deriver ? deriver(raw) : raw;
  // Package script conversion is part of word identity — the same fold
  // canonicalKeyHash applies for the zh variant migration and sync merge.
  return canonicalKeyHash(lang, primary, {
    hashWord: generateWordHashSync,
    languageData: langData[lang],
  });
}

/**
 * D3 (normalization-version migration): persisted, key-derived records were
 * minted under v1 semantics, where package-declared casing steps used the
 * AMBIENT host locale — the same word could hash differently per machine.
 * Creation hashes the metadata-aware PRIMARY word form (shared
 * getWordFormCandidates[0], script-conversion folded), never a bare raw-front
 * hash, so rebuilds reproduce the shared derivation from raw source fields.
 *
 * Source-backed records (cards, word knowledge, ignores, candidates,
 * suggestions — all carry a raw word) rebuild under v2 keys. Key-only records
 * (knownUntracked, knowledge/ignore rows without a raw word)
 * are NOT recoverable and keep their legacy keys verbatim; reads salvage them
 * lazily via legacyCasingCandidates when a raw surface becomes available.
 * Future versions (stored > current) are never downgraded. Idempotent: the
 * version stamp is written once the rebuild completes.
 */
function rebuildKeyedRecordsForNormalization(store: FlashcardStore): FlashcardStore {
  const storedVersion = store.meta?.normalizationVersion;
  if (storedVersion !== undefined && storedVersion >= CURRENT_NORMALIZATION_VERSION) return store;

  const langData = loadLangData() || {};
  let settings: Settings | null = null;
  try {
    settings = loadSettings();
  } catch {
    settings = null;
  }

  const deriverCache = new Map<string, (word: string) => string>();
  const deriverFor = (language: string): ((word: string) => string) | null => {
    const cached = deriverCache.get(language);
    if (cached) return cached;
    const data = langData[language];
    if (!data) return null;
    const deriver = createWordFormDeriver(
      data,
      language,
      settings?.frequencyProviderSelections?.[language],
      settings?.frequencyLevelSystemSelections?.[language],
    );
    deriverCache.set(language, deriver);
    return deriver;
  };

  // Source of truth: cards. Cards without a derivable (language, front) keep
  // their legacy map entries below.
  const wordToCardMap: Record<string, string[]> = {};
  const derivable = new Set<string>();
  for (const card of Object.values(store.flashcards)) {
    const key = deriveRecordKey(deriverFor, langData, card.language, card.content?.front, '');
    if (!key) continue;
    derivable.add(card.id);
    const bucket = wordToCardMap[key];
    if (bucket) {
      if (!bucket.includes(card.id)) bucket.push(card.id);
    } else {
      wordToCardMap[key] = [card.id];
    }
  }
  for (const [legacyKey, ids] of Object.entries(store.wordToCardMap || {})) {
    for (const id of Array.isArray(ids) ? ids : [ids as unknown as string]) {
      if (derivable.has(id)) continue;
      const bucket = wordToCardMap[legacyKey];
      if (bucket) {
        if (!bucket.includes(id)) bucket.push(id);
      } else {
        wordToCardMap[legacyKey] = [id];
      }
    }
  }

  const wordStatsMap: Record<string, WordStats> = {};
  for (const [key, ids] of Object.entries(wordToCardMap)) {
    const cards = ids.map((id) => store.flashcards[id]).filter((card): card is Flashcard => Boolean(card));
    if (cards.length > 0) wordStatsMap[key] = calculateWordStats(cards);
  }

  // Knowledge rows: rebuild by recency when two legacy spellings collapse.
  const wordKnowledge: Record<string, PassiveWordKnowledge> = {};
  const knowledgeWinnerKeys = new Map<string, string>();
  for (const [legacyKey, entry] of Object.entries(store.wordKnowledge || {})) {
    if (!entry) continue;
    const key = deriveRecordKey(deriverFor, langData, entry.language, entry.word, legacyKey);
    if (!key) {
      wordKnowledge[legacyKey] = entry;
      continue;
    }
    const prevOldKey = knowledgeWinnerKeys.get(key);
    if (prevOldKey === undefined) {
      wordKnowledge[key] = entry;
      knowledgeWinnerKeys.set(key, legacyKey);
    } else {
      const prev = wordKnowledge[key];
      if (
        (entry.lastSeen || 0) > (prev.lastSeen || 0)
        || ((entry.lastSeen || 0) === (prev.lastSeen || 0) && legacyKey < prevOldKey)
      ) {
        wordKnowledge[key] = entry;
        knowledgeWinnerKeys.set(key, legacyKey);
      }
    }
  }

  const ignoredWords: Record<string, IgnoredWordEntry> = {};
  const ignoredWinnerKeys = new Map<string, string>();
  for (const [legacyKey, entry] of Object.entries(store.ignoredWords || {})) {
    if (!entry) continue;
    const key = deriveRecordKey(deriverFor, langData, entry.language, entry.word, legacyKey);
    if (!key) {
      ignoredWords[legacyKey] = entry;
      continue;
    }
    const prevOldKey = ignoredWinnerKeys.get(key);
    if (prevOldKey === undefined) {
      ignoredWords[key] = entry;
      ignoredWinnerKeys.set(key, legacyKey);
    } else {
      const prev = ignoredWords[key];
      if (
        (entry.ignoredAt || 0) > (prev.ignoredAt || 0)
        || ((entry.ignoredAt || 0) === (prev.ignoredAt || 0) && legacyKey < prevOldKey)
      ) {
        ignoredWords[key] = entry;
        ignoredWinnerKeys.set(key, legacyKey);
      }
    }
  }

  const wordCandidates: Record<string, WordCandidate> = {};
  for (const [legacyKey, candidate] of Object.entries(store.wordCandidates || {})) {
    if (!candidate) continue;
    const key = deriveRecordKey(deriverFor, langData, candidate.language, candidate.word, legacyKey);
    if (!key) {
      wordCandidates[legacyKey] = candidate;
      continue;
    }
    const prev = wordCandidates[key];
    if (!prev) {
      wordCandidates[key] = candidate;
      continue;
    }
    const winner = (candidate.lastSeen || 0) >= (prev.lastSeen || 0) ? candidate : prev;
    wordCandidates[key] = {
      ...winner,
      count: (prev.count || 0) + (candidate.count || 0),
      lastSeen: Math.max(prev.lastSeen || 0, candidate.lastSeen || 0),
    };
  }

  const suggestedFlashcards: Record<string, SuggestedFlashcard> = {};
  const suggestionWinnerKeys = new Map<string, string>();
  for (const [legacyKey, suggestion] of Object.entries(store.suggestedFlashcards || {})) {
    if (!suggestion) continue;
    const key = deriveRecordKey(deriverFor, langData, suggestion.language, suggestion.word, legacyKey);
    if (!key) {
      suggestedFlashcards[legacyKey] = suggestion;
      continue;
    }
    const prevOldKey = suggestionWinnerKeys.get(key);
    if (prevOldKey === undefined) {
      suggestedFlashcards[key] = suggestion;
      suggestionWinnerKeys.set(key, legacyKey);
    } else {
      const prev = suggestedFlashcards[key];
      if (
        (suggestion.lastSeen || 0) > (prev.lastSeen || 0)
        || ((suggestion.lastSeen || 0) === (prev.lastSeen || 0) && legacyKey < prevOldKey)
      ) {
        suggestedFlashcards[key] = suggestion;
        suggestionWinnerKeys.set(key, legacyKey);
      }
    }
  }

  log.info(`[flashcardStorage] Rebuilt keyed records to normalization version ${CURRENT_NORMALIZATION_VERSION} (stored: ${storedVersion ?? 'absent'})`);
  return {
    ...store,
    wordToCardMap,
    wordStatsMap,
    wordKnowledge,
    ignoredWords,
    wordCandidates,
    suggestedFlashcards,
    // knownUntracked / grammarKnowledge: key-only or
    // pattern-addressed — preserved verbatim in their legacy namespace.
    meta: { ...store.meta, normalizationVersion: CURRENT_NORMALIZATION_VERSION },
  };
}

function finalizeStore(store: FlashcardStore): FlashcardStore {
  const withLevels = backfillMissingFlashcardLevels(migrateLegacyFlashcardStore(store));
  return rebuildKeyedRecordsForNormalization(withLevels);
}


function checkFlashcards(fc_to_check: any): FlashcardStore {
  if (!isValidFlashcardStore(fc_to_check)) {
    log.warn('[flashcardStorage] Loaded store has unexpected structure — using defaults');
    return { ...DEFAULT_FLASHCARD_STORE };
  }

  if (fc_to_check.version < CURRENT_VERSION && containsLegacyZhData(fc_to_check)) {
    const zhMetadata = loadZhMigrationPackage();
    if (!zhMetadata) return fc_to_check;
    const backupPath = createBackup(getFlashcardsPath(), 2);
    return finalizeStore(migrateV2ToV3(fc_to_check, zhMetadata, backupPath));
  }

  const result: FlashcardStore = {
    flashcards: fc_to_check.flashcards || {},
    wordCandidates: fc_to_check.wordCandidates || {},
    wordToCardMap: fc_to_check.wordToCardMap || {},
    wordStatsMap: fc_to_check.wordStatsMap || {},
    knownUntracked: fc_to_check.knownUntracked || {},
    ignoredWords: fc_to_check.ignoredWords || {},
    wordKnowledge: fc_to_check.wordKnowledge || {},
    grammarKnowledge: fc_to_check.grammarKnowledge || {},
    suggestedFlashcards: fc_to_check.suggestedFlashcards || {},
    meta: { ...DEFAULT_FLASHCARD_STORE.meta, ...fc_to_check.meta },
    dailyStats: fc_to_check.dailyStats || {},
    version: fc_to_check.version < CURRENT_VERSION ? CURRENT_VERSION : fc_to_check.version,
    rev: fc_to_check.rev,
  };

  return finalizeStore(result);
}

/**
 * Mutation-owned in-memory store. Reads are pure memory: before this, every
 * knowledge projection, window-focus sync, and tethered read re-read,
 * re-parsed, and double-stringified the full store — seconds of main-thread
 * churn per word hover and the OOM when the Word DB list scrolled. Mutations
 * (saveFlashcards, and migrations/sync merges that save through it) update
 * the cache as part of the mutation; reads never pay I/O. Direct disk writes
 * that bypass this module (tests, exceptional external edits) must call
 * invalidateFlashcardsCache() — per-read mtime watching would put I/O back
 * on the read path. The cached object is shared read-only between mutations.
 */
let cachedStore: FlashcardStore | undefined;
let cachedStorePath: string | undefined;
let inflightLoad: Promise<FlashcardStore> | undefined;

export function invalidateFlashcardsCache(): void {
  cachedStore = undefined;
  cachedStorePath = undefined;
}

export async function loadFlashcards(): Promise<FlashcardStore> {
  const filePath = getFlashcardsPath();
  if (cachedStore && cachedStorePath === filePath) return cachedStore;
  if (inflightLoad) return inflightLoad;
  const load = loadFlashcardsFromDisk(filePath).finally(() => {
    if (inflightLoad === load) inflightLoad = undefined;
  });
  inflightLoad = load;
  return load;
}

async function loadFlashcardsFromDisk(filePath: string): Promise<FlashcardStore> {
  try {
    try {
      await fs.promises.access(filePath);
    } catch (e) {
      log.error("error", e);
      const empty = { ...DEFAULT_FLASHCARD_STORE };
      cachedStore = empty;
      cachedStorePath = filePath;
      return empty;
    }
    const data = await fs.promises.readFile(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(data);
    const parsedJson = JSON.stringify(parsed);

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      log.warn('[flashcardStorage] Loaded JSON is not a plain object — using defaults');
      const empty = { ...DEFAULT_FLASHCARD_STORE };
      cachedStore = empty;
      cachedStorePath = filePath;
      return empty;
    }

    const store = checkFlashcards(parsed);
    const storeJson = JSON.stringify(store);

    if (storeJson !== parsedJson) {
      await saveFlashcards(store);
    }

    if (extractBase64Images(store)) {
      await saveFlashcards(store);
    }

    cachedStore = store;
    cachedStorePath = filePath;
    return store;
  } catch (error) {
    log.error('Failed to load flashcards:', error);
  }
  return { ...DEFAULT_FLASHCARD_STORE };
}

export async function saveFlashcards(store: FlashcardStore): Promise<void> {
  return enqueueWrite(async () => {
    // Monotonic store revision: every persisted write invalidates older
    // client snapshots so the sync server can reject them with HTTP 409.
    store.rev = (store.rev ?? 0) + 1;
    extractBase64Images(store);
    // Mutation-owned cache: the in-memory store becomes this object even if
    // the disk write fails — renderer state stays authoritative and the next
    // mutation retries persistence.
    cachedStore = store;
    cachedStorePath = getFlashcardsPath();
    try {
      const filePath = getFlashcardsPath();
      const tmpPath = `${filePath}.tmp`;
      const dir = path.dirname(filePath);
      try {
        await fs.promises.access(dir);
      } catch (e) {
        log.error("error", e);
        await fs.promises.mkdir(dir, { recursive: true });
      }
      await fs.promises.writeFile(tmpPath, JSON.stringify(store, null, 2));
      await fs.promises.rename(tmpPath, filePath);
    } catch (error) {
      log.error('Failed to save flashcards:', error);
    }
  });
}

export async function getFlashcardEaseMap(): Promise<Record<string, number>> {
  const store = await loadFlashcards();
  const map: Record<string, number> = {};
  
  for (const [, flashcard] of Object.entries(store.flashcards)) {
    if (flashcard.content?.front) {
      map[flashcard.content.front] = flashcard.ease;
    }
  }

  return map;
}

export function setupFlashcardIPC(): void {
  ipcMain.on(IPC_CHANNELS.GET_FLASHCARDS, async (event, knownRev?: number) => {
    const flashcards = await loadFlashcards();
    // Focus/visibility sync: an unchanged rev skips the multi-MB store ship.
    // The renderer treats a null payload as "nothing to reconcile".
    const unchanged = knownRev != null && knownRev === (flashcards.rev ?? 0);
    event.reply(IPC_CHANNELS.FLASHCARDS_LOADED, unchanged ? null : flashcards);

    if (migrationInfo.occurred) {
      event.reply(IPC_CHANNELS.FLASHCARD_MIGRATION_COMPLETE, migrationInfo);
      migrationInfo = { occurred: false, backupPath: null, fromVersion: null };
    }
  });

  ipcMain.on(IPC_CHANNELS.SAVE_FLASHCARDS, (_event, store: FlashcardStore) => {
    void saveFlashcards(store);
  });

}
