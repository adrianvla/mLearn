/**
 * Flashcard Storage Service
 * Handles persistence and IPC for flashcard data
 */

import fs from 'fs';
import path from 'path';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { FlashcardStore, WordStats, Flashcard, FlashcardState } from '../../shared/types';
import { getUserDataPath } from '../utils/platform';

// Current store version - increment when making breaking changes
const CURRENT_VERSION = 3;

// Default flashcard store (matching new UUID-keyed structure)
const DEFAULT_FLASHCARD_STORE: FlashcardStore = {
  flashcards: {},
  wordCandidates: {},
  wordToCardMap: {},
  wordStatsMap: {},
  knownUntracked: {},
  meta: {
    newCardsToday: 0,
    newCardsDate: new Date().toISOString().split('T')[0],
    maxNewCardsPerDay: 10,
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
    meta: { ...DEFAULT_FLASHCARD_STORE.meta, ...store.meta },
    dailyStats: store.dailyStats || {},
    version: CURRENT_VERSION,
  };
}

// Check and fill missing fields in loaded flashcard store, with migrations
function checkFlashcards(fc_to_check: any): FlashcardStore {
  // Handle version migrations
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
  });

  ipcMain.on(IPC_CHANNELS.SAVE_FLASHCARDS, (_event, store: FlashcardStore) => {
    saveFlashcards(store);
  });
}
