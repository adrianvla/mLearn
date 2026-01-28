/**
 * Electron Preload Script
 * Exposes a safe IPC bridge to renderer processes
 */

import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/constants';
import type { Settings, FlashcardStore, InstallOptions, WindowSize, PromptOptions, OpenWindowPayload } from '../shared/types';

/**
 * Type-safe IPC API exposed to renderer
 */
const mLearnIPC = {
  // ========== Settings ==========
  getSettings: () => ipcRenderer.send(IPC_CHANNELS.GET_SETTINGS),
  saveSettings: (settings: Settings) => ipcRenderer.send(IPC_CHANNELS.SAVE_SETTINGS, settings),
  onSettings: (callback: (settings: Settings) => void) => {
    ipcRenderer.on(IPC_CHANNELS.SETTINGS, (_event, settings) => callback(settings));
  },
  onSettingsSaved: (callback: () => void) => {
    ipcRenderer.on(IPC_CHANNELS.SETTINGS_SAVED, () => callback());
  },

  // ========== Language Data ==========
  getLangData: () => ipcRenderer.send(IPC_CHANNELS.GET_LANG_DATA),
  onLangData: (callback: (data: Record<string, unknown>) => void) => {
    ipcRenderer.on(IPC_CHANNELS.LANG_DATA, (_event, data) => callback(data));
  },
  installLanguage: (url: string) => ipcRenderer.send(IPC_CHANNELS.INSTALL_LANG, url),
  onLanguageInstalled: (callback: () => void) => {
    ipcRenderer.on(IPC_CHANNELS.LANG_INSTALLED, () => callback());
  },
  onLanguageInstallError: (callback: (error: string) => void) => {
    ipcRenderer.on(IPC_CHANNELS.LANG_INSTALL_ERROR, (_event, error) => callback(error));
  },

  // ========== Flashcards ==========
  getFlashcards: () => ipcRenderer.send(IPC_CHANNELS.GET_FLASHCARDS),
  saveFlashcards: (flashcards: FlashcardStore) => ipcRenderer.send(IPC_CHANNELS.SAVE_FLASHCARDS, flashcards),
  onFlashcards: (callback: (flashcards: FlashcardStore) => void) => {
    ipcRenderer.on(IPC_CHANNELS.FLASHCARDS_LOADED, (_event, flashcards) => callback(flashcards));
  },
  onNewDayFlashcards: (callback: () => void) => {
    ipcRenderer.on(IPC_CHANNELS.FORCE_NEWDAY_FLASHCARDS, () => callback());
  },
  onFlashcardConnectOpen: (callback: () => void) => {
    ipcRenderer.on(IPC_CHANNELS.FLASHCARD_CONNECT_OPEN, () => callback());
  },
  onReviewFlashcardRequest: (callback: () => void) => {
    ipcRenderer.on(IPC_CHANNELS.REVIEW_FLASHCARDS_REQUEST, () => callback());
  },

  // ========== Window Management ==========
  changeTrafficLights: (visibility: boolean) => {
    ipcRenderer.send(IPC_CHANNELS.TRAFFIC_LIGHTS, { visibility });
  },
  resizeWindow: (size: WindowSize) => ipcRenderer.send(IPC_CHANNELS.CHANGE_WINDOW_SIZE, size),
  makePiP: (size: WindowSize) => ipcRenderer.send(IPC_CHANNELS.MAKE_PIP, size),
  unPiP: () => ipcRenderer.send(IPC_CHANNELS.MAKE_NORMAL),
  showCtxMenu: () => ipcRenderer.send(IPC_CHANNELS.SHOW_CTX_MENU),
  onContextMenuCommand: (callback: (command: string) => void) => {
    ipcRenderer.on(IPC_CHANNELS.CTX_MENU_COMMAND, (_event, command) => callback(command));
  },
  openWindow: (payload: OpenWindowPayload) => ipcRenderer.send(IPC_CHANNELS.OPEN_WINDOW, payload),
  closeWindow: () => ipcRenderer.send(IPC_CHANNELS.CLOSE_WINDOW),

  // ========== App Lifecycle ==========
  restartApp: () => ipcRenderer.send(IPC_CHANNELS.RESTART_APP),
  forceRestartApp: () => ipcRenderer.send(IPC_CHANNELS.RESTART_APP_FORCE),
  getVersion: () => ipcRenderer.send(IPC_CHANNELS.GET_VERSION),
  onVersionReceive: (callback: (version: string) => void) => {
    ipcRenderer.on(IPC_CHANNELS.VERSION, (_event, version) => callback(version));
  },

  // ========== Server Status ==========
  isLoaded: () => ipcRenderer.send(IPC_CHANNELS.IS_LOADED),
  isSuccess: () => ipcRenderer.send(IPC_CHANNELS.IS_SUCCESSFUL_INSTALL),
  onServerLoad: (callback: (message: string) => void) => {
    ipcRenderer.on(IPC_CHANNELS.SERVER_LOAD, (_event, message) => callback(message));
  },
  onServerStatusUpdate: (callback: (message: string) => void) => {
    ipcRenderer.on(IPC_CHANNELS.SERVER_STATUS_UPDATE, (_event, message) => callback(message));
  },
  onServerCriticalError: (callback: (message: string) => void) => {
    ipcRenderer.on(IPC_CHANNELS.SERVER_CRITICAL_ERROR, (_event, message) => callback(message));
  },
  onOcrStatusUpdate: (callback: (message: string) => void) => {
    ipcRenderer.on(IPC_CHANNELS.OCR_STATUS_UPDATE, (_event, message) => callback(message));
  },

  // ========== Installation ==========
  startInstall: (options: InstallOptions) => ipcRenderer.send(IPC_CHANNELS.START_INSTALL, options),
  requestInstallerState: () => ipcRenderer.send(IPC_CHANNELS.INSTALLER_STATE_REQUEST),
  onPythonSuccess: (callback: (success: boolean) => void) => {
    ipcRenderer.on(IPC_CHANNELS.SUCCESSFUL_INSTALL, (_event, success) => callback(success));
  },
  onInstallStarted: (callback: (options: InstallOptions) => void) => {
    ipcRenderer.on(IPC_CHANNELS.INSTALL_STARTED, (_event, options) => callback(options));
  },
  onInstallerAwaitingChoice: (callback: () => void) => {
    ipcRenderer.on(IPC_CHANNELS.INSTALLER_AWAITING_CHOICE, () => callback());
  },
  onInstallerNetworkError: (callback: (payload: { message: string; detail?: string }) => void) => {
    ipcRenderer.on(IPC_CHANNELS.INSTALLER_NETWORK_ERROR, (_event, payload) => callback(payload));
  },
  onInstallerState: (callback: (state: { waiting: boolean; inProgress: boolean; success: boolean }) => void) => {
    ipcRenderer.on(IPC_CHANNELS.INSTALLER_STATE, (_event, state) => callback(state));
  },

  // ========== UI ==========
  onOpenSettings: (callback: (section?: string) => void) => {
    ipcRenderer.on(IPC_CHANNELS.SHOW_SETTINGS, (_event, section) => callback(section));
  },
  onOpenAside: (callback: () => void) => {
    ipcRenderer.on(IPC_CHANNELS.SHOW_ASIDE, () => callback());
  },
  writeToClipboard: (text: string) => ipcRenderer.send(IPC_CHANNELS.WRITE_TO_CLIPBOARD, text),
  showContact: () => ipcRenderer.send(IPC_CHANNELS.SHOW_CONTACT),

  // ========== Watch Together ==========
  watchTogetherSend: (message: string) => ipcRenderer.send(IPC_CHANNELS.WATCH_TOGETHER_SEND, message),
  isWatchingTogether: () => ipcRenderer.send(IPC_CHANNELS.IS_WATCHING_TOGETHER),
  onWatchTogetherLaunch: (callback: () => void) => {
    ipcRenderer.on(IPC_CHANNELS.WATCH_TOGETHER, () => callback());
  },
  onWatchTogetherRequest: (callback: (message: string) => void) => {
    ipcRenderer.on(IPC_CHANNELS.WATCH_TOGETHER_REQUEST, (_event, message) => callback(message));
  },

  // ========== Tethered Updates ==========
  onUpdatePills: (callback: (data: string) => void) => {
    ipcRenderer.on(IPC_CHANNELS.UPDATE_PILLS, (_event, data) => callback(data));
  },
  onUpdateWordAppearance: (callback: (data: string) => void) => {
    ipcRenderer.on(IPC_CHANNELS.UPDATE_WORD_APPEARANCE, (_event, data) => callback(data));
  },
  onUpdateAttemptFlashcardCreation: (callback: (data: string) => void) => {
    ipcRenderer.on(IPC_CHANNELS.UPDATE_ATTEMPT_FLASHCARD_CREATION, (_event, data) => callback(data));
  },
  onUpdateCreateFlashcard: (callback: (data: string) => void) => {
    ipcRenderer.on(IPC_CHANNELS.UPDATE_CREATE_FLASHCARD, (_event, data) => callback(data));
  },
  onUpdateLastWatched: (callback: (data: string) => void) => {
    ipcRenderer.on(IPC_CHANNELS.UPDATE_LAST_WATCHED, (_event, data) => callback(data));
  },

  // ========== Stats & Editors ==========
  onOpenWordDbEditor: (callback: () => void) => {
    ipcRenderer.on(IPC_CHANNELS.OPEN_WORD_DB_EDITOR, () => callback());
  },
  onOpenKanjiGrid: (callback: () => void) => {
    ipcRenderer.on(IPC_CHANNELS.OPEN_KANJI_GRID, () => callback());
  },

  // ========== Prompt ==========
  promptOutput: (text: string) => ipcRenderer.send(IPC_CHANNELS.PROMPT_OUTPUT, text),
  onOpenPrompt: (callback: (options: PromptOptions) => void) => {
    ipcRenderer.on(IPC_CHANNELS.OPEN_PROMPT, (_event, options) => callback(options));
  },

  // ========== LocalStorage Sync ==========
  sendLS: (data: Record<string, unknown>) => ipcRenderer.send(IPC_CHANNELS.SEND_LS, data),

  // ========== File Operations ==========
  readDirectoryImages: (directoryPath: string): Promise<{ files: Array<{ name: string; path: string; data: ArrayBuffer }> }> => 
    ipcRenderer.invoke(IPC_CHANNELS.READ_DIRECTORY_IMAGES, directoryPath),
  readPdfFile: (filePath: string): Promise<{ data: ArrayBuffer }> => 
    ipcRenderer.invoke(IPC_CHANNELS.READ_PDF_FILE, filePath),

  // ========== Generic IPC Methods ==========
  // Generic send for any channel
  send: (channel: string, data?: unknown) => {
    ipcRenderer.send(channel, data);
  },
  
  // Generic on for any channel
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    ipcRenderer.on(channel, (_event, ...args) => callback(...args));
  },
  
  // Remove listener
  removeListener: (channel: string, callback: (...args: unknown[]) => void) => {
    ipcRenderer.removeListener(channel, callback);
  },
};

// Expose API to renderer
contextBridge.exposeInMainWorld('mLearnIPC', mLearnIPC);

// Export type for use in renderer
export type MLearnIPC = typeof mLearnIPC;
