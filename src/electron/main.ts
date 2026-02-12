/**
 * Electron Main Process Entry Point
 */

import { app, ipcMain, clipboard, shell } from 'electron';
import { findPython, terminatePythonBackend, setupPythonBackendIPC } from './services/pythonBackend';
import { startWebServer, stopWebServer } from './services/webServer';
import { setupFlashcardIPC } from './services/flashcardStorage';
import { setupSettingsIPC } from './services/settings';
import { setupLocalizationIPC } from './services/localization';
import { setupWindowIPC, createMainWindow, createWelcomeWindow } from './services/windowManager';
import { setupFileOperationsIPC } from './services/fileOperations';
import { setupMigrationIPC, migrateLocalStorage } from './services/localStorageMigration';
import { registerLocalMediaScheme, setupLocalMediaProtocol } from './services/localMediaProtocol';
import { IPC_CHANNELS } from '../shared/constants';
import { setupKillHandlers } from './services/processManager';

// Register custom protocol scheme before app is ready
registerLocalMediaScheme();

// Initialize IPC handlers (called once)
function setupBaseIPC(): void {
  ipcMain.on(IPC_CHANNELS.WRITE_TO_CLIPBOARD, (_event, text: string) => {
    clipboard.writeText(text);
  });

  ipcMain.on(IPC_CHANNELS.SHOW_CONTACT, () => {
    shell.openExternal('https://morisinc.net/');
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
  setupWindowIPC();
  setupPythonBackendIPC();
  setupFileOperationsIPC();
  setupMigrationIPC();
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
}

// Main initialization
async function initialize(): Promise<void> {
  // Setup all IPC handlers once
  setupAllIPC();

  // Set up custom protocol for serving local media files to renderer
  setupLocalMediaProtocol();

  // Perform localStorage migration before creating windows
  // This migrates data from the old app's file:// localStorage to file-based storage
  await migrateLocalStorage();

  // Create windows and start services
  await createAppWindows();
}

// App lifecycle
app.whenReady().then(() => {
  initialize();

  app.on('activate', () => {
    // On macOS, recreate window when dock icon is clicked
    const { BrowserWindow } = require('electron');
    if (BrowserWindow.getAllWindows().length === 0) {
      createAppWindows();
    }
  });
});

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
