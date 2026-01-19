/**
 * Flashcard Storage Service
 * Handles persistence and IPC for flashcard data
 */

import fs from 'fs';
import path from 'path';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { FlashcardStore } from '../../shared/types';
import { getUserDataPath } from '../utils/platform';

// Default flashcard store (matching old app structure)
const DEFAULT_FLASHCARD_STORE: FlashcardStore = {
  flashcards: [],
  wordCandidates: {},
  alreadyCreated: {},
  knownUnTracked: {},
  meta: {
    flashcardsCreatedToday: 0,
    lastFlashcardCreatedDate: Date.now(),
  },
  version: 1,
};

// Get flashcard storage path
function getFlashcardsPath(): string {
  return path.join(getUserDataPath(), 'flashcards.json');
}

// Check and fill missing fields in loaded flashcard store
function checkFlashcards(fc_to_check: Partial<FlashcardStore>): FlashcardStore {
  const result = { ...DEFAULT_FLASHCARD_STORE };
  for (const key of Object.keys(DEFAULT_FLASHCARD_STORE) as (keyof FlashcardStore)[]) {
    if (fc_to_check[key] !== undefined) {
      (result as any)[key] = fc_to_check[key];
    }
  }
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
  
  for (const flashcard of store.flashcards) {
    if (flashcard.content?.word) {
      map[flashcard.content.word] = flashcard.ease;
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
