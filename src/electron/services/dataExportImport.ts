/**
 * Data Export/Import Service
 * Handles exporting and importing all user data as a .zip archive
 *
 * Exported data includes:
 *  - settings.json
 *  - flashcards.json
 *  - flashcard-images/ (directory)
 *  - flashcard-audio/ (directory with .ogg + .meta.json)
 *  - media-stats/ (directory of per-media JSON files)
 *  - voice-samples/ (directory of audio files)
 *  - voice-samples.json (manifest)
 */

import { ipcMain, dialog, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { IPC_CHANNELS } from '../../shared/constants';
import { getUserDataPath } from '../utils/platform';

/** All user data items to include in a full export */
const DATA_FILES = [
  'settings.json',
  'flashcards.json',
  'voice-samples.json',
] as const;

const DATA_DIRECTORIES = [
  'flashcard-images',
  'flashcard-audio',
  'media-stats',
  'voice-samples',
] as const;

/**
 * Add all files from a directory recursively to the zip under a given prefix
 */
function addDirectoryToZip(zip: AdmZip, dirPath: string, zipPrefix: string): void {
  if (!fs.existsSync(dirPath)) return;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const zipPath = zipPrefix + '/';
    if (entry.isFile()) {
      zip.addLocalFile(fullPath, zipPath);
    } else if (entry.isDirectory()) {
      addDirectoryToZip(zip, fullPath, zipPrefix + '/' + entry.name);
    }
  }
}

/**
 * Export all user data to a .zip archive
 * Returns the file path where the archive was saved, or null if cancelled
 */
async function exportAllData(): Promise<string | null> {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  const defaultName = `mlearn-backup-${new Date().toISOString().split('T')[0]}.zip`;

  const result = await dialog.showSaveDialog({
    ...(focusedWindow ? { browserWindow: focusedWindow } : {}),
    title: 'Export All Data',
    defaultPath: defaultName,
    filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
  } as Electron.SaveDialogOptions);

  if (result.canceled || !result.filePath) return null;

  const userDataPath = getUserDataPath();
  const zip = new AdmZip();

  // Add individual data files
  for (const file of DATA_FILES) {
    const filePath = path.join(userDataPath, file);
    if (fs.existsSync(filePath)) {
      zip.addLocalFile(filePath);
    }
  }

  // Add data directories
  for (const dir of DATA_DIRECTORIES) {
    const dirPath = path.join(userDataPath, dir);
    addDirectoryToZip(zip, dirPath, dir);
  }

  zip.writeZip(result.filePath);
  return result.filePath;
}

/**
 * Import all user data from a .zip archive
 * Returns true if successful, false if cancelled, throws on error
 */
async function importAllData(): Promise<boolean> {
  const focusedWindow = BrowserWindow.getFocusedWindow();

  const result = await dialog.showOpenDialog({
    ...(focusedWindow ? { browserWindow: focusedWindow } : {}),
    title: 'Import All Data',
    filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
    properties: ['openFile'],
  } as Electron.OpenDialogOptions);

  if (result.canceled || !result.filePaths.length) return false;

  const zipPath = result.filePaths[0];
  const userDataPath = getUserDataPath();

  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();

  // Validate: must contain at least settings.json or flashcards.json
  const entryNames = entries.map(e => e.entryName);
  const hasSettings = entryNames.includes('settings.json');
  const hasFlashcards = entryNames.includes('flashcards.json');

  if (!hasSettings && !hasFlashcards) {
    throw new Error('Invalid backup: archive must contain settings.json or flashcards.json');
  }

  // Extract all entries
  for (const entry of entries) {
    const entryName = entry.entryName;

    // Security: prevent path traversal
    const normalized = path.normalize(entryName);
    if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
      console.warn(`[DataImport] Skipping suspicious entry: ${entryName}`);
      continue;
    }

    // Only allow known files and directory prefixes
    const isKnownFile = (DATA_FILES as readonly string[]).includes(entryName);
    const isInKnownDir = (DATA_DIRECTORIES as readonly string[]).some(
      dir => entryName.startsWith(dir + '/')
    );

    if (!isKnownFile && !isInKnownDir) {
      console.warn(`[DataImport] Skipping unknown entry: ${entryName}`);
      continue;
    }

    if (entry.isDirectory) {
      const dirPath = path.join(userDataPath, entryName);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
    } else {
      const targetPath = path.join(userDataPath, entryName);
      const targetDir = path.dirname(targetPath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      fs.writeFileSync(targetPath, entry.getData());
    }
  }

  return true;
}

/**
 * Setup IPC handlers for data export/import
 */
export function setupDataExportImportIPC(): void {
  ipcMain.handle(IPC_CHANNELS.DATA_EXPORT, async () => {
    try {
      const filePath = await exportAllData();
      return { success: true, filePath };
    } catch (error) {
      console.error('[DataExportImport] Export failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.DATA_IMPORT, async () => {
    try {
      const imported = await importAllData();
      return { success: imported };
    } catch (error) {
      console.error('[DataExportImport] Import failed:', error);
      return { success: false, error: String(error) };
    }
  });
}
