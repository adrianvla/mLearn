/**
 * Flashcard Storage Service
 * Handles persistence and IPC for flashcard data
 */

import fs from 'fs';
import path from 'path';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { FlashcardStore, WordStats, Flashcard, FlashcardState, WordCandidate, FlashcardContent } from '../../shared/types';
import { getUserDataPath } from '../utils/platform';

// Current store version - increment when making breaking changes
const CURRENT_VERSION = 4;

// Migration tracking - sent to renderer to notify user
let migrationInfo: { occurred: boolean; backupPath: string | null; fromVersion: number | null } = {
  occurred: false,
  backupPath: null,
  fromVersion: null,
};

// Default flashcard store (matching new UUID-keyed structure)
const DEFAULT_FLASHCARD_STORE: FlashcardStore = {
  flashcards: {},
  wordCandidates: {},
  wordToCardMap: {},
  wordStatsMap: {},
  knownUntracked: {},
  wordKnowledge: {},
  grammarKnowledge: {},
  meta: {
    newCardsToday: 0,
    reviewsToday: 0,
    newCardsDate: new Date().toISOString().split('T')[0],
    maxNewCardsPerDay: 10,
    maxNewCardsPerDayLearning: 20,
    maxReviewsPerDay: -1, // -1 = unlimited
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

// Get flashcard storage path
function getFlashcardsPath(): string {
  return path.join(getUserDataPath(), 'flashcards.json');
}

/**
 * Compare flashcard states - returns positive if a is "better" than b
 */
function compareStates(a: FlashcardState, b: FlashcardState): number {
  const order: Record<FlashcardState, number> = { 'new': 0, 'learning': 1, 'relearning': 2, 'review': 3 };
  return order[a] - order[b];
}

/**
 * Calculate aggregated word stats from all cards for a word
 */
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

/**
 * Migrate from v2 (single card per word) to v3 (multiple cards per word)
 */
function migrateV2ToV3(store: any): FlashcardStore {
  console.log('Migrating flashcard store from v2 to v3...');
  
  const newWordToCardMap: Record<string, string[]> = {};
  const wordStatsMap: Record<string, WordStats> = {};
  
  // Convert wordToCardMap from Record<string, string> to Record<string, string[]>
  if (store.wordToCardMap) {
    for (const [wordHash, cardId] of Object.entries(store.wordToCardMap)) {
      if (typeof cardId === 'string') {
        newWordToCardMap[wordHash] = [cardId];
      } else if (Array.isArray(cardId)) {
        // Already an array (shouldn't happen but handle gracefully)
        newWordToCardMap[wordHash] = cardId as string[];
      }
    }
  }
  
  // Build wordStatsMap from flashcards
  const wordToCards: Record<string, Flashcard[]> = {};
  for (const [wordHash, cardIds] of Object.entries(newWordToCardMap)) {
    const cards: Flashcard[] = [];
    for (const cardId of cardIds) {
      const card = store.flashcards?.[cardId];
      if (card) cards.push(card);
    }
    wordToCards[wordHash] = cards;
  }
  
  for (const [wordHash, cards] of Object.entries(wordToCards)) {
    wordStatsMap[wordHash] = calculateWordStats(cards);
  }
  
  return {
    flashcards: store.flashcards || {},
    wordCandidates: store.wordCandidates || {},
    wordToCardMap: newWordToCardMap,
    wordStatsMap,
    knownUntracked: store.knownUntracked || {},
    wordKnowledge: store.wordKnowledge || {},
    grammarKnowledge: store.grammarKnowledge || {},
    meta: { ...DEFAULT_FLASHCARD_STORE.meta, ...store.meta },
    dailyStats: store.dailyStats || {},
    version: CURRENT_VERSION,
  };
}

/**
 * Generate a simple UUID-like string
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Synchronous word hash using Node's crypto (for migration)
 */
function generateWordHashSync(word: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(word).digest('hex');
  return hash.substring(0, 16);
}

/**
 * V1 flashcard content structure (from old app)
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
 * V1 flashcard structure (from old app)
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
 * V1 store structure (from old app)
 */
interface V1FlashcardStore {
  flashcards: V1Flashcard[];  // Array in v1, object in v2+
  wordCandidates: Record<string, number | { count: number; lastSeen: number; word: string }>;
  alreadyCreated: Record<string, boolean>;
  knownUnTracked: Record<string, boolean>;  // Capital T in v1
  meta: {
    flashcardsCreatedToday: number;
    lastFlashcardCreatedDate: number;
  };
}

/**
 * Detect if the store is v1 format (old app)
 */
function isV1Store(store: any): store is V1FlashcardStore {
  // V1 has flashcards as an array, not an object
  // V1 also has knownUnTracked (capital T) and alreadyCreated
  return Array.isArray(store.flashcards) || 
         store.alreadyCreated !== undefined || 
         store.knownUnTracked !== undefined;
}

/**
 * Create backup of old flashcards file
 */
function createBackup(originalPath: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = originalPath.replace('.json', `-backup-v1-${timestamp}.json`);
  
  if (fs.existsSync(originalPath)) {
    const data = fs.readFileSync(originalPath, 'utf-8');
    fs.writeFileSync(backupPath, data);
    console.log(`Created backup at: ${backupPath}`);
  }
  
  return backupPath;
}

/**
 * Migrate from v1 (old app format) to v3 (new format)
 */
function migrateV1ToV3(store: V1FlashcardStore, backupPath: string): FlashcardStore {
  console.log('Migrating flashcard store from v1 (old app) to v3...');
  
  // Track migration for notification
  migrationInfo = {
    occurred: true,
    backupPath,
    fromVersion: 1,
  };
  
  const newFlashcards: Record<string, Flashcard> = {};
  const wordToCardMap: Record<string, string[]> = {};
  const wordStatsMap: Record<string, WordStats> = {};
  const newWordCandidates: Record<string, WordCandidate> = {};
  
  // Convert array of flashcards to UUID-keyed object
  for (const v1Card of store.flashcards || []) {
    if (!v1Card.content?.word) continue;
    
    const word = v1Card.content.word;
    const wordHash = generateWordHashSync(word);
    const cardId = generateUUID();
    
    // Convert v1 ease (0-10 scale roughly) to v3 ease (2.5 default, min 1.3)
    // Old app ease was based on countToEase and knownStatusToEaseFunction
    // countToEase: Math.atan(x/10)+1.01 (roughly 1-2.5 range)
    // knownStatusToEaseFunction: Math.max((status-1)*0.25,0) + 1.3 (1.3-1.8 range)
    const v1Ease = v1Card.ease || 0;
    let newEase = 2.5;
    if (v1Ease > 0) {
      // Scale from v1 range (roughly 1-3) to v3 range (1.3-3.0)
      newEase = Math.max(1.3, Math.min(3.0, v1Ease * 1.2));
    }
    
    // Determine state based on ease and reviews
    let state: FlashcardState = 'new';
    if (v1Card.reviews > 0) {
      if (newEase >= 2.5) {
        state = 'review';
      } else {
        state = 'learning';
      }
    }
    
    // Convert v1 content to v3 content
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
      // Legacy fields for backwards compatibility
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
    
    // Calculate interval from due date and last reviewed
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
    
    // Map word to card
    if (!wordToCardMap[wordHash]) {
      wordToCardMap[wordHash] = [];
    }
    wordToCardMap[wordHash].push(cardId);
  }
  
  // Build word stats
  for (const [wordHash, cardIds] of Object.entries(wordToCardMap)) {
    const cards = cardIds.map(id => newFlashcards[id]).filter(Boolean);
    wordStatsMap[wordHash] = calculateWordStats(cards);
  }
  
  // Convert word candidates
  for (const [key, value] of Object.entries(store.wordCandidates || {})) {
    if (typeof value === 'number') {
      // Old format: just a count
      newWordCandidates[key] = {
        count: value,
        lastSeen: Date.now(),
        word: '', // We don't have the word text in this case
      };
    } else if (typeof value === 'object' && value !== null) {
      newWordCandidates[key] = {
        count: value.count || 0,
        lastSeen: value.lastSeen || Date.now(),
        word: value.word || '',
      };
    }
  }
  
  // Convert knownUnTracked (capital T) to knownUntracked (lowercase)
  const knownUntracked: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(store.knownUnTracked || {})) {
    knownUntracked[key] = value;
  }
  
  // Convert meta
  const today = new Date().toISOString().split('T')[0];
  const meta = {
    ...DEFAULT_FLASHCARD_STORE.meta,
    newCardsToday: store.meta?.flashcardsCreatedToday || 0,
    newCardsDate: today,
  };
  
  console.log(`Migrated ${Object.keys(newFlashcards).length} flashcards from v1 to v3`);
  
  return {
    flashcards: newFlashcards,
    wordCandidates: newWordCandidates,
    wordToCardMap,
    wordStatsMap,
    knownUntracked,
    wordKnowledge: {},
    grammarKnowledge: {},
    meta,
    dailyStats: {},
    version: CURRENT_VERSION,
  };
}

// Check and fill missing fields in loaded flashcard store, with migrations
function checkFlashcards(fc_to_check: any): FlashcardStore {
  // Detect v1 (old app format) first
  if (isV1Store(fc_to_check)) {
    const backupPath = createBackup(getFlashcardsPath());
    fc_to_check = migrateV1ToV3(fc_to_check as V1FlashcardStore, backupPath);
    return fc_to_check;
  }
  
  // Handle version migrations for v2+
  const version = fc_to_check.version || 1;
  
  if (version < 3) {
    fc_to_check = migrateV2ToV3(fc_to_check);
  }
  
  // Ensure all required fields exist
  const result: FlashcardStore = {
    flashcards: fc_to_check.flashcards || {},
    wordCandidates: fc_to_check.wordCandidates || {},
    wordToCardMap: fc_to_check.wordToCardMap || {},
    wordStatsMap: fc_to_check.wordStatsMap || {},
    knownUntracked: fc_to_check.knownUntracked || {},
    wordKnowledge: fc_to_check.wordKnowledge || {},
    grammarKnowledge: fc_to_check.grammarKnowledge || {},
    meta: { ...DEFAULT_FLASHCARD_STORE.meta, ...fc_to_check.meta },
    dailyStats: fc_to_check.dailyStats || {},
    version: CURRENT_VERSION,
  };
  
  return result;
}

// Load flashcards from disk
export function loadFlashcards(): FlashcardStore {
  try {
    const filePath = getFlashcardsPath();
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      const loaded = JSON.parse(data) as Partial<FlashcardStore>;
      return checkFlashcards(loaded);
    }
  } catch (error) {
    console.error('Failed to load flashcards:', error);
  }
  return { ...DEFAULT_FLASHCARD_STORE };
}

// Save flashcards to disk
export function saveFlashcards(store: FlashcardStore): void {
  try {
    const filePath = getFlashcardsPath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2));
  } catch (error) {
    console.error('Failed to save flashcards:', error);
  }
}

// Get flashcard ease as a hashmap for quick lookups
export function getFlashcardEaseMap(): Record<string, number> {
  const store = loadFlashcards();
  const map: Record<string, number> = {};
  
  for (const [, flashcard] of Object.entries(store.flashcards)) {
    if (flashcard.content?.front) {
      map[flashcard.content.front] = flashcard.ease;
    }
  }
  
  return map;
}

// Setup IPC handlers
export function setupFlashcardIPC(): void {
  ipcMain.on(IPC_CHANNELS.GET_FLASHCARDS, (event) => {
    const flashcards = loadFlashcards();
    event.reply(IPC_CHANNELS.FLASHCARDS_LOADED, flashcards);
    
    // If migration occurred, notify the renderer
    if (migrationInfo.occurred) {
      event.reply(IPC_CHANNELS.FLASHCARD_MIGRATION_COMPLETE, migrationInfo);
      // Reset after sending to prevent multiple notifications
      migrationInfo = { occurred: false, backupPath: null, fromVersion: null };
    }
  });

  ipcMain.on(IPC_CHANNELS.SAVE_FLASHCARDS, (_event, store: FlashcardStore) => {
    saveFlashcards(store);
  });
  
  // Handler to get migration info if needed
  ipcMain.on(IPC_CHANNELS.GET_FLASHCARD_MIGRATION_INFO, (event) => {
    event.reply(IPC_CHANNELS.FLASHCARD_MIGRATION_COMPLETE, migrationInfo);
  });
}

/**
 * Get migration info (for testing or checking status)
 */
export function getMigrationInfo() {
  return migrationInfo;
}
