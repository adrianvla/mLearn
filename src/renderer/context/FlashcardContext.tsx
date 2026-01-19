/**
 * Flashcard Context
 * Manages flashcard state with SRS algorithm (matching old app exactly)
 */

import { createContext, useContext, ParentComponent, onMount, onCleanup, createSignal } from 'solid-js';
import { createStore, reconcile, produce } from 'solid-js/store';
import type { FlashcardStore, Flashcard, FlashcardContent } from '../../shared/types';
import { toUniqueIdentifier } from '../services/statsService';

// SRS constants - SM-2 Algorithm (matching old app)
const MIN_EASE = 1.3;
const DEFAULT_EASE = 2.5;

// Time constants
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Default flashcard store structure (matching old app exactly)
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

/**
 * Check and fill missing fields in loaded flashcard store
 */
function checkFlashcards(fc_to_check: Partial<FlashcardStore>): FlashcardStore {
  const result = { ...DEFAULT_FLASHCARD_STORE };
  for (const key of Object.keys(DEFAULT_FLASHCARD_STORE) as (keyof FlashcardStore)[]) {
    if (fc_to_check[key] !== undefined) {
      (result as any)[key] = fc_to_check[key];
    }
  }
  return result;
}

/**
 * SM-2 SRS Algorithm - Calculate anticipated due date based on quality rating
 * Exactly matching old app's getAnticipatedDueDate function
 */
function getAnticipatedDueDate(fc: Flashcard, q: number): Flashcard {
  // Clone to avoid mutations
  const result = JSON.parse(JSON.stringify(fc)) as Flashcard;
  const now = Date.now();

  // Normalize ease factor (EF) — default to a sane SM-2 starting value
  const currentEF = typeof result.ease === 'number' && result.ease > 0 ? result.ease : DEFAULT_EASE;
  
  // SM-2 EF update formula based on quality (q in 0..5), clamped to 1.3 minimum
  let newEF = currentEF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  newEF = Math.max(MIN_EASE, newEF);

  // Previous scheduled interval (not elapsed) — avoids minute-scale drift
  const lastReviewed = typeof result.lastReviewed === 'number' ? result.lastReviewed : now;
  const dueDate = typeof result.dueDate === 'number' ? result.dueDate : lastReviewed;
  const prevInterval = Math.max(0, dueDate - lastReviewed);

  let interval: number;

  if (q === 0) {
    // Complete failure - reset
    interval = 0;
  } else if (q < 3) {
    // Failed/hard: short retry step (learning)
    interval = 10 * MINUTE;
  } else {
    // Passed: handle first and second reviews with fixed steps, then scale
    const reviews = typeof result.reviews === 'number' ? result.reviews : 0;

    if (reviews === 0) {
      // First successful review: 1 day for good, 4 days for easy
      interval = q >= 5 ? 4 * DAY : 1 * DAY;
    } else if (reviews === 1) {
      // Second successful review: 6 days for good, 10 days for easy
      interval = q >= 5 ? 10 * DAY : 6 * DAY;
    } else {
      // Subsequent reviews: multiply previous scheduled interval by EF
      const base = prevInterval > 0 ? prevInterval : 1 * DAY;
      interval = Math.round(base * newEF);
    }
  }

  // Update fields
  result.ease = newEF;
  result.lastReviewed = now;
  result.dueDate = now + interval;
  result.lastUpdated = now;
  
  if (q >= 3) {
    result.reviews = (typeof result.reviews === 'number' ? result.reviews : 0) + 1;
  }

  return result;
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

/**
 * Format due date to human-readable string (like old app's dateToInString)
 */
export function dateToInString(date: number): string {
  const now = Date.now();
  let diff = date - now;
  if (diff < 0) diff = 0;
  
  const year = 365.25 * DAY;
  
  if (diff < MINUTE) return '< 1m';
  if (diff < HOUR) return `${Math.round(diff / MINUTE)}m`;
  if (diff < DAY) return `${Math.round(diff / HOUR)}h`;
  if (diff < year) return `${Math.round(diff / DAY)} days`;
  return `${(diff / year).toFixed(1)} years`;
}

/**
 * Get postpone date (5-15 days like old app)
 */
function getPostponeDate(): number {
  return Date.now() + DAY * (5 + Math.random() * 10);
}

/**
 * Get pitch mistake date (next day)
 */
function getPitchMistakeDate(): number {
  return Date.now() + DAY;
}

/**
 * Check if a date is today
 */
function isSameDay(date: number): boolean {
  const now = new Date();
  const d = new Date(date);
  return now.getFullYear() === d.getFullYear() &&
         now.getMonth() === d.getMonth() &&
         now.getDate() === d.getDate();
}

/**
 * Generate unique ID for flashcard
 */
function generateId(): string {
  return `fc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// Undo stack for review operations
interface UndoEntry {
  state: FlashcardStore;
  type: string;
  restore?: () => void | Promise<void>;
}

const MAX_UNDO_STACK_SIZE = 50;

// Context interface
interface FlashcardContextValue {
  store: FlashcardStore;
  isLoading: () => boolean;
  
  // Card management
  addFlashcard: (content: FlashcardContent, ease?: number) => Promise<void>;
  removeFlashcard: (index: number, neverShowAgain?: boolean) => Promise<boolean>;
  updateFlashcard: (index: number, updates: Partial<Flashcard>) => void;
  
  // Review operations
  reviewFlashcard: (quality: 'again' | 'hard' | 'good' | 'easy') => void;
  postponeFlashcard: () => void;
  schedulePitchMistake: () => void;
  markAsKnown: () => Promise<boolean>;
  
  // Query operations
  getDueCards: () => Flashcard[];
  getNewCards: (limit?: number) => Flashcard[];
  hasWord: (word: string) => boolean;
  getByWord: (word: string) => Flashcard | null;
  findFlashcardIndex: (word: string) => Promise<number>;
  
  // SRS calculations for UI
  getAnticipatedDueDate: (fc: Flashcard, q: number) => Flashcard;
  dateToInString: (date: number) => string;
  getPostponeDate: () => number;
  getPitchMistakeDate: () => number;
  
  // Undo support
  pushUndoState: (options?: { type?: string; restore?: () => void | Promise<void> }) => void;
  undoLastAction: () => void;
  canUndo: () => boolean;
  
  // Word tracking
  trackWordAppearance: (word: string) => Promise<void>;
  attemptFlashcardCreation: (word: string, content: FlashcardContent) => Promise<void>;
  
  // Sorting
  sortByDueDate: () => void;
}

// Create context
const FlashcardContext = createContext<FlashcardContextValue>();

const FLASHCARD_CHANNEL = 'mlearn-flashcards';

export const FlashcardProvider: ParentComponent = (props) => {
  const [store, setStore] = createStore<FlashcardStore>(checkFlashcards({}));
  const [isLoading, setIsLoading] = createSignal(true);
  
  // UUID lookup hashmap for quick searches
  const [flashcardSearchHashMap, setFlashcardSearchHashMap] = createSignal<Record<string, number>>({});
  
  // Undo stack
  const [undoStack, setUndoStack] = createSignal<UndoEntry[]>([]);
  
  let broadcastChannel: BroadcastChannel | null = null;

  // Update search hashmap
  const updateFlashcardSearchHashMap = async () => {
    const map: Record<string, number> = {};
    for (let i = 0; i < store.flashcards.length; i++) {
      const flashcard = store.flashcards[i];
      if (flashcard.content?.word) {
        try {
          const uuid = await toUniqueIdentifier(flashcard.content.word);
          map[uuid] = i;
        } catch (e) {
          console.error('Failed to generate UUID for flashcard:', e);
        }
      }
    }
    setFlashcardSearchHashMap(map);
  };

  // Load flashcards
  const loadFlashcards = () => {
    if (typeof window !== 'undefined' && window.mLearnIPC) {
      window.mLearnIPC.getFlashcards();
      window.mLearnIPC.onFlashcards((loaded) => {
        const checked = checkFlashcards(loaded as Partial<FlashcardStore>);
        setStore(reconcile(checked));
        updateFlashcardSearchHashMap();
        setIsLoading(false);
      });
    } else {
      // Try localStorage for tethered mode
      try {
        const stored = localStorage.getItem('mlearn-flashcards');
        if (stored) {
          const parsed = JSON.parse(stored);
          setStore(reconcile(checkFlashcards(parsed)));
          updateFlashcardSearchHashMap();
        }
      } catch (e) {
        console.error('Failed to load flashcards from localStorage:', e);
      }
      setIsLoading(false);
    }
  };

  // Save flashcards
  const saveFlashcards = async () => {
    // Must serialize store FIRST to create a plain object from the Solid store proxy
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
    
    await updateFlashcardSearchHashMap();
  };

  // Sort by due date (like old app)
  const sortByDueDate = () => {
    setStore(produce((s) => {
      s.flashcards.sort((a, b) => a.dueDate - b.dueDate);
    }));
    saveFlashcards();
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
    saveFlashcards();
    
    if (entry.restore) {
      const result = entry.restore();
      if (result && typeof (result as Promise<void>).then === 'function') {
        (result as Promise<void>).catch(console.error);
      }
    }
  };

  const canUndo = () => undoStack().length > 0;

  // Add new flashcard (matching old app's addFlashcard)
  const addFlashcard = async (content: FlashcardContent, ease: number = 0) => {
    const word = content.word;
    const uuid = await toUniqueIdentifier(word);
    
    // Check if already created
    if (uuid in store.alreadyCreated) {
      console.log(`%cFlashcard for word "${word}" already created.`, "color: orange; font-weight: bold;");
      return;
    }
    
    const now = Date.now();
    const newCard: Flashcard = {
      id: generateId(),
      content,
      ease: ease || DEFAULT_EASE,
      interval: 0,
      dueDate: now,
      reviews: 0,
      createdAt: new Date(now).toISOString(),
      lastReviewed: now,
      lastUpdated: now,
    };

    setStore(produce((s) => {
      s.flashcards.push(newCard);
      s.alreadyCreated[uuid] = true;
      s.meta.flashcardsCreatedToday++;
    }));
    
    await saveFlashcards();
    console.log(`%cCreated new flashcard for word: ${word}`, "color: aqua; font-weight: bold;");
  };

  // Remove flashcard (matching old app's removeFlashcard)
  const removeFlashcard = async (index: number = 0, neverShowAgain: boolean = true): Promise<boolean> => {
    if (store.flashcards.length === 0 || index >= store.flashcards.length) return false;
    
    const activeCard = store.flashcards[index];
    if (!activeCard?.content?.word) return false;
    
    const word = activeCard.content.word;
    let uuid: string;
    
    try {
      uuid = await toUniqueIdentifier(word);
    } catch (err) {
      console.error(err);
      return false;
    }
    
    setStore(produce((s) => {
      // Remove from alreadyCreated
      if (uuid in s.alreadyCreated) {
        delete s.alreadyCreated[uuid];
      }
      
      // Add to knownUnTracked if neverShowAgain
      if (neverShowAgain) {
        s.knownUnTracked[uuid] = true;
      } else if (uuid in s.knownUnTracked) {
        delete s.knownUnTracked[uuid];
      }
      
      // Remove from flashcards array
      s.flashcards.splice(index, 1);
    }));
    
    await saveFlashcards();
    return true;
  };

  // Update flashcard
  const updateFlashcard = (index: number, updates: Partial<Flashcard>) => {
    if (index < 0 || index >= store.flashcards.length) return;
    
    setStore(produce((s) => {
      Object.assign(s.flashcards[index], updates);
    }));
    saveFlashcards();
  };

  // Review flashcard with SM-2 SRS algorithm
  const reviewFlashcard = (quality: 'again' | 'hard' | 'good' | 'easy') => {
    if (store.flashcards.length === 0) return;
    
    pushUndoState({ type: 'review' });
    
    const q = ratingToQuality(quality);
    const updated = getAnticipatedDueDate(store.flashcards[0], q);
    
    setStore(produce((s) => {
      s.flashcards[0] = updated;
    }));
    
    sortByDueDate();
  };

  // Postpone flashcard
  const postponeFlashcard = () => {
    if (store.flashcards.length === 0) return;
    
    pushUndoState({ type: 'postpone' });
    
    setStore(produce((s) => {
      s.flashcards[0].dueDate = getPostponeDate();
      s.flashcards[0].lastUpdated = Date.now();
    }));
    
    sortByDueDate();
  };

  // Schedule pitch mistake (next day)
  const schedulePitchMistake = () => {
    if (store.flashcards.length === 0) return;
    
    pushUndoState({ type: 'pitch-mistake' });
    
    const now = Date.now();
    setStore(produce((s) => {
      s.flashcards[0].dueDate = getPitchMistakeDate();
      s.flashcards[0].lastReviewed = now;
      s.flashcards[0].lastUpdated = now;
      s.flashcards[0].reviews++;
    }));
    
    sortByDueDate();
  };

  // Mark as known (like old app's already-known button)
  const markAsKnown = async (): Promise<boolean> => {
    if (store.flashcards.length === 0) return false;
    
    pushUndoState({ type: 'mark-known' });
    
    return await removeFlashcard(0, true);
  };

  // Get due cards
  const getDueCards = (): Flashcard[] => {
    const now = Date.now();
    return store.flashcards.filter(f => f.dueDate <= now);
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

  // Find flashcard index by word
  const findFlashcardIndex = async (word: string): Promise<number> => {
    const uuid = await toUniqueIdentifier(word);
    const map = flashcardSearchHashMap();
    if (uuid in map) return map[uuid];
    return -1;
  };

  // Track word appearance (for auto-flashcard creation)
  const trackWordAppearance = async (word: string) => {
    const uuid = await toUniqueIdentifier(word);
    const now = Date.now();
    
    setStore(produce((s) => {
      if (!s.wordCandidates[uuid]) {
        s.wordCandidates[uuid] = { count: 0, lastSeen: now, word };
      }
      s.wordCandidates[uuid].count++;
      s.wordCandidates[uuid].lastSeen = now;
    }));
    
    await saveFlashcards();
  };

  // Attempt flashcard creation (auto-create based on appearances)
  const attemptFlashcardCreation = async (word: string, content: FlashcardContent) => {
    console.log(`%cAttempting flashcard creation for word: ${word}`, "color: blue; font-weight: bold;", content);
    
    // Check if new day
    if (!isSameDay(store.meta.lastFlashcardCreatedDate)) {
      // Reset daily counter
      setStore(produce((s) => {
        s.meta.lastFlashcardCreatedDate = Date.now();
        s.meta.flashcardsCreatedToday = 0;
      }));
    }
    
    const uuid = await toUniqueIdentifier(word);
    
    // Skip if already created or known
    if (uuid in store.alreadyCreated) return;
    if (uuid in store.knownUnTracked) return;
    
    // Check if word is a candidate
    const candidate = store.wordCandidates[uuid];
    if (!candidate) return;
    
    const isCandidate = candidate.count >= 3 && (Date.now() - candidate.lastSeen < HOUR * 24);
    if (!isCandidate) return;
    
    // Check daily limit (would need settings for maxNewCardsPerDay)
    // For now, use a default of 10
    const maxNewCardsPerDay = 10;
    if (store.meta.flashcardsCreatedToday >= maxNewCardsPerDay) return;
    
    // Create the flashcard
    const countToEase = (x: number) => Math.atan(x / 10) + 1.01;
    await addFlashcard(content, countToEase(candidate.count));
    
    console.log(`%cCreated new flashcard for word: ${word}`, "color: aqua; font-weight: bold;");
  };

  // Handle broadcast
  const handleBroadcast = (event: MessageEvent) => {
    if (event.data?.type === 'update' && event.data.store) {
      setStore(reconcile(checkFlashcards(event.data.store)));
      updateFlashcardSearchHashMap();
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
    isLoading,
    addFlashcard,
    removeFlashcard,
    updateFlashcard,
    reviewFlashcard,
    postponeFlashcard,
    schedulePitchMistake,
    markAsKnown,
    getDueCards,
    getNewCards,
    hasWord,
    getByWord,
    findFlashcardIndex,
    getAnticipatedDueDate,
    dateToInString,
    getPostponeDate,
    getPitchMistakeDate,
    pushUndoState,
    undoLastAction,
    canUndo,
    trackWordAppearance,
    attemptFlashcardCreation,
    sortByDueDate,
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
