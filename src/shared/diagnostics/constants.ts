/**
 * Diagnostics IPC channels and constants
 */

export const DIAGNOSTICS_IPC = {
  RUN_ALL_TESTS: 'diagnostics-run-all',
  RUN_SUITE: 'diagnostics-run-suite',
  TEST_PROGRESS: 'diagnostics-progress',
  TEST_COMPLETE: 'diagnostics-complete',
  GET_REPORT: 'diagnostics-get-report',
  SAVE_REPORT: 'diagnostics-save-report',
  OPEN_DIAGNOSTICS_WINDOW: 'diagnostics-open-window',
} as const;

export const DEFAULT_TEST_TIMEOUT_MS = 15_000;
export const NETWORK_TEST_TIMEOUT_MS = 20_000;
export const WINDOW_TEST_TIMEOUT_MS = 10_000;

export const SUITE_NAMES = {
  BACKEND_HEALTH: 'Backend Health',
  LLM: 'LLM Providers',
  DICTIONARY: 'Dictionary',
  OCR: 'OCR',
  OCR_MODELS: 'OCR Models',
  VOICE: 'Voice / TTS / STT',
  CLOUD: 'Cloud Services',
  MEDIA_PROTOCOLS: 'Media Protocols',
  STORAGE: 'Storage',
  ANKI: 'Anki',
  BROWSER_EXTENSION: 'Browser Extension',
  PLUGINS: 'Plugins',
  WINDOWS: 'Windows',
  WATCH_TOGETHER: 'Watch Together',
} as const;
