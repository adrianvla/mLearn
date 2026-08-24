/**
 * Shared constants between main and renderer processes
 */

import { PLUGIN_IPC_CHANNELS } from './plugins/constants';

// Server ports
export const PYTHON_BACKEND_PORT = 7752;
export const PROXY_SERVER_PORT = 7753;

// Structured log wire format: ::STATUS::v2::<LEVEL>::<MODULE>::<TS>::<MESSAGE>
// Mirrored on the Python side in logging_utils.py — keep these in sync.
export const LOG_PATTERN_PREFIX = '::STATUS::';
export const LOG_PATTERN_VERSION = 'v2';

// Cloud service URLs
export const DEFAULT_CLOUD_LOGIN_URL = 'https://mlearn.kikan.net';
export const DEFAULT_CLOUD_API_URL = 'https://mlearn-cloud.kikan.net';
export const DEFAULT_LANGUAGE_CATALOG_URL = 'https://mlearn.kikan.net/language-catalog.json';

// Ports object for hooks
export const PORTS = {
  PYTHON_BACKEND: PYTHON_BACKEND_PORT,
  PROXY_SERVER: PROXY_SERVER_PORT,
} as const;

// Voice endpoints for legacy/Electron direct usage (all other endpoints go
// through API_PATHS + the backend adapter).
export const API_ENDPOINTS = {
  voiceStream: `ws://127.0.0.1:${PYTHON_BACKEND_PORT}/voice/stream`,
  voiceTtsStream: `ws://127.0.0.1:${PYTHON_BACKEND_PORT}/voice/tts/stream`,
  voiceTts: `http://127.0.0.1:${PYTHON_BACKEND_PORT}/voice/tts`,
  voiceSttStatus: `http://127.0.0.1:${PYTHON_BACKEND_PORT}/voice/stt/status`,
  voiceTtsStatus: `http://127.0.0.1:${PYTHON_BACKEND_PORT}/voice/tts/status`,
  voiceModelsDownload: `http://127.0.0.1:${PYTHON_BACKEND_PORT}/voice/models/download`,
  voiceTranscribe: `http://127.0.0.1:${PYTHON_BACKEND_PORT}/voice/transcribe`,
} as const;

/** Path-only endpoint constants for backend transport implementations. */
export const API_PATHS = {
  tokenize: '/tokenize',
  translate: '/translate',
  dictionaryWords: '/dictionary-words',
  ankiCard: '/api/anki/card',
  ankiWords: '/api/anki/words',
  ankiReload: '/api/anki/reload',
  llm: '/llm',
  llmStatus: '/llm/status',
  ocr: '/ocr',
  ocrWarmup: '/ocr/warmup',
  health: '/health',
  quit: '/quit',
  voiceStream: '/voice/stream',
  voiceTtsStream: '/voice/tts/stream',
  voiceTts: '/voice/tts',
  voiceSttStatus: '/voice/stt/status',
  voiceTtsStatus: '/voice/tts/status',
  voiceModelsDownload: '/voice/models/download',
  voiceTranscribe: '/voice/transcribe',
} as const;

// IPC Channel names - strongly typed
export const IPC_CHANNELS = {
  // Settings
  GET_SETTINGS: 'get-settings',
  SAVE_SETTINGS: 'save-settings',
  SETTINGS: 'settings',
  SETTINGS_SAVED: 'settings-saved',
  
  // Language data
  GET_LANG_DATA: 'get-lang-data',
  LANG_DATA: 'lang-data',
  GET_LANGUAGE_DATA_CATALOG: 'get-language-data-catalog',
  LANGUAGE_DATA_CATALOG: 'language-data-catalog',
  INSTALL_LANGUAGE_DATA: 'install-language-data',
  LANGUAGE_DATA_INSTALLED: 'language-data-installed',
  LANGUAGE_DATA_INSTALL_ERROR: 'language-data-install-error',
  INSTALL_LANG: 'install-lang',
  LANG_INSTALLED: 'lang-installed',
  LANG_INSTALL_ERROR: 'lang-install-error',

  // Linguistic graph
  GRAPH_GET_META: 'graph-get-meta',
  GRAPH_LOOKUP_WORD: 'graph-lookup-word',
  GRAPH_GET_RELATED: 'graph-get-related',
  GRAPH_GET_TARGETS_FOR_SURFACES: 'graph-get-targets-for-surfaces',
  GRAPH_GET_NEIGHBORHOOD: 'graph-get-neighborhood',
  KNOWLEDGE_GET_PROJECTION: 'knowledge-get-projection',
  
  // Localization
  GET_LOCALIZATION: 'get-localization',
  LOCALIZATION: 'localization',
  CHANGE_UI_LANGUAGE: 'change-ui-language',
  
  // Flashcards
  GET_FLASHCARDS: 'get-flashcards',
  SAVE_FLASHCARDS: 'save-flashcards',
  FLASHCARDS_LOADED: 'flashcards-loaded',
  FORCE_NEWDAY_FLASHCARDS: 'force-newday-flashcards',
  FLASHCARD_CONNECT_OPEN: 'flashcard-connect-open',
  REVIEW_FLASHCARDS_REQUEST: 'review-flashcards-request',

  // Knowledge events
  KNOWLEDGE_EVENTS_APPEND: 'knowledge-events-append',
  KNOWLEDGE_EVENTS_QUERY: 'knowledge-events-query',
  KNOWLEDGE_EVENTS_QUERY_LANGUAGE: 'knowledge-events-query-language',
  KNOWLEDGE_EVENTS_GET: 'knowledge-events-get',
  KNOWLEDGE_EVENTS_CHANGED: 'knowledge-events-changed',
  // Migration
  FLASHCARD_MIGRATION_COMPLETE: 'flashcard-migration-complete',
  GET_FLASHCARD_MIGRATION_INFO: 'get-flashcard-migration-info',
  LOCALSTORAGE_MIGRATION_COMPLETE: 'localstorage-migration-complete',
  GET_MIGRATED_LOCALSTORAGE: 'get-migrated-localstorage',
  GET_MIGRATED_ITEM: 'get-migrated-item',
  HAS_MIGRATION_OCCURRED: 'has-migration-occurred',
  TRIGGER_MIGRATION: 'trigger-migration',
  
  // Window management
  TRAFFIC_LIGHTS: 'traffic-lights',
  CHANGE_WINDOW_SIZE: 'changeWindowSize',
  MAKE_PIP: 'make-pip',
  MAKE_NORMAL: 'make-normal',
  SHOW_CTX_MENU: 'show-ctx-menu',
  CTX_MENU_COMMAND: 'ctx-menu-command',
  SHOW_READER_CTX_MENU: 'show-reader-ctx-menu',
  READER_CTX_MENU_COMMAND: 'reader-ctx-menu-command',

  // App lifecycle
  RESTART_APP: 'restart-app',
  RESTART_APP_FORCE: 'restart-app-force',
  RESTART_BACKEND: 'restart-backend',
  COMPLETE_INITIAL_SETUP: 'complete-initial-setup',
  GET_VERSION: 'get-version',
  VERSION: 'version',
  UPDATE_STATE_GET: 'update-state-get',
  UPDATE_STATE_CHANGED: 'update-state-changed',
  UPDATE_CHECK: 'update-check',
  UPDATE_DOWNLOAD: 'update-download',
  UPDATE_INSTALL: 'update-install',
  
  // Server status
  IS_LOADED: 'is-loaded',
  SERVER_LOAD: 'server-load',
  SERVER_STATUS_UPDATE: 'server-status-update',
  SERVER_CRITICAL_ERROR: 'server-critical-error',
  LOG_RECORD: 'log-record',
  ANKI_CONNECTION_ERROR: 'anki-connection-error',
  OCR_STATUS_UPDATE: 'ocr-status-update',
  GET_BACKEND_TOKEN: 'get-backend-token',
  BACKEND_TOKEN_CHANGED: 'backend-token-changed',
  
  // Installation
  IS_SUCCESSFUL_INSTALL: 'is-successful-install',
  SUCCESSFUL_INSTALL: 'successful-install',
  START_INSTALL: 'start-install',
  INSTALL_STARTED: 'install-started',
  INSTALLER_STATE_REQUEST: 'installer-state-request',
  INSTALLER_STATE: 'installer-state',
  INSTALLER_AWAITING_CHOICE: 'installer-awaiting-choice',
  INSTALLER_NETWORK_ERROR: 'installer-network-error',
  PIP_PROGRESS: 'pip-progress',
  CANCEL_INSTALL: 'cancel-install',
  
  // UI
  SHOW_SETTINGS: 'show-settings',
  SHOW_ASIDE: 'show-aside',
  WRITE_TO_CLIPBOARD: 'write-to-clipboard',
  SHOW_CONTACT: 'show-contact',
  OPEN_EXTERNAL_URL: 'open-external-url',
  GET_LEGAL_DOCUMENT: 'get-legal-document',
  LEGAL_DOCUMENT: 'legal-document',
  AUTH_DEEP_LINK: 'auth-deep-link',
  LOOKUP_DEEP_LINK: 'lookup-deep-link',
  
  // Watch together
  WATCH_TOGETHER: 'watch-together',
  WATCH_TOGETHER_REQUEST: 'watch-together-request',
  WATCH_TOGETHER_SEND: 'watch-together-send',
  IS_WATCHING_TOGETHER: 'is-watching-together',

  OVERLAY_VIDEO_STATE: 'overlay-video-state',
  OVERLAY_VIDEO_SCREENSHOT: 'overlay-video-screenshot',
  OVERLAY_REQUEST_SYNC: 'overlay-request-sync',
  OVERLAY_LAUNCH: 'overlay-launch',
  OVERLAY_GEOMETRY: 'overlay-geometry',
  OVERLAY_SET_IGNORE_MOUSE_EVENTS: 'overlay-set-ignore-mouse-events',
  OVERLAY_SUBTITLE_TRACKS: 'overlay-subtitle-tracks',
  OVERLAY_COMMAND: 'overlay-command',
  OVERLAY_MOVE_BY: 'overlay-move-by',
  OVERLAY_RESIZE_BY: 'overlay-resize-by',
  OVERLAY_GET_BOUNDS: 'overlay-get-bounds',
  OVERLAY_SET_AUTO_POSITION: 'overlay-set-auto-position',
  OVERLAY_AUTO_POSITION_CHANGED: 'overlay-auto-position-changed',
  OVERLAY_SET_GEOMETRY_LOCKED: 'overlay-set-geometry-locked',
  OVERLAY_TEXT_MODE_LOOKUP: 'overlay-text-mode-lookup',
  OVERLAY_TEXT_MODE_CONNECTED: 'overlay-text-mode-connected',
  OVERLAY_SAVE_SITE_STATE: 'overlay-save-site-state',
  OVERLAY_LOAD_SITE_STATE: 'overlay-load-site-state',
  OVERLAY_CLEAR_SITE_STATE: 'overlay-clear-site-state',
  OVERLAY_SET_BOUNDS: 'overlay-set-bounds',
  OVERLAY_ACTIVE_URL_CHANGED: 'overlay-active-url-changed',
  OVERLAY_CLOSE_HOVER: 'overlay-close-hover',

  DETECT_BROWSERS: 'detect-browsers',
  INSTALL_EXTENSION: 'install-extension',
  UNINSTALL_EXTENSION: 'uninstall-extension',
  IS_EXTENSION_INSTALLED: 'is-extension-installed',
  OPEN_EXTENSION_FOLDER: 'open-extension-folder',

  // Updates from tethered clients
  UPDATE_PILLS: 'update-pills',
  UPDATE_WORD_APPEARANCE: 'update-word-appearance',
  UPDATE_ATTEMPT_FLASHCARD_CREATION: 'update-attempt-flashcard-creation',
  UPDATE_CREATE_FLASHCARD: 'update-create-flashcard',
  UPDATE_LAST_WATCHED: 'update-last-watched',
  
  // Stats & editors
  OPEN_WORD_DB_EDITOR: 'open-word-db-editor',
  OPEN_LEVEL_STUDY: 'open-level-study',
  
  // Prompt
  OPEN_PROMPT: 'open-prompt',
  PROMPT_OUTPUT: 'prompt-output',
  
  // Window spawning from renderer
  OPEN_WINDOW: 'open-window',
  CLOSE_WINDOW: 'close-window',
  MINIMIZE_WINDOW: 'minimize-window',
  MAXIMIZE_WINDOW: 'maximize-window',
  RESTORE_WINDOW: 'restore-window',
  POPUP_APP_MENU: 'popup-app-menu',
  SET_TITLEBAR_OVERLAY: 'set-titlebar-overlay',
  WINDOW_FULLSCREEN_CHANGED: 'window-fullscreen-changed',
  
  // LocalStorage sync
  SEND_LS: 'send-ls',
  
  // File operations
  READ_DIRECTORY_IMAGES: 'read-directory-images',
  REMOVE_LEGACY_LANGUAGE_DATA: 'remove-legacy-language-data',
  READ_PDF_FILE: 'read-pdf-file',
  SELECT_VIDEO_FILE: 'select-video-file',
  SELECT_SUBTITLE_FILE: 'select-subtitle-file',
  SELECT_BOOK_FOLDER: 'select-book-folder',
  SELECT_PDF_FILE: 'select-pdf-file',
  SELECT_BROWSER_FILE: 'select-browser-file',
  GET_LOCAL_MEDIA_URL: 'get-local-media-url',

  // Media stats
  SAVE_MEDIA_STATS: 'save-media-stats',
  GET_MEDIA_STATS: 'get-media-stats',
  LIST_MEDIA_STATS: 'list-media-stats',

  // Ollama
  OLLAMA_CHAT: 'ollama-chat',
  OLLAMA_CHAT_STREAM: 'ollama-chat-stream',
  OLLAMA_CHAT_STREAM_ABORT: 'ollama-chat-stream-abort',
  OLLAMA_LIST_MODELS: 'ollama-list-models',
  OLLAMA_CHECK: 'ollama-check',
  OLLAMA_PULL_MODEL: 'ollama-pull-model',
  OLLAMA_PULL_MODEL_PROGRESS: 'ollama-pull-model-progress',

  // Unified LLM
  LLM_STREAM: 'llm-stream',
  LLM_STREAM_CHUNK: 'llm-stream-chunk',
  LLM_STREAM_ABORT: 'llm-stream-abort',
  LLM_CHECK_MODEL: 'llm-check-model',
  LLM_DOWNLOAD_MODEL: 'llm-download-model',
  LLM_DOWNLOAD_PROGRESS: 'llm-download-progress',
  LLM_MODEL_STATUS: 'llm-model-status',
  LLM_UNLOAD_MODEL: 'llm-unload-model',
  LLM_GET_SYSTEM_MEMORY: 'llm-get-system-memory',
  LLM_LIST_DOWNLOADED_MODELS: 'llm-list-downloaded-models',
  LLM_DELETE_MODEL: 'llm-delete-model',

  // Speech
  STT_START: 'stt-start',
  STT_STOP: 'stt-stop',
  STT_RESULT: 'stt-result',
  TTS_SPEAK: 'tts-speak',
  TTS_STOP: 'tts-stop',
  TTS_STATUS: 'tts-status',

  // URL fetch (for conversation agent)
  FETCH_URL: 'fetch-url',

  // Window context
  GET_WINDOW_CONTEXT: 'get-window-context',
  WINDOW_CONTEXT: 'window-context',

  // Voice call mode
  VOICE_MODEL_STATUS: 'voice-model-status',
  VOICE_MODEL_DOWNLOAD: 'voice-model-download',
  VOICE_MODEL_DOWNLOAD_PROGRESS: 'voice-model-download-progress',
  VOICE_START_SESSION: 'voice-start-session',
  VOICE_STOP_SESSION: 'voice-stop-session',
  VOICE_AUDIO_CHUNK: 'voice-audio-chunk',
  VOICE_STT_RESULT: 'voice-stt-result',
  VOICE_VAD_EVENT: 'voice-vad-event',
  VOICE_TTS_GENERATE: 'voice-tts-generate',
  VOICE_TTS_AUDIO: 'voice-tts-audio',
  VOICE_TTS_STATUS: 'voice-tts-status',
  VOICE_TTS_STOP: 'voice-tts-stop',
  VOICE_TTS_STATE: 'voice-tts-state',
  VOICE_FLUSH: 'voice-flush',
  VOICE_UPDATE_SILENCE_THRESHOLD: 'voice-update-silence-threshold',
  VOICE_SESSION_READY: 'voice-session-ready',
  VOICE_SESSION_STATUS: 'voice-session-status',
  VOICE_SESSION_ERROR: 'voice-session-error',

  // Voice samples
  VOICE_SAMPLE_UPLOAD: 'voice-sample-upload',
  VOICE_SAMPLE_LIST: 'voice-sample-list',
  VOICE_SAMPLE_DELETE: 'voice-sample-delete',
  VOICE_SAMPLE_RENAME: 'voice-sample-rename',
  VOICE_SAMPLE_TRANSCRIBE: 'voice-sample-transcribe',
  VOICE_SAMPLE_GET_PATH: 'voice-sample-get-path',

  // Flashcard images
  FLASHCARD_IMAGE_SAVE: 'flashcard-image-save',
  FLASHCARD_IMAGE_RESOLVE: 'flashcard-image-resolve',
  FLASHCARD_IMAGE_DELETE: 'flashcard-image-delete',

  // Flashcard video clips
  FLASHCARD_VIDEO_SAVE: 'flashcard-video-save',
  FLASHCARD_VIDEO_DELETE: 'flashcard-video-delete',

  READ_MEDIA_FILE: 'read-media-file',
  READ_MEDIA_FILE_CHUNK: 'read-media-file-chunk',
  GET_FILE_SIZE: 'get-file-size',

  // Flashcard TTS audio files
  FLASHCARD_TTS_GET: 'flashcard-tts-get',
  FLASHCARD_TTS_GENERATE: 'flashcard-tts-generate',
  FLASHCARD_TTS_BATCH_GENERATE: 'flashcard-tts-batch-generate',
  FLASHCARD_TTS_GET_META: 'flashcard-tts-get-meta',
  FLASHCARD_TTS_DELETE: 'flashcard-tts-delete',

  // Data export/import
  DATA_EXPORT: 'data-export',
  DATA_IMPORT: 'data-import',

  // KV Store
  KV_GET: 'kv-get',
  KV_SET: 'kv-set',
  KV_REMOVE: 'kv-remove',
  KV_GET_ALL: 'kv-get-all',
  KV_SET_BATCH: 'kv-set-batch',

  // Journal (append-only per-room event journal)
  JOURNAL_APPEND: 'journal-append',
  JOURNAL_SUBSCRIBE: 'journal-subscribe',
  JOURNAL_QUERY: 'journal-query',
  JOURNAL_READ_SEA: 'journal-read-sea',
  JOURNAL_READ_THREAD: 'journal-read-thread',
  // Erasure physically removes thread-scoped lines and appends a 'deletion'
  // Sea event carrying source ids only (journal is logically append-only, D11+).
  JOURNAL_ERASE_THREAD: 'journal-erase-thread',

  // World (rooms/threads/participants entity state)
  WORLD_GET_STATE: 'world-get-state',
  WORLD_CREATE_ROOM: 'world-create-room',
  WORLD_APPLY_MEMBERSHIP: 'world-apply-membership',
  WORLD_CREATE_THREAD: 'world-create-thread',
  WORLD_UPDATE_THREAD: 'world-update-thread',
  WORLD_DELETE_THREAD: 'world-delete-thread',
  WORLD_REMEMBER_THIS: 'world-remember-this',
  WORLD_INTEGRATE: 'world-integrate',
  WORLD_PROMOTE_PARTICIPANT: 'world-promote-participant',
  WORLD_CREATE_PARTICIPANT: 'world-create-participant',
  WORLD_UPDATE_PARTICIPANT: 'world-update-participant',
  WORLD_DELETE_PARTICIPANT: 'world-delete-participant',
  WORLD_CLEAR_UNREAD: 'world-clear-unread',

  // Open the room window at a specific room (optionally deep-linked to an event)
  OPEN_ROOM_EVENT: 'open-room-event',

  // Plugins
  ...PLUGIN_IPC_CHANNELS,
} as const;

// Window types
export const WINDOW_TYPES = {
  MAIN: 'main',
  WELCOME: 'welcome',
  SETTINGS: 'settings',
  READER: 'reader',
  FLASHCARDS: 'flashcards',
  PROMPT: 'prompt',
  UPDATE: 'update',
  CHARACTER_GRID: 'character-grid',
  WORD_DB_EDITOR: 'word-db-editor',
  LICENSES: 'licenses',
  CONNECT_QR: 'connect-qr',
  CONVERSATION_AGENT: 'conversation-agent',
  MEMORY_BROWSER: 'memory-browser',
  STATISTICS: 'statistics',
  WORD_DEFINITION: 'word-definition',
  PLUGIN_HOST: 'plugin-host',
  WORD_SYNC: 'word-sync',
  LEVEL_STUDY: 'level-study',
  OVERLAY: 'overlay',
  DIAGNOSTICS: 'diagnostics',
  GRAPH_INSPECTOR: 'graph-inspector',
} as const;

export type WindowType = typeof WINDOW_TYPES[keyof typeof WINDOW_TYPES];

// Subtitle themes
export const SUBTITLE_THEMES = ['marker', 'background', 'shadow'] as const;
export type SubtitleTheme = typeof SUBTITLE_THEMES[number];

// App themes
export const APP_THEMES = ['light', 'dark', 'glass-light', 'glass-dark', 'light-high-contrast', 'dark-high-contrast', 'darker', 'custom'] as const;
export type AppTheme = typeof APP_THEMES[number];

export const SRS_EASE = {
  MIN: 1.3,
  DEFAULT_LEARNING: 1.55,
  DEFAULT_KNOWN: 1.8,
} as const;

export const ANKI_EASE = {
  MIN: 1300,
  DEFAULT_LEARNING: 1550,
  DEFAULT_KNOWN: 1800,
} as const;

// Canonical word status type (string-based, used across the app)
export const WORD_STATUS_VALUES = ['unknown', 'learning', 'known'] as const;
export type WordStatus = typeof WORD_STATUS_VALUES[number];

export const KNOWLEDGE_ASPECTS = ['meaning', 'reading', 'prosody', 'gender', 'pronunciation', 'orthography'] as const;
export type KnowledgeAspect = typeof KNOWLEDGE_ASPECTS[number];

// Knowledge-aspect dependency graph: an aspect's prerequisites are the coarser
// aspects a learner necessarily traverses first (meaning ← reading ← prosody).
// Aspects outside each other's prerequisite closures are orthogonal — no
// inference flows between them (gender, pronunciation). Scope notes:
// - pronunciation is lexeme-scoped spoken-form knowledge (Model B): meaning-known
//   implies nothing about having heard/produced the spoken form;
// - orthography is surface-scoped written-form→lexeme recognition: cross-scope
//   by design, deliberately WITHOUT a reading prerequisite (a form can be mapped
//   to its lexeme without being pronounceable and vice versa).
// Adding an aspect is one entry here; language feature configs map INTO aspects
// and can never change these relationships.
export const ASPECT_PREREQUISITES: Record<KnowledgeAspect, readonly KnowledgeAspect[]> = {
  meaning: [],
  reading: ['meaning'],
  prosody: ['reading'],
  gender: [],
  pronunciation: [],
  orthography: [],
};

// Locale keys for aspect display names — the single source for every surface
// (pill rows, history tabs, attribution buttons/toasts). Record-typed so adding
// an aspect forces its label here.
export const KNOWLEDGE_ASPECT_LABEL_KEYS: Record<KnowledgeAspect, string> = {
  meaning: 'mlearn.Knowledge.Aspect.Meaning',
  reading: 'mlearn.Knowledge.Aspect.Reading',
  prosody: 'mlearn.Knowledge.Aspect.Prosody',
  gender: 'mlearn.Knowledge.Aspect.Gender',
  pronunciation: 'mlearn.Knowledge.Aspect.Pronunciation',
  orthography: 'mlearn.Knowledge.Aspect.Orthography',
};

// ─── Universal attempt rating (Aspect × Performance) ─────────────────────────
// The learner reports PERFORMANCE in the current interaction; mLearn derives
// Unknown/Learning/Known from accumulated evidence. The old Unknown/Learning/
// Known buttons are projections, not inputs.
export const ATTEMPT_QUALITIES = ['missed', 'struggled', 'fluent'] as const;
export type AttemptQuality = typeof ATTEMPT_QUALITIES[number];

// Keyboard input mode for the attempt matrix. Mnemonic is the default: chords
// are self-documenting (1+M) for users who forget spatial mappings.
export const RATING_KEYBOARD_MODES = ['mnemonic', 'spatial'] as const;
export type RatingKeyboardMode = typeof RATING_KEYBOARD_MODES[number];

// Mnemonic chord letters per aspect (quality number + letter, e.g. 1+M).
// Record-typed so a new aspect must choose a letter here.
export const ASPECT_MNEMONIC_KEYS: Record<KnowledgeAspect, string> = {
  meaning: 'm',
  reading: 'r',
  prosody: 'p',
  gender: 'g',
  pronunciation: 'v',
  orthography: 'o',
};

// Spatial matrix keyboard columns: quality → keys, row index = displayed row.
// Keys mean "quality × current matrix row", never a permanent aspect binding.
export const SPATIAL_QUALITY_KEYS: Record<AttemptQuality, readonly string[]> = {
  missed: ['1', 'q', 'a', 'z'],
  struggled: ['2', 'w', 's', 'x'],
  fluent: ['3', 'e', 'd', 'c'],
};

// Central performance → SRS scheduling grade. Evidence-wise fluent+easy are
// IDENTICAL; easy only adjusts scheduling. Consumed by SRS surfaces, never by
// the knowledge-evidence path.
export function qualityToSrsRating(quality: AttemptQuality, easy = false): 'again' | 'hard' | 'good' | 'easy' {
  if (quality === 'missed') return 'again';
  if (quality === 'struggled') return 'hard';
  return easy ? 'easy' : 'good';
}

// Aspects whose evidence belongs to one exact written surface (stored on the
// presented form's hash only — never fanned out across the word-form family,
// the #230 rule's exception) and resolved on that hash only. Under Model B,
// reading IS surface-scoped: it records whether THIS written form was mapped to
// Numeric word status constants (internal storage format for stats service)
export const WORD_STATUS = {
  UNKNOWN: 0,
  LEARNING: 1,
  KNOWN: 2,
} as const;
export type NumericWordStatus = typeof WORD_STATUS[keyof typeof WORD_STATUS];

// Knowledge sources for word status resolution
export const KNOWLEDGE_SOURCES = ['knownWordsList', 'ignoredWords', 'srs', 'anki', 'passiveTracking'] as const;
export type KnowledgeSource = typeof KNOWLEDGE_SOURCES[number];

export const KNOWLEDGE_SOURCE_DISPLAY_NAMES = {
  knownWordsList: 'KnownWordsList',
  ignoredWords: 'IgnoredWords',
  srs: 'Srs',
  anki: 'Anki',
  passiveTracking: 'PassiveTracking',
  manual: 'Manual',
  grammar: 'Grammar',
  migration: 'Migration',
} as const satisfies Record<KnowledgeSource | 'manual' | 'grammar' | 'migration', string>;

export type KnowledgeSourceDisplayName = typeof KNOWLEDGE_SOURCE_DISPLAY_NAMES[KnowledgeSource];
export type WordKnowledgeSource = KnowledgeSourceDisplayName | 'Manual' | 'None';

// Knowledge resolution modes
export const KNOWLEDGE_RESOLUTION_MODES = ['order', 'highest', 'lowest'] as const;
export type KnowledgeResolutionMode = typeof KNOWLEDGE_RESOLUTION_MODES[number];

// Word hover trigger modes for Reader
export const WORD_HOVER_TRIGGER_MODES = ['hover', 'long-hover', 'key-hover'] as const;
export type WordHoverTriggerMode = typeof WORD_HOVER_TRIGGER_MODES[number];

export const PASSIVE_HOVER_FAIL_ACTIONS = ['decrease-ease', 'decrease-ease-and-flashcard', 'none'] as const;
export type PassiveHoverFailAction = typeof PASSIVE_HOVER_FAIL_ACTIONS[number];

// Python runtime catalog — served by Cloudflare Pages, archives on R2 CDN.
export const DEFAULT_RUNTIME_CATALOG_URL = 'https://mlearn.kikan.net/runtime-catalog.json';

// Update URL
export const UPDATE_URL = 'https://mlearn-versioning.kikan.net/version-info.json';
