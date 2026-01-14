/**
 * Flashcard Context
 * Manages flashcard state with SRS algorithm
 */

import { createContext, useContext, ParentComponent, onMount, onCleanup, createSignal, createMemo } from 'solid-js';
import { createStore, reconcile, produce } from 'solid-js/store';
import type { FlashcardStore, Flashcard, FlashcardContent } from '../../shared/types';

// SRS constants
const EASE_MULTIPLIERS = {
  AGAIN: 0.5,
  HARD: 0.8,
  GOOD: 1.0,
  EASY: 1.3,
};

const MIN_EASE = 1.3;
const DEFAULT_EASE = 2.5;

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
    if (typeof window !== 'undefined' && window.mLearnIPC) {
      window.mLearnIPC.saveFlashcards(store);
    } else {
      try {
        localStorage.setItem('mlearn-flashcards', JSON.stringify(store));
      } catch (e) {
        console.error('Failed to save flashcards to localStorage:', e);
      }
    }
    broadcastChannel?.postMessage({ type: 'update', store });
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

  // Review flashcard with SRS algorithm
  const reviewFlashcard = (id: string, rating: 'again' | 'hard' | 'good' | 'easy') => {
    setStore(produce((s) => {
      const card = s.flashcards.find(f => f.id === id);
      if (!card) return;

      const multiplier = EASE_MULTIPLIERS[rating.toUpperCase() as keyof typeof EASE_MULTIPLIERS];
      
      // Update ease factor
      let newEase = card.ease * multiplier;
      if (newEase < MIN_EASE) newEase = MIN_EASE;
      card.ease = newEase;

      // Calculate new interval
      let newInterval: number;
      if (rating === 'again') {
        newInterval = 1; // 1 minute
      } else if (card.interval === 0) {
        // First review
        newInterval = rating === 'easy' ? 4 * 24 * 60 : rating === 'good' ? 10 : 1;
      } else {
        newInterval = Math.round(card.interval * card.ease);
      }
      card.interval = newInterval;

      // Set due date
      const dueDate = new Date();
      dueDate.setMinutes(dueDate.getMinutes() + newInterval);
      card.dueDate = dueDate.toISOString();

      // Update review count and timestamp
      card.reviews++;
      card.lastReviewed = new Date().toISOString();
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
