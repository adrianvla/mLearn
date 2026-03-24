/**
 * Shared constants between main and renderer processes
 */

// Server ports
export const PYTHON_BACKEND_PORT = 7752;
export const PROXY_SERVER_PORT = 7753;

// Cloud service URLs
export const DEFAULT_CLOUD_LOGIN_URL = 'https://mlearn.kikan.net';
export const DEFAULT_CLOUD_API_URL = 'https://mlearn-cloud.kikan.net';

// Ports object for hooks
export const PORTS = {
  PYTHON_BACKEND: PYTHON_BACKEND_PORT,
  PROXY_SERVER: PROXY_SERVER_PORT,
} as const;

// API endpoints (full URLs — for legacy/Electron direct usage)
export const API_ENDPOINTS = {
  tokenize: `http://127.0.0.1:${PYTHON_BACKEND_PORT}/tokenize`,
  translate: `http://127.0.0.1:${PYTHON_BACKEND_PORT}/translate`,
  getCard: `http://127.0.0.1:${PYTHON_BACKEND_PORT}/getCard`,
  /** @deprecated LLM moved to unified LLM backend */
  llm: `http://127.0.0.1:${PYTHON_BACKEND_PORT}/llm`,
  /** @deprecated LLM moved to unified LLM backend */
  llmStatus: `http://127.0.0.1:${PYTHON_BACKEND_PORT}/llm/status`,
  ocr: `http://127.0.0.1:${PYTHON_BACKEND_PORT}/ocr`,
  control: `http://127.0.0.1:${PYTHON_BACKEND_PORT}/control`,
  quit: `http://127.0.0.1:${PYTHON_BACKEND_PORT}/quit`,
  // Voice endpoints
  voiceStream: `ws://127.0.0.1:${PYTHON_BACKEND_PORT}/voice/stream`,
  voiceTts: `http://127.0.0.1:${PYTHON_BACKEND_PORT}/voice/tts`,
  voiceSttStatus: `http://127.0.0.1:${PYTHON_BACKEND_PORT}/voice/stt/status`,
  voiceTtsStatus: `http://127.0.0.1:${PYTHON_BACKEND_PORT}/voice/tts/status`,
  voiceModelsDownload: `http://127.0.0.1:${PYTHON_BACKEND_PORT}/voice/models/download`,
  voiceTranscribe: `http://127.0.0.1:${PYTHON_BACKEND_PORT}/voice/transcribe`,
} as const;

/** Path-only endpoint constants — use with BackendAdapter.buildUrl() */
export const API_PATHS = {
  tokenize: '/tokenize',
  translate: '/translate',
  getCard: '/getCard',
  llm: '/llm',
  llmStatus: '/llm/status',
  ocr: '/ocr',
  control: '/control',
  quit: '/quit',
  voiceStream: '/voice/stream',
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
  INSTALL_LANG: 'install-lang',
  LANG_INSTALLED: 'lang-installed',
  LANG_INSTALL_ERROR: 'lang-install-error',
  
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
  GET_VERSION: 'get-version',
  VERSION: 'version',
  
  // Server status
  IS_LOADED: 'is-loaded',
  SERVER_LOAD: 'server-load',
  SERVER_STATUS_UPDATE: 'server-status-update',
  SERVER_CRITICAL_ERROR: 'server-critical-error',
  ANKI_CONNECTION_ERROR: 'anki-connection-error',
  RESTART_BACKEND_ANKI_OVERRIDE: 'restart-backend-anki-override',
  OCR_STATUS_UPDATE: 'ocr-status-update',
  
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
  
  // UI
  SHOW_SETTINGS: 'show-settings',
  SHOW_ASIDE: 'show-aside',
  WRITE_TO_CLIPBOARD: 'write-to-clipboard',
  SHOW_CONTACT: 'show-contact',
  OPEN_EXTERNAL_URL: 'open-external-url',
  AUTH_DEEP_LINK: 'auth-deep-link',
  LOOKUP_DEEP_LINK: 'lookup-deep-link',
  
  // Watch together
  WATCH_TOGETHER: 'watch-together',
  WATCH_TOGETHER_REQUEST: 'watch-together-request',
  WATCH_TOGETHER_SEND: 'watch-together-send',
  IS_WATCHING_TOGETHER: 'is-watching-together',
  
  // Updates from tethered clients
  UPDATE_PILLS: 'update-pills',
  UPDATE_WORD_APPEARANCE: 'update-word-appearance',
  UPDATE_ATTEMPT_FLASHCARD_CREATION: 'update-attempt-flashcard-creation',
  UPDATE_CREATE_FLASHCARD: 'update-create-flashcard',
  UPDATE_LAST_WATCHED: 'update-last-watched',
  
  // Stats & editors
  OPEN_WORD_DB_EDITOR: 'open-word-db-editor',
  OPEN_KANJI_GRID: 'open-kanji-grid',
  
  // Prompt
  OPEN_PROMPT: 'open-prompt',
  PROMPT_OUTPUT: 'prompt-output',
  
  // Window spawning from renderer
  OPEN_WINDOW: 'open-window',
  CLOSE_WINDOW: 'close-window',
  
  // LocalStorage sync
  SEND_LS: 'send-ls',
  
  // File operations
  READ_DIRECTORY_IMAGES: 'read-directory-images',
  READ_PDF_FILE: 'read-pdf-file',
  SELECT_VIDEO_FILE: 'select-video-file',
  SELECT_SUBTITLE_FILE: 'select-subtitle-file',
  SELECT_BOOK_FOLDER: 'select-book-folder',
  SELECT_PDF_FILE: 'select-pdf-file',
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
  VOICE_FLUSH: 'voice-flush',
  VOICE_UPDATE_SILENCE_THRESHOLD: 'voice-update-silence-threshold',
  VOICE_SESSION_READY: 'voice-session-ready',
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

  // Flashcard TTS audio files
  FLASHCARD_TTS_GET: 'flashcard-tts-get',
  FLASHCARD_TTS_GENERATE: 'flashcard-tts-generate',
  FLASHCARD_TTS_BATCH_GENERATE: 'flashcard-tts-batch-generate',
  FLASHCARD_TTS_GET_META: 'flashcard-tts-get-meta',

  // Data export/import
  DATA_EXPORT: 'data-export',
  DATA_IMPORT: 'data-import',

  // KV Store
  KV_GET: 'kv-get',
  KV_SET: 'kv-set',
  KV_REMOVE: 'kv-remove',
  KV_GET_ALL: 'kv-get-all',
  KV_SET_BATCH: 'kv-set-batch',
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
  KANJI_GRID: 'kanji-grid',
  WORD_DB_EDITOR: 'word-db-editor',
  LICENSES: 'licenses',
  CONNECT_QR: 'connect-qr',
  CONVERSATION_AGENT: 'conversation-agent',
  STATISTICS: 'statistics',
  WORD_DEFINITION: 'word-definition',
} as const;

export type WindowType = typeof WINDOW_TYPES[keyof typeof WINDOW_TYPES];

// Subtitle themes
export const SUBTITLE_THEMES = ['marker', 'background', 'shadow'] as const;
export type SubtitleTheme = typeof SUBTITLE_THEMES[number];

// App themes
export const APP_THEMES = ['light', 'dark', 'glass-light', 'glass-dark', 'light-high-contrast', 'dark-high-contrast', 'darker'] as const;
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

// Word status (for SRS)
export const WORD_STATUS = {
  UNKNOWN: 0,
  LEARNING: 1,
  KNOWN: 2,
} as const;
export type WordStatus = typeof WORD_STATUS[keyof typeof WORD_STATUS];

// Knowledge sources for word status resolution
export const KNOWLEDGE_SOURCES = ['srs', 'anki', 'manual'] as const;
export type KnowledgeSource = typeof KNOWLEDGE_SOURCES[number];

// Knowledge resolution modes
export const KNOWLEDGE_RESOLUTION_MODES = ['order', 'highest', 'lowest'] as const;
export type KnowledgeResolutionMode = typeof KNOWLEDGE_RESOLUTION_MODES[number];

// Word hover trigger modes for Reader
export const WORD_HOVER_TRIGGER_MODES = ['hover', 'long-hover', 'key-hover'] as const;
export type WordHoverTriggerMode = typeof WORD_HOVER_TRIGGER_MODES[number];

// Python download URLs
// NOTE: Voice TTS uses Kokoro-82M locally (fast, CPU/MPS), Qwen3-TTS (voice cloning), or Cloud TTS.
// Update packaged-python repo with 3.11 builds from indygreg/python-build-standalone:
//   - aarch64-apple-darwin: cpython-3.11.x+...aarch64-apple-darwin-install_only.tar.gz
//   - x86_64-apple-darwin:  cpython-3.11.x+...x86_64-apple-darwin-install_only.tar.gz
//   - x86_64-linux-gnu:     cpython-3.11.x+...x86_64-unknown-linux-gnu-install_only.tar.gz
//   - x86_64-windows-msvc:  cpython-3.11.x+...x86_64-pc-windows-msvc-install_only.tar.gz
export const PYTHON_DOWNLOAD_BASE = 'https://github.com/adrianvla/packaged-python/raw/refs/heads/main/';

// Update URL
export const UPDATE_URL = 'https://mlearn-versioning.kikan.net/version-info.json';
