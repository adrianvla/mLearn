/**
 * Shared TypeScript types between main and renderer processes
 */

import type { SubtitleTheme, ThemeMode, WindowType, WordStatus } from './constants';

// ============================================================================
// Settings Types
// ============================================================================

export interface ColorCodes {
  [pos: string]: string;
}

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
  dark_mode: boolean;
  
  // Language settings
  language: string;
  
  // Dictionary settings
  hover_known_get_from_dictionary: boolean;
  show_pos: boolean;
  furigana: boolean;
  showPitchAccent: boolean;
  
  // Anki settings
  use_anki: boolean;
  anki_field_expression: string;
  anki_field_reading: string;
  anki_field_meaning: string;
  anki_model_name: string;
  ankiConnectUrl: string;
  
  // Flashcard settings
  enable_flashcard_creation: boolean;
  flashcard_deck: string | null;
  flashcards_add_picture: boolean;
  maxNewCardsPerDay: number;
  proportionOfExamCards: number;
  preparedExam: number;
  createUnseenCards: boolean;
  
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
  
  // Feature flags
  llmEnabled: boolean;
  ocrEnabled: boolean;
  devMode: boolean;
  
  // OCR settings
  ocr_crop_padding: number;
  
  // Stats
  timeWatched: number;
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
  dark_mode: true,
  hover_known_get_from_dictionary: false,
  show_pos: true,
  language: 'ja',
  use_anki: false,
  furigana: true,
  enable_flashcard_creation: false,
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
  devMode: false,
  ocr_crop_padding: 200,
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
  translatable: boolean;
  colour_codes: ColorCodes;
  fixed_settings: Partial<Settings>;
  freq?: [string, string][];
  freq_level_names?: FrequencyLevelNames;
}

export interface LanguageDataMap {
  [langCode: string]: LanguageData;
}

// ============================================================================
// Token Types
// ============================================================================

export interface Token {
  word: string;
  actual_word: string;
  type: string; // Part of speech (動詞, 名詞, etc.)
  reading?: string;
}

// ============================================================================
// Translation Types
// ============================================================================

export interface TranslationEntry {
  definitions: string[];
  reading: string;
  word?: string;
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
// Flashcard Types
// ============================================================================

export interface FlashcardContent {
  word: string;
  pitchAccent?: number;
  pronunciation: string;
  translation?: string[];
  definition?: string[];
  example: string;
  exampleMeaning: string;
  screenshotUrl?: string;
  pos: string;
  level: number;
}

export interface Flashcard {
  id: string;
  content: FlashcardContent;
  ease: number;
  interval: number;
  dueDate: string;
  reviews: number;
  createdAt: string;
  lastReviewed?: string;
}

export interface FlashcardStore {
  flashcards: Flashcard[];
  version: number;
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
