import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { createTempDir, ensureDir, type TempDir } from '../../../test/helpers/tempDir';

let tempDir: TempDir;

const mockIpcListeners = new Map<string, ((event: { reply: ReturnType<typeof vi.fn> }, ...args: unknown[]) => void)[]>();
const mockWindows: Array<{ webContents: { send: ReturnType<typeof vi.fn> } }> = [];

vi.mock('electron', () => ({
  ipcMain: {
    on: vi.fn((channel: string, handler: (event: { reply: ReturnType<typeof vi.fn> }, ...args: unknown[]) => void) => {
      const existing = mockIpcListeners.get(channel) ?? [];
      existing.push(handler);
      mockIpcListeners.set(channel, existing);
    }),
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => mockWindows),
  },
  app: {
    getPath: vi.fn(() => tempDir?.tmpDir ?? '/tmp/test'),
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

const mockLoadSettings = vi.fn(() => ({ uiLanguage: 'en' }));

vi.mock('./settings', () => ({
  get loadSettings() {
    return mockLoadSettings;
  },
}));

function writeLocaleFile(dir: string, langCode: string, data: Record<string, unknown>): void {
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, `lang.${langCode}.json`), JSON.stringify(data));
}

describe('localization', () => {
  beforeEach(async () => {
    tempDir = createTempDir('localization-test-');
    mockIpcListeners.clear();
    mockWindows.length = 0;
    mockLoadSettings.mockReset();
    mockLoadSettings.mockReturnValue({ uiLanguage: 'en' });
    vi.resetModules();
  });

  afterEach(() => {
    tempDir.cleanup();
  });

  describe('loadLocalization', () => {
    it('returns empty object when no locales directory exists', async () => {
      const { loadLocalization } = await import('./localization');

      const result = loadLocalization('en');

      expect(result).toEqual({});
    });

    it('loads locale data from the appPath/locales directory', async () => {
      const localesDir = path.join(tempDir.tmpDir, 'locales');
      const enData = { mlearn: { App: { Title: 'mLearn' } } };
      writeLocaleFile(localesDir, 'en', enData);

      const platform = await import('../utils/platform');
      (platform.getAppPath as ReturnType<typeof vi.fn>).mockReturnValue(tempDir.tmpDir);
      (platform.getResourcePath as ReturnType<typeof vi.fn>).mockReturnValue('/no-such-path');

      const { loadLocalization } = await import('./localization');

      const result = loadLocalization('en');

      expect(result).toEqual(enData);
    });

    it('loads locale data from the resourcePath/locales directory as fallback', async () => {
      const resourceDir = path.join(tempDir.tmpDir, 'resource');
      const localesDir = path.join(resourceDir, 'locales');
      const enData = { mlearn: { App: { Title: 'mLearn Resource' } } };
      writeLocaleFile(localesDir, 'en', enData);

      const platform = await import('../utils/platform');
      (platform.getAppPath as ReturnType<typeof vi.fn>).mockReturnValue('/no-such-app-path');
      (platform.getResourcePath as ReturnType<typeof vi.fn>).mockReturnValue(resourceDir);

      const { loadLocalization } = await import('./localization');

      const result = loadLocalization('en');

      expect(result).toEqual(enData);
    });

    it('falls back to English when requested locale file is missing', async () => {
      const localesDir = path.join(tempDir.tmpDir, 'locales');
      const enData = { mlearn: { App: { Title: 'Fallback English' } } };
      writeLocaleFile(localesDir, 'en', enData);

      const platform = await import('../utils/platform');
      (platform.getAppPath as ReturnType<typeof vi.fn>).mockReturnValue(tempDir.tmpDir);

      const { loadLocalization } = await import('./localization');

      const result = loadLocalization('de');

      expect(result).toEqual(enData);
    });

    it('returns empty object when English fallback also missing', async () => {
      const localesDir = path.join(tempDir.tmpDir, 'locales');
      ensureDir(localesDir);

      const platform = await import('../utils/platform');
      (platform.getAppPath as ReturnType<typeof vi.fn>).mockReturnValue(tempDir.tmpDir);

      const { loadLocalization } = await import('./localization');

      const result = loadLocalization('de');

      expect(result).toEqual({});
    });

    it('returns empty object for corrupt JSON file', async () => {
      const localesDir = path.join(tempDir.tmpDir, 'locales');
      ensureDir(localesDir);
      fs.writeFileSync(path.join(localesDir, 'lang.en.json'), 'not-valid-json{{');

      const platform = await import('../utils/platform');
      (platform.getAppPath as ReturnType<typeof vi.fn>).mockReturnValue(tempDir.tmpDir);

      const { loadLocalization } = await import('./localization');

      const result = loadLocalization('en');

      expect(result).toEqual({});
    });

    it('loads locale from root-of-app/locales candidate directory', async () => {
      const rootDir = path.join(tempDir.tmpDir, 'root-of-app', 'locales');
      const deData = { mlearn: { App: { Title: 'mLearn DE' } } };
      writeLocaleFile(rootDir, 'de', deData);
      writeLocaleFile(rootDir, 'en', {});

      const platform = await import('../utils/platform');
      (platform.getAppPath as ReturnType<typeof vi.fn>).mockReturnValue(tempDir.tmpDir);
      (platform.getResourcePath as ReturnType<typeof vi.fn>).mockReturnValue('/no-such-path');

      const { loadLocalization } = await import('./localization');

      const result = loadLocalization('de');

      expect(result).toEqual(deData);
    });

    it('loads locale from source root-of-app when running from dist-electron in development', async () => {
      const distDir = path.join(tempDir.tmpDir, 'dist-electron');
      const sourceLocalesDir = path.join(tempDir.tmpDir, 'src', 'root-of-app', 'locales');
      const enData = { mlearn: { ComponentsTab: { Groups: { AI: { Title: 'AI components' } } } } };
      writeLocaleFile(sourceLocalesDir, 'en', enData);

      const platform = await import('../utils/platform');
      (platform.getAppPath as ReturnType<typeof vi.fn>).mockReturnValue(distDir);
      (platform.getResourcePath as ReturnType<typeof vi.fn>).mockReturnValue(distDir);

      const { loadLocalization } = await import('./localization');

      const result = loadLocalization('en');

      expect(result).toEqual(enData);
    });
  });

  describe('getCurrentLocaleData', () => {
    it('returns the current locale and strings', async () => {
      const localesDir = path.join(tempDir.tmpDir, 'locales');
      const enData = { mlearn: { App: { Title: 'mLearn' } } };
      writeLocaleFile(localesDir, 'en', enData);

      const platform = await import('../utils/platform');
      (platform.getAppPath as ReturnType<typeof vi.fn>).mockReturnValue(tempDir.tmpDir);

      const { getCurrentLocaleData, initializeLocalization } = await import('./localization');

      initializeLocalization();

      const result = getCurrentLocaleData();

      expect(result).toEqual(
        expect.objectContaining({
          locale: expect.any(String),
          strings: expect.any(Object),
        }),
      );
    });

    it('returns default English locale after module load without initialization', async () => {
      const { getCurrentLocaleData } = await import('./localization');

      const result = getCurrentLocaleData();

      expect(result.locale).toBe('en');
      expect(result.strings).toEqual({});
    });
  });

  describe('setUILanguage', () => {
    it('updates the current locale and broadcasts to all windows', async () => {
      const localesDir = path.join(tempDir.tmpDir, 'locales');
      const deData = { mlearn: { App: { Title: 'mLearn DE' } } };
      writeLocaleFile(localesDir, 'en', {});
      writeLocaleFile(localesDir, 'de', deData);

      const platform = await import('../utils/platform');
      (platform.getAppPath as ReturnType<typeof vi.fn>).mockReturnValue(tempDir.tmpDir);

      const mockWebContents = { send: vi.fn() };
      mockWindows.push({ webContents: mockWebContents });

      const { setUILanguage, getCurrentLocaleData } = await import('./localization');

      setUILanguage('de');

      const localeData = getCurrentLocaleData();
      expect(localeData.locale).toBe('de');
      expect(localeData.strings).toEqual(deData);
      expect(mockWebContents.send).toHaveBeenCalledOnce();
    });

    it('broadcasts to multiple windows', async () => {
      const localesDir = path.join(tempDir.tmpDir, 'locales');
      writeLocaleFile(localesDir, 'en', {});
      writeLocaleFile(localesDir, 'fr', { key: 'fr-value' });

      const platform = await import('../utils/platform');
      (platform.getAppPath as ReturnType<typeof vi.fn>).mockReturnValue(tempDir.tmpDir);

      const win1 = { webContents: { send: vi.fn() } };
      const win2 = { webContents: { send: vi.fn() } };
      const win3 = { webContents: { send: vi.fn() } };
      mockWindows.push(win1, win2, win3);

      const { setUILanguage } = await import('./localization');

      setUILanguage('fr');

      expect(win1.webContents.send).toHaveBeenCalledOnce();
      expect(win2.webContents.send).toHaveBeenCalledOnce();
      expect(win3.webContents.send).toHaveBeenCalledOnce();
    });

    it('sends the LOCALIZATION IPC channel with the locale data', async () => {
      const localesDir = path.join(tempDir.tmpDir, 'locales');
      const jaData = { mlearn: { App: { Title: 'mLearn JA' } } };
      writeLocaleFile(localesDir, 'en', {});
      writeLocaleFile(localesDir, 'ja', jaData);

      const platform = await import('../utils/platform');
      (platform.getAppPath as ReturnType<typeof vi.fn>).mockReturnValue(tempDir.tmpDir);

      const mockWebContents = { send: vi.fn() };
      mockWindows.push({ webContents: mockWebContents });

      const { setUILanguage } = await import('./localization');

      setUILanguage('ja');

      const [channel, payload] = mockWebContents.send.mock.calls[0];
      expect(channel).toBe('localization');
      expect(payload).toEqual({ locale: 'ja', strings: jaData });
    });
  });

  describe('initializeLocalization', () => {
    it('loads locale data on initialization and populates current locale', async () => {
      const localesDir = path.join(tempDir.tmpDir, 'locales');
      writeLocaleFile(localesDir, 'en', { mlearn: { App: { Title: 'English' } } });

      const platform = await import('../utils/platform');
      (platform.getAppPath as ReturnType<typeof vi.fn>).mockReturnValue(tempDir.tmpDir);

      const { initializeLocalization, getCurrentLocaleData } = await import('./localization');

      initializeLocalization();

      const localeData = getCurrentLocaleData();
      expect(localeData.locale).toBe('en');
      expect(localeData.strings).toEqual({ mlearn: { App: { Title: 'English' } } });
    });

    it('can be called multiple times without throwing', async () => {
      const localesDir = path.join(tempDir.tmpDir, 'locales');
      writeLocaleFile(localesDir, 'en', {});

      const platform = await import('../utils/platform');
      (platform.getAppPath as ReturnType<typeof vi.fn>).mockReturnValue(tempDir.tmpDir);

      const { initializeLocalization } = await import('./localization');

      expect(() => {
        initializeLocalization();
        initializeLocalization();
      }).not.toThrow();
    });

    it('defaults to English when settings loading fails', async () => {
      const localesDir = path.join(tempDir.tmpDir, 'locales');
      writeLocaleFile(localesDir, 'en', { key: 'english-value' });

      const platform = await import('../utils/platform');
      (platform.getAppPath as ReturnType<typeof vi.fn>).mockReturnValue(tempDir.tmpDir);

      mockLoadSettings.mockImplementation(() => { throw new Error('Settings unavailable'); });

      const { initializeLocalization, getCurrentLocaleData } = await import('./localization');

      initializeLocalization();

      const localeData = getCurrentLocaleData();
      expect(localeData.locale).toBe('en');
    });
  });

  describe('setupLocalizationIPC', () => {
    it('registers GET_LOCALIZATION and CHANGE_UI_LANGUAGE handlers', async () => {
      const localesDir = path.join(tempDir.tmpDir, 'locales');
      writeLocaleFile(localesDir, 'en', {});

      const platform = await import('../utils/platform');
      (platform.getAppPath as ReturnType<typeof vi.fn>).mockReturnValue(tempDir.tmpDir);

      const { ipcMain } = await import('electron');
      const { setupLocalizationIPC } = await import('./localization');

      setupLocalizationIPC();

      expect(ipcMain.on).toHaveBeenCalledWith('get-localization', expect.any(Function));
      expect(ipcMain.on).toHaveBeenCalledWith('change-ui-language', expect.any(Function));
    });

    it('GET_LOCALIZATION handler replies with current locale data', async () => {
      const localesDir = path.join(tempDir.tmpDir, 'locales');
      const enData = { key: 'value' };
      writeLocaleFile(localesDir, 'en', enData);

      const platform = await import('../utils/platform');
      (platform.getAppPath as ReturnType<typeof vi.fn>).mockReturnValue(tempDir.tmpDir);

      const { setupLocalizationIPC } = await import('./localization');

      setupLocalizationIPC();

      const handlers = mockIpcListeners.get('get-localization');
      expect(handlers).toBeDefined();
      expect(handlers!.length).toBeGreaterThan(0);

      const replyFn = vi.fn();
      const mockEvent = { reply: replyFn };
      handlers![0](mockEvent);

      expect(replyFn).toHaveBeenCalledWith('localization', expect.objectContaining({
        locale: expect.any(String),
        strings: expect.any(Object),
      }));
    });

    it('CHANGE_UI_LANGUAGE handler updates locale and broadcasts', async () => {
      const localesDir = path.join(tempDir.tmpDir, 'locales');
      const frData = { mlearn: { App: { Title: 'FR' } } };
      writeLocaleFile(localesDir, 'en', {});
      writeLocaleFile(localesDir, 'fr', frData);

      const platform = await import('../utils/platform');
      (platform.getAppPath as ReturnType<typeof vi.fn>).mockReturnValue(tempDir.tmpDir);

      const mockWin = { webContents: { send: vi.fn() } };
      mockWindows.push(mockWin);

      const { setupLocalizationIPC, getCurrentLocaleData } = await import('./localization');

      setupLocalizationIPC();

      const handlers = mockIpcListeners.get('change-ui-language');
      expect(handlers).toBeDefined();
      handlers![0]({ reply: vi.fn() }, 'fr');

      const localeData = getCurrentLocaleData();
      expect(localeData.locale).toBe('fr');
      expect(mockWin.webContents.send).toHaveBeenCalled();
    });
  });
});
