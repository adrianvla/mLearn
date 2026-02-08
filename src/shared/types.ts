/**
 * Shared TypeScript types between main and renderer processes
 */

import type { SubtitleTheme, WordStatus, WindowType as ConstWindowType, WordHoverTriggerMode, AppTheme } from './constants';

// Re-export WindowType
export type WindowType = ConstWindowType;

// ============================================================================
// Settings Types
// ============================================================================

export interface ColorCodes {
  [pos: string]: string;
}

/** Custom CSS color overrides that apply globally regardless of theme */
export interface CustomColorOverrides {
  'bg-opaque'?: string;
  'text-primary'?: string;
  'text-secondary'?: string;
  'text-tertiary'?: string;
  'bg'?: string;
  'bg-intense'?: string;
  'border-color'?: string;
  'border-color-intense'?: string;
}

/** List of CSS variables that can be customized */
export const CUSTOMIZABLE_CSS_VARS = [
  'bg-opaque',
  'text-primary',
  'text-secondary',
  'text-tertiary',
  'bg',
  'bg-intense',
  'border-color',
  'border-color-intense',
] as const;

export interface Settings {
  // Knowledge thresholds
  known_ease_threshold: number;

  // Display settings
  blur_words: boolean;
  blur_known_subtitles: boolean;
  blur_amount: number;
  colour_known: string;
  do_colour_known: boolean;
  do_colour_codes: boolean;
  colour_codes: ColorCodes;
  theme: AppTheme;
  /** Custom CSS color overrides that apply globally regardless of theme */
  customColors?: CustomColorOverrides;

  // Language settings
  language: string;

  // Dictionary settings
  hover_known_get_from_dictionary: boolean;
  show_pos: boolean;
  furigana: boolean;
  showFurigana?: boolean; // Alias for furigana
  showPitchAccent: boolean;
  showDictionary?: boolean; // Show dictionary on hover

  // Anki settings
  use_anki: boolean;
  anki_field_expression: string;
  anki_field_reading: string;
  anki_field_meaning: string;
  anki_model_name: string;
  ankiConnectUrl: string;
  ankiDeckName?: string;
  ankiModelName?: string; // Alias for anki_model_name

  // Flashcard settings
  enable_flashcard_creation: boolean;
  flashcard_deck: string | null;
  flashcards_add_picture: boolean;
  maxNewCardsPerDay: number;
  proportionOfExamCards: number;
  preparedExam: number;
  createUnseenCards: boolean;
  /** Hour at which a new SRS day begins (0-23, default 4 = 4:00 AM) */
  newDayHour: number;
  /** Whether to show a 3D flip animation when revealing flashcard answers */
  flashcardFlipAnimation: boolean;

  // API URLs
  getCardUrl: string;
  tokeniserUrl: string;
  getTranslationUrl: string;
  ankiUrl: string;

  // UI settings
  openAside: boolean;
  subsOffsetTime: number;
  immediateFetch: boolean;
  subtitleTheme: SubtitleTheme;
  subtitle_font_size: number;
  subtitle_font_weight: number;
  subtitlePosition?: 'top' | 'bottom'; // Subtitle position on screen
  subtitleFont?: string; // Custom font for subtitles
  showSubtitles?: boolean; // Toggle subtitle visibility
  showTranslation?: boolean; // Show translation line
  videoFit?: 'contain' | 'cover' | 'fill'; // Video object fit

  // Subtitle processing
  removeParentheses?: boolean; // Remove content in parentheses from subtitles
  removeSpeakerNames?: boolean; // Remove speaker name prefixes from subtitles

  // Feature flags
  llmEnabled: boolean;
  ocrEnabled: boolean;
  devMode: boolean;

  // OCR settings
  ocr_crop_padding: number;
  /** Use lightweight OCR detection to reduce memory usage (only visible for languages that support it) */
  ocrRamSaver?: boolean;
  /** Turbo mode: faster but potentially less accurate OCR detection (default true) */
  ocrTurboMode?: boolean;
  /** Enable furigana detection and filtering in OCR results (default true) */
  ocrFuriganaDetection?: boolean;
  /** Width ratio threshold for filtering narrow furigana boxes (default 1.5) */
  ocrFuriganaWidthRatio?: number;
  /** Window multiplier for neighbor detection (default 2.4) */
  ocrFuriganaNeighborWindowMultiplier?: number;
  /** Number of boxes to look ahead when detecting furigana neighbors (default 3) */
  ocrFuriganaNeighborLookahead?: number;

  // Reader word hover settings
  /** How word hover is triggered: 'hover', 'long-hover', 'key-hover' */
  readerWordHoverTrigger?: WordHoverTriggerMode;
  /** Key to hold for 'key-hover' mode (e.g., 'Shift', 'Control', 'Alt') */
  readerWordHoverKey?: string;
  /** Whether to hide furigana with white boxes that reveal on hover */
  readerFuriganaHider?: boolean;

  // Reader magnifier settings
  /** Hotkey to activate the magnifying glass (e.g., 'z', 'Control', 'Alt') */
  readerMagnifierHotkey?: string;
  /** Zoom level for the magnifier (default 2x) */
  readerMagnifierZoom?: number;
  /** Size of the magnifier lens in pixels (default 200) */
  readerMagnifierSize?: number;

  // Stats
  timeWatched: number;

  // First-run tracking
  hasCompletedSetup?: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  known_ease_threshold: 2000,
  blur_words: false,
  blur_known_subtitles: false,
  blur_amount: 5,
  colour_known: '#cceec9',
  do_colour_known: true,
  do_colour_codes: true,
  colour_codes: {},
  theme: 'light',
  customColors: {},  // Empty = no custom color overrides
  hover_known_get_from_dictionary: false,
  show_pos: true,
  language: 'ja',
  use_anki: false,
  furigana: true,
  enable_flashcard_creation: true,  // Enable flashcard creation by default
  flashcard_deck: null,
  flashcards_add_picture: true,
  getCardUrl: 'http://127.0.0.1:7752/getCard',
  tokeniserUrl: 'http://127.0.0.1:7752/tokenize',
  getTranslationUrl: 'http://127.0.0.1:7752/translate',
  ankiUrl: 'http://127.0.0.1:7753/api/fwd-to-anki',
  ankiConnectUrl: 'http://127.0.0.1:8765',
  openAside: true,
  llmEnabled: true,
  ocrEnabled: true,
  subsOffsetTime: 0,
  immediateFetch: false,
  subtitleTheme: 'shadow',
  subtitle_font_size: 40,
  subtitle_font_weight: 300,
  showPitchAccent: true,
  timeWatched: 0,
  maxNewCardsPerDay: 10,
  proportionOfExamCards: 0.5,
  preparedExam: 3,
  createUnseenCards: true,
  newDayHour: 4,
  flashcardFlipAnimation: true,
  devMode: false,
  ocr_crop_padding: 200,
  ocrRamSaver: false,
  ocrTurboMode: true,
  ocrFuriganaDetection: true,
  ocrFuriganaWidthRatio: 1.5,
  ocrFuriganaNeighborWindowMultiplier: 2.4,
  ocrFuriganaNeighborLookahead: 3,
  readerWordHoverTrigger: 'hover',
  readerWordHoverKey: 'Shift',
  readerFuriganaHider: false,
  readerMagnifierHotkey: 'z',
  readerMagnifierZoom: 2,
  readerMagnifierSize: 200,
  anki_field_expression: 'Expression',
  anki_field_reading: 'Reading',
  anki_field_meaning: 'Meaning',
  anki_model_name: 'Basic',
};

// ============================================================================
// Language Data Types
// ============================================================================

export interface FrequencyLevelNames {
  [level: string]: string;
}

export interface LanguageData {
  name: string;
  name_translated?: string;
  translatable: string[];  // Array of POS types that should be translated (e.g., ["名詞", "動詞"])
  colour_codes: ColorCodes;
  fixed_settings: Partial<Settings>;
  freq?: [string, string][];
  freq_level_names?: FrequencyLevelNames;
  /** Whether this language offers the OCR Ram Saver toggle (lightweight detection) */
  hasOcrRamSaver?: boolean;
  /** Whether this language can be written vertically (e.g. CJK vertical text) */
  supportsVerticalText?: boolean;
  /** Whether this language has furigana-like reading annotations alongside text (e.g. Japanese) */
  hasFurigana?: boolean;
}

export interface LanguageDataMap {
  [langCode: string]: LanguageData;
}

// ============================================================================
// Token Types
// ============================================================================

export interface Token {
  word: string;        // The display form
  actual_word: string; // The dictionary form
  type: string;        // Part of speech (動詞, 名詞, etc.)
  reading?: string;
  // Computed/derived properties for UI
  surface?: string;    // Alias for word (for compatibility)
  partOfSpeech?: string; // Alias for type
  isKnown?: boolean;   // Whether word is in known list
  meaning?: string;    // Quick translation if available
}

// ============================================================================
// Translation Types
// ============================================================================

export interface TranslationEntry {
  definitions: string | string[];  // Backend may return string or array
  reading: string;
  word?: string;
}

export interface DictionaryEntry {
  word: string;
  reading: string;
  meanings: string[];
  partOfSpeech?: string[];
  tags?: string[];
}

export interface PitchInfo {
  position: number;
}

export interface PitchData {
  pitches?: PitchInfo[];
}

export interface TranslationResponse {
  data: [TranslationEntry?, TranslationEntry?, PitchData?];
}

// ============================================================================
// Flashcard Types (Anki-like SRS system with UUID keys)
// ============================================================================

/**
 * Card state following Anki's model:
 * - new: Never reviewed, waiting in new card queue
 * - learning: Currently in learning phase (short intervals)
 * - review: Graduated to review phase (longer intervals)
 * - relearning: Failed review, back to learning phase
 */
export type FlashcardState = 'new' | 'learning' | 'review' | 'relearning';

/**
 * Content for any type of flashcard (words, sentences, images, etc.)
 * The 'type' field determines what fields are relevant
 */
export interface FlashcardContent {
  /** Type of content - 'word' for vocabulary, 'sentence' for sentence cards, etc. */
  type: 'word' | 'sentence' | 'custom';
  /** Primary display text (word, sentence, etc.) */
  front: string;
  /** Answer/back of card (translation, meaning, etc.) */
  back: string;
  /** Optional pronunciation/reading */
  reading?: string;
  /** Pitch accent position (language-specific) */
  pitchAccent?: number;
  /** Part of speech tag */
  pos?: string;
  /** Frequency level (language-specific) */
  level?: number;
  /** Example sentence */
  example?: string;
  /** Example sentence translation/meaning */
  exampleMeaning?: string;
  /** Screenshot or image URL */
  imageUrl?: string;
  /** Audio URL */
  audioUrl?: string;
  /** Additional context (where the word was encountered) */
  context?: string;
  /** Source (video name, book name, etc.) */
  source?: string;
  /** Custom fields for extensibility */
  extra?: Record<string, unknown>;
  
  // Legacy field aliases for backwards compatibility
  /** @deprecated Use 'front' instead */
  word?: string;
  /** @deprecated Use 'reading' instead */
  pronunciation?: string;
  /** @deprecated Use 'back' instead (as string[]) */
  translation?: string[];
  /** @deprecated Use 'extra.definition' instead */
  definition?: string[];
  /** @deprecated Use 'imageUrl' instead */
  screenshotUrl?: string;
  /** @deprecated Use 'context' instead */
  contextPhrase?: string;
}

/**
 * Flashcard with Anki-like scheduling
 * Uses UUID as the primary key, not the word
 */
export interface Flashcard {
  /** Unique identifier (UUID) - primary key */
  id: string;
  /** Card content */
  content: FlashcardContent;
  /** Current card state */
  state: FlashcardState;
  /** Ease factor (multiplier for intervals, default 2.5, min 1.3) */
  ease: number;
  /** Current interval in milliseconds */
  interval: number;
  /** Due date timestamp in ms */
  dueDate: number;
  /** Number of times card has been reviewed (graduated reviews only) */
  reviews: number;
  /** Number of times card has lapsed (failed after graduating) */
  lapses: number;
  /** Current step index for learning/relearning (0-based) */
  learningStep: number;
  /** Creation timestamp in ms */
  createdAt: number;
  /** Last review timestamp in ms */
  lastReviewed: number;
  /** Last modification timestamp in ms */
  lastUpdated: number;
  /** Tags for organization */
  tags?: string[];
  /** Flag for suspended cards (won't appear in review) */
  suspended?: boolean;
  /** Flag for buried cards (temporarily hidden until next day) */
  buried?: boolean;
}

/**
 * Word candidate tracking for auto-flashcard creation
 */
export interface WordCandidate {
  /** Number of times the word has been seen */
  count: number;
  /** Last time the word was seen (timestamp in ms) */
  lastSeen: number;
  /** The actual word text */
  word: string;
  /** Optional reading for the word */
  reading?: string;
}

/**
 * Daily study statistics
 */
export interface DailyStudyStats {
  /** Date string in YYYY-MM-DD format */
  date: string;
  /** Number of new cards studied */
  newCardsStudied: number;
  /** Number of review cards studied */
  reviewCardsStudied: number;
  /** Number of cards that lapsed */
  lapses: number;
  /** Total time spent studying in ms */
  timeSpent: number;
  /** Number of cards that graduated from learning */
  graduated: number;
}

/**
 * Aggregated word statistics for O(1) lookup
 * Calculated from all flashcards containing this word
 */
export interface WordStats {
  /** Number of flashcards for this word */
  cardCount: number;
  /** Best (highest) ease factor among all cards */
  bestEase: number;
  /** Total reviews across all cards */
  totalReviews: number;
  /** Total lapses across all cards */
  totalLapses: number;
  /** Most recent review timestamp */
  lastReviewed: number;
  /** Best (longest) interval in ms */
  bestInterval: number;
  /** Best card state: 'review' > 'relearning' > 'learning' > 'new' */
  bestState: FlashcardState;
}

/**
 * Flashcard store meta information
 */
export interface FlashcardMeta {
  /** Number of new cards introduced today */
  newCardsToday: number;
  /** Number of reviews done today */
  reviewsToday: number;
  /** Date when new card count was last reset (YYYY-MM-DD) */
  newCardsDate: string;
  /** Maximum new cards per day (user setting stored here for sync) */
  maxNewCardsPerDay: number;
  /** Maximum new cards to learn per day (-1 = unlimited) */
  maxNewCardsPerDayLearning: number;
  /** Maximum reviews per day (-1 = unlimited) */
  maxReviewsPerDay: number;
  /** Learning steps in minutes (e.g., [1, 10] = 1 min, then 10 min) */
  learningSteps: number[];
  /** Relearning steps in minutes */
  relearnSteps: number[];
  /** Graduating interval in days (interval after completing all learning steps) */
  graduatingInterval: number;
  /** Easy interval in days (interval when pressing Easy on a new card) */
  easyInterval: number;
  /** New card interval modifier (percentage, 100 = normal) */
  newIntervalModifier: number;
  /** Review interval modifier (percentage, 100 = normal) */
  reviewIntervalModifier: number;
  /** Maximum interval in days */
  maxInterval: number;
}

/**
 * Full flashcard store with UUID-keyed flashcards
 */
export interface FlashcardStore {
  /** All flashcards keyed by UUID */
  flashcards: Record<string, Flashcard>;
  /** Word candidates for auto-creation, keyed by word hash */
  wordCandidates: Record<string, WordCandidate>;
  /** Tracks which words have flashcards (word hash -> array of card UUIDs) */
  wordToCardMap: Record<string, string[]>;
  /** Aggregated word statistics for O(1) lookup (word hash -> stats) */
  wordStatsMap: Record<string, WordStats>;
  /** Words marked as known but not tracked as flashcards (word hash -> true) */
  knownUntracked: Record<string, boolean>;
  /** Store metadata */
  meta: FlashcardMeta;
  /** Daily study statistics (keyed by date string YYYY-MM-DD) */
  dailyStats: Record<string, DailyStudyStats>;
  /** Version for migrations */
  version: number;
}

/**
 * Review session queue management
 */
export interface ReviewQueue {
  /** New cards available for today */
  newQueue: string[];
  /** Learning cards (with step timers) */
  learningQueue: string[];
  /** Review cards due */
  reviewQueue: string[];
  /** Relearning cards */
  relearnQueue: string[];
}

// ============================================================================
// Subtitle Types
// ============================================================================

export interface Subtitle {
  start: number;
  end: number;
  text: string;
}

// ============================================================================
// Word Knowledge Types
// ============================================================================

export interface WordKnowledge {
  status: WordStatus;
  ease: number;
  lastSeen?: string;
  appearances: number;
}

export interface WordFrequencyEntry {
  reading: string;
  level: string;
  raw_level: number;
}

export interface WordFrequencyMap {
  [word: string]: WordFrequencyEntry;
}

// ============================================================================
// Pitch Accent Types
// ============================================================================

export interface PitchAccentInfo {
  accentType: number;
  pattern: boolean[];
  particleAccent: boolean;
  length: number;
}

// ============================================================================
// IPC Message Types
// ============================================================================

export interface InstallOptions {
  includeLLM: boolean;
  includeOCR: boolean;
}

export interface InstallerState {
  waiting: boolean;
  inProgress: boolean;
  success: boolean;
  options: InstallOptions;
}

export interface PromptOptions {
  title: string;
  desc: string;
  placeholder: string;
  buttonConfirmText: string;
}

export interface WindowSize {
  width: number;
  height: number;
}

export interface OpenWindowPayload {
  type: WindowType;
  options?: Partial<Electron.BrowserWindowConstructorOptions>;
}

// ============================================================================
// Watch Together Types
// ============================================================================

export interface WatchTogetherMessage {
  type: 'play' | 'pause' | 'seek' | 'sync';
  timestamp?: number;
  time?: number;
}

// ============================================================================
// Recently Watched Types
// ============================================================================

export interface RecentlyWatched {
  id: string;
  title: string;
  url?: string;
  filePath?: string;
  thumbnail?: string;
  progress: number;
  duration: number;
  lastWatched: string;
  subtitlePath?: string;
}

// ============================================================================
// OCR Types
// ============================================================================

export interface OCRResult {
  text: string;
  confidence: number;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

// ============================================================================
// LLM Types
// ============================================================================

export interface LLMStatus {
  downloaded: boolean;
  cached: boolean;
  downloading: boolean;
  progress: number;
  downloadedBytes: number;
  expectedBytes: number;
  device?: string;
}

export interface LLMResponse {
  output?: string;
  error?: string;
  device?: string;
}

// ============================================================================
// Anki Types
// ============================================================================

export interface AnkiCard {
  cardId: number;
  fields: {
    [fieldName: string]: {
      value: string;
      order: number;
    };
  };
}

export interface AnkiCardResponse {
  cards: AnkiCard[];
}

// ============================================================================
// Pip Requirements Config Types
// ============================================================================

export interface PipRequirementsConfig {
  core: string[];
  ocr: string[];
  llm: string[];
}
