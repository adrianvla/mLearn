/**
 * Flashcard Context
 * Manages flashcard state with Anki-like SRS algorithm
 * Uses UUID-keyed flashcards with states (new/learning/review/relearning)
 * Supports multiple flashcards per word with O(1) word statistics lookup
 */

import { createContext, useContext, ParentComponent, onMount, onCleanup, createSignal, createMemo } from 'solid-js';
import { createStore, reconcile, produce } from 'solid-js/store';
import { DEFAULT_SETTINGS, type FlashcardStore, type Flashcard, type FlashcardContent, type FlashcardMeta, type ReviewQueue, type WordStats, type FlashcardState, type PassiveWordKnowledge, type GrammarKnowledgeEntry, type TranslationEntry, type IgnoredWordEntry, type SuggestedFlashcard, type DailyStudyStats } from '../../shared/types';
import type { WordStatus } from '../../shared/constants';
import * as SRS from '../services/srsAlgorithm';
import { migrationListenerReady, queuePendingFlashcardMigration } from './migrationSignals';
import { useSettings } from './SettingsContext';
import { useLocalization } from './LocalizationContext';
import { useLanguage } from './LanguageContext';

import { showToast, updateToast } from '../components/common/Feedback/Toast';
import { GroupedTaskProgressContent, type TaskState, type TaskStatus, type TaskGroup } from '../components/common/TaskProgress/TaskProgress';
import { getBridge } from '../../shared/bridges';
import { getBackend, resolveCloudApiUrl } from '../../shared/backends';
import { isElectron } from '../../shared/platform';
import { getPassiveHoverDelayMs, getPassiveHoverEaseDecrease, hasReachedPassiveHoverFailCount, shouldDecreaseEaseOnPassiveFailure, shouldUpdateFlashcardOnPassiveFailure } from '../../shared/utils/passiveWordTracking';
import { findAnkiWordMatchInCache } from '../services/ankiWordsCache';
import { getAnkiWordKnowledgeStatus } from '../components/subtitle/wordHoverHelpers';
import { getWordFormCandidates } from '../utils/wordForms';
import { streamChat } from '../services/llmProvider';
import { CloudSessionCancelledError, CloudUnreachableError, withCloudAuth } from '../services/cloudSessionManager';
import { useLowPowerGate } from './LowPowerGateContext';
import { stripHtmlForTts, getLanguageDisplayName } from '../../shared/utils/textUtils';
import { getLogger } from '../../shared/utils/logger';
import { buildKnownWordSetFromStore, isWordKnown as checkWordIsKnown } from '../utils/knowledgeUtils';
import { getComprehensiveWordStatus, getComprehensiveWordStatusWithSource, isWordKnownComprehensive } from '../utils/comprehensiveKnowledge';


const log = getLogger("renderer.context.flashcard");

// Current store version
const CURRENT_VERSION = 2;

type StoredFlashcardStore = Partial<FlashcardStore> & {
  wordToCardMap?: Record<string, string | string[]>;
};

/** Build a language-prefixed composite key for per-language maps */
function langKey(language: string, hash: string): string {
  return language + ':' + hash;
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

// Default flashcard store
function getDefaultStore(): FlashcardStore {
  return {
    flashcards: {},
    wordCandidates: {},
    wordToCardMap: {},
    wordStatsMap: {},
    knownUntracked: {},
    ignoredWords: {},
    suggestedFlashcards: {},
    wordSyncSeen: {},
    wordKnowledge: {},
    grammarKnowledge: {},
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
const DAY_MS = 24 * 60 * 60 * 1000;

/** Pending flashcard creation requesting user choice between SRS and Anki */
export interface PendingFlashcardChoice {
  content: Partial<FlashcardContent> & { front: string; back: string };
  initialEase?: number;
  resolve: (target: 'srs' | 'anki' | 'cancel') => void;
}

/** Parameters for capturing a suggested flashcard on word encounter */
export interface CaptureSuggestionParams {
  word: string;
  reading?: string;
  pos?: string;
  level?: number | null;
  language?: string;
  contextPhrase?: string;
  contextHtml?: string;
  imageUrl?: string;
  videoUrl?: string;
  source?: string;
  sourceMediaHash?: string;
}

export type KnowledgeBank = 'flashcard' | 'manual' | 'ignored' | 'passive';

export interface SetWordBankStatusOptions {
  reading?: string;
  content?: Partial<FlashcardContent> & { front: string; back: string };
}

type ExamStudyTargetStatus = 'new' | 'learning' | 'known' | 'mastered';

// Context interface
interface FlashcardContextValue {
  // Store access
  store: FlashcardStore;
  isLoading: () => boolean;

  // Queue for current session
  queue: () => ReviewQueue;
  queueCounts: () => { new: number; learning: number; review: number; total: number };

  // Card management
  addFlashcard: (content: Partial<FlashcardContent> & { front: string; back: string }, initialEase?: number, skipAnkiChoice?: boolean) => Promise<string>;
  removeFlashcard: (id: string, neverShowAgain?: boolean) => Promise<boolean>;
  updateFlashcard: (id: string, updates: Partial<Flashcard>) => void;
  updateFlashcardContent: (id: string, content: Partial<FlashcardContent>, trackUserEdits?: boolean) => void;
  suspendCard: (id: string) => void;
  unsuspendCard: (id: string) => void;
  buryCard: (id: string) => void;

  // Review operations
  answerCard: (rating: SRS.Rating, cardId?: string, timeSpentMs?: number) => boolean;
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
  /** Synchronous check if word is ignored for the current language */
  isWordIgnoredSync: (word: string) => boolean;
  /** Synchronous get ignored words for the current language */
  getIgnoredWordsSync: () => IgnoredWordEntry[];
  findUnpopulatedFlashcardForWord: (word: string, language?: string) => Flashcard | null;
  populationStats: () => { total: number; unpopulated: number; populated: number; pct: number };

  // Settings
  updateMeta: (updates: Partial<FlashcardMeta>) => void;

  // Undo support
  pushUndoState: (options?: { type?: string; restore?: () => void | Promise<void> }) => void;
  undoLastAction: () => string | null;
  canUndo: () => boolean;

  // Word tracking
  trackWordAppearance: (word: string, reading?: string) => Promise<void>;
  ignoreWordForLanguage: (word: string, reading?: string) => Promise<void>;
  unignoreWordForLanguage: (word: string) => Promise<void>;

  // Suggested Flashcards (captured automatically, promoted on demand)
  /** Capture a suggestion for a word seen during media playback (idempotent per word per language) */
  captureSuggestedFlashcard: (params: CaptureSuggestionParams) => Promise<void>;
  /** All suggestions for the current language, newest first */
  getSuggestedFlashcardsSync: () => SuggestedFlashcard[];
  /** Remove a suggestion without creating a card */
  removeSuggestedFlashcard: (id: string) => void;
  /** Remove multiple suggestions in a single batch operation */
  removeSuggestedFlashcards: (ids: string[]) => void;
  /** Remove suggested flashcards whose words have become known. Returns count removed. */
  cleanupKnownSuggestions: () => number;
  /** Promote suggestions into full flashcards (runs translation + optional LLM/TTS). Returns number promoted. */
  promoteSuggestedFlashcards: (
    ids: string[],
    options?: { useLLM?: boolean; useTts?: boolean; onProgress?: (done: number, total: number) => void }
  ) => Promise<number>;
  addExamStudyFlashcards: (
    words: string[],
    targetStatus: ExamStudyTargetStatus
  ) => Promise<{ created: number; promoted: number; skipped: number }>;

  // Passive word knowledge tracking
  trackWordSeen: (word: string, reading?: string, easeBump?: number) => void;
  trackWordHovered: (word: string, reading?: string) => void;
  cancelWordHover: (word: string) => void;
  getWordKnowledge: (wordHash: string) => PassiveWordKnowledge | undefined;
  isWordKnown: (wordHash: string) => boolean;
  isWordKnownByText: (word: string) => boolean;
  isWordLearning: (wordHash: string) => boolean;
  isWordLearningByText: (word: string) => boolean;
  /** Comprehensive word status: checks ALL knowledge banks (knownUntracked, ignored, SRS, passive) */
  getComprehensiveWordStatusSync: (word: string) => WordStatus;
  /** Comprehensive word status with source attribution */
  getComprehensiveWordStatusWithSourceSync: (word: string) => import('../../renderer/utils/comprehensiveKnowledge').ComprehensiveWordStatusResult;
  /** Shorthand: is word known by any knowledge bank? */
  isWordKnownComprehensiveSync: (word: string) => boolean;
  trackWordStatusChange: (word: string) => void;
  setWordKnowledgeEase: (word: string, ease: number, reading?: string) => void;
  /** Directly set a word's comprehensive status by adjusting its passive ease and clearing conflicting banks */
  setComprehensiveWordStatus: (word: string, status: WordStatus) => void;
  setWordBankStatus: (word: string, status: WordStatus, bank: KnowledgeBank, options?: SetWordBankStatusOptions) => Promise<void>;

  // Word sync seen tracking
  markWordSyncSeen: (word: string) => void;
  clearAllWordSyncSeen: () => void;

  // Grammar knowledge tracking
  trackGrammarEncountered: (pattern: string, level?: number) => void;
  trackGrammarFailed: (pattern: string, level?: number) => void;
  getGrammarKnowledge: (pattern: string) => GrammarKnowledgeEntry | undefined;

  // Session management
  startSession: () => void;
  refreshQueue: () => void;

  // Data management
  resetSRS: () => void;
  nukeAllFlashcards: () => void;

  // LLM example generation
  generateExampleSentenceWithLLM: (word: string, definition: string, language: string) => Promise<{ sentence: string; meaning: string }>;
  translateExampleSentence: (sentence: string, sourceLanguage: string) => Promise<string>;

  // Utility
  intervalToString: (ms: number) => string;
  dueDateToString: (dueDate: number) => string;

  // Anki creation choice
  pendingFlashcardChoice: () => PendingFlashcardChoice | null;
  resolvePendingFlashcardChoice: (target: 'srs' | 'anki' | 'cancel') => void;
}

// Create context
const FlashcardContext = createContext<FlashcardContextValue>();

const FLASHCARD_CHANNEL = 'mlearn-flashcards';

export const FlashcardProvider: ParentComponent = (props) => {
  const { settings } = useSettings();
  const { t } = useLocalization();
  const { getCanonicalForm, getWordVariants } = useLanguage();
  const { requestAccess } = useLowPowerGate();
  const newDayHour = () => settings.newDayHour ?? DEFAULT_SETTINGS.newDayHour;

  const [store, setStore] = createStore<FlashcardStore>(getDefaultStore());
  const [isLoading, setIsLoading] = createSignal(true);
  const [queue, setQueue] = createSignal<ReviewQueue>({ newQueue: [], scheduledQueue: [] });
  const [undoStack, setUndoStack] = createSignal<UndoEntry[]>([]);
  // Used for tracking session start time (could be used for session stats)
  const [, setSessionStartTime] = createSignal<number>(0);

  // Pending flashcard creation choice (SRS vs Anki)
  const [pendingFlashcardChoice, setPendingFlashcardChoice] = createSignal<PendingFlashcardChoice | null>(null);

  const isCloudSessionCancelled = (error: unknown): boolean => error instanceof CloudSessionCancelledError
    || (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'cloud_session_cancelled');

  const isCloudUnreachable = (error: unknown): boolean => error instanceof CloudUnreachableError
    || (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'cloud_unreachable');

  const handleCloudOperationFallback = (error: unknown): boolean => {
    if (isCloudSessionCancelled(error)) {
      showToast({ message: t('mlearn.CloudReLogin.SignInCanceled'), variant: 'warning', duration: 5000 });
      return true;
    }

    if (isCloudUnreachable(error)) {
      showToast({ message: t('mlearn.AI.CloudUnreachable'), variant: 'error', duration: 6000 });
      return true;
    }

    return false;
  };

  const resolvePendingFlashcardChoice = (target: 'srs' | 'anki' | 'cancel') => {
    const pending = pendingFlashcardChoice();
    if (pending) {
      pending.resolve(target);
      setPendingFlashcardChoice(null);
    }
  };

  let broadcastChannel: BroadcastChannel | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const SAVE_DEBOUNCE_MS = 300;
  const ipcCleanups: Array<() => void> = [];

  // Queue counts memo
  const queueCounts = createMemo(() => SRS.getQueueCounts(queue(), store.flashcards, newDayHour()));

  // Get current card
  const getCurrentCard = (): Flashcard | null => {
    return SRS.getNextCard(queue(), store.flashcards, newDayHour());
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
    log.info('[FlashcardContext] Received migration IPC:', info);
    if (info?.occurred) {
      log.info('[FlashcardContext] Flashcard migration completed from v', info.fromVersion);
      const dispatchMigrationEvent = () => {
        log.info('[FlashcardContext] Dispatching migration event to window');
        window.dispatchEvent(new CustomEvent('mlearn-flashcard-migration', { 
          detail: info 
        }));
      };

      if (migrationListenerReady()) {
        dispatchMigrationEvent();
      } else {
        queuePendingFlashcardMigration(info);
      }
    }
  };

  // Load flashcards — just sends IPC request (listener is registered once in onMount)
  const loadFlashcards = () => {
    if (isElectron()) {
      getBridge().flashcards.getFlashcards();
    } else {
      // Try KV store for tethered/mobile mode
      getBridge().kvStore.kvGet('mlearn-flashcards').then((stored) => {
        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            const checked = ensureStoreFields(parsed);
            setStore(reconcile(checked));
            refreshQueue();
          } catch (e) {
            log.error('Failed to parse flashcards from KV store:', e);
          }
        }
        setIsLoading(false);
      }).catch((e) => {
        log.error('Failed to load flashcards from KV store:', e);
        setIsLoading(false);
      });
    }
  };

  function ensureStoreFields(partial: StoredFlashcardStore): FlashcardStore {
    const hour = newDayHour();
    const today = SRS.getTodayDateString(hour);
    const meta = { ...SRS.getDefaultMeta(hour), ...partial.meta };

    let flashcards = partial.flashcards || {};
    const lastDate = partial.meta?.newCardsDate;
    if (lastDate && lastDate !== today) {
      flashcards = SRS.unburyCards(flashcards);
    }

    let wordToCardMap: Record<string, string[]> = partial.wordToCardMap || {};
    for (const [wordHash, cardIds] of Object.entries(wordToCardMap)) {
      if (!Array.isArray(cardIds)) {
        wordToCardMap[wordHash] = [cardIds as unknown as string];
      }
    }

    const lang = settings.language || DEFAULT_SETTINGS.language;
    const plm = meta.perLanguage[lang];
    if (plm) {
      if (plm.newCardsDate !== today) {
        plm.newCardsToday = 0;
        plm.reviewsToday = 0;
        plm.newCardsDate = today;
      }
    } else {
      meta.perLanguage[lang] = {
        newCardsToday: 0,
        reviewsToday: 0,
        newCardsDate: today,
      };
    }

    meta.newCardsToday = meta.perLanguage[lang].newCardsToday;
    meta.reviewsToday = meta.perLanguage[lang].reviewsToday;
    meta.newCardsDate = meta.perLanguage[lang].newCardsDate;

    return {
      flashcards,
      wordCandidates: partial.wordCandidates || {},
      wordToCardMap,
      wordStatsMap: partial.wordStatsMap || {},
      knownUntracked: partial.knownUntracked || {},
      ignoredWords: partial.ignoredWords || {},
      wordKnowledge: partial.wordKnowledge || {},
      grammarKnowledge: partial.grammarKnowledge || {},
      meta,
      dailyStats: (partial.dailyStats as Record<string, Record<string, DailyStudyStats>>) || {},
      suggestedFlashcards: partial.suggestedFlashcards || {},
      wordSyncSeen: partial.wordSyncSeen || {},
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
      log.error('Failed to serialize flashcard store:', e);
      return;
    }

    if (isElectron()) {
      getBridge().flashcards.saveFlashcards(serializedStore);
    } else {
      getBridge().kvStore.kvSet('mlearn-flashcards', JSON.stringify(serializedStore));
    }

    // Broadcast to other windows
    try {
      broadcastChannel?.postMessage({ type: 'update', store: serializedStore });
    } catch (e) {
      log.error('Failed to broadcast flashcard update:', e);
    }
  };

  // Refresh the review queue
  const refreshQueue = () => {
    const lang = settings.language;
    const plm = store.meta.perLanguage[lang];
    const newQueue = SRS.buildReviewQueue(
        store.flashcards,
        store.meta.maxNewCardsPerDay,
        plm?.newCardsToday ?? 0,
        store.meta.maxNewCardsPerDayLearning,
        store.meta.maxReviewsPerDay,
        plm?.reviewsToday ?? 0,
        newDayHour(),
        lang
    );
    setQueue(newQueue);
  };

  // Start a new study session
  const startSession = () => {
    setSessionStartTime(Date.now());
    refreshQueue();
  };

  // Reset all SRS progress — resets every card to 'new' state while keeping content
  const resetSRS = () => {
    const now = Date.now();
    setStore(produce((s) => {
      for (const id of Object.keys(s.flashcards)) {
        const card = s.flashcards[id];
        card.state = 'new';
        card.ease = SRS.MIN_EASE;
        card.interval = 0;
        card.dueDate = now;
        card.reviews = 0;
        card.lapses = 0;
        card.learningStep = 0;
        card.lastReviewed = 0;
        card.lastUpdated = now;
        card.suspended = false;
        card.buried = false;
      }
      const today = SRS.getTodayDateString(newDayHour());
      for (const plm of Object.values(s.meta.perLanguage)) {
        plm.newCardsToday = 0;
        plm.reviewsToday = 0;
        plm.newCardsDate = today;
      }
      // Reset word knowledge and stats maps
      s.wordStatsMap = {};
      s.wordKnowledge = {};
      s.grammarKnowledge = {};
      s.dailyStats = {};
    }));
    refreshQueue();
    saveFlashcards();
  };

  // Nuke all flashcards — factory reset, wipes everything
  const nukeAllFlashcards = () => {
    setStore(reconcile(getDefaultStore()));
    setQueue({ newQueue: [], scheduledQueue: [] });
    setUndoStack([]);
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
    if (stack.length === 0) return null;

    const entry = stack[stack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));

    if (entry.state) {
      setStore(reconcile(entry.state));
    }

    if (entry.restore) {
      const result = entry.restore();
      if (result && typeof (result as Promise<void>).then === 'function') {
        (result as Promise<void>).catch((err) => log.error("unhandled promise rejection", err));
      }
    }

    refreshQueue();
    saveFlashcards();

    return entry.type;
  };

  const canUndo = () => undoStack().length > 0;

  // Add new flashcard - now supports multiple cards per word
  // When use_anki is enabled, shows a choice modal (SRS vs Anki) before creation
  const addFlashcard = async (content: Partial<FlashcardContent> & { front: string; back: string }, initialEase?: number, skipAnkiChoice?: boolean): Promise<string> => {
    log.info('%caddFlashcard called with:', 'color: magenta; font-weight: bold;', content.front);

    // Intercept: if Anki integration is enabled and choice not skipped, let user choose SRS vs Anki
    if (settings.use_anki && !skipAnkiChoice && !settings.flashcardSkipAnkiChoice) {
      const target = await new Promise<'srs' | 'anki' | 'cancel'>((resolve) => {
        setPendingFlashcardChoice({ content, initialEase, resolve });
      });

      if (target === 'cancel') {
        log.info(`Flashcard creation for "${content.front}" was cancelled by user.`);
        return '';
      }
      if (target === 'anki') {
        // The modal handles Anki export; we don't create a local SRS card
        log.info(`Flashcard for "${content.front}" was exported to Anki.`);
        return '';
      }
      // target === 'srs' → continue with normal SRS creation below
    }

    const word = content.front;
    // Use canonical form for hashing so kana and kanji forms share the same key
    const canonical = getCanonicalForm(word);
    const wordHash = await SRS.hashWord(canonical);
    const lang = settings.language;
    const lk = langKey(lang, wordHash);
    log.info('%caddFlashcard: wordHash generated:', 'color: magenta;', wordHash);

    // Check if marked as known (skip flashcard creation)
    if (store.knownUntracked[lk]) {
      log.info(`Word "${word}" is marked as known, not creating flashcard.`);
      return '';
    }

    const now = Date.now();
    const id = SRS.generateUUID();

    let imageUrl = content.imageUrl;
    if (imageUrl?.startsWith('data:image/')) {
      const bridge = getBridge();
      const savedUrl = await bridge.flashcards.saveFlashcardImage(id, imageUrl);
      if (savedUrl) {
        imageUrl = savedUrl;
      }
    }

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
        imageUrl,
        videoUrl: content.videoUrl,
        skipExampleTts: content.skipExampleTts,
        unpopulated: content.unpopulated,
        userEditedFields: content.userEditedFields,
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
      language: lang,
    };

    setStore(produce((s) => {
      // Add flashcard
      s.flashcards[id] = newCard;
      
      // Add to wordToCardMap (array) with language-prefixed key
      if (!s.wordToCardMap[lk]) {
        s.wordToCardMap[lk] = [];
      }
      s.wordToCardMap[lk].push(id);
      
      // Update wordStatsMap
      const cards = s.wordToCardMap[lk].map(cid => s.flashcards[cid]).filter(Boolean);
      s.wordStatsMap[lk] = calculateWordStats(cards);
    }));

    refreshQueue();
    saveFlashcards();
    log.info(`Created new flashcard for word: ${word} (now has ${store.wordToCardMap[lk]?.length || 1} cards)`);

    // Post-creation async tasks: translate example and generate TTS
    // Only run for user-initiated creation (skipAnkiChoice is true for batch/auto creation)
    if (!skipAnkiChoice) {
      postFlashcardCreation(id, newCard);
    }

    return id;
  };

  /**
   * Multi-card post-creation toast system.
   * Combines all concurrent flashcard generation tasks into a single grouped toast.
   */
  let postCreateToastId: number | null = null;
  const [postCreateGroups, setPostCreateGroups] = createSignal<TaskGroup[]>([]);

  /** Re-render the shared toast with current group state */
  const refreshPostCreateToast = () => {
    if (postCreateToastId === null) {
      postCreateToastId = showToast({
        variant: 'info',
        title: t('mlearn.Flashcards.PostCreate.ToastTitle'),
        content: <GroupedTaskProgressContent groups={postCreateGroups} />,
        duration: 0,
      });
    } else {
      updateToast(postCreateToastId, {
        content: <GroupedTaskProgressContent groups={postCreateGroups} />,
      });
    }
  };

  /** Check if all tasks in all groups are terminal (done/error), then auto-dismiss */
  const checkPostCreateCompletion = () => {
    const groups = postCreateGroups();
    const allTerminal = groups.every(g => g.tasks.every(tk => tk.status === 'done' || tk.status === 'error'));
    if (!allTerminal) return;

    const hadError = groups.some(g => g.tasks.some(tk => tk.status === 'error'));
    if (postCreateToastId !== null) {
      updateToast(postCreateToastId, {
        variant: hadError ? 'warning' : 'success',
        title: hadError ? t('mlearn.Flashcards.PostCreate.SomeFailed') : t('mlearn.Flashcards.PostCreate.AllDone'),
        content: <GroupedTaskProgressContent groups={postCreateGroups} />,
        duration: 4000,
      });
    }
    // Reset for next batch
    postCreateToastId = null;
    setPostCreateGroups([]);
  };

  /** Update a specific task's status within a group (identified by groupKey + taskKey) */
  const updatePostCreateTask = (groupKey: string, taskKey: string, status: TaskStatus) => {
    setPostCreateGroups(prev => prev.map(g =>
      g.label === groupKey
        ? { ...g, tasks: g.tasks.map(tk => tk.key === taskKey ? { ...tk, status } : tk) }
        : g
    ));
    refreshPostCreateToast();
    checkPostCreateCompletion();
  };

  /**
   * Post-flashcard-creation tasks: translate example sentence and generate TTS.
   * Runs asynchronously after card creation with toast notifications.
   * Multiple concurrent calls are combined into a single grouped toast.
   */
  const postFlashcardCreation = (cardId: string, card: Flashcard) => {
    const hasExample = card.content.example && card.content.example !== '-' && card.content.example.replace(/<[^>]*>/g, '').trim().length > 0;
    const needsTranslation = hasExample && !card.content.exampleMeaning && settings.llmEnabled;
    const needsTts = settings.flashcardAutoGenerateAudio && isElectron() && settings.flashcardTtsProvider !== DEFAULT_SETTINGS.flashcardTtsProvider;
    const skipExampleTts = card.content.skipExampleTts;

    if (!needsTranslation && !needsTts) return;

    // Build tasks for this card
    const wordLabel = card.content.front;
    const tasks: TaskState[] = [];
    if (needsTranslation) tasks.push({ key: 'translation', label: t('mlearn.Flashcards.PostCreate.Translation'), status: 'pending' });
    if (needsTts) {
      tasks.push({ key: 'wordTts', label: t('mlearn.Flashcards.PostCreate.WordTts'), status: 'pending' });
      if (hasExample && !skipExampleTts) {
        tasks.push({ key: 'exampleTts', label: t('mlearn.Flashcards.PostCreate.ExampleTts'), status: 'pending' });
      }
    }

    // Add this card's group to the shared toast
    setPostCreateGroups(prev => [...prev, { label: wordLabel, tasks }]);
    refreshPostCreateToast();

    // Run tasks concurrently
    const runTranslation = async () => {
      if (!needsTranslation) return;
      updatePostCreateTask(wordLabel, 'translation', 'running');
      try {
        const translation = await translateExampleSentence(card.content.example!, getLanguageDisplayName(settings.language));
        if (translation) {
          updateFlashcardContent(cardId, { exampleMeaning: translation });
        }
        updatePostCreateTask(wordLabel, 'translation', 'done');
      } catch (err) {
        log.warn('Failed to translate example sentence:', err);
        updatePostCreateTask(wordLabel, 'translation', 'error');
      }
    };

    const runTts = async () => {
      if (!needsTts) return;
      const bridge = getBridge();
      const provider = settings.flashcardTtsProvider;
      const voiceSampleId = settings.flashcardVoiceSampleId || undefined;
      const language = settings.language;
      const cloudApiUrl = resolveCloudApiUrl(settings);

      // Word TTS
      updatePostCreateTask(wordLabel, 'wordTts', 'running');
      try {
        const cleanWord = stripHtmlForTts(card.content.front);
        if (cleanWord && cleanWord !== '-') {
          const result = provider === 'cloud'
            ? await withCloudAuth((cloudToken) => bridge.flashcards.generateFlashcardTts(cardId, cleanWord, language, 'word', provider, voiceSampleId, cloudToken, cloudApiUrl))
            : await bridge.flashcards.generateFlashcardTts(cardId, cleanWord, language, 'word', provider, voiceSampleId, undefined, cloudApiUrl);
          if (result) {
            updatePostCreateTask(wordLabel, 'wordTts', 'done');
          } else {
            updatePostCreateTask(wordLabel, 'wordTts', 'error');
          }
        } else {
          updatePostCreateTask(wordLabel, 'wordTts', 'done');
        }
      } catch (err) {
        handleCloudOperationFallback(err);
        log.warn('Failed to generate word TTS:', err);
        updatePostCreateTask(wordLabel, 'wordTts', 'error');
      }

      // Example TTS
      if (hasExample && !skipExampleTts) {
        updatePostCreateTask(wordLabel, 'exampleTts', 'running');
        try {
          const cleanExample = stripHtmlForTts(card.content.example!);
          if (cleanExample && cleanExample !== '-') {
            const result = provider === 'cloud'
              ? await withCloudAuth((cloudToken) => bridge.flashcards.generateFlashcardTts(cardId, cleanExample, language, 'example', provider, voiceSampleId, cloudToken, cloudApiUrl))
              : await bridge.flashcards.generateFlashcardTts(cardId, cleanExample, language, 'example', provider, voiceSampleId, undefined, cloudApiUrl);
            if (result) {
              updatePostCreateTask(wordLabel, 'exampleTts', 'done');
            } else {
              updatePostCreateTask(wordLabel, 'exampleTts', 'error');
            }
          } else {
            updatePostCreateTask(wordLabel, 'exampleTts', 'done');
          }
        } catch (err) {
          handleCloudOperationFallback(err);
          log.warn('Failed to generate example TTS:', err);
          updatePostCreateTask(wordLabel, 'exampleTts', 'error');
        }
      }
    };

    // Fire both concurrently — translation doesn't depend on TTS
    runTranslation();
    runTts();
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
    const canonical = getCanonicalForm(word);
    const wordHash = await SRS.hashWord(canonical);
    const lang = card.language || settings.language;
    const lk = langKey(lang, wordHash);

    setStore(produce((s) => {
      // Remove from flashcards
      delete s.flashcards[id];
      
      // Remove from wordToCardMap array
      if (s.wordToCardMap[lk]) {
        s.wordToCardMap[lk] = s.wordToCardMap[lk].filter(cid => cid !== id);
        
        // If no more cards for this word, clean up
        if (s.wordToCardMap[lk].length === 0) {
          delete s.wordToCardMap[lk];
          delete s.wordStatsMap[lk];
          
          if (neverShowAgain) {
            s.knownUntracked[lk] = true;
            s.ignoredWords[lk] = {
              word,
              reading: card.content.reading,
              language: lang,
              ignoredAt: Date.now(),
            };
          }
        } else {
          // Recalculate stats for remaining cards
          const cards = s.wordToCardMap[lk].map(cid => s.flashcards[cid]).filter(Boolean);
          s.wordStatsMap[lk] = calculateWordStats(cards);
        }
      }
    }));

    // Remove from queue
    setQueue(SRS.removeFromQueue(queue(), id));

    // Clean up associated video file
    if (card.content.videoUrl) {
      getBridge().flashcards.deleteFlashcardVideo(id).catch((err: unknown) =>
        log.warn('Failed to delete flashcard video:', err)
      );
    }

    // Clean up associated image file
    if (card.content.imageUrl) {
      const imageId = extractCardIdFromImageUrl(card.content.imageUrl);
      if (imageId) {
        getBridge().flashcards.deleteFlashcardImage(imageId).catch((err: unknown) =>
          log.warn('Failed to delete flashcard image:', err)
        );
      }
    }

    // Clean up associated TTS audio (word + example fields)
    getBridge().flashcards.deleteFlashcardTts(id).catch((err: unknown) =>
      log.warn('Failed to delete flashcard TTS:', err)
    );

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
  const updateFlashcardContent = (id: string, content: Partial<FlashcardContent>, trackUserEdits = true) => {
    if (!store.flashcards[id]) return;

    const changedFields = trackUserEdits
      ? (Object.keys(content) as Array<keyof FlashcardContent>).filter((key) =>
        key !== 'userEditedFields' && store.flashcards[id].content[key] !== content[key]
      )
      : [];

    setStore(produce((s) => {
      Object.assign(s.flashcards[id].content, content);
      if (changedFields.length > 0) {
        const existing = s.flashcards[id].content.userEditedFields ?? [];
        s.flashcards[id].content.userEditedFields = Array.from(new Set([...existing, ...changedFields.map(String)]));
      }
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
  // cardId should always be passed from the UI to avoid a second getNextCard() call
  // (which uses Math.random() and may return a different card than the one displayed).
  const answerCard = (rating: SRS.Rating, cardId?: string, timeSpentMs?: number): boolean => {
    const card = cardId ? (store.flashcards[cardId] ?? null) : getCurrentCard();
    if (!card) return false;

    const wasNew = card.state === 'new';
    const wasReview = card.state === 'review';
    const updated = SRS.answerCard(card, rating, store.meta);

    // Update queue - remove from current position, may need to re-add if still learning
    let newQueue = SRS.removeFromQueue(queue(), card.id);

    // If card is still in learning/relearning, keep it in the queue so the review
    // session continues with same-day cards instead of dropping them.
    if (updated.state === 'learning' || updated.state === 'relearning') {
      newQueue = SRS.addToQueue(newQueue, updated, newDayHour());
    }

    const remainsQueued = newQueue.newQueue.includes(card.id) || newQueue.scheduledQueue.includes(card.id);

    // Lightweight undo: snapshot only the affected card and meta (avoids expensive full store clone)
    const cardSnapshot: Flashcard = { ...card, content: { ...card.content } };
    const metaSnapshot = { ...store.meta };
    const undoToday = SRS.getTodayDateString(newDayHour());
    const lang = card.language || settings.language;
    const dailyStatSnapshot = store.dailyStats[undoToday]?.[lang]
      ? { ...store.dailyStats[undoToday][lang] }
      : null;

    setUndoStack((prev) => {
      const newStack = [...prev, {
        type: remainsQueued ? 'answer-requeued' : 'answer',
        restore: () => {
          setStore(produce((s) => {
            s.flashcards[card.id] = cardSnapshot;
            Object.assign(s.meta, metaSnapshot);
            if (dailyStatSnapshot) {
              if (!s.dailyStats[undoToday]) s.dailyStats[undoToday] = {};
              s.dailyStats[undoToday][lang] = dailyStatSnapshot;
            } else {
              if (s.dailyStats[undoToday]) {
                delete s.dailyStats[undoToday][lang];
              }
            }
          }));
        },
      }];
      if (newStack.length > MAX_UNDO_STACK_SIZE) newStack.shift();
      return newStack;
    });

    setStore(produce((s) => {
      s.flashcards[card.id] = updated;

      const today = SRS.getTodayDateString(newDayHour());
      const lang = card.language || settings.language;
      const plm = s.meta.perLanguage[lang] || { newCardsToday: 0, reviewsToday: 0, newCardsDate: today };
      if (wasNew) {
        plm.newCardsToday++;
      }
      if (wasReview) {
        plm.reviewsToday++;
      }
      s.meta.perLanguage[lang] = plm;
      s.meta.newCardsToday = plm.newCardsToday;
      s.meta.reviewsToday = plm.reviewsToday;
      s.meta.newCardsDate = plm.newCardsDate;

      // Update daily stats
      if (!s.dailyStats[today]) {
        s.dailyStats[today] = {};
      }
      if (!s.dailyStats[today][lang]) {
        s.dailyStats[today][lang] = {
          date: today,
          newCardsStudied: 0,
          reviewCardsStudied: 0,
          lapses: 0,
          timeSpent: 0,
          graduated: 0,
        };
      }

      if (wasNew) {
        s.dailyStats[today][lang].newCardsStudied++;
      } else {
        s.dailyStats[today][lang].reviewCardsStudied++;
      }

      if (rating === 'again' && card.state === 'review') {
        s.dailyStats[today][lang].lapses++;
      }

      if ((card.state === 'learning' || card.state === 'new') && updated.state === 'review') {
        s.dailyStats[today][lang].graduated++;
      }

      // Track study time
      if (timeSpentMs && timeSpentMs > 0) {
        s.dailyStats[today][lang].timeSpent += timeSpentMs;
      }
    }));

    setQueue(newQueue);

    // Leech detection: notify when a card's lapses reach the threshold
    const threshold = settings.leechThreshold ?? DEFAULT_SETTINGS.leechThreshold;
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
      const canonical = getCanonicalForm(card.content.front);
      const wordHash = await SRS.hashWord(canonical);
      const lk = langKey(card.language || settings.language, wordHash);
      recalculateWordStats(lk);
    })();
    
    saveFlashcards();

    return !remainsQueued;
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
    const canonical = getCanonicalForm(word);
    const wordHash = await SRS.hashWord(canonical);
    const lk = langKey(settings.language, wordHash);
    const ids = store.wordToCardMap[lk];
    if (!ids || ids.length === 0) return [];
    return ids.map(id => store.flashcards[id]).filter(Boolean);
  };

  // Get the first/best card for a word (backwards compatible)
  const getCardByWord = async (word: string): Promise<Flashcard | null> => {
    const canonical = getCanonicalForm(word);
    const wordHash = await SRS.hashWord(canonical);
    const lk = langKey(settings.language, wordHash);
    const ids = store.wordToCardMap[lk];
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
    const canonical = getCanonicalForm(word);
    const wordHash = await SRS.hashWord(canonical);
    const lk = langKey(settings.language, wordHash);
    const ids = store.wordToCardMap[lk];
    return !!ids && ids.length > 0;
  };

  // Get aggregated word statistics for O(1) lookup
  const getWordStats = async (word: string): Promise<WordStats | null> => {
    const canonical = getCanonicalForm(word);
    const wordHash = await SRS.hashWord(canonical);
    const lk = langKey(settings.language, wordHash);
    return store.wordStatsMap[lk] || null;
  };

  // Get due count (respects end-of-SRS-day for review cards)
  const getDueCount = (): number => {
    return SRS.getDueCards(store.flashcards, newDayHour(), settings.language).length;
  };

  // Get new cards count
  const getNewCount = (): number => {
    return SRS.getNewCards(store.flashcards, settings.language).length;
  };

  // =========== Synchronous Lookup Methods ===========
  // Memoized index: word text -> card IDs for O(1) lookup
  const wordFrontIndex = createMemo(() => {
    const index = new Map<string, string[]>();
    for (const [id, card] of Object.entries(store.flashcards)) {
      const word = card.content.front;
      if (!word) continue;
      const existing = index.get(word);
      if (existing) {
        existing.push(id);
      } else {
        index.set(word, [id]);
      }
    }
    return index;
  });

  const knownWordSet = createMemo(() =>
    buildKnownWordSetFromStore(store, settings.known_ease_threshold)
  );

  // Helper: get cards for a word from the index, filtered by current language.
  // Also checks the canonical form (e.g. kana → kanji) to unify lookup.
  const getCardsFromIndex = (word: string): Flashcard[] => {
    const lang = settings.language;
    const result: Flashcard[] = [];
    const seen = new Set<string>();
    const tryWord = (w: string) => {
      const ids = wordFrontIndex().get(w);
      if (!ids) return;
      for (const id of ids) {
        if (seen.has(id)) continue;
        const card = store.flashcards[id];
        if (card && card.language === lang) {
          seen.add(id);
          result.push(card);
        }
      }
    };
    tryWord(word);
    const canonical = getCanonicalForm(word);
    if (canonical !== word) tryWord(canonical);
    return result;
  };

  // Synchronous check if word has flashcard (for current language)
  const hasWordSync = (word: string): boolean => {
    if (!word) return false;
    return getCardsFromIndex(word).length > 0;
  };
  
  // Synchronous get all cards for a word (for current language)
  const getCardsByWordSync = (word: string): Flashcard[] => {
    if (!word) return [];
    return getCardsFromIndex(word);
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

  const isWordIgnoredSync = (word: string): boolean => {
    if (!word) return false;
    const wordHash = SRS.hashWordSync(word);
    const key = langKey(settings.language, wordHash);
    if (store.knownUntracked[key] || store.ignoredWords[key]) return true;
    // Also check the canonical form (kana → kanji)
    const canonical = getCanonicalForm(word);
    if (canonical !== word) {
      const cHash = SRS.hashWordSync(canonical);
      const cKey = langKey(settings.language, cHash);
      return !!store.knownUntracked[cKey] || !!store.ignoredWords[cKey];
    }
    return false;
  };

  const getIgnoredWordsSync = (): IgnoredWordEntry[] => {
    const prefix = `${settings.language}:`;
    return Object.entries(store.ignoredWords)
      .filter(([key]) => key.startsWith(prefix))
      .map(([, entry]) => entry)
      .sort((a, b) => b.ignoredAt - a.ignoredAt);
  };

  const findUnpopulatedFlashcardForWord = (word: string, language = settings.language): Flashcard | null => {
    if (!word) return null;
    const canonical = getCanonicalForm(word);
    const wordHash = SRS.hashWordSync(canonical);
    const ids = store.wordToCardMap[langKey(language, wordHash)] ?? [];
    for (const id of ids) {
      const card = store.flashcards[id];
      if (card?.content.unpopulated === true) return card;
    }
    return null;
  };

  const populationStats = createMemo(() => {
    const cards = Object.values(store.flashcards).filter((card) => card.language === settings.language);
    const total = cards.length;
    const unpopulated = cards.filter((card) => card.content.unpopulated === true).length;
    const populated = total - unpopulated;
    const pct = total === 0 ? 100 : Math.round((populated / total) * 100);
    return { total, unpopulated, populated, pct };
  });

  const filterUserEditedUpdates = (card: Flashcard, updates: Partial<FlashcardContent>): Partial<FlashcardContent> => {
    const userEditedFields = new Set(card.content.userEditedFields ?? []);
    const filtered: Partial<FlashcardContent> = {};
    for (const key of Object.keys(updates) as Array<keyof FlashcardContent>) {
      if (updates[key] !== undefined && !userEditedFields.has(String(key))) {
        Object.assign(filtered, { [key]: updates[key] });
      }
    }
    return filtered;
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
    const canonical = getCanonicalForm(word);
    const wordHash = await SRS.hashWord(canonical);
    const lang = settings.language;
    const lk = langKey(lang, wordHash);
    const now = Date.now();

    // Skip if already has flashcard(s) or marked as known
    const cardIds = store.wordToCardMap[lk];
    if ((cardIds && cardIds.length > 0) || store.knownUntracked[lk]) {
      return;
    }

    setStore(produce((s) => {
      if (!s.wordCandidates[lk]) {
        s.wordCandidates[lk] = { count: 0, lastSeen: now, word: canonical, reading, language: lang };
      }
      s.wordCandidates[lk].count++;
      s.wordCandidates[lk].lastSeen = now;
    }));

    saveFlashcards();
  };

  /**
   * Capture a lightweight suggestion for a word seen during playback/reading.
   * Does NOT call translation/LLM/TTS — only stores screenshot + context.
   */
  const captureSuggestedFlashcard = async (params: CaptureSuggestionParams): Promise<void> => {
    const { word } = params;
    if (!word || !word.trim()) return;
    const canonical = getCanonicalForm(word);
    const lang = params.language ?? settings.language;
    const wordHash = await SRS.hashWord(canonical);
    const lk = langKey(lang, wordHash);
    const now = Date.now();
    const unpopulatedCard = findUnpopulatedFlashcardForWord(canonical, lang);

    if (checkWordIsKnown(lk, knownWordSet(), store.wordKnowledge, settings.known_ease_threshold) && !unpopulatedCard) return;

    let imageUrl = params.imageUrl;
    let newId: string | undefined;
    if (imageUrl?.startsWith('data:image/')) {
      const bridge = getBridge();
      const existing = store.suggestedFlashcards[lk];
      newId = unpopulatedCard?.id ?? existing?.id ?? crypto.randomUUID();
      const savedUrl = await bridge.flashcards.saveFlashcardImage(newId, imageUrl);
      if (savedUrl) {
        imageUrl = savedUrl;
      }
    }

    if (unpopulatedCard) {
      const updates = filterUserEditedUpdates(unpopulatedCard, {
        context: params.contextPhrase,
        example: params.contextHtml,
        imageUrl,
        videoUrl: params.videoUrl,
        source: params.source,
        sourceMediaHash: params.sourceMediaHash,
      });
      updateFlashcardContent(unpopulatedCard.id, { ...updates, unpopulated: false }, false);
      return;
    }

    setStore(produce((s) => {
      const existing = s.suggestedFlashcards[lk];
      if (existing) {
        existing.count++;
        existing.lastSeen = now;
        // Only upgrade capture data if the previous capture lacked it
        if (!existing.imageUrl && imageUrl) existing.imageUrl = imageUrl;
        if (!existing.videoUrl && params.videoUrl) existing.videoUrl = params.videoUrl;
        if (!existing.contextPhrase && params.contextPhrase) existing.contextPhrase = params.contextPhrase;
        if (!existing.contextHtml && params.contextHtml) existing.contextHtml = params.contextHtml;
        if (existing.level == null && params.level != null) existing.level = params.level;
        if (!existing.pos && params.pos) existing.pos = params.pos;
        if (!existing.reading && params.reading) existing.reading = params.reading;
        if (!existing.source && params.source) existing.source = params.source;
        if (!existing.sourceMediaHash && params.sourceMediaHash) existing.sourceMediaHash = params.sourceMediaHash;
      } else {
        s.suggestedFlashcards[lk] = {
          id: newId ?? crypto.randomUUID(),
          word: canonical,
          reading: params.reading,
          pos: params.pos,
          level: params.level ?? null,
          language: lang,
          contextPhrase: params.contextPhrase,
          contextHtml: params.contextHtml,
          imageUrl: imageUrl,
          videoUrl: params.videoUrl,
          source: params.source,
          sourceMediaHash: params.sourceMediaHash,
          createdAt: now,
          lastSeen: now,
          count: 1,
        };
      }
    }));

    saveFlashcards();
  };

  /** Get sorted suggestions for the current language (newest first). Filters out known words and words above the user's level. */
  const getSuggestedFlashcardsSync = (): SuggestedFlashcard[] => {
    const lang = settings.language;
    const userLevel = settings.learningLanguageLevel;
    const known = knownWordSet();
    return Object.values(store.suggestedFlashcards)
      .filter((s) => {
        if (s.language !== lang) return false;
        if (userLevel != null) {
          if (s.level == null || s.level < userLevel) return false;
        }
        const lk = langKey(lang, SRS.hashWordSync(s.word));
        const hasUnpopulatedCard = findUnpopulatedFlashcardForWord(s.word, lang) !== null;
        if (checkWordIsKnown(lk, known, store.wordKnowledge, settings.known_ease_threshold) && !hasUnpopulatedCard) return false;
        return true;
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  };

  /** Find the store key for a suggestion id */
  const findSuggestionKey = (id: string): string | null => {
    for (const [k, v] of Object.entries(store.suggestedFlashcards)) {
      if (v.id === id) return k;
    }
    return null;
  };

  const extractCardIdFromImageUrl = (url: string): string | null => {
    if (!url.startsWith('flashcard-image://')) return null;
    const filename = url.replace('flashcard-image://', '');
    const dotIndex = filename.lastIndexOf('.');
    if (dotIndex > 0) return filename.slice(0, dotIndex);
    return filename;
  };

  const removeSuggestedFlashcard = (id: string): void => {
    const key = findSuggestionKey(id);
    if (!key) return;
    const suggestion = store.suggestedFlashcards[key];

    if (suggestion?.imageUrl) {
      const otherRef = Object.values(store.suggestedFlashcards).some(
        (s) => s.id !== id && s.imageUrl === suggestion.imageUrl
      );
      if (!otherRef) {
        const imageId = extractCardIdFromImageUrl(suggestion.imageUrl);
        if (imageId) {
          getBridge().flashcards.deleteFlashcardImage(imageId).catch((err: unknown) =>
            log.warn('Failed to delete suggested flashcard image:', err)
          );
        }
      }
    }
    if (suggestion?.videoUrl) {
      const otherRef = Object.values(store.suggestedFlashcards).some(
        (s) => s.id !== id && s.videoUrl === suggestion.videoUrl
      );
      if (!otherRef) {
        getBridge().flashcards.deleteFlashcardVideo(id).catch((err: unknown) =>
          log.warn('Failed to delete suggested flashcard video:', err)
        );
      }
    }

    setStore(produce((s) => {
      delete s.suggestedFlashcards[key];
    }));
    saveFlashcards();
  };

  const removeSuggestedFlashcards = (ids: string[]): void => {
    if (ids.length === 0) return;
    const idsSet = new Set(ids);
    const keysToRemove: string[] = [];
    const suggestionsToRemove: SuggestedFlashcard[] = [];
    for (const [key, suggestion] of Object.entries(store.suggestedFlashcards)) {
      if (idsSet.has(suggestion.id)) {
        keysToRemove.push(key);
        suggestionsToRemove.push(suggestion);
      }
    }
    if (keysToRemove.length === 0) return;

    const imageUrlCounts = new Map<string, number>();
    const videoUrlCounts = new Map<string, number>();
    for (const suggestion of Object.values(store.suggestedFlashcards)) {
      if (suggestion.imageUrl) {
        imageUrlCounts.set(suggestion.imageUrl, (imageUrlCounts.get(suggestion.imageUrl) || 0) + 1);
      }
      if (suggestion.videoUrl) {
        videoUrlCounts.set(suggestion.videoUrl, (videoUrlCounts.get(suggestion.videoUrl) || 0) + 1);
      }
    }

    for (const suggestion of suggestionsToRemove) {
      if (suggestion.imageUrl) {
        const newCount = (imageUrlCounts.get(suggestion.imageUrl) || 1) - 1;
        imageUrlCounts.set(suggestion.imageUrl, newCount);
        if (newCount <= 0) {
          const imageId = extractCardIdFromImageUrl(suggestion.imageUrl);
          if (imageId) {
            getBridge().flashcards.deleteFlashcardImage(imageId).catch((err: unknown) =>
              log.warn('Failed to delete suggested flashcard image:', err)
            );
          }
        }
      }
      if (suggestion.videoUrl) {
        const newCount = (videoUrlCounts.get(suggestion.videoUrl) || 1) - 1;
        videoUrlCounts.set(suggestion.videoUrl, newCount);
        if (newCount <= 0) {
          getBridge().flashcards.deleteFlashcardVideo(suggestion.id).catch((err: unknown) =>
            log.warn('Failed to delete suggested flashcard video:', err)
          );
        }
      }
    }

    setStore(produce((s) => {
      for (const key of keysToRemove) {
        delete s.suggestedFlashcards[key];
      }
    }));
    saveFlashcards();
  };

  const cleanupKnownSuggestions = (): number => {
    const idsToRemove: string[] = [];
    const known = knownWordSet();
    const needsAnkiCheck = settings.use_anki;
    for (const [lk, suggestion] of Object.entries(store.suggestedFlashcards)) {
      const hasUnpopulatedCard = findUnpopulatedFlashcardForWord(suggestion.word, suggestion.language) !== null;
      if (known.has(lk) && !hasUnpopulatedCard) {
        idsToRemove.push(suggestion.id);
        continue;
      }
      if (needsAnkiCheck && getComprehensiveWordStatusSync(suggestion.word) === 'known' && !hasUnpopulatedCard) {
        idsToRemove.push(suggestion.id);
      }
    }
    if (idsToRemove.length > 0) {
      removeSuggestedFlashcards(idsToRemove);
    }
    return idsToRemove.length;
  };

  /**
   * Promote a batch of suggestions into real flashcards.
   * Runs translation, then optionally LLM example / TTS generation per card.
   */
  const promoteSuggestedFlashcards = async (
    ids: string[],
    options?: { useLLM?: boolean; useTts?: boolean; onProgress?: (done: number, total: number) => void }
  ): Promise<number> => {
    const useLLM = options?.useLLM ?? false;
    const useTts = options?.useTts ?? false;
    const onProgress = options?.onProgress;
    const total = ids.length;
    if (total === 0) return 0;

    const backend = getBackend({
      mode: settings.backendMode,
      url: settings.backendUrl,
      authToken: settings.cloudAuthAccessToken || settings.cloudAuthToken,
    });

    let backendAvailable = false;
    try {
      backendAvailable = await backend.ping();
    } catch (e) {
      log.error("error", e);
    }
    if (!backendAvailable) {
      showToast({ message: t('mlearn.Settings.SRS.BuiltInFlashcards.ForceRecreate.BackendUnavailable'), variant: 'error' });
      return 0;
    }

    let created = 0;
    let done = 0;
    for (const id of ids) {
      const key = findSuggestionKey(id);
      if (!key) { done++; onProgress?.(done, total); continue; }
      const suggestion = store.suggestedFlashcards[key];
      if (!suggestion) { done++; onProgress?.(done, total); continue; }

      try {
        const translationResponse = await backend.translate(suggestion.word, suggestion.language);
        const data = translationResponse?.data;
        if (!data || !Array.isArray(data)) { done++; onProgress?.(done, total); continue; }

        const firstEntry = data[0] as TranslationEntry | undefined;
        const secondEntry = data[1] as TranslationEntry | undefined;
        let backText = '';
        if (firstEntry?.definitions) {
          backText = Array.isArray(firstEntry.definitions) ? firstEntry.definitions.join('; ') : String(firstEntry.definitions);
        }
        if (!backText) { done++; onProgress?.(done, total); continue; }

        const reading = firstEntry?.reading || suggestion.reading || '';
        let pitchAccent: number | undefined;
        if (data.length > 2 && data[2]) {
          const pitchEntry = data[2] as Record<string, unknown>;
          const pitches = (pitchEntry as { pitches?: Array<{ position?: number }> }).pitches;
          if (pitches?.[0]?.position !== undefined) pitchAccent = pitches[0].position;
        }
        let definitionArr: string[] | undefined;
        if (secondEntry?.definitions) {
          definitionArr = Array.isArray(secondEntry.definitions)
            ? secondEntry.definitions
            : [String(secondEntry.definitions)];
        }

        let exampleSentence = suggestion.contextHtml || suggestion.contextPhrase || '';
        let exampleMeaning = '';
        if (useLLM) {
          try {
            const result = await generateExampleSentenceWithLLM(suggestion.word, backText, suggestion.language);
            if (result.sentence) {
              exampleSentence = result.sentence;
              exampleMeaning = result.meaning;
            }
          } catch (e) {
            log.warn(`Failed to generate LLM example for "${suggestion.word}":`, e);
          }
        }

        const content: Partial<FlashcardContent> & { front: string; back: string } = {
          type: 'word',
          front: suggestion.word,
          back: backText,
          reading: reading || undefined,
          pitchAccent,
          pos: suggestion.pos,
          level: suggestion.level ?? undefined,
          example: exampleSentence || undefined,
          exampleMeaning: exampleMeaning || undefined,
          imageUrl: suggestion.imageUrl,
          videoUrl: suggestion.videoUrl,
          context: suggestion.contextPhrase,
          source: suggestion.source,
          sourceMediaHash: suggestion.sourceMediaHash,
          word: suggestion.word,
          pronunciation: reading || undefined,
          translation: backText ? [backText] : undefined,
          definition: definitionArr,
        };

        const unpopulatedCard = findUnpopulatedFlashcardForWord(suggestion.word, suggestion.language);
        let populatedCardId: string;
        if (unpopulatedCard) {
          const updates = filterUserEditedUpdates(unpopulatedCard, content);
          updateFlashcardContent(unpopulatedCard.id, { ...updates, unpopulated: false }, false);
          populatedCardId = unpopulatedCard.id;
        } else {
          populatedCardId = await addFlashcard(content, undefined, true);
        }
        if (!populatedCardId) continue;
        created++;

        // Optional TTS generation for word + example
        if (populatedCardId && useTts && isElectron()) {
          try {
            const bridge = getBridge();
            const provider = settings.flashcardTtsProvider || DEFAULT_SETTINGS.flashcardTtsProvider;
            const voiceSampleId = settings.flashcardVoiceSampleId || undefined;
             const cloudApiUrl = provider === 'cloud' ? resolveCloudApiUrl(settings) : undefined;
             const ttsItems: Array<{ cardId: string; text: string; field: 'word' | 'example' }> = [
              { cardId: populatedCardId, text: suggestion.word, field: 'word' },
            ];
            if (exampleSentence && !content.skipExampleTts) {
              ttsItems.push({ cardId: populatedCardId, text: stripHtmlForTts(exampleSentence), field: 'example' });
            }
            if (provider === 'cloud') {
              await withCloudAuth((cloudToken) => bridge.flashcards.batchGenerateFlashcardTts(
                ttsItems,
                suggestion.language,
                provider,
                voiceSampleId,
                cloudToken,
                cloudApiUrl,
              ));
            } else {
              await bridge.flashcards.batchGenerateFlashcardTts(
                ttsItems,
                suggestion.language,
                provider,
                voiceSampleId,
                undefined,
                cloudApiUrl,
              );
          }
        } catch (e) {
          handleCloudOperationFallback(e);
          log.warn(`Failed to generate TTS for promoted suggestion "${suggestion.word}":`, e);
        }
        }

        // Remove suggestion after successful promotion
        setStore(produce((s) => {
          delete s.suggestedFlashcards[key];
        }));
      } catch (e) {
        log.warn(`Failed to promote suggestion "${suggestion?.word}":`, e);
      } finally {
        done++;
        onProgress?.(done, total);
      }
    }

    if (created > 0) saveFlashcards();
    return created;
  };

  const getExamStudyScheduling = (targetStatus: ExamStudyTargetStatus) => {
    switch (targetStatus) {
      case 'new':
        return { state: 'new' as FlashcardState, ease: SRS.MIN_EASE, interval: 0 };
      case 'learning':
        return { state: 'learning' as FlashcardState, ease: settings.srsLearningThreshold / 1000, interval: 0 };
      case 'known':
        return {
          state: 'review' as FlashcardState,
          ease: settings.known_ease_threshold / 1000,
          interval: store.meta.graduatingInterval * DAY_MS,
        };
      case 'mastered':
        return {
          state: 'review' as FlashcardState,
          ease: (settings.known_ease_threshold / 1000) * 1.2,
          interval: store.meta.easyInterval * DAY_MS,
        };
    }
  };

  const applyExamStudyScheduling = (id: string, targetStatus: ExamStudyTargetStatus): void => {
    const schedule = getExamStudyScheduling(targetStatus);
    const now = Date.now();
    updateFlashcard(id, {
      state: schedule.state,
      ease: schedule.ease,
      interval: schedule.interval,
      dueDate: now + schedule.interval,
    });
  };

  const addExamStudyFlashcards = async (
    words: string[],
    targetStatus: ExamStudyTargetStatus
  ): Promise<{ created: number; promoted: number; skipped: number }> => {
    let created = 0;
    let promoted = 0;
    let skipped = 0;

    for (const word of words) {
      if (!word.trim()) {
        skipped++;
        continue;
      }

      const canonical = getCanonicalForm(word);
      const wordHash = SRS.hashWordSync(canonical);
      const lk = langKey(settings.language, wordHash);
      const suggestion = store.suggestedFlashcards[lk];

      if (suggestion) {
        const promotedCount = await promoteSuggestedFlashcards([suggestion.id]);
        if (promotedCount > 0) {
          const card = findUnpopulatedFlashcardForWord(canonical, settings.language) ?? getCardByWordSync(canonical);
          if (card) applyExamStudyScheduling(card.id, targetStatus);
          promoted++;
        } else {
          skipped++;
        }
        continue;
      }

      const existingCardIds = store.wordToCardMap[lk] ?? [];
      if (existingCardIds.some((id) => store.flashcards[id])) {
        skipped++;
        continue;
      }

      const now = Date.now();
      const schedule = getExamStudyScheduling(targetStatus);
      const id = SRS.generateUUID();
      const newCard: Flashcard = {
        id,
        content: {
          type: 'word',
          front: canonical,
          back: '',
          word: canonical,
          unpopulated: true,
          userEditedFields: [],
        },
        state: schedule.state,
        ease: schedule.ease,
        interval: schedule.interval,
        dueDate: now + schedule.interval,
        reviews: 0,
        lapses: 0,
        learningStep: 0,
        createdAt: now,
        lastReviewed: now,
        lastUpdated: now,
        language: settings.language,
      };

      setStore(produce((s) => {
        s.flashcards[id] = newCard;
        if (!s.wordToCardMap[lk]) {
          s.wordToCardMap[lk] = [];
        }
        s.wordToCardMap[lk].push(id);
        const cards = s.wordToCardMap[lk].map((cardId) => s.flashcards[cardId]).filter(Boolean);
        s.wordStatsMap[lk] = calculateWordStats(cards);
      }));
      created++;
    }

    if (created > 0 || promoted > 0) {
      refreshQueue();
      saveFlashcards();
    }

    return { created, promoted, skipped };
  };

  // Ignore a word for the current language and stop tracking it.
  const ignoreWordForLanguage = async (word: string, reading?: string) => {
    const canonical = getCanonicalForm(word);
    const wordHash = await SRS.hashWord(canonical);
    const lang = settings.language;
    const lk = langKey(lang, wordHash);

    const existingTimer = hoverTimers.get(lk);
    if (existingTimer) {
      clearTimeout(existingTimer);
      hoverTimers.delete(lk);
    }

    setStore(produce((s) => {
      s.knownUntracked[lk] = true;
      s.ignoredWords[lk] = {
        word,
        reading,
        language: lang,
        ignoredAt: Date.now(),
      };
      delete s.wordCandidates[lk];
      delete s.wordKnowledge[lk];
    }));
    saveFlashcards();

    // If there are flashcards, remove all of them
    const cardIds = store.wordToCardMap[lk];
    if (cardIds && cardIds.length > 0) {
      // Remove all cards for this word
      for (const cardId of [...cardIds]) {
        await removeFlashcard(cardId, true);
      }
    }
  };

  const unignoreWordForLanguage = async (word: string) => {
    const canonical = getCanonicalForm(word);
    const wordHash = await SRS.hashWord(canonical);
    const lk = langKey(settings.language, wordHash);

    setStore(produce((s) => {
      delete s.knownUntracked[lk];
      delete s.ignoredWords[lk];
    }));
    saveFlashcards();
  };

  // ========================
  // Passive Word Knowledge
  // ========================

  const hoverTimers = new Map<string, ReturnType<typeof setTimeout>>();
  onCleanup(() => {
    hoverTimers.forEach(timer => { clearTimeout(timer); });
    hoverTimers.clear();
  });

  // Track that a word was seen (displayed on screen)
  const trackWordSeen = (word: string, reading?: string, easeBump = 0.01) => {
    if (!settings.passiveEaseEnabled) return;
    // Canonicalize: resolve kana to kanji when possible so different forms track together
    const canonical = getCanonicalForm(word);
    const wordHash = SRS.hashWordSync(canonical);
    const lang = settings.language;
    const lk = langKey(lang, wordHash);
    if (store.knownUntracked[lk]) return;
    const now = Date.now();

    setStore(produce((s) => {
      if (!s.wordKnowledge[lk]) {
        s.wordKnowledge[lk] = {
          ease: SRS.MIN_EASE,
          lastSeen: now,
          timesSeen: 0,
          timesHovered: 0,
          word: canonical,
          reading,
          language: lang,
        };
      }
      const k = s.wordKnowledge[lk];
      k.timesSeen++;
      k.lastSeen = now;
      // Ease bump for passive exposure (configurable per caller)
      k.ease = Math.min(5, k.ease + easeBump);
    }));

    // Notify media stats listeners so per-media tracking stays in sync
    const newEase = store.wordKnowledge[lk]?.ease ?? SRS.MIN_EASE;
    window.dispatchEvent(new CustomEvent('mlearn:word-seen', { detail: { word, ease: newEase } }));
  };

  // Track that a word was hovered (user doesn't know it)
  // Debounce: call this on hover start, cancel on hover end
  const trackWordHovered = (word: string, reading?: string) => {
    if (!settings.passiveEaseEnabled) return;
    const canonical = getCanonicalForm(word);
    const wordHash = SRS.hashWordSync(canonical);
    const lang = settings.language;
    const lk = langKey(lang, wordHash);
    if (store.knownUntracked[lk]) return;

    // Cancel existing timer if any
    const existing = hoverTimers.get(lk);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      hoverTimers.delete(lk);
      const now = Date.now();
      let nextEase: number = SRS.MIN_EASE;
      let nextTimesHovered = 0;
      let isFailed = false;

        setStore(produce((s) => {
            if (!s.wordKnowledge[lk]) {
                s.wordKnowledge[lk] = {
                    ease: SRS.MIN_EASE,
                    lastSeen: now,
                    timesSeen: 0,
                    timesHovered: 0,
                    word: canonical,
                    reading,
                    language: lang,
                };
            }
            const k = s.wordKnowledge[lk];
            const hoveredCount = k.timesHovered + 1;
            k.timesHovered = hoveredCount;
            k.lastSeen = now;
            isFailed = hasReachedPassiveHoverFailCount(hoveredCount, settings);
            const wasManuallySetRecently = k.lastStatusChange && (now - k.lastStatusChange) < 300000;
            const easeDecrease = getPassiveHoverEaseDecrease(settings);
            if (isFailed && shouldDecreaseEaseOnPassiveFailure(settings) && !wasManuallySetRecently) {
                k.ease = Math.max(SRS.MIN_EASE, k.ease - easeDecrease);
            }
            nextEase = k.ease;
            nextTimesHovered = hoveredCount;

            if (isFailed && shouldUpdateFlashcardOnPassiveFailure(settings) && !wasManuallySetRecently) {
                const cardIds = s.wordToCardMap[wordHash];
                if (cardIds) {
                    for (const cardId of cardIds) {
                        const card = s.flashcards[cardId];
                        if (card) {
                            card.ease = Math.max(SRS.MIN_EASE, card.ease - easeDecrease);
                            card.lastUpdated = now;
                        }
                    }
                }
            }
        }));
      saveFlashcards();

      // Notify media stats listeners so per-media tracking stays in sync
      window.dispatchEvent(new CustomEvent('mlearn:word-hovered', {
        detail: { word, ease: nextEase, timesHovered: nextTimesHovered, isFailed },
      }));
    }, getPassiveHoverDelayMs(settings));

    hoverTimers.set(lk, timer);
  };

  // Cancel a hover timer (call on hover end)
  const cancelWordHover = (word: string) => {
    const canonical = getCanonicalForm(word);
    const wordHash = SRS.hashWordSync(canonical);
    const lk = langKey(settings.language, wordHash);
    const timer = hoverTimers.get(lk);
    if (timer) {
      clearTimeout(timer);
      hoverTimers.delete(lk);
    }
  };

  // Get passive word knowledge (uses language-prefixed key)
  const getWordKnowledge = (wordHash: string): PassiveWordKnowledge | undefined => {
    // If the key already has a language prefix, use as-is
    if (wordHash.includes(':')) return store.wordKnowledge[wordHash];
    // Otherwise prefix with current language
    return store.wordKnowledge[langKey(settings.language, wordHash)];
  };

  // Check if word is known by built-in SRS passive ease (ease >= known threshold)
  const isWordKnown = (wordHash: string): boolean => {
    const lk = wordHash.includes(':') ? wordHash : langKey(settings.language, wordHash);
    const k = store.wordKnowledge[lk];
    if (!k) return false;
    return k.ease >= (settings.known_ease_threshold / 1000);
  };

  // Check if word is in the learning range by built-in SRS passive ease
  const isWordLearning = (wordHash: string): boolean => {
    const lk = wordHash.includes(':') ? wordHash : langKey(settings.language, wordHash);
    const k = store.wordKnowledge[lk];
    if (!k) return false;
    const ease = k.ease;
    return ease >= (settings.srsLearningThreshold / 1000) && ease < (settings.known_ease_threshold / 1000);
  };

  // Convenience: check if word is known by raw word text (sync hash)
  const isWordKnownByText = (word: string): boolean => {
    const wordHash = SRS.hashWordSync(word);
    if (isWordKnown(langKey(settings.language, wordHash))) return true;
    // Also check the canonical form (kana → kanji)
    const canonical = getCanonicalForm(word);
    if (canonical !== word) {
      const cHash = SRS.hashWordSync(canonical);
      return isWordKnown(langKey(settings.language, cHash));
    }
    return false;
  };

  // Convenience: check if word is learning by raw word text (sync hash)
  const isWordLearningByText = (word: string): boolean => {
    const wordHash = SRS.hashWordSync(word);
    if (isWordLearning(langKey(settings.language, wordHash))) return true;
    const canonical = getCanonicalForm(word);
    if (canonical !== word) {
      const cHash = SRS.hashWordSync(canonical);
      return isWordLearning(langKey(settings.language, cHash));
    }
    return false;
  };

  const getAnkiStatusForWord = (word: string): WordStatus | null => {
    if (!settings.use_anki) return null;
    const forms = getWordFormCandidates(word, getCanonicalForm, getWordVariants);
    const match = findAnkiWordMatchInCache(forms);
    if (!match?.cards?.length) return null;
    return getAnkiWordKnowledgeStatus(match.cards, settings.ankiLearningThreshold, settings.ankiKnownThreshold);
  };

  const getComprehensiveWordStatusSync = (word: string): WordStatus => {
    return getComprehensiveWordStatus(word, {
      getCanonicalForm,
      hashWordSync: SRS.hashWordSync,
      langKey,
      language: settings.language,
      knownUntracked: store.knownUntracked,
      ignoredWords: store.ignoredWords,
      wordKnowledge: store.wordKnowledge,
      knownEaseThreshold: settings.easeThresholdKnown,
      learningThreshold: settings.easeThresholdLearning,
      getCardByWordSync,
      ankiStatus: getAnkiStatusForWord(word),
      sourceOrder: settings.knowledgeSourceOrder,
      resolutionMode: settings.knowledgeResolutionMode,
    });
  };

  const getComprehensiveWordStatusWithSourceSync = (word: string) => {
    return getComprehensiveWordStatusWithSource(word, {
      getCanonicalForm,
      hashWordSync: SRS.hashWordSync,
      langKey,
      language: settings.language,
      knownUntracked: store.knownUntracked,
      ignoredWords: store.ignoredWords,
      wordKnowledge: store.wordKnowledge,
      knownEaseThreshold: settings.easeThresholdKnown,
      learningThreshold: settings.easeThresholdLearning,
      getCardByWordSync,
      ankiStatus: getAnkiStatusForWord(word),
      sourceOrder: settings.knowledgeSourceOrder,
      resolutionMode: settings.knowledgeResolutionMode,
    });
  };

  const isWordKnownComprehensiveSync = (word: string): boolean => {
    return isWordKnownComprehensive(word, {
      getCanonicalForm,
      hashWordSync: SRS.hashWordSync,
      langKey,
      language: settings.language,
      knownUntracked: store.knownUntracked,
      ignoredWords: store.ignoredWords,
      wordKnowledge: store.wordKnowledge,
      knownEaseThreshold: settings.easeThresholdKnown,
      learningThreshold: settings.easeThresholdLearning,
      getCardByWordSync,
      ankiStatus: getAnkiStatusForWord(word),
      sourceOrder: settings.knowledgeSourceOrder,
      resolutionMode: settings.knowledgeResolutionMode,
    });
  };

  // Record when a user manually changes the word status pill
  // Only records the first manual change; skips words changed within first 3 encounters
  const trackWordStatusChange = (word: string) => {
    const canonical = getCanonicalForm(word);
    const wordHash = SRS.hashWordSync(canonical);
    const lk = langKey(settings.language, wordHash);
    const k = store.wordKnowledge[lk];
    if (!k) return;
    // Already recorded a manual status change for this word
    if (k.statusChangedAtSeen !== undefined) return;
    // Skip words the user already knew (changed within first 3 encounters)
    if (k.timesSeen <= 3) return;

    setStore(produce((s) => {
      const entry = s.wordKnowledge[lk];
      if (entry && entry.statusChangedAtSeen === undefined) {
        entry.statusChangedAtSeen = entry.timesSeen;
        entry.lastStatusChange = Date.now();
      }
    }));
    saveFlashcards();
  };

  /**
   * Directly set the ease factor for a word in wordKnowledge.
   * Used by the "Sync with me" word assessment window to record user ratings.
   */
  const setWordKnowledgeEase = (word: string, ease: number, reading?: string) => {
    const canonical = getCanonicalForm(word);
    const wordHash = SRS.hashWordSync(canonical);
    const lang = settings.language;
    const lk = langKey(lang, wordHash);
    if (store.knownUntracked[lk]) return;
    const now = Date.now();
    const eased = ease + settings.manualStatusEaseBuffer;

    setStore(produce((s) => {
      if (!s.wordKnowledge[lk]) {
        s.wordKnowledge[lk] = {
          ease: eased,
          lastSeen: now,
          timesSeen: 0,
          timesHovered: 0,
          word: canonical,
          reading,
          language: lang,
          lastStatusChange: now,
          wordSyncRatedAt: now,
        };
      } else {
        s.wordKnowledge[lk].ease = eased;
        s.wordKnowledge[lk].lastSeen = now;
        s.wordKnowledge[lk].lastStatusChange = now;
        s.wordKnowledge[lk].wordSyncRatedAt = now;
      }
    }));
    saveFlashcards();
  };

  const setComprehensiveWordStatus = (word: string, status: WordStatus) => {
    const canonical = getCanonicalForm(word);
    const wordHash = SRS.hashWordSync(canonical);
    const lang = settings.language;
    const lk = langKey(lang, wordHash);
    const now = Date.now();

    const buffer = settings.manualStatusEaseBuffer;
    let targetEase = settings.easeThresholdUnknown + buffer;
    if (status === 'learning') targetEase = settings.easeThresholdLearning + buffer;
    else if (status === 'known') targetEase = settings.easeThresholdKnown + buffer;

    setStore(produce((s) => {
      if (status !== 'known' && s.knownUntracked[lk]) {
        delete s.knownUntracked[lk];
      }
      if (status !== 'known' && s.ignoredWords[lk]) {
        delete s.ignoredWords[lk];
      }

      if (!s.wordKnowledge[lk]) {
        s.wordKnowledge[lk] = {
          ease: targetEase,
          lastSeen: now,
          timesSeen: 0,
          timesHovered: 0,
          word: canonical,
          language: lang,
          lastStatusChange: now,
        };
      } else {
        s.wordKnowledge[lk].ease = targetEase;
        s.wordKnowledge[lk].lastStatusChange = now;
        s.wordKnowledge[lk].timesHovered = 0;
      }
    }));
    saveFlashcards();
  };

  const setWordBankStatus = async (
    word: string,
    status: WordStatus,
    bank: KnowledgeBank,
    options?: SetWordBankStatusOptions,
  ): Promise<void> => {
    const canonical = getCanonicalForm(word);
    const wordHash = SRS.hashWordSync(canonical);
    const lk = langKey(settings.language, wordHash);
    const now = Date.now();

    switch (bank) {
      case 'manual': {
        setStore(produce((s) => {
          if (status === 'known') {
            s.knownUntracked[lk] = true;
          } else {
            delete s.knownUntracked[lk];
          }
        }));
        saveFlashcards();
        break;
      }

      case 'ignored': {
        if (status === 'known') {
          await ignoreWordForLanguage(canonical, options?.reading);
        } else {
          await unignoreWordForLanguage(canonical);
        }
        break;
      }

      case 'passive': {
        setStore(produce((s) => {
          if (status === 'unknown') {
            delete s.wordKnowledge[lk];
          } else {
            const ease = status === 'known' ? settings.known_ease_threshold / 1000 : settings.srsLearningThreshold / 1000;
            if (!s.wordKnowledge[lk]) {
              s.wordKnowledge[lk] = {
                ease,
                lastSeen: now,
                timesSeen: 0,
                timesHovered: 0,
                word: canonical,
                language: settings.language,
                lastStatusChange: now,
              };
            } else {
              s.wordKnowledge[lk].ease = ease;
              s.wordKnowledge[lk].lastStatusChange = now;
            }
          }
        }));
        saveFlashcards();
        break;
      }

      case 'flashcard': {
        const cards = store.wordToCardMap[lk]?.map((id) => store.flashcards[id]).filter(Boolean) ?? [];

        if (status === 'unknown') {
          for (const card of [...cards]) {
            await removeFlashcard(card.id, false);
          }
        } else if (cards.length > 0) {
          const ease = status === 'known' ? settings.known_ease_threshold / 1000 : settings.srsLearningThreshold / 1000;
          const state: FlashcardState = status === 'known' ? 'review' : 'learning';
          for (const card of cards) {
            updateFlashcard(card.id, { state, ease });
          }
        } else if (options?.content) {
          const ease = status === 'known' ? settings.known_ease_threshold / 1000 : settings.srsLearningThreshold / 1000;
          const state: FlashcardState = status === 'known' ? 'review' : 'learning';
          const cardId = await addFlashcard(options.content, ease);
          if (cardId) {
            updateFlashcard(cardId, { state });
          }
        } else {
          throw new Error(
            `Cannot set flashcard status to "${status}" for "${word}" because no flashcard exists and no content was provided.`,
          );
        }
        break;
      }
    }
  };

  // ========================
  // Word Sync Seen
  // ========================

  const markWordSyncSeen = (word: string) => {
    const canonical = getCanonicalForm(word);
    const wordHash = SRS.hashWordSync(canonical);
    const lk = langKey(settings.language, wordHash);
    setStore(produce((s) => {
      s.wordSyncSeen[lk] = Date.now();
    }));
    saveFlashcards();
  };

  const clearAllWordSyncSeen = () => {
    setStore(produce((s) => {
      s.wordSyncSeen = {};
    }));
    saveFlashcards();
  };

  // ========================
  // Grammar Knowledge
  // ========================

  // Track that a grammar pattern was passively encountered
  const trackGrammarEncountered = (pattern: string, level = 0) => {
    const lang = settings.language;
    const lk = langKey(lang, pattern);
    const now = Date.now();
    setStore(produce((s) => {
      if (!s.grammarKnowledge[lk]) {
        s.grammarKnowledge[lk] = {
          pattern,
          ease: SRS.MIN_EASE,
          timesEncountered: 0,
          timesFailed: 0,
          lastSeen: now,
          level,
          language: lang,
        };
      }
      const g = s.grammarKnowledge[lk];
      g.timesEncountered++;
      g.lastSeen = now;
      // Slight ease bump for passive encounter
      g.ease = Math.min(5, g.ease + 0.01);
    }));
  };

  // Track that user struggled with a grammar pattern
  const trackGrammarFailed = (pattern: string, level = 0) => {
    const lang = settings.language;
    const lk = langKey(lang, pattern);
    const now = Date.now();
    setStore(produce((s) => {
      if (!s.grammarKnowledge[lk]) {
        s.grammarKnowledge[lk] = {
          pattern,
          ease: SRS.MIN_EASE,
          timesEncountered: 0,
          timesFailed: 0,
          lastSeen: now,
          level,
          language: lang,
        };
      }
      const g = s.grammarKnowledge[lk];
      g.timesFailed++;
      g.lastSeen = now;
      // Larger ease decrease for failed grammar
      g.ease = Math.max(0, g.ease - 0.15);
    }));
    saveFlashcards();
  };

  // Get grammar knowledge entry
  const getGrammarKnowledge = (pattern: string): GrammarKnowledgeEntry | undefined => {
    const lk = pattern.includes(':') ? pattern : langKey(settings.language, pattern);
    return store.grammarKnowledge[lk];
  };

  /**
   * Auto-create flashcards from accumulated word candidates.
   * Uses the backend translate endpoint to get word data,
   * and optionally the LLM to generate example sentences.
   * Returns the number of cards created.
   */
  const autoCreateFlashcardsFromCandidates = async (useLLM: boolean): Promise<number> => {
    const lang = settings.language;
    // Only process candidates for the current language
    const candidates = Object.entries(store.wordCandidates)
      .filter(([key, c]) => {
        // Composite key starts with lang prefix, or legacy entry matches current language
        if (key.startsWith(lang + ':')) return true;
        if (!key.includes(':') && (!c.language || c.language === lang)) return true;
        return false;
      });
    if (candidates.length === 0) return 0;

    // Sort by count descending (most frequently seen first)
    candidates.sort((a, b) => b[1].count - a[1].count);

    // Limit to maxNewCardsPerDay
    const maxCards = settings.maxNewCardsPerDay ?? DEFAULT_SETTINGS.maxNewCardsPerDay;
    const toCreate = candidates.slice(0, maxCards);

    // Check backend availability
    const backend = getBackend({
      mode: settings.backendMode,
      url: settings.backendUrl,
      authToken: settings.cloudAuthAccessToken || settings.cloudAuthToken,
    });

    let backendAvailable = false;
    try {
      backendAvailable = await backend.ping();
    } catch (e) {
      log.error("error", e);
      backendAvailable = false;
    }

    if (!backendAvailable) {
      showToast({ message: t('mlearn.Settings.SRS.BuiltInFlashcards.ForceRecreate.BackendUnavailable'), variant: 'error' });
      return 0;
    }

    let createdCount = 0;

    for (const [compositeKey, candidate] of toCreate) {
      // Skip if card already exists for this word
      const existingCards = store.wordToCardMap[compositeKey];
      if (existingCards && existingCards.length > 0) continue;
      if (store.knownUntracked[compositeKey]) continue;

      try {
        // Get translation data from backend
        const translationResponse = await backend.translate(candidate.word, settings.language);
        const data = translationResponse?.data;

        if (!data || !Array.isArray(data)) continue;

        const firstEntry = data[0] as TranslationEntry | undefined;
        const secondEntry = data[1] as TranslationEntry | undefined;

        // Build back text from definitions
        let backText = '';
        if (firstEntry?.definitions) {
          if (Array.isArray(firstEntry.definitions)) {
            backText = firstEntry.definitions.join('; ');
          } else {
            backText = String(firstEntry.definitions);
          }
        }

        if (!backText) continue; // Skip words with no translation

        const reading = firstEntry?.reading || candidate.reading || '';

        // Get pitch accent if available
        let pitchAccent: number | undefined;
        if (data.length > 2 && data[2]) {
          const pitchEntry = data[2] as Record<string, unknown>;
          if (pitchEntry && typeof pitchEntry === 'object') {
            const pitches = (pitchEntry as { pitches?: Array<{ position?: number }> }).pitches;
            if (pitches?.[0]?.position !== undefined) {
              pitchAccent = pitches[0].position;
            }
          }
        }

        // Get definition HTML from the second entry
        let definitionArr: string[] | undefined;
        if (secondEntry?.definitions) {
          definitionArr = Array.isArray(secondEntry.definitions)
            ? secondEntry.definitions
            : [String(secondEntry.definitions)];
        }

        // Optionally generate example sentence with LLM
        let exampleSentence = '';
        let exampleMeaning = '';
        if (useLLM) {
          try {
            const result = await generateExampleSentenceWithLLM(candidate.word, backText, settings.language);
            exampleSentence = result.sentence;
            exampleMeaning = result.meaning;
          } catch (e) {
            log.warn(`Failed to generate LLM example for "${candidate.word}":`, e);
          }
        }

        const content: Partial<FlashcardContent> & { front: string; back: string } = {
          type: 'word',
          front: candidate.word,
          back: backText,
          reading: reading || undefined,
          pitchAccent,
          example: exampleSentence || undefined,
          exampleMeaning: exampleMeaning || undefined,
          // Legacy fields
          word: candidate.word,
          pronunciation: reading || undefined,
          translation: backText ? [backText] : undefined,
          definition: definitionArr,
        };

        await addFlashcard(content, undefined, true);
        createdCount++;

        // Remove from word candidates after successful creation
        setStore(produce((s) => {
          delete s.wordCandidates[compositeKey];
        }));
      } catch (e) {
        log.warn(`Failed to auto-create flashcard for "${candidate.word}":`, e);
      }
    }

    if (createdCount > 0) {
      saveFlashcards();
    }

    return createdCount;
  };

  /**
   * Generate an example sentence for a word using the LLM.
   * Returns { sentence, meaning }. The meaning is translated to the user's app language.
   */
  const generateExampleSentenceWithLLM = async (word: string, definition: string, language: string): Promise<{ sentence: string; meaning: string }> => {
    // Low power gate: prompt before local LLM call
    if (settings.llmProvider !== 'cloud') {
      const allowed = await requestAccess('llm');
      if (!allowed) return { sentence: '', meaning: '' };
    }

    try {
      return await new Promise((resolve, reject) => {
        const targetLang = getLanguageDisplayName(settings.uiLanguage || DEFAULT_SETTINGS.uiLanguage);
        const prompt = `Generate a simple, natural example sentence using the word "${word}" (meaning: ${definition}) in ${language}. Then provide a ${targetLang} translation of the sentence. Format your response exactly as:
Sentence: [sentence in ${language}]
Translation: [${targetLang} translation]`;

        const messages = [
          { role: 'system' as const, content: 'You are a helpful language learning assistant. Generate natural, simple example sentences.' },
          { role: 'user' as const, content: prompt },
        ];

        const { abort } = streamChat(messages, [], {
          onChunk: () => {},
          onToolCall: () => {},
          onDone: (finalContent: string) => {
            const sentenceMatch = finalContent.match(/Sentence:\s*(.+)/i);
            const translationMatch = finalContent.match(/Translation:\s*(.+)/i);

            resolve({
              sentence: sentenceMatch?.[1]?.trim() || '',
              meaning: translationMatch?.[1]?.trim() || '',
            });
          },
          onError: (error: unknown) => {
            reject(error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Unknown error'));
          },
        }, settings);

        const safetyTimeout = setTimeout(() => {
          abort();
          reject(new Error('LLM timeout'));
        }, 30_000);

        const origResolve = resolve;
        const origReject = reject;
        resolve = (val) => { clearTimeout(safetyTimeout); origResolve(val); };
        reject = (err) => { clearTimeout(safetyTimeout); origReject(err); };
      });
    } catch (error) {
      if (handleCloudOperationFallback(error)) {
        return { sentence: '', meaning: '' };
      }

      throw error;
    }
  };

  /**
   * Translate an example sentence to the user's app language using the LLM.
   */
  const translateExampleSentence = async (sentence: string, sourceLanguage: string): Promise<string> => {
    // Strip HTML tags for translation
    const plainText = sentence.replace(/<[^>]*>/g, '').trim();
    if (!plainText || plainText === '-') return '';

    const targetLang = getLanguageDisplayName(settings.uiLanguage || DEFAULT_SETTINGS.uiLanguage);

    // Low power gate: prompt before local LLM call
    if (settings.llmProvider !== 'cloud') {
      const allowed = await requestAccess('llm');
      if (!allowed) return '';
    }

    try {
      return await new Promise((resolve, reject) => {
        const prompt = `Translate the following ${sourceLanguage} sentence to ${targetLang}. Respond with ONLY the translation, nothing else.\n\n${plainText}`;

        const messages = [
          { role: 'system' as const, content: `You are a translator. Provide only the translation to ${targetLang}, no explanations.` },
          { role: 'user' as const, content: prompt },
        ];

        const { abort } = streamChat(messages, [], {
          onChunk: () => {},
          onToolCall: () => {},
          onDone: (finalContent: string) => {
            resolve(finalContent.trim());
          },
          onError: (error: unknown) => {
            reject(error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Unknown error'));
          },
        }, settings);

        const safetyTimeout = setTimeout(() => {
          abort();
          reject(new Error('LLM translation timeout'));
        }, 30_000);

        const origResolve = resolve;
        const origReject = reject;
        resolve = (val) => { clearTimeout(safetyTimeout); origResolve(val); };
        reject = (err) => { clearTimeout(safetyTimeout); origReject(err); };
      });
    } catch (error) {
      if (handleCloudOperationFallback(error)) {
        return '';
      }

      throw error;
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

  // Handle new day event (also triggered by "Force recreate" menu)
  const handleNewDay = async () => {
    const today = SRS.getTodayDateString(newDayHour());
    setStore(produce((s) => {
      // Unbury all cards
      s.flashcards = SRS.unburyCards(s.flashcards);
      const lang = settings.language;
      if (!s.meta.perLanguage[lang]) {
        s.meta.perLanguage[lang] = { newCardsToday: 0, reviewsToday: 0, newCardsDate: today };
      } else {
        s.meta.perLanguage[lang].newCardsToday = 0;
        s.meta.perLanguage[lang].reviewsToday = 0;
        s.meta.perLanguage[lang].newCardsDate = today;
      }
      s.meta.newCardsToday = 0;
      s.meta.newCardsDate = today;
    }));

    // Auto-create flashcards from word candidates if enabled
    if (settings.createUnseenCards && settings.enable_flashcard_creation) {
      const useLLM = settings.flashcardLLMExamples ?? DEFAULT_SETTINGS.flashcardLLMExamples;
      const maxCards = settings.maxNewCardsPerDay ?? DEFAULT_SETTINGS.maxNewCardsPerDay;
      let createdTotal = 0;

      // 1) First pass — use today's accumulated word candidates (existing logic).
      const candidateCount = Object.keys(store.wordCandidates).length;
      if (candidateCount > 0) {
        try {
          createdTotal += await autoCreateFlashcardsFromCandidates(useLLM);
        } catch (e) {
          log.error('Failed to auto-create flashcards from candidates:', e);
        }
      }

      // 2) Fallback — if quota not reached, top up from the suggestions bin
      //    (older automatically captured words that the user never promoted).
      //    Replaces the previous "random dictionary cards" fallback.
      const remaining = maxCards - createdTotal;
      if (remaining > 0) {
        const suggestions = getSuggestedFlashcardsSync();
        if (suggestions.length > 0) {
          // Prefer words with higher frequency levels (harder) and more hits;
          // frontload older suggestions so the bin eventually drains.
          const sorted = [...suggestions].sort((a, b) => {
            // More failed/seen first
            const byCount = b.count - a.count;
            if (byCount !== 0) return byCount;
            return a.createdAt - b.createdAt;
          });
          const pickIds = sorted.slice(0, remaining).map((s) => s.id);
          try {
            createdTotal += await promoteSuggestedFlashcards(pickIds, { useLLM });
          } catch (e) {
            log.error('Failed to auto-promote suggestions:', e);
          }
        }
      }

      if (createdTotal > 0) {
        showToast({
          message: t('mlearn.Settings.SRS.BuiltInFlashcards.ForceRecreate.Created', { count: String(createdTotal) }),
          variant: 'success'
        });
      }
    }

    refreshQueue();
    saveFlashcards();
  };

  // Handle window focus - reload flashcards to sync changes from other windows
  // Only sends the IPC request; the listener is registered once in onMount
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      if (isElectron()) {
        getBridge().flashcards.getFlashcards();
      }
    }
  };

  onMount(() => {
    if (typeof BroadcastChannel !== 'undefined') {
      broadcastChannel = new BroadcastChannel(FLASHCARD_CHANNEL);
      broadcastChannel.onmessage = handleBroadcast;
    }

    // Register all IPC listeners ONCE and store their cleanup functions
    if (isElectron()) {
      const bridge = getBridge();
      // Flashcards loaded listener (single registration — reused by loadFlashcards and visibility sync)
      ipcCleanups.push(bridge.flashcards.onFlashcards(handleFlashcardsLoaded));

      // Migration listener
      ipcCleanups.push(bridge.migration.onFlashcardMigrationComplete((info) => handleMigrationComplete(info)));

      // New day event from main process
      ipcCleanups.push(bridge.flashcards.onNewDayFlashcards(handleNewDay));

      // Tethered mode updates
      ipcCleanups.push(bridge.crossWindow.onUpdatePills((data: unknown) => {
        try {
          const updates: Array<{ word: string; status: number }> = JSON.parse(data as string);
          for (const update of updates) {
            const canonical = getCanonicalForm(update.word);
            const wordHash = SRS.hashWordSync(canonical);
            const lk = langKey(settings.language, wordHash);
            const now = Date.now();

            if (update.status === 2) {
              setStore(produce((s) => {
                s.knownUntracked[lk] = true;
                delete s.wordCandidates[lk];
                delete s.wordKnowledge[lk];
              }));
            } else if (update.status === 1) {
              setStore(produce((s) => {
                if (!s.wordKnowledge[lk]) {
                  s.wordKnowledge[lk] = {
                    ease: settings.srsLearningThreshold / 1000,
                    lastSeen: now,
                    timesSeen: 0,
                    timesHovered: 0,
                    word: canonical,
                    language: settings.language,
                    lastStatusChange: now,
                    wordSyncRatedAt: now,
                  };
                } else {
                  s.wordKnowledge[lk].ease = settings.srsLearningThreshold / 1000;
                  s.wordKnowledge[lk].lastStatusChange = now;
                }
              }));
            } else {
              setStore(produce((s) => {
                delete s.knownUntracked[lk];
                delete s.ignoredWords[lk];
              }));
            }
          }
          saveFlashcards();
        } catch (e) {
          log.error('[Tethered] Failed to process pill updates:', e);
        }
      }));

      ipcCleanups.push(bridge.crossWindow.onUpdateWordAppearance((data: unknown) => {
        try {
          const words: string[] = JSON.parse(data as string);
          for (const word of words) {
            trackWordAppearance(word);
          }
        } catch (e) {
          log.error('[Tethered] Failed to process word appearance updates:', e);
        }
      }));

      ipcCleanups.push(bridge.crossWindow.onUpdateAttemptFlashcardCreation((data: unknown) => {
        try {
          const updates: Array<{ word: string; content: Record<string, unknown> }> = JSON.parse(data as string);
          for (const update of updates) {
            trackWordAppearance(update.word);
          }
        } catch (e) {
          log.error('[Tethered] Failed to process flashcard creation attempts:', e);
        }
      }));

      ipcCleanups.push(bridge.crossWindow.onUpdateCreateFlashcard((data: unknown) => {
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
          log.error('[Tethered] Failed to process flashcard creation:', e);
        }
      }));

      ipcCleanups.push(bridge.crossWindow.onUpdateLastWatched((data: unknown) => {
        try {
          const updates: Array<{ name: string; screenshotUrl: string; videoUrl: string }> = JSON.parse(data as string);
          for (const update of updates) {
            bridge.kvStore.kvGet('mlearn_recently_watched').then((stored) => {
              const list: Array<{ name: string; screenshotUrl: string; videoUrl: string; timestamp: number }> = stored ? JSON.parse(stored) : [];
              list.unshift({ ...update, timestamp: Date.now() });
              if (list.length > 20) list.length = 20;
              bridge.kvStore.kvSet('mlearn_recently_watched', JSON.stringify(list));
            }).catch((e) => {
              log.warn('[Tethered] Failed to save last watched:', e);
            });
          }
        } catch (e) {
          log.error('[Tethered] Failed to process last watched updates:', e);
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
    isWordIgnoredSync,
    getIgnoredWordsSync,
    findUnpopulatedFlashcardForWord,
    populationStats,
    updateMeta,
    pushUndoState,
    undoLastAction,
    canUndo,
    trackWordAppearance,
    ignoreWordForLanguage,
    unignoreWordForLanguage,
    captureSuggestedFlashcard,
    getSuggestedFlashcardsSync,
    removeSuggestedFlashcard,
    removeSuggestedFlashcards,
    cleanupKnownSuggestions,
    promoteSuggestedFlashcards,
    addExamStudyFlashcards,
    trackWordSeen,
    trackWordHovered,
    cancelWordHover,
    getWordKnowledge,
    isWordKnown,
    isWordKnownByText,
    isWordLearning,
    isWordLearningByText,
    getComprehensiveWordStatusSync,
    getComprehensiveWordStatusWithSourceSync,
    isWordKnownComprehensiveSync,
    trackWordStatusChange,
    setWordKnowledgeEase,
    setComprehensiveWordStatus,
    setWordBankStatus,
    markWordSyncSeen,
    clearAllWordSyncSeen,
    trackGrammarEncountered,
    trackGrammarFailed,
    getGrammarKnowledge,
    startSession,
    refreshQueue,
    resetSRS,
    nukeAllFlashcards,
    generateExampleSentenceWithLLM,
    translateExampleSentence,
    intervalToString: (ms: number) => SRS.intervalToString(ms, t),
    dueDateToString: (dueDate: number) => SRS.dueDateToString(dueDate, t),
    pendingFlashcardChoice,
    resolvePendingFlashcardChoice,
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
