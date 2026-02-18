/**
 * PlatformBridge Interface
 *
 * Abstraction over the Electron IPC / Capacitor / Web APIs.
 * Organized into logical sub-interfaces that mirror the MLearnIPC surface
 * from src/shared/global.d.ts.
 */

import type {
  Settings,
  FlashcardStore,
  LanguageData,
  InstallOptions,
  InstallerState,
  OpenWindowPayload,
  MediaStats,
  LLMChatMessage,
  LLMToolDefinition,
  LLMStreamChunk,
  LLMModelStatus,
  VoiceModelStatus,
  VoiceSTTResult,
  VoiceVadEvent,
  VoiceTtsAudio,
  VoiceTtsStatus,
  VoiceMode,
  VoiceSessionReady,
  VoiceSessionError,
  VoiceSample,
  PipProgress,
} from '../types';

// ============================================================================
// Sub-Interfaces
// ============================================================================

export interface SettingsBridge {
  getSettings: () => void;
  saveSettings: (settings: Settings) => void;
  onSettings: (callback: (settings: Settings) => void) => () => void;
  onSettingsSaved: (callback: () => void) => () => void;
}

export interface FlashcardBridge {
  getFlashcards: () => void;
  saveFlashcards: (flashcards: FlashcardStore) => void;
  onFlashcards: (callback: (flashcards: FlashcardStore) => void) => () => void;
  onNewDayFlashcards: (callback: () => void) => () => void;
  onFlashcardConnectOpen: (callback: () => void) => () => void;
  onReviewFlashcardRequest: (callback: () => void) => () => void;
}

export interface LocalizationBridge {
  getLocalization: () => void;
  onLocalization: (callback: (data: { locale: string; strings: Record<string, unknown> }) => void) => () => void;
  changeUILanguage: (langCode: string) => void;
  getLangData: () => void;
  onLangData: (callback: (data: LanguageData) => void) => () => void;
  installLanguage: (url: string) => void;
  onLanguageInstalled: (callback: (lang: string) => void) => () => void;
  onLanguageInstallError: (callback: (error: string) => void) => () => void;
}

export interface FileBridge {
  readDirectoryImages: (directoryPath: string) => Promise<{ files: Array<{ name: string; path: string; data: ArrayBuffer }> }>;
  readPdfFile: (filePath: string) => Promise<{ data: ArrayBuffer }>;
  selectVideoFile: () => Promise<string | null>;
  selectSubtitleFile: () => Promise<string | null>;
  selectBookFolder: () => Promise<string | null>;
  selectPdfFile: () => Promise<string | null>;
  getLocalMediaUrl: (filePath: string) => Promise<string | null>;
  getPathForFile: (file: File) => string;
  writeToClipboard: (text: string) => void;
}

export interface WindowBridge {
  changeTrafficLights: (visibility: boolean) => void;
  resizeWindow: (size: { width: number; height: number }) => void;
  makePiP: (size: { width: number; height: number }) => void;
  unPiP: () => void;
  showCtxMenu: (options?: { isWatchTogether?: boolean }) => void;
  showReaderCtxMenu: (options: { furiganaHiderEnabled: boolean; hasContextPhrase: boolean }) => void;
  showContact: () => void;
  openWindow: (payload: OpenWindowPayload) => void;
  closeWindow: () => void;
  getWindowContext: (windowType: string) => void;
  onWindowContext: (callback: (context: Record<string, unknown> | null) => void) => (() => void) | undefined;
  onOpenSettings: (callback: (section?: string) => void) => () => void;
  onOpenAside: (callback: () => void) => () => void;
  onContextMenuCommand: (callback: (command: string) => void) => () => void;
  onReaderContextMenuCommand: (callback: (command: string) => void) => () => void;
  onOpenWordDbEditor: (callback: () => void) => () => void;
  onOpenKanjiGrid: (callback: () => void) => () => void;
  onOpenPrompt: (callback: (data: { title: string; message: string }) => void) => () => void;
  promptOutput: (text: string) => void;
}

export interface ServerBridge {
  isLoaded: () => void;
  isSuccess: () => void;
  onServerLoad: (callback: (message: string) => void) => () => void;
  onServerStatusUpdate: (callback: (message: string) => void) => () => void;
  onServerCriticalError: (callback: (message: string) => void) => () => void;
  onOcrStatusUpdate: (callback: (message: string) => void) => () => void;
  restartApp: () => void;
  forceRestartApp: () => void;
  getVersion: () => void;
  onVersionReceive: (callback: (version: string) => void) => () => void;
}

export interface InstallerBridge {
  startInstall: (options: InstallOptions) => void;
  requestInstallerState: () => void;
  onPythonSuccess: (callback: (success: boolean) => void) => () => void;
  onInstallStarted: (callback: (options: InstallOptions) => void) => () => void;
  onInstallerAwaitingChoice: (callback: () => void) => () => void;
  onInstallerNetworkError: (callback: (payload: { message: string; detail?: string }) => void) => () => void;
  onInstallerState: (callback: (state: InstallerState) => void) => () => void;
  onPipProgress: (callback: (progress: PipProgress) => void) => () => void;
}

export interface LLMBridge {
  // Unified LLM
  llmStream: (messages: LLMChatMessage[], tools: LLMToolDefinition[]) => void;
  llmStreamAbort: () => void;
  onLLMStreamChunk: (callback: (chunk: LLMStreamChunk) => void) => () => void;
  llmCheckModel: (modelFile?: string) => Promise<LLMModelStatus>;
  llmDownloadModel: (modelUrl?: string, modelFile?: string) => void;
  onLLMDownloadProgress: (callback: (status: LLMModelStatus) => void) => () => void;
  onLLMModelStatus: (callback: (status: LLMModelStatus) => void) => () => void;
  llmUnloadModel: () => void;

  // Ollama
  ollamaChat: (messages: unknown[], tools?: unknown[]) => void;
  ollamaChatStream: (messages: unknown[], tools?: unknown[]) => void;
  ollamaChatStreamAbort: () => void;
  onOllamaChatStream: (callback: (chunk: { content?: string; done?: boolean; tool_calls?: unknown[]; eval_count?: number; eval_duration?: number; prompt_eval_duration?: number; total_duration?: number }) => void) => () => void;
  ollamaListModels: () => Promise<unknown[]>;
  ollamaCheck: () => Promise<boolean>;
  ollamaPullModel: (modelName: string) => void;
  onOllamaPullModelProgress: (callback: (progress: { status: string; completed?: number; total?: number; error?: string }) => void) => () => void;
}

export interface SpeechBridge {
  sttStart: (language: string) => void;
  sttStop: () => void;
  onSttResult: (callback: (result: { transcript: string; isFinal: boolean }) => void) => () => void;
  ttsSpeak: (text: string, language: string) => void;
  ttsStop: () => void;
  onTtsStatus: (callback: (status: { speaking: boolean; progress: number }) => void) => () => void;
}

export interface VoiceBridge {
  voiceCheckModels: (language: string) => Promise<VoiceModelStatus>;
  voiceDownloadModels: (language: string) => void;
  onVoiceModelProgress: (callback: (status: VoiceModelStatus) => void) => () => void;
  voiceStartSession: (language: string, mode: VoiceMode, silenceThreshold?: number) => void;
  voiceStopSession: () => void;
  voiceSendAudioChunk: (samples: Float32Array) => void;
  voiceFlush: () => void;
  voiceUpdateSilenceThreshold: (threshold: number) => void;
  onVoiceSttResult: (callback: (result: VoiceSTTResult) => void) => () => void;
  onVoiceVadEvent: (callback: (event: VoiceVadEvent) => void) => () => void;
  voiceTtsGenerate: (text: string, language: string, speed?: number, voiceSampleId?: string) => void;
  voiceTtsStop: () => void;
  onVoiceTtsAudio: (callback: (audio: VoiceTtsAudio) => void) => () => void;
  onVoiceTtsStatus: (callback: (status: VoiceTtsStatus) => void) => () => void;
  onVoiceSessionReady: (callback: (data: VoiceSessionReady) => void) => () => void;
  onVoiceSessionError: (callback: (data: VoiceSessionError) => void) => () => void;
  voiceSampleList: () => Promise<VoiceSample[]>;
  voiceSampleUpload: (sourcePath: string, name: string) => Promise<VoiceSample>;
  voiceSampleDelete: (id: string) => Promise<boolean>;
  voiceSampleRename: (id: string, newName: string) => Promise<boolean>;
}

export interface MediaStatsBridge {
  saveMediaStats: (mediaHash: string, stats: MediaStats) => void;
  getMediaStats: (mediaHash: string) => void;
  onMediaStats: (callback: (stats: MediaStats | null) => void) => () => void;
  listMediaStats: () => void;
  onMediaStatsList: (callback: (stats: MediaStats[]) => void) => () => void;
}

export interface WatchTogetherBridge {
  isWatchingTogether: () => void;
  watchTogetherSend: (message: unknown) => void;
  onWatchTogetherLaunch: (callback: (data: unknown) => void) => () => void;
  onWatchTogetherRequest: (callback: (data: unknown) => void) => () => void;
}

export interface CrossWindowBridge {
  onUpdatePills: (callback: (data: unknown) => void) => () => void;
  onUpdateWordAppearance: (callback: (data: unknown) => void) => () => void;
  onUpdateAttemptFlashcardCreation: (callback: (data: unknown) => void) => () => void;
  onUpdateCreateFlashcard: (callback: (data: unknown) => void) => () => void;
  onUpdateLastWatched: (callback: (data: unknown) => void) => () => void;
}

export interface LicenseBridge {
  getLicenseType: () => void;
  activateLicense: (key: string) => void;
  removeLicense: () => void;
  onLicenseGet: (callback: (type: string) => void) => () => void;
  onLicenseActivated: (callback: (success: boolean) => void) => () => void;
}

export interface MigrationBridge {
  getMigratedLocalStorage: () => Promise<Record<string, unknown> | null>;
  getMigratedItem: (key: string) => Promise<unknown>;
  hasMigrationOccurred: () => Promise<boolean>;
  triggerMigration: () => Promise<{ success: boolean; migratedKeys: string[]; error?: string }>;
  onLocalStorageMigrationComplete: (callback: (info: { occurred: boolean; backupPath: string | null }) => void) => () => void;
  onFlashcardMigrationComplete: (callback: (info: { occurred: boolean; backupPath: string | null; fromVersion: number | null }) => void) => () => void;
  getFlashcardMigrationInfo: () => void;
}

export interface GenericIPCBridge {
  send: (channel: string, data?: unknown) => void;
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
  removeListener: (channel: string, callback: (...args: unknown[]) => void) => void;
  sendLS: (data: Record<string, unknown>) => void;
  fetchUrl: (url: string) => Promise<{ content: string; error?: string }>;
}

// ============================================================================
// Combined PlatformBridge
// ============================================================================

export interface PlatformBridge {
  settings: SettingsBridge;
  flashcards: FlashcardBridge;
  localization: LocalizationBridge;
  files: FileBridge;
  window: WindowBridge;
  server: ServerBridge;
  installer: InstallerBridge;
  llm: LLMBridge;
  speech: SpeechBridge;
  voice: VoiceBridge;
  mediaStats: MediaStatsBridge;
  watchTogether: WatchTogetherBridge;
  crossWindow: CrossWindowBridge;
  license: LicenseBridge;
  migration: MigrationBridge;
  generic: GenericIPCBridge;
}
