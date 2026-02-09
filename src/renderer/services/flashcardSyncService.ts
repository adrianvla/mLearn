/**
 * Flashcard Sync Service
 * Handles peer-to-peer flashcard syncing via WebRTC (like the old app's connect module)
 * Uses QR codes for connection establishment
 *
 * Updated to work with new UUID-keyed FlashcardStore format (v3)
 * Supports multiple flashcards per word with O(1) word stats lookup
 */

import type { FlashcardStore, Flashcard, WordCandidate, WordStats, FlashcardState } from '../../shared/types';

// Chunk size for sending data over WebRTC
const CHUNK_SIZE = 16000;

// Max buffered bytes before waiting for drain
const MAX_BUFFERED_AMOUNT = 64 * 1024;

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
 * Merge incoming flashcards with local flashcards
 * Updated for new UUID-keyed Record format (v3) with multiple cards per word
 *
 * Merge strategy:
 * - Flashcards: Merge all cards, deduplicate by ID
 * - wordToCardMap: Merge arrays of card IDs per word
 * - wordStatsMap: Recalculate from merged flashcards
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

  // Merge flashcards - add all remote cards that don't exist locally
  // If same ID exists, keep the one with more reviews or latest update
  for (const [cardId, remoteCard] of Object.entries(remoteStore.flashcards)) {
    const localCard = merged.flashcards[cardId];
    
    if (!localCard) {
      // Card doesn't exist locally - add it
      merged.flashcards[cardId] = remoteCard;
    } else {
      // Card exists in both - merge based on review history
      const localReviews = localCard.reviews || 0;
      const remoteReviews = remoteCard.reviews || 0;
      const localUpdated = localCard.lastUpdated || 0;
      const remoteUpdated = remoteCard.lastUpdated || 0;

      if (remoteReviews > localReviews ||
          (remoteReviews === localReviews && remoteUpdated > localUpdated)) {
        // Use remote card's SRS data but merge content
        merged.flashcards[cardId] = {
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
      } else if (remoteUpdated > localUpdated) {
        // Keep local SRS data but update content
        merged.flashcards[cardId].content = {
          ...localCard.content,
          ...remoteCard.content,
        };
        merged.flashcards[cardId].lastUpdated = remoteUpdated;
      }
    }
  }

  // Rebuild wordToCardMap from all flashcards
  const newWordToCardMap: Record<string, string[]> = {};
  for (const [cardId, card] of Object.entries(merged.flashcards)) {
    const word = card.content.front;
    if (word) {
      const wordHash = await toUniqueIdentifier(word);
      if (!newWordToCardMap[wordHash]) {
        newWordToCardMap[wordHash] = [];
      }
      if (!newWordToCardMap[wordHash].includes(cardId)) {
        newWordToCardMap[wordHash].push(cardId);
      }
    }
  }
  merged.wordToCardMap = newWordToCardMap;

  // Rebuild wordStatsMap from merged flashcards
  const newWordStatsMap: Record<string, WordStats> = {};
  for (const [wordHash, cardIds] of Object.entries(merged.wordToCardMap)) {
    const cards = cardIds.map(id => merged.flashcards[id]).filter(Boolean);
    if (cards.length > 0) {
      newWordStatsMap[wordHash] = calculateWordStats(cards);
    }
  }
  merged.wordStatsMap = newWordStatsMap;

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

/**
 * Wait until the data channel's buffered amount drops below the threshold.
 * Falls back to a polling interval if the `bufferedamountlow` event isn't available.
 */
function waitForBufferDrain(channel: RTCDataChannel): Promise<void> {
  return new Promise<void>((resolve) => {
    const check = () => {
      if (channel.bufferedAmount <= MAX_BUFFERED_AMOUNT) {
        resolve();
      } else {
        setTimeout(check, 5);
      }
    };
    setTimeout(check, 5);
  });
}

/**
 * Send chunked data over a SimplePeer connection with backpressure handling.
 * Prevents "RTCDataChannel send queue is full" by waiting for the buffer to drain
 * between sends when it exceeds `MAX_BUFFERED_AMOUNT`.
 */
export async function sendChunkedWithBackpressure(
  peer: SimplePeerInstance,
  type: string,
  payload: string,
): Promise<void> {
  const chunks = splitTextIntoChunks(payload, CHUNK_SIZE);
  const channel: RTCDataChannel | undefined = (peer as any)._channel;

  for (let i = 0; i < chunks.length; i++) {
    if (channel && channel.bufferedAmount > MAX_BUFFERED_AMOUNT) {
      await waitForBufferDrain(channel);
    }

    peer.send(JSON.stringify({
      type: `${type}-chunk`,
      data: [i, chunks[i], chunks.length],
    }));
  }
}

// Re-export types for convenience
export type { FlashcardStore, Flashcard };
