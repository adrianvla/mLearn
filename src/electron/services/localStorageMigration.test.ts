import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { createTempDir, type TempDir } from '../../../test/helpers/tempDir';

interface MockWebContents {
  send: Mock;
  isDestroyed: Mock;
  isLoading: Mock;
  executeJavaScript: Mock;
  once: Mock;
  on: Mock;
  openDevTools: Mock;
  id: number;
}

interface MockWindowInstance {
  webContents: MockWebContents;
  loadURL: Mock;
  loadFile: Mock;
  show: Mock;
  hide: Mock;
  close: Mock;
  destroy: Mock;
  focus: Mock;
  isDestroyed: Mock;
  isVisible: Mock;
  isMinimized: Mock;
  isFocused: Mock;
  minimize: Mock;
  maximize: Mock;
  restore: Mock;
  on: Mock;
  once: Mock;
  removeAllListeners: Mock;
  id: number;
}

function createMockWebContents(id = 1): MockWebContents {
  return {
    send: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isLoading: vi.fn(() => false),
    executeJavaScript: vi.fn(() => Promise.resolve({})),
    once: vi.fn(),
    on: vi.fn(),
    openDevTools: vi.fn(),
    id,
  };
}

function createMockWindow(id = 1): MockWindowInstance {
  return {
    webContents: createMockWebContents(id),
    loadURL: vi.fn(() => Promise.resolve()),
    loadFile: vi.fn(() => Promise.resolve()),
    show: vi.fn(),
    hide: vi.fn(),
    close: vi.fn(),
    destroy: vi.fn(),
    focus: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => true),
    isMinimized: vi.fn(() => false),
    isFocused: vi.fn(() => true),
    minimize: vi.fn(),
    maximize: vi.fn(),
    restore: vi.fn(),
    on: vi.fn().mockReturnThis(),
    once: vi.fn().mockReturnThis(),
    removeAllListeners: vi.fn().mockReturnThis(),
    id,
  };
}

const mockIpcHandlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();

let tempDir: TempDir;
let mockBrowserWindowInstances: MockWindowInstance[] = [];
let nextWindowImpl: (() => MockWindowInstance) | null = null;

const MockBrowserWindowClass = vi.fn(function (this: MockWindowInstance) {
  const win = nextWindowImpl ? nextWindowImpl() : createMockWindow(mockBrowserWindowInstances.length + 1);
  nextWindowImpl = null;
  Object.assign(this, win);
  mockBrowserWindowInstances.push(this);
  return this;
});

(MockBrowserWindowClass as unknown as { getAllWindows: Mock }).getAllWindows = vi.fn(() => mockBrowserWindowInstances);

const mockIpcMain = {
  handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
    mockIpcHandlers.set(channel, handler);
  }),
  on: vi.fn(),
  removeHandler: vi.fn(),
};

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  BrowserWindow: MockBrowserWindowClass,
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return tempDir?.tmpDir ?? '/tmp/test';
      return '/tmp';
    }),
    isPackaged: false,
    on: vi.fn(),
  },
}));

vi.mock('../utils/platform', () => ({
  getUserDataPath: vi.fn(() => tempDir?.tmpDir ?? '/tmp/test'),
  getAppPath: vi.fn(() => tempDir?.tmpDir ?? '/tmp/test'),
  getResourcePath: vi.fn(() => tempDir?.tmpDir ?? '/tmp/test'),
  isMac: false,
  isWindows: false,
  isLinux: true,
}));

describe('localStorageMigration', () => {
  beforeEach(async () => {
    tempDir = createTempDir('migration-test-');
    mockIpcHandlers.clear();
    mockBrowserWindowInstances = [];
    nextWindowImpl = null;
    vi.resetModules();
  });

  afterEach(() => {
    tempDir.cleanup();
  });

  describe('hasMigrationBeenAttempted', () => {
    it('returns false when no status file exists', async () => {
      const { hasMigrationBeenAttempted } = await import('./localStorageMigration');

      expect(hasMigrationBeenAttempted()).toBe(false);
    });

    it('returns true when status file exists', async () => {
      const statusPath = path.join(tempDir.tmpDir, 'localStorage_migration_status.json');
      fs.writeFileSync(statusPath, JSON.stringify({ success: true, migratedKeys: [] }));

      const { hasMigrationBeenAttempted } = await import('./localStorageMigration');

      expect(hasMigrationBeenAttempted()).toBe(true);
    });

    it('returns true even for a failed migration status file', async () => {
      const statusPath = path.join(tempDir.tmpDir, 'localStorage_migration_status.json');
      fs.writeFileSync(statusPath, JSON.stringify({ success: false, error: 'failed', migratedKeys: [] }));

      const { hasMigrationBeenAttempted } = await import('./localStorageMigration');

      expect(hasMigrationBeenAttempted()).toBe(true);
    });
  });

  describe('getMigratedLocalStorage', () => {
    it('returns null when no migration data file exists', async () => {
      const { getMigratedLocalStorage } = await import('./localStorageMigration');

      expect(getMigratedLocalStorage()).toBeNull();
    });

    it('returns parsed data when migration data file exists', async () => {
      const dataPath = path.join(tempDir.tmpDir, 'localStorage_migration.json');
      const data = { knownAdjustment: { word1: 1, word2: -1 }, recentlyWatched: [] };
      fs.writeFileSync(dataPath, JSON.stringify(data));

      const { getMigratedLocalStorage } = await import('./localStorageMigration');

      expect(getMigratedLocalStorage()).toEqual(data);
    });

    it('returns null for corrupt migration data file', async () => {
      const dataPath = path.join(tempDir.tmpDir, 'localStorage_migration.json');
      fs.writeFileSync(dataPath, 'not-valid-json{{{{');

      const { getMigratedLocalStorage } = await import('./localStorageMigration');

      expect(getMigratedLocalStorage()).toBeNull();
    });

    it('returns full data with all fields', async () => {
      const dataPath = path.join(tempDir.tmpDir, 'localStorage_migration.json');
      const data = {
        knownAdjustment: { hello: 2 },
        recentlyWatched: [{ name: 'video.mp4' }],
        lastVideo: { name: 'video.mp4' },
        translationOverrides: { 猫: 'cat' },
        videoTimestamps: { 'video.mp4': 120 },
      };
      fs.writeFileSync(dataPath, JSON.stringify(data));

      const { getMigratedLocalStorage } = await import('./localStorageMigration');

      expect(getMigratedLocalStorage()).toEqual(data);
    });
  });

  describe('getMigratedItem', () => {
    it('returns null when no migration data exists', async () => {
      const { getMigratedItem } = await import('./localStorageMigration');

      expect(getMigratedItem('knownAdjustment')).toBeNull();
    });

    it('returns specific item by key', async () => {
      const dataPath = path.join(tempDir.tmpDir, 'localStorage_migration.json');
      const adjustment = { word1: 2, word2: -1 };
      fs.writeFileSync(dataPath, JSON.stringify({ knownAdjustment: adjustment, other: 'value' }));

      const { getMigratedItem } = await import('./localStorageMigration');

      expect(getMigratedItem('knownAdjustment')).toEqual(adjustment);
    });

    it('returns null for a key that does not exist in migrated data', async () => {
      const dataPath = path.join(tempDir.tmpDir, 'localStorage_migration.json');
      fs.writeFileSync(dataPath, JSON.stringify({ knownAdjustment: {} }));

      const { getMigratedItem } = await import('./localStorageMigration');

      expect(getMigratedItem('nonExistentKey')).toBeNull();
    });

    it('returns a string value from migrated data', async () => {
      const dataPath = path.join(tempDir.tmpDir, 'localStorage_migration.json');
      fs.writeFileSync(dataPath, JSON.stringify({ customKey: 'custom-value' }));

      const { getMigratedItem } = await import('./localStorageMigration');

      expect(getMigratedItem<string>('customKey')).toBe('custom-value');
    });
  });

  describe('getKnownAdjustmentFromMigration', () => {
    it('returns null when no migration data exists', async () => {
      const { getKnownAdjustmentFromMigration } = await import('./localStorageMigration');

      expect(getKnownAdjustmentFromMigration()).toBeNull();
    });

    it('returns knownAdjustment from migrated data', async () => {
      const dataPath = path.join(tempDir.tmpDir, 'localStorage_migration.json');
      const adjustment = { 猫: 1, 犬: -1, 花: 2 };
      fs.writeFileSync(dataPath, JSON.stringify({ knownAdjustment: adjustment }));

      const { getKnownAdjustmentFromMigration } = await import('./localStorageMigration');

      expect(getKnownAdjustmentFromMigration()).toEqual(adjustment);
    });

    it('returns null when knownAdjustment key is missing from migration data', async () => {
      const dataPath = path.join(tempDir.tmpDir, 'localStorage_migration.json');
      fs.writeFileSync(dataPath, JSON.stringify({ recentlyWatched: [] }));

      const { getKnownAdjustmentFromMigration } = await import('./localStorageMigration');

      expect(getKnownAdjustmentFromMigration()).toBeNull();
    });
  });

  describe('migrateLocalStorage', () => {
    it('skips migration if already attempted and returns success', async () => {
      const statusPath = path.join(tempDir.tmpDir, 'localStorage_migration_status.json');
      fs.writeFileSync(statusPath, JSON.stringify({ success: true, migratedKeys: ['knownAdjustment'] }));

      const { migrateLocalStorage } = await import('./localStorageMigration');

      const result = await migrateLocalStorage();

      expect(result.success).toBe(true);
      expect(result.migratedKeys).toEqual([]);
      expect(MockBrowserWindowClass).not.toHaveBeenCalled();
    });

    it('creates a BrowserWindow for migration if not already attempted', async () => {
      nextWindowImpl = () => {
        const win = createMockWindow(1);
        win.webContents.executeJavaScript = vi.fn().mockResolvedValue({});
        return win;
      };

      const { migrateLocalStorage } = await import('./localStorageMigration');

      await migrateLocalStorage();

      expect(MockBrowserWindowClass).toHaveBeenCalledWith(
        expect.objectContaining({
          show: false,
          webPreferences: expect.objectContaining({
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
          }),
        }),
      );
    });

    it('migrates localStorage data from extracted keys', async () => {
      const localStorageData = {
        knownAdjustment: { word1: 1 },
        recentlyWatched: [{ name: 'video.mp4' }],
        lastVideo: { name: 'video.mp4' },
      };
      nextWindowImpl = () => {
        const win = createMockWindow(1);
        win.webContents.executeJavaScript = vi.fn().mockResolvedValue(localStorageData);
        win.loadFile = vi.fn().mockResolvedValue(undefined);
        return win;
      };

      const { migrateLocalStorage } = await import('./localStorageMigration');

      const result = await migrateLocalStorage();

      expect(result.success).toBe(true);
      expect(result.migratedKeys.length).toBeGreaterThan(0);

      const dataPath = path.join(tempDir.tmpDir, 'localStorage_migration.json');
      expect(fs.existsSync(dataPath)).toBe(true);
      const saved = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
      expect(saved.knownAdjustment).toEqual({ word1: 1 });
    });

    it('saves migration status file after successful migration', async () => {
      nextWindowImpl = () => {
        const win = createMockWindow(1);
        win.webContents.executeJavaScript = vi.fn().mockResolvedValue({ someKey: 'someValue' });
        win.loadFile = vi.fn().mockResolvedValue(undefined);
        return win;
      };

      const { migrateLocalStorage } = await import('./localStorageMigration');

      await migrateLocalStorage();

      const statusPath = path.join(tempDir.tmpDir, 'localStorage_migration_status.json');
      expect(fs.existsSync(statusPath)).toBe(true);
      const status = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
      expect(status.success).toBe(true);
      expect(status.attemptedAt).toBeDefined();
    });

    it('marks migration as attempted even when no localStorage data found', async () => {
      nextWindowImpl = () => {
        const win = createMockWindow(1);
        win.webContents.executeJavaScript = vi.fn().mockResolvedValue({});
        win.loadFile = vi.fn().mockResolvedValue(undefined);
        return win;
      };

      const { migrateLocalStorage, hasMigrationBeenAttempted } = await import('./localStorageMigration');

      const result = await migrateLocalStorage();

      expect(result.success).toBe(true);
      expect(result.migratedKeys).toEqual([]);
      expect(hasMigrationBeenAttempted()).toBe(true);
    });

    it('destroys the migration window after completion', async () => {
      let capturedWin: MockWindowInstance | null = null;
      nextWindowImpl = () => {
        const win = createMockWindow(1);
        win.webContents.executeJavaScript = vi.fn().mockResolvedValue({});
        win.loadFile = vi.fn().mockResolvedValue(undefined);
        win.isDestroyed = vi.fn(() => false);
        capturedWin = win;
        return win;
      };

      const { migrateLocalStorage } = await import('./localStorageMigration');

      await migrateLocalStorage();

      expect(capturedWin).not.toBeNull();
      expect((capturedWin as unknown as MockWindowInstance).destroy).toHaveBeenCalled();
    });

    it('cleans up temporary HTML file after migration', async () => {
      nextWindowImpl = () => {
        const win = createMockWindow(1);
        win.webContents.executeJavaScript = vi.fn().mockResolvedValue({});
        win.loadFile = vi.fn().mockResolvedValue(undefined);
        return win;
      };

      const { migrateLocalStorage } = await import('./localStorageMigration');

      await migrateLocalStorage();

      const tempHtmlPath = path.join(tempDir.tmpDir, 'migration_temp.html');
      expect(fs.existsSync(tempHtmlPath)).toBe(false);
    });

    it('marks migration as attempted even when an error occurs', async () => {
      nextWindowImpl = () => {
        const win = createMockWindow(1);
        win.loadFile = vi.fn().mockRejectedValue(new Error('Load failed'));
        return win;
      };

      const { migrateLocalStorage, hasMigrationBeenAttempted } = await import('./localStorageMigration');

      const result = await migrateLocalStorage();

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(hasMigrationBeenAttempted()).toBe(true);
    });

    it('filters out mlearn_ prefixed keys from migration data', async () => {
      const rawData = {
        knownAdjustment: { word: 1 },
        mlearn_v1_backup_key: 'should-be-skipped',
        mlearn_settings: 'also-skipped',
        legitKey: 'kept',
      };
      nextWindowImpl = () => {
        const win = createMockWindow(1);
        win.webContents.executeJavaScript = vi.fn().mockResolvedValue(rawData);
        win.loadFile = vi.fn().mockResolvedValue(undefined);
        return win;
      };

      const { migrateLocalStorage } = await import('./localStorageMigration');

      await migrateLocalStorage();

      const dataPath = path.join(tempDir.tmpDir, 'localStorage_migration.json');
      const saved = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
      expect(saved.mlearn_v1_backup_key).toBeUndefined();
      expect(saved.mlearn_settings).toBeUndefined();
      expect(saved.knownAdjustment).toEqual({ word: 1 });
      expect(saved.legitKey).toBe('kept');
    });

    it('groups videoCurrentTime_ keys into videoTimestamps', async () => {
      const rawData = {
        videoCurrentTime_video1: 120,
        videoCurrentTime_video2: 300,
      };
      nextWindowImpl = () => {
        const win = createMockWindow(1);
        win.webContents.executeJavaScript = vi.fn().mockResolvedValue(rawData);
        win.loadFile = vi.fn().mockResolvedValue(undefined);
        return win;
      };

      const { migrateLocalStorage } = await import('./localStorageMigration');

      await migrateLocalStorage();

      const dataPath = path.join(tempDir.tmpDir, 'localStorage_migration.json');
      const saved = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
      expect(saved.videoTimestamps).toEqual({ video1: 120, video2: 300 });
      expect(saved.videoCurrentTime_video1).toBeUndefined();
    });
  });

  describe('setupMigrationIPC', () => {
    it('registers all expected IPC handlers', async () => {
      const { ipcMain } = await import('electron');
      const { setupMigrationIPC } = await import('./localStorageMigration');

      setupMigrationIPC();

      expect(ipcMain.handle).toHaveBeenCalledWith('get-migrated-localstorage', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith('get-migrated-item', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith('has-migration-occurred', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith('trigger-migration', expect.any(Function));
    });

    it('GET_MIGRATED_LOCALSTORAGE handler returns null when no data exists', async () => {
      const { setupMigrationIPC } = await import('./localStorageMigration');
      setupMigrationIPC();

      const handler = mockIpcHandlers.get('get-migrated-localstorage');
      expect(handler).toBeDefined();

      const result = await handler!({});
      expect(result).toBeNull();
    });

    it('GET_MIGRATED_LOCALSTORAGE handler returns data when file exists', async () => {
      const dataPath = path.join(tempDir.tmpDir, 'localStorage_migration.json');
      const data = { knownAdjustment: { word: 1 } };
      fs.writeFileSync(dataPath, JSON.stringify(data));

      const { setupMigrationIPC } = await import('./localStorageMigration');
      setupMigrationIPC();

      const handler = mockIpcHandlers.get('get-migrated-localstorage');
      const result = await handler!({});
      expect(result).toEqual(data);
    });

    it('GET_MIGRATED_ITEM handler returns specific item by key', async () => {
      const dataPath = path.join(tempDir.tmpDir, 'localStorage_migration.json');
      const adjustment = { 猫: 1 };
      fs.writeFileSync(dataPath, JSON.stringify({ knownAdjustment: adjustment }));

      const { setupMigrationIPC } = await import('./localStorageMigration');
      setupMigrationIPC();

      const handler = mockIpcHandlers.get('get-migrated-item');
      const result = await handler!({}, 'knownAdjustment');
      expect(result).toEqual(adjustment);
    });

    it('GET_MIGRATED_ITEM handler returns null for missing key', async () => {
      const { setupMigrationIPC } = await import('./localStorageMigration');
      setupMigrationIPC();

      const handler = mockIpcHandlers.get('get-migrated-item');
      const result = await handler!({}, 'nonExistentKey');
      expect(result).toBeNull();
    });

    it('HAS_MIGRATION_OCCURRED handler returns false when no status file exists', async () => {
      const { setupMigrationIPC } = await import('./localStorageMigration');
      setupMigrationIPC();

      const handler = mockIpcHandlers.get('has-migration-occurred');
      const result = await handler!({});
      expect(result).toBe(false);
    });

    it('HAS_MIGRATION_OCCURRED handler returns true when status file exists', async () => {
      const statusPath = path.join(tempDir.tmpDir, 'localStorage_migration_status.json');
      fs.writeFileSync(statusPath, JSON.stringify({ success: true }));

      const { setupMigrationIPC } = await import('./localStorageMigration');
      setupMigrationIPC();

      const handler = mockIpcHandlers.get('has-migration-occurred');
      const result = await handler!({});
      expect(result).toBe(true);
    });

    it('TRIGGER_MIGRATION handler resets status and triggers migration', async () => {
      const statusPath = path.join(tempDir.tmpDir, 'localStorage_migration_status.json');
      fs.writeFileSync(statusPath, JSON.stringify({ success: true, migratedKeys: [] }));

      nextWindowImpl = () => {
        const win = createMockWindow(1);
        win.webContents.executeJavaScript = vi.fn().mockResolvedValue({});
        win.loadFile = vi.fn().mockResolvedValue(undefined);
        return win;
      };

      const { setupMigrationIPC } = await import('./localStorageMigration');
      setupMigrationIPC();

      const handler = mockIpcHandlers.get('trigger-migration');
      const result = await handler!({});

      expect(result).toEqual(expect.objectContaining({ success: expect.any(Boolean) }));
      expect(MockBrowserWindowClass).toHaveBeenCalled();
    });
  });
});
