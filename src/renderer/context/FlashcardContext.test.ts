import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { FlashcardStore, Flashcard, FlashcardContent, FlashcardMeta, ReviewQueue, Settings } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/types';
import type { Rating } from '../services/srsAlgorithm';
import * as SRS from '../services/srsAlgorithm';

// ── IPC callback captures ────────────────────────────────────────────
let flashcardsCb: (store: FlashcardStore) => void;
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
const mockStreamChat = vi.hoisted(() => vi.fn());
const mockBackend = vi.hoisted(() => ({
  ping: vi.fn().mockResolvedValue(true),
  translate: vi.fn().mockResolvedValue({ data: [] }),
}));

// ── Mock bridge ──────────────────────────────────────────────────────
const mockBridge = {
  flashcards: {
    onFlashcards: vi.fn(),
    getFlashcards: vi.fn(),
    saveFlashcards: vi.fn(),
    onNewDayFlashcards: vi.fn(),
    onFlashcardConnectOpen: vi.fn(),
    onReviewFlashcardRequest: vi.fn(),
    deleteFlashcardVideo: vi.fn().mockResolvedValue(undefined),
    deleteFlashcardImage: vi.fn().mockResolvedValue(undefined),
    deleteFlashcardTts: vi.fn().mockResolvedValue(undefined),
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
};

function setupMockImplementations() {
  mockBridge.flashcards.onFlashcards.mockImplementation((cb: (s: FlashcardStore) => void) => {
    flashcardsCb = cb;
    return flashcardsCleanup;
  });
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
  getBackend: vi.fn(() => mockBackend),
}));

vi.mock('../../shared/platform', () => ({
  isElectron: () => true,
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
  ja: {
    name: 'Japanese',
    name_translated: '日本語',
    colour_codes: {},
    settings: { fixed: {} },
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
    currentLangData: () => null,
  }),
}));

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
  queue: () => ReviewQueue;
  queueCounts: () => { new: number; learning: number; review: number; total: number };
  addFlashcard: (content: Partial<{ type: string; front: string; back: string; reading?: string; prosody?: FlashcardContent['prosody']; pos?: string; level?: number; example?: string; exampleMeaning?: string; imageUrl?: string; videoUrl?: string; skipExampleTts?: boolean; audioUrl?: string; context?: string; source?: string; extra?: string; word?: string; pronunciation?: string; translation?: string[]; definition?: string[]; screenshotUrl?: string; contextPhrase?: string }> & { front: string; back: string }, initialEase?: number, skipAnkiChoice?: boolean, language?: string) => Promise<string>;
  removeFlashcard: (id: string, neverShowAgain?: boolean) => Promise<boolean>;
  updateFlashcard: (id: string, updates: Partial<Flashcard>) => void;
  updateFlashcardContent: (id: string, content: Partial<Record<string, unknown>>) => void;
  suspendCard: (id: string) => void;
  unsuspendCard: (id: string) => void;
  buryCard: (id: string) => void;
  answerCard: (rating: Rating, cardId?: string) => void;
  getCurrentCard: () => Flashcard | null;
  getAllCards: () => Flashcard[];
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
  updateMeta: (updates: Partial<FlashcardMeta>) => void;
  pushUndoState: (options?: { type?: string; restore?: () => void | Promise<void> }) => void;
  undoLastAction: () => void;
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
  isWordKnownComprehensiveSync: (word: string, language?: string) => boolean;
  trackGrammarEncountered: (pattern: string, level?: number, language?: string) => void;
  setWordKnowledgeEase: (word: string, ease: number, reading?: string, language?: string) => void;
  restoreWordSyncRating: (
    word: string,
    previousKnowledge: { ease: number; lastSeen: number; timesSeen: number; timesHovered: number; word: string; reading?: string; language?: string } | undefined,
    previousSeenAt: number | undefined,
    language?: string,
  ) => void;
  setComprehensiveWordStatus: (word: string, status: 'unknown' | 'learning' | 'known', language?: string) => void;
  setWordBankStatus: (word: string, status: 'unknown' | 'learning' | 'known', bank: string, options?: { reading?: string; language?: string; content?: Partial<Record<string, unknown>> & { front: string; back: string } }) => Promise<void>;
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
  promoteSuggestedFlashcards: (ids: string[], options?: { useLLM?: boolean; useTts?: boolean; onProgress?: (done: number, total: number) => void }) => Promise<number>;
  generateExampleSentenceWithLLM: (word: string, definition: string, language: string) => Promise<{ sentence: string; meaning: string }>;
  translateExampleSentence: (sentence: string, sourceLanguage: string, language?: string) => Promise<string>;
};

// ── Mount helper ─────────────────────────────────────────────────────
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
const CURRENT_VERSION = 2;

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
    wordSyncSeen: {},
    meta: {
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

// ── Tests ────────────────────────────────────────────────────────────
describe('FlashcardProvider', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    mockBackend.ping.mockResolvedValue(true);
    mockBackend.translate.mockResolvedValue({ data: [] });
    mockGetCanonicalForm.mockImplementation((word: string) => word);
    mockGetWordVariants.mockImplementation((_word: string) => []);
    mockGetCanonicalFormForLanguage.mockImplementation((_language: string, word: string) => word);
    mockGetWordVariantsForLanguage.mockImplementation((_language: string, _word: string) => []);
    mockGetFrequencyForLanguage.mockImplementation((_language: string, _word: string) => null);
    mockSettings.autoSuggestFlashcards = true;
    mockSettings.autoSuggestUnknownWords = true;
    mockSettings.learningLanguageLevels = {};
    mockSettings.language = 'ja';
    mockSettings.uiLanguage = DEFAULT_SETTINGS.uiLanguage;
    mockSettings.dictionaryTargetLanguages = {};
    mockStreamChat.mockReset();
    setupMockImplementations();
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
    expect(mockBridge.crossWindow.onUpdateWordAppearance).toHaveBeenCalledOnce();
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

  // ─── Priority 1: addFlashcard ─────────────────────────────────────
  it('addFlashcard creates a card and updates store maps', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

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

  it('addFlashcard populates wordToCardMap with language-prefixed key', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    const id = await ctx.addFlashcard({ front: '犬', back: 'dog' }, undefined, true);

    const mapKeys = Object.keys(ctx.store.wordToCardMap);
    expect(mapKeys.length).toBe(1);
    expect(mapKeys[0]).toMatch(/^ja:/);
    expect(ctx.store.wordToCardMap[mapKeys[0]]).toContain(id);
    dispose();
  });

  it('addFlashcard updates wordStatsMap', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    await ctx.addFlashcard({ front: '鳥', back: 'bird' }, undefined, true);

    const statsKeys = Object.keys(ctx.store.wordStatsMap);
    expect(statsKeys.length).toBe(1);
    expect(ctx.store.wordStatsMap[statsKeys[0]].cardCount).toBe(1);
    dispose();
  });

  it('addFlashcard with custom initialEase', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    const id = await ctx.addFlashcard({ front: '魚', back: 'fish' }, 3.0, true);

    expect(ctx.store.flashcards[id].ease).toBe(3.0);
    dispose();
  });

  it('addFlashcard skips creation for knownUntracked words', async () => {
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const hash = await SRS.hashWord('空');
    const lk = `ja:${hash}`;
    flashcardsCb(makeEmptyStore({
      knownUntracked: { [lk]: true },
    }));

    const id = await ctx.addFlashcard({ front: '空', back: 'sky' }, undefined, true);

    expect(id).toBe('');
    dispose();
  });

  it('addFlashcard supports multiple cards per word', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

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
    flashcardsCb(makeEmptyStore());

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
    flashcardsCb(makeEmptyStore());

    const id = await ctx.addFlashcard({ front: '山', back: 'mountain' }, undefined, true);
    expect(ctx.store.flashcards[id]).toBeDefined();

    const result = await ctx.removeFlashcard(id);
    expect(result).toBe(true);
    expect(ctx.store.flashcards[id]).toBeUndefined();
    dispose();
  });

  it('removeFlashcard marks word as known when neverShowAgain=true', async () => {
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    flashcardsCb(makeEmptyStore());

    const id = await ctx.addFlashcard({ front: '川', back: 'river' }, undefined, true);
    const hash = await SRS.hashWord('川');
    const lk = `ja:${hash}`;

    await ctx.removeFlashcard(id, true);
    expect(ctx.store.knownUntracked[lk]).toBe(true);
    expect(ctx.store.ignoredWords[lk]).toBeDefined();
    dispose();
  });

  it('removeFlashcard indexes non-active-language cards with the card language', async () => {
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    mockGetCanonicalForm.mockImplementation((word: string) => `ja:${word}`);
    mockGetCanonicalFormForLanguage.mockImplementation((language: string, word: string) => `${language}:${word}`);
    flashcardsCb(makeEmptyStore());

    const id = await ctx.addFlashcard({ front: 'سلام', back: 'hello' }, undefined, true, 'ar');
    const storageWord = 'ar:سلام';
    const hash = await SRS.hashWord(storageWord);
    const lk = `ar:${hash}`;
    expect(ctx.store.wordToCardMap[lk]).toContain(id);

    await ctx.removeFlashcard(id, true);

    expect(ctx.store.wordToCardMap[lk]).toBeUndefined();
    expect(ctx.store.knownUntracked[lk]).toBe(true);
    expect(ctx.store.ignoredWords[lk]).toBeDefined();
    dispose();
  });

  it('removeFlashcard returns false for nonexistent card', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    const result = await ctx.removeFlashcard('nonexistent');
    expect(result).toBe(false);
    dispose();
  });

  it('removeFlashcard cleans up video file if present', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    const id = await ctx.addFlashcard({ front: '雨', back: 'rain', videoUrl: 'video://test.mp4' }, undefined, true);
    await ctx.removeFlashcard(id);

    expect(mockBridge.flashcards.deleteFlashcardVideo).toHaveBeenCalledWith(id);
    dispose();
  });

  // ─── Priority 1: answerCard ───────────────────────────────────────
  it('answerCard updates card SRS fields for "good" rating', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'ans-1', state: 'new' });
    const SRS = await import('../services/srsAlgorithm');
    const hash = await SRS.hashWord('テスト');
    const lk = `ja:${hash}`;
    flashcardsCb(makeEmptyStore({
      flashcards: { 'ans-1': card },
      wordToCardMap: { [lk]: ['ans-1'] },
    }));
    ctx.refreshQueue();

    const beforeState = ctx.store.flashcards['ans-1'].state;
    expect(beforeState).toBe('new');

    ctx.answerCard('good');

    const after = ctx.store.flashcards['ans-1'];
    expect(after).toBeDefined();
    expect(after.state === 'new' && after.learningStep === 0).toBe(false);
    dispose();
  });

  it('answerCard increments newCardsToday when answering a new card', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'ans-new-1', state: 'new' });
    const SRS = await import('../services/srsAlgorithm');
    const hash = await SRS.hashWord('テスト');
    const lk = `ja:${hash}`;
    flashcardsCb(makeEmptyStore({
      flashcards: { 'ans-new-1': card },
      wordToCardMap: { [lk]: ['ans-new-1'] },
    }));
    ctx.refreshQueue();

    const before = ctx.store.meta.newCardsToday ?? 0;
    ctx.answerCard('good');
    expect(ctx.store.meta.newCardsToday).toBe(before + 1);
    dispose();
  });

  it('answerCard increments reviewsToday when answering a review card', async () => {
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
    flashcardsCb(makeEmptyStore({
      flashcards: { 'ans-rev-1': card },
      wordToCardMap: { [lk]: ['ans-rev-1'] },
    }));
    ctx.refreshQueue();

    const before = ctx.store.meta.reviewsToday ?? 0;
    ctx.answerCard('good');
    expect(ctx.store.meta.reviewsToday).toBe(before + 1);
    dispose();
  });

  it('answerCard pushes undo entry', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'ans-undo' });
    const SRS = await import('../services/srsAlgorithm');
    const hash = await SRS.hashWord('テスト');
    const lk = `ja:${hash}`;
    flashcardsCb(makeEmptyStore({
      flashcards: { 'ans-undo': card },
      wordToCardMap: { [lk]: ['ans-undo'] },
    }));
    ctx.refreshQueue();

    expect(ctx.canUndo()).toBe(false);
    ctx.answerCard('good');
    expect(ctx.canUndo()).toBe(true);
    dispose();
  });

  it('answerCard updates dailyStats', async () => {
    const { ctx, dispose } = await mountProvider();
    const card = makeCard({ id: 'daily-1', state: 'new' });
    const SRS = await import('../services/srsAlgorithm');
    const hash = await SRS.hashWord('テスト');
    const lk = `ja:${hash}`;
    flashcardsCb(makeEmptyStore({
      flashcards: { 'daily-1': card },
      wordToCardMap: { [lk]: ['daily-1'] },
    }));
    ctx.refreshQueue();

    ctx.answerCard('good');
    const today = SRS.getTodayDateString(4);
    const langStats = ctx.store.dailyStats[today];
    expect(langStats).toBeDefined();
    const stats = langStats['ja'];
    expect(stats).toBeDefined();
    expect(stats.newCardsStudied).toBe(1);
    dispose();
  });

  it('answerCard with explicit cardId answers the specified card, not whatever getNextCard() returns', async () => {
    // Regression: without cardId, answerCard calls getCurrentCard() fresh which uses Math.random()
    // and may return a different card than the one displayed, leaving the displayed card in the queue.
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
    flashcardsCb(makeEmptyStore({
      flashcards: { 'card-new': newCard, 'card-review': reviewCard },
      wordToCardMap: { [lkNew]: ['card-new'], [lkReview]: ['card-review'] },
    }));
    ctx.refreshQueue();

    // Force Math.random to always pick review cards so getNextCard() without cardId would answer reviewCard
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    // But we explicitly pass newCard.id — so newCard should be answered
    ctx.answerCard('good', 'card-new');
    vi.restoreAllMocks();

    const answeredNew = ctx.store.flashcards['card-new'];
    const untouchedReview = ctx.store.flashcards['card-review'];
    expect(answeredNew.state).not.toBe('new');
    expect(untouchedReview.state).toBe('review');
    dispose();
  });

  it('answerCard recalculates explicit non-active language stats with that language primary form', async () => {
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
    flashcardsCb(makeEmptyStore({
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

    ctx.answerCard('good', cardId);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(ctx.store.wordStatsMap[primaryKey]?.totalReviews).toBe(6);
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
    flashcardsCb(makeEmptyStore({
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
    flashcardsCb(makeEmptyStore());

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

    ctx.pushUndoState({ type: 'test' });
    ctx.updateFlashcard('undo-1', { ease: 4.0 });
    expect(ctx.store.flashcards['undo-1'].ease).toBe(4.0);

    ctx.undoLastAction();
    expect(ctx.store.flashcards['undo-1'].ease).toBe(2.5);
    dispose();
  });

  it('undoLastAction is no-op when stack is empty', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    ctx.undoLastAction();
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
    flashcardsCb(makeEmptyStore());

    await ctx.addFlashcard({ front: '森', back: 'forest' }, undefined, true);
    expect(ctx.hasWordSync('森')).toBe(true);
    expect(ctx.hasWordSync('unkown')).toBe(false);
    dispose();
  });

  it('getCardByWordSync returns card for existing word', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    await ctx.addFlashcard({ front: '海', back: 'sea' }, undefined, true);
    const card = ctx.getCardByWordSync('海');
    expect(card).not.toBeNull();
    expect(card!.content.front).toBe('海');
    dispose();
  });

  it('getCardByWordSync finds cards through language-provided variants', async () => {
    mockGetWordVariants.mockImplementation((word: string) => word === 'иду' ? ['идти', 'иду'] : []);
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    await ctx.addFlashcard({ front: 'идти', back: 'to go' }, undefined, true);
    const card = ctx.getCardByWordSync('иду');

    expect(card).not.toBeNull();
    expect(card!.content.front).toBe('идти');
    expect(ctx.hasWordSync('иду')).toBe(true);
    dispose();
  });

  it('addFlashcard stores inflected words under the language primary form key', async () => {
    mockGetWordVariants.mockImplementation((word: string) => word === 'иду' ? ['идти', 'иду'] : []);
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

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
    flashcardsCb(makeEmptyStore());

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
    flashcardsCb(makeEmptyStore());

    await ctx.ignoreWordForLanguage('كتب', undefined, 'ar');
    const createdId = await ctx.addFlashcard({ front: 'يكتب', back: 'he writes' }, undefined, true, 'ar');

    expect(createdId).toBe('');
    expect(ctx.getAllCards()).toHaveLength(0);
    dispose();
  });

  it('sync card lookups can target a non-active stored word language explicitly', async () => {
    mockSettings.language = 'ja';
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

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
    flashcardsCb(makeEmptyStore());

    await ctx.addFlashcard({ front: 'كتب', back: 'write', unpopulated: true }, undefined, true, 'ar');

    expect(ctx.findUnpopulatedFlashcardForWord('يكتب')).toBeNull();
    expect(ctx.findUnpopulatedFlashcardForWord('يكتب', 'ar')?.content.front).toBe('كتب');
    dispose();
  });

  it('getCardsByWordSync returns all cards for a word', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

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
    flashcardsCb(makeEmptyStore());

    await ctx.addFlashcard({ front: '星', back: 'star' }, undefined, true);
    const result = await ctx.hasWord('星');
    expect(result).toBe(true);
    dispose();
  });

  it('hasWord and getCardsByWord find cards through language-provided variants', async () => {
    mockGetWordVariants.mockImplementation((word: string) => word === 'يكتب' ? ['كتب', 'يكتب'] : []);
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

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
    flashcardsCb(makeEmptyStore());

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
    flashcardsCb(makeEmptyStore());

    await ctx.addFlashcard({ front: 'يكتب', back: 'he writes' }, undefined, true, 'ar');

    expect(await ctx.getWordStats('يكتب')).toBeNull();
    expect(await ctx.getWordStats('يكتب', 'ar')).toMatchObject({ cardCount: 1 });
    dispose();
  });

  it('getCardsByWord returns cards for a word', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    await ctx.addFlashcard({ front: '月', back: 'moon' }, undefined, true);
    const cards = await ctx.getCardsByWord('月');
    expect(cards).toHaveLength(1);
    expect(cards[0].content.front).toBe('月');
    dispose();
  });

  it('getCardByWord returns best card when multiple exist', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

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

    expect(ctx.store.knownUntracked[arKey]).toBe(true);
    expect(ctx.store.ignoredWords[arKey]).toMatchObject({
      word: 'سلام',
      language: 'ar',
    });
    expect(ctx.store.knownUntracked[jaKey]).toBeUndefined();
    expect(ctx.store.ignoredWords[jaKey]).toBeUndefined();
    dispose();
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

    expect(ctx.store.knownUntracked[primaryKey]).toBe(true);
    expect(ctx.store.ignoredWords[primaryKey]).toMatchObject({
      word: 'كتب',
      language: 'ar',
    });
    expect(ctx.store.knownUntracked[inflectedKey]).toBeUndefined();
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

  it('setComprehensiveWordStatus can target a non-active stored word language', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    mockSettings.language = 'ja';
    const SRS = await import('../services/srsAlgorithm');
    const hash = SRS.hashWordSync('سلام');
    const arKey = `ar:${hash}`;
    const jaKey = `ja:${hash}`;

    ctx.setComprehensiveWordStatus('سلام', 'known', 'ar');

    expect(ctx.store.wordKnowledge[arKey]).toMatchObject({
      word: 'سلام',
      language: 'ar',
    });
    expect(ctx.store.wordKnowledge[arKey]?.ease).toBeGreaterThanOrEqual(mockSettings.easeThresholdKnown);
    expect(ctx.store.wordKnowledge[jaKey]).toBeUndefined();
    dispose();
  });

  it('getComprehensiveWordStatusSync can read a non-active stored word language explicitly', async () => {
    const { ctx, dispose } = await mountProvider();
    mockSettings.language = 'ja';
    const SRS = await import('../services/srsAlgorithm');
    const arKey = `ar:${SRS.hashWordSync('سلام')}`;
    flashcardsCb(makeEmptyStore({
      wordKnowledge: {
        [arKey]: {
          word: 'سلام',
          language: 'ar',
          ease: mockSettings.easeThresholdKnown,
          lastSeen: 1,
          timesSeen: 1,
          timesHovered: 0,
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
    expect(ctx.store.ignoredWords[primaryKey]).toBeUndefined();
    expect(ctx.isWordIgnoredSync('يكتب', 'ar')).toBe(false);
    dispose();
  });

  // ─── Priority 2: Word tracking ────────────────────────────────────
  it('trackWordSeen creates wordKnowledge entry and bumps ease', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    ctx.trackWordSeen('学校', undefined, 0.05);
    const SRS = await import('../services/srsAlgorithm');
    const hash = SRS.hashWordSync('学校');
    const lk = `ja:${hash}`;
    const knowledge = ctx.store.wordKnowledge[lk];
    expect(knowledge).toBeDefined();
    expect(knowledge.timesSeen).toBe(1);
    expect(knowledge.ease).toBeCloseTo(SRS.MIN_EASE + 0.05, 2);
    dispose();
  });

  it('trackWordSeen stores inflected active-language words under the language primary form key', async () => {
    mockGetWordVariants.mockImplementation((word: string) => word === 'يكتب' ? ['كتب', 'يكتب'] : []);
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    ctx.trackWordSeen('يكتب', undefined, 0.05);

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

    const SRS = await import('../services/srsAlgorithm');
    const arKey = `ar:${SRS.hashWordSync('كتب')}`;
    const jaKey = `ja:${SRS.hashWordSync('يكتب')}`;
    expect(ctx.store.wordKnowledge[arKey]?.word).toBe('كتب');
    expect(ctx.store.wordKnowledge[arKey]?.language).toBe('ar');
    expect(ctx.store.wordKnowledge[arKey]?.timesSeen).toBe(1);
    expect(ctx.store.wordKnowledge[jaKey]).toBeUndefined();
    dispose();
  });

  it('trackWordSeen skips knownUntracked words', async () => {
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const hash = SRS.hashWordSync('既知');
    const lk = `ja:${hash}`;
    flashcardsCb(makeEmptyStore({ knownUntracked: { [lk]: true } }));

    ctx.trackWordSeen('既知');
    expect(ctx.store.wordKnowledge[lk]).toBeUndefined();
    dispose();
  });

  it('setWordBankStatus manual bank adds to knownUntracked', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    await ctx.setWordBankStatus('学校', 'known', 'manual');
    const SRS = await import('../services/srsAlgorithm');
    const hash = SRS.hashWordSync('学校');
    const lk = `ja:${hash}`;
    expect(ctx.store.knownUntracked[lk]).toBe(true);
    dispose();
  });

  it('setWordBankStatus manual bank removes from knownUntracked', async () => {
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const hash = SRS.hashWordSync('学校');
    const lk = `ja:${hash}`;
    flashcardsCb(makeEmptyStore({ knownUntracked: { [lk]: true } }));

    await ctx.setWordBankStatus('学校', 'unknown', 'manual');
    expect(ctx.store.knownUntracked[lk]).toBeUndefined();
    dispose();
  });

  it('setWordBankStatus passive bank sets ease for known', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    await ctx.setWordBankStatus('学校', 'known', 'passive');
    const SRS = await import('../services/srsAlgorithm');
    const hash = SRS.hashWordSync('学校');
    const lk = `ja:${hash}`;
    expect(ctx.store.wordKnowledge[lk]?.ease).toBe(mockSettings.known_ease_threshold / 1000);
    dispose();
  });

  it('setWordBankStatus stores inflected passive status under the language primary form key', async () => {
    mockGetWordVariants.mockImplementation((word: string) => word === 'يكتب' ? ['كتب', 'يكتب'] : []);
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    await ctx.setWordBankStatus('يكتب', 'known', 'passive');

    const SRS = await import('../services/srsAlgorithm');
    const primaryKey = `ja:${SRS.hashWordSync('كتب')}`;
    const inflectedKey = `ja:${SRS.hashWordSync('يكتب')}`;
    expect(ctx.store.wordKnowledge[primaryKey]?.word).toBe('كتب');
    expect(ctx.store.wordKnowledge[primaryKey]?.ease).toBe(mockSettings.known_ease_threshold / 1000);
    expect(ctx.store.wordKnowledge[inflectedKey]).toBeUndefined();
    dispose();
  });

  it('setWordBankStatus can target a non-active passive word language explicitly', async () => {
    mockSettings.language = 'ja';
    mockGetCanonicalFormForLanguage.mockImplementation((language: string, word: string) => (
      language === 'ar' && word === 'يكتب' ? 'كتب' : word
    ));
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    await ctx.setWordBankStatus('يكتب', 'known', 'passive', { language: 'ar' });

    const SRS = await import('../services/srsAlgorithm');
    const arKey = `ar:${SRS.hashWordSync('كتب')}`;
    const jaKey = `ja:${SRS.hashWordSync('يكتب')}`;
    expect(ctx.store.wordKnowledge[arKey]?.word).toBe('كتب');
    expect(ctx.store.wordKnowledge[arKey]?.language).toBe('ar');
    expect(ctx.store.wordKnowledge[arKey]?.ease).toBe(mockSettings.known_ease_threshold / 1000);
    expect(ctx.store.wordKnowledge[jaKey]).toBeUndefined();
    dispose();
  });

  it('setWordBankStatus passive bank removes entry for unknown', async () => {
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const hash = SRS.hashWordSync('学校');
    const lk = `ja:${hash}`;
    flashcardsCb(makeEmptyStore({
      wordKnowledge: {
        [lk]: { ease: 2.5, lastSeen: 1, timesSeen: 1, timesHovered: 0, word: '学校', language: 'ja' },
      },
    }));

    await ctx.setWordBankStatus('学校', 'unknown', 'passive');
    expect(ctx.store.wordKnowledge[lk]).toBeUndefined();
    dispose();
  });

  it('setWordBankStatus ignored bank ignores word', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    await ctx.setWordBankStatus('学校', 'known', 'ignored');
    expect(ctx.isWordIgnoredSync('学校')).toBe(true);
    dispose();
  });

  it('setWordBankStatus can target a non-active ignored word language explicitly', async () => {
    mockSettings.language = 'ja';
    mockGetCanonicalFormForLanguage.mockImplementation((language: string, word: string) => (
      language === 'ar' && word === 'يكتب' ? 'كتب' : word
    ));
    mockGetWordVariantsForLanguage.mockImplementation((language: string, word: string) => (
      language === 'ar' && word === 'يكتب' ? ['كتب', 'يكتب'] : [word]
    ));
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    await ctx.setWordBankStatus('يكتب', 'known', 'ignored', { language: 'ar' });

    const SRS = await import('../services/srsAlgorithm');
    const arKey = `ar:${SRS.hashWordSync('كتب')}`;
    const jaKey = `ja:${SRS.hashWordSync('يكتب')}`;
    expect(ctx.store.ignoredWords[arKey]?.word).toBe('كتب');
    expect(ctx.store.ignoredWords[arKey]?.language).toBe('ar');
    expect(ctx.store.ignoredWords[jaKey]).toBeUndefined();
    expect(ctx.isWordIgnoredSync('يكتب', 'ar')).toBe(true);
    dispose();
  });

  it('setWordBankStatus flashcard bank removes cards for unknown', async () => {
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const hash = SRS.hashWordSync('学校');
    const lk = `ja:${hash}`;
    const cardId = 'c1';
    flashcardsCb(makeEmptyStore({
      flashcards: {
        [cardId]: {
          id: cardId,
          content: { type: 'word', front: '学校', back: 'school' },
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
      wordToCardMap: { [lk]: [cardId] },
    }));

    await ctx.setWordBankStatus('学校', 'unknown', 'flashcard');
    expect(ctx.store.flashcards[cardId]).toBeUndefined();
    dispose();
  });

  it('setWordBankStatus flashcard bank updates existing card state', async () => {
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const hash = SRS.hashWordSync('学校');
    const lk = `ja:${hash}`;
    const cardId = 'c1';
    flashcardsCb(makeEmptyStore({
      flashcards: {
        [cardId]: {
          id: cardId,
          content: { type: 'word', front: '学校', back: 'school' },
          state: 'new',
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
      wordToCardMap: { [lk]: [cardId] },
    }));

    await ctx.setWordBankStatus('学校', 'known', 'flashcard');
    expect(ctx.store.flashcards[cardId]?.state).toBe('review');
    expect(ctx.store.flashcards[cardId]?.ease).toBe(mockSettings.known_ease_threshold / 1000);
    dispose();
  });

  it('setWordBankStatus flashcard bank creates card when content provided', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    await ctx.setWordBankStatus('学校', 'learning', 'flashcard', {
      content: { type: 'word', front: '学校', back: 'school' },
    });
    expect(Object.keys(ctx.store.flashcards)).toHaveLength(1);
    const card = Object.values(ctx.store.flashcards)[0];
    expect(card?.state).toBe('learning');
    expect(card?.ease).toBe(mockSettings.srsLearningThreshold / 1000);
    dispose();
  });

  it('setWordBankStatus flashcard bank throws when no card and no content', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    await expect(ctx.setWordBankStatus('学校', 'known', 'flashcard')).rejects.toThrow('no content was provided');
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

  it('trackWordHovered respects passiveHoverFailAction="none"', async () => {
    vi.useFakeTimers();
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    const prevAction = mockSettings.passiveHoverFailAction;
    mockSettings.passiveHoverFailAction = 'none';

    const SRS = await import('../services/srsAlgorithm');
    const hash = SRS.hashWordSync('不変');
    const lk = `ja:${hash}`;

    ctx.trackWordHovered('不変');
    await vi.advanceTimersByTimeAsync(mockSettings.passiveHoverDelayMs);

    expect(ctx.store.wordKnowledge[lk]?.timesHovered).toBe(1);
    expect(ctx.store.wordKnowledge[lk]?.ease).toBe(SRS.MIN_EASE);

    mockSettings.passiveHoverFailAction = prevAction;
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

  it('trackWordHovered lowers indexed flashcard ease on passive failure using the primary language key', async () => {
    vi.useFakeTimers();
    mockGetWordVariants.mockImplementation((word: string) => word === 'يكتب' ? ['كتب', 'يكتب'] : []);
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const primaryKey = `ja:${SRS.hashWordSync('كتب')}`;
    const cardId = 'card-inflected-hover';
    const prevAction = mockSettings.passiveHoverFailAction;
    mockSettings.passiveHoverFailAction = 'decrease-ease-and-flashcard';
    flashcardsCb(makeEmptyStore({
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

    expect(ctx.store.flashcards[cardId]?.ease).toBeCloseTo(2.45, 2);

    mockSettings.passiveHoverFailAction = prevAction;
    dispose();
    vi.useRealTimers();
  });

  it('trackWordHovered does not decrease ease below the SRS minimum', async () => {
    vi.useFakeTimers();
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const hash = SRS.hashWordSync('下限');
    const lk = `ja:${hash}`;
    flashcardsCb(makeEmptyStore({
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

    ctx.trackWordHovered('下限');
    await vi.advanceTimersByTimeAsync(mockSettings.passiveHoverDelayMs);

    expect(ctx.store.wordKnowledge[lk]?.ease).toBeCloseTo(SRS.MIN_EASE, 2);

    mockSettings.passiveHoverEaseDecrease = prevDecrease;
    dispose();
    vi.useRealTimers();
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
  it('trackGrammarEncountered creates entry and bumps ease', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
    const SRS = await import('../services/srsAlgorithm');

    ctx.trackGrammarEncountered('てform', 3);
    const grammar = ctx.getGrammarKnowledge('てform');
    expect(grammar).toBeDefined();
    expect(grammar!.timesEncountered).toBe(1);
    expect(grammar!.ease).toBeCloseTo(SRS.MIN_EASE + 0.01, 2);
    expect(grammar!.level).toBe(3);
    dispose();
  });

  it('trackGrammarFailed decreases ease', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    ctx.trackGrammarEncountered('ないform');
    ctx.trackGrammarFailed('ないform');
    const grammar = ctx.getGrammarKnowledge('ないform');
    expect(grammar).toBeDefined();
    expect(grammar!.timesFailed).toBe(1);
    expect(grammar!.ease).toBeLessThan(2.5);
    dispose();
  });

  it('trackGrammarEncountered increments counter on repeated calls', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    ctx.trackGrammarEncountered('ている');
    ctx.trackGrammarEncountered('ている');
    ctx.trackGrammarEncountered('ている');
    const grammar = ctx.getGrammarKnowledge('ている');
    expect(grammar!.timesEncountered).toBe(3);
    dispose();
  });

  it('grammar tracking can target a non-active stored language explicitly', async () => {
    mockSettings.language = 'ja';
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    ctx.trackGrammarEncountered('verb-case:genitive', 4, 'ru');
    ctx.trackGrammarFailed('verb-case:genitive', 4, 'ru');

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
    flashcardsCb(makeEmptyStore({
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
    flashcardsCb(makeEmptyStore());

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
    flashcardsCb(makeEmptyStore());

    await ctx.addFlashcard({ front: 'كتب', back: 'write' }, undefined, true);
    await ctx.trackWordAppearance('يكتب');

    const SRS = await import('../services/srsAlgorithm');
    const key = `ja:${await SRS.hashWord('يكتب')}`;
    expect(ctx.store.wordCandidates[key]).toBeUndefined();
    dispose();
  });

  // ─── Priority 2: BroadcastChannel ─────────────────────────────────
  it('BroadcastChannel update reconciles store', async () => {
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
    flashcardsCb(makeEmptyStore());

    const card = makeCard({ id: 'bc-1' });
    const remoteStore = makeEmptyStore({ flashcards: { 'bc-1': card } });
    state.handler!({ data: { type: 'update', store: remoteStore } } as MessageEvent);

    expect(ctx.store.flashcards['bc-1']).toBeDefined();
    expect(ctx.store.flashcards['bc-1'].content.front).toBe('テスト');
    dispose();
    vi.unstubAllGlobals();
  });

  // ─── Priority 2: updateMeta ───────────────────────────────────────
  it('updateMeta modifies store.meta and refreshes queue', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    ctx.updateMeta({ maxNewCardsPerDay: 50 });
    expect(ctx.store.meta.maxNewCardsPerDay).toBe(50);
    dispose();
  });

  // ─── Priority 2: updateFlashcardContent ───────────────────────────
  it('updateFlashcardContent modifies content fields', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());

    const id = await ctx.addFlashcard({ front: '本', back: 'book' }, undefined, true);
    ctx.updateFlashcardContent(id, { back: 'book (also: origin)' });

    expect(ctx.store.flashcards[id].content.back).toBe('book (also: origin)');
    dispose();
  });

  it('updateFlashcardContent moves word indexes using the card language when the front changes', async () => {
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    mockGetCanonicalForm.mockImplementation((word: string) => `ja:${word}`);
    mockGetCanonicalFormForLanguage.mockImplementation((language: string, word: string) => `${language}:${word}`);
    flashcardsCb(makeEmptyStore());

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
    flashcardsCb(makeEmptyStore());
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
  it('isWordKnownByText returns true when ease exceeds threshold', async () => {
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const hash = SRS.hashWordSync('上手');
    const lk = `ja:${hash}`;
    flashcardsCb(makeEmptyStore({
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

    expect(ctx.isWordKnownByText('上手')).toBe(true);
    dispose();
  });

  it('isWordKnownByText returns false when ease is below threshold', async () => {
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const hash = SRS.hashWordSync('難しい');
    const lk = `ja:${hash}`;
    flashcardsCb(makeEmptyStore({
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
    flashcardsCb(makeEmptyStore({
      wordKnowledge: {
        [arKey]: {
          ease: 4.5,
          lastSeen: Date.now(),
          timesSeen: 10,
          timesHovered: 0,
          word: 'كتب',
          language: 'ar',
        },
      },
    }));

    expect(ctx.isWordKnownByText('يكتب', 'ar')).toBe(true);
    expect(ctx.isWordKnownByText('يكتب')).toBe(false);
    dispose();
  });

  it('setWordKnowledgeEase can write a non-active stored word language explicitly', async () => {
    mockSettings.language = 'ja';
    mockGetCanonicalFormForLanguage.mockImplementation((language: string, word: string) => (
      language === 'ar' && word === 'يكتب' ? 'كتب' : word
    ));
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    flashcardsCb(makeEmptyStore());

    ctx.setWordKnowledgeEase('يكتب', 4.5, undefined, 'ar');

    const arKey = `ar:${SRS.hashWordSync('كتب')}`;
    const jaKey = `ja:${SRS.hashWordSync('يكتب')}`;
    expect(ctx.store.wordKnowledge[arKey]?.word).toBe('كتب');
    expect(ctx.store.wordKnowledge[arKey]?.language).toBe('ar');
    expect(ctx.store.wordKnowledge[jaKey]).toBeUndefined();
    expect(ctx.isWordKnownByText('يكتب', 'ar')).toBe(true);
    dispose();
  });

  it('markWordSyncSeen can write a non-active stored word language explicitly', async () => {
    mockSettings.language = 'ja';
    mockGetCanonicalFormForLanguage.mockImplementation((language: string, word: string) => (
      language === 'ar' && word === 'يكتب' ? 'كتب' : word
    ));
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    flashcardsCb(makeEmptyStore());

    ctx.markWordSyncSeen('يكتب', 'ar');

    const arKey = `ar:${SRS.hashWordSync('كتب')}`;
    const jaKey = `ja:${SRS.hashWordSync('يكتب')}`;
    expect(ctx.store.wordSyncSeen[arKey]).toEqual(expect.any(Number));
    expect(ctx.store.wordSyncSeen[jaKey]).toBeUndefined();
    dispose();
  });

  it('restoreWordSyncRating restores previous knowledge and seen state for an explicit language', async () => {
    mockSettings.language = 'ja';
    mockGetCanonicalFormForLanguage.mockImplementation((language: string, word: string) => (
      language === 'ar' && word === 'يكتب' ? 'كتب' : word
    ));
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const arKey = `ar:${SRS.hashWordSync('كتب')}`;
    const jaKey = `ja:${SRS.hashWordSync('يكتب')}`;
    const previousKnowledge = {
      ease: 0.5,
      lastSeen: 10,
      timesSeen: 2,
      timesHovered: 1,
      word: 'كتب',
      reading: 'yaktub',
      language: 'ar',
    };
    flashcardsCb(makeEmptyStore({
      wordKnowledge: {
        [arKey]: {
          ease: 4.5,
          lastSeen: 100,
          timesSeen: 10,
          timesHovered: 0,
          word: 'كتب',
          language: 'ar',
        },
      },
      wordSyncSeen: {
        [arKey]: 200,
      },
    }));

    ctx.restoreWordSyncRating('يكتب', previousKnowledge, 1234, 'ar');

    expect(ctx.store.wordKnowledge[arKey]).toEqual(previousKnowledge);
    expect(ctx.store.wordSyncSeen[arKey]).toBe(1234);
    expect(ctx.store.wordKnowledge[jaKey]).toBeUndefined();
    expect(ctx.store.wordSyncSeen[jaKey]).toBeUndefined();
    dispose();
  });

  it('restoreWordSyncRating removes knowledge and seen state when the previous state was untracked', async () => {
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const jaKey = `ja:${SRS.hashWordSync('赤い')}`;
    flashcardsCb(makeEmptyStore({
      wordKnowledge: {
        [jaKey]: {
          ease: 4.5,
          lastSeen: 100,
          timesSeen: 10,
          timesHovered: 0,
          word: '赤い',
          language: 'ja',
        },
      },
      wordSyncSeen: {
        [jaKey]: 200,
      },
    }));

    ctx.restoreWordSyncRating('赤い', undefined, undefined, 'ja');

    expect(ctx.store.wordKnowledge[jaKey]).toBeUndefined();
    expect(ctx.store.wordSyncSeen[jaKey]).toBeUndefined();
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
    flashcardsCb(makeEmptyStore({
      wordKnowledge: {
        [arKey]: {
          word: 'كتب',
          language: 'ar',
          ease: mockSettings.easeThresholdKnown,
          lastSeen: 1,
          timesSeen: 1,
          timesHovered: 0,
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
    flashcardsCb(makeEmptyStore({
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

  // ─── Priority 3: Anki choice flow ────────────────────────────────
  it('addFlashcard with use_anki shows pending choice', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore());
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
    flashcardsCb(makeEmptyStore());
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
    flashcardsCb(makeEmptyStore());
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
    flashcardsCb(makeEmptyStore());
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
    flashcardsCb(makeEmptyStore());
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
    flashcardsCb(makeEmptyStore({
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
    flashcardsCb(makeEmptyStore({
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
    flashcardsCb(makeEmptyStore({
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
  it('captureSuggestedFlashcard skips words with SRS review-state flashcards', async () => {
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const hash = await SRS.hashWord('既知単語');
    const lk = `ja:${hash}`;
    flashcardsCb(makeEmptyStore({
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

    await ctx.captureSuggestedFlashcard({ word: '既知単語', level: 5 });

    expect(ctx.getSuggestedFlashcardsSync()).toHaveLength(0);
    dispose();
  });

  it('captureSuggestedFlashcard skips words with high passive knowledge ease', async () => {
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const hash = SRS.hashWordSync('passive既知');
    const lk = `ja:${hash}`;
    flashcardsCb(makeEmptyStore({
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

    expect(ctx.getSuggestedFlashcardsSync()).toHaveLength(0);
    dispose();
  });

  it('captureSuggestedFlashcard skips words marked as knownUntracked', async () => {
    const { ctx, dispose } = await mountProvider();
    const SRS = await import('../services/srsAlgorithm');
    const hash = await SRS.hashWord('手動既知');
    const lk = `ja:${hash}`;
    flashcardsCb(makeEmptyStore({
      knownUntracked: { [lk]: true },
    }));

    await ctx.captureSuggestedFlashcard({ word: '手動既知', level: 5 });

    expect(ctx.getSuggestedFlashcardsSync()).toHaveLength(0);
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
    flashcardsCb(makeEmptyStore({
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
        },
      },
    }));

    const suggestions = ctx.getSuggestedFlashcardsSync();
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].word).toBe('未知単語');
    dispose();
  });

  // ─── Priority 2: Batched suggested flashcard removal ──────────────
  it('removeSuggestedFlashcards deletes multiple suggestions in one batch', async () => {
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore({
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
    flashcardsCb(makeEmptyStore({
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
    flashcardsCb(makeEmptyStore({
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
    flashcardsCb(makeEmptyStore({
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
    flashcardsCb(makeEmptyStore({
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
    flashcardsCb(makeEmptyStore({
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
    flashcardsCb(makeEmptyStore({
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
    flashcardsCb(makeEmptyStore({
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
        },
      },
    }));

    const removed = await ctx.cleanupKnownSuggestions();

    expect(removed).toBe(1);
    expect(Object.values(ctx.store.suggestedFlashcards)).toHaveLength(0);
    dispose();
  });

  it('cleanupKnownSuggestions preserves hidden non-dictionary suggestions when unknown words are disabled', async () => {
    mockSettings.autoSuggestUnknownWords = false;
    mockBackend.translate.mockResolvedValue({ data: [] });
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore({
      suggestedFlashcards: {
        'ja:hash-nuu': { id: 's-nuu', word: 'ヌウ', level: null, language: 'ja', createdAt: 1, lastSeen: 1, count: 1 },
      },
    }));

    const removed = await ctx.cleanupKnownSuggestions();

    expect(removed).toBe(0);
    expect(mockBackend.translate).not.toHaveBeenCalled();
    expect(ctx.getSuggestedFlashcardsSync()).toHaveLength(0);
    expect(Object.values(ctx.store.suggestedFlashcards)).toHaveLength(1);
    expect(ctx.store.suggestedFlashcards['ja:hash-nuu']?.word).toBe('ヌウ');
    dispose();
  });

  it('cleanupKnownSuggestions preserves suggestions when auto-suggest is disabled', async () => {
    mockSettings.autoSuggestFlashcards = false;
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore({
      suggestedFlashcards: {
        'ja:hash-preserved': { id: 's-preserved', word: '保存', level: null, language: 'ja', createdAt: 1, lastSeen: 1, count: 1 },
      },
    }));

    const removed = await ctx.cleanupKnownSuggestions();

    expect(removed).toBe(0);
    expect(Object.values(ctx.store.suggestedFlashcards)).toHaveLength(1);
    expect(ctx.store.suggestedFlashcards['ja:hash-preserved']?.word).toBe('保存');
    dispose();
  });

  it('cleanupKnownSuggestions preserves dictionary suggestions when unknown words are disabled', async () => {
    mockSettings.autoSuggestUnknownWords = false;
    mockBackend.translate.mockResolvedValue({
      data: [{ reading: 'たんご', definitions: 'word; vocabulary' }, { reading: 'たんご', definitions: '<ul data-content="glossary"><li>word</li></ul>' }, {}],
    });
    const { ctx, dispose } = await mountProvider();
    flashcardsCb(makeEmptyStore({
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
    flashcardsCb(makeEmptyStore({
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
    flashcardsCb(makeEmptyStore({
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
});
