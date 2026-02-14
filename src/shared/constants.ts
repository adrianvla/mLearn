/**
 * Shared constants between main and renderer processes
 */

// Server ports
export const PYTHON_BACKEND_PORT = 7752;
export const PROXY_SERVER_PORT = 7753;

// Ports object for hooks
export const PORTS = {
  PYTHON_BACKEND: PYTHON_BACKEND_PORT,
  PROXY_SERVER: PROXY_SERVER_PORT,
} as const;

// API endpoints
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
  GET_VERSION: 'get-version',
  VERSION: 'version',
  
  // Server status
  IS_LOADED: 'is-loaded',
  SERVER_LOAD: 'server-load',
  SERVER_STATUS_UPDATE: 'server-status-update',
  SERVER_CRITICAL_ERROR: 'server-critical-error',
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
  
  // UI
  SHOW_SETTINGS: 'show-settings',
  SHOW_ASIDE: 'show-aside',
  WRITE_TO_CLIPBOARD: 'write-to-clipboard',
  SHOW_CONTACT: 'show-contact',
  
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
} as const;

export type WindowType = typeof WINDOW_TYPES[keyof typeof WINDOW_TYPES];

// Subtitle themes
export const SUBTITLE_THEMES = ['marker', 'background', 'shadow'] as const;
export type SubtitleTheme = typeof SUBTITLE_THEMES[number];

// App themes
export const APP_THEMES = ['light', 'dark', 'glass-light', 'glass-dark', 'light-high-contrast', 'dark-high-contrast', 'darker'] as const;
export type AppTheme = typeof APP_THEMES[number];

// Word status (for SRS)
export const WORD_STATUS = {
  UNKNOWN: 0,
  LEARNING: 1,
  KNOWN: 2,
} as const;
export type WordStatus = typeof WORD_STATUS[keyof typeof WORD_STATUS];

// Word hover trigger modes for Reader
export const WORD_HOVER_TRIGGER_MODES = ['hover', 'long-hover', 'key-hover'] as const;
export type WordHoverTriggerMode = typeof WORD_HOVER_TRIGGER_MODES[number];

// Python download URLs
export const PYTHON_DOWNLOAD_BASE = 'https://github.com/adrianvla/packaged-python/raw/refs/heads/main/';

// Update URL
export const UPDATE_URL = 'https://mlearn-update.morisinc.net/version-info.json';
