import { DEFAULT_SETTINGS, type FlashcardStore, type Flashcard, type WordCandidate, type WordStats, type FlashcardState } from '../../shared/types';
import { SRS_EASE } from '../../shared/constants';

const CHUNK_SIZE = 16000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 800;

const WORKER_API_URL = 'https://mlearn-cloud.kikan.net';

export interface SyncRoom {
  roomId: string;
  roomCode: string;
  status: string;
  createdAt: string;
  expiresAt: string;
}

export interface SyncRoomResponse {
  data: SyncRoom;
  actions: Record<string, unknown>;
}

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

export async function toUniqueIdentifier(word: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(word);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function compareStates(a: FlashcardState, b: FlashcardState): number {
  const order: Record<FlashcardState, number> = { 'new': 0, 'learning': 1, 'relearning': 2, 'review': 3 };
  return order[a] - order[b];
}

function calculateWordStats(cards: Flashcard[]): WordStats {
  if (cards.length === 0) {
    return {
      cardCount: 0,
      bestEase: SRS_EASE.DEFAULT_KNOWN,
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

function stripMediaUrls(store: FlashcardStore): FlashcardStore {
  const stripped = JSON.parse(JSON.stringify(store)) as FlashcardStore;

  for (const card of Object.values(stripped.flashcards)) {
    if (card.content) {
      const content = card.content as unknown as Record<string, unknown>;
      delete content.imageUrl;
      delete content.audioUrl;
      delete content.videoUrl;
    }
  }

  return stripped;
}

export async function mergeFlashcards(
    localStore: FlashcardStore,
    remoteStore: FlashcardStore
): Promise<FlashcardStore> {
  const merged: FlashcardStore = JSON.parse(JSON.stringify(localStore));

  if (remoteStore.knownUntracked) {
    for (const [wordHash, value] of Object.entries(remoteStore.knownUntracked)) {
      if (value) {
        merged.knownUntracked[wordHash] = true;
      }
    }
  }

  if (remoteStore.wordCandidates) {
    for (const [key, value] of Object.entries(remoteStore.wordCandidates)) {
      const myValue = merged.wordCandidates[key];
      const remoteCandidate = typeof value === 'number'
          ? { count: value, lastSeen: Date.now(), word: key }
          : value as WordCandidate;

      if (!myValue) {
        merged.wordCandidates[key] = remoteCandidate;
      } else {
        merged.wordCandidates[key] = {
          word: myValue.word || remoteCandidate.word || key,
          count: Math.max(myValue.count || 0, remoteCandidate.count || 0),
          lastSeen: Math.max(myValue.lastSeen || 0, remoteCandidate.lastSeen || 0),
          reading: myValue.reading || remoteCandidate.reading,
        };
      }
    }
  }

  for (const [cardId, remoteCard] of Object.entries(remoteStore.flashcards)) {
    const localCard = merged.flashcards[cardId];
    
    if (!localCard) {
      merged.flashcards[cardId] = remoteCard;
    } else {
      const localReviews = localCard.reviews || 0;
      const remoteReviews = remoteCard.reviews || 0;
      const localUpdated = localCard.lastUpdated || 0;
      const remoteUpdated = remoteCard.lastUpdated || 0;

      if (remoteReviews > localReviews ||
          (remoteReviews === localReviews && remoteUpdated > localUpdated)) {
        merged.flashcards[cardId] = {
          ...remoteCard,
          content: {
            ...localCard.content,
            ...remoteCard.content,
            example: (remoteCard.content.example?.length || 0) > (localCard.content.example?.length || 0)
                ? remoteCard.content.example
                : localCard.content.example,
            imageUrl: localCard.content.imageUrl || remoteCard.content.imageUrl,
          },
        };
      } else if (remoteUpdated > localUpdated) {
        merged.flashcards[cardId].content = {
          ...localCard.content,
          ...remoteCard.content,
        };
        merged.flashcards[cardId].lastUpdated = remoteUpdated;
      }
    }
  }

  const newWordToCardMap: Record<string, string[]> = {};
  for (const [cardId, card] of Object.entries(merged.flashcards)) {
    const word = card.content.front;
    if (word) {
      const wordHash = await toUniqueIdentifier(word);
      const lang = card.language || DEFAULT_SETTINGS.language;
      const lk = lang + ':' + wordHash;
      if (!newWordToCardMap[lk]) {
        newWordToCardMap[lk] = [];
      }
      if (!newWordToCardMap[lk].includes(cardId)) {
        newWordToCardMap[lk].push(cardId);
      }
    }
  }
  merged.wordToCardMap = newWordToCardMap;

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

export async function createSyncRoom(accessToken: string): Promise<SyncRoomResponse> {
  const response = await fetch(`${WORKER_API_URL}/api/flashcard-sync/rooms`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Authentication required. Please sign in to sync.');
    }
    throw new Error(`Failed to create sync room: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<SyncRoomResponse>;
}

export function buildSyncSocketUrl(roomId: string, role: 'sender' | 'receiver'): string {
  const workerUrl = new URL(WORKER_API_URL);
  const protocol = workerUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${workerUrl.host}/api/flashcard-sync/rooms/${roomId}/socket?_role=${role}`;
}

export interface SyncSocketMessage {
  type: 'offer' | 'request_chunk' | 'chunk_data' | 'chunk_received' | 'complete' | 'error' | 'peer_connected' | 'peer_disconnected';
  index?: number;
  data?: string;
  totalChunks?: number;
  totalSize?: number;
  message?: string;
  role?: 'sender' | 'receiver';
}

export class SyncSocketClient {
  private ws: WebSocket | null = null;
  private roomId: string;
  private role: 'sender' | 'receiver';
  private accessToken: string;
  private onMessageCallback: ((msg: SyncSocketMessage) => void) | null = null;
  private onOpenCallback: (() => void) | null = null;
  private onCloseCallback: (() => void) | null = null;
  private onErrorCallback: ((error: string) => void) | null = null;

  constructor(roomId: string, role: 'sender' | 'receiver', accessToken: string) {
    this.roomId = roomId;
    this.role = role;
    this.accessToken = accessToken;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const attempt = (retriesLeft: number) => {
        const url = buildSyncSocketUrl(this.roomId, this.role);
        this.ws = new WebSocket(url, ['mlearn-flashcard-sync-v1', this.accessToken]);

        this.ws.onopen = () => {
          this.onOpenCallback?.();
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data as string) as SyncSocketMessage;
            this.onMessageCallback?.(msg);
          } catch {
            this.onErrorCallback?.('Invalid message received');
          }
        };

        this.ws.onclose = () => {
          this.onCloseCallback?.();
        };

        this.ws.onerror = () => {
          if (retriesLeft > 0) {
            this.ws = null;
            setTimeout(() => attempt(retriesLeft - 1), RETRY_DELAY_MS);
          } else {
            this.onErrorCallback?.('WebSocket connection failed');
            reject(new Error('WebSocket connection failed'));
          }
        };
      };

      attempt(MAX_RETRIES);
    });
  }

  send(message: SyncSocketMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  onMessage(callback: (msg: SyncSocketMessage) => void): void {
    this.onMessageCallback = callback;
  }

  onOpen(callback: () => void): void {
    this.onOpenCallback = callback;
  }

  onClose(callback: () => void): void {
    this.onCloseCallback = callback;
  }

  onError(callback: (error: string) => void): void {
    this.onErrorCallback = callback;
  }
}

export { stripMediaUrls };
export type { FlashcardStore, Flashcard };
