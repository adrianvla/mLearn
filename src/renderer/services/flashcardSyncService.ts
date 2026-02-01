/**
 * Flashcard Sync Service
 * Handles peer-to-peer flashcard syncing via WebRTC (like the old app's connect module)
 * Uses QR codes for connection establishment
 *
 * Updated to work with new UUID-keyed FlashcardStore format (v2)
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
 * Updated for new UUID-keyed Record format (v2)
 *
 * Merge strategy:
 * - Flashcards: Use wordToCardMap for deduplication, keep card with more reviews or higher lastUpdated
 * - wordCandidates: Keep max counts and latest lastSeen
 * - knownUntracked: Union of both sets
 * - meta: Preserve local settings, update date if remote is today
 */
export async function mergeFlashcards(
    localStore: FlashcardStore,
    remoteStore: FlashcardStore
): Promise<FlashcardStore> {
  // Start with a deep copy of local store
  const merged: FlashcardStore = JSON.parse(JSON.stringify(localStore));

  // Merge knownUntracked (union)
  if (remoteStore.knownUntracked) {
    for (const [wordHash, value] of Object.entries(remoteStore.knownUntracked)) {
      if (value) {
        merged.knownUntracked[wordHash] = true;
      }
    }
  }

  // Merge wordCandidates (keep max count and latest lastSeen)
  if (remoteStore.wordCandidates) {
    for (const [key, value] of Object.entries(remoteStore.wordCandidates)) {
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
          reading: myValue.reading || remoteCandidate.reading,
        };
      }
    }
  }

  // Merge flashcards using new Record format
  // Build reverse lookup from wordToCardMap
  const remoteWordToCard: Record<string, string> = remoteStore.wordToCardMap || {};
  const localWordToCard: Record<string, string> = merged.wordToCardMap || {};

  for (const [wordHash, remoteCardId] of Object.entries(remoteWordToCard)) {
    const remoteCard = remoteStore.flashcards[remoteCardId];
    if (!remoteCard) continue;

    const localCardId = localWordToCard[wordHash];

    if (!localCardId) {
      // Card doesn't exist locally - add it with a new local UUID
      // Keep the remote card's ID to avoid conflicts if it comes from same source
      merged.flashcards[remoteCardId] = remoteCard;
      merged.wordToCardMap[wordHash] = remoteCardId;
    } else {
      // Card exists in both - merge based on review history
      const localCard = merged.flashcards[localCardId];
      if (!localCard) {
        // Local map points to non-existent card, use remote
        merged.flashcards[remoteCardId] = remoteCard;
        merged.wordToCardMap[wordHash] = remoteCardId;
        continue;
      }

      // Decide which card to keep:
      // 1. Prefer card with more reviews (more learning data)
      // 2. If same reviews, prefer more recent lastUpdated
      // 3. Merge content if one has more data
      const localReviews = localCard.reviews || 0;
      const remoteReviews = remoteCard.reviews || 0;
      const localUpdated = localCard.lastUpdated || 0;
      const remoteUpdated = remoteCard.lastUpdated || 0;

      if (remoteReviews > localReviews ||
          (remoteReviews === localReviews && remoteUpdated > localUpdated)) {
        // Use remote card's SRS data but merge content
        const mergedCard: Flashcard = {
          ...remoteCard,
          content: {
            ...localCard.content,
            ...remoteCard.content,
            // Keep longer example/image data
            example: (remoteCard.content.example?.length || 0) > (localCard.content.example?.length || 0)
                ? remoteCard.content.example
                : localCard.content.example,
            imageUrl: remoteCard.content.imageUrl || localCard.content.imageUrl,
          },
        };
        merged.flashcards[localCardId] = mergedCard;
      } else {
        // Keep local card's SRS data but potentially update content
        if (remoteUpdated > localUpdated) {
          merged.flashcards[localCardId].content = {
            ...localCard.content,
            ...remoteCard.content,
          };
          merged.flashcards[localCardId].lastUpdated = remoteUpdated;
        }
      }
    }
  }

  // Also add any remote cards not in wordToCardMap (orphaned cards)
  for (const [cardId, remoteCard] of Object.entries(remoteStore.flashcards)) {
    if (!merged.flashcards[cardId]) {
      merged.flashcards[cardId] = remoteCard;
      // Try to add to wordToCardMap
      const word = remoteCard.content.front;
      if (word) {
        const wordHash = await toUniqueIdentifier(word);
        if (!merged.wordToCardMap[wordHash]) {
          merged.wordToCardMap[wordHash] = cardId;
        }
      }
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
