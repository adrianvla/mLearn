/**
 * Data Export/Import Service
 * Handles exporting and importing all user data as a .zip archive
 *
 * Exported data includes:
 *  - canonical settings, flashcards, world, journals, and knowledge history
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
import { backup, DatabaseSync } from 'node:sqlite';
import { IPC_CHANNELS } from '../../shared/constants';
import { getUserDataPath } from '../utils/platform';
import { getLogger } from '../../shared/utils/logger';
import { guardianForWrites } from './guardian';

const log = getLogger('electron.dataExportImport');

/** All user data items to include in a full export */
const DATA_FILES = [
  'settings.json',
  'flashcards.json',
  'world.json',
  'kv-store.json',
  'knowledge-events.json',
  'knowledge-events.json.migrated',
  'voice-samples.json',
] as const;

const DATA_DIRECTORIES = [
  'flashcard-images',
  'flashcard-audio',
  'media-stats',
  'voice-samples',
  'journal',
  'flashcard-video',
] as const;
const KNOWLEDGE_DB = 'knowledge-history.sqlite3';

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

  const tempDir = fs.mkdtempSync(path.join(userDataPath, 'export-'));
  try {
    // SQLite's backup API includes committed WAL data in a standalone image.
    const dbFile = path.join(userDataPath, KNOWLEDGE_DB);
    if (fs.existsSync(dbFile)) {
      const db = new DatabaseSync(dbFile, { readOnly: true });
      try { await backup(db, path.join(tempDir, KNOWLEDGE_DB)); }
      finally { db.close(); }
      zip.addLocalFile(path.join(tempDir, KNOWLEDGE_DB));
    }

    for (const file of DATA_FILES) {
      const filePath = path.join(userDataPath, file);
      if (fs.existsSync(filePath)) zip.addLocalFile(filePath);
    }
    for (const dir of DATA_DIRECTORIES) {
      addDirectoryToZip(zip, path.join(userDataPath, dir), dir);
    }

    zip.writeZip(result.filePath);
  } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }
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
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();

  // Validate: the archive must contain at least one supported data file.
  const entryNames = entries.map(e => e.entryName);
  if (!entryNames.some((name) => (DATA_FILES as readonly string[]).includes(name) || name === KNOWLEDGE_DB)) {
    throw new Error('Invalid backup: archive contains no supported data files');
  }

  // Validate names before queueing. The archive is applied by Guardian on the
  // next launch, before services open files or migrations mutate the profile.
  for (const entry of entries) {
    const entryName = entry.entryName;

    // Security: prevent path traversal
    const normalized = path.normalize(entryName);
    if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
      throw new Error(`Unsafe import path: ${entryName}`);
    }

    // Only allow known files and directory prefixes
    const isKnownFile = (DATA_FILES as readonly string[]).includes(entryName) || entryName === KNOWLEDGE_DB;
    const isInKnownDir = (DATA_DIRECTORIES as readonly string[]).some(
      dir => entryName.startsWith(dir + '/')
    );

    if (!isKnownFile && !isInKnownDir) {
      log.warn(`[DataImport] Skipping unknown entry: ${entryName}`);
      continue;
    }

    if ((entry.header?.size ?? entry.getData().length) > 512 * 1024 * 1024) throw new Error('Import entry is too large');
  }
  const guardian = guardianForWrites();
  if (!guardian) throw new Error('Guardian is not ready to import data');
  guardian.queueImportArchive(zipPath);
  return true;
}

/**
 * Setup IPC handlers for data export/import
 */
export function setupDataExportImportIPC(): void {
  ipcMain.handle(IPC_CHANNELS.GUARDIAN_STATUS, async (): Promise<import('../../shared/guardian').ProtectionStatus> => {
    const guardian = guardianForWrites();
    if (!guardian) return { state: 'unavailable', recoveryPoints: 0 };
    const status = guardian.status;
    return { state: status.state, recoveryPoints: guardian.listRecoveryPoints().length,
      lastSnapshot: status.lastGoodSnapshot, reason: status.reason };
  });
  ipcMain.handle(IPC_CHANNELS.DATA_EXPORT, async () => {
    try {
      const filePath = await exportAllData();
      return { success: true, filePath };
    } catch (error) {
      log.error('[DataExportImport] Export failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.DATA_IMPORT, async () => {
    try {
      const imported = await importAllData();
      return { success: imported };
    } catch (error) {
      log.error('[DataExportImport] Import failed:', error);
      return { success: false, error: String(error) };
    }
  });
}
