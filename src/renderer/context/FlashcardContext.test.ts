import { reviewPresentationPatch, type ReviewPresentationWrite } from '../../shared/reviewPresentationWrite';
import { RatingAdmissionRefusal, type FlashcardRatingCommand } from '../../shared/flashcardRating';
import { knowledgeEventIdentity } from '../../shared/knowledge/eventIdentity';
import { projectCapabilities, projectClaimMarkers } from '../../shared/knowledge/capabilityProjection';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FlashcardStore, Flashcard, FlashcardContent, FlashcardMeta, ReviewPresentation, ReviewQueue, Settings, WordStats, PassiveWordKnowledge } from '../../shared/types';
import { DEFAULT_SETTINGS, type FlashcardAudioPreset } from '../../shared/types';
import { selectFlashcardReviewDecision, flashcardReviewPolicyEntry } from '../components/flashcard/flashcardReviewDecision';
import { selectNextEncounter } from '../learning/engine';
import type { AttemptQuality } from '../../shared/constants';
import type { CapabilityKind } from '../../shared/graph/types';
import type { AttemptId, AttemptScaffolds, AttemptTaskType, EventSourceVersions, KnowledgeEvent, KnowledgeEventLog } from '../../shared/knowledgeEvents';
import type { AccessStatusResult } from '../utils/accessKnowledge';
import type { Rating } from '../services/srsAlgorithm';
import * as SRS from '../services/srsAlgorithm';
import { replayKeyProjection, type ReplayProjection } from '../../shared/utils/projectionReplay';
import { GRAMMAR_ENCOUNTER_EASE_BUMP, GRAMMAR_FAIL_EASE_PENALTY, initialGrammarEase } from '../../shared/utils/grammarPolicy';
import { grammarEvidenceKey, grammarPatternFromEvidenceKey, grammarRecognitionEvidence, replayGrammarRecognition } from '../../shared/grammar/evidence';
import type { GrammarProjectionMap } from '../../shared/knowledge/historyQueries';
import { itemContentVersion, retractionEventsForItem, type DeclaredItemState } from '../learning/questionBank';
import { summarizeGrammarCurriculum, classifyGrammarMeasurements } from '../utils/curriculumCoverage';
import { effectiveThresholds } from '../../shared/knowledge/effectiveKnowledge';
import { applyStorePatch, type StorePatch } from '../../shared/utils/storePatch';
import { GrammarCoverage } from '../windows/levelStudy/GrammarCoverage';
import fs from 'fs';
import path from 'path';
import { UNMEASURED_LABEL_KEY, knowledgeStatusLabelKey } from '../components/common/WordStatusPillKnowledge/knowledgeSummary';
import { staleFlashcardRevisionMessage } from '../../shared/flashcardWriteRevision';

// ── IPC callback captures ────────────────────────────────────────────
let flashcardsCb: (store: FlashcardStore | null) => void;
const flashcardsCleanup = vi.fn();
const newDayCleanup = vi.fn();
const migrationCleanup = vi.fn();
const reviewRequestCleanup = vi.fn();
const connectOpenCleanup = vi.fn();
const updatePillsCleanup = vi.fn();
const updateWordAppearanceCleanup = vi.fn();
const updateAttemptCleanup = vi.fn();
const updateCreateCleanup = vi.fn();
const updateLastWatchedCleanup = vi.fn();
const mockIsElectron = vi.hoisted(() => vi.fn(() => true));
const mockStreamChat = vi.hoisted(() => vi.fn());
const mockBackend = vi.hoisted(() => ({
  ping: vi.fn().mockResolvedValue(true),
  translate: vi.fn().mockResolvedValue({ data: [] }),
  getAnkiWordStatuses: vi.fn().mockResolvedValue([]),
}));

// ── Mock bridge ──────────────────────────────────────────────────────
const mockBridge = {
  flashcards: {
    onFlashcards: vi.fn(),
    onFlashcardLoadError: vi.fn((_callback: (message: string) => void) => vi.fn()),
    getFlashcards: vi.fn(),
    saveFlashcards: vi.fn(),
    saveFlashcardPatch: vi.fn(),
    saveReviewPresentation: vi.fn(),
    enqueueFlashcardRating: vi.fn().mockResolvedValue(1),
    commitFlashcardRating: vi.fn(),
    flushFlashcardRatings: vi.fn().mockResolvedValue(undefined),
    onFlashcardRatingsCommitted: vi.fn(() => () => {}),
    onNewDayFlashcards: vi.fn(),
    onFlashcardConnectOpen: vi.fn(),
    onReviewFlashcardRequest: vi.fn(),
    deleteFlashcardVideo: vi.fn().mockResolvedValue(undefined),
    deleteFlashcardImage: vi.fn().mockResolvedValue(undefined),
    deleteFlashcardTts: vi.fn().mockResolvedValue(undefined),
    saveFlashcardImage: vi.fn(),
    saveFlashcardVideo: vi.fn(),
    generateFlashcardTts: vi.fn().mockResolvedValue(null),
  },
  migration: {
    onFlashcardMigrationComplete: vi.fn(),
  },
  crossWindow: {
    onUpdatePills: vi.fn(),
    onUpdateWordAppearance: vi.fn(),
    onUpdateAttemptFlashcardCreation: vi.fn(),
    onUpdateCreateFlashcard: vi.fn(),
    onUpdateLastWatched: vi.fn(),
  },
  kvStore: {
    kvGet: vi.fn().mockResolvedValue(null),
    kvSet: vi.fn().mockResolvedValue(undefined),
    kvRemove: vi.fn().mockResolvedValue(undefined),
    kvGetAll: vi.fn().mockResolvedValue({}),
    kvSetBatch: vi.fn().mockResolvedValue(undefined),
  },
  knowledgeEvents: {
    recordLearningDecision: vi.fn().mockResolvedValue(undefined),
    getRatingUndoHistory: vi.fn().mockResolvedValue([]),
    queryKnowledgeEvents: knowledgeJournal.queryKnowledgeEvents,
    queryKnowledgeItemEvents: knowledgeJournal.queryKnowledgeItemEvents,
    getGrammarProjections: knowledgeJournal.getGrammarProjections,
    getKnowledgeRows: knowledgeJournal.getKnowledgeRows,
    getKnowledgeStates: knowledgeJournal.getKnowledgeStates,
    getKnowledgeArchive: knowledgeJournal.getKnowledgeArchive,
    queryKnowledgeSummaries: knowledgeJournal.queryKnowledgeSummaries,
    queryLanguageKeys: knowledgeJournal.queryLanguageKeys,
    queryAnkiReviewIds: knowledgeJournal.queryAnkiReviewIds,
    queryAnkiReviewIdSets: knowledgeJournal.queryAnkiReviewIdSets,
  },
};

let savedReviewUndos: NonNullable<FlashcardRatingCommand['undo']>[] = [];

/**
 * The main process's flashcard authority: the committed revision, the
 * snapshot `onFlashcards` answers with, and the revision check that refuses
 * any write not carrying the revision it holds.
 *
 * The two halves matter separately. A DELIVERED store is the window's starting
 * state — a store it is rendering when a write is composed. A COMMITTED
 * revision is what the authority will accept next; only an accepted write
 * moves it, which is exactly why a stale-snapshot write disappears without
 * anything retrying it.
 */
let committed: FlashcardStore | null = null;
let revision = 0;
let delivered: FlashcardStore | null = null;

const acceptedSaves: FlashcardStore[] = [];

/**
 * The provider's flashcard-save debounce, restated for the harness.
 *
 * It has to match the provider's own constant: the gap between tests below is
 * sized to outlast a pending debounced write, so a test that waits out this
 * value is waiting out the real timer and not an approximation of it. If the
 * provider's debounce changes, this must change with it.
 */
const SAVE_DEBOUNCE_MS_FOR_TESTS = 300;

/**
 * Seeds the authority and delivers the snapshot to the window.
 *
 * `seed` also opens the window ON the authority's revision. A test that wants
 * the window holding something older says so by delivering that explicitly.
 */
function seed(store: FlashcardStore): void {
  committed = structuredClone(store);
  revision = store.rev ?? 0;
  delivered = structuredClone(store);
  flashcardsCb(committed);
}

/**
 * Hands the window a store the way the main process answers a `getFlashcards`
 * request, without implying the authority moved.
 *
 * The store is delivered as given. A window is normally only ever handed the
 * revision the authority can accept a write from, so a test that has not
 * deliberately shows the window a stale snapshot says so by passing one.
 */
function deliver(store: FlashcardStore | null): void {
  if (store) delivered = structuredClone(store);
  flashcardsCb(store);
}

/**
 * Answers flashcard saves the way the main process does: a write that does not
 * carry the committed revision is refused, and only an accepted write moves
 * the revision on. A refused write changed nothing.
 */
function installStrictSaveRevision(): void {
  mockBridge.flashcards.saveFlashcards.mockImplementation((saved: FlashcardStore) => {
    if ((saved.rev ?? 0) !== revision) {
      return Promise.reject(new Error(staleFlashcardRevisionMessage(revision, saved.rev ?? 0)));
    }
    revision += 1;
    // The authority stamps the store it persists, as flashcardStorage does. A
    // probe answered from a snapshot that has not been stamped would offer the
    // caller a revision the authority has already moved past, and its next
    // write would be refused for a reason that has nothing to do with any race.
    committed = structuredClone(saved);
    committed.rev = revision;
    acceptedSaves.push(structuredClone(committed));
    return Promise.resolve(revision);
  });
}

/**
 * Answers `getFlashcards` probes the way the main process does: with the store
 * it currently holds, or with nothing when the caller already holds that
 * revision.
 *
 * A refused write re-reads the authority before it can be replayed onto it, so
 * a harness that never answers leaves the window waiting on a delivery that is
 * never coming - and every later write serialised behind it. Tests opt in
 * rather than having this installed suite-wide: a probe answered on every call
 * is a delivery injected into tests that never asked for one.
 */
function answerProbesFromAuthority(): void {
  mockBridge.flashcards.getFlashcards.mockImplementation((knownRev?: number) => {
    const answer = knownRev != null && knownRev === revision ? null : committed;
    queueMicrotask(() => {
      if (flashcardsCb) deliver(answer);
    });
  });
}

function setupMockImplementations() {
  mockBridge.flashcards.onFlashcards.mockImplementation((cb: (s: FlashcardStore | null) => void) => {
    flashcardsCb = cb;
    return flashcardsCleanup;
  });
  // The main process answers a `getFlashcards` probe with no delivery at all;
  // a bare `vi.fn()` does that by having no implementation. It is re-stated
  // every test because `answerProbesFromAuthority` installs one, and
  // `vi.clearAllMocks` clears calls without removing implementations. A
  // surviving answerer would answer - and DELIVER - for every later test.
  mockBridge.flashcards.getFlashcards.mockReset();
  mockBridge.flashcards.onNewDayFlashcards.mockImplementation((_cb: () => void) => {
    return newDayCleanup;
  });
  mockBridge.migration.onFlashcardMigrationComplete.mockImplementation((_cb: (info: unknown) => void) => {
    return migrationCleanup;
  });
  mockBridge.flashcards.onFlashcardConnectOpen.mockImplementation(() => connectOpenCleanup);
  mockBridge.flashcards.onReviewFlashcardRequest.mockImplementation((_cb: () => void) => {
    return reviewRequestCleanup;
  });
  mockBridge.crossWindow.onUpdatePills.mockImplementation(() => updatePillsCleanup);
  mockBridge.crossWindow.onUpdateWordAppearance.mockImplementation(() => updateWordAppearanceCleanup);
  mockBridge.crossWindow.onUpdateAttemptFlashcardCreation.mockImplementation(() => updateAttemptCleanup);
  mockBridge.crossWindow.onUpdateCreateFlashcard.mockImplementation(() => updateCreateCleanup);
  mockBridge.crossWindow.onUpdateLastWatched.mockImplementation(() => updateLastWatchedCleanup);
}

// ── Module mocks ─────────────────────────────────────────────────────
vi.mock('../../shared/bridges', () => ({
  getBridge: () => mockBridge,
}));

vi.mock('../../shared/backends', () => ({
  resolveCloudApiUrl: () => 'https://example.test',
  getBackend: vi.fn(() => mockBackend),
}));

// ── Mock knowledge journal (SQLite store stand-in) ───────────────────
// appendEvents records rows; the store read APIs (queryKnowledgeEvents /
// getKnowledgeRows / getKnowledgeStates / queryLanguageKeys) replay exactly
// what the writers appended — same data flow as the production SQLite store.
const knowledgeJournal = vi.hoisted(() => {
  const mockAppendEvents = vi.fn(async (_byKey: Record<string, unknown[]>) => undefined);
  const allRows = (): Record<string, Array<Record<string, unknown>>> => {
    const rows: Record<string, Array<Record<string, unknown>>> = {};
    for (const [byKey] of mockAppendEvents.mock.calls) {
      for (const [key, events] of Object.entries(byKey as Record<string, Array<Record<string, unknown>>>)) {
        const target = rows[key] ??= [];
        const identities = new Set(target.map(event => knowledgeEventIdentity(event as unknown as KnowledgeEvent)).filter(Boolean));
        for (const event of events) {
          const identity = knowledgeEventIdentity(event as unknown as KnowledgeEvent);
          if (identity && identities.has(identity)) continue;
          if (identity) identities.add(identity);
          target.push(event);
        }
      }
    }
    return rows;
  };
  const queryKnowledgeEvents = vi.fn(async (keys: readonly string[]) => {
    const rows = allRows();
    const log: Record<string, Array<Record<string, unknown>>> = {};
    for (const key of keys) if (rows[key]?.length) log[key] = rows[key];
    return log;
  });
  const queryKnowledgeItemEvents = vi.fn(async (keys: readonly string[]) => {
    const log = await queryKnowledgeEvents(keys);
    return Object.fromEntries(Object.entries(log).map(([key, events]) => [key,
      events.filter((event) => event.itemRef !== undefined || event.retracts !== undefined),
    ]).filter(([, events]) => events.length > 0));
  });
  /** Mirrors the real bridge: fold every recognition key into the read model. */
  const grammarProjectionsOf = (language: string): GrammarProjectionMap => {
    const result: GrammarProjectionMap = {};
    for (const [key, events] of Object.entries(allRows())) {
      if (grammarPatternFromEvidenceKey(language, key) === null) continue;
      const projection = replayGrammarRecognition(events as KnowledgeEvent[]);
      if (projection) result[key] = projection;
    }
    return result;
  };
  const getGrammarProjections = vi.fn(async (language: string) => grammarProjectionsOf(language));
  const getKnowledgeRows = vi.fn(async (keys: readonly string[]) => {
    const rows = allRows();
    const out: Record<string, Array<{ event: Record<string, unknown>; seq: number }>> = {};
    for (const key of keys) out[key] = (rows[key] ?? []).map((event, seq) => ({ event, seq }));
    return out;
  });
  const getKnowledgeStates = vi.fn(async (keys: readonly string[]) => {
    const rows = allRows();
    const out: Record<string, { projection: ReplayProjection | null; capabilities?: Record<string, ReplayProjection>; claimMarkers?: ReturnType<typeof projectClaimMarkers>; hasArchive: boolean; archivedEventCount: number }> = {};
    for (const key of keys) {
      // Faithful to the store: the projection is the fold over the key's rows
      // (replayKeyProjection applies retractions, as the real checkpoint does).
      out[key] = {
        projection: replayKeyProjection((rows[key] ?? []) as KnowledgeEvent[]),
        capabilities: projectCapabilities(((rows[key] ?? []) as KnowledgeEvent[]).map((event, seq) => ({ event, seq })), undefined, true),
        claimMarkers: projectClaimMarkers(((rows[key] ?? []) as KnowledgeEvent[]).map((event, seq) => ({ event, seq })), true),
        hasArchive: false,
        archivedEventCount: 0,
      };
    }
    return out;
  });
  const queryLanguageKeys = vi.fn(async (language: string, prefix?: string) =>
    Object.keys(allRows()).filter((key) => key.startsWith(`${language}:${prefix ?? ''}`)).sort());
  const getKnowledgeArchive = vi.fn(async (key: string) => ({ key }));
  const queryKnowledgeSummaries = vi.fn(async () => ({}));
  const queryAnkiReviewIds = vi.fn(async () => [] as number[]);
  const queryAnkiReviewIdSets = vi.fn(async () => ({}) as Record<string, number[]>);
  return {
    mockAppendEvents, allRows, queryKnowledgeEvents, queryKnowledgeItemEvents, getGrammarProjections, grammarProjectionsOf, getKnowledgeRows, getKnowledgeStates,
    queryLanguageKeys, getKnowledgeArchive, queryKnowledgeSummaries, queryAnkiReviewIds, queryAnkiReviewIdSets,
  };
});
const mockAppendEvents = knowledgeJournal.mockAppendEvents;
const grammarProjectionsOf = knowledgeJournal.grammarProjectionsOf;
const mockAccumulateWordSeen = vi.hoisted(() => vi.fn());
const mockFlushKnowledgeRollup = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../services/knowledgeEvents', () => ({
  appendEvents: mockAppendEvents,
  appendEventsIdempotentAcknowledged: async (events: Record<string, unknown[]>) => {
    await mockAppendEvents(events);
    return true;
  },
  getEvents: async (keys: readonly string[]) => Object.values(await knowledgeJournal.queryKnowledgeEvents(keys)).flat(),
  getKnowledgeStates: knowledgeJournal.getKnowledgeStates,
  queryKnowledgeSummaries: knowledgeJournal.queryKnowledgeSummaries,
  queryLanguageKeys: knowledgeJournal.queryLanguageKeys,
}));

vi.mock('../services/knowledgeRollup', () => ({
  accumulateWordSeen: mockAccumulateWordSeen,
  flushKnowledgeRollup: mockFlushKnowledgeRollup,
  installPassiveFlushHooks: vi.fn(),
  uninstallPassiveFlushHooks: vi.fn(),
  setKnowledgeRollupTodayFn: vi.fn(),
}));

vi.mock('../../shared/platform', () => ({
  isElectron: mockIsElectron,
  getOS: () => 'mac',
  isCapacitor: () => false,
  isMobile: () => false,
  isDesktop: () => true,
}));

const mockT = vi.fn((key: string) => key);
vi.mock('./LocalizationContext', () => ({
  useLocalization: () => ({ t: mockT }),
}));

const mockGetCanonicalForm = vi.fn((word: string) => word);
const mockGetWordVariants = vi.fn((_word: string) => [] as string[]);
const mockGetCanonicalFormForLanguage = vi.fn((_language: string, word: string) => word);
const mockGetWordVariantsForLanguage = vi.fn((_language: string, _word: string) => [] as string[]);
const mockGetFrequencyForLanguage = vi.fn((_language: string, _word: string) => null as { raw_level: number; level: string; reading: string } | null);
const mockLangData = vi.hoisted(() => ({
  ar: {
    name: 'Arabic',
    name_translated: 'العربية',
    colour_codes: {},
    settings: { fixed: {} },
    textProcessing: {
      scriptProfile: {
        acceptedScripts: ['Arab'],
        wordScriptValidation: 'only-accepted',
      },
    },
  },
  ru2: {
    name: 'Russian Aspects',
    settings: { fixed: {} },
    textProcessing: { readingAnnotation: { type: 'script-reading', annotationScripts: ['Cyrl'] } },
  },
  ja2: {
    name: 'Japanese Aspects',
    settings: { fixed: {} },
    textProcessing: { readingAnnotation: { type: 'script-reading', annotationScripts: ['Han'] } },
    prosody: { type: 'japanese-pitch-accent' },
  },
  ja: {
    name: 'Japanese',
    name_translated: '日本語',
    colour_codes: {},
    settings: { fixed: {} },
  },
  zh: {
    name: 'Chinese',
    variants: {
      simplified: { name: 'Simplified', overrides: {} },
      traditional: {
        name: 'Traditional',
        scriptConversion: { engine: 'opencc', config: 't2s', mappingAsset: 'languages/zh.t2s.json' },
        overrides: { 'runtime.adapter.config.pinyinInputConversion': true },
      },
    },
  },
  fr: {
    name: 'French',
    name_translated: 'français',
    colour_codes: {},
    settings: { fixed: {} },
  },
  de: {
    name: 'German',
    name_translated: 'Deutsch',
    colour_codes: {},
    settings: { fixed: {} },
  },
}));
vi.mock('./LanguageContext', () => ({
  useLanguage: () => ({
    langData: mockLangData,
    getCanonicalForm: mockGetCanonicalForm,
    getWordVariants: mockGetWordVariants,
    getCanonicalFormForLanguage: mockGetCanonicalFormForLanguage,
    getWordVariantsForLanguage: mockGetWordVariantsForLanguage,
    getFrequencyForLanguage: mockGetFrequencyForLanguage,
    getEffectiveLanguageData: (language: string) => mockLangData[language as keyof typeof mockLangData] ?? null,
    currentLangData: () => mockLangData[mockSettings.language as keyof typeof mockLangData] ?? null,
    // Lookups may only name an INSTALLED dictionary pack.
    languageDataCatalog: () => mockLanguageDataCatalog,
  }),
}));

// Mutable so a test can change which dictionary packs are on disk.
let mockLanguageDataCatalog: Array<{ language: string; dictionaryPacks: Array<{ targetLanguage: string; installed: boolean }> }> = [
  { language: 'ja', dictionaryPacks: [{ targetLanguage: 'en', installed: true }] },
];

const mockSettings: Settings = {
  ...DEFAULT_SETTINGS,
  language: 'ja',
  newDayHour: 4,
  use_anki: false,
  flashcardLLMExamples: false,
  llmEnabled: false,
  flashcardAutoGenerateAudio: false,
  passiveEaseEnabled: true,
  passiveHoverDelayMs: 300,
  passiveHoverFailCount: 1,
  passiveHoverFailAction: 'decrease-ease',
  passiveHoverEaseDecrease: 0.05,
  known_ease_threshold: 4000,
};

vi.mock('./SettingsContext', () => ({
  useSettings: () => ({
    settings: mockSettings,
    updateSetting: vi.fn(),
    updateSettings: vi.fn(),
    saveSettings: vi.fn(),
    isLoading: () => false,
  }),
}));

vi.mock('./LowPowerGateContext', () => ({
  useLowPowerGate: () => ({
    requestAccess: vi.fn().mockResolvedValue(true),
  }),
}));

vi.mock('./migrationSignals', () => ({
  migrationListenerReady: () => true,
}));

const mockShowToast = vi.fn((_opts: Record<string, unknown>) => 1);
const mockUpdateToast = vi.fn();
vi.mock('../components/common/Feedback/Toast', () => ({
  showToast: (opts: Record<string, unknown>) => mockShowToast(opts),
  updateToast: (id: number, opts: Record<string, unknown>) => mockUpdateToast(id, opts),
  removeToast: vi.fn(),
}));

vi.mock('../services/statsService', () => ({
  changeKnownStatus: vi.fn(),
}));

vi.mock('../services/llmProvider', () => ({
  streamChat: mockStreamChat,
  checkAvailability: vi.fn().mockResolvedValue({ available: false }),
  isLLMReady: (settings: { llmEnabled: boolean }) => settings.llmEnabled !== false,
}));

vi.mock('../../shared/utils/textUtils', () => ({
  stripHtmlForTts: (s: string) => s.replace(/<[^>]*>/g, ''),
  getLanguageDisplayName: (lang: string) => lang,
  getReadingExtraCharacters: () => [],
  normalizeReading: (raw: string) => raw.replace(/<[^>]*>/g, '').replace(/\s+/g, ''),
  normalizeWordLookupText: (raw: string) => raw.replace(/<[^>]*>/g, '').trim(),
  isWordInLanguageScript: (
    word: string,
    _language: string,
    languageData?: { textProcessing?: { scriptProfile?: { acceptedScripts?: string[] } } } | null,
  ) => {
    if (languageData?.textProcessing?.scriptProfile?.acceptedScripts?.includes('Arab')) {
      return /[\u0600-\u06FF]/u.test(word);
    }
    return true;
  },
}));

vi.mock('../components/common/TaskProgress/TaskProgress', () => ({
  GroupedTaskProgressContent: () => null,
}));

// ── Helper types ─────────────────────────────────────────────────────
type FlashcardCtx = {
  store: FlashcardStore;
  isLoading: () => boolean;
  libraryLoadError: () => string | null;
  retryLibraryLoad: () => void;
  queue: () => ReviewQueue;
  queueCounts: () => { new: number; learning: number; review: number; total: number };
  addFlashcard: (content: Partial<{ type: string; front: string; back: string; reading?: string; prosody?: FlashcardContent['prosody']; pos?: string; level?: number; example?: string; exampleMeaning?: string; imageUrl?: string; videoUrl?: string; skipExampleTts?: boolean; audioUrl?: string; context?: string; source?: string; extra?: string; word?: string; pronunciation?: string; translation?: string[]; definition?: string[]; screenshotUrl?: string; contextPhrase?: string; unpopulated?: boolean }> & { front: string; back: string }, initialEase?: number, skipAnkiChoice?: boolean, language?: string) => Promise<string>;
  removeFlashcard: (id: string, neverShowAgain?: boolean) => Promise<boolean>;
  updateFlashcard: (id: string, updates: Partial<Flashcard>) => void;
  updateFlashcardContent: (id: string, content: Partial<Record<string, unknown>>) => void;
  suspendCard: (id: string) => void;
  unsuspendCard: (id: string) => void;
  buryCard: (id: string) => void;
  submitRating: (word: string, observations: readonly { capability: CapabilityKind; quality: AttemptQuality; method?: 'recall' | 'inference' }[], options?: {
    language?: string;
    attemptId?: AttemptId;
    timing?: { activeLatencyMs: number; wallLatencyMs: number; interruptionCount: number; interrupted: boolean; stalled: boolean };
    origin?: string;
    taskType?: AttemptTaskType;
    scaffolds?: AttemptScaffolds;
    sourceVersions?: EventSourceVersions;
    persistence?: 'immediate' | 'background';
    reviewSessionId?: string;
    scheduler?: { cardId: string; rating: Rating; timeSpentMs?: number; tested?: readonly CapabilityKind[] };
  }) => Promise<{ attemptId: AttemptId; completed: boolean; persisted?: Promise<boolean> }>;
  getCurrentCard: () => Flashcard | null;
  ratingPersistenceState: () => 'idle' | 'pending' | 'failed';
  retryRatingPersistence: () => Promise<void>;
  getAllCards: () => Flashcard[];
  getStudyableCards: () => Record<string, Flashcard>;
  getCardById: (id: string) => Flashcard | null;
  getCardsByWord: (word: string, language?: string) => Promise<Flashcard[]>;
  getCardByWord: (word: string, language?: string) => Promise<Flashcard | null>;
  hasWord: (word: string, language?: string) => Promise<boolean>;
  getWordStats: (word: string, language?: string) => Promise<WordStats | null>;
  getDueCount: () => number;
  getNewCount: () => number;
  hasWordSync: (word: string, language?: string) => boolean;
  getCardByWordSync: (word: string, language?: string) => Flashcard | null;
  getCardsByWordSync: (word: string, language?: string) => Flashcard[];
  isWordIgnoredSync: (word: string, language?: string) => boolean;
  getIgnoredWordsSync: () => Array<{ word: string; reading?: string; language: string; ignoredAt: number }>;
  findUnpopulatedFlashcardForWord: (word: string, language?: string) => Flashcard | null;
  addLevelStudyFlashcards: (
    words: string[],
    targetStatus: 'new' | 'learning' | 'known' | 'mastered',
    language?: string,
    options?: { onProgress?: (done: number, total: number) => void; preserveExistingStatus?: boolean },
  ) => Promise<{ created: number; promoted: number; skipped: number }>;
  updateMeta: (updates: Partial<FlashcardMeta>) => void;
  saveReviewPresentation: (language: string, presentation: ReviewPresentation, expectedId: string | null) => Promise<void>;
  pushUndoState: (options: { type: string; cardId: string }) => void;
  undoLastAction: () => Promise<string | null>;
  canUndo: () => boolean;
  trackWordAppearance: (word: string, reading?: string) => Promise<void>;
  ignoreWordForLanguage: (word: string, reading?: string, language?: string) => Promise<void>;
  unignoreWordForLanguage: (word: string, language?: string) => Promise<void>;
  trackWordSeen: (word: string, reading?: string, easeBump?: number, language?: string) => void;
  trackWordHovered: (word: string, reading?: string, language?: string) => void;
  cancelWordHover: (word: string, language?: string) => void;
  getWordKnowledge: (wordHash: string) => { ease: number; lastSeen: number; timesSeen: number; timesHovered: number; word: string; reading?: string; language?: string } | undefined;
  isWordKnown: (wordHash: string) => boolean;
  isWordKnownByText: (word: string, language?: string) => boolean;
  isWordLearningByText: (word: string, language?: string) => boolean;
  getComprehensiveWordStatusSync: (word: string, language?: string) => 'unknown' | 'learning' | 'known';
  restoreWordSyncRating: (previousSeenAt: Record<string, number | undefined>, language?: string) => void;
  getComprehensiveWordStatusWithSourceSync: (word: string, language?: string) => { status: 'unknown' | 'learning' | 'known'; basis: 'claim' | 'evidence' | 'unmeasured'; claim?: 'unknown' | 'learning' | 'known'; evidenceStatus: 'unknown' | 'learning' | 'known'; source: string; timesSeen: number; matchedWord?: string; ease?: number };
  isWordKnownComprehensiveSync: (word: string, language?: string) => boolean;
  trackGrammarEncountered: (pattern: string, levelOrOpts?: number | { confidence?: number; span?: { start: number; end: number }; origin?: string; encounterId?: string }, language?: string) => void;
  setWordClaim: (word: string, claim: 'unknown' | 'learning' | 'known' | null, language?: string) => Promise<boolean>;
  isKnowledgeReady: () => boolean;
  getAccessStatus: (word: string, capability: CapabilityKind, language?: string) => AccessStatusResult;
  setAccessClaim: (word: string, capability: CapabilityKind, status: 'unknown' | 'learning' | 'known', language?: string) => Promise<boolean>;
  clearAccessClaim: (word: string, capability: CapabilityKind, language?: string) => Promise<boolean>;
  recomputeWordKnowledgeFromEvidence: (word: string, language?: string) => Promise<void>;
  // setWordKnowledgeEase is intentionally not public — attempt evidence only.
  markWordSyncSeen: (word: string, language?: string) => void;
  trackGrammarFailed: (pattern: string, level?: number, language?: string) => void;
  getGrammarKnowledge: (pattern: string, language?: string) => { pattern: string; ease: number; timesEncountered: number; timesFailed: number; lastSeen: number; level: number; language: string } | undefined;
  startSession: () => void;
  refreshQueue: () => void;
  resetSRS: () => void;
  nukeAllFlashcards: () => void;
  pendingFlashcardChoice: () => unknown;
  resolvePendingFlashcardChoice: (target: 'srs' | 'anki' | 'cancel') => void;
  captureSuggestedFlashcard: (params: { word: string; reading?: string; pos?: string; level?: number | null; language?: string; contextPhrase?: string; contextHtml?: string; imageUrl?: string; videoUrl?: string; source?: string; sourceMediaHash?: string }) => Promise<void>;
  getSuggestedFlashcardsSync: () => Array<{ id: string; word: string; reading?: string; pos?: string; level?: number | null; language: string; contextPhrase?: string; contextHtml?: string; imageUrl?: string; videoUrl?: string; source?: string; sourceMediaHash?: string; createdAt: number; lastSeen: number; count: number }>;
  removeSuggestedFlashcard: (id: string) => void;
  removeSuggestedFlashcards: (ids: string[]) => void;
  cleanupKnownSuggestions: () => Promise<number>;
  garbageCollectSuggestedFlashcards: () => Promise<number>;
  promoteSuggestedFlashcards: (ids: string[], options?: { useLLM?: boolean; useTts?: boolean; onProgress?: (done: number, total: number) => void }) => Promise<number>;
  generateExampleSentenceWithLLM: (word: string, definition: string, language: string) => Promise<{ sentence: string; meaning: string }>;
  translateExampleSentence: (sentence: string, sourceLanguage: string, language?: string) => Promise<string>;
};

type AttemptSubmissionOptions = NonNullable<Parameters<FlashcardCtx['submitRating']>[2]> & {
  method?: 'recall' | 'inference';
};
const submitObservation = (
  ctx: FlashcardCtx,
  word: string,
  capability: CapabilityKind,
  quality: AttemptQuality,
  options?: AttemptSubmissionOptions,
) => {
  const { method, ...ratingOptions } = options ?? {};
  return ctx.submitRating(word, [{ capability, quality, ...(method ? { method } : {}) }], ratingOptions);
};
const submitSchedulerRating = (
  ctx: FlashcardCtx,
  cardId: string,
  rating: Rating,
  timeSpentMs?: number,
) => {
  const card = ctx.store.flashcards[cardId];
  if (!card) throw new Error(`Missing test card ${cardId}`);
  return ctx.submitRating(card.content.front, [], {
    language: card.language,
    scheduler: { cardId, rating, timeSpentMs },
  });
};

// ── Mount helper ─────────────────────────────────────────────────────
/**
 * Direct store seeding: writes partial top-level keys onto the live reactive
 * store. No bridge-callback timing involved.
 */
async function seedInto(ctx: FlashcardCtx, partial: Partial<FlashcardStore>): Promise<void> {
  const { produce } = await import('solid-js/store');
  for (const [key, value] of Object.entries(partial)) {
    produce((s: FlashcardStore) => {
      (s as unknown as Record<string, unknown>)[key] = value;
    })(ctx.store);
  }
  await Promise.resolve();
}

async function mountProvider() {
  const { createRoot, createComponent } = await import('solid-js');
  const { FlashcardProvider, useFlashcards } = await import('./FlashcardContext');
  let ctx!: FlashcardCtx;
  let dispose!: () => void;
  createRoot((d) => {
    dispose = d;
    createComponent(FlashcardProvider, {
      get children() {
        ctx = useFlashcards() as unknown as FlashcardCtx;
        return null;
      },
    });
  });
  return { ctx, dispose };
}

// ── Helpers ──────────────────────────────────────────────────────────
const CURRENT_VERSION = 3;
const CAPABILITY_PROJECTION_VERSION = 3;

function makeEmptyStore(overrides?: Partial<FlashcardStore>): FlashcardStore {
  return {
    flashcards: {},
    wordCandidates: {},
    wordToCardMap: {},
    wordStatsMap: {},
    knownUntracked: {},
    ignoredWords: {},
    wordKnowledge: {},
    grammarKnowledge: {},
    suggestedFlashcards: {},
    meta: {
      // Matches the version the provider stamps on a current store. A store
      // left behind it is a LEGACY store, and loading one runs
      // repairCapabilityProjection - which rematerializes wordKnowledge
      // straight from the evidence journal and so discards any seeded ease
      // the journal has no row for. Tests that seed rows directly and want the
      // repair say so explicitly; the rest are not exercising a repair they
      // cannot observe.
      capabilityProjectionVersion: CAPABILITY_PROJECTION_VERSION,
      perLanguage: {
        ja: { newCardsToday: 0, reviewsToday: 0, newCardsDate: '' },
      },
      newCardsToday: 0,
      reviewsToday: 0,
      newCardsDate: '',
      maxNewCardsPerDay: 20,
      maxNewCardsPerDayLearning: -1,
      maxReviewsPerDay: -1,
      learningSteps: [1, 10],
      relearnSteps: [10],
      graduatingInterval: 1,
      easyInterval: 4,
      newIntervalModifier: 100,
      reviewIntervalModifier: 100,
      maxInterval: 365,
    },
    dailyStats: {},
    version: CURRENT_VERSION,
    ...overrides,
  };
}

function makeCard(overrides?: Partial<Flashcard>): Flashcard {
  const now = Date.now();
  return {
    id: 'card-1',
    content: {
      type: 'word',
      front: 'テスト',
      back: 'test',
    },
    state: 'new',
    ease: 2.5,
    interval: 0,
    dueDate: now,
    reviews: 0,
    lapses: 0,
    learningStep: 0,
    createdAt: now,
    lastReviewed: now,
    lastUpdated: now,
    language: 'ja',
    ...overrides,
  };
}

function resetProviderTestHarness() {
    vi.resetModules();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    mockLanguageDataCatalog = [{ language: 'ja', dictionaryPacks: [{ targetLanguage: 'en', installed: true }] }];
    mockIsElectron.mockReturnValue(true);
    mockBridge.flashcards.saveFlashcards.mockReset().mockImplementation((saved: FlashcardStore) =>
      Promise.resolve((saved?.rev ?? 0) + 1));
    mockBridge.flashcards.enqueueFlashcardRating.mockReset().mockResolvedValue(1);
    mockBridge.flashcards.flushFlashcardRatings.mockReset().mockResolvedValue(undefined);
    mockBridge.flashcards.commitFlashcardRating.mockReset().mockImplementation(async (command: FlashcardRatingCommand) => {
      if (await mockAppendEvents(command.events) === false) throw new Error('rating journal append was refused');
      const rev = await mockBridge.flashcards.saveFlashcardPatch(command.patch);
      if (command.undo && !savedReviewUndos.some(record => record.attemptId === command.attemptId)) {
        savedReviewUndos.unshift(structuredClone(command.undo));
      }
      return { patch: command.patch, rev, attemptIds: [command.attemptId] };
    });
    savedReviewUndos = [];
    mockBridge.knowledgeEvents.getRatingUndoHistory.mockReset().mockImplementation(async () =>
      savedReviewUndos.filter(record => !Object.values(knowledgeJournal.allRows()).flat()
        .some(event => event.retracts === record.attemptId)));
    // Patches are applied to the committed authority, including peer edits.
    mockBridge.flashcards.saveFlashcardPatch.mockReset().mockImplementation((patch: StorePatch, removals, reset, authorization) => {
      const target = structuredClone(committed ?? delivered ?? makeEmptyStore());
      target.rev = revision;
      applyStorePatch(target as unknown as Record<string, unknown>, patch);
      return mockBridge.flashcards.saveFlashcards(target, removals, reset, authorization);
    });
    mockBridge.flashcards.saveReviewPresentation.mockReset().mockImplementation(async (command: ReviewPresentationWrite) => {
      const current = committed ?? delivered ?? makeEmptyStore();
      const patch = reviewPresentationPatch(current, command);
      if (!patch) return null;
      const rev = patch.entries.length ? await mockBridge.flashcards.saveFlashcardPatch(patch) : current.rev ?? 0;
      return { patch, rev, attemptIds: [] };
    });
    mockBridge.kvStore.kvGet.mockResolvedValue(null);
    mockBackend.ping.mockResolvedValue(true);
    mockBackend.translate.mockResolvedValue({ data: [] });
    mockBackend.getAnkiWordStatuses.mockResolvedValue([]);
    mockGetCanonicalForm.mockImplementation((word: string) => word);
    mockGetWordVariants.mockImplementation((_word: string) => []);
    mockGetCanonicalFormForLanguage.mockImplementation((_language: string, word: string) => word);
    mockGetWordVariantsForLanguage.mockImplementation((_language: string, _word: string) => []);
    mockGetFrequencyForLanguage.mockImplementation((_language: string, _word: string) => null);
    mockSettings.autoSuggestFlashcards = true;
    mockSettings.autoSuggestUnknownWords = true;
    mockSettings.learningLanguageLevels = {};
    mockSettings.language = 'ja';
    mockSettings.languageVariants = {};
    mockSettings.uiLanguage = DEFAULT_SETTINGS.uiLanguage;
    mockSettings.dictionaryTargetLanguages = {};
    mockSettings.use_anki = false;
    mockStreamChat.mockReset();
    mockAppendEvents.mockClear();
    mockAccumulateWordSeen.mockClear();
    mockFlushKnowledgeRollup.mockClear();
    committed = null;
    revision = 0;
    delivered = null;
    acceptedSaves.length = 0;
    setupMockImplementations();
    // Revision checking, as flashcardStorage does it. A test that needs a
    // different ordering (the stale-write regression) replaces this wholesale.
    installStrictSaveRevision();
}

// ── Tests ────────────────────────────────────────────────────────────
describe('FlashcardProvider', () => {
  beforeEach(resetProviderTestHarness);

  it('does not save an unchanged capability projection again when another window starts', async () => {
    const word = 'startup word';
    const key = `ja:${SRS.hashWordSync(word)}`;
    await mockAppendEvents({ [key]: [{ t: 100, kind: 'rollup', source: 'passiveTracking', aspect: 'meaning', timesSeenDelta: 3, presentedSurface: word }] });
    const first = await mountProvider();
    seed(makeEmptyStore({ wordKnowledge: { [key]: { word, language: 'ja', ease: SRS.MIN_EASE, timesSeen: 3, timesHovered: 0, firstSeen: 100, lastSeen: 100 } } }));
    await vi.waitFor(() => expect(first.ctx.isKnowledgeReady()).toBe(true));
    first.dispose();
    await vi.waitFor(() => expect(acceptedSaves.length).toBeGreaterThan(0));
    await new Promise(resolve => setTimeout(resolve, 0));
    const normalized = structuredClone(committed!);
    mockBridge.flashcards.saveFlashcards.mockClear();
    const second = await mountProvider();
    try {
      seed({ ...normalized, rev: revision });
      await vi.waitFor(() => expect(second.ctx.isKnowledgeReady()).toBe(true));
      await new Promise(resolve => setTimeout(resolve, 350));
      expect(mockBridge.flashcards.saveFlashcards).not.toHaveBeenCalled();
    } finally { second.dispose(); }
  });

  afterEach(async () => {
    // Tearing the provider down flushes whatever write is still on its
    // debounce timer, and that flush is deliberately detached: a window
    // closing must not wait for it. The write therefore outlives the test that
    // scheduled it, and with nothing between tests to stop it, it lands in the
    // NEXT test - against that test's authority, at that test's revision. The
    // symptom is a refusal in a test that never touched persistence at all,
    // and it moves around with scheduling order because the leak is a race.
    //
    // The flush has to be given a real timer turn to complete against the
    // authority that is still its own, which is what happens in the app when
    // the window really does close first. Draining microtasks is NOT enough:
    // a debounced save is scheduled on a 300ms timer, so with only microtasks
    // drained the write stays pending and fires part-way through a LATER test,
    // against that test's authority.
    await new Promise((resolve) => setTimeout(resolve, SAVE_DEBOUNCE_MS_FOR_TESTS));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  /**
   * Seeds a store the strict authority will accept a write from.
   *
   * `makeEmptyStore` carries no `rev`, so a store seeded straight from it is
   * written under revision 0 while the authority installed suite-wide expects
   * the first write at 1. That refusal is correct at the IPC boundary - it is
   * the exact mismatch `installStrictSaveRevision` exists to model - but a
   * test about word lookup has no race to exercise, and a capture now reports
   * the refusal rather than resolving anyway. Seeding the revision the
   * authority is actually on is what keeps such a test testing its own subject.
   */
  function seedAccepted(): void {
    seed(makeEmptyStore({ rev: revision }));
  }

  it('saves an active immutable review choice, resumes it after hydration, and refuses a superseded cursor', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'persisted-choice', reviews: 0 });
    seed(makeEmptyStore({ rev: revision, flashcards: { [card.id]: card } }));
    const decision = selectFlashcardReviewDecision({ id: 'retained-choice', at: 20,
      entries: [flashcardReviewPolicyEntry(card, 'ja')], rng: () => 0.7 })!.provenance;
    const materialSnapshot = { languageData: { name: 'Unknown package', settings: { fixed: {} }, future: { relation: ['opaque', { scope: 'clause' }] } }, lookup: { data: [{ future: { gloss: ['meaning'] } }] } } as unknown as NonNullable<ReviewPresentation['materialSnapshot']>;
    const presentation = { id: decision.id, cardId: card.id, decision, materialSnapshot };
    await ctx.saveReviewPresentation('ja', presentation, null);
    await expect(ctx.saveReviewPresentation('ja', { ...presentation, materialSnapshot: { languageData: null, lookup: null } }, decision.id)).rejects.toThrow('material');
    expect(committed!.meta.reviewPresentations?.ja).toEqual(presentation);
    expect(ctx.store.meta.reviewPresentations?.ja).toEqual(presentation);
    const saved = structuredClone(committed!);
    dispose();
    await new Promise(resolve => setTimeout(resolve, 0));
    const reopened = await mountProvider();
    seed(saved);
    expect(reopened.ctx.store.meta.reviewPresentations?.ja?.decision).toEqual(decision);
    await expect(reopened.ctx.saveReviewPresentation('ja', { ...presentation, id: 'wrong-cursor' }, null)).rejects.toThrow();
    expect(committed!.meta.reviewPresentations?.ja).toEqual(presentation);
    expect(mockAppendEvents).not.toHaveBeenCalled();
    reopened.dispose();
  });

  it('does not replace a peer review choice when the library revision changes during admission', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'raced-choice' });
    seed(makeEmptyStore({ rev: revision, flashcards: { [card.id]: card } }));
    const decision = selectFlashcardReviewDecision({ id: 'local-choice', at: 20,
      entries: [flashcardReviewPolicyEntry(card, 'ja')], rng: () => 0.7 })!.provenance;
    committed!.meta.reviewPresentations = { ja: { id: 'peer-choice', cardId: card.id } };
    committed!.rev = ++revision;
    answerProbesFromAuthority();
    await expect(ctx.saveReviewPresentation('ja', { id: decision.id, cardId: card.id, decision }, null)).rejects.toThrow();
    expect(committed!.meta.reviewPresentations?.ja?.id).toBe('peer-choice');
    expect(ctx.store.meta.reviewPresentations?.ja?.id).toBe('peer-choice');
    dispose();
  });

  it('routes a package-defined retraction through its registered replay handler', async () => {
    const { ctx, dispose } = await mountProvider();
    const lifecycle = ctx as unknown as ReturnType<typeof import('./FlashcardContext').useFlashcards>;
    seed(makeEmptyStore());
    const target = { keys: ['package:utterance'], replay: { kind: 'third-party:discourse', speaker: { classes: ['unfamiliar', 'structured'] } } };
    const replay = vi.fn(async () => {});
    expect(await lifecycle.retractAttempts(target, ['custom-attempt' as AttemptId])).toBe(false);
    expect(knowledgeJournal.allRows()['package:utterance']).toBeUndefined();
    const unregister = lifecycle.registerRetractionReplay(target.replay.kind, replay);
    expect(await lifecycle.retractAttempts(target, ['custom-attempt' as AttemptId])).toBe(true);
    expect(replay).toHaveBeenCalledWith(target.replay);
    expect(knowledgeJournal.allRows()['package:utterance']).toMatchObject([{ retracts: 'custom-attempt' }]);
    unregister();
    expect(await lifecycle.retractAttempts(target, ['later-attempt' as AttemptId])).toBe(false);
    dispose();
  });

  it('keeps an interrupted surface Undo until its projection owner is mounted', async () => {
    const { ctx, dispose } = await mountProvider();
    const lifecycle = ctx as unknown as ReturnType<typeof import('./FlashcardContext').useFlashcards>;
    const pending = {
      attemptId: 'package-recovery', surface: 'package-study', word: 'word', language: 'ja2',
      attemptIds: ['package-attempt'],
      target: { keys: ['ja2:package-key'], replay: { kind: 'word' as const, word: 'word', language: 'ja2' } },
      restore: { position: 3 },
    };
    seed(makeEmptyStore({ pendingRetraction: pending }));
    await vi.waitFor(() => expect(ctx.isKnowledgeReady()).toBe(true));
    await lifecycle.recoverPendingRetraction();
    expect(ctx.store.pendingRetraction).toEqual(pending);
    expect(knowledgeJournal.allRows()['ja2:package-key']).toBeUndefined();
    const build = vi.fn(async () => (record: typeof pending, target: FlashcardStore) => {
      target.knownUntracked['restored-position'] = { word: String((record.restore as { position: number }).position), language: 'ja2', addedAt: 1 };
    });
    const unregister = lifecycle.registerRetractionProjection('package-study', build);
    unregister();
    await lifecycle.recoverPendingRetraction();
    expect(build).not.toHaveBeenCalled();
    expect(ctx.store.pendingRetraction).toEqual(pending);
    lifecycle.registerRetractionProjection('package-study', build);
    await lifecycle.recoverPendingRetraction();
    expect(build).toHaveBeenCalledOnce();
    expect(ctx.store.pendingRetraction).toBeUndefined();
    expect(ctx.store.knownUntracked['restored-position']?.word).toBe('3');
    dispose();
  });

  it("does not replace another window's pending Undo when rebasing a recovery record", async () => {
    answerProbesFromAuthority();
    const { ctx, dispose } = await mountProvider();
    const lifecycle = ctx as unknown as ReturnType<typeof import('./FlashcardContext').useFlashcards>;
    seed(makeEmptyStore({ rev: 5 }));
    const first = { attemptId: 'first-undo', surface: 'package-study', word: 'word', language: 'ja2', attemptIds: ['first-attempt'], restore: { position: 1 } };
    const second = { ...first, attemptId: 'second-undo', attemptIds: ['second-attempt'] };
    await mockBridge.flashcards.saveFlashcards(makeEmptyStore({ rev: 5, pendingRetraction: first }), [], false, undefined);
    expect(await lifecycle.recordPendingRetraction(second)).toBe(false);
    expect(committed?.pendingRetraction?.attemptId).toBe('first-undo');
    dispose();
  });

  it('publishes a scheduler rating only after the flashcard write is acknowledged', async () => {
    mockSettings.language = 'ja2';
    let acknowledgeSave!: () => void;
    mockBridge.flashcards.saveFlashcards.mockImplementation((saved: FlashcardStore) => new Promise((resolve, reject) => {
      if ((saved.rev ?? 0) !== revision) {
        return reject(new Error(staleFlashcardRevisionMessage(revision, saved.rev ?? 0)));
      }
      revision += 1;
      committed = structuredClone(saved);
      acceptedSaves.push(structuredClone(saved));
      acknowledgeSave = () => resolve(revision);
    }));
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({
      id: 'card-acknowledged-rating',
      language: 'ja2',
      content: { type: 'word', front: '学校', back: 'school' },
      state: 'review',
      reviews: 3,
      interval: 86_400_000,
      dueDate: Date.now() - 1000,
    });
    flashcardsCb(makeEmptyStore({ flashcards: { [card.id]: card } }));
    const previousReviews = ctx.store.flashcards[card.id].reviews;
    let settled = false;

    const submission = ctx.submitRating('学校', [{ capability: 'sense-recognition', quality: 'fluent' }], {
      language: 'ja2',
      attemptId: 'stable-review-attempt' as AttemptId,
      scheduler: { cardId: card.id, rating: 'good', tested: ['sense-recognition'] },
    }).then((result) => {
      settled = true;
      return result;
    });

    await vi.waitFor(() => expect(mockBridge.flashcards.saveFlashcards).toHaveBeenCalled());
    expect(ctx.store.flashcards[card.id].reviews).toBe(previousReviews);
    expect(settled).toBe(false);

    acknowledgeSave();
    const result = await submission;

    expect(ctx.store.flashcards[card.id].reviews).toBe(previousReviews + 1);
    expect(result.completed).toBe(true);
    expect(result.attemptId).toBe('stable-review-attempt');
    dispose();
    mockSettings.language = 'ja';
  });

  it('commits finite review progress with evidence and restores its slot on Undo', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'bounded', state: 'review', reviews: 2, interval: 86400000, dueDate: Date.now() - 100 });
    const session = { id: 'finite', cardIds: [card.id], completedCardIds: [], encounterLimit: 1, startedAt: 10 };
    const initial = makeEmptyStore({ flashcards: { [card.id]: card } });
    initial.meta.reviewSessions = { ja: session };
    flashcardsCb(initial);
    const result = await ctx.submitRating(card.content.front, [], { language: 'ja', reviewSessionId: session.id,
      attemptId: 'finite-attempt' as AttemptId, scheduler: { cardId: card.id, rating: 'again' } });
    await result.persisted;
    expect(ctx.store.meta.reviewSessions?.ja?.completedCardIds).toEqual([card.id]);
    await ctx.undoLastAction();
    expect(ctx.store.meta.reviewSessions?.ja?.completedCardIds).toEqual([]);
    expect(ctx.store.flashcards[card.id].reviews).toBe(card.reviews);
    dispose();
  });

  it.each(['prompt', 'language'])('refuses a first review admission when another window changes its %s', async changed => {
    const { ctx, dispose } = await mountProvider();
    try {
      const card = makeCard({ id: 'changed-before-admission', language: 'ja2',
        content: { type: 'word', front: 'captured prompt', back: 'answer' }, state: 'review', reviews: 3 });
      const original = makeEmptyStore({ rev: revision, flashcards: { [card.id]: card } });
      seed(original);
      mockAppendEvents.mockClear();
      mockBridge.flashcards.saveFlashcards.mockClear();
      const pending = ctx.submitRating(card.content.front, [{ capability: 'sense-recognition', quality: 'fluent' }], {
        language: card.language, attemptId: `first-admission-${changed}`, persistence: 'immediate',
        scheduler: { cardId: card.id, rating: 'good', tested: ['sense-recognition'] },
      });
      const replacement = { ...card, ...(changed === 'language' ? { language: 'future' }
        : { content: { ...card.content, front: 'replacement prompt' } }) };
      seed({ ...original, rev: (original.rev ?? 0) + 1, flashcards: { [card.id]: replacement } });
      await expect(pending).rejects.toThrow(/captured prompt|captured language/);
      expect(mockAppendEvents).not.toHaveBeenCalled();
      expect(mockBridge.flashcards.saveFlashcards).not.toHaveBeenCalled();
    } finally { dispose(); }
  });

  it('advances repeated background ratings before persistence acknowledges and preserves unmapped-card provenance', async () => {
    const acknowledgements: Array<(revision: number) => void> = [];
    mockBridge.flashcards.enqueueFlashcardRating.mockImplementation(() => new Promise<number>(resolve => acknowledgements.push(resolve)));
    const { ctx, dispose } = await mountProvider();
    const first = makeCard({ id: 'background-first', state: 'review', reviews: 2, dueDate: Date.now() - 1000 });
    const second = makeCard({ id: 'background-second', state: 'review', reviews: 4, dueDate: Date.now() - 1000 });
    flashcardsCb(makeEmptyStore({ flashcards: { [first.id]: first, [second.id]: second } }));
    mockAppendEvents.mockClear();
    const options = (cardId: string) => ({ persistence: 'background' as const,
      origin: 'flashcard-review:unmapped', taskType: 'srs-review' as const,
      scheduler: { cardId, rating: 'good' as const, tested: ['sense-recognition' as const] } });
    const result = await ctx.submitRating(first.content.front, [{ capability: 'sense-recognition', quality: 'fluent' }], options(first.id));
    expect(ctx.store.flashcards[first.id].reviews).toBe(3);
    expect(ctx.getCurrentCard()?.id).toBe(second.id);
    expect(ctx.ratingPersistenceState()).toBe('pending');
    expect(mockAppendEvents).not.toHaveBeenCalled();
    await ctx.submitRating(second.content.front, [{ capability: 'sense-recognition', quality: 'fluent' }], options(second.id));
    expect(ctx.store.flashcards[second.id].reviews).toBe(5);
    const firstCommand = mockBridge.flashcards.enqueueFlashcardRating.mock.calls[0][0];
    expect(Object.values(firstCommand.events as Record<string, KnowledgeEvent[]>).flat().find(event => event.kind === 'review')).toMatchObject({
      attemptId: result.attemptId, schedulerCardId: first.id, presentedSurface: first.content.front,
      origin: 'flashcard-review:unmapped', taskType: 'srs-review',
    });
    expect(Object.values(firstCommand.events as Record<string, KnowledgeEvent[]>).flat().find(event => event.kind === 'rating')).toMatchObject({
      attemptId: result.attemptId, schedulerCardId: first.id, presentedSurface: first.content.front,
      origin: 'flashcard-review:unmapped', taskType: 'srs-review',
      targetRef: { kind: 'surface', id: expect.stringMatching(/^ja:surface:[a-f0-9]{64}$/), capability: 'sense-recognition' },
    });
    // A stale focus snapshot must not erase either optimistic rating.
    flashcardsCb(makeEmptyStore({ rev: 0, flashcards: { [first.id]: first, [second.id]: second } }));
    expect(ctx.store.flashcards[first.id].reviews).toBe(3);
    expect(ctx.store.flashcards[second.id].reviews).toBe(5);
    acknowledgements.forEach(resolve => resolve(1));
    await vi.waitFor(() => expect(ctx.ratingPersistenceState()).toBe('idle'));
    expect(ctx.store.flashcards[first.id].reviews).toBe(3);
    expect(ctx.store.flashcards[second.id].reviews).toBe(5);
    dispose();
  });

  it('retains the original queued-response Undo after durable acknowledgement and provider restart', async () => {
    mockBridge.flashcards.enqueueFlashcardRating.mockImplementation(async command => {
      const commit = await mockBridge.flashcards.commitFlashcardRating(command);
      mockBridge.flashcards.onFlashcardRatingsCommitted.mock.calls.at(-1)![0](commit);
      return commit.rev;
    });
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'queued-restart', state: 'review', reviews: 2 });
    seed(makeEmptyStore({ flashcards: { [card.id]: card } }));
    await ctx.submitRating(card.content.front, [], { persistence: 'background', attemptId: 'queued-restart-original' as AttemptId,
      scheduler: { cardId: card.id, rating: 'good' } });
    await vi.waitFor(() => expect(ctx.ratingPersistenceState()).toBe('idle'));
    const queued = mockBridge.flashcards.enqueueFlashcardRating.mock.calls[0][0];
    expect(queued.guardCardIds).toEqual([card.id]);
    expect(queued.undo.restore.restoreCard.reviews).toBe(2);
    expect(queued.undo.target.keys).toEqual(Object.keys(queued.events));
    const persisted = structuredClone(committed!);
    dispose();
    const reopened = await mountProvider();
    seed(persisted);
    await vi.waitFor(() => expect(reopened.ctx.canUndo()).toBe(true));
    await reopened.ctx.undoLastAction();
    expect(reopened.ctx.store.flashcards[card.id].reviews).toBe(2);
    expect(reopened.ctx.store.pendingRetraction).toBeUndefined();
    expect(reopened.ctx.canUndo()).toBe(false);
    reopened.dispose();
  });

  it('removes completed review Undo by attempt identity when a late history refresh replaces its stack entry', async () => {
    const { ctx, dispose } = await mountProvider();
    const earlier = makeCard({ id: 'earlier-manual' });
    const reviewed = makeCard({ id: 'late-ack-reviewed', state: 'review', reviews: 2 });
    seed(makeEmptyStore({ flashcards: { [earlier.id]: earlier, [reviewed.id]: reviewed } }));
    ctx.pushUndoState({ type: 'earlier-manual-action', cardId: earlier.id });
    await ctx.submitRating(reviewed.content.front, [], { attemptId: 'late-ack-owned' as AttemptId,
      scheduler: { cardId: reviewed.id, rating: 'good' } });
    const originalAppend = mockAppendEvents.getMockImplementation()!;
    mockAppendEvents.mockImplementationOnce(async events => {
      mockBridge.flashcards.onFlashcardRatingsCommitted.mock.calls.at(-1)![0]({
        patch: { baseRev: ctx.store.rev, entries: [] }, rev: ctx.store.rev, attemptIds: ['late-ack-owned'],
      });
      await Promise.resolve();
      return originalAppend(events);
    });
    await ctx.undoLastAction();
    expect(ctx.canUndo()).toBe(true);
    await expect(ctx.undoLastAction()).resolves.toBe('earlier-manual-action');
    expect(ctx.canUndo()).toBe(false);
    dispose();
  });

  it('releases a refused queued response, reloads the authored authority and reports that it was not saved', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'queued-refused', state: 'review', reviews: 2 });
    seed(makeEmptyStore({ flashcards: { [card.id]: card } }));
    const peer = structuredClone(committed!);
    peer.flashcards[card.id].content.back = 'authoritative peer answer';
    mockBridge.flashcards.enqueueFlashcardRating.mockImplementation(async command => {
      committed = peer;
      committed.rev = ++revision;
      throw new Error(`Error invoking enqueue: ${new RatingAdmissionRefusal([command.attemptId]).message}`);
    });
    answerProbesFromAuthority();
    mockShowToast.mockClear();
    await ctx.submitRating(card.content.front, [], { persistence: 'background', attemptId: 'refused-before-admission' as AttemptId,
      scheduler: { cardId: card.id, rating: 'good' } });
    await vi.waitFor(() => expect(ctx.store.flashcards[card.id].content.back).toBe('authoritative peer answer'));
    expect(ctx.store.flashcards[card.id].reviews).toBe(2);
    expect(ctx.ratingPersistenceState()).toBe('idle');
    expect(ctx.canUndo()).toBe(false);
    expect(mockShowToast).toHaveBeenCalledWith({ variant: 'warning', message: 'mlearn.Flashcards.Review.PendingRatingChanged' });
    await ctx.retryRatingPersistence();
    expect(mockBridge.flashcards.enqueueFlashcardRating).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('preserves unrelated pending authored edits and unknown content through refusal refresh and eventual save', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'refused-with-local-edit', state: 'review', reviews: 2 });
    const other = makeCard({ id: 'pending-authored-card' });
    seed(makeEmptyStore({ flashcards: { [card.id]: card, [other.id]: other } }));
    const peer = structuredClone(committed!);
    peer.flashcards[card.id].content.back = 'authoritative peer answer';
    let reject!: (error: Error) => void;
    mockBridge.flashcards.enqueueFlashcardRating.mockImplementation(() => new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
    await ctx.submitRating(card.content.front, [], { persistence: 'background', attemptId: 'refused-preserve-authored' as AttemptId,
      scheduler: { cardId: card.id, rating: 'good' } });
    ctx.updateFlashcard(other.id, { content: { ...other.content, back: 'unsaved authored answer',
      futureFeature: { arbitraryCategory: ['unfamiliar', { conditional: true }] } } as FlashcardContent });
    committed = peer;
    committed.rev = ++revision;
    answerProbesFromAuthority();
    reject(new RatingAdmissionRefusal(['refused-preserve-authored']));
    await vi.waitFor(() => expect(ctx.store.flashcards[card.id].content.back).toBe('authoritative peer answer'));
    expect(ctx.store.flashcards[card.id].reviews).toBe(2);
    expect(ctx.store.flashcards[other.id].content.back).toBe('unsaved authored answer');
    expect((ctx.store.flashcards[other.id].content as unknown as Record<string, unknown>).futureFeature)
      .toEqual({ arbitraryCategory: ['unfamiliar', { conditional: true }] });
    await vi.waitFor(() => expect(committed!.flashcards[other.id].content.back).toBe('unsaved authored answer'));
    expect(committed!.flashcards[card.id].content.back).toBe('authoritative peer answer');
    expect(committed!.flashcards[card.id].reviews).toBe(2);
    expect((committed!.flashcards[other.id].content as unknown as Record<string, unknown>).futureFeature)
      .toEqual({ arbitraryCategory: ['unfamiliar', { conditional: true }] });
    dispose();
  });

  it('retains a failed background command and retries the same attempt without rerating', async () => {
    mockBridge.flashcards.enqueueFlashcardRating.mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(1);
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'background-retry', state: 'review', reviews: 2, dueDate: Date.now() - 1000 });
    flashcardsCb(makeEmptyStore({ flashcards: { [card.id]: card } }));
    const result = await ctx.submitRating(card.content.front, [], { persistence: 'background', scheduler: { cardId: card.id, rating: 'good' } });
    await vi.waitFor(() => expect(ctx.ratingPersistenceState()).toBe('failed'));
    const durable = vi.fn();
    void result.persisted!.then(durable);
    await Promise.resolve();
    expect(durable).not.toHaveBeenCalled();
    expect(ctx.store.flashcards[card.id].reviews).toBe(3);
    await ctx.retryRatingPersistence();
    expect(mockBridge.flashcards.enqueueFlashcardRating.mock.calls[0]).toEqual(mockBridge.flashcards.enqueueFlashcardRating.mock.calls[1]);
    expect(ctx.ratingPersistenceState()).toBe('idle');
    await expect(result.persisted).resolves.toBe(true);
    expect(ctx.store.flashcards[card.id].reviews).toBe(3);
    dispose();
  });

  it('flushes background ratings before the existing durable Undo transaction', async () => {
    let acknowledge!: (revision: number) => void;
    mockBridge.flashcards.enqueueFlashcardRating.mockImplementation(command => new Promise<number>(resolve => {
      acknowledge = acceptedRevision => {
        revision = acceptedRevision;
        void mockAppendEvents(command.events).then(() => {
          committed = structuredClone(delivered!);
          applyStorePatch(committed as unknown as Record<string, unknown>, command.patch);
          committed.rev = revision;
          const callback = mockBridge.flashcards.onFlashcardRatingsCommitted.mock.calls.at(-1)![0];
          callback({ patch: command.patch, rev: revision, attemptIds: [command.attemptId] });
          resolve(revision);
        });
      };
    }));
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'background-undo', state: 'review', reviews: 2, dueDate: Date.now() - 1000 });
    seed(makeEmptyStore({ flashcards: { [card.id]: card } }));
    await ctx.submitRating(card.content.front, [], { persistence: 'background', scheduler: { cardId: card.id, rating: 'good' } });
    expect(ctx.canUndo()).toBe(true);
    let undone = false;
    const undo = ctx.undoLastAction().then(result => { undone = true; return result; });
    await vi.waitFor(() => expect(mockBridge.flashcards.flushFlashcardRatings).toHaveBeenCalled());
    expect(undone).toBe(false);
    acknowledge(1);
    expect(await undo).toBe('answer');
    expect(ctx.store.flashcards[card.id].reviews).toBe(2);
    expect(ctx.store.pendingReviewUndo).toBeUndefined();
    expect(ctx.ratingPersistenceState()).toBe('idle');
    dispose();
  });

  it('overlays later local ratings onto a committed batch from another window', async () => {
    let acknowledge!: (revision: number) => void;
    mockBridge.flashcards.enqueueFlashcardRating.mockImplementation(() => new Promise<number>(resolve => { acknowledge = resolve; }));
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'background-peer', state: 'review', reviews: 2, dueDate: Date.now() - 1000 });
    flashcardsCb(makeEmptyStore({ rev: 1, flashcards: { [card.id]: card } }));
    await ctx.submitRating(card.content.front, [], { persistence: 'background', scheduler: { cardId: card.id, rating: 'good' } });
    const committed = mockBridge.flashcards.onFlashcardRatingsCommitted.mock.calls.at(-1)![0] as (commit: { patch: StorePatch; rev: number; attemptIds: string[] }) => void;
    committed({ rev: 2, attemptIds: [], patch: { baseRev: 1, entries: [
      { path: ['flashcards', card.id], before: card, after: { ...card, content: { ...card.content, back: 'peer edited answer' } } },
    ] } });
    expect(ctx.store.flashcards[card.id].reviews).toBe(3);
    expect(ctx.store.flashcards[card.id].content.back).toBe('peer edited answer');
    acknowledge(3);
    await vi.waitFor(() => expect(ctx.ratingPersistenceState()).toBe('idle'));
    expect(ctx.store.flashcards[card.id].reviews).toBe(3);
    expect(ctx.store.flashcards[card.id].content.back).toBe('peer edited answer');
    dispose();
  });

  it('replays only later pending commands after a partial batch commits', async () => {
    const acknowledgements: Array<(revision: number) => void> = [];
    mockBridge.flashcards.enqueueFlashcardRating.mockImplementation(() => new Promise<number>(resolve => acknowledgements.push(resolve)));
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'partial-batch', state: 'review', reviews: 2, dueDate: Date.now() - 1000 });
    flashcardsCb(makeEmptyStore({ rev: 1, flashcards: { [card.id]: card } }));
    const options = { persistence: 'background' as const, scheduler: { cardId: card.id, rating: 'good' as const } };
    await ctx.submitRating(card.content.front, [], options);
    await ctx.submitRating(card.content.front, [], options);
    expect(ctx.store.flashcards[card.id].reviews).toBe(4);
    const commands = mockBridge.flashcards.enqueueFlashcardRating.mock.calls.map(([command]) => command);
    const committed = mockBridge.flashcards.onFlashcardRatingsCommitted.mock.calls.at(-1)![0];
    committed({ rev: 2, patch: commands[0].patch, attemptIds: [commands[0].attemptId] });
    expect(ctx.store.flashcards[card.id].reviews).toBe(4);
    expect(ctx.ratingPersistenceState()).toBe('pending');
    committed({ rev: 3, patch: commands[1].patch, attemptIds: [commands[1].attemptId] });
    expect(ctx.store.flashcards[card.id].reviews).toBe(4);
    expect(ctx.ratingPersistenceState()).toBe('idle');
    acknowledgements.forEach((resolve, index) => resolve(index + 2));
    dispose();
  });

  it('persists the next authoritative mobile revision through the flashcard authority', async () => {
    mockIsElectron.mockReturnValue(false);
    const card = makeCard({ id: 'mobile-revision', language: 'ja', content: { type: 'word', front: '学校', back: 'school' } });
    const initialStore = makeEmptyStore({ rev: 8, flashcards: { [card.id]: card } });
    const { ctx, dispose } = await mountProvider();
    seed(initialStore);
    installStrictSaveRevision();
    answerProbesFromAuthority();
    await vi.waitFor(() => expect(ctx.store.rev).toBe(8));

    await ctx.submitRating('学校', [{ capability: 'sense-recognition', quality: 'fluent' }], {
      language: 'ja',
      attemptId: 'mobile-revision-attempt' as AttemptId,
      scheduler: { cardId: card.id, rating: 'good', tested: ['sense-recognition'] },
    });

    expect(committed?.rev).toBe(9);
    expect(mockBridge.kvStore.kvSet).not.toHaveBeenCalledWith('mlearn-flashcards', expect.anything());
    expect(ctx.store.rev).toBe(9);
    dispose();
  });

  it('keeps a mobile review unchanged and retryable when its native observation journal refuses', async () => {
    mockIsElectron.mockReturnValue(false);
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'mobile-journal-refusal', language: 'ja', reviews: 3, state: 'review', dueDate: Date.now() - 1000 });
    seed(makeEmptyStore({ rev: 8, flashcards: { [card.id]: card } }));
    installStrictSaveRevision(); answerProbesFromAuthority();
    await vi.waitFor(() => expect(ctx.isKnowledgeReady()).toBe(true));
    mockBridge.flashcards.saveFlashcards.mockClear(); mockBridge.flashcards.saveFlashcardPatch.mockClear();
    mockAppendEvents.mockRejectedValueOnce(new Error('native observation journal refused'));
    const submit = () => ctx.submitRating(card.content.front, [{ capability: 'sense-recognition', quality: 'fluent' }], {
      language: 'ja', attemptId: 'mobile-journal-retry' as AttemptId,
      scheduler: { cardId: card.id, rating: 'good', tested: ['sense-recognition'] },
    });
    await expect(submit()).rejects.toThrow('native observation journal refused');
    expect(ctx.store.flashcards[card.id].reviews).toBe(3); expect(ctx.store.rev).toBe(8); expect(ctx.canUndo()).toBe(false);
    expect(mockBridge.flashcards.saveFlashcards).not.toHaveBeenCalled(); expect(mockBridge.flashcards.saveFlashcardPatch).not.toHaveBeenCalled();
    await submit(); expect(ctx.store.flashcards[card.id].reviews).toBe(4); expect(ctx.store.rev).toBe(9); expect(ctx.canUndo()).toBe(true);
    dispose();
  });

  it('keeps unknown language-owned root data through mobile hydration and an authored edit', async () => {
    mockIsElectron.mockReturnValue(false);
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'mobile-opaque', language: 'ja', content: { type: 'word', front: '学校', back: 'school' } });
    seed({ ...makeEmptyStore({ rev: 8, flashcards: { [card.id]: card } }),
      opaquePackage: { 'unknown:concept': [{ arbitrary: [2, 3] }] } } as FlashcardStore);
    installStrictSaveRevision(); answerProbesFromAuthority();
    await ctx.updateFlashcard(card.id, { content: { ...card.content, back: 'edited' } });
    await vi.waitFor(() => expect(committed?.flashcards[card.id].content.back).toBe('edited'));
    expect(committed).toHaveProperty('opaquePackage', { 'unknown:concept': [{ arbitrary: [2, 3] }] });
    expect(mockBridge.kvStore.kvSet).not.toHaveBeenCalledWith('mlearn-flashcards', expect.anything());
    dispose();
  });

  it('awaits the real Undo command after a scheduler rating', async () => {
    mockSettings.language = 'ja2';
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({
      id: 'card-undo-command',
      language: 'ja2',
      content: { type: 'word', front: '学校', back: 'school' },
      state: 'review',
      reviews: 3,
      interval: 86_400_000,
      dueDate: Date.now() - 1000,
    });
    flashcardsCb(makeEmptyStore({ flashcards: { [card.id]: card } }));
    const { attemptId } = await ctx.submitRating('学校', [{ capability: 'sense-recognition', quality: 'fluent' }], {
      language: 'ja2',
      attemptId: 'undoable-review-attempt' as AttemptId,
      scheduler: { cardId: card.id, rating: 'good', tested: ['sense-recognition'] },
    });

    const undo = ctx.undoLastAction();
    expect(undo).toBeInstanceOf(Promise);
    await undo;

    expect(ctx.store.flashcards[card.id].reviews).toBe(3);
    expect(mockBridge.flashcards.saveFlashcards.mock.calls.at(-1)?.[3]).toEqual({
      kind: 'undo-review', cardId: card.id, restoredReviews: 3,
    });
    const events = mockAppendEvents.mock.calls.flatMap(([byKey]) => Object.values(byKey as Record<string, Array<Record<string, unknown>>>).flat());
    expect(events.some((event) => event.kind === 'retraction' && event.retracts === attemptId)).toBe(true);
    dispose();
    mockSettings.language = 'ja';
  });

  it('Undo rerating corrects the original elicitation once rather than scheduling an exposed replay', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'corrected-response', language: 'ja', state: 'review', reviews: 3,
      interval: 86_400_000, dueDate: Date.now() - 1000, content: { type: 'word', front: '学校', back: 'school' } });
    const decision = selectFlashcardReviewDecision({ id: 'original-elicitation', at: Date.now(),
      entries: [flashcardReviewPolicyEntry(card, 'ja')], rng: () => 0.7 })!.provenance;
    const scaffolds = { 'unknown-package:cue': true };
    const timing = { wallLatencyMs: 2100, activeLatencyMs: 1800, interruptionCount: 1, interrupted: true, stalled: false };
    const materialSnapshot = { languageData: { name: 'Admitted package', settings: { fixed: {} } }, lookup: null };
    const initial = makeEmptyStore({ flashcards: { [card.id]: card } });
    initial.meta.reviewPresentations = { ja: { id: decision.id, cardId: card.id, decision, materialSnapshot } };
    flashcardsCb(initial);
    try {
      await ctx.submitRating(card.content.front, [{ capability: 'sense-recognition', quality: 'fluent' }], {
        language: 'ja', attemptId: 'original-response', decision, scaffolds, timing,
        scheduler: { cardId: card.id, rating: 'good', tested: ['sense-recognition'] },
      });
      await ctx.undoLastAction();
      expect(ctx.store.meta.reviewPresentations?.ja).toMatchObject({ decision, materialSnapshot,
        correction: { attemptId: 'original-response', scaffolds, timing } });
      const saved = JSON.parse(JSON.stringify(ctx.store)) as FlashcardStore;
      flashcardsCb(saved);
      await ctx.submitRating(card.content.front, [{ capability: 'sense-recognition', quality: 'fluent' }], {
        language: 'ja', attemptId: 'corrected-response', decision,
        scaffolds: { 'prior-cue-exposure': true },
        scheduler: { cardId: card.id, rating: 'good', tested: ['sense-recognition'] },
      });
      expect(ctx.store.flashcards[card.id].reviews).toBe(4);
      expect(ctx.store.flashcards[card.id].dueDate).toBeGreaterThan(Date.now());
      expect(ctx.store.meta.reviewPresentations?.ja).toBeUndefined();
      const events = mockAppendEvents.mock.calls.flatMap(([byKey]) => Object.values(byKey as Record<string, Array<Record<string, unknown>>>).flat());
      const replacement = events.filter(event => event.attemptId === 'corrected-response');
      expect(replacement.find(event => event.kind === 'rating')).toMatchObject({
        correctsAttemptId: 'original-response', scaffolds, latencyMs: 2100, activeLatencyMs: 1800,
        decisionRef: { id: decision.id },
      });
      expect(replacement.find(event => event.kind === 'review')?.retentionCondition).toBeUndefined();
      expect(events.filter(event => event.kind === 'retraction' && event.retracts === 'original-response')).toHaveLength(1);
    } finally { dispose(); }
  });

  it('atomically restores review presentation and arbitrary assistance with Undo and consumes it on the next rating', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'restored-presentation', language: 'ja', state: 'review', reviews: 3,
      interval: 86_400_000, dueDate: Date.now() - 1000, content: { type: 'word', front: '学校', back: 'school' } });
    const scaffolds = { 'provided-access:future:relationship': true };
    flashcardsCb(makeEmptyStore({ flashcards: { [card.id]: card } }));
    try {
      await ctx.submitRating('学校', [{ capability: 'sense-recognition', quality: 'fluent' }], {
        language: 'ja', attemptId: 'presentation-undo' as AttemptId, scaffolds,
        scheduler: { cardId: card.id, rating: 'good', tested: ['sense-recognition'] },
      });
      await ctx.undoLastAction();
      const exposedScaffolds = { ...scaffolds, 'provided-access:sense-recognition': true, 'prior-cue-exposure': true };
      expect(ctx.store.meta.reviewPresentations?.ja).toEqual({ id: 'presentation-undo', cardId: card.id, scaffolds: exposedScaffolds });
      const persisted = mockBridge.flashcards.saveFlashcards.mock.calls.at(-1)![0] as FlashcardStore;
      expect(persisted.meta.reviewPresentations?.ja).toEqual(ctx.store.meta.reviewPresentations?.ja);
      expect(persisted.pendingRetraction).toBeUndefined();
      // Serialization/hydration must retain unknown capability flags.
      flashcardsCb(JSON.parse(JSON.stringify(persisted)) as FlashcardStore);
      expect(ctx.store.meta.reviewPresentations?.ja?.scaffolds).toEqual(exposedScaffolds);
      await ctx.submitRating('学校', [{ capability: 'sense-recognition', quality: 'fluent' }], {
        language: 'ja', attemptId: 'after-presentation-undo' as AttemptId, scaffolds,
        scheduler: { cardId: card.id, rating: 'good', tested: ['sense-recognition'] },
      });
      expect(ctx.store.meta.reviewPresentations?.ja).toBeUndefined();
    } finally { dispose(); }
  });

  it('inherits restored assistance at canonical admission even when another review surface omits it', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'restored-canonical', language: 'ja', state: 'review', reviews: 3,
      interval: 86_400_000, dueDate: Date.now() - 1000, content: { type: 'word', front: '学校', back: 'school' } });
    const data = makeEmptyStore({ flashcards: { [card.id]: card } });
    data.meta.reviewPresentations = { ja: { id: 'restored-owner', cardId: card.id,
      scaffolds: { 'provided-access:sense-recognition': true, 'provided-access:future:relation': true } } };
    flashcardsCb(data);
    try {
      await ctx.submitRating('学校', [{ capability: 'sense-recognition', quality: 'fluent' }], {
        language: 'ja', attemptId: 'canonical-restored-rating' as AttemptId,
        scaffolds: { reading: true, 'provided-access:sense-recognition': false },
        scheduler: { cardId: card.id, rating: 'good', tested: ['sense-recognition'] },
      });
      const events = mockAppendEvents.mock.calls.flatMap(([byKey]) => Object.values(byKey as Record<string, Array<Record<string, unknown>>>).flat());
      expect(events.filter(event => event.attemptId === 'canonical-restored-rating' && event.kind === 'rating')).toEqual([]);
      expect(events.find(event => event.attemptId === 'canonical-restored-rating' && event.kind === 'review')).toMatchObject({
        retentionCondition: 'supplied', scaffolds: { reading: true, 'provided-access:sense-recognition': true, 'provided-access:future:relation': true },
      });
      expect(ctx.store.flashcards[card.id].reviews).toBe(3);
      expect(ctx.store.meta.reviewPresentations?.ja).toBeUndefined();
    } finally { dispose(); }
  });

  // A durable cursor exists on an ordinary resumed library whether or not the
  // learner saw any assistance - it is how the surface knows where it was. That
  // is `scaffolds: undefined`, which is what an unassisted review leaves behind.
  // Reading "a cursor exists" as "this response is assisted" routed every rating
  // of a resumed card through an acknowledged store write, putting a whole
  // disk round-trip between the keypress and the next card.
  it('keeps an unassisted rating on the background route even when a cursor exists for the card', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'resumed-unassisted', language: 'ja', state: 'review', reviews: 3,
      interval: 86_400_000, dueDate: Date.now() - 1000, content: { type: 'word', front: '学校', back: 'school' } });
    const data = makeEmptyStore({ flashcards: { [card.id]: card } });
    // Exactly what an ordinary resume holds: a position, and no assistance.
    data.meta.reviewPresentations = { ja: { id: 'restored-plain', cardId: card.id } };
    flashcardsCb(data);
    try {
      await ctx.submitRating('学校', [{ capability: 'sense-recognition', quality: 'fluent' }], {
        language: 'ja', attemptId: 'resumed-unassisted-rating' as AttemptId,
        persistence: 'background',
        scheduler: { cardId: card.id, rating: 'good', tested: ['sense-recognition'] },
      });
      // The acknowledged path is the only one that commits rather than queues.
      expect(mockBridge.flashcards.commitFlashcardRating, 'background must not be upgraded to immediate').not.toHaveBeenCalled();
      expect(mockBridge.flashcards.enqueueFlashcardRating).toHaveBeenCalledTimes(1);
      // The cursor is still consumed, so a resume does not replay.
      expect(ctx.store.meta.reviewPresentations?.ja).toBeUndefined();
      expect(ctx.store.flashcards[card.id].reviews).toBe(4);
    } finally { dispose(); }
  });

  // The scaffold merge itself is unaffected by the route: it runs before the
  // scheduler derives the retention condition, so a cue the caller tried to
  // erase is still recorded on the durable background command.
  it('keeps restored assistance on the background command without forcing an acknowledged write', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'resumed-assisted', language: 'ja', state: 'review', reviews: 3,
      interval: 86_400_000, dueDate: Date.now() - 1000, content: { type: 'word', front: '学校', back: 'school' } });
    const data = makeEmptyStore({ flashcards: { [card.id]: card } });
    data.meta.reviewPresentations = { ja: { id: 'restored-assisted', cardId: card.id,
      scaffolds: { 'provided-access:sense-recognition': true } } };
    flashcardsCb(data);
    try {
      await ctx.submitRating('学校', [{ capability: 'sense-recognition', quality: 'fluent' }], {
        language: 'ja', attemptId: 'resumed-assisted-rating' as AttemptId,
        // The caller tries to ERASE the admitted cue.
        scaffolds: { 'provided-access:sense-recognition': false },
        persistence: 'background',
        scheduler: { cardId: card.id, rating: 'good', tested: ['sense-recognition'] },
      });
      const events = mockBridge.flashcards.enqueueFlashcardRating.mock.calls.flatMap(([command]) =>
        Object.values((command as FlashcardRatingCommand).events).flat());
      expect(events.find(event => event.schedulerCardId === card.id)).toMatchObject({
        retentionCondition: 'supplied', scaffolds: { 'provided-access:sense-recognition': true },
      });
      expect(mockBridge.flashcards.commitFlashcardRating).not.toHaveBeenCalled();
      expect(mockBridge.flashcards.enqueueFlashcardRating).toHaveBeenCalledTimes(1);
    } finally { dispose(); }
  });

  it('preserves another card restored in the same language when rating an unrelated card', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'unrelated-rating', language: 'ja', state: 'review', reviews: 3,
      interval: 86_400_000, dueDate: Date.now() - 1000, content: { type: 'word', front: '学校', back: 'school' } });
    const data = makeEmptyStore({ flashcards: { [card.id]: card } });
    const restored = { id: 'restored-other', cardId: 'other-card', scaffolds: { 'provided-access:sense-recognition': true } };
    data.meta.reviewPresentations = { ja: restored };
    flashcardsCb(data);
    try {
      await ctx.submitRating('学校', [{ capability: 'sense-recognition', quality: 'fluent' }], {
        language: 'ja', scheduler: { cardId: card.id, rating: 'good', tested: ['sense-recognition'] },
      });
      expect(ctx.store.meta.reviewPresentations?.ja).toEqual(restored);
      expect(ctx.store.flashcards[card.id].reviews).toBe(4);
    } finally { dispose(); }
  });

  it.each(['consumed', 'newer-owner', 'language-edit', 'surface-edit'] as const)('retains original admitted assistance across a failed projection ACK and peer %s before retry', async peerChange => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'failed-admission', language: 'ja', state: 'review', reviews: 3,
      interval: 86_400_000, dueDate: Date.now() - 1000, content: { type: 'word', front: '学校', back: 'school' } });
    const data = makeEmptyStore({ flashcards: { [card.id]: card } });
    const scaffolds = { 'provided-access:sense-recognition': true, 'provided-access:future:relation': true };
    data.meta.reviewPresentations = { ja: { id: 'failed-admission-owner', cardId: card.id, scaffolds } };
    flashcardsCb(data);
    const options = { language: 'ja', attemptId: 'retained-admission' as AttemptId, scaffolds: { reading: true },
      scheduler: { cardId: card.id, rating: 'good' as const, tested: ['sense-recognition'] } };
    try {
      mockBridge.flashcards.saveFlashcardPatch.mockRejectedValueOnce(new Error('disk full'));
      await expect(ctx.submitRating('学校', [{ capability: 'sense-recognition', quality: 'fluent' }], options)).rejects.toThrow('scheduler persistence');
      const peer = makeEmptyStore({ flashcards: { [card.id]: { ...card, reviews: 4 } }, rev: (ctx.store.rev ?? 0) + 1 });
      const newer = { id: 'newer-undo-owner', cardId: card.id, scaffolds: { 'provided-access:future:other': true } };
      if (peerChange === 'newer-owner') peer.meta.reviewPresentations = { ja: newer };
      if (peerChange === 'language-edit') peer.flashcards[card.id].language = 'ja2';
      if (peerChange === 'surface-edit') peer.flashcards[card.id].content.front = '新しい';
      flashcardsCb(peer);
      expect(ctx.store.meta.reviewPresentations?.ja).toEqual(peerChange === 'newer-owner' ? newer : undefined);
      const changedRetry = { ...options, scaffolds: { reading: false },
        scheduler: { ...options.scheduler, rating: 'hard' as const, tested: ['sense-recognition', 'future:other'] } };
      const retry = ctx.submitRating('学校', [{ capability: 'sense-recognition', quality: 'missed' },
        { capability: 'future:other', quality: 'fluent' }], changedRetry);
      if (peerChange === 'language-edit' || peerChange === 'surface-edit') {
        await expect(retry).rejects.toThrow(peerChange === 'language-edit' ? 'admitted language' : 'admitted prompt');
        const originalRows = Object.values(knowledgeJournal.allRows()).flat().filter(event => event.attemptId === 'retained-admission');
        expect(originalRows).toHaveLength(1);
        expect(originalRows[0]).toMatchObject({ kind: 'review', retentionCondition: 'supplied', scaffolds });
        return;
      }
      await retry;
      const events = mockAppendEvents.mock.calls.flatMap(([byKey]) => Object.values(byKey as Record<string, Array<Record<string, unknown>>>).flat())
        .filter(event => event.attemptId === 'retained-admission');
      expect(events.filter(event => event.kind === 'rating')).toEqual([]);
      expect(events.filter(event => event.kind === 'review')).toHaveLength(2);
      for (const event of events) expect(event).toMatchObject({ retentionCondition: 'supplied',
        scaffolds: { reading: true, ...scaffolds } });
      expect(ctx.store.flashcards[card.id].reviews).toBe(4);
      expect(ctx.store.meta.reviewPresentations?.ja).toEqual(peerChange === 'newer-owner' ? newer : undefined);
    } finally { dispose(); }
  });

  it.each([false, true])('restores presentation and prior assistance for a non-rating card Undo (assisted=%s)', async assisted => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'bury-presentation', language: 'ja' });
    const data = makeEmptyStore({ flashcards: { [card.id]: card } });
    const scaffolds = { 'provided-access:future:relationship': true };
    if (assisted) data.meta.reviewPresentations = { ja: { id: 'prior-assisted-owner', cardId: card.id, scaffolds } };
    flashcardsCb(data);
    try {
      ctx.buryCard(card.id);
      expect(ctx.store.flashcards[card.id].buried).toBe(true);
      await ctx.undoLastAction();
      expect(ctx.store.flashcards[card.id].buried).not.toBe(true);
      expect(ctx.store.meta.reviewPresentations?.ja?.cardId).toBe(card.id);
      expect(ctx.store.meta.reviewPresentations?.ja?.id).toBeTypeOf('string');
      expect(ctx.store.meta.reviewPresentations?.ja?.scaffolds).toEqual(assisted ? scaffolds : undefined);
    } finally { dispose(); }
  });

  it('routes a legacy card Undo to the originally admitted language', async () => {
    mockSettings.language = 'ja2';
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'legacy-undo-language', language: undefined,
      state: 'review', reviews: 3, interval: 86_400_000, dueDate: Date.now() - 1000,
      content: { type: 'word', front: '学校', back: 'school' } });
    flashcardsCb(makeEmptyStore({ flashcards: { [card.id]: card } }));
    try {
      await ctx.submitRating('学校', [{ capability: 'sense-recognition', quality: 'fluent' }], {
        language: 'ja', attemptId: 'legacy-original-language' as AttemptId,
        scheduler: { cardId: card.id, rating: 'good', tested: ['sense-recognition'] },
      });
      await ctx.undoLastAction();
      expect(ctx.store.meta.reviewPresentations?.ja?.id).toBe('legacy-original-language');
      expect(ctx.store.meta.reviewPresentations?.ja2).toBeUndefined();
      const events = knowledgeJournal.allRows()[`ja:${SRS.hashWordSync('学校')}`] ?? [];
      expect(events.some(event => event.kind === 'retraction' && event.retracts === 'legacy-original-language')).toBe(true);
    } finally { dispose(); mockSettings.language = 'ja'; }
  });

  it('creates a fresh attempt when the same rating is submitted after Undo', async () => {
    mockSettings.language = 'ja2';
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({
      id: 'card-repeat-rating',
      language: 'ja2',
      content: { type: 'word', front: '学校', back: 'school' },
      state: 'review',
      reviews: 3,
      interval: 86_400_000,
      dueDate: Date.now() - 1000,
    });
    flashcardsCb(makeEmptyStore({ flashcards: { [card.id]: card } }));

    const first = await ctx.submitRating('学校', [{ capability: 'sense-recognition', quality: 'fluent' }], {
      language: 'ja2',
      scheduler: { cardId: card.id, rating: 'good', tested: ['sense-recognition'] },
    });
    await ctx.undoLastAction();
    const second = await ctx.submitRating('学校', [{ capability: 'sense-recognition', quality: 'fluent' }], {
      language: 'ja2',
      scheduler: { cardId: card.id, rating: 'good', tested: ['sense-recognition'] },
    });

    expect(second.attemptId).not.toBe(first.attemptId);
    const reviewEvents = mockAppendEvents.mock.calls.flatMap(([byKey]) =>
      Object.values(byKey as Record<string, KnowledgeEvent[]>).flat(),
    ).filter((event) => event.kind === 'review');
    expect(reviewEvents.map((event) => event.attemptId)).toEqual([first.attemptId, second.attemptId]);
    dispose();
    mockSettings.language = 'ja';
  });

  it.each([true, false])('rejects addFlashcard when the write is refused for a reason a rebase cannot fix (Electron=%s)', async electron => {
    mockIsElectron.mockReturnValue(electron);
    // The product question is "did my card get saved?", and every capture
    // surface answers it by catching whatever `addFlashcard` throws and routing
    // it to `reportCaptureFailure`. `addFlashcard` therefore has to reject when
    // the write does not land.
    //
    // It used to call the debounced `saveFlashcards()`, which is fire and
    // forget: it returns void, and the refusal is logged inside
    // `saveFlashcardsImmediate` and swallowed. So a card that never reached
    // disk resolved successfully, the surface showed success, the word stayed
    // in the unknown-words list as a card, and the learner's deck was
    // permanently one card short of what they were told it held. The
    // capture-failure architecture could never see it, because nothing was
    // ever thrown.
    //
    // A stale-revision refusal is NOT this case: that one is rebased onto the
    // authority and replayed, and the card legitimately survives.
    mockSettings.language = 'ja';
    installStrictSaveRevision();
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    seed(makeEmptyStore());
    await vi.waitFor(() => expect(ctx.isKnowledgeReady()).toBe(true));

    // A full disk, a torn file, an interrupted process: the write did not
    // happen and re-reading the authority cannot change that.
    mockBridge.flashcards.saveFlashcards.mockRejectedValueOnce(new Error('ENOSPC: no space left on device'));

    await expect(ctx.addFlashcard(
      { front: ' 保存失败', back: 'save failed', type: 'word', word: '保存失败' },
      undefined, true, 'ja',
    )).rejects.toThrow(/ENOSPC|no space left/i);

    // A card that is not on disk must not be left in the rendered deck either.
    // Reporting the failure while still showing the card is the same
    // contradiction this campaign has been removing elsewhere: the surface
    // says "that failed" and the list beside it says "mLearn card".
    const lk2 = `ja:${SRS.hashWordSync(' 保存失败')}`;
    const leaked = Object.values(ctx.store.flashcards).find((c) => c.word === ' 保存失败');
    expect(leaked, 'the un-persisted card must not remain in the rendered deck').toBeUndefined();
    expect(ctx.store.wordToCardMap[lk2] ?? []).toEqual([]);
    expect(ctx.getCardByWordSync(' 保存失败', 'ja')).toBeFalsy();

    dispose();
  });

  it('refreshes the complete authority when a sparse rating commits after an unseen peer write', async () => {
    answerProbesFromAuthority();
    const mine = makeCard({ id: 'patch-mine', state: 'review', reviews: 2, dueDate: Date.now() - 1000 });
    const peer = makeCard({ id: 'patch-peer', reviews: 7 });
    const { ctx, dispose } = await mountProvider();
    seed(makeEmptyStore({ rev: 5, flashcards: { [mine.id]: mine, [peer.id]: peer } }));
    const other = structuredClone(committed!);
    other.flashcards[peer.id].content.back = 'peer changed the answer';
    await mockBridge.flashcards.saveFlashcards(other, [], false, undefined);
    await ctx.submitRating(mine.content.front, [], { scheduler: { cardId: mine.id, rating: 'good' } });
    expect(committed?.flashcards[peer.id].content.back).toBe('peer changed the answer');
    expect(ctx.store.flashcards[peer.id].content.back).toBe('peer changed the answer');
    expect(ctx.store.rev).toBe(revision);
    dispose();
  });

  it('preserves an edit queued while an Undo is waiting for the authority', async () => {
    const mine = makeCard({ id: 'undo-wait', state: 'review', reviews: 2, dueDate: Date.now() - 1000 });
    const { ctx, dispose } = await mountProvider();
    seed(makeEmptyStore({ rev: 5, flashcards: { [mine.id]: mine } }));
    await ctx.submitRating(mine.content.front, [], { scheduler: { cardId: mine.id, rating: 'good' } });
    const peer = structuredClone(committed!);
    await mockBridge.flashcards.saveFlashcards(peer, [], false, undefined);
    mockBridge.flashcards.getFlashcards.mockClear();
    const undo = ctx.undoLastAction();
    await vi.waitFor(() => expect(mockBridge.flashcards.getFlashcards).toHaveBeenCalled());
    await ctx.setAccessClaim('new edit during Undo', 'sense-recognition', 'known', 'ja');
    const key = `ja:${SRS.hashWordSync('new edit during Undo')}`;
    deliver(committed!);
    expect(await undo).toBe('answer');
    expect(ctx.store.wordKnowledge[key]?.access?.['sense-recognition']?.claim).toBe('known');
    await vi.waitFor(() => expect(committed?.wordKnowledge[key]?.access?.['sense-recognition']?.claim).toBe('known'));
    dispose();
  });

  it.each([true, false])('lands a refused write by replaying it onto what the other window committed (Electron=%s)', async electron => {
    mockIsElectron.mockReturnValue(electron);
    // Every window holds the same provider over the same whole-snapshot store,
    // so two of them writing at once is ordinary rather than exceptional. The
    // loser's write used to be refused outright and dropped, taking the
    // learner's rating with it - and the window's rendered store was left
    // disagreeing with the file in the other direction.
    answerProbesFromAuthority();
    const mine = makeCard({ id: 'race-mine', state: 'review', interval: 86_400_000, dueDate: Date.now() - 1000, reviews: 2 });
    const theirs = makeCard({ id: 'race-theirs', reviews: 7 });
    const { ctx, dispose } = await mountProvider();
    seed(makeEmptyStore({ flashcards: { [mine.id]: mine, [theirs.id]: theirs }, rev: 5 }));
    expect(ctx.store.rev).toBe(5);

    // The rating is real: giving it is what records the Undo, and the Undo
    // restores the card to the state captured here.
    await ctx.submitRating(mine.content.front, [{ capability: 'sense-recognition', quality: 'fluent' }], {
      attemptId: 'race-mine-attempt' as AttemptId,
      language: mine.language,
      scheduler: { cardId: mine.id, rating: 'good', tested: ['sense-recognition'] },
    });
    expect(ctx.store.flashcards[mine.id].reviews).toBe(mine.reviews + 1);
    expect(ctx.canUndo()).toBe(true);

    // The other window commits while this one is not looking. This window is
    // still holding the revision before its own rating, and so is the Undo it
    // is about to make - two windows writing the whole store, which is the
    // ordinary case, not an edge case.
    const beforeRace = ctx.store.rev;
    const otherWindow = JSON.parse(JSON.stringify(ctx.store)) as FlashcardStore;
    otherWindow.flashcards[theirs.id].reviews = 8;
    otherWindow.rev = beforeRace;
    await mockBridge.flashcards.saveFlashcards(otherWindow, [], false, undefined);
    expect(revision).toBe(beforeRace + 1);

    await expect(ctx.undoLastAction()).resolves.toBe('answer');
    await vi.waitFor(() => expect(ctx.store.rev).toBe(revision));

    // Both windows' work is in the file. The refused write was replayed onto
    // what the other window committed rather than overwriting it.
    expect(committed?.flashcards[mine.id].reviews).toBe(mine.reviews);
    expect(committed?.flashcards[theirs.id].reviews).toBe(8);
    expect(committed?.rev).toBe(revision);
    // And this window renders what was written, not the snapshot it lost.
    expect(ctx.store.flashcards[theirs.id].reviews).toBe(8);
    expect(ctx.store.flashcards[mine.id].reviews).toBe(mine.reviews);
    dispose();
  });


  it('rebases a refused write the way the real IPC boundary delivers a refusal', async () => {
    // Every refusal test above drives the authority through a plain
    // `Error(message)`. The live app never delivers that: a throw raised in the
    // main process crosses the IPC boundary as
    // "Error invoking remote method 'save-flashcards': Error: <message>", which
    // keeps the message and loses every other property.
    //
    // Matching only the start of that text therefore never recognizes a real
    // refusal. The rebase never engaged, and a write that another window had
    // merely won a race against - one the learner would never know had been lost
    // - was reported as a failed save instead, dropping their rating with it.
    answerProbesFromAuthority();
    const mine = makeCard({ id: 'ipc-mine', state: 'review', interval: 86_400_000, dueDate: Date.now() - 1000, reviews: 2 });
    const theirs = makeCard({ id: 'ipc-theirs', reviews: 7 });
    const startingStore = makeEmptyStore({ flashcards: { [mine.id]: mine, [theirs.id]: theirs }, rev: 5 });
    const { ctx, dispose } = await mountProvider();
    seed(startingStore);
    ctx.refreshQueue();
    expect(ctx.store.rev).toBe(5);

    // The same strict revision check, but refusing the way a real invocation
    // refuses. Nothing else about the authority changes, so the only variable
    // is the shape of the rejection.
    mockBridge.flashcards.saveFlashcards.mockImplementation((saved: FlashcardStore) => {
      if ((saved.rev ?? 0) !== revision) {
        return Promise.reject(new Error(
          "Error invoking remote method 'save-flashcards': Error: " +
          staleFlashcardRevisionMessage(revision, saved.rev ?? 0),
        ));
      }
      revision += 1;
      committed = structuredClone(saved);
      committed.rev = revision;
      acceptedSaves.push(structuredClone(committed));
      return Promise.resolve(revision);
    });

    // The other window commits first, from a snapshot taken before this window
    // rated anything.
    const otherWindow = JSON.parse(JSON.stringify(startingStore)) as FlashcardStore;
    otherWindow.flashcards[theirs.id].reviews = 8;
    otherWindow.rev = 5;
    await mockBridge.flashcards.saveFlashcards(otherWindow, [], false, undefined);
    expect(revision).toBe(6);

    await ctx.submitRating(mine.content.front, [{ capability: 'sense-recognition', quality: 'fluent' }], {
      attemptId: 'ipc-mine-attempt' as AttemptId,
      language: mine.language,
    });
    const knowledgeKeys = Object.keys(ctx.store.wordKnowledge);
    expect(knowledgeKeys).toHaveLength(1);

    // The refusal arrives wrapped. A window that cannot recognize it drops the
    // rating and reports a failed save; a window that can rebases, and the
    // rating lands. Waiting on the committed revision - not on it having been
    // touched at all - is what distinguishes the two: the other window's write
    // already satisfied the weaker condition.
    await vi.waitFor(() => {
      expect(committed?.rev).toBe(7);
      expect(Object.keys(committed?.wordKnowledge ?? {})).toEqual(knowledgeKeys);
      expect(committed?.flashcards[theirs.id].reviews).toBe(8);
    }, { timeout: 5000 });

    expect(ctx.store.flashcards[theirs.id].reviews).toBe(8);
    expect(Object.keys(ctx.store.wordKnowledge)).toEqual(knowledgeKeys);
    dispose();
  });

  it('lands a refused whole-snapshot write by diffing the durable baseline, not replaying nothing', async () => {
    // Most writes are not scheduler ratings. A knowledge-only rating - the word
    // sync drill and the grammar drill both go through this one - applies its
    // decision to the in-memory store and then asks for that whole state to be
    // persisted, with no transform to describe what it decided.
    //
    // So the decision this window is persisting is everything between the last
    // store the authority confirmed and the store as it now stands. Recording
    // no intent for it meant a refused write rebased onto an empty delta: the
    // authority's store was written straight back and the learner's rating was
    // dropped - the one loss the rebase exists to prevent.
    answerProbesFromAuthority();
    const mine = makeCard({ id: 'snap-mine', state: 'review', interval: 86_400_000, dueDate: Date.now() - 1000, reviews: 2 });
    const theirs = makeCard({ id: 'snap-theirs', reviews: 7 });
    const startingStore = makeEmptyStore({ flashcards: { [mine.id]: mine, [theirs.id]: theirs }, rev: 5 });
    const { ctx, dispose } = await mountProvider();
    seed(startingStore);
    ctx.refreshQueue();
    expect(ctx.store.rev).toBe(5);

    // The other window commits first, from a snapshot taken before this window
    // rated anything. This is the ordinary race: it moves the authority on
    // while this window is still holding the revision it will write from.
    const otherWindow = JSON.parse(JSON.stringify(startingStore)) as FlashcardStore;
    otherWindow.flashcards[theirs.id].reviews = 8;
    otherWindow.rev = 5;
    await mockBridge.flashcards.saveFlashcards(otherWindow, [], false, undefined);
    expect(revision).toBe(6);

    // Now this window rates, with no scheduler: the debounced whole-snapshot
    // path is what carries it. The window is deliberately not re-synced first,
    // so the write it composes carries the revision the authority has already
    // moved past and is refused.
    await ctx.submitRating(mine.content.front, [{ capability: 'sense-recognition', quality: 'fluent' }], {
      attemptId: 'snap-mine-attempt' as AttemptId,
      language: mine.language,
    });
    const knowledgeKeys = Object.keys(ctx.store.wordKnowledge);
    expect(knowledgeKeys).toHaveLength(1);
    expect(ctx.store.rev).toBe(5);

    // The refused write is replayed onto what the other window committed, which
    // is a second accepted write. Waiting only on the committed store would be
    // satisfied by the other window's write, so the rebased revision is what
    // this waits on.
    await vi.waitFor(() => {
      expect(committed?.rev).toBe(7);
      // The rating's own evidence is in the file...
      expect(Object.keys(committed?.wordKnowledge ?? {})).toEqual(knowledgeKeys);
      // ...and the other window's work survived the replay, which is what
      // makes the replay a decision rather than a snapshot.
      expect(committed?.flashcards[theirs.id].reviews).toBe(8);
    }, { timeout: 5000 });

    // And this window renders what was written.
    expect(ctx.store.flashcards[theirs.id].reviews).toBe(8);
    expect(Object.keys(ctx.store.wordKnowledge)).toEqual(knowledgeKeys);
    dispose();
  });

  it('preserves an unrelated local mutation while a scheduler write is pending', async () => {
    let acknowledgeSave!: () => void;
    mockBridge.flashcards.saveFlashcards.mockImplementation((saved: FlashcardStore) => new Promise((resolve, reject) => {
      if ((saved.rev ?? 0) !== revision) {
        return reject(new Error(staleFlashcardRevisionMessage(revision, saved.rev ?? 0)));
      }
      revision += 1;
      committed = structuredClone(saved);
      acceptedSaves.push(structuredClone(saved));
      acknowledgeSave = () => resolve(revision);
    }));
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'card-concurrent-rating' });
    seed(makeEmptyStore({ flashcards: { [card.id]: card } }));
    const submission = ctx.submitRating(card.content.front, [], {
      attemptId: 'concurrent-rating-attempt' as AttemptId,
      scheduler: { cardId: card.id, rating: 'good' },
    });
    await vi.waitFor(() => expect(mockBridge.flashcards.saveFlashcards).toHaveBeenCalled());

    ctx.updateMeta({ maxReviewsPerDay: 37 });
    acknowledgeSave();
    await submission;

    expect(ctx.store.meta.maxReviewsPerDay).toBe(37);
    dispose();
  });

  it('composes the next write over the authority, not a stale redelivery', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'stale-redelivery-card', reviews: 3 });
    seed(makeEmptyStore({ flashcards: { [card.id]: card }, rev: 10 }));
    expect(ctx.store.rev).toBe(10);

    // A focus/visibility sync can redeliver a snapshot that predates what this
    // window has already adopted - two probes settling out of order, or a reply
    // to a write this window made. Adopting it would rewind the revision the
    // window writes with, and the main process then refuses every write as
    // stale: the learner sees their Undo come back as a failed save for a save
    // they never saw fail.
    flashcardsCb(makeEmptyStore({ flashcards: { [card.id]: card }, rev: 7 }));
    expect(ctx.store.rev).toBe(10);

    ctx.pushUndoState({ type: 'answer', cardId: card.id });
    await expect(ctx.undoLastAction()).resolves.toBe('answer');

    expect(acceptedSaves.length).toBe(1);
    expect(ctx.store.rev).toBe(11);
    expect(ctx.store.flashcards[card.id].reviews).toBe(3);
    dispose();
  });

  it('preserves a newer incoming broadcast while a scheduler write is pending', async () => {
    const state: { handler: ((event: MessageEvent) => void) | null } = { handler: null };
    function MockBroadcastChannel() {
      return {
        postMessage: vi.fn(),
        close: vi.fn(),
        set onmessage(fn: ((event: MessageEvent) => void) | null) { state.handler = fn; },
        get onmessage() { return state.handler; },
      };
    }
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);
    let acknowledgeSave!: () => void;
    mockBridge.flashcards.saveFlashcards.mockImplementation((saved: FlashcardStore) => new Promise((resolve, reject) => {
      if ((saved.rev ?? 0) !== revision) {
        return reject(new Error(staleFlashcardRevisionMessage(revision, saved.rev ?? 0)));
      }
      revision += 1;
      committed = structuredClone(saved);
      acceptedSaves.push(structuredClone(saved));
      acknowledgeSave = () => resolve(revision);
    }));
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'card-broadcast-rating' });
    seed(makeEmptyStore({ flashcards: { [card.id]: card } }));
    const submission = ctx.submitRating(card.content.front, [], {
      attemptId: 'broadcast-rating-attempt' as AttemptId,
      scheduler: { cardId: card.id, rating: 'good' },
    });
    await vi.waitFor(() => expect(mockBridge.flashcards.saveFlashcards).toHaveBeenCalled());

    const remoteCandidate = { count: 2, lastSeen: Date.now(), word: '別の語', language: 'ja' };
    state.handler!({ data: { type: 'update', store: makeEmptyStore({ rev: revision, wordCandidates: { 'ja:別の語': remoteCandidate } }) } } as MessageEvent);
    acknowledgeSave();
    await submission;

    expect(ctx.store.wordCandidates['ja:別の語']).toEqual(remoteCandidate);
    dispose();
    vi.unstubAllGlobals();
  });

  it('restores the original pre-review card when a saved response hydrates before its failed ACK is retried', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'recovered-before-retry', state: 'review', reviews: 3,
      interval: 86_400_000, dueDate: Date.now() - 1000,
      content: { type: 'word', front: '学校', back: 'school' } });
    flashcardsCb(makeEmptyStore({ flashcards: { [card.id]: card } }));
    const command = { language: 'ja', attemptId: 'lost-ack' as AttemptId,
      scheduler: { cardId: card.id, rating: 'good' as const, tested: ['sense-recognition'] } };
    let saved!: FlashcardRatingCommand;
    mockBridge.flashcards.commitFlashcardRating.mockImplementationOnce(async rating => {
      saved = rating;
      if (await mockAppendEvents(rating.events) === false) throw new Error('journal failed');
      throw new Error('acknowledgement interrupted');
    });
    try {
      await expect(ctx.submitRating(card.content.front, [{ capability: 'sense-recognition', quality: 'fluent' }], command)).rejects.toThrow('acknowledgement interrupted');
      const recovered = makeEmptyStore({ flashcards: { [card.id]: card } });
      applyStorePatch(recovered as unknown as Record<string, unknown>, saved.patch);
      recovered.rev = 1;
      flashcardsCb(recovered);
      expect(ctx.store.flashcards[card.id].reviews).toBe(4);
      await ctx.submitRating(card.content.front, [{ capability: 'sense-recognition', quality: 'fluent' }], command);
      await ctx.undoLastAction();
      expect(ctx.store.flashcards[card.id].reviews).toBe(3);
      expect(mockBridge.flashcards.saveFlashcards.mock.calls.at(-1)?.[3]).toEqual({
        kind: 'undo-review', cardId: card.id, restoredReviews: 3,
      });
    } finally { dispose(); }
  });

  it('keeps a durably acknowledged rating successful and undoable when peer publication throws', async () => {
    vi.stubGlobal('BroadcastChannel', class {
      postMessage() { throw new Error('channel closed'); }
      close() {}
      set onmessage(_handler: (event: MessageEvent) => void) {}
    });
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'notification-failure', state: 'review', reviews: 3,
      interval: 86_400_000, dueDate: Date.now() - 1000,
      content: { type: 'word', front: '学校', back: 'school' } });
    flashcardsCb(makeEmptyStore({ flashcards: { [card.id]: card } }));
    try {
      await expect(ctx.submitRating(card.content.front, [], {
        scheduler: { cardId: card.id, rating: 'good' },
      })).resolves.toBeDefined();
      expect(ctx.store.flashcards[card.id].reviews).toBe(4);
      await ctx.undoLastAction();
      expect(ctx.store.flashcards[card.id].reviews).toBe(3);
    } finally {
      dispose();
      vi.unstubAllGlobals();
    }
  });

  it('broadcasts ratings as small patches and reloads peers that missed a revision', async () => {
    let receive!: (event: MessageEvent) => void;
    const postMessage = vi.fn();
    vi.stubGlobal('BroadcastChannel', class {
      postMessage = postMessage;
      close() {}
      set onmessage(handler: (event: MessageEvent) => void) { receive = handler; }
    });
    let dispose: (() => void) | undefined;
    try {
      const mounted = await mountProvider();
      const ctx = mounted.ctx;
      dispose = mounted.dispose;
      const card = makeCard({ id: 'peer-card', content: { type: 'word', front: '学校', back: 'school' } });
      flashcardsCb(makeEmptyStore({ rev: 0, flashcards: { [card.id]: card } }));
      await ctx.submitRating(card.content.front, [], { scheduler: { cardId: card.id, rating: 'good' } });
      const message = postMessage.mock.calls.at(-1)?.[0];
      expect(message.type).toBe('patch');
      expect(message.store).toBeUndefined();
      expect(message.patch.entries.every((entry: StorePatch['entries'][number]) => entry.path.length >= 2)).toBe(true);

      const before = JSON.parse(JSON.stringify(ctx.store.flashcards[card.id]));
      const peerPatch = { baseRev: ctx.store.rev, entries: [
        { path: ['flashcards', card.id], before, after: { ...before, suspended: true } },
      ] };
      const revision = (ctx.store.rev ?? 0) + 1;
      receive({ data: { type: 'patch', patch: peerPatch, rev: revision } } as MessageEvent);
      expect(ctx.store.flashcards[card.id].suspended).toBe(true);
      expect(ctx.store.rev).toBe(revision);
      expect(ctx.queue().newQueue).not.toContain(card.id);
      receive({ data: { type: 'patch', patch: peerPatch, rev: revision } } as MessageEvent);
      expect(ctx.store.rev).toBe(revision);
      mockBridge.flashcards.getFlashcards.mockClear();
      receive({ data: { type: 'patch', patch: peerPatch, rev: revision + 2 } } as MessageEvent);
      expect(mockBridge.flashcards.getFlashcards).toHaveBeenCalledOnce();
      expect(ctx.store.rev).toBe(revision);
    } finally {
      dispose?.();
      vi.unstubAllGlobals();
    }
  });

  it('keeps Undo retryable when loading saved history fails instead of treating the failure as empty history', async () => {
    mockBridge.knowledgeEvents.getRatingUndoHistory.mockRejectedValue(new Error('saved Undo unavailable'));
    const { ctx, dispose } = await mountProvider();
    seed(makeEmptyStore());
    await vi.waitFor(() => expect(ctx.canUndo()).toBe(true));
    await expect(ctx.undoLastAction()).rejects.toThrow('saved Undo unavailable');
    expect(ctx.store.pendingRetraction).toBeUndefined();
    mockBridge.knowledgeEvents.getRatingUndoHistory.mockResolvedValue([]);
    await expect(ctx.undoLastAction()).resolves.toBeNull();
    expect(ctx.canUndo()).toBe(false);
    dispose();
  });

  it('offers a completed response Undo after restart and preserves subsequent authored edits and other-card totals', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'completed-restart', state: 'review', reviews: 3,
      interval: 86_400_000, dueDate: Date.now() - 1000 });
    seed(makeEmptyStore({ flashcards: { [card.id]: card } }));
    await ctx.submitRating(card.content.front, [], { attemptId: 'completed-original' as AttemptId,
      scheduler: { cardId: card.id, rating: 'good' } });
    expect(savedReviewUndos).toHaveLength(1);
    const submittedUndo = structuredClone(savedReviewUndos[0]);
    const saved = structuredClone(committed!);
    saved.flashcards[card.id].content.back = 'later authored answer';
    saved.meta.perLanguage.ja.reviewsToday += 2;
    const today = (submittedUndo.restore as { today: string }).today;
    saved.dailyStats[today].ja.reviewCardsStudied += 2;
    dispose();

    const reopened = await mountProvider();
    seed(saved);
    await vi.waitFor(() => expect(reopened.ctx.canUndo()).toBe(true));
    await reopened.ctx.undoLastAction();
    expect(reopened.ctx.store.flashcards[card.id].reviews).toBe(3);
    expect(reopened.ctx.store.flashcards[card.id].content.back).toBe('later authored answer');
    expect(reopened.ctx.store.meta.perLanguage.ja.reviewsToday).toBe(2);
    expect(reopened.ctx.store.dailyStats[today].ja.reviewCardsStudied).toBe(2);
    expect(reopened.ctx.store.pendingRetraction).toBeUndefined();
    expect(reopened.ctx.canUndo()).toBe(false);
    expect(Object.values(knowledgeJournal.allRows()).flat().filter(row => row.retracts === 'completed-original')).toHaveLength(1);
    reopened.dispose();
  });

  it('refuses a stale completed rollback before persisting or retracting when that card was rated again', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'completed-peer', state: 'review', reviews: 3 });
    seed(makeEmptyStore({ flashcards: { [card.id]: card } }));
    await ctx.submitRating(card.content.front, [], { attemptId: 'completed-stale' as AttemptId,
      scheduler: { cardId: card.id, rating: 'good' } });
    const peer = structuredClone(committed!);
    peer.flashcards[card.id].reviews += 1;
    peer.rev = (peer.rev ?? 0) + 1;
    seed(peer);
    expect(ctx.canUndo()).toBe(false);
    const before = mockBridge.flashcards.saveFlashcards.mock.calls.length;
    await expect(ctx.undoLastAction()).resolves.toBeNull();
    expect(mockBridge.flashcards.saveFlashcards).toHaveBeenCalledTimes(before);
    expect(Object.values(knowledgeJournal.allRows()).flat().some(row => row.retracts === 'completed-stale')).toBe(false);
    dispose();
  });

  it('checks refreshed authority before recording a completed Undo or retracting its evidence', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'completed-stale-authority', state: 'review', reviews: 3 });
    seed(makeEmptyStore({ flashcards: { [card.id]: card } }));
    await ctx.submitRating(card.content.front, [], { attemptId: 'stale-authority-original' as AttemptId,
      scheduler: { cardId: card.id, rating: 'good' } });
    committed!.flashcards[card.id].reviews += 1;
    committed!.rev = ++revision;
    answerProbesFromAuthority();
    await expect(ctx.undoLastAction()).rejects.toThrow(/persistence was refused/);
    expect(committed!.pendingRetraction).toBeUndefined();
    expect(committed!.flashcards[card.id].reviews).toBe(5);
    expect(Object.values(knowledgeJournal.allRows()).flat().some(row => row.retracts === 'stale-authority-original')).toBe(false);
    dispose();
  });

  it('recomputes an Undo on newer authored content and unrelated totals when its final save rebases', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'completed-projection-rebase', state: 'review', reviews: 3 });
    seed(makeEmptyStore({ flashcards: { [card.id]: card } }));
    await ctx.submitRating(card.content.front, [], { attemptId: 'projection-rebase-original' as AttemptId,
      scheduler: { cardId: card.id, rating: 'good' } });
    const today = (savedReviewUndos[0].restore as { today: string }).today;
    answerProbesFromAuthority();
    const originalAppend = mockAppendEvents.getMockImplementation()!;
    mockAppendEvents.mockImplementationOnce(async events => {
      const result = await originalAppend(events);
      committed!.flashcards[card.id].content.back = 'peer authored answer during Undo';
      committed!.meta.perLanguage.ja.reviewsToday += 2;
      committed!.dailyStats[today].ja.reviewCardsStudied += 2;
      committed!.rev = ++revision;
      return result;
    });
    await ctx.undoLastAction();
    expect(committed!.flashcards[card.id].reviews).toBe(3);
    expect(committed!.flashcards[card.id].content.back).toBe('peer authored answer during Undo');
    expect(committed!.meta.perLanguage.ja.reviewsToday).toBe(2);
    expect(committed!.dailyStats[today].ja.reviewCardsStudied).toBe(2);
    expect(committed!.pendingRetraction).toBeUndefined();
    dispose();
  });

  it('retries an Undo rebase when a second window advances the authority before the replay write', async () => {
    const attemptId = 'undo-double-rebase-attempt' as AttemptId;
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'undo-double-rebase', state: 'review', reviews: 3,
      interval: 86_400_000, dueDate: Date.now() - 1000 });
    const peer = makeCard({ id: 'undo-double-rebase-peer' });
    seed(makeEmptyStore({ flashcards: { [card.id]: card, [peer.id]: peer } }));
    await ctx.submitRating(card.content.front, [], { attemptId, scheduler: { cardId: card.id, rating: 'good' } });
    answerProbesFromAuthority();

    const originalAppend = mockAppendEvents.getMockImplementation()!;
    mockAppendEvents.mockImplementationOnce(async events => {
      const result = await originalAppend(events);
      committed!.flashcards[peer.id].content.back = 'peer edit before Undo rebase';
      committed!.rev = ++revision;
      return result;
    });
    const originalSave = mockBridge.flashcards.saveFlashcards.getMockImplementation()!;
    let racedRebaseSave = false;
    mockBridge.flashcards.saveFlashcards.mockImplementation((saved, removed, reset, authorization) => {
      const completion = (saved as FlashcardStore & { retractionCompleted?: string }).retractionCompleted;
      if (!racedRebaseSave && completion === attemptId && (saved.rev ?? 0) === revision) {
        racedRebaseSave = true;
        committed!.flashcards[peer.id].content.back = 'peer edit during Undo rebase';
        committed!.rev = ++revision;
      }
      return originalSave(saved, removed, reset, authorization);
    });

    try {
      await expect(ctx.undoLastAction()).resolves.toBe('answer');
      expect(racedRebaseSave).toBe(true);
      expect(committed!.flashcards[card.id].reviews).toBe(3);
      expect(committed!.flashcards[peer.id].content.back).toBe('peer edit during Undo rebase');
      expect(committed!.pendingRetraction).toBeUndefined();
      const retractions = Object.values(knowledgeJournal.allRows()).flat()
        .filter(row => row.kind === 'retraction' && row.retracts === attemptId);
      expect(retractions).toHaveLength(1);
    } finally {
      dispose();
    }
  });

  it('treats an Undo completed by a peer as successful after its stale write is refused', async () => {
    const attemptId = 'undo-peer-completion-attempt' as AttemptId;
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'undo-peer-completion', state: 'review', reviews: 3,
      interval: 86_400_000, dueDate: Date.now() - 1000 });
    const peer = makeCard({ id: 'undo-peer-completion-peer' });
    seed(makeEmptyStore({ flashcards: { [card.id]: card, [peer.id]: peer } }));
    await ctx.submitRating(card.content.front, [], { attemptId, scheduler: { cardId: card.id, rating: 'good' } });
    answerProbesFromAuthority();

    const originalSave = mockBridge.flashcards.saveFlashcards.getMockImplementation()!;
    let peerCompletedUndo = false;
    mockBridge.flashcards.saveFlashcards.mockImplementation((saved, removed, reset, authorization) => {
      const completion = (saved as FlashcardStore & { retractionCompleted?: string }).retractionCompleted;
      if (completion === attemptId) {
        peerCompletedUndo = true;
        const peerStore = structuredClone(saved);
        delete (peerStore as FlashcardStore & { retractionCompleted?: string }).retractionCompleted;
        // A later response for the same card lands before this renderer
        // rereads the authority; the stale Undo must not replay over it.
        peerStore.flashcards[card.id].reviews += 1;
        peerStore.flashcards[peer.id].content.back = 'peer edit after completing Undo';
        peerStore.rev = ++revision;
        committed = peerStore;
        acceptedSaves.push(structuredClone(peerStore));
        return Promise.reject(new Error(staleFlashcardRevisionMessage(revision, saved.rev ?? 0)));
      }
      return originalSave(saved, removed, reset, authorization);
    });

    try {
      await expect(ctx.undoLastAction()).resolves.toBe('answer');
      expect(peerCompletedUndo).toBe(true);
      expect(committed!.flashcards[card.id].reviews).toBe(4);
      expect(committed!.flashcards[peer.id].content.back).toBe('peer edit after completing Undo');
      expect(committed!.pendingRetraction).toBeUndefined();
      expect(ctx.store.flashcards[card.id].reviews).toBe(4);
      expect(ctx.store.flashcards[peer.id].content.back).toBe('peer edit after completing Undo');
      const retractions = Object.values(knowledgeJournal.allRows()).flat()
        .filter(row => row.kind === 'retraction' && row.retracts === attemptId);
      expect(retractions).toHaveLength(1);
    } finally {
      dispose();
    }
  });

  it('restores aggregate word statistics when a scheduler rating is undone', async () => {
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const card = makeCard({
      id: 'undo-word-stats',
      language: 'ja',
      content: { type: 'word', front: '昨日', back: 'yesterday' },
      state: 'review',
      reviews: 3,
      lapses: 0,
      interval: 86_400_000,
      dueDate: Date.now() - 1000,
      lastReviewed: 1,
    });
    const wordKey = `ja:${SRS.hashWordSync(card.content.front)}`;
    const originalStats = {
      cardCount: 1,
      bestEase: card.ease,
      totalReviews: 3,
      totalLapses: 0,
      lastReviewed: 1,
      bestInterval: card.interval,
      bestState: 'review' as const,
    };
    seed(makeEmptyStore({
      flashcards: { [card.id]: card },
      wordToCardMap: { [wordKey]: [card.id] },
      wordStatsMap: { [wordKey]: originalStats },
    }));

    await ctx.submitRating(card.content.front, [], {
      attemptId: 'undo-word-stats-attempt' as AttemptId,
      scheduler: { cardId: card.id, rating: 'good' },
    });
    await vi.waitFor(() => expect(ctx.store.wordStatsMap[wordKey]?.totalReviews).toBe(4));

    await ctx.undoLastAction();

    expect(ctx.store.flashcards[card.id].state).toBe('review');
    expect(ctx.store.wordStatsMap[wordKey]).toEqual(originalStats);
    expect(committed?.wordStatsMap[wordKey]).toEqual(originalStats);
    dispose();
  });

  it('persists rating Undo through navigation and a provider restart', async () => {
    mockSettings.language = 'ja2';
    let persistedStore: FlashcardStore | null = null;
    mockBridge.flashcards.saveFlashcards.mockImplementation((serialized: FlashcardStore) => {
      persistedStore = structuredClone(serialized);
      return Promise.resolve(1);
    });
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({
      id: 'card-undo-restart',
      language: 'ja2',
      content: { type: 'word', front: '学校', back: 'school' },
      state: 'review',
      reviews: 3,
      interval: 86_400_000,
      dueDate: Date.now() - 1000,
    });
    flashcardsCb(makeEmptyStore({ flashcards: { [card.id]: card } }));
    const wordKey = `ja2:${SRS.hashWordSync('学校')}`;
    const beforeReviewsToday = ctx.store.meta.perLanguage.ja2?.reviewsToday ?? 0;

    await ctx.submitRating('学校', [{ capability: 'sense-recognition', quality: 'fluent' }], {
      language: 'ja2',
      attemptId: 'undo-restart-attempt' as AttemptId,
      scheduler: { cardId: card.id, rating: 'good', tested: ['sense-recognition'] },
    });
    expect(ctx.store.flashcards[card.id].reviews).toBe(4);
    expect(ctx.queue().scheduledQueue).not.toContain(card.id);

    await ctx.undoLastAction();
    expect(persistedStore?.flashcards[card.id].reviews).toBe(3);
    dispose();

    const remounted = await mountProvider();
    flashcardsCb(persistedStore);
    expect(remounted.ctx.store.flashcards[card.id].reviews).toBe(3);
    expect(remounted.ctx.queue().scheduledQueue).toContain(card.id);
    expect(remounted.ctx.store.meta.perLanguage.ja2?.reviewsToday ?? 0).toBe(beforeReviewsToday);
    expect(knowledgeJournal.allRows()[wordKey]?.some((event) => event.kind === 'retraction' && event.retracts === 'undo-restart-attempt')).toBe(true);
    const replayed = await knowledgeJournal.getKnowledgeStates([wordKey]);
    expect(replayed[wordKey]?.projection).toBeNull();

    remounted.dispose();
    mockSettings.language = 'ja';
  });

  it('finishes an interrupted Undo from its durable recovery record after remount', async () => {
    mockSettings.language = 'ja2';
    mockBridge.flashcards.saveFlashcards.mockImplementation((saved: FlashcardStore) => Promise.resolve((saved.rev ?? 0) + 1));
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({
      id: 'card-undo-recovery',
      language: 'ja2',
      content: { type: 'word', front: '学校', back: 'school' },
      state: 'review',
      reviews: 3,
      interval: 86_400_000,
      dueDate: Date.now() - 1000,
    });
    flashcardsCb(makeEmptyStore({ flashcards: { [card.id]: card } }));
    await ctx.submitRating('学校', [{ capability: 'sense-recognition', quality: 'fluent' }], {
      language: 'ja2',
      attemptId: 'interrupted-undo-attempt' as AttemptId,
      scheduler: { cardId: card.id, rating: 'good', tested: ['sense-recognition'] },
    });
    let persistedStore = structuredClone(mockBridge.flashcards.saveFlashcards.mock.calls.at(-1)![0] as FlashcardStore);

    // The record is written first; the retraction and the projection land
    // together in the second write. Interrupting that second write is the
    // window this record exists for: the decision is on disk, the card is
    // still scheduled, and the store shows nothing wrong.
    mockBridge.flashcards.saveFlashcards
      .mockImplementationOnce((saved: FlashcardStore) => {
        persistedStore = structuredClone(saved);
        return Promise.resolve((saved.rev ?? 0) + 1);
      })
      .mockRejectedValueOnce(new Error('process interrupted before final Undo write'));
    await expect(ctx.undoLastAction()).rejects.toThrow('undo persistence was refused');
    expect(persistedStore.pendingRetraction?.attemptId).toBe('interrupted-undo-attempt');
    expect(persistedStore.flashcards[card.id].reviews).toBe(4);
    expect(ctx.canUndo()).toBe(true);
    dispose();

    mockBridge.flashcards.saveFlashcards.mockImplementation((saved: FlashcardStore) => {
      persistedStore = structuredClone(saved);
      return Promise.resolve((saved.rev ?? 0) + 1);
    });
    const remounted = await mountProvider();
    flashcardsCb(persistedStore);
    await vi.waitFor(() => {
      expect(remounted.ctx.store.flashcards[card.id].reviews).toBe(3);
      expect(remounted.ctx.store.pendingRetraction).toBeUndefined();
    });
    remounted.dispose();
    mockSettings.language = 'ja';
  });

  it('keeps a failed Undo on the stack until the scheduler restore is durable', async () => {
    mockSettings.language = 'ja2';
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({
      id: 'card-retry-undo',
      language: 'ja2',
      content: { type: 'word', front: '学校', back: 'school' },
      state: 'review',
      reviews: 3,
      interval: 86_400_000,
      dueDate: Date.now() - 1000,
    });
    flashcardsCb(makeEmptyStore({ flashcards: { [card.id]: card } }));
    await ctx.submitRating('学校', [{ capability: 'sense-recognition', quality: 'fluent' }], {
      language: 'ja2',
      attemptId: 'retryable-undo-attempt' as AttemptId,
      scheduler: { cardId: card.id, rating: 'good', tested: ['sense-recognition'] },
    });
    mockBridge.flashcards.saveFlashcards
      .mockImplementationOnce((saved: FlashcardStore) => Promise.resolve((saved.rev ?? 0) + 1))
      .mockRejectedValueOnce(new Error('disk full'));

    await expect(ctx.undoLastAction()).rejects.toThrow('undo persistence was refused');
    expect(ctx.store.flashcards[card.id].reviews).toBe(4);
    expect(ctx.canUndo()).toBe(true);

    mockBridge.flashcards.saveFlashcards.mockResolvedValue(undefined);
    await expect(ctx.undoLastAction()).resolves.toBe('answer');
    expect(ctx.store.flashcards[card.id].reviews).toBe(3);
    expect(ctx.canUndo()).toBe(false);
    dispose();
    mockSettings.language = 'ja';
  });

  describe('package-declared surface capability writes', () => {
    const language = 'x-surface-test';
    const capability = 'x-surface-test::unfamiliar-observation';
    const word = 'vexa';
    const primary = 'vex';
    const variant = 'vexi';
    const key = `${language}:${SRS.hashWordSync(word)}`;
    const primaryKey = `${language}:${SRS.hashWordSync(primary)}`;
    const variantKey = `${language}:${SRS.hashWordSync(variant)}`;

    beforeEach(() => {
      Object.assign(mockLangData, {
        [language]: {
          name: 'Synthetic scope package',
          settings: { fixed: {} },
          learning: { capabilities: { [capability]: { scope: 'surface' } } },
        },
      });
      mockGetCanonicalForm.mockImplementation(() => primary);
      mockGetWordVariants.mockImplementation(() => [word, variant]);
      mockGetCanonicalFormForLanguage.mockImplementation(() => primary);
      mockGetWordVariantsForLanguage.mockImplementation(() => [word, variant]);
    });

    afterEach(() => {
      Reflect.deleteProperty(mockLangData, language);
    });

    it.each([false, true])('anchors rating state and journal to exactly the presented surface (active language: %s)', async (active) => {
      if (active) mockSettings.language = language;
      const { ctx, dispose } = await mountProvider();
      try {
        flashcardsCb(makeEmptyStore());
        await submitObservation(ctx, word, capability, 'fluent', { language });
        expect(ctx.store.wordKnowledge[key]?.access?.[capability]?.status).toBe('known');
        expect(ctx.store.wordKnowledge[primaryKey]?.access?.[capability]).toBeUndefined();
        expect(ctx.store.wordKnowledge[variantKey]?.access?.[capability]).toBeUndefined();
        const journal = knowledgeJournal.allRows();
        expect(Object.keys(journal)).toEqual([key]);
        expect(journal[key]).toEqual([expect.objectContaining({
          kind: 'rating', presentedSurface: word,
          targetRef: { kind: 'surface', id: `${language}:surface:${SRS.hashWordSync(word)}`, capability },
        })]);
      } finally { dispose(); }
    });

    it('claims an unknown package capability only on the addressed surface', async () => {
      const { ctx, dispose } = await mountProvider();
      try {
        flashcardsCb(makeEmptyStore());
        await ctx.setAccessClaim(word, capability, 'known', language);
        expect(ctx.store.wordKnowledge[key]?.access?.[capability]?.claim).toBe('known');
        expect(ctx.store.wordKnowledge[primaryKey]?.access?.[capability]).toBeUndefined();
        expect(ctx.store.wordKnowledge[variantKey]?.access?.[capability]).toBeUndefined();
        expect(Object.keys(knowledgeJournal.allRows())).toEqual([key]);
      } finally { dispose(); }
    });

    it('clears only the addressed surface claim and preserves independent related-form claims', async () => {
      const { ctx, dispose } = await mountProvider();
      try {
        flashcardsCb(makeEmptyStore());
        await ctx.setAccessClaim(word, capability, 'known', language);
        await ctx.setAccessClaim(variant, capability, 'learning', language);
        await ctx.clearAccessClaim(word, capability, language);
        expect(ctx.store.wordKnowledge[key]?.access?.[capability]?.claim).toBeUndefined();
        expect(ctx.store.wordKnowledge[variantKey]?.access?.[capability]?.claim).toBe('learning');
        const journal = knowledgeJournal.allRows();
        const clearingRows = Object.entries(journal).flatMap(([eventKey, events]) =>
          events.filter(event => event.kind === 'claim' && event.toStatus === undefined)
            .map(event => ({ key: eventKey, event })));
        expect(clearingRows).toEqual([{ key, event: expect.objectContaining({
          kind: 'claim', targetRef: { kind: 'surface', id: `${language}:surface:${SRS.hashWordSync(word)}`, capability },
        }) }]);
        await ctx.recomputeWordKnowledgeFromEvidence(word, language);
        expect(ctx.store.wordKnowledge[key]?.access?.[capability]?.claim).toBeUndefined();
        expect(ctx.store.wordKnowledge[variantKey]?.access?.[capability]?.claim).toBe('learning');
      } finally { dispose(); }
    });
  });

  // ─── Priority 1: useFlashcards outside provider ──────────────────
  it('useFlashcards throws when used outside FlashcardProvider', { timeout: 10000 }, async () => {
    const { createRoot } = await import('solid-js');
    const { useFlashcards } = await import('./FlashcardContext');
    expect(() => {
      createRoot((dispose) => {
        try {
          useFlashcards();
        } finally {
          dispose();
        }
      });
    }).toThrow('useFlashcards must be used within a FlashcardProvider');
  });

  // ─── Priority 1: Initial empty store state ───────────────────────
  it('initial state: isLoading=true, store has default structure', async () => {
    const { ctx, dispose } = await mountProvider();
    expect(ctx.isLoading()).toBe(true);
    expect(ctx.store.flashcards).toEqual({});
    expect(ctx.store.wordToCardMap).toEqual({});
    expect(ctx.store.wordStatsMap).toEqual({});
    expect(ctx.store.version).toBe(CURRENT_VERSION);
    dispose();
  });

  // ─── Priority 1: IPC listener registration ───────────────────────
  it.each([true, false])('preserves an unavailable library, refuses responses, and reloads the repaired authority (Electron=%s)', async electron => {
    mockIsElectron.mockReturnValue(electron);
    const { ctx, dispose } = await mountProvider();
    try {
      const fail = mockBridge.flashcards.onFlashcardLoadError.mock.calls.at(-1)![0] as (message: string) => void;
      fail('permission denied');
      expect(ctx.libraryLoadError()).toBe('permission denied');
      expect(ctx.isLoading()).toBe(true);
      await expect(ctx.submitRating('unread', [{ access: 'sense-recognition', rating: 'normal' }], { language: 'de' })).rejects.toThrow(/library must be loaded/);
      expect(mockAppendEvents).not.toHaveBeenCalled();
      ctx.retryLibraryLoad();
      expect(mockBridge.flashcards.getFlashcards).toHaveBeenCalledTimes(2);
      flashcardsCb(makeEmptyStore({ rev: 8 }));
      expect(ctx.libraryLoadError()).toBeNull();
      expect(ctx.isLoading()).toBe(false);
      expect(ctx.store.rev).toBe(8);
    } finally { dispose(); }
  });

  it('releases the recovery gate when the same intact revision is delivered again', async () => {
    const { ctx, dispose } = await mountProvider();
    try {
      const saved = makeEmptyStore({ rev: 8 });
      flashcardsCb(saved);
      const fail = mockBridge.flashcards.onFlashcardLoadError.mock.calls.at(-1)![0];
      fail('temporarily unavailable');
      expect(ctx.isLoading()).toBe(true);
      flashcardsCb(saved);
      expect(ctx.libraryLoadError()).toBeNull();
      expect(ctx.isLoading()).toBe(false);
    } finally { dispose(); }
  });

  it('keeps recovery blocked for an unchanged probe or a stale snapshot', async () => {
    const { ctx, dispose } = await mountProvider();
    try {
      flashcardsCb(makeEmptyStore({ rev: 8 }));
      mockBridge.flashcards.onFlashcardLoadError.mock.calls.at(-1)![0]('unavailable');
      flashcardsCb(null);
      flashcardsCb(makeEmptyStore({ rev: 7 }));
      expect(ctx.libraryLoadError()).toBe('unavailable');
      expect(ctx.isLoading()).toBe(true);
      expect(ctx.store.rev).toBe(8);
    } finally { dispose(); }
  });

  it('registers onFlashcards listener before calling getFlashcards', async () => {
    const { dispose } = await mountProvider();
    const onFlashcardsOrder = mockBridge.flashcards.onFlashcards.mock.invocationCallOrder[0];
    const getFlashcardsOrder = mockBridge.flashcards.getFlashcards.mock.invocationCallOrder[0];
    expect(onFlashcardsOrder).toBeLessThan(getFlashcardsOrder);
    dispose();
  });

  it('registers all IPC listeners on mount', async () => {
    const { dispose } = await mountProvider();
    expect(mockBridge.flashcards.onFlashcards).toHaveBeenCalledOnce();
    expect(mockBridge.flashcards.onNewDayFlashcards).toHaveBeenCalledOnce();
    expect(mockBridge.migration.onFlashcardMigrationComplete).toHaveBeenCalledOnce();
    expect(mockBridge.crossWindow.onUpdatePills).toHaveBeenCalledOnce();
    expect(mockBridge.crossWindow.onUpdateAttemptFlashcardCreation).toHaveBeenCalledOnce();
    expect(mockBridge.crossWindow.onUpdateCreateFlashcard).toHaveBeenCalledOnce();
    expect(mockBridge.crossWindow.onUpdateLastWatched).toHaveBeenCalledOnce();
    dispose();
  });

  // ─── Priority 1: Store loading from bridge ───────────────────────
  it('after receiving flashcards: isLoading=false, store populated', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard();
    const store = makeEmptyStore({
      flashcards: { [card.id]: card },
    });
    flashcardsCb(store);
    expect(ctx.isLoading()).toBe(false);
    expect(ctx.store.flashcards[card.id]).toBeDefined();
    expect(ctx.store.flashcards[card.id].content.front).toBe('テスト');
    dispose();
  });

  it('loading empty store sets isLoading=false', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    expect(ctx.isLoading()).toBe(false);
    expect(Object.keys(ctx.store.flashcards)).toHaveLength(0);
    dispose();
  });

  it('knowledge readiness stays unresolved until load AND legacy epistemic migration settle', async () => {
    const { ctx, dispose } = await mountProvider();
    // Before hydration the store is empty: absence must not read as
    // "unmeasured knowledge", so the gate stays closed.
    expect(ctx.isKnowledgeReady()).toBe(false);
    flashcardsCb(makeEmptyStore());
    // Migration is async (journal reads); readiness opens only after it
    // settles so rows the honesty cap flips are never shown mid-flight.
    await vi.waitFor(() => expect(ctx.isKnowledgeReady()).toBe(true));
    dispose();
  });

  it('preserves current-day burial when only the obsolete global day marker is old', async () => {
    const { ctx, dispose } = await mountProvider();
    const today = SRS.getTodayDateString(DEFAULT_SETTINGS.newDayHour);
    const snapshot = makeEmptyStore({ flashcards: { buried: makeCard({ id: 'buried', buried: true }) } });
    snapshot.meta.newCardsDate = '2000-01-01';
    snapshot.meta.perLanguage.ja.newCardsDate = today;
    flashcardsCb(snapshot);
    await vi.waitFor(() => expect(ctx.isKnowledgeReady()).toBe(true));
    expect(ctx.store.flashcards.buried.buried).toBe(true);
    dispose();
  });
  it('unburies only cards whose own language day has advanced', async () => {
    const { ctx, dispose } = await mountProvider();
    const today = SRS.getTodayDateString(DEFAULT_SETTINGS.newDayHour);
    const snapshot = makeEmptyStore({ flashcards: {
      current: makeCard({ id: 'current', language: 'ja', buried: true }),
      older: makeCard({ id: 'older', language: 'future', buried: true }),
    } });
    snapshot.meta.newCardsDate = today;
    snapshot.meta.perLanguage.ja.newCardsDate = today;
    snapshot.meta.perLanguage.future = { newCardsToday: 1, reviewsToday: 1, newCardsDate: '2000-01-01' };
    flashcardsCb(snapshot);
    await vi.waitFor(() => expect(ctx.isKnowledgeReady()).toBe(true));
    expect(ctx.store.flashcards.current.buried).toBe(true);
    expect(ctx.store.flashcards.older.buried).toBe(false);
    dispose();
  });
  it('focus redelivery with an unchanged rev keeps the knowledge gate open', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore({ rev: 7 }));
    await vi.waitFor(() => expect(ctx.isKnowledgeReady()).toBe(true));

    // Refocus probe: the main process replies null — the gate must not cycle.
    flashcardsCb(null);
    expect(ctx.isKnowledgeReady()).toBe(true);

    // An identical-rev redelivery is also a no-op (no reconcile, no gate drop).
    flashcardsCb(makeEmptyStore({ rev: 7 }));
    expect(ctx.isKnowledgeReady()).toBe(true);

    // A genuinely newer revision (another window wrote) reconciles; the gate
    // stays open because the store is complete, not half-migrated.
    flashcardsCb(makeEmptyStore({ rev: 8 }));
    expect(ctx.isKnowledgeReady()).toBe(true);
    expect(ctx.store.rev).toBe(8);
    dispose();
  });

  it('preserves the sync revision from the received store (CAS push path)', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore({ rev: 7 }));
    expect(ctx.isLoading()).toBe(false);
    expect(ctx.store.rev).toBe(7);
    dispose();
  });

  // ─── Priority 1: addFlashcard ─────────────────────────────────────
  it('addFlashcard creates a card and updates store maps', async () => {
    const { ctx, dispose } = await mountProvider();
    seedAccepted();

    const id = await ctx.addFlashcard({ front: '猫', back: 'cat' }, undefined, true);

    expect(id).toBeTruthy();
    expect(id.length).toBeGreaterThan(0);
    const card = ctx.store.flashcards[id];
    expect(card).toBeDefined();
    expect(card.content.front).toBe('猫');
    expect(card.content.back).toBe('cat');
    expect(card.state).toBe('new');
    expect(card.ease).toBe(2.5);
    expect(card.language).toBe('ja');
    dispose();
  });

  it.each(['high-quality', 'fast'] as FlashcardAudioPreset[])('uses the creation %s preset for word and example audio', async (preset) => {
    const previous = {
      flashcardAutoGenerateAudio: mockSettings.flashcardAutoGenerateAudio,
      flashcardTtsProvider: mockSettings.flashcardTtsProvider,
      flashcardCreationAudioPreset: mockSettings.flashcardCreationAudioPreset,
    };
    mockSettings.flashcardAutoGenerateAudio = true;
    mockSettings.flashcardTtsProvider = preset === 'fast' ? 'cloud' : 'qwen3';
    mockSettings.flashcardCreationAudioPreset = preset;
    mockBridge.flashcards.generateFlashcardTts.mockResolvedValue('flashcard-audio://generated.ogg');
    const { ctx, dispose } = await mountProvider();
    try {
      flashcardsCb(makeEmptyStore());
      const id = await ctx.addFlashcard({ front: 'Word', back: 'Meaning', example: 'Example', exampleMeaning: 'Translated' }, undefined, false);
      await vi.waitFor(() => expect(mockBridge.flashcards.generateFlashcardTts).toHaveBeenCalledTimes(2));
      const calls = mockBridge.flashcards.generateFlashcardTts.mock.calls;
      expect(calls[0]).toEqual([id, 'Word', 'ja', 'word', 'qwen3', undefined, undefined, expect.any(String), preset]);
      expect(calls[1]).toEqual([id, 'Example', 'ja', 'example', 'qwen3', undefined, undefined, expect.any(String), preset]);
    } finally {
      dispose();
      Object.assign(mockSettings, previous);
      mockBridge.flashcards.generateFlashcardTts.mockResolvedValue(null);
    }
  });

  it('addFlashcard populates wordToCardMap with language-prefixed key', async () => {
    const { ctx, dispose } = await mountProvider();
    seedAccepted();

    const id = await ctx.addFlashcard({ front: '犬', back: 'dog' }, undefined, true);

    const mapKeys = Object.keys(ctx.store.wordToCardMap);
    expect(mapKeys.length).toBe(1);
    expect(mapKeys[0]).toMatch(/^ja:/);
    expect(ctx.store.wordToCardMap[mapKeys[0]]).toContain(id);
    dispose();
  });

  it('addFlashcard updates wordStatsMap', async () => {
    const { ctx, dispose } = await mountProvider();
    seedAccepted();

    await ctx.addFlashcard({ front: '鳥', back: 'bird' }, undefined, true);

    const statsKeys = Object.keys(ctx.store.wordStatsMap);
    expect(statsKeys.length).toBe(1);
    expect(ctx.store.wordStatsMap[statsKeys[0]].cardCount).toBe(1);
    dispose();
  });

  it('addFlashcard with custom initialEase', async () => {
    const { ctx, dispose } = await mountProvider();
    seedAccepted();

    const id = await ctx.addFlashcard({ front: '魚', back: 'fish' }, 3.0, true);

    expect(ctx.store.flashcards[id].ease).toBe(3.0);
    dispose();
  });

  it('addFlashcard does not silently suppress an unmeasured word because of an orphan legacy marker', async () => {
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const hash = await SRS.hashWord('空');
    const lk = `ja:${hash}`;
    seed(makeEmptyStore({
      knownUntracked: { [lk]: true },
    }));

    const id = await ctx.addFlashcard({ front: '空', back: 'sky' }, undefined, true);

    expect(id).not.toBe('');
    expect(ctx.store.flashcards[id].content.front).toBe('空');
    expect(ctx.store.knownUntracked[lk]).toBe(true);
    expect(ctx.getComprehensiveWordStatusWithSourceSync('空').basis).toBe('unmeasured');
    dispose();
  });

  it('addFlashcard supports multiple cards per word', async () => {
    const { ctx, dispose } = await mountProvider();
    seedAccepted();

    const id1 = await ctx.addFlashcard({ front: '花', back: 'flower' }, undefined, true);
    const id2 = await ctx.addFlashcard({ front: '花', back: 'blossom' }, undefined, true);

    expect(id1).not.toBe(id2);
    const mapKeys = Object.keys(ctx.store.wordToCardMap);
    expect(mapKeys.length).toBe(1);
    expect(ctx.store.wordToCardMap[mapKeys[0]]).toContain(id1);
    expect(ctx.store.wordToCardMap[mapKeys[0]]).toContain(id2);
    expect(ctx.store.wordStatsMap[mapKeys[0]].cardCount).toBe(2);
    dispose();
  });

  it('generateExampleSentenceWithLLM uses the card language dictionary target, not the UI language', async () => {
    mockSettings.uiLanguage = 'en';
    mockSettings.dictionaryTargetLanguages = { ja: 'fr' };
    mockStreamChat.mockImplementation((_messages, _tools, callbacks) => {
      queueMicrotask(() => callbacks.onDone("Sentence: 赤い花です。\nTranslation: C'est une fleur rouge."));
      return { abort: vi.fn() };
    });
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    const result = await ctx.generateExampleSentenceWithLLM('赤い', 'red', 'ja');

    expect(result).toEqual({ sentence: '赤い花です。', meaning: "C'est une fleur rouge." });
    const messages = mockStreamChat.mock.calls[0][0] as Array<{ role: string; content: string }>;
    expect(messages[1].content).toContain('Japanese (日本語)');
    expect(messages[1].content).toContain('French (français) translation');
    expect(messages[1].content).not.toContain('English translation');
    dispose();
  });

  it('generateExampleSentenceWithLLM uses installed language metadata names for third-party-style languages', async () => {
    mockSettings.uiLanguage = 'en';
    mockSettings.dictionaryTargetLanguages = { ar: 'fr' };
    mockStreamChat.mockImplementation((_messages, _tools, callbacks) => {
      queueMicrotask(() => callbacks.onDone('Sentence: السلام عليكم.\nTranslation: Bonjour.'));
      return { abort: vi.fn() };
    });
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    const result = await ctx.generateExampleSentenceWithLLM('سلام', 'peace', 'ar');

    expect(result).toEqual({ sentence: 'السلام عليكم.', meaning: 'Bonjour.' });
    const messages = mockStreamChat.mock.calls[0][0] as Array<{ role: string; content: string }>;
    expect(messages[1].content).toContain('Arabic (العربية)');
    expect(messages[1].content).toContain('French (français) translation');
    expect(messages[1].content).not.toContain('in ar');
    dispose();
  });

  it('translateExampleSentence uses the explicit card language dictionary target', async () => {
    mockSettings.uiLanguage = 'en';
    mockSettings.dictionaryTargetLanguages = { ja: 'de' };
    mockStreamChat.mockImplementation((_messages, _tools, callbacks) => {
      queueMicrotask(() => callbacks.onDone('Das ist eine rote Blume.'));
      return { abort: vi.fn() };
    });
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    const result = await ctx.translateExampleSentence('赤い花です。', 'ja', 'ja');

    expect(result).toBe('Das ist eine rote Blume.');
    const messages = mockStreamChat.mock.calls[0][0] as Array<{ role: string; content: string }>;
    expect(messages[0].content).toContain('German (Deutsch)');
    expect(messages[1].content).toContain('Japanese (日本語)');
    expect(messages[1].content).toContain('to German (Deutsch)');
    expect(messages[1].content).not.toContain('to English');
    dispose();
  });

  it('post-create example translation uses the card language code for prompt metadata lookup', async () => {
    mockSettings.llmEnabled = true;
    mockSettings.uiLanguage = 'de';
    mockSettings.dictionaryTargetLanguages = { ar: 'fr' };
    mockStreamChat.mockImplementation((_messages, _tools, callbacks) => {
      queueMicrotask(() => callbacks.onDone('Bonjour.'));
      return { abort: vi.fn() };
    });
    const { ctx, dispose } = await mountProvider();
    seedAccepted();

    await ctx.addFlashcard(
      { front: 'سلام', back: 'peace', example: 'السلام عليكم.' },
      undefined,
      false,
      'ar',
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const messages = mockStreamChat.mock.calls[0][0] as Array<{ role: string; content: string }>;
    expect(messages[1].content).toContain('Arabic (العربية)');
    expect(messages[1].content).toContain('to French (français)');
    expect(messages[1].content).not.toContain('to German');
    dispose();
  });

  // ─── Priority 1: updateFlashcard ──────────────────────────────────
  it('updateFlashcard modifies card fields', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'upd-1' });
    flashcardsCb(makeEmptyStore({ flashcards: { 'upd-1': card } }));

    ctx.updateFlashcard('upd-1', { ease: 3.0 });

    expect(ctx.store.flashcards['upd-1'].ease).toBe(3.0);
    expect(ctx.store.flashcards['upd-1'].lastUpdated).toBeGreaterThanOrEqual(card.lastUpdated);
    dispose();
  });

  it('updateFlashcard is no-op for nonexistent card', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    ctx.updateFlashcard('nonexistent', { ease: 5 });

    expect(ctx.store.flashcards['nonexistent']).toBeUndefined();
    dispose();
  });

  // ─── Priority 1: removeFlashcard ──────────────────────────────────
  it('removeFlashcard deletes card from store and map', async () => {
    const { ctx, dispose } = await mountProvider();
    seedAccepted();

    const id = await ctx.addFlashcard({ front: '山', back: 'mountain' }, undefined, true);
    expect(ctx.store.flashcards[id]).toBeDefined();

    const result = await ctx.removeFlashcard(id);
    expect(result).toBe(true);
    expect(ctx.store.flashcards[id]).toBeUndefined();
    dispose();
  });

  it('removeFlashcard with neverShowAgain=true writes exclusion policy only — no claim, no knowledge fabrication', async () => {
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    seedAccepted();

    const id = await ctx.addFlashcard({ front: '川', back: 'river' }, undefined, true);
    const hash = await SRS.hashWord('川');
    const lk = `ja:${hash}`;

    await ctx.removeFlashcard(id, true);
    expect(ctx.store.ignoredWords[lk]).toBeDefined();
    // Exclusion is policy, never epistemics: no claim, no entry, no bank write.
    expect(ctx.store.wordKnowledge[lk]).toBeUndefined();
    expect(ctx.store.knownUntracked[lk]).toBeUndefined();
    expect(ctx.getComprehensiveWordStatusWithSourceSync('川').excluded).toBe(true);
    expect(ctx.getComprehensiveWordStatusWithSourceSync('川').basis).toBe('unmeasured');
    dispose();
  });

  it('removeFlashcard indexes non-active-language cards with the card language', async () => {
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    mockGetCanonicalForm.mockImplementation((word: string) => `ja:${word}`);
    mockGetCanonicalFormForLanguage.mockImplementation((language: string, word: string) => `${language}:${word}`);
    seedAccepted();

    const id = await ctx.addFlashcard({ front: 'سلام', back: 'hello' }, undefined, true, 'ar');
    const storageWord = 'ar:سلام';
    const hash = await SRS.hashWord(storageWord);
    const lk = `ar:${hash}`;
    expect(ctx.store.wordToCardMap[lk]).toContain(id);

    await ctx.removeFlashcard(id, true);

    expect(ctx.store.wordToCardMap[lk]).toBeUndefined();
    expect(ctx.store.ignoredWords[lk]?.language).toBe('ar');
    // No epistemic write: exclusion only.
    expect(ctx.store.wordKnowledge[lk]).toBeUndefined();
    expect(ctx.store.knownUntracked[lk]).toBeUndefined();
    dispose();
  });

  it('preserves opaque preference metadata and orders re-exclusion when removing the last card', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'remove-with-preference', language: 'package-x',
      content: { type: 'word', front: 'target', back: 'authored explanation' } });
    const key = `package-x:${SRS.hashWordSync('target')}`;
    const previous = { word: 'target', reading: 'retained reading', language: 'package-x', ignoredAt: 10,
      excluded: false, updatedAt: Date.now() + 10000,
      'third-party:unfamiliar-feature': { scope: { participants: ['unknown-role'] }, value: [false, { nested: [3] }] } };
    seed(makeEmptyStore({ flashcards: { [card.id]: card }, wordToCardMap: { [key]: [card.id] },
      ignoredWords: { [key]: previous } }));
    try {
      await expect(ctx.removeFlashcard(card.id, true)).resolves.toBe(true);
      expect(ctx.store.ignoredWords[key]).toMatchObject({ reading: previous.reading, excluded: true,
        'third-party:unfamiliar-feature': previous['third-party:unfamiliar-feature'] });
      expect(ctx.store.ignoredWords[key].updatedAt).toBeGreaterThan(previous.updatedAt);
      await new Promise(resolve => setTimeout(resolve, SAVE_DEBOUNCE_MS_FOR_TESTS));
      const serialized = JSON.parse(JSON.stringify(acceptedSaves.at(-1))) as FlashcardStore;
      expect(serialized.ignoredWords[key]).toMatchObject({ reading: previous.reading, excluded: true,
        'third-party:unfamiliar-feature': previous['third-party:unfamiliar-feature'] });
      expect(serialized.flashcards[card.id]).toBeUndefined();
    } finally { dispose(); }
  });

  it('keeps the card, queue and media until removal is acknowledged', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'removal-ack', content: { type: 'word', front: 'target', back: 'authored answer',
      videoUrl: 'video://owned.mp4', imageUrl: 'flashcard-image://removal-ack.png' } });
    const key = `ja:${SRS.hashWordSync('target')}`;
    seed(makeEmptyStore({ flashcards: { [card.id]: card }, wordToCardMap: { [key]: [card.id] } }));
    ctx.refreshQueue();
    const beforeCard = JSON.parse(JSON.stringify(ctx.store.flashcards[card.id])) as Flashcard;
    const beforeQueue = JSON.parse(JSON.stringify(ctx.queue()));
    let acknowledge!: () => void;
    mockBridge.flashcards.saveFlashcards.mockImplementationOnce((saved: FlashcardStore) => new Promise(resolve => {
      acknowledge = () => { committed = structuredClone(saved); revision += 1; committed.rev = revision; resolve(revision); };
    }));
    let settled = false;
    const removal = ctx.removeFlashcard(card.id, true).then(result => { settled = true; return result; });
    try {
      await vi.waitFor(() => expect(acknowledge).toBeTypeOf('function'));
      expect(settled).toBe(false);
      expect(ctx.store.flashcards[card.id]).toEqual(beforeCard);
      expect(ctx.store.ignoredWords[key]).toBeUndefined();
      expect(ctx.queue()).toEqual(beforeQueue);
      expect(mockBridge.flashcards.deleteFlashcardVideo).not.toHaveBeenCalled();
      expect(mockBridge.flashcards.deleteFlashcardImage).not.toHaveBeenCalled();
      expect(mockBridge.flashcards.deleteFlashcardTts).not.toHaveBeenCalled();
      acknowledge();
      await expect(removal).resolves.toBe(true);
      expect(ctx.store.flashcards[card.id]).toBeUndefined();
      expect(ctx.store.ignoredWords[key]?.excluded).toBe(true);
      expect(committed?.flashcards[card.id]).toBeUndefined();
      expect(mockBridge.flashcards.saveFlashcards.mock.calls.at(-1)?.[1]).toEqual([card.id]);
      expect(mockBridge.flashcards.deleteFlashcardVideo).toHaveBeenCalledWith(card.id);
    } finally { if (acknowledge && !settled) acknowledge(); await removal; dispose(); }
  });

  it('a refused removal retains authored content and cannot leak into another save', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'removal-refused', content: { type: 'word', front: 'target', back: 'authored answer',
      videoUrl: 'video://owned.mp4', imageUrl: 'flashcard-image://removal-refused.png' } });
    const key = `ja:${SRS.hashWordSync('target')}`;
    seed(makeEmptyStore({ flashcards: { [card.id]: card }, wordToCardMap: { [key]: [card.id] } }));
    ctx.refreshQueue();
    const beforeCard = JSON.parse(JSON.stringify(ctx.store.flashcards[card.id])) as Flashcard;
    mockBridge.flashcards.saveFlashcards.mockRejectedValueOnce(new Error('disk full'));
    try {
      await expect(ctx.removeFlashcard(card.id, true)).resolves.toBe(false);
      expect(ctx.store.flashcards[card.id]).toEqual(beforeCard);
      expect(ctx.store.wordToCardMap[key]).toEqual([card.id]);
      expect(ctx.store.ignoredWords[key]).toBeUndefined();
      expect(mockBridge.flashcards.deleteFlashcardVideo).not.toHaveBeenCalled();
      expect(mockBridge.flashcards.deleteFlashcardImage).not.toHaveBeenCalled();
      expect(mockBridge.flashcards.deleteFlashcardTts).not.toHaveBeenCalled();
      await ctx.ignoreWordForLanguage('different');
      expect(committed?.flashcards[card.id]).toEqual(beforeCard);
      expect(mockBridge.flashcards.saveFlashcards.mock.calls.at(-1)?.[1]).toEqual([]);
      await expect(ctx.removeFlashcard(card.id, true)).resolves.toBe(true);
      expect(committed?.flashcards[card.id]).toBeUndefined();
    } finally { dispose(); }
  });

  it('recomputes removal against a peer-added sibling before deciding exclusion', async () => {
    answerProbesFromAuthority();
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'removed-with-sibling', content: { type: 'word', front: 'target', back: 'first answer' } });
    const sibling = makeCard({ id: 'peer-sibling', content: { type: 'word', front: 'target', back: 'peer authored answer' } });
    const key = `ja:${SRS.hashWordSync('target')}`;
    seed(makeEmptyStore({ rev: 4, flashcards: { [card.id]: card }, wordToCardMap: { [key]: [card.id] } }));
    await mockBridge.flashcards.saveFlashcards(makeEmptyStore({ rev: 4,
      flashcards: { [card.id]: card, [sibling.id]: sibling }, wordToCardMap: { [key]: [card.id, sibling.id] } }), [], false, undefined);
    try {
      await expect(ctx.removeFlashcard(card.id, true)).resolves.toBe(true);
      expect(committed?.flashcards[sibling.id]).toMatchObject(sibling);
      expect(committed?.wordToCardMap[key]).toEqual([sibling.id]);
      expect(committed?.ignoredWords[key]).toBeUndefined();
      expect(ctx.store.wordToCardMap[key]).toEqual([sibling.id]);
      expect(mockAppendEvents).not.toHaveBeenCalled();
    } finally { dispose(); }
  });

  it('refuses a removal when a peer changes the confirmed card', async () => {
    answerProbesFromAuthority();
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'peer-edited-removal', content: { type: 'word', front: 'target', back: 'first answer' } });
    const edited = { ...card, content: { ...card.content, back: 'new peer-authored explanation' } };
    const key = `ja:${SRS.hashWordSync('target')}`;
    seed(makeEmptyStore({ rev: 4, flashcards: { [card.id]: card }, wordToCardMap: { [key]: [card.id] } }));
    await mockBridge.flashcards.saveFlashcards(makeEmptyStore({ rev: 4,
      flashcards: { [card.id]: edited }, wordToCardMap: { [key]: [card.id] } }), [], false, undefined);
    try {
      await expect(ctx.removeFlashcard(card.id, true)).resolves.toBe(false);
      expect(committed?.flashcards[card.id]).toEqual(edited);
      expect(committed?.wordToCardMap[key]).toEqual([card.id]);
      expect(committed?.ignoredWords[key]).toBeUndefined();
      expect(mockBridge.flashcards.deleteFlashcardTts).not.toHaveBeenCalled();
    } finally { dispose(); }
  });

  it.each(['same-url', 'same-storage-id'] as const)('retains %s media still referenced by another authored card after removal', async variant => {
    const { ctx, dispose } = await mountProvider();
    const imageUrl = 'flashcard-image://shared-image.png';
    const otherImageUrl = variant === 'same-url' ? imageUrl : 'flashcard-image://shared-image.webp';
    const card = makeCard({ id: 'shared-image-owner', content: { type: 'word', front: 'target', back: 'first', imageUrl } });
    const sibling = makeCard({ id: 'shared-image-consumer', content: { type: 'word', front: 'target', back: 'second', imageUrl: otherImageUrl } });
    const key = `ja:${SRS.hashWordSync('target')}`;
    seed(makeEmptyStore({ flashcards: { [card.id]: card, [sibling.id]: sibling }, wordToCardMap: { [key]: [card.id, sibling.id] } }));
    try {
      await expect(ctx.removeFlashcard(card.id, true)).resolves.toBe(true);
      expect(ctx.store.flashcards[sibling.id].content.imageUrl).toBe(otherImageUrl);
      expect(mockBridge.flashcards.deleteFlashcardImage).not.toHaveBeenCalled();
    } finally { dispose(); }
  });

  it.each(['sibling', 'removed-target'] as const)('an acknowledged removal preserves sibling edits without resurrecting its removed %s', async variant => {
    answerProbesFromAuthority();
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'overlay-target', content: { type: 'word', front: 'target', back: 'first' } });
    const sibling = makeCard({ id: 'overlay-sibling', content: { type: 'word', front: 'target', back: 'second' } });
    const key = `ja:${SRS.hashWordSync('target')}`;
    seed(makeEmptyStore({ rev: 4, flashcards: { [card.id]: card, [sibling.id]: sibling }, wordToCardMap: { [key]: [card.id, sibling.id] } }));
    await mockBridge.flashcards.saveFlashcards(structuredClone(committed!), [], false, undefined);
    const strictSave = mockBridge.flashcards.saveFlashcards.getMockImplementation()!;
    let acknowledge!: () => void;
    mockBridge.flashcards.saveFlashcards.mockImplementationOnce(strictSave).mockImplementationOnce((saved: FlashcardStore) => new Promise(resolve => {
      let acked = false; acknowledge = () => { if (acked) return; acked = true; committed = structuredClone(saved); revision += 1; committed.rev = revision; resolve(revision); };
    }));
    const removal = ctx.removeFlashcard(card.id, true);
    try {
      await vi.waitFor(() => expect(acknowledge).toBeTypeOf('function'));
      ctx.updateFlashcardContent(variant === 'sibling' ? sibling.id : card.id, { back: 'new local answer while rebase ACK waits' });
      acknowledge(); await removal;
      expect(committed?.flashcards[card.id]).toBeUndefined();
      expect(ctx.store.flashcards[card.id]).toBeUndefined();
      if (variant === 'sibling') expect(ctx.store.flashcards[sibling.id].content.back).toBe('new local answer while rebase ACK waits');
    } finally { if (acknowledge) acknowledge(); await removal; dispose(); }
  });

  it('an older removal rebase acknowledgment preserves a newer peer authority', async () => {
    answerProbesFromAuthority();
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'peer-ack-target', content: { type: 'word', front: 'target', back: 'first' } });
    const key = `ja:${SRS.hashWordSync('target')}`;
    seed(makeEmptyStore({ rev: 4, flashcards: { [card.id]: card }, wordToCardMap: { [key]: [card.id] } }));
    await mockBridge.flashcards.saveFlashcards(structuredClone(committed!), [], false, undefined);
    const strictSave = mockBridge.flashcards.saveFlashcards.getMockImplementation()!;
    let acknowledge!: () => void;
    mockBridge.flashcards.saveFlashcards.mockImplementationOnce(strictSave).mockImplementationOnce((saved: FlashcardStore) => new Promise(resolve => {
      committed = structuredClone(saved); revision += 1; committed.rev = revision;
      const accepted = revision; acknowledge = () => resolve(accepted);
    }));
    const removal = ctx.removeFlashcard(card.id, true);
    try {
      await vi.waitFor(() => expect(acknowledge).toBeTypeOf('function'));
      const peer = makeCard({ id: 'new-peer-after-removal', content: { type: 'word', front: 'peer word', back: 'new authored peer answer' } });
      const newer = structuredClone(committed!);
      newer.flashcards[peer.id] = peer;
      newer.wordToCardMap[`ja:${SRS.hashWordSync(peer.content.front)}`] = [peer.id];
      await mockBridge.flashcards.saveFlashcards(newer, [], false, undefined);
      deliver(committed!);
      const newestRev = revision;
      expect(ctx.store.flashcards[peer.id]).toMatchObject(peer);
      acknowledge(); await expect(removal).resolves.toBe(true);
      expect(committed?.flashcards[peer.id]).toEqual(peer);
      expect(ctx.store.flashcards[peer.id]).toMatchObject(peer);
      expect(ctx.store.rev).toBe(newestRev);
    } finally { if (acknowledge) acknowledge(); await removal; dispose(); }
  });

  it('ordinary ACK removes indexes written by a local target rename while saving', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'normal-ack-rename', content: { type: 'word', front: 'old target', back: 'first' } });
    const key = `ja:${SRS.hashWordSync(card.content.front)}`;
    const renamedKey = `ja:${SRS.hashWordSync('new target')}`;
    seed(makeEmptyStore({ flashcards: { [card.id]: card }, wordToCardMap: { [key]: [card.id] } }));
    let acknowledge!: () => void;
    mockBridge.flashcards.saveFlashcards.mockImplementationOnce((saved: FlashcardStore) => new Promise(resolve => {
      let acked = false; acknowledge = () => { if (acked) return; acked = true; committed = structuredClone(saved); revision += 1; committed.rev = revision; resolve(revision); };
    }));
    const removal = ctx.removeFlashcard(card.id, true);
    try {
      await vi.waitFor(() => expect(acknowledge).toBeTypeOf('function'));
      ctx.updateFlashcardContent(card.id, { front: 'new target' });
      acknowledge(); await expect(removal).resolves.toBe(true);
      expect(ctx.store.flashcards[card.id]).toBeUndefined();
      expect(ctx.store.wordToCardMap[renamedKey]).toBeUndefined();
      expect(ctx.store.wordStatsMap[renamedKey]).toBeUndefined();
    } finally { if (acknowledge) acknowledge(); await removal; dispose(); }
  });

  it('removeFlashcard returns false for nonexistent card', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    const result = await ctx.removeFlashcard('nonexistent');
    expect(result).toBe(false);
    dispose();
  });

  // ─── Durable media ownership ─────────────────────────────────────
  // Durable flashcard media must be named after the object that owns it.
  // A capture surface produces prepared bytes; only the owner persists them.
  // Anything written under a capture-scoped name is unreachable by every
  // delete path, so it survives the card it was meant for.
  describe('durable media ownership', () => {
    it('stores a prepared image under the id of the card that owns it', async () => {
      const { ctx, dispose } = await mountProvider();
      seedAccepted();
      mockBridge.flashcards.saveFlashcardImage.mockImplementationOnce(
        async (ownerId: string) => `flashcard-image://${ownerId}.jpg`,
      );

      const id = await ctx.addFlashcard(
        { front: '猫', back: 'cat', imageUrl: 'data:image/jpeg;base64,FRAME' },
        undefined,
        true,
      );

      expect(mockBridge.flashcards.saveFlashcardImage).toHaveBeenCalledTimes(1);
      expect(mockBridge.flashcards.saveFlashcardImage).toHaveBeenCalledWith(id, 'data:image/jpeg;base64,FRAME');
      expect(ctx.store.flashcards[id].content.imageUrl).toBe(`flashcard-image://${id}.jpg`);
      dispose();
    });

    it('repoints the legacy screenshot alias at the adopted file', async () => {
      const { ctx, dispose } = await mountProvider();
      seedAccepted();
      mockBridge.flashcards.saveFlashcardImage.mockImplementationOnce(
        async (ownerId: string) => `flashcard-image://${ownerId}.jpg`,
      );

      const id = await ctx.addFlashcard(
        {
          front: '犬', back: 'dog',
          imageUrl: 'data:image/jpeg;base64,FRAME',
          screenshotUrl: 'data:image/jpeg;base64,FRAME',
        },
        undefined,
        true,
      );

      const content = ctx.store.flashcards[id].content;
      expect(content.imageUrl).toBe(`flashcard-image://${id}.jpg`);
      expect(content.screenshotUrl).toBe(`flashcard-image://${id}.jpg`);
      dispose();
    });

    it('leaves no image when the store refuses the capture', async () => {
      const { ctx, dispose } = await mountProvider();
      seedAccepted();
      mockBridge.flashcards.saveFlashcardImage.mockRejectedValue(new Error('disk full'));

      const id = await ctx.addFlashcard(
        { front: '鳥', back: 'bird', imageUrl: 'data:image/jpeg;base64,FRAME' },
        undefined,
        true,
      );

      const content = ctx.store.flashcards[id].content;
      expect(content.imageUrl).toBe('data:image/jpeg;base64,FRAME');
      expect(content.screenshotUrl).toBeUndefined();
      dispose();
    });

    it('stores a prepared video clip under the card id, not a word-derived one', async () => {
      const { ctx, dispose } = await mountProvider();
      seedAccepted();
      mockBridge.flashcards.saveFlashcardVideo.mockImplementationOnce(
        async (ownerId: string) => `flashcard-video://${ownerId}.mp4`,
      );

      const id = await ctx.addFlashcard(
        { front: '雨', back: 'rain' },
        undefined,
        true,
        undefined,
        new Uint8Array([1, 2, 3]),
      );

      expect(mockBridge.flashcards.saveFlashcardVideo).toHaveBeenCalledTimes(1);
      expect(mockBridge.flashcards.saveFlashcardVideo.mock.calls[0][0]).toBe(id);
      const content = ctx.store.flashcards[id].content;
      expect(content.videoUrl).toBe(`flashcard-video://${id}.mp4`);
      expect(content.skipExampleTts).toBe(true);
      dispose();
    });

    it('deleting the card removes the media it adopted', async () => {
      const { ctx, dispose } = await mountProvider();
      seedAccepted();
      mockBridge.flashcards.saveFlashcardImage.mockImplementationOnce(
        async (ownerId: string) => `flashcard-image://${ownerId}.jpg`,
      );
      mockBridge.flashcards.saveFlashcardVideo.mockImplementationOnce(
        async (ownerId: string) => `flashcard-video://${ownerId}.mp4`,
      );

      const id = await ctx.addFlashcard(
        { front: '風', back: 'wind', imageUrl: 'data:image/jpeg;base64,FRAME' },
        undefined,
        true,
        undefined,
        new Uint8Array([1, 2, 3]),
      );
      await ctx.removeFlashcard(id);

      // The delete is addressed by owner id, so it must reach files named
      // after the card. Under the old word-derived naming neither call hit.
      expect(mockBridge.flashcards.deleteFlashcardImage).toHaveBeenCalledWith(id);
      expect(mockBridge.flashcards.deleteFlashcardVideo).toHaveBeenCalledWith(id);
      dispose();
    });

    it('never persists media for a card that was rejected before it existed', async () => {
      const { ctx, dispose } = await mountProvider();
      seedAccepted();
      mockBridge.flashcards.saveFlashcards.mockRejectedValue(new Error('refused'));

      await expect(ctx.addFlashcard(
        { front: '海', back: 'sea', imageUrl: 'data:image/jpeg;base64,FRAME' },
        undefined,
        true,
      )).rejects.toThrow();

      // The card never landed, so the store holds no owner for the media that
      // was adopted for it. The caller sees the failure and can retry.
      expect(Object.keys(ctx.store.flashcards)).toHaveLength(0);
      dispose();
    });
  });

  it('removeFlashcard cleans up video file if present', async () => {
    const { ctx, dispose } = await mountProvider();
    seedAccepted();

    const id = await ctx.addFlashcard({ front: '雨', back: 'rain', videoUrl: 'video://test.mp4' }, undefined, true);
    await ctx.removeFlashcard(id);

    expect(mockBridge.flashcards.deleteFlashcardVideo).toHaveBeenCalledWith(id);
    dispose();
  });

  // ─── Canonical scheduler rating command ───────────────────────────
  it('submitRating updates card SRS fields for a scheduler rating', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'ans-1', state: 'new' });
    const SRS = await import('../services/srsAlgorithm');
    const hash = await SRS.hashWord('テスト');
    const lk = `ja:${hash}`;
    seed(makeEmptyStore({
      flashcards: { 'ans-1': card },
      wordToCardMap: { [lk]: ['ans-1'] },
    }));
    ctx.refreshQueue();

    const beforeState = ctx.store.flashcards['ans-1'].state;
    expect(beforeState).toBe('new');

    await submitSchedulerRating(ctx, 'ans-1', 'good');

    const after = ctx.store.flashcards['ans-1'];
    expect(after).toBeDefined();
    expect(after.state === 'new' && after.learningStep === 0).toBe(false);
    dispose();
  });

  it('submitRating increments newCardsToday when rating a new card', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'ans-new-1', state: 'new' });
    const SRS = await import('../services/srsAlgorithm');
    const hash = await SRS.hashWord('テスト');
    const lk = `ja:${hash}`;
    seed(makeEmptyStore({
      flashcards: { 'ans-new-1': card },
      wordToCardMap: { [lk]: ['ans-new-1'] },
    }));
    ctx.refreshQueue();

    const before = ctx.store.meta.perLanguage.ja?.newCardsToday ?? 0;
    await submitSchedulerRating(ctx, 'ans-new-1', 'good');
    expect(ctx.store.meta.perLanguage.ja?.newCardsToday).toBe(before + 1);
    dispose();
  });

  it('submitRating increments reviewsToday when rating a review card', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({
      id: 'ans-rev-1',
      state: 'review',
      interval: 86400000,
      dueDate: Date.now() - 1000,
      reviews: 5,
    });
    const SRS = await import('../services/srsAlgorithm');
    const hash = await SRS.hashWord('テスト');
    const lk = `ja:${hash}`;
    seed(makeEmptyStore({
      flashcards: { 'ans-rev-1': card },
      wordToCardMap: { [lk]: ['ans-rev-1'] },
    }));
    ctx.refreshQueue();

    const before = ctx.store.meta.perLanguage.ja?.reviewsToday ?? 0;
    await submitSchedulerRating(ctx, 'ans-rev-1', 'good');
    expect(ctx.store.meta.perLanguage.ja?.reviewsToday).toBe(before + 1);
    dispose();
  });

  it('submitRating pushes an acknowledged undo entry', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'ans-undo' });
    const SRS = await import('../services/srsAlgorithm');
    const hash = await SRS.hashWord('テスト');
    const lk = `ja:${hash}`;
    seed(makeEmptyStore({
      flashcards: { 'ans-undo': card },
      wordToCardMap: { [lk]: ['ans-undo'] },
    }));
    ctx.refreshQueue();

    expect(ctx.canUndo()).toBe(false);
    await submitSchedulerRating(ctx, 'ans-undo', 'good');
    expect(ctx.canUndo()).toBe(true);
    dispose();
  });

  it('submitRating updates dailyStats', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'daily-1', state: 'new' });
    const SRS = await import('../services/srsAlgorithm');
    const hash = await SRS.hashWord('テスト');
    const lk = `ja:${hash}`;
    seed(makeEmptyStore({
      flashcards: { 'daily-1': card },
      wordToCardMap: { [lk]: ['daily-1'] },
    }));
    ctx.refreshQueue();

    await submitSchedulerRating(ctx, 'daily-1', 'good');
    const today = SRS.getTodayDateString(4);
    const langStats = ctx.store.dailyStats[today];
    expect(langStats).toBeDefined();
    const stats = langStats['ja'];
    expect(stats).toBeDefined();
    expect(stats.newCardsStudied).toBe(1);
    dispose();
  });

  it('submitRating appends an acknowledged review event with ease before and after', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'evt-1', state: 'new', content: { type: 'word', front: 'テスト', back: 'test' } });
    const SRS = await import('../services/srsAlgorithm');
    const hash = SRS.hashWordSync('テスト');
    const lk = `ja:${hash}`;
    seed(makeEmptyStore({
      flashcards: { 'evt-1': card },
      wordToCardMap: { [lk]: ['evt-1'] },
    }));
    ctx.refreshQueue();

    const easeBefore = ctx.store.flashcards['evt-1'].ease;
    await submitSchedulerRating(ctx, 'evt-1', 'good');
    const easeAfter = ctx.store.flashcards['evt-1'].ease;

    const reviewCalls = mockAppendEvents.mock.calls.filter(([byKey]) =>
      Object.values(byKey as Record<string, Array<{ kind: string }>>).some((events) => events.some((e) => e.kind === 'review')));
    expect(reviewCalls).toHaveLength(1);
    const [byKey] = reviewCalls[0] as [Record<string, Array<Record<string, unknown>>>];
    const events = byKey[lk];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'review', source: 'srs', aspect: 'meaning', rating: 'good',
      easeBefore, easeAfter,
    });
    dispose();
  });

  it('trackWordSeen accumulates a rollup bucket only when the seen actually counts', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    mockSettings.passiveEaseEnabled = true;

    ctx.trackWordSeen('積算');
    expect(mockAccumulateWordSeen).toHaveBeenCalledTimes(1);
    const [lkArg, easeArg, deltaArg] = mockAccumulateWordSeen.mock.calls[0] as [string, number, number];
    expect(lkArg.startsWith('ja:')).toBe(true);
    expect(typeof easeArg).toBe('number');
    expect(deltaArg).toBe(1);

    // Second immediate call is throttled — no extra accumulation.
    ctx.trackWordSeen('積算');
    expect(mockAccumulateWordSeen).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('trackWordSeen sets firstSeen on a fresh knowledge entry', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    mockSettings.passiveEaseEnabled = true;

    ctx.trackWordSeen('初見');
    ctx.flushPendingWordSeen();
    const SRS = await import('../services/srsAlgorithm');
    const lk = `ja:${SRS.hashWordSync('初見')}`;
    expect(ctx.store.wordKnowledge[lk]?.firstSeen).toBeTypeOf('number');
    dispose();
  });

  it('submitRating targets the supplied card even when another card is next in the queue', async () => {
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const hashNew = await SRS.hashWord('新しい');
    const hashReview = await SRS.hashWord('復習');
    const lkNew = `ja:${hashNew}`;
    const lkReview = `ja:${hashReview}`;
    const newCard = makeCard({ id: 'card-new', state: 'new', content: { type: 'word', front: '新しい', back: 'new' } });
    const reviewCard = makeCard({
      id: 'card-review',
      state: 'review',
      interval: 86400000,
      dueDate: Date.now() - 1000,
      reviews: 5,
      content: { type: 'word', front: '復習', back: 'review' },
    });
    seed(makeEmptyStore({
      flashcards: { 'card-new': newCard, 'card-review': reviewCard },
      wordToCardMap: { [lkNew]: ['card-new'], [lkReview]: ['card-review'] },
    }));
    ctx.refreshQueue();

    // Force Math.random to always pick review cards so getNextCard() without cardId would answer reviewCard
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    // But we explicitly pass newCard.id — so newCard should be answered
    await submitSchedulerRating(ctx, 'card-new', 'good');
    vi.restoreAllMocks();

    const answeredNew = ctx.store.flashcards['card-new'];
    const untouchedReview = ctx.store.flashcards['card-review'];
    expect(answeredNew.state).not.toBe('new');
    expect(untouchedReview.state).toBe('review');
    dispose();
  });

  it('submitRating recalculates non-active language stats with that language primary form', async () => {
    mockSettings.language = 'ja';
    mockGetCanonicalFormForLanguage.mockImplementation((language: string, word: string) => (
      language === 'ar' && word === 'يكتب' ? 'كتب' : word
    ));
    mockGetWordVariantsForLanguage.mockImplementation((language: string, word: string) => (
      language === 'ar' && word === 'يكتب' ? ['كتب', 'يكتب'] : [word]
    ));
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const primaryKey = `ar:${SRS.hashWordSync('كتب')}`;
    const cardId = 'card-ar-review';
    const card = makeCard({
      id: cardId,
      language: 'ar',
      content: { type: 'word', front: 'يكتب', back: 'he writes' },
      state: 'review',
      interval: 86400000,
      dueDate: Date.now() - 1000,
      reviews: 5,
    });
    seed(makeEmptyStore({
      flashcards: { [cardId]: card },
      wordToCardMap: { [primaryKey]: [cardId] },
      wordStatsMap: {
        [primaryKey]: {
          cardCount: 1,
          bestEase: 2.5,
          totalReviews: 0,
          totalLapses: 0,
          lastReviewed: 0,
          bestInterval: 0,
          bestState: 'review',
        },
      },
    }));

    await submitSchedulerRating(ctx, cardId, 'good');
    // The word-stats recompute is a fire-and-forget async IIFE whose hashWord
    // round-trips through a worker — a single setTimeout(0) tick races it under
    // load. Poll until the recompute lands instead.
    await vi.waitFor(() => {
      expect(ctx.store.wordStatsMap[primaryKey]?.totalReviews).toBe(6);
    });
    dispose();
  });

  // ─── Priority 1: getDueCount / getNewCount ────────────────────────
  it('getDueCount returns number of due review cards', async () => {
    const { ctx, dispose } = await mountProvider();
    const dueCard = makeCard({
      id: 'due-1',
      state: 'review',
      interval: 86400000,
      dueDate: Date.now() - 1000,
    });
    flashcardsCb(makeEmptyStore({ flashcards: { 'due-1': dueCard } }));

    expect(ctx.getDueCount()).toBe(1);
    dispose();
  });

  it('getNewCount returns number of new cards', async () => {
    const { ctx, dispose } = await mountProvider();
    const newCard = makeCard({ id: 'new-1', state: 'new' });
    flashcardsCb(makeEmptyStore({ flashcards: { 'new-1': newCard } }));

    expect(ctx.getNewCount()).toBe(1);
    dispose();
  });

  it('getDueCount excludes suspended and buried cards', async () => {
    const { ctx, dispose } = await mountProvider();
    seed(makeEmptyStore({
      flashcards: {
        'due-ok': makeCard({ id: 'due-ok', state: 'review', interval: 86400000, dueDate: Date.now() - 1000 }),
        'due-sus': makeCard({ id: 'due-sus', state: 'review', interval: 86400000, dueDate: Date.now() - 1000, suspended: true }),
        'due-bur': makeCard({ id: 'due-bur', state: 'review', interval: 86400000, dueDate: Date.now() - 1000, buried: true }),
      },
    }));

    expect(ctx.getDueCount()).toBe(1);
    dispose();
  });

  // ─── Priority 1: getAllCards / getCardById ─────────────────────────
  it('getAllCards returns all cards', async () => {
    const { ctx, dispose } = await mountProvider();
    const card1 = makeCard({ id: 'all-1' });
    const card2 = makeCard({ id: 'all-2', content: { type: 'word', front: '犬', back: 'dog' } });
    flashcardsCb(makeEmptyStore({ flashcards: { 'all-1': card1, 'all-2': card2 } }));

    const all = ctx.getAllCards();
    expect(all).toHaveLength(2);
    dispose();
  });

  it('getCardById returns card or null', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'by-id-1' });
    flashcardsCb(makeEmptyStore({ flashcards: { 'by-id-1': card } }));

    expect(ctx.getCardById('by-id-1')).toBeDefined();
    expect(ctx.getCardById('nonexistent')).toBeNull();
    dispose();
  });

  // ─── Priority 1: Queue management ─────────────────────────────────
  it('queue is populated after loading cards', async () => {
    const { ctx, dispose } = await mountProvider();
    const newCard = makeCard({ id: 'q-1', state: 'new' });
    flashcardsCb(makeEmptyStore({ flashcards: { 'q-1': newCard } }));

    const q = ctx.queue();
    expect(q.newQueue.length + q.scheduledQueue.length).toBeGreaterThan(0);
    dispose();
  });

  it('getCurrentCard returns first card in queue', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'curr-1', state: 'new' });
    flashcardsCb(makeEmptyStore({ flashcards: { 'curr-1': card } }));

    const current = ctx.getCurrentCard();
    expect(current).toBeDefined();
    expect(current!.id).toBe('curr-1');
    dispose();
  });

  it('getCurrentCard returns null when no cards', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    expect(ctx.getCurrentCard()).toBeNull();
    dispose();
  });

  it('queueCounts reflects card states', async () => {
    const { ctx, dispose } = await mountProvider();
    const card1 = makeCard({ id: 'qc-1', state: 'new' });
    const card2 = makeCard({ id: 'qc-2', state: 'review', interval: 86400000, dueDate: Date.now() - 1000, reviews: 3 });
    flashcardsCb(makeEmptyStore({ flashcards: { 'qc-1': card1, 'qc-2': card2 } }));

    const counts = ctx.queueCounts();
    expect(counts.total).toBeGreaterThanOrEqual(1);
    dispose();
  });

  // ─── Priority 1: Store version handling ───────────────────────────
  it('loading a v5 store preserves version', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore({ version: 5 }));

    expect(ctx.store.version).toBe(CURRENT_VERSION);
    dispose();
  });

  it('loading an old version store migrates to current version', async () => {
    const { ctx, dispose } = await mountProvider();
    const oldStore = makeEmptyStore({ version: 2 });
    flashcardsCb(oldStore);

    expect(ctx.store.version).toBe(CURRENT_VERSION);
    dispose();
  });

  it('v2→v3 migration converts single wordToCardMap entries to arrays', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'mig-1' });
    const oldStore = {
      ...makeEmptyStore({ version: 2 }),
      flashcards: { 'mig-1': card },
      wordToCardMap: { 'somehash': 'mig-1' },
    };
    flashcardsCb(oldStore as unknown as FlashcardStore);

    const mapVals = Object.values(ctx.store.wordToCardMap);
    for (const val of mapVals) {
      expect(Array.isArray(val)).toBe(true);
    }
    dispose();
  });

  // ─── Priority 1: Save triggers ────────────────────────────────────
  it('addFlashcard triggers save via bridge', async () => {
    const { ctx, dispose } = await mountProvider();
    seedAccepted();

    await ctx.addFlashcard({ front: '水', back: 'water' }, undefined, true);

    await vi.waitFor(() => {
      expect(mockBridge.flashcards.saveFlashcards).toHaveBeenCalled();
    });
    dispose();
  });

  // ─── Priority 1: suspend / unsuspend / bury ──────────────────────
  it('suspendCard marks card as suspended and removes from queue', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'sus-1', state: 'new' });
    flashcardsCb(makeEmptyStore({ flashcards: { 'sus-1': card } }));

    ctx.suspendCard('sus-1');
    expect(ctx.store.flashcards['sus-1'].suspended).toBe(true);
    dispose();
  });

  it('unsuspendCard un-suspends card', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'unsus-1', suspended: true });
    flashcardsCb(makeEmptyStore({ flashcards: { 'unsus-1': card } }));

    ctx.unsuspendCard('unsus-1');
    expect(ctx.store.flashcards['unsus-1'].suspended).toBe(false);
    dispose();
  });

  it('buryCard marks card as buried', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'bury-1', state: 'new' });
    flashcardsCb(makeEmptyStore({ flashcards: { 'bury-1': card } }));

    ctx.buryCard('bury-1');
    expect(ctx.store.flashcards['bury-1'].buried).toBe(true);
    dispose();
  });

  // ─── Priority 1: Undo system ──────────────────────────────────────
  it('canUndo returns false initially', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    expect(ctx.canUndo()).toBe(false);
    dispose();
  });

  it('pushUndoState and undoLastAction restore state', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'undo-1', ease: 2.5 });
    flashcardsCb(makeEmptyStore({ flashcards: { 'undo-1': card } }));

    ctx.pushUndoState({ type: 'test', cardId: 'undo-1' });
    ctx.updateFlashcard('undo-1', { ease: 4.0 });
    expect(ctx.store.flashcards['undo-1'].ease).toBe(4.0);

    await ctx.undoLastAction();
    expect(ctx.store.flashcards['undo-1'].ease).toBe(2.5);
    dispose();
  });

  it.each(['bury', 'suspend'] as const)('manual %s Undo preserves later authored content, scheduler changes and opaque metadata', async action => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: `manual-preserve-${action}`, state: 'review', reviews: 2 });
    seed(makeEmptyStore({ flashcards: { [card.id]: card } }));
    if (action === 'bury') ctx.buryCard(card.id); else ctx.suspendCard(card.id);
    ctx.updateFlashcard(card.id, { reviews: 7, interval: 987654, content: {
      ...card.content, back: 'later authored answer', futureFeature: { arbitrary: ['new', { contextual: true }] },
    } });
    await expect(ctx.undoLastAction()).resolves.toBe(action);
    expect(ctx.store.flashcards[card.id].reviews).toBe(7);
    expect(ctx.store.flashcards[card.id].interval).toBe(987654);
    expect(ctx.store.flashcards[card.id].content.back).toBe('later authored answer');
    expect(ctx.store.flashcards[card.id].content.futureFeature).toEqual({ arbitrary: ['new', { contextual: true }] });
    expect(ctx.store.flashcards[card.id][action === 'bury' ? 'buried' : 'suspended']).toBe(card[action === 'bury' ? 'buried' : 'suspended']);
    expect(committed!.flashcards[card.id].content.back).toBe('later authored answer');
    dispose();
  });

  it.each([true, false])('manual Undo recomputes only its owned flag after a peer commit and preserves the peer review position (Electron=%s)', async electron => {
    mockIsElectron.mockReturnValue(electron);
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'manual-rebase', state: 'review', reviews: 2 });
    const peer = makeCard({ id: 'manual-peer-position' });
    seed(makeEmptyStore({ flashcards: { [card.id]: card, [peer.id]: peer } }));
    ctx.buryCard(card.id);
    await vi.waitFor(() => expect(committed!.flashcards[card.id].buried).toBe(true));
    answerProbesFromAuthority();
    committed!.flashcards[card.id].content.back = 'peer authored during Undo';
    committed!.flashcards[card.id].reviews = 8;
    committed!.flashcards[card.id].lastUpdated += 1;
    committed!.meta.reviewPresentations = { ja: { id: 'peer-current-owner', cardId: peer.id } };
    committed!.rev = ++revision;
    await expect(ctx.undoLastAction()).resolves.toBe('bury');
    expect(committed!.flashcards[card.id].reviews).toBe(8);
    expect(ctx.store.flashcards[card.id].reviews).toBe(8);
    expect(ctx.store.flashcards[card.id].content.back).toBe('peer authored during Undo');
    expect(committed!.flashcards[card.id].content.back).toBe('peer authored during Undo');
    expect(committed!.flashcards[card.id].buried).not.toBe(true);
    expect(committed!.meta.reviewPresentations!.ja).toEqual({ id: 'peer-current-owner', cardId: peer.id });
    dispose();
  });

  it('manual Undo does not resurrect a card deleted by a peer before its stale write can rebase', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'manual-deleted' });
    seed(makeEmptyStore({ flashcards: { [card.id]: card } }));
    ctx.suspendCard(card.id);
    await vi.waitFor(() => expect(committed!.flashcards[card.id].suspended).toBe(true));
    answerProbesFromAuthority();
    delete committed!.flashcards[card.id];
    committed!.rev = ++revision;
    await expect(ctx.undoLastAction()).rejects.toThrow('undo persistence was refused');
    expect(committed!.flashcards[card.id]).toBeUndefined();
    expect(ctx.store.flashcards[card.id]).toBeUndefined();
    expect(ctx.canUndo()).toBe(false);
    dispose();
  });

  it.each(['bury', 'suspend'] as const)('does not manufacture manual Undo for an already %s excluded card', async action => {
    const { ctx, dispose } = await mountProvider();
    const field = action === 'bury' ? 'buried' : 'suspended';
    const card = makeCard({ id: `manual-noop-${action}`, [field]: true });
    seed(makeEmptyStore({ flashcards: { [card.id]: card } }));
    if (action === 'bury') ctx.buryCard(card.id); else ctx.suspendCard(card.id);
    expect(ctx.canUndo()).toBe(false);
    await expect(ctx.undoLastAction()).resolves.toBeNull();
    expect(ctx.store.flashcards[card.id][field]).toBe(true);
    dispose();
  });

  it.each(['front', 'language', 'resumed'] as const)('does not offer manual Undo after the card is %s changed', async change => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: `manual-inapplicable-${change}` });
    seed(makeEmptyStore({ flashcards: { [card.id]: card } }));
    ctx.suspendCard(card.id);
    await vi.waitFor(() => expect(committed!.flashcards[card.id].suspended).toBe(true));
    if (change === 'front') committed!.flashcards[card.id].content.front = 'different target';
    else if (change === 'language') committed!.flashcards[card.id].language = 'unknown-future-language';
    else committed!.flashcards[card.id].suspended = false;
    committed!.rev = ++revision;
    deliver(committed);
    expect(ctx.canUndo()).toBe(false);
    await expect(ctx.undoLastAction()).resolves.toBeNull();
    expect(ctx.store.flashcards[card.id]).toEqual(committed!.flashcards[card.id]);
    dispose();
  });

  it('manual Bury Undo returns to the exact original immutable choice so its answer exposure remains owned', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'manual-choice' });
    seed(makeEmptyStore({ rev: revision, flashcards: { [card.id]: card } }));
    const decision = selectFlashcardReviewDecision({ id: 'manual-original-choice', at: 20,
      entries: [flashcardReviewPolicyEntry(card, 'ja')], rng: () => 0.7 })!.provenance;
    const presentation = { id: decision.id, cardId: card.id, decision,
      scaffolds: { 'provided-access:unknown-package-dimension': true } };
    await ctx.saveReviewPresentation('ja', presentation, null);
    ctx.buryCard(card.id);
    expect(ctx.store.meta.reviewPresentations?.ja).toBeUndefined();
    await ctx.undoLastAction();
    expect(committed!.meta.reviewPresentations?.ja).toEqual(presentation);
    expect(ctx.store.meta.reviewPresentations?.ja).toEqual(presentation);
    expect(mockAppendEvents).not.toHaveBeenCalled();
    dispose();
  });

  it.each([['bury', 'suspend'], ['suspend', 'bury']] as const)('compound %s then %s Undo retains the original immutable choice and supplied flags', async (first, second) => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: `manual-compound-${first}` });
    seed(makeEmptyStore({ rev: revision, flashcards: { [card.id]: card } }));
    const decision = selectFlashcardReviewDecision({ id: `compound-original-${first}`, at: 20,
      entries: [flashcardReviewPolicyEntry(card, 'ja')], rng: () => 0.7 })!.provenance;
    const presentation = { id: decision.id, cardId: card.id, decision,
      scaffolds: { audio: true, 'provided-access:unknown-package-dimension': true } };
    await ctx.saveReviewPresentation('ja', presentation, null);
    const act = (action: string) => action === 'bury' ? ctx.buryCard(card.id) : ctx.suspendCard(card.id);
    act(first); act(second);
    await expect(ctx.undoLastAction()).resolves.toBe(second);
    expect(ctx.store.meta.reviewPresentations?.ja).toBeUndefined();
    await expect(ctx.undoLastAction()).resolves.toBe(first);
    expect(committed!.meta.reviewPresentations?.ja).toEqual(presentation);
    expect(ctx.store.meta.reviewPresentations?.ja).toEqual(presentation);
    expect(ctx.store.flashcards[card.id].buried).not.toBe(true);
    expect(ctx.store.flashcards[card.id].suspended).not.toBe(true);
    dispose();
  });

  it('an older manual Undo cannot cancel a peer Resume/re-exclusion cycle', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'manual-replaced-owner' });
    seed(makeEmptyStore({ flashcards: { [card.id]: card } }));
    ctx.suspendCard(card.id);
    await vi.waitFor(() => expect(committed!.flashcards[card.id].suspended).toBe(true));
    const originalOwner = committed!.flashcards[card.id].scheduleActionOwners!.suspended;
    committed!.flashcards[card.id] = SRS.suspendCard({ ...committed!.flashcards[card.id], suspended: false });
    expect(committed!.flashcards[card.id].scheduleActionOwners!.suspended).not.toBe(originalOwner);
    committed!.rev = ++revision;
    deliver(committed);
    expect(ctx.canUndo()).toBe(false);
    await expect(ctx.undoLastAction()).resolves.toBeNull();
    expect(committed!.flashcards[card.id].suspended).toBe(true);
    dispose();
  });

  it('mixed explicit exclusion writes retire the resumed owner on the replacement card before acknowledgement', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'manual-mixed-write', suspended: true,
      scheduleActionOwners: { suspended: 'older-suspend', 'future-action': 'opaque-owner' } });
    seed(makeEmptyStore({ flashcards: { [card.id]: card } }));
    ctx.updateFlashcard(card.id, { buried: true, suspended: false });
    expect(ctx.store.flashcards[card.id].scheduleActionOwners?.suspended).toBeUndefined();
    expect(ctx.store.flashcards[card.id].scheduleActionOwners?.buried).toBeTypeOf('string');
    expect(ctx.store.flashcards[card.id].scheduleActionOwners?.['future-action']).toBe('opaque-owner');
    await vi.waitFor(() => expect(committed!.flashcards[card.id].buried).toBe(true));
    expect(ctx.store.flashcards[card.id]).toEqual(committed!.flashcards[card.id]);
    dispose();
  });

  it('reactively removes manual Undo availability immediately when the learner resumes the card', async () => {
    const { createRoot, createMemo } = await import('solid-js');
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'manual-reactive-resume' });
    seed(makeEmptyStore({ flashcards: { [card.id]: card } }));
    ctx.suspendCard(card.id);
    let disposeMemo!: () => void;
    const available = createRoot(end => { disposeMemo = end; return createMemo(() => ctx.canUndo()); });
    expect(available()).toBe(true);
    ctx.unsuspendCard(card.id);
    expect(available()).toBe(false);
    disposeMemo(); dispose();
  });

  it('undoLastAction is no-op when stack is empty', async () => {
    const { ctx, dispose } = await mountProvider();
    seedAccepted();

    await ctx.undoLastAction();
    expect(ctx.canUndo()).toBe(false);
    dispose();
  });

  // ─── Priority 1: resetSRS / nukeAllFlashcards ────────────────────
  it('resetSRS resets all cards to new state', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({
      id: 'reset-1',
      state: 'review',
      interval: 86400000,
      ease: 3.0,
      reviews: 10,
    });
    flashcardsCb(makeEmptyStore({ flashcards: { 'reset-1': card } }));

    ctx.resetSRS();

    const after = ctx.store.flashcards['reset-1'];
    expect(after.state).toBe('new');
    expect(after.ease).toBe(SRS.MIN_EASE);
    expect(after.interval).toBe(0);
    expect(after.reviews).toBe(0);
    expect(ctx.store.meta.newCardsToday).toBe(0);
    dispose();
  });

  it('resetSRS makes the NEXT review schedule from the reset state, not the pre-reset cache', async () => {
    // The scheduler cache is what answerCard reads in preference to the
    // mirrored card fields. A reset that leaves it behind would show
    // 'new' in the UI while silently resuming the pre-reset review interval.
    const { ctx, dispose } = await mountProvider();
    const scheduled = SRS.answerCard(
      makeCard({ id: 'reset-cache', state: 'review', interval: 86400000, ease: 3.0, reviews: 10 }),
      'good',
      SRS.getDefaultMeta(),
    );
    expect(scheduled.retentionCache?.interval).toBeGreaterThan(0);
    flashcardsCb(makeEmptyStore({ flashcards: { 'reset-cache': scheduled } }));

    ctx.resetSRS();

    const next = SRS.answerCard(ctx.store.flashcards['reset-cache'], 'good', SRS.getDefaultMeta());
    // A fresh card's first 'good' walks the learning steps, so the next due
    // date is minutes away — never the pre-reset multi-day review interval.
    expect(next.state).toBe('learning');
    expect(next.retentionCache!.dueAt - Date.now()).toBeLessThan(60 * 60 * 1000);
    dispose();
  });

  it('nukeAllFlashcards wipes everything', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'nuke-1' });
    flashcardsCb(makeEmptyStore({ flashcards: { 'nuke-1': card } }));

    ctx.nukeAllFlashcards();

    expect(Object.keys(ctx.store.flashcards)).toHaveLength(0);
    expect(Object.keys(ctx.store.wordToCardMap)).toHaveLength(0);
    expect(Object.keys(ctx.store.wordStatsMap)).toHaveLength(0);
    expect(ctx.canUndo()).toBe(false);
    dispose();
  });

  // ─── Priority 2: Synchronous lookups ──────────────────────────────
  it('hasWordSync returns true for existing words', async () => {
    const { ctx, dispose } = await mountProvider();
    seedAccepted();

    await ctx.addFlashcard({ front: '森', back: 'forest' }, undefined, true);
    expect(ctx.hasWordSync('森')).toBe(true);
    expect(ctx.hasWordSync('unkown')).toBe(false);
    dispose();
  });

  it('getCardByWordSync returns card for existing word', async () => {
    const { ctx, dispose } = await mountProvider();
    seedAccepted();

    await ctx.addFlashcard({ front: '海', back: 'sea' }, undefined, true);
    const card = ctx.getCardByWordSync('海');
    expect(card).not.toBeNull();
    expect(card!.content.front).toBe('海');
    dispose();
  });

  it('getCardByWordSync finds cards through language-provided variants', async () => {
    mockGetWordVariants.mockImplementation((word: string) => word === 'иду' ? ['идти', 'иду'] : []);
    const { ctx, dispose } = await mountProvider();
    seedAccepted();

    await ctx.addFlashcard({ front: 'идти', back: 'to go' }, undefined, true);
    const card = ctx.getCardByWordSync('иду');

    expect(card).not.toBeNull();
    expect(card!.content.front).toBe('идти');
    expect(ctx.hasWordSync('иду')).toBe(true);
    dispose();
  });

  it('addFlashcard stores inflected words under the language primary form key', async () => {
    mockGetCanonicalForm.mockImplementation((word: string) => word === 'иду' ? 'идти' : word);
    mockGetWordVariants.mockImplementation((word: string) => word === 'иду' ? ['идти', 'иду'] : []);
    const { ctx, dispose } = await mountProvider();
    seedAccepted();

    await ctx.addFlashcard({ front: 'иду', back: 'I go' }, undefined, true);

    const SRS = await import('../services/srsAlgorithm');
    const primaryKey = `ja:${await SRS.hashWord('идти')}`;
    const inflectedKey = `ja:${await SRS.hashWord('иду')}`;
    expect(ctx.store.wordToCardMap[primaryKey]).toHaveLength(1);
    expect(ctx.store.wordToCardMap[inflectedKey]).toBeUndefined();
    expect(ctx.getCardByWordSync('идти')?.content.front).toBe('иду');
    dispose();
  });

  it('addFlashcard stores explicit non-active language cards under that language primary form key', async () => {
    mockSettings.language = 'ja';
    mockGetCanonicalFormForLanguage.mockImplementation((language: string, word: string) => (
      language === 'ar' && word === 'يكتب' ? 'كتب' : word
    ));
    mockGetWordVariantsForLanguage.mockImplementation((language: string, word: string) => (
      language === 'ar' && word === 'يكتب' ? ['كتب', 'يكتب'] : [word]
    ));
    const { ctx, dispose } = await mountProvider();
    seedAccepted();

    await ctx.addFlashcard({ front: 'يكتب', back: 'he writes' }, undefined, true, 'ar');

    const SRS = await import('../services/srsAlgorithm');
    const primaryKey = `ar:${await SRS.hashWord('كتب')}`;
    const inflectedKey = `ar:${await SRS.hashWord('يكتب')}`;
    const activeKey = `ja:${await SRS.hashWord('كتب')}`;
    expect(ctx.store.wordToCardMap[primaryKey]).toHaveLength(1);
    expect(ctx.store.wordToCardMap[inflectedKey]).toBeUndefined();
    expect(ctx.store.wordToCardMap[activeKey]).toBeUndefined();
    expect(ctx.getAllCards()[0].language).toBe('ar');
    dispose();
  });

  it('addFlashcard skips explicit non-active language variants marked known by canonical form', async () => {
    mockSettings.language = 'ja';
    mockGetCanonicalFormForLanguage.mockImplementation((language: string, word: string) => (
      language === 'ar' && word === 'يكتب' ? 'كتب' : word
    ));
    mockGetWordVariantsForLanguage.mockImplementation((language: string, word: string) => (
      language === 'ar' && word === 'يكتب' ? ['كتب', 'يكتب'] : [word]
    ));
    const { ctx, dispose } = await mountProvider();
    seedAccepted();

    await ctx.ignoreWordForLanguage('كتب', undefined, 'ar');
    const createdId = await ctx.addFlashcard({ front: 'يكتب', back: 'he writes' }, undefined, true, 'ar');

    expect(createdId).toBe('');
    expect(ctx.getAllCards()).toHaveLength(0);
    dispose();
  });

  it('sync card lookups can target a non-active stored word language explicitly', async () => {
    mockSettings.language = 'ja';
    const { ctx, dispose } = await mountProvider();
    seedAccepted();

    await ctx.addFlashcard({ front: 'سلام', back: 'hello' }, undefined, true, 'ar');

    expect(ctx.hasWordSync('سلام')).toBe(false);
    expect(ctx.getCardByWordSync('سلام')).toBeNull();
    expect(ctx.hasWordSync('سلام', 'ar')).toBe(true);
    expect(ctx.getCardByWordSync('سلام', 'ar')?.content.front).toBe('سلام');
    expect(ctx.getCardsByWordSync('سلام', 'ar')).toHaveLength(1);
    dispose();
  });

  it('findUnpopulatedFlashcardForWord uses explicit language forms', async () => {
    mockSettings.language = 'ja';
    mockGetCanonicalFormForLanguage.mockImplementation((language: string, word: string) => (
      language === 'ar' && word === 'يكتب' ? 'كتب' : word
    ));
    mockGetWordVariantsForLanguage.mockImplementation((language: string, word: string) => (
      language === 'ar' && word === 'يكتب' ? ['كتب', 'يكتب'] : [word]
    ));
    const { ctx, dispose } = await mountProvider();
    seedAccepted();

    await ctx.addFlashcard({ front: 'كتب', back: 'write', unpopulated: true }, undefined, true, 'ar');

    expect(ctx.findUnpopulatedFlashcardForWord('يكتب')).toBeNull();
    expect(ctx.findUnpopulatedFlashcardForWord('يكتب', 'ar')?.content.front).toBe('كتب');
    dispose();
  });

  it('getCardsByWordSync returns all cards for a word', async () => {
    const { ctx, dispose } = await mountProvider();
    seedAccepted();

    await ctx.addFlashcard({ front: '石', back: 'stone' }, undefined, true);
    await ctx.addFlashcard({ front: '石', back: 'rock' }, undefined, true);
    const cards = ctx.getCardsByWordSync('石');
    expect(cards).toHaveLength(2);
    dispose();
  });

  it('hasWordSync returns false for empty string', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    expect(ctx.hasWordSync('')).toBe(false);
    dispose();
  });

  // ─── Priority 2: Async word lookup ────────────────────────────────
  it('hasWord returns true after adding card', async () => {
    const { ctx, dispose } = await mountProvider();
    seedAccepted();

    await ctx.addFlashcard({ front: '星', back: 'star' }, undefined, true);
    const result = await ctx.hasWord('星');
    expect(result).toBe(true);
    dispose();
  });

  it('hasWord and getCardsByWord find cards through language-provided variants', async () => {
    mockGetWordVariants.mockImplementation((word: string) => word === 'يكتب' ? ['كتب', 'يكتب'] : []);
    const { ctx, dispose } = await mountProvider();
    seedAccepted();

    await ctx.addFlashcard({ front: 'كتب', back: 'write' }, undefined, true);

    expect(await ctx.hasWord('يكتب')).toBe(true);
    const cards = await ctx.getCardsByWord('يكتب');
    expect(cards).toHaveLength(1);
    expect(cards[0].content.front).toBe('كتب');
    dispose();
  });

  it('async word lookups can target a non-active stored word language explicitly', async () => {
    mockSettings.language = 'ja';
    const { ctx, dispose } = await mountProvider();
    seedAccepted();

    await ctx.addFlashcard({ front: 'سلام', back: 'hello' }, undefined, true, 'ar');

    expect(await ctx.hasWord('سلام')).toBe(false);
    expect(await ctx.getCardByWord('سلام')).toBeNull();
    expect(await ctx.hasWord('سلام', 'ar')).toBe(true);
    expect((await ctx.getCardByWord('سلام', 'ar'))?.content.front).toBe('سلام');
    expect(await ctx.getCardsByWord('سلام', 'ar')).toHaveLength(1);
    dispose();
  });

  it('getWordStats can target a non-active stored word language explicitly', async () => {
    mockSettings.language = 'ja';
    mockGetCanonicalFormForLanguage.mockImplementation((language: string, word: string) => (
      language === 'ar' && word === 'يكتب' ? 'كتب' : word
    ));
    mockGetWordVariantsForLanguage.mockImplementation((language: string, word: string) => (
      language === 'ar' && word === 'يكتب' ? ['كتب', 'يكتب'] : [word]
    ));
    const { ctx, dispose } = await mountProvider();
    seedAccepted();

    await ctx.addFlashcard({ front: 'يكتب', back: 'he writes' }, undefined, true, 'ar');

    expect(await ctx.getWordStats('يكتب')).toBeNull();
    expect(await ctx.getWordStats('يكتب', 'ar')).toMatchObject({ cardCount: 1 });
    dispose();
  });

  it('getCardsByWord returns cards for a word', async () => {
    const { ctx, dispose } = await mountProvider();
    seedAccepted();

    await ctx.addFlashcard({ front: '月', back: 'moon' }, undefined, true);
    const cards = await ctx.getCardsByWord('月');
    expect(cards).toHaveLength(1);
    expect(cards[0].content.front).toBe('月');
    dispose();
  });

  it('getCardByWord returns best card when multiple exist', async () => {
    const { ctx, dispose } = await mountProvider();
    seedAccepted();

    const id1 = await ctx.addFlashcard({ front: '風', back: 'wind' }, undefined, true);
    await ctx.addFlashcard({ front: '風', back: 'breeze' }, undefined, true);
    ctx.updateFlashcard(id1, { state: 'review', reviews: 5, interval: 86400000 });

    const best = await ctx.getCardByWord('風');
    expect(best).not.toBeNull();
    expect(best!.id).toBe(id1);
    dispose();
  });

  // ─── Priority 2: isWordIgnoredSync ────────────────────────────────
  it('isWordIgnoredSync returns true for ignored words', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    await ctx.ignoreWordForLanguage('テスト');
    expect(ctx.isWordIgnoredSync('テスト')).toBe(true);
    dispose();
  });

  it('isWordIgnoredSync finds ignored words through language-provided variants', async () => {
    mockGetWordVariants.mockImplementation((word: string) => word === '食べた' ? ['食べる', '食べた'] : []);
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    await ctx.ignoreWordForLanguage('食べる');

    expect(ctx.isWordIgnoredSync('食べた')).toBe(true);
    dispose();
  });

  it('ignoreWordForLanguage can target a non-active stored word language', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    mockSettings.language = 'ja';
    const SRS = await import('../services/srsAlgorithm');
    const hash = await SRS.hashWord('سلام');
    const arKey = `ar:${hash}`;
    const jaKey = `ja:${hash}`;

    await ctx.ignoreWordForLanguage('سلام', undefined, 'ar');

    // Ignore is exclusion POLICY — no epistemic write of any kind.
    expect(ctx.store.ignoredWords[arKey]).toMatchObject({
      word: 'سلام',
      language: 'ar',
    });
    expect(ctx.store.wordKnowledge[arKey]).toBeUndefined();
    expect(ctx.store.knownUntracked[arKey]).toBeUndefined();
    expect(ctx.store.wordKnowledge[jaKey]).toBeUndefined();
    expect(ctx.store.ignoredWords[jaKey]).toBeUndefined();
    expect(ctx.isWordIgnoredSync('سلام', 'ar')).toBe(true);
    const ignoreEvents = mockAppendEvents.mock.calls
      .flatMap(([byKey]) => Object.entries(byKey as Record<string, Array<Record<string, unknown>>>))
      .filter(([key]) => key === arKey);
    expect(ignoreEvents).toHaveLength(0);
    dispose();
  });

  it('keeps an excluded authored card out of study queues and due counts without deleting it', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'excluded-authored', language: 'ja', state: 'review', reviews: 9,
      dueDate: Date.now() - 1000, content: { type: 'word', front: '学校', back: 'authored explanation' } });
    const key = `ja:${SRS.hashWordSync(card.content.front)}`;
    const data = makeEmptyStore({ flashcards: { [card.id]: card },
      ignoredWords: { [key]: { word: card.content.front, language: 'ja', ignoredAt: Date.now() } } });
    flashcardsCb(data);
    try {
      ctx.refreshQueue();
      expect(ctx.store.flashcards[card.id]).toMatchObject(card);
      expect(ctx.getCurrentCard()).toBeNull();
      expect(ctx.queueCounts().total).toBe(0);
      expect(ctx.getDueCount()).toBe(0);
      expect(ctx.queue().scheduledQueue).not.toContain(card.id);
      await expect(ctx.submitRating(card.content.front, [{ capability: 'sense-recognition', quality: 'fluent' }], {
        language: 'ja', scheduler: { cardId: card.id, rating: 'good', tested: ['sense-recognition'] },
      })).rejects.toThrow('excluded');
      expect(ctx.store.flashcards[card.id].reviews).toBe(9);
      expect(mockAppendEvents).not.toHaveBeenCalled();
    } finally { dispose(); }
  });

  it('preserves indexed authored cards through study exclusion and restores eligibility on withdrawal', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'reversible-exclusion', language: 'ja', state: 'new', reviews: 0,
      content: { type: 'word', front: '学校', back: 'authored explanation' } });
    const key = `ja:${SRS.hashWordSync(card.content.front)}`;
    flashcardsCb(makeEmptyStore({ flashcards: { [card.id]: card }, wordToCardMap: { [key]: [card.id] } }));
    try {
      await ctx.ignoreWordForLanguage(card.content.front, undefined, 'ja');
      expect(ctx.store.flashcards[card.id]).toMatchObject(card);
      expect(ctx.store.wordToCardMap[key]).toEqual([card.id]);
      expect(ctx.queueCounts().total).toBe(0);
      expect(ctx.getNewCount()).toBe(0);
      expect(ctx.getCurrentCard()).toBeNull();
      await ctx.unignoreWordForLanguage(card.content.front, 'ja');
      expect(ctx.store.flashcards[card.id]).toMatchObject(card);
      expect(ctx.getCurrentCard()?.id).toBe(card.id);
      expect(ctx.getNewCount()).toBe(1);
      expect(ctx.queueCounts().total).toBe(1);
      expect(mockAppendEvents).not.toHaveBeenCalled();
    } finally { dispose(); }
  });

  it.each(['exclude', 'withdraw'] as const)('preserves opaque package metadata and reading when a learner first chooses to %s', async firstAction => {
    const { ctx, dispose } = await mountProvider();
    const key = `package-x:${SRS.hashWordSync('target')}`;
    const entry = { word: 'target', reading: 'package reading', language: 'package-x',
      ignoredAt: 10, updatedAt: 10, excluded: firstAction === 'withdraw',
      'third-party:unfamiliar-feature': { participants: ['speaker', 'listener'],
        conditions: [{ scope: { spans: [[2, 5]] }, values: ['unknown-class', { nested: true }] }] } };
    seed(makeEmptyStore({ ignoredWords: { [key]: entry } }));
    const expectedMetadata = { reading: entry.reading,
      'third-party:unfamiliar-feature': entry['third-party:unfamiliar-feature'] };
    const assertPreserved = (excluded: boolean) => {
      expect(ctx.store.ignoredWords[key]).toMatchObject({ ...expectedMetadata, excluded });
      const serialized = JSON.parse(JSON.stringify(acceptedSaves.at(-1))) as FlashcardStore;
      expect(serialized.ignoredWords[key]).toMatchObject({ ...expectedMetadata, excluded });
    };
    try {
      if (firstAction === 'exclude') await ctx.ignoreWordForLanguage('target', undefined, 'package-x');
      else await ctx.unignoreWordForLanguage('target', 'package-x');
      assertPreserved(firstAction === 'exclude');
      await ctx.unignoreWordForLanguage('target', 'package-x');
      assertPreserved(false);
      await ctx.ignoreWordForLanguage('target', undefined, 'package-x');
      assertPreserved(true);
      await ctx.ignoreWordForLanguage('target', 'corrected package reading', 'package-x');
      expect(ctx.store.ignoredWords[key]).toMatchObject({ reading: 'corrected package reading',
        'third-party:unfamiliar-feature': entry['third-party:unfamiliar-feature'], excluded: true });
    } finally { dispose(); }
  });

  it('publishes study exclusion and withdrawal only after their durable acknowledgment', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'exclusion-ack', language: 'ja', state: 'review', reviews: 9,
      dueDate: Date.now() - 1000, content: { type: 'word', front: '学校', back: 'authored explanation' } });
    flashcardsCb(makeEmptyStore({ flashcards: { [card.id]: card } }));
    try {
      mockBridge.flashcards.saveFlashcards.mockRejectedValueOnce(new Error('disk full'));
      await expect(ctx.ignoreWordForLanguage(card.content.front, undefined, 'ja')).rejects.toThrow('disk full');
      expect(ctx.isWordIgnoredSync(card.content.front, 'ja')).toBe(false);
      expect(ctx.getCurrentCard()?.id).toBe(card.id);
      expect(ctx.store.flashcards[card.id]).toMatchObject(card);
      await ctx.ignoreWordForLanguage(card.content.front, undefined, 'ja');
      expect(ctx.isWordIgnoredSync(card.content.front, 'ja')).toBe(true);
      mockBridge.flashcards.saveFlashcards.mockRejectedValueOnce(new Error('disk full'));
      await expect(ctx.unignoreWordForLanguage(card.content.front, 'ja')).rejects.toThrow('disk full');
      expect(ctx.isWordIgnoredSync(card.content.front, 'ja')).toBe(true);
      expect(ctx.getCurrentCard()).toBeNull();
      await ctx.unignoreWordForLanguage(card.content.front, 'ja');
      expect(ctx.isWordIgnoredSync(card.content.front, 'ja')).toBe(false);
      expect(ctx.getCurrentCard()?.id).toBe(card.id);
    } finally { dispose(); }
  });

  it('withdraws legacy alias exclusions without changing another package or authored cards', async () => {
    mockGetCanonicalFormForLanguage.mockImplementation((language: string, word: string) => language === 'package-x' && word === 'variant' ? 'target' : word);
    mockGetWordVariantsForLanguage.mockImplementation((language: string, word: string) => language === 'package-x' && word === 'variant' ? ['target', 'variant'] : [word]);
    const { ctx, dispose } = await mountProvider();
    const alias = `package-x:${SRS.hashWordSync('variant')}`;
    const foreign = `package-y:${SRS.hashWordSync('variant')}`;
    const aliasPreference = { word: 'variant', reading: 'alias reading', language: 'package-x', ignoredAt: 10,
      'third-party:unfamiliar-feature': { dependentValues: [{ relation: 'unregistered', values: [1, 'opaque'] }] } };
    const card = makeCard({ id: 'alias-card', language: 'package-x', content: { type: 'word', front: 'variant', back: 'authored' } });
    flashcardsCb(makeEmptyStore({ flashcards: { [card.id]: card }, ignoredWords: {
      [alias]: aliasPreference,
      [foreign]: { word: 'variant', language: 'package-y', ignoredAt: 10 },
    } }));
    try {
      expect(ctx.isWordIgnoredSync('variant', 'package-x')).toBe(true);
      expect(ctx.getStudyableCards()[card.id]).toBeUndefined();
      await ctx.unignoreWordForLanguage('variant', 'package-x');
      expect(ctx.store.ignoredWords[alias]).toMatchObject({ ...aliasPreference, excluded: false });
      const serialized = JSON.parse(JSON.stringify(acceptedSaves.at(-1))) as FlashcardStore;
      expect(serialized.ignoredWords[alias]).toMatchObject({ ...aliasPreference, excluded: false });
      expect(ctx.isWordIgnoredSync('variant', 'package-x')).toBe(false);
      expect(ctx.isWordIgnoredSync('variant', 'package-y')).toBe(true);
      expect(ctx.getStudyableCards()[card.id]).toMatchObject(card);
    } finally { dispose(); }
  });

  it('fills a daily-cap slot from eligible cards when an authored card is excluded', async () => {
    const { ctx, dispose } = await mountProvider();
    const first = makeCard({ id: 'first-new', language: 'ja', state: 'new', createdAt: 1,
      content: { type: 'word', front: 'first', back: 'authored' } });
    const second = makeCard({ id: 'second-new', language: 'ja', state: 'new', createdAt: 2,
      content: { type: 'word', front: 'second', back: 'authored' } });
    const data = makeEmptyStore({ flashcards: { [first.id]: first, [second.id]: second } });
    data.meta.maxNewCardsPerDayLearning = 1;
    flashcardsCb(data);
    try {
      ctx.refreshQueue();
      expect(ctx.queue().newQueue).toEqual([first.id]);
      await ctx.ignoreWordForLanguage('first', undefined, 'ja');
      expect(ctx.queue().newQueue).toEqual([second.id]);
      expect(ctx.store.flashcards[first.id]).toMatchObject(first);
    } finally { dispose(); }
  });

  it('orders withdrawal and re-exclusion even when the wall clock does not advance', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const key = `ja:${SRS.hashWordSync('target')}`;
    try {
      await ctx.ignoreWordForLanguage('target', undefined, 'ja');
      const first = ctx.store.ignoredWords[key].updatedAt!;
      await ctx.unignoreWordForLanguage('target', 'ja');
      const second = ctx.store.ignoredWords[key].updatedAt!;
      expect(second).toBeGreaterThan(first);
      expect(ctx.getIgnoredWordsSync()).toEqual([]);
      await ctx.ignoreWordForLanguage('target', undefined, 'ja');
      expect(ctx.store.ignoredWords[key].updatedAt!).toBeGreaterThan(second);
      expect(ctx.isWordIgnoredSync('target', 'ja')).toBe(true);
      expect(ctx.getIgnoredWordsSync()).toHaveLength(1);
    } finally { now.mockRestore(); dispose(); }
  });

  it('does not overwrite a newer peer withdrawal when an exclusion save rebases', async () => {
    answerProbesFromAuthority();
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'peer-policy-card', language: 'ja', state: 'review', dueDate: 0,
      content: { type: 'word', front: 'target', back: 'authored' } });
    seed(makeEmptyStore({ flashcards: { [card.id]: card }, rev: 10 }));
    const key = `ja:${SRS.hashWordSync('target')}`;
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    mockBridge.flashcards.saveFlashcards.mockImplementationOnce(async () => {
      revision = 11;
      committed = makeEmptyStore({ flashcards: { [card.id]: card }, rev: 11,
        ignoredWords: { [key]: { word: 'target', language: 'ja', ignoredAt: 900, updatedAt: 2000, excluded: false } } });
      throw new Error(staleFlashcardRevisionMessage(11, 10));
    });
    try {
      await expect(ctx.ignoreWordForLanguage('target', undefined, 'ja')).rejects.toThrow('superseded');
      expect(acceptedSaves.at(-1)?.ignoredWords[key]).toMatchObject({ updatedAt: 2000, excluded: false });
      expect(ctx.store.ignoredWords[key]).toMatchObject({ updatedAt: 2000, excluded: false });
      expect(ctx.isWordIgnoredSync('target', 'ja')).toBe(false);
      expect(ctx.getCurrentCard()?.id).toBe(card.id);
      expect(ctx.store.flashcards[card.id]).toMatchObject(card);
    } finally { now.mockRestore(); dispose(); }
  });

  it('auto-creates eligible candidates before the daily cap and preserves excluded passive counts', async () => {
    const settingsBefore = { createUnseenCards: mockSettings.createUnseenCards, enable_flashcard_creation: mockSettings.enable_flashcard_creation,
      maxNewCardsPerDay: mockSettings.maxNewCardsPerDay, flashcardLLMExamples: mockSettings.flashcardLLMExamples };
    Object.assign(mockSettings, { createUnseenCards: true, enable_flashcard_creation: true, maxNewCardsPerDay: 1, flashcardLLMExamples: false });
    const { ctx, dispose } = await mountProvider();
    const excluded = `ja:${SRS.hashWordSync('excluded')}`;
    const eligible = `ja:${SRS.hashWordSync('eligible')}`;
    const candidate = (word: string, count: number) => ({ word, count, reading: '', firstSeen: 1, lastSeen: 1, language: 'ja' });
    seed(makeEmptyStore({ wordCandidates: { [excluded]: candidate('excluded', 100), [eligible]: candidate('eligible', 1) },
      ignoredWords: { [excluded]: { word: 'excluded', language: 'ja', ignoredAt: 1 } } }));
    mockBackend.translate.mockResolvedValue({ data: [{ definitions: ['definition'] }] });
    try {
      const nextDay = mockBridge.flashcards.onNewDayFlashcards.mock.calls.at(-1)![0] as () => Promise<void>;
      await nextDay();
      expect(mockBackend.translate.mock.calls.map(call => call[0])).not.toContain('excluded');
      expect(ctx.store.wordCandidates[excluded]).toMatchObject({ count: 100 });
      expect(Object.values(ctx.store.flashcards).map(card => card.content.front)).toContain('eligible');
      expect(ctx.store.wordCandidates[eligible]).toBeUndefined();
    } finally { Object.assign(mockSettings, settingsBefore); mockBackend.translate.mockResolvedValue({ data: [] }); dispose(); }
  });

  it('ignoreWordForLanguage stores explicit non-active inflections under that language primary form', async () => {
    mockSettings.language = 'ja';
    mockGetCanonicalFormForLanguage.mockImplementation((language: string, word: string) => (
      language === 'ar' && word === 'يكتب' ? 'كتب' : word
    ));
    mockGetWordVariantsForLanguage.mockImplementation((language: string, word: string) => (
      language === 'ar' && word === 'يكتب' ? ['كتب', 'يكتب'] : [word]
    ));
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    const SRS = await import('../services/srsAlgorithm');
    const primaryKey = `ar:${SRS.hashWordSync('كتب')}`;
    const inflectedKey = `ar:${SRS.hashWordSync('يكتب')}`;

    await ctx.ignoreWordForLanguage('يكتب', undefined, 'ar');

    // Exclusion lands under the language's primary form key; no claim.
    expect(ctx.store.ignoredWords[primaryKey]).toMatchObject({
      word: 'كتب',
      language: 'ar',
    });
    expect(ctx.store.wordKnowledge[primaryKey]).toBeUndefined();
    expect(ctx.store.knownUntracked[primaryKey]).toBeUndefined();
    expect(ctx.store.ignoredWords[inflectedKey]).toBeUndefined();
    expect(ctx.isWordIgnoredSync('يكتب', 'ar')).toBe(true);
    dispose();
  });

  it('isWordIgnoredSync can read a non-active stored word language explicitly', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    mockSettings.language = 'ja';

    await ctx.ignoreWordForLanguage('سلام', undefined, 'ar');

    expect(ctx.isWordIgnoredSync('سلام')).toBe(false);
    expect(ctx.isWordIgnoredSync('سلام', 'ar')).toBe(true);
    dispose();
  });

  it('setWordClaim can target a non-active stored word language', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    mockSettings.language = 'ja';
    const SRS = await import('../services/srsAlgorithm');
    const hash = SRS.hashWordSync('سلام');
    const arKey = `ar:${hash}`;
    const jaKey = `ja:${hash}`;

    await ctx.setWordClaim('سلام', 'known', 'ar');

    expect(ctx.store.wordKnowledge[arKey]).toMatchObject({
      word: 'سلام',
      language: 'ar',
      claim: 'known',
    });
    // A claim never fabricates evidence ease.
    expect(ctx.store.wordKnowledge[arKey]?.ease).toBe(SRS.MIN_EASE);
    expect(ctx.store.wordKnowledge[jaKey]).toBeUndefined();
    dispose();
  });

  it('migration strips legacy inherited aspect records; explicit records survive', async () => {
    const SRS = await import('../services/srsAlgorithm');
    const mixedLk = `ja:${SRS.hashWordSync('猫')}`;
    const seedOnlyLk = `ja:${SRS.hashWordSync('犬')}`;
    const { ctx, dispose } = await mountProvider();
    seed(makeEmptyStore({
      wordKnowledge: {
        [mixedLk]: {
          word: '猫', language: 'ja', ease: 2.0, lastSeen: 1, timesSeen: 1, timesHovered: 0,
          aspects: {
            reading: { status: 'known', ease: 1.8, source: 'Manual', lastStatusChange: 1, updatedAt: 1 },
            prosody: { status: 'known', ease: 1.8, source: 'Manual', lastStatusChange: 1, updatedAt: 1, inherited: true },
          },
        } as PassiveWordKnowledge,
        [seedOnlyLk]: {
          word: '犬', language: 'ja', ease: 1.9, lastSeen: 1, timesSeen: 1, timesHovered: 0,
          aspects: {
            prosody: { status: 'learning', ease: 1.55, source: 'Manual', lastStatusChange: 1, updatedAt: 1, inherited: true },
          },
        } as PassiveWordKnowledge,
      },
    }));

    // Explicit evidence survives the legacy→access re-key (reading →
    // surface-reading); the seeded inherited projection is gone.
    expect(ctx.store.wordKnowledge[mixedLk]?.access?.['surface-reading']?.status).toBe('known');
    expect(ctx.store.wordKnowledge[mixedLk]?.access?.['prosodic-pattern']).toBeUndefined();
    expect(ctx.store.wordKnowledge[mixedLk]?.ease).toBe(2.0);
    // Seed-only entry keeps its word-level passive data; the empty aspects object is dropped.
    expect(ctx.store.wordKnowledge[seedOnlyLk]?.access).toBeUndefined();
    expect(ctx.store.wordKnowledge[seedOnlyLk]?.ease).toBe(1.9);
    dispose();
  });

  it('setAccessClaim keeps surface-scoped accesses on the presented hash only (#230 exception)', async () => {
    mockGetWordVariants.mockImplementation((word: string) => word === 'さすが' ? ['さすが', '流石'] : [word]);
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    const SRS = await import('../services/srsAlgorithm');
    const sasugaLk = `ja:${SRS.hashWordSync('さすが')}`;
    const sasugaKanjiLk = `ja:${SRS.hashWordSync('流石')}`;

    // surface-recognition evidence belongs to the exact written form presented…
    await ctx.setAccessClaim('流石', 'surface-recognition', 'unknown', 'ja');
    expect(ctx.store.wordKnowledge[sasugaKanjiLk]?.access?.['surface-recognition']?.status).toBe('unknown');
    expect(ctx.store.wordKnowledge[sasugaLk]?.access?.['surface-recognition']).toBeUndefined();

    // …while surface-reading is ALSO surface-scoped: failing to read 流石
    // says nothing about さすが, whose script supplies its own pronunciation.
    await ctx.setAccessClaim('さすが', 'surface-reading', 'unknown', 'ja');
    expect(ctx.store.wordKnowledge[sasugaLk]?.access?.['surface-reading']?.status).toBe('unknown');
    expect(ctx.store.wordKnowledge[sasugaKanjiLk]?.access?.['surface-reading']).toBeUndefined();
    // Lexeme-scoped accesses (prosodic-pattern) still fan out across the family (#230).
    await ctx.setAccessClaim('さすが', 'prosodic-pattern', 'unknown', 'ja');
    expect(ctx.store.wordKnowledge[sasugaLk]?.access?.['prosodic-pattern']?.status).toBe('unknown');
    expect(ctx.store.wordKnowledge[sasugaKanjiLk]?.access?.['prosodic-pattern']?.status).toBe('unknown');
    dispose();
  });

  it('clearing an access claim on a claim-only record removes it — clear must not fabricate evidence', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    const SRS = await import('../services/srsAlgorithm');
    const lk = `ja:${SRS.hashWordSync('ねこ')}`;

    await ctx.setAccessClaim('ねこ', 'surface-reading', 'known', 'ja');
    expect(ctx.store.wordKnowledge[lk]?.access?.['surface-reading']?.claim).toBe('known');

    await ctx.clearAccessClaim('ねこ', 'surface-reading', 'ja');
    await vi.waitFor(() => {
      // No observation events exist under the access: the record must be gone
      // entirely instead of surviving as evidence-backed Known.
      expect(ctx.store.wordKnowledge[lk]?.access?.['surface-reading']).toBeUndefined();
    });
    expect(ctx.getAccessStatus('ねこ', 'surface-reading', 'ja').untracked).toBe(true);
    dispose();
  });

  it('clearing an access claim on an evidence-backed record reverts to the evidence classification', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    const SRS = await import('../services/srsAlgorithm');
    const lk = `ja:${SRS.hashWordSync('いぬ')}`;

    // Seed real observation evidence: a materialized surface-reading record
    // plus its journal observation (kept in step by the writers).
    mockAppendEvents.mock.calls.push([{
      [lk]: [{
        t: 1, kind: 'rating', source: 'srs', aspect: 'reading',
        toStatus: 'learning', easeAfter: 1.7, rating: 'struggled', attemptId: 'ev-1',
      }],
    }]);
    seed(makeEmptyStore({
      wordKnowledge: {
        [lk]: {
          word: 'いぬ', language: 'ja', ease: 1.7, lastSeen: 1, firstSeen: 1, timesSeen: 2, timesHovered: 0,
          hasActiveEvidence: true,
          access: { 'surface-reading': { status: 'learning', ease: 1.7, source: 'Srs', lastStatusChange: 1, updatedAt: 1 } },
        },
      },
    }));

    // The learner overrides the evidence with an explicit Known claim…
    await ctx.setAccessClaim('いぬ', 'surface-reading', 'known', 'ja');
    expect(ctx.store.wordKnowledge[lk]?.access?.['surface-reading']?.claim).toBe('known');
    // …and the underlying evidence classification AND its timestamp
    // fingerprint are preserved, not overwritten by the claim.
    expect(ctx.store.wordKnowledge[lk]?.access?.['surface-reading']?.status).toBe('learning');
    expect(ctx.store.wordKnowledge[lk]?.access?.['surface-reading']?.lastStatusChange).toBe(1);

    await ctx.clearAccessClaim('いぬ', 'surface-reading', 'ja');
    await vi.waitFor(() => {
      const record = ctx.store.wordKnowledge[lk]?.access?.['surface-reading'];
      expect(record?.claim).toBeUndefined();
      // Reverted to the evidence classification, provenance is evidence again.
      expect(record?.status).toBe('learning');
      expect(record?.lastStatusChange).toBe(1);
    });
    // The second store delivery re-opened the readiness gate; wait for the
    // migration to settle before reading through the gated resolver.
    await vi.waitFor(() => expect(ctx.isKnowledgeReady()).toBe(true));
    const resolved = ctx.getAccessStatus('いぬ', 'surface-reading', 'ja');
    expect(resolved.status).toBe('learning');
    expect(resolved.basis).toBe('evidence');
    dispose();
  });

  it('setWordClaim writes the claim to every word-form hash; sibling passive evidence stays intact', async () => {
    mockGetWordVariants.mockImplementation((word: string) => word === 'さすが' ? ['さすが', '流石'] : [word]);
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const sasugaLk = `ja:${SRS.hashWordSync('さすが')}`;
    const sasugaKanjiLk = `ja:${SRS.hashWordSync('流石')}`;
    const siblingEase = mockSettings.easeThresholdKnown + 0.2;
    seed(makeEmptyStore({
      wordKnowledge: {
        [sasugaKanjiLk]: {
          word: '流石',
          language: 'ja',
          reading: 'さすが',
          ease: siblingEase,
          lastSeen: 1,
          timesSeen: 36,
          timesHovered: 0,
        },
      },
    }));

    // Passive-only sibling ease (no active evidence) is untracked — the REQ13
    // honesty rule — and the claim must still win over it on every form hash.
    expect(ctx.getComprehensiveWordStatusWithSourceSync('さすが')).toMatchObject({
      status: 'unknown',
      basis: 'unmeasured',
      matchedWord: '流石',
    });

    await ctx.setWordClaim('さすが', 'unknown');

    expect(ctx.getComprehensiveWordStatusWithSourceSync('さすが')).toMatchObject({
      status: 'unknown',
      basis: 'claim',
    });
    expect(ctx.store.wordKnowledge[sasugaLk]?.claim).toBe('unknown');
    expect(ctx.store.wordKnowledge[sasugaKanjiLk]?.claim).toBe('unknown');
    // Evidence ease is NEVER mutated by a claim — history stays intact.
    expect(ctx.store.wordKnowledge[sasugaKanjiLk]?.ease).toBe(siblingEase);

    const claimCalls = mockAppendEvents.mock.calls.filter(([byKey]) =>
      Object.values(byKey as Record<string, Array<{ kind: string }>>).some((events) => events.some((e) => e.kind === 'claim')));
    expect(claimCalls.length).toBeGreaterThanOrEqual(1);
    const claimEvents = claimCalls.flatMap(([byKey]) =>
      Object.entries(byKey as Record<string, Array<Record<string, unknown>>>).flatMap(([lk, events]) => events.map((e) => ({ lk, ...e }))));
    expect(claimEvents.some((e) => e.lk === sasugaKanjiLk && e.toStatus === 'unknown')).toBe(true);
    expect(claimEvents.every((e) => e.aspect === 'meaning')).toBe(true);
    dispose();
  });

  it('clearing a claim on an unmeasured word drops the fabricated entry back to untracked', async () => {
    mockGetWordVariants.mockImplementation((word: string) => [word]);
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    await ctx.setWordClaim('会う', 'known', 'ja');
    const lk = `ja:${(await import('../services/srsAlgorithm')).hashWordSync('会う')}`;
    expect(ctx.store.wordKnowledge[lk]?.claim).toBe('known');

    await ctx.setWordClaim('会う', null, 'ja');

    // No evidence exists behind the claim — the cache entry must be removed,
    // not left as a fabricated negative-evidence fingerprint.
    expect(ctx.store.wordKnowledge[lk]).toBeUndefined();
    expect(ctx.getComprehensiveWordStatusWithSourceSync('会う', 'ja')).toMatchObject({
      status: 'unknown',
      basis: 'unmeasured',
    });
    dispose();
  });

  it('clearing a claim keeps evidence-backed facts and drops only the override', async () => {
    mockGetWordVariants.mockImplementation((word: string) => [word]);
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const lk = `ja:${SRS.hashWordSync('さすが')}`;
    seed(makeEmptyStore({
      wordKnowledge: {
        [lk]: {
          word: 'さすが',
          language: 'ja',
          ease: 1.9,
          lastSeen: 1,
          timesSeen: 12,
          timesHovered: 0,
          hasActiveEvidence: true,
        },
      },
    }));

    await ctx.setWordClaim('さすが', 'known');
    expect(ctx.store.wordKnowledge[lk]?.claim).toBe('known');

    await ctx.setWordClaim('さすが', null);

    const entry = ctx.store.wordKnowledge[lk];
    expect(entry?.claim).toBeUndefined();
    expect(entry?.ease).toBe(1.9);
    expect(entry?.timesSeen).toBe(12);
    // Evidence returns to the honest classification (active evidence ≥ known anchor).
    expect(ctx.getComprehensiveWordStatusWithSourceSync('さすが').status).toBe('known');
    dispose();
  });

  it('claims do not fan out to inflections — 食べた and 食べる stay separate identities', async () => {
    // Form families come from lexeme normalization (orthographic/reading
    // variants), never conjugation: an inflected surface is its own identity
    // for claim purposes. Only dictionary-listed variants share a claim.
    mockGetWordVariants.mockImplementation((word: string) => [word]);
    mockGetCanonicalForm.mockImplementation((word: string) => word);
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    const SRS = await import('../services/srsAlgorithm');
    const tabetaLk = `ja:${SRS.hashWordSync('食べた')}`;
    const taberuLk = `ja:${SRS.hashWordSync('食べる')}`;

    await ctx.setWordClaim('食べた', 'known', 'ja');

    expect(ctx.store.wordKnowledge[tabetaLk]?.claim).toBe('known');
    expect(ctx.store.wordKnowledge[taberuLk]).toBeUndefined();
    // Claiming the inflection leaves the lemma's state untouched.
    expect(ctx.getComprehensiveWordStatusWithSourceSync('食べる').basis).toBe('unmeasured');
    dispose();
  });

  it('getComprehensiveWordStatusSync can read a non-active stored word language explicitly', async () => {
    const { ctx, dispose } = await mountProvider();
    mockSettings.language = 'ja';
    const SRS = await import('../services/srsAlgorithm');
    const arKey = `ar:${SRS.hashWordSync('سلام')}`;
    seed(makeEmptyStore({
      wordKnowledge: {
        [arKey]: {
          word: 'سلام',
          language: 'ar',
          ease: mockSettings.easeThresholdKnown,
          lastSeen: 1,
          timesSeen: 1,
          timesHovered: 0,
          lastStatusChange: 5,
          hasActiveEvidence: true,
        },
      },
    }));

    expect(ctx.getComprehensiveWordStatusSync('سلام')).toBe('unknown');
    expect(ctx.getComprehensiveWordStatusSync('سلام', 'ar')).toBe('known');
    dispose();
  });

  it('unignoreWordForLanguage removes ignored status', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    await ctx.ignoreWordForLanguage('サンプル');
    expect(ctx.isWordIgnoredSync('サンプル')).toBe(true);
    await ctx.unignoreWordForLanguage('サンプル');
    expect(ctx.isWordIgnoredSync('サンプル')).toBe(false);
    dispose();
  });

  it('unignoreWordForLanguage removes explicit non-active inflections by language primary form', async () => {
    mockSettings.language = 'ja';
    mockGetCanonicalFormForLanguage.mockImplementation((language: string, word: string) => (
      language === 'ar' && word === 'يكتب' ? 'كتب' : word
    ));
    mockGetWordVariantsForLanguage.mockImplementation((language: string, word: string) => (
      language === 'ar' && word === 'يكتب' ? ['كتب', 'يكتب'] : [word]
    ));
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    const SRS = await import('../services/srsAlgorithm');
    const primaryKey = `ar:${SRS.hashWordSync('كتب')}`;

    await ctx.ignoreWordForLanguage('كتب', undefined, 'ar');
    expect(ctx.store.ignoredWords[primaryKey]).toBeDefined();

    await ctx.unignoreWordForLanguage('يكتب', 'ar');

    expect(ctx.store.knownUntracked[primaryKey]).toBeUndefined();
    expect(ctx.store.ignoredWords[primaryKey]).toMatchObject({ excluded: false });
    expect(ctx.isWordIgnoredSync('يكتب', 'ar')).toBe(false);
    dispose();
  });

  // ─── Priority 2: Word tracking ────────────────────────────────────
  it('trackWordSeen creates wordKnowledge entry and bumps ease', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    ctx.trackWordSeen('学校', undefined, 0.05);
    ctx.flushPendingWordSeen();
    const SRS = await import('../services/srsAlgorithm');
    const hash = SRS.hashWordSync('学校');
    const lk = `ja:${hash}`;
    const knowledge = ctx.store.wordKnowledge[lk];
    expect(knowledge).toBeDefined();
    expect(knowledge.timesSeen).toBe(1);
    expect(knowledge.ease).toBeCloseTo(SRS.MIN_EASE + 0.05, 2);
    dispose();
  });

  it('trackWordSeen coalesces into the store only on flush', async () => {
    // Regression: passive-seen observations used to write the store per token,
    // invalidating vocabulary-wide memos on every seen word. They must stay
    // pending until an explicit/event-driven flush applies them in one batch.
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    mockSettings.passiveEaseEnabled = true;

    ctx.trackWordSeen('保留', undefined, 0.05);
    ctx.trackWordSeen('保留', undefined, 0.05);
    const SRS = await import('../services/srsAlgorithm');
    const lk = `ja:${SRS.hashWordSync('保留')}`;
    expect(ctx.store.wordKnowledge[lk]).toBeUndefined();

    ctx.flushPendingWordSeen();
    const knowledge = ctx.store.wordKnowledge[lk];
    expect(knowledge).toBeDefined();
    expect(knowledge.timesSeen).toBe(1);
    expect(knowledge.ease).toBeCloseTo(SRS.MIN_EASE + 0.05, 2);
    expect(knowledge.lastSeen).toBe(0);

    // An encounter after the throttle window counts again post-flush.
    vi.setSystemTime(600);
    ctx.trackWordSeen('保留', undefined, 0.05);
    expect(ctx.store.wordKnowledge[lk].timesSeen).toBe(1);
    ctx.flushPendingWordSeen();
    expect(ctx.store.wordKnowledge[lk].timesSeen).toBe(2);
    expect(ctx.store.wordKnowledge[lk].ease).toBeCloseTo(SRS.MIN_EASE + 0.1, 2);
    dispose();
    vi.useRealTimers();
  });

  it('counts a logical visible encounter once across UI churn and counts a new encounter', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    mockSettings.passiveEaseEnabled = true;
    const SRS = await import('../services/srsAlgorithm');
    const lk = `ja:${SRS.hashWordSync('分かる')}`;

    ctx.trackWordSeen('分かる', undefined, 0.05, 'ja', 'reader:book:page:visit1:box1:word1');
    vi.setSystemTime(2_000);
    ctx.trackWordSeen('分かる', undefined, 0.05, 'ja', 'reader:book:page:visit1:box1:word1');
    ctx.flushPendingWordSeen();
    expect(ctx.store.wordKnowledge[lk]?.timesSeen).toBe(1);

    ctx.trackWordSeen('分かる', undefined, 0.05, 'ja', 'reader:book:page:visit2:box1:word1');
    ctx.flushPendingWordSeen();
    expect(ctx.store.wordKnowledge[lk]?.timesSeen).toBe(2);
    dispose();
    vi.useRealTimers();
  });

  it('tracks script forms under one canonical word identity', async () => {
    mockSettings.language = 'zh';
    mockGetCanonicalForm.mockImplementation((word: string) => word === '學' ? '学' : word);
    mockGetWordVariants.mockImplementation((word: string) => word === '學' ? ['学', '學'] : [word]);
    const { registerMappingTable } = await import('../../shared/languageFeatures');
    registerMappingTable('zh', { words: {}, chars: { 學: '学' } });
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    vi.useFakeTimers();
    vi.setSystemTime(0);
    ctx.trackWordSeen('學', undefined, 0);
    vi.setSystemTime(501);
    ctx.trackWordSeen('学', undefined, 0);
    ctx.flushPendingWordSeen();

    const SRS = await import('../services/srsAlgorithm');
    const entry = ctx.store.wordKnowledge[`zh:${SRS.hashWordSync('学')}`];
    expect(entry.timesSeen).toBe(2);
    // Per-script-form WrittenForm sub-skill copies are gone: exposure is
    // bookkeeping on the canonical identity, not per-form recognition state.
    expect(entry.forms).toBeUndefined();
    vi.useRealTimers();
    dispose();
  });

  it('trackWordSeen stores inflected active-language words under the language primary form key', async () => {
    mockGetCanonicalForm.mockImplementation((word: string) => word === 'يكتب' ? 'كتب' : word);
    mockGetWordVariants.mockImplementation((word: string) => word === 'يكتب' ? ['كتب', 'يكتب'] : []);
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    ctx.trackWordSeen('يكتب', undefined, 0.05);
    ctx.flushPendingWordSeen();

    const SRS = await import('../services/srsAlgorithm');
    const primaryKey = `ja:${SRS.hashWordSync('كتب')}`;
    const inflectedKey = `ja:${SRS.hashWordSync('يكتب')}`;
    expect(ctx.store.wordKnowledge[primaryKey]?.word).toBe('كتب');
    expect(ctx.store.wordKnowledge[primaryKey]?.timesSeen).toBe(1);
    expect(ctx.store.wordKnowledge[inflectedKey]).toBeUndefined();
    dispose();
  });

  it('trackWordSeen can write a non-active stored word language explicitly', async () => {
    mockSettings.language = 'ja';
    mockGetCanonicalFormForLanguage.mockImplementation((language: string, word: string) => (
      language === 'ar' && word === 'يكتب' ? 'كتب' : word
    ));
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    ctx.trackWordSeen('يكتب', undefined, 0.05, 'ar');
    ctx.flushPendingWordSeen();

    const SRS = await import('../services/srsAlgorithm');
    const arKey = `ar:${SRS.hashWordSync('كتب')}`;
    const jaKey = `ja:${SRS.hashWordSync('يكتب')}`;
    expect(ctx.store.wordKnowledge[arKey]?.word).toBe('كتب');
    expect(ctx.store.wordKnowledge[arKey]?.language).toBe('ar');
    expect(ctx.store.wordKnowledge[arKey]?.timesSeen).toBe(1);
    expect(ctx.store.wordKnowledge[jaKey]).toBeUndefined();
    dispose();
  });

  it('trackWordSeen records exposure despite an orphan legacy marker', async () => {
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const hash = SRS.hashWordSync('既知');
    const lk = `ja:${hash}`;
    flashcardsCb(makeEmptyStore({ knownUntracked: { [lk]: true } }));

    ctx.trackWordSeen('既知');
    ctx.flushPendingWordSeen();
    expect(ctx.store.wordKnowledge[lk]?.timesSeen).toBe(1);
    expect(ctx.getComprehensiveWordStatusWithSourceSync('既知').basis).toBe('unmeasured');
    dispose();
  });

  it('setWordClaim writes an explicit claim', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    await ctx.setWordClaim('学校', 'known');
    const SRS = await import('../services/srsAlgorithm');
    const hash = SRS.hashWordSync('学校');
    const lk = `ja:${hash}`;
    // A write is an explicit claim; the bank never touches knownUntracked.
    expect(ctx.store.wordKnowledge[lk]?.claim).toBe('known');
    expect(ctx.store.wordKnowledge[lk]?.ease).toBe(SRS.MIN_EASE);
    expect(ctx.store.knownUntracked[lk]).toBeUndefined();
    dispose();
  });

  it('setWordClaim unknown writes an unknown claim', async () => {
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const hash = SRS.hashWordSync('学校');
    const lk = `ja:${hash}`;
    seed(makeEmptyStore({
      wordKnowledge: {
        [lk]: { claim: 'learning', claimAt: 5, ease: SRS.MIN_EASE, lastSeen: 1, timesSeen: 0, timesHovered: 0, word: '学校', language: 'ja' },
      },
    }));

    await ctx.setWordClaim('学校', 'unknown');
    // 'unknown' is an explicit claim written over the previous one — the
    // legacy bank is never touched and the entry is never deleted.
    expect(ctx.store.wordKnowledge[lk]?.claim).toBe('unknown');
    expect(ctx.store.wordKnowledge[lk]?.ease).toBe(SRS.MIN_EASE);
    expect(ctx.store.knownUntracked[lk]).toBeUndefined();
    dispose();
  });

  it('setWordClaim writes a claim', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    await ctx.setWordClaim('学校', 'known');
    const SRS = await import('../services/srsAlgorithm');
    const hash = SRS.hashWordSync('学校');
    const lk = `ja:${hash}`;
    // Passive selection is a claim, not ease mutation: fresh entries stay at MIN ease.
    expect(ctx.store.wordKnowledge[lk]?.claim).toBe('known');
    expect(ctx.store.wordKnowledge[lk]?.ease).toBe(SRS.MIN_EASE);
    dispose();
  });

  it('setWordClaim stores inflected claim under the language primary form key', async () => {
    mockGetWordVariants.mockImplementation((word: string) => word === 'يكتب' ? ['كتب', 'يكتب'] : []);
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    await ctx.setWordClaim('يكتب', 'known');

    const SRS = await import('../services/srsAlgorithm');
    const primaryKey = `ja:${SRS.hashWordSync('كتب')}`;
    const inflectedKey = `ja:${SRS.hashWordSync('يكتب')}`;
    expect(ctx.store.wordKnowledge[primaryKey]?.word).toBe('كتب');
    expect(ctx.store.wordKnowledge[primaryKey]?.claim).toBe('known');
    // Whole-identity claims fan out to every surface-form hash the resolver reads.
    expect(ctx.store.wordKnowledge[inflectedKey]?.claim).toBe('known');
    dispose();
  });

  it('setWordClaim can target a non-active word language explicitly', async () => {
    mockSettings.language = 'ja';
    mockGetCanonicalFormForLanguage.mockImplementation((language: string, word: string) => (
      language === 'ar' && word === 'يكتب' ? 'كتب' : word
    ));
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    await ctx.setWordClaim('يكتب', 'known', 'ar');

    const SRS = await import('../services/srsAlgorithm');
    const arKey = `ar:${SRS.hashWordSync('كتب')}`;
    const jaKey = `ja:${SRS.hashWordSync('يكتب')}`;
    expect(ctx.store.wordKnowledge[arKey]?.word).toBe('كتب');
    expect(ctx.store.wordKnowledge[arKey]?.language).toBe('ar');
    expect(ctx.store.wordKnowledge[arKey]?.claim).toBe('known');
    expect(ctx.store.wordKnowledge[jaKey]).toBeUndefined();
    dispose();
  });

  it('setWordClaim unknown writes an unknown claim', async () => {
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const hash = SRS.hashWordSync('学校');
    const lk = `ja:${hash}`;
    seed(makeEmptyStore({
      wordKnowledge: {
        [lk]: { ease: 2.5, lastSeen: 1, timesSeen: 1, timesHovered: 0, word: '学校', language: 'ja' },
      },
    }));

    await ctx.setWordClaim('学校', 'unknown');
    // 'unknown' is an explicit claim, not entry deletion; ease stays untouched.
    expect(ctx.store.wordKnowledge[lk]).toBeDefined();
    expect(ctx.store.wordKnowledge[lk]?.claim).toBe('unknown');
    expect(ctx.store.wordKnowledge[lk]?.ease).toBe(2.5);
    dispose();
  });

  it('trackWordSeen throttles timesSeen increments for rapid calls', async () => {
    vi.useFakeTimers();
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    const SRS = await import('../services/srsAlgorithm');
    const hash = SRS.hashWordSync('連打');
    const lk = `ja:${hash}`;

    for (let i = 0; i < 50; i++) {
      ctx.trackWordSeen('連打');
      await vi.advanceTimersByTimeAsync(60);
    }

    ctx.flushPendingWordSeen();
    expect(ctx.store.wordKnowledge[lk]?.timesSeen).toBeLessThanOrEqual(10);
    expect(ctx.store.wordKnowledge[lk]?.timesSeen).toBeGreaterThan(0);

    dispose();
    vi.useRealTimers();
  });

  it('trackWordHovered waits for passiveHoverDelayMs before counting an attempt', async () => {
    vi.useFakeTimers();
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    const prevDelay = mockSettings.passiveHoverDelayMs;
    mockSettings.passiveHoverDelayMs = 300;

    ctx.trackWordHovered('遅延');

    const SRS = await import('../services/srsAlgorithm');
    const hash = SRS.hashWordSync('遅延');
    const lk = `ja:${hash}`;

    await vi.advanceTimersByTimeAsync(299);
    expect(ctx.store.wordKnowledge[lk]).toBeUndefined();

    await vi.advanceTimersByTimeAsync(1);
    expect(ctx.store.wordKnowledge[lk]?.timesHovered).toBe(1);

    mockSettings.passiveHoverDelayMs = prevDelay;
    dispose();
    vi.useRealTimers();
  });

  it('trackWordHovered stores inflected active-language words under the language primary form key', async () => {
    vi.useFakeTimers();
    mockGetCanonicalForm.mockImplementation((word: string) => word === 'يكتب' ? 'كتب' : word);
    mockGetWordVariants.mockImplementation((word: string) => word === 'يكتب' ? ['كتب', 'يكتب'] : []);
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    ctx.trackWordHovered('يكتب');
    await vi.advanceTimersByTimeAsync(mockSettings.passiveHoverDelayMs);

    const SRS = await import('../services/srsAlgorithm');
    const primaryKey = `ja:${SRS.hashWordSync('كتب')}`;
    const inflectedKey = `ja:${SRS.hashWordSync('يكتب')}`;
    expect(ctx.store.wordKnowledge[primaryKey]?.word).toBe('كتب');
    expect(ctx.store.wordKnowledge[primaryKey]?.timesHovered).toBe(1);
    expect(ctx.store.wordKnowledge[inflectedKey]).toBeUndefined();

    dispose();
    vi.useRealTimers();
  });

  it('trackWordHovered can write a non-active stored word language explicitly', async () => {
    vi.useFakeTimers();
    mockSettings.language = 'ja';
    mockGetCanonicalFormForLanguage.mockImplementation((language: string, word: string) => (
      language === 'ar' && word === 'يكتب' ? 'كتب' : word
    ));
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    ctx.trackWordHovered('يكتب', undefined, 'ar');
    await vi.advanceTimersByTimeAsync(mockSettings.passiveHoverDelayMs);

    const SRS = await import('../services/srsAlgorithm');
    const arKey = `ar:${SRS.hashWordSync('كتب')}`;
    const jaKey = `ja:${SRS.hashWordSync('يكتب')}`;
    expect(ctx.store.wordKnowledge[arKey]?.word).toBe('كتب');
    expect(ctx.store.wordKnowledge[arKey]?.language).toBe('ar');
    expect(ctx.store.wordKnowledge[arKey]?.timesHovered).toBe(1);
    expect(ctx.store.wordKnowledge[jaKey]).toBeUndefined();

    dispose();
    vi.useRealTimers();
  });

  it('cancelWordHover cancels inflected active-language hover timers through the primary form key', async () => {
    vi.useFakeTimers();
    mockGetWordVariants.mockImplementation((word: string) => word === 'يكتب' ? ['كتب', 'يكتب'] : []);
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    ctx.trackWordHovered('يكتب');
    ctx.cancelWordHover('يكتب');
    await vi.advanceTimersByTimeAsync(mockSettings.passiveHoverDelayMs);

    const SRS = await import('../services/srsAlgorithm');
    const primaryKey = `ja:${SRS.hashWordSync('كتب')}`;
    const inflectedKey = `ja:${SRS.hashWordSync('يكتب')}`;
    expect(ctx.store.wordKnowledge[primaryKey]).toBeUndefined();
    expect(ctx.store.wordKnowledge[inflectedKey]).toBeUndefined();

    dispose();
    vi.useRealTimers();
  });

  it('cancelWordHover can cancel a non-active stored word language explicitly', async () => {
    vi.useFakeTimers();
    mockSettings.language = 'ja';
    mockGetCanonicalFormForLanguage.mockImplementation((language: string, word: string) => (
      language === 'ar' && word === 'يكتب' ? 'كتب' : word
    ));
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    ctx.trackWordHovered('يكتب', undefined, 'ar');
    ctx.cancelWordHover('يكتب', 'ar');
    await vi.advanceTimersByTimeAsync(mockSettings.passiveHoverDelayMs);

    const SRS = await import('../services/srsAlgorithm');
    const arKey = `ar:${SRS.hashWordSync('كتب')}`;
    const jaKey = `ja:${SRS.hashWordSync('يكتب')}`;
    expect(ctx.store.wordKnowledge[arKey]).toBeUndefined();
    expect(ctx.store.wordKnowledge[jaKey]).toBeUndefined();

    dispose();
    vi.useRealTimers();
  });

  it('trackWordHovered counts attempts before lowering ease', async () => {
    vi.useFakeTimers();
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    const prevCount = mockSettings.passiveHoverFailCount;
    mockSettings.passiveHoverFailCount = 2;

    const SRS = await import('../services/srsAlgorithm');
    const hash = SRS.hashWordSync('学校');
    const lk = `ja:${hash}`;

    ctx.trackWordHovered('学校');
    await vi.advanceTimersByTimeAsync(mockSettings.passiveHoverDelayMs);

    expect(ctx.store.wordKnowledge[lk]?.timesHovered).toBe(1);
    expect(ctx.store.wordKnowledge[lk]?.ease).toBe(SRS.MIN_EASE);

    ctx.trackWordHovered('学校');
    await vi.advanceTimersByTimeAsync(mockSettings.passiveHoverDelayMs);

    expect(ctx.store.wordKnowledge[lk]?.timesHovered).toBe(2);
    // Starting from MIN_EASE, the decrease is clamped back to MIN_EASE
    expect(ctx.store.wordKnowledge[lk]?.ease).toBe(SRS.MIN_EASE);

    mockSettings.passiveHoverFailCount = prevCount;
    dispose();
    vi.useRealTimers();
  });

  it('trackWordHovered respects passiveHoverFailAction="none" and writes no negative journal evidence', async () => {
    vi.useFakeTimers();
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    const prevAction = mockSettings.passiveHoverFailAction;
    // The shipped default (DEFAULT_SETTINGS.passiveHoverFailAction) is 'none'.
    mockSettings.passiveHoverFailAction = 'none';

    const SRS = await import('../services/srsAlgorithm');
    const hash = SRS.hashWordSync('不変');
    const lk = `ja:${hash}`;

    // Hover well past passiveHoverFailCount — familiarity still accrues,
    // but no ease drop and NO knowledge-journal append may record a
    // "failure" for an ordinary lookup (R10: the writer must not manufacture
    // negative epistemic evidence for passive hovers).
    mockAppendEvents.mockClear();
    ctx.trackWordHovered('不変');
    await vi.advanceTimersByTimeAsync(mockSettings.passiveHoverDelayMs);
    ctx.trackWordHovered('不変');
    await vi.advanceTimersByTimeAsync(mockSettings.passiveHoverDelayMs);
    ctx.trackWordHovered('不変');
    await vi.advanceTimersByTimeAsync(mockSettings.passiveHoverDelayMs);

    expect(ctx.store.wordKnowledge[lk]?.timesHovered).toBe(3);
    expect(ctx.store.wordKnowledge[lk]?.ease).toBe(SRS.MIN_EASE);
    expect(ctx.store.wordKnowledge[lk]?.timesSeen).toBe(0);
    expect(ctx.store.wordKnowledge[lk]?.claim).toBeUndefined();
    expect(ctx.store.wordKnowledge[lk]?.hasActiveEvidence).not.toBe(true);
    expect(mockAppendEvents).not.toHaveBeenCalled();

    mockSettings.passiveHoverFailAction = prevAction;
    dispose();
    vi.useRealTimers();
  });

  it('trackWordHovered never appends journal events for a non-English display pair (de, default action none)', async () => {
    vi.useFakeTimers();
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    const prevAction = mockSettings.passiveHoverFailAction;
    const prevLanguage = mockSettings.language;
    mockSettings.passiveHoverFailAction = 'none';
    mockSettings.language = 'de';

    const SRS = await import('../services/srsAlgorithm');
    const hash = SRS.hashWordSync('gespielt');
    const lk = `de:${hash}`;

    mockAppendEvents.mockClear();
    ctx.trackWordHovered('gespielt');
    await vi.advanceTimersByTimeAsync(mockSettings.passiveHoverDelayMs);
    // Interrupted repeat: a second hover cancelled mid-debounce must not
    // leave any attempt behind either.
    ctx.trackWordHovered('gespielt');
    ctx.cancelWordHover('gespielt');
    await vi.advanceTimersByTimeAsync(mockSettings.passiveHoverDelayMs);

    expect(ctx.store.wordKnowledge[lk]?.timesHovered).toBe(1);
    expect(ctx.store.wordKnowledge[lk]?.ease).toBe(SRS.MIN_EASE);
    expect(mockAppendEvents).not.toHaveBeenCalled();

    mockSettings.passiveHoverFailAction = prevAction;
    mockSettings.language = prevLanguage;
    dispose();
    vi.useRealTimers();
  });

  it('trackWordHovered respects passiveHoverEaseDecrease', async () => {
    vi.useFakeTimers();
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    const prevDecrease = mockSettings.passiveHoverEaseDecrease;
    mockSettings.passiveHoverEaseDecrease = 0.2;

    const SRS = await import('../services/srsAlgorithm');
    const hash = SRS.hashWordSync('減少');
    const lk = `ja:${hash}`;

    ctx.trackWordHovered('減少');
    await vi.advanceTimersByTimeAsync(mockSettings.passiveHoverDelayMs);

    // Starting from MIN_EASE, the decrease is clamped back to MIN_EASE
    expect(ctx.store.wordKnowledge[lk]?.ease).toBe(SRS.MIN_EASE);

    mockSettings.passiveHoverEaseDecrease = prevDecrease;
    dispose();
    vi.useRealTimers();
  });

  it('trackWordHovered never mutates indexed flashcard scheduling — telemetry is not an SRS writer', async () => {
    vi.useFakeTimers();
    mockGetWordVariants.mockImplementation((word: string) => word === 'يكتب' ? ['كتب', 'يكتب'] : []);
    mockGetCanonicalForm.mockImplementation((word: string) => word === 'يكتب' ? 'كتب' : word);
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const primaryKey = `ja:${SRS.hashWordSync('كتب')}`;
    const cardId = 'card-inflected-hover';
    const prevAction = mockSettings.passiveHoverFailAction;
    mockSettings.passiveHoverFailAction = 'decrease-ease-and-flashcard';
    seed(makeEmptyStore({
      flashcards: {
        [cardId]: {
          id: cardId,
          content: { type: 'word', front: 'يكتب', back: 'he writes' },
          state: 'review',
          ease: 2.5,
          interval: 0,
          dueDate: 0,
          reviews: 0,
          lapses: 0,
          learningStep: 0,
          createdAt: 1,
          lastReviewed: 0,
          lastUpdated: 1,
          language: 'ja',
        },
      },
      wordToCardMap: { [primaryKey]: [cardId] },
    }));

    ctx.trackWordHovered('يكتب');
    await vi.advanceTimersByTimeAsync(mockSettings.passiveHoverDelayMs);

    // Passive telemetry owns FAMILIARITY only: indexed cards keep their
    // scheduler state untouched (no permanent card debt from hover noise).
    expect(ctx.store.flashcards[cardId]?.ease).toBe(2.5);
    expect(ctx.store.flashcards[cardId]?.lastUpdated).toBe(1);
    // Familiarity tracking still ran for the word.
    expect(ctx.store.wordKnowledge[primaryKey]?.timesHovered).toBe(1);

    mockSettings.passiveHoverFailAction = prevAction;
    dispose();
    vi.useRealTimers();
  });

  it('trackWordHovered leaves an existing ease untouched under a legacy decrease-ease config (demotion retired)', async () => {
    vi.useFakeTimers();
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const hash = SRS.hashWordSync('下限');
    const lk = `ja:${hash}`;
    seed(makeEmptyStore({
      wordKnowledge: {
        [lk]: {
          ease: 1.35,
          lastSeen: Date.now(),
          timesSeen: 0,
          timesHovered: 0,
          word: '下限',
          language: 'ja',
        },
      },
    }));

    const prevDecrease = mockSettings.passiveHoverEaseDecrease;
    mockSettings.passiveHoverEaseDecrease = 0.2;

    // The seeded journal-empty row is backfilled asynchronously by the legacy
    // epistemic migration (passiveTracking rollup, REQ25). Let that settle so
    // the assertion below measures the HOVER, not the backfill.
    await vi.waitFor(() => expect(ctx.isKnowledgeReady()).toBe(true));
    mockAppendEvents.mockClear();
    ctx.trackWordHovered('下限');
    await vi.advanceTimersByTimeAsync(mockSettings.passiveHoverDelayMs);

    // R10: hover demotion is retired under every configuration — familiarity
    // accrues, ease stays, and the journal records nothing negative.
    expect(ctx.store.wordKnowledge[lk]?.timesHovered).toBe(1);
    expect(ctx.store.wordKnowledge[lk]?.ease).toBe(1.35);
    expect(mockAppendEvents).not.toHaveBeenCalled();

    mockSettings.passiveHoverEaseDecrease = prevDecrease;
    dispose();
    vi.useRealTimers();
  });

  it('retains admitted media context in exposure and delayed lookup usage without creating learner evidence when passive tracking is disabled', async () => {
    vi.useFakeTimers(); const { ctx, dispose } = await mountProvider(); flashcardsCb(makeEmptyStore());
    const enabled = mockSettings.passiveEaseEnabled; const delay = mockSettings.passiveHoverDelayMs;
    mockSettings.passiveEaseEnabled = false; mockSettings.passiveHoverDelayMs = 300;
    const context = { mediaHash: 'source-hash', sourceId: '/books/admitted.epub', sessionId: 'physical-session', language: 'ja' };
    const seen = vi.fn(); const hovered = vi.fn();
    window.addEventListener('mlearn:word-seen', seen); window.addEventListener('mlearn:word-hovered', hovered);
    ctx.trackWordSeen('婚約者', undefined, 0.01, 'ja', 'occurrence', context);
    ctx.trackWordHovered('婚約者', undefined, 'ja', context);
    mockSettings.language = 'ru'; await vi.advanceTimersByTimeAsync(300);
    expect((seen.mock.calls[0][0] as CustomEvent).detail).toMatchObject({ ...context, word: '婚約者', encounterId: 'occurrence' });
    expect((hovered.mock.calls[0][0] as CustomEvent).detail).toMatchObject({ ...context, word: '婚約者' });
    expect(ctx.store.wordKnowledge).toEqual({});
    window.removeEventListener('mlearn:word-seen', seen); window.removeEventListener('mlearn:word-hovered', hovered);
    mockSettings.passiveEaseEnabled = enabled; mockSettings.passiveHoverDelayMs = delay; mockSettings.language = 'ja';
    dispose(); vi.useRealTimers();
  });

  it('trackWordHovered does nothing when passiveEaseEnabled is false', async () => {
    vi.useFakeTimers();
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    const prevEnabled = mockSettings.passiveEaseEnabled;
    mockSettings.passiveEaseEnabled = false;

    ctx.trackWordHovered('無効ホバー');
    await vi.runAllTimersAsync();

    const SRS = await import('../services/srsAlgorithm');
    const hash = SRS.hashWordSync('無効ホバー');
    const lk = `ja:${hash}`;
    expect(ctx.store.wordKnowledge[lk]).toBeUndefined();

    mockSettings.passiveEaseEnabled = prevEnabled;
    dispose();
    vi.useRealTimers();
  });

  // ─── Priority 2: Grammar tracking ─────────────────────────────────
  it('trackGrammarEncountered writes a recognition evidence event and the replayed cache reflects it', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    ctx.trackGrammarEncountered('てform', 3);
    await vi.waitFor(() => expect(ctx.getGrammarKnowledge('てform')).toBeDefined());

    // Single-writer: the observation lands in the evidence journal...
    expect(mockAppendEvents).toHaveBeenCalledTimes(1);
    const [[events]] = mockAppendEvents.mock.calls;
    const [event] = Object.values(events as Record<string, Array<Record<string, unknown>>>)[0];
    expect(event).toMatchObject({
      source: 'grammar',
      aspect: 'grammar',
      kind: 'rollup',
      origin: 'grammar-encounter',
      timesSeenDelta: 1,
      targetRef: { kind: 'grammar-pattern', capability: 'grammar-recognition' },
    });
    expect(event.easeAfter).toBeUndefined();
    expect(event.grammarFailedDelta).toBeUndefined();

    // ...and the materialized cache is the replay of that event.
    const grammar = ctx.getGrammarKnowledge('てform')!;
    expect(grammar.timesEncountered).toBe(1);
    expect(grammar.timesFailed).toBe(0);
    expect(grammar.ease).toBeCloseTo(initialGrammarEase() + GRAMMAR_ENCOUNTER_EASE_BUMP, 5);
    expect(grammar.level).toBe(3);
    expect(grammar.language).toBe('ja');
    dispose();
  });

  it('trackGrammarFailed records grammarFailedDelta and the replayed cache reflects it', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    ctx.trackGrammarEncountered('ないform');
    ctx.trackGrammarFailed('ないform');
    await vi.waitFor(() => expect(ctx.getGrammarKnowledge('ないform')?.timesFailed).toBe(1));

    const grammar = ctx.getGrammarKnowledge('ないform')!;
    expect(grammar.timesEncountered).toBe(1);
    expect(grammar.timesFailed).toBe(1);
    expect(grammar.ease).toBeCloseTo(
      Math.max(initialGrammarEase() + GRAMMAR_ENCOUNTER_EASE_BUMP - GRAMMAR_FAIL_EASE_PENALTY, 0),
      5,
    );
    const appended = mockAppendEvents.mock.calls.flatMap(
      (call) => Object.values(call[0] as Record<string, Array<Record<string, unknown>>>).flat(),
    );
    const failureEvent = appended.find((event) => event.origin === 'grammar-failure');
    expect(failureEvent).toMatchObject({ source: 'grammar', aspect: 'grammar', grammarFailedDelta: 1 });
    expect(failureEvent!.timesSeenDelta).toBeUndefined();
    expect(failureEvent!.easeAfter).toBeUndefined();
    dispose();
  });

  it('trackGrammarEncountered increments the replayed counter on repeated calls', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    ctx.trackGrammarEncountered('ている');
    ctx.trackGrammarEncountered('ている');
    ctx.trackGrammarEncountered('ている');
    await vi.waitFor(() => expect(ctx.getGrammarKnowledge('ている')?.timesEncountered).toBe(3));
    dispose();
  });

  it('grammar materialization rebuilds cache entries from journal evidence alone', async () => {
    const { ctx, dispose } = await mountProvider();
    // The journal already carries recognition evidence (persisted event store)
    // while the materialized cache starts empty — fresh store on a new machine,
    // cache corruption, or a future migration. Load must rebuild from evidence.
    mockAppendEvents.mock.calls.push([{
      [grammarEvidenceKey('ja', 'てform', 'grammar-recognition')]: [
        grammarRecognitionEvidence('ja', 'てform', { t: 1, kind: 'rollup', timesSeenDelta: 1, origin: 'grammar-encounter' }),
        grammarRecognitionEvidence('ja', 'てform', { t: 2, kind: 'rollup', grammarFailedDelta: 1, origin: 'grammar-failure' }),
      ],
    }]);

    flashcardsCb(makeEmptyStore());

    await vi.waitFor(() => expect(ctx.getGrammarKnowledge('てform')?.timesFailed).toBe(1));
    expect(ctx.getGrammarKnowledge('てform')?.timesEncountered).toBe(1);
    expect(ctx.getGrammarKnowledge('てform')?.ease).toBeCloseTo(
      Math.max(initialGrammarEase() + GRAMMAR_ENCOUNTER_EASE_BUMP - GRAMMAR_FAIL_EASE_PENALTY, 0),
      5,
    );
    dispose();
  });

  it('grammar tracking can target a non-active stored language explicitly', async () => {
    mockSettings.language = 'ja';
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    ctx.trackGrammarEncountered('verb-case:genitive', 4, 'ru');
    ctx.trackGrammarFailed('verb-case:genitive', 4, 'ru');

    await vi.waitFor(() => expect(ctx.getGrammarKnowledge('verb-case:genitive', 'ru')?.timesFailed).toBe(1));
    const ruGrammar = ctx.getGrammarKnowledge('verb-case:genitive', 'ru');
    const jaGrammar = ctx.getGrammarKnowledge('verb-case:genitive', 'ja');
    expect(ruGrammar?.language).toBe('ru');
    expect(ruGrammar?.level).toBe(4);
    expect(ruGrammar?.timesEncountered).toBe(1);
    expect(ruGrammar?.timesFailed).toBe(1);
    expect(jaGrammar).toBeUndefined();
    expect(ctx.store.grammarKnowledge['ru:verb-case:genitive']).toBeDefined();
    expect(ctx.store.grammarKnowledge['ja:verb-case:genitive']).toBeUndefined();
    dispose();
  });

  it('getGrammarKnowledge can read a non-active stored language explicitly', async () => {
    mockSettings.language = 'ja';
    const { ctx, dispose } = await mountProvider();
    seed(makeEmptyStore({
      grammarKnowledge: {
        'ar:idafa': {
          pattern: 'idafa',
          ease: 2.7,
          timesEncountered: 5,
          timesFailed: 1,
          lastSeen: Date.now(),
          level: 2,
          language: 'ar',
        },
      },
    }));

    expect(ctx.getGrammarKnowledge('idafa', 'ar')?.language).toBe('ar');
    expect(ctx.getGrammarKnowledge('idafa')).toBeUndefined();
    dispose();
  });

  it('migrates legacy grammar ease into recognition-only evidence', async () => {
    const { ctx, dispose } = await mountProvider();
    mockAppendEvents.mockClear();
    seed(makeEmptyStore({
      grammarKnowledge: {
        'ja:ている': {
          pattern: 'ている', ease: 2.8, timesEncountered: 6, timesFailed: 2,
          lastSeen: 100, level: 5, language: 'ja',
        },
      },
    }));

    await vi.waitFor(() => expect(mockAppendEvents).toHaveBeenCalledTimes(1));
    const [[events]] = mockAppendEvents.mock.calls;
    const migrated = Object.values(events as Record<string, Array<Record<string, unknown>>>)[0][0];
    expect(migrated).toMatchObject({
      source: 'grammar',
      origin: 'grammar-legacy-migration',
      targetRef: { kind: 'grammar-pattern', capability: 'grammar-recognition' },
      easeAfter: 2.8,
      timesSeenDelta: 6,
      grammarFailedDelta: 2,
    });
    await vi.waitFor(() => expect(ctx.getGrammarKnowledge('ている')).toMatchObject({ ease: 2.8, timesEncountered: 6, timesFailed: 2 }));
    dispose();
  });


  it('does not promote journal-less legacy passive grammar rows to active evidence', async () => {
    const { ctx, dispose } = await mountProvider();
    mockAppendEvents.mockClear();
    seed(makeEmptyStore({
      grammarKnowledge: {
        'ja:たら': {
          pattern: 'たら', ease: 2.6, timesEncountered: 10, timesFailed: 0,
          lastSeen: 100, level: 5, language: 'ja',
        },
      },
    }));

    await vi.waitFor(() => expect(mockAppendEvents).toHaveBeenCalledTimes(1));
    const [[events]] = mockAppendEvents.mock.calls;
    const migrated = Object.values(events as Record<string, Array<Record<string, unknown>>>)[0][0] as Record<string, unknown>;
    expect(migrated.origin).toBe('grammar-legacy-migration');
    expect(migrated.easeAfter).toBeUndefined();
    expect(migrated.timesSeenDelta).toBe(10);
    expect(migrated.grammarFailedDelta).toBe(0);
    // The materialized projection stays passive: passive exposure can never
    // render Known (R01 / assistance attribution, review 2026-09-17T002411_0000-cc07ec).
    await vi.waitFor(() => {
      const entry = ctx.getGrammarKnowledge('たら');
      expect(entry).toMatchObject({ hasActiveEvidence: false, timesEncountered: 10, timesFailed: 0 });
      expect(entry!.ease).toBeCloseTo(1.4, 10); // derived passive ease, not the legacy 2.6
    });
    dispose();
  });
  it('crash recovery: journal-empty passive rows backfill as passiveTracking and render Untracked (REQ25)', async () => {
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const lk = `ja:${SRS.hashWordSync('受動')}`;
    mockAppendEvents.mockClear();
    // Materialized passive-only row (a crash lost its rollup): seen/hovered,
    // tiny ease, no active markers, no claim, no linked cards.
    seed(makeEmptyStore({
      wordKnowledge: {
        [lk]: {
          ease: 0.05, lastSeen: 1, firstSeen: 1, timesSeen: 3, timesHovered: 1,
          word: '受動', language: 'ja', lastEvidenceSource: 'passiveTracking',
        },
      },
    }));

    // The store load runs the legacy epistemic migration against the empty journal.
    await vi.waitFor(() => expect(mockAppendEvents.mock.calls.length).toBeGreaterThan(0));
    const backfillCall = mockAppendEvents.mock.calls.find(([byKey]) =>
      Object.keys(byKey as Record<string, unknown>)[0] === lk);
    expect(backfillCall).toBeDefined();
    const [backfill] = Object.values(backfillCall![0] as Record<string, Array<Record<string, unknown>>>)[0];
    // NOT source 'migration' — that is an active source on replay and would
    // promote pure exposure into active evidence.
    expect(backfill).toMatchObject({
      kind: 'rollup',
      source: 'passiveTracking',
      origin: 'legacy-projection-backfill',
      easeAfter: 0.05,
      timesSeenDelta: 3,
    });

    // Replay of the recovered row yields NO active evidence.
    const projection = replayKeyProjection([backfill as unknown as Parameters<typeof replayKeyProjection>[0][number]]);
    expect(projection?.hasActiveEvidence).toBe(false);
    expect(projection?.hasEvidence).toBe(true);

    // The word renders Untracked everywhere — never Learning/Unknown/Known.
    const resolved = ctx.getComprehensiveWordStatusWithSourceSync('受動');
    expect(resolved.status).toBe('unknown');
    expect(resolved.basis).toBe('unmeasured');
    expect(knowledgeStatusLabelKey(resolved.status, resolved.basis)).toBe(UNMEASURED_LABEL_KEY);
    dispose();
  });

  it('crash recovery: rows with active provenance keep the migration backfill', async () => {
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const lk = `ja:${SRS.hashWordSync('能動')}`;
    mockAppendEvents.mockClear();
    seed(makeEmptyStore({
      wordKnowledge: {
        [lk]: {
          ease: 2.2, lastSeen: 1, timesSeen: 2, timesHovered: 0,
          word: '能動', language: 'ja',
          hasActiveEvidence: true, lastEvidenceSource: 'manual', lastStatusChange: 1,
        },
      },
    }));

    await vi.waitFor(() => expect(mockAppendEvents.mock.calls.length).toBeGreaterThan(0));
    const backfillCall = mockAppendEvents.mock.calls.find(([byKey]) =>
      Object.keys(byKey as Record<string, unknown>)[0] === lk);
    const [backfill] = Object.values(backfillCall![0] as Record<string, Array<Record<string, unknown>>>)[0];
    expect(backfill).toMatchObject({ kind: 'rollup', source: 'migration', origin: 'legacy-projection-backfill' });
    const projection = replayKeyProjection([backfill as unknown as Parameters<typeof replayKeyProjection>[0][number]]);
    expect(projection?.hasActiveEvidence).toBe(true);
    dispose();
  });

  // ─── Priority 2: Word appearance tracking ─────────────────────────
  it('trackWordAppearance tracks word candidates', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    await ctx.trackWordAppearance('新語');
    const SRS = await import('../services/srsAlgorithm');
    const hash = await SRS.hashWord('新語');
    const lk = `ja:${hash}`;
    expect(ctx.store.wordCandidates[lk]).toBeDefined();
    expect(ctx.store.wordCandidates[lk].count).toBe(1);
    dispose();
  });

  it('trackWordAppearance increments count on repeated calls', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    await ctx.trackWordAppearance('繰り返し');
    await ctx.trackWordAppearance('繰り返し');
    const SRS = await import('../services/srsAlgorithm');
    const hash = await SRS.hashWord('繰り返し');
    const lk = `ja:${hash}`;
    expect(ctx.store.wordCandidates[lk].count).toBe(2);
    dispose();
  });

  it('trackWordAppearance increments an existing candidate through language-provided variants', async () => {
    mockGetWordVariants.mockImplementation((word: string) => word === 'иду' ? ['идти', 'иду'] : []);
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    await ctx.trackWordAppearance('идти');
    await ctx.trackWordAppearance('иду');

    const SRS = await import('../services/srsAlgorithm');
    const lemmaKey = `ja:${await SRS.hashWord('идти')}`;
    const inflectedKey = `ja:${await SRS.hashWord('иду')}`;
    expect(ctx.store.wordCandidates[lemmaKey].count).toBe(2);
    expect(ctx.store.wordCandidates[inflectedKey]).toBeUndefined();
    dispose();
  });

  it('trackWordAppearance skips words that already have flashcards', async () => {
    const { ctx, dispose } = await mountProvider();
    seedAccepted();

    await ctx.addFlashcard({ front: '既存', back: 'existing' }, undefined, true);
    await ctx.trackWordAppearance('既存');

    const SRS = await import('../services/srsAlgorithm');
    const hash = await SRS.hashWord('既存');
    const lk = `ja:${hash}`;
    expect(ctx.store.wordCandidates[lk]).toBeUndefined();
    dispose();
  });

  it('trackWordAppearance skips variants that already have flashcards', async () => {
    mockGetWordVariants.mockImplementation((word: string) => word === 'يكتب' ? ['كتب', 'يكتب'] : []);
    const { ctx, dispose } = await mountProvider();
    seedAccepted();

    await ctx.addFlashcard({ front: 'كتب', back: 'write' }, undefined, true);
    await ctx.trackWordAppearance('يكتب');

    const SRS = await import('../services/srsAlgorithm');
    const key = `ja:${await SRS.hashWord('يكتب')}`;
    expect(ctx.store.wordCandidates[key]).toBeUndefined();
    dispose();
  });

  // ─── Priority 2: BroadcastChannel ─────────────────────────────────
  it('adopts a newer authoritative Undo and ignores an older scheduler snapshot', async () => {
    const state: { handler: ((event: MessageEvent) => void) | null } = { handler: null };
    function MockBroadcastChannel() {
      return {
        postMessage: vi.fn(),
        close: vi.fn(),
        set onmessage(fn: ((event: MessageEvent) => void) | null) { state.handler = fn; },
        get onmessage() { return state.handler; },
      };
    }
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'card-window-undo', state: 'review', reviews: 4 });
    const today = SRS.getTodayDateString(4);
    seed(makeEmptyStore({
      rev: 8,
      flashcards: { [card.id]: card },
      meta: { ...makeEmptyStore().meta, perLanguage: { ja: { newCardsToday: 0, reviewsToday: 6, newCardsDate: today } } },
      dailyStats: { [today]: { ja: { date: today, newCardsStudied: 0, reviewCardsStudied: 6, lapses: 0, timeSpent: 10, graduated: 0 } } },
    }));

    const undone = makeEmptyStore({
      rev: 9,
      flashcards: { [card.id]: { ...card, reviews: 3, interval: 0, dueDate: Date.now() - 1000 } },
      meta: { ...makeEmptyStore().meta, perLanguage: { ja: { newCardsToday: 0, reviewsToday: 5, newCardsDate: today } } },
      dailyStats: { [today]: { ja: { date: today, newCardsStudied: 0, reviewCardsStudied: 5, lapses: 0, timeSpent: 10, graduated: 0 } } },
    });
    state.handler!({ data: { type: 'update', store: undone } } as MessageEvent);

    expect(ctx.store.flashcards[card.id].reviews).toBe(3);
    expect(ctx.store.meta.perLanguage.ja.reviewsToday).toBe(5);
    expect(ctx.store.dailyStats[today].ja.reviewCardsStudied).toBe(5);

    state.handler!({ data: { type: 'update', store: makeEmptyStore({
      rev: 8,
      flashcards: { [card.id]: card },
      meta: { ...makeEmptyStore().meta, perLanguage: { ja: { newCardsToday: 0, reviewsToday: 6, newCardsDate: today } } },
      dailyStats: { [today]: { ja: { date: today, newCardsStudied: 0, reviewCardsStudied: 6, lapses: 0, timeSpent: 10, graduated: 0 } } },
    }) } } as MessageEvent);

    expect(ctx.store.flashcards[card.id].reviews).toBe(3);
    expect(ctx.store.meta.perLanguage.ja.reviewsToday).toBe(5);
    expect(ctx.store.dailyStats[today].ja.reviewCardsStudied).toBe(5);
    dispose();
    vi.unstubAllGlobals();
  });

  it('BroadcastChannel merges knowledge entries per-key LWW by claim recency', async () => {
    const state: { handler: ((event: MessageEvent) => void) | null } = { handler: null };
    const closeFn = vi.fn();
    function MockBroadcastChannel() {
      return {
        postMessage: vi.fn(),
        close: closeFn,
        set onmessage(fn: ((event: MessageEvent) => void) | null) { state.handler = fn; },
        get onmessage() { return state.handler; },
      };
    }
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);

    const { ctx, dispose } = await mountProvider();
    const lk = `ja:${SRS.hashWordSync('学校')}`;
    const seenKey = `${lk}:seen`;
    seed(makeEmptyStore({
      wordKnowledge: {
        [lk]: {
          ease: SRS.MIN_EASE, lastSeen: 1, timesSeen: 0, timesHovered: 0,
          word: '学校', language: 'ja', claim: 'learning', claimAt: 100,
        },
      },
    }));

    // Incoming NEWER claim entry wins over the local entry.
    const remoteNewer = makeEmptyStore({
      wordKnowledge: {
        [lk]: {
          ease: SRS.MIN_EASE, lastSeen: 1, timesSeen: 0, timesHovered: 0,
          word: '学校', language: 'ja', claim: 'known', claimAt: 200,
        },
      },
    });
    state.handler!({ data: { type: 'update', store: remoteNewer } } as MessageEvent);

    expect(ctx.store.wordKnowledge[lk]?.claim).toBe('known');
    expect(ctx.store.wordKnowledge[lk]?.claimAt).toBe(200);

    // Incoming STALE entry (older claimAt) must not clobber the newer local write.
    const remoteStale = makeEmptyStore({
      wordKnowledge: {
        [lk]: {
          ease: SRS.MIN_EASE, lastSeen: 1, timesSeen: 0, timesHovered: 0,
          word: '学校', language: 'ja', claim: 'unknown', claimAt: 50,
        },
      },
    });
    state.handler!({ data: { type: 'update', store: remoteStale } } as MessageEvent);

    expect(ctx.store.wordKnowledge[lk]?.claim).toBe('known');
    expect(ctx.store.wordKnowledge[lk]?.claimAt).toBe(200);
    dispose();
    vi.unstubAllGlobals();
  });

  it('BroadcastChannel merges reversible knowledge collections without max-merging daily counters', async () => {
    const state: { handler: ((event: MessageEvent) => void) | null } = { handler: null };
    const closeFn = vi.fn();
    function MockBroadcastChannel() {
      return {
        postMessage: vi.fn(),
        close: closeFn,
        set onmessage(fn: ((event: MessageEvent) => void) | null) { state.handler = fn; },
        get onmessage() { return state.handler; },
      };
    }
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);

    const { ctx, dispose } = await mountProvider();
    const candidateKey = 'ja:学校';
    const grammarKey = 'ja:てform';
    const suggestionKey = 'ja:候補';
    const today = '2026-08-30';
    seed(makeEmptyStore({
      wordCandidates: { [candidateKey]: { count: 5, lastSeen: 200, word: '学校', language: 'ja' } },
      grammarKnowledge: {
        [grammarKey]: { pattern: 'てform', ease: 1.31, timesEncountered: 3, timesFailed: 0, lastSeen: 200, level: 1, language: 'ja' },
      },
      suggestedFlashcards: { [suggestionKey]: { id: 's1', word: '候補', language: 'ja', createdAt: 100, lastSeen: 200, count: 1 } },
      dailyStats: { [today]: { ja: { date: today, newCardsStudied: 3, reviewCardsStudied: 1, lapses: 0, timeSpent: 100, graduated: 0 } } },
    }));

    // Incoming NEWER entries win per collection.
    const remoteNewer = makeEmptyStore({
      wordCandidates: { [candidateKey]: { count: 7, lastSeen: 300, word: '学校', language: 'ja' } },
      grammarKnowledge: {
        [grammarKey]: { pattern: 'てform', ease: 1.32, timesEncountered: 4, timesFailed: 0, lastSeen: 300, level: 1, language: 'ja' },
      },
      suggestedFlashcards: { [suggestionKey]: { id: 's1', word: '候補', language: 'ja', createdAt: 100, lastSeen: 300, count: 2 } },
      dailyStats: { [today]: { ja: { date: today, newCardsStudied: 1, reviewCardsStudied: 2, lapses: 1, timeSpent: 500, graduated: 1 } } },
    });
    state.handler!({ data: { type: 'update', store: remoteNewer } } as MessageEvent);

    expect(ctx.store.wordCandidates[candidateKey]?.count).toBe(7);
    expect(ctx.store.grammarKnowledge[grammarKey]?.timesEncountered).toBe(4);
    expect(ctx.store.suggestedFlashcards[suggestionKey]?.lastSeen).toBe(300);
    expect(ctx.store.dailyStats[today]?.ja).toEqual({
      date: today, newCardsStudied: 3, reviewCardsStudied: 1, lapses: 0, timeSpent: 100, graduated: 0,
    });

    // Incoming STALE entries must not revert the newer local writes.
    const remoteStale = makeEmptyStore({
      wordCandidates: { [candidateKey]: { count: 2, lastSeen: 400, word: '学校', language: 'ja' } },
      grammarKnowledge: {
        [grammarKey]: { pattern: 'てform', ease: 5, timesEncountered: 1, timesFailed: 0, lastSeen: 400, level: 1, language: 'ja' },
      },
      suggestedFlashcards: { [suggestionKey]: { id: 's1', word: '候補', language: 'ja', createdAt: 100, lastSeen: 100, count: 9 } },
      dailyStats: { [today]: { ja: { date: today, newCardsStudied: 0, reviewCardsStudied: 0, lapses: 0, timeSpent: 10, graduated: 0 } } },
    });
    state.handler!({ data: { type: 'update', store: remoteStale } } as MessageEvent);

    // Lower candidate count loses despite a newer lastSeen; fewer grammar
    // encounters lose despite a higher ease.
    expect(ctx.store.wordCandidates[candidateKey]?.count).toBe(7);
    expect(ctx.store.grammarKnowledge[grammarKey]?.timesEncountered).toBe(4);
    expect(ctx.store.suggestedFlashcards[suggestionKey]?.lastSeen).toBe(300);
    expect(ctx.store.dailyStats[today]?.ja).toEqual({
      date: today, newCardsStudied: 3, reviewCardsStudied: 1, lapses: 0, timeSpent: 100, graduated: 0,
    });
    dispose();
    vi.unstubAllGlobals();
  });

  // ─── Priority 2: updateMeta ───────────────────────────────────────
  it('updateMeta modifies store.meta and refreshes queue', async () => {
    const { ctx, dispose } = await mountProvider();
    seedAccepted();

    ctx.updateMeta({ maxNewCardsPerDay: 50 });
    expect(ctx.store.meta.maxNewCardsPerDay).toBe(50);
    // `updateMeta` persists on the debounced timer, so the write would still be
    // queued when this test disposes the provider - and would then land inside
    // whichever test ran next, against that test's authority and revision. A
    // cross-test leak like that shows up as a refusal in an unrelated test
    // about something else entirely. Flushing here keeps the write this
    // test's own.
    await vi.waitFor(() => expect(mockBridge.flashcards.saveFlashcards).toHaveBeenCalled());
    dispose();
  });

  // ─── Priority 2: updateFlashcardContent ───────────────────────────
  it('updateFlashcardContent modifies content fields', async () => {
    const { ctx, dispose } = await mountProvider();
    seedAccepted();

    const id = await ctx.addFlashcard({ front: '本', back: 'book' }, undefined, true);
    ctx.updateFlashcardContent(id, { back: 'book (also: origin)' });

    expect(ctx.store.flashcards[id].content.back).toBe('book (also: origin)');
    dispose();
  });

  it('tracks authored changes without marking cloned package data as edited', async () => {
    const { ctx, dispose } = await mountProvider();
    seedAccepted();
    const id = await ctx.addFlashcard({ front: 'surface', back: 'meaning' }, undefined, true);
    const prosody = { type: 'future::relationship-contour', raw: { participants: ['speaker', 'hearer'], value: { contour: [2, 1], condition: 'formal' } } };
    const extra = { 'future::discourse': { relation: { subject: 'speaker', referent: 'prior-clause' }, values: [false, { mode: 'indirect' }] } };
    ctx.updateFlashcard(id, { content: { ...ctx.store.flashcards[id].content,
      prosody, extra, userEditedFields: ['example'] } });
    ctx.updateFlashcardContent(id, {
      back: 'revised meaning',
      prosody: JSON.parse(JSON.stringify(prosody)),
      extra: { 'future::discourse': { values: [false, { mode: 'indirect' }], relation: { referent: 'prior-clause', subject: 'speaker' } } },
    });
    expect(ctx.store.flashcards[id].content.userEditedFields).toEqual(['example', 'back']);
    expect(ctx.store.flashcards[id].content.prosody).toEqual(prosody);
    expect(ctx.store.flashcards[id].content.extra).toEqual(extra);
    ctx.updateFlashcardContent(id, { prosody: { ...prosody, raw: { ...prosody.raw, value: { contour: [1, 2], condition: 'formal' } } } });
    expect(ctx.store.flashcards[id].content.userEditedFields).toEqual(['example', 'back', 'prosody']);
    dispose();
  });

  it('updateFlashcardContent moves word indexes using the card language when the front changes', async () => {
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    mockGetCanonicalForm.mockImplementation((word: string) => `ja:${word}`);
    mockGetCanonicalFormForLanguage.mockImplementation((language: string, word: string) => `${language}:${word}`);
    seedAccepted();

    const id = await ctx.addFlashcard({ front: 'سلام', back: 'hello' }, undefined, true, 'ar');
    const oldKey = `ar:${await SRS.hashWord('ar:سلام')}`;
    const newKey = `ar:${await SRS.hashWord('ar:كتاب')}`;
    expect(ctx.store.wordToCardMap[oldKey]).toContain(id);

    ctx.updateFlashcardContent(id, { front: 'كتاب' });

    expect(ctx.store.wordToCardMap[oldKey]).toBeUndefined();
    expect(ctx.store.wordToCardMap[newKey]).toContain(id);
    expect(ctx.hasWordSync('سلام', 'ar')).toBe(false);
    expect(ctx.hasWordSync('كتاب', 'ar')).toBe(true);
    dispose();
  });

  // ─── Priority 2: Cleanup ─────────────────────────────────────────
  it('dispose cleans up IPC listeners and BroadcastChannel', async () => {
    const closeFn = vi.fn();
    function MockBroadcastChannel() {
      return {
        postMessage: vi.fn(),
        close: closeFn,
        set onmessage(_fn: ((event: MessageEvent) => void) | null) {},
        get onmessage(): ((event: MessageEvent) => void) | null { return null; },
      };
    }
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);

    const { dispose } = await mountProvider();
    dispose();

    expect(flashcardsCleanup).toHaveBeenCalled();
    expect(newDayCleanup).toHaveBeenCalled();
    expect(migrationCleanup).toHaveBeenCalled();
    expect(closeFn).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  // ─── Priority 2: Canonical form integration ──────────────────────
  it('addFlashcard uses getCanonicalForm for hashing', async () => {
    const { ctx, dispose } = await mountProvider();
    seedAccepted();
    mockGetCanonicalForm.mockImplementation((w: string) => w === 'きる' ? '着る' : w);

    await ctx.addFlashcard({ front: 'きる', back: 'to wear' }, undefined, true);

    const SRS = await import('../services/srsAlgorithm');
    const canonHash = await SRS.hashWord('着る');
    const lk = `ja:${canonHash}`;
    expect(ctx.store.wordToCardMap[lk]).toBeDefined();
    expect(ctx.store.wordToCardMap[lk].length).toBe(1);

    mockGetCanonicalForm.mockImplementation((w: string) => w);
    dispose();
  });

  // ─── Priority 2: isWordKnown / isWordKnownByText ─────────────────
  it('isWordKnownByText is false for pure passive ease — Known requires active evidence', async () => {
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const hash = SRS.hashWordSync('上手');
    const lk = `ja:${hash}`;
    seed(makeEmptyStore({
      wordKnowledge: {
        [lk]: {
          ease: 4.5,
          lastSeen: Date.now(),
          timesSeen: 100,
          timesHovered: 0,
          word: '上手',
          language: 'ja',
        },
      },
    }));

    // REQ13: high passive ease is familiarity, never epistemic Known.
    expect(ctx.isWordKnownByText('上手')).toBe(false);
    dispose();
  });

  it('isWordKnownByText is true when active evidence backs the high ease', async () => {
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const hash = SRS.hashWordSync('上手');
    const lk = `ja:${hash}`;
    seed(makeEmptyStore({
      wordKnowledge: {
        [lk]: {
          ease: 4.5,
          lastSeen: Date.now(),
          timesSeen: 100,
          timesHovered: 0,
          word: '上手',
          language: 'ja',
          hasActiveEvidence: true,
          lastEvidenceSource: 'srs',
        },
      },
    }));

    expect(ctx.isWordKnownByText('上手')).toBe(true);
    dispose();
  });

  it('isWordKnownByText returns false when ease is below threshold', async () => {
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const hash = SRS.hashWordSync('難しい');
    const lk = `ja:${hash}`;
    seed(makeEmptyStore({
      wordKnowledge: {
        [lk]: {
          ease: 2.0,
          lastSeen: Date.now(),
          timesSeen: 5,
          timesHovered: 10,
          word: '難しい',
          language: 'ja',
        },
      },
    }));

    expect(ctx.isWordKnownByText('難しい')).toBe(false);
    dispose();
  });

  it('isWordKnownByText can target a non-active stored word language explicitly', async () => {
    mockSettings.language = 'ja';
    mockGetCanonicalFormForLanguage.mockImplementation((language: string, word: string) => (
      language === 'ar' && word === 'يكتب' ? 'كتب' : word
    ));
    mockGetWordVariantsForLanguage.mockImplementation((language: string, word: string) => (
      language === 'ar' && word === 'يكتب' ? ['كتب', 'يكتب'] : [word]
    ));
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const arKey = `ar:${SRS.hashWordSync('كتب')}`;
    seed(makeEmptyStore({
      wordKnowledge: {
        [arKey]: {
          ease: 4.5,
          lastSeen: Date.now(),
          timesSeen: 10,
          timesHovered: 0,
          word: 'كتب',
          language: 'ar',
          // Language-targeting is the point of this test; Known still needs
          // active evidence, so seed it (REQ13).
          hasActiveEvidence: true,
          lastEvidenceSource: 'srs',
        },
      },
    }));
    flashcardsCb(committed);

    expect(ctx.isWordKnownByText('يكتب', 'ar')).toBe(true);
    expect(ctx.isWordKnownByText('يكتب')).toBe(false);
    dispose();
  });

  it('submitRating writes active evidence under a non-active language primary form key', async () => {
    mockSettings.language = 'ja';
    mockGetCanonicalFormForLanguage.mockImplementation((language: string, word: string) => (
      language === 'ar' && word === 'يكتب' ? 'كتب' : word
    ));
    // Anchor the fluent known threshold at the resolver's known threshold so the
    // written evidence genuinely classifies as Known (mockSettings only sets the
    // legacy known_ease_threshold, leaving easeThresholdKnown at its lower default).
    mockSettings.easeThresholdKnown = mockSettings.known_ease_threshold / 1000;
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    flashcardsCb(makeEmptyStore());

    // setWordKnowledgeEase is no longer public — attempt ratings are the only
    // evidence writer. A fluent sense-recognition rating anchors at the known threshold.
    await submitObservation(ctx, 'يكتب', 'sense-recognition', 'fluent', { language: 'ar' });

    const arKey = `ar:${SRS.hashWordSync('كتب')}`;
    const jaKey = `ja:${SRS.hashWordSync('يكتب')}`;
    expect(ctx.store.wordKnowledge[arKey]?.word).toBe('كتب');
    expect(ctx.store.wordKnowledge[arKey]?.language).toBe('ar');
    expect(ctx.store.wordKnowledge[arKey]?.ease).toBe(mockSettings.easeThresholdKnown);
    // Attempt ratings are ACTIVE evidence — they lift the passive-only cap.
    expect(ctx.store.wordKnowledge[arKey]?.hasActiveEvidence).toBe(true);
    expect(ctx.store.wordKnowledge[arKey]?.lastEvidenceSource).toBe('manual');
    expect(ctx.store.wordKnowledge[jaKey]).toBeUndefined();
    expect(ctx.isWordKnownByText('يكتب', 'ar')).toBe(true);
    // Restore the shared mock setting mutated above (beforeEach does not reset it).
    mockSettings.easeThresholdKnown = DEFAULT_SETTINGS.easeThresholdKnown;
    dispose();
  });

  it('records one exact reading observation without creating meaning evidence', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    mockAppendEvents.mockClear();

    await submitObservation(ctx, '苗字', 'surface-reading', 'fluent', {});

    const events = mockAppendEvents.mock.calls.flatMap(([batch]) => Object.values(batch).flat());
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'rating', targetRef: { capability: 'surface-reading' }, toStatus: 'known' });
    expect(ctx.store.wordKnowledge[`ja:${SRS.hashWordSync('苗字')}`]?.ease).toBe(SRS.MIN_EASE);
    expect(ctx.getAccessStatus('苗字', 'sense-recognition').status).toBe('unknown');
    dispose();
  });

  it('writes reading evidence and scheduler review in one acknowledged command', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'reading-review', state: 'new' });
    flashcardsCb(makeEmptyStore({ flashcards: { [card.id]: card } }));
    mockAppendEvents.mockClear();

    await ctx.submitRating(card.content.front, [{ capability: 'surface-reading', quality: 'fluent' }], {
      scheduler: { cardId: card.id, rating: 'good', tested: ['surface-reading'] },
    });

    const events = mockAppendEvents.mock.calls.flatMap(([batch]) => Object.values(batch).flat());
    expect(events).toHaveLength(2);
    expect(events.find((event) => event.kind === 'review')).toMatchObject({ kind: 'review', schedulerCardId: card.id });
    expect(events.find((event) => event.kind === 'review')?.aspect).toBeUndefined();
    expect(events.every((event) => event.attemptId === events[0].attemptId)).toBe(true);
    expect(ctx.store.wordKnowledge[`ja:${SRS.hashWordSync(card.content.front)}`]?.ease).toBe(SRS.MIN_EASE);
    dispose();
  });

  it('rebuilds independent access evidence and claims during replay', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    await submitObservation(ctx, '苗字', 'sense-recognition', 'fluent');
    await submitObservation(ctx, '苗字', 'surface-reading', 'missed');
    await ctx.setAccessClaim('苗字', 'surface-reading', 'known');
    await ctx.recomputeWordKnowledgeFromEvidence('苗字');
    const entry = ctx.store.wordKnowledge[`ja:${SRS.hashWordSync('苗字')}`];
    expect(entry?.ease).toBe(mockSettings.easeThresholdKnown + mockSettings.manualStatusEaseBuffer);
    expect(entry?.access?.['surface-reading']).toMatchObject({ status: 'unknown', claim: 'known' });
    expect(ctx.getAccessStatus('苗字', 'surface-reading').status).toBe('known');
    dispose();
  });

  it('imports real Anki reviews into the same capability projection on refresh', async () => {
    const previous = mockSettings.use_anki;
    mockSettings.use_anki = true;
    const anki = await import('../hooks/useAnki');
    const request = vi.spyOn(anki, 'ankiRequest').mockImplementation(async (_url, action) => action === 'cardsInfo' ? [{
      cardId: 999, question: 'review-import pronunciation', answer: 'definition',
      fields: { Expression: { value: 'review-import' }, Reading: { value: 'pronunciation' }, Meaning: { value: 'definition' } },
    }] : {
      '999': [{ id: Date.now(), cid: 999, usn: 0, ease: 3, ivl: 3, lastIvl: 1, factor: 2500, time: 1200, type: 1 }],
    });
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    mockBackend.getAnkiWordStatuses.mockResolvedValue([{ word: 'review-import', cardId: 999, mod: 10 }]);
    const { refreshAnkiWordsCache } = await import('../services/ankiWordsCache');
    await refreshAnkiWordsCache({ language: 'ja', languageData: mockLangData.ja });
    await vi.waitFor(() => expect(ctx.store.wordKnowledge[`ja:${SRS.hashWordSync('review-import')}`]?.lastEvidenceSource).toBe('anki'));
    const entry = ctx.store.wordKnowledge[`ja:${SRS.hashWordSync('review-import')}`];
    expect(entry?.hasActiveEvidence).toBe(true);
    expect(entry?.access?.['surface-reading']).toBeUndefined();
    expect(ctx.getAccessStatus('review-import', 'sense-recognition').status).toBe('known');
    request.mockRestore();
    dispose();
    mockSettings.use_anki = previous;
  });

  it('repairs a version-one mixed-capability cache once at startup', async () => {
    const key = `ja:${SRS.hashWordSync('cache-repair')}`;
    mockAppendEvents.mockClear();
    await mockAppendEvents({ [key]: [{ t: 1, kind: 'rating', source: 'manual', aspect: 'reading', easeAfter: 2.5, attemptId: 'old-reading' }] });
    const { ctx, dispose } = await mountProvider();
    const loaded = makeEmptyStore({ wordKnowledge: { [key]: {
      word: 'cache-repair', language: 'ja', ease: 2.5, lastSeen: 1, timesSeen: 0, timesHovered: 0, hasActiveEvidence: true,
    } } });
    loaded.meta.capabilityProjectionVersion = 1;
    flashcardsCb(loaded);
    await vi.waitFor(() => expect(ctx.isKnowledgeReady()).toBe(true));
    expect(ctx.store.wordKnowledge[key]?.ease).toBe(SRS.MIN_EASE);
    expect(ctx.store.wordKnowledge[key]?.access?.['surface-reading']?.status).toBe('known');
    expect(ctx.store.meta.capabilityProjectionVersion).toBe(3);
    dispose();
  });

  it('keeps Japanese text meaning known when reading is unknown and prosody is irrelevant to that task', async () => {
    mockSettings.language = 'ja';
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    await submitObservation(ctx, '会う', 'sense-recognition', 'fluent');
    await submitObservation(ctx, '会う', 'surface-reading', 'missed');
    await submitObservation(ctx, '会う', 'prosodic-pattern', 'missed');
    await ctx.recomputeWordKnowledgeFromEvidence('会う', 'ja');
    // A meaning task queries its directed access, without aggregating unrelated failures.
    expect(ctx.getAccessStatus('会う', 'sense-recognition', 'ja').status).toBe('known');
    expect(ctx.getAccessStatus('会う', 'surface-reading', 'ja').status).toBe('unknown');
    expect(ctx.getAccessStatus('会う', 'prosodic-pattern', 'ja').status).toBe('unknown');
    dispose();
  });

  it('does not infer meaning from recognizing the written or spoken identity', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    await submitObservation(ctx, '会う', 'surface-recognition', 'fluent');
    await submitObservation(ctx, '会う', 'spoken-recognition', 'fluent');
    expect(ctx.getComprehensiveWordStatusSync('会う')).toBe('known');
    expect(ctx.getAccessStatus('会う', 'sense-recognition').status).toBe('unknown');
    expect(ctx.getAccessStatus('会う', 'sense-recognition').untracked).toBe(true);
    dispose();
  });

  it('keeps Anki scheduler metadata out of known sets and suggestion cleanup', async () => {
    const previous = mockSettings.use_anki;
    mockSettings.use_anki = true;
    mockBackend.getAnkiWordStatuses.mockResolvedValue([{ word: 'source-only', factor: 4000, queue: 2, type: 2 }]);
    const { ctx, dispose } = await mountProvider();
    const key = `ja:${SRS.hashWordSync('source-only')}`;
    flashcardsCb(makeEmptyStore({ suggestedFlashcards: {
      [key]: { id: 'source-only', word: 'source-only', language: 'ja', createdAt: Date.now(), lastSeen: Date.now(), count: 1 },
    } }));
    const { refreshAnkiWordsCache } = await import('../services/ankiWordsCache');
    await refreshAnkiWordsCache({ language: 'ja', languageData: mockLangData.ja });
    expect(ctx.isWordKnownByText('source-only')).toBe(false);
    expect(await ctx.cleanupKnownSuggestions()).toBe(0);
    expect(ctx.store.suggestedFlashcards[key]).toBeDefined();
    dispose();
    mockSettings.use_anki = previous;
  });

  it('submitRating refuses evidence for a scaffold-supplied access (acceptance B)', async () => {
    mockSettings.language = 'ja';
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    flashcardsCb(makeEmptyStore());

    // Furigana was visible: a "fluent reading" rating is cued recognition.
    const { attemptId } = await submitObservation(ctx, '苗字', 'surface-reading', 'fluent', {
      scaffolds: { reading: true },
    });

    const lk = `ja:${SRS.hashWordSync('苗字')}`;
    expect(ctx.store.wordKnowledge[lk]).toBeUndefined();
    expect(ctx.getAccessStatus('苗字', 'surface-reading')).toMatchObject({ status: 'unknown' });
    expect(typeof attemptId).toBe('string');

    // Same rating with reading explicitly hidden measures normally.
    await submitObservation(ctx, '苗字', 'surface-reading', 'fluent', { scaffolds: { reading: false } });
    expect(ctx.store.wordKnowledge[lk]?.access?.['surface-reading']?.status).toBe('known');
    dispose();
  });

  it('consulted review preserves retention and does not create a retrieval lapse or independent meaning', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'consulted', state: 'review', interval: 86400000,
      dueDate: Date.now() - 1000, reviews: 3, lapses: 2,
      content: { type: 'word', front: 'consulted-source', back: 'answer' } });
    seed(makeEmptyStore({ flashcards: { [card.id]: card } }));
    await ctx.submitRating(card.content.front, [{ capability: 'sense-recognition', quality: 'missed' }], {
      taskType: 'srs-review', language: 'ja', scaffolds: { 'provided-access:sense-recognition': true },
      scheduler: { cardId: card.id, rating: 'again', tested: ['sense-recognition'] },
    });
    expect(ctx.store.flashcards[card.id]).toMatchObject({ ease: card.ease, interval: card.interval,
      dueDate: card.dueDate, reviews: card.reviews, lapses: card.lapses });
    expect(Object.values(ctx.store.dailyStats).flatMap(byLanguage => Object.values(byLanguage)).map(day => day.lapses)).toEqual([0]);
    expect(ctx.getAccessStatus(card.content.front, 'sense-recognition').status).toBe('unknown');
    dispose();
  });

  it('isWordKnownComprehensiveSync can target a non-active stored word language explicitly', async () => {
    mockSettings.language = 'ja';
    mockGetCanonicalFormForLanguage.mockImplementation((language: string, word: string) => (
      language === 'ar' && word === 'يكتب' ? 'كتب' : word
    ));
    mockGetWordVariantsForLanguage.mockImplementation((language: string, word: string) => (
      language === 'ar' && word === 'يكتب' ? ['كتب', 'يكتب'] : [word]
    ));
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const arKey = `ar:${SRS.hashWordSync('كتب')}`;
    seed(makeEmptyStore({
      wordKnowledge: {
        [arKey]: {
          word: 'كتب',
          language: 'ar',
          ease: mockSettings.easeThresholdKnown,
          lastSeen: 1,
          timesSeen: 1,
          timesHovered: 0,
          lastStatusChange: 5,
          // Known evidence must be active (SRS/Anki/attempt/migration) to resolve as known.
          hasActiveEvidence: true,
        },
      },
    }));

    expect(ctx.isWordKnownComprehensiveSync('يكتب')).toBe(false);
    expect(ctx.isWordKnownComprehensiveSync('يكتب', 'ar')).toBe(true);
    dispose();
  });

  // ─── Priority 2: getIgnoredWordsSync ──────────────────────────────
  it('getIgnoredWordsSync returns only current language entries', async () => {
    const { ctx, dispose } = await mountProvider();
    seed(makeEmptyStore({
      ignoredWords: {
        'ja:hash1': { word: '犬', language: 'ja', ignoredAt: 1000 },
        'de:hash2': { word: 'Hund', language: 'de', ignoredAt: 2000 },
        'ja:hash3': { word: '猫', language: 'ja', ignoredAt: 3000 },
      },
    }));

    const ignored = ctx.getIgnoredWordsSync();
    expect(ignored).toHaveLength(2);
    expect(ignored[0].word).toBe('猫');
    expect(ignored[1].word).toBe('犬');
    dispose();
  });

  // ─── Priority 2: startSession / refreshQueue ─────────────────────
  it('startSession refreshes the queue', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'sess-1', state: 'new' });
    flashcardsCb(makeEmptyStore({ flashcards: { 'sess-1': card } }));

    ctx.startSession();
    const q = ctx.queue();
    expect(q.newQueue).toContain('sess-1');
    dispose();
  });

  it('refreshQueue caps new cards by maxNewCardsPerDayLearning, not the legacy maxNewCardsPerDay', async () => {
    const { ctx, dispose } = await mountProvider();
    const cards: Record<string, Flashcard> = {};
    for (let i = 0; i < 50; i++) {
      cards[`cap-${i}`] = makeCard({ id: `cap-${i}`, state: 'new' });
    }
    const hash = await SRS.hashWord('テスト');
    const lk = `ja:${hash}`;
    seed(makeEmptyStore({
      flashcards: cards,
      wordToCardMap: { [lk]: Object.keys(cards) },
      meta: {
        ...makeEmptyStore().meta,
        // Legacy field shadows the queue if used; the user-facing learning
        // setting must be the effective daily cap.
        maxNewCardsPerDay: 10,
        maxNewCardsPerDayLearning: 40,
        perLanguage: { ja: { newCardsToday: 2, reviewsToday: 0, newCardsDate: SRS.getTodayDateString(4) } },
        newCardsToday: 2,
      },
    }));
    flashcardsCb(committed);

    ctx.refreshQueue();

    expect(ctx.queue().newQueue.length).toBe(38); // 40 - 2, not 10 - 2 = 8
    dispose();
  });

  // ─── Priority 3: Anki choice flow ────────────────────────────────
  it('addFlashcard with use_anki shows pending choice', async () => {
    const { ctx, dispose } = await mountProvider();
    seedAccepted();
    const prevAnki = mockSettings.use_anki;
    mockSettings.use_anki = true;

    const addPromise = ctx.addFlashcard({ front: 'アンキ', back: 'anki' });

    await vi.waitFor(() => {
      expect(ctx.pendingFlashcardChoice()).not.toBeNull();
    });

    ctx.resolvePendingFlashcardChoice('srs');
    const id = await addPromise;
    expect(id).toBeTruthy();
    expect(ctx.store.flashcards[id]).toBeDefined();

    mockSettings.use_anki = prevAnki;
    dispose();
  });

  it('addFlashcard with use_anki + cancel returns empty id', async () => {
    const { ctx, dispose } = await mountProvider();
    seedAccepted();
    const prevAnki = mockSettings.use_anki;
    mockSettings.use_anki = true;

    const addPromise = ctx.addFlashcard({ front: 'キャンセル', back: 'cancel' });

    await vi.waitFor(() => {
      expect(ctx.pendingFlashcardChoice()).not.toBeNull();
    });

    ctx.resolvePendingFlashcardChoice('cancel');
    const id = await addPromise;
    expect(id).toBe('');

    mockSettings.use_anki = prevAnki;
    dispose();
  });

  // ─── Suggested flashcard media ownership ─────────────────────────
  // A suggestion adopts its image under its own id, so the file is reachable
  // by the existing suggestion delete paths.
  describe('suggested flashcard media ownership', () => {
    it('stores a suggestion image under the suggestion that owns it', async () => {
      const { ctx, dispose } = await mountProvider();
      flashcardsCb(makeEmptyStore());
      mockSettings.learningLanguageLevel = null;
      mockSettings.learningLanguageLevels = { ja: null };
      mockBridge.flashcards.saveFlashcardImage.mockImplementationOnce(
        async (ownerId: string) => `flashcard-image://${ownerId}.jpg`,
      );

      await ctx.captureSuggestedFlashcard({
        word: '単語', level: 3, imageUrl: 'data:image/jpeg;base64,CROP',
      });

      expect(mockBridge.flashcards.saveFlashcardImage).toHaveBeenCalledTimes(1);
      const suggestion = Object.values(ctx.store.suggestedFlashcards)[0];
      expect(suggestion.imageUrl).toBe(`flashcard-image://${suggestion.id}.jpg`);
      dispose();
    });

    it('reuses the existing suggestion id rather than creating a second file', async () => {
      const { ctx, dispose } = await mountProvider();
      flashcardsCb(makeEmptyStore());
      mockSettings.learningLanguageLevel = null;
      mockSettings.learningLanguageLevels = { ja: null };
      mockBridge.flashcards.saveFlashcardImage.mockImplementation(
        async (ownerId: string) => `flashcard-image://${ownerId}.jpg`,
      );

      await ctx.captureSuggestedFlashcard({ word: '単語', level: 3, imageUrl: 'data:image/jpeg;base64,A' });
      const firstId = Object.values(ctx.store.suggestedFlashcards)[0].id;
      await ctx.captureSuggestedFlashcard({ word: '単語', level: 3, imageUrl: 'data:image/jpeg;base64,B' });

      expect(mockBridge.flashcards.saveFlashcardImage.mock.calls.map(c => c[0])).toEqual([firstId, firstId]);
      dispose();
    });

    it('records the suggestion without media when the store refuses the image', async () => {
      const { ctx, dispose } = await mountProvider();
      flashcardsCb(makeEmptyStore());
      mockSettings.learningLanguageLevel = null;
      mockSettings.learningLanguageLevels = { ja: null };
      mockBridge.flashcards.saveFlashcardImage.mockRejectedValue(new Error('disk full'));

      await ctx.captureSuggestedFlashcard({
        word: '単語', level: 3, imageUrl: 'data:image/jpeg;base64,CROP',
      });

      const suggestion = Object.values(ctx.store.suggestedFlashcards)[0];
      expect(suggestion.word).toBe('単語');
      expect(suggestion.imageUrl).toBeUndefined();
      dispose();
    });

    it('keeps a suggestion text-only when no target geometry was available', async () => {
      const { ctx, dispose } = await mountProvider();
      flashcardsCb(makeEmptyStore());
      mockSettings.learningLanguageLevel = null;
      mockSettings.learningLanguageLevels = { ja: null };

      await ctx.captureSuggestedFlashcard({ word: '単語', level: 3, imageUrl: undefined });

      const suggestion = Object.values(ctx.store.suggestedFlashcards)[0];
      expect(suggestion.word).toBe('単語');
      expect(suggestion.imageUrl).toBeUndefined();
      expect(mockBridge.flashcards.saveFlashcardImage).not.toHaveBeenCalled();
      dispose();
    });

    it('two words on one page each adopt their own capture', async () => {
      const { ctx, dispose } = await mountProvider();
      flashcardsCb(makeEmptyStore());
      mockSettings.learningLanguageLevel = null;
      mockSettings.learningLanguageLevels = { ja: null };
      mockBridge.flashcards.saveFlashcardImage.mockImplementation(
        async (ownerId: string) => `flashcard-image://${ownerId}.jpg`,
      );

      await ctx.captureSuggestedFlashcard({ word: '猫', level: 3, imageUrl: 'data:image/jpeg;base64,OCC1' });
      await ctx.captureSuggestedFlashcard({ word: '犬', level: 3, imageUrl: 'data:image/jpeg;base64,OCC2' });

      const suggestions = Object.values(ctx.store.suggestedFlashcards);
      expect(suggestions).toHaveLength(2);
      expect(suggestions[0].id).not.toBe(suggestions[1].id);
      expect(suggestions[0].imageUrl).not.toBe(suggestions[1].imageUrl);
      dispose();
    });
  });

  // ─── Priority 2: Suggested flashcard level filtering ──────────────
  it('captureSuggestedFlashcard saves suggestion when no level is set', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    mockSettings.learningLanguageLevel = null;
    mockSettings.learningLanguageLevels = { ja: null };

    await ctx.captureSuggestedFlashcard({ word: '単語', level: 3 });

    expect(ctx.getSuggestedFlashcardsSync()).toHaveLength(1);
    expect(ctx.getSuggestedFlashcardsSync()[0].word).toBe('単語');
    dispose();
  });

  it('captureSuggestedFlashcard keeps dictionary-only suggestions using the configured dictionary target', async () => {
    const { warmTranslationCache } = await import('../hooks/useTranslation');
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    mockSettings.autoSuggestUnknownWords = false;
    mockSettings.dictionaryTargetLanguages = { ja: 'fr' };
    mockLanguageDataCatalog = [{ language: 'ja', dictionaryPacks: [{ targetLanguage: 'fr', installed: true }] }];
    mockSettings.learningLanguageLevels = { ja: null };
    mockBackend.translate.mockImplementation(async (_word: string, _language?: string, options?: { dictionaryTargetLanguage?: string }) => (
      options?.dictionaryTargetLanguage === 'fr'
        ? { data: [{ definitions: ['mot'] }] }
        : { data: [] }
    ));

    await warmTranslationCache(['単語'], undefined, undefined, 'ja', 'fr', mockLangData.ja);
    await ctx.captureSuggestedFlashcard({ word: '単語', level: 5 });

    expect(ctx.getSuggestedFlashcardsSync()).toHaveLength(1);
    expect(ctx.getSuggestedFlashcardsSync()[0].word).toBe('単語');
    dispose();
  });

  it('captureSuggestedFlashcard skips words above user level', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    mockSettings.learningLanguageLevels = { ja: 3 };

    await ctx.captureSuggestedFlashcard({ word: '難単語', level: 2 });

    expect(ctx.getSuggestedFlashcardsSync()).toHaveLength(0);
    dispose();
  });

  it('captureSuggestedFlashcard keeps a repeatedly-blocking off-list word through current-media recurrence (R21)', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    mockSettings.learningLanguageLevels = { ja: 3 };

    // The 粉飾 case: an intermediate exam target keeps meeting a domain term
    // that is on NO frequency list (`level: null`) — recorded passive
    // exposures in the CURRENT content admit the capture and survive the
    // promotion list.
    await ctx.captureSuggestedFlashcard({ word: '粉飾', level: null, mediaRecurrence: 4 });

    const suggestions = ctx.getSuggestedFlashcardsSync();
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].word).toBe('粉飾');
    expect(suggestions[0].mediaRecurrence).toBe(4);
    dispose();
  });

  it('captureSuggestedFlashcard still skips a one-off word above user level', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    mockSettings.learningLanguageLevels = { ja: 3 };

    // One encounter gains no exception: below MEDIA_MIN_ENCOUNTERS.
    await ctx.captureSuggestedFlashcard({ word: '難単語', level: 2, mediaRecurrence: 1 });

    expect(ctx.getSuggestedFlashcardsSync()).toHaveLength(0);
    dispose();
  });

  it('captureSuggestedFlashcard stores the best recorded recurrence on re-capture', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    mockSettings.learningLanguageLevels = { ja: 3 };

    await ctx.captureSuggestedFlashcard({ word: '粉飾', level: null, mediaRecurrence: 3 });
    await ctx.captureSuggestedFlashcard({ word: '粉飾', level: null, mediaRecurrence: 7 });

    const suggestions = ctx.getSuggestedFlashcardsSync();
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].mediaRecurrence).toBe(7);
    dispose();
  });

  it('captureSuggestedFlashcard saves words at or below user level', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    mockSettings.learningLanguageLevels = { ja: 3 };

    await ctx.captureSuggestedFlashcard({ word: '易単語1', level: 3 });
    await ctx.captureSuggestedFlashcard({ word: '易単語2', level: 5 });

    const suggestions = ctx.getSuggestedFlashcardsSync();
    expect(suggestions).toHaveLength(2);
    expect(suggestions.map(s => s.word)).toContain('易単語1');
    expect(suggestions.map(s => s.word)).toContain('易単語2');
    dispose();
  });

  it('captureSuggestedFlashcard validates explicit suggestion language with that language metadata', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    mockSettings.learningLanguageLevels = { ar: null };

    await ctx.captureSuggestedFlashcard({ word: 'hello', language: 'ar', level: 5 });

    expect(Object.values(ctx.store.suggestedFlashcards)).toHaveLength(0);
    dispose();
  });

  it('promoteSuggestedFlashcards preserves the suggestion language when active language differs', async () => {
    const { ctx, dispose } = await mountProvider();
    seedAccepted();
    mockSettings.language = 'ja';
    mockSettings.learningLanguageLevels = { ar: null };
    mockBackend.translate.mockResolvedValue({
      data: [
        { definitions: ['peace'], reading: 'salaam' },
      ],
    });

    await ctx.captureSuggestedFlashcard({ word: 'سلام', language: 'ar', level: 5 });
    const suggestion = Object.values(ctx.store.suggestedFlashcards)[0];
    expect(suggestion).toBeDefined();

    const promoted = await ctx.promoteSuggestedFlashcards([suggestion.id], { useLLM: false, useTts: false });

    expect(promoted).toBe(1);
    const card = ctx.getAllCards()[0];
    expect(card.language).toBe('ar');
    expect(card.content.front).toBe('سلام');
    expect(card.content.reading).toBe('salaam');
    expect(Object.keys(ctx.store.wordToCardMap)[0]).toMatch(/^ar:/);
    expect(Object.keys(ctx.store.wordToCardMap)[0]).not.toMatch(/^ja:/);
    dispose();
  });

  it('promoteSuggestedFlashcards preserves a captured suggestion reading over backend readings', async () => {
    const { ctx, dispose } = await mountProvider();
    seedAccepted();
    mockSettings.language = 'ja';
    mockSettings.learningLanguageLevels = { zh: null };
    mockBackend.translate.mockResolvedValue({
      data: [
        { definitions: ['hello'], reading: 'backend-reading' },
      ],
    });

    await ctx.captureSuggestedFlashcard({
      word: '你好',
      reading: 'ni hao',
      language: 'zh',
      level: 5,
    });
    const suggestion = Object.values(ctx.store.suggestedFlashcards)[0];
    expect(suggestion).toBeDefined();

    const promoted = await ctx.promoteSuggestedFlashcards([suggestion.id], { useLLM: false, useTts: false });

    expect(promoted).toBe(1);
    const card = ctx.getAllCards()[0];
    expect(card.language).toBe('zh');
    expect(card.content.reading).toBe('ni hao');
    expect(card.content.pronunciation).toBe('ni hao');
    dispose();
  });

  it('promoteSuggestedFlashcards derives missing levels from installed suggestion language frequency data', async () => {
    const { ctx, dispose } = await mountProvider();
    seedAccepted();
    mockSettings.language = 'ja';
    mockSettings.learningLanguageLevels = { de: null };
    mockBackend.translate.mockResolvedValue({
      data: [
        { definitions: ['house'], reading: 'Haus' },
      ],
    });
    mockGetFrequencyForLanguage.mockImplementation((language: string, word: string) => (
      language === 'de' && word === 'Haus'
        ? { raw_level: 1, level: 'A1', reading: 'Haus' }
        : null
    ));

    await ctx.captureSuggestedFlashcard({
      word: 'Haus',
      language: 'de',
      level: null,
    });
    const suggestion = Object.values(ctx.store.suggestedFlashcards)[0];
    expect(suggestion).toBeDefined();

    const promoted = await ctx.promoteSuggestedFlashcards([suggestion.id], { useLLM: false, useTts: false });

    expect(promoted).toBe(1);
    const card = ctx.getAllCards()[0];
    expect(card.language).toBe('de');
    expect(card.content.level).toBe(1);
    dispose();
  });

  it('captureSuggestedFlashcard skips words without level when user level is set', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    mockSettings.learningLanguageLevels = { ja: 3 };

    await ctx.captureSuggestedFlashcard({ word: '無レベル' });

    expect(ctx.getSuggestedFlashcardsSync()).toHaveLength(0);
    dispose();
  });

  it('getSuggestedFlashcardsSync filters existing suggestions by level', async () => {
    const { ctx, dispose } = await mountProvider();
    seed(makeEmptyStore({
      suggestedFlashcards: {
        'ja:hash1': { id: 's1', word: 'N1単語', level: 1, language: 'ja', createdAt: 1, lastSeen: 1, count: 1 },
        'ja:hash2': { id: 's2', word: 'N2単語', level: 2, language: 'ja', createdAt: 2, lastSeen: 2, count: 1 },
        'ja:hash3': { id: 's3', word: 'N3単語', level: 3, language: 'ja', createdAt: 3, lastSeen: 3, count: 1 },
        'ja:hash4': { id: 's4', word: '無レベル', level: null, language: 'ja', createdAt: 4, lastSeen: 4, count: 1 },
      },
    }));
    mockSettings.learningLanguageLevels = { ja: 3 };

    const suggestions = ctx.getSuggestedFlashcardsSync();
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].word).toBe('N3単語');
    dispose();
  });

  it('getSuggestedFlashcardsSync derives missing suggestion levels from installed language frequency data', async () => {
    const { ctx, dispose } = await mountProvider();
    seed(makeEmptyStore({
      suggestedFlashcards: {
        'ja:hash-derived': { id: 's-derived', word: '派生レベル', level: null, language: 'ja', createdAt: 1, lastSeen: 1, count: 1 },
        'ja:hash-missing': { id: 's-missing', word: '無レベル', level: null, language: 'ja', createdAt: 2, lastSeen: 2, count: 1 },
      },
    }));
    mockSettings.learningLanguageLevels = { ja: 3 };
    mockGetFrequencyForLanguage.mockImplementation((language: string, word: string) => (
      language === 'ja' && word === '派生レベル'
        ? { raw_level: 3, level: 'JLPT N3', reading: 'はせいレベル' }
        : null
    ));

    const suggestions = ctx.getSuggestedFlashcardsSync();

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].word).toBe('派生レベル');
    dispose();
  });

  it('getSuggestedFlashcardsSync returns all when no level is set', async () => {
    const { ctx, dispose } = await mountProvider();
    seed(makeEmptyStore({
      suggestedFlashcards: {
        'ja:hash1': { id: 's1', word: 'N1単語', level: 1, language: 'ja', createdAt: 1, lastSeen: 1, count: 1 },
        'ja:hash2': { id: 's2', word: 'N3単語', level: 3, language: 'ja', createdAt: 2, lastSeen: 2, count: 1 },
      },
    }));
    mockSettings.learningLanguageLevel = null;
    mockSettings.learningLanguageLevels = { ja: null };

    const suggestions = ctx.getSuggestedFlashcardsSync();
    expect(suggestions).toHaveLength(2);
    dispose();
  });

  // ─── Priority 2: Known-word filtering ─────────────────────────────
  it('captureSuggestedFlashcard skips words known through SRS review evidence', async () => {
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const hash = await SRS.hashWord('既知単語');
    const lk = `ja:${hash}`;
    seed(makeEmptyStore({
      flashcards: {
        'fc-1': {
          id: 'fc-1',
          content: { type: 'word', front: '既知単語', back: 'known' },
          state: 'review',
          ease: 2.5,
          interval: 86400000,
          dueDate: Date.now(),
          reviews: 5,
          lapses: 0,
          learningStep: 0,
          createdAt: Date.now(),
          lastReviewed: Date.now(),
          lastUpdated: Date.now(),
          language: 'ja',
        },
      },
      wordToCardMap: { [lk]: ['fc-1'] },
      // SRS reviews are ACTIVE evidence materialized in wordKnowledge — a bare
      // review card is not knowledge on its own under Tier-2 resolution.
      wordKnowledge: {
        [lk]: {
          ease: 4.5,
          lastSeen: Date.now(),
          timesSeen: 5,
          timesHovered: 0,
          word: '既知単語',
          language: 'ja',
          hasActiveEvidence: true,
          lastEvidenceSource: 'srs',
        },
      },
    }));

    await ctx.captureSuggestedFlashcard({ word: '既知単語', level: 5 });

    expect(ctx.getSuggestedFlashcardsSync()).toHaveLength(0);
    dispose();
  });

  it('captureSuggestedFlashcard keeps suggestions with passive-only familiarity (honesty rule)', async () => {
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const hash = SRS.hashWordSync('passive既知');
    const lk = `ja:${hash}`;
    seed(makeEmptyStore({
      wordKnowledge: {
        [lk]: {
          ease: 4.5,
          lastSeen: Date.now(),
          timesSeen: 100,
          timesHovered: 0,
          word: 'passive既知',
          language: 'ja',
        },
      },
    }));

    await ctx.captureSuggestedFlashcard({ word: 'passive既知', level: 5 });

    // Passive-only exposure never establishes Known — the suggestion is captured.
    const suggestions = ctx.getSuggestedFlashcardsSync();
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].word).toBe('passive既知');
    dispose();
  });

  it('captureSuggestedFlashcard does not infer knowledge from an unmigrated orphan marker', async () => {
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const hash = await SRS.hashWord('手動既知');
    const lk = `ja:${hash}`;
    seed(makeEmptyStore({
      knownUntracked: { [lk]: true },
    }));

    await ctx.captureSuggestedFlashcard({ word: '手動既知', level: 5 });

    expect(ctx.getComprehensiveWordStatusWithSourceSync('手動既知').basis).toBe('unmeasured');
    expect(ctx.getSuggestedFlashcardsSync()).toHaveLength(1);
    dispose();
  });

  it('captureSuggestedFlashcard deduplicates language-provided word variants', async () => {
    mockGetWordVariants.mockImplementation((word: string) => word === 'иду' ? ['идти', 'иду'] : []);
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    await ctx.captureSuggestedFlashcard({ word: 'идти', level: 5, contextPhrase: 'lemma' });
    await ctx.captureSuggestedFlashcard({ word: 'иду', level: 5, contextPhrase: 'inflected' });

    const suggestions = ctx.getSuggestedFlashcardsSync();
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].word).toBe('идти');
    expect(suggestions[0].count).toBe(2);
    expect(suggestions[0].contextPhrase).toBe('lemma');
    dispose();
  });

  it('captureSuggestedFlashcard deduplicates explicit non-active language variants', async () => {
    mockSettings.language = 'ja';
    mockSettings.learningLanguageLevels = { ar: null };
    mockGetCanonicalFormForLanguage.mockImplementation((language: string, word: string) => (
      language === 'ar' && word === 'يكتب' ? 'كتب' : word
    ));
    mockGetWordVariantsForLanguage.mockImplementation((language: string, word: string) => (
      language === 'ar' && word === 'يكتب' ? ['كتب', 'يكتب'] : [word]
    ));
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    await ctx.captureSuggestedFlashcard({ word: 'كتب', language: 'ar', level: 5, contextPhrase: 'lemma' });
    await ctx.captureSuggestedFlashcard({ word: 'يكتب', language: 'ar', level: 5, contextPhrase: 'inflected' });

    const suggestions = Object.values(ctx.store.suggestedFlashcards);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].word).toBe('كتب');
    expect(suggestions[0].language).toBe('ar');
    expect(suggestions[0].count).toBe(2);
    expect(Object.keys(ctx.store.suggestedFlashcards)[0]).toBe(`ar:${SRS.hashWordSync('كتب')}`);
    dispose();
  });

  it('captureSuggestedFlashcard stores explicit non-active inflections under that language primary form', async () => {
    mockSettings.language = 'ja';
    mockSettings.learningLanguageLevels = { ar: null };
    mockGetCanonicalFormForLanguage.mockImplementation((language: string, word: string) => (
      language === 'ar' && word === 'يكتب' ? 'كتب' : word
    ));
    mockGetWordVariantsForLanguage.mockImplementation((language: string, word: string) => (
      language === 'ar' && word === 'يكتب' ? ['كتب', 'يكتب'] : [word]
    ));
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    await ctx.captureSuggestedFlashcard({ word: 'يكتب', language: 'ar', level: 5, contextPhrase: 'inflected first' });

    const key = Object.keys(ctx.store.suggestedFlashcards)[0];
    const suggestion = Object.values(ctx.store.suggestedFlashcards)[0];
    expect(key).toBe(`ar:${SRS.hashWordSync('كتب')}`);
    expect(suggestion.word).toBe('كتب');
    expect(suggestion.language).toBe('ar');
    dispose();
  });

  it('getSuggestedFlashcardsSync filters out suggestions for now-known words', async () => {
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const hash = SRS.hashWordSync('後付既知');
    const lk = `ja:${hash}`;
    seed(makeEmptyStore({
      suggestedFlashcards: {
        [lk]: { id: 's-known', word: '後付既知', level: 5, language: 'ja', createdAt: 1, lastSeen: 1, count: 1 },
        'ja:hash2': { id: 's-ok', word: '未知単語', level: 5, language: 'ja', createdAt: 2, lastSeen: 2, count: 1 },
      },
      wordKnowledge: {
        [lk]: {
          ease: 4.5,
          lastSeen: Date.now(),
          timesSeen: 100,
          timesHovered: 0,
          word: '後付既知',
          language: 'ja',
          // Evidence-based Known requires active evidence; this word was rated.
          hasActiveEvidence: true,
        },
      },
    }));
    flashcardsCb(committed);

    const suggestions = ctx.getSuggestedFlashcardsSync();
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].word).toBe('未知単語');
    dispose();
  });

  // ─── Priority 2: Batched suggested flashcard removal ──────────────
  it('removeSuggestedFlashcards deletes multiple suggestions in one batch', async () => {
    const { ctx, dispose } = await mountProvider();
    seed(makeEmptyStore({
      suggestedFlashcards: {
        'ja:hash1': { id: 's1', word: '単語1', level: 5, language: 'ja', createdAt: 1, lastSeen: 1, count: 1 },
        'ja:hash2': { id: 's2', word: '単語2', level: 4, language: 'ja', createdAt: 2, lastSeen: 2, count: 1 },
        'ja:hash3': { id: 's3', word: '単語3', level: 3, language: 'ja', createdAt: 3, lastSeen: 3, count: 1 },
      },
    }));

    ctx.removeSuggestedFlashcards(['s1', 's3']);

    const remaining = ctx.getSuggestedFlashcardsSync();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].word).toBe('単語2');
    dispose();
  });

  it('removeSuggestedFlashcards is no-op for empty array', async () => {
    const { ctx, dispose } = await mountProvider();
    seed(makeEmptyStore({
      suggestedFlashcards: {
        'ja:hash1': { id: 's1', word: '単語1', level: 5, language: 'ja', createdAt: 1, lastSeen: 1, count: 1 },
      },
    }));

    ctx.removeSuggestedFlashcards([]);

    expect(ctx.getSuggestedFlashcardsSync()).toHaveLength(1);
    dispose();
  });

  it('cleanupKnownSuggestions removes suggestions for knownUntracked words (fast path)', async () => {
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const hash = SRS.hashWordSync('手動既知');
    const lk = `ja:${hash}`;
    seed(makeEmptyStore({
      suggestedFlashcards: {
        [lk]: { id: 's-known', word: '手動既知', level: 5, language: 'ja', createdAt: 1, lastSeen: 1, count: 1 },
        'ja:hash2': { id: 's-ok', word: '未知単語', level: 5, language: 'ja', createdAt: 2, lastSeen: 2, count: 1 },
      },
      knownUntracked: { [lk]: true },
    }));

    const removed = await ctx.cleanupKnownSuggestions();
    expect(removed).toBe(1);
    expect(ctx.getSuggestedFlashcardsSync()).toHaveLength(1);
    expect(ctx.getSuggestedFlashcardsSync()[0].word).toBe('未知単語');
    dispose();
  });

  it('cleanupKnownSuggestions removes known suggestions for non-active languages', async () => {
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    mockSettings.language = 'ja';
    const germanHash = SRS.hashWordSync('Haus');
    const germanKey = `de:${germanHash}`;
    seed(makeEmptyStore({
      suggestedFlashcards: {
        [germanKey]: { id: 's-de-known', word: 'Haus', level: 1, language: 'de', createdAt: 1, lastSeen: 1, count: 1 },
        'ja:hash-ok': { id: 's-ja-ok', word: '未知単語', level: 5, language: 'ja', createdAt: 2, lastSeen: 2, count: 1 },
      },
      knownUntracked: { [germanKey]: true },
    }));

    const removed = await ctx.cleanupKnownSuggestions();

    expect(removed).toBe(1);
    expect(ctx.getSuggestedFlashcardsSync()).toHaveLength(1);
    expect(ctx.getSuggestedFlashcardsSync()[0].word).toBe('未知単語');
    dispose();
  });

  it('cleanupKnownSuggestions removes suggestions with SRS review cards (fast path)', async () => {
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const hash = SRS.hashWordSync('既知単語');
    const lk = `ja:${hash}`;
    seed(makeEmptyStore({
      suggestedFlashcards: {
        [lk]: { id: 's-known', word: '既知単語', level: 5, language: 'ja', createdAt: 1, lastSeen: 1, count: 1 },
        'ja:hash2': { id: 's-ok', word: '未知単語', level: 5, language: 'ja', createdAt: 2, lastSeen: 2, count: 1 },
      },
      flashcards: {
        'fc-1': {
          id: 'fc-1',
          content: { type: 'word', front: '既知単語', back: 'known' },
          state: 'review',
          ease: 2.5,
          interval: 86400000,
          dueDate: Date.now(),
          reviews: 5,
          lapses: 0,
          learningStep: 0,
          createdAt: Date.now(),
          lastReviewed: Date.now(),
          lastUpdated: Date.now(),
          language: 'ja',
        },
      },
      wordToCardMap: { [lk]: ['fc-1'] },
    }));

    const removed = await ctx.cleanupKnownSuggestions();
    expect(removed).toBe(1);
    expect(ctx.getSuggestedFlashcardsSync()).toHaveLength(1);
    expect(ctx.getSuggestedFlashcardsSync()[0].word).toBe('未知単語');
    dispose();
  });

  it('cleanupKnownSuggestions keeps suggestions for unknown words', async () => {
    const { ctx, dispose } = await mountProvider();
    seed(makeEmptyStore({
      suggestedFlashcards: {
        'ja:hash1': { id: 's1', word: '未知単語', level: 5, language: 'ja', createdAt: 1, lastSeen: 1, count: 1 },
      },
    }));

    const removed = await ctx.cleanupKnownSuggestions();
    expect(removed).toBe(0);
    expect(ctx.getSuggestedFlashcardsSync()).toHaveLength(1);
    dispose();
  });

  it('cleanupKnownSuggestions preserves suggestions with only incidental passive known ease', async () => {
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const hash = SRS.hashWordSync('見ただけ');
    const lk = `ja:${hash}`;
    seed(makeEmptyStore({
      suggestedFlashcards: {
        [lk]: { id: 's-passive', word: '見ただけ', level: 5, language: 'ja', createdAt: 1, lastSeen: 1, count: 1 },
      },
      wordKnowledge: {
        [lk]: {
          ease: mockSettings.known_ease_threshold / 1000,
          lastSeen: 1,
          timesSeen: 12,
          timesHovered: 0,
          word: '見ただけ',
          language: 'ja',
        },
      },
    }));

    const removed = await ctx.cleanupKnownSuggestions();

    expect(removed).toBe(0);
    expect(Object.values(ctx.store.suggestedFlashcards)).toHaveLength(1);
    expect(ctx.store.suggestedFlashcards[lk]?.word).toBe('見ただけ');
    dispose();
  });

  it('cleanupKnownSuggestions removes suggestions with explicitly rated passive known status', async () => {
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const hash = SRS.hashWordSync('評価済み');
    const lk = `ja:${hash}`;
    seed(makeEmptyStore({
      suggestedFlashcards: {
        [lk]: { id: 's-rated', word: '評価済み', level: 5, language: 'ja', createdAt: 1, lastSeen: 1, count: 1 },
      },
      wordKnowledge: {
        [lk]: {
          ease: mockSettings.known_ease_threshold / 1000,
          lastSeen: 1,
          timesSeen: 12,
          timesHovered: 0,
          word: '評価済み',
          language: 'ja',
          lastStatusChange: 2,
          // Explicitly rated = active evidence (isExplicitPassiveKnown gate).
          hasActiveEvidence: true,
        },
      },
    }));

    const removed = await ctx.cleanupKnownSuggestions();

    expect(removed).toBe(1);
    expect(Object.values(ctx.store.suggestedFlashcards)).toHaveLength(0);
    dispose();
  });

  it('getSuggestedFlashcardsSync keeps stored suggestions visible while dictionary eligibility is unresolved', async () => {
    mockSettings.autoSuggestUnknownWords = false;
    mockBackend.translate.mockResolvedValue({ data: [] });
    const { ctx, dispose } = await mountProvider();
    seed(makeEmptyStore({
      suggestedFlashcards: {
        'ja:hash-nuu': { id: 's-nuu', word: 'ヌウ', level: null, language: 'ja', createdAt: 1, lastSeen: 1, count: 1 },
      },
    }));

    const removed = await ctx.cleanupKnownSuggestions();

    expect(removed).toBe(0);
    expect(mockBackend.translate).not.toHaveBeenCalled();
    expect(ctx.getSuggestedFlashcardsSync()).toHaveLength(1);
    expect(Object.values(ctx.store.suggestedFlashcards)).toHaveLength(1);
    expect(ctx.store.suggestedFlashcards['ja:hash-nuu']?.word).toBe('ヌウ');
    dispose();
  });

  it('getSuggestedFlashcardsSync keeps stored suggestions visible when capture is disabled', async () => {
    mockSettings.autoSuggestFlashcards = false;
    const { ctx, dispose } = await mountProvider();
    seed(makeEmptyStore({
      suggestedFlashcards: {
        'ja:hash-preserved': { id: 's-preserved', word: '保存', level: null, language: 'ja', createdAt: 1, lastSeen: 1, count: 1 },
      },
    }));

    const removed = await ctx.cleanupKnownSuggestions();

    expect(removed).toBe(0);
    expect(ctx.getSuggestedFlashcardsSync()).toHaveLength(1);
    expect(Object.values(ctx.store.suggestedFlashcards)).toHaveLength(1);
    expect(ctx.store.suggestedFlashcards['ja:hash-preserved']?.word).toBe('保存');
    dispose();
  });

  it('garbageCollectSuggestedFlashcards removes entries made ineligible by current settings', async () => {
    mockSettings.learningLanguageLevels = { ja: 3 };
    const { ctx, dispose } = await mountProvider();
    seed(makeEmptyStore({
      suggestedFlashcards: {
        'ja:eligible': { id: 's-eligible', word: '適切', level: 3, language: 'ja', createdAt: 1, lastSeen: 1, count: 1 },
        'ja:too-hard': { id: 's-too-hard', word: '困難', level: 1, language: 'ja', createdAt: 2, lastSeen: 2, count: 1 },
      },
    }));

    const removed = await ctx.garbageCollectSuggestedFlashcards();

    expect(removed).toBe(1);
    expect(Object.values(ctx.store.suggestedFlashcards).map((suggestion) => suggestion.id)).toEqual(['s-eligible']);
    dispose();
  });

  it('cleanupKnownSuggestions preserves dictionary suggestions when unknown words are disabled', async () => {
    mockSettings.autoSuggestUnknownWords = false;
    mockBackend.translate.mockResolvedValue({
      data: [{ reading: 'たんご', definitions: 'word; vocabulary' }, { reading: 'たんご', definitions: '<ul data-content="glossary"><li>word</li></ul>' }, {}],
    });
    const { ctx, dispose } = await mountProvider();
    seed(makeEmptyStore({
      suggestedFlashcards: {
        'ja:hash-dict': { id: 's-dict', word: '単語', level: null, language: 'ja', createdAt: 1, lastSeen: 1, count: 1 },
      },
    }));

    const removed = await ctx.cleanupKnownSuggestions();

    expect(removed).toBe(0);
    expect(mockBackend.translate).not.toHaveBeenCalled();
    expect(Object.values(ctx.store.suggestedFlashcards)).toHaveLength(1);
    expect(ctx.store.suggestedFlashcards['ja:hash-dict']?.word).toBe('単語');
    dispose();
  });

  it('removeSuggestedFlashcards does not delete shared images when only one owner is removed', async () => {
    const { ctx, dispose } = await mountProvider();
    seed(makeEmptyStore({
      suggestedFlashcards: {
        'ja:hash1': { id: 's1', word: '単語1', level: 5, language: 'ja', createdAt: 1, lastSeen: 1, count: 1, imageUrl: 'flashcard-image://shared.png' },
        'ja:hash2': { id: 's2', word: '単語2', level: 5, language: 'ja', createdAt: 2, lastSeen: 2, count: 1, imageUrl: 'flashcard-image://shared.png' },
      },
    }));

    ctx.removeSuggestedFlashcards(['s1']);

    expect(ctx.getSuggestedFlashcardsSync()).toHaveLength(1);
    expect(mockBridge.flashcards.deleteFlashcardImage).not.toHaveBeenCalled();
    dispose();
  });

  it('removeSuggestedFlashcards deletes orphaned images when all owners are removed', async () => {
    const { ctx, dispose } = await mountProvider();
    seed(makeEmptyStore({
      suggestedFlashcards: {
        'ja:hash1': { id: 's1', word: '単語1', level: 5, language: 'ja', createdAt: 1, lastSeen: 1, count: 1, imageUrl: 'flashcard-image://shared.png' },
        'ja:hash2': { id: 's2', word: '単語2', level: 5, language: 'ja', createdAt: 2, lastSeen: 2, count: 1, imageUrl: 'flashcard-image://shared.png' },
      },
    }));

    ctx.removeSuggestedFlashcards(['s1', 's2']);

    expect(ctx.getSuggestedFlashcardsSync()).toHaveLength(0);
    expect(mockBridge.flashcards.deleteFlashcardImage).toHaveBeenCalledOnce();
    expect(mockBridge.flashcards.deleteFlashcardImage).toHaveBeenCalledWith('shared');
    dispose();
  });

  // ─── addLevelStudyFlashcards bulk per-femory benchmark (perf guard) ──────
  // Sandboxed: getBridge()/getBackend() are mocked, so saveFlashcards is a no-op
  // and this test can never read or write the user's real flashcard files.
  describe('addLevelStudyFlashcards scaling', () => {
    it('curriculum adds claim nothing; explicit bulk status selection claims', async () => {
      const { ctx, dispose } = await mountProvider();
      flashcardsCb(makeEmptyStore());
      const SRS = await import('../services/srsAlgorithm');

      // Curriculum add ('new'): scheduler seeds only — zero epistemic writes.
      mockAppendEvents.mockClear();
      await ctx.addLevelStudyFlashcards(['カリキュラム'], 'new', 'ja');
      expect(mockAppendEvents).not.toHaveBeenCalled();
      const curriculumLk = `ja:${SRS.hashWordSync('カリキュラム')}`;
      expect(ctx.store.wordKnowledge[curriculumLk]?.claim).toBeUndefined();

      // Explicit bulk status choice ('known'): claims on every created word.
      mockAppendEvents.mockClear();
      await ctx.addLevelStudyFlashcards(['明示既知'], 'known', 'ja');
      const claimLk = `ja:${SRS.hashWordSync('明示既知')}`;
      expect(ctx.store.wordKnowledge[claimLk]?.claim).toBe('known');
      const claimEvents = mockAppendEvents.mock.calls
        .flatMap(([byKey]) => Object.values(byKey as Record<string, Array<{ kind: string }>>))
        .flat();
      expect(claimEvents.some((e) => e.kind === 'claim')).toBe(true);
      dispose();
    });

    it('creates a large batch in one saveFlashcards call and reports wall time', async () => {
      const N = 2000;
      const { ctx, dispose } = await mountProvider();

      // Deferred saves from this window's own hydration — and from other
      // tests' un-awaited migration continuations — are debounced at 300ms and
      // would otherwise land inside the measurement window. Let them settle
      // before opening it, so the one-save assertion below counts only the
      // bulk add's own write.
      await new Promise((r) => setTimeout(r, 550));
      seed(makeEmptyStore());
      mockBridge.flashcards.saveFlashcards.mockClear();
      mockBackend.translate.mockClear();

      const words = Array.from({ length: N }, (_, i) => `bench-テスト-${i}`);
      const t0 = performance.now();
      const result = await ctx.addLevelStudyFlashcards(words, 'new', 'ja');
      const wallMs = performance.now() - t0;

      expect(result.created).toBe(N);
      expect(result.skipped).toBe(0);
      await vi.waitFor(() => {
        expect(mockBridge.flashcards.saveFlashcards).toHaveBeenCalledOnce();
      });
      expect(mockBackend.translate).not.toHaveBeenCalled();
      expect(Object.keys(ctx.store.flashcards)).toHaveLength(N);

      // eslint-disable-next-line no-console
      console.log(`[bench] addLevelStudyFlashcards(${N} shells) = ${wallMs.toFixed(1)}ms`);
      dispose();
    });

    it('batches one save even when words are reused (all skipped)', async () => {
      const N = 2000;
      const { ctx, dispose } = await mountProvider();
      const words = Array.from({ length: N }, (_, i) => `bench-テスト-${i}`);
      await ctx.addLevelStudyFlashcards(words, 'new', 'ja');

      mockBridge.flashcards.saveFlashcards.mockClear();
      const t1 = performance.now();
      const second = await ctx.addLevelStudyFlashcards(words, 'new', 'ja');
      const wallMs = performance.now() - t1;

      expect(second.created).toBe(0);
      expect(second.skipped).toBe(N);
      await vi.waitFor(() => {
        expect(mockBridge.flashcards.saveFlashcards).toHaveBeenCalledOnce();
      });
      // eslint-disable-next-line no-console
      console.log(`[bench] re-add skips ${N} = ${wallMs.toFixed(1)}ms`);
      dispose();
    });

    it('promotes pending suggestions in a single batched path', async () => {
      const { ctx, dispose } = await mountProvider();
      flashcardsCb(makeEmptyStore());
      const words = ['キャプチャテスト'];
      await ctx.captureSuggestedFlashcard({ word: 'キャプチャテスト', language: 'ja' });

      mockBridge.flashcards.saveFlashcards.mockClear();
      mockBackend.translate.mockClear();
      const result = await ctx.addLevelStudyFlashcards(words, 'new', 'ja');

      // A pending suggestion must route through the promote path, never a fresh shell.
      expect(result.created).toBe(0);
      expect(mockBackend.translate).toHaveBeenCalledWith('キャプチャテスト', 'ja', expect.anything());
      // eslint-disable-next-line no-console
      console.log(
        `[bench] promote suggestion -> created=${result.created} promoted=${result.promoted} skipped=${result.skipped}`,
      );
      dispose();
    });

    it('skips already-tracked words when preserveExistingStatus is set', async () => {
      const { ctx, dispose } = await mountProvider();
      const lk = `ja:${SRS.hashWordSync('テスト')}`;
      seed(makeEmptyStore({
        wordKnowledge: {
          [lk]: {
            // A Tier-2 known claim (no knownUntracked — that bank is legacy residue).
            claim: 'known',
            claimAt: 1,
            ease: SRS.MIN_EASE,
            lastSeen: 1,
            timesSeen: 0,
            timesHovered: 0,
            word: 'テスト',
            language: 'ja',
          },
        },
      }));
      mockBridge.flashcards.saveFlashcards.mockClear();
      mockBackend.translate.mockClear();

      // Known-untracked entries resolve to 'known' via the comprehensive status resolver,
      // so the preserve mode must skip the word instead of overwriting its status.
      const preserved = await ctx.addLevelStudyFlashcards(['テスト'], 'new', 'ja', {
        preserveExistingStatus: true,
      });
      expect(preserved.created).toBe(0);
      expect(preserved.skipped).toBe(1);
      expect(Object.keys(ctx.store.flashcards)).toHaveLength(0);

      // Without the option the same word is re-stamped as a fresh shell (the data-loss path).
      const overwritten = await ctx.addLevelStudyFlashcards(['テスト'], 'new', 'ja');
      expect(overwritten.created).toBe(1);
      expect(overwritten.skipped).toBe(0);
      dispose();
    });

    it('skips a word with an existing card before promoting its pending suggestion', async () => {
      const { ctx, dispose } = await mountProvider();
      const lk = `ja:${SRS.hashWordSync('キャプチャテスト')}`;
      flashcardsCb(
        makeEmptyStore({
          flashcards: { 'card-existing': makeCard({ id: 'card-existing' }) },
          wordToCardMap: { [lk]: ['card-existing'] },
        }),
      );
      await ctx.captureSuggestedFlashcard({ word: 'キャプチャテスト', language: 'ja' });

      mockBackend.translate.mockClear();
      const result = await ctx.addLevelStudyFlashcards(['キャプチャテスト'], 'new', 'ja', {
        preserveExistingStatus: true,
      });

      // The existing-card check runs before the suggestion check, so a real card is
      // never clobbered by a stale pending suggestion's promote re-stamp.
      expect(result.created).toBe(0);
      expect(result.promoted).toBe(0);
      expect(result.skipped).toBe(1);
      expect(mockBackend.translate).not.toHaveBeenCalled();
      dispose();
    });
  });

  it('resolves only changed word families when a rating updates a large knowledge map', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'indexed-rating', content: { type: 'word', front: '学校', back: 'school' } });
    const wordKnowledge: FlashcardStore['wordKnowledge'] = {};
    for (let i = 0; i < 1000; i++) {
      const word = `word-${i}`;
      wordKnowledge[`ja:${SRS.hashWordSync(word)}`] = {
        word, language: 'ja', ease: 2.5, lastSeen: 1, timesSeen: 1, timesHovered: 0, hasActiveEvidence: true,
      };
    }
    flashcardsCb(makeEmptyStore({ flashcards: { [card.id]: card }, wordKnowledge }));
    await vi.waitFor(() => expect(ctx.isKnowledgeReady()).toBe(true));
    mockGetCanonicalForm.mockClear();
    await ctx.submitRating(card.content.front, [{ capability: 'sense-recognition', quality: 'struggled' }], {
      scheduler: { cardId: card.id, rating: 'again', tested: ['sense-recognition'] },
    });
    expect(mockGetCanonicalForm.mock.calls.length).toBeLessThan(50);
    expect(ctx.store.wordKnowledge[`ja:${SRS.hashWordSync(card.content.front)}`].hasActiveEvidence).toBe(true);
    dispose();
  });

  it('does not deep-copy the whole store during a rating', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({
      id: 'perf-card', language: 'ja',
      content: { type: 'word', front: '学校', back: 'school' },
      state: 'review', reviews: 1, interval: 86_400_000, dueDate: Date.now() - 1000,
    });
    flashcardsCb(makeEmptyStore({ flashcards: { [card.id]: card } }));

    // Count whole-store deep copies during one rating. The regression this
    // guards: submitRating built a base+candidate pair and then handed a
    // TRANSFORM to saveFlashcardsImmediate, which deep-copied the entire store
    // twice more, plus a third copy for the authoritative snapshot. Cost scaled
    // with total card count, not with the one card being rated.
    const realClone = JSON.parse;
    let storeCopies = 0;
    const spy = vi.spyOn(JSON, 'parse').mockImplementation((text: string, reviver?: any) => {
      if (typeof text === 'string' && text.includes('"flashcards"') && text.includes('"wordToCardMap"')) storeCopies++;
      return (realClone as any)(text, reviver);
    });
    try {
      await ctx.submitRating('学校', [{ capability: 'sense-recognition', quality: 'struggled' }], {
        language: 'ja', scheduler: { cardId: card.id, rating: 'again', tested: ['sense-recognition'] },
      });
    } finally {
      spy.mockRestore();
    }

    expect(storeCopies).toBe(0);
    // The rating still took effect.
    expect(ctx.store.flashcards[card.id].state).toBe('relearning');
    dispose();
  });

  it('persists a rating as a declared patch instead of shipping the whole store', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({
      id: 'patch-card', language: 'ja',
      content: { type: 'word', front: '学校', back: 'school' },
      state: 'review', reviews: 1, interval: 86_400_000, dueDate: Date.now() - 1000,
    });
    flashcardsCb(makeEmptyStore({ flashcards: { [card.id]: card } }));
    mockBridge.flashcards.saveFlashcardPatch.mockClear();
    mockBridge.flashcards.saveFlashcards.mockClear();

    await ctx.submitRating('学校', [{ capability: 'sense-recognition', quality: 'struggled' }], {
      language: 'ja', scheduler: { cardId: card.id, rating: 'again', tested: ['sense-recognition'] },
    });

    // The whole-collection post-image must not cross the IPC boundary; only the
    // entries the command actually wrote. (The mock applies the patch and then
    // records a saveFlashcards call, so only the patch call is asserted here.)
    const patch = mockBridge.flashcards.saveFlashcardPatch.mock.calls.at(-1)?.[0] as StorePatch;
    expect(patch).toBeDefined();
    const roots = patch.entries.map((entry) => entry.path[0]);
    expect(roots).toContain('flashcards');
    // Unrelated maps are untouched, so they are neither sent nor rewritten.
    expect(roots).not.toContain('wordToCardMap');
    expect(roots).not.toContain('wordCandidates');
    // The rating itself still took effect.
    expect(ctx.store.flashcards[card.id].state).toBe('relearning');
    dispose();
  });
});

describe('acknowledged rating command semantics', () => {
  beforeEach(resetProviderTestHarness);
  afterEach(async () => {
    await new Promise(resolve => setTimeout(resolve, SAVE_DEBOUNCE_MS_FOR_TESTS));
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  it('acknowledges a profile batch before changing local knowledge and retries the same attempt', async () => {
    const SRS = await import('../services/srsAlgorithm');
    const key = `ja2:${await SRS.hashWord('学校')}`;
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    mockAppendEvents.mockClear();
    mockAppendEvents.mockRejectedValueOnce(new Error('journal unavailable'));
    const observations = [
      { capability: 'sense-recognition', quality: 'fluent' },
      { capability: 'surface-reading', quality: 'missed' },
    ] as const;

    await expect(ctx.submitRating('学校', observations, {
      language: 'ja2', attemptId: 'word-sync-retry-1', origin: 'word-sync',
    })).rejects.toThrow('journal unavailable');
    expect(ctx.store.wordKnowledge[key]).toBeUndefined();

    await expect(ctx.submitRating('学校', observations, {
      language: 'ja2', attemptId: 'word-sync-retry-1', origin: 'word-sync',
    })).resolves.toEqual({ attemptId: 'word-sync-retry-1', completed: true });
    expect(mockAppendEvents).toHaveBeenCalledTimes(2);
    const accepted = mockAppendEvents.mock.calls[1][0] as Record<string, KnowledgeEvent[]>;
    expect(accepted[key]).toHaveLength(2);
    expect(accepted[key].map((event) => event.targetRef?.capability)).toEqual(['sense-recognition', 'surface-reading']);
    expect(accepted[key].every((event) => event.attemptId === 'word-sync-retry-1')).toBe(true);
    expect(ctx.store.wordKnowledge[key]?.access?.['surface-reading']?.status).toBe('unknown');
    dispose();
  });

  it('struggled sense-recognition MAY demote known: learning-region target', async () => {
    mockSettings.language = 'ja2';
    const SRS = await import('../services/srsAlgorithm');
    const lk = `ja2:${await SRS.hashWord('学校')}`;
    const { ctx, dispose } = await mountProvider();
    seed(makeEmptyStore({
      wordKnowledge: {
        [lk]: { ease: 2.5, lastSeen: 1, timesSeen: 3, timesHovered: 0, word: '学校', language: 'ja2', lastStatusChange: 5 },
      },
    }));

    await submitObservation(ctx, '学校', 'sense-recognition', 'struggled', { language: 'ja2' });

    expect(ctx.store.wordKnowledge[lk]?.ease).toBeCloseTo(mockSettings.easeThresholdLearning, 5);
    dispose();
    mockSettings.language = 'ja';
  });

  describe.each(['de', 'ja', 'zh'] as const)('grammar practice route (%s package → provider → journal → rendered progress)', (language) => {
    // Passes serialize their durable mutations with the Web Locks API;
    // happy-dom reports navigator.locks as null, which DISABLES the pass
    // surfaces (G04). These integration tests drive the serialized evidence
    // loop (the LevelStudyTab.test convention), so inject a pass-through
    // lock; removed in afterEach.
    beforeEach(() => {
      Object.defineProperty(globalThis.navigator, 'locks', {
        value: { request: (_name: string, callback: () => void) => { callback(); return Promise.resolve(); } },
        configurable: true,
      });
    });
    afterEach(() => {
      const lockStubHost = globalThis.navigator as { locks?: unknown };
      delete lockStubHost.locks;
    });
    // Real packaging-source packages (installed/remote catalogs refresh via
    // the campaign-blocked publish step — source-of-truth content here).
    const languagePackage = JSON.parse(fs.readFileSync(
      path.join(process.cwd(), 'scripts/language-data/source/root-of-app/languages', `${language}.json`),
      'utf8',
    )) as LanguageData;
    const routePoint = (languagePackage.grammar ?? []).find((candidate) => typeof candidate.level === 'number');

    it('package UI pass → provider writer → canonical journal → rendered progress', async () => {
      expect(routePoint).toBeDefined();

      mockSettings.language = language;
      const { ctx, dispose: disposeProvider } = await mountProvider();
      flashcardsCb(makeEmptyStore());
      mockAppendEvents.mockClear();

      const container = document.createElement('div');
      document.body.appendChild(container);
      const { createComponent, createSignal } = await import('solid-js');
      const { render } = await import('solid-js/web');
      const { GrammarCoverage } = await import('../windows/levelStudy/GrammarCoverage');
      const [journalSignal, setJournalSignal] = createSignal<KnowledgeEventLog>({});
      // Production path: the journal is written, the bridge folds it into the
      // recognition read model, and coverage reads THAT (never the raw log).
      const [projectionsSignal, setProjectionsSignal] = createSignal<GrammarProjectionMap>({});
      const disposeUi = render(() => createComponent(GrammarCoverage, {
        language,
        languageData: languagePackage,
        get eventLog() { return journalSignal(); },
        get projections() { return projectionsSignal(); },
        get summary() { return summarizeGrammarCurriculum(language, languagePackage, projectionsSignal(), effectiveThresholds()); },
        // LevelStudyTab's real onProbe wiring: component → provider writer.
        onProbe: (pattern, quality, level) => {
          ctx.recordGrammarAttempt(pattern, quality, { language, level });
        },
        // LevelStudyTab's real wiring: the drill hands the provider's shared
        // durable Undo lifecycle to the component.
        undoLifecycle: {
          record: ctx.recordPendingRetraction,
          complete: ctx.completePendingRetraction,
          recover: ctx.recoverPendingRetraction,
          register: ctx.registerRetractionProjection,
        },
      }), container);

      // Expand the chosen construction's level and start the policy pass.
      const block = () => container.querySelector(`[data-level="${routePoint!.level}"]`) as HTMLElement;
      (container.querySelector(`.grammar-coverage__level-row[data-level="${routePoint!.level}"]`) as HTMLElement).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      (block().querySelector('.grammar-coverage__session-btn') as HTMLElement).click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Rate the presented pattern (written-form only; no meaning cue in the pass).
      const presented = block().querySelector('[data-testid="grammar-pattern-prompt"]')?.getAttribute('data-pattern');
      expect(presented).toBeTruthy();
      (block().querySelector('.study-encounter__reveal') as HTMLElement).click();
      (block().querySelector('.grammar-coverage__encounter .rating-matrix__quality:nth-child(3)') as HTMLElement).click();

      // The provider mutation must settle (materialization) before teardown.
      await vi.waitFor(() => expect(ctx.getGrammarKnowledge(presented as string, language)).toBeDefined());

      // End the live pass (skips record nothing) so coverage rows render again.
      // The sanctioned 150ms beat locks ALL session controls after a rating:
      // wait for an enabled skip (or pass completion) before each click.
      for (let guard = 0; guard < 120; guard += 1) {
        const skip = block().querySelector('.study-encounter__skip') as HTMLButtonElement | null;
        if (!skip) break; // pass complete
        if (skip.disabled) {
          await vi.waitFor(() => {
            const current = block().querySelector('.study-encounter__skip') as HTMLButtonElement | null;
            if (current) expect(current.disabled).toBe(false);
          });
        }
        (block().querySelector('.study-encounter__skip') as HTMLButtonElement).click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      await vi.waitFor(() => expect(block().querySelector('.grammar-coverage__session-done')).toBeTruthy());

      // Feed the persisted journal back through the same fold the bridge
      // applies: the rated construction renders as known (rendered progress,
      // not just math).
      const journal = (mockAppendEvents.mock.calls[0][0] ?? {}) as Record<string, KnowledgeEvent[]>;
      const projections = grammarProjectionsOf(language);
      setJournalSignal(journal);
      setProjectionsSignal(projections);
      await vi.waitFor(() => expect(container.querySelectorAll('.grammar-coverage__state--known').length).toBeGreaterThan(0));
      const measurements = classifyGrammarMeasurements(language, projections, effectiveThresholds());
      expect(measurements.get(presented as string)).toMatchObject({ state: 'known', passiveOnly: false });
      const summary = summarizeGrammarCurriculum(language, languagePackage, projections, effectiveThresholds());
      expect(summary.known).toBe(1);
      expect(summary.complete).toBe(false); // one pass never claims full coverage

      // Flush the provider's debounced flashcards save BEFORE teardown so the
      // pending BroadcastChannel postMessage cannot race disposal.
      await new Promise((resolve) => setTimeout(resolve, SAVE_FLUSH_MS));
      disposeUi();
      container.remove();
      disposeProvider();
      mockSettings.language = 'ja';
    });
  });

  it('real zh package under a non-English UI withholds English meanings yet records canonical progress (representative display pair)', async () => {
    // Representative pair per R05/R19: Chinese data shown in a GERMAN UI. The zh
    // package's canonical meanings are English-authored with no `meanings` variants,
    // so under uiLanguage 'de' the resolver WITHHOLDS them (no English leak).
    const zhPackage = JSON.parse(fs.readFileSync(
      path.join(process.cwd(), 'scripts/language-data/source/root-of-app/languages/zh.json'),
      'utf8',
    )) as LanguageData;
    const point = (zhPackage.grammar ?? []).find((candidate) => typeof candidate.level === 'number' && typeof candidate.meaning === 'string');
    expect(point).toBeDefined();

    mockSettings.language = 'zh';
    mockSettings.uiLanguage = 'de';
    // Pass surfaces serialize durable mutations with the Web Locks API and are
    // DISABLED without it (G04); happy-dom reports navigator.locks as null.
    // Inject the same pass-through lock the describe.each routes above use.
    Object.defineProperty(globalThis.navigator, 'locks', {
      value: { request: (_name: string, callback: () => void) => { callback(); return Promise.resolve(); } },
      configurable: true,
    });
    const { ctx, dispose: disposeProvider } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    mockAppendEvents.mockClear();

    const container = document.createElement('div');
    document.body.appendChild(container);
    const { createComponent, createSignal } = await import('solid-js');
    const { render } = await import('solid-js/web');
    const { GrammarCoverage } = await import('../windows/levelStudy/GrammarCoverage');
    const [journalSignal, setJournalSignal] = createSignal<KnowledgeEventLog>({});
    const [projectionsSignal, setProjectionsSignal] = createSignal<GrammarProjectionMap>({});
    const disposeUi = render(() => createComponent(GrammarCoverage, {
      language: 'zh',
      languageData: zhPackage,
      get eventLog() { return journalSignal(); },
      get projections() { return projectionsSignal(); },
      get summary() { return summarizeGrammarCurriculum('zh', zhPackage, projectionsSignal(), effectiveThresholds()); },
      onProbe: (pattern, quality, level) => { ctx.recordGrammarAttempt(pattern, quality, { language: 'zh', level }); },
      // LevelStudyTab's real wiring: the drill hands the provider's shared
      // durable Undo lifecycle to the component.
      undoLifecycle: {
        record: ctx.recordPendingRetraction,
        complete: ctx.completePendingRetraction,
        recover: ctx.recoverPendingRetraction,
        register: ctx.registerRetractionProjection,
      },
    }), container);

    const level = point!.level as number;
    (container.querySelector(`.grammar-coverage__level-row[data-level="${level}"]`) as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // A German-UI learner must not see English canonical meanings anywhere.
    expect(container.querySelectorAll('.grammar-coverage__meaning').length).toBe(0);

    (container.querySelector(`[data-level="${level}"] .grammar-coverage__session-btn`) as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const presented = container.querySelector(`[data-level="${level}"] [data-testid="grammar-pattern-prompt"]`)?.getAttribute('data-pattern');
    expect(presented).toBeTruthy();
    (container.querySelector(`[data-level="${level}"] .study-encounter__reveal`) as HTMLElement).click();
    (container.querySelector(`[data-level="${level}"] .grammar-coverage__encounter .rating-matrix__quality:nth-child(3)`) as HTMLElement).click();
    await vi.waitFor(() => expect(ctx.getGrammarKnowledge(presented as string, 'zh')).toBeDefined());

    for (let guard = 0; guard < 120; guard += 1) {
      const skip = container.querySelector(`[data-level="${level}"] .study-encounter__skip`) as HTMLButtonElement | null;
      if (!skip) break;
      skip.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await vi.waitFor(() => expect(container.querySelector(`[data-level="${level}"] .grammar-coverage__session-done`)).toBeTruthy());

    const journal = (mockAppendEvents.mock.calls[0][0] ?? {}) as Record<string, KnowledgeEvent[]>;
    const projections = grammarProjectionsOf('zh');
    setJournalSignal(journal);
    setProjectionsSignal(projections);
    await vi.waitFor(() => expect(container.querySelectorAll('.grammar-coverage__state--known').length).toBeGreaterThan(0));
    const measurements = classifyGrammarMeasurements('zh', projections, effectiveThresholds());
    expect(measurements.get(presented as string)).toMatchObject({ state: 'known', passiveOnly: false });

    await new Promise((resolve) => setTimeout(resolve, SAVE_FLUSH_MS));
    disposeUi();
    container.remove();
    disposeProvider();
    delete (globalThis.navigator as { locks?: unknown }).locks;
    mockSettings.language = 'ja';
    mockSettings.uiLanguage = DEFAULT_SETTINGS.uiLanguage;
  });

  it('zh HSK 3.0 lexical category → policy → real word activity → canonical journal → materialized progress', async () => {
    // Finding 1 end-to-end on REAL HSK-labelled data: a production HSK Level-1
    // word drives category → TeachingPolicy → word self-assessment → journal → progress.
    const freq = JSON.parse(fs.readFileSync(
      path.join(process.cwd(), 'scripts/language-data/source/root-of-app/languages/zh.freq.json'),
      'utf8',
    )) as Array<[string, string, number, string]>;
    const hskWordRow = freq.find(([word, , level]) => level === 1 && typeof word === 'string' && word.length > 0);
    expect(hskWordRow).toBeDefined();
    const [word] = hskWordRow!;

    mockSettings.language = 'zh';
    const { ctx, dispose: disposeProvider } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    mockAppendEvents.mockClear();

    // Real HSK category (Level 3.0 band) → policy selects the word (no card).
    const decision = selectNextEncounter({
      preset: 'CURRICULUM',
      nowMs: 1_000,
      levelStudyItems: [{ key: `zh:${word}`, word, language: 'zh', level: 1 }],
      curriculumGrammarItems: [],
    });
    expect(decision).not.toBeNull();
    expect(decision!.action).toBe('TEACH');
    expect(decision!.candidate.word).toBe(word);

    // Real activity provenance: EXACTLY what the Word Sync/encounter writer
    // passes for a cardless word self-assessment.
    await submitObservation(ctx, word, 'surface-recognition', 'fluent', {
      language: 'zh',
      origin: 'word-sync',
      taskType: 'word-sync',
    });

    // Collect the ACTUAL rating row from every append call (no calls[0] guess):
    const ratingRows = mockAppendEvents.mock.calls.flatMap((call) =>
      Object.entries(call[0] as Record<string, KnowledgeEvent[]>)
        .flatMap(([, events]) => events as KnowledgeEvent[]),
    ).filter((event) => event.kind === 'rating');
    expect(ratingRows.length).toBe(1);
    const rating = ratingRows[0];
    expect(rating.targetRef).toMatchObject({ capability: 'surface-recognition' });
    expect(rating.origin).toBe('word-sync');
    expect(rating.taskType).toBe('word-sync');
    expect(rating.toStatus).toBe('known');

    // Canonical journal → projection on the EXACT captured key: the projected
    // ease/evidence must equal the recorded rating (journal is the authority).
    let journalEvents: KnowledgeEvent[] | undefined;
    // Wait for the rating's own append call (prior tests' in-flight appends can
    // land mid-test under full-matrix load); guard with Array.isArray so a
    // non-array value shape can never leak into replayKeyProjection.
    await vi.waitFor(() => {
      const ratingJournal = mockAppendEvents.mock.calls
        .map((call) => call[0] as Record<string, KnowledgeEvent[]>)
        .find((log) => Object.values(log).some((events) => Array.isArray(events) && events.includes(rating)));
      journalEvents = ratingJournal
        ? Object.values(ratingJournal).find((events) => Array.isArray(events) && events.includes(rating))
        : undefined;
      expect(journalEvents).toBeDefined();
    });
    const projection = replayKeyProjection(journalEvents!);
    expect(projection).not.toBeNull();
    expect(projection.ease).toBe(rating.easeAfter);
    expect(projection.evidenceSource).toBe('manual');

    // Progress: the canonical journal materializes a measured, not-unknown state.
    await vi.waitFor(() => {
      const status = ctx.getComprehensiveWordStatusSync(word, 'zh');
      expect(['learning', 'known']).toContain(status);
    });

    await new Promise((resolve) => setTimeout(resolve, SAVE_FLUSH_MS));
    disposeProvider();
    mockSettings.language = 'ja';
  });

  it('fluent sense-recognition is raise-only: never lowers an ease above the known anchor', async () => {
    mockSettings.language = 'ja2';
    const SRS = await import('../services/srsAlgorithm');
    const lk = `ja2:${await SRS.hashWord('学校')}`;
    const { ctx, dispose } = await mountProvider();
    seed(makeEmptyStore({
      wordKnowledge: {
        [lk]: { ease: 2.5, lastSeen: 1, timesSeen: 3, timesHovered: 0, word: '学校', language: 'ja2', lastStatusChange: 5 },
      },
    }));

    await submitObservation(ctx, '学校', 'sense-recognition', 'fluent', { language: 'ja2' });

    expect(ctx.store.wordKnowledge[lk]?.ease).toBe(2.5);
    dispose();
    mockSettings.language = 'ja';
  });

  it('fluent surface-reading writes known once; never lowers an existing known record', async () => {
    mockSettings.language = 'ja2';
    const SRS = await import('../services/srsAlgorithm');
    const lk = `ja2:${await SRS.hashWord('学校')}`;
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    await submitObservation(ctx, '学校', 'surface-reading', 'fluent', { language: 'ja2' });
    expect(ctx.store.wordKnowledge[lk]?.access?.['surface-reading']?.status).toBe('known');

    const withKnown = makeEmptyStore({
      wordKnowledge: {
        [lk]: {
          ease: 2.0, lastSeen: 1, timesSeen: 1, timesHovered: 0, word: '学校', language: 'ja2',
          access: { 'surface-reading': { status: 'known', ease: 2.2, source: 'Manual', lastStatusChange: 5, updatedAt: 5 } },
        },
      },
    });
    flashcardsCb(withKnown);
    await submitObservation(ctx, '学校', 'surface-reading', 'fluent', { language: 'ja2' });
    expect(ctx.store.wordKnowledge[lk]?.access?.['surface-reading']?.ease).toBe(2.2);
    dispose();
    mockSettings.language = 'ja';
  });

  it('struggled prosodic-pattern is partial success: learning record, not unknown', async () => {
    mockSettings.language = 'ja2';
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    await submitObservation(ctx, '学校', 'prosodic-pattern', 'struggled', { language: 'ja2' });
    const SRS = await import('../services/srsAlgorithm');
    const lk = `ja2:${await SRS.hashWord('学校')}`;
    const entry = ctx.store.wordKnowledge[lk];
    expect(entry?.access?.['prosodic-pattern']?.status).toBe('learning');
    expect(entry?.access?.['surface-recognition']).toBeUndefined();
    expect(entry?.access?.['surface-reading']).toBeUndefined();
    dispose();
    mockSettings.language = 'ja';
  });

  it('emits one observation event with quality/method/latency provenance', async () => {
    mockSettings.language = 'ja2';
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    await submitObservation(ctx, '学校', 'sense-recognition', 'fluent', {
      language: 'ja2',
      method: 'inference',
      timing: { activeLatencyMs: 1100, wallLatencyMs: 1234, interruptionCount: 1, interrupted: true, stalled: false },
    });
    await Promise.resolve();

    const SRS = await import('../services/srsAlgorithm');
    const lk = `ja2:${await SRS.hashWord('学校')}`;
    const attemptEvents = mockAppendEvents.mock.calls
      .flatMap(([byKey]) => Object.entries(byKey as Record<string, Array<Record<string, unknown>>>))
      .filter(([key]) => key === lk)
      .flatMap(([, events]) => events)
      .filter((e) => e.kind === 'rating' && e.quality !== undefined);
    expect(attemptEvents.length).toBe(1);
    expect(attemptEvents[0]).toMatchObject({
      aspect: 'meaning',
      quality: 'fluent',
      method: 'inference',
      latencyMs: 1234,
      activeLatencyMs: 1100,
      interruptionCount: 1,
      interrupted: true,
    });
    expect(attemptEvents[0]).toMatchObject({
      targetRef: { kind: 'surface', id: `ja2:surface:${SRS.hashWordSync('学校')}`, capability: 'sense-recognition' },
      presentedSurface: '学校',
    });
    dispose();
    mockSettings.language = 'ja';
  });

  it('commits staged retrieval once with target-specific cues and refuses an unfinished stage', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'staged-card', state: 'review', reviews: 2, interval: 86400000, dueDate: Date.now() - 100 });
    const capabilities = ['surface-reading', 'sense-recognition'];
    const id = `ja:surface:${SRS.hashWordSync(card.content.front)}`;
    const decision: import('../../shared/learningDecision').LearningDecision = { id: 'staged-decision', at: 1, policyVersion: 'test',
      selected: { key: card.id, action: 'PROBE', targets: capabilities.map(capability => ({ kind: 'surface', id, capability })),
        task: { taskTemplateId: 'staged', inputModality: 'written-form', responseModality: 'self-assessment', supplied: ['written-form'],
          requested: capabilities, fluencyRequired: false, ratingMode: 'profile', stages: [
            { id: 'first', supplied: [], requested: ['surface-reading'] },
            { id: 'later', supplied: ['surface-reading'], requested: ['sense-recognition'] },
          ] } }, baseline: null, detail: {} };
    const initial = makeEmptyStore({ flashcards: { [card.id]: card } });
    initial.meta.reviewPresentations = { ja: { id: decision.id, cardId: card.id, decision, stageIndex: 0 } };
    flashcardsCb(initial);
    const observations = capabilities.map(capability => ({ capability, quality: 'fluent' as const }));
    const options = { language: 'ja', decision, scaffolds: { audio: true }, attemptId: 'staged-attempt', scheduler: { cardId: card.id, rating: 'good' as const, tested: capabilities } };
    await expect(ctx.submitRating(card.content.front, observations, options)).rejects.toThrow('every admitted stage');
    initial.meta.reviewPresentations.ja.stageIndex = 1; initial.meta.reviewPresentations.ja.stageScaffolds = { first: {} }; flashcardsCb(initial);
    mockAppendEvents.mockClear();
    await ctx.submitRating(card.content.front, observations, options);
    const rows = mockAppendEvents.mock.calls.flatMap(([batch]) => Object.values(batch).flat()).filter(row => row.kind === 'rating');
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.attemptId === 'staged-attempt' && row.decisionRef?.id === decision.id)).toBe(true);
    const first = rows.find(row => row.targetRef?.capability === 'surface-reading');
    const later = rows.find(row => row.targetRef?.capability === 'sense-recognition');
    expect(first?.scaffolds?.['provided-access:surface-reading']).toBeUndefined();
    expect(later?.scaffolds?.['provided-access:surface-reading']).toBe(true);
    expect(first?.scaffolds?.audio).toBeUndefined(); expect(later?.scaffolds?.audio).toBe(true);
    expect(ctx.store.flashcards[card.id].reviews).toBe(3);
    await ctx.undoLastAction();
    expect(ctx.store.meta.reviewPresentations?.ja?.scaffolds).toMatchObject({
      'prior-cue-exposure': true, 'provided-access:surface-reading': true, 'provided-access:sense-recognition': true,
    });
    const restored = makeEmptyStore({ ...JSON.parse(JSON.stringify(ctx.store)), rev: (ctx.store.rev ?? 0) + 1 });
    const replayDecision = { ...decision, id: 'replay-stage' };
    restored.meta.reviewPresentations!.ja = { ...restored.meta.reviewPresentations!.ja, id: replayDecision.id,
      decision: replayDecision, stageIndex: 1, stageScaffolds: { first: {} } };
    flashcardsCb(restored); mockAppendEvents.mockClear();
    await expect(ctx.submitRating(card.content.front, observations, { ...options, decision: replayDecision,
      attemptId: 'rebound-correction' })).rejects.toThrow('original elicitation');
    // A separately admitted exposed replay retains exposure, rather than rebinding the correction.
    delete restored.meta.reviewPresentations!.ja.correction;
    restored.rev = (ctx.store.rev ?? 0) + 1;
    flashcardsCb(restored);
    await ctx.submitRating(card.content.front, observations, { ...options, decision: replayDecision, attemptId: 'replay-stage-attempt' });
    expect(mockAppendEvents.mock.calls.flatMap(([batch]) => Object.values(batch).flat()).filter(row => row.kind === 'rating')).toHaveLength(0);
    dispose();
  });

  it('corrects a retracted frozen word report using original conditions and one idempotent replacement', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    const SRS = await import('../services/srsAlgorithm');
    const key = `ja:${SRS.hashWordSync('学校')}`;
    const decision = { id: 'word-original-correction', at: 1, policyVersion: 'test',
      selected: { key: 'school', action: 'PROBE', targets: ['sense-recognition', 'surface-reading'].map(capability => ({ kind: 'surface', id: `ja:surface:${SRS.hashWordSync('学校')}`, capability })),
        task: { taskTemplateId: 'word-sync', inputModality: 'written-form', responseModality: 'recall', supplied: ['written-form'],
          requested: ['sense-recognition', 'surface-reading'], fluencyRequired: false, ratingMode: 'profile' as const } },
      baseline: null, detail: { 'package:unknown': { values: ['opaque', 3] } } };
    await ctx.submitRating('学校', [{ capability: 'sense-recognition', quality: 'struggled', method: 'recall' }, { capability: 'surface-reading', quality: 'missed', method: 'recall' }],
      { language: 'ja', attemptId: 'word-original', origin: 'word-sync', decision, sourceVersions: { packageVersions: { 'unknown-package': 'v7' } }, scaffolds: { 'package:unknown': true },
        timing: { wallLatencyMs: 500, activeLatencyMs: 400, interruptionCount: 1, interrupted: true, stalled: false } });
    const original = (await knowledgeJournal.getKnowledgeRows([key]))[key].find(row => row.event.attemptId === 'word-original')!.event;
    const options = { language: 'ja', attemptId: 'word-replacement', origin: 'word-sync', decision,
      correctsAttemptId: 'word-original', scaffolds: { translation: true }, correctedAttemptAt: 999 };
    const observations = [{ capability: 'sense-recognition', quality: 'fluent', method: 'recall' },
      { capability: 'surface-reading', quality: 'struggled', method: 'recall' }] as const;
    await expect(ctx.submitRating('学校', observations, options)).rejects.toThrow('retracted original');
    await mockAppendEvents({ [key]: [{ t: Date.now(), kind: 'retraction', source: 'manual', retracts: 'word-original' }] });
    mockAppendEvents.mockRejectedValueOnce(new Error('correction journal unavailable'));
    await expect(ctx.submitRating('学校', observations, options)).rejects.toThrow('correction journal unavailable');
    await ctx.submitRating('学校', observations, options);
    const replacement = (await knowledgeJournal.getKnowledgeRows([key]))[key].find(row => row.event.correctsAttemptId === 'word-original')!.event;
    expect(replacement).toMatchObject({ t: original.t, attemptId: 'word-replacement', correctsAttemptId: 'word-original', quality: 'fluent',
      scaffolds: { 'package:unknown': true }, latencyMs: 500, activeLatencyMs: 400, interruptionCount: 1, decision });
    const originals = (await knowledgeJournal.getKnowledgeRows([key]))[key].filter(row => row.event.attemptId === 'word-original');
    const corrected = (await knowledgeJournal.getKnowledgeRows([key]))[key].filter(row => row.event.correctsAttemptId === 'word-original');
    for (const row of originals) {
      const event = corrected.find(value => value.event.targetRef?.capability === row.event.targetRef?.capability)!.event;
      expect(event).toMatchObject({ targetRef: row.event.targetRef, decisionRef: row.event.decisionRef, t: row.event.t,
        scaffolds: row.event.scaffolds, sourceVersions: row.event.sourceVersions, latencyMs: row.event.latencyMs,
        activeLatencyMs: row.event.activeLatencyMs, interruptionCount: row.event.interruptionCount });
    }
    await ctx.submitRating('学校', observations, options);
    expect((await knowledgeJournal.getKnowledgeRows([key]))[key].filter(row => row.event.correctsAttemptId === 'word-original')).toHaveLength(2);
    await expect(ctx.submitRating('学校', observations, { ...options, attemptId: 'word-second-replacement' })).rejects.toThrow('already has a replacement');
    await expect(ctx.submitRating('学校', observations.slice(0, 1), { ...options, attemptId: 'word-partial' })).rejects.toThrow('retracted original');
    await expect(ctx.submitRating('different', observations, { ...options, attemptId: 'word-other-target' })).rejects.toThrow();
    await expect(ctx.submitRating('学校', observations, { ...options, attemptId: 'word-rebound', decision: { ...decision, id: 'other-decision' } })).rejects.toThrow();
    dispose();
  });

  it('journals the pinned decision on the first measured row after scaffold filtering and refuses a mismatched exact target', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    const SRS = await import('../services/srsAlgorithm');
    const id = `ja:surface:${SRS.hashWordSync('学校')}`;
    const decision: import('../../shared/learningDecision').LearningDecision = { id: 'decision-audit-test', at: 1, policyVersion: 'policy-test',
      selected: { key: 'school', action: 'PROBE', targets: ['surface-reading', 'sense-recognition'].map(capability => ({ kind: 'surface', id, capability })),
        task: { taskTemplateId: 'word-sync', inputModality: 'written-form', responseModality: 'recall', supplied: ['written-form'],
          requested: ['surface-reading', 'sense-recognition'], fluencyRequired: false, ratingMode: 'profile' } },
      baseline: null, detail: { 'future::unknown': { values: [3] } } };
    await ctx.submitRating('学校', [{ capability: 'surface-reading', quality: 'fluent' }, { capability: 'sense-recognition', quality: 'fluent' }],
      { language: 'ja', attemptId: 'decision-audit-attempt', scaffolds: { reading: true }, decision });
    const rows = mockAppendEvents.mock.calls.flatMap(([log]) => Object.values(log as Record<string, KnowledgeEvent[]>).flat())
      .filter(row => row.attemptId === 'decision-audit-attempt');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ targetRef: { kind: 'surface', id, capability: 'sense-recognition' },
      decisionRef: { id: decision.id }, decision });
    const wrong = { ...decision, selected: { ...decision.selected, targets: [{ kind: 'sense', id: 'isolated-sense', capability: 'sense-recognition' }] } };
    await expect(ctx.submitRating('学校', [{ capability: 'sense-recognition', quality: 'fluent' }],
      { attemptId: 'refused-audit-attempt', decision: wrong })).rejects.toThrow('pinned learning task');
    expect(mockAppendEvents.mock.calls.flatMap(([log]) => Object.values(log as Record<string, KnowledgeEvent[]>).flat())
      .some(row => row.attemptId === 'refused-audit-attempt')).toBe(false);
    dispose();
  });
});

describe('submitRating missed (attribution semantics)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setupMockImplementations();
    mockSettings.language = 'ja';
  });

  it('failed prosodic-pattern records only the observed prosody failure', async () => {
    mockSettings.language = 'ja2';
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    const SRS = await import('../services/srsAlgorithm');
    const lk = `ja2:${await SRS.hashWord('学校')}`;

    await submitObservation(ctx, '学校', 'prosodic-pattern', 'missed', { language: 'ja2' });

    const entry = ctx.store.wordKnowledge[lk];
    expect(entry?.access?.['prosodic-pattern']?.status).toBe('unknown');
    expect(entry?.access?.['surface-recognition']).toBeUndefined();
    expect(entry?.access?.['surface-reading']).toBeUndefined();
    expect((entry?.access?.['surface-reading'] as unknown as Record<string, unknown> | undefined)?.inherited).toBeUndefined();
    expect(entry?.ease).toBe(SRS.MIN_EASE);
    dispose();
    mockSettings.language = 'ja';
  });

  it('failed surface-reading leaves prosodic-pattern without inference', async () => {
    mockSettings.language = 'ja2';
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    await submitObservation(ctx, '学校', 'surface-reading', 'missed', { language: 'ja2' });

    const SRS = await import('../services/srsAlgorithm');
    const lk = `ja2:${await SRS.hashWord('学校')}`;
    const entry = ctx.store.wordKnowledge[lk];
    expect(entry?.access?.['surface-reading']?.status).toBe('unknown');
    expect(entry?.access?.['prosodic-pattern']).toBeUndefined();
    expect(entry?.access?.['surface-recognition']).toBeUndefined();
    dispose();
    mockSettings.language = 'ja';
  });

  it('never lowers existing access evidence: known surface-reading stays known, no demotion of the word anchor', async () => {
    mockSettings.language = 'ja2';
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const lk = `ja2:${await SRS.hashWord('学校')}`;
    seed(makeEmptyStore({
      wordKnowledge: {
        [lk]: {
          ease: 2.5, lastSeen: 1, timesSeen: 3, timesHovered: 0, word: '学校', language: 'ja2',
          access: { 'surface-reading': { status: 'known', ease: 1.9, source: 'Manual', lastStatusChange: 5, updatedAt: 5 } },
        },
      },
    }));

    await submitObservation(ctx, '学校', 'prosodic-pattern', 'missed', { language: 'ja2' });

    const entry = ctx.store.wordKnowledge[lk];
    expect(entry?.access?.['surface-reading']?.status).toBe('known');
    expect(entry?.access?.['surface-reading']?.lastStatusChange).toBe(5);
    expect(entry?.ease).toBe(2.5);
    expect(entry?.access?.['surface-recognition']).toBeUndefined();
    expect(entry?.access?.['prosodic-pattern']?.status).toBe('unknown');
    dispose();
    mockSettings.language = 'ja';
  });

  it('unmeasured surface-reading stays absent after a prosody failure', async () => {
    mockSettings.language = 'ja2';
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const lk = `ja2:${await SRS.hashWord('学校')}`;
    seed(makeEmptyStore({
      wordKnowledge: {
        [lk]: { ease: 2.0, lastSeen: 1, timesSeen: 2, timesHovered: 0, word: '学校', language: 'ja2' },
      },
    }));

    await submitObservation(ctx, '学校', 'prosodic-pattern', 'missed', { language: 'ja2' });

    const entry = ctx.store.wordKnowledge[lk];
    expect(entry?.access?.['surface-reading']).toBeUndefined();
    expect(entry?.access?.['surface-recognition']).toBeUndefined();
    expect(entry?.access?.['prosodic-pattern']?.status).toBe('unknown');
    dispose();
    mockSettings.language = 'ja';
  });
});

describe('submitRating missed with orthogonal accesses', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setupMockImplementations();
    mockSettings.language = 'ja';
  });

  it('failed prosodic-pattern leaves an orthogonal package access untouched', async () => {
    mockSettings.language = 'ru2x';
    mockLangData.ru2x = {
      name: 'Chain + Gender',
      settings: { fixed: {} },
      textProcessing: { readingAnnotation: { type: 'script-reading', annotationScripts: ['Cyrl'] } },
      prosody: { type: 'test-prosody' },
    };
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    await submitObservation(ctx, 'школа', 'prosodic-pattern', 'missed', { language: 'ru2x' });

    const SRS = await import('../services/srsAlgorithm');
    const lk = `ru2x:${await SRS.hashWord('школа')}`;
    const entry = ctx.store.wordKnowledge[lk];
    expect(entry?.access?.['prosodic-pattern']?.status).toBe('unknown');
    expect(entry?.access?.['surface-recognition']).toBeUndefined();
    expect(entry?.access?.['surface-reading']).toBeUndefined();
    expect(entry?.access?.['x-ru::noun-class']).toBeUndefined();
    dispose();
    delete mockLangData.ru2x;
    mockSettings.language = 'ja';
  });

  it('unrecognized package capability is stored without affecting core capabilities', async () => {
    mockSettings.language = 'ru2';
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    await submitObservation(ctx, 'школа', 'x-ru::noun-class', 'missed', { language: 'ru2' });

    const SRS = await import('../services/srsAlgorithm');
    const lk = `ru2:${await SRS.hashWord('школа')}`;
    const entry = ctx.store.wordKnowledge[lk];
    expect(entry?.access?.['x-ru::noun-class']?.status).toBe('unknown');
    expect(entry?.access?.['surface-reading']).toBeUndefined();
    expect(entry?.access?.['prosodic-pattern']).toBeUndefined();
    expect(entry?.access?.['surface-recognition']).toBeUndefined();
    expect(entry?.ease).toBe(SRS.MIN_EASE);
    dispose();
    mockSettings.language = 'ja';
  });
});


describe('attempt undo integrity (P0)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setupMockImplementations();
    mockSettings.language = 'ja';
  });

  it('undo restores knowledge state and retracts every event of the attempt', async () => {
    mockSettings.language = 'ja2';
    const lk = `ja2:${SRS.hashWordSync('学校')}`;
    mockAppendEvents.mockClear();
    // Pre-attempt knowledge exists as EVIDENCE (explicit manual rating), not
    // just as a snapshot — that is what projection replay can legitimately
    // restore after undo. Seeded BEFORE the store load so the legacy migration
    // sees journal evidence for the key and skips its rollup backfill.
    const priorT = Date.now() - 1000;
    await mockAppendEvents({
      [lk]: [{ t: priorT, kind: 'rating', source: 'manual', aspect: 'meaning', quality: 'fluent', easeAfter: 2.5, toStatus: 'known' }],
    });
    const { ctx, dispose } = await mountProvider();
    seed(makeEmptyStore({
      flashcards: {
        'card-1': makeCard({
          id: 'card-1',
          language: 'ja2',
          content: { type: 'word', front: '学校', back: 'school' },
          state: 'review',
          interval: 86400000,
          dueDate: Date.now() - 1000,
        }),
      },
      wordToCardMap: { [lk]: ['card-1'] },
    }));

    const attemptId = (await import('../../shared/knowledgeEvents')).nextAttemptId();
    expect(typeof attemptId).toBe('string');
    await ctx.submitRating('学校', [{ capability: 'sense-recognition', quality: 'struggled' }], {
      language: 'ja2',
      attemptId,
      scheduler: { cardId: 'card-1', rating: 'hard', timeSpentMs: 1000, tested: ['sense-recognition'] },
    });
    // Attributed reviews change retention; the observed struggle remains the evidence.
    expect(ctx.store.wordKnowledge[lk]?.ease).toBe(mockSettings.easeThresholdLearning + mockSettings.manualStatusEaseBuffer);
    expect(ctx.store.wordKnowledge[lk]?.hasActiveEvidence).toBe(true);
    expect(ctx.store.wordKnowledge[lk]?.lastEvidenceSource).toBe('manual');

    // Undo appends the tombstone and lets the projection REPLAY rebuild state —
    // no knowledge snapshots involved. Run the idempotent replay explicitly and
    // assert convergence onto the prior evidence.
    await ctx.undoLastAction();
    const replayed = replayKeyProjection((knowledgeJournal.allRows()[lk] ?? []) as KnowledgeEvent[]);
    expect(replayed?.ease).toBe(2.5);
    expect(ctx.store.wordKnowledge[lk]?.ease).toBe(2.5);
    expect(ctx.store.wordKnowledge[lk]?.lastStatusChange).toBe(priorT);

    const { stripRetractions } = await import('../../shared/knowledgeEvents');
    const appendedByKey: Record<string, Array<Record<string, unknown>>> = {};
    for (const [byKey] of mockAppendEvents.mock.calls) {
      for (const [key, events] of Object.entries(byKey as Record<string, Array<Record<string, unknown>>>)) {
        appendedByKey[key] = [...(appendedByKey[key] ?? []), ...events];
      }
    }
    // The retracted attempt's events (observation + review) were appended…
    const retractionCalls = Object.values(appendedByKey).flat().filter((e) => e.kind === 'retraction');
    expect(new Set(retractionCalls.map((e) => e.retracts))).toEqual(new Set([attemptId]));
    // …and after stripping retractions, zero net evidence from that attempt remains.
    const survivingWithAttemptId = stripRetractions(
      Object.values(appendedByKey).flat() as unknown as Parameters<typeof stripRetractions>[0],
    ).filter((e) => e.attemptId === attemptId);
    expect(survivingWithAttemptId).toHaveLength(0);
    dispose();
    mockSettings.language = 'ja';
  });

  it('all-fluent submits share one attempt id across accesses and the review event', async () => {
    mockSettings.language = 'ja2';
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    const attemptId = (await import('../../shared/knowledgeEvents')).nextAttemptId();
    const a = await submitObservation(ctx, '学校', 'surface-reading', 'fluent', { language: 'ja2', attemptId });
    const b = await submitObservation(ctx, '学校', 'prosodic-pattern', 'fluent', { language: 'ja2', attemptId });
    expect(a.attemptId).toBe(attemptId);
    expect(b.attemptId).toBe(attemptId);

    mockAppendEvents.mockClear();
    dispose();
    mockSettings.language = 'ja';
  });
});

describe('submitRating logs no-transition submissions', () => {
  it('fluent sense-recognition on an already-known word logs one observation and writes nothing', async () => {
    mockSettings.language = 'ja2';
    const lk = `ja2:${SRS.hashWordSync('学校')}`;
    mockAppendEvents.mockClear();
    const { ctx, dispose } = await mountProvider();
    seed(makeEmptyStore({
      wordKnowledge: {
        // Evidence-backed Known requires active evidence (manual rating here).
        [lk]: {
          ease: 4.5, lastSeen: 1, timesSeen: 3, timesHovered: 0, word: '学校', language: 'ja2',
          lastStatusChange: 5, hasActiveEvidence: true, lastEvidenceSource: 'manual',
        },
      },
    }));

    await submitObservation(ctx, '学校', 'sense-recognition', 'fluent', { language: 'ja2' });
    await Promise.resolve();
    // The legacy migration may append a kind:'rollup' backfill for this key —
    // the no-transition contract is about the rating observation, so count those.
    const events = mockAppendEvents.mock.calls
      .flatMap(([byKey]) => Object.entries(byKey as Record<string, Array<Record<string, unknown>>>))
      .filter(([key]) => key === lk)
      .flatMap(([, es]) => es)
      .filter((e) => e.kind === 'rating');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'rating', aspect: 'meaning', quality: 'fluent', fromStatus: 'known', toStatus: 'known' });
    // No state write: the raise-only rule left the known record untouched.
    expect(ctx.store.wordKnowledge[lk]?.ease).toBe(4.5);
    // The legacy aggregate does not reconstruct an observed status transition.
    expect(ctx.store.wordKnowledge[lk]?.lastStatusChange).toBeUndefined();
    expect(ctx.store.wordKnowledge[lk]?.claim).toBeUndefined();
    dispose();
    mockSettings.language = 'ja';
  });

  it('fluent surface-reading already known logs the observation without a status event', async () => {
    mockSettings.language = 'ja2';
    const lk = `ja2:${SRS.hashWordSync('学校')}`;
    mockAppendEvents.mockClear();
    const { ctx, dispose } = await mountProvider();
    seed(makeEmptyStore({
      wordKnowledge: {
        // Active evidence marks the entry honest; the surface-reading access carries the known status.
        [lk]: {
          ease: 2.0, lastSeen: 1, timesSeen: 1, timesHovered: 0, word: '学校', language: 'ja2',
          hasActiveEvidence: true, lastEvidenceSource: 'manual',
          access: { 'surface-reading': { status: 'known', ease: 2.2, source: 'Manual', lastStatusChange: 5, updatedAt: 5 } },
        },
      },
    }));
    flashcardsCb(committed);

    await submitObservation(ctx, '学校', 'surface-reading', 'fluent', { language: 'ja2' });
    await Promise.resolve();
    // The legacy migration may append a kind:'rollup' backfill — count the rating observation.
    const events = mockAppendEvents.mock.calls
      .flatMap(([byKey]) => Object.entries(byKey as Record<string, Array<Record<string, unknown>>>))
      .filter(([key]) => key === lk)
      .flatMap(([, es]) => es)
      .filter((e) => e.kind === 'rating');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'rating', aspect: 'reading', quality: 'fluent' });
    // No status event and no ease mutation for the already-known access.
    expect(ctx.store.wordKnowledge[lk]?.access?.['surface-reading']?.ease).toBe(2.2);
    expect(ctx.store.wordKnowledge[lk]?.access?.['surface-reading']?.status).toBe('known');
    dispose();
    mockSettings.language = 'ja';
  });

  it('submission for a claim-known word still logs its observation', async () => {
    mockSettings.language = 'ja2';
    const SRS = await import('../services/srsAlgorithm');
    const lk = `ja2:${await SRS.hashWord('学校')}`;
    mockAppendEvents.mockClear();
    const { ctx, dispose } = await mountProvider();
    seed(makeEmptyStore({
      wordKnowledge: {
        [lk]: {
          // A Tier-2 known claim governs the effective status (knownUntracked is legacy residue).
          claim: 'known',
          claimAt: 5,
          ease: SRS.MIN_EASE,
          lastSeen: 1,
          timesSeen: 0,
          timesHovered: 0,
          word: '学校',
          language: 'ja2',
        },
      },
    }));

    await submitObservation(ctx, '学校', 'sense-recognition', 'missed', { language: 'ja2' });
    await Promise.resolve();
    // The legacy migration may append a kind:'rollup' backfill — count the rating observation.
    const events = mockAppendEvents.mock.calls
      .flatMap(([byKey]) => Object.entries(byKey as Record<string, Array<Record<string, unknown>>>))
      .filter(([key]) => key === lk)
      .flatMap(([, es]) => es)
      .filter((e) => e.kind === 'rating');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'rating', quality: 'missed', fromStatus: 'known', toStatus: 'unknown' });
    // The claim stays; the observation is also recorded as ACTIVE evidence.
    expect(ctx.store.wordKnowledge[lk]?.claim).toBe('known');
    expect(ctx.store.wordKnowledge[lk]?.hasActiveEvidence).toBe(true);
    expect(ctx.store.wordKnowledge[lk]?.lastEvidenceSource).toBe('manual');
    dispose();
    mockSettings.language = 'ja';
  });
});
// ── REQ15: claim override persistence ─────────────────────────────────
describe('claim override persistence (REQ15)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setupMockImplementations();
  });
  it('set claim Learning over evidence Known → reload → evidence intact → clear restores', async () => {
    mockSettings.language = 'ja';
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const word = '学習';
    const lk = `ja:${SRS.hashWordSync(word)}`;
    // Journal already holds the SRS review evidence (persisted store) — seeded
    // BEFORE the load so the legacy migration sees journal history for the key
    // and skips its rollup backfill.
    await mockAppendEvents({
      [lk]: [{ t: 1, kind: 'review', source: 'srs', aspect: 'meaning', rating: 'good', easeAfter: 2.6 }],
    });
    seed(makeEmptyStore({
      wordKnowledge: {
        [lk]: {
          ease: 2.6, lastSeen: 1, timesSeen: 4, timesHovered: 0, word, language: 'ja',
          hasActiveEvidence: true, lastEvidenceSource: 'srs',
        },
      },
    }));

    // 1. Claim Learning over evidence Known: effective Learning, basis claim,
    //    evidence classification stays visible.
    await ctx.setWordClaim(word, 'learning');
    const claimed = ctx.getComprehensiveWordStatusWithSourceSync(word);
    expect(claimed).toMatchObject({ status: 'learning', basis: 'claim', claim: 'learning', evidenceStatus: 'known' });
    expect(ctx.store.wordKnowledge[lk]?.ease).toBe(2.6);

    // 2. Simulate store reload: the persisted materialized store comes back
    //    through the bridge (claim + evidence are part of it) and the load
    //    re-runs the journal reconciliation.
    const persisted = JSON.parse(JSON.stringify(ctx.store));
    flashcardsCb(persisted);
    const reloaded = ctx.getComprehensiveWordStatusWithSourceSync(word);
    expect(reloaded).toMatchObject({ status: 'learning', basis: 'claim', evidenceStatus: 'known' });
    // Evidence intact, nothing fabricated: ease unchanged, no negative rows.
    expect(ctx.store.wordKnowledge[lk]?.ease).toBe(2.6);
    expect(ctx.store.wordKnowledge[lk]?.hasActiveEvidence).toBe(true);
    const journal = knowledgeJournal.allRows();
    expect(journal[lk].map((e) => e.kind).sort()).toEqual(['claim', 'review']);
    const projection = replayKeyProjection(journal[lk] as Parameters<typeof replayKeyProjection>[0]);
    expect(projection).toMatchObject({ claim: 'learning', ease: 2.6, hasActiveEvidence: true });

    // 3. Cross-window: the persisted store arrives as a second-window update
    //    (BroadcastChannel harness) AFTER the local claim was cleared — the
    //    claim LWW merge restores it, evidence ease unchanged.
    await ctx.setWordClaim(word, null);
    const cleared = ctx.getComprehensiveWordStatusWithSourceSync(word);
    expect(cleared).toMatchObject({ status: 'known', basis: 'evidence', evidenceStatus: 'known' });
    expect(cleared.claim).toBeUndefined();
    expect(ctx.store.wordKnowledge[lk]?.ease).toBe(2.6);

    const state: { handler: ((event: MessageEvent) => void) | null } = { handler: null };
    vi.stubGlobal('BroadcastChannel', function MockBroadcastChannel() {
      return {
        postMessage: vi.fn(),
        close: vi.fn(),
        set onmessage(fn: ((event: MessageEvent) => void) | null) { state.handler = fn; },
        get onmessage() { return state.handler; },
      };
    });
    const { ctx: windowB, dispose: disposeB } = await mountProvider();
    flashcardsCb(makeEmptyStore()); // window B starts from its own (empty) view
    state.handler!({ data: { type: 'update', store: persisted } } as MessageEvent);
    expect(windowB.store.wordKnowledge[lk]?.claim).toBe('learning');
    expect(windowB.store.wordKnowledge[lk]?.ease).toBe(2.6);
    expect(windowB.getComprehensiveWordStatusWithSourceSync(word)).toMatchObject({ status: 'learning', basis: 'claim' });
    disposeB();
    vi.unstubAllGlobals();
    dispose();
  });

  // REGRESSION (this campaign): a manual "I know this" claim is stored
  // word-level, so `sense-recognition` folds it in but `surface-recognition`
  // never saw it. Written comprehension requires both, so a word the learner
  // had explicitly claimed kept being re-listed as unknown by the reader,
  // video and overlay sidebars while the comprehensive projection reported it
  // as `known` on the same screen.
  it('a claimed word is not re-listed as unknown by the written-comprehension rule', async () => {
    mockSettings.language = 'ja';
    const { ctx, dispose } = await mountProvider();
    seed(makeEmptyStore());

    // The gated resolver only answers once hydration + migration have settled.
    await vi.waitFor(() => expect(ctx.isKnowledgeReady()).toBe(true));

    await ctx.setWordClaim('遅刻', 'known', 'ja');

    // The claim is honoured by the comprehensive projection...
    expect(ctx.getComprehensiveWordStatusSync('遅刻', 'ja')).toBe('known');
    // ...so the capture surfaces must agree that it is not an unknown word.
    expect(ctx.isWordKnownWhenWrittenSync('遅刻', '遅刻', 'ja')).toBe(true);
    dispose();
  });

  // The claim only settles the word the learner spoke about. It must NOT
  // manufacture a written-form bridge for an unmeasured surface: that rule is
  // the entire reason this predicate exists, and a learner who has only seen
  // a word still wants it in the list.
  it('a claim does not turn an unmeasured bridge into evidence for an ALIAS spelling', async () => {
    mockSettings.language = 'ja';
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const lk = `ja:${SRS.hashWordSync('遅刻')}`;
    seed(makeEmptyStore({
      wordKnowledge: {
        [lk]: {
          ease: 2.6, lastSeen: 1, timesSeen: 4, timesHovered: 0,
          word: '遅刻', language: 'ja', hasActiveEvidence: true, lastEvidenceSource: 'srs',
        },
      },
    }));

    await vi.waitFor(() => expect(ctx.isKnowledgeReady()).toBe(true));
    await ctx.setWordClaim('遅刻', 'known', 'ja');

    // The claim settles the word itself...
    expect(ctx.isWordKnownWhenWrittenSync('遅刻', '遅刻', 'ja')).toBe(true);
    // ...but it must not manufacture a written-form bridge for a DIFFERENT
    // spelling of it. An alias the learner has never been shown is still an
    // unknown written form, which is exactly what this rule exists to catch.
    expect(ctx.isWordKnownWhenWrittenSync('遅刻', '遅刻し', 'ja')).toBe(false);
    dispose();
  });
});
// ── REQ3/REQ52: attempt metadata completeness ─────────────────────────
describe('attempt task metadata (REQ3/REQ52)', () => {
  beforeEach(resetProviderTestHarness);
  afterEach(async () => {
    await new Promise(resolve => setTimeout(resolve, SAVE_DEBOUNCE_MS_FOR_TESTS));
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  it('persists popup self-assessments as claims without replacing observations or scheduler state', async () => {
    mockSettings.language = 'ja2';
    const { ctx, dispose } = await mountProvider();
    const word = '学校';
    const key = `ja2:${SRS.hashWordSync(word)}`;
    await mockAppendEvents({ [key]: [
      { t: 10, kind: 'rollup', source: 'srs', aspect: 'meaning', easeAfter: 1.4, timesSeenDelta: 5 },
      { t: 10, kind: 'rating', source: 'srs', aspect: 'reading', easeAfter: 1.6, quality: 'struggled' },
    ] });
    seed(makeEmptyStore({ wordKnowledge: { [key]: { word, language: 'ja2', ease: 1.4,
      timesSeen: 5, timesHovered: 0, lastSeen: 10, hasActiveEvidence: true,
      access: { 'surface-reading': { status: 'learning', ease: 1.6, source: 'Manual', lastStatusChange: 10 } } } } }));
    await vi.waitFor(() => expect(ctx.isKnowledgeReady()).toBe(true));
    const priorCalls = mockAppendEvents.mock.calls.length;
    await ctx.submitRating(word, [{ capability: 'sense-recognition', quality: 'fluent' },
      { capability: 'surface-reading', quality: 'missed' }], { language: 'ja2', attemptId: 'popup-assessment', selfAssessment: true });
    const events = mockAppendEvents.mock.calls.slice(priorCalls).flatMap(([log]) => Object.values(log as KnowledgeEventLog).flat());
    expect(events).toHaveLength(2);
    expect(events.every(event => event.kind === 'claim' && event.source === 'manual')).toBe(true);
    expect(events.find(event => event.targetRef?.capability === 'sense-recognition')).toMatchObject({ toStatus: 'known', quality: 'fluent', attemptId: 'popup-assessment' });
    expect(events.find(event => event.targetRef?.capability === 'surface-reading')).toMatchObject({ toStatus: 'unknown', quality: 'missed' });
    expect(events.every(event => event.easeAfter === undefined && event.taskType === undefined && event.method === undefined)).toBe(true);
    expect(ctx.store.wordKnowledge[key]).toMatchObject({ ease: 1.4, timesSeen: 5, lastSeen: 10, claim: 'known' });
    expect(ctx.store.wordKnowledge[key].access?.['surface-reading']).toMatchObject({ ease: 1.6, status: 'learning', claim: 'unknown' });
    expect(ctx.getAccessStatus(word, 'surface-reading', 'ja2')).toMatchObject({ basis: 'claim', status: 'unknown' });
    const projected = replayKeyProjection(events);
    expect(projected?.hasActiveEvidence).toBe(false);
    mockAppendEvents.mockClear();
    await expect(ctx.submitRating(word, [{ capability: 'sense-recognition', quality: 'fluent' }],
      { language: 'ja2', selfAssessment: true, scheduler: { cardId: 'any-card', rating: 'good' } }))
      .rejects.toThrow('A self-assessment cannot advance a review schedule');
    expect(mockAppendEvents).not.toHaveBeenCalled();
    dispose();
    mockSettings.language = 'ja';
  });

  it('submitRating writes taskType/scaffolds/sourceVersions onto the observation and replay round-trips them', async () => {
    mockSettings.language = 'ja2';
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    mockAppendEvents.mockClear();
    await submitObservation(ctx, '学校', 'sense-recognition', 'fluent', {
      language: 'ja2',
      taskType: 'word-sync',
      // Reading scaffold on a SENSE-addressed rating supplies nothing the
      // sense access needs, so the row stays measurable and carries its
      // provenance. (translation: true here would make the attempt cued and
      // unmeasured — covered by the dedicated scaffold-guard test.)
      scaffolds: { reading: true, translation: false },
      sourceVersions: { graphSchemaVersion: 1 },
    });
    await vi.waitFor(() => expect(mockAppendEvents.mock.calls.length).toBeGreaterThan(0));

    const events = mockAppendEvents.mock.calls
      .flatMap(([byKey]) => Object.values(byKey as Record<string, Array<Record<string, unknown>>>))
      .flat()
      .filter((e) => e.kind === 'rating');
    const observation = events.find((e) => e.taskType === 'word-sync');
    expect(observation).toBeDefined();
    expect(observation).toMatchObject({
      quality: 'fluent',
      taskType: 'word-sync',
      scaffolds: { reading: true, translation: false },
      sourceVersions: { graphSchemaVersion: 1 },
    });

    // Round-trip: journal → replay keeps the attempt as active evidence and
    // the metadata stays on the journaled rows for horizon-sensitive projection.
    const journal = knowledgeJournal.allRows();
    const journaled = Object.values(journal).flat().find((e) => e.attemptId !== undefined);
    expect(journaled).toMatchObject({ taskType: 'word-sync', scaffolds: { reading: true, translation: false } });
    const projection = replayKeyProjection(
      Object.values(journal).flat() as Parameters<typeof replayKeyProjection>[0],
    );
    expect(projection?.hasActiveEvidence).toBe(true);
    dispose();
    mockSettings.language = 'ja';
  });

  it('a word-sync origin implies the word-sync task type when the caller omits one', async () => {
    mockSettings.language = 'ja2';
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    mockAppendEvents.mockClear();
    await submitObservation(ctx, '学校', 'sense-recognition', 'struggled', { language: 'ja2', origin: 'word-sync' });
    await vi.waitFor(() => expect(mockAppendEvents.mock.calls.length).toBeGreaterThan(0));

    const observation = mockAppendEvents.mock.calls
      .flatMap(([byKey]) => Object.values(byKey as Record<string, Array<Record<string, unknown>>>))
      .flat()
      .find((e) => e.kind === 'rating');
    expect(observation).toMatchObject({ origin: 'word-sync', taskType: 'word-sync' });
    dispose();
    mockSettings.language = 'ja';
  });

  it('submitRating tags SRS reviews with the srs-review task type', async () => {
    mockSettings.language = 'ja2';
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'task-card', state: 'new', language: 'ja2' });
    seed(makeEmptyStore({
      flashcards: { 'task-card': card },
      wordToCardMap: { [`ja2:${SRS.hashWordSync('テスト')}`]: ['task-card'] },
    }));
    mockAppendEvents.mockClear();
    await submitSchedulerRating(ctx, 'task-card', 'good');
    await vi.waitFor(() => expect(mockAppendEvents.mock.calls.length).toBeGreaterThan(0));

    const review = mockAppendEvents.mock.calls
      .flatMap(([byKey]) => Object.values(byKey as Record<string, Array<Record<string, unknown>>>))
      .flat()
      .find((e) => e.kind === 'review');
    expect(review).toMatchObject({ kind: 'review', source: 'srs', taskType: 'srs-review' });
    dispose();
    mockSettings.language = 'ja';
  });
});

// ── REQ39 provider side: grammar encounter provenance ─────────────────
describe('trackGrammarEncountered encounter opts (REQ39)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setupMockImplementations();
  });
  it('counts a grammar pattern once per domain encounter across remount-like calls', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    mockAppendEvents.mockClear();
    ctx.trackGrammarEncountered('unknown-package-pattern', { encounterId: 'reader:book:page:visit-1' });
    ctx.trackGrammarEncountered('unknown-package-pattern', { encounterId: 'reader:book:page:visit-1' });
    ctx.trackGrammarEncountered('unknown-package-pattern', { encounterId: 'reader:book:page:visit-2' });
    expect(mockAppendEvents).toHaveBeenCalledTimes(2);
    await new Promise((resolve) => setTimeout(resolve, SAVE_FLUSH_MS));
    dispose();
  });
  it('carries confidence/span/origin onto the rollup event and keeps legacy positional calls', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    mockAppendEvents.mockClear();
    ctx.trackGrammarEncountered('てform', { confidence: 0.65, span: { start: 0, end: 1 }, origin: 'subtitle:literal' });
    await vi.waitFor(() => expect(ctx.getGrammarKnowledge('てform')).toBeDefined());

    const [[byKey]] = mockAppendEvents.mock.calls;
    const [event] = Object.values(byKey as Record<string, Array<Record<string, unknown>>>)[0];
    expect(event).toMatchObject({
      kind: 'rollup',
      source: 'grammar',
      timesSeenDelta: 1,
      confidence: 0.65,
      span: { start: 0, end: 1 },
      origin: 'subtitle:literal',
    });
    // Encounters are factual exposure — never mastery evidence.
    expect(event.easeAfter).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, SAVE_FLUSH_MS));
    dispose();
  });

  it('positional (pattern, level, language) callers keep their behavior', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    mockAppendEvents.mockClear();
    ctx.trackGrammarEncountered('ないform', 4, 'ru');
    await vi.waitFor(() => expect(ctx.getGrammarKnowledge('ないform', 'ru')).toBeDefined());

    const [[byKey]] = mockAppendEvents.mock.calls;
    const [event] = Object.values(byKey as Record<string, Array<Record<string, unknown>>>)[0];
    expect(event).toMatchObject({ kind: 'rollup', timesSeenDelta: 1, origin: 'grammar-encounter' });
    expect(event.confidence).toBeUndefined();
    expect(event.span).toBeUndefined();
    dispose();
  });
});

const SAVE_FLUSH_MS = 400; // provider SAVE_DEBOUNCE_MS (300) + margin

vi.mock('../context', () => ({
  useLocalization: () => ({ t: (key: string) => key }),
  useSettings: () => ({ settings: mockSettings }),
}));

describe('recordGrammarAttempt (curriculum grammar probe)', () => {
  beforeEach(setupMockImplementations);

  it('corrects a retracted grammar self-report using original canonical conditions and rejects another target', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    const decision = { id: 'correctable-grammar', at: 100, policyVersion: 'test',
      selected: { key: 'grammar', action: 'PROBE', targets: [{ kind: 'grammar-pattern', id: 'de:grammar:weil', capability: 'grammar-recognition' }],
        task: { taskTemplateId: 'grammar-self-assess', inputModality: 'written-form', responseModality: 'recall',
          supplied: ['written-form'], requested: ['grammar-recognition'], fluencyRequired: false, ratingMode: 'dominant' as const } },
      baseline: null, detail: { opaquePackageMetadata: { 'future:feature': [7, 'value'] } } };
    const originalId = await ctx.recordGrammarAttemptAcknowledged('weil', 'struggled', {
      language: 'de', taskType: 'grammar-self-assess', method: 'recall', decision, scaffolds: { audio: true } });
    const key = grammarEvidenceKey('de', 'weil', 'grammar-recognition');
    const original = (await knowledgeJournal.getKnowledgeRows([key]))[key].find(row => row.event.attemptId === originalId)!.event;
    await expect(ctx.recordGrammarAttemptAcknowledged('weil', 'fluent', {
      language: 'de', taskType: 'grammar-self-assess', method: 'recall', decision, correctsAttemptId: originalId })).rejects.toThrow('retracted original');
    await mockAppendEvents({ [key]: [{ t: Date.now(), kind: 'retraction', source: 'manual', retracts: originalId }] });
    const replacement = await ctx.recordGrammarAttemptAcknowledged('weil', 'fluent', {
      language: 'de', taskType: 'grammar-self-assess', method: 'recall', decision, correctsAttemptId: originalId });
    const event = (mockAppendEvents.mock.calls.at(-1)![0] as KnowledgeEventLog)[key][0];
    expect(event).toMatchObject({ attemptId: replacement, correctsAttemptId: originalId, t: original.t,
      quality: 'fluent', scaffolds: { audio: true }, decision });
    await ctx.recordGrammarAttemptAcknowledged('weil', 'fluent', {
      language: 'de', taskType: 'grammar-self-assess', method: 'recall', decision, correctsAttemptId: originalId, attemptId: replacement });
    expect((await knowledgeJournal.getKnowledgeRows([key]))[key].filter(row => row.event.correctsAttemptId === originalId)).toHaveLength(1);
    await expect(ctx.recordGrammarAttemptAcknowledged('weil', 'missed', {
      language: 'de', taskType: 'grammar-self-assess', method: 'recall', decision, correctsAttemptId: originalId })).rejects.toThrow('already has a replacement');
    await expect(ctx.recordGrammarAttemptAcknowledged('obwohl', 'fluent', {
      language: 'de', taskType: 'grammar-self-assess', method: 'recall', decision, correctsAttemptId: originalId })).rejects.toThrow();
    dispose();
  });

  it.each(['grammar-self-assess', 'grammar-self-check'])('joins an acknowledged %s response to its frozen decision and refuses a different target', async taskType => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    mockAppendEvents.mockClear();
    const decision = { id: 'grammar-admission', at: Date.now(), policyVersion: 'captured-policy',
      selected: { key: 'opaque-grammar', action: 'PROBE', targets: [{ kind: 'grammar-pattern', id: 'de:grammar:weil', capability: 'grammar-recognition' }],
        task: { taskTemplateId: taskType, inputModality: 'written-form', responseModality: 'recall',
          supplied: ['written-form'], requested: ['grammar-recognition'], fluencyRequired: false, ratingMode: 'dominant' as const } },
      baseline: null, detail: { packageOwned: { futureFeature: ['opaque', { value: 7 }] } } };
    await ctx.recordGrammarAttemptAcknowledged('weil', 'fluent', { language: 'de', attemptId: 'stable-grammar-attempt',
      taskType, method: 'recall', decision });
    const [event] = (mockAppendEvents.mock.calls[0][0] as KnowledgeEventLog)[grammarEvidenceKey('de', 'weil', 'grammar-recognition')];
    expect(event).toMatchObject({ attemptId: 'stable-grammar-attempt', decisionRef: { id: decision.id }, decision });
    mockAppendEvents.mockClear();
    await expect(ctx.recordGrammarAttemptAcknowledged('obwohl', 'fluent', { language: 'de',
      taskType, method: 'recall', decision })).rejects.toThrow('pinned learning task');
    await expect(ctx.recordGrammarAttemptAcknowledged('weil', 'fluent', { language: 'de',
      taskType: 'grammar-recognize', decision })).rejects.toThrow('Grammar response task');
    expect(mockAppendEvents).not.toHaveBeenCalled();
    dispose();
  });

  it.each(['mcq', 'typed'] as const)('persists the admitted contrast-%s decision with item validation, without calling it recall', async format => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore()); mockAppendEvents.mockClear();
    const taskType = `contrast-${format}`;
    const itemRef = { id: 'vendor:unknown-question', version: 'opaque-version', seed: 7 };
    const validationRef = { validator: 'test-validator', at: '2026-10-04', contentHash: itemRef.version };
    const decision = { id: `contrast-${format}-admission`, at: Date.now(), policyVersion: 'captured-policy',
      selected: { key: 'opaque-grammar', action: 'PROBE', targets: [{ kind: 'grammar-pattern', id: 'future:grammar:unknown', capability: 'grammar-recognition' }],
        task: { taskTemplateId: taskType, inputModality: 'written-context', responseModality: format === 'mcq' ? 'multiple-choice' : 'typed',
          supplied: ['written-context'], requested: ['grammar-recognition'], fluencyRequired: false, ratingMode: 'dominant' as const },
        presentation: { itemRef, validationRef } }, baseline: null, detail: { scope: 'frozen-grammar-contrast' } };
    await ctx.recordGrammarAttemptAcknowledged('unknown', 'struggled', { language: 'future', taskType, itemRef, validationRef,
      attemptId: 'stable-contrast-attempt', decision });
    const [event] = (mockAppendEvents.mock.calls[0][0] as KnowledgeEventLog)[grammarEvidenceKey('future', 'unknown', 'grammar-recognition')];
    expect(event).toMatchObject({ attemptId: 'stable-contrast-attempt', taskType, itemRef, validationRef,
      decisionRef: { id: decision.id }, decision });
    expect(event.method).not.toBe('recall');
    mockAppendEvents.mockClear();
    await expect(ctx.recordGrammarAttemptAcknowledged('unknown', 'struggled', { language: 'future',
      taskType: format === 'mcq' ? 'contrast-typed' : 'contrast-mcq', decision })).rejects.toThrow('Grammar response task');
    await expect(ctx.recordGrammarAttemptAcknowledged('unknown', 'struggled', { language: 'future', taskType,
      itemRef: { ...itemRef, version: 'wrong-version' }, validationRef, decision })).rejects.toThrow('Grammar response item');
    await expect(ctx.recordGrammarAttemptAcknowledged('unknown', 'struggled', { language: 'future', taskType,
      itemRef, validationRef: { ...validationRef, validator: 'wrong-validator' }, decision })).rejects.toThrow('Grammar response item');
    expect(mockAppendEvents).not.toHaveBeenCalled();
    dispose();
  });

  it('a German grammar probe is UNASSISTED by default (cue-free session surface)', async () => {
    mockSettings.language = 'de';
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    mockAppendEvents.mockClear();

    // 'weil' is a real construction of the German source package
    // (scripts/language-data/source/root-of-app/languages/de.json, B1).
    const attemptId = ctx.recordGrammarAttempt('weil', 'fluent', { language: 'de', level: 3 });
    await vi.waitFor(() => expect(ctx.getGrammarKnowledge('weil', 'de')).toBeDefined());

    const byKey = mockAppendEvents.mock.calls[0][0] as Record<string, Array<Record<string, unknown>>>;
    const [event] = byKey[grammarEvidenceKey('de', 'weil', 'grammar-recognition')];
    expect(event).toMatchObject({
      kind: 'rating',
      quality: 'fluent',
      attemptId,
      origin: 'grammar-probe',
      taskType: 'grammar-recognize',
      easeAfter: 1.8,
    });
    // The grammar-probe surface is cue-free by construction: no meaning is
    // rendered inside the pass, so attempts are unassisted (no scaffolds).
    expect('scaffolds' in event).toBe(false);
    dispose();
    mockSettings.language = 'ja';
  });

  it.each([true, false])('the acknowledged grammar writer rejects when the canonical journal append fails (Electron=%s)', async electron => {
    mockIsElectron.mockReturnValue(electron);
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    mockAppendEvents.mockRejectedValueOnce(new Error('journal unavailable'));

    await expect(ctx.recordGrammarAttemptAcknowledged('のに', 'struggled', {
      language: 'ja',
      level: 2,
    })).rejects.toThrow('journal unavailable');
    dispose();
  });

  it('the acknowledged grammar writer preserves a caller-reserved attempt id and declared recall method', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    mockAppendEvents.mockClear();
    const attemptId = await ctx.recordGrammarAttemptAcknowledged('のに', 'struggled', {
      language: 'ja',
      level: 2,
      attemptId: 'restart-stable-attempt',
      method: 'recall',
    });
    expect(attemptId).toBe('restart-stable-attempt');
    expect(Object.values(mockAppendEvents.mock.calls[0][0] as Record<string, Array<{ attemptId?: string }>>)[0][0].attemptId)
      .toBe('restart-stable-attempt');
    expect(Object.values(mockAppendEvents.mock.calls[0][0] as Record<string, Array<{ method?: string }>>)[0][0].method).toBe('recall');
    dispose();
  });

  it('a row-probe with visible meaning records translation-scaffold provenance', async () => {
    // The restored per-row probe is a browsing-surface self-assessment: the
    // meaning is visible, so the record declares the cue (translation) while
    // staying an active grammar-recognition attempt per the core contract
    // (SCAFFOLD_INVALIDATES only ever pre-empts sense-recognition).
    mockSettings.language = 'ja';
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    mockAppendEvents.mockClear();

    ctx.recordGrammarAttempt('のに', 'struggled', { language: 'ja', level: 2, scaffolds: { translation: true } });
    await vi.waitFor(() => expect(ctx.getGrammarKnowledge('のに', 'ja')).toBeDefined());

    const byKey = mockAppendEvents.mock.calls[0][0] as Record<string, Array<Record<string, unknown>>>;
    const [event] = byKey[grammarEvidenceKey('ja', 'のに', 'grammar-recognition')];
    expect(event).toMatchObject({
      kind: 'rating',
      quality: 'struggled',
      origin: 'grammar-probe',
      taskType: 'grammar-recognize',
      scaffolds: { translation: true },
    });
    await new Promise((resolve) => setTimeout(resolve, SAVE_FLUSH_MS));
    dispose();
    mockSettings.language = 'ja';
  });


  beforeEach(setupMockImplementations);

  it('writes ONE active rating event on the capability-scoped grammar key', async () => {
    mockSettings.language = 'ja';
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    mockAppendEvents.mockClear();

    const attemptId = ctx.recordGrammarAttempt('〜わけではない', 'fluent', { language: 'ja', level: 2 });
    await vi.waitFor(() => expect(ctx.getGrammarKnowledge('〜わけではない', 'ja')).toBeDefined());

    const byKey = mockAppendEvents.mock.calls[0][0] as Record<string, Array<Record<string, unknown>>>;
    const events = byKey[grammarEvidenceKey('ja', '〜わけではない', 'grammar-recognition')];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'rating',
      quality: 'fluent',
      attemptId,
      origin: 'grammar-probe',
      taskType: 'grammar-recognize',
      // Active measurement: explicit ease outcome, not an exposure bump.
      easeAfter: 1.8,
    });
    expect('timesSeenDelta' in events[0]).toBe(false);
    expect(events[0].targetRef).toMatchObject({ capability: 'grammar-recognition' });
    await new Promise((resolve) => setTimeout(resolve, SAVE_FLUSH_MS));
    dispose();
    mockSettings.language = 'ja';
  });

  it('a missed probe records negative evidence through the failure delta', async () => {
    mockSettings.language = 'ja';
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    mockAppendEvents.mockClear();

    ctx.recordGrammarAttempt('ば', 'missed', { language: 'ja' });
    await vi.waitFor(() => expect(ctx.getGrammarKnowledge('ば', 'ja')).toBeDefined());

    const byKey = mockAppendEvents.mock.calls[0][0] as Record<string, Array<Record<string, unknown>>>;
    const [event] = byKey[grammarEvidenceKey('ja', 'ば', 'grammar-recognition')];
    expect(event).toMatchObject({ kind: 'rating', quality: 'missed', grammarFailedDelta: 1 });
    expect(event.easeAfter).toBeUndefined();
    dispose();
    mockSettings.language = 'ja';
  });
});

describe('contrast-question item provenance and invalidation (R12/G03)', () => {
  beforeEach(setupMockImplementations);

  const keyFor = (language: string, pattern: string): string =>
    grammarEvidenceKey(language, pattern, 'grammar-recognition');

  it('a contrast attempt carries the versioned item reference and task type', async () => {
    mockSettings.language = 'ja';
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    mockAppendEvents.mockClear();

    const attemptId = ctx.recordGrammarAttempt('のに', 'struggled', {
      language: 'ja',
      level: 2,
      itemRef: { id: 'ja-noni-11ji-1', version: 'ja-package-2026.09.19', seed: 314159 },
      validationRef: {
        validator: 'teacher-review',
        validatorVersion: 'rubric-1',
        at: '2026-09-19T00:00:00Z',
        contentHash: 'ja-package-2026.09.19',
      },
      taskType: 'contrast-mcq',
    });
    await vi.waitFor(() => expect(ctx.getGrammarKnowledge('のに', 'ja')).toBeDefined());

    const byKey = mockAppendEvents.mock.calls[0][0] as Record<string, Array<Record<string, unknown>>>;
    const [event] = byKey[keyFor('ja', 'のに')];
    expect(event).toMatchObject({
      kind: 'rating',
      quality: 'struggled',
      attemptId,
      taskType: 'contrast-mcq',
      itemRef: { id: 'ja-noni-11ji-1', version: 'ja-package-2026.09.19', seed: 314159 },
      validationRef: {
        validator: 'teacher-review',
        validatorVersion: 'rubric-1',
        at: '2026-09-19T00:00:00Z',
        contentHash: 'ja-package-2026.09.19',
      },
    });
    dispose();
    mockSettings.language = 'ja';
  });

  it('retracting an invalidated item recomputes the projection without deleting unrelated history', async () => {
    mockSettings.language = 'de';
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    mockAppendEvents.mockClear();

    // One attempt through a (later invalidated) item, plus unrelated evidence
    // on another pattern recorded directly through the journal.
    ctx.recordGrammarAttempt('weil', 'struggled', {
      language: 'de',
      level: 3,
      itemRef: { id: 'de-weil-fieber-1', version: 'de-package-2026.09.18' },
      taskType: 'contrast-mcq',
    });
    await vi.waitFor(() => expect(ctx.getGrammarKnowledge('weil', 'de')?.ease).toBeCloseTo(1.55));

    // Unrelated evidence recorded through the normal writer (no itemRef):
    // an ordinary grammar probe on another pattern.
    const unrelatedAttemptId = ctx.recordGrammarAttempt('obwohl', 'fluent', { language: 'de', level: 3 });
    expect(unrelatedAttemptId).toBeTruthy();
    await vi.waitFor(() => expect(ctx.getGrammarKnowledge('obwohl', 'de')?.ease).toBeCloseTo(1.8));

    // Invalidation: tombstones for exactly the item's attempts, computed by
    // the pure helper from the LIVE journal (the mock journal derives its
    // rows from append calls, so it is read BEFORE any clearing), then
    // appended through the context writer; the projection re-materializes.
    const itemKey = keyFor('de', 'weil');
    const queried = await knowledgeJournal.queryKnowledgeEvents([itemKey]);
    const log = {
      [itemKey]: (queried[itemKey] ?? []).filter(
        (event) => (event as { itemRef?: unknown }).itemRef !== undefined,
      ),
    } as unknown as KnowledgeEventLog;
    expect(log[itemKey]).toHaveLength(1);
    const tombstones = retractionEventsForItem(log, { id: 'de-weil-fieber-1', version: 'de-package-2026.09.18' });
    expect(Object.keys(tombstones)).toEqual([itemKey]);
    // The mock journal derives its rows from append calls — never clear it
    // here; the tombstone append must land on a journal that still holds the
    // row being retracted and the unrelated evidence being kept.
    await ctx.retractGrammarItemAttempts(tombstones, 'de', ['weil']);
    await vi.waitFor(() => expect(ctx.getGrammarKnowledge('weil', 'de')).toBeUndefined());
    // Unrelated evidence intact.
    expect(ctx.getGrammarKnowledge('obwohl', 'de')?.ease).toBeCloseTo(1.8);
    await new Promise((resolve) => setTimeout(resolve, SAVE_FLUSH_MS));
    dispose();
    mockSettings.language = 'ja';
  });

  it('package reconcile retires only undeclared item ids and is idempotent', async () => {
    mockSettings.language = 'de';
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    mockAppendEvents.mockClear();

    ctx.recordGrammarAttempt('weil', 'struggled', {
      language: 'de',
      level: 3,
      itemRef: { id: 'de-weil-retired-1', version: 'de-package-2026.09.18' },
      taskType: 'contrast-mcq',
    });
    await vi.waitFor(() => expect(ctx.getGrammarKnowledge('weil', 'de')).toBeDefined());

    // The updated package still declares 'de-weil-fieber-1' (kept) but not
    // 'de-weil-retired-1': the retired attempt retracts, the entry vanishes.
    // Call COUNTS track appends — clearing the mock would erase the journal
    // the reconcile reads (allRows derives from append calls).
    const callsBeforeReconcile = mockAppendEvents.mock.calls.length;
    const retired = await ctx.reconcileGrammarItems('de', new Map([['de-weil-fieber-1', { version: 'de-package-2026.09.18', invalid: false } satisfies DeclaredItemState]]));
    expect(retired).toBe(1);
    await vi.waitFor(() => expect(ctx.getGrammarKnowledge('weil', 'de')).toBeUndefined());
    expect(mockAppendEvents.mock.calls.length).toBe(callsBeforeReconcile + 1);

    // Idempotent: a second reconcile over the reconciled journal appends nothing.
    const callsAfterFirst = mockAppendEvents.mock.calls.length;
    const second = await ctx.reconcileGrammarItems('de', new Map([['de-weil-fieber-1', { version: 'de-package-2026.09.18', invalid: false } satisfies DeclaredItemState]]));
    expect(second).toBe(0);
    expect(mockAppendEvents.mock.calls.length).toBe(callsAfterFirst);
    await new Promise((resolve) => setTimeout(resolve, SAVE_FLUSH_MS));
    dispose();
    mockSettings.language = 'ja';
  });

  it('package reconcile retracts attempts recorded under changed item content and keeps unchanged ones', async () => {
    mockSettings.language = 'de';
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    mockAppendEvents.mockClear();

    ctx.recordGrammarAttempt('weil', 'struggled', {
      language: 'de',
      level: 3,
      itemRef: { id: 'de-weil-fieber-1', version: itemContentVersion({ id: 'de-weil-fieber-1', context: 'x', answerSpan: 'x', conditions: [], distractors: [] }) },
      taskType: 'contrast-mcq',
    });
    ctx.recordGrammarAttempt('obwohl', 'fluent', {
      language: 'de',
      level: 3,
      itemRef: { id: 'de-obwohl-current-1', version: 'item-v1:1111111111111111' },
      taskType: 'contrast-mcq',
    });
    await vi.waitFor(() => expect(ctx.getGrammarKnowledge('weil', 'de')).toBeDefined());
    await vi.waitFor(() => expect(ctx.getGrammarKnowledge('obwohl', 'de')).toBeDefined());

    const callsBefore = mockAppendEvents.mock.calls.length;
    // Declared state: obwohl's item content unchanged → survives; weil's
    // declared content version differs → its attempt retracts.
    const retired = await ctx.reconcileGrammarItems('de', new Map<string, DeclaredItemState>([
      ['de-weil-fieber-1', { version: 'item-v1:2222222222222222', invalid: false }],
      ['de-obwohl-current-1', { version: 'item-v1:1111111111111111', invalid: false }],
    ]));
    expect(retired).toBe(0); // the item is still declared — only its content changed
    await vi.waitFor(() => expect(ctx.getGrammarKnowledge('weil', 'de')).toBeUndefined());
    expect(ctx.getGrammarKnowledge('obwohl', 'de')).toBeDefined();
    expect(mockAppendEvents.mock.calls.length).toBe(callsBefore + 1);
    await new Promise((resolve) => setTimeout(resolve, SAVE_FLUSH_MS));
    dispose();
    mockSettings.language = 'ja';
  });

  it('a repeated success on the same item does not raise the projected ease (G02)', async () => {
    mockSettings.language = 'de';
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    const ref = { id: 'de-weil-fieber-1', version: 'item-v1:3333333333333333' };
    ctx.recordGrammarAttempt('weil', 'struggled', { language: 'de', level: 3, itemRef: ref, taskType: 'contrast-mcq' });
    await vi.waitFor(() => expect(ctx.getGrammarKnowledge('weil', 'de')?.ease).toBeCloseTo(1.55));
    // The SAME item again (memorized, familiar): still measured, but the
    // projection must not read it as fresh generalization.
    ctx.recordGrammarAttempt('weil', 'fluent', { language: 'de', level: 3, itemRef: ref, taskType: 'contrast-mcq' });
    await vi.waitFor(() => expect(ctx.getGrammarKnowledge('weil', 'de')?.ease).toBeCloseTo(1.55));

    // A DIFFERENT item (fresh generalization) applies fully.
    ctx.recordGrammarAttempt('weil', 'fluent', { language: 'de', level: 3, itemRef: { id: 'de-weil-studium-2', version: 'item-v1:3333333333333333' }, taskType: 'contrast-mcq' });
    await vi.waitFor(() => expect(ctx.getGrammarKnowledge('weil', 'de')?.ease).toBeCloseTo(1.8));
    await new Promise((resolve) => setTimeout(resolve, SAVE_FLUSH_MS));
    dispose();
    mockSettings.language = 'ja';
  });
});


describe('self-assessment durable recovery', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); setupMockImplementations(); });
  it('review probe: a durable claim is recovered from journal after a missed cache save and restart', async () => {
    const first = await mountProvider();
    seed(makeEmptyStore({ rev: 0 }));
    const persisted = JSON.parse(JSON.stringify(first.ctx.store));
    const word = 'restart-probe';
    const lk = `ja:${SRS.hashWordSync(word)}`;
    await first.ctx.submitRating(word, [{ capability: 'sense-recognition', quality: 'fluent' }], { language: 'ja', selfAssessment: true, attemptId: 'claim-restart-probe' as AttemptId });
    expect(knowledgeJournal.allRows()[lk][0]).toMatchObject({ kind: 'claim', toStatus: 'known' });
    mockBridge.flashcards.saveFlashcards.mockResolvedValue(null);
    first.dispose();
    const second = await mountProvider();
    flashcardsCb(persisted);
    await vi.waitFor(() => expect(second.ctx.isKnowledgeReady()).toBe(true));
    expect(second.ctx.store.wordKnowledge[lk]).toMatchObject({ claim: 'known' });
    expect(second.ctx.getComprehensiveWordStatusWithSourceSync(word, 'ja')).toMatchObject({ status: 'known', basis: 'claim' });
    second.dispose();
  });
  it('review probe: failed clear leaves the active durable claim effective', async () => {
    const { ctx, dispose } = await mountProvider();
    seed(makeEmptyStore({ rev: 0 }));
    const word = 'clear-failure-probe';
    const lk = `ja:${SRS.hashWordSync(word)}`;
    await ctx.submitRating(word, [{ capability: 'surface-reading', quality: 'fluent' }], { language: 'ja', selfAssessment: true, attemptId: 'claim-clear-probe' as AttemptId });
    mockAppendEvents.mockImplementationOnce(async () => { mockAppendEvents.mock.calls.pop(); throw new Error('synthetic durable write failure'); });
    await ctx.clearAccessClaim(word, 'surface-reading', 'ja');
    await Promise.resolve(); await Promise.resolve();
    expect(projectCapabilities((knowledgeJournal.allRows()[lk] as KnowledgeEvent[]).map((event, seq) => ({ event, seq })))['surface-reading'].claim).toBe('known');
    expect(ctx.getAccessStatus(word, 'surface-reading', 'ja')).toMatchObject({ status: 'known', basis: 'claim' });
    dispose();
  });
  it('review probe: idempotent retry after later claim clear keeps journal latest state', async () => {
    const { ctx, dispose } = await mountProvider();
    seed(makeEmptyStore({ rev: 0 }));
    const word = 'retry-probe';
    const lk = `ja:${SRS.hashWordSync(word)}`;
    const options = { language: 'ja', selfAssessment: true, attemptId: 'claim-idempotent-probe' as AttemptId };
    await ctx.submitRating(word, [{ capability: 'sense-recognition', quality: 'fluent' }], options);
    await ctx.setWordClaim(word, null, 'ja');
    await Promise.resolve();
    await ctx.submitRating(word, [{ capability: 'sense-recognition', quality: 'fluent' }], options);
    expect(replayKeyProjection(knowledgeJournal.allRows()[lk] as KnowledgeEvent[])).toBeNull();
    expect(ctx.getComprehensiveWordStatusWithSourceSync(word, 'ja').basis).toBe('unmeasured');
    dispose();
  });
  it('followup probe: root clear failure preserves active durable claim', async () => {
    const {ctx, dispose} = await mountProvider();
    seed(makeEmptyStore({rev:0}));
    const word='root-clear-failure'; const lk=`ja:${SRS.hashWordSync(word)}`;
    await ctx.submitRating(word,[{capability:'sense-recognition',quality:'fluent'}],{language:'ja',selfAssessment:true,attemptId:'root-claim-probe' as AttemptId});
    mockAppendEvents.mockImplementationOnce(async ()=>{mockAppendEvents.mock.calls.pop(); throw new Error('synthetic root clear rejection');});
    await ctx.setWordClaim(word,null,'ja');
    await Promise.resolve(); await Promise.resolve();
    expect(replayKeyProjection(knowledgeJournal.allRows()[lk] as KnowledgeEvent[])).toMatchObject({claim:'known'});
    expect(ctx.getComprehensiveWordStatusWithSourceSync(word,'ja')).toMatchObject({status:'known',basis:'claim'});
    dispose();
  });
  it('followup probe: startup retains legacy claim alongside preexisting journal evidence', async () => {
    const word='legacy-claim-evidence'; const lk=`ja:${SRS.hashWordSync(word)}`;
    await mockAppendEvents({[lk]:[{t:1,kind:'review',source:'srs',aspect:'meaning',easeAfter:2.6}]});
    const {ctx,dispose}=await mountProvider();
    seed(makeEmptyStore({rev:0,wordKnowledge:{[lk]:{word,language:'ja',ease:2.6,lastSeen:1,timesSeen:0,timesHovered:0,hasActiveEvidence:true,lastEvidenceSource:'srs',claim:'learning',claimAt:10}}}));
    await vi.waitFor(()=>expect(ctx.isKnowledgeReady()).toBe(true));
    expect(ctx.store.wordKnowledge[lk]?.ease).toBe(2.6);
    expect(ctx.getComprehensiveWordStatusWithSourceSync(word,'ja')).toMatchObject({status:'learning',basis:'claim'});
    dispose();
  });
  it('followup probe: retry after reading claim clear stays unmeasured rather than evidence', async () => {
    const {ctx,dispose}=await mountProvider();seed(makeEmptyStore({rev:0}));
    const word='reading-noop-retry';const options={language:'ja',selfAssessment:true,attemptId:'reading-retry-probe' as AttemptId};
    await ctx.submitRating(word,[{capability:'surface-reading',quality:'fluent'}],options);
    await ctx.clearAccessClaim(word,'surface-reading','ja');
    expect(ctx.getAccessStatus(word,'surface-reading','ja').untracked).toBe(true);
    await ctx.submitRating(word,[{capability:'surface-reading',quality:'fluent'}],options);
    expect(ctx.getAccessStatus(word,'surface-reading','ja').untracked).toBe(true);
    dispose();
  });

  it('followup language probe: journal-only claim from another installed language is recovered', async () => {
    mockSettings.language='ja';
    mockLanguageDataCatalog=[{language:'ja',dictionaryPacks:[{targetLanguage:'en',installed:true}]},{language:'de',dictionaryPacks:[{targetLanguage:'en',installed:true}]}];
    const word='anderes'; const lk=`de:${SRS.hashWordSync(word)}`;
    await mockAppendEvents({[lk]:[{t:1,kind:'claim',source:'manual',toStatus:'known',presentedSurface:word,targetRef:{kind:'surface',id:`de:surface:${SRS.hashWordSync(word)}`,capability:'sense-recognition'}}]});
    const {ctx,dispose}=await mountProvider();seed(makeEmptyStore({rev:0}));
    await vi.waitFor(()=>expect(ctx.isKnowledgeReady()).toBe(true));
    expect(ctx.getComprehensiveWordStatusWithSourceSync(word,'de')).toMatchObject({status:'known',basis:'claim'});
    dispose();
  });

  it('marker review probe: startup does not resurrect a retracted self-assessment from stale cache', async () => {
    const word='retracted-claim'; const lk=`ja:${SRS.hashWordSync(word)}`;
    await mockAppendEvents({[lk]:[
      {t:1,kind:'claim',source:'manual',toStatus:'known',attemptId:'retracted-self-claim',presentedSurface:word,targetRef:{kind:'surface',id:`ja:surface:${SRS.hashWordSync(word)}`,capability:'sense-recognition'}},
      {t:2,kind:'retraction',source:'manual',retracts:'retracted-self-claim'}
    ]});
    const {ctx,dispose}=await mountProvider();
    seed(makeEmptyStore({rev:0,wordKnowledge:{[lk]:{word,language:'ja',ease:SRS.MIN_EASE,lastSeen:1,timesSeen:0,timesHovered:0,claim:'known',claimAt:1}}}));
    await vi.waitFor(()=>expect(ctx.isKnowledgeReady()).toBe(true));
    expect(ctx.getComprehensiveWordStatusWithSourceSync(word,'ja').basis).toBe('unmeasured');
    dispose();
  });
  it('marker review probe: claim over passive cache does not migrate passive exposure to active evidence', async () => {
    const word='passive-claimed-cache'; const lk=`ja:${SRS.hashWordSync(word)}`;
    const {ctx,dispose}=await mountProvider();
    seed(makeEmptyStore({rev:0,wordKnowledge:{[lk]:{word,language:'ja',ease:1.7,lastSeen:1,timesSeen:5,timesHovered:1,hasActiveEvidence:false,lastEvidenceSource:'passiveTracking',claim:'known',claimAt:2}}}));
    await vi.waitFor(()=>expect(ctx.isKnowledgeReady()).toBe(true));
    expect(ctx.getComprehensiveWordStatusWithSourceSync(word,'ja').basis).toBe('claim');
    await ctx.setWordClaim(word,null,'ja');
    expect(ctx.getComprehensiveWordStatusWithSourceSync(word,'ja').basis).toBe('unmeasured');
    expect(ctx.store.wordKnowledge[lk]?.hasActiveEvidence).toBe(false);
    dispose();
  });

  it('evidence flag probe: real attempt after written claim sets evidence presence and preserves lexical measurement', async () => {
    const {ctx,dispose}=await mountProvider();seed(makeEmptyStore({rev:0}));
    const word='written-claim-then-attempt';const lk=`ja:${SRS.hashWordSync(word)}`;
    await ctx.submitRating(word,[{capability:'surface-recognition',quality:'missed'}],{language:'ja',selfAssessment:true,attemptId:'written-self-probe' as AttemptId});
    expect(ctx.store.wordKnowledge[lk]?.access?.['surface-recognition']?.hasEvidence).toBe(false);
    await ctx.submitRating(word,[{capability:'surface-recognition',quality:'fluent',method:'recall'}],{language:'ja',attemptId:'written-active-probe' as AttemptId});
    expect(ctx.getComprehensiveWordStatusWithSourceSync(word,'ja')).toMatchObject({status:'known',basis:'evidence'});
    expect(ctx.store.wordKnowledge[lk]?.access?.['surface-recognition']?.hasEvidence).toBe(true);
    dispose();
  });

});

describe('study preference replay records', () => {
  it.each([20, 40])('preserves complete preference metadata when replaying a local change at %i', async updatedAt => {
    const { recordStoreDelta, mergeIntentOnto } = await import('./FlashcardContext');
    const previous = { word: 'target', language: 'package-x', reading: 'authored', ignoredAt: 10,
      excluded: false, updatedAt: 30 };
    const base = { ignoredWords: { key: previous } };
    const changed = { ...previous, excluded: true, updatedAt };
    const delta = {};
    recordStoreDelta(delta, base, { ignoredWords: { key: changed } });
    const target = structuredClone(base);
    mergeIntentOnto(target, delta);
    expect(target.ignoredWords.key).toEqual(updatedAt > 30 ? changed : previous);
  });
  it('does not interpret an unknown nested field as a root study preference map', async () => {
    const { mergeIntentOnto } = await import('./FlashcardContext');
    const target = { meta: { packageData: { ignoredWords: { arbitrary: { custom: 1 } } } } };
    mergeIntentOnto(target, { meta: { packageData: { ignoredWords: { arbitrary: { custom: 2 } } } } });
    expect(target.meta.packageData.ignoredWords.arbitrary.custom).toBe(2);
  });
});
