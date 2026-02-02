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
  llm: `http://127.0.0.1:${PYTHON_BACKEND_PORT}/llm`,
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
