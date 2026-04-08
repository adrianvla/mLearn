import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createTempDir } from '../../../test/helpers/tempDir';
import type { TempDir } from '../../../test/helpers/tempDir';

const mockIpcListeners = new Map<string, ((event: MockIpcEvent, ...args: unknown[]) => void)[]>();

interface MockIpcEvent {
  reply: ReturnType<typeof vi.fn>;
}

vi.mock('electron', () => ({
  ipcMain: {
    on: vi.fn((channel: string, handler: (event: MockIpcEvent, ...args: unknown[]) => void) => {
      const existing = mockIpcListeners.get(channel) ?? [];
      existing.push(handler);
      mockIpcListeners.set(channel, existing);
    }),
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
  app: {
    getPath: vi.fn(() => '/tmp/test'),
    on: vi.fn(),
    isPackaged: false,
  },
}));

vi.mock('./localization', () => ({
  setUILanguage: vi.fn(),
}));

let tempDir: TempDir;

vi.mock('../utils/platform', () => ({
  getUserDataPath: vi.fn(() => tempDir?.tmpDir ?? '/tmp/test'),
  getAppPath: vi.fn(() => tempDir?.tmpDir ?? '/tmp/test'),
  getResourcePath: vi.fn(() => tempDir?.tmpDir ?? '/tmp/test'),
}));

let mod: typeof import('./settings');
let setUILanguageMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  tempDir = createTempDir();
  vi.resetModules();
  mockIpcListeners.clear();
  mod = await import('./settings');
  const locMod = await import('./localization');
  setUILanguageMock = vi.mocked(locMod.setUILanguage);
});

afterEach(() => {
  tempDir.cleanup();
});

function makeEvent(): MockIpcEvent {
  return { reply: vi.fn() };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

describe('loadSettings', () => {
  it('returns DEFAULT_SETTINGS when settings file does not exist', () => {
    const settings = mod.loadSettings();
    expect(settings).toBeDefined();
    expect(typeof settings).toBe('object');
    expect(settings.language).toBeDefined();
  });

  it('loads settings from an existing file', () => {
    const settingsPath = path.join(tempDir.tmpDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ language: 'de', blur_words: true }), 'utf-8');
    const settings = mod.loadSettings();
    expect(settings.language).toBe('de');
    expect(settings.blur_words).toBe(true);
  });

  it('merges loaded settings with DEFAULT_SETTINGS filling missing keys', () => {
    const settingsPath = path.join(tempDir.tmpDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ language: 'de' }), 'utf-8');
    const settings = mod.loadSettings();
    expect(settings.language).toBe('de');
    expect(settings.theme).toBeDefined();
  });

  it('returns DEFAULT_SETTINGS when file contains corrupt JSON', () => {
    const settingsPath = path.join(tempDir.tmpDir, 'settings.json');
    fs.writeFileSync(settingsPath, '{ invalid json', 'utf-8');
    const settings = mod.loadSettings();
    expect(settings).toBeDefined();
    expect(typeof settings.language).toBe('string');
  });

  it('returns DEFAULT_SETTINGS when file contains a JSON array', () => {
    const settingsPath = path.join(tempDir.tmpDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify([1, 2, 3]), 'utf-8');
    const settings = mod.loadSettings();
    expect(settings.language).toBeDefined();
  });

  it('returns DEFAULT_SETTINGS when file contains null', () => {
    const settingsPath = path.join(tempDir.tmpDir, 'settings.json');
    fs.writeFileSync(settingsPath, 'null', 'utf-8');
    const settings = mod.loadSettings();
    expect(settings.language).toBeDefined();
  });
});

describe('loadSettings migration', () => {
  it('migrates cloudAuthToken to cloudAuthAccessToken when cloudAuthAccessToken is missing', () => {
    const settingsPath = path.join(tempDir.tmpDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ cloudAuthToken: 'token123' }), 'utf-8');
    const settings = mod.loadSettings();
    expect(settings.cloudAuthAccessToken).toBe('token123');
  });

  it('sets cloudAuthStatus to signed-in when cloudAuthAccessToken exists but cloudAuthStatus is absent', () => {
    const settingsPath = path.join(tempDir.tmpDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ cloudAuthAccessToken: 'tok' }), 'utf-8');
    const settings = mod.loadSettings();
    expect(settings.cloudAuthStatus).toBe('signed-in');
  });

  it('migrates cloudApiUrl from backendUrl when overrideCloudEndpointUrl is set', () => {
    const settingsPath = path.join(tempDir.tmpDir, 'settings.json');
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ overrideCloudEndpointUrl: true, backendUrl: 'https://example.com', cloudApiUrl: undefined }),
      'utf-8',
    );
    const settings = mod.loadSettings();
    expect(settings.cloudApiUrl).toBe('https://example.com');
    expect(settings.cloudLoginUrl).toBe('https://example.com');
  });

  it('does not overwrite existing cloudAuthAccessToken with cloudAuthToken', () => {
    const settingsPath = path.join(tempDir.tmpDir, 'settings.json');
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ cloudAuthToken: 'old', cloudAuthAccessToken: 'existing' }),
      'utf-8',
    );
    const settings = mod.loadSettings();
    expect(settings.cloudAuthAccessToken).toBe('existing');
  });
});

describe('saveSettings', () => {
  it('writes settings to settings.json', async () => {
    const settings = mod.loadSettings();
    settings.language = 'de';
    await mod.saveSettings(settings);
    const settingsPath = path.join(tempDir.tmpDir, 'settings.json');
    expect(fs.existsSync(settingsPath)).toBe(true);
    const loaded = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(loaded.language).toBe('de');
  });

  it('uses atomic write (tmp + rename)', async () => {
    const settings = mod.loadSettings();
    await mod.saveSettings(settings);
    const settingsPath = path.join(tempDir.tmpDir, 'settings.json');
    const tmpPath = `${settingsPath}.tmp`;
    expect(fs.existsSync(settingsPath)).toBe(true);
    expect(fs.existsSync(tmpPath)).toBe(false);
  });

  it('round-trips saved settings correctly', async () => {
    const settings = mod.loadSettings();
    settings.language = 'fr';
    settings.blur_words = true;
    await mod.saveSettings(settings);
    const loaded = mod.loadSettings();
    expect(loaded.language).toBe('fr');
    expect(loaded.blur_words).toBe(true);
  });

  it('serializes concurrent saves so the last snapshot wins', async () => {
    const originalWriteFile = fs.promises.writeFile.bind(fs.promises);
    const firstWriteStarted = deferred<void>();
    const releaseFirstWrite = deferred<void>();
    let writeCallCount = 0;

    const writeFileSpy = vi.spyOn(fs.promises, 'writeFile').mockImplementation(async (
      file,
      data,
      options,
    ) => {
      writeCallCount += 1;
      if (writeCallCount === 1) {
        firstWriteStarted.resolve();
        await releaseFirstWrite.promise;
      }

      return originalWriteFile(file, data, options);
    });

    try {
      const firstSettings = { ...mod.loadSettings(), language: 'de' };
      const secondSettings = { ...mod.loadSettings(), language: 'fr' };

      const firstSave = mod.saveSettings(firstSettings);
      await firstWriteStarted.promise;

      const secondSave = mod.saveSettings(secondSettings);
      await Promise.resolve();

      expect(writeFileSpy).toHaveBeenCalledTimes(1);

      releaseFirstWrite.resolve();
      await Promise.all([firstSave, secondSave]);

      const saved = JSON.parse(fs.readFileSync(path.join(tempDir.tmpDir, 'settings.json'), 'utf-8'));
      expect(saved.language).toBe('fr');
      expect(fs.existsSync(path.join(tempDir.tmpDir, 'settings.json.tmp'))).toBe(false);
    } finally {
      writeFileSpy.mockRestore();
    }
  });
});

describe('loadLangData', () => {
  it('returns default lang data when no languages directory exists', () => {
    const langData = mod.loadLangData();
    expect(langData).toBeDefined();
    expect(typeof langData).toBe('object');
    expect(langData['ja']).toBeDefined();
    expect(langData['de']).toBeDefined();
  });

  it('loads JSON files from a languages directory when it exists', () => {
    const langsDir = path.join(tempDir.tmpDir, 'languages');
    fs.mkdirSync(langsDir, { recursive: true });
    fs.writeFileSync(path.join(langsDir, 'en.json'), JSON.stringify({ name: 'English', translatable: [] }), 'utf-8');
    const langData = mod.loadLangData();
    expect(langData['en']).toBeDefined();
    expect(langData['en'].name).toBe('English');
  });

  it('skips corrupt JSON files in the languages directory', () => {
    const langsDir = path.join(tempDir.tmpDir, 'languages');
    fs.mkdirSync(langsDir, { recursive: true });
    fs.writeFileSync(path.join(langsDir, 'bad.json'), '{ broken', 'utf-8');
    fs.writeFileSync(path.join(langsDir, 'en.json'), JSON.stringify({ name: 'English' }), 'utf-8');
    const langData = mod.loadLangData();
    expect(langData['bad']).toBeUndefined();
    expect(langData['en']).toBeDefined();
  });

  it('ignores non-JSON files in the languages directory', () => {
    const langsDir = path.join(tempDir.tmpDir, 'languages');
    fs.mkdirSync(langsDir, { recursive: true });
    fs.writeFileSync(path.join(langsDir, 'readme.txt'), 'ignore me', 'utf-8');
    fs.writeFileSync(path.join(langsDir, 'ja.json'), JSON.stringify({ name: 'Japanese' }), 'utf-8');
    const langData = mod.loadLangData();
    expect(langData['readme']).toBeUndefined();
    expect(langData['ja']).toBeDefined();
  });

  it('returns default lang data when languages directory is empty', () => {
    const langsDir = path.join(tempDir.tmpDir, 'languages');
    fs.mkdirSync(langsDir, { recursive: true });
    const langData = mod.loadLangData();
    expect(langData['ja']).toBeDefined();
  });
});

describe('setupSettingsIPC', () => {
  it('registers listener for GET_SETTINGS channel', () => {
    mod.setupSettingsIPC();
    expect(mockIpcListeners.has('get-settings')).toBe(true);
  });

  it('registers listener for SAVE_SETTINGS channel', () => {
    mod.setupSettingsIPC();
    expect(mockIpcListeners.has('save-settings')).toBe(true);
  });

  it('registers listener for GET_LANG_DATA channel', () => {
    mod.setupSettingsIPC();
    expect(mockIpcListeners.has('get-lang-data')).toBe(true);
  });
});

describe('GET_SETTINGS IPC handler', () => {
  it('replies with current settings on GET_SETTINGS', () => {
    mod.setupSettingsIPC();
    const handlers = mockIpcListeners.get('get-settings') ?? [];
    const event = makeEvent();
    for (const h of handlers) h(event);
    expect(event.reply).toHaveBeenCalledWith('settings', expect.objectContaining({ language: expect.any(String) }));
  });

  it('replies with settings loaded from disk', () => {
    const settingsPath = path.join(tempDir.tmpDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ language: 'fr' }), 'utf-8');
    mod.setupSettingsIPC();
    const handlers = mockIpcListeners.get('get-settings') ?? [];
    const event = makeEvent();
    for (const h of handlers) h(event);
    expect(event.reply).toHaveBeenCalledWith('settings', expect.objectContaining({ language: 'fr' }));
  });
});

describe('SAVE_SETTINGS IPC handler', () => {
  it('saves settings and replies with settings-saved', async () => {
    mod.setupSettingsIPC();
    const handlers = mockIpcListeners.get('save-settings') ?? [];
    const event = makeEvent();
    const settings = mod.loadSettings();
    settings.language = 'de';
    for (const h of handlers) await h(event, settings);
    expect(event.reply).toHaveBeenCalledWith('settings-saved');
    const settingsPath = path.join(tempDir.tmpDir, 'settings.json');
    expect(fs.existsSync(settingsPath)).toBe(true);
  });

  it('calls setUILanguage when uiLanguage changes', async () => {
    const settingsPath = path.join(tempDir.tmpDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ uiLanguage: 'en' }), 'utf-8');
    mod.setupSettingsIPC();
    const handlers = mockIpcListeners.get('save-settings') ?? [];
    const event = makeEvent();
    const settings = mod.loadSettings();
    settings.uiLanguage = 'de';
    for (const h of handlers) await h(event, settings);
    expect(setUILanguageMock).toHaveBeenCalledWith('de');
  });

  it('does not call setUILanguage when uiLanguage is unchanged', async () => {
    const settingsPath = path.join(tempDir.tmpDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ uiLanguage: 'en' }), 'utf-8');
    mod.setupSettingsIPC();
    const handlers = mockIpcListeners.get('save-settings') ?? [];
    const event = makeEvent();
    const settings = mod.loadSettings();
    settings.uiLanguage = 'en';
    for (const h of handlers) await h(event, settings);
    expect(setUILanguageMock).not.toHaveBeenCalled();
  });
});

describe('GET_LANG_DATA IPC handler', () => {
  it('replies with lang data on GET_LANG_DATA', () => {
    mod.setupSettingsIPC();
    const handlers = mockIpcListeners.get('get-lang-data') ?? [];
    const event = makeEvent();
    for (const h of handlers) h(event);
    expect(event.reply).toHaveBeenCalledWith('lang-data', expect.objectContaining({ ja: expect.any(Object) }));
  });

  it('replies with lang data loaded from custom languages directory', () => {
    const langsDir = path.join(tempDir.tmpDir, 'languages');
    fs.mkdirSync(langsDir, { recursive: true });
    fs.writeFileSync(path.join(langsDir, 'zz.json'), JSON.stringify({ name: 'TestLang' }), 'utf-8');
    mod.setupSettingsIPC();
    const handlers = mockIpcListeners.get('get-lang-data') ?? [];
    const event = makeEvent();
    for (const h of handlers) h(event);
    expect(event.reply).toHaveBeenCalledWith('lang-data', expect.objectContaining({ zz: expect.any(Object) }));
  });
});
