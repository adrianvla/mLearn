/**
 * Global Type Declarations
 * Extends Window interface with mLearn IPC API
 */

import type { Settings, FlashcardStore, LanguageData, InstallOptions, InstallerState, OpenWindowPayload, MediaStats, LLMChatMessage, LLMToolDefinition, LLMStreamChunk, LLMModelStatus, VoiceModelStatus, VoiceSTTResult, VoiceVadEvent, VoiceTtsAudio, VoiceTtsStatus, VoiceMode, VoiceSessionReady, VoiceSessionError, VoiceSample, PipProgress, SystemMemoryInfo } from './types';
import type { PluginInstallResult, PluginKVGetResult, PluginState, PluginWindowPayload } from './plugins/types';
import type { PluginBusEnvelope, PluginBusJSONValue } from './pluginBus';

export interface MLearnIPC {
  // Settings
  getSettings: () => void;
  saveSettings: (settings: Settings) => void;
  onSettings: (callback: (settings: Settings) => void) => () => void;
  onSettingsSaved: (callback: () => void) => () => void;
  
  // Flashcards
  getFlashcards: () => void;
  saveFlashcards: (flashcards: FlashcardStore) => void;
  onFlashcards: (callback: (flashcards: FlashcardStore) => void) => () => void;
  onNewDayFlashcards: (callback: () => void) => () => void;
  onFlashcardConnectOpen: (callback: () => void) => () => void;
  onReviewFlashcardRequest: (callback: () => void) => () => void;
  
  // Flashcard Images
  saveFlashcardImage: (cardId: string, dataUrl: string) => Promise<string>;
  resolveFlashcardImage: (imageUrl: string) => Promise<string | null>;
  deleteFlashcardImage: (cardId: string) => Promise<void>;

  // Plugins
  getPluginValue: (channel: string) => Promise<PluginBusEnvelope>;
  setPluginValue: (channel: string, value: PluginBusJSONValue) => Promise<void>;
  emitPluginEvent: (channel: string, payload: PluginBusJSONValue) => Promise<void>;
  onPluginValue: (channel: string, callback: (nextValue: PluginBusEnvelope, previousValue: PluginBusEnvelope) => void) => () => void;
  onPluginEvent: (channel: string, callback: (payload: PluginBusJSONValue) => void) => () => void;
  pluginGetList: () => Promise<PluginState[]>;
  pluginEnable: (pluginId: string) => Promise<PluginState | null>;
  pluginDisable: (pluginId: string) => Promise<PluginState | null>;
  pluginGrantPermissions: (pluginId: string) => Promise<PluginState | null>;
  pluginInstallFromPath: (sourcePath: string) => Promise<PluginInstallResult>;
  pluginSelectAndInstall: () => Promise<PluginInstallResult>;
  pluginUninstall: (pluginId: string) => Promise<boolean>;
  pluginKVGet: (pluginId: string, key: string) => Promise<PluginKVGetResult>;
  pluginKVSet: (pluginId: string, key: string, value: string) => Promise<void>;
  pluginKVRemove: (pluginId: string, key: string) => Promise<void>;
  pluginOpenWindow: (payload: PluginWindowPayload) => Promise<boolean>;
  onPluginList: (callback: (plugins: PluginState[]) => void) => () => void;
  onPluginStatusUpdate: (callback: (plugin: PluginState) => void) => () => void;
  onPluginInstallResult: (callback: (result: PluginInstallResult) => void) => () => void;
  
  // Flashcard Videos
  saveFlashcardVideo: (cardId: string, data: ArrayBuffer) => Promise<string | null>;
  deleteFlashcardVideo: (cardId: string) => Promise<void>;
  
  // Flashcard TTS
  getFlashcardTts: (cardId: string, field: string) => Promise<string | null>;
  generateFlashcardTts: (cardId: string, text: string, language: string, field: string, provider: string, voiceSampleId?: string, cloudAuthToken?: string, cloudApiUrl?: string) => Promise<string | null>;
  batchGenerateFlashcardTts: (items: Array<{ cardId: string; text: string; field: string }>, language: string, provider: string, voiceSampleId?: string, cloudAuthToken?: string, cloudApiUrl?: string) => Promise<Record<string, string>>;
  getFlashcardTtsMeta: (cardId: string, field: string) => Promise<{ provider: string; generatedAt: string; language: string } | null>;
  deleteFlashcardTts: (cardId: string) => Promise<void>;
  
  // Language Data
  getLangData: () => void;
  onLangData: (callback: (data: LanguageDataMap) => void) => () => void;
  installLanguage: (url: string) => void;
  onLanguageInstalled: (callback: (lang: string) => void) => () => void;
  onLanguageInstallError: (callback: (error: string) => void) => () => void;
  
  // Localization
  getLocalization: () => void;
  onLocalization: (callback: (data: { locale: string; strings: Record<string, unknown> }) => void) => () => void;
  changeUILanguage: (langCode: string) => void;
  
  // Window Management
  changeTrafficLights: (visibility: boolean) => void;
  resizeWindow: (size: { width: number; height: number }) => void;
  makePiP: (size: { width: number; height: number }) => void;
  unPiP: () => void;
  showCtxMenu: (options?: { isWatchTogether?: boolean; hasContextPhrase?: boolean; canExplainPhrase?: boolean }) => void;
  showContact: () => void;
  openExternalUrl: (url: string) => Promise<boolean>;
  onAuthDeepLink: (callback: (payload: { code: string | null; state: string | null; error: string | null }) => void) => () => void;
  onLookupDeepLink: (callback: (word: string) => void) => () => void;
  
  // App Control
  restartApp: () => void;
  forceRestartApp: () => void;
  restartBackend: () => void;
  getVersion: () => void;
  onVersionReceive: (callback: (version: string) => void) => () => void;
  
  // Server/Backend Status
  isLoaded: () => void;
  isSuccess: () => void;
  onServerLoad: (callback: (message: string) => void) => () => void;
  onServerStatusUpdate: (callback: (message: string) => void) => () => void;
  onServerCriticalError: (callback: (message: string) => void) => () => void;
  onAnkiConnectionError: (callback: (reason: string) => void) => () => void;
  restartBackendAnkiOverride: (disableAnki: boolean) => void;
  onOcrStatusUpdate: (callback: (message: string) => void) => () => void;
sendLogRecord: (record: unknown) => void;
  
  // Python Installer
  startInstall: (options: InstallOptions) => void;
  cancelInstall: () => void;
  requestInstallerState: () => void;
  onPythonSuccess: (callback: (success: boolean) => void) => () => void;
  onInstallStarted: (callback: (options: InstallOptions) => void) => () => void;
  onInstallerAwaitingChoice: (callback: () => void) => () => void;
  onInstallerNetworkError: (callback: (payload: { message: string; detail?: string }) => void) => () => void;
  onInstallerState: (callback: (state: InstallerState) => void) => () => void;
  onPipProgress: (callback: (progress: PipProgress) => void) => () => void;
  
  // Clipboard & UI
  writeToClipboard: (text: string) => void;
  promptOutput: (text: string) => void;
  onOpenPrompt: (callback: (data: { title: string; message: string }) => void) => () => void;
  
  // Context Menu & UI Events
  onOpenSettings: (callback: (section?: string) => void) => () => void;
  onOpenAside: (callback: () => void) => () => void;
  onContextMenuCommand: (callback: (command: string) => void) => () => void;
  showReaderCtxMenu: (options: { furiganaHiderEnabled: boolean; hasContextPhrase: boolean; canExplainPhrase?: boolean; collatePagesEnabled?: boolean; isDoublePageMode?: boolean }) => void;
  onReaderContextMenuCommand: (callback: (command: string) => void) => () => void;
  onOpenWordDbEditor: (callback: () => void) => () => void;
  onOpenKanjiGrid: (callback: () => void) => () => void;
  
  // Watch Together
  isWatchingTogether: () => void;
  watchTogetherSend: (message: unknown) => void;
  onWatchTogetherLaunch: (callback: (data: unknown) => void) => () => void;
  onWatchTogetherRequest: (callback: (data: unknown) => void) => () => void;

  // Overlay
  sendOverlayVideoState: (state: import('./types').OverlayVideoState) => void;
  onOverlayVideoState: (callback: (state: import('./types').OverlayVideoState) => void) => () => void;
  requestOverlaySync: () => void;
  onOverlayRequestSync: (callback: () => void) => () => void;
  launchOverlay: () => void;
  onOverlayLaunch: (callback: () => void) => () => void;
  onOverlayGeometry: (callback: (geometry: import('./types').OverlayGeometry) => void) => () => void;
  setOverlayIgnoreMouseEvents: (ignore: boolean) => void;
  sendOverlayCommand: (cmd: import('./types').OverlayCommand) => void;
  sendOverlaySubtitleTracks: (tracks: import('./types').OverlaySubtitleTracks) => void;
  onOverlaySubtitleTracks: (callback: (tracks: import('./types').OverlaySubtitleTracks) => void) => () => void;
  overlayMoveBy: (delta: { x: number; y: number }) => Promise<void>;
  overlayResizeBy: (delta: { width: number; height: number }) => Promise<void>;
  overlayGetBounds: () => Promise<{ x: number; y: number; width: number; height: number } | null>;
  overlaySetAutoPosition: (enabled: boolean) => Promise<void>;
  overlaySetGeometryLocked: (locked: boolean) => void;
  onOverlayAutoPositionChanged: (callback: (enabled: boolean) => void) => () => void;
  sendOverlayTextModeLookup: (payload: { word: string; x: number; y: number; contextText?: string; offset?: number }) => void;
  onOverlayTextModeLookup: (callback: (payload: { word: string; x: number; y: number; contextText?: string; offset?: number }) => void) => () => void;
  onOverlayTextModeConnected: (callback: (connected: boolean) => void) => () => void;
  overlaySaveSiteState: (payload: { url: string; state: Record<string, unknown> }) => void;
  overlayLoadSiteState: (url: string) => Promise<Record<string, unknown> | null>;
  overlayClearSiteState: (url: string) => void;
  overlaySetBounds: (bounds: { x: number; y: number; width: number; height: number }) => Promise<void>;
  onOverlayActiveUrlChanged: (callback: (url: string) => void) => () => void;
  onOverlayCloseHover: (callback: () => void) => () => void;

  // Pill/Word Updates (cross-window sync)
  onUpdatePills: (callback: (data: unknown) => void) => () => void;
  onUpdateWordAppearance: (callback: (data: unknown) => void) => () => void;
  onUpdateAttemptFlashcardCreation: (callback: (data: unknown) => void) => () => void;
  onUpdateCreateFlashcard: (callback: (data: unknown) => void) => () => void;
  onUpdateLastWatched: (callback: (data: unknown) => void) => () => void;
  
  // License (DRM)
  getLicenseType: () => void;
  activateLicense: (key: string) => void;
  removeLicense: () => void;
  onLicenseGet: (callback: (type: string) => void) => () => void;
  onLicenseActivated: (callback: (success: boolean) => void) => () => void;
  
  // Local Storage Sync
  sendLS: (data: Record<string, unknown>) => void;
  
  // Migration APIs
  getMigratedLocalStorage: () => Promise<Record<string, unknown> | null>;
  getMigratedItem: (key: string) => Promise<unknown>;
  hasMigrationOccurred: () => Promise<boolean>;
  triggerMigration: () => Promise<{ success: boolean; migratedKeys: string[]; error?: string }>;
  onLocalStorageMigrationComplete: (callback: (info: { occurred: boolean; backupPath: string | null }) => void) => () => void;
  onFlashcardMigrationComplete: (callback: (info: { occurred: boolean; backupPath: string | null; fromVersion: number | null }) => void) => () => void;
  getFlashcardMigrationInfo: () => void;
  
  // File Operations
  readDirectoryImages: (directoryPath: string) => Promise<{ files: Array<{ name: string; path: string; data: ArrayBuffer }> }>;
  readPdfFile: (filePath: string) => Promise<{ data: ArrayBuffer }>;
  selectVideoFile: () => Promise<string | null>;
  selectSubtitleFile: () => Promise<string | null>;
  selectBookFolder: () => Promise<string | null>;
  selectPdfFile: () => Promise<string | null>;
  selectBrowserFile: () => Promise<string | null>;
  readMediaFile: (filePath: string) => Promise<ArrayBuffer | null>;
  readMediaFileChunk: (filePath: string, offset: number, length: number) => Promise<ArrayBuffer | null>;
  getFileSize: (filePath: string) => Promise<number | null>;
  /**
   * Convert a local file path to a local-media:// URL for secure media playback.
   * Use this for video/audio files to bypass Electron's file:// restrictions.
   */
  getLocalMediaUrl: (filePath: string) => Promise<string | null>;

  /**
   * Get filesystem path for a File object.
   * Required for Electron v32+ where File.path was removed.
   * Use this when handling drag-dropped files to get their filesystem path.
   */
  getPathForFile: (file: File) => string;

  // Media Stats
  saveMediaStats: (mediaHash: string, stats: MediaStats) => void;
  getMediaStats: (mediaHash: string) => void;
  onMediaStats: (callback: (stats: MediaStats | null) => void) => () => void;
  listMediaStats: () => void;
  onMediaStatsList: (callback: (stats: MediaStats[]) => void) => () => void;

  // Ollama
  ollamaChat: (messages: unknown[], tools?: unknown[]) => void;
  ollamaChatStream: (messages: unknown[], tools?: unknown[]) => void;
  ollamaChatStreamAbort: () => void;
  onOllamaChatStream: (callback: (chunk: { content?: string; done?: boolean; tool_calls?: unknown[]; eval_count?: number; eval_duration?: number; prompt_eval_duration?: number; total_duration?: number }) => void) => () => void;
  ollamaListModels: () => Promise<unknown[]>;
  ollamaCheck: () => Promise<boolean>;
  ollamaPullModel: (modelName: string) => void;
  onOllamaPullModelProgress: (callback: (progress: { status: string; completed?: number; total?: number; error?: string }) => void) => () => void;

  // Unified LLM
  llmStream: (messages: LLMChatMessage[], tools: LLMToolDefinition[]) => void;
  llmStreamAbort: () => void;
  onLLMStreamChunk: (callback: (chunk: LLMStreamChunk) => void) => () => void;
  llmCheckModel: (modelFile?: string) => Promise<LLMModelStatus>;
  llmDownloadModel: (modelUrl?: string, modelFile?: string) => void;
  onLLMDownloadProgress: (callback: (status: LLMModelStatus) => void) => () => void;
  onLLMModelStatus: (callback: (status: LLMModelStatus) => void) => () => void;
  llmUnloadModel: () => void;
  llmGetSystemMemory?: () => Promise<SystemMemoryInfo>;
  llmListDownloadedModels?: () => Promise<Array<{ modelFile: string; sizeBytes: number }>>;
  llmDeleteModel?: (modelFile: string) => Promise<void>;

  // Speech
  sttStart: (language: string) => void;
  sttStop: () => void;
  onSttResult: (callback: (result: { transcript: string; isFinal: boolean }) => void) => () => void;
  ttsSpeak: (text: string, language: string) => void;
  ttsStop: () => void;
  onTtsStatus: (callback: (status: { speaking: boolean; progress: number }) => void) => () => void;

  // URL Fetch
  fetchUrl: (url: string) => Promise<{ content: string; error?: string }>;

  // Voice Call Mode
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
  voiceTtsGenerate: (text: string, language: string, speed?: number, voiceSampleId?: string, provider?: string) => void;
  voiceTtsStop: () => void;
  onVoiceTtsAudio: (callback: (audio: VoiceTtsAudio) => void) => () => void;
  onVoiceTtsStatus: (callback: (status: VoiceTtsStatus) => void) => () => void;
  onVoiceSessionReady: (callback: (data: VoiceSessionReady) => void) => () => void;
  onVoiceSessionError: (callback: (data: VoiceSessionError) => void) => () => void;

  // Voice Sample Management
  voiceSampleList: () => Promise<VoiceSample[]>;
  voiceSampleUpload: (sourcePath: string, name: string) => Promise<VoiceSample>;
  voiceSampleDelete: (id: string) => Promise<boolean>;
  voiceSampleRename: (id: string, newName: string) => Promise<boolean>;
  voiceSampleTranscribe: (id: string) => Promise<{ text: string; language: string }>;
  voiceSampleGetPath: (id: string) => Promise<string | null>;

  // KV Store
  kvGet: (key: string) => Promise<string | null>;
  kvSet: (key: string, value: string) => Promise<void>;
  kvRemove: (key: string) => Promise<void>;
  kvGetAll: () => Promise<Record<string, string>>;
  kvSetBatch: (entries: Record<string, string>) => Promise<void>;

  // Data Export/Import
  dataExport: () => Promise<{ success: boolean; filePath?: string | null; error?: string }>;
  dataImport: () => Promise<{ success: boolean; error?: string }>;

  // Browser Detection & Extension Installation
  detectBrowsers: (customPaths?: Array<{ path: string; type: 'chrome' | 'firefox' }>) => Promise<Array<{ name: string; type: 'chrome' | 'firefox' | 'unknown'; path: string; profilePath?: string; isInstalled: boolean }>>;
  installExtension: (browser: { name: string; type: 'chrome' | 'firefox' | 'unknown'; path: string; profilePath?: string; isInstalled: boolean }) => Promise<{ success: boolean; path?: string; error?: string; extensionPath?: string }>;
  uninstallExtension: (browser: { name: string; type: 'chrome' | 'firefox' | 'unknown'; path: string; profilePath?: string; isInstalled: boolean }) => Promise<{ success: boolean; error?: string }>;
  isExtensionInstalled: (browser: { name: string; type: 'chrome' | 'firefox' | 'unknown'; path: string; profilePath?: string; isInstalled: boolean }) => Promise<{ installed: boolean }>;
  openExtensionFolder: () => Promise<boolean>;

  // Window Management
  openWindow: (payload: OpenWindowPayload) => void;
  closeWindow: () => void;
  getWindowContext: (windowType: string) => void;
  onWindowContext: (callback: (context: Record<string, unknown> | null) => void) => (() => void) | undefined;

  // Diagnostics
  runDiagnostics: () => Promise<import('./diagnostics/types').DiagnosticsReport>;
  onDiagnosticsProgress: (callback: (progress: import('./diagnostics/types').DiagnosticsProgressEvent) => void) => () => void;
  onDiagnosticsComplete: (callback: (report: import('./diagnostics/types').DiagnosticsReport) => void) => () => void;
  saveDiagnosticsReport: (reportJson: string) => Promise<string>;
}

export interface MLearnInternal {
  setScopedPluginValue: (payload: { sourceId: string; isFocused: boolean; channel: string; value: PluginBusJSONValue }) => void;
}

interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
}

declare global {
  interface Window {
    mLearnIPC?: MLearnIPC;
    mLearnInternal?: MLearnInternal;
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv;
    glob: <T = () => Promise<unknown>>(pattern: string) => Record<string, T>;
  }
}

export {};
