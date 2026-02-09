/**
 * Flashcard Context
 * Manages flashcard state with Anki-like SRS algorithm
 * Uses UUID-keyed flashcards with states (new/learning/review/relearning)
 * Supports multiple flashcards per word with O(1) word statistics lookup
 */

import { createContext, useContext, ParentComponent, onMount, onCleanup, createSignal, createMemo } from 'solid-js';
import { createStore, reconcile, produce } from 'solid-js/store';
import type { FlashcardStore, Flashcard, FlashcardContent, FlashcardMeta, ReviewQueue, WordStats, FlashcardState } from '../../shared/types';
import * as SRS from '../services/srsAlgorithm';
import { migrationListenerReady } from './migrationSignals';
import { useSettings } from './SettingsContext';
import { useLocalization } from './LocalizationContext';
import { changeKnownStatus as changeKnownStatusInStats } from '../services/statsService';
import { showToast } from '../components/common/Feedback/Toast';

// Current store version
const CURRENT_VERSION = 3;

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

// Default flashcard store
function getDefaultStore(): FlashcardStore {
  return {
    flashcards: {},
    wordCandidates: {},
    wordToCardMap: {},
    wordStatsMap: {},
    knownUntracked: {},
    meta: SRS.getDefaultMeta(),
    dailyStats: {},
    version: CURRENT_VERSION,
  };
}

// Undo stack entry
interface UndoEntry {
  state?: FlashcardStore;
  type: string;
  restore?: () => void | Promise<void>;
}

const MAX_UNDO_STACK_SIZE = 50;

// Context interface
interface FlashcardContextValue {
  // Store access
  store: FlashcardStore;
  isLoading: () => boolean;

  // Queue for current session
  queue: () => ReviewQueue;
  queueCounts: () => { new: number; learning: number; review: number; total: number };

  // Card management
  addFlashcard: (content: Partial<FlashcardContent> & { front: string; back: string }, initialEase?: number) => Promise<string>;
  removeFlashcard: (id: string, neverShowAgain?: boolean) => Promise<boolean>;
  updateFlashcard: (id: string, updates: Partial<Flashcard>) => void;
  updateFlashcardContent: (id: string, content: Partial<FlashcardContent>) => void;
  suspendCard: (id: string) => void;
  unsuspendCard: (id: string) => void;
  buryCard: (id: string) => void;

  // Review operations
  answerCard: (rating: SRS.Rating) => void;
  getCurrentCard: () => Flashcard | null;
  getPreviewDueDates: () => Record<SRS.Rating, number> | null;

  // Query operations
  getAllCards: () => Flashcard[];
  getCardById: (id: string) => Flashcard | null;
  /** Get all flashcards for a word (supports multiple cards per word) */
  getCardsByWord: (word: string) => Promise<Flashcard[]>;
  /** Get the first/best flashcard for a word (backwards compatible) */
  getCardByWord: (word: string) => Promise<Flashcard | null>;
  hasWord: (word: string) => Promise<boolean>;
  /** Get aggregated word statistics for O(1) lookup */
  getWordStats: (word: string) => Promise<WordStats | null>;
  getDueCount: () => number;
  getNewCount: () => number;
  
  // Synchronous query operations (for reactive SolidJS usage)
  /** Synchronous check if word has a flashcard - iterates cards directly, O(n) but reactive */
  hasWordSync: (word: string) => boolean;
  /** Synchronous get card by word - iterates cards directly, O(n) but reactive */
  getCardByWordSync: (word: string) => Flashcard | null;
  /** Synchronous get all cards for a word - iterates cards directly, O(n) but reactive */
  getCardsByWordSync: (word: string) => Flashcard[];

  // Settings
  updateMeta: (updates: Partial<FlashcardMeta>) => void;

  // Undo support
  pushUndoState: (options?: { type?: string; restore?: () => void | Promise<void> }) => void;
  undoLastAction: () => void;
  canUndo: () => boolean;

  // Word tracking
  trackWordAppearance: (word: string, reading?: string) => Promise<void>;
  markWordAsKnown: (word: string) => Promise<void>;

  // Session management
  startSession: () => void;
  refreshQueue: () => void;

  // Utility
  intervalToString: (ms: number) => string;
  dueDateToString: (dueDate: number) => string;
}

// Create context
const FlashcardContext = createContext<FlashcardContextValue>();

const FLASHCARD_CHANNEL = 'mlearn-flashcards';

export const FlashcardProvider: ParentComponent = (props) => {
  const { settings } = useSettings();
  const { t } = useLocalization();
  const newDayHour = () => settings.newDayHour ?? 4;

  const [store, setStore] = createStore<FlashcardStore>(getDefaultStore());
  const [isLoading, setIsLoading] = createSignal(true);
  const [queue, setQueue] = createSignal<ReviewQueue>({ newQueue: [], learningQueue: [], reviewQueue: [], relearnQueue: [] });
  const [undoStack, setUndoStack] = createSignal<UndoEntry[]>([]);
  // Used for tracking session start time (could be used for session stats)
  const [, setSessionStartTime] = createSignal<number>(0);

  let broadcastChannel: BroadcastChannel | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const SAVE_DEBOUNCE_MS = 300;
  const ipcCleanups: Array<() => void> = [];

  // Queue counts memo
  const queueCounts = createMemo(() => SRS.getQueueCounts(queue(), store.flashcards));

  // Get current card
  const getCurrentCard = (): Flashcard | null => {
    return SRS.getNextCard(queue(), store.flashcards);
  };

  // Preview due dates for rating buttons
  const getPreviewDueDates = (): Record<SRS.Rating, number> | null => {
    const card = getCurrentCard();
    if (!card) return null;
    return SRS.previewAnswers(card, store.meta);
  };

  // Handle loaded flashcards (used by IPC listener registered once in onMount)
  const handleFlashcardsLoaded = (loaded: FlashcardStore) => {
    const checked = ensureStoreFields(loaded as Partial<FlashcardStore>);
    setStore(reconcile(checked));
    refreshQueue();
    setIsLoading(false);
  };

  // Handle migration IPC event
  const handleMigrationComplete = (...args: unknown[]) => {
    const info = args[0] as { occurred: boolean; backupPath: string | null; fromVersion: number | null } | undefined;
    console.log('[FlashcardContext] Received migration IPC:', info);
    if (info?.occurred) {
      console.log('[FlashcardContext] Flashcard migration completed from v', info.fromVersion);
      const dispatchMigrationEvent = () => {
        console.log('[FlashcardContext] Dispatching migration event to window');
        window.dispatchEvent(new CustomEvent('mlearn-flashcard-migration', { 
          detail: info 
        }));
      };
      
      if (migrationListenerReady()) {
        dispatchMigrationEvent();
      } else {
        const checkReady = setInterval(() => {
          if (migrationListenerReady()) {
            clearInterval(checkReady);
            dispatchMigrationEvent();
          }
        }, 50);
        setTimeout(() => {
          clearInterval(checkReady);
          if (!migrationListenerReady()) {
            console.warn('[FlashcardContext] Migration listener not ready after timeout, dispatching anyway');
            dispatchMigrationEvent();
          }
        }, 2000);
      }
    }
  };

  // Load flashcards — just sends IPC request (listener is registered once in onMount)
  const loadFlashcards = () => {
    if (typeof window !== 'undefined' && window.mLearnIPC) {
      window.mLearnIPC.getFlashcards();
    } else {
      // Try localStorage for tethered mode
      try {
        const stored = localStorage.getItem('mlearn-flashcards');
        if (stored) {
          const parsed = JSON.parse(stored);
          const checked = ensureStoreFields(parsed);
          setStore(reconcile(checked));
          refreshQueue();
        }
      } catch (e) {
        console.error('Failed to load flashcards from localStorage:', e);
      }
      setIsLoading(false);
    }
  };

  // Ensure store has all required fields and handle migrations
  function ensureStoreFields(partial: any): FlashcardStore {
    const hour = newDayHour();
    const today = SRS.getTodayDateString(hour);
    const meta = { ...SRS.getDefaultMeta(hour), ...partial.meta };

    // Reset new cards count and reviews count if it's a new day
    if (meta.newCardsDate !== today) {
      meta.newCardsToday = 0;
      meta.reviewsToday = 0;
      meta.newCardsDate = today;
    }

    // Ensure reviewsToday exists (for migration from older stores)
    if (meta.reviewsToday === undefined) {
      meta.reviewsToday = 0;
    }

    // Unbury cards at start of new day
    let flashcards = partial.flashcards || {};
    const lastDate = partial.meta?.newCardsDate;
    if (lastDate && lastDate !== today) {
      flashcards = SRS.unburyCards(flashcards);
    }

    // Handle migration from v2 to v3 (single card per word -> multiple cards per word)
    let wordToCardMap: Record<string, string[]> = {};
    let wordStatsMap: Record<string, WordStats> = partial.wordStatsMap || {};
    
    const version = partial.version || 1;
    if (version < 3 && partial.wordToCardMap) {
      // Migrate from Record<string, string> to Record<string, string[]>
      for (const [wordHash, cardId] of Object.entries(partial.wordToCardMap)) {
        if (typeof cardId === 'string') {
          wordToCardMap[wordHash] = [cardId];
        } else if (Array.isArray(cardId)) {
          wordToCardMap[wordHash] = cardId as string[];
        }
      }
      
      // Rebuild wordStatsMap from flashcards
      for (const [wordHash, cardIds] of Object.entries(wordToCardMap)) {
        const cards: Flashcard[] = [];
        for (const cardId of cardIds) {
          const card = flashcards[cardId];
          if (card) cards.push(card);
        }
        wordStatsMap[wordHash] = calculateWordStats(cards);
      }
    } else {
      // Already v3, use as-is but ensure arrays
      wordToCardMap = partial.wordToCardMap || {};
      for (const [wordHash, cardIds] of Object.entries(wordToCardMap)) {
        if (!Array.isArray(cardIds)) {
          wordToCardMap[wordHash] = [cardIds as unknown as string];
        }
      }
    }

    return {
      flashcards,
      wordCandidates: partial.wordCandidates || {},
      wordToCardMap,
      wordStatsMap,
      knownUntracked: partial.knownUntracked || {},
      meta,
      dailyStats: partial.dailyStats || {},
      version: CURRENT_VERSION,
    };
  }

  // Save flashcards (debounced to avoid lag during rapid review)
  const saveFlashcards = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveFlashcardsImmediate();
    }, SAVE_DEBOUNCE_MS);
  };

  // Immediate save (used by debounced save and cleanup)
  const saveFlashcardsImmediate = () => {
    let serializedStore: FlashcardStore;
    try {
      serializedStore = JSON.parse(JSON.stringify(store));
    } catch (e) {
      console.error('Failed to serialize flashcard store:', e);
      return;
    }

    if (typeof window !== 'undefined' && window.mLearnIPC) {
      window.mLearnIPC.saveFlashcards(serializedStore);
    } else {
      try {
        localStorage.setItem('mlearn-flashcards', JSON.stringify(serializedStore));
      } catch (e) {
        console.error('Failed to save flashcards to localStorage:', e);
      }
    }

    // Broadcast to other windows
    try {
      broadcastChannel?.postMessage({ type: 'update', store: serializedStore });
    } catch (e) {
      console.error('Failed to broadcast flashcard update:', e);
    }
  };

  // Refresh the review queue
  const refreshQueue = () => {
    const newQueue = SRS.buildReviewQueue(
        store.flashcards,
        store.meta.maxNewCardsPerDay,
        store.meta.newCardsToday,
        store.meta.maxNewCardsPerDayLearning,
        store.meta.maxReviewsPerDay,
        store.meta.reviewsToday,
        newDayHour()
    );
    setQueue(newQueue);
  };

  // Start a new study session
  const startSession = () => {
    setSessionStartTime(Date.now());
    refreshQueue();
  };

  // Push undo state
  const pushUndoState = (options: { type?: string; restore?: () => void | Promise<void> } = {}) => {
    const snapshot = JSON.parse(JSON.stringify(store)) as FlashcardStore;
    setUndoStack((prev) => {
      const newStack = [...prev, { state: snapshot, type: options.type || 'unknown', restore: options.restore }];
      if (newStack.length > MAX_UNDO_STACK_SIZE) {
        newStack.shift();
      }
      return newStack;
    });
  };

  // Undo last action
  const undoLastAction = () => {
    const stack = undoStack();
    if (stack.length === 0) return;

    const entry = stack[stack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));

    if (entry.state) {
      setStore(reconcile(entry.state));
    }

    if (entry.restore) {
      const result = entry.restore();
      if (result && typeof (result as Promise<void>).then === 'function') {
        (result as Promise<void>).catch(console.error);
      }
    }

    refreshQueue();
    saveFlashcards();
  };

  const canUndo = () => undoStack().length > 0;

  // Add new flashcard - now supports multiple cards per word
  const addFlashcard = async (content: Partial<FlashcardContent> & { front: string; back: string }, initialEase?: number): Promise<string> => {
    console.log('%caddFlashcard called with:', 'color: magenta; font-weight: bold;', content.front);
    const word = content.front;
    const wordHash = await SRS.hashWord(word);
    console.log('%caddFlashcard: wordHash generated:', 'color: magenta;', wordHash);

    // Check if marked as known (skip flashcard creation)
    if (store.knownUntracked[wordHash]) {
      console.log(`Word "${word}" is marked as known, not creating flashcard.`);
      return '';
    }

    const now = Date.now();
    const id = SRS.generateUUID();

    const newCard: Flashcard = {
      id,
      content: {
        type: content.type || 'word',
        front: content.front,
        back: content.back,
        reading: content.reading,
        pitchAccent: content.pitchAccent,
        pos: content.pos,
        level: content.level,
        example: content.example,
        exampleMeaning: content.exampleMeaning,
        imageUrl: content.imageUrl,
        audioUrl: content.audioUrl,
        context: content.context,
        source: content.source,
        extra: content.extra,
        // Legacy fields
        word: content.word,
        pronunciation: content.pronunciation,
        translation: content.translation,
        definition: content.definition,
        screenshotUrl: content.screenshotUrl,
        contextPhrase: content.contextPhrase,
      },
      state: 'new',
      ease: initialEase ?? 2.5,
      interval: 0,
      dueDate: now,
      reviews: 0,
      lapses: 0,
      learningStep: 0,
      createdAt: now,
      lastReviewed: now,
      lastUpdated: now,
    };

    setStore(produce((s) => {
      // Add flashcard
      s.flashcards[id] = newCard;
      
      // Add to wordToCardMap (array)
      if (!s.wordToCardMap[wordHash]) {
        s.wordToCardMap[wordHash] = [];
      }
      s.wordToCardMap[wordHash].push(id);
      
      // Update wordStatsMap
      const cards = s.wordToCardMap[wordHash].map(cid => s.flashcards[cid]).filter(Boolean);
      s.wordStatsMap[wordHash] = calculateWordStats(cards);
    }));

    refreshQueue();
    saveFlashcards();
    console.log(`Created new flashcard for word: ${word} (now has ${store.wordToCardMap[wordHash]?.length || 1} cards)`);
    return id;
  };

  // Helper to recalculate word stats after card changes
  const recalculateWordStats = (wordHash: string) => {
    setStore(produce((s) => {
      const cardIds = s.wordToCardMap[wordHash] || [];
      const cards = cardIds.map(id => s.flashcards[id]).filter(Boolean);
      if (cards.length > 0) {
        s.wordStatsMap[wordHash] = calculateWordStats(cards);
      } else {
        delete s.wordStatsMap[wordHash];
      }
    }));
  };

  // Remove flashcard
  const removeFlashcard = async (id: string, neverShowAgain: boolean = true): Promise<boolean> => {
    const card = store.flashcards[id];
    if (!card) return false;

    const word = card.content.front;
    const wordHash = await SRS.hashWord(word);

    setStore(produce((s) => {
      // Remove from flashcards
      delete s.flashcards[id];
      
      // Remove from wordToCardMap array
      if (s.wordToCardMap[wordHash]) {
        s.wordToCardMap[wordHash] = s.wordToCardMap[wordHash].filter(cid => cid !== id);
        
        // If no more cards for this word, clean up
        if (s.wordToCardMap[wordHash].length === 0) {
          delete s.wordToCardMap[wordHash];
          delete s.wordStatsMap[wordHash];
          
          if (neverShowAgain) {
            s.knownUntracked[wordHash] = true;
          }
        } else {
          // Recalculate stats for remaining cards
          const cards = s.wordToCardMap[wordHash].map(cid => s.flashcards[cid]).filter(Boolean);
          s.wordStatsMap[wordHash] = calculateWordStats(cards);
        }
      }
    }));

    // Remove from queue
    setQueue(SRS.removeFromQueue(queue(), id));

    saveFlashcards();
    return true;
  };

  // Update flashcard
  const updateFlashcard = (id: string, updates: Partial<Flashcard>) => {
    if (!store.flashcards[id]) return;

    setStore(produce((s) => {
      Object.assign(s.flashcards[id], updates, { lastUpdated: Date.now() });
    }));
    saveFlashcards();
  };

  // Update flashcard content
  const updateFlashcardContent = (id: string, content: Partial<FlashcardContent>) => {
    if (!store.flashcards[id]) return;

    setStore(produce((s) => {
      Object.assign(s.flashcards[id].content, content);
      s.flashcards[id].lastUpdated = Date.now();
    }));
    saveFlashcards();
  };

  // Suspend card
  const suspendCard = (id: string) => {
    if (!store.flashcards[id]) return;

    pushUndoState({ type: 'suspend' });

    setStore(produce((s) => {
      s.flashcards[id] = SRS.suspendCard(s.flashcards[id]);
    }));

    setQueue(SRS.removeFromQueue(queue(), id));
    saveFlashcards();
  };

  // Unsuspend card
  const unsuspendCard = (id: string) => {
    if (!store.flashcards[id]) return;

    setStore(produce((s) => {
      s.flashcards[id].suspended = false;
      s.flashcards[id].lastUpdated = Date.now();
    }));

    refreshQueue();
    saveFlashcards();
  };

  // Bury card
  const buryCard = (id: string) => {
    if (!store.flashcards[id]) return;

    pushUndoState({ type: 'bury' });

    setStore(produce((s) => {
      s.flashcards[id] = SRS.buryCard(s.flashcards[id]);
    }));

    setQueue(SRS.removeFromQueue(queue(), id));
    saveFlashcards();
  };

  // Answer current card
  const answerCard = (rating: SRS.Rating) => {
    const card = getCurrentCard();
    if (!card) return;

    // Lightweight undo: snapshot only the affected card and meta (avoids expensive full store clone)
    const cardSnapshot: Flashcard = { ...card, content: { ...card.content } };
    const metaSnapshot = { ...store.meta };
    const undoToday = SRS.getTodayDateString(newDayHour());
    const dailyStatSnapshot = store.dailyStats[undoToday]
      ? { ...store.dailyStats[undoToday] }
      : null;

    setUndoStack((prev) => {
      const newStack = [...prev, {
        type: 'answer',
        restore: () => {
          setStore(produce((s) => {
            s.flashcards[card.id] = cardSnapshot;
            Object.assign(s.meta, metaSnapshot);
            if (dailyStatSnapshot) {
              s.dailyStats[undoToday] = dailyStatSnapshot;
            } else {
              delete s.dailyStats[undoToday];
            }
          }));
        },
      }];
      if (newStack.length > MAX_UNDO_STACK_SIZE) newStack.shift();
      return newStack;
    });

    const wasNew = card.state === 'new';
    const wasReview = card.state === 'review';
    const updated = SRS.answerCard(card, rating, store.meta);

    setStore(produce((s) => {
      s.flashcards[card.id] = updated;

      // Update new cards count if this was a new card
      if (wasNew) {
        s.meta.newCardsToday++;
      }

      // Update review count for review cards
      if (wasReview) {
        s.meta.reviewsToday++;
      }

      // Update daily stats
      const today = SRS.getTodayDateString(newDayHour());
      if (!s.dailyStats[today]) {
        s.dailyStats[today] = {
          date: today,
          newCardsStudied: 0,
          reviewCardsStudied: 0,
          lapses: 0,
          timeSpent: 0,
          graduated: 0,
        };
      }

      if (wasNew) {
        s.dailyStats[today].newCardsStudied++;
      } else {
        s.dailyStats[today].reviewCardsStudied++;
      }

      if (rating === 'again' && card.state === 'review') {
        s.dailyStats[today].lapses++;
      }

      if ((card.state === 'learning' || card.state === 'new') && updated.state === 'review') {
        s.dailyStats[today].graduated++;
      }
    }));

    // Update queue - remove from current position, may need to re-add if still learning
    let newQueue = SRS.removeFromQueue(queue(), card.id);

    // If card is still in learning/relearning and due soon, add back to queue
    if ((updated.state === 'learning' || updated.state === 'relearning') &&
        updated.dueDate <= Date.now() + 10 * 60 * 1000) { // Due within 10 minutes
      newQueue = SRS.addToQueue(newQueue, updated);
    }

    setQueue(newQueue);

    // Leech detection: notify when a card's lapses reach the threshold
    const threshold = settings.leechThreshold ?? 10;
    if (threshold > 0 && updated.lapses >= threshold && updated.lapses % threshold === 0) {
      showToast({
        variant: 'warning',
        title: t('mlearn.Flashcards.Leech.Title'),
        message: t('mlearn.Flashcards.Leech.Message', { word: card.content.front, count: String(updated.lapses) }),
        duration: 8000,
      });
    }
    
    // Recalculate word stats after answering (async)
    (async () => {
      const wordHash = await SRS.hashWord(card.content.front);
      recalculateWordStats(wordHash);
    })();
    
    saveFlashcards();
  };

  // Get all cards
  const getAllCards = (): Flashcard[] => {
    return Object.values(store.flashcards);
  };

  // Get card by ID
  const getCardById = (id: string): Flashcard | null => {
    return store.flashcards[id] || null;
  };

  // Get all cards for a word (supports multiple cards per word)
  const getCardsByWord = async (word: string): Promise<Flashcard[]> => {
    const wordHash = await SRS.hashWord(word);
    const ids = store.wordToCardMap[wordHash];
    if (!ids || ids.length === 0) return [];
    return ids.map(id => store.flashcards[id]).filter(Boolean);
  };

  // Get the first/best card for a word (backwards compatible)
  const getCardByWord = async (word: string): Promise<Flashcard | null> => {
    const wordHash = await SRS.hashWord(word);
    const ids = store.wordToCardMap[wordHash];
    if (!ids || ids.length === 0) return null;
    
    // Return the card with best state/ease
    const cards = ids.map(id => store.flashcards[id]).filter(Boolean);
    if (cards.length === 0) return null;
    if (cards.length === 1) return cards[0];
    
    // Sort by state (review > relearning > learning > new), then by ease
    return cards.sort((a, b) => {
      const stateCompare = compareStates(b.state, a.state);
      if (stateCompare !== 0) return stateCompare;
      return b.ease - a.ease;
    })[0];
  };

  // Check if word has flashcard
  const hasWord = async (word: string): Promise<boolean> => {
    const wordHash = await SRS.hashWord(word);
    const ids = store.wordToCardMap[wordHash];
    return !!ids && ids.length > 0;
  };

  // Get aggregated word statistics for O(1) lookup
  const getWordStats = async (word: string): Promise<WordStats | null> => {
    const wordHash = await SRS.hashWord(word);
    return store.wordStatsMap[wordHash] || null;
  };

  // Get due count (respects end-of-SRS-day for review cards)
  const getDueCount = (): number => {
    return SRS.getDueCards(store.flashcards, newDayHour()).length;
  };

  // Get new cards count
  const getNewCount = (): number => {
    return SRS.getNewCards(store.flashcards).length;
  };

  // =========== Synchronous Lookup Methods ===========
  // These iterate through cards directly by checking content.front
  // They're O(n) but fully reactive with SolidJS, unlike async methods
  // TODO: instead of O(n), maybe using a Map of word to card IDs would be better for performance
  // Synchronous check if word has flashcard
  const hasWordSync = (word: string): boolean => {
    if (!word) return false;
    const allCards = Object.values(store.flashcards);
    return allCards.some(card => card.content.front === word);
  };
  
  // Synchronous get all cards for a word
  const getCardsByWordSync = (word: string): Flashcard[] => {
    if (!word) return [];
    const allCards = Object.values(store.flashcards);
    return allCards.filter(card => card.content.front === word);
  };
  
  // Synchronous get the best card for a word (highest state/ease)
  const getCardByWordSync = (word: string): Flashcard | null => {
    if (!word) return null;
    const cards = getCardsByWordSync(word);
    if (cards.length === 0) return null;
    if (cards.length === 1) return cards[0];
    
    // Sort by state (review > relearning > learning > new), then by ease
    return cards.sort((a, b) => {
      const stateCompare = compareStates(b.state, a.state);
      if (stateCompare !== 0) return stateCompare;
      return b.ease - a.ease;
    })[0];
  };

  // Update metadata
  const updateMeta = (updates: Partial<FlashcardMeta>) => {
    setStore(produce((s) => {
      Object.assign(s.meta, updates);
    }));
    refreshQueue();
    saveFlashcards();
  };

  // Track word appearance for auto-creation
  const trackWordAppearance = async (word: string, reading?: string) => {
    const wordHash = await SRS.hashWord(word);
    const now = Date.now();

    // Skip if already has flashcard(s) or marked as known
    const cardIds = store.wordToCardMap[wordHash];
    if ((cardIds && cardIds.length > 0) || store.knownUntracked[wordHash]) {
      return;
    }

    setStore(produce((s) => {
      if (!s.wordCandidates[wordHash]) {
        s.wordCandidates[wordHash] = { count: 0, lastSeen: now, word, reading };
      }
      s.wordCandidates[wordHash].count++;
      s.wordCandidates[wordHash].lastSeen = now;
    }));

    saveFlashcards();
  };

  // Mark word as known (won't create flashcard)
  const markWordAsKnown = async (word: string) => {
    const wordHash = await SRS.hashWord(word);

    // If there are flashcards, remove all of them
    const cardIds = store.wordToCardMap[wordHash];
    if (cardIds && cardIds.length > 0) {
      // Remove all cards for this word
      for (const cardId of [...cardIds]) {
        await removeFlashcard(cardId, true);
      }
    } else {
      setStore(produce((s) => {
        s.knownUntracked[wordHash] = true;
        delete s.wordCandidates[wordHash];
      }));
      saveFlashcards();
    }
  };

  // Handle broadcast from other windows
  const handleBroadcast = (event: MessageEvent) => {
    if (event.data?.type === 'update' && event.data.store) {
      const checked = ensureStoreFields(event.data.store);
      setStore(reconcile(checked));
      refreshQueue();
    }
  };

  // Handle new day event
  const handleNewDay = () => {
    const today = SRS.getTodayDateString(newDayHour());
    setStore(produce((s) => {
      // Unbury all cards
      s.flashcards = SRS.unburyCards(s.flashcards);
      // Reset new cards count
      s.meta.newCardsToday = 0;
      s.meta.newCardsDate = today;
    }));
    refreshQueue();
    saveFlashcards();
  };

  // Handle window focus - reload flashcards to sync changes from other windows
  // Only sends the IPC request; the listener is registered once in onMount
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      if (typeof window !== 'undefined' && window.mLearnIPC) {
        window.mLearnIPC.getFlashcards();
      }
    }
  };

  onMount(() => {
    if (typeof BroadcastChannel !== 'undefined') {
      broadcastChannel = new BroadcastChannel(FLASHCARD_CHANNEL);
      broadcastChannel.onmessage = handleBroadcast;
    }

    // Register all IPC listeners ONCE and store their cleanup functions
    if (typeof window !== 'undefined' && window.mLearnIPC) {
      // Flashcards loaded listener (single registration — reused by loadFlashcards and visibility sync)
      ipcCleanups.push(window.mLearnIPC.onFlashcards(handleFlashcardsLoaded));

      // Migration listener
      ipcCleanups.push(window.mLearnIPC.on('flashcard-migration-complete', handleMigrationComplete));

      // New day event from main process
      ipcCleanups.push(window.mLearnIPC.onNewDayFlashcards(handleNewDay));

      // Tethered mode updates
      ipcCleanups.push(window.mLearnIPC.onUpdatePills((data: unknown) => {
        try {
          const updates: Array<{ word: string; status: number }> = JSON.parse(data as string);
          for (const update of updates) {
            changeKnownStatusInStats(update.word, update.status);
          }
        } catch (e) {
          console.error('[Tethered] Failed to process pill updates:', e);
        }
      }));

      ipcCleanups.push(window.mLearnIPC.onUpdateWordAppearance((data: unknown) => {
        try {
          const words: string[] = JSON.parse(data as string);
          for (const word of words) {
            trackWordAppearance(word);
          }
        } catch (e) {
          console.error('[Tethered] Failed to process word appearance updates:', e);
        }
      }));

      ipcCleanups.push(window.mLearnIPC.onUpdateAttemptFlashcardCreation((data: unknown) => {
        try {
          const updates: Array<{ word: string; content: Record<string, unknown> }> = JSON.parse(data as string);
          for (const update of updates) {
            trackWordAppearance(update.word);
          }
        } catch (e) {
          console.error('[Tethered] Failed to process flashcard creation attempts:', e);
        }
      }));

      ipcCleanups.push(window.mLearnIPC.onUpdateCreateFlashcard((data: unknown) => {
        try {
          const updates: Array<{ content: Record<string, unknown> }> = JSON.parse(data as string);
          for (const update of updates) {
            const c = update.content as Record<string, unknown>;
            const word = (c.word as string) || '';
            const rawTranslation = c.translation;
            const rawDefinition = c.definition;
            const toBackString = (val: unknown): string => {
              if (!val) return '';
              if (Array.isArray(val)) return val.join('; ');
              return String(val);
            };
            const back = toBackString(rawTranslation) || toBackString(rawDefinition) || '';
            if (word && back) {
              addFlashcard({
                type: 'word',
                front: word,
                back,
                reading: (c.pronunciation as string) || undefined,
                pitchAccent: (c.pitchAccent as number) || undefined,
                pos: (c.pos as string) || undefined,
                level: (c.level as number) || undefined,
                example: (c.example as string) || undefined,
                exampleMeaning: (c.exampleMeaning as string) || undefined,
                imageUrl: (c.screenshotUrl as string) || undefined,
              });
            }
          }
        } catch (e) {
          console.error('[Tethered] Failed to process flashcard creation:', e);
        }
      }));

      ipcCleanups.push(window.mLearnIPC.onUpdateLastWatched((data: unknown) => {
        try {
          const updates: Array<{ name: string; screenshotUrl: string; videoUrl: string }> = JSON.parse(data as string);
          for (const update of updates) {
            try {
              const stored = localStorage.getItem('mlearn_recently_watched');
              const list: Array<{ name: string; screenshotUrl: string; videoUrl: string; timestamp: number }> = stored ? JSON.parse(stored) : [];
              list.unshift({ ...update, timestamp: Date.now() });
              if (list.length > 20) list.length = 20;
              localStorage.setItem('mlearn_recently_watched', JSON.stringify(list));
            } catch (e) {
              console.warn('[Tethered] Failed to save last watched:', e);
            }
          }
        } catch (e) {
          console.error('[Tethered] Failed to process last watched updates:', e);
        }
      }));
    }
    
    // Listen for visibility changes to reload on window focus
    document.addEventListener('visibilitychange', handleVisibilityChange);

    loadFlashcards();
    startSession();
  });

  onCleanup(() => {
    // Flush any pending save before cleanup
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveFlashcardsImmediate();
    }
    // Remove all IPC listeners
    for (const cleanup of ipcCleanups) cleanup();
    ipcCleanups.length = 0;
    broadcastChannel?.close();
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  });

  const value: FlashcardContextValue = {
    store,
    isLoading,
    queue,
    queueCounts,
    addFlashcard,
    removeFlashcard,
    updateFlashcard,
    updateFlashcardContent,
    suspendCard,
    unsuspendCard,
    buryCard,
    answerCard,
    getCurrentCard,
    getPreviewDueDates,
    getAllCards,
    getCardById,
    getCardsByWord,
    getCardByWord,
    hasWord,
    getWordStats,
    getDueCount,
    getNewCount,
    // Synchronous lookup methods (for reactive SolidJS usage)
    hasWordSync,
    getCardByWordSync,
    getCardsByWordSync,
    updateMeta,
    pushUndoState,
    undoLastAction,
    canUndo,
    trackWordAppearance,
    markWordAsKnown,
    startSession,
    refreshQueue,
    intervalToString: SRS.intervalToString,
    dueDateToString: SRS.dueDateToString,
  };

  return (
      <FlashcardContext.Provider value={value}>
        {props.children}
      </FlashcardContext.Provider>
  );
};

// Hook to use flashcards
export function useFlashcards(): FlashcardContextValue {
  const ctx = useContext(FlashcardContext);
  if (!ctx) {
    throw new Error('useFlashcards must be used within a FlashcardProvider');
  }
  return ctx;
}

// Export utility functions for external use
export { SRS };
