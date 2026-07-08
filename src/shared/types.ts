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

export type ReaderSpreadDirection = 'left-to-right' | 'right-to-left';

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
  /**
   * Built-in SRS ease above which a word is considered known (integer, 0–5000 = 0.0–5.0 scale).
   *
   * @deprecated Use `easeThresholdKnown` for new settings UI/business logic.
   * This persisted key is retained for compatibility with older settings files.
   */
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
  /** Preferred definition/gloss language per learning language, e.g. { ja: "fr" }. */
  dictionaryTargetLanguages: Record<string, string>;
  hover_known_get_from_dictionary: boolean;
  show_pos: boolean;
  /** Preferred persisted toggle for reading annotations. Prefer readingAnnotationsEnabled() when reading it. */
  showReadingAnnotations?: boolean;
  hideReadingForKnownWords?: boolean;
  /** Preferred persisted toggle for prosody/accent display. Prefer prosodyVisible() when reading it. */
  showProsody: boolean;
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
  proportionOfLevelCards: number;
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
   * Uses the active language package's raw_level scale.
   *
   * @deprecated Use `learningLanguageLevels[language]` so each learning language
   * has its own package-defined level scale.
   */
  learningLanguageLevel: number | null;
  /**
   * Preferred learning/proficiency ceiling per learning language. Values use that
   * language's raw_level scale, so each language can define its own proficiency
   * or frequency buckets independently.
   */
  learningLanguageLevels: Record<string, number | null>;

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
  /**
   * Bearer token for cloud backend auth.
   *
   * @deprecated Use `cloudAuthAccessToken`; this remains only as a migration
   * fallback for older settings files.
   */
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
  /** Persisted visibility of the right-side unknown-words sidebar in media windows. */
  rightSidebarOpen: boolean;
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
  /** Enable reading annotation detection and filtering in OCR results (default true) */
  ocrReadingAnnotationFiltering?: boolean;
  /** Width ratio threshold for filtering narrow reading annotation boxes (default 1.5) */
  ocrReadingAnnotationWidthRatio?: number;
  /** Window multiplier for neighbor detection (default 2.4) */
  ocrReadingAnnotationNeighborWindowMultiplier?: number;
  /** Number of boxes to look ahead when detecting reading annotation neighbors (default 3) */
  ocrReadingAnnotationNeighborLookahead?: number;
  /** OCR backend provider */
  ocrProvider?: OCRProvider;

  // Reader word hover settings
  /** How word hover is triggered: 'hover', 'long-hover', 'key-hover' */
  readerWordHoverTrigger?: WordHoverTriggerMode;
  /** Key to hold for 'key-hover' mode (e.g., 'Shift', 'Control', 'Alt') */
  readerWordHoverKey?: string;
  /** Whether to hide detected reading annotations with white boxes that reveal on hover */
  readerReadingAnnotationHider?: boolean;
  /** Whether to remove the gap between pages in double-page mode */
  readerCollatePages?: boolean;
  readerPageMode?: 'single' | 'double';
  readerFirstPageSingle?: boolean;
  /** Visual order for double-page spreads. Right-to-left preserves manga/booklet defaults. */
  readerSpreadDirection?: ReaderSpreadDirection;

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
  /** STT model override (empty string = platform auto-pick: MLX turbo on Apple Silicon, FW large-v3-turbo on CUDA, FW small on CPU). */
  sttModel: string;

  // Voice call mode settings
  /** Voice input mode: hands-free VAD or push-to-talk */
  voiceMode: VoiceMode;
  /** Voice-call TTS backend provider. Cloud is a legacy value and is normalized to Qwen3. */
  ttsProvider: VoiceCallTTSProvider;
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
  language: '',
  dictionaryTargetLanguages: {},
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
  showReadingAnnotations: true,
  enable_flashcard_creation: true,
  automaticFlashcardCreation: false,
  flashcard_deck: null,
  ankiDeckName: 'mLearn',
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
  rightSidebarOpen: true,
  llmEnabled: true,
  ocrEnabled: true,
  voiceEnabled: true,
  subsOffsetTime: 0,
  immediateFetch: false,
  subtitleTheme: 'shadow',
  subtitle_font_size: 40,
  subtitle_font_weight: 400,
  showSubtitles: true,
  showTranslation: false,
  removeParentheses: false,
  removeSpeakerNames: false,
  overlayAutoPosition: true,
  overlayTextMode: false,
  showProsody: true,
  timeWatched: 0,
  maxNewCardsPerDay: 10,
  proportionOfLevelCards: 0.5,
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
  learningLanguageLevel: null,
  learningLanguageLevels: {},
  devMode: false,
  lowBatteryMode: false,
  ocr_crop_padding: 200,
  showLiveTranslator: true,
  liveTranslatorIncludeKnown: false,
  blurKnownWords: false,
  ocrRamSaver: false,
  ocrTurboMode: false,
  ocrReadingAnnotationFiltering: true,
  ocrReadingAnnotationWidthRatio: 1.5,
  ocrReadingAnnotationNeighborWindowMultiplier: 2.4,
  ocrReadingAnnotationNeighborLookahead: 3,
  ocrProvider: 'local',
  readerWordHoverTrigger: 'hover',
  readerWordHoverKey: 'shift',
  readerReadingAnnotationHider: false,
  readerCollatePages: false,
  readerPageMode: 'double',
  readerFirstPageSingle: true,
  readerSpreadDirection: 'right-to-left',
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
  sttModel: '',
  voiceMode: 'vad',
  ttsProvider: 'kokoro',
  voiceTtsSpeed: 1.0,
  voiceAutoSendOnSilence: true,
  voiceSilenceThreshold: 0.8,
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

export type GrammarTokenField = 'word' | 'surface' | 'actual_word' | 'lemma' | 'reading' | 'type' | 'partOfSpeech';

export interface GrammarTokenMatcher {
  /** Token field to inspect. Defaults to "word". "lemma" aliases actual_word. */
  field?: GrammarTokenField;
  /** Exact value to match. */
  equals?: string;
  /** Any exact value to match. */
  oneOf?: string[];
  /** Regular expression source to match against the selected value. */
  regex?: string;
  /** Canonical POS category to match after language part-of-speech aliases are applied. */
  canonicalPartOfSpeech?: string;
  /** Morphosyntactic features to match, e.g. { Case: "Acc", Number: ["Sing", "Plur"] }. */
  features?: Record<string, string | string[]>;
  /** Per-token case sensitivity override. Defaults to the enclosing grammar match config, then false. */
  caseSensitive?: boolean;
}

export interface GrammarMatchConfig {
  /** Matching strategy. Defaults to "text" for legacy pattern matching. */
  type?: 'text' | 'token-sequence';
  /** Text pattern to match when type="text". Defaults to GrammarPoint.pattern. */
  text?: string;
  /** Ordered token matchers used when type="token-sequence". */
  tokens?: GrammarTokenMatcher[];
  /** Whether string comparisons preserve case. Defaults to false. */
  caseSensitive?: boolean;
}

export interface GrammarPoint {
  /** The grammar pattern text */
  pattern: string;
  /** Meaning/explanation of the grammar point */
  meaning: string;
  /** Numeric difficulty level (same scale as frequency levels) */
  level: number;
  /** Optional metadata-driven matcher for non-substring grammars. */
  match?: GrammarMatchConfig | GrammarMatchConfig[];
}

export interface LanguageDataAsset {
  /** Stable asset id, e.g. "dictionary". */
  id: string;
  /** Relative destination under the per-user language data root. */
  path: string;
  /** Runtime components this asset belongs to. Omitted means core language data. */
  components?: LanguagePythonRequirementComponent[];
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

export interface LanguageDictionaryPack {
  /** Definition/gloss language for this dictionary pack, e.g. "en", "fr", "de". */
  targetLanguage: string;
  /** Human-readable target language name shown in setup/settings. */
  name: string;
  /** Dictionary payload version independent from app version. */
  version?: string;
  /** Optional archive containing all files listed in assets. */
  bundle?: LanguageDataBundle;
  /** Files needed by this dictionary pack, installed on demand into userData. */
  assets: LanguageDataAsset[];
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
  /** Optional dictionary payloads keyed by definition/gloss language. */
  dictionaryPacks?: Record<string, LanguageDictionaryPack>;
}

export interface LanguageScriptProfile {
  /** Unicode script tags accepted for words in this language, e.g. ["Latn"], ["Arab"], ["Hira","Kana","Han"]. */
  acceptedScripts?: string[];
  /** Package-declared code-point ranges for scripts not known to the backend yet, e.g. {"Osge": [[66736, 66815]]}. */
  scriptRanges?: Record<string, Array<[number, number]>>;
  /** Scripts that should appear for strict validation. Defaults to acceptedScripts. */
  requiredScripts?: string[];
  /** How strictly word-level filters should reject letters outside acceptedScripts. */
  wordScriptValidation?: 'contains-required' | 'only-accepted';
  /** Whether Latin romanization is acceptable for user/STT input even when it is not a native script. */
  allowsRomanization?: boolean;
  /** Minimum code-point length for candidate words. Useful for scripts where one-character OCR hits are noisy. */
  minWordCodePoints?: number;
  /** Reject STT results made only from these scripts when no non-rejected script is present. */
  sttRejectPureScripts?: string[];
  /** Exact one-token STT noise strings to discard for this language. */
  sttNoiseCharacters?: string[];
}

export type LanguageNormalizerPresetName = 'arabic-script' | 'persian-arabic' | (string & {});

export type LanguagePresetNormalizerStep = {
  type: 'preset';
  name: LanguageNormalizerPresetName;
};

export type LanguageReplaceCharactersNormalizerStep = {
  type: 'replace-characters';
  map: Record<string, string>;
};

export type LanguageReplaceAffixNormalizerStep = {
  type: 'replace-prefix' | 'replace-suffix';
  /** Exact prefix/suffix to replace. */
  from: string;
  /** Replacement text. Defaults to an empty string for stripping. */
  to?: string;
};

export type LanguageTextNormalizerStep =
  | 'lowercase'
  | 'casefold'
  | 'strip-diacritics'
  | 'lowercase-strip-diacritics'
  | 'unicode-nfc'
  | 'unicode-nfd'
  | 'unicode-nfkc'
  | 'unicode-nfkd'
  | 'remove-arabic-diacritics'
  | 'remove-tatweel'
  | 'arabic-script'
  | 'persian-arabic'
  | LanguagePresetNormalizerStep
  | LanguageReplaceCharactersNormalizerStep
  | LanguageReplaceAffixNormalizerStep;

export interface LanguageLexemeNormalization {
  /** How written forms and readings are connected for dictionary/frequency lookup. */
  type?: 'identity' | 'surface-reading' | 'reading' | 'surface';
  /** Surface scripts that should be treated as canonical written forms, e.g. ["Han"]. */
  surfaceScripts?: string[];
  /** Ordered normalizers for written-form variants before frequency/knowledge lookup. */
  surfaceNormalizers?: LanguageTextNormalizerStep[];
  /** Reading/transliteration scripts that may resolve to canonical written forms, e.g. ["Latn"]. */
  readingScripts?: string[];
  /** Single-character reading/transliteration marks allowed alongside readingScripts, e.g. Arabic romanization ʿ/ʾ. */
  readingExtraCharacters?: string[];
  /** Optional reading normalization before lookup. */
  readingNormalizer?: LanguageReadingNormalizer;
  /** Keep words written in a secondary reading script distinct from canonical headwords. */
  preserveNonPrimaryReadingScript?: boolean;
}

export type LanguageReadingNormalizerStep =
  | 'none'
  | 'kana-to-hiragana'
  | LanguageTextNormalizerStep;

export type LanguageReadingNormalizer = LanguageReadingNormalizerStep | LanguageReadingNormalizerStep[];

export interface LanguageWordIndexStrategy {
  /** How flashcard/card indexes should compare expressions for this language. */
  type?: 'whole-expression' | 'character-containment';
}

export interface LanguageTokenEstimationConfig {
  /** Scripts whose text is dense in LLM context windows, independent of word-index matching. */
  compactScripts?: string[];
}

export interface LanguageReadingAnnotationConfig {
  /** How written forms and readings should be rendered together. */
  type?: 'none' | 'script-reading';
  /** Visual renderer for the surface and reading. Defaults to ruby for compact annotations. */
  display?: 'ruby' | 'inline';
  /** Surface scripts that should receive reading annotations, e.g. ["Han"]. */
  annotationScripts?: string[];
  /** Scripts at the end of a surface form that should remain visible in the displayed reading. */
  surfaceSuffixScripts?: string[];
  /** Separator used when joining token readings for TTS or plain text display. */
  readingSeparator?: string;
  /** Whether subtitle patterns like word(reading) should be consumed as temporary readings. */
  stripParentheticalReadings?: boolean;
}

export interface LanguagePartOfSpeechConfig {
  /** Canonical POS categories that should trigger translation/dictionary lookup. */
  translatable?: string[];
  /** Tokenizer-specific POS labels mapped to canonical POS categories, e.g. {"NOUN": "noun", "名詞-普通名詞": "名詞"}. */
  aliases?: Record<string, string>;
  /** POS categories that should never be treated as translatable, even when no translatable allow-list is configured. */
  ignored?: string[];
  /** Package-provided default colors for canonical POS categories. User Settings.colour_codes overrides these. */
  colors?: ColorCodes;
  /** Whether POS category comparisons should preserve case. Defaults to false for tokenizer interoperability. */
  caseSensitive?: boolean;
}

export interface LanguageSubtitleParsingConfig {
  /** Speaker-label prefixes to strip when the user enables "remove speaker names". */
  speakerNamePrefix?: {
    /** Disable speaker-label stripping for this language even when the user setting is enabled. */
    enabled?: boolean;
    /** Scripts accepted inside speaker labels. Defaults to the language script profile. */
    scripts?: string[];
    /** Also accept Latin-script labels for translated/romanized subtitle labels. Defaults to false. */
    allowLatinFallback?: boolean;
    /** Maximum label length before the colon. Defaults to 40 code points. */
    maxCodePoints?: number;
    /** Colon-like delimiters that mark speaker labels. Defaults to ":" and "：". */
    delimiters?: string[];
  };
  /** Character-name prefixes used to build media context for the tutor. */
  characterNamePrefix?: {
    /** Enable character-name extraction for this language's subtitle conventions. */
    enabled?: boolean;
    /** Scripts accepted inside character names. Defaults to the language script profile. */
    scripts?: string[];
    /** Also accept Latin-script labels for translated/romanized subtitle labels. Defaults to false. */
    allowLatinFallback?: boolean;
    /** Maximum label length before a delimiter/bracket close. Defaults to 30 code points. */
    maxCodePoints?: number;
    /** Minimum repeated lines before a detected name is included. Defaults to 2. */
    minLineCount?: number;
    /** Colon-like delimiters that mark speaker/character labels. Defaults to ":" and "：". */
    delimiters?: string[];
    /** Opening/closing bracket pairs that mark character labels. Defaults to legacy subtitle brackets. */
    bracketPairs?: Array<[string, string]>;
  };
}

export interface LanguageTextProcessingConfig {
  scriptProfile?: LanguageScriptProfile;
  /** Reusable normalizer recipes that installed language packs can reference by name. */
  normalizerPresets?: Record<string, LanguageReadingNormalizerStep[]>;
  lexemeNormalization?: LanguageLexemeNormalization;
  wordIndexStrategy?: LanguageWordIndexStrategy;
  /** LLM context-window token estimation hints for this language. */
  tokenEstimation?: LanguageTokenEstimationConfig;
  readingAnnotation?: LanguageReadingAnnotationConfig;
  partOfSpeech?: LanguagePartOfSpeechConfig;
  subtitle?: LanguageSubtitleParsingConfig;
  /** Sentence-ending punctuation used when batching text for TTS. Defaults cover common cross-script punctuation. */
  sentenceTerminators?: string[];
  /** Separator used when reconstructing plain text from tokenizer output. Defaults to compact before metadata loads, otherwise a space. */
  tokenJoinSeparator?: string;
}

export interface LanguageTypographyConfig {
  /** CSS font-family used for subtitle/media text. Defaults are derived from supported scripts. */
  subtitleFontFamily?: string;
  /** CSS font-family used for language content outside subtitles when a surface needs it. */
  contentFontFamily?: string;
  /** Text direction for language content. Defaults are derived from supported scripts. */
  textDirection?: 'ltr' | 'rtl' | 'auto';
}

export interface LanguageProsodyConfig {
  /** Prosody data model used by this language. */
  type?: 'none' | 'japanese-pitch-accent' | (string & {});
  /** Path to the numeric position in raw dictionary prosody payloads; "*" walks array entries, e.g. ["tones", "*", "number"]. */
  positionPath?: string[];
  /** Path to a concise display value in raw dictionary prosody payloads; "*" walks array entries, e.g. ["tones", "*", "label"]. */
  displayPath?: string[];
  /** User-facing label for a numeric prosody position editor, e.g. "Pitch accent" or "Stress position". */
  positionLabel?: string;
  /** User-facing placeholder for the numeric prosody position editor. */
  positionPlaceholder?: string;
  /** User-facing label for the global prosody visibility toggle. */
  toggleLabel?: string;
  /** User-facing description for the global prosody visibility toggle. */
  toggleDescription?: string;
  /** POS tags whose pitch boxes should be hidden because they do not represent lexical accent. */
  particleBoxExcludedPos?: string[];
  /** Matching mode for particleBoxExcludedPos. Defaults to "contains" for tokenizer tags like "動詞-一般". */
  particleBoxExcludedPosMatch?: 'contains' | 'exact';
}

export interface LanguageCharacterStudyConfig {
  /** Whether character-level study views are meaningful for this language. */
  enabled?: boolean;
  /** Unicode scripts whose individual characters should be tracked, e.g. ["Han"], ["Arab"]. */
  scripts?: string[];
  /** Optional package-defined UI labels for character study views. */
  labels?: {
    title?: string;
    description?: string;
    emptyTitle?: string;
    emptyDescription?: string;
    emptyHint?: string;
    unsupportedTitle?: string;
    unsupportedDescription?: string;
    byLevel?: string;
    loading?: string;
  };
  /** Sort order for language-defined levels in character views. */
  levelOrder?: 'ascending' | 'descending';
  /** Whether character-level estimates inferred from word levels should show an explanatory disclaimer. */
  levelDisclaimer?: boolean;
}

export interface LanguageReaderConfig {
  /** Default reader page mode while the user has not chosen a different app setting. */
  pageMode?: 'single' | 'double';
  /** Default visual order for double-page spreads while the user has not chosen a different app setting. */
  spreadDirection?: ReaderSpreadDirection;
  /** Whether the first page should be treated as a standalone cover by default. */
  firstPageSingle?: boolean;
  /** Whether adjacent spread pages should be visually collated by default. */
  collatePages?: boolean;
}

export interface LanguageConversationConfig {
  /** Register/politeness behavior that affects tutor prompts and mistake correction. */
  register?: {
    /** Whether casual-vs-deferential forms are morphosyntactically important for this language. */
    hasDeferentialForms?: boolean;
    /** Extra guidance used when the tutor should speak casually. */
    casualPromptGuidelines?: string[];
    /** Extra guidance used when judging casual learner messages. */
    correctionPromptGuidelines?: string[];
  };
  /** Extra tutor-system-prompt guidelines for this language, e.g. quiz/register constraints. */
  tutorPromptGuidelines?: string[];
  /** Extra correction guidelines shared by tutor and checker prompts, e.g. register, orthography, or transliteration policy. */
  correctionPromptGuidelines?: string[];
  /** Extra mistake-checker prompt guidelines for language-specific register, orthography, or correction policy. */
  mistakeCheckerPromptGuidelines?: string[];
}

export interface LanguageFrequencyLevelConfig {
  /** User-facing labels for numeric levels, e.g. {"1": "N1", "6": "HSK 6", "0": "Beginner"}. */
  names?: FrequencyLevelNames;
  /** How language-defined levels should be displayed in ordered UI controls. */
  displayOrder?: 'ascending' | 'descending';
  /** Which side of the numeric level scale represents harder material. Defaults to lower numeric values being harder. */
  difficulty?: 'lower-is-harder' | 'higher-is-harder';
  /** Fallback label template for unnamed numeric levels, e.g. "HSK {level}" or "Band {level}". */
  fallbackLabelTemplate?: string;
  /** Frequency row boundaries for assigning most-common-first rows to easiest-to-hardest levels. */
  boundaries?: number[];
  /** Optional zero-based frequency row column containing an authoritative raw level. Defaults to boundary assignment. */
  rowLevelIndex?: number;
}

export type LanguageFrequencyRow = [string, string, ...unknown[]];

export interface LanguageOcrRuntimeConfig {
  /** RapidOCR LangRec enum name, e.g. "JAPAN", "LATIN", "CYRILLIC". */
  rapidLangType?: string;
  /** PaddleOCR language argument, e.g. "japan", "en", "german". */
  paddleLang?: string;
  /** Recognition strategy after text detection. */
  recognitionEngine?: 'rapidocr' | 'paddleocr' | 'mangaocr' | (string & {});
  /** Whether this OCR pipeline should use vertical-text-friendly detector settings. */
  supportsVerticalText?: boolean;
  /** Whether this OCR pipeline supports lightweight region detection before recognition. */
  supportsRamSaver?: boolean;
}

export interface LanguageTokenizerRuntimeConfig {
  /**
   * Metadata-driven tokenizer adapter used when no installed Python language module exists.
   * Use `unicode-word` for rough Unicode token-character segmentation.
   */
  type?: 'none' | 'unicode-word' | 'spacy' | 'sudachi' | (string & {});
  /** Token features this adapter can be trusted to provide. Defaults are derived from the tokenizer type. */
  capabilities?: Array<'segments' | 'lemmas' | 'partOfSpeech' | 'readings' | 'morphology'>;
  /** When true, tokenizer setup failure is an install/runtime error instead of silently degrading. */
  required?: boolean;
  /** Optional fallback behavior when a linguistic tokenizer is unavailable. Rough segmentation fallback is opt-in. */
  fallback?: 'unicode-word' | 'none';
  /** Explicitly allow rough segmentation for scripts whose word boundaries usually need a linguistic segmenter. */
  allowRoughSegmentationForSegmentlessScripts?: boolean;
  /** Whether this tokenizer can process romanized/transliterated Latin input for a non-Latin language. */
  acceptsRomanizedInput?: boolean;
  /** spaCy model name for type="spacy", e.g. "de_core_news_sm". */
  model?: string;
  /** Whether the generic adapter may download a missing spaCy model. */
  autoDownload?: boolean;
  /** Whether rough fallback tokens should use lower-case lemmas. */
  lowercaseLemma?: boolean;
  /** Pipeline for normalizing rough-tokenizer token output. Dictionary lookup uses runtime.nlp.dictionary.lookup or lexemeNormalization instead. */
  lemmaNormalizers?: LanguageTextNormalizerStep[];
  /** Character classes included by the rough segmenter. Defaults to ["letter", "number"]. */
  tokenCharacterClasses?: Array<'letter' | 'number' | 'mark'>;
  /** Unicode scripts accepted as rough-token letters. Defaults to the language script profile. */
  tokenCharacterScripts?: string[];
  /** Extra individual characters always included inside rough tokens, e.g. Persian ZWNJ. */
  extraTokenCharacters?: string[];
  /** Characters kept only between token characters, e.g. apostrophe, hyphen, or Persian ZWNJ. */
  innerTokenCharacters?: string[];
  /** Normalize readings emitted by the tokenizer before sending them to the renderer. */
  outputReadingNormalizer?: LanguageReadingNormalizer;
  /** Token POS labels to suppress from tokenizer output. */
  ignoredPos?: string[];
  /** Suffix-based lemma fallback rules used when a tokenizer cannot recover a dictionary form. */
  lemmaFallbackRules?: Array<{
    pos?: string;
    suffix: string;
    replacement: string;
    requireDictionaryMatch?: boolean;
  }>;
}

export interface LanguageDictionaryRuntimeConfig {
  /** Metadata-driven dictionary adapter used when no installed Python language module exists. */
  type?: 'sqlite-zlib-json' | (string & {});
  /** SQLite payload schema/renderer. */
  schema?: 'simple-headword-zlib-json' | 'headword-reading-zlib-json';
  /** Dictionary DB path under the language-data root. */
  path?: string;
  /** Optional path template under language-data; supports {language} and {target}. */
  targetPathTemplate?: string;
  /** Optional fallback path used when targetPathTemplate misses. */
  fallbackPath?: string;
  /** Optional JSON metadata file under the language-data root. */
  metadataPath?: string;
  /** Expected SQLite schema version from the meta table. */
  schemaVersion?: string;
  /** Renderer for the translation response payload. */
  renderer?: 'simple-glosses' | 'structured-glosses' | 'raw-entry';
  /** Path to the pronunciation/reading/transliteration in dictionary payloads; "*" walks array entries, e.g. ["pronunciations", "*", "value"]. */
  readingPath?: string[];
  /** Path to one or more user-facing definitions/glosses in dictionary payloads; "*" walks array entries, e.g. ["senses", "*", "glosses"]. */
  definitionsPath?: string[];
  /** Default dictionary target language when targetPathTemplate is used. */
  defaultTargetLanguage?: string;
  /** Optional structured prosody/accent payload stored in the same SQLite DB. */
  prosody?: {
    /** SQLite table containing per-headword prosody/accent records. Required when dictionary prosody lookup is enabled. */
    table: string;
    /** Column containing the dictionary headword key. Defaults to "headword". */
    headwordColumn?: string;
    /** Optional column containing the reading/pronunciation key. When present, prosody lookup is keyed by both headword and reading. */
    readingColumn?: string;
    /** Column containing zlib-compressed JSON prosody data. Defaults to "data". */
    dataColumn?: string;
  };
  /** Lookup candidate generation before dictionary queries. */
  lookup?: {
    /**
     * Candidate sources used before dictionary queries. Defaults include tokenizer lemmas
     * when the configured tokenizer is trusted to provide lemmas.
     */
    seedForms?: Array<'surface' | 'tokenizer-lemma' | (string & {})>;
    /** Ordered text normalizers to apply when direct lookup misses. */
    normalizers?: LanguageTextNormalizerStep[];
    /** Whether normalizers run as one cumulative pipeline or branch across variants. Defaults to "pipeline". */
    normalizerMode?: 'pipeline' | 'branching';
    /** When to query the dictionary reading/transliteration index. Defaults to lexemeNormalization.readingScripts. */
    readingLookup?: 'none' | 'always' | {
      /** Query the reading index only when the candidate's letters are in these Unicode scripts, e.g. ["Latn"] for pinyin/romanization. */
      scripts: string[];
    };
    /** Ordered tie-breakers for multiple headword/reading entries. */
    readingRank?: Array<
      | 'common'
      | 'score-desc'
      | 'short-reading'
      | 'long-reading'
      | {
        type: 'script';
        scripts: string[];
      }
    >;
  };
}

export interface LanguageAdapterRuntimeConfig {
  /** Optional downloaded adapter. Metadata-only language bricks are used when absent. */
  type?: 'python-module';
  /** Adapter path under the language-data root. Required when type is 'python-module'. */
  path?: string;
}

export interface LanguageTtsRuntimeConfig {
  /** Package-defined local TTS engine implemented by the installed language adapter. */
  engine?: 'kokoro' | 'qwen3' | (string & {});
  /** Kokoro phonemizer language code, when Kokoro supports this language. */
  kokoroLangCode?: string;
  /** Preferred Kokoro voice for this language/phonemizer. */
  kokoroVoice?: string;
  /** Qwen3 language name required by the model, when Qwen3 supports this language. */
  qwen3LanguageName?: string;
  /** macOS `say` voice name for lightweight system TTS. */
  macosVoice?: string;
  /** espeak voice code for lightweight Linux system TTS. */
  espeakVoice?: string;
  /** Windows System.Speech voice name for lightweight system TTS. */
  windowsVoice?: string;
  /** BCP-47 language tag for browser/mobile Web Speech synthesis. */
  webSpeechLang?: string;
  /** Preferred browser/mobile Web Speech voice name. */
  webSpeechVoice?: string;
  /** Short language-appropriate phrase used by voice diagnostics. */
  diagnosticText?: string;
}

export interface LanguageSttRuntimeConfig {
  /** Whisper/faster-whisper language code, or "auto" to allow detection. */
  whisperLanguage?: string;
  /** Exact or substring phrases commonly emitted by the STT model as hallucinations for this language. */
  hallucinationPhrases?: string[];
  /** Audio shorter than this may be discarded when it produces suspiciously long text. */
  shortAudioMaxSeconds?: number;
  /** Minimum normalized text length that makes very short audio suspicious. */
  shortAudioMinTextLength?: number;
}

export interface LanguageDiagnosticsRuntimeConfig {
  /** Short text that should tokenize and/or resolve in the language dictionary. */
  sampleText?: string;
}

export interface LanguageSettingsConfig {
  /** App settings that this language package forces while the language is active. */
  fixed?: Partial<Settings>;
}

export type LanguagePythonRequirementComponent = 'core' | 'ocr' | 'llm' | 'voice' | (string & {});

export interface LanguagePythonRuntimeConfig {
  /** Pip requirements always needed by this language package, independent of optional app components. */
  packages?: string[];
  /** Extra pip requirements needed by this language for selected optional runtime components. */
  packagesByComponent?: Partial<Record<LanguagePythonRequirementComponent, string[]>>;
}

export interface LanguageRuntimeConfig {
  /** Optional downloaded Python adapter for capabilities that cannot yet be expressed as metadata bricks. */
  adapter?: LanguageAdapterRuntimeConfig;
  python?: LanguagePythonRuntimeConfig;
  ocr?: LanguageOcrRuntimeConfig;
  nlp?: {
    /** @deprecated Prefer runtime.adapter so OCR/TTS-only packages do not need an NLP-shaped adapter declaration. */
    adapter?: LanguageAdapterRuntimeConfig;
    tokenizer?: LanguageTokenizerRuntimeConfig;
    dictionary?: LanguageDictionaryRuntimeConfig;
  };
  tts?: LanguageTtsRuntimeConfig;
  stt?: LanguageSttRuntimeConfig;
  diagnostics?: LanguageDiagnosticsRuntimeConfig;
}

export interface LanguageData {
  name: string;
  name_translated?: string;
  /** Settings behavior supplied by the language package. */
  settings?: LanguageSettingsConfig;
  /** Frequency rows as [surface, reading, ...metadata]. Levels are assigned from boundaries unless frequencyLevels.rowLevelIndex is set. */
  freq?: LanguageFrequencyRow[];
  /** Grammar points for this language */
  grammar?: GrammarPoint[];
  /** Ordering and difficulty semantics for numeric grammar/proficiency levels. */
  grammarLevels?: LanguageFrequencyLevelConfig;
  /** Ordering and difficulty semantics for numeric frequency/proficiency levels. */
  frequencyLevels?: LanguageFrequencyLevelConfig;
  /** Script validation, lexeme normalization, and indexing behavior for this language. */
  textProcessing?: LanguageTextProcessingConfig;
  /** Optional prosody/accent behavior for this language. */
  prosody?: LanguageProsodyConfig;
  /** Character-level study/decomposition behavior. */
  characterStudy?: LanguageCharacterStudyConfig;
  /** Reader layout defaults supplied by the language package. */
  reader?: LanguageReaderConfig;
  /** Conversation tutor behavior and prompt guidance. */
  conversation?: LanguageConversationConfig;
  /** Font choices for language content. */
  typography?: LanguageTypographyConfig;
  /** Backend provider adapter hints for downloaded language modules. */
  runtime?: LanguageRuntimeConfig;
  /** Heavy per-language payloads, installed into userData on demand. */
  languageData?: LanguageDataManifest;
}

export interface LanguageDataMap {
  [langCode: string]: LanguageData;
}

export interface LanguageCatalogEntry {
  name: string;
  nameTranslated?: string;
  version: string;
  bundle: LanguageDataBundle;
  files: LanguageDataAsset[];
  dictionaryPacks?: Record<string, LanguageDictionaryPack>;
}

export interface LanguageCatalogManifest {
  schemaVersion?: number;
  generatedAt?: string;
  languages: Record<string, LanguageCatalogEntry>;
}

export interface LanguageDataCatalogStatus {
  language: string;
  name: string;
  nameTranslated?: string;
  dataRoot: string;
  installed: boolean;
  outdated: boolean;
  totalBytes: number;
  installedBytes: number;
  missingRequiredAssets: string[];
  assets: Array<{
    id: string;
    path: string;
    installed: boolean;
    outdated?: boolean;
    sizeBytes?: number;
    validationIssue?: string;
  }>;
  dictionaryPacks?: Array<{
    targetLanguage: string;
    name: string;
    version?: string;
    installed: boolean;
    outdated: boolean;
    totalBytes: number;
    installedBytes: number;
    missingRequiredAssets: string[];
    assets: Array<{
      id: string;
      path: string;
      installed: boolean;
      outdated?: boolean;
      sizeBytes?: number;
      validationIssue?: string;
    }>;
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
  /** Optional morphosyntactic analyzer features, e.g. { Case: "Acc", Number: "Sing" }. */
  features?: Record<string, string | string[]>;
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

export interface FlashcardProsody {
  /** Runtime prosody model that produced this data. */
  type: NonNullable<LanguageProsodyConfig['type']>;
  /** Numeric prosody/accent/stress/tone position for the configured prosody model. */
  position?: number;
  /** Short package-defined value for display when the model is not numeric-position based. */
  display?: string;
  /** Original backend prosody payload for forward-compatible renderers. */
  raw?: unknown;
}

export interface TranslationResponse {
  /**
   * Dictionary adapters return an ordered payload:
   * 0 = primary entry, 1 = optional structured entry, 2 = optional package-defined prosody/accent payload.
   * Slot 2 is intentionally unknown so third-party language packages can add tone/stress/etc. models
   * without pretending to be Japanese pitch data.
   */
  data: [TranslationEntry?, TranslationEntry?, unknown?];
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
  /** Generic prosody/accent payload. Prefer this for new language features. */
  prosody?: FlashcardProsody;
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

/** TTS backend provider for generated audio files. */
export type TTSProvider = 'kokoro' | 'qwen3' | 'cloud';

/** TTS provider used by the realtime voice-call UI. */
export type VoiceCallTTSProvider = 'system' | TTSProvider;

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
  'mlx-stt'?: string[];
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
  sttEngine?: string;
}

export interface VoiceSTTResult {
  text: string;
  isFinal: boolean;
  isPartial: boolean;
}

export interface VoiceVadEvent {
  type: 'speech-start' | 'speech-end';
  reason?: string;
  speechProb?: number;
  threshold?: number;
  silenceSeconds?: number;
  silenceThreshold?: number;
  speechSeconds?: number;
  chunkSeconds?: number;
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
  error?: string;
}

export interface VoiceSessionReady {
  ready: true;
}

export interface VoiceSessionStatus {
  stage: 'starting' | 'backend' | 'websocket' | 'vad' | 'stt' | 'tts' | 'ready';
  message: string;
  progress: number;
  modelName?: string;
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
