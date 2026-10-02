import { isStudyExcluded, mergeStudyExclusion } from '../../shared/studyExclusion';
import { flashcardAudioProvider } from '../../shared/utils/flashcardAudioPreset';
/**
 * Flashcard Context
 * Manages flashcard state with Anki-like SRS algorithm
 * Uses UUID-keyed flashcards with states (new/learning/review/relearning)
 * Supports multiple flashcards per word with O(1) word statistics lookup
 */

import { createContext, useContext, ParentComponent, onMount, onCleanup, createSignal, createMemo, batch } from 'solid-js';
import { pushUndo } from '../learning/undoHistory';
import { perfCount } from '../utils/perfCounters';
import { createStore, reconcile, produce, unwrap } from 'solid-js/store';
import { DEFAULT_SETTINGS, isRemoteLLMProvider, type CapabilityKey, type FlashcardStore, type Flashcard, type FlashcardContent, type FlashcardMeta, type ReviewPresentation, type FlashcardProsody, type ReviewQueue, type WordStats, type FlashcardState, type PassiveWordKnowledge, type GrammarKnowledgeEntry, type TranslationEntry, type IgnoredWordEntry, type SuggestedFlashcard, type DailyStudyStats, type WordCandidate, type LanguageData, type FlashcardWriteAuthorization, type PerLanguageMeta } from '../../shared/types';
import { PROXY_SERVER_PORT, SRS_EASE, type AttemptQuality } from '../../shared/constants';
import { isSurfaceScopedCapability } from '../../shared/graph/targets';
import { surfaceEntityId } from '../../shared/graph/load';
import { applyLearningDecision, isLearningDecision } from '../../shared/learningDecision';
import { clonePendingRetraction, readPendingRetraction, type PendingRetraction, type RetractionTarget, type RetractionReplayDescriptor } from '../../shared/retractionRecovery';
import { isStaleFlashcardRevision } from '../../shared/flashcardWriteRevision';
import { grammarEvidenceKey, grammarPatternFromEvidenceKey, grammarRecognitionEvidence } from '../../shared/grammar/evidence';
import { evidenceStatusFromEase, effectiveThresholds } from '../../shared/knowledge/effectiveKnowledge';
import type { GrammarEncounterOptions } from '../../shared/grammar/encounters';
import { isAccessMeasurable } from '../../shared/knowledgeEvents';
import type { KeyKnowledgeState } from '../../shared/knowledge/historyQueries';
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
import { getPassiveHoverDelayMs } from '../../shared/utils/passiveWordTracking';
import { registerAnkiReviewSync, refreshAnkiWordsCache } from '../services/ankiWordsCache';
import { getWordFormCandidates } from '../utils/wordForms';
import { legacyCasingCandidates } from '../../shared/utils/normalizationVersion';
import { streamChat, isLLMReady } from '../services/llmProvider';
import { withCloudAuth } from '../services/cloudSessionManager';
import { absorbProviderFailure } from '../services/providerFailure';
import { useLowPowerGate } from './LowPowerGateContext';
import { stripHtmlForTts } from '../../shared/utils/textUtils';
import { getLogger } from '../../shared/utils/logger';
import { createKnownWordSet } from '../utils/knowledgeUtils';
import { applyFlashcardRatingCommand, ratingCounterDeltas, type FlashcardRatingCommand, type FlashcardRatingCommit } from '../../shared/flashcardRating';
import { getComprehensiveWordStatus, getComprehensiveWordStatusWithSource, getEffectiveWordStateForKeys } from '../utils/comprehensiveKnowledge';
import { getWrittenComprehensionStatus } from '../utils/writtenComprehension';
import { aspectSourceToDisplay, getAccessStatusSync, legacyAspectFor, migrateAspectRecordsToAccess, type AccessStatusResult } from '../utils/accessKnowledge';
import { appendEvents, appendEventsIdempotentAcknowledged, getEvents, getKnowledgeStates, queryLanguageKeys } from '../services/knowledgeEvents';
import { accumulateWordSeen, flushKnowledgeRollup, installPassiveFlushHooks, setKnowledgeRollupTodayFn, uninstallPassiveFlushHooks } from '../services/knowledgeRollup';
import { nextAttemptId, retentionConditionFor, type AttemptId, type AttemptScaffolds, type AttemptTaskType, type EventSourceVersions, type KnowledgeEvent, type KnowledgeEventLog } from '../../shared/knowledgeEvents';
import { reconcileQuestionItems, type DeclaredItemState } from '../learning/questionBank';
import type { AttemptTiming } from '../../shared/encounterTiming';
import { shouldKeepSuggestion, warmDictionaryStatus } from '../utils/suggestedFlashcards';
import { enrichWord } from '../services/wordEnrichment';
import { selectRankedEncounters } from '../learning/engine';
import { getLanguagePromptName, getLearningLanguageLevelForLanguage } from '../../shared/languageFeatures';
import { getDictionaryPromptTargetForSettings, getDictionaryTargetLanguageForSettings, installedDictionaryTargetLanguages } from '../utils/dictionaryTargetLanguage';
import { parseExampleBlocksFromLLM, type LLMExampleJob, type LLMExampleResult } from '../utils/llmExampleBatch';
import {
  applyStorePatchInPlace,
  copyStoreWithPatch,
  getStorePath,
  setStorePath,
  snapshotStorePaths,
  storePatchRecorder,
  type StorePatch,
  type StorePatchRecorder,
} from '../../shared/utils/storePatch';


const log = getLogger("renderer.context.flashcard");

// Current store version
const CURRENT_VERSION = 3;
const CAPABILITY_PROJECTION_VERSION = 3;

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
    wordKnowledge: {},
    grammarKnowledge: {},
    meta: { ...SRS.getDefaultMeta(), capabilityProjectionVersion: CAPABILITY_PROJECTION_VERSION },
    dailyStats: {},
    version: CURRENT_VERSION,
  };
}

/**
 * The projection a flashcard review Undo puts back. Opaque to the store; this
 * is the review surface's own vocabulary, carried inside the shared retraction
 * record so a reloaded window can finish the Undo without one.
 */
/**
 * A study surface's policy for putting its own state back, applied inside the
 * one durable write that clears the retraction record.
 *
 * Synchronous by design: it runs against the candidate store while that write
 * is being composed, so the projection and the clear either both land or
 * neither does. A projection that had to await storage of its own would leave a
 * window where the record is cleared but the projection is not applied — the
 * learner's Undo would look finished while their state still reflected it.
 *
 * `authorization` is the one write this store permits to restore scheduling
 * state, so a surface that owns a scheduler can name the write it needs.
 */
/** How finishing a recorded retraction ended. */
export type RetractionCompletion =
  /** The retraction is durable, the projection is applied, the record is gone. */
  | 'completed'
  /** The journal refused the tombstone. The record survives; the retry is the same Undo. */
  | 'retraction-refused'
  /** The record this call owns is no longer the one on disk. A newer Undo replaced it. */
  | 'stale'
  /** The retraction landed but the store refused the write that clears the record. */
  | 'store-refused';

export type RetractionProjection = ((
  record: PendingRetraction,
  target: FlashcardStore,
) => void) & { authorization?: FlashcardWriteAuthorization };

interface ReviewUndoProjection {
  cardId: string;
  type: string;
  restoreCard: Flashcard;
  restorePerLanguage: PerLanguageMeta | null;
  today: string;
  restoreDailyStats: DailyStudyStats | null;
  scaffolds?: AttemptScaffolds;
}

// Undo stack entry
interface UndoEntry {
  scaffolds?: AttemptScaffolds;
  type: string;
  language?: string;
  cardId?: string;
  restoreCard?: Flashcard;
  reviewUndo?: PendingRetraction;
  reviewUndoAuthorization?: FlashcardWriteAuthorization;
}

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
  /**
   * Recorded passive exposures of this word in the learner's CURRENT content
   * (R21). Lets a repeatedly-blocking off-list term through the suggestion
   * level gate; stored on the suggestion so promotion keeps the same rule.
   */
  mediaRecurrence?: number;
}

export type LevelStudyTargetStatus = 'new' | 'learning' | 'known' | 'mastered';

// Context interface
type AttemptOptions = {
  /** Exact task/target choice persisted before the learner responded. */
  decision?: import('../../shared/learningDecision').LearningDecision;
  language?: string;
  method?: 'recall' | 'inference';
  timing?: AttemptTiming;
  attemptId?: AttemptId;
  origin?: string;
  taskType?: AttemptTaskType;
  scaffolds?: AttemptScaffolds;
  sourceVersions?: EventSourceVersions;
  /** Inspection without an observed task records a learner claim, never performance evidence. */
  selfAssessment?: boolean;
};

type AttemptObservation = { capability: CapabilityKey; quality: AttemptQuality; method?: 'recall' | 'inference' };
type SchedulerRating = {
  cardId: string;
  rating: SRS.Rating;
  timeSpentMs?: number;
  tested?: readonly CapabilityKey[];
};
type RatingSubmissionOptions = Omit<AttemptOptions, 'method'> & {
  scheduler?: SchedulerRating;
  /** Review advances locally while main owns and batches the durable write. */
  persistence?: 'immediate' | 'background';
};

interface FlashcardContextValue {
  // Store access
  store: FlashcardStore;
  isLoading: () => boolean;
  libraryLoadError: () => string | null;
  retryLibraryLoad: () => void;
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
  ratingPersistenceState: () => 'idle' | 'pending' | 'failed';
  retryRatingPersistence: () => Promise<void>;
  getCurrentCard: () => Flashcard | null;
  getPreviewDueDates: () => Record<SRS.Rating, number> | null;

  // Query operations
  getAllCards: () => Flashcard[];
  /** Authored cards eligible for study preferences, across packages; scheduler rules still apply. */
  getStudyableCards: () => Record<string, Flashcard>;
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
  /** Synchronous check if word is ignored for the active or supplied language. */
  isWordIgnoredSync: (word: string, language?: string) => boolean;
  /** Synchronous get ignored words for the current language */
  getIgnoredWordsSync: () => IgnoredWordEntry[];
  findUnpopulatedFlashcardForWord: (word: string, language?: string) => Flashcard | null;
  populationStats: () => { total: number; unpopulated: number; populated: number; pct: number };

  // Settings
  updateMeta: (updates: Partial<FlashcardMeta>) => void;
  /** Admit a review cursor without replacing a newer window's position. */
  saveReviewPresentation: (language: string, presentation: ReviewPresentation, expectedId: string | null) => Promise<void>;

  // Undo support
  pushUndoState: (options: { type: string; cardId: string }) => void;
  undoLastAction: () => Promise<string | null>;
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
  trackWordSeen: (word: string, reading?: string, easeBump?: number, language?: string, encounterId?: string) => void;
  /** Applies coalesced passive-seen observations to the store immediately. */
  flushPendingWordSeen: () => void;
  cancelWordHover: (word: string, language?: string) => void;
  trackWordHovered: (word: string, reading?: string, language?: string) => void;
  getAccessStatus: (word: string, capability: CapabilityKey, language?: string) => AccessStatusResult;
  getWordKnowledge: (wordHash: string) => PassiveWordKnowledge | undefined;
  isWordKnown: (wordHash: string) => boolean;
  isWordKnownByText: (word: string, language?: string) => boolean;
  isWordLearning: (wordHash: string) => boolean;
  isWordLearningByText: (word: string, language?: string) => boolean;
  /** Canonical lexical status with explicit exclusion policy kept separate. */
  getComprehensiveWordStatusSync: (word: string, language?: string) => WordStatus;
  /** Comprehensive word status with source attribution */
  getComprehensiveWordStatusWithSourceSync: (word: string, language?: string) => import('../../renderer/utils/comprehensiveKnowledge').ComprehensiveWordStatusResult;
  /** Shorthand: is word known by any knowledge bank? */
  isWordKnownComprehensiveSync: (word: string, language?: string) => boolean;
  /** Selection predicate: evidence-backed known OR explicit exclusion (never claims knowledge). */
  isWordSettledSync: (word: string, language?: string) => boolean;
  /** Canonical written-comprehension predicate: is this word known AS PRESENTED IN TEXT? */
  isWordKnownWhenWrittenSync: (word: string, surface: string, language?: string) => boolean;
  /** Projection refresh: rebuild wordKnowledge for a word's family keys from ACTIVE evidence. */
  recomputeWordKnowledgeFromEvidence: (word: string, language?: string) => Promise<void>;
  /**
   * Explicit epistemic claim: "I know / am learning / do not know this", or
   * null to withdraw. Never touches evidence ease; overrides the effective
   * classification until cleared. The ONLY manual whole-word status path.
   */
  setWordClaim: (word: string, claim: WordStatus | null, language?: string) => Promise<boolean>;
  setAccessClaim: (word: string, capability: CapabilityKey, status: WordStatus, language?: string, entity?: { kind: string; id: string }) => Promise<boolean>;
  /** Withdraw an access claim; evidence classification resumes. */
  clearAccessClaim: (word: string, capability: CapabilityKey, language?: string) => Promise<boolean>;
  /** Acknowledged rating command; scheduler consequences are part of the same attempt. */
  submitRating: (
    word: string,
    observations: readonly AttemptObservation[],
    options?: RatingSubmissionOptions,
  ) => Promise<{ attemptId: AttemptId; completed: boolean }>;
  /** Append retraction tombstones for the given attempts across the word's form keys (undo bookkeeping). */
  appendRetractions: (word: string, language: string, attemptIds: readonly AttemptId[]) => Promise<boolean>;
  /**
   * The journal keys a word's attempts live under, and the projection they feed.
   *
   * A retraction has to be written to the keys the attempt actually landed on,
   * and those are derived from the word's whole form family. Exposed so a
   * surface records that location on its Undo instead of re-deriving it and
   * risking a recovery that routes somewhere the attempt never was.
   */
  wordRetractionTarget: (word: string, language: string) => RetractionTarget;
  /**
   * Append retraction tombstones to the keys an attempt was actually written
   * to, and replay whatever projection those keys feed.
   *
   * The durable Undo lifecycle needs this because a retraction is routed by
   * KEY, not by attempt id alone: a tombstone only un-counts an attempt where
   * the reading projection later finds it. Deriving those keys was hardcoded
   * to a word's form family, which silently made every non-word study surface
   * un-retractable — an Undo there would append nothing and still look done.
   * Targets are open descriptors rather than an enum of subject kinds, so a
   * surface for any new subject kind states its own keys instead of needing a
   * new branch in core.
   */
  retractAttempts: (target: RetractionTarget, attemptIds: readonly AttemptId[]) => Promise<boolean>;
  /** Register a package-owned projection replay without extending core subject types. */
  registerRetractionReplay: (
    kind: string,
    replay: (descriptor: RetractionReplayDescriptor) => Promise<void>,
  ) => (() => void);
  /**
   * The durable Undo lifecycle, shared by every study surface.
   *
   * A study surface records the Undo it has decided, finishes it (retracting
   * the attempt and putting its own projection back), and lets a reloaded
   * window finish one a previous window left behind. What the projection is
   * stays the surface's own business, passed as policy — so adding a study
   * surface does not add another copy of this protocol here.
   */
  recordPendingRetraction: (record: PendingRetraction) => Promise<boolean>;
  completePendingRetraction: (
    record: PendingRetraction,
    build?: (record: PendingRetraction) => Promise<RetractionProjection>,
  ) => Promise<RetractionCompletion>;
  recoverPendingRetraction: () => Promise<void>;
  /**
   * Registers how a study surface puts its own state back, so an Undo it
   * decided can be finished by a window that never made the decision. Keyed by
   * the `surface` tag on the record; a surface only registers while it is
   * mounted, and core never inspects what the projection restores.
   */
  registerRetractionProjection: (
    surface: string,
    build: (record: PendingRetraction) => Promise<RetractionProjection>,
  ) => (() => void);

  // Word sync seen tracking

  // Grammar knowledge tracking
  trackGrammarEncountered: (pattern: string, levelOrOpts?: number | GrammarEncounterOptions, language?: string) => void;
  trackGrammarFailed: (pattern: string, level?: number, language?: string) => void;
  /**
   * Curriculum grammar probe (grammar-recognize task): ONE self-assessed
   * rating event on the capability-scoped grammar journal. Active measurement
   * — unlike encounter rollups, it counts as measuring the construction.
   */
  recordGrammarAttempt: (pattern: string, quality: AttemptQuality, options?: { language?: string; level?: number; scaffolds?: AttemptScaffolds; itemRef?: { id: string; version: string; seed?: number }; validationRef?: KnowledgeEvent['validationRef']; taskType?: AttemptTaskType }) => AttemptId;
  /** Same canonical writer, but resolves only after the durable journal accepts the event. */
  recordGrammarAttemptAcknowledged: (pattern: string, quality: AttemptQuality, options?: { language?: string; level?: number; scaffolds?: AttemptScaffolds; itemRef?: { id: string; version: string; seed?: number }; validationRef?: KnowledgeEvent['validationRef']; taskType?: AttemptTaskType; attemptId?: AttemptId }) => Promise<AttemptId>;
  getGrammarKnowledge: (pattern: string, language?: string) => GrammarKnowledgeEntry | undefined;
  /**
   * Appends item-invalidation tombstones (items retired, content-changed or
   * currently invalid under the CURRENT package — G03) and re-materializes the affected
   * grammar projections (G03): retracts exactly the recorded attempts of
   * defective/retired question items without touching unrelated history.
   */
  retractGrammarItemAttempts: (tombstones: KnowledgeEventLog, language: string, patterns: readonly string[]) => Promise<void>;
  /**
   * Package-update reconcile (G03): appends tombstones for attempts recorded
   * through items the current package no longer declares and re-materializes
   * the affected patterns. Idempotent; returns the retired item count.
   */
  reconcileGrammarItems: (language: string, declaredItems: ReadonlyMap<string, DeclaredItemState>) => Promise<number>;

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

type RatingStore = Pick<FlashcardStore, 'flashcards' | 'wordKnowledge' | 'meta' | 'dailyStats' | 'rev'>;

const FLASHCARD_CHANNEL = 'mlearn-flashcards';


// TEMP DIAGNOSTIC: opt-in rating phase tracer. Enable from the DevTools console
// with `window.__mlearnTrace = true`, disable with `false`. Remove this block
// together with the trace marks once the flush is resolved.
type RatingTraceMark = { label: string; ms: number };
const ratingTraceOn = (): boolean => {
  try {
    return (globalThis as unknown as { __mlearnTrace?: boolean }).__mlearnTrace === true
      || localStorage.getItem('mlearn.ratingTrace') === '1';
  } catch { return false; }
};
const emitRatingTrace = (rows: RatingTraceMark[], total: number): void => {
  // eslint-disable-next-line no-console
  console.log(`%c[RATING] total=${total.toFixed(1)}ms  ${rows.map((r) => `${r.label}=${r.ms.toFixed(1)}`).join('  ')}`,
    'color:#c0f; font-weight:bold');
};


/**
 * Deep copy of the whole store. A JSON round-trip is used rather than
 * `structuredClone` because call sites pass Solid's reactive store: its proxies
 * are not cloneable, and unwrapping is only shallow.
 */
function cloneFlashcardStore<T extends object>(store: T): T {
  return JSON.parse(JSON.stringify(store)) as T;
}

function isStoreRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function applyStoreDelta(target: Record<string, unknown>, base: Record<string, unknown>, next: Record<string, unknown>): void {
  for (const key of new Set([...Object.keys(base), ...Object.keys(next)])) {
    const before = base[key];
    const after = next[key];
    if (Object.is(before, after)) continue;
    if (!(key in next)) {
      delete target[key];
    } else if (isStoreRecord(before) && isStoreRecord(after)) {
      if (!isStoreRecord(target[key])) target[key] = {};
      applyStoreDelta(target[key] as Record<string, unknown>, before, after);
    } else {
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      target[key] = after === undefined ? undefined : JSON.parse(JSON.stringify(after)) as unknown;
    }
  }
}

/**
 * Replays a recorded decision (a delta) onto a store, leaving every key the
 * decision did not mention exactly as the store already had it.
 *
 * `applyStoreDelta` computes changes between two whole snapshots, so a delta
 * cannot be replayed with it: every key absent from the delta would be read as
 * a deletion. This walks the delta's own branches instead, so a decision about
 * one card cannot rewrite the rest of the store around it.
 */
export function mergeIntentOnto(target: Record<string, unknown>, intent: Record<string, unknown>, root = true): void {
  for (const [key, value] of Object.entries(intent)) {
    if (root && key === 'ignoredWords' && isStoreRecord(value)) {
      // Preferences are whole records. A stale retry/local overlay cannot
      // overwrite a newer peer withdrawal or create hybrid policy metadata.
      if (!isStoreRecord(target[key])) target[key] = {};
      const preferences = target[key] as Record<string, IgnoredWordEntry>;
      for (const [id, entry] of Object.entries(value)) {
        if (isStoreRecord(entry)) preferences[id] = mergeStudyExclusion(preferences[id], entry as unknown as IgnoredWordEntry);
      }
      continue;
    }
    if (isStoreRecord(value)) {
      if (Object.keys(value).length === 0) {
        // Every key under here was removed; the parent map is what the removal
        // was recorded against.
        if (Array.isArray(target[key])) target[key] = [];
        else delete target[key];
        continue;
      }
      if (!isStoreRecord(target[key])) target[key] = {};
      mergeIntentOnto(target[key] as Record<string, unknown>, value, false);
      continue;
    }
    if (value === undefined) {
      // A key the decision removed. `applyStoreDelta` records a removal by
      // omitting the key, and the store's own shape says how to read that: an
      // array emptied, anything else deleted.
      const existing = target[key];
      if (Array.isArray(existing)) target[key] = [];
      else delete target[key];
      continue;
    }
    target[key] = JSON.parse(JSON.stringify(value)) as unknown;
  }
}

/**
 * Records what changed between two whole snapshots as a delta that can be
 * replayed elsewhere.
 *
 * `applyStoreDelta` expresses a removal by omitting the key, which is right
 * for applying onto the very snapshot it was computed from. A replayed delta
 * has no such context: an absent key would be indistinguishable from one the
 * decision never touched, so a removal would be silently dropped. Removals are
 * therefore recorded explicitly, and `mergeIntentOnto` reads them back.
 */
export function recordStoreDelta(target: Record<string, unknown>, base: Record<string, unknown>, next: Record<string, unknown>, root = true): void {
  for (const key of new Set([...Object.keys(base), ...Object.keys(next)])) {
    const before = base[key];
    const after = next[key];
    if (Object.is(before, after)) continue;
    if (root && key === 'ignoredWords' && isStoreRecord(after)) {
      const preferences: Record<string, unknown> = {};
      const previous = isStoreRecord(before) ? before : {};
      for (const [id, entry] of Object.entries(after)) {
        if (JSON.stringify(previous[id]) !== JSON.stringify(entry)) preferences[id] = JSON.parse(JSON.stringify(entry));
      }
      if (Object.keys(preferences).length > 0) target[key] = preferences;
      continue;
    }
    if (!(key in next)) {
      target[key] = undefined;
    } else if (isStoreRecord(before) && isStoreRecord(after)) {
      if (!isStoreRecord(target[key])) target[key] = {};
      recordStoreDelta(target[key] as Record<string, unknown>, before, after, false);
      if (Object.keys(target[key] as Record<string, unknown>).length === 0) delete target[key];
    } else {
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      target[key] = after === undefined ? undefined : JSON.parse(JSON.stringify(after)) as unknown;
    }
  }
}

export const FlashcardProvider: ParentComponent = (props) => {
  const { settings } = useSettings();
  const { t } = useLocalization();
  const { currentLangData, getFrequencyForLanguage, getCanonicalForm, getWordVariants, getCanonicalFormForLanguage, getWordVariantsForLanguage, getEffectiveLanguageData, languageDataCatalog } = useLanguage();
  // Dictionary lookups may only name a pack that is actually installed; an
  // uninstalled target returns empty definitions for every word.
  const dictionaryTargetFor = (learningLanguage: string) => getDictionaryTargetLanguageForSettings(
    settings,
    learningLanguage,
    installedDictionaryTargetLanguages(languageDataCatalog?.() ?? [], learningLanguage),
  );
  // Knowledge readiness: closed until the store hydrates AND the legacy
  // epistemic migration settles (that migration can legitimately flip rows —
  // e.g. passive Known → Learning under the REQ13 honesty cap — so any state
  // shown before it finishes is provisional).
  const [isKnowledgeReady, setIsKnowledgeReady] = createSignal(false);
  const languageData = () => typeof currentLangData === 'function' ? currentLangData() : null;
  const languageDataFor = (language: string): LanguageData | null => (
    language === settings.language ? languageData() : getEffectiveLanguageData(language)
  );
  const { requestAccess } = useLowPowerGate();
  const newDayHour = () => settings.newDayHour ?? DEFAULT_SETTINGS.newDayHour;

  const [store, setStore] = createStore<FlashcardStore>(getDefaultStore());
  const [isLoading, setIsLoading] = createSignal(true);
  const [libraryLoadError, setLibraryLoadError] = createSignal<string | null>(null);
  const handleLibraryLoadError = (message: string): void => {
    setLibraryLoadError(message);
    setIsLoading(true);
    log.error('The saved library could not be loaded:', message);
    const waiting = authorityRequest;
    authorityRequest = null;
    waiting?.(null);
  };
  const [queue, setQueue] = createSignal<ReviewQueue>({ newQueue: [], scheduledQueue: [] });
  // Exclusion is a reversible teaching policy. Keep authored/history records
  // in the store and present only eligible cards to the scheduling mechanism.
  const studyableCards = createMemo(() => Object.fromEntries(Object.entries(store.flashcards)
    .filter(([, card]) => !isWordIgnoredSync(card.content.front, card.language || settings.language))));
  const [undoStack, setUndoStack] = createSignal<UndoEntry[]>([]);
  let ratingCommandInFlight = false;
  // Retained only until a command's ACK (or ownership transfer to the
  // background command queue). A retry is the same physical encounter, even if a peer
  // has meanwhile consumed its restored presentation.
  const admittedRatingCommands = new Map<AttemptId, {
    word: string; observations: readonly AttemptObservation[]; options: RatingSubmissionOptions; presentationId?: string; cardFront?: string; command?: FlashcardRatingCommand;
    schedulerOutcome?: { undo: UndoEntry; completed: boolean; updated: Flashcard };
  }>();
  let pendingRecoveryRequested = false;
  let persistenceQueue: Promise<void> = Promise.resolve();
  let authoritativeStore: FlashcardStore | undefined;
  const pendingRatings = new Map<string, FlashcardRatingCommand>();
  const ratingAcknowledgements = new Set<Promise<void>>();
  const [ratingPersistenceState, setRatingPersistenceState] = createSignal<'idle' | 'pending' | 'failed'>('idle');

  const overlayPendingRatings = (target: FlashcardStore): void => {
    // Reset only pending additive counters to the durable baseline before
    // replaying local commands; a peer patch may not touch these paths.
    for (const command of pendingRatings.values()) for (const { path } of command.counterDeltas ?? []) {
      setStorePath(target as unknown as Record<string, unknown>, path,
        getStorePath((authoritativeStore ?? getDefaultStore()) as unknown as Record<string, unknown>, path) ?? 0);
    }
    for (const command of pendingRatings.values()) applyFlashcardRatingCommand(target, command, true);
  };

  const sendBackgroundRating = (command: FlashcardRatingCommand): void => {
    pendingRatings.set(command.attemptId, command);
    setRatingPersistenceState('pending');
    // Send before returning to the UI. Main owns this work even if the review
    // window closes before the 300ms batch is written.
    const acknowledgement = getBridge().flashcards.enqueueFlashcardRating(command).then(revision => {
      pendingRatings.delete(command.attemptId);
      setStore('rev', Math.max(store.rev ?? 0, revision));
      if (pendingRatings.size === 0) setRatingPersistenceState('idle');
    }, error => {
      // Retain the command and its attempt id; retry cannot duplicate evidence
      // or reconstruct a different scheduler result from a later card state.
      setRatingPersistenceState('failed');
      log.error('Failed to save queued flashcard ratings:', error);
    });
    ratingAcknowledgements.add(acknowledgement);
    void acknowledgement.finally(() => ratingAcknowledgements.delete(acknowledgement));
  };

  const flushBackgroundRatings = async (): Promise<void> => {
    if (pendingRatings.size === 0) return;
    if (ratingPersistenceState() === 'failed') {
      for (const command of pendingRatings.values()) sendBackgroundRating(command);
    }
    await getBridge().flashcards.flushFlashcardRatings();
    await Promise.all([...ratingAcknowledgements]);
    if (pendingRatings.size > 0) throw new Error('Pending flashcard ratings could not be saved');
  };

  const handleRatingCommit = ({ patch, rev, attemptIds }: FlashcardRatingCommit): void => {
    const currentRevision = authoritativeStore?.rev ?? store.rev ?? 0;
    if (rev < currentRevision) return;
    for (const attemptId of attemptIds) pendingRatings.delete(attemptId);
    if (pendingRatings.size === 0) setRatingPersistenceState('idle');
    if (!authoritativeStore || rev > currentRevision + 1) {
      authorityRefreshRequired = true;
      loadFlashcards();
    }
    if (authoritativeStore) {
      authoritativeStore = copyStoreWithPatch(authoritativeStore, patch);
      authoritativeStore.rev = rev;
    }
    batch(() => {
      setStore(produce(current => {
        applyStorePatchInPlace(current as unknown as Record<string, unknown>, patch);
        overlayPendingRatings(current as FlashcardStore);
        current.rev = rev;
      }));
      refreshQueue();
    });
  };
  // Used for tracking session start time (could be used for session stats)
  const [, setSessionStartTime] = createSignal<number>(0);

  // Pending flashcard creation choice (SRS vs Anki)
  const [pendingFlashcardChoice, setPendingFlashcardChoice] = createSignal<PendingFlashcardChoice | null>(null);


  const resolvePendingFlashcardChoice = (target: 'srs' | 'anki' | 'cancel') => {
    const pending = pendingFlashcardChoice();
    if (pending) {
      pending.resolve(target);
      setPendingFlashcardChoice(null);
    }
  };

  let broadcastChannel: BroadcastChannel | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingCardRemovals = new Set<string>();
  let pendingReviewReset = false;
  const SAVE_DEBOUNCE_MS = 300;
  // How long a refused write waits for the authority to answer before giving
  // up and reporting the write as failed. Generous enough to cover a busy main
  // process and a multi-megabyte store transfer, short enough that a lost
  // answer surfaces to the learner instead of stalling their next action.
  const AUTHORITY_REBASE_TIMEOUT_MS = 5_000;
  const ipcCleanups: Array<() => void> = [];

  // Queue counts memo
  const queueCounts = createMemo(() => SRS.getQueueCounts(queue(), studyableCards(), newDayHour()));

  // Get current card
  const getCurrentCard = (): Flashcard | null => {
    return SRS.getNextCard(queue(), studyableCards(), newDayHour());
  };

  // Preview due dates for rating buttons
  const getPreviewDueDates = (): Record<SRS.Rating, number> | null => {
    const card = getCurrentCard();
    if (!card) return null;
    return SRS.previewAnswers(card, store.meta);
  };

  // Hydrated-once flag: the knowledge gate exists so UI never renders a
  // half-migrated store. Only the FIRST load (and migrations) needs to close
  // it — a focus-sync redelivery of an identical or merely merged store must
  // not unmount every gated pill/hover (the "refocus recomputes everything"
  // jank).
  let storeHydrated = false;
  let knowledgeInitialization: Promise<void> = Promise.resolve();
  let authorityRefreshRequired = false;
  /**
   * Set while a rebase is waiting for the authority to ship its current store.
   *
   * A refused write must rebase onto what the main process actually holds, and
   * that store can only be had by asking for it. The provider already has one
   * listener for that answer, so the rebase arms a request here instead of
   * registering a second listener that would race the first: a focus or
   * visibility probe in flight answers the same channel, and a competing
   * one-shot would either steal a delivery it did not ask for or miss the one
   * it did. Whoever accepts a delivery while this is armed resolves it.
   */
  let authorityRequest: ((store: FlashcardStore | null) => void) | null = null;
  /**
   * Set when the window goes away while a rebase is waiting.
   *
   * A rebase holds a write open across a round trip to the authority, so a
   * window that unmounts mid-flight has to call it off. Left armed, it would
   * answer a delivery no window is listening for and push a write for a
   * surface that no longer exists - one more writer racing the windows that
   * are still open.
   */
  let disposed = false;
  /**
   * Whether the store this window renders has been superseded by a rebase, so
   * the store itself no longer carries the revision the authority holds.
   *
   * A write queued behind a rebase must not compose its next candidate over the
   * pre-rebase snapshot: that write carries the same refused revision, so the
   * authority refuses it too, and the learner's action is lost the same way.
   * The rebase's own store carries the revision that will be accepted, so
   * composing there ends the refusal instead of repeating it.
   */
  let storeSupersededByRebase = false;
  const markSuperseded = () => {
    storeSupersededByRebase = true;
  };
  // Handle loaded flashcards (used by IPC listener registered once in onMount;
  // sync/visibility can re-deliver the store later).
  const handleFlashcardsLoaded = (loaded: FlashcardStore | null) => {
    // Unchanged-rev probe reply: the main process already holds this exact
    // store — nothing to reconcile, nothing to re-render.
    if (!loaded) {
      if (authorityRefreshRequired || libraryLoadError()) return;
      // A rebase is waiting to learn what the authority holds. A null answer
      // to its probe means the authority is already at the revision this
      // window holds, so the store in hand is the authority's own — resolving
      // with it lets the rebase go. Ignoring the reply would leave the rebase
      // waiting for a delivery that is never coming, and with it this window's
      // whole write queue, which is serialised behind it.
      const waiting = authorityRequest;
      if (waiting) {
        authorityRequest = null;
        waiting(cloneFlashcardStore(unwrap(store) as FlashcardStore));
      }
      return;
    }
    const checked = ensureStoreFields(loaded as Partial<FlashcardStore>);

    // This window's view of the store only ever moves forward. The store is
    // whole-snapshot and revision-checked, so adopting a snapshot older than
    // one already adopted here does not just render stale data: it rewinds the
    // revision this window writes with, and the main process then refuses every
    // write it makes as stale - including the Undo a learner is trying to take
    // back, which is reported to them as a failed save.
    //
    // Older snapshots do arrive. Two probes can be in flight at once and settle
    // out of order, and a write this window made is answered before the
    // delivery that preceded it. Ignoring them costs nothing: the next probe
    // ships the current snapshot anyway.
    if (storeHydrated && typeof checked.rev === 'number' && checked.rev < (store.rev ?? 0)) return;
    setLibraryLoadError(null);
    if (storeHydrated && checked.rev != null && checked.rev === store.rev && !authorityRefreshRequired && !authorityRequest) {
      setIsLoading(false);
      return;
    }
    const request = authorityRequest;
    if (request) {
      authorityRequest = null;
      request(cloneFlashcardStore(checked));
    }
    authorityRefreshRequired = false;
    const firstHydration = !storeHydrated;
    if (firstHydration) setIsKnowledgeReady(false);
    const localChanges: Record<string, unknown> = {};
    // Preserve edits queued during a requested rebase/refresh round trip.
    if (request && storeHydrated && authoritativeStore) {
      recordStoreDelta(localChanges, authoritativeStore as unknown as Record<string, unknown>,
        cloneFlashcardStore(unwrap(store) as FlashcardStore) as unknown as Record<string, unknown>);
      delete localChanges.rev;
    }
    authoritativeStore = cloneFlashcardStore(checked);
    const rendered = cloneFlashcardStore(checked);
    mergeIntentOnto(rendered as unknown as Record<string, unknown>, localChanges);
    batch(() => {
      setStore(reconcile(rendered));
      if (pendingRatings.size > 0) setStore(produce(current => overlayPendingRatings(current as FlashcardStore)));
    });
    if (firstHydration) {
      void migrateLegacyGrammarKnowledge(checked.grammarKnowledge);
      knowledgeInitialization = migrateLegacyEpistemicState().finally(() => {
        setIsKnowledgeReady(true);
        if (checked.pendingRetraction) void recoverPendingRetraction();
      });
    } else if (checked.pendingRetraction) {
      void recoverPendingRetraction();
    }
    storeHydrated = true;
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
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !parsed.flashcards || typeof parsed.flashcards !== 'object' || Array.isArray(parsed.flashcards)) {
              throw new Error('The saved flashcard library has an invalid structure');
            }
            setLibraryLoadError(null);
            setIsKnowledgeReady(false);
            const checked = ensureStoreFields(parsed);
            authoritativeStore = cloneFlashcardStore(checked);
            setStore(reconcile(checked));
            void migrateLegacyGrammarKnowledge(checked.grammarKnowledge);
            knowledgeInitialization = migrateLegacyEpistemicState().finally(() => {
              setIsKnowledgeReady(true);
              if (checked.pendingRetraction) void recoverPendingRetraction();
            });
            refreshQueue();
          } catch (e) {
            log.error('Failed to parse flashcards from KV store:', e);
            handleLibraryLoadError(e instanceof Error ? e.message : String(e));
            return;
          }
        } else {
          setLibraryLoadError(null);
          // A missing disposable cache does not imply an empty durable journal.
          setIsKnowledgeReady(false);
          knowledgeInitialization = repairCapabilityProjection().finally(() => setIsKnowledgeReady(true));
        }
        setIsLoading(false);
      }).catch((e) => {
        log.error('Failed to load flashcards from KV store:', e);
        handleLibraryLoadError(e instanceof Error ? e.message : String(e));
      });
    }
  };

  function ensureStoreFields(partial: StoredFlashcardStore): FlashcardStore {
    // A decided-but-unfinished Undo must survive every path that rebuilds the
    // store, or a reload would strand the rating the learner tried to take
    // back. Read it through the one normalizer so a pre-envelope record is
    // upgraded here instead of being dropped as unrecognized.
    const storedRetraction = readPendingRetraction(
      (partial as { pendingRetraction?: unknown }).pendingRetraction
      ?? (partial as { pendingReviewUndo?: unknown }).pendingReviewUndo,
    );
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

    // Overlay migration: (1) strip aspect records seeded by the removed
    // meaning-cascade (inherited === true was written exclusively by that
    // seeding path — a derived projection, never learner evidence);
    // (2) re-key remaining legacy aspect records onto capability ids
    // (migrateAspectRecordsToAccess). Unknown keys survive as-is.
    const wordKnowledge: FlashcardStore['wordKnowledge'] = {};
    for (const [lk, entry] of Object.entries(partial.wordKnowledge || {})) {
      const legacy = entry as typeof entry & { aspects?: Record<string, { inherited?: unknown }> };
      if (!legacy.aspects) {
        wordKnowledge[lk] = migrateAspectRecordsToAccess(entry);
        continue;
      }
      const kept = Object.fromEntries(
        Object.entries(legacy.aspects).filter(([, record]) => record.inherited !== true),
      );
      wordKnowledge[lk] = migrateAspectRecordsToAccess({ ...legacy, aspects: kept } as typeof entry);
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
      ...(storedRetraction ? { pendingRetraction: storedRetraction } : {}),
      ...(partial.rev !== undefined ? { rev: partial.rev } : {}),
      version: CURRENT_VERSION,
  };
}

/** Entry recency for LWW merges: claim timestamp wins, then status change, then last seen. */
function knowledgeEntryRecency(entry: PassiveWordKnowledge): number {
  return entry.claimAt ?? entry.lastStatusChange ?? entry.lastSeen;
}

/**
 * Unversioned legacy broadcasts only merge knowledge collections. Revisioned
 * snapshots use the persisted store as authority, including reversible stats.
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
    local.ignoredWords[lk] = mergeStudyExclusion(current, entry);
  }

  mergeWordCandidates(local, incoming);
  mergeGrammarKnowledge(local, incoming);
  mergeSuggestedFlashcards(local, incoming);
}

/**
 * One-time legacy epistemic migration (Tier 1 → Tier 2 claims/evidence):
 *
 * 1. knownUntracked ("known words list" bank) → explicit claim:'known' on the
 *    word's knowledge entries + kind:'claim' journal events. The bank stops
 *    being an epistemic source; unrecoverable orphan hashes remain as inert compatibility data until
 *    their word text can be recovered. They do not govern live selection.
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
        const word = s.ignoredWords[lk]?.word ?? s.wordKnowledge[lk]?.word ?? s.suggestedFlashcards[lk]?.word;
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
      entry.hasActiveEvidence !== true
      && entry.lastStatusChange === undefined
      && (entry.lastEvidenceSource === undefined || entry.lastEvidenceSource === 'passiveTracking')
      && !hasLinkedGraduatedCards(lk);
    for (const language of languages) {
      let journalKeys: Set<string>;
      try {
        journalKeys = new Set(await queryLanguageKeys(language));
      } catch {
        continue;
      }
      const prefix = `${language}:`;
      const cachedClaimKeys = Object.entries(store.wordKnowledge).filter(([key, entry]) => key.startsWith(prefix)
        && journalKeys.has(key) && (entry.claim !== undefined || Object.values(entry.access ?? {}).some(access => access?.claim !== undefined))).map(([key]) => key);
      const durableClaims = await getKnowledgeStates(cachedClaimKeys);
      for (const [lk, entry] of Object.entries(store.wordKnowledge)) {
        if (!lk.startsWith(prefix)) continue;
        if (additions[lk]?.length) continue;
        const legacy: KnowledgeEvent[] = [];
        if (!journalKeys.has(lk) && (entry.ease > SRS.MIN_EASE || entry.timesSeen > 0)) {
          legacy.push({
            t: entry.lastSeen || now, kind: 'rollup',
            source: isPassiveOnlyRow(lk, entry) ? 'passiveTracking' : 'migration',
            aspect: 'meaning', origin: 'legacy-projection-backfill', easeAfter: entry.ease,
            ...(entry.timesSeen ? { timesSeenDelta: entry.timesSeen } : {}),
            ...(entry.word ? { presentedSurface: entry.word } : {}),
          });
        }
        const recoverClaim = (capability: CapabilityKey, claim: WordStatus | undefined, at?: number): void => {
          if (claim === undefined || durableClaims[lk]?.claimMarkers?.[capability] !== undefined) return;
          const aspect = legacyAspectFor(capability);
          legacy.push({ t: at ?? now, kind: 'claim', source: 'manual', toStatus: claim,
            ...(aspect !== undefined ? { aspect } : {}), origin: 'legacy-projection-backfill',
            ...(entry.word ? { presentedSurface: entry.word } : {}),
            targetRef: { kind: 'surface', id: surfaceEntityId(language, lk.slice(prefix.length)), capability },
          });
        };
        recoverClaim('sense-recognition', entry.claim, entry.claimAt);
        for (const [capability, access] of Object.entries(entry.access ?? {})) {
          if (!access) continue;
          if (!journalKeys.has(lk) && access.hasEvidence !== false && access.ease > SRS.MIN_EASE) {
            const aspect = legacyAspectFor(capability);
            legacy.push({ t: access.updatedAt ?? access.lastStatusChange ?? now, kind: 'rollup', source: 'migration',
              origin: 'legacy-projection-backfill', easeAfter: access.ease,
              ...(aspect !== undefined ? { aspect } : {}),
              ...(entry.word ? { presentedSurface: entry.word } : {}),
              targetRef: { kind: 'surface', id: surfaceEntityId(language, lk.slice(prefix.length)), capability },
            });
          }
          recoverClaim(capability, access.claim, access.claimAt);
        }
        if (legacy.length > 0) additions[lk] = legacy;
      }
      // Graduated cards without journal evidence (legacy SRS-as-truth).
      for (const [lk, cardIds] of Object.entries(store.wordToCardMap)) {
        if (!lk.startsWith(prefix)) continue;
        if (journalKeys.has(lk) || additions[lk]?.length) continue;
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
    await repairCapabilityProjection();
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
        const grammarKeys = new Set(await queryLanguageKeys(language, 'grammar:'));
        const additions: KnowledgeEventLog = {};
        for (const entry of group) {
          const key = grammarEvidenceKey(language, entry.pattern, 'grammar-recognition');
          if (grammarKeys.has(key)) continue;
          additions[key] = [{
            ...grammarRecognitionEvidence(language, entry.pattern, { t: entry.lastSeen, kind: 'rollup' }),
            origin: 'grammar-legacy-migration',
            // An explicit ease outcome is only migrated when the legacy row
            // semantics demonstrate measurement: a recorded failure, or
            // persisted active provenance (a rated row whose journal keys
            // are missing locally must not be downgraded to passive). Pure
            // encounter rows were passive: historical trackGrammarEncountered
            // raised ease by 0.01 per encounter without recording an outcome,
            // so stamping easeAfter would promote them to active evidence and
            // render passive exposure as Known (review 2026-09-17T002411_0000-cc07ec).
            ...(entry.hasActiveEvidence === true || entry.timesFailed > 0 ? { easeAfter: entry.ease } : {}),
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
      saveTimer = null;
      void saveFlashcardsImmediate();
    }, SAVE_DEBOUNCE_MS);
  };

  const requestAuthorityStore = (): Promise<FlashcardStore | null> => {
    return new Promise<FlashcardStore | null>((resolve) => {
      if (disposed) {
        resolve(null);
        return;
      }
      const settle = (answer: FlashcardStore | null) => {
        clearTimeout(timer);
        resolve(answer);
      };
      const timer = setTimeout(() => {
        if (authorityRequest === settle) authorityRequest = null;
        resolve(null);
      }, AUTHORITY_REBASE_TIMEOUT_MS);
      authorityRequest = settle;
      getBridge().flashcards.getFlashcards();
    });
  };

  /**
   * Re-plays a refused write onto the store the authority actually holds.
   *
   * Returns the store as committed, or null when the retry could not be
   * attempted. The authority is asked for rather than assumed: a broadcast or
   * a focus probe may have already moved it, and only the store the main
   * process holds carries the revision it will accept.
   *
   * The decision being replayed is a delta, not a snapshot, so whatever the
   * other window committed in the meantime survives. Overwriting it with this
   * window's older copy is exactly the loss being repaired: a rating or an Undo
   * in one window used to erase the other window's work whenever they raced.
   */
  const rebaseOntoAuthority = async (
    intent: Record<string, unknown>,
    removals: string[],
    resetReviewProgress: boolean,
    authorization?: FlashcardWriteAuthorization,
    recompute?: (target: FlashcardStore) => boolean,
  ): Promise<FlashcardStore | null> => {
    if (!isElectron()) return null;
    // Bounded: this window's whole write queue is serialised behind this
    // write, so an authority that never answers must not hold it open. The
    // window going away ends the wait too — a rebase is a repair for a live
    // surface, not something to finish for one that is already gone.
    markSuperseded();
    const current = await requestAuthorityStore();
    if (!current) return null;
    const rebased = ensureStoreFields(current as Partial<FlashcardStore>);
    const pending = readPendingRetraction(rebased.pendingRetraction);
    const recorded = intent.pendingRetraction as { attemptId?: unknown } | undefined;
    if (pending && recorded?.attemptId && recorded.attemptId !== pending.attemptId) {
      return null;
    }
    if (intent.retractionCompleted && pending?.attemptId !== intent.retractionCompleted) {
      return null;
    }
    // The intent is a delta, not a snapshot: it names the keys this window
    // changed and their new values, and says nothing about the keys it never
    // looked at. Merging it as "the next store" would replace every collection
    // it merely touched with a fragment of itself, so the replay walks the
    // intent's own branches against what the authority already holds.
    if (recompute) {
      if (!recompute(rebased)) return null;
    } else mergeIntentOnto(rebased as unknown as Record<string, unknown>, intent);
    try {
      const revision = await getBridge().flashcards.saveFlashcards(rebased, removals, resetReviewProgress, authorization);
      // The main process owns the revision it accepted; mirror it so this
      // window writes against what is durable rather than what it sent.
      const committed = cloneFlashcardStore(rebased);
      committed.rev = typeof revision === 'number' ? revision : (rebased.rev ?? 0) + 1;
      return committed;
    } catch (retryError) {
      // The retry can be refused too - another window can commit between the
      // read and the write, and the store is large enough that this is not
      // hypothetical. Handled here rather than allowed to escape: the caller
      // is already holding the original refusal and reports that, and a
      // rejection escaping this call would reach the window's write queue as
      // an error with nothing waiting on it.
      log.warn('Rebased flashcard write was refused too:', retryError);
      return null;
    }
  };

  /**
   * Immediate acknowledged save (used by debounced persistence and commands
   * whose visible result depends on the durable scheduler state).
   *
   * `transform` is applied to the current store when this write reaches the
   * local queue. It is also handed the record of what it decided - the keys it
   * changed and their new values - because a write can be refused and has to
   * be replayed onto whatever the store holds at that later moment. Every other
   * window holds the same provider over the same whole-snapshot store, so two of
   * them writing at once is ordinary rather than exceptional, and the loser's
   * write used to be dropped with nothing retrying it.
   *
   * The decision has to be stated where it is made. A caller restoring a known
   * card state may leave both snapshots it could be diffed between unchanged,
   * and an inferred decision would come back empty - turning the refusal into a
   * re-write of the very snapshot that was just rejected, erasing whatever the
   * other window committed in between.
   */
  /**
   * The cause of the most recent refused write, cleared when a write lands.
   *
   * `saveFlashcardsImmediate` answers with a boolean because its other caller
   * (the debounced bulk path) has nothing to report a cause to. A capture does,
   * so the cause is kept here rather than only logged, and the capture surfaces
   * turn it into the message the learner reads.
   */
  let lastPersistFailure: unknown = null;

  // A local edit may add a new index while an accepted removal is in flight.
  // Remove only references owned by that command, retaining unrelated edits.
  const pruneAcknowledgedRemovals = (target: FlashcardStore, removedCardIds: readonly string[]): void => {
    if (removedCardIds.length === 0) return;
    const removed = new Set(removedCardIds);
    for (const id of removed) delete target.flashcards[id];
    for (const [key, ids] of Object.entries(target.wordToCardMap)) {
      if (!ids.some(id => removed.has(id))) continue;
      const remaining = ids.filter(id => !removed.has(id));
      if (remaining.length) {
        target.wordToCardMap[key] = remaining;
        target.wordStatsMap[key] = calculateWordStats(remaining.map(id => target.flashcards[id]).filter(Boolean));
      } else { delete target.wordToCardMap[key]; delete target.wordStatsMap[key]; }
    }
    for (const [language, presentation] of Object.entries(target.meta.reviewPresentations ?? {})) {
      if (removed.has(presentation.cardId)) delete target.meta.reviewPresentations![language];
    }
  };

  const saveFlashcardsImmediate = async (
    transform?: (target: FlashcardStore, intent: Record<string, unknown>) => void,
    authorization?: FlashcardWriteAuthorization,
    /** A command's detached pre-image and declared writes. */
    prebuilt?: {
      base: RatingStore;
      guardCardIds?: readonly string[];
      patch: StorePatch;
    },
    command?: {
      removedCardIds: readonly string[];
      /** Refuse changes to the confirmed object, including on a stale-write retry. */
      validate: (target: FlashcardStore) => boolean;
      /** Recompute dependent indexes/preferences on the refreshed authority. */
      recomputeOnRebase: boolean;
    },
  ): Promise<boolean> => {
    await flushBackgroundRatings();
    const write = persistenceQueue.then(async () => {
      if (libraryLoadError()) {
        lastPersistFailure = new Error('The saved library must be loaded before changes can be saved');
        return false;
      }
      if (authorityRefreshRequired && !await requestAuthorityStore()) {
        lastPersistFailure = new Error('The complete flashcard store could not be refreshed');
        return false;
      }
      const composedOverRebase = storeSupersededByRebase;
      const intent: Record<string, unknown> = {};
      // TEMP DIAGNOSTIC: opt-in via window.__mlearnTrace / localStorage mlearn.ratingTrace=1.
      const __tw = performance.now();
      const __wrows: RatingTraceMark[] = [];
      const __wmark = (label: string): void => { __wrows.push({ label, ms: performance.now() - __tw }); };
      const base = prebuilt?.base ?? cloneFlashcardStore(unwrap(store) as FlashcardStore);
      if (command && !command.validate(base as FlashcardStore)) {
        lastPersistFailure = new Error('The confirmed card changed before the command could be saved');
        return false;
      }
      let candidate: FlashcardStore;
      if (prebuilt?.patch) {
        for (const id of prebuilt.guardCardIds ?? []) {
          if (JSON.stringify(unwrap(store.flashcards[id])) !== JSON.stringify(base.flashcards[id])) {
            throw new Error(`Flashcard ${id} changed while the rating was being persisted`);
          }
        }
        __wmark('guard');
        candidate = copyStoreWithPatch(authoritativeStore ?? getDefaultStore(), prebuilt.patch);
        __wmark('deltaApply');
        const before: Record<string, unknown> = {};
        const after: Record<string, unknown> = {};
        for (const entry of prebuilt.patch.entries) {
          setStorePath(before, entry.path, entry.before);
          setStorePath(after, entry.path, entry.after);
        }
        recordStoreDelta(intent, before, after);
      } else {
        candidate = cloneFlashcardStore(base as FlashcardStore);
        if (transform) transform(candidate, intent);
        else recordStoreDelta(intent,
          (authoritativeStore ?? base) as unknown as Record<string, unknown>,
          candidate as unknown as Record<string, unknown>);
      }
      const removals = [...new Set([...pendingCardRemovals, ...(command?.removedCardIds ?? [])])];
      const resetReviewProgress = pendingReviewReset;
      let committedRevision: number;
      try {
        if (isElectron()) {
          const __tipc = performance.now();
          const revision = prebuilt?.patch
            ? await getBridge().flashcards.saveFlashcardPatch(prebuilt.patch, removals, resetReviewProgress, authorization)
            : await getBridge().flashcards.saveFlashcards(candidate, removals, resetReviewProgress, authorization);
          __wmark(`ipc(${((performance.now() - __tipc)).toFixed(0)}ms)`);
          committedRevision = typeof revision === 'number' ? revision : (candidate.rev ?? 0) + 1;
        } else {
          committedRevision = (candidate.rev ?? 0) + 1;
          candidate.rev = committedRevision;
          await getBridge().kvStore.kvSet('mlearn-flashcards', JSON.stringify(candidate));
        }
      } catch (error) {
        // A refusal here means another window committed first: the write
        // carried a revision the authority has already moved past, while the
        // decision itself is still perfectly good. Rebase it onto the store
        // the authority left behind and write again, so the learner's action
        // survives instead of being dropped with nothing retrying it. Only a
        // write carrying the current revision can succeed, so this settles
        // rather than spinning.
        //
        // A write that failed for any other reason - a full disk, a torn file,
        // an interrupted process - did not happen, and re-reading the
        // authority cannot change that. Those are reported, not retried.
        if (isStaleFlashcardRevision(error)) {
          // What this window renders afterwards is the store that was actually
          // written - the authority's, with this decision replayed onto it -
          // not the pre-refusal snapshot. Rebuilding from that snapshot would
          // drop the other window's committed state from the view while the
          // file held it, so the next probe would undo the render again.
          const recompute = command?.recomputeOnRebase && transform ? (target: FlashcardStore) => {
            if (!command.validate(target)) return false;
            transform(target, {});
            return true;
          } : undefined;
          const rebased = await rebaseOntoAuthority(intent, removals, resetReviewProgress, authorization, recompute);
          if (rebased) {
            const publishAcknowledgment = (authoritativeStore?.rev ?? 0) <= (rebased.rev ?? 0);
            if (publishAcknowledgment) {
              const localChanges: Record<string, unknown> = {};
              recordStoreDelta(localChanges,
                (authoritativeStore ?? rebased) as unknown as Record<string, unknown>,
                cloneFlashcardStore(unwrap(store) as FlashcardStore) as unknown as Record<string, unknown>);
              delete localChanges.rev;
              // An acknowledged deletion owns its old target. A newer local
              // field edit cannot recreate a fragment of that deleted object.
              const changedCards = localChanges.flashcards as Record<string, unknown> | undefined;
              for (const id of command?.removedCardIds ?? []) if (changedCards) delete changedCards[id];
              if (changedCards && Object.keys(changedCards).length === 0) delete localChanges.flashcards;
              const rendered = cloneFlashcardStore(rebased);
              mergeIntentOnto(rendered as unknown as Record<string, unknown>, localChanges);
              pruneAcknowledgedRemovals(rendered, command?.removedCardIds ?? []);
              authoritativeStore = cloneFlashcardStore(rebased);
              setStore(reconcile(rendered));
            }
            // Keep the committed baseline separate from newer local edits,
            // so the next queued write can persist those edits against it.
            storeSupersededByRebase = false;
            lastPersistFailure = null;
            refreshQueue();
            for (const id of removals) pendingCardRemovals.delete(id);
            if (resetReviewProgress) pendingReviewReset = false;
            try {
              if (publishAcknowledgment) broadcastChannel?.postMessage({ type: 'update', store: rebased });
            } catch (broadcastError) {
              log.error('Failed to broadcast flashcard update:', broadcastError);
            }
            return true;
          }
        }
        authorityRequest = null;
        log.error('Failed to persist flashcards:', error);
        // The cause travels with the refusal rather than staying in the log.
        // A learner deciding whether to retry needs to know whether the disk is
        // full or the write merely lost a race, and `reportCaptureFailure`
        // shows whatever error it is handed.
        lastPersistFailure = error;
        return false;
      }
      if (prebuilt?.patch && committedRevision > (candidate.rev ?? 0) + 1) {
        // Main applied the patch to a newer store than this window has seen.
        // A revision alone cannot turn our partial snapshot into that store.
        authorityRefreshRequired = true;
        const refreshed = await requestAuthorityStore();
        if (refreshed && (refreshed.rev ?? 0) >= committedRevision) candidate = refreshed;
      }
      lastPersistFailure = null;
      candidate.rev = committedRevision;
      for (const id of removals) pendingCardRemovals.delete(id);
      if (resetReviewProgress) pendingReviewReset = false;

      if ((authoritativeStore?.rev ?? base.rev ?? 0) <= committedRevision) {
        // The candidate's changed branches are private and unchanged branches
        // share the previous immutable snapshot. Retain it as the authority
        // without another whole-store copy.
        authoritativeStore = candidate;
        __wmark('preSetStore');
        batch(() => setStore(produce((current) => {
          if (prebuilt?.patch) {
            applyStorePatchInPlace(current as unknown as Record<string, unknown>, prebuilt.patch);
            // The committed revision is not part of the command's patch: it is
            // the store's own acknowledgement counter, assigned by the writer.
            (current as unknown as Record<string, unknown>).rev = committedRevision;
          } else if (composedOverRebase) {
            mergeIntentOnto(current as unknown as Record<string, unknown>, intent);
          } else {
            applyStoreDelta(current as unknown as Record<string, unknown>, base as unknown as Record<string, unknown>, candidate as unknown as Record<string, unknown>);
          }
          pruneAcknowledgedRemovals(current, command?.removedCardIds ?? []);
        })));
        __wmark('setStore');
      }
      storeSupersededByRebase = false;

      const __tbc = performance.now();
      try {
        broadcastChannel?.postMessage(prebuilt?.patch
          ? { type: 'patch', patch: prebuilt.patch, rev: committedRevision }
          : { type: 'update', store: candidate });
      } catch (e) {
        log.error('Failed to broadcast flashcard update:', e);
      }
      __wmark(`broadcast(${((performance.now() - __tbc)).toFixed(0)}ms)`);
      if (ratingTraceOn()) emitRatingTrace(__wrows, performance.now() - __tw);
      return true;
    });
    persistenceQueue = write.then(() => undefined, () => undefined);
    return write;
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
        studyableCards(),
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
        // The scheduler cache is the authoritative schedule (answerCard reads
        // it in preference to these mirrored fields). Leaving it behind would
        // make the very next review resume the pre-reset interval, so the
        // reset has to drop it and let the fields above be the seed again.
        delete card.retentionCache;
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
    pendingReviewReset = true;
    refreshQueue();
    saveFlashcards();
  };

  // Nuke all flashcards — factory reset, wipes everything
  const nukeAllFlashcards = () => {
    for (const id of Object.keys(store.flashcards)) pendingCardRemovals.add(id);
    pendingReviewReset = true;
    setStore(reconcile(getDefaultStore()));
    setQueue({ newQueue: [], scheduledQueue: [] });
    setUndoStack([]);
    saveFlashcards();
  };

  // Push undo state
  const pushUndoState = (options: { type: string; cardId: string }) => {
    const card = store.flashcards[options.cardId];
    if (!card) return;
    const language = card.language || settings.language;
    const restored = store.meta.reviewPresentations?.[language];
    const scaffolds = restored?.cardId === card.id && restored.scaffolds
      ? { ...restored.scaffolds } : undefined;
    setUndoStack((prev) => {
      return pushUndo(prev, {
        type: options.type,
        language,
        ...(scaffolds ? { scaffolds } : {}),
        cardId: options.cardId,
        restoreCard: { ...card, content: { ...card.content } },
      });
    });
  };

  // Undo last action
  const undoLastAction = async (): Promise<string | null> => {
    const stack = undoStack();
    const entry = stack[stack.length - 1];
    const pendingUndo = readPendingRetraction(store.pendingRetraction) ?? entry?.reviewUndo;
    if (!entry && !pendingUndo) return null;
    if (ratingCommandInFlight) throw new Error('A rating command is already being persisted');
    ratingCommandInFlight = true;
    try {
      await flushBackgroundRatings();
      if (pendingUndo) {
        return await finishReviewRetraction(pendingUndo, entry);
      }

      // `restoreCard` was captured out of the live store, so it is a proxy: a
      // shallow copy leaves its nested branches proxy-backed, and the write
      // boundary cannot serialize one. The decision crosses the bridge, so it
      // is detached into plain data on the way in.
      const restoreId = entry?.cardId ?? null;
      const restoreCard = entry?.restoreCard
        ? JSON.parse(JSON.stringify(entry.restoreCard)) as Flashcard
        : null;
      const restoreLanguage = entry?.language || restoreCard?.language || settings.language;
      const presentationId = nextAttemptId();
      if (!await saveFlashcardsImmediate((target, intent) => {
        if (!restoreId || !restoreCard) return;
        const plain = JSON.parse(JSON.stringify(restoreCard)) as Flashcard;
        target.flashcards[restoreId] = plain;
        // The decision is this one card restored, not a rewritten store: the
        // record to replay says so, so a refusal can put the card back on top
        // of what another window committed instead of replacing it.
        intent.flashcards = { [restoreId]: plain };
        const presentation = { id: presentationId, cardId: restoreId,
          ...(entry?.scaffolds ? { scaffolds: { ...entry.scaffolds } } : {}) };
        (target.meta.reviewPresentations ??= {})[restoreLanguage] = presentation;
        intent.meta = { reviewPresentations: { [restoreLanguage]: presentation } };
      }, entry?.reviewUndoAuthorization)) {
        throw new Error('undo persistence was refused');
      }
      if (entry) setUndoStack((previous) => {
        const index = previous.lastIndexOf(entry);
        return index < 0 ? previous : [...previous.slice(0, index), ...previous.slice(index + 1)];
      });
      refreshQueue();
      return entry?.type ?? null;
    } finally {
      ratingCommandInFlight = false;
      drainPendingRecovery();
    }
  };

  const canUndo = () => undoStack().length > 0 || store.pendingRetraction !== undefined;

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
    if (getWordFormKeysSync(word, lang).some((key) => isKnownClaimed(key) || isStudyExcluded(store.ignoredWords[key]))) {
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
    // The card is not saved until the authority says so. `saveFlashcards()`
    // is the debounced fire-and-forget used by the write-heavy paths (bulk
    // edits, migrations) that have no single learner action to report on; a
    // capture is not one of them. Every capture surface answers "did my card
    // get saved?" by catching what this throws and routing it to
    // `reportCaptureFailure`, so a write that never lands has to reject here
    // rather than resolve with an id. Otherwise a card that only ever existed
    // in memory was reported as captured, the word stayed in the
    // unknown-words list showing as a card, and the deck was silently short
    // the one the learner was told they had.
    //
    // The immediate path is not a behaviour change for the happy path: it
    // writes the same delta, and it serializes on the same persistence queue,
    // so a rapid burst of captures still commits in order. What it changes is
    // that the caller learns the outcome instead of guessing.
    const persisted = await saveFlashcardsImmediate();
    if (!persisted) {
      // The card is in memory but not on disk. Taking it back out leaves the
      // rendered deck agreeing with the durable one, so a retry starts from
      // the same state the learner last saw rather than inheriting a card they
      // were just told was not saved. The rebase path inside
      // `saveFlashcardsImmediate` has already run by this point, so `false`
      // means no re-reading can help.
      setStore(produce((s) => {
        delete s.flashcards[id];
        const ids = s.wordToCardMap[lk];
        if (ids) {
          const remaining = ids.filter((cardId) => cardId !== id);
          if (remaining.length > 0) s.wordToCardMap[lk] = remaining;
          else delete s.wordToCardMap[lk];
        }
        const cards = (s.wordToCardMap[lk] ?? []).map((cid) => s.flashcards[cid]).filter(Boolean);
        if (cards.length > 0) s.wordStatsMap[lk] = calculateWordStats(cards);
        else delete s.wordStatsMap[lk];
      }));
      refreshQueue();
      // The cause is in the MESSAGE, not only on `cause`, because
      // `reportCaptureFailure` announces `error.message` and that message is
      // the only thing the learner sees. Naming the cause is what lets them
      // tell "the disk is full" (retry will not help) from "another window got
      // there first" (it will).
      const cause = lastPersistFailure instanceof Error
        ? lastPersistFailure.message
        : lastPersistFailure != null ? String(lastPersistFailure) : 'the store could not be written';
      throw new Error(
        `flashcard persistence was refused for "${word}": ${cause}`,
        { cause: lastPersistFailure },
      );
    }
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
    const needsTts = settings.flashcardAutoGenerateAudio && isElectron() && flashcardAudioProvider(settings.flashcardCreationAudioPreset ?? DEFAULT_SETTINGS.flashcardCreationAudioPreset, settings.flashcardTtsProvider) !== DEFAULT_SETTINGS.flashcardTtsProvider;
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
      const preset = settings.flashcardCreationAudioPreset ?? DEFAULT_SETTINGS.flashcardCreationAudioPreset;
      const provider = flashcardAudioProvider(preset, settings.flashcardTtsProvider);
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
            ? await withCloudAuth((cloudToken) => bridge.flashcards.generateFlashcardTts(cardId, cleanWord, language, 'word', provider, voiceSampleId, cloudToken, cloudApiUrl, preset))
            : await bridge.flashcards.generateFlashcardTts(cardId, cleanWord, language, 'word', provider, voiceSampleId, undefined, cloudApiUrl, preset);
          if (result) {
            updatePostCreateTask(wordLabel, 'wordTts', 'done');
          } else {
            updatePostCreateTask(wordLabel, 'wordTts', 'error');
          }
        } else {
          updatePostCreateTask(wordLabel, 'wordTts', 'done');
        }
      } catch (err) {
        absorbProviderFailure(err, t, settings.llmProvider);
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
              ? await withCloudAuth((cloudToken) => bridge.flashcards.generateFlashcardTts(cardId, cleanExample, language, 'example', provider, voiceSampleId, cloudToken, cloudApiUrl, preset))
              : await bridge.flashcards.generateFlashcardTts(cardId, cleanExample, language, 'example', provider, voiceSampleId, undefined, cloudApiUrl, preset);
            if (result) {
              updatePostCreateTask(wordLabel, 'exampleTts', 'done');
            } else {
              updatePostCreateTask(wordLabel, 'exampleTts', 'error');
            }
          } else {
            updatePostCreateTask(wordLabel, 'exampleTts', 'done');
          }
        } catch (err) {
          absorbProviderFailure(err, t, settings.llmProvider);
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

  // Removal is a command: publish its result and release media only after ACK.
  const removalCommands = new Map<string, Promise<boolean>>();
  const removeFlashcard = (id: string, neverShowAgain: boolean = true): Promise<boolean> => {
    const existing = removalCommands.get(id);
    if (existing) return existing;
    const current = store.flashcards[id];
    if (!current) return Promise.resolve(false);
    const card = JSON.parse(JSON.stringify(current)) as Flashcard;
    const word = card.content.front;
    const lang = card.language || settings.language;
    const lk = langKey(lang, SRS.hashWordSync(getPrimaryWordFormForLanguage(word, lang)));
    const confirmed = JSON.stringify(card);
    const removal = (async () => {
      const persisted = await saveFlashcardsImmediate((target, intent) => {
        const before = cloneFlashcardStore(target);
        delete target.flashcards[id];
        if (target.meta.reviewPresentations?.[lang]?.cardId === id) delete target.meta.reviewPresentations[lang];
        const remaining = target.wordToCardMap[lk]?.filter(cardId => cardId !== id);
        if (remaining) {
          if (remaining.length === 0) {
            delete target.wordToCardMap[lk];
            delete target.wordStatsMap[lk];
            if (neverShowAgain) {
              const previous = target.ignoredWords[lk];
              target.ignoredWords[lk] = { ...previous, word,
                ...(card.content.reading !== undefined ? { reading: card.content.reading } : {}),
                language: lang, ignoredAt: Date.now(), excluded: true,
                updatedAt: Math.max(Date.now(), (previous?.updatedAt ?? previous?.ignoredAt ?? 0) + 1) };
            }
          } else {
            target.wordToCardMap[lk] = remaining;
            target.wordStatsMap[lk] = calculateWordStats(remaining.map(cardId => target.flashcards[cardId]).filter(Boolean));
          }
        }
        recordStoreDelta(intent, before as unknown as Record<string, unknown>, target as unknown as Record<string, unknown>);
      }, undefined, undefined, { removedCardIds: [id],
        validate: target => JSON.stringify(target.flashcards[id]) === confirmed, recomputeOnRebase: true });
      if (!persisted) return false;
      refreshQueue();
      // A newer acknowledged authority can recreate this ID while the old
      // response is in flight. Its resources belong to that newer owner.
      if (store.flashcards[id]) return true;
      if (card.content.videoUrl) {
        getBridge().flashcards.deleteFlashcardVideo(id).catch((error: unknown) => log.warn('Failed to delete flashcard video:', error));
      }
      if (card.content.imageUrl) {
        const imageId = extractCardIdFromImageUrl(card.content.imageUrl);
        const imageStillUsed = Object.values(store.flashcards).some(other => other.content.imageUrl && extractCardIdFromImageUrl(other.content.imageUrl) === imageId)
          || Object.values(store.suggestedFlashcards).some(other => other.imageUrl && extractCardIdFromImageUrl(other.imageUrl) === imageId);
        if (imageId && !imageStillUsed) {
          getBridge().flashcards.deleteFlashcardImage(imageId).catch((error: unknown) => log.warn('Failed to delete flashcard image:', error));
        }
      }
      getBridge().flashcards.deleteFlashcardTts(id).catch((error: unknown) => log.warn('Failed to delete flashcard TTS:', error));
      return true;
    })().finally(() => { if (removalCommands.get(id) === removal) removalCommands.delete(id); });
    removalCommands.set(id, removal);
    return removal;
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

    pushUndoState({ type: 'suspend', cardId: id });

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

    pushUndoState({ type: 'bury', cardId: id });

    setStore(produce((s) => {
      const language = s.flashcards[id].language || settings.language;
      if (s.meta.reviewPresentations?.[language]?.cardId === id) delete s.meta.reviewPresentations[language];
      s.flashcards[id] = SRS.buryCard(s.flashcards[id]);
    }));

    setQueue(SRS.removeFromQueue(queue(), id));
    saveFlashcards();
  };

  const applySchedulerRating = (
    target: RatingStore,
    startingQueue: ReviewQueue,
    scheduler: SchedulerRating,
    attemptId: AttemptId,
    options: RatingSubmissionOptions,
    hasObservations: boolean,
    /** Declares each entry this command writes, as it writes it. */
    patch?: StorePatchRecorder,
    /** Original return-position owner, including absence on first admission. */
    presentationId?: string,
  ): { completed: boolean; nextQueue: ReviewQueue; event: KnowledgeEvent; undo: UndoEntry; updated: Flashcard } => {
    const card = target.flashcards[scheduler.cardId];
    if (!card) throw new Error(`Flashcard ${scheduler.cardId} no longer exists`);

    const wasNew = card.state === 'new';
    const wasReview = card.state === 'review';
    const retentionCondition = scheduler.tested
      ? retentionConditionFor(scheduler.tested, options.scaffolds)
      : 'unassisted' as const;
    const updated = SRS.answerCard(card, scheduler.rating, target.meta, retentionCondition);
    const language = card.language || options.language || settings.language;
    const storageWord = getPrimaryWordFormForLanguage(card.content.front, language);
    const now = Date.now();
    const key = langKey(language, SRS.hashWordSync(storageWord));
    const event: KnowledgeEvent = {
      t: now,
      kind: 'review',
      source: 'srs',
      ...(!hasObservations ? { aspect: 'meaning' as const } : {}),
      rating: scheduler.rating,
      presentedSurface: card.content.front,
      easeBefore: card.ease,
      easeAfter: updated.ease,
      intervalBefore: card.interval,
      intervalAfter: updated.interval,
      schedulerCardId: card.id,
      attemptId,
      taskType: options.taskType ?? 'srs-review',
      ...(options.origin ? { origin: options.origin } : {}),
      ...(options.scaffolds ? { scaffolds: options.scaffolds } : {}),
      ...(retentionCondition !== 'unassisted' ? { retentionCondition } : {}),
    };

    // Scheduler reviews remain active retention evidence. When explicit
    // observations accompany this review, their rating owns knowledge status.
    const meaningMeasured = !hasObservations;
    if (!target.wordKnowledge[key]) {
      if (meaningMeasured) {
        target.wordKnowledge[key] = {
          ease: updated.ease,
          lastSeen: now,
          firstSeen: now,
          timesSeen: 0,
          timesHovered: 0,
          word: storageWord,
          language,
          lastEvidenceSource: 'srs',
          hasActiveEvidence: true,
        };
      }
    } else {
      if (meaningMeasured) target.wordKnowledge[key].ease = updated.ease;
      target.wordKnowledge[key].lastSeen = now;
      if (meaningMeasured) {
        target.wordKnowledge[key].lastEvidenceSource = 'srs';
        target.wordKnowledge[key].hasActiveEvidence = true;
      }
    }
    patch?.set(['wordKnowledge', key], target.wordKnowledge[key]);
    const nextQueue = (() => {
      let next = SRS.removeFromQueue(startingQueue, card.id);
      if (updated.state === 'learning' || updated.state === 'relearning') {
        next = SRS.addToQueue(next, updated, newDayHour());
      }
      return next;
    })();
    const remainsQueued = nextQueue.newQueue.includes(card.id) || nextQueue.scheduledQueue.includes(card.id);
    const priorCard: Flashcard = { ...card, content: { ...card.content } };
    const today = SRS.getTodayDateString(newDayHour());
    const priorPerLanguage = target.meta.perLanguage[language]
      ? { ...target.meta.perLanguage[language] }
      : null;
    const dailyBefore = target.dailyStats[today]?.[language]
      ? { ...target.dailyStats[today][language] }
      : null;
    // The acknowledged scheduler transaction also consumes the restored
    // presentation; assistance remains durable until this same write lands.
    const restored = target.meta.reviewPresentations?.[language];
    if (restored?.cardId === card.id && restored.id === presentationId) {
      delete target.meta.reviewPresentations![language];
      const path = ['meta', 'reviewPresentations', language];
      patch?.remove(path, { path: [...path, 'id'], equals: restored.id });
    }
    target.flashcards[card.id] = updated;
    const perLanguage = target.meta.perLanguage[language] ?? {
      newCardsToday: 0, reviewsToday: 0, newCardsDate: today,
    };
    if (wasNew) perLanguage.newCardsToday++;
    if (wasReview) perLanguage.reviewsToday++;
    target.meta.perLanguage[language] = perLanguage;
    target.dailyStats[today] ??= {};
    target.dailyStats[today][language] ??= {
      date: today,
      newCardsStudied: 0,
      reviewCardsStudied: 0,
      lapses: 0,
      timeSpent: 0,
      graduated: 0,
    };
    if (wasNew) target.dailyStats[today][language].newCardsStudied++;
    else target.dailyStats[today][language].reviewCardsStudied++;
    target.dailyStats[today][language].lapses += Math.max(0, updated.lapses - card.lapses);
    if ((card.state === 'learning' || card.state === 'new') && updated.state === 'review') {
      target.dailyStats[today][language].graduated++;
    }
    if (scheduler.timeSpentMs && scheduler.timeSpentMs > 0) {
      target.dailyStats[today][language].timeSpent += scheduler.timeSpentMs;
    }
    // The complete set of entries this command writes. Declaring them here is
    // what lets the write skip a structural diff of the whole store.
    patch?.set(['flashcards', card.id], target.flashcards[card.id]);
    patch?.set(['meta', 'perLanguage', language], perLanguage);
    patch?.set(['dailyStats', today, language], target.dailyStats[today][language]);
    const undo: UndoEntry = {
      type: remainsQueued ? 'answer-requeued' : 'answer',
      cardId: card.id,
      reviewUndoAuthorization: { kind: 'undo-review', cardId: card.id, restoredReviews: priorCard.reviews },
      reviewUndo: reviewRetraction(
        attemptId, card, priorCard, priorPerLanguage, today, dailyBefore,
        remainsQueued ? 'answer-requeued' : 'answer', language, options.scaffolds,
      ),
    };
    return { completed: !remainsQueued, nextQueue, event, undo, updated };
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
    return SRS.getDueCards(studyableCards(), newDayHour(), settings.language).length;
  };

  // Get new cards count
  const getNewCount = (): number => {
    return SRS.getNewCards(studyableCards(), settings.language).length;
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

  const knownWordSet = createKnownWordSet(
    () => store.wordKnowledge,
    () => effectiveThresholds(settings),
    (key, entry) => {
      const language = entry.language ?? key.split(':')[0];
      return [...new Set([key, ...getWordFormsForLanguage(entry.word, language)
        .map(form => langKey(language, SRS.hashWordSync(form)))])];
    },
  );
  /** Teaching-policy exclusions (ignoredWords): never select/teach/test these. */
  const excludedWordKeys = createMemo(() => new Set(Object.entries(store.ignoredWords).filter(([, entry]) => isStudyExcluded(entry)).map(([key]) => key)));
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

  const isWordIgnoredSync = (word: string, language = settings.language): boolean => {
    if (!word) return false;
    // Exclusion policy ONLY. A known claim is not an ignore — callers that
    // mean "known OR excluded" use isWordSettledSync.
    for (const form of getWordFormsForLanguage(word, language)) {
      const wordHash = SRS.hashWordSync(form);
      const key = langKey(language, wordHash);
      if (isStudyExcluded(store.ignoredWords[key])) {
        return true;
      }
    }
    return false;
  };

  const getIgnoredWordsSync = (): IgnoredWordEntry[] => {
    const prefix = `${settings.language}:`;
    return Object.entries(store.ignoredWords)
      .filter(([key, entry]) => key.startsWith(prefix) && isStudyExcluded(entry))
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

  const saveReviewPresentation = async (language: string, presentation: ReviewPresentation, expectedId: string | null): Promise<void> => {
    const frozen = JSON.parse(JSON.stringify(presentation)) as ReviewPresentation;
    if (!isLearningDecision(frozen.decision) || frozen.cardId !== frozen.decision.selected.key || frozen.id !== frozen.decision.id) {
      throw new Error('Invalid saved review choice');
    }
    const cue = frozen.decision.selected.presentation;
    const matchesCard = (target: FlashcardStore) => {
      const card = target.flashcards[frozen.cardId];
      return !!card && !card.suspended && !card.buried && cue?.cardId === card.id
        && cue.surface === card.content.front && cue.language === (card.language || language)
        && (cue.contentVersion === undefined || cue.contentVersion === SRS.hashWordSync(JSON.stringify(card.content)));
    };
    // Durable technical audit precedes the resumable cursor. Neither is evidence.
    await getBridge().knowledgeEvents.recordLearningDecision(frozen.decision);
    const existing = store.meta.reviewPresentations?.[language];
    if (existing?.id === frozen.id && JSON.stringify(existing) === JSON.stringify(frozen) && matchesCard(store)) return;
    const validate = (target: FlashcardStore) => matchesCard(target)
      && (target.meta.reviewPresentations?.[language]?.id ?? null) === expectedId;
    if (!await saveFlashcardsImmediate((target, intent) => {
      (target.meta.reviewPresentations ??= {})[language] = frozen;
      intent.meta = { reviewPresentations: { [language]: frozen } };
    }, undefined, undefined, { removedCardIds: [], validate, recomputeOnRebase: true })) {
      throw new Error('The review position could not be saved');
    }
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
      return (cardIds && cardIds.length > 0) || isKnownClaimed(key) || isStudyExcluded(store.ignoredWords[key]);
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

    const comprehensiveStatus = getComprehensiveWordStatusWithSourceSync(word, lang).status;
    const suggestionLanguageData = languageDataFor(lang);
    const dictionaryTargetLanguage = params.dictionaryTargetLanguage ?? dictionaryTargetFor(lang);
    const keepSuggestion = shouldKeepSuggestion(
      {
        word: storageWord,
        reading: params.reading,
        pos: params.pos,
        level: params.level,
        language: lang,
        // Current-media recurrence (R21): admits a repeatedly-blocking
        // off-list term through the level gate; dictionary/script/known/
        // exclusion checks stay in force.
        mediaRecurrence: params.mediaRecurrence,
      },
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
        // Recurrence is coverage that grows with use: keep the best recorded
        // count (R21), never a look-up-derived value.
        if (params.mediaRecurrence != null) {
          existing.mediaRecurrence = Math.max(existing.mediaRecurrence ?? 0, params.mediaRecurrence);
        }
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
          ...(params.mediaRecurrence != null ? { mediaRecurrence: params.mediaRecurrence } : {}),
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
        const comprehensiveStatus = getComprehensiveWordStatusWithSourceSync(s.word, lang).status;
        const level = getSuggestedFlashcardLevel(s);
        const suggestionLanguageData = languageDataFor(lang);
        const dictionaryTargetLanguage = dictionaryTargetFor(lang);
        const keep = shouldKeepSuggestion(
          {
            word: s.word,
            reading: s.reading,
            pos: s.pos,
            level,
            language: s.language,
            // Recorded current-media recurrence (R21): the stored coverage
            // count, falling back to capture refreshes — both honest counts
            // of the word recurring in the learner's content.
            mediaRecurrence: s.mediaRecurrence ?? s.count,
          },
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
   * Only the replayed explicit claim governs creation/suggestion suppression.
   * Orphan legacy markers have no canonical claim and must not silently veto
   * actions that Inspect correctly presents as unmeasured. Keep that stored
   * compatibility data intact for the existing recovery path.
   */
  const isKnownClaimed = (lk: string): boolean =>
    store.wordKnowledge[lk]?.claim === 'known';

  /** Passive rows classify by the same anchors as the resolver; source stays passiveTracking so replay never marks lastStatusChange. */
  const passiveEaseToStatus = (ease: number): WordStatus =>
    evidenceStatusFromEase(ease, effectiveThresholds(settings));

  const shouldGarbageCollectSuggestion = (suggestion: SuggestedFlashcard): boolean => (
    getAccessStatusSync(suggestion.word, 'sense-recognition', comprehensiveDeps(suggestion.language)).status === 'known'
    || isWordIgnoredSync(suggestion.word, suggestion.language)
    || getCardsByWordSync(suggestion.word, suggestion.language).length > 0
  );

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
    const dictionaryTargetLanguage = dictionaryTargetFor(lang);

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
          {
            word: suggestion.word,
            reading: suggestion.reading,
            pos: suggestion.pos,
            level,
            language: lang,
            // Same recorded recurrence the list filter honors (R21): GC must
            // not delete what capture kept for recurring current-media terms.
            mediaRecurrence: suggestion.mediaRecurrence ?? suggestion.count,
          },
          settings,
          known,
          userLevel,
          getComprehensiveWordStatusWithSourceSync(suggestion.word, lang).status,
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
          const dictionaryTargetLanguage = dictionaryTargetFor(suggestion.language);
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
    let needsSave = false;
    let done = 0;
    for (const id of ids) {
      const key = findSuggestionKey(id);
      if (!key) { done++; onProgress?.(done, total); continue; }
      const suggestion = store.suggestedFlashcards[key];
      if (!suggestion) { done++; onProgress?.(done, total); continue; }

      try {
        const suggestionLanguageData = languageDataFor(suggestion.language);
        // One enrichment owner: the dictionary lookup, the dictionary target
        // language, and the package-declared reading/prosody extraction.
        const enriched = await enrichWord({
          word: suggestion.word,
          language: suggestion.language,
          languageData: suggestionLanguageData,
          settings,
          dictionaryTargetLanguage: dictionaryTargetFor(suggestion.language),
          currentContent: { reading: suggestion.reading },
        });
        if (!enriched) { done++; onProgress?.(done, total); continue; }

        const { back: backText, reading, prosody, definition: definitionArr } = enriched;

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
          // Populating an existing card is an in-place edit and does not
          // persist on its own, so it is the one path here that still needs the
          // write at the end. A card built by `addFlashcard` already reached the
          // authority when that call resolved.
          needsSave = true;
        } else {
          populatedCardId = await addFlashcard(content, undefined, true, suggestion.language);
        }
        if (!populatedCardId) continue;
        created++;

        // Optional TTS generation for word + example
        if (populatedCardId && useTts && isElectron()) {
          try {
            const bridge = getBridge();
            const preset = settings.flashcardCreationAudioPreset ?? DEFAULT_SETTINGS.flashcardCreationAudioPreset;
            const provider = flashcardAudioProvider(preset, settings.flashcardTtsProvider ?? DEFAULT_SETTINGS.flashcardTtsProvider);
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
                preset,
              ));
            } else {
              await bridge.flashcards.batchGenerateFlashcardTts(
                ttsItems,
                suggestion.language,
                provider,
                voiceSampleId,
                undefined,
                cloudApiUrl,
                preset,
              );
          }
        } catch (e) {
          absorbProviderFailure(e, t, settings.llmProvider);
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

    if (created > 0 && needsSave) saveFlashcards();
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

        // Preserve-existing-status mode respects canonical knowledge and explicit
        // exclusion policy. Card ownership is checked separately below.
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

    if (!await saveFlashcardsImmediate((target, intent) => {
      const previous = target.ignoredWords[lk];
      const exclusion: IgnoredWordEntry = { ...previous, word: storageWord,
        ...(reading !== undefined ? { reading } : {}), language: lang,
        ignoredAt: Date.now(), excluded: true,
        updatedAt: Math.max(Date.now(), (previous?.updatedAt ?? previous?.ignoredAt ?? 0) + 1) };
      target.ignoredWords[lk] = exclusion;
      intent.ignoredWords = { [lk]: exclusion };
    })) throw lastPersistFailure ?? new Error('Study exclusion persistence was refused');
    refreshQueue();
    if (!isWordIgnoredSync(word, lang)) throw new Error('The study preference was superseded by a newer change');
  };

  const unignoreWordForLanguage = async (word: string, language?: string) => {
    const lang = language ?? settings.language;
    const storageWord = getPrimaryWordFormForLanguage(word, lang);
    const wordHash = await SRS.hashWord(storageWord);
    const lk = langKey(lang, wordHash);

    // Withdrawing the policy preserves claims, historical observations and cards.
    const keys = new Set([lk, ...getWordFormKeysSync(word, lang)]);
    if (!await saveFlashcardsImmediate((target, intent) => {
      const preferences: Record<string, IgnoredWordEntry> = {};
      for (const key of keys) {
        const previous = target.ignoredWords[key];
        if (key !== lk && !previous) continue;
        const withdrawal: IgnoredWordEntry = {
          ...previous,
          word: previous?.word ?? storageWord, language: lang,
          ignoredAt: previous?.ignoredAt ?? Date.now(), excluded: false,
          updatedAt: Math.max(Date.now(), (previous?.updatedAt ?? previous?.ignoredAt ?? 0) + 1),
        };
        target.ignoredWords[key] = withdrawal;
        preferences[key] = withdrawal;
      }
      intent.ignoredWords = preferences;
    })) throw lastPersistFailure ?? new Error('Study preference persistence was refused');
    refreshQueue();
    if (isWordIgnoredSync(word, lang)) throw new Error('The study preference was superseded by a newer change');
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

  // Coalesced passive-seen writes (performance ownership: telemetry must not
  // synchronously churn presentation). A per-token setStore write here used to
  // invalidate vocabulary-wide memos (knownWordSet iterates every entry) on
  // every seen word, so passive exposure cost O(vocabulary) per token.
  // Observations accumulate in this map with identical throttle arithmetic and
  // are applied in ONE batched produce at event-driven flush points. Status
  // semantics cannot drift mid-burst: pure passive ease never changes the
  // Tier-2 status read (REQ13), so a lagging ease column cannot change what a
  // word resolves to.
  interface PendingSeenEntry {
    easeDelta: number;
    timesSeenDelta: number;
    /** Undefined until the first queued encounter; a real epoch-0 timestamp must not read as "never seen". */
    lastSeen: number | undefined;
    firstSeen: number;
    word: string;
    reading?: string;
    language: string;
  }
  const pendingSeen = new Map<string, PendingSeenEntry>();
  // Caller-supplied media/page identities survive component remounts within this
  // learner session. A new playback/page visit uses a new identity.
  const recordedSeenEncounters = new Set<string>();
  const PENDING_SEEN_FLUSH_BOUND = 50;

  const flushPendingSeen = (): void => {
    if (pendingSeen.size === 0) return;
    const batch = [...pendingSeen.entries()];
    pendingSeen.clear();
    perfCount('knowledge.flushPendingSeen.batches');
    perfCount('knowledge.flushPendingSeen.entries', batch.length);
    setStore(produce((s) => {
      for (const [lk, entry] of batch) {
        if (!s.wordKnowledge[lk]) {
          s.wordKnowledge[lk] = {
            ease: Math.min(5, SRS.MIN_EASE + entry.easeDelta),
            lastSeen: entry.lastSeen ?? entry.firstSeen,
            timesSeen: entry.timesSeenDelta,
            timesHovered: 0,
            word: entry.word,
            reading: entry.reading,
            language: entry.language,
            firstSeen: entry.firstSeen,
          };
          continue;
        }
        const k = s.wordKnowledge[lk];
        if (entry.timesSeenDelta > 0) {
          k.timesSeen += entry.timesSeenDelta;
          // Ease bump rides the encounter throttle (see trackWordSeen).
          k.ease = Math.min(5, k.ease + entry.easeDelta);
        }
        if (entry.lastSeen !== undefined) k.lastSeen = entry.lastSeen;
      }
    }));
  };

  // Track that a word was seen (displayed on screen)
  const trackWordSeen = (word: string, reading?: string, easeBump = 0.01, language = settings.language, encounterId?: string) => {
    perfCount('knowledge.trackWordSeen.calls');
    if (!settings.passiveEaseEnabled) return;
    // Use the language's primary word form so inflections and alternate spellings track together.
    const storageWord = getPrimaryWordFormForLanguage(word, language);
    const wordHash = SRS.hashWordSync(storageWord);
    const lang = language;
    const lk = langKey(lang, wordHash);
    if (isKnownClaimed(lk)) return;
    const encounterKey = encounterId ? `${lk}\0${encounterId}` : undefined;
    if (encounterKey && recordedSeenEncounters.has(encounterKey)) return;
    const now = Date.now();

    const existing = store.wordKnowledge[lk];
    let entry = pendingSeen.get(lk);
    if (!entry) {
      entry = {
        easeDelta: 0,
        timesSeenDelta: 0,
        lastSeen: existing?.lastSeen,
        firstSeen: existing?.firstSeen ?? now,
        word: storageWord,
        reading,
        language: lang,
      };
      pendingSeen.set(lk, entry);
    }
    const referenceSeen = entry.lastSeen;
    const shouldCount = encounterKey !== undefined
      || referenceSeen === undefined || now - referenceSeen >= WORD_SEEN_COUNT_THROTTLE_MS;

    if (shouldCount) {
      if (encounterKey) recordedSeenEncounters.add(encounterKey);
      entry.timesSeenDelta += 1;
      // Ease bump rides the same throttle as timesSeen: without this, subtitle
      // line flapping / window remounts farm ease unboundedly (the throttle
      // gated only the counter). Logical media-position encounter identity is
      // a Tier-2 concern; this closes the farm hole now.
      entry.easeDelta += easeBump;
    }
    entry.lastSeen = now;

    // Notify media stats listeners so per-media tracking stays in sync.
    // The projected ease is (store ease + pending delta) — the store column
    // itself lags until flushPendingSeen, by design. Computed BEFORE the
    // size-bound flush so the read cannot observe the just-applied batch.
    const newEase = Math.min(5, (existing?.ease ?? SRS.MIN_EASE) + entry.easeDelta);
    window.dispatchEvent(new CustomEvent('mlearn:word-seen', { detail: { word, language: lang, ease: newEase } }));
    if (shouldCount) accumulateWordSeen(lk, newEase, 1, passiveEaseToStatus(newEase));

    if (pendingSeen.size >= PENDING_SEEN_FLUSH_BOUND) flushPendingSeen();
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
      perfCount('knowledge.trackWordHovered.writes');
      hoverTimers.delete(lk);
      const now = Date.now();

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
        k.timesHovered += 1;
        k.lastSeen = now;
      }));
      saveFlashcards();

      // R10 (review 2026-09-17T011733): an ordinary hover is NEVER a failure.
      // The retired decrease-ease policy used to lower ease and append a
      // passiveTracking status event once passiveHoverFailCount was reached —
      // under any configured action. Hovering now records FAMILIARITY only,
      // so no interaction with a hover popup can create negative epistemic
      // evidence. The legacy media-stats event keeps its contract shape with
      // isFailed: false.
      window.dispatchEvent(new CustomEvent('mlearn:word-hovered', {
        detail: {
          word,
          language: lang,
          ease: store.wordKnowledge[lk]?.ease ?? SRS.MIN_EASE,
          timesHovered: store.wordKnowledge[lk]?.timesHovered ?? 0,
          isFailed: false,
        },
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
  const effectiveWordState = (lk: string) => {
    const entry = store.wordKnowledge[lk];
    return entry?.word
      ? getComprehensiveWordStatusWithSourceSync(entry.word, entry.language ?? lk.split(':')[0])
      : getEffectiveWordStateForKeys([lk], store.wordKnowledge, {
        learning: passiveLearningEaseThreshold(), known: passiveKnownEaseThreshold(),
      });
  };

  const isWordKnown = (wordHash: string): boolean => {
    const lk = wordHash.includes(':') ? wordHash : langKey(settings.language, wordHash);
    return effectiveWordState(lk).status === 'known';
  };

  const isWordLearning = (wordHash: string): boolean => {
    const lk = wordHash.includes(':') ? wordHash : langKey(settings.language, wordHash);
    return effectiveWordState(lk).status === 'learning';
  };

  // Convenience: check if word is known by raw word text (sync hash)
  const isWordKnownByText = (word: string, language = settings.language): boolean =>
    getComprehensiveWordStatusWithSourceSync(word, language).status === 'known';

  const isWordLearningByText = (word: string, language = settings.language): boolean =>
    getComprehensiveWordStatusWithSourceSync(word, language).status === 'learning';

  const passiveLearningEaseThreshold = (): number => effectiveThresholds(settings).learning;
  const passiveKnownEaseThreshold = (): number => effectiveThresholds(settings).known;

  const comprehensiveDeps = (language: string): Parameters<typeof getComprehensiveWordStatusWithSource>[1] => ({
    getCanonicalForm: (value: string) => getPrimaryWordFormForLanguage(value, language),
    // D4 lazy salvage: read-only probe of legacy ambient-locale casing variants
    // after current-version forms, so pre-v2 persisted keys remain visible.
    getWordForms: (value: string) => {
      const forms = getWordFormsForLanguage(value, language);
      const legacy = legacyCasingCandidates(value).filter((variant) => !forms.includes(variant));
      return [...forms, ...legacy];
    },
    hashWordSync: SRS.hashWordSync,
    langKey,
    language,
    ignoredWords: store.ignoredWords,
    wordKnowledge: store.wordKnowledge,
    knownEaseThreshold: passiveKnownEaseThreshold(),
    learningThreshold: passiveLearningEaseThreshold(),
  });

  /**
   * Canonical per-access read (surface-scoped hashing / untracked semantics
   * live in one place). The readiness gate lives HERE — one source of truth
   * for every consumer (reader, subtitles, sidebar, Word DB, word sync,
   * flashcards): before hydration+migration settle, an empty store must read
   * as untracked-neutral, not as observed knowledge.
   */
  const getAccessStatus = (word: string, capability: CapabilityKey, language = settings.language): AccessStatusResult => (
    (perfCount('knowledge.getAccessStatus.calls'), isKnowledgeReady())
      ? getAccessStatusSync(word, capability, comprehensiveDeps(language))
      : { status: 'unknown', ease: 0, source: 'None', untracked: true }
  );

  const getComprehensiveWordStatusSync = (word: string, language = settings.language): WordStatus => {
    perfCount('knowledge.getComprehensiveStatus.calls');
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

  /**
   * Canonical "would this word be hidden from the unknown-words list?" answer for
   * every surface that captures words the learner is READING (reader pages,
   * subtitle tracks, the floating overlay).
   *
   * Written comprehension is a different question from word-level knowledge: it
   * requires the presented WRITTEN form to be recognized as well as the meaning
   * to be known. A word imported from Anki, or claimed known by the learner, can
   * hold a word-level `known` with no `surface-recognition` record at all - such a
   * word is not yet known AS WRITTEN, so it still belongs in the list.
   *
   * This existed as two rules. The reader asked this question; the video route
   * and the overlay asked the laxer word-level one, so the same word rendered as
   * unknown in the subtitle track while the sidebar beside it reported the word
   * as known and listed nothing - the video window contradicting itself on one
   * screen. Both answers were defensible alone; the surfaces simply disagreed.
   * Subtitle/OCR tokens already render from this rule (SubtitleWord/OcrWord), so
   * routing the capture surfaces through it is what makes the list, the colouring
   * and the bluring agree.
   */
  const isWordKnownWhenWrittenSync = (
    word: string,
    surface: string,
    language = settings.language,
  ): boolean => getWrittenComprehensionStatus(
    { surface, lexicalWord: word, language },
    getAccessStatus,
  ) === 'known';


  const isWordKnownComprehensiveSync = (word: string, language = settings.language): boolean => (
    getComprehensiveWordStatusSync(word, language) === 'known'
  );

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
  const setWordClaim = async (word: string, claim: WordStatus | null, language = settings.language): Promise<boolean> => {
    await knowledgeInitialization;
    const forms = getWordFormsForLanguage(word, language);
    const now = Date.now();
    const events: KnowledgeEventLog = Object.fromEntries(forms.map(form => {
      const hash = SRS.hashWordSync(form);
      return [langKey(language, hash), [{ t: now, kind: 'claim', source: 'manual', aspect: 'meaning',
        presentedSurface: form, targetRef: { kind: 'surface', id: surfaceEntityId(language, hash), capability: 'sense-recognition' },
        ...(claim !== null ? { toStatus: claim } : {}),
      } satisfies KnowledgeEvent]];
    }));
    try {
      if (!await appendEventsIdempotentAcknowledged(events)) return false;
      const states = await getKnowledgeStates(Object.keys(events));
      setStore(produce(current => {
        for (const form of forms) {
          const key = langKey(language, SRS.hashWordSync(form));
          const latest = states[key]?.claimMarkers?.['sense-recognition'];
          const status = latest?.status;
          if (status === undefined && !current.wordKnowledge[key]) continue;
          const entry = current.wordKnowledge[key] ?? (current.wordKnowledge[key] = {
            word: form, language, ease: SRS.MIN_EASE, lastSeen: now, timesSeen: 0, timesHovered: 0,
          });
          if (status !== undefined) {
            entry.claim = status;
            entry.claimAt = latest!.t;
          } else {
            delete entry.claim;
            delete entry.claimAt;
            if (entry.ease <= SRS.MIN_EASE && entry.timesSeen === 0 && entry.timesHovered === 0
              && !entry.hasActiveEvidence && Object.keys(entry.access ?? {}).length === 0) delete current.wordKnowledge[key];
          }
        }
      }));
      saveFlashcards();
      return true;
    } catch (error) {
      log.warn('claim write failed:', error);
      return false;
    }
  };

  const setAccessClaim = async (
    word: string, capability: CapabilityKey, status: WordStatus, language = settings.language,
    entity?: { kind: string; id: string },
  ): Promise<boolean> => {
    await knowledgeInitialization;
    const forms = entity !== undefined || isSurfaceScopedCapability(capability, languageDataFor(language))
      ? [word] : getWordFormsForLanguage(word, language);
    const now = Date.now();
    const aspect = legacyAspectFor(capability);
    const events: KnowledgeEventLog = Object.fromEntries(forms.map(form => [langKey(language, SRS.hashWordSync(form)), [{
      t: now, kind: 'claim', source: 'manual', presentedSurface: form,
      ...(aspect !== undefined ? { aspect } : {}),
      targetRef: { ...(entity ?? { kind: 'surface', id: surfaceEntityId(language, SRS.hashWordSync(form)) }), capability },
      toStatus: status,
    } satisfies KnowledgeEvent]]));
    try {
      if (!await appendEventsIdempotentAcknowledged(events)) return false;
      // Exact non-surface claims belong to their graph target, not a word-wide cache.
      if (entity && entity.kind !== 'surface') return true;
      const states = await getKnowledgeStates(Object.keys(events));
      setStore(produce(current => {
        for (const form of forms) {
          const key = langKey(language, SRS.hashWordSync(form));
          const latest = states[key]?.claimMarkers?.[capability];
          if (!latest || latest.status === undefined) continue;
          const entry = current.wordKnowledge[key] ?? (current.wordKnowledge[key] = {
            word: form, language, ease: SRS.MIN_EASE, lastSeen: now, timesSeen: 0, timesHovered: 0,
          });
          const prior = entry.access?.[capability];
          entry.access = { ...entry.access, [capability]: {
            ...(prior ?? { status: 'unknown', ease: SRS.MIN_EASE, source: 'Manual', lastStatusChange: now, hasEvidence: false }),
            claim: latest.status, claimAt: latest.t, updatedAt: latest.t,
          } };
        }
      }));
      saveFlashcards();
      return true;
    } catch (error) {
      log.warn('access claim write failed:', error);
      return false;
    }
  };

  /**
   * Withdraw an access claim ("Clear override"): deletes record.claim/claimAt
   * on every addressed form and appends a clearing claim event (toStatus
   * absent) so projections replay back to the evidence classification.
   */
  const clearAccessClaim = async (word: string, capability: CapabilityKey, language = settings.language): Promise<boolean> => {
    await knowledgeInitialization;
    const lang = language;
    const forms = isSurfaceScopedCapability(capability, languageDataFor(language)) ? [word] : getWordFormsForLanguage(word, lang);
    const now = Date.now();
    const aspect = legacyAspectFor(capability);
    const claimEvents: Record<string, KnowledgeEvent[]> = {};
    for (const form of forms) {
      const lk = langKey(lang, SRS.hashWordSync(form));
      if (store.wordKnowledge[lk]?.access?.[capability]?.claim === undefined) continue;
      claimEvents[lk] = [{
        t: now, kind: 'claim', source: 'manual', presentedSurface: form,
        ...(aspect !== undefined ? { aspect } : {}),
        targetRef: { kind: 'surface', id: surfaceEntityId(lang, SRS.hashWordSync(form)), capability },
      }];
    }
    if (Object.keys(claimEvents).length === 0) return true;
    // The displayed claim changes only after the journal accepts its withdrawal.
    try {
      if (!await appendEventsIdempotentAcknowledged(claimEvents)) throw new Error('Claim withdrawal was refused');
      const states = await getKnowledgeStates(Object.keys(claimEvents));
      materializeCapabilityStates(forms.map(form => ({ key: langKey(lang, SRS.hashWordSync(form)), word: form, language: lang })), states);
      saveFlashcards();
      return true;
    } catch (error) {
      log.warn('access claim clear failed:', error);
      return false;
    }
  };

  /** Prepare one learner-owned claim through the same acknowledged write boundary. */
  const prepareSelfAssessment = (word: string, capability: CapabilityKey, quality: AttemptQuality, options: AttemptOptions) => {
    const language = options.language ?? settings.language;
    const attemptId = options.attemptId ?? nextAttemptId();
    const now = Date.now();
    const status: WordStatus = quality === 'fluent' ? 'known' : quality === 'missed' ? 'unknown' : 'learning';
    const forms = isSurfaceScopedCapability(capability, languageDataFor(language)) ? [word] : getWordFormsForLanguage(word, language);
    const materializedKeys = forms.map(form => langKey(language, SRS.hashWordSync(form)));
    const aspect = legacyAspectFor(capability);
    const storageWord = isSurfaceScopedCapability(capability, languageDataFor(language)) ? word : getPrimaryWordFormForLanguage(word, language);
    const value: KnowledgeEvent = { t: now, kind: 'claim', source: 'manual', quality, attemptId,
      ...(aspect !== undefined ? { aspect } : {}), toStatus: status, presentedSurface: word,
      targetRef: { kind: 'surface', id: surfaceEntityId(language, SRS.hashWordSync(word)), capability },
    };
    return { attemptId, materializedKeys, event: { key: langKey(language, SRS.hashWordSync(storageWord)), value },
      applyMaterialized: (target: RatingStore, patch?: StorePatchRecorder) => {
        forms.forEach((form, index) => {
          const key = materializedKeys[index];
          const entry = target.wordKnowledge[key] ?? (target.wordKnowledge[key] = {
            word: form, language, ease: SRS.MIN_EASE, lastSeen: now, timesSeen: 0, timesHovered: 0,
          });
          if (capability === 'sense-recognition') {
            entry.claim = status;
            entry.claimAt = now;
          } else {
            const prior = entry.access?.[capability];
            entry.access = { ...entry.access, [capability]: {
              ...(prior ?? { status: 'unknown', ease: SRS.MIN_EASE, source: 'Manual', lastStatusChange: now, hasEvidence: false }),
              claim: status, claimAt: now, updatedAt: now,
            } };
          }
          patch?.set(['wordKnowledge', key], entry);
        });
      },
    };
  };

  /** Prepare one canonical observation without changing the local projection. */
  const prepareAttempt = (
    word: string,
    capability: CapabilityKey,
    quality: AttemptQuality,
    options?: AttemptOptions,
  ): { attemptId: AttemptId; event?: { key: string; value: KnowledgeEvent }; materializedKeys?: readonly string[]; applyMaterialized?: (target: RatingStore, patch?: StorePatchRecorder) => void } => {
    const language = options?.language ?? settings.language;
    const attemptId = options?.attemptId ?? nextAttemptId();
    // Scaffold-aware evidence invariant: when the caller reports the actual
    // presentation state and a scaffold SUPPLIED this access (furigana shown,
    // translation visible, prosody colored, audio played), the rating is cued
    // recognition — not unassisted recall — so no evidence and no access-state
    // write may be fabricated from it. The access stays unmeasured. Absent
    // scaffolds (writer did not know) keeps the legacy measurable default.
    if (options?.scaffolds && !isAccessMeasurable(capability, options.scaffolds)) {
      return { attemptId };
    }
    const before = getAccessStatusSync(word, capability, comprehensiveDeps(language));
    const status: WordStatus = quality === 'fluent' ? 'known' : quality === 'missed' ? 'unknown' : 'learning';
    const anchor = (quality === 'fluent' ? settings.easeThresholdKnown
      : quality === 'missed' ? settings.easeThresholdUnknown : settings.easeThresholdLearning) + settings.manualStatusEaseBuffer;
    const ease = quality === 'fluent' ? Math.max(before.ease, anchor) : anchor;
    const now = Date.now();
    const forms = capability === 'sense-recognition'
      ? getWordFormsForLanguage(word, language)
      : isSurfaceScopedCapability(capability, languageDataFor(language)) ? [word] : getWordFormsForLanguage(word, language);
    const materializedKeys = forms.map(form => langKey(language, SRS.hashWordSync(form)));
    const applyMaterialized = (target: RatingStore, patch?: StorePatchRecorder) => {
      for (let index = 0; index < forms.length; index++) {
        const form = forms[index];
        const key = materializedKeys[index];
        const entry = target.wordKnowledge[key] ?? (target.wordKnowledge[key] = {
          word: form, language, ease: SRS.MIN_EASE, lastSeen: now, timesSeen: 0, timesHovered: 0,
        });
        if (capability === 'sense-recognition') {
          if (entry.ease !== ease) entry.lastStatusChange = now;
          entry.ease = ease;
          entry.lastSeen = now;
          entry.hasActiveEvidence = true;
          entry.lastEvidenceSource = 'manual';
        } else {
          entry.access = { ...entry.access, [capability]: {
            ...entry.access?.[capability], status, ease, source: 'Manual', lastStatusChange: now, updatedAt: now, hasEvidence: true,
          } };
        }
        patch?.set(['wordKnowledge', key], entry);
      }
    };

    // One observation event per attempt — quality/method/latency provenance
    // for future calibration. fromStatus/toStatus/easeAfter keep
    // replay/analytics consistent with the underlying writers' transition
    // events. Addressing: targetRef.capability is canonical; the legacy
    // aspect field stays written only where the mapping is lossless.
    const storageWord = isSurfaceScopedCapability(capability, languageDataFor(language)) ? word : getPrimaryWordFormForLanguage(word, language);
    const observationAspect = legacyAspectFor(capability);
    const observation: KnowledgeEvent = {
      t: now,
      kind: 'rating',
      source: 'manual',
      ...(observationAspect !== undefined ? { aspect: observationAspect } : {}),
      quality,
      attemptId,
      targetRef: { kind: 'surface', id: surfaceEntityId(language, SRS.hashWordSync(word)), capability },
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
      ...(options?.timing ? {
        latencyMs: options.timing.wallLatencyMs,
        activeLatencyMs: options.timing.activeLatencyMs,
        interruptionCount: options.timing.interruptionCount,
        interrupted: options.timing.interrupted,
        stalled: options.timing.stalled,
      } : {}),
      ...(options?.origin ? { origin: options.origin } : {}),
      fromStatus: before.status,
      toStatus: status,
      easeAfter: ease,
    };
    return { attemptId, event: { key: langKey(language, SRS.hashWordSync(storageWord)), value: observation }, materializedKeys, applyMaterialized };
  };

  const submitRating = async (
    word: string,
    observations: readonly AttemptObservation[],
    options?: RatingSubmissionOptions,
  ): Promise<{ attemptId: AttemptId; completed: boolean }> => {
    if (ratingCommandInFlight) throw new Error('A rating command is already being persisted');
    if (libraryLoadError()) throw new Error('The saved library must be loaded before a response can be saved');
    if (ratingPersistenceState() === 'failed') throw new Error('Pending ratings need persistence retry');
    ratingCommandInFlight = true;
    try {
      await knowledgeInitialization;
      const attemptId = options?.attemptId ?? nextAttemptId();
      const admitted = admittedRatingCommands.get(attemptId);
      if (admitted) {
        if (word !== admitted.word || options?.scheduler?.cardId !== admitted.options.scheduler?.cardId) {
          throw new Error('An admitted rating attempt cannot be rebound to another encounter');
        }
        observations = admitted.observations;
        options = admitted.options;
      } else if (admittedRatingCommands.size >= 16) {
        // Never evict unresolved assistance into an unassisted retry.
        throw new Error('Unresolved rating commands need retry before admitting another encounter');
      }
      if (options?.selfAssessment && options.scheduler) throw new Error('A self-assessment cannot advance a review schedule');
      if (options?.selfAssessment && options.decision) throw new Error('A learner claim cannot be recorded as a task outcome');
      let scheduler = options?.scheduler;
      const card = scheduler ? store.flashcards[scheduler.cardId] : undefined;
      if (scheduler && !card) throw new Error(`Flashcard ${scheduler.cardId} no longer exists`);
      if (!admitted && card) {
        // Initialization can yield to a peer edit. Bind the first admission
        // to the captured question, just as retries remain bound below.
        if (word !== card.content.front) throw new Error('The card no longer presents the captured prompt');
        if (card.language && options?.language && options.language !== card.language) {
          throw new Error('The card no longer belongs to the captured language');
        }
      }
      if (admitted && card) {
        if (card.language && card.language !== admitted.options.language) {
          throw new Error('The card no longer belongs to the admitted language');
        }
        if (card.content.front !== admitted.cardFront) {
          throw new Error('The card no longer presents the admitted prompt');
        }
      }
      const language = admitted?.options.language || card?.language || options?.language || settings.language;
      options = { ...options, language };
      if (!admitted && !options.selfAssessment && (isWordIgnoredSync(word, language)
        || (card && isWordIgnoredSync(card.content.front, language)))) {
        throw new Error('This target is excluded from study');
      }
      const restored = scheduler ? store.meta.reviewPresentations?.[language] : undefined;
      const presentationId = admitted ? admitted.presentationId
        : restored?.cardId === scheduler?.cardId ? restored?.id : undefined;
      if (!admitted && restored && scheduler && restored.cardId === scheduler.cardId) {
        // Every review surface inherits the restored encounter's assistance.
        // Caller flags cannot erase an already admitted cue, and consumption
        // waits for the same acknowledged scheduler transaction.
        const scaffolds = { ...options?.scaffolds };
        for (const [key, value] of Object.entries(restored.scaffolds ?? {})) {
          if (value === true) scaffolds[key] = true;
        }
        options = { ...options, language, scaffolds, persistence: 'immediate' };
      }
      if (!admitted) {
        const envelope = JSON.parse(JSON.stringify({ word, observations, options, presentationId, cardFront: card?.content.front })) as {
          word: string; observations: readonly AttemptObservation[]; options: RatingSubmissionOptions; presentationId?: string; cardFront?: string;
        };
        admittedRatingCommands.set(attemptId, envelope);
        observations = envelope.observations;
        options = envelope.options;
      }
      scheduler = options.scheduler;
      const prepared = observations.map(({ capability, quality, method }) =>
        options?.selfAssessment
          ? prepareSelfAssessment(word, capability, quality, { ...options, attemptId })
          : prepareAttempt(word, capability, quality, { ...options, method, attemptId }));
      const __t0 = performance.now();
      const __rows: RatingTraceMark[] = [];
      const __mark = (label: string): void => { __rows.push({ label, ms: performance.now() - __t0 }); };
      const paths: string[][] = [
        ['rev'], ['meta'],
        ...prepared.flatMap(entry => (entry.materializedKeys ?? []).map(key => ['wordKnowledge', key])),
      ];
      if (scheduler && card) {
        const language = card.language || options?.language || settings.language;
        const key = langKey(language, SRS.hashWordSync(getPrimaryWordFormForLanguage(card.content.front, language)));
        paths.push(['flashcards', card.id], ['wordKnowledge', key], ['wordStatsMap', key], ['dailyStats', SRS.getTodayDateString(newDayHour()), language]);
      }
      // Private, sparse pre/post images contain only the entries this command
      // reads or writes. The library's unrelated cards and knowledge stay out.
      const commandBase = snapshotStorePaths(unwrap(store) as unknown as Record<string, unknown>, paths) as RatingStore;
      const candidate = cloneFlashcardStore(commandBase);
      candidate.flashcards ??= {};
      candidate.wordKnowledge ??= {};
      candidate.dailyStats ??= {};
      // The command declares the entries it writes as it writes them. That
      // declared set replaces a structural diff of the two clones, which had to
      // walk every card in the collection twice per rating.
      const patchRecorder = storePatchRecorder(commandBase as unknown as Record<string, unknown>);
      __mark('snapshot');
      for (const entry of prepared) entry.applyMaterialized?.(candidate, patchRecorder);

      const eventsByKey: KnowledgeEventLog = {};
      if (options?.decision) {
        const measured = prepared.flatMap(entry => entry.event ? [entry.event] : []);
        const attributed = applyLearningDecision(measured.map(entry => entry.value), options.decision);
        measured.forEach((entry, index) => { entry.value = attributed[index]; });
      }
      for (const entry of prepared) {
        if (!entry.event) continue;
        // An authored card can address an unmapped surface without claiming
        // that a dictionary node exists. Preserve the producing card identity
        // alongside its exact presented surface and explicit origin.
        if (scheduler) entry.event.value.schedulerCardId = scheduler.cardId;
        (eventsByKey[entry.event.key] ??= []).push(entry.event.value);
      }

      let schedulerResult: ReturnType<typeof applySchedulerRating> | undefined;
      if (scheduler) {
        schedulerResult = applySchedulerRating(candidate, queue(), scheduler, attemptId, options ?? {}, observations.length > 0, patchRecorder, presentationId);
        const cardLanguage = card!.language || options?.language || settings.language;
        const reviewKey = langKey(
          cardLanguage,
          SRS.hashWordSync(getPrimaryWordFormForLanguage(card!.content.front, cardLanguage)),
        );
        (eventsByKey[reviewKey] ??= []).push(schedulerResult.event);
      }

      __mark('prepare');
      const background = options?.persistence === 'background' && isElectron() && schedulerResult !== undefined;
      const atomicScheduler = !background && isElectron() && schedulerResult !== undefined;
      if (!atomicScheduler && !background && Object.keys(eventsByKey).length > 0 && !await appendEventsIdempotentAcknowledged(eventsByKey)) {
        throw new Error('rating journal append was refused');
      }
      __mark('journal');

      if (options?.selfAssessment) {
        // An acknowledged retry may be a journal no-op. Materialize the latest
        // durable claim, including a later withdrawal, rather than the retry's
        // newly prepared timestamp. Preserve the pre-existing observations.
        const states = await getKnowledgeStates(Object.keys(eventsByKey));
        for (const entry of prepared) {
          if (!entry.event) continue;
          const capability = entry.event.value.targetRef!.capability!;
          const projected = states[entry.event.key]?.capabilities?.[capability];
          for (const key of entry.materializedKeys ?? []) {
            const record = candidate.wordKnowledge[key];
            if (!record) continue;
            const claimTarget = capability === 'sense-recognition' ? record : record.access?.[capability];
            if (!claimTarget) continue;
            if (projected?.claim !== undefined) {
              claimTarget.claim = projected.claim;
              claimTarget.claimAt = projected.claimAt;
            } else {
              delete claimTarget.claim;
              delete claimTarget.claimAt;
              if (capability !== 'sense-recognition' && projected === undefined) delete record.access?.[capability];
              if (record.ease <= SRS.MIN_EASE && record.timesSeen === 0 && record.timesHovered === 0
                && !record.hasActiveEvidence && record.claim === undefined && Object.keys(record.access ?? {}).length === 0) {
                delete candidate.wordKnowledge[key];
                patchRecorder.remove(['wordKnowledge', key]);
                continue;
              }
            }
            patchRecorder.set(['wordKnowledge', key], record);
          }
        }
        if (!await saveFlashcardsImmediate(undefined, undefined, {
          base: commandBase, patch: patchRecorder.build(commandBase.rev ?? 0),
        })) throw new Error('Self-assessment projection persistence was refused');
      } else if (schedulerResult) {
        // Persistence applies the declared entries to its current snapshot.
        if (atomicScheduler) {
          const envelope = admittedRatingCommands.get(attemptId)!;
          envelope.schedulerOutcome ??= JSON.parse(JSON.stringify({
            undo: schedulerResult.undo, completed: schedulerResult.completed, updated: schedulerResult.updated,
          })) as NonNullable<typeof envelope.schedulerOutcome>;
          // Recovery may hydrate this response before its original caller gets
          // an ACK. Retry must keep the admitted Undo, never the rated pre-image.
          schedulerResult = { ...schedulerResult, ...envelope.schedulerOutcome };
          envelope.command ??= JSON.parse(JSON.stringify({
            attemptId, decisionId: options?.decision?.id, events: eventsByKey, patch: patchRecorder.build(commandBase.rev ?? 0),
            ...(options?.decision ? { presentation: { cardId: scheduler!.cardId, language, surface: word,
              ...(options.decision.selected.presentation?.contentVersion !== undefined
                ? { contentVersion: SRS.hashWordSync(JSON.stringify(card!.content)) } : {}) } } : {}),
            guardCardIds: scheduler ? [scheduler.cardId] : [],
            counterDeltas: ratingCounterDeltas(patchRecorder.build(commandBase.rev ?? 0)),
          })) as FlashcardRatingCommand;
          let commit: FlashcardRatingCommit;
          try {
            commit = await getBridge().flashcards.commitFlashcardRating(envelope.command);
          } catch (error) {
            throw new Error(`rating scheduler persistence was refused: ${error instanceof Error ? error.message : String(error)}`);
          }
          handleRatingCommit(commit);
          try {
            broadcastChannel?.postMessage({ type: 'patch', patch: commit.patch, rev: commit.rev });
          } catch (error) {
            log.warn('Failed to notify peers about an acknowledged rating:', error);
          }
        } else if (!background && !await saveFlashcardsImmediate(undefined, undefined, {
          base: commandBase,
          guardCardIds: scheduler ? [scheduler.cardId] : undefined,
          patch: patchRecorder.build(commandBase.rev ?? 0),
        })) {
          throw new Error('scheduler persistence was refused');
        }
        __mark('storeWrite');
        const schedulerLanguage = card!.language || options?.language || settings.language;
        const statsKey = langKey(schedulerLanguage, SRS.hashWordSync(getPrimaryWordFormForLanguage(card!.content.front, schedulerLanguage)));
        batch(() => {
          if (background) setStore(produce(current => {
            applyStorePatchInPlace(current as unknown as Record<string, unknown>, patchRecorder.build(commandBase.rev ?? 0));
          }));
          refreshQueue();
          if (ratingTraceOn()) __rows.push({ label: 'refreshQueue', ms: performance.now() - __t0 });
          setUndoStack((previous) => pushUndo(previous, schedulerResult!.undo));
          if (background) {
            recalculateWordStats(statsKey);
            patchRecorder.set(['wordStatsMap', statsKey], unwrap(store.wordStatsMap[statsKey]));
            const patch = patchRecorder.build(commandBase.rev ?? 0);
            sendBackgroundRating({ attemptId, events: eventsByKey, patch, counterDeltas: ratingCounterDeltas(patch) });
          }
        });

        const threshold = settings.leechThreshold ?? DEFAULT_SETTINGS.leechThreshold;
        if (threshold > 0 && schedulerResult.updated.lapses >= threshold && schedulerResult.updated.lapses % threshold === 0) {
          showToast({
            variant: 'warning',
            title: t('mlearn.Flashcards.Leech.Title'),
            message: t('mlearn.Flashcards.Leech.Message', { word: card!.content.front, count: String(schedulerResult.updated.lapses) }),
            duration: 8000,
          });
        }
        if (!background) recalculateWordStats(statsKey);
        __mark('wordStats');
      } else if (Object.keys(eventsByKey).length > 0) {
        setStore(produce((current) => {
          applyStorePatchInPlace(current as unknown as Record<string, unknown>, patchRecorder.build(commandBase.rev ?? 0));
        }));
        saveFlashcards();
      }
      if (ratingTraceOn()) __rows.push({ label: 'rest', ms: performance.now() - __t0 });
      if (ratingTraceOn()) emitRatingTrace(__rows, performance.now() - __t0);
      admittedRatingCommands.delete(attemptId);
      return { attemptId, completed: schedulerResult?.completed ?? true };
    } finally {
      ratingCommandInFlight = false;
      drainPendingRecovery();
    }
  };

  /**
   * Where a word's attempts live in the journal.
   *
   * A word is stored under one key per form it can appear as, so a retraction
   * has to name all of them or the attempt stays counted under the forms the
   * learner will actually meet it by. Stated once here so the word surfaces
   * and the pre-target records that predate routing both resolve identically.
   */
  const wordRetractionTarget = (word: string, language: string): RetractionTarget => ({
    keys: [...new Set([word, ...getWordFormsForLanguage(word, language)])]
      .map((form) => langKey(language, SRS.hashWordSync(form))),
    replay: { kind: 'word', word, language },
  });

  /**
   * Undo bookkeeping: append a retraction tombstone for each attemptId to every
   * form-family key of the word. Projections drop retracted events via
   * stripRetractions; the raw log stays append-only.
   */
  const appendRetractions = async (word: string, language: string, attemptIds: readonly AttemptId[]): Promise<boolean> => {
    if (attemptIds.length === 0) return true;
    const now = Date.now();
    const eventsByKey: KnowledgeEventLog = {};
    for (const form of new Set([word, ...getWordFormsForLanguage(word, language)])) {
      // Tombstones carry no epistemic address: routing is attemptId-only, so
      // no aspect/capability lie is needed (projection readers skip
      // address-less events for capability routing).
      eventsByKey[langKey(language, SRS.hashWordSync(form))] = attemptIds.map((retracts) => ({
        t: now, kind: 'retraction', source: 'manual', retracts,
      }));
    }
    return appendEventsIdempotentAcknowledged(eventsByKey);
  };

  const retractionReplays = new Map<string, (descriptor: RetractionReplayDescriptor) => Promise<void>>();
  const registerRetractionReplay = (
    kind: string,
    replay: (descriptor: RetractionReplayDescriptor) => Promise<void>,
  ): (() => void) => {
    retractionReplays.set(kind, replay);
    return () => {
      if (retractionReplays.get(kind) === replay) retractionReplays.delete(kind);
    };
  };
  // Adapters for existing durable descriptors; packages can register other kinds.
  registerRetractionReplay('word', async ({ word, language }) => {
    if (typeof word !== 'string' || typeof language !== 'string') throw new Error('Invalid word replay descriptor');
    await recomputeWordKnowledgeFromEvidence(word, language);
  });
  registerRetractionReplay('grammar', async ({ language, patterns }) => {
    if (typeof language !== 'string' || !Array.isArray(patterns) || !patterns.every(pattern => typeof pattern === 'string')) {
      throw new Error('Invalid grammar replay descriptor');
    }
    await materializeGrammarKnowledge(language, patterns.map(pattern => ({ pattern })));
  });

  /**
   * The routing-aware half of a retraction: tombstone the keys the attempt was
   * actually written to, then replay the projection those keys feed.
   *
   * The replay is what makes an Undo visible. Appending the tombstone only
   * changes the journal; the materialised projection still counts the attempt
   * until something re-reads it, so without the replay the learner watches
   * their rating stand while the evidence behind it is gone.
   */
  const retractAttempts = async (target: RetractionTarget, attemptIds: readonly AttemptId[]): Promise<boolean> => {
    if (attemptIds.length === 0) return true;
    // A target with no keys cannot be routed anywhere, and reporting success
    // would be the silent-no-op this exists to prevent.
    if (target.keys.length === 0) return false;
    const replay = retractionReplays.get(target.replay.kind);
    if (!replay) return false;
    const now = Date.now();
    // Tombstones carry no epistemic address: routing is attemptId-only, so no
    // aspect/capability lie is needed (projection readers skip address-less
    // events for capability routing).
    const eventsByKey: KnowledgeEventLog = {};
    for (const key of new Set(target.keys)) {
      eventsByKey[key] = attemptIds.map((retracts) => ({
        t: now, kind: 'retraction', source: 'manual', retracts,
      }));
    }
    if (!await appendEventsIdempotentAcknowledged(eventsByKey)) return false;
    await replay(target.replay);
    return true;
  };

  /**
   * ── Durable retraction recovery ──────────────────────────────────
   *
   * Taking a rating back is one operation, not one per study surface: a
   * retraction is appended to the knowledge journal, and the surface that
   * started it puts its own projection back. Both halves can be interrupted —
   * the window reloads, the machine closes — between the decision and its
   * completion, and the in-memory undo entry is gone when that happens. The
   * rating the learner tried to take back stays applied, and no surface can
   * take it back again.
   *
   * The record is the promise that this cannot happen. It is written BEFORE
   * the retraction, so a window that disappears mid-undo leaves behind enough
   * to finish the undo without it. This block is the only owner of that
   * lifecycle:
   *
   *     record → append retraction → surface restores its projection → clear
   *
   * Both study surfaces go through here. What legitimately varies is only the
   * projection, and that is supplied by the caller as policy — flashcard
   * review restores a card's scheduling state, word sync restores a position in
   * a word queue. Core never interprets either one.
   */

  /**
   * Writes the decision so it survives the window that made it.
   *
   * Refusing this write is the safe failure: nothing has been retracted yet, so
   * the rating is untouched and the surface can tell the learner their Undo did
   * not happen rather than letting them believe it landed.
   */
  const recordPendingRetraction = async (record: PendingRetraction): Promise<boolean> =>
    saveFlashcardsImmediate((target, intent) => {
      const existing = readPendingRetraction(target.pendingRetraction);
      if (existing && existing.attemptId !== record.attemptId) {
        throw new Error('A different Undo is already awaiting recovery');
      }
      const recorded = clonePendingRetraction(record);
      target.pendingRetraction = recorded;
      intent.pendingRetraction = JSON.parse(JSON.stringify(recorded)) as unknown;
    });

  /**
   * Finishes a recorded retraction: appends the journal tombstones, then lets
   * the owning surface restore its projection, then clears the record.
   *
   * The clear happens only after both halves are durable. A refusal anywhere
   * leaves the record in place, so a retry — or the next load — finishes the
   * exact Undo the learner asked for rather than a different one.
   *
   * `restore` is the caller's projection policy. It runs after the retraction
   * is durable because that is the half that changes what the learner knows;
   * if the projection cannot be put back, the attempt is still retracted and
   * only the position is left where it is.
   */
  const completePendingRetraction = async (
    record: PendingRetraction,
    build?: (record: PendingRetraction) => Promise<RetractionProjection>,
  ): Promise<RetractionCompletion> => {
    const durable = readPendingRetraction(store.pendingRetraction);
    // Recovery may only finish the retraction it recorded. A record replaced
    // while this one was in flight belongs to a newer Undo, and that one owns
    // the outcome.
    if (!durable || durable.attemptId !== record.attemptId) return 'stale';

    // Routed by the record, not by re-deriving the subject: a tombstone only
    // un-counts an attempt where the reading projection later finds it, so the
    // keys must be the ones the attempt was actually written to. Records
    // written before targets existed fall back to the word-form routing they
    // were recorded under rather than being stranded mid-undo.
    const target: RetractionTarget = durable.target ?? wordRetractionTarget(durable.word, durable.language);
    if (!await retractAttempts(target, durable.attemptIds as AttemptId[])) {
      return 'retraction-refused';
    }
    // Built only now, after the tombstones are in the journal: a projection
    // that reads the replayed evidence before the retraction would restore
    // state that still counts the attempt being taken back.
    const project = build ? await build(durable) : undefined;
    if (!await saveFlashcardsImmediate((target, intent) => {
      const current = readPendingRetraction(target.pendingRetraction);
      if (!current || current.attemptId !== record.attemptId) {
        throw new Error('The pending Undo changed before it could be completed');
      }
      // The projection is applied in the same write that clears the record, so
      // an Undo is either fully undone or still recorded — a surface can never
      // come back to find its projection restored but the Undo still pending.
      void project?.(current, target);
      delete target.pendingRetraction;
      // Name the Undo this write finishes. Without it, "this snapshot has no
      // pending retraction" would be indistinguishable from "this window never
      // saw one", and any other window's ordinary save would be free to delete
      // a record the learner is relying on.
      target.retractionCompleted = record.attemptId;
      // What to replay onto whatever the store holds if this write is refused:
      // the restored projection, the cleared record, and the marker that keeps
      // any other window's save from deleting it again.
      recordStoreDelta(
        intent,
        cloneFlashcardStore(unwrap(store) as FlashcardStore) as unknown as Record<string, unknown>,
        target as unknown as Record<string, unknown>,
      );
    }, project?.authorization)) {
      return 'store-refused';
    }
    return 'completed';
  };

  /**
   * Finishes an Undo a previous window decided but did not complete. Runs on
   * hydration, so a rating the learner already tried to take back is not
   * stranded by a reload.
   *
   * Deferred behind the rating-command guard rather than run alongside it: a
   * retraction rewrites the journal that a rating is appending to, and the
   * surface projection it restores is the one the in-flight rating is moving.
   */
  const recoverPendingRetraction = async (): Promise<void> => {
    const pending = readPendingRetraction(store.pendingRetraction);
    if (!pending) return;
    const build = projectionBuilders.get(pending.surface);
    // Another window may own this session. Keep its recovery record until
    // that owner can restore the projection as well as retract the evidence.
    if (!build) return;
    if (ratingCommandInFlight) {
      pendingRecoveryRequested = true;
      return;
    }
    ratingCommandInFlight = true;
    try {
      await completePendingRetraction(pending, build);
    } catch (error) {
      log.warn(`Interrupted ${pending.surface} Undo recovery failed:`, error);
    } finally {
      ratingCommandInFlight = false;
    }
  };

  /**
   * Drains a recovery that was deferred behind an in-flight rating.
   *
   * Owned here so it is surface-agnostic: the flag is set by any deferred
   * recovery, and draining it must not presume which surface asked.
   */
  const drainPendingRecovery = (): void => {
    if (!pendingRecoveryRequested) return;
    pendingRecoveryRequested = false;
    if (store.pendingRetraction) void recoverPendingRetraction();
  };

  /**
   * Applies the flashcard review projection to the store.
   *
   * This is the review surface's policy inside the shared retraction
   * lifecycle: it puts a card's scheduling state, its per-language meta, and
   * its daily stats back, and drops the capability projections that the
   * retracted attempt had already materialized.
   */
  const applyReviewProjection = (
    target: FlashcardStore,
    record: PendingRetraction,
    states: Record<string, KeyKnowledgeState>,
  ): void => {
    const restore = record.restore as ReviewUndoProjection | null;
    if (!restore?.restoreCard) throw new Error('The pending review Undo has no card to restore');
    target.flashcards[restore.cardId] = { ...restore.restoreCard, content: { ...restore.restoreCard.content } };
    (target.meta.reviewPresentations ??= {})[record.language] = {
      id: record.attemptId, cardId: restore.cardId,
      ...(restore.scaffolds ? { scaffolds: { ...restore.scaffolds } } : {}),
    };
    if (restore.restorePerLanguage) {
      target.meta.perLanguage[record.language] = { ...restore.restorePerLanguage };
    } else {
      delete target.meta.perLanguage[record.language];
    }
    const today = restore.today;
    if (restore.restoreDailyStats) {
      (target.dailyStats[today] ??= {})[record.language] = { ...restore.restoreDailyStats };
    } else if (target.dailyStats[today]) {
      delete target.dailyStats[today][record.language];
      if (Object.keys(target.dailyStats[today]).length === 0) delete target.dailyStats[today];
    }
    // The retracted attempt had already been materialized into these
    // projections, so restoring the card without them would leave the card
    // scheduling an answer that no longer counts.
    const forms = [...new Set([record.word, ...getWordFormsForLanguage(record.word, record.language)])];
    materializeCapabilityStatesInto(target, forms.map((form) => ({
      key: langKey(record.language, SRS.hashWordSync(form)), word: form, language: record.language,
    })), states);
  };

  /**
   * How each study surface restores its own projection, keyed by the `surface`
   * tag on the record.
   *
   * This is the whole extension point. A surface registers a projection when
   * it decides an Undo; recovery on a later load looks the owner up by tag, so
   * finishing an interrupted Undo never needs to know which surface it came
   * from. A surface with no live window simply never registers, and its record
   * is left for a window that does.
   */
  const projectionBuilders = new Map<string, (record: PendingRetraction) => Promise<RetractionProjection>>();

  /** Registers a surface's projection so its interrupted Undos can finish. */
  const registerRetractionProjection = (
    surface: string,
    build: (record: PendingRetraction) => Promise<RetractionProjection>,
  ): (() => void) => {
    projectionBuilders.set(surface, build);
    return () => {
      if (projectionBuilders.get(surface) === build) projectionBuilders.delete(surface);
    };
  };

  /**
   * The review surface's projection.
   *
   * Its knowledge read happens before the write rather than inside it, so the
   * projection itself can stay synchronous and land in the same durable write
   * that clears the record: the card, its meta, its daily stats, and the
   * retracted attempt's projections all commit together, or none of them do.
   */
  const reviewProjection = async (record: PendingRetraction): Promise<RetractionProjection> => {
    const restore = record.restore as ReviewUndoProjection;
    const forms = [...new Set([record.word, ...getWordFormsForLanguage(record.word, record.language)])];
    const states = await getKnowledgeStates(forms.map((form) => langKey(record.language, SRS.hashWordSync(form))));
    const project: RetractionProjection = (current, target) => {
      applyReviewProjection(target, current, states);
    };
    project.authorization = {
      kind: 'undo-review', cardId: restore.cardId, restoredReviews: restore.restoreCard.reviews,
    };
    return project;
  };
  registerRetractionProjection('flashcard-review', reviewProjection);

  /**
   * Finishes a review Undo: the shared retraction lifecycle plus the review
   * surface's projection. The card write and the record clear are one durable
   * step, so an interrupted Undo is either fully undone or still recorded.
   */
  const finishReviewRetraction = async (record: PendingRetraction, entry?: UndoEntry): Promise<string> => {
    if (!await recordPendingRetraction(record)) {
      throw new Error('undo recovery record persistence was refused');
    }
    const outcome = await completePendingRetraction(record, reviewProjection);
    if (outcome === 'retraction-refused') throw new Error('knowledge retraction was refused');
    if (outcome === 'store-refused') throw new Error('undo persistence was refused');
    if (outcome === 'stale') throw new Error('A different Undo is already awaiting recovery');
    if (entry) setUndoStack((previous) => {
      const index = previous.lastIndexOf(entry);
      return index < 0 ? previous : [...previous.slice(0, index), ...previous.slice(index + 1)];
    });
    refreshQueue();
    return (record.restore as ReviewUndoProjection).type;
  };

  /** Builds the review surface's record for a decided Undo. */
  const reviewRetraction = (
    attemptId: string,
    card: Flashcard,
    priorCard: Flashcard,
    priorPerLanguage: PerLanguageMeta | null,
    today: string,
    dailyBefore: DailyStudyStats | null,
    type: string,
    language: string,
    scaffolds?: AttemptScaffolds,
  ): PendingRetraction => ({
    attemptId,
    surface: 'flashcard-review',
    word: card.content.front,
    language,
    attemptIds: [attemptId],
    restore: { cardId: card.id, type, restoreCard: priorCard, restorePerLanguage: priorPerLanguage, today, restoreDailyStats: dailyBefore, ...(scaffolds ? { scaffolds: { ...scaffolds } } : {}) } satisfies ReviewUndoProjection,
  });

  /**
   * Recompute the materialized wordKnowledge entries for a word's family keys
   * from ACTIVE evidence (retractions applied). The evidence journal is the
   * epistemic source of truth; this is the projection refresh, not a writer.
   */
  const recomputeWordKnowledgeFromEvidence = async (word: string, language?: string): Promise<void> => {
    const lang = language ?? settings.language;
    const forms = [...new Set([word, ...getWordFormsForLanguage(word, lang)])];
    const lks = forms.map((form) => langKey(lang, SRS.hashWordSync(form)));
    let states: Record<string, KeyKnowledgeState>;
    try {
      states = await getKnowledgeStates(lks);
    } catch (e) {
      log.warn('projection recompute failed to load states:', e);
      return;
    }
    materializeCapabilityStates(forms.map((form, index) => ({ key: lks[index], word: form, language: lang })), states);
    saveFlashcards();
  };

  const materializeCapabilityStates = (
    seeds: readonly { key: string; word: string; language: string }[],
    states: Record<string, KeyKnowledgeState>,
  ): void => {
    setStore(produce((s) => materializeCapabilityStatesInto(s as FlashcardStore, seeds, states)));
  };

  const materializeCapabilityStatesInto = (
    target: FlashcardStore,
    seeds: readonly { key: string; word: string; language: string }[],
    states: Record<string, KeyKnowledgeState>,
  ): void => {
    for (const { key: lk, word, language } of seeds) {
      const capabilities = states[lk]?.capabilities ?? {};
      const meaning = capabilities['sense-recognition'];
      if (Object.keys(capabilities).length === 0) {
        delete target.wordKnowledge[lk];
        continue;
      }
      const existing = target.wordKnowledge[lk];
      const next: PassiveWordKnowledge = {
        ...existing,
        word: existing?.word ?? word,
        language,
        ease: meaning?.hasEvidence ? meaning.ease : SRS.MIN_EASE,
        timesSeen: meaning?.timesSeen ?? 0,
        timesHovered: meaning?.timesHovered ?? 0,
        lastSeen: meaning?.lastSeen ?? Math.max(...Object.values(capabilities).map((projection) => projection.lastSeen)),
        firstSeen: meaning?.firstSeen,
        lastStatusChange: meaning?.lastStatusChange,
        lastEvidenceSource: meaning?.evidenceSource,
        hasActiveEvidence: meaning?.hasActiveEvidence ?? false,
        access: {},
      };
      if (meaning?.claim !== undefined) {
        next.claim = meaning.claim;
        next.claimAt = meaning.claimAt;
      } else {
        delete next.claim;
        delete next.claimAt;
      }
      for (const [capability, projected] of Object.entries(capabilities)) {
        if (capability === 'sense-recognition') continue;
        const source = projected.evidenceSource;
        const record: NonNullable<PassiveWordKnowledge['access']>[string] = {
          ...existing?.access?.[capability],
          status: evidenceStatusFromEase(projected.ease, {
            known: passiveKnownEaseThreshold(), learning: passiveLearningEaseThreshold(),
          }),
          ease: projected.hasEvidence ? projected.ease : SRS.MIN_EASE,
          hasEvidence: projected.hasEvidence,
          source: source === 'manual' || source === 'srs' || source === 'anki' || source === 'passiveTracking'
            || source === 'knownWordsList' || source === 'ignoredWords' ? aspectSourceToDisplay(source) : 'None',
          lastStatusChange: projected.lastStatusChange ?? projected.lastSeen,
          updatedAt: projected.lastSeen,
          ...(projected.claim !== undefined ? { claim: projected.claim, claimAt: projected.claimAt } : {}),
        };
        if (projected.claim === undefined) {
          delete record.claim;
          delete record.claimAt;
        }
        next.access = { ...next.access, [capability]: record };
      }
      target.wordKnowledge[lk] = next;
    }
  };

  const repairCapabilityProjection = async (): Promise<void> => {
    const upgrading = store.meta.capabilityProjectionVersion !== CAPABILITY_PROJECTION_VERSION;
    const seeds = new Map(Object.entries(store.wordKnowledge).flatMap(([key, entry]) => entry.word ? [[key, {
      key, word: entry.word, language: entry.language ?? key.split(':')[0],
    }] as const] : []));
    const languages = new Set([settings.language, ...[...seeds.values()].map(seed => seed.language),
      ...(languageDataCatalog?.() ?? []).filter(status => status.installed !== false).map(status => status.language)]);
    const replayKeys = new Set(upgrading ? seeds.keys() : []);
    // The journal is authoritative even when a crash missed a cache write at
    // the current schema version. Include journal-only keys, not just cached ones.
    for (const language of languages) {
      for (const key of await queryLanguageKeys(language)) {
        if (!key.startsWith(`${language}:`) || !/^[a-f0-9]{64}$/.test(key.slice(language.length + 1))) continue;
        replayKeys.add(key);

      }
    }
    const missing = [...replayKeys].filter(key => !seeds.has(key));
    for (let offset = 0; offset < missing.length; offset += 256) {
      const keys = new Set(missing.slice(offset, offset + 256));
      for (const event of [...await getEvents([...keys])].reverse()) {
        const encountered = event.presentedSurface;
        if (!encountered) continue;
        for (const language of languages) {
          const forms = [...new Set([encountered, ...getWordFormsForLanguage(encountered, language)])];
          for (const word of forms) {
            const key = langKey(language, SRS.hashWordSync(word));
            if (keys.has(key) && !seeds.has(key)) seeds.set(key, { key, word, language });
          }
        }
      }
    }
    const pending = [...replayKeys].flatMap(key => seeds.has(key) ? [seeds.get(key)!] : []);
    for (let offset = 0; offset < pending.length; offset += 256) {
      const batch = pending.slice(offset, offset + 256);
      const states = await getKnowledgeStates(batch.map(({ key }) => key));
      materializeCapabilityStates(batch, states);
    }
    setStore('meta', 'capabilityProjectionVersion', CAPABILITY_PROJECTION_VERSION);
    if (upgrading || pending.length > 0) saveFlashcards();
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
    // The journal owner folds exact recognition rows beside SQLite; only the
    // small read model crosses IPC, including when other grammar capabilities
    // have very large histories.
    let projections: import('../../shared/knowledge/historyQueries').GrammarProjectionMap;
    try {
      projections = await getBridge().knowledgeEvents.getGrammarProjections(language);
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
    // evidence alone, so patterns are also enumerated from the recognition
    // projection keys — seeds and surviving entries only add presentation
    // hints. Key parsing belongs to the evidence module.
    for (const key of Object.keys(projections)) {
      const pattern = grammarPatternFromEvidenceKey(language, key);
      if (pattern !== null && !levels.has(pattern)) levels.set(pattern, undefined);
    }
    setStore(produce((s) => {
      for (const [pattern, level] of levels) {
        const lk = langKey(language, pattern);
        const projection = projections[grammarEvidenceKey(language, pattern, 'grammar-recognition')];
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
          hasActiveEvidence: projection.hasActiveEvidence,
          // 0 is the level placeholder — a seedless load-time pass may stamp
          // it first; a caller's explicit level must still win.
          level: existing?.level || level || 0,
          language,
        };
      }
    }));
    saveFlashcards();
  };

  // Serialize materializations so a rapid tracker burst lands the latest
  // journal-side fold last.
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
  const seenGrammarEncounterIds = new Set<string>();
  const trackGrammarEncountered = (
    pattern: string,
    levelOrOpts: number | GrammarEncounterOptions = 0,
    language = settings.language,
  ) => {
    const opts = typeof levelOrOpts === 'object' ? levelOrOpts : undefined;
    const level = typeof levelOrOpts === 'number' ? levelOrOpts : 0;
    const encounterKey = opts?.encounterId ? `${language}\0${pattern}\0${opts.encounterId}` : undefined;
    if (encounterKey && seenGrammarEncounterIds.has(encounterKey)) return;
    if (encounterKey) seenGrammarEncounterIds.add(encounterKey);
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
      .catch((e) => {
        if (encounterKey) seenGrammarEncounterIds.delete(encounterKey);
        log.warn('grammar evidence append failed:', e);
      });
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

  // Curriculum grammar probe (grammar-recognize task). Writes ONE active
  // rating event on the grammar-recognition capability key — the same
  // journal writers the anki import and legacy paths use, so replay,
  // materialization, and coverage see identical evidence. Ease moves along
  // the shared grammar anchors: fluent counts as a successful encounter,
  // struggled as an encounter with friction, missed as a failure.
  type GrammarAttemptOptions = { language?: string; level?: number; scaffolds?: AttemptScaffolds; itemRef?: { id: string; version: string; seed?: number }; validationRef?: KnowledgeEvent['validationRef']; taskType?: AttemptTaskType; attemptId?: AttemptId };
  const prepareGrammarAttempt = (
    pattern: string,
    quality: AttemptQuality,
    options?: GrammarAttemptOptions,
  ): { attemptId: AttemptId; language: string; level?: number; events: KnowledgeEventLog } => {
    const language = options?.language ?? settings.language;
    const attemptId = options?.attemptId ?? nextAttemptId();
    // An ACTIVE measurement records its outcome explicitly (easeAfter),
    // like the anki import — it must not inherit the slow exposure-anchor
    // walk that passive encounter rollups use. Missed records a failure
    // delta so the anchor path registers the negative evidence.
    const outcome = quality === 'fluent'
      ? { easeAfter: SRS_EASE.DEFAULT_KNOWN }
      : quality === 'struggled'
        ? { easeAfter: (SRS_EASE.MIN + SRS_EASE.DEFAULT_KNOWN) / 2 }
        : { grammarFailedDelta: 1 };
    return { attemptId, language, level: options?.level, events: {
      [grammarEvidenceKey(language, pattern, 'grammar-recognition')]: [grammarRecognitionEvidence(language, pattern, {
        t: Date.now(),
        kind: 'rating',
        quality,
        attemptId,
        origin: 'grammar-probe',
        taskType: options?.taskType ?? 'grammar-recognize',
        // Presentation provenance: the surface declares what was visible while
        // the learner self-assessed (core contract: translation cues do not
        // invalidate grammar-recognition — SCAFFOLD_INVALIDATES).
        ...(options?.scaffolds ? { scaffolds: options.scaffolds } : {}),
        // Practice-item provenance (R12/G03): the versioned question item that
        // produced this attempt, enabling item-level invalidation later.
        ...(options?.itemRef ? { itemRef: options.itemRef } : {}),
        ...(options?.validationRef ? { validationRef: options.validationRef } : {}),
        ...outcome,
      })],
    } };
  };
  const recordGrammarAttempt = (
    pattern: string,
    quality: AttemptQuality,
    options?: GrammarAttemptOptions,
  ): AttemptId => {
    const prepared = prepareGrammarAttempt(pattern, quality, options);
    appendEvents(prepared.events)
      .then(() => queueGrammarMaterialize(prepared.language, [{ pattern, level: prepared.level }]))
      .catch((e) => log.warn('grammar probe append failed:', e));
    return prepared.attemptId;
  };
  const recordGrammarAttemptAcknowledged = async (
    pattern: string,
    quality: AttemptQuality,
    options?: GrammarAttemptOptions,
  ): Promise<AttemptId> => {
    const prepared = prepareGrammarAttempt(pattern, quality, options);
    if (!await appendEventsIdempotentAcknowledged(prepared.events)) {
      throw new Error('grammar attempt journal append was refused');
    }
    queueGrammarMaterialize(prepared.language, [{ pattern, level: prepared.level }]);
    return prepared.attemptId;
  };

  // Get grammar knowledge entry — serves the replay-materialized cache.
  const getGrammarKnowledge = (pattern: string, language = settings.language): GrammarKnowledgeEntry | undefined => {
    const lk = pattern.includes(':') && store.grammarKnowledge[pattern]
      ? pattern
      : langKey(language, pattern);
    return store.grammarKnowledge[lk];
  };

  /**
   * Item-invalidation bookkeeping (G03): appends the computed tombstones on
   * their grammar keys and re-materializes every affected pattern — the
   * projection replay drops the retracted attempts, unrelated history is
   * never touched (append-only journal).
   */
  const retractGrammarItemAttempts = async (tombstones: KnowledgeEventLog, language: string, patterns: readonly string[]): Promise<void> => {
    if (Object.keys(tombstones).length === 0) return;
    await appendEvents(tombstones);
    await materializeGrammarKnowledge(language, patterns.map((pattern) => ({ pattern })));
  };

  /**
   * Package-update reconcile (G03): the journal is scanned over the
   * language's grammar keys only (item provenance lives there), attempts
   * through items the CURRENT package no longer declares are retracted, and
   * the affected projections re-materialize. Idempotent: already-retracted
   * attempts are skipped, so re-runs append nothing.
   */
  const reconcileGrammarItems = async (language: string, declaredItems: ReadonlyMap<string, DeclaredItemState>): Promise<number> => {
    try {
      const keys = await queryLanguageKeys(language, 'grammar:');
      if (keys.length === 0) return 0;
      // Per-key log (not the flattened service view): tombstones must land on
      // the exact evidence keys the item attempts were written to.
      const log = await getBridge().knowledgeEvents.queryKnowledgeItemEvents(keys);
      const result = reconcileQuestionItems(log, declaredItems);
      await retractGrammarItemAttempts(result.tombstones, language, [...result.patterns]);
      return result.retiredItemIds.size;
    } catch (error) {
      log.warn('grammar item reconcile failed:', error);
      return 0;
    }
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
        const matchesPackage = key.startsWith(lang + ':') || (!key.includes(':') && (!c.language || c.language === lang));
        return matchesPackage && !isWordIgnoredSync(c.word, lang);
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
      if (isKnownClaimed(compositeKey) || isWordIgnoredSync(candidate.word, lang)) continue;

      try {
        // One enrichment owner (see wordEnrichment). The dictionary reading wins
        // here, with the tracked candidate reading as the fallback.
        const enriched = await enrichWord({
          word: candidate.word,
          language: lang,
          languageData: languageDataFor(lang),
          settings,
          dictionaryTargetLanguage: dictionaryTargetFor(lang),
        });
        if (!enriched || isWordIgnoredSync(candidate.word, lang)) continue; // Skip words with no translation

        prepared.push({
          compositeKey,
          candidate,
          backText: enriched.back,
          reading: enriched.reading || candidate.reading || '',
          prosody: enriched.prosody,
          definitionArr: enriched.definition,
        });
      } catch (e) {
        log.warn(`Failed to auto-create flashcard for "${candidate.word}":`, e);
      }
    }

    // A preference may change during dictionary enrichment. Never send an
    // excluded target into optional generation or consume its passive record.
    for (let index = prepared.length - 1; index >= 0; index--) {
      if (isWordIgnoredSync(prepared[index].candidate.word, lang)) prepared.splice(index, 1);
    }
    let examples: LLMExampleResult[] = prepared.map(() => ({ sentence: '', meaning: '' }));
    if (useLLM && prepared.length > 0) {
      try {
        examples = await generateExampleSentencesWithLLM(prepared.map(({ candidate, backText }) => ({
          word: candidate.word,
          definition: backText,
          language: lang,
        })));
      } catch (e) {
        log.warn('Failed to generate LLM examples for auto-created flashcards:', e);
      }
    }

    let createdCount = 0;
    for (const [index, preparedCard] of prepared.entries()) {
      const { compositeKey, candidate, backText, reading, prosody, definitionArr } = preparedCard;
      if (isWordIgnoredSync(candidate.word, lang)) continue;
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

        const createdId = await addFlashcard(content, undefined, true, lang);
        if (!createdId) continue;
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
    if (!isRemoteLLMProvider(settings.llmProvider)) {
      const allowed = await requestAccess('llm');
      if (!allowed) return { sentence: '', meaning: '' };
    }

    try {
      return await new Promise((resolve, reject) => {
        const displayLocale = settings.uiLanguage || DEFAULT_SETTINGS.uiLanguage;
        const sourceLanguageData = languageDataFor(language);
        const dictionaryTargetLanguage = (getDictionaryPromptTargetForSettings(settings, language) ?? displayLocale);
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
      if (absorbProviderFailure(error, t, settings.llmProvider)) {
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
      const dictionaryTargetLanguage = (getDictionaryPromptTargetForSettings(settings, job.language) ?? displayLocale);
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

        if (isRemoteLLMProvider(settings.llmProvider) || await requestAccess('llm')) {
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
            if (!absorbProviderFailure(error, t, settings.llmProvider)) throw error;
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
    const dictionaryTargetLanguage = (getDictionaryPromptTargetForSettings(settings, cardLanguage) ?? displayLocale);
    const sourceLang = getLanguagePromptName(sourceLanguageCode, languageDataFor(sourceLanguageCode));
    const targetLang = getLanguagePromptName(dictionaryTargetLanguage, languageDataFor(dictionaryTargetLanguage));

    // Low power gate: prompt before local LLM call
    if (!isRemoteLLMProvider(settings.llmProvider)) {
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
      if (absorbProviderFailure(error, t, settings.llmProvider)) {
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
    if (event.data?.type === 'patch' && event.data.patch && typeof event.data.rev === 'number') {
      const revision = event.data.rev as number;
      const currentRevision = authoritativeStore?.rev ?? store.rev ?? 0;
      if (revision <= currentRevision) return;
      if (!authoritativeStore || revision !== currentRevision + 1) {
        // A peer missed a revision: ask the durable owner for the full state.
        loadFlashcards();
        return;
      }
      const patch = event.data.patch as StorePatch;
      authoritativeStore = copyStoreWithPatch(authoritativeStore, patch);
      authoritativeStore.rev = revision;
      batch(() => {
        setStore(produce(current => {
          applyStorePatchInPlace(current as unknown as Record<string, unknown>, patch);
          overlayPendingRatings(current as FlashcardStore);
          current.rev = revision;
        }));
        refreshQueue();
      });
      return;
    }
    if (event.data?.type === 'update' && event.data.store) {
      const incoming = ensureStoreFields(event.data.store);
      if (typeof incoming.rev === 'number') {
        const currentRevision = authoritativeStore?.rev ?? store.rev ?? 0;
        if (incoming.rev <= currentRevision) return;
        const base = authoritativeStore ?? cloneFlashcardStore(unwrap(store) as FlashcardStore);
        authoritativeStore = cloneFlashcardStore(incoming);
        setStore(produce((current) => {
          applyStoreDelta(
            current as unknown as Record<string, unknown>,
            base as unknown as Record<string, unknown>,
            incoming as unknown as Record<string, unknown>,
          );
          overlayPendingRatings(current as FlashcardStore);
        }));
        refreshQueue();
        if (incoming.pendingRetraction) void recoverPendingRetraction();
        return;
      }
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
          // R21: the SAME teaching policy owns the promotion order — the
          // manual "more seen first" sort was the labelled baseline heuristic
          // and is now expressed as media-fit scores (timesSeen, saturating)
          // in the policy's weighted pick, with canonical journal statuses.
          // `count` is passive recurrence in the learner's selected content
          // (coverage); the capture lookup itself is assisted access and is
          // NOT inflated here (timesHovered stays 0).
          const canonicalStatus = (word: string, language: string): 'unmeasured' | 'learning' | 'known' => {
            const status = getComprehensiveWordStatusSync(word, language);
            return status === 'known' ? 'known' : status === 'learning' ? 'learning' : 'unmeasured';
          };
          const pickIds = selectRankedEncounters({
            preset: 'SUGGESTED',
            nowMs: 0,
            suggestedItems: suggestions.map((suggestion) => ({
              key: suggestion.id,
              word: suggestion.word,
              language: suggestion.language,
              status: canonicalStatus(suggestion.word, suggestion.language),
              // Passive recurrence since capture (coverage heuristic) rides
              // the SAME candidate — no duplicate word entries. The stored
              // current-content exposure count is the better coverage
              // measure; capture refreshes are the honest fallback.
              timesSeen: Math.max(suggestion.count, suggestion.mediaRecurrence ?? 0),
              // Capture provenance (R20): which media snapshot produced the
              // suggestion, so its trace row can be audited back to content.
              ...(suggestion.source !== undefined ? { source: suggestion.source } : {}),
              ...(suggestion.sourceMediaHash !== undefined ? { sourceMediaHash: suggestion.sourceMediaHash } : {}),
            })),
          }, remaining).map((decision) => decision.candidate.key);
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
        // Rev probe: the main process skips the multi-MB store ship entirely
        // when this window already holds the current revision.
        getBridge().flashcards.getFlashcards(store.rev);
      }
    }
  };

  const unregisterAnkiReviewSync = registerAnkiReviewSync(async (language, statuses) => {
    if (!settings.use_anki) return false;
    const [{ importAnkiReviewHistory }, { ankiRequest }] = await Promise.all([
      import('../services/ankiReviewImport'), import('../hooks/useAnki'),
    ]);
    const proxy = settings.ankiUrl || `http://127.0.0.1:${PROXY_SERVER_PORT}/api/fwd-to-anki`;
    const result = await importAnkiReviewHistory(language, {
      statuses,
      fetchReviews: (cards) => ankiRequest(proxy, 'getReviewsOfCards', { cards }),
      fetchCards: (cards) => ankiRequest(proxy, 'cardsInfo', { cards }),
      fields: {
        expression: settings.anki_field_expression ?? DEFAULT_SETTINGS.anki_field_expression,
        reading: settings.anki_field_reading ?? DEFAULT_SETTINGS.anki_field_reading,
        meaning: settings.anki_field_meaning ?? DEFAULT_SETTINGS.anki_field_meaning,
      },
    });
    // Keep projection refresh bounded. A large Anki backfill can touch thousands
    // of words; fanning every getKnowledgeStates IPC out at once can make the
    // Electron main process serialize thousands of replies concurrently.
    for (const word of result.importedWords) {
      await recomputeWordKnowledgeFromEvidence(word, language);
    }
    return;
  });
  onCleanup(unregisterAnkiReviewSync);

  onMount(() => {
    if (settings.use_anki) void refreshAnkiWordsCache({ language: settings.language, languageData: languageDataFor(settings.language) });
    if (typeof BroadcastChannel !== 'undefined') {
      broadcastChannel = new BroadcastChannel(FLASHCARD_CHANNEL);
      broadcastChannel.onmessage = handleBroadcast;
    }

    // Register all IPC listeners ONCE and store their cleanup functions
    if (isElectron()) {
      const bridge = getBridge();
      // Flashcards loaded listener (single registration — reused by loadFlashcards and visibility sync)
      ipcCleanups.push(bridge.flashcards.onFlashcards(handleFlashcardsLoaded));
      ipcCleanups.push(bridge.flashcards.onFlashcardLoadError(handleLibraryLoadError));
      ipcCleanups.push(bridge.flashcards.onFlashcardRatingsCommitted(handleRatingCommit));

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
              }).catch((e) => log.error(`[Tethered] Could not apply created card "${word}":`, e));
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
    // Coalesced passive-seen rows use the same event-driven flush points
    // (no timers): apply batched knowledge before the window hides or dies.
    const flushSeenOnHide = () => {
      if (document.visibilityState === 'hidden') flushPendingSeen();
    };
    const flushSeenOnUnload = () => {
      flushPendingSeen();
      if (pendingRatings.size > 0) void flushBackgroundRatings().catch(error => log.error('Rating flush on unload failed:', error));
    };
    document.addEventListener('visibilitychange', flushSeenOnHide);
    window.addEventListener('beforeunload', flushSeenOnUnload);
    ipcCleanups.push(() => {
      document.removeEventListener('visibilitychange', flushSeenOnHide);
      window.removeEventListener('beforeunload', flushSeenOnUnload);
    });

    loadFlashcards();
    startSession();
  });

  onCleanup(() => {
    // Call off a rebase before anything else: the flush below can itself be
    // refused and rebase, and a window that is going away must not come back
    // for a second write.
    disposed = true;
    authorityRequest = null;
    // Apply coalesced passive-seen rows FIRST so the immediate save below
    // (and the debounced save it flushes) includes them.
    flushPendingSeen();
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
    broadcastChannel = null;
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  });

  const value: FlashcardContextValue = {
    store,
    isLoading,
    libraryLoadError,
    retryLibraryLoad: loadFlashcards,
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
    getCurrentCard,
    getPreviewDueDates,
    getAllCards,
    getStudyableCards: studyableCards,
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
    saveReviewPresentation,
    pushUndoState,
    undoLastAction,
    canUndo,
    trackWordAppearance,
    ignoreWordForLanguage,
    unignoreWordForLanguage,
    captureSuggestedFlashcard,
    getSuggestedFlashcardsSync,
    setAccessClaim,
    clearAccessClaim,
    cleanupKnownSuggestions,
    garbageCollectSuggestedFlashcards,
    promoteSuggestedFlashcards,
    addLevelStudyFlashcards,
    removeSuggestedFlashcard,
    removeSuggestedFlashcards,
    trackWordSeen,
    flushPendingWordSeen: flushPendingSeen,
    trackWordHovered,
    cancelWordHover,
    getWordKnowledge,
    getAccessStatus,
    isWordKnown,
    isWordKnownByText,
    isWordLearning,
    isWordLearningByText,
    getComprehensiveWordStatusSync,
    getComprehensiveWordStatusWithSourceSync,
    isWordKnownComprehensiveSync,
    isWordSettledSync,
    isWordKnownWhenWrittenSync,
    appendRetractions,
    retractAttempts,
    registerRetractionReplay,
    wordRetractionTarget,
    recordPendingRetraction,
    completePendingRetraction,
    recoverPendingRetraction,
    registerRetractionProjection,
    recomputeWordKnowledgeFromEvidence,
    setWordClaim,
    submitRating,
    ratingPersistenceState,
    retryRatingPersistence: flushBackgroundRatings,
    trackGrammarEncountered,
    trackGrammarFailed,
    recordGrammarAttempt,
    recordGrammarAttemptAcknowledged,
    getGrammarKnowledge,
    retractGrammarItemAttempts,
    reconcileGrammarItems,
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
