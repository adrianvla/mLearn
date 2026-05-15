/**
 * Electron Preload Script
 * Exposes a safe IPC bridge to renderer processes
 */

import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC_CHANNELS } from '../shared/constants';
import type { PluginBusEnvelope, PluginBusJSONValue } from '../shared/pluginBus';
import type { Settings, FlashcardStore, InstallOptions, WindowSize, PromptOptions, OpenWindowPayload, MediaStats, LLMChatMessage, LLMToolDefinition, LLMStreamChunk, LLMModelStatus, VoiceModelStatus, VoiceSTTResult, VoiceVadEvent, VoiceTtsStatus, VoiceTtsAudio, VoiceMode, VoiceSessionReady, VoiceSessionError, VoiceSample, SystemMemoryInfo, OverlayVideoState, OverlayGeometry, OverlayCommand, OverlaySubtitleTracks } from '../shared/types';
import type { PluginInstallResult, PluginKVGetResult, PluginState, PluginWindowPayload } from '../shared/plugins/types';
import { getLogger } from '../shared/utils/logger';

const log = getLogger('electron.preload');

/**
 * Type-safe IPC API exposed to renderer
 */
/** Register an IPC listener and return a cleanup function to remove it */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ipcOn(channel: string, handler: (...args: any[]) => void): () => void {
  ipcRenderer.on(channel, handler);
  return () => { ipcRenderer.removeListener(channel, handler); };
}

const mLearnIPC = {
  // ========== Settings ==========
  getSettings: () => ipcRenderer.send(IPC_CHANNELS.GET_SETTINGS),
  saveSettings: (settings: Settings) => ipcRenderer.send(IPC_CHANNELS.SAVE_SETTINGS, settings),
  onSettings: (callback: (settings: Settings) => void) =>
    ipcOn(IPC_CHANNELS.SETTINGS, (_event, settings) => callback(settings)),
  onSettingsSaved: (callback: () => void) =>
    ipcOn(IPC_CHANNELS.SETTINGS_SAVED, () => callback()),

  // ========== Language Data ==========
  getLangData: () => ipcRenderer.send(IPC_CHANNELS.GET_LANG_DATA),
  onLangData: (callback: (data: Record<string, unknown>) => void) =>
    ipcOn(IPC_CHANNELS.LANG_DATA, (_event, data) => callback(data)),
  installLanguage: (url: string) => ipcRenderer.send(IPC_CHANNELS.INSTALL_LANG, url),
  onLanguageInstalled: (callback: () => void) =>
    ipcOn(IPC_CHANNELS.LANG_INSTALLED, () => callback()),
  onLanguageInstallError: (callback: (error: string) => void) =>
    ipcOn(IPC_CHANNELS.LANG_INSTALL_ERROR, (_event, error) => callback(error)),

  // ========== Localization ==========
  getLocalization: () => ipcRenderer.send(IPC_CHANNELS.GET_LOCALIZATION),
  onLocalization: (callback: (data: { locale: string; strings: Record<string, unknown> }) => void) =>
    ipcOn(IPC_CHANNELS.LOCALIZATION, (_event, data) => callback(data)),
  changeUILanguage: (langCode: string) => ipcRenderer.send(IPC_CHANNELS.CHANGE_UI_LANGUAGE, langCode),

  // ========== Flashcards ==========
  getFlashcards: () => ipcRenderer.send(IPC_CHANNELS.GET_FLASHCARDS),
  saveFlashcards: (flashcards: FlashcardStore) => ipcRenderer.send(IPC_CHANNELS.SAVE_FLASHCARDS, flashcards),
  onFlashcards: (callback: (flashcards: FlashcardStore) => void) =>
    ipcOn(IPC_CHANNELS.FLASHCARDS_LOADED, (_event, flashcards) => callback(flashcards)),
  onNewDayFlashcards: (callback: () => void) =>
    ipcOn(IPC_CHANNELS.FORCE_NEWDAY_FLASHCARDS, () => callback()),
  onFlashcardConnectOpen: (callback: () => void) =>
    ipcOn(IPC_CHANNELS.FLASHCARD_CONNECT_OPEN, () => callback()),
  onReviewFlashcardRequest: (callback: () => void) =>
    ipcOn(IPC_CHANNELS.REVIEW_FLASHCARDS_REQUEST, () => callback()),
  
  // ========== Flashcard Images ==========
  saveFlashcardImage: (cardId: string, dataUrl: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.FLASHCARD_IMAGE_SAVE, cardId, dataUrl),
  resolveFlashcardImage: (imageUrl: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.FLASHCARD_IMAGE_RESOLVE, imageUrl),
  deleteFlashcardImage: (cardId: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.FLASHCARD_IMAGE_DELETE, cardId),

  // ========== Plugins ==========
  getPluginValue: (channel: string): Promise<PluginBusEnvelope> =>
    ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_BUS_GET_VALUE, channel),
  setPluginValue: (channel: string, value: PluginBusJSONValue): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_BUS_SET_VALUE, channel, value),
  emitPluginEvent: (channel: string, payload: PluginBusJSONValue): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_BUS_EMIT_EVENT, channel, payload),
  onPluginValue: (callbackChannel: string, callback: (nextValue: PluginBusEnvelope, previousValue: PluginBusEnvelope) => void) =>
    ipcOn(IPC_CHANNELS.PLUGIN_BUS_VALUE_CHANGED, (_event, payload: { channel: string; nextValue: PluginBusEnvelope; previousValue: PluginBusEnvelope }) => {
      if (payload.channel === callbackChannel) {
        callback(payload.nextValue, payload.previousValue);
      }
    }),
  onPluginEvent: (callbackChannel: string, callback: (payload: PluginBusJSONValue) => void) =>
    ipcOn(IPC_CHANNELS.PLUGIN_BUS_EVENT_EMITTED, (_event, payload: { channel: string; payload: PluginBusJSONValue }) => {
      if (payload.channel === callbackChannel) {
        callback(payload.payload);
      }
    }),
  pluginGetList: (): Promise<PluginState[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_GET_LIST),
  pluginEnable: (pluginId: string): Promise<PluginState | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_ENABLE, pluginId),
  pluginDisable: (pluginId: string): Promise<PluginState | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_DISABLE, pluginId),
  pluginGrantPermissions: (pluginId: string): Promise<PluginState | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_GRANT_PERMISSIONS, pluginId),
  pluginInstallFromPath: (sourcePath: string): Promise<PluginInstallResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_INSTALL_FROM_PATH, sourcePath),
  pluginSelectAndInstall: (): Promise<PluginInstallResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_SELECT_AND_INSTALL),
  pluginUninstall: (pluginId: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_UNINSTALL, pluginId),
  pluginKVGet: (pluginId: string, key: string): Promise<PluginKVGetResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_KV_GET, pluginId, key),
  pluginKVSet: (pluginId: string, key: string, value: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_KV_SET, pluginId, key, value),
  pluginKVRemove: (pluginId: string, key: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_KV_REMOVE, pluginId, key),
  pluginOpenWindow: (payload: PluginWindowPayload): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_OPEN_WINDOW, payload),
  onPluginList: (callback: (plugins: PluginState[]) => void) =>
    ipcOn(IPC_CHANNELS.PLUGIN_LIST, (_event, plugins) => callback(plugins)),
  onPluginStatusUpdate: (callback: (plugin: PluginState) => void) =>
    ipcOn(IPC_CHANNELS.PLUGIN_STATUS_UPDATE, (_event, plugin) => callback(plugin)),
  onPluginInstallResult: (callback: (result: PluginInstallResult) => void) =>
    ipcOn(IPC_CHANNELS.PLUGIN_INSTALL_RESULT, (_event, result) => callback(result)),

  // ========== Flashcard Videos ==========
  saveFlashcardVideo: (cardId: string, data: ArrayBuffer): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.FLASHCARD_VIDEO_SAVE, cardId, data),
  deleteFlashcardVideo: (cardId: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.FLASHCARD_VIDEO_DELETE, cardId),

  // ========== Flashcard TTS ==========
  getFlashcardTts: (cardId: string, field: 'word' | 'example'): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.FLASHCARD_TTS_GET, cardId, field),
  generateFlashcardTts: (cardId: string, text: string, language: string, field: 'word' | 'example', provider: string, voiceSampleId?: string, cloudAuthToken?: string, cloudApiUrl?: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.FLASHCARD_TTS_GENERATE, cardId, text, language, field, provider, voiceSampleId, cloudAuthToken, cloudApiUrl),
  batchGenerateFlashcardTts: (items: Array<{ cardId: string; text: string; field: 'word' | 'example' }>, language: string, provider: string, voiceSampleId?: string, cloudAuthToken?: string, cloudApiUrl?: string): Promise<Record<string, string>> =>
    ipcRenderer.invoke(IPC_CHANNELS.FLASHCARD_TTS_BATCH_GENERATE, items, language, provider, voiceSampleId, cloudAuthToken, cloudApiUrl),
  getFlashcardTtsMeta: (cardId: string, field: 'word' | 'example'): Promise<{ provider: string; generatedAt: string; language: string } | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.FLASHCARD_TTS_GET_META, cardId, field),
  deleteFlashcardTts: (cardId: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.FLASHCARD_TTS_DELETE, cardId),
  
  // ========== Migration ==========
  onFlashcardMigrationComplete: (callback: (info: { occurred: boolean; backupPath: string | null; fromVersion: number | null }) => void) =>
    ipcOn(IPC_CHANNELS.FLASHCARD_MIGRATION_COMPLETE, (_event, info) => callback(info)),
  getFlashcardMigrationInfo: () => ipcRenderer.send(IPC_CHANNELS.GET_FLASHCARD_MIGRATION_INFO),
  onLocalStorageMigrationComplete: (callback: (info: { occurred: boolean; backupPath: string | null }) => void) =>
    ipcOn(IPC_CHANNELS.LOCALSTORAGE_MIGRATION_COMPLETE, (_event, info) => callback(info)),
  // Get all migrated localStorage data
  getMigratedLocalStorage: (): Promise<Record<string, unknown> | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_MIGRATED_LOCALSTORAGE),
  // Get specific migrated item by key
  getMigratedItem: (key: string): Promise<unknown> =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_MIGRATED_ITEM, key),
  // Check if migration has occurred
  hasMigrationOccurred: (): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.HAS_MIGRATION_OCCURRED),
  // Trigger manual migration (useful for re-migration)
  triggerMigration: (): Promise<{ success: boolean; migratedKeys: string[]; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.TRIGGER_MIGRATION),

  // ========== Window Management ==========
  changeTrafficLights: (visibility: boolean) => {
    ipcRenderer.send(IPC_CHANNELS.TRAFFIC_LIGHTS, { visibility });
  },
  resizeWindow: (size: WindowSize) => ipcRenderer.send(IPC_CHANNELS.CHANGE_WINDOW_SIZE, size),
  makePiP: (size: WindowSize) => ipcRenderer.send(IPC_CHANNELS.MAKE_PIP, size),
  unPiP: () => ipcRenderer.send(IPC_CHANNELS.MAKE_NORMAL),
  showCtxMenu: (options?: { isWatchTogether?: boolean; hasContextPhrase?: boolean; canExplainPhrase?: boolean }) => ipcRenderer.send(IPC_CHANNELS.SHOW_CTX_MENU, options),
  onContextMenuCommand: (callback: (command: string) => void) =>
    ipcOn(IPC_CHANNELS.CTX_MENU_COMMAND, (_event, command) => callback(command)),
  showReaderCtxMenu: (options: { furiganaHiderEnabled: boolean; hasContextPhrase: boolean; canExplainPhrase?: boolean; collatePagesEnabled?: boolean; isDoublePageMode?: boolean }) => {
    ipcRenderer.send(IPC_CHANNELS.SHOW_READER_CTX_MENU, options);
  },
  onReaderContextMenuCommand: (callback: (command: string) => void) =>
    ipcOn(IPC_CHANNELS.READER_CTX_MENU_COMMAND, (_event, command) => callback(command)),
  openWindow: (payload: OpenWindowPayload) => ipcRenderer.send(IPC_CHANNELS.OPEN_WINDOW, payload),
  closeWindow: () => ipcRenderer.send(IPC_CHANNELS.CLOSE_WINDOW),
  getWindowContext: (windowType: string) => ipcRenderer.send(IPC_CHANNELS.GET_WINDOW_CONTEXT, windowType),
  onWindowContext: (callback: (context: Record<string, unknown> | null) => void) =>
    ipcOn(IPC_CHANNELS.WINDOW_CONTEXT, (_event, context) => callback(context)),

  // ========== App Lifecycle ==========
  restartApp: () => ipcRenderer.send(IPC_CHANNELS.RESTART_APP),
  forceRestartApp: () => ipcRenderer.send(IPC_CHANNELS.RESTART_APP_FORCE),
  restartBackend: () => ipcRenderer.send(IPC_CHANNELS.RESTART_BACKEND),
  getVersion: () => ipcRenderer.send(IPC_CHANNELS.GET_VERSION),
  onVersionReceive: (callback: (version: string) => void) =>
    ipcOn(IPC_CHANNELS.VERSION, (_event, version) => callback(version)),

  // ========== Server Status ==========
  isLoaded: () => ipcRenderer.send(IPC_CHANNELS.IS_LOADED),
  isSuccess: () => ipcRenderer.send(IPC_CHANNELS.IS_SUCCESSFUL_INSTALL),
  onServerLoad: (callback: (message: string) => void) =>
    ipcOn(IPC_CHANNELS.SERVER_LOAD, (_event, message) => callback(message)),
  onServerStatusUpdate: (callback: (message: string) => void) =>
    ipcOn(IPC_CHANNELS.SERVER_STATUS_UPDATE, (_event, message) => callback(message)),
  onServerCriticalError: (callback: (message: string) => void) =>
    ipcOn(IPC_CHANNELS.SERVER_CRITICAL_ERROR, (_event, message) => callback(message)),
  onAnkiConnectionError: (callback: (reason: string) => void) =>
    ipcOn(IPC_CHANNELS.ANKI_CONNECTION_ERROR, (_event, reason) => callback(reason)),
  restartBackendAnkiOverride: (disableAnki: boolean) =>
    ipcRenderer.send(IPC_CHANNELS.RESTART_BACKEND_ANKI_OVERRIDE, disableAnki),
  onOcrStatusUpdate: (callback: (message: string) => void) =>
    ipcOn(IPC_CHANNELS.OCR_STATUS_UPDATE, (_event, message) => callback(message)),

  // ========== Logging ==========
  sendLogRecord: (record: unknown) => ipcRenderer.send(IPC_CHANNELS.LOG_RECORD, record),

  // ========== Installation ==========
  startInstall: (options: InstallOptions) => ipcRenderer.send(IPC_CHANNELS.START_INSTALL, options),
  cancelInstall: () => ipcRenderer.send(IPC_CHANNELS.CANCEL_INSTALL),
  requestInstallerState: () => ipcRenderer.send(IPC_CHANNELS.INSTALLER_STATE_REQUEST),
  onPythonSuccess: (callback: (success: boolean) => void) =>
    ipcOn(IPC_CHANNELS.SUCCESSFUL_INSTALL, (_event, success) => callback(success)),
  onInstallStarted: (callback: (options: InstallOptions) => void) =>
    ipcOn(IPC_CHANNELS.INSTALL_STARTED, (_event, options) => callback(options)),
  onInstallerAwaitingChoice: (callback: () => void) =>
    ipcOn(IPC_CHANNELS.INSTALLER_AWAITING_CHOICE, () => callback()),
  onInstallerNetworkError: (callback: (payload: { message: string; detail?: string }) => void) =>
    ipcOn(IPC_CHANNELS.INSTALLER_NETWORK_ERROR, (_event, payload) => callback(payload)),
  onInstallerState: (callback: (state: { waiting: boolean; inProgress: boolean; success: boolean }) => void) =>
    ipcOn(IPC_CHANNELS.INSTALLER_STATE, (_event, state) => callback(state)),
  onPipProgress: (callback: (progress: { packageName: string; current: number; total: number; action: string }) => void) =>
    ipcOn(IPC_CHANNELS.PIP_PROGRESS, (_event, progress) => callback(progress)),

  // ========== UI ==========
  onOpenSettings: (callback: (section?: string) => void) =>
    ipcOn(IPC_CHANNELS.SHOW_SETTINGS, (_event, section) => callback(section)),
  onOpenAside: (callback: () => void) =>
    ipcOn(IPC_CHANNELS.SHOW_ASIDE, () => callback()),
  writeToClipboard: (text: string) => ipcRenderer.send(IPC_CHANNELS.WRITE_TO_CLIPBOARD, text),
  showContact: () => ipcRenderer.send(IPC_CHANNELS.SHOW_CONTACT),
  openExternalUrl: (url: string): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.OPEN_EXTERNAL_URL, url),
  onAuthDeepLink: (callback: (payload: { code: string | null; state: string | null; error: string | null }) => void) =>
    ipcOn(IPC_CHANNELS.AUTH_DEEP_LINK, (_event, payload) => callback(payload)),
  onLookupDeepLink: (callback: (word: string) => void) =>
    ipcOn(IPC_CHANNELS.LOOKUP_DEEP_LINK, (_event, word) => callback(word)),

  // ========== Watch Together ==========
  watchTogetherSend: (message: string) => ipcRenderer.send(IPC_CHANNELS.WATCH_TOGETHER_SEND, message),
  isWatchingTogether: () => ipcRenderer.send(IPC_CHANNELS.IS_WATCHING_TOGETHER),
  onWatchTogetherLaunch: (callback: () => void) =>
    ipcOn(IPC_CHANNELS.WATCH_TOGETHER, () => callback()),
  onWatchTogetherRequest: (callback: (message: string) => void) =>
    ipcOn(IPC_CHANNELS.WATCH_TOGETHER_REQUEST, (_event, message) => callback(message)),

  // ========== Overlay ==========
  sendOverlayVideoState: (state: OverlayVideoState) => ipcRenderer.send(IPC_CHANNELS.OVERLAY_VIDEO_STATE, state),
  onOverlayVideoState: (callback: (state: OverlayVideoState) => void) =>
    ipcOn(IPC_CHANNELS.OVERLAY_VIDEO_STATE, (_event, state) => callback(state)),
  requestOverlaySync: () => ipcRenderer.send(IPC_CHANNELS.OVERLAY_REQUEST_SYNC),
  onOverlayRequestSync: (callback: () => void) =>
    ipcOn(IPC_CHANNELS.OVERLAY_REQUEST_SYNC, () => callback()),
  launchOverlay: () => ipcRenderer.send(IPC_CHANNELS.OVERLAY_LAUNCH),
  onOverlayLaunch: (callback: () => void) =>
    ipcOn(IPC_CHANNELS.OVERLAY_LAUNCH, () => callback()),
  onOverlayGeometry: (callback: (geometry: OverlayGeometry) => void) =>
    ipcOn(IPC_CHANNELS.OVERLAY_GEOMETRY, (_event, geometry) => callback(geometry)),
  setOverlayIgnoreMouseEvents: (ignore: boolean) => ipcRenderer.send(IPC_CHANNELS.OVERLAY_SET_IGNORE_MOUSE_EVENTS, ignore),
  sendOverlayCommand: (cmd: OverlayCommand) => ipcRenderer.send(IPC_CHANNELS.OVERLAY_COMMAND, cmd),
  sendOverlaySubtitleTracks: (tracks: OverlaySubtitleTracks) => ipcRenderer.send(IPC_CHANNELS.OVERLAY_SUBTITLE_TRACKS, tracks),
  onOverlaySubtitleTracks: (callback: (tracks: OverlaySubtitleTracks) => void) =>
    ipcOn(IPC_CHANNELS.OVERLAY_SUBTITLE_TRACKS, (_event, tracks) => callback(tracks)),
  overlayMoveBy: (delta: { x: number; y: number }) => ipcRenderer.invoke(IPC_CHANNELS.OVERLAY_MOVE_BY, delta),
  overlayResizeBy: (delta: { width: number; height: number }) => ipcRenderer.invoke(IPC_CHANNELS.OVERLAY_RESIZE_BY, delta),
  overlayGetBounds: (): Promise<{ x: number; y: number; width: number; height: number } | null> => ipcRenderer.invoke(IPC_CHANNELS.OVERLAY_GET_BOUNDS),
  overlaySetAutoPosition: (enabled: boolean) => ipcRenderer.invoke(IPC_CHANNELS.OVERLAY_SET_AUTO_POSITION, enabled),
  onOverlayAutoPositionChanged: (callback: (enabled: boolean) => void) =>
    ipcOn(IPC_CHANNELS.OVERLAY_AUTO_POSITION_CHANGED, (_event, enabled) => callback(enabled)),

  // ========== Tethered Updates ==========
  onUpdatePills: (callback: (data: string) => void) =>
    ipcOn(IPC_CHANNELS.UPDATE_PILLS, (_event, data) => callback(data)),
  onUpdateWordAppearance: (callback: (data: string) => void) =>
    ipcOn(IPC_CHANNELS.UPDATE_WORD_APPEARANCE, (_event, data) => callback(data)),
  onUpdateAttemptFlashcardCreation: (callback: (data: string) => void) =>
    ipcOn(IPC_CHANNELS.UPDATE_ATTEMPT_FLASHCARD_CREATION, (_event, data) => callback(data)),
  onUpdateCreateFlashcard: (callback: (data: string) => void) =>
    ipcOn(IPC_CHANNELS.UPDATE_CREATE_FLASHCARD, (_event, data) => callback(data)),
  onUpdateLastWatched: (callback: (data: string) => void) =>
    ipcOn(IPC_CHANNELS.UPDATE_LAST_WATCHED, (_event, data) => callback(data)),

  // ========== Stats & Editors ==========
  onOpenWordDbEditor: (callback: () => void) =>
    ipcOn(IPC_CHANNELS.OPEN_WORD_DB_EDITOR, () => callback()),
  onOpenKanjiGrid: (callback: () => void) =>
    ipcOn(IPC_CHANNELS.OPEN_KANJI_GRID, () => callback()),

  // ========== Prompt ==========
  promptOutput: (text: string) => ipcRenderer.send(IPC_CHANNELS.PROMPT_OUTPUT, text),
  onOpenPrompt: (callback: (options: PromptOptions) => void) =>
    ipcOn(IPC_CHANNELS.OPEN_PROMPT, (_event, options) => callback(options)),

  // ========== LocalStorage Sync ==========
  sendLS: (data: Record<string, unknown>) => ipcRenderer.send(IPC_CHANNELS.SEND_LS, data),

  // ========== File Operations ==========
  readDirectoryImages: (directoryPath: string): Promise<{ files: Array<{ name: string; path: string; data: ArrayBuffer }> }> => 
    ipcRenderer.invoke(IPC_CHANNELS.READ_DIRECTORY_IMAGES, directoryPath),
  readPdfFile: (filePath: string): Promise<{ data: ArrayBuffer }> => 
    ipcRenderer.invoke(IPC_CHANNELS.READ_PDF_FILE, filePath),
  selectVideoFile: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.SELECT_VIDEO_FILE),
  selectSubtitleFile: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.SELECT_SUBTITLE_FILE),
  selectBookFolder: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.SELECT_BOOK_FOLDER),
  selectPdfFile: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.SELECT_PDF_FILE),
  selectBrowserFile: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.SELECT_BROWSER_FILE),
  readMediaFile: (filePath: string): Promise<ArrayBuffer | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.READ_MEDIA_FILE, filePath),
  readMediaFileChunk: (filePath: string, offset: number, length: number): Promise<ArrayBuffer | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.READ_MEDIA_FILE_CHUNK, filePath, offset, length),
  getFileSize: (filePath: string): Promise<number | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_FILE_SIZE, filePath),

  /**
   * Get filesystem path for a File object.
   * Required for Electron v32+ where File.path was removed.
   * Use this when handling drag-dropped files to get their filesystem path.
   */
  getPathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file);
    } catch (e) {
      log.error('getPathForFile failed', e);
      return '';
    }
  },

  // ========== Media Stats ==========
  saveMediaStats: (mediaHash: string, stats: MediaStats) =>
    ipcRenderer.send(IPC_CHANNELS.SAVE_MEDIA_STATS, mediaHash, stats),
  getMediaStats: (mediaHash: string) => ipcRenderer.send(IPC_CHANNELS.GET_MEDIA_STATS, mediaHash),
  onMediaStats: (callback: (stats: MediaStats | null) => void) =>
    ipcOn(IPC_CHANNELS.GET_MEDIA_STATS, (_event, stats) => callback(stats)),
  listMediaStats: () => ipcRenderer.send(IPC_CHANNELS.LIST_MEDIA_STATS),
  onMediaStatsList: (callback: (stats: MediaStats[]) => void) =>
    ipcOn(IPC_CHANNELS.LIST_MEDIA_STATS, (_event, stats) => callback(stats)),

  // ========== Ollama ==========
  ollamaChat: (messages: unknown[], tools?: unknown[]) =>
    ipcRenderer.send(IPC_CHANNELS.OLLAMA_CHAT, messages, tools),
  ollamaChatStream: (messages: unknown[], tools?: unknown[]) =>
    ipcRenderer.send(IPC_CHANNELS.OLLAMA_CHAT_STREAM, messages, tools),
  ollamaChatStreamAbort: () =>
    ipcRenderer.send(IPC_CHANNELS.OLLAMA_CHAT_STREAM_ABORT),
  onOllamaChatStream: (callback: (chunk: { content?: string; done?: boolean; tool_calls?: unknown[]; eval_count?: number; eval_duration?: number; prompt_eval_duration?: number; total_duration?: number }) => void) =>
    ipcOn(IPC_CHANNELS.OLLAMA_CHAT_STREAM, (_event, chunk) => callback(chunk)),
  ollamaListModels: () => ipcRenderer.invoke(IPC_CHANNELS.OLLAMA_LIST_MODELS),
  ollamaCheck: () => ipcRenderer.invoke(IPC_CHANNELS.OLLAMA_CHECK),
  ollamaPullModel: (modelName: string) =>
    ipcRenderer.send(IPC_CHANNELS.OLLAMA_PULL_MODEL, modelName),
  onOllamaPullModelProgress: (callback: (progress: { status: string; completed?: number; total?: number; error?: string }) => void) =>
    ipcOn(IPC_CHANNELS.OLLAMA_PULL_MODEL_PROGRESS, (_event, progress) => callback(progress)),

  // ========== Unified LLM ==========
  llmStream: (messages: LLMChatMessage[], tools: LLMToolDefinition[]) =>
    ipcRenderer.send(IPC_CHANNELS.LLM_STREAM, messages, tools),
  llmStreamAbort: () =>
    ipcRenderer.send(IPC_CHANNELS.LLM_STREAM_ABORT),
  onLLMStreamChunk: (callback: (chunk: LLMStreamChunk) => void) =>
    ipcOn(IPC_CHANNELS.LLM_STREAM_CHUNK, (_event, chunk) => callback(chunk)),
  llmCheckModel: (modelFile?: string): Promise<LLMModelStatus> =>
    ipcRenderer.invoke(IPC_CHANNELS.LLM_CHECK_MODEL, modelFile),
  llmDownloadModel: (modelUrl?: string, modelFile?: string) =>
    ipcRenderer.send(IPC_CHANNELS.LLM_DOWNLOAD_MODEL, modelUrl, modelFile),
  onLLMDownloadProgress: (callback: (status: LLMModelStatus) => void) =>
    ipcOn(IPC_CHANNELS.LLM_DOWNLOAD_PROGRESS, (_event, status) => callback(status)),
  onLLMModelStatus: (callback: (status: LLMModelStatus) => void) =>
    ipcOn(IPC_CHANNELS.LLM_MODEL_STATUS, (_event, status) => callback(status)),
  llmUnloadModel: () =>
    ipcRenderer.send(IPC_CHANNELS.LLM_UNLOAD_MODEL),
  llmGetSystemMemory: (): Promise<SystemMemoryInfo> =>
    ipcRenderer.invoke(IPC_CHANNELS.LLM_GET_SYSTEM_MEMORY),
  llmListDownloadedModels: (): Promise<Array<{ modelFile: string; sizeBytes: number }>> =>
    ipcRenderer.invoke(IPC_CHANNELS.LLM_LIST_DOWNLOADED_MODELS),
  llmDeleteModel: (modelFile: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.LLM_DELETE_MODEL, modelFile),

  // ========== Speech ==========
  sttStart: (language: string) => ipcRenderer.send(IPC_CHANNELS.STT_START, language),
  sttStop: () => ipcRenderer.send(IPC_CHANNELS.STT_STOP),
  onSttResult: (callback: (result: { transcript: string; isFinal: boolean }) => void) =>
    ipcOn(IPC_CHANNELS.STT_RESULT, (_event, result) => callback(result)),
  ttsSpeak: (text: string, language: string) => ipcRenderer.send(IPC_CHANNELS.TTS_SPEAK, text, language),
  ttsStop: () => ipcRenderer.send(IPC_CHANNELS.TTS_STOP),
  onTtsStatus: (callback: (status: { speaking: boolean; progress: number }) => void) =>
    ipcOn(IPC_CHANNELS.TTS_STATUS, (_event, status) => callback(status)),

  // ========== URL Fetch ==========
  fetchUrl: (url: string): Promise<{ content: string; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.FETCH_URL, url),

  // ========== Voice Call Mode ==========
  voiceCheckModels: (language: string): Promise<VoiceModelStatus> =>
    ipcRenderer.invoke(IPC_CHANNELS.VOICE_MODEL_STATUS, language),
  voiceDownloadModels: (language: string) =>
    ipcRenderer.send(IPC_CHANNELS.VOICE_MODEL_DOWNLOAD, language),
  onVoiceModelProgress: (callback: (status: VoiceModelStatus) => void) =>
    ipcOn(IPC_CHANNELS.VOICE_MODEL_DOWNLOAD_PROGRESS, (_event, status) => callback(status)),
  voiceStartSession: (language: string, mode: VoiceMode, silenceThreshold?: number) =>
    ipcRenderer.send(IPC_CHANNELS.VOICE_START_SESSION, language, mode, silenceThreshold),
  voiceStopSession: () =>
    ipcRenderer.send(IPC_CHANNELS.VOICE_STOP_SESSION),
  voiceSendAudioChunk: (samples: Float32Array) =>
    ipcRenderer.send(IPC_CHANNELS.VOICE_AUDIO_CHUNK, samples),
  voiceFlush: () =>
    ipcRenderer.send(IPC_CHANNELS.VOICE_FLUSH),
  voiceUpdateSilenceThreshold: (threshold: number) =>
    ipcRenderer.send(IPC_CHANNELS.VOICE_UPDATE_SILENCE_THRESHOLD, threshold),
  onVoiceSttResult: (callback: (result: VoiceSTTResult) => void) =>
    ipcOn(IPC_CHANNELS.VOICE_STT_RESULT, (_event, result) => callback(result)),
  onVoiceVadEvent: (callback: (event: VoiceVadEvent) => void) =>
    ipcOn(IPC_CHANNELS.VOICE_VAD_EVENT, (_event, vadEvent) => callback(vadEvent)),
  voiceTtsGenerate: (text: string, language: string, speed?: number, voiceSampleId?: string, provider?: string) =>
    ipcRenderer.send(IPC_CHANNELS.VOICE_TTS_GENERATE, text, language, speed, voiceSampleId, provider),
  voiceTtsStop: () =>
    ipcRenderer.send(IPC_CHANNELS.VOICE_TTS_STOP),
  onVoiceTtsAudio: (callback: (audio: VoiceTtsAudio) => void) =>
    ipcOn(IPC_CHANNELS.VOICE_TTS_AUDIO, (_event, audio) => callback(audio)),
  onVoiceTtsStatus: (callback: (status: VoiceTtsStatus) => void) =>
    ipcOn(IPC_CHANNELS.VOICE_TTS_STATUS, (_event, status) => callback(status)),
  onVoiceSessionReady: (callback: (data: VoiceSessionReady) => void) =>
    ipcOn(IPC_CHANNELS.VOICE_SESSION_READY, (_event, data) => callback(data)),
  onVoiceSessionError: (callback: (data: VoiceSessionError) => void) =>
    ipcOn(IPC_CHANNELS.VOICE_SESSION_ERROR, (_event, data) => callback(data)),

  // ========== Voice Sample Management ==========
  voiceSampleList: (): Promise<VoiceSample[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.VOICE_SAMPLE_LIST),
  voiceSampleUpload: (sourcePath: string, name: string): Promise<VoiceSample> =>
    ipcRenderer.invoke(IPC_CHANNELS.VOICE_SAMPLE_UPLOAD, sourcePath, name),
  voiceSampleDelete: (id: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.VOICE_SAMPLE_DELETE, id),
  voiceSampleRename: (id: string, newName: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.VOICE_SAMPLE_RENAME, id, newName),
  voiceSampleTranscribe: (id: string): Promise<{ text: string; language: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.VOICE_SAMPLE_TRANSCRIBE, id),
  voiceSampleGetPath: (id: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.VOICE_SAMPLE_GET_PATH, id),

  // ========== Data Export/Import ==========
  dataExport: (): Promise<{ success: boolean; filePath?: string | null; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.DATA_EXPORT),
  dataImport: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.DATA_IMPORT),

  // ========== Browser Detection ==========
  detectBrowsers: (customPaths?: Array<{ path: string; type: 'chrome' | 'firefox' }>): Promise<Array<{ name: string; type: 'chrome' | 'firefox' | 'unknown'; path: string; profilePath?: string; isInstalled: boolean }>> =>
    ipcRenderer.invoke(IPC_CHANNELS.DETECT_BROWSERS, customPaths),
  installExtension: (browser: { name: string; type: 'chrome' | 'firefox' | 'unknown'; path: string; profilePath?: string; isInstalled: boolean }): Promise<{ success: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.INSTALL_EXTENSION, browser),
  uninstallExtension: (browser: { name: string; type: 'chrome' | 'firefox' | 'unknown'; path: string; profilePath?: string; isInstalled: boolean }): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.UNINSTALL_EXTENSION, browser),
  isExtensionInstalled: (browser: { name: string; type: 'chrome' | 'firefox' | 'unknown'; path: string; profilePath?: string; isInstalled: boolean }): Promise<{ installed: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.IS_EXTENSION_INSTALLED, browser),
  openExtensionFolder: (): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.OPEN_EXTENSION_FOLDER),

  // ========== KV Store ==========
  kvGet: (key: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.KV_GET, key),
  kvSet: (key: string, value: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.KV_SET, key, value),
  kvRemove: (key: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.KV_REMOVE, key),
  kvGetAll: (): Promise<Record<string, string>> =>
    ipcRenderer.invoke(IPC_CHANNELS.KV_GET_ALL),
  kvSetBatch: (entries: Record<string, string>): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.KV_SET_BATCH, entries),

  // ========== Diagnostics ==========
  runDiagnostics: (): Promise<import('../shared/diagnostics/types').DiagnosticsReport> =>
    ipcRenderer.invoke('diagnostics-run-all'),
  onDiagnosticsProgress: (callback: (progress: import('../shared/diagnostics/types').DiagnosticsProgressEvent) => void) =>
    ipcOn('diagnostics-progress', (_event, progress) => callback(progress)),
  onDiagnosticsComplete: (callback: (report: import('../shared/diagnostics/types').DiagnosticsReport) => void) =>
    ipcOn('diagnostics-complete', (_event, report) => callback(report)),
  saveDiagnosticsReport: (reportJson: string): Promise<string> =>
    ipcRenderer.invoke('diagnostics-save-report', reportJson),
};

const mLearnInternal = {
  setScopedPluginValue: (payload: { sourceId: string; isFocused: boolean; channel: string; value: PluginBusJSONValue }) =>
    ipcRenderer.send(IPC_CHANNELS.PLUGIN_BUS_SET_SCOPED_VALUE, payload),
};

function isPluginHostRenderer(): boolean {
  const globalLocation = (globalThis as typeof globalThis & {
    location?: { pathname?: string }
  }).location

  return globalLocation?.pathname?.includes('plugin-host.html') ?? false
}

const exposedIPC = {
  ...mLearnIPC,
  onPluginValue: (callbackChannel: string, callback: (nextValue: PluginBusEnvelope, previousValue: PluginBusEnvelope) => void) => {
    const initialPreviousValue: PluginBusEnvelope = { hasValue: false, value: null };

    const cleanup = ipcOn(IPC_CHANNELS.PLUGIN_BUS_VALUE_CHANGED, (_event, payload: { channel: string; nextValue: PluginBusEnvelope; previousValue: PluginBusEnvelope }) => {
      if (payload.channel === callbackChannel) {
        callback(payload.nextValue, payload.previousValue);
      }
    });

    const currentValue = ipcRenderer.sendSync(IPC_CHANNELS.PLUGIN_BUS_GET_VALUE_SYNC, callbackChannel) as PluginBusEnvelope
    callback(currentValue, initialPreviousValue)

    return cleanup;
  },
};

// Expose API to renderer
contextBridge.exposeInMainWorld('mLearnIPC', exposedIPC);

if (!isPluginHostRenderer()) {
  contextBridge.exposeInMainWorld('mLearnInternal', mLearnInternal);
}

// Export type for use in renderer
export type MLearnIPC = typeof exposedIPC;
export type MLearnInternal = typeof mLearnInternal;
