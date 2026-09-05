/**
 * Flashcard Context
 * Manages flashcard state with Anki-like SRS algorithm
 * Uses UUID-keyed flashcards with states (new/learning/review/relearning)
 * Supports multiple flashcards per word with O(1) word statistics lookup
 */

import { createContext, useContext, ParentComponent, onMount, onCleanup, createSignal, createMemo } from 'solid-js';
import { createStore, reconcile, produce, unwrap } from 'solid-js/store';
import { DEFAULT_SETTINGS, type FlashcardStore, type Flashcard, type FlashcardContent, type FlashcardMeta, type FlashcardProsody, type ReviewQueue, type WordStats, type FlashcardState, type PassiveWordKnowledge, type GrammarKnowledgeEntry, type TranslationEntry, type IgnoredWordEntry, type SuggestedFlashcard, type DailyStudyStats, type WordCandidate } from '../../shared/types';
import { type AttemptQuality } from '../../shared/constants';
import { isSurfaceScopedAspect } from '../../shared/graph/targets';
import { grammarEvidenceKey, grammarRecognitionEvidence, replayGrammarRecognition } from '../../shared/grammar/evidence';
import type { GrammarEncounterOptions } from '../../shared/grammar/encounters';
import { effectiveStateFromEntry, type EffectiveWordState } from '../utils/effectiveKnowledge';
import { replayKeyProjection } from '../../shared/utils/projectionReplay';
import type { KnowledgeAspect, KnowledgeSource, WordStatus } from '../../shared/constants';
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
import { ankiCacheVersion, buildAnkiStatusKeySets, findAnkiWordMatchInCache } from '../services/ankiWordsCache';
import { getAnkiWordKnowledgeStatus } from '../components/subtitle/wordHoverHelpers';
import { extractProsodyFromTranslationData } from '../utils/readingProsody';
import { getWordFormCandidates } from '../utils/wordForms';
import { streamChat, isLLMReady } from '../services/llmProvider';
import { CloudSessionCancelledError, CloudUnreachableError, withCloudAuth } from '../services/cloudSessionManager';
import { useLowPowerGate } from './LowPowerGateContext';
import { stripHtmlForTts } from '../../shared/utils/textUtils';
import { getLogger } from '../../shared/utils/logger';
import { buildKnownWordSetFromStore } from '../utils/knowledgeUtils';
import { getComprehensiveWordStatus, getComprehensiveWordStatusWithSource, toSelectionBlockingStatus } from '../utils/comprehensiveKnowledge';
import { applyAspectWrite, aspectSourceToDisplay, getAspectStatusSync, type AspectStatusResult } from '../utils/aspectKnowledge';
import { appendEvents, getEventLogForLanguage } from '../services/knowledgeEvents';
import { accumulateWordSeen, flushKnowledgeRollup, installPassiveFlushHooks, setKnowledgeRollupTodayFn, uninstallPassiveFlushHooks } from '../services/knowledgeRollup';
import { nextAttemptId, readActiveEvidence, type AttemptId, type AttemptScaffolds, type AttemptTaskType, type EventSourceVersions, type KnowledgeEvent, type KnowledgeEventLog } from '../../shared/knowledgeEvents';
import { shouldKeepSuggestion, warmDictionaryStatus } from '../utils/suggestedFlashcards';
import { selectEncounterBatch } from '../learning/engine';
import { detectScriptForm, getLanguagePromptName, getLearningLanguageLevelForLanguage } from '../../shared/languageFeatures';
import { getDictionaryTargetLanguageForSettings } from '../utils/dictionaryTargetLanguage';
import { extractReadingValue } from '../utils/translationCacheParsers';
import { parseExampleBlocksFromLLM, type LLMExampleJob, type LLMExampleResult } from '../utils/llmExampleBatch';


const log = getLogger("renderer.context.flashcard");

// Current store version
const CURRENT_VERSION = 3;

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
  language?: string;
  resolve: (target: 'srs' | 'anki' | 'cancel') => void;
}

/** Parameters for capturing a suggested flashcard on word encounter */
export interface CaptureSuggestionParams {
  word: string;
  reading?: string;
  pos?: string;
  level?: number | null;
  language?: string;
  dictionaryTargetLanguage?: string;
  contextPhrase?: string;
  contextHtml?: string;
  imageUrl?: string;
  videoUrl?: string;
  source?: string;
  sourceMediaHash?: string;
}

export type KnowledgeBank =
  | 'flashcard'
  /**
   * @deprecated Old name for passive/manual word status writes. New code should
   * use `passive` and `wordSyncRatedAt`/source metadata for explicit ratings.
   */
  | 'manual'
  | 'ignored'
  | 'passive';

export interface SetWordBankStatusOptions {
  reading?: string;
  language?: string;
  content?: Partial<FlashcardContent> & { front: string; back: string };
}

export type LevelStudyTargetStatus = 'new' | 'learning' | 'known' | 'mastered';

export interface WordTrackingSyncResult {
  tracker: 'flashcards' | 'anki' | 'nothing';
  ankiLookupWord?: string;
}

// Context interface
interface FlashcardContextValue {
  // Store access
  store: FlashcardStore;
  isLoading: () => boolean;
  /**
   * True once the flashcard store is loaded AND the legacy epistemic
   * migration (claim/evidence backfill that can legitimately flip rows)
   * has settled. Before this, absence of a wordKnowledge entry means
   * "not hydrated yet", never "unmeasured" — knowledge UI must render a
   * loading placeholder instead of Untracked/Unknown, and must not write
   * passive evidence into a store that is about to be replaced.
   */
  isKnowledgeReady: () => boolean;

  // Queue for current session
  queue: () => ReviewQueue;
  queueCounts: () => { new: number; learning: number; review: number; total: number };

  // Card management
  addFlashcard: (content: Partial<FlashcardContent> & { front: string; back: string }, initialEase?: number, skipAnkiChoice?: boolean, language?: string) => Promise<string>;
  removeFlashcard: (id: string, neverShowAgain?: boolean) => Promise<boolean>;
  updateFlashcard: (id: string, updates: Partial<Flashcard>) => void;
  updateFlashcardContent: (id: string, content: Partial<FlashcardContent>, trackUserEdits?: boolean) => void;
  suspendCard: (id: string) => void;
  unsuspendCard: (id: string) => void;
  buryCard: (id: string) => void;

  // Review operations
  answerCard: (
    rating: SRS.Rating,
    cardId?: string,
    timeSpentMs?: number,
    attempt?: { attemptId: AttemptId },
  ) => boolean;
  getCurrentCard: () => Flashcard | null;
  getPreviewDueDates: () => Record<SRS.Rating, number> | null;

  // Query operations
  getAllCards: () => Flashcard[];
  getCardById: (id: string) => Flashcard | null;
  /** Get all flashcards for a word (supports multiple cards per word) */
  getCardsByWord: (word: string, language?: string) => Promise<Flashcard[]>;
  /** Get the first/best flashcard for a word (backwards compatible) */
  getCardByWord: (word: string, language?: string) => Promise<Flashcard | null>;
  hasWord: (word: string, language?: string) => Promise<boolean>;
  /** Get aggregated word statistics for O(1) lookup */
  getWordStats: (word: string, language?: string) => Promise<WordStats | null>;
  getDueCount: () => number;
  getNewCount: () => number;
  
  // Synchronous query operations (for reactive SolidJS usage)
  /** Synchronous check if word has a flashcard for the active or supplied language. */
  hasWordSync: (word: string, language?: string) => boolean;
  /** Synchronous get best card by word for the active or supplied language. */
  getCardByWordSync: (word: string, language?: string) => Flashcard | null;
  /** Synchronous get all cards for a word for the active or supplied language. */
  getCardsByWordSync: (word: string, language?: string) => Flashcard[];
  /** Synchronously resolve what tracks this word: own flashcards, Anki, or nothing. */
  getWordTrackingSync: (word: string, language?: string) => WordTrackingSyncResult;
  /** Synchronous check if word is ignored for the active or supplied language. */
  isWordIgnoredSync: (word: string, language?: string) => boolean;
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
  ignoreWordForLanguage: (word: string, reading?: string, language?: string) => Promise<void>;
  unignoreWordForLanguage: (word: string, language?: string) => Promise<void>;

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
  cleanupKnownSuggestions: () => Promise<number>;
  /** Remove current-language suggestions invalidated by current settings or knowledge state. */
  garbageCollectSuggestedFlashcards: () => Promise<number>;
  /** Promote suggestions into full flashcards (runs translation + optional LLM/TTS). Returns number promoted. */
  promoteSuggestedFlashcards: (
    ids: string[],
    options?: { useLLM?: boolean; useTts?: boolean; onProgress?: (done: number, total: number) => void }
  ) => Promise<number>;
  addLevelStudyFlashcards: (
    words: string[],
    targetStatus: LevelStudyTargetStatus,
    language?: string,
    options?: {
      onProgress?: (done: number, total: number) => void;
      preserveExistingStatus?: boolean;
    },
  ) => Promise<{ created: number; promoted: number; skipped: number }>;

  // Passive word knowledge tracking
  trackWordSeen: (word: string, reading?: string, easeBump?: number, language?: string) => void;
  trackWordHovered: (word: string, reading?: string, language?: string) => void;
  cancelWordHover: (word: string, language?: string) => void;
  getWordKnowledge: (wordHash: string) => PassiveWordKnowledge | undefined;
  getAspectStatus: (word: string, aspect: KnowledgeAspect, language?: string) => AspectStatusResult;
  isWordKnown: (wordHash: string) => boolean;
  isWordKnownByText: (word: string, language?: string) => boolean;
  isWordLearning: (wordHash: string) => boolean;
  isWordLearningByText: (word: string, language?: string) => boolean;
  /** Comprehensive word status: checks ALL knowledge banks (knownUntracked, ignored, SRS, passive) */
  getComprehensiveWordStatusSync: (word: string, language?: string) => WordStatus;
  /** Comprehensive word status with source attribution */
  getComprehensiveWordStatusWithSourceSync: (word: string, language?: string) => import('../../renderer/utils/comprehensiveKnowledge').ComprehensiveWordStatusResult;
  /** Shorthand: is word known by any knowledge bank? */
  isWordKnownComprehensiveSync: (word: string, language?: string) => boolean;
  /** Selection predicate: evidence-backed known OR explicit exclusion (never claims knowledge). */
  isWordSettledSync: (word: string, language?: string) => boolean;
  /** Snapshot wordSyncSeen timestamps across all surface-form hashes (undo support for cooldown restore). Policy data only — never knowledge. */
  getWordSyncSeenSnapshotForForms: (word: string, language?: string) => Record<string, number | undefined>;
  /** Policy-cooldown restore (wordSyncSeen only). */
  restoreWordSyncRating: (previousSeenAt: Record<string, number | undefined>, language?: string) => void;
  /** Projection refresh: rebuild wordKnowledge for a word's family keys from ACTIVE evidence. */
  recomputeWordKnowledgeFromEvidence: (word: string, language?: string) => Promise<void>;
  /**
   * Explicit epistemic claim: "I know / am learning / do not know this", or
   * null to withdraw. Never touches evidence ease; overrides the effective
   * classification until cleared. The ONLY manual whole-word status path.
   */
  setWordClaim: (word: string, claim: WordStatus | null, language?: string) => void;
  setAspectStatus: (word: string, aspect: Exclude<KnowledgeAspect, 'meaning'>, status: WordStatus, source: KnowledgeSource | 'manual', language?: string) => void;
  /** Withdraw an aspect claim; evidence classification resumes. */
  clearAspectClaim: (word: string, aspect: Exclude<KnowledgeAspect, 'meaning'>, language?: string) => void;
  /**
   * Canonical attempt-rating evidence interpreter. `attemptId` groups the
   * observation events of one logical learner response (profile submits pass a
   * shared id; absent = standalone attempt). Undo retracts the attempt and the
   * projection replay rebuilds state — no knowledge snapshots.
   */
  recordAttempt: (
    word: string,
    aspect: KnowledgeAspect,
    quality: AttemptQuality,
    options?: { language?: string; method?: 'recall' | 'inference'; demonstrated?: readonly KnowledgeAspect[]; latencyMs?: number; attemptId?: AttemptId; origin?: string },
  ) => { attemptId: AttemptId };
  /** Append retraction tombstones for the given attempts across the word's form keys (undo bookkeeping). */
  appendRetractions: (word: string, language: string, attemptIds: readonly AttemptId[]) => void;
  setWordBankStatus: (word: string, status: WordStatus, bank: KnowledgeBank, options?: SetWordBankStatusOptions) => Promise<void>;

  // Word sync seen tracking
  markWordSyncSeen: (word: string, language?: string) => void;
  clearAllWordSyncSeen: () => void;

  // Grammar knowledge tracking
  trackGrammarEncountered: (pattern: string, levelOrOpts?: number | GrammarEncounterOptions, language?: string) => void;
  trackGrammarFailed: (pattern: string, level?: number, language?: string) => void;
  getGrammarKnowledge: (pattern: string, language?: string) => GrammarKnowledgeEntry | undefined;

  // Session management
  startSession: () => void;
  refreshQueue: () => void;

  // Data management
  resetSRS: () => void;
  nukeAllFlashcards: () => void;

  // LLM example generation
  generateExampleSentenceWithLLM: (word: string, definition: string, language: string) => Promise<{ sentence: string; meaning: string }>;
  generateExampleSentencesWithLLM: (jobs: LLMExampleJob[]) => Promise<LLMExampleResult[]>;
  translateExampleSentence: (sentence: string, sourceLanguage: string, language?: string) => Promise<string>;

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
  const { langData, currentLangData, getFrequencyForLanguage, getCanonicalForm, getWordVariants, getCanonicalFormForLanguage, getWordVariantsForLanguage } = useLanguage();
  // Knowledge readiness: closed until the store hydrates AND the legacy
  // epistemic migration settles (that migration can legitimately flip rows —
  // e.g. passive Known → Learning under the REQ13 honesty cap — so any state
  // shown before it finishes is provisional).
  const [isKnowledgeReady, setIsKnowledgeReady] = createSignal(false);
  const languageData = () => typeof currentLangData === 'function' ? currentLangData() : null;
  const languageDataFor = (language: string): ReturnType<typeof languageData> => (
    language === settings.language ? languageData() : langData[language] ?? null
  );
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

  // Handle loaded flashcards (used by IPC listener registered once in onMount;
  // sync/visibility can re-deliver the store later, reopening the gate).
  const handleFlashcardsLoaded = (loaded: FlashcardStore) => {
    setIsKnowledgeReady(false);
    const checked = ensureStoreFields(loaded as Partial<FlashcardStore>);
    setStore(reconcile(checked));
    void migrateLegacyGrammarKnowledge(checked.grammarKnowledge);
    void migrateLegacyEpistemicState().finally(() => setIsKnowledgeReady(true));
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
            setIsKnowledgeReady(false);
            const checked = ensureStoreFields(parsed);
            setStore(reconcile(checked));
            void migrateLegacyGrammarKnowledge(checked.grammarKnowledge);
            void migrateLegacyEpistemicState().finally(() => setIsKnowledgeReady(true));
            refreshQueue();
          } catch (e) {
            log.error('Failed to parse flashcards from KV store:', e);
            setIsKnowledgeReady(true);
          }
        } else {
          setIsKnowledgeReady(true);
        }
        setIsLoading(false);
      }).catch((e) => {
        log.error('Failed to load flashcards from KV store:', e);
        setIsKnowledgeReady(true);
        setIsLoading(false);
      });
    }
  };

  function ensureStoreFields(partial: StoredFlashcardStore): FlashcardStore {
    const hour = newDayHour();
    const today = SRS.getTodayDateString(hour);
    const meta = { ...SRS.getDefaultMeta(hour), ...partial.meta };

    let flashcards = partial.flashcards || {};
    flashcards = Object.fromEntries(Object.entries(flashcards).map(([id, card]) => [id, {
      ...card,
      retentionCache: card.retentionCache ?? {
        state: card.state,
        ease: card.ease,
        interval: card.interval,
        dueAt: card.dueDate,
        reviews: card.reviews,
        lapses: card.lapses,
        learningStep: card.learningStep,
        lastReviewed: card.lastReviewed,
        provenance: 'migrated-scheduler-cache' as const,
      },
    }]));
    // Legacy stores carried the day marker at the top level; perLanguage is canonical now.
    const lastDate = (partial.meta as { newCardsDate?: string } | undefined)?.newCardsDate;
    if (lastDate && lastDate !== today) {
      flashcards = SRS.unburyCards(flashcards);
    }

    let wordToCardMap: Record<string, string[]> = partial.wordToCardMap || {};
    for (const [wordHash, cardIds] of Object.entries(wordToCardMap)) {
      if (!Array.isArray(cardIds)) {
        wordToCardMap[wordHash] = [cardIds as unknown as string];
      }
    }

    const lang = settings.language;
    if (lang) {
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

    }

    // Migration: strip aspect records seeded by the removed meaning-cascade.
    // inherited === true was written exclusively by that seeding path — a derived
    // projection of the meaning status, never learner evidence. Deleted records
    // resolve to untracked; explicit records and the event log are untouched.
    const wordKnowledge: FlashcardStore['wordKnowledge'] = {};
    for (const [lk, entry] of Object.entries(partial.wordKnowledge || {})) {
      if (!entry?.aspects) {
        wordKnowledge[lk] = entry;
        continue;
      }
      const kept = Object.fromEntries(
        // Legacy persisted records may still carry the removed cascade-seed flag.
        Object.entries(entry.aspects).filter(([, record]) => (record as { inherited?: unknown }).inherited !== true),
      );
      if (Object.keys(kept).length === Object.keys(entry.aspects).length) {
        wordKnowledge[lk] = entry;
        continue;
      }
      const { aspects: _stripped, ...rest } = entry;
      wordKnowledge[lk] = Object.keys(kept).length > 0 ? { ...rest, aspects: kept } : rest;
    }

    return {
      flashcards,
      wordCandidates: partial.wordCandidates || {},
      wordToCardMap,
      wordStatsMap: partial.wordStatsMap || {},
      knownUntracked: partial.knownUntracked || {},
      ignoredWords: partial.ignoredWords || {},
      wordKnowledge,
      grammarKnowledge: partial.grammarKnowledge || {},
      meta,
      dailyStats: (partial.dailyStats as Record<string, Record<string, DailyStudyStats>>) || {},
      suggestedFlashcards: partial.suggestedFlashcards || {},
      wordSyncSeen: partial.wordSyncSeen || {},
      ...(partial.rev !== undefined ? { rev: partial.rev } : {}),
      version: CURRENT_VERSION,
  };
}

/** Entry recency for LWW merges: claim timestamp wins, then status change, then last seen. */
function knowledgeEntryRecency(entry: PassiveWordKnowledge): number {
  return entry.claimAt ?? entry.lastStatusChange ?? entry.lastSeen;
}

/**
 * Cross-window convergence for knowledge collections: per-entry LWW instead of
 * whole-store replace. A stale snapshot can no longer revert a newer claim,
 * evidence write, candidate count, suggestion, or day stat made in another
 * window.
 */

/** wordCandidates LWW: the higher encounter count wins; ties break on lastSeen. */
function mergeWordCandidates(local: FlashcardStore, incoming: FlashcardStore): void {
  for (const [lk, entry] of Object.entries(incoming.wordCandidates)) {
    const current = local.wordCandidates[lk];
    if (!current || entry.count > current.count || (entry.count === current.count && entry.lastSeen > current.lastSeen)) {
      local.wordCandidates[lk] = entry;
    }
  }
}

/**
 * grammarKnowledge LWW: concurrent windows replay the same evidence journal,
 * so the encounter count is the recency signal; at equal counts the higher
 * ease wins (a failure lowers ease without adding an encounter).
 */
function mergeGrammarKnowledge(local: FlashcardStore, incoming: FlashcardStore): void {
  for (const [lk, entry] of Object.entries(incoming.grammarKnowledge)) {
    const current = local.grammarKnowledge[lk];
    if (
      !current
      || entry.timesEncountered > current.timesEncountered
      || (entry.timesEncountered === current.timesEncountered && entry.ease > current.ease)
    ) {
      local.grammarKnowledge[lk] = entry;
    }
  }
}

/** suggestedFlashcards LWW: the most recently seen suggestion wins. */
function mergeSuggestedFlashcards(local: FlashcardStore, incoming: FlashcardStore): void {
  for (const [lk, entry] of Object.entries(incoming.suggestedFlashcards)) {
    const current = local.suggestedFlashcards[lk];
    if (!current || entry.lastSeen > current.lastSeen) local.suggestedFlashcards[lk] = entry;
  }
}

/** dailyStats: union per day+language, max per counter (concurrent windows each increment their own copy). */
function mergeDailyStats(local: FlashcardStore, incoming: FlashcardStore): void {
  for (const [date, perLanguage] of Object.entries(incoming.dailyStats)) {
    if (local.dailyStats[date] === undefined) local.dailyStats[date] = {};
    for (const [lang, stats] of Object.entries(perLanguage)) {
      const current = local.dailyStats[date][lang];
      local.dailyStats[date][lang] = current
        ? {
            date: stats.date || current.date,
            newCardsStudied: Math.max(current.newCardsStudied, stats.newCardsStudied),
            reviewCardsStudied: Math.max(current.reviewCardsStudied, stats.reviewCardsStudied),
            lapses: Math.max(current.lapses, stats.lapses),
            timeSpent: Math.max(current.timeSpent, stats.timeSpent),
            graduated: Math.max(current.graduated, stats.graduated),
          }
        : stats;
    }
  }
}

function mergeKnowledgeMaps(local: FlashcardStore, incoming: FlashcardStore): void {
  for (const [lk, entry] of Object.entries(incoming.wordKnowledge)) {
    const current = local.wordKnowledge[lk];
    if (!current || knowledgeEntryRecency(entry) > knowledgeEntryRecency(current)) {
      local.wordKnowledge[lk] = entry;
    }
  }
  for (const [lk, value] of Object.entries(incoming.knownUntracked)) {
    if (value && !local.knownUntracked[lk]) local.knownUntracked[lk] = value;
  }
  for (const [lk, entry] of Object.entries(incoming.ignoredWords)) {
    const current = local.ignoredWords[lk];
    if (!current || entry.ignoredAt > current.ignoredAt) local.ignoredWords[lk] = entry;
  }
  for (const [lk, seen] of Object.entries(incoming.wordSyncSeen)) {
    if (seen > (local.wordSyncSeen[lk] ?? 0)) local.wordSyncSeen[lk] = seen;
  }
  mergeWordCandidates(local, incoming);
  mergeGrammarKnowledge(local, incoming);
  mergeSuggestedFlashcards(local, incoming);
  mergeDailyStats(local, incoming);
}

/**
 * One-time legacy epistemic migration (Tier 1 → Tier 2 claims/evidence):
 *
 * 1. knownUntracked ("known words list" bank) → explicit claim:'known' on the
 *    word's knowledge entries + kind:'claim' journal events. The bank stops
 *    being an epistemic source; only unrecoverable orphan hashes remain (see
 *    isKnownClaimed) until storage migrations recover their word text.
 * 2. Legacy materialized ease/graduated cards that predate the journal get one
 *    provenance-marked rollup event each, so the projection is rebuildable
 *    from evidence for pre-Tier-2 data.
 *
 */
const migrateLegacyEpistemicState = async (): Promise<void> => {
  const now = Date.now();
  try {
    const byLanguage = new Map<string, string[]>();
    const claimBackfill: Record<string, KnowledgeEvent[]> = {};

    // 1. knownUntracked → claims (word text recoverable via co-located entries).
    setStore(produce((s) => {
      for (const [lk, value] of Object.entries(s.knownUntracked)) {
        if (!value) {
          delete s.knownUntracked[lk];
          continue;
        }
        const language = lk.includes(':') ? lk.split(':')[0] : settings.language;
        const word = s.ignoredWords[lk]?.word ?? s.wordKnowledge[lk]?.word;
        if (!word) continue; // orphan hash — kept until storage migration recovers text
        const form = getPrimaryWordFormForLanguage(word, language);
        const wordHash = SRS.hashWordSync(form);
        const claimLk = langKey(language, wordHash);
        if (!s.wordKnowledge[claimLk]) {
          s.wordKnowledge[claimLk] = {
            ease: SRS.MIN_EASE,
            lastSeen: now,
            firstSeen: now,
            timesSeen: 0,
            timesHovered: 0,
            word: form,
            language,
          };
        }
        s.wordKnowledge[claimLk].claim = 'known';
        s.wordKnowledge[claimLk].claimAt = now;
        delete s.knownUntracked[lk];
        claimBackfill[claimLk] = [{
          t: now, kind: 'claim', source: 'manual', aspect: 'meaning', toStatus: 'known',
        }];
        const keys = byLanguage.get(language) ?? [];
        if (!keys.includes(claimLk)) keys.push(claimLk);
        byLanguage.set(language, keys);
      }
    }));
    // 2. Evidence backfill for keys the journal has never seen.
    const additions: KnowledgeEventLog = { ...claimBackfill };
    const languages = new Set(byLanguage.keys());
    for (const lk of Object.keys(store.wordKnowledge)) {
      if (lk.includes(':')) languages.add(lk.split(':')[0]);
    }
    // A materialized row proves active provenance when it was last written by
    // an explicit-status source or links graduated SRS cards (legacy SRS-as-
    // truth). REQ25: passive-only rows must backfill as passiveTracking — a
    // 'migration' row is an ACTIVE source on replay and would promote pure
    // exposure into active evidence.
    const hasLinkedGraduatedCards = (lk: string): boolean =>
      (store.wordToCardMap[lk] ?? []).some((id) => {
        const card = store.flashcards[id];
        return Boolean(card) && card.state !== 'new';
      });
    const isPassiveOnlyRow = (lk: string, entry: PassiveWordKnowledge): boolean =>
      entry.claim === undefined
      && entry.hasActiveEvidence !== true
      && entry.lastStatusChange === undefined
      && (entry.lastEvidenceSource === undefined || entry.lastEvidenceSource === 'passiveTracking')
      && !hasLinkedGraduatedCards(lk);
    for (const language of languages) {
      let eventLog: KnowledgeEventLog;
      try {
        eventLog = await getEventLogForLanguage(language);
      } catch {
        continue;
      }
      const prefix = `${language}:`;
      for (const [lk, entry] of Object.entries(store.wordKnowledge)) {
        if (!lk.startsWith(prefix)) continue;
        if (eventLog[lk]?.length) continue;
        if (additions[lk]?.length) continue;
        if (entry.ease <= SRS.MIN_EASE && entry.timesSeen === 0 && entry.claim === undefined) continue;
        additions[lk] = [{
          t: entry.lastSeen || now,
          kind: 'rollup',
          source: isPassiveOnlyRow(lk, entry) ? 'passiveTracking' : 'migration',
          aspect: 'meaning',
          origin: 'legacy-projection-backfill',
          easeAfter: entry.ease,
          ...(entry.timesSeen ? { timesSeenDelta: entry.timesSeen } : {}),
        }];
      }
      // Graduated cards without journal evidence (legacy SRS-as-truth).
      for (const [lk, cardIds] of Object.entries(store.wordToCardMap)) {
        if (!lk.startsWith(prefix)) continue;
        if (eventLog[lk]?.length || additions[lk]?.length) continue;
        const eases = cardIds
          .map((id) => store.flashcards[id])
          .filter((card): card is Flashcard => Boolean(card) && card.state !== 'new')
          .map((card) => card.ease);
        if (eases.length === 0) continue;
        additions[lk] = [{
          t: now,
          kind: 'rollup',
          source: 'migration',
          aspect: 'meaning',
          origin: 'legacy-card-backfill',
          easeAfter: Math.max(...eases),
        }];
      }
    }
    if (Object.keys(additions).length > 0) {
      await appendEvents(additions);
      saveFlashcards();
    }
  } catch (error) {
    log.warn('legacy epistemic migration failed:', error);
  }
};

  /**
   * Imports legacy counters once as recognition-only, provenance-marked
   * evidence, then (re)materializes the grammar cache. The active language is
   * always materialized — even with no legacy entries — so a cache rebuilt
   * from scratch (fresh store, corruption, migration) recovers every pattern
   * that has active journal evidence.
   */
  const migrateLegacyGrammarKnowledge = async (entries: Record<string, GrammarKnowledgeEntry>): Promise<void> => {
    const grouped = new Map<string, GrammarKnowledgeEntry[]>();
    for (const entry of Object.values(entries)) {
      const language = entry.language ?? settings.language;
      const group = grouped.get(language) ?? [];
      group.push(entry);
      grouped.set(language, group);
    }
    const languages = new Set(grouped.keys());
    languages.add(settings.language);
    for (const language of languages) {
      const group = grouped.get(language) ?? [];
      try {
        const eventLog = await getEventLogForLanguage(language);
        const additions: KnowledgeEventLog = {};
        for (const entry of group) {
          const key = grammarEvidenceKey(language, entry.pattern, 'grammar-recognition');
          if (eventLog[key]?.length) continue;
          additions[key] = [{
            ...grammarRecognitionEvidence(language, entry.pattern, { t: entry.lastSeen, kind: 'rollup' }),
            origin: 'grammar-legacy-migration',
            easeAfter: entry.ease,
            timesSeenDelta: entry.timesEncountered,
            grammarFailedDelta: entry.timesFailed,
          }];
        }
        if (Object.keys(additions).length > 0) await appendEvents(additions);
        await materializeGrammarKnowledge(
          language,
          group.map((entry) => ({ pattern: entry.pattern, level: entry.level })),
        );
      } catch (error) {
        log.warn('grammar evidence migration failed:', error);
      }
    }
  };

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
      // structuredClone(unwrap(...)) unwraps the reactive proxy without the
      // JSON string round trip — the clone of the full store ran on the main
      // thread after every debounced write (hover tracking included) and was
      // a measured ~100ms jank source in the Reader.
      serializedStore = structuredClone(unwrap(store));
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
    // The user-facing "Max new cards to learn" setting is the effective daily cap
    // for studying new cards. The legacy meta.maxNewCardsPerDay field (the
    // auto-creation quota, default 10) must NOT shadow it — it used to cap the
    // queue at min(legacy, learning), so a user setting of 40 still only saw 10
    // new cards per day. -1 means unlimited.
    const learningCap = store.meta.maxNewCardsPerDayLearning;
    const maxNew = learningCap === -1 ? Number.MAX_SAFE_INTEGER : learningCap;
    const newQueue = SRS.buildReviewQueue(
        store.flashcards,
        maxNew,
        plm?.newCardsToday ?? 0,
        learningCap,
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
  const addFlashcard = async (
    content: Partial<FlashcardContent> & { front: string; back: string },
    initialEase?: number,
    skipAnkiChoice?: boolean,
    language?: string,
  ): Promise<string> => {
    log.info('%caddFlashcard called with:', 'color: magenta; font-weight: bold;', content.front);
    const lang = language ?? settings.language;

    // Intercept: if Anki integration is enabled and choice not skipped, let user choose SRS vs Anki
    if (settings.use_anki && !skipAnkiChoice && !settings.flashcardSkipAnkiChoice) {
      const target = await new Promise<'srs' | 'anki' | 'cancel'>((resolve) => {
        setPendingFlashcardChoice({ content, initialEase, language: lang, resolve });
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
    // Use the language's primary word form so inflections, alternate spellings, and readings share a key.
    const storageWord = getPrimaryWordFormForLanguage(word, lang);
    const wordHash = await SRS.hashWord(storageWord);
    const lk = langKey(lang, wordHash);
    log.info('%caddFlashcard: wordHash generated:', 'color: magenta;', wordHash);

    // Check if marked as known (skip flashcard creation)
    if (getWordFormKeysSync(word, lang).some((key) => isKnownClaimed(key) || store.ignoredWords[key])) {
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
        prosody: content.prosody,
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
    const needsTranslation = hasExample && !card.content.exampleMeaning && isLLMReady(settings);
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
        const cardLanguage = card.language || settings.language;
        const translation = await translateExampleSentence(
          card.content.example!,
          cardLanguage,
          cardLanguage,
        );
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
      const language = card.language || settings.language;
      const cardLanguageData = languageDataFor(language);
      const cloudApiUrl = resolveCloudApiUrl(settings);

      // Word TTS
      updatePostCreateTask(wordLabel, 'wordTts', 'running');
      try {
        const cleanWord = stripHtmlForTts(card.content.front, false, cardLanguageData);
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
          const cleanExample = stripHtmlForTts(card.content.example!, false, cardLanguageData);
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
    const lang = card.language || settings.language;
    const storageWord = getPrimaryWordFormForLanguage(word, lang);
    const wordHash = await SRS.hashWord(storageWord);
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
            // Exclusion policy only — never an epistemic claim. The word's
            // knowledge state stays exactly what its evidence says.
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
    const card = store.flashcards[id];
    if (!card) return;

    const language = card.language || settings.language;
    const oldFront = card.content.front;
    const nextFront = typeof content.front === 'string' ? content.front : oldFront;
    const oldStorageWord = getPrimaryWordFormForLanguage(oldFront, language);
    const nextStorageWord = getPrimaryWordFormForLanguage(nextFront, language);
    const oldWordKey = langKey(language, SRS.hashWordSync(oldStorageWord));
    const nextWordKey = langKey(language, SRS.hashWordSync(nextStorageWord));
    const shouldMoveWordIndex = oldWordKey !== nextWordKey;

    const changedFields = trackUserEdits
      ? (Object.keys(content) as Array<keyof FlashcardContent>).filter((key) =>
        key !== 'userEditedFields' && store.flashcards[id].content[key] !== content[key]
      )
      : [];

    setStore(produce((s) => {
      if (shouldMoveWordIndex) {
        const oldCardIds = s.wordToCardMap[oldWordKey] ?? [];
        s.wordToCardMap[oldWordKey] = oldCardIds.filter((cardId) => cardId !== id);
        if (s.wordToCardMap[oldWordKey].length === 0) {
          delete s.wordToCardMap[oldWordKey];
          delete s.wordStatsMap[oldWordKey];
        } else {
          s.wordStatsMap[oldWordKey] = calculateWordStats(
            s.wordToCardMap[oldWordKey].map((cardId) => s.flashcards[cardId]).filter(Boolean),
          );
        }

        const nextCardIds = s.wordToCardMap[nextWordKey] ?? [];
        if (!nextCardIds.includes(id)) {
          s.wordToCardMap[nextWordKey] = [...nextCardIds, id];
        }
      }

      Object.assign(s.flashcards[id].content, content);
      if (changedFields.length > 0) {
        const existing = s.flashcards[id].content.userEditedFields ?? [];
        s.flashcards[id].content.userEditedFields = Array.from(new Set([...existing, ...changedFields.map(String)]));
      }
      s.flashcards[id].lastUpdated = Date.now();

      if (shouldMoveWordIndex) {
        s.wordStatsMap[nextWordKey] = calculateWordStats(
          (s.wordToCardMap[nextWordKey] ?? []).map((cardId) => s.flashcards[cardId]).filter(Boolean),
        );
      }
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
  // `attempt` ties the review event to the logical attempt and lets undo restore
  // the knowledge recordAttempt wrote plus retract the attempt's events.
  const answerCard = (
    rating: SRS.Rating,
    cardId?: string,
    timeSpentMs?: number,
    attempt?: { attemptId: AttemptId },
  ): boolean => {
    const card = cardId ? (store.flashcards[cardId] ?? null) : getCurrentCard();
    if (!card) return false;

    const wasNew = card.state === 'new';
    const wasReview = card.state === 'review';
    const updated = SRS.answerCard(card, rating, store.meta);
    const cardLang = card.language || settings.language;
    const cardForm = getPrimaryWordFormForLanguage(card.content.front, cardLang);
    const now = Date.now();
    const cardLk = langKey(cardLang, SRS.hashWordSync(cardForm));
    appendEvents({
      [cardLk]: [{
        t: now,
        kind: 'review',
        source: 'srs',
        aspect: 'meaning',
        rating,
        presentedSurface: card.content.front,
        easeBefore: card.ease,
        easeAfter: updated.ease,
        intervalBefore: card.interval,
        intervalAfter: updated.interval,
        schedulerCardId: card.id,
        ...(attempt?.attemptId !== undefined ? { attemptId: attempt.attemptId } : {}),
        // REQ3/REQ52: an SRS review is a known task type. Scaffolds are not
        // structurally known on this path (card presentation varies) — omitted
        // rather than guessed.
        taskType: 'srs-review',
      }],
    }).catch((e) => log.warn('knowledge event append failed:', e));

    // SRS reviews are ACTIVE evidence and must be visible in the projection
    // immediately — the resolver no longer reads card state as a knowledge
    // source, so the materialized entry carries the review outcome.
    setStore(produce((s) => {
      if (!s.wordKnowledge[cardLk]) {
        s.wordKnowledge[cardLk] = {
          ease: updated.ease,
          lastSeen: now,
          firstSeen: now,
          timesSeen: 0,
          timesHovered: 0,
          word: cardForm,
          language: cardLang,
        };
      } else {
        s.wordKnowledge[cardLk].ease = updated.ease;
        s.wordKnowledge[cardLk].lastSeen = now;
      }
      s.wordKnowledge[cardLk].lastEvidenceSource = 'srs';
      s.wordKnowledge[cardLk].hasActiveEvidence = true;
    }));

    // Update queue - remove from current position, may need to re-add if still learning
    let newQueue = SRS.removeFromQueue(queue(), card.id);

    // If card is still in learning/relearning, keep it in the queue so the review
    // session continues with same-day cards instead of dropping them.
    if (updated.state === 'learning' || updated.state === 'relearning') {
      newQueue = SRS.addToQueue(newQueue, updated, newDayHour());
    }

    const remainsQueued = newQueue.newQueue.includes(card.id) || newQueue.scheduledQueue.includes(card.id);

    // Lightweight undo: snapshot only the affected card and meta (avoids expensive full store clone).
    // When an attempt id is supplied, undo also restores the knowledge recordAttempt
    // wrote and appends retraction tombstones so replay/analytics drop the attempt.
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
          if (attempt?.attemptId !== undefined) {
            appendRetractions(card.content.front, cardLang, [attempt.attemptId]);
            // Epistemic state is evidence-derived: retractions + replay restore
            // the projection. No knowledge snapshots.
            void recomputeWordKnowledgeFromEvidence(cardLang, card.content.front);
          }
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
      const cardLanguage = card.language || settings.language;
      const storageWord = getPrimaryWordFormForLanguage(card.content.front, cardLanguage);
      const wordHash = await SRS.hashWord(storageWord);
      const lk = langKey(cardLanguage, wordHash);
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
  const getCardsByWord = async (word: string, language = settings.language): Promise<Flashcard[]> => {
    const result: Flashcard[] = [];
    const seen = new Set<string>();
    for (const form of getWordFormsForLanguage(word, language)) {
      const wordHash = await SRS.hashWord(form);
      const lk = langKey(language, wordHash);
      const ids = store.wordToCardMap[lk] ?? [];
      for (const id of ids) {
        if (seen.has(id)) continue;
        const card = store.flashcards[id];
        if (card?.language === language) {
          seen.add(id);
          result.push(card);
        }
      }
    }
    return result;
  };

  // Get the first/best card for a word (backwards compatible)
  const getCardByWord = async (word: string, language = settings.language): Promise<Flashcard | null> => {
    const cards = await getCardsByWord(word, language);
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
  const hasWord = async (word: string, language = settings.language): Promise<boolean> => {
    return (await getCardsByWord(word, language)).length > 0;
  };

  // Get aggregated word statistics for O(1) lookup
  const getWordStats = async (word: string, language = settings.language): Promise<WordStats | null> => {
    for (const form of getWordFormsForLanguage(word, language)) {
      const wordHash = await SRS.hashWord(form);
      const lk = langKey(language, wordHash);
      const stats = store.wordStatsMap[lk];
      if (stats) return stats;
    }
    return null;
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

  const getWordFormsForStatus = (word: string): string[] => (
    getWordFormCandidates(word, getCanonicalForm, getWordVariants, { languageData: languageData(), language: settings.language })
  );
  const getPrimaryWordFormForStorage = (word: string): string => getWordFormsForStatus(word)[0] ?? getCanonicalForm(word) ?? word;
  const getWordFormsForLanguage = (word: string, language = settings.language): string[] => (
    getWordFormCandidates(
      word,
      (value) => language === settings.language ? getCanonicalForm(value) : getCanonicalFormForLanguage(language, value),
      (value) => language === settings.language ? getWordVariants(value) : getWordVariantsForLanguage(language, value),
      { languageData: languageDataFor(language), language },
    )
  );

  const knownWordSet = createMemo(() => buildKnownWordSetFromStore(
    store,
    settings.known_ease_threshold,
    settings.use_anki
      ? buildAnkiStatusKeySets(
        settings.language,
        settings.ankiLearningThreshold,
        settings.ankiKnownThreshold,
        (word) => getWordFormsForLanguage(word, settings.language),
        languageData(),
      ).known
      : undefined,
  ));
  /** Teaching-policy exclusions (ignoredWords): never select/teach/test these. */
  const excludedWordKeys = createMemo(() => new Set(Object.keys(store.ignoredWords)));
  const getPrimaryWordFormForLanguage = (word: string, language = settings.language): string => (
    getWordFormsForLanguage(word, language)[0] ?? word
  );

  // Helper: get cards for a word from the index, filtered by language.
  // Also checks language-provided forms to unify inflections, alternate spellings, and readings.
  const getCardsFromIndex = (word: string, language = settings.language): Flashcard[] => {
    const result: Flashcard[] = [];
    const seen = new Set<string>();
    const addCardIds = (ids: readonly string[] | undefined) => {
      if (!ids) return;
      for (const id of ids) {
        if (seen.has(id)) continue;
        const card = store.flashcards[id];
        if (card && card.language === language) {
          seen.add(id);
          result.push(card);
        }
      }
    };
    const tryWord = (w: string) => {
      addCardIds(wordFrontIndex().get(w));
      addCardIds(store.wordToCardMap[langKey(language, SRS.hashWordSync(w))]);
    };
    for (const form of getWordFormsForLanguage(word, language)) {
      tryWord(form);
    }
    return result;
  };

  // Synchronous check if word has flashcard.
  const hasWordSync = (word: string, language = settings.language): boolean => {
    if (!word) return false;
    return getCardsFromIndex(word, language).length > 0;
  };
  
  // Synchronous get all cards for a word.
  const getCardsByWordSync = (word: string, language = settings.language): Flashcard[] => {
    if (!word) return [];
    return getCardsFromIndex(word, language);
  };
  
  // Synchronous get the best card for a word (highest state/ease)
  const getCardByWordSync = (word: string, language = settings.language): Flashcard | null => {
    if (!word) return null;
    const cards = getCardsByWordSync(word, language);
    if (cards.length === 0) return null;
    if (cards.length === 1) return cards[0];
    
    // Sort by state (review > relearning > learning > new), then by ease
    return cards.sort((a, b) => {
      const stateCompare = compareStates(b.state, a.state);
      if (stateCompare !== 0) return stateCompare;
      return b.ease - a.ease;
    })[0];
  };

  const getCardByWordForLanguageSync = (word: string, language = settings.language): Flashcard | null => {
    return getCardByWordSync(word, language);
  };

  const isWordIgnoredSync = (word: string, language = settings.language): boolean => {
    if (!word) return false;
    // Exclusion policy ONLY. A known claim is not an ignore — callers that
    // mean "known OR excluded" use isWordSettledSync.
    for (const form of getWordFormsForLanguage(word, language)) {
      const wordHash = SRS.hashWordSync(form);
      const key = langKey(language, wordHash);
      if (store.ignoredWords[key]) {
        return true;
      }
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
    for (const form of getWordFormsForLanguage(word, language)) {
      const wordHash = SRS.hashWordSync(form);
      const ids = store.wordToCardMap[langKey(language, wordHash)] ?? [];
      for (const id of ids) {
        const card = store.flashcards[id];
        if (card?.content.unpopulated === true) return card;
      }
    }
    return null;
  };

  const getWordFormKeysSync = (word: string, language = settings.language): string[] => {
    const keys: string[] = [];
    const seen = new Set<string>();
    for (const form of getWordFormsForLanguage(word, language)) {
      const key = langKey(language, SRS.hashWordSync(form));
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
    return keys;
  };

  const findSuggestedFlashcardKeyForWord = (word: string, language = settings.language): string | null => {
    for (const key of getWordFormKeysSync(word, language)) {
      if (store.suggestedFlashcards[key]) return key;
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
    const storageWord = getPrimaryWordFormForStorage(word);
    const wordHash = await SRS.hashWord(storageWord);
    const lang = settings.language;
    const lk = langKey(lang, wordHash);
    const now = Date.now();

    // Skip if already has flashcard(s) or marked as known
    const matchingKeys = getWordFormKeysSync(word, lang);
    const existingKey = matchingKeys.find((key) => store.wordCandidates[key]) ?? lk;
    const hasExistingCardOrKnownState = matchingKeys.some((key) => {
      const cardIds = store.wordToCardMap[key];
      return (cardIds && cardIds.length > 0) || isKnownClaimed(key) || store.ignoredWords[key];
    });
    if (hasExistingCardOrKnownState) {
      return;
    }

    setStore(produce((s) => {
      if (!s.wordCandidates[existingKey]) {
        s.wordCandidates[existingKey] = { count: 0, lastSeen: now, word: storageWord, reading, language: lang };
      }
      s.wordCandidates[existingKey].count++;
      s.wordCandidates[existingKey].lastSeen = now;
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
    const lang = params.language ?? settings.language;
    const storageWord = getPrimaryWordFormForLanguage(word, lang);
    const wordHash = await SRS.hashWord(storageWord);
    const lk = langKey(lang, wordHash);
    const suggestionKey = findSuggestedFlashcardKeyForWord(word, lang) ?? lk;
    const now = Date.now();
    const unpopulatedCard = findUnpopulatedFlashcardForWord(word, lang);

    const comprehensiveStatus = toSelectionBlockingStatus(
      getComprehensiveWordStatusWithSourceSync(word, lang),
    );
    const suggestionLanguageData = languageDataFor(lang);
    const dictionaryTargetLanguage = params.dictionaryTargetLanguage ?? getDictionaryTargetLanguageForSettings(settings, lang);
    const keepSuggestion = shouldKeepSuggestion(
      { word: storageWord, reading: params.reading, pos: params.pos, level: params.level, language: lang },
      settings,
      knownWordSet(),
      getLearningLanguageLevelForLanguage(settings, lang),
      comprehensiveStatus,
      suggestionLanguageData,
      {
        getWordForms: (value: string) => getWordFormsForLanguage(value, lang),
        dictionaryTargetLanguage,
        languageData: suggestionLanguageData,
      },
      excludedWordKeys(),
    );
    if (!keepSuggestion && !unpopulatedCard) return;

    let imageUrl = params.imageUrl;
    let newId: string | undefined;
    if (imageUrl?.startsWith('data:image/')) {
      const bridge = getBridge();
      const existing = store.suggestedFlashcards[suggestionKey];
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
        level: getFrequencyForLanguage(lang, word)?.raw_level,
      });
      updateFlashcardContent(unpopulatedCard.id, { ...updates, unpopulated: false }, false);
      return;
    }

    setStore(produce((s) => {
      const existing = s.suggestedFlashcards[suggestionKey];
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
        s.suggestedFlashcards[suggestionKey] = {
          id: newId ?? crypto.randomUUID(),
          word: storageWord,
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

  const getSuggestedFlashcardLevel = (suggestion: SuggestedFlashcard): number | null => {
    if (typeof suggestion.level === 'number' && Number.isFinite(suggestion.level)) {
      return suggestion.level;
    }
    const frequency = getFrequencyForLanguage(suggestion.language, suggestion.word);
    return typeof frequency?.raw_level === 'number' && Number.isFinite(frequency.raw_level)
      ? frequency.raw_level
      : null;
  };

  /** Get sorted suggestions for the current language (newest first). Filters out known words and words above the user's level. */
  const getSuggestedFlashcardsSync = (): SuggestedFlashcard[] => {
    const lang = settings.language;
    const userLevel = getLearningLanguageLevelForLanguage(settings, lang);
    const known = knownWordSet();
    return Object.values(store.suggestedFlashcards)
      .filter((s) => {
        if (s.language !== lang) return false;
        const hasUnpopulatedCard = findUnpopulatedFlashcardForWord(s.word, lang) !== null;
        const comprehensiveStatus = toSelectionBlockingStatus(
          getComprehensiveWordStatusWithSourceSync(s.word, lang),
        );
        const level = getSuggestedFlashcardLevel(s);
        const suggestionLanguageData = languageDataFor(lang);
        const dictionaryTargetLanguage = getDictionaryTargetLanguageForSettings(settings, lang);
        const keep = shouldKeepSuggestion(
          { word: s.word, reading: s.reading, pos: s.pos, level, language: s.language },
          { ...settings, autoSuggestFlashcards: true, autoSuggestUnknownWords: true },
          known,
          userLevel,
          comprehensiveStatus,
          suggestionLanguageData,
          {
            getWordForms: (word) => getWordFormsForLanguage(word, lang),
            dictionaryTargetLanguage,
            languageData: suggestionLanguageData,
          },
          excludedWordKeys(),
        );
        return keep || hasUnpopulatedCard;
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

  /**
   * Known-word gate for creation/suggestion suppression. Claim-known first;
   * knownUntracked is legacy residue (orphan hashes) kept only until storage
   * migrations recover their word text — no new writes ever land there.
   */
  const isKnownClaimed = (lk: string): boolean =>
    store.wordKnowledge[lk]?.claim === 'known' || store.knownUntracked[lk] === true;

  /** Evidence-backed Known (active source required — passive exposure never qualifies). */
  const isExplicitPassiveKnown = (key: string): boolean => {
    const knowledge = store.wordKnowledge[key];
    if (!knowledge) return false;
    return knowledge.ease >= passiveKnownEaseThreshold() && knowledge.hasActiveEvidence === true;
  };

  /** Passive rows classify by the same anchors as the resolver; source stays passiveTracking so replay never marks lastStatusChange. */
  const passiveEaseToStatus = (ease: number): WordStatus =>
    ease >= passiveKnownEaseThreshold() ? 'known' : ease >= passiveLearningEaseThreshold() ? 'learning' : 'unknown';

  const shouldGarbageCollectSuggestion = (suggestion: SuggestedFlashcard): boolean => {
    if (getAnkiStatusForWord(suggestion.word, suggestion.language) === 'known') return true;

    for (const form of getWordFormsForLanguage(suggestion.word, suggestion.language)) {
      const key = langKey(suggestion.language, SRS.hashWordSync(form));
      if (isKnownClaimed(key) || store.ignoredWords[key] || isExplicitPassiveKnown(key)) {
        return true;
      }

      const cards = getCardsByWordSync(form, suggestion.language);
      if (cards.some((card) => card.state === 'review')) {
        return true;
      }
    }

    return false;
  };

  const cleanupKnownSuggestions = async (): Promise<number> => {
    const idsToRemove: string[] = [];
    const suggestions = Object.values(store.suggestedFlashcards);

    for (const suggestion of suggestions) {
      if (idsToRemove.includes(suggestion.id)) continue;
      const hasUnpopulatedCard = findUnpopulatedFlashcardForWord(suggestion.word, suggestion.language) !== null;
      if (hasUnpopulatedCard) continue;

      if (shouldGarbageCollectSuggestion(suggestion)) {
        idsToRemove.push(suggestion.id);
      }
    }

    if (idsToRemove.length > 0) {
      removeSuggestedFlashcards(idsToRemove);
    }
    return idsToRemove.length;
  };

  const garbageCollectSuggestedFlashcards = async (): Promise<number> => {
    const lang = settings.language;
    const suggestions = Object.values(store.suggestedFlashcards).filter((suggestion) => suggestion.language === lang);
    const suggestionLanguageData = languageDataFor(lang);
    const dictionaryTargetLanguage = getDictionaryTargetLanguageForSettings(settings, lang);

    if (!(settings.autoSuggestUnknownWords ?? DEFAULT_SETTINGS.autoSuggestUnknownWords)) {
      await warmDictionaryStatus(
        suggestions.map((suggestion) => suggestion.word),
        lang,
        {
          getWordForms: (word) => getWordFormsForLanguage(word, lang),
          dictionaryTargetLanguage,
          languageData: suggestionLanguageData,
        },
      );
    }

    const known = knownWordSet();
    const userLevel = getLearningLanguageLevelForLanguage(settings, lang);
    const idsToRemove = suggestions
      .filter((suggestion) => {
        if (findUnpopulatedFlashcardForWord(suggestion.word, lang)) return false;
        const level = getSuggestedFlashcardLevel(suggestion);
        return !shouldKeepSuggestion(
          { word: suggestion.word, reading: suggestion.reading, pos: suggestion.pos, level, language: lang },
          settings,
          known,
          userLevel,
          toSelectionBlockingStatus(
            getComprehensiveWordStatusWithSourceSync(suggestion.word, lang),
          ),
          suggestionLanguageData,
          {
            getWordForms: (word) => getWordFormsForLanguage(word, lang),
            dictionaryTargetLanguage,
            languageData: suggestionLanguageData,
          },
          excludedWordKeys(),
        );
      })
      .map((suggestion) => suggestion.id);

    if (idsToRemove.length > 0) removeSuggestedFlashcards(idsToRemove);
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

    const backend = getBackend();

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

    const llmExamples = new Map<string, LLMExampleResult>();
    if (useLLM) {
      const jobs: LLMExampleJob[] = [];
      const jobIds: string[] = [];
      for (const id of ids) {
        const key = findSuggestionKey(id);
        if (!key) continue;
        const suggestion = store.suggestedFlashcards[key];
        if (!suggestion) continue;
        try {
          const dictionaryTargetLanguage = getDictionaryTargetLanguageForSettings(settings, suggestion.language);
          const translationResponse = await backend.translate(
            suggestion.word,
            suggestion.language,
            dictionaryTargetLanguage ? { dictionaryTargetLanguage } : undefined,
          );
          const firstEntry = translationResponse?.data?.[0] as TranslationEntry | undefined;
          const backText = firstEntry?.definitions
            ? (Array.isArray(firstEntry.definitions) ? firstEntry.definitions.join('; ') : String(firstEntry.definitions))
            : '';
          if (backText) {
            jobs.push({ word: suggestion.word, definition: backText, language: suggestion.language });
            jobIds.push(id);
          }
        } catch (e) {
          log.warn(`Failed to prepare LLM example for "${suggestion.word}":`, e);
        }
      }
      try {
        const results = await generateExampleSentencesWithLLM(jobs);
        results.forEach((result, index) => {
          llmExamples.set(jobIds[index], result);
        });
      } catch (e) {
        log.warn('Failed to generate LLM examples for suggested flashcards:', e);
      }
    }

    let created = 0;
    let done = 0;
    for (const id of ids) {
      const key = findSuggestionKey(id);
      if (!key) { done++; onProgress?.(done, total); continue; }
      const suggestion = store.suggestedFlashcards[key];
      if (!suggestion) { done++; onProgress?.(done, total); continue; }

      try {
        const dictionaryTargetLanguage = getDictionaryTargetLanguageForSettings(settings, suggestion.language);
        const translationResponse = await backend.translate(
          suggestion.word,
          suggestion.language,
          dictionaryTargetLanguage ? { dictionaryTargetLanguage } : undefined,
        );
        const data = translationResponse?.data;
        if (!data || !Array.isArray(data)) { done++; onProgress?.(done, total); continue; }

        const firstEntry = data[0] as TranslationEntry | undefined;
        const secondEntry = data[1] as TranslationEntry | undefined;
        let backText = '';
        if (firstEntry?.definitions) {
          backText = Array.isArray(firstEntry.definitions) ? firstEntry.definitions.join('; ') : String(firstEntry.definitions);
        }
        if (!backText) { done++; onProgress?.(done, total); continue; }

        const suggestionLanguageData = languageDataFor(suggestion.language);
        const reading = suggestion.reading || extractReadingValue(firstEntry, suggestionLanguageData) || '';
        const prosody = extractProsodyFromTranslationData(translationResponse, suggestionLanguageData, reading);
        let definitionArr: string[] | undefined;
        if (secondEntry?.definitions) {
          definitionArr = Array.isArray(secondEntry.definitions)
            ? secondEntry.definitions
            : [String(secondEntry.definitions)];
        }

        let exampleSentence = suggestion.contextHtml || suggestion.contextPhrase || '';
        let exampleMeaning = '';
        if (useLLM) {
          const result = llmExamples.get(id);
          if (result?.sentence) {
            exampleSentence = result.sentence;
            exampleMeaning = result.meaning;
          }
        }

        const content: Partial<FlashcardContent> & { front: string; back: string } = {
          type: 'word',
          front: suggestion.word,
          back: backText,
          reading: reading || undefined,
          prosody,
          pos: suggestion.pos,
          level: suggestion.level ?? getFrequencyForLanguage(suggestion.language, getPrimaryWordFormForLanguage(suggestion.word, suggestion.language))?.raw_level ?? undefined,
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
          populatedCardId = await addFlashcard(content, undefined, true, suggestion.language);
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
              ttsItems.push({ cardId: populatedCardId, text: stripHtmlForTts(exampleSentence, false, languageDataFor(suggestion.language)), field: 'example' });
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

  const getLevelStudyScheduling = (targetStatus: LevelStudyTargetStatus) => {
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

  const applyLevelStudyScheduling = (id: string, targetStatus: LevelStudyTargetStatus): void => {
    const schedule = getLevelStudyScheduling(targetStatus);
    const now = Date.now();
    updateFlashcard(id, {
      state: schedule.state,
      ease: schedule.ease,
      interval: schedule.interval,
      dueDate: now + schedule.interval,
    });
  };

  const addLevelStudyFlashcards = async (
    words: string[],
    targetStatus: LevelStudyTargetStatus,
    language?: string,
    options?: {
      onProgress?: (done: number, total: number) => void;
      preserveExistingStatus?: boolean;
    },
  ): Promise<{ created: number; promoted: number; skipped: number }> => {
    const lang = language ?? settings.language;
    let created = 0;
    let promoted = 0;
    let skipped = 0;
    const onProgress = options?.onProgress;
    const total = words.length;

    // Staggered bulk add: ~176k words through SHA-256 + store lookups in ONE sync pass
    // would block the main thread for seconds, then one giant store mutation. Process
    // bounded chunks, yielding between each so the UI repaints and onProgress (the
    // caller's progress bar) can render. BULK_ADD_CHUNK keeps a slice ~16ms at the
    // measured ~10-50µs/word (hash + lookups + wordStats).
    const BULK_ADD_CHUNK = 500;
    let processed = 0;

    while (processed < total) {
      const chunkEnd = Math.min(processed + BULK_ADD_CHUNK, total);
      const chunkWords = words.slice(processed, chunkEnd);

      // Collect suggestion ids to promote and (canonical, lk) pairs to build as fresh
      // shells for THIS chunk, so the add stays O(1) store re-renders / translates.
      const promotes: Array<{ id: string; word: string }> = [];
      const shells: Array<{ canonical: string; lk: string }> = [];

      for (const word of chunkWords) {
        if (!word.trim()) {
          skipped++;
          continue;
        }

        const canonical = getPrimaryWordFormForLanguage(word, lang);
        const wordHash = SRS.hashWordSync(canonical);
        const lk = langKey(lang, wordHash);
        const existingCardIds = store.wordToCardMap[lk] ?? [];

        // Preserve-existing-status mode: skip any word that is already tracked in any
        // knowledge bank (knownUntracked, ignored, SRS, passive) so bulk add never
        // overwrites learning data. New-state cards resolve to 'unknown' here and fall
        // through to the existing-card check below.
        if (
          options?.preserveExistingStatus &&
          (() => {
            const resolved = getComprehensiveWordStatusWithSourceSync(canonical, lang);
            return resolved.status !== 'unknown' || resolved.excluded === true;
          })()
        ) {
          skipped++;
          continue;
        }

        // An existing card must never be promoted/re-stamped: check BEFORE suggestions so
        // a stale pending suggestion cannot clobber a real card's state (the data-loss path).
        if (existingCardIds.some((id) => store.flashcards[id])) {
          skipped++;
          continue;
        }

        const suggestion = store.suggestedFlashcards[lk];

        if (suggestion) {
          promotes.push({ id: suggestion.id, word: canonical });
          continue;
        }

        shells.push({ canonical, lk });
      }

      // A bulk target status is the user's epistemic statement about every
      // word in the batch — an explicit claim, not silent ease seeding.
      // 'mastered' is a scheduler distinction (longer seed interval); the
      // claim itself is 'known'. 'new' claims nothing (unmeasured).
      const bulkClaim: WordStatus | null =
        targetStatus === 'known' || targetStatus === 'mastered' ? 'known'
          : targetStatus === 'learning' ? 'learning'
            : null;

      if (promotes.length > 0) {
        await promoteSuggestedFlashcards(promotes.map((p) => p.id));
        // Re-apply level-study scheduling to the card created for each promoted word.
        for (const { word } of promotes) {
          const card = findUnpopulatedFlashcardForWord(word, lang) ?? getCardByWordSync(word, lang);
          if (card) {
            applyLevelStudyScheduling(card.id, targetStatus);
            if (bulkClaim !== null) setWordClaim(word, bulkClaim, lang);
            promoted++;
          } else {
            skipped++;
          }
        }
      }

      // Create this chunk's new shells in a single batched store mutation.
      if (shells.length > 0) {
        const now = Date.now();
        const schedule = getLevelStudyScheduling(targetStatus);
        const claimEvents: KnowledgeEventLog = {};
        const newCards: Flashcard[] = shells.map(({ canonical }) => ({
          id: SRS.generateUUID(),
          content: {
            type: 'word',
            front: canonical,
            back: '',
            word: canonical,
            unpopulated: true,
            level: getFrequencyForLanguage(lang, canonical)?.raw_level,
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
          language: lang,
        }));
        setStore(produce((s) => {
          for (let i = 0; i < shells.length; i++) {
            const { lk } = shells[i];
            s.flashcards[newCards[i].id] = newCards[i];
            if (!s.wordToCardMap[lk]) {
              s.wordToCardMap[lk] = [];
            }
            s.wordToCardMap[lk].push(newCards[i].id);
            const cards = s.wordToCardMap[lk].map((cardId) => s.flashcards[cardId]).filter(Boolean);
            s.wordStatsMap[lk] = calculateWordStats(cards);
            if (bulkClaim !== null) {
              if (!s.wordKnowledge[lk]) {
                s.wordKnowledge[lk] = {
                  ease: SRS.MIN_EASE,
                  lastSeen: now,
                  timesSeen: 0,
                  timesHovered: 0,
                  word: shells[i].canonical,
                  language: lang,
                };
              }
              s.wordKnowledge[lk].claim = bulkClaim;
              s.wordKnowledge[lk].claimAt = now;
              claimEvents[lk] = [{
                t: now, kind: 'claim', source: 'manual', aspect: 'meaning', toStatus: bulkClaim,
              }];
            }
          }
        }));
        if (Object.keys(claimEvents).length > 0) {
          appendEvents(claimEvents).catch((e) => log.warn('bulk claim event append failed:', e));
        }
        created += shells.length;
      }

      processed = chunkEnd;
      onProgress?.(processed, total);
      // Yield so the renderer repaints and the caller's progress bar updates.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    if (created > 0 || promoted > 0) {
      refreshQueue();
      saveFlashcards();
    }

    return { created, promoted, skipped };
  };

  // Ignore a word for a language: EXCLUSION POLICY only — never an epistemic
  // claim. "Stop teaching/selecting this" leaves knowledge state untouched.
  const ignoreWordForLanguage = async (word: string, reading?: string, language?: string) => {
    const lang = language ?? settings.language;
    const storageWord = getPrimaryWordFormForLanguage(word, lang);
    const wordHash = await SRS.hashWord(storageWord);
    const lk = langKey(lang, wordHash);

    const existingTimer = hoverTimers.get(lk);
    if (existingTimer) {
      clearTimeout(existingTimer);
      hoverTimers.delete(lk);
    }

    setStore(produce((s) => {
      s.ignoredWords[lk] = {
        word: storageWord,
        reading,
        language: lang,
        ignoredAt: Date.now(),
      };
      delete s.wordCandidates[lk];
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

  const unignoreWordForLanguage = async (word: string, language?: string) => {
    const lang = language ?? settings.language;
    const storageWord = getPrimaryWordFormForLanguage(word, lang);
    const wordHash = await SRS.hashWord(storageWord);
    const lk = langKey(lang, wordHash);

    setStore(produce((s) => {
      // Un-ignore withdraws the exclusion policy only; any explicit claim
      // stays until the user clears it via the pill.
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

  const WORD_SEEN_COUNT_THROTTLE_MS = 500;

  // Track that a word was seen (displayed on screen)
  const trackWordSeen = (word: string, reading?: string, easeBump = 0.01, language = settings.language) => {
    if (!settings.passiveEaseEnabled) return;
    // Use the language's primary word form so inflections and alternate spellings track together.
    const storageWord = getPrimaryWordFormForLanguage(word, language);
    const wordHash = SRS.hashWordSync(storageWord);
    const lang = language;
    const lk = langKey(lang, wordHash);
    const scriptForm = detectScriptForm(word, lang, languageDataFor(lang));
    if (isKnownClaimed(lk)) return;
    const now = Date.now();

    const existing = store.wordKnowledge[lk];
    const shouldCount = !existing || now - existing.lastSeen >= WORD_SEEN_COUNT_THROTTLE_MS;

    setStore(produce((s) => {
      if (!s.wordKnowledge[lk]) {
        s.wordKnowledge[lk] = {
          ease: SRS.MIN_EASE,
          lastSeen: now,
          timesSeen: 0,
          timesHovered: 0,
          word: storageWord,
          reading,
          language: lang,
          firstSeen: now,
        };
      }
      const k = s.wordKnowledge[lk];
      if (shouldCount) {
        k.timesSeen++;
        // Ease bump rides the same throttle as timesSeen: without this, subtitle
        // line flapping / window remounts farm ease unboundedly (the throttle
        // gated only the counter). Logical media-position encounter identity is
        // a Tier-2 concern; this closes the farm hole now.
        k.ease = Math.min(5, k.ease + easeBump);
      }
      k.lastSeen = now;
      if (scriptForm) {
        const recognize = k.forms?.[scriptForm]?.recognize ?? {
          ease: SRS.MIN_EASE,
          lastSeen: now,
          timesSeen: 0,
          timesHovered: 0,
        };
        if (shouldCount) recognize.timesSeen++;
        recognize.lastSeen = now;
        if (shouldCount) recognize.ease = Math.min(5, recognize.ease + easeBump);
        k.forms = { ...k.forms, [scriptForm]: { ...k.forms?.[scriptForm], recognize } };
        k.ease = Math.max(k.ease, ...Object.values(k.forms).flatMap((form) => form?.recognize ? [form.recognize.ease] : []));
      }
    }));

    // Notify media stats listeners so per-media tracking stays in sync
    const newEase = store.wordKnowledge[lk]?.ease ?? SRS.MIN_EASE;
    window.dispatchEvent(new CustomEvent('mlearn:word-seen', { detail: { word, language: lang, ease: newEase } }));
    if (shouldCount) accumulateWordSeen(lk, newEase, 1, passiveEaseToStatus(newEase));
  };

  // Track that a word was hovered (user doesn't know it)
  // Debounce: call this on hover start, cancel on hover end
  const trackWordHovered = (word: string, reading?: string, language = settings.language) => {
    if (!settings.passiveEaseEnabled) return;
    const storageWord = getPrimaryWordFormForLanguage(word, language);
    const wordHash = SRS.hashWordSync(storageWord);
    const lang = language;
    const lk = langKey(lang, wordHash);
    if (isKnownClaimed(lk)) return;

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
                    word: storageWord,
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
            // Hover-failure ease changes are evidence, not silent arithmetic:
            // the projection replay derives timesHovered and ease from these rows.
            if (isFailed && shouldDecreaseEaseOnPassiveFailure(settings) && !wasManuallySetRecently) {
                void appendEvents({
                    [lk]: [{
                        t: now,
                        kind: 'status',
                        source: 'passiveTracking',
                        aspect: 'meaning',
                        toStatus: passiveEaseToStatus(nextEase),
                        easeAfter: nextEase,
                    }],
                }).catch((e) => log.warn('knowledge event append failed:', e));
            }

            if (isFailed && shouldUpdateFlashcardOnPassiveFailure(settings) && !wasManuallySetRecently) {
                const cardIds = s.wordToCardMap[lk];
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
        detail: { word, language: lang, ease: nextEase, timesHovered: nextTimesHovered, isFailed },
      }));
    }, getPassiveHoverDelayMs(settings));

    hoverTimers.set(lk, timer);
  };

  // Cancel a hover timer (call on hover end)
  const cancelWordHover = (word: string, language = settings.language) => {
    const storageWord = getPrimaryWordFormForLanguage(word, language);
    const wordHash = SRS.hashWordSync(storageWord);
    const lk = langKey(language, wordHash);
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

  // Knowledge lookups route through THE canonical resolver (effectiveKnowledge):
  // a claim decides, ACTIVE evidence classifies through the ease bands, and
  // pure passive familiarity is never Known/Learning (REQ13 — no independent
  // raw-ease arithmetic here).
  const effectiveWordState = (lk: string): EffectiveWordState =>
    effectiveStateFromEntry(store.wordKnowledge[lk], {
      learning: settings.srsLearningThreshold / 1000,
      known: settings.known_ease_threshold / 1000,
    });

  const isWordKnown = (wordHash: string): boolean => {
    const lk = wordHash.includes(':') ? wordHash : langKey(settings.language, wordHash);
    return effectiveWordState(lk).status === 'known';
  };

  const isWordLearning = (wordHash: string): boolean => {
    const lk = wordHash.includes(':') ? wordHash : langKey(settings.language, wordHash);
    return effectiveWordState(lk).status === 'learning';
  };

  // Convenience: check if word is known by raw word text (sync hash)
  const isWordKnownByText = (word: string, language = settings.language): boolean => {
    for (const form of getWordFormsForLanguage(word, language)) {
      const wordHash = SRS.hashWordSync(form);
      if (isWordKnown(langKey(language, wordHash))) {
        return true;
      }
    }
    return false;
  };

  // Convenience: check if word is learning by raw word text (sync hash)
  const isWordLearningByText = (word: string, language = settings.language): boolean => {
    for (const form of getWordFormsForLanguage(word, language)) {
      const wordHash = SRS.hashWordSync(form);
      if (isWordLearning(langKey(language, wordHash))) {
        return true;
      }
    }
    return false;
  };

  const getAnkiStatusForWord = (word: string, language = settings.language): WordStatus | null => {
    ankiCacheVersion();
    if (!settings.use_anki) return null;
    const forms = getWordFormsForLanguage(word, language);
    const match = findAnkiWordMatchInCache(forms, {
      language,
      languageData: languageDataFor(language),
      ankiLearningThreshold: settings.ankiLearningThreshold,
      ankiKnownThreshold: settings.ankiKnownThreshold,
    });
    if (!match?.cards?.length) return null;
    return getAnkiWordKnowledgeStatus(match.cards, settings.ankiLearningThreshold, settings.ankiKnownThreshold);
  };

  const getWordTrackingSync = (word: string, language = settings.language): WordTrackingSyncResult => {
    ankiCacheVersion();
    if (getCardByWordForLanguageSync(word, language) || hasWordSync(word, language)) {
      return { tracker: 'flashcards' };
    }
    if (settings.use_anki) {
      const match = findAnkiWordMatchInCache(getWordFormsForLanguage(word, language), {
        language,
        languageData: languageDataFor(language),
        ankiLearningThreshold: settings.ankiLearningThreshold,
        ankiKnownThreshold: settings.ankiKnownThreshold,
      });
      if (match) return { tracker: 'anki', ankiLookupWord: match.word };
    }
    return { tracker: 'nothing' };
  };

  const passiveLearningEaseThreshold = (): number => (
    settings.easeThresholdLearning ?? ((settings.srsLearningThreshold ?? DEFAULT_SETTINGS.srsLearningThreshold) / 1000)
  );

  const passiveKnownEaseThreshold = (): number => (
    settings.easeThresholdKnown ?? ((settings.known_ease_threshold ?? DEFAULT_SETTINGS.known_ease_threshold) / 1000)
  );

  const comprehensiveDeps = (language: string): Parameters<typeof getComprehensiveWordStatusWithSource>[1] => ({
    getCanonicalForm: (value: string) => getPrimaryWordFormForLanguage(value, language),
    getWordForms: (value: string) => getWordFormsForLanguage(value, language),
    hashWordSync: SRS.hashWordSync,
    langKey,
    language,
    ignoredWords: store.ignoredWords,
    wordKnowledge: store.wordKnowledge,
    knownEaseThreshold: passiveKnownEaseThreshold(),
    learningThreshold: passiveLearningEaseThreshold(),
  });

  /**
   * Canonical per-aspect read (chain inheritance / orthogonal untracked
   * semantics live in one place). The readiness gate lives HERE — one source
   * of truth for every consumer (reader, subtitles, sidebar, Word DB, word
   * sync, flashcards): before hydration+migration settle, an empty store must
   * read as untracked-neutral, not as observed knowledge.
   */
  const getAspectStatus = (word: string, aspect: KnowledgeAspect, language = settings.language): AspectStatusResult => (
    isKnowledgeReady()
      ? getAspectStatusSync(word, aspect, comprehensiveDeps(language))
      : { status: 'unknown', ease: 0, source: 'None', untracked: true }
  );

  const getComprehensiveWordStatusSync = (word: string, language = settings.language): WordStatus => {
    return getComprehensiveWordStatus(word, comprehensiveDeps(language));
  };

  const getComprehensiveWordStatusWithSourceSync = (word: string, language = settings.language) => {
    return getComprehensiveWordStatusWithSource(word, comprehensiveDeps(language));
  };

  /**
   * Selection/display predicate: has the learner settled this word (evidence-backed
   * known OR explicit teaching exclusion)? Used where ignored words must not create
   * unknown-word noise — it never claims knowledge, only absence of noise.
   */
  const isWordSettledSync = (word: string, language = settings.language): boolean => {
    const resolved = getComprehensiveWordStatusWithSourceSync(word, language);
    return resolved.status === 'known' || resolved.excluded === true;
  };


  const isWordKnownComprehensiveSync = (word: string, language = settings.language): boolean => (
    getComprehensiveWordStatusSync(word, language) === 'known'
  );

  /**
   * Directly set the ease factor for a word in wordKnowledge.
   * Used by the "Sync with me" word assessment window to record user ratings.
   * `opts.emitTransitionEvents: false` (attempt flow) suppresses the per-form
   * transition events — recordAttempt then writes ONE attributed observation
   * per changed key instead of an unattributed transition + observation pair.
   * Returns the form keys whose status changed.
   */
  const setWordKnowledgeEase = (
    word: string,
    ease: number,
    reading?: string,
    language = settings.language,
    opts?: { emitTransitionEvents?: boolean; attemptId?: AttemptId; taskType?: AttemptTaskType; scaffolds?: AttemptScaffolds; sourceVersions?: EventSourceVersions },
  ): string[] => {
    // Multi-hash rule (#230): the resolver reads every surface-form hash, so a
    // single-hash rating write is shadowed by sibling forms' stale entries.
    const forms = getWordFormsForLanguage(word, language);
    const lang = language;
    const scriptForm = detectScriptForm(word, lang, languageDataFor(lang));
    const now = Date.now();
    const eased = ease + settings.manualStatusEaseBuffer;
    const ratingEvents: Record<string, KnowledgeEvent[]> = {};
    const changedKeys: string[] = [];
    const easeToStatus = (e: number): WordStatus =>
      e >= passiveKnownEaseThreshold() ? 'known'
        : e >= passiveLearningEaseThreshold() ? 'learning' : 'unknown';

    setStore(produce((s) => {
      for (const form of forms) {
        const wordHash = SRS.hashWordSync(form);
        const lk = langKey(lang, wordHash);
        const prior = s.wordKnowledge[lk];
        const fromStatus = prior ? easeToStatus(prior.ease) : 'unknown';
        const easeBefore = prior?.ease;
        if (!s.wordKnowledge[lk]) {
          s.wordKnowledge[lk] = {
            ease: eased,
            lastSeen: now,
            timesSeen: 0,
            timesHovered: 0,
            word: form,
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
        // Attempt ratings are ACTIVE evidence — they lift the passive-only cap.
        const entry = s.wordKnowledge[lk];
        entry.hasActiveEvidence = true;
        entry.lastEvidenceSource = 'manual';
        if (scriptForm) {
          const recognize = entry.forms?.[scriptForm]?.recognize ?? {
            ease: entry.ease,
            lastSeen: entry.lastSeen,
            timesSeen: entry.timesSeen,
            timesHovered: entry.timesHovered,
          };
          recognize.ease = eased;
          recognize.lastSeen = now;
          recognize.lastStatusChange = now;
          entry.forms = { ...entry.forms, [scriptForm]: { ...entry.forms?.[scriptForm], recognize } };
          entry.ease = Math.max(...Object.values(entry.forms).flatMap((f) => f?.recognize ? [f.recognize.ease] : [entry.ease]));
        }
        const toStatus = easeToStatus(eased);
        if (fromStatus !== toStatus) {
          changedKeys.push(lk);
          ratingEvents[lk] = [{
            t: now, kind: 'rating', source: 'manual', aspect: 'meaning',
            fromStatus, toStatus, easeBefore, easeAfter: eased,
            ...(opts?.attemptId !== undefined ? { attemptId: opts.attemptId } : {}),
            ...(opts?.taskType ? { taskType: opts.taskType } : {}),
            ...(opts?.scaffolds ? { scaffolds: opts.scaffolds } : {}),
            ...(opts?.sourceVersions ? { sourceVersions: opts.sourceVersions } : {}),
          }];
        }
      }
    }));
    saveFlashcards();
    if (opts?.emitTransitionEvents !== false && Object.keys(ratingEvents).length > 0) {
      appendEvents(ratingEvents).catch((e) => log.warn('knowledge event append failed:', e));
    }
    return changedKeys;
  };

  /**
   * Explicit epistemic claim — the user's own statement about a word identity:
   * "I know this" / "I am learning this" / "I do not know this", or `null` to
   * withdraw the claim. A claim NEVER mutates evidence ease; it overrides the
   * effective classification until cleared. Whole-identity semantics: written
   * to every surface-form key the resolver reads.
   *
   * This is the ONLY manual status path in the product. Legacy
   * ease-overwriting (setComprehensiveWordStatus) is gone: a refocus/replay
   * can no longer disagree with the UI because both read the same claim.
   */
  const setWordClaim = (word: string, claim: WordStatus | null, language = settings.language) => {
    const lang = language;
    const forms = getWordFormsForLanguage(word, lang);
    const now = Date.now();
    const claimEvents: Record<string, KnowledgeEvent[]> = {};

    setStore(produce((s) => {
      for (const form of forms) {
        const wordHash = SRS.hashWordSync(form);
        const lk = langKey(lang, wordHash);
        if (!s.wordKnowledge[lk]) {
          // A claim on an unmeasured word materializes a floor-ease entry:
          // evidence stays "unmeasured", the claim carries the classification.
          s.wordKnowledge[lk] = {
            ease: SRS.MIN_EASE,
            lastSeen: now,
            firstSeen: now,
            timesSeen: 0,
            timesHovered: 0,
            word: form,
            language: lang,
          };
        }
        const entry = s.wordKnowledge[lk];
        if (claim === null) {
          delete entry.claim;
          delete entry.claimAt;
          // Clearing a claim must not fabricate evidence metadata: a
          // claim-only entry (no observations) drops back to unmeasured by
          // removing the materialized cache entry entirely — the journal
          // still holds the claim history. Evidence-backed entries keep
          // their replayed facts.
          const hasRealEvidence = (entry.timesSeen ?? 0) > 0
            || (entry.timesHovered ?? 0) > 0
            || entry.hasActiveEvidence === true
            || (entry.aspects !== undefined && Object.keys(entry.aspects).length > 0)
            || (entry.ease !== undefined && entry.ease > SRS.MIN_EASE);
          if (!hasRealEvidence) {
            delete s.wordKnowledge[lk];
          }
        } else {
          // A claim is not a status change: lastStatusChange (an evidence
          // fingerprint) is never touched by the claim path; claimAt drives
          // merge recency.
          entry.claim = claim;
          entry.claimAt = now;
        }
        claimEvents[lk] = [{
          t: now,
          kind: 'claim',
          source: 'manual',
          aspect: 'meaning',
          ...(claim !== null ? { toStatus: claim } : {}),
        }];
      }
    }));
    saveFlashcards();
    if (Object.keys(claimEvents).length > 0) {
      appendEvents(claimEvents).catch((e) => log.warn('claim event append failed:', e));
    }
  };

  const setAspectStatus = (
    word: string,
    aspect: Exclude<KnowledgeAspect, 'meaning'>,
    status: WordStatus,
    source: KnowledgeSource | 'manual',
    language = settings.language,
    attemptId?: AttemptId,
  ) => {
    const lang = language;
    // #230 all-form-hash write, with its one exception: surface-scoped aspects
    // (orthography) belong to the exact written form presented — fanning
    // orthography(殖える) out to 増える's hash would claim recognition of a
    // form the learner never interacted with.
    const forms = isSurfaceScopedAspect(aspect)
      ? [word]
      : getWordFormsForLanguage(word, lang);
    const now = Date.now();
    // A manual aspect change without an attemptId is the user's own statement
    // (explicit claim), not an observation — it overrides the evidence
    // classification without touching the evidence ease. Attempt-driven writes
    // (attemptId present) are evidence.
    const isClaim = source === 'manual' && attemptId === undefined;
    const buffer = settings.manualStatusEaseBuffer;
    const easeForStatus = (st: WordStatus) => {
      if (st === 'learning') return settings.easeThresholdLearning + buffer;
      if (st === 'known') return settings.easeThresholdKnown + buffer;
      return settings.easeThresholdUnknown + buffer;
    };
    const aspectEvents: Record<string, KnowledgeEvent[]> = {};

    setStore(produce((s) => {
      for (const form of forms) {
        const wordHash = SRS.hashWordSync(form);
        const lk = langKey(lang, wordHash);
        const priorRecord = s.wordKnowledge[lk]?.aspects?.[aspect];
        const prior = priorRecord?.status ?? 'unknown';
        if (!s.wordKnowledge[lk]) {
          s.wordKnowledge[lk] = {
            ease: isClaim ? SRS.MIN_EASE : easeForStatus(status),
            lastSeen: now,
            timesSeen: 0,
            timesHovered: 0,
            word: form,
            language: lang,
            ...(isClaim ? {} : { lastStatusChange: now }),
          };
        }
        const entry = s.wordKnowledge[lk];
        if (isClaim) {
          const record = entry.aspects?.[aspect] ?? {
            status,
            ease: entry.ease,
            source: aspectSourceToDisplay(source),
            lastStatusChange: now,
            updatedAt: now,
          };
          // `status` and `lastStatusChange` keep the underlying evidence
          // classification/fingerprint for existing records — the claim rides
          // in `claim` and clears back to them (same invariant as the
          // word-level claim path). Only a fresh record adopts the claimed
          // status (there is no evidence under it).
          if (!entry.aspects?.[aspect]) {
            record.status = status;
            record.lastStatusChange = now;
          }
          record.claim = status;
          record.claimAt = now;
          record.updatedAt = now;
          entry.aspects = { ...entry.aspects, [aspect]: record };
          aspectEvents[lk] = [{
            t: now, kind: 'claim', source, aspect,
            ...(status !== undefined ? { fromStatus: prior, toStatus: status } : {}),
          }];
        } else {
          applyAspectWrite(entry, {
            aspect,
            status,
            ease: easeForStatus(status),
            source: aspectSourceToDisplay(source),
            now,
          });
          entry.lastStatusChange = now;
          if (prior !== status) {
            aspectEvents[lk] = [{
              t: now, kind: 'status', source, aspect,
              fromStatus: prior, toStatus: status, easeAfter: easeForStatus(status),
              ...(attemptId !== undefined ? { attemptId } : {}),
            }];
          }
        }
      }
    }));
    saveFlashcards();
    if (Object.keys(aspectEvents).length > 0) {
      appendEvents(aspectEvents).catch((e) => log.warn('knowledge event append failed:', e));
    }
  };

  /**
   * Withdraw an aspect claim ("Clear override"): deletes record.claim/claimAt
   * on every addressed form and appends a clearing claim event (toStatus
   * absent) so projections replay back to the evidence classification.
   */
  const clearAspectClaim = (word: string, aspect: Exclude<KnowledgeAspect, 'meaning'>, language = settings.language) => {
    const lang = language;
    const forms = isSurfaceScopedAspect(aspect) ? [word] : getWordFormsForLanguage(word, lang);
    const now = Date.now();
    const claimEvents: Record<string, KnowledgeEvent[]> = {};
    setStore(produce((s) => {
      for (const form of forms) {
        const wordHash = SRS.hashWordSync(form);
        const lk = langKey(lang, wordHash);
        const entry = s.wordKnowledge[lk];
        const record = entry?.aspects?.[aspect];
        if (!record || record.claim === undefined) continue;
        const next = { ...record };
        delete next.claim;
        delete next.claimAt;
        entry.aspects = { ...entry.aspects, [aspect]: next };
        claimEvents[lk] = [{ t: now, kind: 'claim', source: 'manual', aspect }];
      }
    }));
    saveFlashcards();
    if (Object.keys(claimEvents).length > 0) {
      appendEvents(claimEvents)
        // A cleared claim must not survive as materialized "evidence": if the
        // journal holds no active observation for the aspect (claim-only
        // record), drop the record so the aspect reads untracked again.
        .then(async () => {
          const eventLog = await getEventLogForLanguage(lang);
          const lks = Object.keys(claimEvents);
          setStore(produce((s) => {
            for (const lk of lks) {
              const entry = s.wordKnowledge[lk];
              const aspects = entry?.aspects;
              const record = aspects?.[aspect];
              if (!record || record.claim !== undefined) continue;
              const hasActiveEvidence = readActiveEvidence(eventLog[lk] ?? []).some(
                (event) => event.aspect === aspect && event.kind !== 'claim',
              );
              if (!hasActiveEvidence) {
                delete aspects[aspect];
                if (Object.keys(aspects).length === 0) delete entry.aspects;
              }
            }
          }));
          saveFlashcards();
        })
        .catch((e) => log.warn('aspect claim clear recompute failed:', e));
    }
  };
  /**
   * Failure attribution ("where did knowledge fail?"). The failed aspect records
   * negative evidence (unknown). Every coarser aspect in the language's aspect
   * hierarchy was successfully traversed by the same interaction and records
   * positive evidence: meaning via the word-level ease anchor (raised to the
   * learning band, never lowered — "almost know the word"), finer coarser aspects
   * (e.g. reading when prosody failed) via an explicit learning write, only when
   * currently below learning so inherited states are never overwritten down.
   * Aspects finer than the failure get no inference. These are real interaction
   * observations — unlike inheritance fallback, they emit events.
   */
  /**
   * Canonical attempt-rating evidence interpreter (the universal Aspect ×
   * Performance matrix backend). The learner reports attempt PERFORMANCE —
   * missed/struggled/fluent — for one aspect; this method decides what
   * knowledge evidence that report is, at the correct scope:
   * - meaning: missed → unknown anchor (demotes); struggled → learning anchor
   *   (MAY demote Known — a badly struggled known item must show regression);
   *   fluent → raise-only known anchor;
   * - finer aspect: missed → explicit unknown; struggled → explicit learning
   *   (may demote a known record); fluent → known record unless already known
   *   (never lowers evidence above the anchor).
   * `demonstrated` is TASK-MEDIATED: the aspects this interaction's structure
   * actually proves were traversed. Word-presentation tasks (wordSync, review)
   * pass the prerequisite chain; a dedicated audio task would pass []. The
   * engine never traverses the linguistic graph on its own — the graph
   * describes linguistic relations, the task defines what this observation
   * proves.
   */
  const recordAttempt = (
    word: string,
    aspect: KnowledgeAspect,
    quality: AttemptQuality,
    options?: {
      language?: string;
      method?: 'recall' | 'inference';
      /** Aspects this task structure demonstrates were traversed (default: none). */
      demonstrated?: readonly KnowledgeAspect[];
      latencyMs?: number;
      /** Shared logical-attempt id for multi-observation submits (profile mode). Absent = new attempt. */
      attemptId?: AttemptId;
      /** Presenting channel (e.g. 'word-sync') — replay derives policy markers from it. */
      origin?: string;
      /** What task produced the attempt (REQ3/REQ52) — provenance only, written when known. */
      taskType?: AttemptTaskType;
      /** Scaffolds visible during the attempt — written when the caller knows them. */
      scaffolds?: AttemptScaffolds;
      /** Reference-data versions at observation time — written when meaningfully available. */
      sourceVersions?: EventSourceVersions;
    },
  ): { attemptId: AttemptId } => {
    const language = options?.language ?? settings.language;
    const attemptId = options?.attemptId ?? nextAttemptId();
    const demonstrated = options?.demonstrated ?? [];
    const before = getComprehensiveWordStatusWithSourceSync(word, language);

    if (aspect === 'meaning') {
      let targetEase: number | null;
      if (quality === 'missed') {
        targetEase = settings.easeThresholdUnknown;
      } else if (quality === 'struggled') {
        targetEase = settings.easeThresholdLearning;
      } else if ((before.ease ?? 0) < settings.easeThresholdKnown) {
        targetEase = settings.easeThresholdKnown;
      } else {
        targetEase = null;
      }
      if (targetEase !== null) {
        setWordKnowledgeEase(word, targetEase, undefined, language, { emitTransitionEvents: false });
      }
    } else {
      if (quality === 'fluent') {
        const current = getAspectStatusSync(word, aspect, comprehensiveDeps(language));
        if (current.status !== 'known') {
          setAspectStatus(word, aspect, 'known', 'manual', language, attemptId);
        }
      } else {
        setAspectStatus(word, aspect, quality === 'missed' ? 'unknown' : 'learning', 'manual', language, attemptId);
      }
      // Prerequisite evidence is judged AFTER the rated aspect write (the rated
      // aspect is never its own prerequisite) and independently of the meaning
      // anchor below — stored aspects do not inherit, so ordering is free.
      for (const pre of demonstrated) {
        if (pre === 'meaning' || pre === aspect) continue;
        const preStatus = getAspectStatusSync(word, pre, comprehensiveDeps(language));
        if (preStatus.status === 'unknown') {
          setAspectStatus(word, pre, 'learning', 'manual', language, attemptId);
        }
      }
      if (demonstrated.includes('meaning') && (before.ease ?? 0) < settings.easeThresholdLearning) {
        setWordKnowledgeEase(word, settings.easeThresholdLearning, undefined, language, {
          taskType: options?.taskType,
        });
      }
    }

    const after = getComprehensiveWordStatusWithSourceSync(word, language);
    // One observation event per attempt — quality/method/latency provenance for
    // future calibration. fromStatus/toStatus/easeAfter keep replay/analytics
    // consistent with the underlying writers' transition events.
    const storageWord = getPrimaryWordFormForLanguage(word, language);
    const observation: KnowledgeEvent = {
      t: Date.now(),
      kind: 'rating',
      source: 'manual',
      aspect,
      quality,
      attemptId,
      // Exact presented surface — survives even when storage keys resolve to a
      // different primary family form. Never fan observations out from this.
      presentedSurface: word,
      ...(options?.method ? { method: options.method } : {}),
      // REQ3/REQ52 attempt metadata: write only what is genuinely known. The
      // word-sync rating route is recognized by its origin when the caller
      // did not pass an explicit task type.
      ...(options?.taskType ? { taskType: options.taskType } : options?.origin === 'word-sync' ? { taskType: 'word-sync' satisfies AttemptTaskType } : {}),
      ...(options?.scaffolds ? { scaffolds: options.scaffolds } : {}),
      ...(options?.sourceVersions ? { sourceVersions: options.sourceVersions } : {}),
      ...(options?.latencyMs !== undefined ? { latencyMs: options.latencyMs } : {}),
      ...(options?.origin ? { origin: options.origin } : {}),
      fromStatus: before.status,
      toStatus: after.status,
      easeAfter: after.ease,
    };
    appendEvents({
      [langKey(language, SRS.hashWordSync(storageWord))]: [observation],
    }).catch((e) => log.warn('knowledge event append failed:', e));
    return { attemptId };
  };

  const setWordBankStatus = async (
    word: string,
    status: WordStatus,
    bank: KnowledgeBank,
    options?: SetWordBankStatusOptions,
  ): Promise<void> => {
    const lang = options?.language ?? settings.language;
    const storageWord = getPrimaryWordFormForLanguage(word, lang);
    const wordHash = SRS.hashWordSync(storageWord);
    const lk = langKey(lang, wordHash);


    switch (bank) {
      case 'manual': {
        // The "known words list" bank is now an explicit claim. Nothing writes
        // knownUntracked anymore; the map only carries legacy residue until
        // storage migrations recover orphan word text.
        setWordClaim(word, status, lang);
        break;
      }

      case 'ignored': {
        if (status === 'known') {
          await ignoreWordForLanguage(storageWord, options?.reading, lang);
        } else {
          await unignoreWordForLanguage(storageWord, lang);
        }
        break;
      }

      case 'passive': {
        // Legacy "passive bank" writes were direct ease mutation — Tier-1
        // epistemics. A user-initiated status selection is a claim; evidence
        // only changes through real observations.
        setWordClaim(word, status, lang);
        break;
      }

      case 'flashcard': {
        const cards = store.wordToCardMap[lk]?.map((id) => store.flashcards[id]).filter(Boolean) ?? [];
        const ease = status === 'known' ? settings.known_ease_threshold / 1000 : settings.srsLearningThreshold / 1000;
        const state: FlashcardState = status === 'known' ? 'review' : 'learning';

        if (status === 'unknown') {
          for (const card of [...cards]) {
            await removeFlashcard(card.id, false);
          }
        } else if (cards.length > 0) {
          for (const card of cards) {
            updateFlashcard(card.id, { state, ease });
          }
        } else if (options?.content) {
          const ease = status === 'known' ? settings.known_ease_threshold / 1000 : settings.srsLearningThreshold / 1000;
          const state: FlashcardState = status === 'known' ? 'review' : 'learning';
          const cardId = await addFlashcard(options.content, ease, false, lang);
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

  // Multi-hash rule (#230): the sync pool filters on the canonical-form hash,
  // so the seen mark must cover the canonical form plus every surface form.
  const getWordSyncSeenKeysForLanguage = (word: string, language = settings.language): string[] => {
    const keys = new Set<string>();
    const canonical = getCanonicalFormForLanguage(language, word);
    if (canonical) keys.add(langKey(language, SRS.hashWordSync(canonical)));
    for (const form of getWordFormsForLanguage(word, language)) {
      keys.add(langKey(language, SRS.hashWordSync(form)));
    }
    return [...keys];
  };

  const markWordSyncSeen = (word: string, language = settings.language) => {
    const now = Date.now();
    setStore(produce((s) => {
      for (const lk of getWordSyncSeenKeysForLanguage(word, language)) {
        s.wordSyncSeen[lk] = now;
      }
    }));
    saveFlashcards();
  };

  const getWordSyncSeenSnapshotForForms = (word: string, language = settings.language): Record<string, number | undefined> => {
    const snapshot: Record<string, number | undefined> = {};
    for (const lk of getWordSyncSeenKeysForLanguage(word, language)) {
      snapshot[lk] = store.wordSyncSeen[lk];
    }
    return snapshot;
  };

  /** Policy-cooldown restore (wordSyncSeen). NOT epistemic: knowledge restores via retraction + projection replay. */
  const restoreWordSyncRating = (
    previousSeenAt: Record<string, number | undefined>,
    _language = settings.language,
  ) => {
    setStore(produce((s) => {
      for (const [seenLk, prev] of Object.entries(previousSeenAt)) {
        if (prev === undefined) {
          delete s.wordSyncSeen[seenLk];
        } else {
          s.wordSyncSeen[seenLk] = prev;
        }
      }
    }));
    saveFlashcards();
  };

  const clearAllWordSyncSeen = () => {
    setStore(produce((s) => {
      s.wordSyncSeen = {};
    }));
    saveFlashcards();
  };

  /**
   * Undo bookkeeping: append a retraction tombstone for each attemptId to every
   * form-family key of the word. Projections drop retracted events via
   * stripRetractions; the raw log stays append-only.
   */
  const appendRetractions = (word: string, language: string, attemptIds: readonly AttemptId[]) => {
    if (attemptIds.length === 0) return;
    const now = Date.now();
    const eventsByKey: KnowledgeEventLog = {};
    for (const form of getWordFormsForLanguage(word, language)) {
      eventsByKey[langKey(language, SRS.hashWordSync(form))] = attemptIds.map((retracts) => ({
        t: now, kind: 'retraction', source: 'manual', aspect: 'meaning', retracts,
      }));
    }
    appendEvents(eventsByKey).catch((e) => log.warn('knowledge event retraction failed:', e));
  };

  /**
   * Recompute the materialized wordKnowledge entries for a word's family keys
   * from ACTIVE evidence (retractions applied). The evidence journal is the
   * epistemic source of truth; this is the projection refresh, not a writer.
   */
  const recomputeWordKnowledgeFromEvidence = async (word: string, language?: string): Promise<void> => {
    const lang = language ?? settings.language;
    const lks = getWordFormsForLanguage(word, lang).map((form) => langKey(lang, SRS.hashWordSync(form)));
    let eventLog: KnowledgeEventLog;
    try {
      eventLog = await getEventLogForLanguage(lang);
    } catch (e) {
      log.warn('projection recompute failed to load events:', e);
      return;
    }
    setStore(produce((s) => {
      for (const lk of lks) {
        const projected = replayKeyProjection(eventLog[lk] ?? []);
        if (!projected || !s.wordKnowledge[lk]) {
          // No active state (claims included) → no entry; entry absent →
          // stays unmaterialized.
          if (!projected) delete s.wordKnowledge[lk];
          continue;
        }
        const existing = s.wordKnowledge[lk];
        const next: PassiveWordKnowledge = {
          ...existing,
          ease: projected.ease,
          lastStatusChange: projected.lastStatusChange,
          wordSyncRatedAt: projected.wordSyncRatedAt,
          timesSeen: projected.timesSeen,
          timesHovered: projected.timesHovered,
          firstSeen: projected.firstSeen,
          lastSeen: projected.lastSeen,
          lastEvidenceSource: projected.evidenceSource,
          ...(projected.hasActiveEvidence ? { hasActiveEvidence: true } : {}),
        };
        if (projected.claim !== undefined) {
          next.claim = projected.claim;
          next.claimAt = projected.claimAt;
        } else {
          delete next.claim;
          delete next.claimAt;
        }
        s.wordKnowledge[lk] = next;
      }
    }));
    saveFlashcards();
  };

  // ========================
  // Grammar Knowledge
  // ========================

  // Grammar counters are the recognition-target read model. The materialized
  // grammarKnowledge cache has exactly one writer — this replay (the store
  // loader aside): trackers append observation rows to the evidence journal
  // and the projection below rebuilds entries from ACTIVE evidence.
  let grammarReplayChain: Promise<void> = Promise.resolve();
  const materializeGrammarKnowledge = async (
    language: string,
    seeds: Array<{ pattern: string; level?: number }> = [],
  ): Promise<void> => {
    let eventLog: KnowledgeEventLog;
    try {
      eventLog = await getEventLogForLanguage(language);
    } catch (e) {
      log.warn('grammar projection recompute failed to load events:', e);
      return;
    }
    // Presentation data (pattern, level, language) is not evidence-derived:
    // existing entries and the caller's seed carry it; every epistemic field
    // (ease, counters, lastSeen) comes from the replay.
    const levels = new Map<string, number | undefined>();
    for (const seed of seeds) {
      if (!levels.has(seed.pattern)) levels.set(seed.pattern, seed.level);
    }
    for (const entry of Object.values(store.grammarKnowledge)) {
      if ((entry.language ?? settings.language) !== language) continue;
      if (!levels.has(entry.pattern)) levels.set(entry.pattern, entry.level);
    }
    // Rebuild criterion: the cache must be reconstructable from active
    // evidence alone, so patterns are also enumerated from the journal's
    // recognition-evidence keys — seeds and surviving entries only add
    // presentation hints. Key shape: `${language}:grammar:` +
    // `${language}:grammar:${pattern}` + ':grammar-recognition'.
    const recognitionSuffix = ':grammar-recognition';
    const grammarKeyPrefix = `${language}:grammar:`;
    for (const key of Object.keys(eventLog)) {
      if (!key.startsWith(grammarKeyPrefix) || !key.endsWith(recognitionSuffix)) continue;
      const entityId = key.slice(grammarKeyPrefix.length, key.length - recognitionSuffix.length);
      if (!entityId.startsWith(grammarKeyPrefix)) continue;
      const pattern = entityId.slice(grammarKeyPrefix.length);
      if (pattern && !levels.has(pattern)) levels.set(pattern, undefined);
    }
    setStore(produce((s) => {
      for (const [pattern, level] of levels) {
        const lk = langKey(language, pattern);
        const projection = replayGrammarRecognition(eventLog[grammarEvidenceKey(language, pattern, 'grammar-recognition')] ?? []);
        if (!projection) {
          // No active evidence → no materialized entry.
          delete s.grammarKnowledge[lk];
          continue;
        }
        const existing = s.grammarKnowledge[lk];
        s.grammarKnowledge[lk] = {
          pattern,
          ease: projection.ease,
          timesEncountered: projection.timesEncountered,
          timesFailed: projection.timesFailed,
          lastSeen: projection.lastSeen,
          // 0 is the level placeholder — a seedless load-time pass may stamp
          // it first; a caller's explicit level must still win.
          level: existing?.level || level || 0,
          language,
        };
      }
    }));
    saveFlashcards();
  };

  // Serialize materializations so a rapid tracker burst always lands the
  // full-log replay last (each run re-reads the whole language log).
  const queueGrammarMaterialize = (language: string, seeds: Array<{ pattern: string; level?: number }>): void => {
    grammarReplayChain = grammarReplayChain
      .then(() => materializeGrammarKnowledge(language, seeds))
      .catch((e) => log.warn('grammar materialization failed:', e));
  };

  // Track that a grammar pattern was passively encountered. Writes ONLY an
  // evidence observation (encounter delta); the materialized cache is
  // refreshed by replay, never mutated here.
  /**
   * Factual grammar exposure rollup. REQ39 provider side: accepts the shared
   * GrammarEncounterOptions contract — `(pattern, opts)` from the encounter
   * journal — while legacy positional callers keep working as
   * `(pattern, level?, language?)`. Provenance (confidence/span/origin) rides
   * on the appended rollup event; encounters never touch ratings or claims.
   */
  const trackGrammarEncountered = (
    pattern: string,
    levelOrOpts: number | GrammarEncounterOptions = 0,
    language = settings.language,
  ) => {
    const opts = typeof levelOrOpts === 'object' ? levelOrOpts : undefined;
    const level = typeof levelOrOpts === 'number' ? levelOrOpts : 0;
    appendEvents({
      [grammarEvidenceKey(language, pattern, 'grammar-recognition')]: [grammarRecognitionEvidence(language, pattern, {
        t: Date.now(),
        kind: 'rollup',
        timesSeenDelta: 1,
        ...(opts?.confidence !== undefined ? { confidence: opts.confidence } : {}),
        ...(opts?.span ? { span: opts.span } : {}),
        // A caller-supplied presenting surface beats the generic marker.
        origin: opts?.origin ?? 'grammar-encounter',
      })],
    })
      .then(() => queueGrammarMaterialize(language, [{ pattern, level }]))
      .catch((e) => log.warn('grammar evidence append failed:', e));
  };

  // Track that user struggled with a grammar pattern. Same single-writer path:
  // a failure delta in the journal, cache updated by replay.
  const trackGrammarFailed = (pattern: string, level = 0, language = settings.language) => {
    appendEvents({
      [grammarEvidenceKey(language, pattern, 'grammar-recognition')]: [grammarRecognitionEvidence(language, pattern, {
        t: Date.now(),
        kind: 'rollup',
        grammarFailedDelta: 1,
        origin: 'grammar-failure',
      })],
    })
      .then(() => queueGrammarMaterialize(language, [{ pattern, level }]))
      .catch((e) => log.warn('grammar evidence append failed:', e));
  };

  // Get grammar knowledge entry — serves the replay-materialized cache.
  const getGrammarKnowledge = (pattern: string, language = settings.language): GrammarKnowledgeEntry | undefined => {
    const lk = pattern.includes(':') && store.grammarKnowledge[pattern]
      ? pattern
      : langKey(language, pattern);
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
    const backend = getBackend();

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

    const prepared: Array<{
      compositeKey: string;
      candidate: WordCandidate;
      backText: string;
      reading: string;
      prosody: FlashcardProsody | undefined;
      definitionArr: string[] | undefined;
    }> = [];

    for (const [compositeKey, candidate] of toCreate) {
      // Skip if card already exists for this word
      const existingCards = store.wordToCardMap[compositeKey];
      if (existingCards && existingCards.length > 0) continue;
      if (isKnownClaimed(compositeKey)) continue;

      try {
        // Get translation data from backend
        const dictionaryTargetLanguage = getDictionaryTargetLanguageForSettings(settings, settings.language);
        const translationResponse = await backend.translate(
          candidate.word,
          settings.language,
          dictionaryTargetLanguage ? { dictionaryTargetLanguage } : undefined,
        );
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

        const currentLanguageData = languageDataFor(settings.language);
        const reading = extractReadingValue(firstEntry, currentLanguageData) || candidate.reading || '';
        const prosody = extractProsodyFromTranslationData(translationResponse, currentLanguageData, reading);
        // Get definition HTML from the second entry
        let definitionArr: string[] | undefined;
        if (secondEntry?.definitions) {
          definitionArr = Array.isArray(secondEntry.definitions)
            ? secondEntry.definitions
            : [String(secondEntry.definitions)];
        }

        prepared.push({ compositeKey, candidate, backText, reading, prosody, definitionArr });
      } catch (e) {
        log.warn(`Failed to auto-create flashcard for "${candidate.word}":`, e);
      }
    }

    let examples: LLMExampleResult[] = prepared.map(() => ({ sentence: '', meaning: '' }));
    if (useLLM && prepared.length > 0) {
      try {
        examples = await generateExampleSentencesWithLLM(prepared.map(({ candidate, backText }) => ({
          word: candidate.word,
          definition: backText,
          language: settings.language,
        })));
      } catch (e) {
        log.warn('Failed to generate LLM examples for auto-created flashcards:', e);
      }
    }

    let createdCount = 0;
    for (const [index, preparedCard] of prepared.entries()) {
      const { compositeKey, candidate, backText, reading, prosody, definitionArr } = preparedCard;
      const example = examples[index];
      try {
        const content: Partial<FlashcardContent> & { front: string; back: string } = {
          type: 'word',
          front: candidate.word,
          back: backText,
          reading: reading || undefined,
          prosody,
          example: example.sentence || undefined,
          exampleMeaning: example.meaning || undefined,
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
   * Returns { sentence, meaning }. The meaning follows that language's dictionary target.
   */
  const generateExampleSentenceWithLLM = async (word: string, definition: string, language: string): Promise<{ sentence: string; meaning: string }> => {
    // Low power gate: prompt before local LLM call
    if (settings.llmProvider !== 'cloud') {
      const allowed = await requestAccess('llm');
      if (!allowed) return { sentence: '', meaning: '' };
    }

    try {
      return await new Promise((resolve, reject) => {
        const displayLocale = settings.uiLanguage || DEFAULT_SETTINGS.uiLanguage;
        const sourceLanguageData = languageDataFor(language);
        const dictionaryTargetLanguage = getDictionaryTargetLanguageForSettings(settings, language) || displayLocale;
        const targetLanguageData = languageDataFor(dictionaryTargetLanguage);
        const sourceLang = getLanguagePromptName(language, sourceLanguageData);
        const targetLang = getLanguagePromptName(dictionaryTargetLanguage, targetLanguageData);
        const prompt = `Generate a simple, natural example sentence using the word "${word}" (meaning: ${definition}) in ${sourceLang}. Then provide a ${targetLang} translation of the sentence. Format your response exactly as:
Sentence: [sentence in ${sourceLang}]
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

  const generateExampleSentencesWithLLM = async (jobs: LLMExampleJob[]): Promise<LLMExampleResult[]> => {
    if (jobs.length === 0) return [];

    const batchSize = settings.llmBulkExampleBatchSize;
    if (batchSize < 2) {
      return Promise.all(jobs.map((job) => generateExampleSentenceWithLLM(job.word, job.definition, job.language)));
    }

    const results: LLMExampleResult[] = jobs.map(() => ({ sentence: '', meaning: '' }));
    const displayLocale = settings.uiLanguage || DEFAULT_SETTINGS.uiLanguage;
    const groups = new Map<string, Array<{ index: number; job: LLMExampleJob; sourceLang: string; targetLang: string }>>();

    jobs.forEach((job, index) => {
      const dictionaryTargetLanguage = getDictionaryTargetLanguageForSettings(settings, job.language) || displayLocale;
      const sourceLang = getLanguagePromptName(job.language, languageDataFor(job.language));
      const targetLang = getLanguagePromptName(dictionaryTargetLanguage, languageDataFor(dictionaryTargetLanguage));
      const key = `${sourceLang}\u0000${targetLang}`;
      const group = groups.get(key) ?? [];
      group.push({ index, job, sourceLang, targetLang });
      groups.set(key, group);
    });

    for (const group of groups.values()) {
      for (let start = 0; start < group.length; start += batchSize) {
        const chunk = group.slice(start, start + batchSize);
        const { sourceLang, targetLang } = chunk[0];
        let parsed: LLMExampleResult[] | null = null;

        if (settings.llmProvider === 'cloud' || await requestAccess('llm')) {
          try {
            const response = await new Promise<string>((resolve, reject) => {
              const prompt = `Generate a simple, natural example sentence in ${sourceLang} for each of the following words, then give the ${targetLang} translation of each sentence. Respond with exactly ${chunk.length} numbered blocks. Use this exact format per item N:

N. Sentence: (sentence in ${sourceLang})
N. Translation: (translation in ${targetLang})

${chunk.map(({ job }, index) => `${index + 1}. Word "${job.word}" (meaning: ${job.definition})`).join('\n')}`;
              const { abort } = streamChat([
                { role: 'system', content: 'You are a helpful language learning assistant. Generate natural, simple example sentences.' },
                { role: 'user', content: prompt },
              ], [], {
                onChunk: () => {},
                onToolCall: () => {},
                onDone: resolve,
                onError: (error: unknown) => reject(error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Unknown error')),
              }, settings);
              const safetyTimeout = setTimeout(() => {
                abort();
                reject(new Error('LLM timeout'));
              }, 30_000);
              const originalResolve = resolve;
              const originalReject = reject;
              resolve = (value) => { clearTimeout(safetyTimeout); originalResolve(value); };
              reject = (error) => { clearTimeout(safetyTimeout); originalReject(error); };
            });
            parsed = parseExampleBlocksFromLLM(response, chunk.length);
          } catch (error) {
            if (!handleCloudOperationFallback(error)) throw error;
          }
        }

        const chunkResults = parsed ?? await Promise.all(chunk.map(({ job }) => (
          generateExampleSentenceWithLLM(job.word, job.definition, job.language)
        )));
        chunk.forEach(({ index }, chunkIndex) => {
          results[index] = chunkResults[chunkIndex];
        });
      }
    }

    return results;
  };

  /**
   * Translate an example sentence using the card language's dictionary target.
   */
  const translateExampleSentence = async (sentence: string, sourceLanguageCode: string, language?: string): Promise<string> => {
    // Strip HTML tags for translation
    const plainText = sentence.replace(/<[^>]*>/g, '').trim();
    if (!plainText || plainText === '-') return '';

    const displayLocale = settings.uiLanguage || DEFAULT_SETTINGS.uiLanguage;
    const cardLanguage = language || settings.language;
    const dictionaryTargetLanguage = getDictionaryTargetLanguageForSettings(settings, cardLanguage) || displayLocale;
    const sourceLang = getLanguagePromptName(sourceLanguageCode, languageDataFor(sourceLanguageCode));
    const targetLang = getLanguagePromptName(dictionaryTargetLanguage, languageDataFor(dictionaryTargetLanguage));

    // Low power gate: prompt before local LLM call
    if (settings.llmProvider !== 'cloud') {
      const allowed = await requestAccess('llm');
      if (!allowed) return '';
    }

    try {
      return await new Promise((resolve, reject) => {
        const prompt = `Translate the following ${sourceLang} sentence to ${targetLang}. Respond with ONLY the translation, nothing else.\n\n${plainText}`;

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

  // Handle broadcast from other windows. Whole-store replace is a
  // last-writer-wins race: a window holding a stale snapshot would revert a
  // claim/evidence write made in another window (the refocus-revert class of
  // bug). Per-collection LWW merge instead — entries win by their own
  // recency, so concurrent windows converge on the newest epistemic state.
  const handleBroadcast = (event: MessageEvent) => {
    if (event.data?.type === 'update' && event.data.store) {
      const incoming = ensureStoreFields(event.data.store);
      setStore(produce((s) => {
        mergeKnowledgeMaps(s, incoming);
      }));
      refreshQueue();
    }
  };

  // Handle new day event (also triggered by "Force recreate" menu)
  const handleNewDay = async () => {
    const today = SRS.getTodayDateString(newDayHour());
    await flushKnowledgeRollup();
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
          // Prefer words with more hits; frontload older suggestions so the bin eventually drains.
          const sorted = [...suggestions].sort((a, b) => {
            // More failed/seen first
            const byCount = b.count - a.count;
            if (byCount !== 0) return byCount;
            return a.createdAt - b.createdAt;
          });
          const pickIds = selectEncounterBatch({
            preset: 'SUGGESTED',
            nowMs: 0,
            suggestedItems: sorted.map((suggestion) => ({
              key: suggestion.id,
              word: suggestion.word,
              language: suggestion.language,
            })),
          }).slice(0, remaining).map((decision) => decision.candidate.key);
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
            // Remote pill actions are explicit claims (same semantics as the
            // local pill): 2 = known, 1 = learning, 0 = unknown.
            const claim: WordStatus = update.status === 2 ? 'known' : update.status === 1 ? 'learning' : 'unknown';
            setWordClaim(update.word, claim, settings.language);
          }
        } catch (e) {
          log.error('[Tethered] Failed to process pill updates:', e);
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

    setKnowledgeRollupTodayFn(() => SRS.getTodayDateString(newDayHour()));
    // REQ25 crash-window hardening: event-driven flush on beforeunload +
    // visibilitychange→hidden (installed in knowledgeRollup, no timers).
    installPassiveFlushHooks();

    loadFlashcards();
    startSession();
  });

  onCleanup(() => {
    // Flush any pending save before cleanup
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveFlashcardsImmediate();
    }
    uninstallPassiveFlushHooks();
    void flushKnowledgeRollup();
    // Remove all IPC listeners
    for (const cleanup of ipcCleanups) cleanup();
    ipcCleanups.length = 0;
    broadcastChannel?.close();
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  });

  const value: FlashcardContextValue = {
    store,
    isLoading,
    isKnowledgeReady,
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
    getWordTrackingSync,
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
    setAspectStatus,
    clearAspectClaim,
    cleanupKnownSuggestions,
    garbageCollectSuggestedFlashcards,
    promoteSuggestedFlashcards,
    addLevelStudyFlashcards,
    removeSuggestedFlashcard,
    removeSuggestedFlashcards,
    trackWordSeen,
    trackWordHovered,
    cancelWordHover,
    getWordKnowledge,
    getAspectStatus,
    isWordKnown,
    isWordKnownByText,
    isWordLearning,
    isWordLearningByText,
    getComprehensiveWordStatusSync,
    getComprehensiveWordStatusWithSourceSync,
    isWordKnownComprehensiveSync,
    isWordSettledSync,
    getWordSyncSeenSnapshotForForms,
    restoreWordSyncRating,
    appendRetractions,
    recomputeWordKnowledgeFromEvidence,
    setWordClaim,
    recordAttempt,
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
    generateExampleSentencesWithLLM,
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
