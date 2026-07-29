/**
 * Flashcard Storage Service
 * Handles persistence and IPC for flashcard data
 */

import fs from 'fs';
import path from 'path';
import { ipcMain } from 'electron';
import { IPC_CHANNELS, SRS_EASE } from '../../shared/constants';
import type { FlashcardStore, WordStats, Flashcard, FlashcardState, WordCandidate, FlashcardContent, DailyStudyStats, LanguageData, PassiveWordKnowledge, GrammarKnowledgeEntry } from '../../shared/types';
import { createProsodyForPosition, getLanguageProsodyType, registerMappingTable } from '../../shared/languageFeatures';
import { calculateWordStats } from '../../shared/utils/wordStats';
import { canonicalKeyHash } from '../../shared/utils/canonicalWordKey';
import { getUserDataPath } from '../utils/platform';
import { extractBase64Images } from './flashcardImageStorage';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger('electron.flashcardStorage');

const CURRENT_VERSION = 3;

function getTodayDateString(): string {
  return new Date().toISOString().split('T')[0];
}

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
  wordSyncSeen: {},
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

function getSettingsPath(): string {
  return path.join(getUserDataPath(), 'settings.json');
}

function inferSingleInstalledLanguage(): string {
  const languagesDir = path.join(getUserDataPath(), 'language-data', 'languages');
  if (!fs.existsSync(languagesDir)) return '';

  try {
    const languageCodes = fs.readdirSync(languagesDir)
      .filter((file) => file.endsWith('.json') && !file.endsWith('.freq.json'))
      .map((file) => path.basename(file, '.json'))
      .sort();
    return languageCodes.length === 1 ? languageCodes[0] : '';
  } catch (error) {
    log.warn('[flashcardStorage] Failed to infer installed language for flashcard migration:', error);
    return '';
  }
}

function resolveMigrationDefaultLanguage(): string {
  try {
    const settingsPath = getSettingsPath();
    if (fs.existsSync(settingsPath)) {
      const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const language = (parsed as { language?: unknown }).language;
        if (typeof language === 'string' && language.trim()) {
          return language.trim();
        }
      }
    }
  } catch (error) {
    log.warn('[flashcardStorage] Failed to read settings language for flashcard migration:', error);
  }

  return inferSingleInstalledLanguage();
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

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function generateWordHashSync(word: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodeCrypto = require('crypto') as typeof import('crypto');
  return nodeCrypto.createHash('sha256').update(Buffer.from(word)).digest('hex');
}

function isSha256Hex(key: string): boolean {
  return /^[0-9a-f]{64}$/.test(key);
}

function migrateV4ToV5(store: FlashcardStore): FlashcardStore {
  log.info('[flashcardStorage] Migrating store from v4 to v5 (canonical SHA-256 keys)...');

  const newWordToCardMap: Record<string, string[]> = {};
  const newWordStatsMap: Record<string, WordStats> = {};
  const newWordCandidates = { ...store.wordCandidates };
  const newWordKnowledge = { ...store.wordKnowledge };
  const newKnownUntracked = { ...store.knownUntracked };
  const newIgnoredWords = { ...store.ignoredWords };

  for (const [oldKey, cardIds] of Object.entries(store.wordToCardMap)) {
    if (isSha256Hex(oldKey)) {
      newWordToCardMap[oldKey] = cardIds;
      continue;
    }
    const firstCard = cardIds.map(id => store.flashcards[id]).find(c => c?.content?.front);
    if (firstCard) {
      const newKey = generateWordHashSync(firstCard.content.front);
      const existing = newWordToCardMap[newKey];
      newWordToCardMap[newKey] = existing ? [...new Set([...existing, ...cardIds])] : cardIds;
    }
    // Legacy key with no recoverable word text: cards remain accessible by their UUID
  }

  for (const [wordKey, cardIds] of Object.entries(newWordToCardMap)) {
    const cards = cardIds.map(id => store.flashcards[id]).filter(Boolean);
    newWordStatsMap[wordKey] = calculateWordStats(cards);
  }

  for (const [oldKey, candidate] of Object.entries(store.wordCandidates)) {
    if (isSha256Hex(oldKey)) continue;
    if (candidate.word) {
      const newKey = generateWordHashSync(candidate.word);
      if (!newWordCandidates[newKey]) newWordCandidates[newKey] = candidate;
      delete newWordCandidates[oldKey];
    } else {
      delete newWordCandidates[oldKey];
    }
  }

  for (const [oldKey, entry] of Object.entries(store.wordKnowledge)) {
    const hash = oldKey.includes(':') ? oldKey.split(':')[1] : oldKey;
    if (isSha256Hex(hash)) continue;
    const lang = entry.language ?? (oldKey.includes(':') ? oldKey.split(':')[0] : '');
    if (entry.word) {
      const newKey = lang ? `${lang}:${generateWordHashSync(entry.word)}` : generateWordHashSync(entry.word);
      if (!newWordKnowledge[newKey]) newWordKnowledge[newKey] = entry;
      delete newWordKnowledge[oldKey];
    } else {
      delete newWordKnowledge[oldKey];
    }
  }

  // knownUntracked has no embedded word text — recover from co-located ignoredWords/wordKnowledge entries
  for (const [oldKey, value] of Object.entries(store.knownUntracked)) {
    const hash = oldKey.includes(':') ? oldKey.split(':')[1] : oldKey;
    if (isSha256Hex(hash)) continue;
    const word = store.ignoredWords[oldKey]?.word ?? store.wordKnowledge[oldKey]?.word;
    if (word) {
      const lang = oldKey.includes(':') ? oldKey.split(':')[0] : (store.ignoredWords[oldKey]?.language ?? '');
      const newKey = lang ? `${lang}:${generateWordHashSync(word)}` : generateWordHashSync(word);
      if (!(newKey in newKnownUntracked)) newKnownUntracked[newKey] = value;
      delete newKnownUntracked[oldKey];
    } else {
      delete newKnownUntracked[oldKey];
    }
  }

  for (const [oldKey, entry] of Object.entries(store.ignoredWords)) {
    const hash = oldKey.includes(':') ? oldKey.split(':')[1] : oldKey;
    if (isSha256Hex(hash)) continue;
    if (entry.word) {
      const lang = entry.language ?? (oldKey.includes(':') ? oldKey.split(':')[0] : '');
      const newKey = lang ? `${lang}:${generateWordHashSync(entry.word)}` : generateWordHashSync(entry.word);
      if (!newIgnoredWords[newKey]) newIgnoredWords[newKey] = entry;
      delete newIgnoredWords[oldKey];
    } else {
      delete newIgnoredWords[oldKey];
    }
  }

  const migrated: FlashcardStore = {
    ...store,
    wordToCardMap: newWordToCardMap,
    wordStatsMap: newWordStatsMap,
    wordCandidates: newWordCandidates,
    wordKnowledge: newWordKnowledge,
    knownUntracked: newKnownUntracked,
    ignoredWords: newIgnoredWords,
    version: 5,
  };

  const upgradedCount =
    Object.keys(store.wordToCardMap).filter(k => !isSha256Hex(k)).length +
    Object.keys(store.wordKnowledge).filter(k => !isSha256Hex(k.includes(':') ? k.split(':')[1] : k)).length;
  log.info(`[flashcardStorage] v4→v5: re-hashed ${upgradedCount} legacy keys`);

  return { ...migrated, version: CURRENT_VERSION };
}

function migrateV6ToV7(store: FlashcardStore, defaultLanguage: string): FlashcardStore {
  log.info('[flashcardStorage] Migrating store from v6 to v7 (per-language meta and dailyStats)...');

  const meta = { ...store.meta };
  if (!meta.perLanguage || Object.keys(meta.perLanguage).length === 0) {
    meta.perLanguage = defaultLanguage
      ? {
          [defaultLanguage]: {
            newCardsToday: (meta as any).newCardsToday ?? 0,
            reviewsToday: (meta as any).reviewsToday ?? 0,
            newCardsDate: (meta as any).newCardsDate ?? getTodayDateString(),
          }
        }
      : {};
  }

  const dailyStats: Record<string, Record<string, DailyStudyStats>> = {};
  for (const [date, stat] of Object.entries((store.dailyStats as any) || {})) {
    if (stat && typeof stat === 'object' && 'newCardsStudied' in stat) {
      dailyStats[date] = defaultLanguage ? { [defaultLanguage]: stat as DailyStudyStats } : {};
    } else {
      dailyStats[date] = stat as Record<string, DailyStudyStats>;
    }
  }

  const flashcards = { ...store.flashcards };
  for (const card of Object.values(flashcards)) {
    if (!card.language && defaultLanguage) card.language = defaultLanguage;
  }

  return { ...store, meta, dailyStats, flashcards, version: CURRENT_VERSION };
}

/**
 * @deprecated Shape of the pre-v2 flashcard payload. Keep only for importing
 * existing files; do not use for new persistence code.
 */
interface V1FlashcardContent {
  word: string;
  pitchAccent?: number;
  pronunciation?: string;
  translation?: string | string[];
  definition?: string | string[];
  example?: string;
  exampleMeaning?: string;
  screenshotUrl?: string;
  pos?: string;
  level?: number;
}

/**
 * @deprecated Shape of pre-v2 cards imported by `migrateV1ToV2`.
 */
interface V1Flashcard {
  content: V1FlashcardContent;
  dueDate: number;
  lastReviewed: number;
  lastUpdated?: number;
  ease: number;
  reviews: number;
}

/**
 * @deprecated Shape of the old array-based flashcard store.
 */
interface V1FlashcardStore {
  flashcards: V1Flashcard[];
  wordCandidates: Record<string, number | { count: number; lastSeen: number; word: string }>;
  alreadyCreated: Record<string, boolean>;
  knownUnTracked: Record<string, boolean>;
  meta: {
    flashcardsCreatedToday: number;
    lastFlashcardCreatedDate: number;
  };
}

/**
 * @deprecated Version probe for the old array-based flashcard store.
 */
function isV1Store(store: any): store is V1FlashcardStore {
  return Array.isArray(store.flashcards) || 
         store.alreadyCreated !== undefined || 
         store.knownUnTracked !== undefined;
}

/**
 * @deprecated Backup helper for the one-way v1 flashcard migration path.
 */
function createBackup(originalPath: string, version = 1): string {
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
  orphanCounts: { knownUntracked: number; wordSyncSeen: number };
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
    store.wordSyncSeen,
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

function recognizeSnapshot(entry: PassiveWordKnowledge) {
  return {
    ease: entry.ease,
    lastSeen: entry.lastSeen,
    timesSeen: entry.timesSeen,
    timesHovered: entry.timesHovered,
    lastStatusChange: entry.lastStatusChange,
  };
}

function mergeWordKnowledge(a: PassiveWordKnowledge, b: PassiveWordKnowledge, aSource: string, bSource: string): PassiveWordKnowledge {
  const winner = (b.lastStatusChange ?? 0) > (a.lastStatusChange ?? 0) ? b : a;
  return {
    ...winner,
    language: 'zh',
    lastSeen: Math.max(a.lastSeen, b.lastSeen),
    timesSeen: a.timesSeen + b.timesSeen,
    timesHovered: a.timesHovered + b.timesHovered,
    forms: {
      ...a.forms,
      [aSource]: { ...a.forms?.[aSource], recognize: recognizeSnapshot(a) },
      ...b.forms,
      [bSource]: { ...b.forms?.[bSource], recognize: recognizeSnapshot(b) },
    },
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
    orphanCounts: { knownUntracked: 0, wordSyncSeen: 0 },
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

  const wordKnowledge = migrateKeyed(store.wordKnowledge, 'wordKnowledge', entry => entry.word, entry => {
    const source = entry.language && legacyZhSource('', entry.language) ? entry.language : 'zh-Hans';
    return { ...entry, language: 'zh', forms: { ...entry.forms, [source]: { ...entry.forms?.[source], recognize: recognizeSnapshot(entry) } } };
  }, (a, b) => mergeWordKnowledge(a, b, Object.keys(a.forms ?? {})[0] ?? 'zh-Hans', Object.keys(b.forms ?? {})[0] ?? 'zh-Hant'));
  const wordCandidates = migrateKeyed(store.wordCandidates, 'wordCandidates', entry => entry.word, entry => ({ ...entry, language: 'zh' }), (a, b) => ({ ...((b.lastSeen > a.lastSeen) ? b : a), count: a.count + b.count, lastSeen: Math.max(a.lastSeen, b.lastSeen) }));
  const ignoredWords = migrateKeyed(store.ignoredWords, 'ignoredWords', entry => entry.word, entry => ({ ...entry, language: 'zh' }), (a, b) => a.ignoredAt <= b.ignoredAt ? a : b);
  const suggestedFlashcards = migrateKeyed(store.suggestedFlashcards, 'suggestedFlashcards', entry => entry.word, entry => ({ ...entry, language: 'zh' }), (a, b) => {
    const richer = a.imageUrl && !b.imageUrl ? a : b.imageUrl && !a.imageUrl ? b : (a.lastSeen >= b.lastSeen ? a : b);
    return { ...richer, count: a.count + b.count, lastSeen: Math.max(a.lastSeen, b.lastSeen) };
  });
  const grammarKnowledge = migrateKeyed(store.grammarKnowledge, 'grammarKnowledge', entry => entry.pattern, entry => ({ ...entry, language: 'zh' }), (a, b): GrammarKnowledgeEntry => ({ ...((a.lastSeen >= b.lastSeen) ? a : b), ease: Math.max(a.ease, b.ease), timesEncountered: a.timesEncountered + b.timesEncountered, timesFailed: a.timesFailed + b.timesFailed, lastSeen: Math.max(a.lastSeen, b.lastSeen), language: 'zh' }));

  const corpus = collectZhCorpus(store, metadata);
  const migrateInverted = <T>(map: Record<string, T>, name: 'knownUntracked' | 'wordSyncSeen', merge: (a: T, b: T) => T): Record<string, T> => {
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
  const wordSyncSeen = migrateInverted(store.wordSyncSeen, 'wordSyncSeen', (a, b) => Math.max(a, b));

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

  const migrated: FlashcardStore = { ...store, flashcards, wordToCardMap, wordStatsMap, wordKnowledge, wordCandidates, knownUntracked, ignoredWords, suggestedFlashcards, wordSyncSeen, grammarKnowledge, meta, dailyStats, version: CURRENT_VERSION };
  fs.writeFileSync(path.join(path.dirname(backupPath), 'flashcards.zh-variant-merge-report.json'), JSON.stringify(report, null, 2));
  migrationInfo = { occurred: true, backupPath, fromVersion: 2 };
  return migrated;
}

/**
 * @deprecated Imports the pre-v2 flashcard store into the current normalized
 * schema. New migrations should be versioned from the current store format.
 */
function migrateV1ToV2(store: V1FlashcardStore, backupPath: string): FlashcardStore {
  log.info('Migrating flashcard store from v1 (old app) to v3...');
  
  migrationInfo = {
    occurred: true,
    backupPath,
    fromVersion: 1,
  };
  
  const newFlashcards: Record<string, Flashcard> = {};
  const wordToCardMap: Record<string, string[]> = {};
  const wordStatsMap: Record<string, WordStats> = {};
  const newWordCandidates: Record<string, WordCandidate> = {};
  const migrationLanguage = resolveMigrationDefaultLanguage();
  
  for (const v1Card of store.flashcards || []) {
    if (!v1Card.content?.word) continue;
    
    const word = v1Card.content.word;
    const wordHash = generateWordHashSync(word);
    const cardId = generateUUID();
    
    const v1Ease = v1Card.ease || 0;
    let newEase: number = SRS_EASE.DEFAULT_KNOWN;
    if (v1Ease > 0) {
      newEase = Math.max(SRS_EASE.MIN, Math.min(3.0, v1Ease * 1.2));
    }

    let state: FlashcardState = 'new';
    if (v1Card.reviews > 0) {
      if (newEase >= SRS_EASE.DEFAULT_KNOWN) {
        state = 'review';
      } else {
        state = 'learning';
      }
    }
    
    const legacyPitchAccentProsody = typeof v1Card.content.pitchAccent === 'number'
      ? createProsodyForPosition(
          resolveLegacyProsodyMigrationType(migrationLanguage || undefined, undefined),
          v1Card.content.pitchAccent
        )
      : undefined;

    const newContent: FlashcardContent = {
      type: 'word',
      front: word,
      back: Array.isArray(v1Card.content.translation) 
        ? v1Card.content.translation.join('; ') 
        : v1Card.content.translation || '',
      reading: v1Card.content.pronunciation,
      prosody: legacyPitchAccentProsody,
      pos: v1Card.content.pos,
      level: v1Card.content.level,
      example: v1Card.content.example !== '-' ? v1Card.content.example : undefined,
      exampleMeaning: v1Card.content.exampleMeaning || undefined,
      imageUrl: v1Card.content.screenshotUrl || undefined,
      word: word,
      pronunciation: v1Card.content.pronunciation,
      translation: Array.isArray(v1Card.content.translation) 
        ? v1Card.content.translation 
        : v1Card.content.translation ? [v1Card.content.translation] : undefined,
      definition: Array.isArray(v1Card.content.definition)
        ? v1Card.content.definition
        : v1Card.content.definition ? [v1Card.content.definition] : undefined,
      screenshotUrl: v1Card.content.screenshotUrl,
    };
    
    const interval = Math.max(0, v1Card.dueDate - v1Card.lastReviewed);
    
    const newCard: Flashcard = {
      id: cardId,
      content: newContent,
      state,
      ease: newEase,
      interval,
      dueDate: v1Card.dueDate,
      reviews: v1Card.reviews || 0,
      lapses: 0,
      learningStep: 0,
      createdAt: v1Card.lastUpdated || v1Card.lastReviewed || Date.now(),
      lastReviewed: v1Card.lastReviewed,
      lastUpdated: v1Card.lastUpdated || v1Card.lastReviewed || Date.now(),
    };
    
    newFlashcards[cardId] = newCard;
    
    if (!wordToCardMap[wordHash]) {
      wordToCardMap[wordHash] = [];
    }
    wordToCardMap[wordHash].push(cardId);
  }
  
  for (const [wordHash, cardIds] of Object.entries(wordToCardMap)) {
    const cards = cardIds.map(id => newFlashcards[id]).filter(Boolean);
    wordStatsMap[wordHash] = calculateWordStats(cards);
  }
  
  for (const [key, value] of Object.entries(store.wordCandidates || {})) {
    if (typeof value === 'number') {
      newWordCandidates[key] = {
        count: value,
        lastSeen: Date.now(),
        word: '',
      };
    } else if (typeof value === 'object' && value !== null) {
      newWordCandidates[key] = {
        count: value.count || 0,
        lastSeen: value.lastSeen || Date.now(),
        word: value.word || '',
      };
    }
  }
  
  const knownUntracked: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(store.knownUnTracked || {})) {
    knownUntracked[key] = value;
  }
  
  const today = new Date().toISOString().split('T')[0];
  const meta = {
    ...DEFAULT_FLASHCARD_STORE.meta,
    newCardsToday: store.meta?.flashcardsCreatedToday || 0,
    newCardsDate: today,
  };
  
  log.info(`Migrated ${Object.keys(newFlashcards).length} flashcards from v1 to v2`);

  let result: FlashcardStore = {
    flashcards: newFlashcards,
    wordCandidates: newWordCandidates,
    wordToCardMap,
    wordStatsMap,
    knownUntracked,
    ignoredWords: {},
    wordKnowledge: {},
    grammarKnowledge: {},
    suggestedFlashcards: {},
    wordSyncSeen: {},
    meta,
    dailyStats: {},
    version: 5,
  };

  result = migrateV4ToV5(result);
  // The old v1 store did not record a card language, so use the user's current
  // profile language instead of assigning a language-specific default.
  result = migrateV6ToV7(result, migrationLanguage);

  return migrateLegacyFlashcardStore(result);
}

function isValidFlashcardStore(value: unknown): value is FlashcardStore {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    'flashcards' in v && typeof v.flashcards === 'object' && v.flashcards !== null &&
    typeof v.version === 'number'
  );
}

function checkFlashcards(fc_to_check: any): FlashcardStore {
  if (isV1Store(fc_to_check)) {
    const backupPath = createBackup(getFlashcardsPath());
    return migrateV1ToV2(fc_to_check as V1FlashcardStore, backupPath);
  }

  if (!isValidFlashcardStore(fc_to_check)) {
    log.warn('[flashcardStorage] Loaded store has unexpected structure — using defaults');
    return { ...DEFAULT_FLASHCARD_STORE };
  }

  if (fc_to_check.version < CURRENT_VERSION && containsLegacyZhData(fc_to_check)) {
    const zhMetadata = loadZhMigrationPackage();
    if (!zhMetadata) return fc_to_check;
    const backupPath = createBackup(getFlashcardsPath(), 2);
    return migrateLegacyFlashcardStore(migrateV2ToV3(fc_to_check, zhMetadata, backupPath));
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
    wordSyncSeen: fc_to_check.wordSyncSeen || {},
    meta: { ...DEFAULT_FLASHCARD_STORE.meta, ...fc_to_check.meta },
    dailyStats: fc_to_check.dailyStats || {},
    version: fc_to_check.version < CURRENT_VERSION ? CURRENT_VERSION : fc_to_check.version,
  };

  return migrateLegacyFlashcardStore(result);
}

export async function loadFlashcards(): Promise<FlashcardStore> {
  try {
    const filePath = getFlashcardsPath();
    try {
      await fs.promises.access(filePath);
    } catch (e) {
      log.error("error", e);
      return { ...DEFAULT_FLASHCARD_STORE };
    }
    const data = await fs.promises.readFile(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(data);
    const parsedJson = JSON.stringify(parsed);

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      log.warn('[flashcardStorage] Loaded JSON is not a plain object — using defaults');
      return { ...DEFAULT_FLASHCARD_STORE };
    }

    const store = checkFlashcards(parsed);
    const storeJson = JSON.stringify(store);

    if (storeJson !== parsedJson) {
      await saveFlashcards(store);
    }

    if (extractBase64Images(store)) {
      await saveFlashcards(store);
    }

    return store;
  } catch (error) {
    log.error('Failed to load flashcards:', error);
  }
  return { ...DEFAULT_FLASHCARD_STORE };
}

export async function saveFlashcards(store: FlashcardStore): Promise<void> {
  return enqueueWrite(async () => {
    try {
      extractBase64Images(store);

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
  ipcMain.on(IPC_CHANNELS.GET_FLASHCARDS, async (event) => {
    const flashcards = await loadFlashcards();
    event.reply(IPC_CHANNELS.FLASHCARDS_LOADED, flashcards);
    
    if (migrationInfo.occurred) {
      event.reply(IPC_CHANNELS.FLASHCARD_MIGRATION_COMPLETE, migrationInfo);
      migrationInfo = { occurred: false, backupPath: null, fromVersion: null };
    }
  });

  ipcMain.on(IPC_CHANNELS.SAVE_FLASHCARDS, (_event, store: FlashcardStore) => {
    void saveFlashcards(store);
  });
  
  ipcMain.on(IPC_CHANNELS.GET_FLASHCARD_MIGRATION_INFO, (event) => {
    event.reply(IPC_CHANNELS.FLASHCARD_MIGRATION_COMPLETE, migrationInfo);
  });
}

export function getMigrationInfo() {
  return migrationInfo;
}
