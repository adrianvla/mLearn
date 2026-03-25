/**
 * LocalStorage Migration Service
 * 
 * Migrates localStorage data from the old app (which used file:// protocol)
 * to file-based storage in userData that works regardless of protocol.
 * 
 * The old app stored:
 * - knownAdjustment: Record<string, number> - word learning status
 * - recentlyWatched: Array - recent videos
 * - lastVideo: Object - last watched video info
 * - settings: Object - some renderer-side settings
 * - translationOverrides: Record<string, string> - user translation overrides
 */

import { BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { getUserDataPath } from '../utils/platform';
import { IPC_CHANNELS } from '../../shared/constants';

// Migration status
interface MigrationResult {
  success: boolean;
  migratedKeys: string[];
  error?: string;
}

// Storage for migrated data
interface MigratedLocalStorage {
  knownAdjustment?: Record<string, number>;
  recentlyWatched?: Array<{ name: string; screenshotUrl?: string }>;
  lastVideo?: { name: string; screenshotUrl?: string };
  translationOverrides?: Record<string, string>;
  videoTimestamps?: Record<string, number>;
  [key: string]: unknown;
}

// Path to the migration data file
function getMigrationDataPath(): string {
  return path.join(getUserDataPath(), 'localStorage_migration.json');
}

// Path to migration status file (tracks if migration was attempted)
function getMigrationStatusPath(): string {
  return path.join(getUserDataPath(), 'localStorage_migration_status.json');
}

/**
 * Check if migration has already been performed
 */
export function hasMigrationBeenAttempted(): boolean {
  const statusPath = getMigrationStatusPath();
  return fs.existsSync(statusPath);
}

/**
 * Mark migration as attempted
 */
function markMigrationAttempted(result: MigrationResult): void {
  const statusPath = getMigrationStatusPath();
  fs.writeFileSync(statusPath, JSON.stringify({
    attemptedAt: new Date().toISOString(),
    ...result,
  }, null, 2));
}

/**
 * Get migrated localStorage data
 */
export function getMigratedLocalStorage(): MigratedLocalStorage | null {
  const dataPath = getMigrationDataPath();
  if (fs.existsSync(dataPath)) {
    try {
      return JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    } catch (e) {
      console.error('Failed to read migrated localStorage:', e);
    }
  }
  return null;
}

/**
 * Get a specific item from migrated localStorage
 */
export function getMigratedItem<T = unknown>(key: string): T | null {
  const data = getMigratedLocalStorage();
  if (data && key in data) {
    return data[key] as T;
  }
  return null;
}

/**
 * Create a hidden window to access file:// localStorage
 * This is necessary because in dev mode we run on localhost which has different localStorage
 */
async function createMigrationWindow(): Promise<BrowserWindow> {
  const migrationWindow = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  // Create a minimal HTML file to load
  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head><title>Migration</title></head>
      <body>
        <script>
          // Gather all localStorage data
          const data = {};
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key) {
              try {
                const value = localStorage.getItem(key);
                if (value) {
                  try {
                    data[key] = JSON.parse(value);
                  } catch (e) {
                    console.error(e);
                    data[key] = value;
                  }
                }
              } catch (e) {
                console.warn('Failed to read key:', key);
              }
            }
          }
          // Store result for executeJavaScript to retrieve
          window.__migrationData = data;
        </script>
      </body>
    </html>
  `;

  // Write temporary HTML file
  const tempHtmlPath = path.join(getUserDataPath(), 'migration_temp.html');
  fs.writeFileSync(tempHtmlPath, htmlContent);

  // Load the file with file:// protocol to access the same localStorage as old app
  await migrationWindow.loadFile(tempHtmlPath);

  return migrationWindow;
}

/**
 * Extract localStorage from the migration window
 */
async function extractLocalStorage(window: BrowserWindow): Promise<Record<string, unknown>> {
  try {
    // Execute JavaScript to get the migration data
    const data = await window.webContents.executeJavaScript(`
      (function() {
        const data = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key) {
            try {
              const value = localStorage.getItem(key);
              if (value) {
                try {
                  data[key] = JSON.parse(value);
                } catch (e) {
                  console.error(e);
                  data[key] = value;
                }
              }
            } catch (e) {
              console.warn('Failed to read key:', key);
            }
          }
        }
        return data;
      })();
    `);
    
    return data || {};
  } catch (e) {
    console.error('Failed to extract localStorage:', e);
    return {};
  }
}

/**
 * Process and organize the raw localStorage data
 */
function processMigratedData(rawData: Record<string, unknown>): MigratedLocalStorage {
  const processed: MigratedLocalStorage = {};
  const videoTimestamps: Record<string, number> = {};

  for (const [key, value] of Object.entries(rawData)) {
    // Skip any backup keys we might have created
    if (key.startsWith('mlearn_v1_backup_') || key.startsWith('mlearn_')) {
      continue;
    }

    // Categorize the data
    if (key === 'knownAdjustment' && typeof value === 'object') {
      processed.knownAdjustment = value as Record<string, number>;
    } else if (key === 'recentlyWatched' && Array.isArray(value)) {
      processed.recentlyWatched = value;
    } else if (key === 'lastVideo' && typeof value === 'object') {
      processed.lastVideo = value as { name: string; screenshotUrl?: string };
    } else if (key === 'translationOverrides' && typeof value === 'object') {
      processed.translationOverrides = value as Record<string, string>;
    } else if (key.startsWith('videoCurrentTime_')) {
      const videoId = key.replace('videoCurrentTime_', '');
      if (typeof value === 'number') {
        videoTimestamps[videoId] = value;
      }
    } else {
      // Store other keys as-is
      processed[key] = value;
    }
  }

  if (Object.keys(videoTimestamps).length > 0) {
    processed.videoTimestamps = videoTimestamps;
  }

  return processed;
}

/**
 * Perform the localStorage migration
 */
export async function migrateLocalStorage(): Promise<MigrationResult> {
  console.log('[Migration] Starting localStorage migration...');
  
  // Check if already migrated
  if (hasMigrationBeenAttempted()) {
    console.log('[Migration] Migration already attempted, skipping.');
    return {
      success: true,
      migratedKeys: [],
    };
  }

  let migrationWindow: BrowserWindow | null = null;
  
  try {
    // Create hidden window to access file:// localStorage
    migrationWindow = await createMigrationWindow();
    
    // Wait a moment for page to load
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Extract localStorage
    const rawData = await extractLocalStorage(migrationWindow);
    
    console.log('[Migration] Found localStorage keys:', Object.keys(rawData));
    
    if (Object.keys(rawData).length === 0) {
      console.log('[Migration] No localStorage data found to migrate.');
      const result: MigrationResult = {
        success: true,
        migratedKeys: [],
      };
      markMigrationAttempted(result);
      return result;
    }

    // Process the data
    const processedData = processMigratedData(rawData);
    
    // Save to file
    const dataPath = getMigrationDataPath();
    fs.writeFileSync(dataPath, JSON.stringify(processedData, null, 2));
    
    const migratedKeys = Object.keys(processedData);
    console.log('[Migration] Successfully migrated keys:', migratedKeys);
    
    const result: MigrationResult = {
      success: true,
      migratedKeys,
    };
    
    markMigrationAttempted(result);
    
    return result;
  } catch (error) {
    console.error('[Migration] Migration failed:', error);
    const result: MigrationResult = {
      success: false,
      migratedKeys: [],
      error: String(error),
    };
    markMigrationAttempted(result);
    return result;
  } finally {
    // Clean up
    if (migrationWindow && !migrationWindow.isDestroyed()) {
      migrationWindow.destroy();
    }
    
    // Remove temp HTML file
    const tempHtmlPath = path.join(getUserDataPath(), 'migration_temp.html');
    if (fs.existsSync(tempHtmlPath)) {
      fs.unlinkSync(tempHtmlPath);
    }
  }
}

/**
 * Get knownAdjustment data (word statuses) from migration
 */
export function getKnownAdjustmentFromMigration(): Record<string, number> | null {
  return getMigratedItem<Record<string, number>>('knownAdjustment');
}

/**
 * Setup IPC handlers for migration
 */
export function setupMigrationIPC(): void {
  // Get migrated localStorage data
  ipcMain.handle(IPC_CHANNELS.GET_MIGRATED_LOCALSTORAGE, async () => {
    return getMigratedLocalStorage();
  });

  // Get specific migrated item
  ipcMain.handle(IPC_CHANNELS.GET_MIGRATED_ITEM, async (_event, key: string) => {
    return getMigratedItem(key);
  });

  // Check if migration has been performed
  ipcMain.handle(IPC_CHANNELS.HAS_MIGRATION_OCCURRED, async () => {
    return hasMigrationBeenAttempted();
  });

  // Trigger manual migration (useful for testing or re-migration)
  ipcMain.handle(IPC_CHANNELS.TRIGGER_MIGRATION, async () => {
    // Remove status file to allow re-migration
    const statusPath = getMigrationStatusPath();
    if (fs.existsSync(statusPath)) {
      fs.unlinkSync(statusPath);
    }
    return migrateLocalStorage();
  });
}
