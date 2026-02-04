/**
 * Global Type Declarations
 * Extends Window interface with mLearn IPC API
 */

import type { Settings, FlashcardStore, LanguageData, InstallOptions, InstallerState, OpenWindowPayload } from './types';

export interface MLearnIPC {
  // Settings
  getSettings: () => void;
  saveSettings: (settings: Settings) => void;
  onSettings: (callback: (settings: Settings) => void) => void;
  onSettingsSaved: (callback: () => void) => void;
  
  // Flashcards
  getFlashcards: () => void;
  saveFlashcards: (flashcards: FlashcardStore) => void;
  onFlashcards: (callback: (flashcards: FlashcardStore) => void) => void;
  onNewDayFlashcards: (callback: () => void) => void;
  onFlashcardConnectOpen: (callback: () => void) => void;
  onReviewFlashcardRequest: (callback: () => void) => void;
  
  // Language Data
  getLangData: () => void;
  onLangData: (callback: (data: LanguageData) => void) => void;
  installLanguage: (url: string) => void;
  onLanguageInstalled: (callback: (lang: string) => void) => void;
  onLanguageInstallError: (callback: (error: string) => void) => void;
  
  // Localization
  getLocalization: () => void;
  onLocalization: (callback: (data: { locale: string; strings: Record<string, unknown> }) => void) => void;
  changeUILanguage: (langCode: string) => void;
  
  // Window Management
  changeTrafficLights: (visibility: boolean) => void;
  resizeWindow: (size: { width: number; height: number }) => void;
  makePiP: (size: { width: number; height: number }) => void;
  unPiP: () => void;
  showCtxMenu: () => void;
  showContact: () => void;
  
  // App Control
  restartApp: () => void;
  forceRestartApp: () => void;
  getVersion: () => void;
  onVersionReceive: (callback: (version: string) => void) => void;
  
  // Server/Backend Status
  isLoaded: () => void;
  isSuccess: () => void;
  onServerLoad: (callback: (message: string) => void) => void;
  onServerStatusUpdate: (callback: (message: string) => void) => void;
  onServerCriticalError: (callback: (message: string) => void) => void;
  onOcrStatusUpdate: (callback: (message: string) => void) => void;
  
  // Python Installer
  startInstall: (options: InstallOptions) => void;
  requestInstallerState: () => void;
  onPythonSuccess: (callback: (success: boolean) => void) => void;
  onInstallStarted: (callback: (options: InstallOptions) => void) => void;
  onInstallerAwaitingChoice: (callback: () => void) => void;
  onInstallerNetworkError: (callback: (payload: { message: string; detail?: string }) => void) => void;
  onInstallerState: (callback: (state: InstallerState) => void) => void;
  
  // Clipboard & UI
  writeToClipboard: (text: string) => void;
  promptOutput: (text: string) => void;
  onOpenPrompt: (callback: (data: { title: string; message: string }) => void) => void;
  
  // Context Menu & UI Events
  onOpenSettings: (callback: (section?: string) => void) => void;
  onOpenAside: (callback: () => void) => void;
  onContextMenuCommand: (callback: (command: string) => void) => void;
  showReaderCtxMenu: (options: { furiganaHiderEnabled: boolean; hasContextPhrase: boolean }) => void;
  onReaderContextMenuCommand: (callback: (command: string) => void) => void;
  onOpenWordDbEditor: (callback: () => void) => void;
  onOpenKanjiGrid: (callback: () => void) => void;
  
  // Watch Together
  isWatchingTogether: () => void;
  watchTogetherSend: (message: unknown) => void;
  onWatchTogetherLaunch: (callback: (data: unknown) => void) => void;
  onWatchTogetherRequest: (callback: (data: unknown) => void) => void;
  
  // Pill/Word Updates (cross-window sync)
  onUpdatePills: (callback: (data: unknown) => void) => void;
  onUpdateWordAppearance: (callback: (data: unknown) => void) => void;
  onUpdateAttemptFlashcardCreation: (callback: (data: unknown) => void) => void;
  onUpdateCreateFlashcard: (callback: (data: unknown) => void) => void;
  onUpdateLastWatched: (callback: (data: unknown) => void) => void;
  
  // License (DRM)
  getLicenseType: () => void;
  activateLicense: (key: string) => void;
  removeLicense: () => void;
  onLicenseGet: (callback: (type: string) => void) => void;
  onLicenseActivated: (callback: (success: boolean) => void) => void;
  
  // Local Storage Sync
  sendLS: (data: Record<string, unknown>) => void;
  
  // Migration APIs
  getMigratedLocalStorage: () => Promise<Record<string, unknown> | null>;
  getMigratedItem: (key: string) => Promise<unknown>;
  hasMigrationOccurred: () => Promise<boolean>;
  triggerMigration: () => Promise<{ success: boolean; migratedKeys: string[]; error?: string }>;
  onLocalStorageMigrationComplete: (callback: (info: { occurred: boolean; backupPath: string | null }) => void) => void;
  onFlashcardMigrationComplete: (callback: (info: { occurred: boolean; backupPath: string | null; fromVersion: number | null }) => void) => void;
  getFlashcardMigrationInfo: () => void;
  
  // File Operations
  readDirectoryImages: (directoryPath: string) => Promise<{ files: Array<{ name: string; path: string; data: ArrayBuffer }> }>;
  readPdfFile: (filePath: string) => Promise<{ data: ArrayBuffer }>;
  selectVideoFile: () => Promise<string | null>;
  selectSubtitleFile: () => Promise<string | null>;
  selectBookFolder: () => Promise<string | null>;
  selectPdfFile: () => Promise<string | null>;
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

  // Generic IPC Methods
  send: (channel: string, data?: unknown) => void;
  on: (channel: string, callback: (...args: unknown[]) => void) => void;
  removeListener: (channel: string, callback: (...args: unknown[]) => void) => void;
  
  // Window Management
  openWindow: (payload: OpenWindowPayload) => void;
  closeWindow: () => void;
}

declare global {
  interface Window {
    mLearnIPC?: MLearnIPC;
  }
}

export {};
