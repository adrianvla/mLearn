/**
 * Flashcard Storage Service
 * Handles persistence and IPC for flashcard data
 */

import fs from 'fs';
import path from 'path';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { FlashcardStore, WordStats, Flashcard, FlashcardState, WordCandidate, FlashcardContent, DailyStudyStats } from '../../shared/types';
import { getUserDataPath } from '../utils/platform';
import { extractBase64Images } from './flashcardImageStorage';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger('electron.flashcardStorage');

const CURRENT_VERSION = 2;

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
    perLanguage: {
      ja: {
        newCardsToday: 0,
        reviewsToday: 0,
        newCardsDate: getTodayDateString(),
      },
    },
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

function compareStates(a: FlashcardState, b: FlashcardState): number {
  const order: Record<FlashcardState, number> = { 'new': 0, 'learning': 1, 'relearning': 2, 'review': 3 };
  return order[a] - order[b];
}

function calculateWordStats(cards: Flashcard[]): WordStats {
  if (cards.length === 0) {
    return {
      cardCount: 0,
      bestEase: 2.5,
      totalReviews: 0,
      totalLapses: 0,
      lastReviewed: 0,
      bestInterval: 0,
      bestState: 'new',
    };
  }

  let bestEase = 0;
  let totalReviews = 0;
  let totalLapses = 0;
  let lastReviewed = 0;
  let bestInterval = 0;
  let bestState: FlashcardState = 'new';

  for (const card of cards) {
    if (card.ease > bestEase) bestEase = card.ease;
    totalReviews += card.reviews || 0;
    totalLapses += card.lapses || 0;
    if (card.lastReviewed > lastReviewed) lastReviewed = card.lastReviewed;
    if (card.interval > bestInterval) bestInterval = card.interval;
    if (compareStates(card.state, bestState) > 0) bestState = card.state;
  }

  return {
    cardCount: cards.length,
    bestEase,
    totalReviews,
    totalLapses,
    lastReviewed,
    bestInterval,
    bestState,
  };
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
  if (!meta.perLanguage) {
    meta.perLanguage = {
      [defaultLanguage]: {
        newCardsToday: (meta as any).newCardsToday ?? 0,
        reviewsToday: (meta as any).reviewsToday ?? 0,
        newCardsDate: (meta as any).newCardsDate ?? getTodayDateString(),
      }
    };
  }

  const dailyStats: Record<string, Record<string, DailyStudyStats>> = {};
  for (const [date, stat] of Object.entries((store.dailyStats as any) || {})) {
    if (stat && typeof stat === 'object' && 'newCardsStudied' in stat) {
      dailyStats[date] = { [defaultLanguage]: stat as DailyStudyStats };
    } else {
      dailyStats[date] = stat as Record<string, DailyStudyStats>;
    }
  }

  const flashcards = { ...store.flashcards };
  for (const card of Object.values(flashcards)) {
    if (!card.language) card.language = defaultLanguage;
  }

  return { ...store, meta, dailyStats, flashcards, version: CURRENT_VERSION };
}

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

interface V1Flashcard {
  content: V1FlashcardContent;
  dueDate: number;
  lastReviewed: number;
  lastUpdated?: number;
  ease: number;
  reviews: number;
}

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

function isV1Store(store: any): store is V1FlashcardStore {
  return Array.isArray(store.flashcards) || 
         store.alreadyCreated !== undefined || 
         store.knownUnTracked !== undefined;
}

function createBackup(originalPath: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = originalPath.replace('.json', `-backup-v1-${timestamp}.json`);
  
  if (fs.existsSync(originalPath)) {
    const data = fs.readFileSync(originalPath, 'utf-8');
    fs.writeFileSync(backupPath, data);
    log.info(`Created backup at: ${backupPath}`);
  }
  
  return backupPath;
}

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
  
  for (const v1Card of store.flashcards || []) {
    if (!v1Card.content?.word) continue;
    
    const word = v1Card.content.word;
    const wordHash = generateWordHashSync(word);
    const cardId = generateUUID();
    
    const v1Ease = v1Card.ease || 0;
    let newEase = 2.5;
    if (v1Ease > 0) {
      newEase = Math.max(1.3, Math.min(3.0, v1Ease * 1.2));
    }
    
    let state: FlashcardState = 'new';
    if (v1Card.reviews > 0) {
      if (newEase >= 2.5) {
        state = 'review';
      } else {
        state = 'learning';
      }
    }
    
    const newContent: FlashcardContent = {
      type: 'word',
      front: word,
      back: Array.isArray(v1Card.content.translation) 
        ? v1Card.content.translation.join('; ') 
        : v1Card.content.translation || '',
      reading: v1Card.content.pronunciation,
      pitchAccent: v1Card.content.pitchAccent,
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
  result = migrateV6ToV7(result, 'ja');

  return result;
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
    version: CURRENT_VERSION,
  };

  return result;
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
