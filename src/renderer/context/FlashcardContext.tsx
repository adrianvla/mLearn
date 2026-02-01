/**
 * Flashcard Context
 * Manages flashcard state with Anki-like SRS algorithm
 * Uses UUID-keyed flashcards with states (new/learning/review/relearning)
 */

import { createContext, useContext, ParentComponent, onMount, onCleanup, createSignal, createMemo } from 'solid-js';
import { createStore, reconcile, produce } from 'solid-js/store';
import type { FlashcardStore, Flashcard, FlashcardContent, FlashcardMeta, ReviewQueue } from '../../shared/types';
import * as SRS from '../services/srsAlgorithm';

// Default flashcard store
function getDefaultStore(): FlashcardStore {
  return {
    flashcards: {},
    wordCandidates: {},
    wordToCardMap: {},
    knownUntracked: {},
    meta: SRS.getDefaultMeta(),
    dailyStats: {},
    version: 2,
  };
}

// Undo stack entry
interface UndoEntry {
  state: FlashcardStore;
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
  getCardByWord: (word: string) => Promise<Flashcard | null>;
  hasWord: (word: string) => Promise<boolean>;
  getDueCount: () => number;
  getNewCount: () => number;

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
  const [store, setStore] = createStore<FlashcardStore>(getDefaultStore());
  const [isLoading, setIsLoading] = createSignal(true);
  const [queue, setQueue] = createSignal<ReviewQueue>({ newQueue: [], learningQueue: [], reviewQueue: [], relearnQueue: [] });
  const [undoStack, setUndoStack] = createSignal<UndoEntry[]>([]);
  // Used for tracking session start time (could be used for session stats)
  const [, setSessionStartTime] = createSignal<number>(0);

  let broadcastChannel: BroadcastChannel | null = null;

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

  // Load flashcards
  const loadFlashcards = () => {
    if (typeof window !== 'undefined' && window.mLearnIPC) {
      window.mLearnIPC.getFlashcards();
      window.mLearnIPC.onFlashcards((loaded) => {
        const checked = ensureStoreFields(loaded as Partial<FlashcardStore>);
        setStore(reconcile(checked));
        refreshQueue();
        setIsLoading(false);
      });
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

  // Ensure store has all required fields
  function ensureStoreFields(partial: Partial<FlashcardStore>): FlashcardStore {
    const today = SRS.getTodayDateString();
    const meta = { ...SRS.getDefaultMeta(), ...partial.meta };

    // Reset new cards count if it's a new day
    if (meta.newCardsDate !== today) {
      meta.newCardsToday = 0;
      meta.newCardsDate = today;
    }

    // Unbury cards at start of new day
    let flashcards = partial.flashcards || {};
    const lastDate = partial.meta?.newCardsDate;
    if (lastDate && lastDate !== today) {
      flashcards = SRS.unburyCards(flashcards);
    }

    return {
      flashcards,
      wordCandidates: partial.wordCandidates || {},
      wordToCardMap: partial.wordToCardMap || {},
      knownUntracked: partial.knownUntracked || {},
      meta,
      dailyStats: partial.dailyStats || {},
      version: 2,
    };
  }

  // Save flashcards
  const saveFlashcards = () => {
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
        store.meta.newCardsToday
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

    setStore(reconcile(entry.state));
    refreshQueue();
    saveFlashcards();

    if (entry.restore) {
      const result = entry.restore();
      if (result && typeof (result as Promise<void>).then === 'function') {
        (result as Promise<void>).catch(console.error);
      }
    }
  };

  const canUndo = () => undoStack().length > 0;

  // Add new flashcard
  const addFlashcard = async (content: Partial<FlashcardContent> & { front: string; back: string }, initialEase?: number): Promise<string> => {
    const word = content.front;
    const wordHash = await SRS.hashWord(word);

    // Check if already exists
    if (store.wordToCardMap[wordHash]) {
      console.log(`Flashcard for word "${word}" already exists.`);
      return store.wordToCardMap[wordHash];
    }

    // Check if marked as known
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
      s.flashcards[id] = newCard;
      s.wordToCardMap[wordHash] = id;
    }));

    refreshQueue();
    saveFlashcards();
    console.log(`Created new flashcard for word: ${word}`);
    return id;
  };

  // Remove flashcard
  const removeFlashcard = async (id: string, neverShowAgain: boolean = true): Promise<boolean> => {
    const card = store.flashcards[id];
    if (!card) return false;

    const word = card.content.front;
    const wordHash = await SRS.hashWord(word);

    setStore(produce((s) => {
      delete s.flashcards[id];
      delete s.wordToCardMap[wordHash];

      if (neverShowAgain) {
        s.knownUntracked[wordHash] = true;
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

    pushUndoState({ type: 'answer' });

    const wasNew = card.state === 'new';
    const updated = SRS.answerCard(card, rating, store.meta);

    setStore(produce((s) => {
      s.flashcards[card.id] = updated;

      // Update new cards count if this was a new card
      if (wasNew) {
        s.meta.newCardsToday++;
      }

      // Update daily stats
      const today = SRS.getTodayDateString();
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

  // Get card by word
  const getCardByWord = async (word: string): Promise<Flashcard | null> => {
    const wordHash = await SRS.hashWord(word);
    const id = store.wordToCardMap[wordHash];
    if (!id) return null;
    return store.flashcards[id] || null;
  };

  // Check if word has flashcard
  const hasWord = async (word: string): Promise<boolean> => {
    const wordHash = await SRS.hashWord(word);
    return !!store.wordToCardMap[wordHash];
  };

  // Get due count
  const getDueCount = (): number => {
    return SRS.getDueCards(store.flashcards).length;
  };

  // Get new cards count
  const getNewCount = (): number => {
    return SRS.getNewCards(store.flashcards).length;
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

    // Skip if already has flashcard or marked as known
    if (store.wordToCardMap[wordHash] || store.knownUntracked[wordHash]) {
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

    // If there's a flashcard, remove it
    const cardId = store.wordToCardMap[wordHash];
    if (cardId) {
      await removeFlashcard(cardId, true);
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
    const today = SRS.getTodayDateString();
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

  onMount(() => {
    if (typeof BroadcastChannel !== 'undefined') {
      broadcastChannel = new BroadcastChannel(FLASHCARD_CHANNEL);
      broadcastChannel.onmessage = handleBroadcast;
    }

    // Listen for new day event from main process
    if (typeof window !== 'undefined' && window.mLearnIPC) {
      window.mLearnIPC.onNewDayFlashcards(handleNewDay);
    }

    loadFlashcards();
    startSession();
  });

  onCleanup(() => {
    broadcastChannel?.close();
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
    getCardByWord,
    hasWord,
    getDueCount,
    getNewCount,
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
