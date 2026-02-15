/**
 * Electron Preload Script
 * Exposes a safe IPC bridge to renderer processes
 */

import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC_CHANNELS } from '../shared/constants';
import type { Settings, FlashcardStore, InstallOptions, WindowSize, PromptOptions, OpenWindowPayload, MediaStats, LLMChatMessage, LLMToolDefinition, LLMStreamChunk, LLMModelStatus, VoiceModelStatus, VoiceSTTResult, VoiceVadEvent, VoiceTtsStatus, VoiceTtsAudio, VoiceMode, VoiceSessionReady, VoiceSessionError, VoiceSample } from '../shared/types';

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
  showCtxMenu: (options?: { isWatchTogether?: boolean }) => ipcRenderer.send(IPC_CHANNELS.SHOW_CTX_MENU, options),
  onContextMenuCommand: (callback: (command: string) => void) =>
    ipcOn(IPC_CHANNELS.CTX_MENU_COMMAND, (_event, command) => callback(command)),
  showReaderCtxMenu: (options: { furiganaHiderEnabled: boolean; hasContextPhrase: boolean }) => {
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
  onOcrStatusUpdate: (callback: (message: string) => void) =>
    ipcOn(IPC_CHANNELS.OCR_STATUS_UPDATE, (_event, message) => callback(message)),

  // ========== Installation ==========
  startInstall: (options: InstallOptions) => ipcRenderer.send(IPC_CHANNELS.START_INSTALL, options),
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

  // ========== UI ==========
  onOpenSettings: (callback: (section?: string) => void) =>
    ipcOn(IPC_CHANNELS.SHOW_SETTINGS, (_event, section) => callback(section)),
  onOpenAside: (callback: () => void) =>
    ipcOn(IPC_CHANNELS.SHOW_ASIDE, () => callback()),
  writeToClipboard: (text: string) => ipcRenderer.send(IPC_CHANNELS.WRITE_TO_CLIPBOARD, text),
  showContact: () => ipcRenderer.send(IPC_CHANNELS.SHOW_CONTACT),

  // ========== Watch Together ==========
  watchTogetherSend: (message: string) => ipcRenderer.send(IPC_CHANNELS.WATCH_TOGETHER_SEND, message),
  isWatchingTogether: () => ipcRenderer.send(IPC_CHANNELS.IS_WATCHING_TOGETHER),
  onWatchTogetherLaunch: (callback: () => void) =>
    ipcOn(IPC_CHANNELS.WATCH_TOGETHER, () => callback()),
  onWatchTogetherRequest: (callback: (message: string) => void) =>
    ipcOn(IPC_CHANNELS.WATCH_TOGETHER_REQUEST, (_event, message) => callback(message)),

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
    
  /**
   * Get filesystem path for a File object.
   * Required for Electron v32+ where File.path was removed.
   * Use this when handling drag-dropped files to get their filesystem path.
   */
  getPathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },

  // ========== Generic IPC Methods ==========
  // Generic send for any channel
  send: (channel: string, data?: unknown) => {
    ipcRenderer.send(channel, data);
  },
  
  // Generic on for any channel (returns cleanup function)
  on: (channel: string, callback: (...args: unknown[]) => void) =>
    ipcOn(channel, (_event, ...args) => callback(...args)),
  
  // Remove listener
  removeListener: (channel: string, callback: (...args: unknown[]) => void) => {
    ipcRenderer.removeListener(channel, callback);
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
  onVoiceSttResult: (callback: (result: VoiceSTTResult) => void) =>
    ipcOn(IPC_CHANNELS.VOICE_STT_RESULT, (_event, result) => callback(result)),
  onVoiceVadEvent: (callback: (event: VoiceVadEvent) => void) =>
    ipcOn(IPC_CHANNELS.VOICE_VAD_EVENT, (_event, vadEvent) => callback(vadEvent)),
  voiceTtsGenerate: (text: string, language: string, speed?: number, voiceSampleId?: string) =>
    ipcRenderer.send(IPC_CHANNELS.VOICE_TTS_GENERATE, text, language, speed, voiceSampleId),
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
};

// Expose API to renderer
contextBridge.exposeInMainWorld('mLearnIPC', mLearnIPC);

// Export type for use in renderer
export type MLearnIPC = typeof mLearnIPC;
