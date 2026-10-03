import { isDeepStrictEqual } from 'node:util';
import { reviewPresentationPatch, type ReviewPresentationWrite } from '../../shared/reviewPresentationWrite';
import { reconcileFlashcardActionOwners } from '../../shared/flashcardActionUndo';
/**
 * Flashcard Storage Service
 * Handles persistence and IPC for flashcard data
 */

import fs from 'fs';
import path from 'path';
import { app, BrowserWindow, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { createProsodyForPosition, getLanguageProsodyType, registerMappingTable, buildLexemeIndex, buildWordFrequencyMapFromLanguageData, getFrequencyForLexeme, resolveLanguageFrequencyPayload } from '../../shared/languageFeatures';
import { CURRENT_NORMALIZATION_VERSION } from '../../shared/utils/normalizationVersion';
import { mergeStudyExclusion } from '../../shared/studyExclusion';
import { readPendingRetraction, readRetractionCompletionClaim } from '../../shared/retractionRecovery';
import { validateReviewResponseUndo, type ReviewUndoProjection } from '../../shared/flashcardReviewUndo';
import { staleFlashcardRevisionMessage } from '../../shared/flashcardWriteRevision';
import type { FlashcardStore, FlashcardWriteAuthorization, WordStats, Flashcard, WordCandidate, FlashcardContent, DailyStudyStats, LanguageData, LanguageDataMap, PassiveWordKnowledge, GrammarKnowledgeEntry, IgnoredWordEntry, SuggestedFlashcard, Settings } from '../../shared/types';
import { canonicalKeyHash } from '../../shared/utils/canonicalWordKey';
import { copyStoreWithPatch, getStorePath, storePatchRecorder, type StorePatch } from '../../shared/utils/storePatch';
import { applyFlashcardRatingCommand, RatingAdmissionRefusal, type FlashcardRatingCommand, type FlashcardRatingCommit } from '../../shared/flashcardRating';
import type { KnowledgeEventLog } from '../../shared/knowledgeEvents';
import { RatingWriteQueue } from './ratingWriteQueue';
import { calculateWordStats } from '../../shared/utils/wordStats';
import { createWordFormDeriver } from '../../shared/utils/wordForms';
import { getUserDataPath } from '../utils/platform';
import { extractBase64Images } from './flashcardImageStorage';
import { loadLangData, loadSettings } from './settings';
import { getLogger } from '../../shared/utils/logger';
import { guardianForWrites } from './guardian';

const log = getLogger('electron.flashcardStorage');
const ratingWrites = new RatingWriteQueue(persistRatingCommands);

export const enqueueFlashcardRating = (command: FlashcardRatingCommand): Promise<number> => ratingWrites.enqueue(command);
export const flushFlashcardRatings = (): Promise<void> => ratingWrites.flush();

function persistRatingCommands(commands: readonly FlashcardRatingCommand[]): Promise<number> {
  return enqueueWrite(async () => {
    await recoverAdmittedRatingsBeforeWrite();
    return (await commitRatingCommands(commands)).rev;
  });
}

/** Derived retention caches can be hydrated locally; authored/scheduling fields own admission. */
const capturedReviewCardMatches = (actual: Flashcard | undefined, captured: unknown): boolean => {
  if (!actual || !captured || typeof captured !== 'object') return false;
  return isDeepStrictEqual({ ...actual, retentionCache: undefined }, { ...captured, retentionCache: undefined });
};

/** Immediate Review admission and both effects share the main write queue. */
export function commitFlashcardRating(command: FlashcardRatingCommand): Promise<FlashcardRatingCommit> {
  return enqueueWrite(async () => {
    await recoverAdmittedRatingsBeforeWrite();
    return commitRatingCommands([command]);
  });
}

/** Every mutation settles durable earlier responses before changing their authority. */
async function recoverAdmittedRatingsBeforeWrite(): Promise<void> {
  const journal = await import('./knowledgeEvents');
  await journal.whenKnowledgeEventsReady();
  if (journal.pendingRatingCommands().length > 0) await commitRatingCommands([]);
}

async function commitRatingCommands(commands: readonly FlashcardRatingCommand[], loaded?: FlashcardStore): Promise<FlashcardRatingCommit> {
  const filePath = getFlashcardsPath();
  const current = loaded ?? (cachedStorePath === filePath && cachedStore
    ? cachedStore : await loadFlashcardsFromDisk(filePath, store => writeStore(store, [], false)));
  const journal = await import('./knowledgeEvents');
  const { isKnowledgeEvent } = await import('./knowledgeHistoryStore');
  await journal.whenKnowledgeEventsReady();
  const validate = (command: FlashcardRatingCommand): void => {
    for (const rows of Object.values(command.events)) {
      if (rows.some(row => !isKnowledgeEvent(row) || row.attemptId !== command.attemptId)) throw new Error('Invalid flashcard rating evidence');
    }
    // Validate counter declarations before durable admission or evidence append.
    applyFlashcardRatingCommand(current, command);
  };
  // Preflight the complete ordered batch before reserving any new response.
  // A stale response and its dependent successors have no durable effects;
  // independent responses remain eligible for the next queue pass.
  let preflight = current;
  const refused: string[] = [];
  if (current.pendingRetraction !== undefined) {
    const unadmitted = commands.filter(command => !journal.isRatingCommandCommitted(command.attemptId));
    if (unadmitted.length > 0) throw new RatingAdmissionRefusal(unadmitted.map(command => command.attemptId),
      'Complete the pending Undo before submitting another review.');
  }
  for (const command of commands) {
    if (journal.isRatingCommandCommitted(command.attemptId)) continue;
    const captured = (command.guardCardIds ?? []).every(id => {
      const entry = command.patch.entries.find(row => row.path.length === 2 && row.path[0] === 'flashcards' && row.path[1] === id);
      return entry && capturedReviewCardMatches(preflight.flashcards[id], entry.before);
    });
    if (!captured) { refused.push(command.attemptId); continue; }
    preflight = applyFlashcardRatingCommand(preflight, command);
  }
  if (refused.length > 0) throw new RatingAdmissionRefusal(refused);
  let admission = current;
  for (const command of commands) {
    const reserved = journal.reserveRatingCommand(command, () => {
      if (admission.pendingRetraction !== undefined) throw new Error('Complete the pending Undo before submitting another review');
      validate(command);
      for (const id of command.guardCardIds ?? []) {
        const entry = command.patch.entries.find(row => row.path.length === 2 && row.path[0] === 'flashcards' && row.path[1] === id);
        if (!entry || !capturedReviewCardMatches(admission.flashcards[id], entry.before)) throw new Error('The captured review card changed before admission');
      }
    });
    // A queued second response may have been shown after the first optimistic
    // response. Its proof belongs to that ordered state, not the batch origin.
    if ('command' in reserved) admission = applyFlashcardRatingCommand(admission, reserved.command);
  }
  const pending = journal.pendingRatingCommands();
  const ledgerId = journal.ratingLedgerId();
  const committedThrough = current.meta.ratingCommitLedgerId === ledgerId ? current.meta.ratingCommitSequence ?? 0 : 0;
  if (!Number.isSafeInteger(committedThrough) || committedThrough < 0) throw new Error('Invalid saved rating commit frontier');
  const remaining = pending.filter(entry => entry.sequence > committedThrough);
  const events: KnowledgeEventLog = {};
  let candidate = current;
  const paths = new Map<string, readonly string[]>();
  for (const { command } of remaining) {
    validate(command);
    for (const id of command.guardCardIds ?? []) {
      const entry = command.patch.entries.find(row => row.path.length === 2 && row.path[0] === 'flashcards' && row.path[1] === id);
      if (!entry || !capturedReviewCardMatches(candidate.flashcards[id], entry.before)) throw new Error('The admitted review card changed before recovery');
    }
    candidate = applyFlashcardRatingCommand(candidate, command);
    for (const [key, rows] of Object.entries(command.events)) (events[key] ??= []).push(...rows);
    for (const entry of command.patch.entries) paths.set(JSON.stringify(entry.path), entry.path);
  }
  // Journal identities protect every access of an admitted response through compaction.
  if (remaining.length > 0) await journal.appendKnowledgeEvents(events);
  const recorder = storePatchRecorder(current as unknown as Record<string, unknown>);
  for (const path of paths.values()) recorder.set(path, getStorePath(candidate as unknown as Record<string, unknown>, path));
  const through = remaining.at(-1)?.sequence ?? committedThrough;
  let rev = current.rev ?? 0;
  if (remaining.length > 0) {
    // Commit the effects and their receipt in the SAME atomic library rename.
    candidate = copyStoreWithPatch(candidate, { baseRev: current.rev ?? 0, entries: [
      { path: ['meta', 'ratingCommitSequence'], before: current.meta.ratingCommitSequence, after: through },
      { path: ['meta', 'ratingCommitLedgerId'], before: current.meta.ratingCommitLedgerId, after: ledgerId },
    ] });
    recorder.set(['meta', 'ratingCommitLedgerId'], ledgerId);
    recorder.set(['meta', 'ratingCommitSequence'], through);
    rev = await writeStore(candidate, [], false, undefined, { ledgerId, sequence: through });
  }
  // A crash after the library rename lands here on restart, with no replay.
  if (pending.length > 0 && through > 0) journal.completeRatingCommands(through, rev);
  const patch = remaining.length > 0 ? recorder.build(current.rev ?? 0) : {
    baseRev: current.rev ?? 0,
    entries: commands.flatMap(command => command.patch.entries.map(entry => ({
      ...entry, after: getStorePath(current as unknown as Record<string, unknown>, entry.path),
    }))),
  };
  const result: FlashcardRatingCommit = {
    patch, rev,
    attemptIds: [...new Set([...commands.map(command => command.attemptId), ...pending.map(entry => entry.command.attemptId)])],
  };
  if (remaining.length > 0) for (const window of BrowserWindow.getAllWindows()) {
    try {
      if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.FLASHCARD_RATINGS_COMMITTED, result);
    } catch (error) { log.warn('Failed to notify a window about saved ratings:', error); }
  }
  return result;
}

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
function enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
  const write = writeQueue.then(fn, fn);
  writeQueue = write.then(() => undefined, () => undefined);
  return write;
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
    || maps.some(map => Object.keys(map ?? {}).some(isLegacyZhKey))
    || Boolean(store.meta?.perLanguage?.['zh-Hans'] || store.meta?.perLanguage?.['zh-Hant'])
    || Object.values(store.dailyStats ?? {}).some(stats => Boolean(stats['zh-Hans'] || stats['zh-Hant']));
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
  const ignoredWords = migrateKeyed(store.ignoredWords, 'ignoredWords', entry => entry.word, entry => ({ ...entry, language: 'zh' }), mergeStudyExclusion);
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
    'flashcards' in v && typeof v.flashcards === 'object' && v.flashcards !== null && !Array.isArray(v.flashcards) &&
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
  for (const [legacyKey, entry] of Object.entries(store.ignoredWords || {})) {
    if (!entry) continue;
    const key = deriveRecordKey(deriverFor, langData, entry.language, entry.word, legacyKey);
    if (!key) {
      ignoredWords[legacyKey] = entry;
      continue;
    }
    ignoredWords[key] = mergeStudyExclusion(ignoredWords[key], entry);
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
    throw new Error('The saved flashcard library has an invalid structure');
  }

  if (fc_to_check.version < CURRENT_VERSION && containsLegacyZhData(fc_to_check)) {
    const zhMetadata = loadZhMigrationPackage();
    if (!zhMetadata) return fc_to_check;
    const backupPath = createBackup(getFlashcardsPath(), 2);
    return finalizeStore(migrateV2ToV3(fc_to_check, zhMetadata, backupPath));
  }

  // A decided-but-unfinished Undo survives a reload, so the record must survive
  // too. The pre-envelope field is read as well so an in-flight review Undo is
  // upgraded rather than dropped.
  const pendingRetraction = readPendingRetraction(
    fc_to_check.pendingRetraction
    // Pre-envelope stores kept the review record under its own field.
    ?? (fc_to_check as { pendingReviewUndo?: unknown }).pendingReviewUndo,
  );

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
    ...(pendingRetraction ? { pendingRetraction } : {}),
    rev: fc_to_check.rev,
  };
  // A completion claim describes one write rather than the store, so it is not
  // carried through here and never survives a reload.

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
  const load = enqueueWrite(async () => {
    const loaded = await loadFlashcardsFromDisk(filePath, store => writeStore(store, [], false));
    const journal = await import('./knowledgeEvents');
    await journal.whenKnowledgeEventsReady();
    if (journal.pendingRatingCommands().length > 0) await commitRatingCommands([], loaded);
    return cachedStore ?? loaded;
  }).finally(() => {
    if (inflightLoad === load) inflightLoad = undefined;
  });
  inflightLoad = load;
  return load;
}

/**
 * Reads the store from disk, migrating and re-saving as needed.
 *
 * `write` is injected rather than calling saveFlashcards directly because this
 * runs under whatever lock the caller holds: loadFlashcardsFromDisk called from
 * inside enqueueWrite would re-enter the queue and wait on itself.
 */
async function loadFlashcardsFromDisk(
  filePath: string,
  write: (store: FlashcardStore) => Promise<number>,
): Promise<FlashcardStore> {
  try {
    try {
      await fs.promises.access(filePath);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      const empty = { ...DEFAULT_FLASHCARD_STORE };
      cachedStore = empty;
      cachedStorePath = filePath;
      return empty;
    }
    const data = await fs.promises.readFile(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(data);
    // Normalizers may mutate nested records. Compare against the original
    // values, independently of object property insertion order.
    const original = structuredClone(parsed);

    const store = checkFlashcards(parsed);
    const extracted = extractBase64Images(store);
    if (extracted || !isDeepStrictEqual(original, store)) await write(store);

    cachedStore = store;
    cachedStorePath = filePath;
    return store;
  } catch (error) {
    invalidateFlashcardsCache();
    log.error('Failed to load flashcards:', error);
    throw error;
  }
}

/**
 * Retire only media absent from the saved authority. Check and synchronous
 * release share the store-write queue turn, so a queued peer save cannot race
 * the check. Read disk strictly: an unavailable library is never proof that
 * a resource is unreferenced.
 */
export async function releaseUnusedFlashcardMedia(
  kind: 'image' | 'video' | 'tts', id: string, release: () => void,
): Promise<boolean> {
  if (!['image', 'video', 'tts'].includes(kind) || typeof id !== 'string'
    || id.length === 0 || id === '.' || id === '..' || /[\\/\0]/.test(id)) {
    throw new Error('Invalid flashcard media identity');
  }
  await flushFlashcardRatings();
  return enqueueWrite(async () => {
    await recoverAdmittedRatingsBeforeWrite();
    const authority: unknown = JSON.parse(await fs.promises.readFile(getFlashcardsPath(), 'utf-8'));
    const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
    if (!record(authority) || !record(authority.flashcards)
      || (authority.suggestedFlashcards !== undefined && !record(authority.suggestedFlashcards))) {
      throw new Error('Cannot establish flashcard media ownership');
    }
    const cards = authority.flashcards;
    const suggestions = authority.suggestedFlashcards ?? {};
    if (Object.values(cards).some(value => !record(value) || !record(value.content))
      || Object.values(suggestions).some(value => !record(value))) {
      throw new Error('Cannot establish flashcard media ownership');
    }
    // A recreated card/capture owns its media namespace before URLs are
    // populated. Keep both ordinary and extracted-suggestion image IDs.
    if (Object.hasOwn(cards, id) || Object.values(cards).some(value => record(value) && value.id === id)
      || Object.entries(suggestions).some(([key, value]) => record(value)
        && (value.id === id || (kind === 'image' && `suggested-${value.id || key}` === id)))) return false;
    const scheme = kind === 'tts' ? 'flashcard-audio' : `flashcard-${kind}`;
    const names = new Set(kind === 'image' ? ['jpg', 'png', 'webp', 'gif'].map(ext => `${id}.${ext}`)
      : kind === 'video' ? [`${id}.mp4`] : [`${id}-word.ogg`, `${id}-example.ogg`]);
    const pattern = new RegExp(`${scheme}://([^"'<>?#]+)`, 'gi');
    const referenced = (value: unknown): boolean => {
      if (typeof value === 'string') {
        // Stored HTML reaches the browser after character-reference parsing.
        // Resolve numeric/basic protocol punctuation; retain opaque references
        // conservatively rather than guessing a complete HTML entity catalog.
        const punctuation: Record<string, string> = { colon: ':', sol: '/', period: '.', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', Tab: '\t', NewLine: '\n' };
        const entityDecoded = value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);?/gi, (raw, entity: string) => {
          if (entity.startsWith('#')) {
            const point = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
            return Number.isSafeInteger(point) && point > 0 && point <= 0x10ffff
              && (point < 0xd800 || point > 0xdfff) ? String.fromCodePoint(point) : raw;
          }
          return punctuation[entity] ?? raw;
        });
        const rendered = entityDecoded.replace(/[\t\n\r]/g, '');
        // Character-reference parsing can introduce an attribute delimiter or
        // filename character. Any remaining ambiguity retains the namespace.
        if (/&(?:#[xX]?[0-9a-f]+|[a-z]+);?/i.test(value)
          && rendered.toLowerCase().includes(`${scheme}://`)) return true;
        for (const match of [...entityDecoded.matchAll(pattern), ...rendered.matchAll(pattern)]) {
          if (match[1].includes('&')) return true;
          let filename: string;
          try { filename = decodeURIComponent(match[1]).split('?')[0].trim().replace(/\/$/, ''); }
          catch { return true; } // An opaque malformed reference cannot authorize deletion.
          if (names.has(filename) || [...names].some(name => filename.startsWith(name)
            && /^\s/.test(filename.slice(name.length)))) return true;
        }
      } else if (Array.isArray(value)) return value.some(referenced);
      else if (record(value)) return Object.values(value).some(referenced);
      return false;
    };
    for (const value of [...Object.values(cards), ...Object.values(suggestions)]) {
      if (!record(value)) throw new Error('Cannot establish flashcard media ownership');
      if (referenced(value)) return false;
    }
    release();
    return true;
  });
}

export async function saveFlashcards(store: FlashcardStore, removedCardIds: readonly string[] = [], resetReviewProgress = false, authorization?: FlashcardWriteAuthorization): Promise<number> {
  await flushFlashcardRatings();
  return enqueueWrite(async () => {
    await recoverAdmittedRatingsBeforeWrite();
    return writeStore(store, removedCardIds, resetReviewProgress, authorization);
  });
}

/**
 * The body of a flashcard write, WITHOUT the queue.
 *
 * Callers that are already inside `enqueueWrite` (saveFlashcardPatch) must use
 * this directly: re-entering the queue from within a queued write would await
 * the very write that is awaiting it, and the write would never settle.
 */
async function writeStore(store: FlashcardStore, removedCardIds: readonly string[], resetReviewProgress: boolean, authorization?: FlashcardWriteAuthorization, ratingReceipt?: { ledgerId: string; sequence: number }): Promise<number> {
    // TEMP DIAGNOSTIC: opt-in via the mlearn.ratingTrace file flag, since the
    // main process has no localStorage. `touch <userData>/ratingTrace.flag`.
    const traceOn = fs.existsSync(path.join(getUserDataPath(), 'ratingTrace.flag'));
    const t0 = Date.now();
    const filePath = getFlashcardsPath();
    let persistedAuthority: FlashcardStore | undefined;
    let currentRevision = cachedStorePath === filePath ? cachedStore?.rev : undefined;
    if (currentRevision === undefined) {
      try {
        const persisted: unknown = JSON.parse(await fs.promises.readFile(filePath, 'utf-8'));
        if (!isValidFlashcardStore(persisted)) throw new Error('The saved flashcard library has an invalid structure');
        persistedAuthority = persisted;
        currentRevision = typeof persisted.rev === 'number' && Number.isSafeInteger(persisted.rev) ? persisted.rev : 0;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        currentRevision = 0;
      }
    }
    const ownedMeta = (cachedStorePath === filePath ? cachedStore : persistedAuthority)?.meta;
    if (ratingReceipt) {
      store.meta.ratingCommitSequence = ratingReceipt.sequence;
      store.meta.ratingCommitLedgerId = ratingReceipt.ledgerId;
    } else {
      for (const field of ['ratingCommitSequence', 'ratingCommitLedgerId'] as const) {
        if (ownedMeta?.[field] !== undefined) Object.assign(store.meta, { [field]: ownedMeta[field] });
        else delete store.meta[field];
      }
    }
    const expectedRevision = store.rev ?? 0;
    if (expectedRevision !== currentRevision) {
      throw new Error(staleFlashcardRevisionMessage(currentRevision, expectedRevision));
    }

    // A decided-but-unfinished Undo must not be undone by an unrelated write.
    // The store is whole-snapshot: every window saves all of it, and a window
    // whose snapshot predates the record simply has no `pendingRetraction` key.
    // Writing that snapshot as-is silently deleted the record — the rating the
    // learner tried to take back stayed applied with nothing left able to take
    // it back, which is the exact loss the record exists to prevent.
    //
    // Only the window that decided the Undo clears it, and it does so by
    // writing the store without the field on purpose. So an incoming snapshot
    // that omits a record the last persisted store still holds means "this
    // writer has not seen it", never "this Undo was cancelled": carrying the
    // authoritative one forward is the only reading that cannot lose it. The
    // decision to finish still belongs to whoever recorded it.
    const authoritativeRetraction = cachedStorePath === filePath
      ? readPendingRetraction((cachedStore as FlashcardStore | undefined)?.pendingRetraction)
      : readPendingRetraction(persistedAuthority?.pendingRetraction ?? (persistedAuthority as { pendingReviewUndo?: unknown } | undefined)?.pendingReviewUndo);
    const claim = readRetractionCompletionClaim(store as { pendingRetraction?: unknown; retractionCompleted?: unknown });
    const incomingRetraction = readPendingRetraction(store.pendingRetraction);
    if (authoritativeRetraction && incomingRetraction && authoritativeRetraction.attemptId !== incomingRetraction.attemptId) {
      throw new Error('Another pending Undo must be completed before it can be replaced');
    }
    // A decided Undo owns its scheduler pre-image until completion. Ordinary
    // edits can continue, but a reset/deletion/new response cannot strand the
    // journal half behind a projection that will never accept its rollback.
    const protectedReview = authoritativeRetraction ?? incomingRetraction;
    if (protectedReview?.surface === 'flashcard-review'
      && (!authoritativeRetraction || claim?.attemptId !== authoritativeRetraction.attemptId)) {
      const projection = protectedReview.restore as ReviewUndoProjection;
      if (projection?.expectedCard) validateReviewResponseUndo(store, projection);
    }
    if (authoritativeRetraction && !readPendingRetraction(store.pendingRetraction)) {
      // Finishing an Undo is the one write that deliberately drops the record,
      // and it names the retraction it is completing. Any other snapshot that
      // lacks the record simply has not seen the decision yet.
      if (!claim || claim.attemptId !== authoritativeRetraction.attemptId) {
        store.pendingRetraction = authoritativeRetraction;
      }
    }
    // The claim is a statement about this write, not part of the store.
    delete (store as { retractionCompleted?: unknown }).retractionCompleted;

    const previousCards = (cachedStorePath === filePath ? cachedStore : persistedAuthority)?.flashcards;
    for (const card of Object.values(store.flashcards)) reconcileFlashcardActionOwners(card, previousCards?.[card.id]);

    const guardian = guardianForWrites();
    guardian?.checkFlashcardWrite(store, removedCardIds, resetReviewProgress, authorization);
    // The main process serializes writes and advances the authoritative
    // revision. Other renderer snapshots from the previous revision are stale.
    store.rev = currentRevision + 1;
    extractBase64Images(store);
    try {
      const tmpPath = `${filePath}.tmp`;
      const dir = path.dirname(filePath);
      try {
        await fs.promises.access(dir);
      } catch (e) {
        log.error("error", e);
        await fs.promises.mkdir(dir, { recursive: true });
      }
      const tSerialize = Date.now();
      const encoded = JSON.stringify(store, null, 2);
      const tWrite = Date.now();
      await fs.promises.writeFile(tmpPath, encoded);
      await fs.promises.rename(tmpPath, filePath);
      const tRename = Date.now();
      guardian?.recordFlashcardWrite(store);
      if (traceOn) console.log(`[MAIN save] start=${(tSerialize - t0).toFixed(1)}ms serialize=${(tWrite - tSerialize).toFixed(1)}ms write+rename=${(tRename - tWrite).toFixed(1)}ms ledger=${(Date.now() - tRename).toFixed(1)}ms total=${(Date.now() - t0).toFixed(1)}ms`);
      cachedStore = store;
      cachedStorePath = filePath;
      return store.rev;
    } catch (error) {
      invalidateFlashcardsCache();
      log.error('Failed to save flashcards:', error);
      throw error;
    }
}

/**
 * Applies a declared set of entry changes to the authoritative store and
 * persists it. The renderer sends a patch rather than a whole store because it
 * already knows which entries a command touched, and shipping the full store
 * through IPC cost more than the disk write it preceded. The result is
 * identical: the same entries end up in the same file.
 *
 * Resolve the current store inside the write queue, loading on a cold cache.
 * Leaf pre-images preserve concurrent sibling edits when rebasing a patch.
 * The candidate becomes authoritative only after persistence succeeds.
 */
export async function saveFlashcardPatch(
  patch: StorePatch,
  removedCardIds: readonly string[] = [],
  resetReviewProgress = false,
  authorization?: FlashcardWriteAuthorization,
): Promise<number> {
  await flushFlashcardRatings();
  return enqueueWrite(async () => {
    await recoverAdmittedRatingsBeforeWrite();
    const filePath = getFlashcardsPath();
    // Resolve the current snapshot AFTER earlier writes finish. Capturing it
    // before entering the queue loses edits or targets an obsolete revision.
    const current = cachedStorePath === filePath && cachedStore
      ? cachedStore
      : await loadFlashcardsFromDisk(filePath, loaded => writeStore(loaded, [], false));
    // Publish only after the atomic disk write succeeds. Patching cachedStore
    // in place poisoned its data and revision when a write failed.
    const candidate = copyStoreWithPatch(current, patch);
    return writeStore(candidate, removedCardIds, resetReviewProgress, authorization);
  });
}

/** Cursor persistence is background work with its own sparse command, never a renderer store save. */
export async function saveReviewPresentation(command: ReviewPresentationWrite): Promise<FlashcardRatingCommit | null> {
  const captured = JSON.parse(JSON.stringify(command)) as ReviewPresentationWrite;
  await flushFlashcardRatings();
  return enqueueWrite(async () => {
    await recoverAdmittedRatingsBeforeWrite();
    const filePath = getFlashcardsPath();
    const current = cachedStorePath === filePath && cachedStore
      ? cachedStore : await loadFlashcardsFromDisk(filePath, loaded => writeStore(loaded, [], false));
    const patch = reviewPresentationPatch(current, captured);
    if (!patch) return null;
    const rev = patch.entries.length ? await writeStore(copyStoreWithPatch(current, patch), [], false) : current.rev ?? 0;
    const commit = { patch, rev, attemptIds: [] };
    for (const window of BrowserWindow.getAllWindows()) {
      try { if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.FLASHCARD_RATINGS_COMMITTED, commit); }
      catch (error) { log.warn('Failed to notify a window about its review position:', error); }
    }
    return commit;
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
  let quitAfterFlush = false;
  let flushingForQuit = false;
  app.on('before-quit', event => {
    if (quitAfterFlush || !ratingWrites.hasPending) return;
    event.preventDefault();
    if (flushingForQuit) return;
    flushingForQuit = true;
    void flushFlashcardRatings().then(() => { quitAfterFlush = true; app.quit(); }, error => {
      flushingForQuit = false;
      log.error('Failed to save pending ratings before quit:', error);
    });
  });
  ipcMain.handle(IPC_CHANNELS.COMMIT_FLASHCARD_RATING, (_event, command: FlashcardRatingCommand) => commitFlashcardRating(command));
  ipcMain.handle(IPC_CHANNELS.ENQUEUE_FLASHCARD_RATING, (_event, command: FlashcardRatingCommand) => enqueueFlashcardRating(command));
  ipcMain.handle(IPC_CHANNELS.FLUSH_FLASHCARD_RATINGS, () => flushFlashcardRatings());
  ipcMain.on(IPC_CHANNELS.GET_FLASHCARDS, async (event, knownRev?: number) => {
    try {
      const flashcards = await loadFlashcards();
      // Focus/visibility sync: an unchanged rev skips the multi-MB store ship.
      // The renderer treats a null payload as "nothing to reconcile".
      const unchanged = knownRev != null && knownRev === (flashcards.rev ?? 0);
      event.reply(IPC_CHANNELS.FLASHCARDS_LOADED, unchanged ? null : flashcards);

      if (migrationInfo.occurred) {
        event.reply(IPC_CHANNELS.FLASHCARD_MIGRATION_COMPLETE, migrationInfo);
        migrationInfo = { occurred: false, backupPath: null, fromVersion: null };
      }
    } catch (error) {
      log.error('Could not deliver the flashcard library:', error);
      event.reply(IPC_CHANNELS.FLASHCARDS_LOAD_ERROR, error instanceof Error ? error.message : String(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.SAVE_FLASHCARDS, (_event, store: FlashcardStore, removedCardIds?: string[], resetReviewProgress?: boolean, authorization?: FlashcardWriteAuthorization) => {
    return saveFlashcards(store, removedCardIds, resetReviewProgress, authorization);
  });

  ipcMain.handle(IPC_CHANNELS.SAVE_REVIEW_PRESENTATION, (_event, command: ReviewPresentationWrite) => saveReviewPresentation(command));

  ipcMain.handle(IPC_CHANNELS.SAVE_FLASHCARD_PATCH, (_event, patch: StorePatch, removedCardIds?: string[], resetReviewProgress?: boolean, authorization?: FlashcardWriteAuthorization) => {
    return saveFlashcardPatch(patch, removedCardIds, resetReviewProgress, authorization);
  });

}
