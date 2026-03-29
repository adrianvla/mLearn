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
import { setupSettingsIPC } from './services/settings';
import { setupLocalizationIPC } from './services/localization';
import { setupWindowIPC, createMainWindow, createWelcomeWindow } from './services/windowManager';
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
import { initPluginManager } from './services/pluginManager';
import { setupPluginIPC } from './services/pluginIPC';
import { IPC_CHANNELS } from '../shared/constants';
import { setupKillHandlers } from './services/processManager';

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
    console.error(e);
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
    console.error(e);
    return null;
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
  }
}

function handleDeepLinkArgs(args: string[]): void {
  for (const arg of args) {
    if (arg.startsWith('mlearn://')) {
      handlePossibleDeepLinkValue(arg);
    }
  }
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
      console.warn(
        `Could not raise kern.maxfiles (needs root). If OCR fails, run: ` +
        `sudo sysctl -w kern.maxfiles=524288 kern.maxfilesperproc=524288`,
      );
    }
  } else if (process.platform === 'linux') {
    try {
      await execAsync('sysctl -w fs.file-max=524288', { timeout: 2000 });
    } catch (e) {
      console.error(e);
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
}

// Track whether IPC handlers have been registered
let ipcInitialized = false;

// Register all IPC handlers (only once)
function setupAllIPC(): void {
  if (ipcInitialized) return;
  ipcInitialized = true;

  setupBaseIPC();
  setupSettingsIPC();
  setupLocalizationIPC();
  setupFlashcardIPC();
  setupFlashcardImageIPC();
  setupFlashcardTtsIPC();
  setupFlashcardVideoIPC();
  setupWindowIPC();
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
  setupPluginIPC();
  setupKillHandlers();
}

// Create windows and start services
async function createAppWindows(): Promise<void> {
  // Start Python backend
  const pythonFound = await findPython();
  
  // Create appropriate window FIRST so it can receive error messages
  if (!pythonFound) {
    createWelcomeWindow();
  } else {
    createMainWindow();
  }

  // Start web server for tethered mode AFTER window is created
  // This ensures any errors (like EADDRINUSE) can be displayed to the user
  startWebServer();
  flushQueuedAuthDeepLinks();
  flushQueuedLookupDeepLinks();
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

  if (!app.isDefaultProtocolClient('mlearn')) {
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
      // On macOS, recreate window when dock icon is clicked
      const { BrowserWindow } = require('electron');
      if (BrowserWindow.getAllWindows().length === 0) {
        createAppWindows();
      }
    });
  });
}

app.on('before-quit', () => {
  console.log('App before-quit: terminating Python backend');
  terminatePythonBackend();
});

app.on('quit', () => {
  console.log('App quit: cleanup');
  stopWebServer();
  terminatePythonBackend();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    terminatePythonBackend();
    app.quit();
  }
});
