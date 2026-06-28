/**
 * Shared TypeScript types between main and renderer processes
 */

import { PYTHON_BACKEND_PORT, PROXY_SERVER_PORT, ANKI_EASE, SRS_EASE, KNOWLEDGE_SOURCES, DEFAULT_LANGUAGE_CATALOG_URL } from './constants';
import { DEFAULT_CUSTOM_THEME_CSS } from './defaultCustomThemeCss';
import type { SubtitleTheme, NumericWordStatus, WindowType as ConstWindowType, WordHoverTriggerMode, AppTheme, KnowledgeSource, KnowledgeResolutionMode, PassiveHoverFailAction } from './constants';

// Re-export WindowType
export type WindowType = ConstWindowType;

// ============================================================================
// Overlay Types
// ============================================================================

export interface OverlayVideoState {
  currentTime: number;
  isPlaying: boolean;
  duration: number;
  playbackRate: number;
  volume?: number;
  muted?: boolean;
  isWaiting?: boolean;
  isFullscreen?: boolean;
  url?: string;
  title?: string;
  videoSrc?: string;
}

export interface OverlayVideoScreenshot {
  dataUrl: string;
  timestamp: number;
}

export interface OverlayGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  isFullscreen?: boolean;
}

export interface OverlayCommand {
  command: 'play' | 'pause' | 'seek' | 'setRate' | 'setVolume' | 'showNativeCaptions' | 'hideNativeCaptions';
  time?: number;
  rate?: number;
  volume?: number;
}

export interface OverlaySubtitleTracks {
  tracks: Array<{ kind: string; src: string; srclang: string; label: string }>;
  textTracks: Array<{ language: string; text: string }>;
  url: string;
  timestamp?: number;
}

export interface OverlayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OverlayDelta {
  x: number;
  y: number;
}

export interface OverlaySizeDelta {
  width: number;
  height: number;
}

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
  /** Built-in SRS ease above which a word is considered learning (integer, 0–5000 = 0.0–5.0 scale) */
  srsLearningThreshold: number;
  /** Built-in SRS ease above which a word is considered known (integer, 0–5000 = 0.0–5.0 scale) */
  known_ease_threshold: number; //this setting is named in this way because of backwards compatibility, it was always named that way from day 1
  /** Anki card factor above which a word is considered learning (integer, Anki scale) */
  ankiLearningThreshold: number;
  /** Anki card factor above which a word is considered known (integer, Anki scale) */
  ankiKnownThreshold: number;

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
  customThemeCSS: string;

  // Language settings
  language: string;

  // Dictionary settings
  hover_known_get_from_dictionary: boolean;
  show_pos: boolean;
  furigana: boolean;
  showFurigana?: boolean; // Alias for furigana
  hideReadingForKnownWords?: boolean;
  showPitchAccent: boolean;
  showDictionary?: boolean; // Show dictionary on hover

  // Anki settings
  use_anki: boolean;
  /** Skip the SRS/Anki choice modal and always save to SRS */
  flashcardSkipAnkiChoice: boolean;
  /** Skip the duplicate warning when adding a word that already exists in Anki */
  skipAnkiDuplicateWarning: boolean;
  /** Skip the warning modal when changing status of a word tracked by Anki or Flashcards */
  skipStatusSourceWarning: boolean;
  /** Skip the warning modal when modifying Anki card ease/position */
  skipAnkiModifyWarning: boolean;
  /** Ease threshold below which a word is considered unknown / failing (float, 0.0–5.0 scale) */
  easeThresholdUnknown: number;
  /** Ease threshold above which a word is considered learning (float, 0.0–5.0 scale) */
  easeThresholdLearning: number;
  /** Ease threshold above which a word is considered known (float, 0.0–5.0 scale) */
  easeThresholdKnown: number;
  /** Ease threshold above which a word is considered mastered (float, 0.0–5.0 scale) */
  easeThresholdMastered: number;
  manualStatusEaseBuffer: number;
  /** Order of knowledge sources for word status resolution */
  knowledgeSourceOrder: KnowledgeSource[];
  /** How to resolve word status from multiple knowledge sources */
  knowledgeResolutionMode: KnowledgeResolutionMode;
  anki_field_expression: string;
  anki_field_reading: string;
  anki_field_meaning: string;
  anki_model_name: string;
  ankiConnectUrl: string;
  ankiDeckName?: string;
  ankiTemplateExpression: string;
  ankiTemplateReading: string;
  ankiTemplateMeaning: string;

  // Flashcard settings
  enable_flashcard_creation: boolean;
  /** Automatically create flashcards from tracked word candidates */
  automaticFlashcardCreation: boolean;
  flashcard_deck: string | null;
  flashcards_add_picture: boolean;
  maxNewCardsPerDay: number;
  proportionOfExamCards: number;
  /** Days after which a "learning" word is re-shown in Word Sync (default 30) */
  wordSyncStaleLearningDays: number;
  createUnseenCards: boolean;
  /** Use LLM to generate example sentences when auto-creating flashcards */
  flashcardLLMExamples: boolean;
  /** Hour at which a new SRS day begins (0-23, default 4 = 4:00 AM) */
  newDayHour: number;
  /** Whether to show a 3D flip animation when revealing flashcard answers */
  flashcardFlipAnimation: boolean;
  /** Number of lapses before a card is flagged as a leech (0 = disabled) */
  leechThreshold: number;
  /** Whether flashcards capture a screenshot or video clip: 'image' or 'video' */
  flashcardMediaType: 'image' | 'video';
  /** Extra ms added before and after the subtitle when clipping video for flashcard (default 300) */
  flashcardVideoMargin: number;
  /**
   * When true, unknown words seen during media playback are captured as
   * lightweight "Suggested Flashcards" (screenshot + context phrase only — no
   * translation/LLM/TTS). The user reviews and promotes them later from the
   * Suggested Flashcards tab.
   */
  autoSuggestFlashcards: boolean;
  /**
   * When true, suggested flashcards are captured even when dictionary membership
   * cannot be confirmed from the translation cache. When false, only words with
   * cached dictionary definitions are suggested. Does nothing when
   * autoSuggestFlashcards is false.
   */
  autoSuggestUnknownWords: boolean;
  /**
   * Learning language level for the current language. When set, suggested flashcards
   * above this level (harder) and cards without a level are not captured.
   * Uses the language's raw_level scale (e.g., 2 = JLPT N2, 5 = JLPT N5).
   */
  learningLanguageLevel: number | null;

  // API URLs
  tokeniserUrl: string;
  getTranslationUrl: string;
  ankiUrl: string;

  // Backend connection mode
  /** How the renderer reaches the Python backend */
  backendMode: 'local' | 'tethered';
  /** Base URL when mode is 'tethered' (e.g. http://192.168.1.10:7752) */
  backendUrl: string;
  /** Single provider-agnostic manifest URL describing downloadable language data. */
  languageCatalogUrl: string;
  /** Bearer token for cloud backend auth */
  cloudAuthToken: string;
  /** Session access token for signed-in cloud account */
  cloudAuthAccessToken: string;
  /** Session refresh token for signed-in cloud account */
  cloudAuthRefreshToken: string;
  /** Cloud account user id */
  cloudAuthUserId: string;
  /** Cloud account email */
  cloudAuthUserEmail: string;
  /** Unix timestamp (seconds) when access token expires */
  cloudAuthExpiresAt: number;
  /** Cloud auth status */
  cloudAuthStatus: 'signed-out' | 'signed-in';
  /** URL of the Electron node server (port 7753) for tethered mode sync */
  nodeServerUrl: string;
  /** Whether cloud endpoint URLs are manually overridden */
  overrideCloudEndpointUrl: boolean;
  /** Custom cloud login/website URL (when overrideCloudEndpointUrl is true) */
  cloudLoginUrl: string;
  /** Custom cloud API URL (when overrideCloudEndpointUrl is true) */
  cloudApiUrl: string;
  /** Timestamp of last settings modification (for sync conflict resolution) */
  lastModified: number;

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
  overlayAutoPosition?: boolean; // Enable automatic overlay positioning from browser extension
  overlayTextMode?: boolean;

  // Subtitle processing
  removeParentheses?: boolean; // Remove content in parentheses from subtitles
  removeSpeakerNames?: boolean; // Remove speaker name prefixes from subtitles

  // Video player settings
  /** Show or hide the live word translator panel */
  showLiveTranslator?: boolean;
  /** Include known words in the live word translator */
  liveTranslatorIncludeKnown?: boolean;
  /** Blur known words individually in subtitles */
  blurKnownWords?: boolean;

  // Feature flags
  llmEnabled: boolean;
  ocrEnabled: boolean;
  voiceEnabled: boolean;
  devMode: boolean;

  /** Low battery mode: intercepts local neural network calls (LLM, TTS, OCR) with a user prompt */
  lowBatteryMode: boolean;

  /** Whether the user has completed initial LLM provider setup */
  llmConfigured: boolean;

  // OCR settings
  ocr_crop_padding: number;
  /** Use lightweight OCR detection to reduce memory usage (only visible for languages that support it) */
  ocrRamSaver?: boolean;
  /** Turbo mode: faster but potentially less accurate OCR detection (default false) */
  ocrTurboMode?: boolean;
  /** Enable furigana detection and filtering in OCR results (default true) */
  ocrFuriganaDetection?: boolean;
  /** Width ratio threshold for filtering narrow furigana boxes (default 1.5) */
  ocrFuriganaWidthRatio?: number;
  /** Window multiplier for neighbor detection (default 2.4) */
  ocrFuriganaNeighborWindowMultiplier?: number;
  /** Number of boxes to look ahead when detecting furigana neighbors (default 3) */
  ocrFuriganaNeighborLookahead?: number;
  /** OCR backend provider */
  ocrProvider?: OCRProvider;

  // Reader word hover settings
  /** How word hover is triggered: 'hover', 'long-hover', 'key-hover' */
  readerWordHoverTrigger?: WordHoverTriggerMode;
  /** Key to hold for 'key-hover' mode (e.g., 'Shift', 'Control', 'Alt') */
  readerWordHoverKey?: string;
  /** Whether to hide furigana with white boxes that reveal on hover */
  readerFuriganaHider?: boolean;
  /** Whether to remove the gap between pages in double-page mode */
  readerCollatePages?: boolean;
  readerPageMode?: 'single' | 'double';
  readerFirstPageSingle?: boolean;

  // Reader magnifier settings
  /** Hotkey to activate the magnifying glass (e.g., 'z', 'Control', 'Alt') */
  readerMagnifierHotkey?: string;
  /** Zoom level for the magnifier (default 2x) */
  readerMagnifierZoom?: number;
  /** Size of the magnifier lens in pixels (default 200) */
  readerMagnifierSize?: number;

  // Stats
  timeWatched: number;

  // Passive word knowledge
  /** Enable passive ease adjustments from seeing/hovering words */
  passiveEaseEnabled: boolean;
  /** Delay in ms before a hover counts as one failed-word attempt */
  passiveHoverDelayMs: number;
  /** Number of counted hovers required before a word is marked as failed */
  passiveHoverFailCount: number;
  /** Action to take when a counted hover leaves a word in the failed state */
  passiveHoverFailAction: PassiveHoverFailAction;
  /** Ease amount to subtract when the failed-word action is set to decrease ease */
  passiveHoverEaseDecrease: number;

  // LLM provider settings
  /** LLM provider: built-in local model or Ollama */
  llmProvider: LLMProvider;
  /** Ollama server URL */
  ollamaUrl: string;
  /** Ollama model name */
  ollamaModel: string;
  /** Built-in model identifier (GGUF filename) */
  builtinModel: string;
  /** Whether the built-in model has been autoselected (prevents re-running autoselect) */
  builtinModelAutoselected?: boolean;

  // Speech settings
  /** Enable speech I/O features */
  speechEnabled: boolean;
  /** Automatically read assistant responses aloud */
  autoSpeak: boolean;
  /** STT language override (auto-detected from learning language by default) */
  sttLanguage: string;

  // Voice call mode settings
  /** Voice input mode: hands-free VAD or push-to-talk */
  voiceMode: VoiceMode;
  /** TTS backend provider: local Kokoro, Qwen3, or Cloud */
  ttsProvider: TTSProvider;
  /** TTS speech speed multiplier */
  voiceTtsSpeed: number;
  /** Automatically send message after VAD silence detection */
  voiceAutoSendOnSilence: boolean;
  /** Seconds of silence before considering speech ended */
  voiceSilenceThreshold: number;

  /** UI language / locale code (e.g., 'en', 'ja', 'de') */
  uiLanguage: string;

  // Flashcard TTS settings
  /** Auto-play TTS when viewing flashcard front */
  flashcardAutoTts: boolean;
  /** TTS provider for flashcard audio: 'kokoro', 'qwen3', or 'cloud' */
  flashcardTtsProvider: TTSProvider;
  /** Auto-generate .ogg files for new flashcards */
  flashcardAutoGenerateAudio: boolean;
  /** Voice sample ID for flashcard TTS voice cloning (Qwen3/Remote) */
  flashcardVoiceSampleId: string;
  /** Stealth mode: hide media (image/video) on flashcards during review */
  flashcardStealthMode: boolean;
  /** Mute audio: prevent autoplay of TTS audio during flashcard review */
  flashcardMuteAudio: boolean;

  // Cloud LLM tier settings
  /** Cloud LLM tier for conversation agent (text chat) */
  cloudLLMTierConversation: CloudLLMTier;
  /** Cloud LLM tier for voice agent */
  cloudLLMTierVoice: CloudLLMTier;
  /** Cloud LLM tier for word explainer */
  cloudLLMTierExplanation: CloudLLMTier;

  // Conversation agent settings
  /** Whether the agent memory feature is enabled */
  agentMemoryEnabled: boolean;
  /** Whether memories are shared across all agents or compartmentalized */
  agentMemoryShared: boolean;
  /** Whether the separate checker agent should correct language mistakes */
  agentMistakeChecker: boolean;
  /** Whether the separate checker agent should flag safety risks (e.g. self-harm) */
  agentSafetyChecker: boolean;
  /** List of browser paths that have the mLearn browser extension installed */
  installedBrowserExtensions: string[];

  hasCompletedSetup?: boolean;

  eulaAccepted: boolean;
  eulaAcceptedVersion: string;
  eulaAcceptedAt: number;
  eulaAcceptedHash: string;
  cloudTosAccepted: boolean;
  cloudTosAcceptedAt: number;
  cloudPrivacyAccepted: boolean;
  cloudPrivacyAcceptedAt: number;
}

export const DEFAULT_SETTINGS: Settings = {
  srsLearningThreshold: Math.round(SRS_EASE.DEFAULT_LEARNING * 1000),
  known_ease_threshold: Math.round(SRS_EASE.DEFAULT_KNOWN * 1000),
  ankiLearningThreshold: ANKI_EASE.DEFAULT_LEARNING,
  ankiKnownThreshold: ANKI_EASE.DEFAULT_KNOWN,
  blur_words: false,
  blur_known_subtitles: false,
  blur_amount: 5,
  colour_known: '#cceec9',
  do_colour_known: true,
  do_colour_codes: true,
  colour_codes: {},
  theme: 'light',
  customColors: {},  // Empty = no custom color overrides
  customThemeCSS: DEFAULT_CUSTOM_THEME_CSS,
  hover_known_get_from_dictionary: false,
  showDictionary: true,
  show_pos: true,
  language: 'ja',
  use_anki: false,
  flashcardSkipAnkiChoice: false,
  skipAnkiDuplicateWarning: false,
  skipStatusSourceWarning: false,
  skipAnkiModifyWarning: false,
  easeThresholdUnknown: SRS_EASE.MIN,
  easeThresholdLearning: SRS_EASE.DEFAULT_LEARNING,
  easeThresholdKnown: SRS_EASE.DEFAULT_KNOWN,
  easeThresholdMastered: SRS_EASE.DEFAULT_KNOWN + 0.5,
  manualStatusEaseBuffer: 0,
  knowledgeSourceOrder: [...KNOWLEDGE_SOURCES],
  knowledgeResolutionMode: 'highest' as KnowledgeResolutionMode,
  furigana: true,
  enable_flashcard_creation: true,
  automaticFlashcardCreation: false,
  flashcard_deck: null,
  flashcards_add_picture: true,
  tokeniserUrl: `http://127.0.0.1:${PYTHON_BACKEND_PORT}/tokenize`,
  getTranslationUrl: `http://127.0.0.1:${PYTHON_BACKEND_PORT}/translate`,
  ankiUrl: `http://127.0.0.1:${PROXY_SERVER_PORT}/api/fwd-to-anki`,
  ankiConnectUrl: 'http://127.0.0.1:8765',
  backendMode: 'local' as const,
  backendUrl: '',
  languageCatalogUrl: DEFAULT_LANGUAGE_CATALOG_URL,
  cloudAuthToken: '',
  cloudAuthAccessToken: '',
  cloudAuthRefreshToken: '',
  cloudAuthUserId: '',
  cloudAuthUserEmail: '',
  cloudAuthExpiresAt: 0,
  cloudAuthStatus: 'signed-out',
  nodeServerUrl: `http://127.0.0.1:${PROXY_SERVER_PORT}`,
  overrideCloudEndpointUrl: false,
  cloudLoginUrl: '',
  cloudApiUrl: '',
  lastModified: 0,
  openAside: true,
  llmEnabled: true,
  ocrEnabled: true,
  voiceEnabled: true,
  subsOffsetTime: 0,
  immediateFetch: false,
  subtitleTheme: 'shadow',
  subtitle_font_size: 40,
  subtitle_font_weight: 400,
  overlayAutoPosition: true,
  overlayTextMode: false,
  showPitchAccent: true,
  timeWatched: 0,
  maxNewCardsPerDay: 10,
  proportionOfExamCards: 0.5,
  wordSyncStaleLearningDays: 30,
  createUnseenCards: true,
  flashcardLLMExamples: false,
  newDayHour: 4,
  flashcardFlipAnimation: true,
  leechThreshold: 10,
  flashcardMediaType: 'image',
  flashcardVideoMargin: 300,
  autoSuggestFlashcards: true,
  autoSuggestUnknownWords: true,
  learningLanguageLevel: 3,
  devMode: false,
  lowBatteryMode: false,
  ocr_crop_padding: 200,
  showLiveTranslator: true,
  liveTranslatorIncludeKnown: false,
  blurKnownWords: false,
  ocrRamSaver: false,
  ocrTurboMode: false,
  ocrFuriganaDetection: true,
  ocrFuriganaWidthRatio: 1.5,
  ocrFuriganaNeighborWindowMultiplier: 2.4,
  ocrFuriganaNeighborLookahead: 3,
  ocrProvider: 'local',
  readerWordHoverTrigger: 'hover',
  readerWordHoverKey: 'shift',
  readerFuriganaHider: false,
  readerCollatePages: false,
  readerPageMode: 'double',
  readerFirstPageSingle: true,
  hideReadingForKnownWords: false,
  readerMagnifierHotkey: 'z',
  readerMagnifierZoom: 2,
  readerMagnifierSize: 200,
  anki_field_expression: 'Expression',
  anki_field_reading: 'Reading',
  anki_field_meaning: 'Meaning',
  anki_model_name: 'Basic',
  ankiTemplateExpression: '{word}',
  ankiTemplateReading: '{reading}',
  ankiTemplateMeaning: '{meaning}',
  passiveEaseEnabled: true,
  passiveHoverDelayMs: 300,
  passiveHoverFailCount: 1,
  passiveHoverFailAction: 'decrease-ease',
  passiveHoverEaseDecrease: 0.05,
  llmConfigured: false,
  llmProvider: 'builtin',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: '',
  builtinModel: 'Qwen3.5-9B-Q4_K_M.gguf',
  builtinModelAutoselected: false,
  speechEnabled: false,
  autoSpeak: false,
  sttLanguage: '',
  voiceMode: 'vad',
  ttsProvider: 'kokoro',
  voiceTtsSpeed: 1.0,
  voiceAutoSendOnSilence: true,
  voiceSilenceThreshold: 1.2,
  uiLanguage: 'en',
  flashcardAutoTts: true,
  flashcardTtsProvider: 'kokoro',
  flashcardAutoGenerateAudio: false,
  flashcardVoiceSampleId: '',
  flashcardStealthMode: false,
  flashcardMuteAudio: false,
  agentMemoryEnabled: true,
  agentMemoryShared: true,
  agentMistakeChecker: true,
  agentSafetyChecker: true,
  installedBrowserExtensions: [],
  eulaAccepted: false,
  eulaAcceptedVersion: '',
  eulaAcceptedAt: 0,
  eulaAcceptedHash: '',
  cloudTosAccepted: false,
  cloudTosAcceptedAt: 0,
  cloudPrivacyAccepted: false,
  cloudPrivacyAcceptedAt: 0,
  cloudLLMTierConversation: 'cheap',
  cloudLLMTierVoice: 'fast',
  cloudLLMTierExplanation: 'cheap',
};

// ============================================================================
// Language Data Types
// ============================================================================

export interface FrequencyLevelNames {
  [level: string]: string;
}

export interface GrammarPoint {
  /** The grammar pattern text */
  pattern: string;
  /** Meaning/explanation of the grammar point */
  meaning: string;
  /** Numeric difficulty level (same scale as frequency levels) */
  level: number;
}

export interface LanguageDataAsset {
  /** Stable asset id, e.g. "dictionary". */
  id: string;
  /** Relative destination under the per-user language data root. */
  path: string;
  /** Remote URL used by packaged apps to install this asset on demand. */
  url?: string;
  /** Provider-neutral link alias accepted in remote language catalogs. */
  href?: string;
  /** Optional relative path under root-of-app used by development/local builds. */
  bundledPath?: string;
  /** Expected file size, used for UI/status display. */
  sizeBytes?: number;
  /** Optional SHA-256 checksum for downloaded/copied payload verification. */
  sha256?: string;
  /** Whether backend startup requires this asset for the language. */
  required?: boolean;
}

export interface LanguageDataBundle {
  /** Remote archive URL used to install all required files for a language in one download. */
  url?: string;
  /** Provider-neutral link alias accepted in remote language catalogs. */
  href?: string;
  /** Expected archive size, used for UI/status display. */
  sizeBytes?: number;
  /** Optional SHA-256 checksum for archive verification before extraction. */
  sha256?: string;
}

export interface LanguageDataManifest {
  /** Data payload version independent from app version. */
  version?: string;
  /** Source/component versions that make up this language package. */
  sourceVersions?: Record<string, string>;
  /** Optional archive containing all files listed in assets. */
  bundle?: LanguageDataBundle;
  /** Files needed by this language, installed on demand into userData. */
  assets: LanguageDataAsset[];
}

export interface LanguageData {
  name: string;
  name_translated?: string;
  translatable: string[];  // Array of POS types that should be translated (e.g., ["名詞", "動詞"])
  colour_codes: ColorCodes;
  fixed_settings: Partial<Settings>;
  freq?: [string, string][];
  freq_level_names?: FrequencyLevelNames;
  /** Grammar points for this language */
  grammar?: GrammarPoint[];
  /** Level names for grammar (e.g., {"5": "JLPT N5", ...}) — reuses FrequencyLevelNames */
  grammar_level_names?: FrequencyLevelNames;
  /** Whether this language has grammar point data */
  hasGrammar?: boolean;
  /** Whether this language offers the OCR Ram Saver toggle (lightweight detection) */
  hasOcrRamSaver?: boolean;
  /** Whether this language can be written vertically (e.g. CJK vertical text) */
  supportsVerticalText?: boolean;
  /** Whether this language has furigana-like reading annotations alongside text (e.g. Japanese) */
  hasFurigana?: boolean;
  /** Whether this language uses CJK-style parentheses for character names (e.g. （角色名）) */
  usesCJKParentheses?: boolean;
  /** Whether this language primarily uses Latin script */
  usesLatinScript?: boolean;
  /** Unicode script tags used by this language (e.g., ["Latn"], ["Hira","Kana","Han"]) */
  supportedScripts?: string[];
  /** Whether this language has pitch accent data */
  hasPitchAccent?: boolean;
  /** Whether the language supports character name detection in subtitles */
  hasCharacterNames?: boolean;
  /** Whether this language has a distinct honorific/deferential register
   *  (e.g. Japanese keigo, Korean jondaetmal). T/V distinctions like German
   *  Sie/du do NOT count — set to false for those. */
  hasHonorifics?: boolean;
  /** Frequency boundaries for level assignment [level5Max, level4Max, level3Max, level2Max] */
  freq_level_boundaries?: number[];
  /** Heavy per-language payloads, installed into userData on demand. */
  languageData?: LanguageDataManifest;
}

export interface LanguageDataMap {
  [langCode: string]: LanguageData;
}

export interface LanguageCatalogEntry {
  /** URL to a per-language manifest. Relative URLs resolve against the catalog URL. */
  url?: string;
  /** Provider-neutral alias for url. */
  href?: string;
  name?: string;
  nameTranslated?: string;
  version?: string;
  bundle?: LanguageDataBundle;
  files?: LanguageDataAsset[];
}

export interface LanguageCatalogManifest {
  version?: string;
  languages: Record<string, LanguageData | LanguageCatalogEntry | string>;
}

export interface LanguageDataCatalogStatus {
  language: string;
  name: string;
  nameTranslated?: string;
  dataRoot: string;
  installed: boolean;
  totalBytes: number;
  installedBytes: number;
  missingRequiredAssets: string[];
  assets: Array<{
    id: string;
    path: string;
    installed: boolean;
    sizeBytes?: number;
  }>;
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
  /** Hash of source media when known */
  sourceMediaHash?: string;
  /** Video clip URL (flashcard-video:// protocol or Capacitor file URL) */
  videoUrl?: string;
  /** When true, skip automatic TTS generation for the example field (e.g. video clip provides audio) */
  skipExampleTts?: boolean;
  /** True when the card was created as a shell and still needs media/definition population */
  unpopulated?: boolean;
  /** Content fields edited by the user that automatic population should not overwrite */
  userEditedFields?: string[];
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
  /** Language this card belongs to (e.g. 'ja', 'de') — set at creation */
  language?: string;
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
  /** Language this candidate belongs to */
  language?: string;
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
 * Per-language daily flashcard meta counters
 */
export interface PerLanguageMeta {
  /** Number of new cards introduced today */
  newCardsToday: number;
  /** Number of reviews done today */
  reviewsToday: number;
  /** Date when new card count was last reset (YYYY-MM-DD) */
  newCardsDate: string;
}

/**
 * Flashcard store meta information
 */
export interface FlashcardMeta {
  /** Per-language daily counters */
  perLanguage: Record<string, PerLanguageMeta>;
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
  /** @deprecated Use perLanguage[lang].newCardsToday instead */
  newCardsToday?: number;
  /** @deprecated Use perLanguage[lang].reviewsToday instead */
  reviewsToday?: number;
  /** @deprecated Use perLanguage[lang].newCardsDate instead */
  newCardsDate?: string;
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
  /** Persisted ignored-word metadata keyed by language-prefixed word hash */
  ignoredWords: Record<string, IgnoredWordEntry>;
  /** Unified passive word knowledge (word hash -> PassiveWordKnowledge) */
  wordKnowledge: Record<string, PassiveWordKnowledge>;
  /** Grammar knowledge tracking (pattern -> GrammarKnowledgeEntry) */
  grammarKnowledge: Record<string, GrammarKnowledgeEntry>;
  /** Store metadata */
  meta: FlashcardMeta;
  /** Daily study statistics (date → language → stats) */
  dailyStats: Record<string, Record<string, DailyStudyStats>>;
  /**
   * Suggested flashcards captured automatically when the learner sees new
   * words. Keyed by a language-prefixed word hash (same key scheme as
   * wordCandidates). Suggestions only contain captured context (screenshot,
   * phrase, source) — translation/LLM/TTS are not run until the user promotes
   * them via the Suggested Flashcards tab.
   */
  suggestedFlashcards: Record<string, SuggestedFlashcard>;
  /**
   * Timestamps recording when words were last seen in the Word Sync window.
   * Keyed by language-prefixed word hash (same scheme as wordKnowledge).
   * Words seen less than ~30 days ago are skipped on next sync.
   */
  wordSyncSeen: Record<string, number>;
  /** Version for migrations */
  version: number;
}

/**
 * A captured "suggested" flashcard – produced automatically when the learner
 * encounters a new word during a study session. No translation/LLM/TTS work
 * has been performed yet; those happen only when the suggestion is promoted
 * to a full flashcard.
 */
export interface SuggestedFlashcard {
  /** Stable id (UUID) used when later promoted into a full card */
  id: string;
  /** The word as captured (canonicalized before lookup) */
  word: string;
  /** Reading, if available at capture time */
  reading?: string;
  /** Part-of-speech from the source tokenizer, if available */
  pos?: string;
  /** Frequency list raw_level at capture time (null when not in freq list) */
  level?: number | null;
  /** Language code this suggestion belongs to */
  language: string;
  /** Cleaned context phrase (e.g. subtitle or OCR sentence) */
  contextPhrase?: string;
  /** HTML-coloured context (matches flashcard example format) */
  contextHtml?: string;
  /** Captured screenshot URL (flashcard-image:// or data URL) */
  imageUrl?: string;
  /** Captured video clip URL (flashcard-video:// or blob URL) */
  videoUrl?: string;
  /** Source media name (video file, book name, etc.) */
  source?: string;
  /** Hash of the source media (matches MediaStats.mediaHash when known) */
  sourceMediaHash?: string;
  /** When the suggestion was first captured */
  createdAt: number;
  /** Last time this suggestion was refreshed (e.g. seen again) */
  lastSeen: number;
  /** Number of times the word has been seen since capture */
  count: number;
}

/**
 * Review session queue management
 */
export interface ReviewQueue {
  /** New cards available for today */
  newQueue: string[];
  /** Single scheduled queue for learning, relearning, and review cards due this SRS day */
  scheduledQueue: string[];
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

/** @deprecated Use PassiveWordKnowledge for unified system */
export interface WordKnowledge {
  status: NumericWordStatus;
  ease: number;
  lastSeen?: string;
  appearances: number;
}

/** Unified passive word knowledge tracked in FlashcardStore */
export interface PassiveWordKnowledge {
  /** Ease factor 0–5, default 2.5. Lower = less known */
  ease: number;
  /** Timestamp of last encounter */
  lastSeen: number;
  /** Total times word was displayed on screen */
  timesSeen: number;
  /** Times a hover lasted long enough to count toward failed-word tracking */
  timesHovered: number;
  /** The word text */
  word: string;
  /** Reading/pronunciation if available */
  reading?: string;
  /** Language this knowledge entry belongs to */
  language?: string;
  /** timesSeen when user first manually changed status (undefined = never changed) */
  statusChangedAtSeen?: number;
  /** Timestamp of last knowledge status change (manual rating, sync, or SRS-driven) */
  lastStatusChange?: number;
  /** Timestamp when this word was explicitly rated in the Word Sync window (undefined = never) */
  wordSyncRatedAt?: number;
}

/** Ignored word entry tracked per language for browse/unignore workflows */
export interface IgnoredWordEntry {
  /** The raw word text */
  word: string;
  /** Reading/pronunciation if available */
  reading?: string;
  /** Language this ignore entry belongs to */
  language?: string;
  /** Timestamp when the word was ignored */
  ignoredAt: number;
}

/** Grammar knowledge entry tracked in FlashcardStore */
export interface GrammarKnowledgeEntry {
  /** The grammar pattern */
  pattern: string;
  /** Ease factor 0–5, default 2.5 */
  ease: number;
  /** Times the pattern was passively encountered */
  timesEncountered: number;
  /** Times user needed help (explainer, copy) */
  timesFailed: number;
  /** Timestamp of last encounter */
  lastSeen: number;
  /** Difficulty level from language data */
  level: number;
  /** Language this grammar entry belongs to */
  language?: string;
}

export interface WordFrequencyEntry {
  reading: string;
  level: string;
  raw_level: number;
  /** Additional readings for words that have multiple independent senses */
  alternateReadings?: string[];
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
  moraCharCounts: number[];
}

// ============================================================================
// IPC Message Types
// ============================================================================

export interface InstallOptions {
  includeLLM: boolean;
  includeOCR: boolean;
  includeVoice?: boolean;
}

export interface InstallerState {
  waiting: boolean;
  inProgress: boolean;
  success: boolean;
  options: InstallOptions;
}

export interface PipProgress {
  /** Package currently being processed */
  packageName: string;
  /** Current package index (1-based) */
  current: number;
  /** Total number of packages to install */
  total: number;
  /** Current pip action: collecting, downloading, installing, etc. */
  action: string;
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
  /** Context data to pass to the new window */
  context?: Record<string, unknown>;
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
// LLM Types (Legacy — Python backend)
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
// Unified LLM Types
// ============================================================================

/** LLM backend provider */
export type LLMProvider = 'builtin' | 'ollama' | 'cloud';

/** Cloud LLM model tier */
export type CloudLLMTier = 'fast' | 'cheap';

/** Configuration for a built-in GGUF model */
export interface BuiltinModelConfig {
  /** Unique identifier e.g. 'qwen3.5-4b' */
  id: string;
  /** Display name e.g. 'Qwen 3.5 4B' */
  displayName: string;
  /** GGUF filename e.g. 'Qwen3.5-4B-Q4_K_M.gguf' */
  modelFile: string;
  /** HuggingFace repo path e.g. 'unsloth/Qwen3.5-4B-GGUF' */
  modelRepo: string;
  /** Runtime memory requirement in GB */
  requiredMemoryGb: number;
  /** Approximate download size in GB */
  fileSizeGb: number;
}

/** System memory info returned by the main process for autoselect */
export interface SystemMemoryInfo {
  hasDiscreteGpu: boolean;
  dedicatedVramBytes: number;
  totalRamBytes: number;
}

/** OCR backend provider */
export type OCRProvider = 'local' | 'cloud';

/** Conversation agent personality mode */
export type AgentPersonality = 'polite' | 'casual' | 'roleplay';

/** TTS backend provider */
export type TTSProvider = 'kokoro' | 'qwen3' | 'cloud';

/** Provider-agnostic chat message */
export interface LLMChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: LLMToolCall[];
  toolName?: string;
  toolCallId?: string;
}

/** Provider-agnostic tool definition */
export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** Provider-agnostic tool call result */
export interface LLMToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Chunk emitted during LLM streaming */
export interface LLMStreamChunk {
  /** Incremental text content */
  content?: string;
  /** Whether this is the final chunk */
  done?: boolean;
  /** Tool calls detected in this chunk */
  toolCalls?: LLMToolCall[];
  /** Error message if something went wrong */
  error?: string;
  /** Token count for stats (final chunk) */
  evalCount?: number;
  /** Duration in nanoseconds for stats (final chunk) */
  evalDuration?: number;
  /** Prompt eval duration in nanoseconds (final chunk) */
  promptEvalDuration?: number;
  /** Total duration in nanoseconds (final chunk) */
  totalDuration?: number;
}

/** Model download/readiness status */
export interface LLMModelStatus {
  /** Whether the model file exists on disk */
  downloaded: boolean;
  /** Whether a download is currently in progress */
  downloading: boolean;
  /** Download progress 0.0–1.0 */
  progress: number;
  /** Total bytes downloaded */
  downloadedBytes: number;
  /** Total expected bytes */
  expectedBytes: number;
  /** Whether the model is loaded into memory and ready */
  loaded: boolean;
  /** Error message if download/load failed */
  error?: string;
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
  voice?: string[];
  'qwen3-tts'?: string[];
}

// ============================================================================
// Media Statistics Types
// ============================================================================

export interface MediaStatsWordEntry {
  word: string;
  ease: number;
  timesSeen: number;
  /** Times a hover lasted long enough to count toward failed-word tracking */
  timesHovered: number;
}

export interface MediaStatsGrammarEntry {
  pattern: string;
  ease: number;
  timesFailed: number;
}

export interface MediaSession {
  date: string;
  duration: number;
  wordsLearned: number;
  /** Epoch ms when the session started (undefined for legacy sessions) */
  startTime?: number;
  /** Epoch ms when the session ended (undefined for legacy sessions) */
  endTime?: number;
}

export interface MediaStats {
  mediaHash: string;
  mediaName: string;
  mediaType: 'video' | 'book';
  language: string;
  wordsEncountered: Record<string, MediaStatsWordEntry>;
  grammarEncountered: Record<string, MediaStatsGrammarEntry>;
  assessedLevel: number | null;
  sessions: MediaSession[];
  totalTimeSpent: number;
  lastAccessed: number;
  /** Cached OCR results per page for books */
  ocrCache?: Record<number, Token[]>;
}

// ============================================================================
// Conversation Agent Types
// ============================================================================

export type ConversationRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ConversationMessage {
  role: ConversationRole;
  content: string;
  /** Tool call results or tool invocations */
  toolCalls?: ToolCall[];
  toolCallId?: string;
  /** Tokenized content for interactive rendering */
  tokens?: Token[];
  /** Timestamp */
  timestamp: number;
  /** Rendered widget data (quiz, mistake, etc.) */
  widget?: ChatWidget;
  /** Rendered widgets in order when multiple tool calls occur in one assistant turn */
  widgets?: ChatWidget[];
  /** Inline corrections applied to user messages by the AI tutor */
  corrections?: MistakeWidgetData[];
  /** Safety signal produced by the checker sidecar */
  safety?: ConversationSafetyFlag;
  /** Generation timing stats (assistant messages only) */
  streamStats?: StreamStats;
  /** Whether the TTS output was interrupted by the user speaking */
  interrupted?: boolean;
  /** The content up to where TTS was interrupted (e.g. "I have eaten a green") */
  interruptedAt?: string;
  /** Whether this message represents an error from the AI */
  isError?: boolean;
}

/** Performance stats from the LLM streaming response */
export interface StreamStats {
  /** Time from request sent to first token (ms) */
  timeToFirstToken: number;
  /** Total generation time (ms) */
  totalTime: number;
  /** Tokens per second */
  tokensPerSecond: number;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type ChatWidgetType = 'quiz' | 'mistake' | 'url-fetch' | 'stats';

export interface ChatWidget {
  type: ChatWidgetType;
  data: Record<string, unknown>;
  /** Whether the user has interacted with this widget */
  resolved?: boolean;
}

export interface QuizWidgetData {
  type: 'mcq' | 'text-input' | 'fill-in';
  question: string;
  /** Phrase template with [] placeholders for fill-in mode */
  textWithBlanks?: string;
  options?: string[];
  correctAnswer: string;
  affectedPattern?: string;
  userAnswer?: string;
  isCorrect?: boolean;
  /** Tokenized question text for interactive rendering */
  tokens?: Token[];
}

export interface MistakeWidgetData {
  userMessageIndex: number;
  errorSpan: string;
  correction: string;
  errorType: 'grammar' | 'word' | 'typo' | 'unnatural' | 'other';
  affectedPattern?: string;
  /** Text immediately before the error span for disambiguation */
  contextBefore?: string;
  /** Text immediately after the error span for disambiguation */
  contextAfter?: string;
  /** Source of this correction: 'agent' (inline from tutor) or 'checker' (separate checker agent) */
  source?: 'agent' | 'checker';
  /** Alternative corrections suggested by the checker agent */
  alternatives?: string[];
}

export type ConversationSafetyCategory = 'self-harm' | 'self-harm-related';

export type ConversationSafetySeverity = 'concern' | 'urgent';

export interface ConversationSafetyFlag {
  category: ConversationSafetyCategory;
  severity: ConversationSafetySeverity;
  flaggedSpan?: string;
  contextBefore?: string;
  contextAfter?: string;
  source?: 'checker';
}

// ============================================================================
// Ollama Types
// ============================================================================

export interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
}

export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Tool calls made by the assistant (Ollama format) */
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
  /** Name of the tool that produced this message (for role: 'tool') */
  tool_name?: string;
}

export interface OllamaToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// ============================================================================
// Speech Types
// ============================================================================

// ============================================================================
// Conversation Agent Config & Memory Types
// ============================================================================

/** Roleplay formality sub-option */
export type RoleplayFormality = 'polite' | 'casual';

/** Persistent agent configuration (stored in KV store) */
export interface AgentConfig {
  /** Unique identifier for this agent */
  id: string;
  /** Agent display name (empty = unnamed) */
  agentName: string;
  /** User's display name */
  userName: string;
  /** Personality mode */
  personality: AgentPersonality;
  /** Roleplay character name (only when personality === 'roleplay') */
  roleplayName: string;
  /** Roleplay character lore/description (only when personality === 'roleplay') */
  roleplayLore: string;
  /** Whether the initial setup has been completed */
  setupComplete: boolean;
  /** Formality sub-option for roleplay personality */
  roleplayFormality?: RoleplayFormality;
  /** Default voice sample ID for this agent's TTS */
  voiceSampleId?: string;
  /** Profile photo as base64 data URI */
  profilePhoto?: string;
  /** User's self-description — used as context for the agent */
  aboutMe?: string;
  /** Sample quotes for roleplay characters (2-4 short quotes) */
  roleplayQuotes?: string[];
  /** Fandom wiki base URL for roleplay character lookup (e.g. https://myheroacademia.fandom.com) */
  roleplayFandomUrl?: string;
  /** Story context summary for roleplay — plot summary up to the user's progress point */
  roleplayContext?: string;
}

/** A single memory entry stored by the agent */
export interface AgentMemoryEntry {
  /** Unique ID */
  id: string;
  /** ID of the agent that created this memory */
  agentId: string;
  /** Memory content */
  content: string;
  /** Timestamp of when the memory was created */
  timestamp: number;
}

/** A conversation session with an AI tutor */
export interface ConversationSession {
  /** Unique ID */
  id: string;
  /** Display title */
  title: string;
  /** ID of the agent this session belongs to, or null for legacy sessions */
  agentId: string | null;
  /** Messages in the conversation */
  messages: ConversationMessage[];
  /** Full LLM history for context reconstruction */
  llmHistory: LLMChatMessage[];
  /** Timestamp of session creation */
  createdAt: number;
  /** Timestamp of last activity */
  updatedAt: number;
  /** Total number of messages (for efficient count queries) */
  messageCount: number;
}

// ============================================================================
// Conversation Agent Context Types
// ============================================================================

/** Context passed to the conversation agent window when opened from a media route */
export interface ConversationAgentContext {
  mediaName: string;
  mediaType: 'video' | 'book';
  mediaHash: string;
  assessedLevel: number | null;
  assessedLevelName: string;
  language: string;
  failedWords: MediaStatsWordEntry[];
  failedGrammar: MediaStatsGrammarEntry[];
  wordLevelPercentages: LevelPercentages;
  grammarLevelPercentages: LevelPercentages;
  characterContext?: string;
  subtitleHistory?: string[];
}

/** Grammar point selected by the user for a tutor session */
export interface TutorGrammarSelection {
  pattern: string;
  meaning: string;
  level: number;
}

/** Word selected by the user for a tutor session */
export interface TutorWordSelection {
  word: string;
  reading?: string;
  ease: number;
}

/** Media selected by the user for a tutor session, with its failed data */
export interface TutorMediaSelection {
  mediaHash: string;
  mediaName: string;
  mediaType: 'video' | 'book';
  failedWords: MediaStatsWordEntry[];
  failedGrammar: MediaStatsGrammarEntry[];
}

/** Configuration for an AI tutor session launched from the welcome page */
export interface TutorSessionConfig {
  /** Grammar points the user wants to focus on */
  selectedGrammar: TutorGrammarSelection[];
  /** Words the user wants to practice */
  selectedWords: TutorWordSelection[];
  /** Media the user selected (with their failed words/grammar, minus excluded) */
  selectedMedia: TutorMediaSelection[];
  /** Custom instructions from the user (scenario, roleplay, etc.) */
  customInstructions: string;
}

/** Level distribution data for analytics display */
export interface LevelPercentageEntry {
  level: number;
  levelName: string;
  /** Percentage by unique items */
  uniquePercent: number;
  /** Percentage by occurrence count */
  occurrencePercent: number;
  /** Count of unique items at this level */
  uniqueCount: number;
  /** Total occurrences at this level */
  occurrenceCount: number;
}

export interface LevelPercentages {
  entries: LevelPercentageEntry[];
  totalUnique: number;
  totalOccurrences: number;
}

export interface SpeechModelInfo {
  language: string;
  modelPath: string;
  downloaded: boolean;
  size: number;
}

export interface STTResult {
  transcript: string;
  isFinal: boolean;
}

export interface TTSStatus {
  speaking: boolean;
  progress: number;
}

// ============================================================================
// Voice Call Mode Types
// ============================================================================

export type VoiceMode = 'vad' | 'push-to-talk';

export interface VoiceModelStatus {
  sttDownloaded: boolean;
  ttsDownloaded: boolean;
  vadDownloaded: boolean;
  downloading: boolean;
  progress: number;
  error?: string;
  statusMessage?: string;
  sttModelName?: string;
  ttsModelName?: string;
}

export interface VoiceSTTResult {
  text: string;
  isFinal: boolean;
  isPartial: boolean;
}

export interface VoiceVadEvent {
  type: 'speech-start' | 'speech-end';
}

export interface VoiceTtsAudio {
  samples: Float32Array;
  sampleRate: number;
  sentenceIndex?: number;
  sentenceText?: string;
  totalSentences?: number;
  sampleOffset?: number;
  sampleCount?: number;
}

export interface VoiceTtsStatus {
  generating: boolean;
  playing: boolean;
  modelLoading?: boolean;
  downloadProgress?: number;
}

export interface VoiceSessionReady {
  ready: true;
}

export interface VoiceSessionError {
  error: string;
}

/** A user-uploaded voice sample for TTS voice cloning */
export interface VoiceSample {
  id: string;
  name: string;
  filename: string;
  language?: string;
  transcript?: string;
  createdAt: number;
}

/** A mistake noted by the LLM during voice mode */
export interface VoiceMistake {
  word: string;
  reading?: string;
  context: string;
  correction: string;
  type: string;
}

/** Summary displayed after a voice call session ends */
export interface VoiceSessionAftermath {
  mistakes: VoiceMistake[];
  duration: number;
  messageCount: number;
}
