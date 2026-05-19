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
  LanguageDataMap,
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
  SystemMemoryInfo,
  CloudLLMTier,
} from '../types';
import type {
  PluginBusEnvelope,
  PluginBusJSONValue,
} from '../pluginBus';
import type {
  PluginInstallResult,
  PluginKVGetResult,
  PluginState,
  PluginWindowPayload,
} from '../plugins/types';

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
  saveFlashcardImage: (cardId: string, dataUrl: string) => Promise<string | null>;
  resolveFlashcardImage: (imageUrl: string) => Promise<string | null>;
  deleteFlashcardImage: (cardId: string) => Promise<void>;
  saveFlashcardVideo: (cardId: string, data: ArrayBuffer) => Promise<string | null>;
  deleteFlashcardVideo: (cardId: string) => Promise<void>;
  getFlashcardTts: (cardId: string, field: 'word' | 'example') => Promise<string | null>;
  generateFlashcardTts: (cardId: string, text: string, language: string, field: 'word' | 'example', provider: string, voiceSampleId?: string, cloudAuthToken?: string, cloudApiUrl?: string) => Promise<string | null>;
  batchGenerateFlashcardTts: (items: Array<{ cardId: string; text: string; field: 'word' | 'example' }>, language: string, provider: string, voiceSampleId?: string, cloudAuthToken?: string, cloudApiUrl?: string) => Promise<Record<string, string>>;
  getFlashcardTtsMeta: (cardId: string, field: 'word' | 'example') => Promise<{ provider: string; generatedAt: string; language: string } | null>;
  deleteFlashcardTts: (cardId: string) => Promise<void>;
}

export interface PluginBridge {
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
}

export interface LocalizationBridge {
  getLocalization: () => void;
  onLocalization: (callback: (data: { locale: string; strings: Record<string, unknown> }) => void) => () => void;
  changeUILanguage: (langCode: string) => void;
  getLangData: () => void;
  onLangData: (callback: (data: LanguageDataMap) => void) => () => void;
  installLanguage: (url: string) => void;
  onLanguageInstalled: (callback: (lang: string) => void) => () => void;
  onLanguageInstallError: (callback: (error: string) => void) => () => void;
}

export interface FileBridge {
  readDirectoryImages: (directoryPath: string) => Promise<{ files: Array<{ name: string; path: string; data: ArrayBuffer }> }>;
  readPdfFile: (filePath: string) => Promise<{ data: ArrayBuffer }>;
  readMediaFile: (filePath: string) => Promise<ArrayBuffer | null>;
  readMediaFileChunk: (filePath: string, offset: number, length: number) => Promise<ArrayBuffer | null>;
  getFileSize: (filePath: string) => Promise<number | null>;
  selectVideoFile: () => Promise<string | null>;
  selectSubtitleFile: () => Promise<string | null>;
  selectBookFolder: () => Promise<string | null>;
  selectPdfFile: () => Promise<string | null>;
  selectBrowserFile: () => Promise<string | null>;
  getLocalMediaUrl: (filePath: string) => Promise<string | null>;
  getPathForFile: (file: File) => string;
  writeToClipboard: (text: string) => void;
}

export interface WindowBridge {
  changeTrafficLights: (visibility: boolean) => void;
  resizeWindow: (size: { width: number; height: number }) => void;
  makePiP: (size: { width: number; height: number }) => void;
  unPiP: () => void;
  showCtxMenu: (options?: { isWatchTogether?: boolean; hasContextPhrase?: boolean; canExplainPhrase?: boolean }) => void;
  showReaderCtxMenu: (options: { furiganaHiderEnabled: boolean; hasContextPhrase: boolean; canExplainPhrase?: boolean; collatePagesEnabled?: boolean; isDoublePageMode?: boolean }) => void;
  showContact: () => void;
  openExternalUrl: (url: string) => Promise<boolean>;
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
  onAuthDeepLink: (callback: (payload: { code: string | null; state: string | null; error: string | null }) => void) => () => void;
  onLookupDeepLink: (callback: (word: string) => void) => () => void;
  promptOutput: (text: string) => void;
}

export interface ServerBridge {
  isLoaded: () => void;
  isSuccess: () => void;
  onServerLoad: (callback: (message: string) => void) => () => void;
  onServerStatusUpdate: (callback: (message: string) => void) => () => void;
  onServerCriticalError: (callback: (message: string) => void) => () => void;
  onAnkiConnectionError: (callback: (reason: string) => void) => () => void;
  restartBackendAnkiOverride: (disableAnki: boolean) => void;
  onOcrStatusUpdate: (callback: (message: string) => void) => () => void;
  sendLogRecord: (record: unknown) => void;
  restartApp: () => void;
  forceRestartApp: () => void;
  restartBackend: () => void;
  getVersion: () => void;
  onVersionReceive: (callback: (version: string) => void) => () => void;
  getLegalDocument: (name: string) => void;
  onLegalDocumentReceive: (callback: (content: string) => void) => () => void;
}

export interface InstallerBridge {
  startInstall: (options: InstallOptions) => void;
  cancelInstall: () => void;
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
  llmStream: (messages: LLMChatMessage[], tools: LLMToolDefinition[], tier?: CloudLLMTier) => void;
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
  voiceTtsGenerate: (text: string, language: string, speed?: number, voiceSampleId?: string, provider?: string, cloudAuthToken?: string) => void;
  voiceTtsStop: () => void;
  onVoiceTtsAudio: (callback: (audio: VoiceTtsAudio) => void) => () => void;
  onVoiceTtsStatus: (callback: (status: VoiceTtsStatus) => void) => () => void;
  onVoiceSessionReady: (callback: (data: VoiceSessionReady) => void) => () => void;
  onVoiceSessionError: (callback: (data: VoiceSessionError) => void) => () => void;
  voiceSampleList: () => Promise<VoiceSample[]>;
  voiceSampleUpload: (sourcePath: string, name: string) => Promise<VoiceSample>;
  voiceSampleDelete: (id: string) => Promise<boolean>;
  voiceSampleRename: (id: string, newName: string) => Promise<boolean>;
  voiceSampleTranscribe: (id: string) => Promise<{ text: string; language: string }>;
  voiceSampleGetPath: (id: string) => Promise<string | null>;
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

export interface OverlayBridge {
  sendOverlayVideoState: (state: import('../types').OverlayVideoState) => void;
  onOverlayVideoState: (callback: (state: import('../types').OverlayVideoState) => void) => () => void;
  onOverlayVideoScreenshot: (callback: (screenshot: import('../types').OverlayVideoScreenshot) => void) => () => void;
  requestOverlaySync: () => void;
  onOverlayRequestSync: (callback: () => void) => () => void;
  launchOverlay: () => void;
  onOverlayLaunch: (callback: () => void) => () => void;
  onOverlayGeometry: (callback: (geometry: import('../types').OverlayGeometry) => void) => () => void;
  setOverlayIgnoreMouseEvents: (ignore: boolean) => void;
  sendOverlayCommand: (cmd: import('../types').OverlayCommand) => void;
  sendOverlaySubtitleTracks: (tracks: import('../types').OverlaySubtitleTracks) => void;
  onOverlaySubtitleTracks: (callback: (tracks: import('../types').OverlaySubtitleTracks) => void) => () => void;
  overlayMoveBy: (delta: import('../types').OverlayDelta) => Promise<void>;
  overlayResizeBy: (delta: import('../types').OverlaySizeDelta) => Promise<void>;
  overlayGetBounds: () => Promise<import('../types').OverlayBounds | null>;
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
  sendLS: (data: Record<string, unknown>) => void;
  fetchUrl: (url: string) => Promise<{ content: string; error?: string }>;
}

export interface DataBridge {
  dataExport: () => Promise<{ success: boolean; filePath?: string | null; error?: string }>;
  dataImport: () => Promise<{ success: boolean; error?: string }>;
}

export interface BrowserInfo {
  name: string;
  type: 'chrome' | 'firefox' | 'unknown';
  path: string;
  profilePath?: string;
  isInstalled: boolean;
}

export interface CustomBrowserPath {
  path: string;
  type: 'chrome' | 'firefox';
}

export interface BrowserBridge {
  detectBrowsers: (customPaths?: CustomBrowserPath[]) => Promise<BrowserInfo[]>;
  installExtension: (browser: BrowserInfo) => Promise<{ success: boolean; path?: string; error?: string; extensionPath?: string }>;
  uninstallExtension: (browser: BrowserInfo) => Promise<{ success: boolean; error?: string }>;
  isExtensionInstalled: (browser: BrowserInfo) => Promise<{ installed: boolean }>;
  openExtensionFolder: () => Promise<boolean>;
}

export interface DiagnosticsBridge {
  runDiagnostics: () => Promise<import('../diagnostics/types').DiagnosticsReport>;
  onDiagnosticsProgress: (callback: (progress: import('../diagnostics/types').DiagnosticsProgressEvent) => void) => () => void;
  onDiagnosticsComplete: (callback: (report: import('../diagnostics/types').DiagnosticsReport) => void) => () => void;
  saveDiagnosticsReport: (reportJson: string) => Promise<string>;
}

export interface KVStoreBridge {
  kvGet: (key: string) => Promise<string | null>;
  kvSet: (key: string, value: string) => Promise<void>;
  kvRemove: (key: string) => Promise<void>;
  kvGetAll: () => Promise<Record<string, string>>;
  kvSetBatch: (entries: Record<string, string>) => Promise<void>;
}

// ============================================================================
// Combined PlatformBridge
// ============================================================================

export interface PlatformBridge {
  settings: SettingsBridge;
  flashcards: FlashcardBridge;
  plugins: PluginBridge;
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
  overlay: OverlayBridge;
  crossWindow: CrossWindowBridge;
  license: LicenseBridge;
  migration: MigrationBridge;
  generic: GenericIPCBridge;
  data: DataBridge;
  kvStore: KVStoreBridge;
  browser: BrowserBridge;
  diagnostics: DiagnosticsBridge;
}
