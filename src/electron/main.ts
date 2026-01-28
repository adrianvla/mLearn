/**
 * Electron Main Process Entry Point
 */

import { app, ipcMain, clipboard, shell } from 'electron';
import { findPython, terminatePythonBackend, setupPythonBackendIPC } from './services/pythonBackend';
import { startWebServer, stopWebServer } from './services/webServer';
import { setupFlashcardIPC } from './services/flashcardStorage';
import { setupSettingsIPC } from './services/settings';
import { setupWindowIPC, createMainWindow, createWelcomeWindow } from './services/windowManager';
import { setupFileOperationsIPC } from './services/fileOperations';
import { IPC_CHANNELS } from '../shared/constants';
import { setupKillHandlers } from './services/processManager';

// Initialize IPC handlers
function setupBaseIPC(): void {
  ipcMain.on(IPC_CHANNELS.WRITE_TO_CLIPBOARD, (_event, text: string) => {
    clipboard.writeText(text);
  });

  ipcMain.on(IPC_CHANNELS.SHOW_CONTACT, () => {
    shell.openExternal('https://morisinc.net/');
  });
}

// Main initialization
async function initialize(): Promise<void> {
  // Setup all IPC handlers
  setupBaseIPC();
  setupSettingsIPC();
  setupFlashcardIPC();
  setupWindowIPC();
  setupPythonBackendIPC();
  setupFileOperationsIPC();
  setupKillHandlers();

  // Start Python backend
  const pythonFound = await findPython();
  
  // Start web server for tethered mode
  startWebServer();

  // Create appropriate window
  if (!pythonFound) {
    createWelcomeWindow();
  } else {
    createMainWindow();
  }
}

// App lifecycle
app.whenReady().then(() => {
  initialize();

  app.on('activate', () => {
    // On macOS, recreate window when dock icon is clicked
    const { BrowserWindow } = require('electron');
    if (BrowserWindow.getAllWindows().length === 0) {
      initialize();
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
