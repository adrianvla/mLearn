import type { FlashcardStore, Flashcard, LanguageDataMap, PassiveWordKnowledge, WordCandidate, WordStats } from '../../shared/types';
import { canonicalLanguage } from '../../shared/languageVariants';
import { canonicalKeyHash } from '../../shared/utils/canonicalWordKey';
import { calculateWordStats } from '../../shared/utils/wordStats';
import { hashWordSync } from './srsAlgorithm';
import { getLogger } from '../../shared/utils/logger';

const CHUNK_SIZE = 16000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 800;

const WORKER_API_URL = 'https://mlearn-cloud.kikan.net';
const log = getLogger('renderer.flashcardSync');

export interface SyncMergeCollision {
  source: 'sync-merge';
  loser: Flashcard;
  oldMapKeys: string[];
  survivorId: string;
}

export interface MergeFlashcardsOptions {
  languageData?: LanguageDataMap;
  onCardCollision?: (collision: SyncMergeCollision) => void;
}

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
    remoteStore: FlashcardStore,
    options: MergeFlashcardsOptions = {},
): Promise<FlashcardStore> {
  const merged: FlashcardStore = JSON.parse(JSON.stringify(localStore));
  const entryRecency = (entry: PassiveWordKnowledge): number => entry.claimAt ?? entry.lastStatusChange ?? entry.lastSeen;

  // Epistemic entries merge per-entry LWW (claim timestamp wins): a stale
  // device snapshot can no longer revert a newer claim/evidence write.
  if (remoteStore.wordKnowledge) {
    for (const [lk, remoteEntry] of Object.entries(remoteStore.wordKnowledge)) {
      const localEntry = merged.wordKnowledge[lk];
      if (!localEntry || entryRecency(remoteEntry) > entryRecency(localEntry)) {
        merged.wordKnowledge[lk] = remoteEntry;
      }
    }
  }

  // Legacy remote clients still send knownUntracked (pre-claims protocol).
  // Ingest recoverable entries as explicit known claims; orphan hashes stay
  // in the residue map until their word text can be recovered.
  if (remoteStore.knownUntracked) {
    for (const [wordHash, value] of Object.entries(remoteStore.knownUntracked)) {
      if (!value) continue;
      const word = remoteStore.ignoredWords?.[wordHash]?.word
        ?? remoteStore.wordKnowledge?.[wordHash]?.word
        ?? merged.wordKnowledge[wordHash]?.word;
      if (word) {
        const existing = merged.wordKnowledge[wordHash];
        merged.wordKnowledge[wordHash] = {
          ease: existing?.ease ?? 0,
          lastSeen: existing?.lastSeen ?? Date.now(),
          timesSeen: existing?.timesSeen ?? 0,
          timesHovered: existing?.timesHovered ?? 0,
          word,
          language: existing?.language,
          claim: 'known',
          claimAt: Math.max(existing?.claimAt ?? 0, Date.now()),
        };
      } else {
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
      merged.flashcards[cardId] = { ...remoteCard, content: { ...remoteCard.content } };
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

  const originalCards = new Map(
    Object.entries(merged.flashcards).map(([cardId, card]) => [cardId, JSON.parse(JSON.stringify(card)) as Flashcard]),
  );
  for (const card of Object.values(merged.flashcards)) {
    if (card.language) {
      card.language = canonicalLanguage(card.language, options.languageData);
    }
  }

  const canonicalKeyForCard = (card: Flashcard): string => {
    const language = card.language || 'und';
    return canonicalKeyHash(language, card.content.front, {
      hashWord: hashWordSync,
      languageData: options.languageData?.[language],
    });
  };

  const hasScriptConversion = (language: string): boolean => {
    const languageData = options.languageData?.[language];
    return Boolean(
      languageData?.textProcessing?.lexemeNormalization?.mappingTableAsset
      || Object.values(languageData?.variants ?? {}).some((variant) => variant.scriptConversion?.mappingAsset),
    );
  };

  const canonicalGroups = new Map<string, Array<[string, Flashcard]>>();
  for (const entry of Object.entries(merged.flashcards)) {
    const [, card] = entry;
    if (!card.content.front || !hasScriptConversion(card.language || 'und')) continue;
    const key = canonicalKeyForCard(card);
    const group = canonicalGroups.get(key) ?? [];
    group.push(entry);
    canonicalGroups.set(key, group);
  }

  const now = Date.now();
  for (const cards of canonicalGroups.values()) {
    if (cards.length < 2) continue;
    const sorted = [...cards].sort(([, left], [, right]) => {
      const reviewedDifference = (right.lastReviewed || 0) - (left.lastReviewed || 0);
      if (reviewedDifference) return reviewedDifference;
      const reviewDifference = (right.reviews || 0) - (left.reviews || 0);
      if (reviewDifference) return reviewDifference;
      return left.id.localeCompare(right.id);
    });
    const [survivorKey, survivor] = sorted[0];
    const oldMapKeys = cards.map(([, card]) => `${card.language || 'und'}:${hashWordSync(card.content.front)}`);
    const mergedCard: Flashcard = {
      ...survivor,
      dueDate: Math.min(...cards.map(([, card]) => card.dueDate)),
      lastReviewed: Math.max(...cards.map(([, card]) => card.lastReviewed || 0)),
      createdAt: Math.min(...cards.map(([, card]) => card.createdAt)),
      lastUpdated: now,
      reviews: cards.reduce((total, [, card]) => total + (card.reviews || 0), 0),
      lapses: cards.reduce((total, [, card]) => total + (card.lapses || 0), 0),
      tags: [...new Set(cards.flatMap(([, card]) => card.tags ?? []))],
      suspended: cards.some(([, card]) => Boolean(card.suspended)),
    };
    merged.flashcards[survivorKey] = mergedCard;

    for (const [cardKey, card] of sorted.slice(1)) {
      delete merged.flashcards[cardKey];
      const collision: SyncMergeCollision = {
        source: 'sync-merge',
        loser: originalCards.get(cardKey) ?? card,
        oldMapKeys,
        survivorId: survivor.id,
      };
      options.onCardCollision?.(collision);
      log.info('Merged canonical flashcard collision', collision);
    }
  }

  const newWordToCardMap: Record<string, string[]> = {};
  for (const [cardId, card] of Object.entries(merged.flashcards)) {
    const word = card.content.front;
    if (word) {
      const lk = canonicalKeyForCard(card);
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
