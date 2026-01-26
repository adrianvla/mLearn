/**
 * Flashcard Sync Service
 * Handles peer-to-peer flashcard syncing via WebRTC (like the old app's connect module)
 * Uses QR codes for connection establishment
 */

import type { FlashcardStore, Flashcard, WordCandidate } from '../../shared/types';

// Chunk size for sending data over WebRTC (must be small for reliability)
const CHUNK_SIZE = 1000;

// QR code chunk size for signal data
const QR_CHUNK_SIZE = 60;

export interface SyncChunk {
  type: string;
  data: [number, string, number]; // [index, chunk, total]
}

export interface SyncCallbacks {
  onStatusUpdate: (status: string) => void;
  onProgress: (current: number, total: number) => void;
  onQRData: (data: string) => void;
  onConnected: () => void;
  onSyncComplete: (mergedStore: FlashcardStore) => void;
  onError: (error: string) => void;
}

/**
 * Split text into chunks for transmission
 */
export function splitTextIntoChunks(text: string, chunkSize: number = CHUNK_SIZE): string[] {
  if (typeof text !== 'string') {
    throw new TypeError('First argument must be a string');
  }
  if (typeof chunkSize !== 'number' || chunkSize <= 0) {
    throw new RangeError('Chunk size must be a positive number');
  }

  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Split data into QR code friendly chunks
 */
export function splitForQR(data: string): string[] {
  const numberOfChunks = Math.ceil(data.length / QR_CHUNK_SIZE);
  const chunkSize = Math.ceil(data.length / numberOfChunks);
  const chunks: string[] = [];
  for (let i = 0; i < data.length; i += chunkSize) {
    chunks.push(data.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Generate unique identifier for a word (SHA-256 hash)
 */
export async function toUniqueIdentifier(word: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(word);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Merge incoming flashcards with local flashcards
 * Uses the same merge logic as the old app's sync.js
 */
export async function mergeFlashcards(
  localStore: FlashcardStore,
  remoteStore: FlashcardStore
): Promise<FlashcardStore> {
  const merged: FlashcardStore = JSON.parse(JSON.stringify(localStore));
  
  // Merge alreadyCreated
  for (const [key, value] of Object.entries(remoteStore.alreadyCreated || {})) {
    merged.alreadyCreated[key] = value;
  }
  
  // Merge wordCandidates (keep max count)
  // Note: Old app sometimes stored wordCandidates as raw numbers, new app uses WordCandidate objects
  for (const [key, value] of Object.entries(remoteStore.wordCandidates || {})) {
    const myValue = merged.wordCandidates[key];
    const remoteCandidate = typeof value === 'number' 
      ? { count: value, lastSeen: Date.now(), word: key }
      : value as WordCandidate;
    
    if (!myValue) {
      merged.wordCandidates[key] = remoteCandidate;
    } else {
      // Both exist - merge by taking max values
      merged.wordCandidates[key] = {
        word: myValue.word || remoteCandidate.word || key,
        count: Math.max(myValue.count || 0, remoteCandidate.count || 0),
        lastSeen: Math.max(myValue.lastSeen || 0, remoteCandidate.lastSeen || 0),
      };
    }
  }
  
  // Build hash maps for flashcard lookup
  const otherHashMap: Record<string, number> = {};
  const myHashMap: Record<string, number> = {};
  
  for (let i = 0; i < (remoteStore.flashcards || []).length; i++) {
    const word = remoteStore.flashcards[i]?.content?.word;
    if (word) {
      const uuid = await toUniqueIdentifier(word);
      otherHashMap[uuid] = i;
    }
  }
  
  for (let i = 0; i < merged.flashcards.length; i++) {
    const word = merged.flashcards[i]?.content?.word;
    if (word) {
      const uuid = await toUniqueIdentifier(word);
      myHashMap[uuid] = i;
    }
  }
  
  // Add cards that don't exist locally
  for (const [key, remoteIndex] of Object.entries(otherHashMap)) {
    if (!(key in myHashMap)) {
      merged.flashcards.push(remoteStore.flashcards[remoteIndex]);
    }
  }
  
  // Update hash map with new cards
  for (let i = 0; i < merged.flashcards.length; i++) {
    const word = merged.flashcards[i]?.content?.word;
    if (word) {
      const uuid = await toUniqueIdentifier(word);
      myHashMap[uuid] = i;
    }
  }
  
  // Update cards that exist in both based on lastUpdated timestamp
  for (const [key, remoteIndex] of Object.entries(otherHashMap)) {
    if (!(key in myHashMap)) continue;
    
    const localIndex = myHashMap[key];
    const otherCard = remoteStore.flashcards[remoteIndex];
    const myCard = merged.flashcards[localIndex];
    
    if (otherCard?.content?.word !== myCard?.content?.word) {
      console.error('Word mismatch during merge', myCard, otherCard);
      continue;
    }
    
    // Use the more recently updated card
    if ((myCard.lastUpdated || 0) < (otherCard.lastUpdated || 0)) {
      merged.flashcards[localIndex] = otherCard;
    }
  }
  
  return merged;
}

/**
 * Chunk collector for assembling fragmented data
 */
export class ChunkCollector {
  private chunks: Record<number, string> = {};
  private totalChunks: number = 0;
  
  addChunk(index: number, data: string, total: number): boolean {
    this.totalChunks = total;
    this.chunks[index] = data;
    return this.isComplete();
  }
  
  isComplete(): boolean {
    return Object.keys(this.chunks).length === this.totalChunks && this.totalChunks > 0;
  }
  
  getProgress(): { current: number; total: number } {
    return { current: Object.keys(this.chunks).length, total: this.totalChunks };
  }
  
  assemble(): string {
    let data = '';
    for (let i = 0; i < this.totalChunks; i++) {
      if (!(i in this.chunks)) {
        throw new Error(`Missing chunk ${i}`);
      }
      data += this.chunks[i];
    }
    return data;
  }
  
  reset(): void {
    this.chunks = {};
    this.totalChunks = 0;
  }
}

// Re-export types for convenience
export type { FlashcardStore, Flashcard };
