/**
 * Flashcard Context
 * Manages flashcard state with SRS algorithm
 */

import { createContext, useContext, ParentComponent, onMount, onCleanup, createSignal } from 'solid-js';
import { createStore, reconcile, produce } from 'solid-js/store';
import type { FlashcardStore, Flashcard, FlashcardContent } from '../../shared/types';

// SRS constants - SM-2 Algorithm (matching old app)
const MIN_EASE = 1.3;
const DEFAULT_EASE = 2.5;

// Time constants
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * SM-2 SRS Algorithm - Calculate new due date based on quality rating
 * @param card - The flashcard being reviewed
 * @param quality - Rating from 0-5 (0=again/complete failure, 3=good, 5=easy/perfect)
 */
function calculateSM2(card: Flashcard, quality: number): Partial<Flashcard> {
  const now = Date.now();
  
  // Normalize ease factor (EF) — default to a sane SM-2 starting value
  const currentEF = typeof card.ease === 'number' && card.ease > 0 ? card.ease : DEFAULT_EASE;
  
  // SM-2 EF update formula based on quality (q in 0..5), clamped to 1.3 minimum
  let newEF = currentEF + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  newEF = Math.max(MIN_EASE, newEF);

  // Previous scheduled interval (not elapsed) — avoids minute-scale drift
  const lastReviewed = card.lastReviewed ? new Date(card.lastReviewed).getTime() : now;
  const dueDate = card.dueDate ? new Date(card.dueDate).getTime() : lastReviewed;
  const prevInterval = Math.max(0, dueDate - lastReviewed);

  let interval: number;

  if (quality === 0) {
    // Complete failure - reset
    interval = 0;
  } else if (quality < 3) {
    // Failed/hard: short retry step (learning)
    interval = 10 * MINUTE;
  } else {
    // Passed: handle first and second reviews with fixed steps, then scale
    const reviews = typeof card.reviews === 'number' ? card.reviews : 0;

    if (reviews === 0) {
      // First successful review: 1 day for good, 4 days for easy
      interval = quality >= 5 ? 4 * DAY : 1 * DAY;
    } else if (reviews === 1) {
      // Second successful review: 6 days for good, 10 days for easy
      interval = quality >= 5 ? 10 * DAY : 6 * DAY;
    } else {
      // Subsequent reviews: multiply previous scheduled interval by EF
      const base = prevInterval > 0 ? prevInterval : 1 * DAY;
      interval = Math.round(base * newEF);
    }
  }

  return {
    ease: newEF,
    interval: Math.round(interval / MINUTE), // Store as minutes
    dueDate: new Date(now + interval).toISOString(),
    lastReviewed: new Date(now).toISOString(),
    reviews: quality >= 3 ? (card.reviews || 0) + 1 : card.reviews,
  };
}

/**
 * Convert rating string to SM-2 quality score
 */
function ratingToQuality(rating: 'again' | 'hard' | 'good' | 'easy'): number {
  switch (rating) {
    case 'again': return 0;
    case 'hard': return 2;
    case 'good': return 3;
    case 'easy': return 5;
    default: return 3;
  }
}

// Context interface
interface FlashcardContextValue {
  store: FlashcardStore;
  addFlashcard: (content: FlashcardContent) => void;
  removeFlashcard: (id: string) => void;
  updateFlashcard: (id: string, updates: Partial<Flashcard>) => void;
  reviewFlashcard: (id: string, rating: 'again' | 'hard' | 'good' | 'easy') => void;
  getDueCards: () => Flashcard[];
  getNewCards: (limit?: number) => Flashcard[];
  hasWord: (word: string) => boolean;
  getByWord: (word: string) => Flashcard | null;
  isLoading: () => boolean;
}

// Create context
const FlashcardContext = createContext<FlashcardContextValue>();

const FLASHCARD_CHANNEL = 'mlearn-flashcards';

export const FlashcardProvider: ParentComponent = (props) => {
  const [store, setStore] = createStore<FlashcardStore>({
    flashcards: [],
    version: 1,
  });
  const [isLoading, setIsLoading] = createSignal(true);

  let broadcastChannel: BroadcastChannel | null = null;

  // Load flashcards
  const loadFlashcards = () => {
    if (typeof window !== 'undefined' && window.mLearnIPC) {
      window.mLearnIPC.getFlashcards();
      window.mLearnIPC.onFlashcards((loaded) => {
        setStore(reconcile(loaded));
        setIsLoading(false);
      });
    } else {
      // Try localStorage for tethered mode
      try {
        const stored = localStorage.getItem('mlearn-flashcards');
        if (stored) {
          setStore(reconcile(JSON.parse(stored)));
        }
      } catch (e) {
        console.error('Failed to load flashcards from localStorage:', e);
      }
      setIsLoading(false);
    }
  };

  // Save flashcards
  const saveFlashcards = () => {
    // Must serialize store FIRST to create a plain object from the Solid store proxy
    // This prevents "An object could not be cloned" errors from BroadcastChannel
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
    // Broadcast serialized data to other windows
    try {
      broadcastChannel?.postMessage({ type: 'update', store: serializedStore });
    } catch (e) {
      console.error('Failed to broadcast flashcard update:', e);
    }
  };

  // Generate unique ID
  const generateId = (): string => {
    return `fc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  };

  // Add new flashcard
  const addFlashcard = (content: FlashcardContent) => {
    const newCard: Flashcard = {
      id: generateId(),
      content,
      ease: DEFAULT_EASE,
      interval: 0,
      dueDate: new Date().toISOString(),
      reviews: 0,
      createdAt: new Date().toISOString(),
    };

    setStore(produce((s) => {
      s.flashcards.push(newCard);
    }));
    saveFlashcards();
  };

  // Remove flashcard
  const removeFlashcard = (id: string) => {
    setStore(produce((s) => {
      s.flashcards = s.flashcards.filter(f => f.id !== id);
    }));
    saveFlashcards();
  };

  // Update flashcard
  const updateFlashcard = (id: string, updates: Partial<Flashcard>) => {
    setStore(produce((s) => {
      const idx = s.flashcards.findIndex(f => f.id === id);
      if (idx !== -1) {
        Object.assign(s.flashcards[idx], updates);
      }
    }));
    saveFlashcards();
  };

  // Review flashcard with SM-2 SRS algorithm
  const reviewFlashcard = (id: string, rating: 'again' | 'hard' | 'good' | 'easy') => {
    setStore(produce((s) => {
      const card = s.flashcards.find(f => f.id === id);
      if (!card) return;

      const quality = ratingToQuality(rating);
      const updates = calculateSM2(card, quality);
      
      // Apply all updates
      Object.assign(card, updates);
    }));
    saveFlashcards();
  };

  // Get due cards
  const getDueCards = (): Flashcard[] => {
    const now = new Date();
    return store.flashcards.filter(f => new Date(f.dueDate) <= now);
  };

  // Get new cards (never reviewed)
  const getNewCards = (limit = 10): Flashcard[] => {
    return store.flashcards
      .filter(f => f.reviews === 0)
      .slice(0, limit);
  };

  // Check if word exists
  const hasWord = (word: string): boolean => {
    return store.flashcards.some(f => f.content?.word === word);
  };

  // Get flashcard by word
  const getByWord = (word: string): Flashcard | null => {
    return store.flashcards.find(f => f.content?.word === word) || null;
  };

  // Handle broadcast
  const handleBroadcast = (event: MessageEvent) => {
    if (event.data?.type === 'update' && event.data.store) {
      setStore(reconcile(event.data.store));
    }
  };

  onMount(() => {
    if (typeof BroadcastChannel !== 'undefined') {
      broadcastChannel = new BroadcastChannel(FLASHCARD_CHANNEL);
      broadcastChannel.onmessage = handleBroadcast;
    }
    loadFlashcards();
  });

  onCleanup(() => {
    broadcastChannel?.close();
  });

  const value: FlashcardContextValue = {
    store,
    addFlashcard,
    removeFlashcard,
    updateFlashcard,
    reviewFlashcard,
    getDueCards,
    getNewCards,
    hasWord,
    getByWord,
    isLoading,
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
