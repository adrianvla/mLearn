/**
 * Process Manager Service
 * Handles application restart and kill operations
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { terminatePythonBackend, isServerLoaded, restartPythonBackend } from './pythonBackend';
import { createMainWindow } from './windowManager';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger('electron.processManager');

// Restart the application
export function restartApp(): void {
  if (!isServerLoaded()) return;
  
  terminatePythonBackend();
  log.info('Restarting app');
  
  setTimeout(() => {
    app.relaunch();
    app.exit();
  }, 1000);
}

// Force restart without checking server status
export function forceRestartApp(): void {
  if (process.env.NODE_ENV === 'development') {
    log.info('Reloading app runtime without exiting development services');
    restartPythonBackend();
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.reloadIgnoringCache();
      }
    }
    return;
  }

  terminatePythonBackend();
  log.info('Force restarting app');
  
  setTimeout(() => {
    app.relaunch();
    app.exit();
  }, 1000);
}

/**
 * Finish first-run setup without relaunching Electron. The main renderer gets
 * a fresh settings context while only the backend restarts for new language data.
 */
export function completeInitialSetup(): void {
  log.info('Completing initial setup without relaunching app');
  restartPythonBackend();
  createMainWindow();
}

// Setup IPC handlers
export function setupKillHandlers(): void {
  ipcMain.on(IPC_CHANNELS.RESTART_APP, () => {
    restartApp();
  });

  ipcMain.on(IPC_CHANNELS.RESTART_APP_FORCE, () => {
    forceRestartApp();
  });

  ipcMain.on(IPC_CHANNELS.COMPLETE_INITIAL_SETUP, () => {
    completeInitialSetup();
  });
}
