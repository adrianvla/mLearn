/**
 * Electron Main Process Entry Point
 */

import { app, ipcMain, clipboard, shell } from 'electron';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { findPython, terminatePythonBackend, setupPythonBackendIPC } from './services/pythonBackend';
import { startWebServer, stopWebServer } from './services/webServer';
import { setupFlashcardIPC } from './services/flashcardStorage';
import { setupFlashcardImageIPC, registerFlashcardImageScheme, setupFlashcardImageProtocol } from './services/flashcardImageStorage';
import { setupFlashcardTtsIPC, registerFlashcardAudioScheme, setupFlashcardAudioProtocol } from './services/flashcardTtsStorage';
import { setupFlashcardVideoIPC, registerFlashcardVideoScheme, setupFlashcardVideoProtocol } from './services/flashcardVideoStorage';
import { hasExistingProfile, setupSettingsIPC } from './services/settings';
import { setupLoggingService } from './services/loggingService';
import { setupLocalizationIPC } from './services/localization';
import { setupWindowIPC, createMainWindow, createWelcomeWindow, createDiagnosticsWindow } from './services/windowManager';
import { initOverlaySiteState, registerOverlaySiteStateIPC } from './services/overlaySiteState';
import { getExtensionDistDir } from './utils/platform';
import { setupFileOperationsIPC } from './services/fileOperations';
import { setupMigrationIPC, migrateLocalStorage } from './services/localStorageMigration';
import { registerLocalMediaScheme, registerPluginUiScheme, setupLocalMediaProtocol, setupPluginUiProtocol } from './services/localMediaProtocol';
import { setupMediaStatsIPC } from './services/mediaStatsStorage';
import { setupOllamaIPC } from './services/ollamaService';
import { setupBuiltinLLMIPC } from './services/builtinLLMService';
import { setupLLMRouterIPC } from './services/llmRouter';
import { setupSpeechIPC } from './services/speechService';
import { setupVoiceIPC } from './services/voiceService';
import { setupDataExportImportIPC } from './services/dataExportImport';
import { setupKVStoreIPC } from './services/kvStore';
import { setupBrowserDetectionIPC } from './services/browserDetection';
import { setupExtensionInstallerIPC } from './services/extensionInstaller';
import { initPluginManager } from './services/pluginManager';
import { setupPluginIPC } from './services/pluginIPC';
import { setupDiagnosticsIPC } from './services/diagnostics';
import { createTray, destroyTray } from './services/trayManager';
import { IPC_CHANNELS } from '../shared/constants';
import { setupKillHandlers } from './services/processManager';
import { getLogger } from '../shared/utils/logger';

const log = getLogger('electron.main');
let appWindowCreationPromise: Promise<void> | null = null;

interface AuthDeepLinkPayload {
  code: string | null;
  state: string | null;
  error: string | null;
}

const queuedAuthDeepLinks: AuthDeepLinkPayload[] = [];
const queuedLookupWords: string[] = [];

function parseAuthDeepLink(rawUrl: string): AuthDeepLinkPayload | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'mlearn:') {
      return null;
    }
    const path = `${parsed.hostname}${parsed.pathname}`;
    if (path !== 'auth/callback') {
      return null;
    }
    return {
      code: parsed.searchParams.get('code'),
      state: parsed.searchParams.get('state'),
      error: parsed.searchParams.get('error'),
    };
  } catch (e) {
    log.error('parseAuthDeepLink failed', e);
    return null;
  }
}

function parseLookupDeepLink(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'mlearn:') {
      return null;
    }
    if (parsed.hostname !== 'lookup') {
      return null;
    }
    const word = parsed.searchParams.get('word');
    return word && word.trim() ? word.trim() : null;
  } catch (e) {
    log.error('parseLookupDeepLink failed', e);
    return null;
  }
}

function isDiagnosticsDeepLink(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'mlearn:' && parsed.hostname === 'diagnostics';
  } catch {
    return false;
  }
}

function dispatchAuthDeepLink(payload: AuthDeepLinkPayload): void {
  const { BrowserWindow } = require('electron');
  const windows = BrowserWindow.getAllWindows();
  if (windows.length === 0) {
    queuedAuthDeepLinks.push(payload);
    return;
  }
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.AUTH_DEEP_LINK, payload);
    }
  }
}

function dispatchLookupDeepLink(word: string): void {
  const { BrowserWindow } = require('electron');
  const windows = BrowserWindow.getAllWindows();
  if (windows.length === 0) {
    queuedLookupWords.push(word);
    return;
  }
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.LOOKUP_DEEP_LINK, word);
      return;
    }
  }
}

function flushQueuedAuthDeepLinks(): void {
  if (queuedAuthDeepLinks.length === 0) {
    return;
  }
  const queue = queuedAuthDeepLinks.splice(0, queuedAuthDeepLinks.length);
  for (const payload of queue) {
    dispatchAuthDeepLink(payload);
  }
}

function flushQueuedLookupDeepLinks(): void {
  if (queuedLookupWords.length === 0) {
    return;
  }
  const queue = queuedLookupWords.splice(0, queuedLookupWords.length);
  for (const word of queue) {
    dispatchLookupDeepLink(word);
  }
}

function handlePossibleDeepLinkValue(value: string): void {
  const authPayload = parseAuthDeepLink(value);
  if (authPayload) {
    dispatchAuthDeepLink(authPayload);
    return;
  }
  const lookupWord = parseLookupDeepLink(value);
  if (lookupWord) {
    dispatchLookupDeepLink(lookupWord);
    return;
  }
  if (isDiagnosticsDeepLink(value)) {
    createDiagnosticsWindow();
    return;
  }
}

function handleDeepLinkArgs(args: string[]): void {
  for (const arg of args) {
    if (arg.startsWith('mlearn://')) {
      handlePossibleDeepLinkValue(arg);
    }
  }
}

function focusExistingAppWindow(): boolean {
  const { BrowserWindow } = require('electron');
  const allWindows = BrowserWindow.getAllWindows();
  const win = allWindows.find((candidate: Electron.BrowserWindow) => !candidate.isDestroyed());
  if (!win) return false;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  return true;
}

const execAsync = promisify(exec);

async function raiseFileDescriptorLimits(): Promise<void> {
  if (process.platform === 'darwin') {
    const TARGET_MAXFILES = 524288;
    try {
      const { stdout } = await execAsync('sysctl -n kern.maxfiles', { timeout: 2000 });
      const current = parseInt(stdout.trim(), 10);
      if (!isNaN(current) && current < TARGET_MAXFILES) {
        await execAsync(
          `sysctl -w kern.maxfiles=${TARGET_MAXFILES} kern.maxfilesperproc=${TARGET_MAXFILES}`,
          { timeout: 2000 },
        );
      }
    } catch {
      log.warn(
        `Could not raise kern.maxfiles (needs root). If OCR fails, run: ` +
        `sudo sysctl -w kern.maxfiles=524288 kern.maxfilesperproc=524288`,
      );
    }
  } else if (process.platform === 'linux') {
    try {
      await execAsync('sysctl -w fs.file-max=524288', { timeout: 2000 });
    } catch (e) {
      log.error('Failed to raise fs.file-max', e);
    }
  }
}

// Register custom protocol schemes before app is ready
registerLocalMediaScheme();
registerPluginUiScheme();
registerFlashcardImageScheme();
registerFlashcardAudioScheme();
registerFlashcardVideoScheme();

// Initialize IPC handlers (called once)
function setupBaseIPC(): void {
  ipcMain.on(IPC_CHANNELS.WRITE_TO_CLIPBOARD, (_event, text: string) => {
    clipboard.writeText(text);
  });

  ipcMain.on(IPC_CHANNELS.SHOW_CONTACT, () => {
    shell.openExternal('https://mlearn.kikan.net/');
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_EXTERNAL_URL, async (_event, url: string) => {
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
      throw new Error('Only http/https URLs can be opened');
    }
    await shell.openExternal(url);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_EXTENSION_FOLDER, async () => {
    const extensionDir = getExtensionDistDir();
    log.info(`Opening extension folder: ${extensionDir}`);

    try {
      const fs = await import('fs');
      const stats = await fs.promises.stat(extensionDir);
      if (!stats.isDirectory()) {
        log.error(`Extension path is not a directory: ${extensionDir}`);
        return false;
      }
    } catch (e) {
      log.error(`Extension folder does not exist: ${extensionDir}`, e);
      return false;
    }

    try {
      const result = await shell.openPath(extensionDir);
      if (result !== '') {
        log.warn(`shell.openPath returned error: ${result}`);
        const platform = process.platform;
        if (platform === 'darwin') {
          await promisify(exec)(`open "${extensionDir}"`);
        } else if (platform === 'win32') {
          await promisify(exec)(`explorer "${extensionDir}"`);
        } else {
          await promisify(exec)(`xdg-open "${extensionDir}"`);
        }
      }
      return true;
    } catch (e) {
      log.error('Failed to open extension folder:', e);
      return false;
    }
  });
}

// Track whether IPC handlers have been registered
let ipcInitialized = false;

// Register all IPC handlers (only once)
function setupAllIPC(): void {
  if (ipcInitialized) return;
  ipcInitialized = true;

  setupBaseIPC();
  setupLoggingService();
  setupSettingsIPC();
  setupLocalizationIPC();
  setupFlashcardIPC();
  setupFlashcardImageIPC();
  setupFlashcardTtsIPC();
  setupFlashcardVideoIPC();
  setupWindowIPC();
  registerOverlaySiteStateIPC();
  initOverlaySiteState();
  setupPluginUiProtocol();
  setupPythonBackendIPC();
  setupFileOperationsIPC();
  setupMigrationIPC();
  setupMediaStatsIPC();
  setupOllamaIPC();
  setupBuiltinLLMIPC();
  setupLLMRouterIPC();
  setupSpeechIPC();
  setupVoiceIPC();
  setupDataExportImportIPC();
  setupKVStoreIPC();
  setupBrowserDetectionIPC();
  setupExtensionInstallerIPC();
  setupPluginIPC();
  setupDiagnosticsIPC();
  setupKillHandlers();
}

// Create windows and start services
async function createAppWindows(): Promise<void> {
  if (appWindowCreationPromise) {
    await appWindowCreationPromise;
    return;
  }

  appWindowCreationPromise = (async () => {
  // Check for diagnostics mode
  const isDiagnosticsMode = process.argv.includes('--diagnostics');
  if (isDiagnosticsMode) {
    createDiagnosticsWindow();
    startWebServer();
    return;
  }

  if (hasExistingProfile()) {
    createMainWindow();
  } else {
    createWelcomeWindow();
  }

  await findPython();

  // Start web server for tethered mode AFTER window is created
  // This ensures any errors (like EADDRINUSE) can be displayed to the user
  startWebServer();
  flushQueuedAuthDeepLinks();
  flushQueuedLookupDeepLinks();
  })();

  try {
    await appWindowCreationPromise;
  } finally {
    appWindowCreationPromise = null;
  }
}

// Main initialization
async function initialize(): Promise<void> {
  await raiseFileDescriptorLimits();

  setupAllIPC();
  await initPluginManager();

  // Set up custom protocols for serving local files to renderer
  setupLocalMediaProtocol();
  setupFlashcardImageProtocol();
  setupFlashcardAudioProtocol();
  setupFlashcardVideoProtocol();

  // Perform localStorage migration before creating windows
  // This migrates data from the old app's file:// localStorage to file-based storage
  await migrateLocalStorage();

  // Create windows and start services
  await createAppWindows();

  const { getMainWindow } = require('./services/windowManager');
  const mainWindow = getMainWindow();
  if (mainWindow) {
    createTray(mainWindow);
  }

  if (app.isPackaged && !app.isDefaultProtocolClient('mlearn')) {
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('mlearn', process.execPath, [path.resolve(process.argv[1])]);
    } else {
      app.setAsDefaultProtocolClient('mlearn');
    }
  }
}

// App lifecycle
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    handleDeepLinkArgs(commandLine);
    focusExistingAppWindow();
  });

  app.on('open-url', (event, rawUrl) => {
    event.preventDefault();
    handlePossibleDeepLinkValue(rawUrl);
  });

  app.whenReady().then(() => {
    if (process.platform !== 'darwin') {
      handleDeepLinkArgs(process.argv);
    }

    void initialize();

    app.on('activate', () => {
      if (!focusExistingAppWindow()) {
        void createAppWindows();
      }
    });
  });
}

app.on('before-quit', () => {
  log.info('App before-quit: setting isQuitting flag, cleaning up');
  (app as any).isQuitting = true;
  destroyTray();
  terminatePythonBackend();
});

app.on('quit', () => {
  log.info('App quit: cleanup');
  stopWebServer();
  terminatePythonBackend();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    const { hasTray } = require('./services/trayManager');
    if (hasTray()) {
      return;
    }
    terminatePythonBackend();
    app.quit();
  }
});
