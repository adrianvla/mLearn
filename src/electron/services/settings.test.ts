import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as tar from 'tar';
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

const mockDownloadFileWithProgress = vi.fn();

vi.mock('../utils/downloadManager', () => ({
  downloadFileWithProgress: mockDownloadFileWithProgress,
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
  mockDownloadFileWithProgress.mockReset();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: false,
    status: 404,
    statusText: 'Not Found',
  }));
  vi.resetModules();
  mockIpcListeners.clear();
  mod = await import('./settings');
  const locMod = await import('./localization');
  setUILanguageMock = vi.mocked(locMod.setUILanguage);
});

afterEach(() => {
  tempDir.cleanup();
  vi.unstubAllGlobals();
});

function makeEvent(): MockIpcEvent {
  return { reply: vi.fn() };
}

function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
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
  it('reports whether the settings file exists', () => {
    expect(mod.hasSettingsFile()).toBe(false);

    const settingsPath = path.join(tempDir.tmpDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ language: 'de' }), 'utf-8');

    expect(mod.hasSettingsFile()).toBe(true);
  });

  it('returns DEFAULT_SETTINGS when settings file does not exist', () => {
    const settings = mod.loadSettings();
    expect(settings).toBeDefined();
    expect(typeof settings).toBe('object');
    expect(settings.language).toBeDefined();
    expect(settings.languageCatalogUrl).toBe('https://mlearn.kikan.net/language-catalog.json');
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
  it('returns no runtime language data when no downloaded language data exists', () => {
    const langData = mod.loadLangData();
    expect(langData).toEqual({});
  });

  it('loads JSON files from the downloaded language-data directory', () => {
    const langsDir = path.join(tempDir.tmpDir, 'language-data', 'languages');
    fs.mkdirSync(langsDir, { recursive: true });
    fs.writeFileSync(path.join(langsDir, 'en.json'), JSON.stringify({ name: 'English', translatable: [] }), 'utf-8');
    const langData = mod.loadLangData();
    expect(langData['en']).toBeDefined();
    expect(langData['en'].name).toBe('English');
  });

  it('ignores legacy user and bundled language directories', () => {
    const customLangsDir = path.join(tempDir.tmpDir, 'languages');
    const bundledLangsDir = path.join(tempDir.tmpDir, 'root-of-app', 'languages');
    fs.mkdirSync(customLangsDir, { recursive: true });
    fs.mkdirSync(bundledLangsDir, { recursive: true });
    fs.writeFileSync(path.join(customLangsDir, 'zz.json'), JSON.stringify({ name: 'Custom', translatable: [] }), 'utf-8');
    fs.writeFileSync(path.join(bundledLangsDir, 'ja.json'), JSON.stringify({ name: 'Japanese', translatable: [] }), 'utf-8');

    const langData = mod.loadLangData();

    expect(langData).toEqual({});
  });

  it('skips corrupt JSON files in the downloaded language-data directory', () => {
    const langsDir = path.join(tempDir.tmpDir, 'language-data', 'languages');
    fs.mkdirSync(langsDir, { recursive: true });
    fs.writeFileSync(path.join(langsDir, 'bad.json'), '{ broken', 'utf-8');
    fs.writeFileSync(path.join(langsDir, 'en.json'), JSON.stringify({ name: 'English' }), 'utf-8');
    const langData = mod.loadLangData();
    expect(langData['bad']).toBeUndefined();
    expect(langData['en']).toBeDefined();
  });

  it('ignores non-JSON files in the downloaded language-data directory', () => {
    const langsDir = path.join(tempDir.tmpDir, 'language-data', 'languages');
    fs.mkdirSync(langsDir, { recursive: true });
    fs.writeFileSync(path.join(langsDir, 'readme.txt'), 'ignore me', 'utf-8');
    fs.writeFileSync(path.join(langsDir, 'ja.json'), JSON.stringify({ name: 'Japanese' }), 'utf-8');
    const langData = mod.loadLangData();
    expect(langData['readme']).toBeUndefined();
    expect(langData['ja']).toBeDefined();
  });

  it('loads split word frequency files without registering them as languages', () => {
    const langsDir = path.join(tempDir.tmpDir, 'language-data', 'languages');
    fs.mkdirSync(langsDir, { recursive: true });
    fs.writeFileSync(
      path.join(langsDir, 'ja.json'),
      JSON.stringify({ name: 'Japanese', translatable: [], colour_codes: {}, fixed_settings: {} }),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(langsDir, 'ja.freq.json'),
      JSON.stringify({ freq: [['行く', 'いく']] }),
      'utf-8',
    );

    const langData = mod.loadLangData();

    expect(langData['ja']?.freq).toEqual([['行く', 'いく']]);
    expect(langData['ja.freq']).toBeUndefined();
  });

  it('loads installed frequency files from the language-data directory', () => {
    const installedFreqDir = path.join(tempDir.tmpDir, 'language-data', 'languages');
    fs.mkdirSync(installedFreqDir, { recursive: true });
    fs.writeFileSync(
      path.join(installedFreqDir, 'ja.json'),
      JSON.stringify({ name: 'Japanese', translatable: [], colour_codes: {}, fixed_settings: {} }),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(installedFreqDir, 'ja.freq.json'),
      JSON.stringify({ freq: [['食べる', 'たべる']] }),
      'utf-8',
    );

    const langData = mod.loadLangData();

    expect(langData['ja']?.freq).toEqual([['食べる', 'たべる']]);
  });

  it('returns no runtime language data when downloaded language-data directory is empty', () => {
    const langsDir = path.join(tempDir.tmpDir, 'language-data', 'languages');
    fs.mkdirSync(langsDir, { recursive: true });
    const langData = mod.loadLangData();
    expect(langData).toEqual({});
  });
});

describe('loadLanguageCatalogData', () => {
  it('loads runtime language data only from local files', async () => {
    const langsDir = path.join(tempDir.tmpDir, 'language-data', 'languages');
    fs.mkdirSync(langsDir, { recursive: true });
    fs.writeFileSync(
      path.join(langsDir, 'ja.json'),
      JSON.stringify({
        name: 'Japanese',
        translatable: ['名詞'],
        colour_codes: {},
        fixed_settings: {},
      }),
      'utf-8',
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        languages: {
          ja: {
            name: 'Japanese package',
            nameTranslated: '日本語',
            version: 'ja-package-v1',
            bundle: {
              href: './language-data/language-ja-v1.tar.gz',
              sizeBytes: 456,
              sha256: 'f'.repeat(64),
            },
            files: [],
          },
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const langData = await mod.loadLanguageCatalogData({
      ...mod.loadSettings(),
      languageCatalogUrl: 'https://pages.example.com/catalog/languages.json',
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(langData['ja']?.name).toBe('Japanese');
    expect(langData['ja']?.translatable).toEqual(['名詞']);
    expect(langData['ja']?.languageData).toBeUndefined();
  });
});

describe('loadLanguagePackageCatalog', () => {
  it('loads package entries from the configured catalog URL and resolves bundle hrefs', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        generatedAt: '2026-06-28T12:00:00.000Z',
        languages: {
          es: {
            name: 'Spanish',
            nameTranslated: 'Español',
            version: 'es-package-v1',
            bundle: {
              href: './language-data/language-es-package-v1.tar.gz',
              sizeBytes: 456,
              sha256: 'f'.repeat(64),
            },
            files: [{
              id: 'dictionary',
              path: 'dictionaries/es/dictionary.db',
              sizeBytes: 123,
              sha256: 'a'.repeat(64),
              required: true,
            }],
          },
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const langData = await mod.loadLanguagePackageCatalog({
      ...mod.loadSettings(),
      languageCatalogUrl: 'https://pages.example.com/language-catalog.json',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('https://pages.example.com/language-catalog.json', expect.objectContaining({
      headers: expect.objectContaining({ Accept: 'application/json' }),
    }));
    expect(langData['es']).toMatchObject({
      name: 'Spanish',
      name_translated: 'Español',
      languageData: {
        version: 'es-package-v1',
        bundle: {
          url: 'https://pages.example.com/language-data/language-es-package-v1.tar.gz',
          sizeBytes: 456,
        },
        assets: [
          expect.objectContaining({
            id: 'dictionary',
            path: 'dictionaries/es/dictionary.db',
          }),
        ],
      },
    });
  });

  it('loads dictionary packs from language package catalog entries', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        languages: {
          ja: {
            name: 'Japanese',
            nameTranslated: '日本語',
            version: 'ja-core-v1',
            bundle: {
              href: './language-data/language-ja-core-v1.tar.gz',
              sizeBytes: 100,
              sha256: 'a'.repeat(64),
            },
            files: [{
              id: 'language-metadata',
              path: 'languages/ja.json',
              sizeBytes: 10,
              sha256: 'b'.repeat(64),
              required: true,
            }],
            dictionaryPacks: {
              fr: {
                targetLanguage: 'fr',
                name: 'French',
                version: 'jmdict-fr-v1',
                bundle: {
                  href: './language-data/dictionary-ja-fr-v1.tar.gz',
                  sizeBytes: 200,
                  sha256: 'c'.repeat(64),
                },
                assets: [{
                  id: 'dictionary',
                  path: 'dictionaries/ja/dictionary.db',
                  sizeBytes: 20,
                  sha256: 'd'.repeat(64),
                  required: true,
                }],
              },
            },
          },
        },
      }),
    }));

    const langData = await mod.loadLanguagePackageCatalog({
      ...mod.loadSettings(),
      languageCatalogUrl: 'https://pages.example.com/language-catalog.json',
    });

    expect(langData.ja.languageData?.dictionaryPacks?.fr).toMatchObject({
      targetLanguage: 'fr',
      name: 'French',
      version: 'jmdict-fr-v1',
      bundle: {
        url: 'https://pages.example.com/language-data/dictionary-ja-fr-v1.tar.gz',
        sizeBytes: 200,
      },
      assets: [
        expect.objectContaining({
          id: 'dictionary',
          path: 'dictionaries/ja/dictionary.db',
        }),
      ],
    });
  });

  it('ignores legacy embedded metadata and per-language manifest links', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        languages: {
          legacy: {
            name: 'Legacy Metadata',
            translatable: ['NOUN'],
            colour_codes: {},
            fixed_settings: {},
          },
          fr: './language-catalog/fr.json',
          es: {
            name: 'Spanish',
            nameTranslated: 'Español',
            version: 'es-package-v1',
            bundle: {
              href: './language-data/language-es-package-v1.tar.gz',
              sizeBytes: 456,
              sha256: 'f'.repeat(64),
            },
            files: [{
              id: 'dictionary',
              path: 'dictionaries/es/dictionary.db',
              sizeBytes: 123,
              sha256: 'a'.repeat(64),
              required: true,
            }],
          },
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const langData = await mod.loadLanguagePackageCatalog({
      ...mod.loadSettings(),
      languageCatalogUrl: 'https://pages.example.com/language-catalog.json',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(Object.keys(langData)).toEqual(['es']);
  });

  it('returns an empty package catalog when the configured catalog is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    }));

    const langData = await mod.loadLanguagePackageCatalog({
      ...mod.loadSettings(),
      languageCatalogUrl: 'https://pages.example.com/catalog/languages.json',
    });

    expect(langData).toEqual({});
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

  it('registers listener for GET_LANGUAGE_DATA_CATALOG channel', () => {
    mod.setupSettingsIPC();
    expect(mockIpcListeners.has('get-language-data-catalog')).toBe(true);
  });

  it('registers listener for INSTALL_LANGUAGE_DATA channel', () => {
    mod.setupSettingsIPC();
    expect(mockIpcListeners.has('install-language-data')).toBe(true);
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
  it('replies with empty lang data when no downloaded language data exists', async () => {
    mod.setupSettingsIPC();
    const handlers = mockIpcListeners.get('get-lang-data') ?? [];
    const event = makeEvent();
    for (const h of handlers) await h(event);
    expect(event.reply).toHaveBeenCalledWith('lang-data', {});
  });

  it('replies with lang data loaded from downloaded language-data directory', async () => {
    const langsDir = path.join(tempDir.tmpDir, 'language-data', 'languages');
    fs.mkdirSync(langsDir, { recursive: true });
    fs.writeFileSync(path.join(langsDir, 'zz.json'), JSON.stringify({ name: 'TestLang' }), 'utf-8');
    mod.setupSettingsIPC();
    const handlers = mockIpcListeners.get('get-lang-data') ?? [];
    const event = makeEvent();
    for (const h of handlers) await h(event);
    expect(event.reply).toHaveBeenCalledWith('lang-data', expect.objectContaining({ zz: expect.any(Object) }));
  });

  it('does not include uninstalled languages from the package catalog', async () => {
    const settingsPath = path.join(tempDir.tmpDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({
      languageCatalogUrl: 'https://pages.example.com/language-catalog.json',
    }), 'utf-8');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        languages: {
          it: {
            name: 'Italian',
            nameTranslated: 'Italiano',
            version: 'it-package-v1',
            bundle: {
              href: './language-data/language-it-package-v1.tar.gz',
              sizeBytes: 1,
              sha256: 'f'.repeat(64),
            },
            files: [],
          },
        },
      }),
    }));

    mod.setupSettingsIPC();
    const handlers = mockIpcListeners.get('get-lang-data') ?? [];
    const event = makeEvent();
    for (const h of handlers) await h(event);

    expect(event.reply).toHaveBeenCalledWith('lang-data', expect.not.objectContaining({
      it: expect.anything(),
    }));
  });
});

describe('GET_LANGUAGE_DATA_CATALOG IPC handler', () => {
  it('replies with install status for every language', async () => {
    const installedDir = path.join(tempDir.tmpDir, 'language-data', 'languages');
    fs.mkdirSync(installedDir, { recursive: true });
    fs.writeFileSync(path.join(installedDir, 'aa.freq.json'), JSON.stringify({ freq: [] }), 'utf-8');

    const settingsPath = path.join(tempDir.tmpDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({
      languageCatalogUrl: 'https://pages.example.com/language-catalog.json',
    }), 'utf-8');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        languages: {
          aa: {
            name: 'Alpha',
            version: 'aa-package-v1',
            bundle: { href: './aa.tar.gz', sizeBytes: 10, sha256: 'a'.repeat(64) },
            files: [{ id: 'freq', path: 'languages/aa.freq.json', sizeBytes: 9 }],
          },
          zz: {
            name: 'Zeta',
            version: 'zz-package-v1',
            bundle: { href: './zz.tar.gz', sizeBytes: 12, sha256: 'b'.repeat(64) },
            files: [{ id: 'freq', path: 'languages/zz.freq.json', sizeBytes: 12 }],
          },
        },
      }),
    }));

    mod.setupSettingsIPC();
    const handlers = mockIpcListeners.get('get-language-data-catalog') ?? [];
    const event = makeEvent();
    for (const h of handlers) await h(event);

    expect(event.reply).toHaveBeenCalledWith('language-data-catalog', [
      expect.objectContaining({
        language: 'aa',
        name: 'Alpha',
        installed: true,
        missingRequiredAssets: [],
      }),
      expect.objectContaining({
        language: 'zz',
        name: 'Zeta',
        installed: false,
        missingRequiredAssets: ['freq'],
      }),
    ]);
  });
});

describe('INSTALL_LANGUAGE_DATA IPC handler', () => {
  it('installs required language assets and replies with refreshed status', async () => {
    const archiveSourceDir = path.join(tempDir.tmpDir, 'archive-source');
    const archivePath = path.join(tempDir.tmpDir, 'aa.tar.gz');
    const frequencyBytes = JSON.stringify({ freq: [['alpha', 'alpha']] });
    const metadataBytes = JSON.stringify({
      name: 'Alpha',
      translatable: ['NOUN'],
      colour_codes: {},
      fixed_settings: {},
    });
    const manifestFiles = [
      {
        id: 'frequency',
        path: 'languages/aa.freq.json',
        sizeBytes: Buffer.byteLength(frequencyBytes),
        sha256: sha256(frequencyBytes),
        required: true,
      },
      {
        id: 'language-metadata',
        path: 'languages/aa.json',
        sizeBytes: Buffer.byteLength(metadataBytes),
        sha256: sha256(metadataBytes),
        required: true,
      },
    ];
    fs.mkdirSync(path.join(archiveSourceDir, 'files', 'languages'), { recursive: true });
    fs.writeFileSync(path.join(archiveSourceDir, 'manifest.json'), JSON.stringify({
      schemaVersion: 1,
      language: 'aa',
      version: 'aa-package-v1',
      files: manifestFiles,
    }), 'utf-8');
    fs.writeFileSync(path.join(archiveSourceDir, 'files', 'languages', 'aa.freq.json'), frequencyBytes, 'utf-8');
    fs.writeFileSync(path.join(archiveSourceDir, 'files', 'languages', 'aa.json'), metadataBytes, 'utf-8');
    await tar.c({ gzip: true, file: archivePath, cwd: archiveSourceDir }, ['manifest.json', 'files']);

    mockDownloadFileWithProgress.mockImplementation(async (_url: string, destPath: string) => {
      fs.copyFileSync(archivePath, destPath);
    });
    const settingsPath = path.join(tempDir.tmpDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({
      languageCatalogUrl: 'https://pages.example.com/language-catalog.json',
    }), 'utf-8');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        languages: {
          aa: {
            name: 'Alpha',
            version: 'aa-package-v1',
            bundle: {
              href: './aa.tar.gz',
              sizeBytes: fs.statSync(archivePath).size,
              sha256: sha256(fs.readFileSync(archivePath)),
            },
            files: manifestFiles,
          },
        },
      }),
    }));

    mod.setupSettingsIPC();
    const handlers = mockIpcListeners.get('install-language-data') ?? [];
    const event = makeEvent();
    for (const h of handlers) await h(event, 'aa');

    expect(fs.existsSync(path.join(tempDir.tmpDir, 'language-data', 'languages', 'aa.freq.json'))).toBe(true);
    expect(event.reply).toHaveBeenCalledWith('language-data-installed', expect.objectContaining({
      language: 'aa',
      installed: true,
      missingRequiredAssets: [],
    }));
    expect(event.reply).toHaveBeenCalledWith('language-data-catalog', [
      expect.objectContaining({
        language: 'aa',
        installed: true,
      }),
    ]);
  });

  it('replies with install errors without throwing', async () => {
    const settingsPath = path.join(tempDir.tmpDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({
      languageCatalogUrl: 'https://pages.example.com/language-catalog.json',
    }), 'utf-8');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        languages: {
          aa: {
            name: 'Alpha',
            version: 'aa-package-v1',
            bundle: {
              sizeBytes: 10,
              sha256: 'f'.repeat(64),
            },
            files: [{ id: 'missing', path: 'languages/missing.freq.json' }],
          },
        },
      }),
    }));

    mod.setupSettingsIPC();
    const handlers = mockIpcListeners.get('install-language-data') ?? [];
    const event = makeEvent();
    for (const h of handlers) await h(event, 'aa');

    expect(event.reply).toHaveBeenCalledWith('language-data-install-error', expect.objectContaining({
      language: 'aa',
      error: expect.stringContaining('No download URL for language data bundle'),
    }));
  });
});
