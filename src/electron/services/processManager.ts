/**
 * Process Manager Service
 * Handles application restart and kill operations
 */

import { app, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { terminatePythonBackend, isServerLoaded } from './pythonBackend';

// Restart the application
export function restartApp(): void {
  if (!isServerLoaded()) return;
  
  terminatePythonBackend();
  console.log('Restarting app');
  
  setTimeout(() => {
    app.relaunch();
    app.exit();
  }, 1000);
}

// Force restart without checking server status
export function forceRestartApp(): void {
  terminatePythonBackend();
  console.log('Force restarting app');
  
  setTimeout(() => {
    app.relaunch();
    app.exit();
  }, 1000);
}

// Setup IPC handlers
export function setupKillHandlers(): void {
  ipcMain.on(IPC_CHANNELS.RESTART_APP, () => {
    restartApp();
  });

  ipcMain.on(IPC_CHANNELS.RESTART_APP_FORCE, () => {
    forceRestartApp();
  });
}
