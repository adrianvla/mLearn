import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as tar from 'tar';
import { createTempDir } from '../../../test/helpers/tempDir';
import type { TempDir } from '../../../test/helpers/tempDir';
import { DEFAULT_SETTINGS } from '../../shared/types';

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
    getVersion: vi.fn(() => '2.6.7'),
    on: vi.fn(),
    isPackaged: false,
  },
}));

vi.mock('./localization', () => ({
  setUILanguage: vi.fn(),
}));

const mockDownloadFileWithProgress = vi.fn();
const mockEnsureLanguagePythonRequirementsInstalled = vi.hoisted(() => vi.fn());
const mockRestartPythonBackend = vi.hoisted(() => vi.fn());

vi.mock('../utils/downloadManager', () => ({
  downloadFileWithProgress: mockDownloadFileWithProgress,
}));

vi.mock('./pythonRuntimeRequirements', () => ({
  ensureLanguagePythonRequirementsInstalled: mockEnsureLanguagePythonRequirementsInstalled,
}));

vi.mock('./pythonBackend', () => ({
  restartPythonBackend: mockRestartPythonBackend,
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
  mockEnsureLanguagePythonRequirementsInstalled.mockReset();
  mockRestartPythonBackend.mockReset();
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

  it('treats installed language data as an existing profile even without settings.json', () => {
    const langsDir = path.join(tempDir.tmpDir, 'language-data', 'languages');
    fs.mkdirSync(langsDir, { recursive: true });
    fs.writeFileSync(path.join(langsDir, 'ja.json'), JSON.stringify({ name: 'Japanese' }), 'utf-8');
    fs.writeFileSync(path.join(langsDir, 'ja.freq.json'), JSON.stringify({ freq: [] }), 'utf-8');

    expect(mod.hasSettingsFile()).toBe(false);
    expect(mod.hasInstalledLanguageData()).toBe(true);
    expect(mod.hasExistingProfile()).toBe(true);
  });

  it('returns DEFAULT_SETTINGS when settings file does not exist', () => {
    const settings = mod.loadSettings();
    expect(settings).toBeDefined();
    expect(typeof settings).toBe('object');
    expect(settings.language).toBeDefined();
    expect(settings.languageCatalogUrl).toBe('https://mlearn.kikan.net/language-catalog.json');
  });

  it('recovers the selected language from a single installed language when settings file is missing', () => {
    const langsDir = path.join(tempDir.tmpDir, 'language-data', 'languages');
    fs.mkdirSync(langsDir, { recursive: true });
    fs.writeFileSync(path.join(langsDir, 'ja.json'), JSON.stringify({ name: 'Japanese' }), 'utf-8');
    fs.writeFileSync(path.join(langsDir, 'ja.freq.json'), JSON.stringify({ freq: [] }), 'utf-8');

    const settings = mod.loadSettings();

    expect(settings.language).toBe('ja');
  });

  it('does not guess a selected language from multiple installed languages when settings file is missing', () => {
    const langsDir = path.join(tempDir.tmpDir, 'language-data', 'languages');
    fs.mkdirSync(langsDir, { recursive: true });
    fs.writeFileSync(path.join(langsDir, 'de.json'), JSON.stringify({ name: 'German' }), 'utf-8');
    fs.writeFileSync(path.join(langsDir, 'ja.json'), JSON.stringify({ name: 'Japanese' }), 'utf-8');

    const settings = mod.loadSettings();

    expect(settings.language).toBe('');
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

  it('recovers a single installed language when settings file is not a plain object', () => {
    const settingsPath = path.join(tempDir.tmpDir, 'settings.json');
    const langsDir = path.join(tempDir.tmpDir, 'language-data', 'languages');
    fs.mkdirSync(langsDir, { recursive: true });
    fs.writeFileSync(settingsPath, 'null', 'utf-8');
    fs.writeFileSync(path.join(langsDir, 'fa.json'), JSON.stringify({ name: 'Farsi' }), 'utf-8');

    const settings = mod.loadSettings();

    expect(settings.language).toBe('fa');
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

  it('recovers the selected language from a single installed language on update', () => {
    const settingsPath = path.join(tempDir.tmpDir, 'settings.json');
    const langsDir = path.join(tempDir.tmpDir, 'language-data', 'languages');
    fs.mkdirSync(langsDir, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({ language: '' }), 'utf-8');
    fs.writeFileSync(path.join(langsDir, 'ja.json'), JSON.stringify({ name: 'Japanese' }), 'utf-8');
    fs.writeFileSync(path.join(langsDir, 'ja.freq.json'), JSON.stringify({ freq: [] }), 'utf-8');

    const settings = mod.loadSettings();

    expect(settings.language).toBe('ja');
  });

  it('migrates the legacy learning level to the selected language on update', () => {
    const settingsPath = path.join(tempDir.tmpDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({
      language: 'ja',
      learningLanguageLevel: 3,
      learningLanguageLevels: {},
    }), 'utf-8');

    const settings = mod.loadSettings();

    expect(settings.learningLanguageLevels.ja).toBe(3);
  });

  it('migrates the legacy learning level after recovering a single installed language', () => {
    const settingsPath = path.join(tempDir.tmpDir, 'settings.json');
    const langsDir = path.join(tempDir.tmpDir, 'language-data', 'languages');
    fs.mkdirSync(langsDir, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({
      language: '',
      learningLanguageLevel: 4,
      learningLanguageLevels: {},
    }), 'utf-8');
    fs.writeFileSync(path.join(langsDir, 'ja.json'), JSON.stringify({ name: 'Japanese' }), 'utf-8');

    const settings = mod.loadSettings();

    expect(settings.language).toBe('ja');
    expect(settings.learningLanguageLevels.ja).toBe(4);
  });

  it('ignores legacy Japanese-named settings instead of treating them as runtime API', () => {
    const settingsPath = path.join(tempDir.tmpDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({
      furigana: false,
      showPitchAccent: false,
      proportionOfExamCards: 0.25,
      ocrFuriganaDetection: false,
      ocrFuriganaWidthRatio: 2,
      ocrFuriganaNeighborWindowMultiplier: 3,
      ocrFuriganaNeighborLookahead: 5,
      readerFuriganaHider: true,
    }), 'utf-8');

    const settings = mod.loadSettings();

    expect(settings.showReadingAnnotations).toBe(DEFAULT_SETTINGS.showReadingAnnotations);
    expect(settings.showProsody).toBe(DEFAULT_SETTINGS.showProsody);
    expect(settings.proportionOfLevelCards).toBe(DEFAULT_SETTINGS.proportionOfLevelCards);
    expect(settings.ocrReadingAnnotationFiltering).toBe(DEFAULT_SETTINGS.ocrReadingAnnotationFiltering);
    expect(settings.ocrReadingAnnotationWidthRatio).toBe(DEFAULT_SETTINGS.ocrReadingAnnotationWidthRatio);
    expect(settings.ocrReadingAnnotationNeighborWindowMultiplier).toBe(DEFAULT_SETTINGS.ocrReadingAnnotationNeighborWindowMultiplier);
    expect(settings.ocrReadingAnnotationNeighborLookahead).toBe(DEFAULT_SETTINGS.ocrReadingAnnotationNeighborLookahead);
    expect(settings.readerReadingAnnotationHider).toBe(DEFAULT_SETTINGS.readerReadingAnnotationHider);
  });

  it('keeps neutral settings authoritative when legacy Japanese-named settings are present', () => {
    const settingsPath = path.join(tempDir.tmpDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({
      furigana: false,
      showReadingAnnotations: true,
      showPitchAccent: false,
      showProsody: true,
      proportionOfExamCards: 0.25,
      proportionOfLevelCards: 0.75,
    }), 'utf-8');

    const settings = mod.loadSettings();

    expect(settings.showReadingAnnotations).toBe(true);
    expect(settings.showProsody).toBe(true);
    expect(settings.proportionOfLevelCards).toBe(0.75);
  });

  it('does not guess a selected language when multiple languages are installed', () => {
    const settingsPath = path.join(tempDir.tmpDir, 'settings.json');
    const langsDir = path.join(tempDir.tmpDir, 'language-data', 'languages');
    fs.mkdirSync(langsDir, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({ language: '' }), 'utf-8');
    fs.writeFileSync(path.join(langsDir, 'de.json'), JSON.stringify({ name: 'German' }), 'utf-8');
    fs.writeFileSync(path.join(langsDir, 'ja.json'), JSON.stringify({ name: 'Japanese' }), 'utf-8');

    const settings = mod.loadSettings();

    expect(settings.language).toBe('');
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

  it('ignores unknown settings keys while loading', () => {
    const settingsPath = path.join(tempDir.tmpDir, 'settings.json');
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        language: 'de',
        unknownDisplayToggle: false,
        unknownNestedSetting: { enabled: true },
      }),
      'utf-8',
    );

    const settings = mod.loadSettings();

    expect(settings.language).toBe('de');
    const loadedRecord = settings as unknown as Record<string, unknown>;
    expect(loadedRecord.unknownDisplayToggle).toBeUndefined();
    expect(loadedRecord.unknownNestedSetting).toBeUndefined();
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

  it('does not persist unknown settings keys', async () => {
    const settings = {
      ...mod.loadSettings(),
      showReadingAnnotations: false,
      showProsody: false,
      unknownDisplayToggle: true,
      unknownNestedSetting: { enabled: true },
      furigana: true,
      showPitchAccent: true,
    } as ReturnType<typeof mod.loadSettings> & Record<string, unknown>;

    await mod.saveSettings(settings);

    const saved = JSON.parse(fs.readFileSync(path.join(tempDir.tmpDir, 'settings.json'), 'utf-8'));
    expect(saved.showReadingAnnotations).toBe(false);
    expect(saved.showProsody).toBe(false);
    expect(saved.unknownDisplayToggle).toBeUndefined();
    expect(saved.unknownNestedSetting).toBeUndefined();
    expect(saved.furigana).toBeUndefined();
    expect(saved.showPitchAccent).toBeUndefined();
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

  it('normalizes legacy installed language metadata before exposing runtime data', () => {
    const langsDir = path.join(tempDir.tmpDir, 'language-data', 'languages');
    const metadataPath = path.join(langsDir, 'zz.json');
    fs.mkdirSync(langsDir, { recursive: true });
    fs.writeFileSync(
      metadataPath,
      JSON.stringify({
        name: 'Zed',
        fixed_settings: { do_colour_codes: false },
        translatable: ['NOUN'],
        colour_codes: { NOUN: '#ffffff' },
        freq_level_names: { '1': 'A1' },
        freq_level_boundaries: [1000],
        grammar_level_names: { '1': 'Beginner' },
        supportedScripts: ['Latn'],
      }),
      'utf-8',
    );

    const langData = mod.loadLangData();
    const metadataOnDisk = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));

    expect(langData.zz).toMatchObject({
      settings: { fixed: { do_colour_codes: false } },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Latn'] },
        partOfSpeech: {
          translatable: ['NOUN'],
          colors: { NOUN: '#ffffff' },
        },
      },
      frequencyLevels: {
        names: { '1': 'A1' },
        boundaries: [1000],
      },
      grammarLevels: {
        names: { '1': 'Beginner' },
      },
    });
    expect(langData.zz).not.toHaveProperty('translatable');
    expect(langData.zz).not.toHaveProperty('colour_codes');
    expect(metadataOnDisk).toHaveProperty('fixed_settings');
    expect(metadataOnDisk).toHaveProperty('freq_level_names');
    expect(fs.existsSync(`${metadataPath}.bak-before-language-contract-v2`)).toBe(false);
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
      JSON.stringify({ name: 'Japanese', translatable: [], colour_codes: {}, settings: { fixed: {} } }),
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
      JSON.stringify({ name: 'Japanese', translatable: [], colour_codes: {}, settings: { fixed: {} } }),
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

  it('loads installed frequency files published as a top-level row array', () => {
    const installedFreqDir = path.join(tempDir.tmpDir, 'language-data', 'languages');
    fs.mkdirSync(installedFreqDir, { recursive: true });
    fs.writeFileSync(
      path.join(installedFreqDir, 'ru.json'),
      JSON.stringify({ name: 'Russian', settings: { fixed: {} } }),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(installedFreqDir, 'ru.freq.json'),
      JSON.stringify([['человек', 'челове́к']]),
      'utf-8',
    );

    const langData = mod.loadLangData();

    expect(langData['ru']?.freq).toEqual([['человек', 'челове́к']]);
  });

  it('hydrates every declared frequency provider from its language asset', () => {
    const installedFreqDir = path.join(tempDir.tmpDir, 'language-data', 'languages');
    fs.mkdirSync(installedFreqDir, { recursive: true });
    fs.writeFileSync(
      path.join(installedFreqDir, 'ru.json'),
      JSON.stringify({
        name: 'Russian',
        defaultFrequencyProvider: 'openrussian',
        frequencyProviders: {
          openrussian: {
            name: 'OpenRussian',
            assetId: 'frequency',
            frequencyLevels: { names: { '1': 'Common' } },
          },
          smartool: {
            name: 'SMARTool',
            assetId: 'frequency-smartool',
            defaultLevelSystem: 'cefr',
            levelSystems: {
              cefr: {
                name: 'CEFR',
                frequencyLevels: { names: { '1': 'A1' }, rowLevelIndex: 2 },
              },
            },
          },
        },
        languageData: {
          assets: [
            { id: 'frequency', path: 'languages/ru.freq.json', required: true },
            { id: 'frequency-smartool', path: 'languages/ru.smartool.freq.json', required: true },
          ],
        },
      }),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(installedFreqDir, 'ru.freq.json'),
      JSON.stringify([['человек', 'челове́к']]),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(installedFreqDir, 'ru.smartool.freq.json'),
      JSON.stringify({ freq: [['слово', 'слово', 1]] }),
      'utf-8',
    );

    const langData = mod.loadLangData();

    expect(langData['ru']?.frequencyProviders?.openrussian.freq).toEqual([['человек', 'челове́к']]);
    expect(langData['ru']?.frequencyProviders?.smartool.freq).toEqual([['слово', 'слово', 1]]);
    expect(langData['ru']?.frequencyProviders?.smartool.levelSystems?.cefr.frequencyLevels.names).toEqual({ '1': 'A1' });
  });

  it('hydrates declared language fonts from installed package assets', () => {
    const languagesDir = path.join(tempDir.tmpDir, 'language-data', 'languages');
    const fontsDir = path.join(tempDir.tmpDir, 'language-data', 'fonts', 'cu');
    fs.mkdirSync(languagesDir, { recursive: true });
    fs.mkdirSync(fontsDir, { recursive: true });
    fs.writeFileSync(path.join(fontsDir, 'Ponomar-Regular.woff2'), Buffer.from('font-data'));
    fs.writeFileSync(
      path.join(languagesDir, 'cu.json'),
      JSON.stringify({
        name: 'Church Slavonic',
        typography: {
          contentFontOptions: [{
            id: 'ponomar',
            name: 'Ponomar',
            fontFamily: 'Ponomar',
            assetId: 'font-ponomar',
          }],
        },
        languageData: {
          assets: [{ id: 'font-ponomar', path: 'fonts/cu/Ponomar-Regular.woff2', required: true }],
        },
      }),
      'utf-8',
    );

    const langData = mod.loadLangData();

    expect(langData.cu?.typography?.contentFontOptions?.[0].sourceDataUrl).toBe(
      `data:font/woff2;base64,${Buffer.from('font-data').toString('base64')}`,
    );
  });

  it('preserves explicit numeric levels from installed frequency files even when metadata is incomplete', () => {
    const installedFreqDir = path.join(tempDir.tmpDir, 'language-data', 'languages');
    fs.mkdirSync(installedFreqDir, { recursive: true });
    fs.writeFileSync(
      path.join(installedFreqDir, 'ja.json'),
      JSON.stringify({
        name: 'Japanese',
        translatable: [],
        colour_codes: {},
        settings: { fixed: {} },
        frequencyLevels: {
          names: { '5': 'JLPT N5' },
        },
      }),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(installedFreqDir, 'ja.freq.json'),
      JSON.stringify({ freq: [['赤い', 'あかい', 5]] }),
      'utf-8',
    );

    const langData = mod.loadLangData();

    expect(langData['ja']?.freq).toEqual([['赤い', 'あかい', 5]]);
    expect(langData['ja']?.frequencyLevels?.rowLevelIndex).toBe(2);
    expect(langData['ja']?.frequencyLevels?.names).toEqual({ '5': 'JLPT N5' });
  });

  it('migrates sectioned installed frequency files into numeric level rows before exposing runtime data', () => {
    const languagesDir = path.join(tempDir.tmpDir, 'language-data', 'languages');
    const metadataPath = path.join(languagesDir, 'ja.json');
    const frequencyPath = path.join(languagesDir, 'ja.freq.json');
    fs.mkdirSync(languagesDir, { recursive: true });
    fs.writeFileSync(
      metadataPath,
      JSON.stringify({ name: 'Japanese', translatable: [], colour_codes: {}, settings: { fixed: {} } }),
      'utf-8',
    );
    fs.writeFileSync(
      frequencyPath,
      JSON.stringify({
        freq: [
          ['N5', 'N5'],
          ['会う', 'あう'],
          ['', ''],
          ['N4', 'N4'],
          ['払う', 'はらう'],
        ],
      }),
      'utf-8',
    );

    const langData = mod.loadLangData();

    expect(langData['ja']?.freq).toEqual([
      ['会う', 'あう', 5],
      ['払う', 'はらう', 4],
    ]);
    expect(langData['ja']?.frequencyLevels).toEqual({
      names: { '5': 'N5', '4': 'N4' },
      difficulty: 'lower-is-harder',
      displayOrder: 'descending',
      rowLevelIndex: 2,
    });
    expect(JSON.parse(fs.readFileSync(frequencyPath, 'utf-8')).freq).toEqual([
      ['N5', 'N5'],
      ['会う', 'あう'],
      ['', ''],
      ['N4', 'N4'],
      ['払う', 'はらう'],
    ]);
    expect(JSON.parse(fs.readFileSync(metadataPath, 'utf-8'))).not.toHaveProperty('frequencyLevels');
    expect(fs.existsSync(`${frequencyPath}.bak-before-frequency-contract-v2`)).toBe(false);
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
        settings: { fixed: {} },
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
    expect(langData['ja']?.textProcessing?.partOfSpeech?.translatable).toEqual(['名詞']);
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
            minimumAppVersion: '2.7.0',
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
        minimumAppVersion: '2.7.0',
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

  it('rejects catalog entries with an invalid minimum app version', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        languages: {
          bad: {
            name: 'Bad Version',
            version: 'bad-package-v1',
            minimumAppVersion: '2.7',
            bundle: { href: './language-data/bad.tar.gz' },
            files: [],
          },
        },
      }),
    }));

    const langData = await mod.loadLanguagePackageCatalog({
      ...mod.loadSettings(),
      languageCatalogUrl: 'https://pages.example.com/language-catalog.json',
    });

    expect(langData).toEqual({});
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

  it('preserves component scopes from language package catalog assets', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        languages: {
          aa: {
            name: 'Alpha',
            version: 'aa-package-v1',
            bundle: {
              href: './language-data/aa.tar.gz',
              sizeBytes: 100,
              sha256: 'a'.repeat(64),
            },
            files: [
              {
                id: 'language-metadata',
                path: 'languages/aa.json',
                required: true,
              },
              {
                id: 'ocr-model',
                path: 'models/aa/ocr.bin',
                components: ['ocr', ''],
                required: true,
              },
            ],
            dictionaryPacks: {
              en: {
                targetLanguage: 'en',
                name: 'English',
                bundle: {
                  href: './language-data/aa-en.tar.gz',
                  sizeBytes: 200,
                  sha256: 'b'.repeat(64),
                },
                assets: [{
                  id: 'dictionary',
                  path: 'dictionaries/aa/en/dictionary.db',
                  components: ['core'],
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

    expect(langData.aa.languageData?.assets).toEqual([
      expect.objectContaining({
        id: 'language-metadata',
        components: undefined,
      }),
      expect.objectContaining({
        id: 'ocr-model',
        components: ['ocr'],
      }),
    ]);
    expect(langData.aa.languageData?.dictionaryPacks?.en.assets[0]).toMatchObject({
      id: 'dictionary',
      components: ['core'],
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
            settings: { fixed: {} },
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

  it('repairs active language requirements and restarts the backend when runtime components change', async () => {
    const settingsPath = path.join(tempDir.tmpDir, 'settings.json');
    const languagesDir = path.join(tempDir.tmpDir, 'language-data', 'languages');
    fs.mkdirSync(languagesDir, { recursive: true });
    fs.writeFileSync(path.join(languagesDir, 'de.json'), JSON.stringify({ name: 'German' }), 'utf-8');
    fs.writeFileSync(settingsPath, JSON.stringify({
      language: 'de',
      ocrEnabled: false,
      voiceEnabled: false,
      llmEnabled: false,
    }), 'utf-8');
    mockEnsureLanguagePythonRequirementsInstalled.mockResolvedValue(undefined);

    mod.setupSettingsIPC();
    const handlers = mockIpcListeners.get('save-settings') ?? [];
    const event = makeEvent();
    const settings = mod.loadSettings();
    settings.ocrEnabled = true;

    for (const handler of handlers) await handler(event, settings);

    expect(mockEnsureLanguagePythonRequirementsInstalled).toHaveBeenCalledWith(
      'de',
      expect.objectContaining({ de: expect.any(Object) }),
      { includeLLM: false, includeOCR: true, includeVoice: false },
    );
    expect(mockRestartPythonBackend).toHaveBeenCalledOnce();
  });

  it('does not restart the backend for a runtime-component change without installed language data', async () => {
    mod.setupSettingsIPC();
    const handlers = mockIpcListeners.get('save-settings') ?? [];
    const event = makeEvent();
    const settings = mod.loadSettings();
    settings.ocrEnabled = !(settings.ocrEnabled ?? DEFAULT_SETTINGS.ocrEnabled);

    for (const handler of handlers) await handler(event, settings);

    expect(mockEnsureLanguagePythonRequirementsInstalled).not.toHaveBeenCalled();
    expect(mockRestartPythonBackend).not.toHaveBeenCalled();
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
    const installedFrequency = JSON.stringify({ freq: [] });
    fs.writeFileSync(path.join(installedDir, 'aa.freq.json'), installedFrequency, 'utf-8');

    const settingsPath = path.join(tempDir.tmpDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({
      languageCatalogUrl: 'https://pages.example.com/language-catalog.json',
      devMode: true,
    }), 'utf-8');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        languages: {
          aa: {
            name: 'Alpha',
            version: 'aa-package-v1',
            bundle: { href: './aa.tar.gz', sizeBytes: 10, sha256: 'a'.repeat(64) },
            files: [{ id: 'freq', path: 'languages/aa.freq.json', sizeBytes: Buffer.byteLength(installedFrequency) }],
          },
          zz: {
            name: 'Zeta',
            version: 'zz-package-v1',
            minimumAppVersion: '2.7.0',
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
        compatible: true,
        minimumAppVersion: '2.7.0',
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
      textProcessing: {
        partOfSpeech: {
          translatable: ['NOUN'],
          colors: {},
        },
      },
      settings: { fixed: {} },
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

  it('ensures installed language-declared Python requirements for enabled components', async () => {
    const archiveSourceDir = path.join(tempDir.tmpDir, 'archive-source');
    const archivePath = path.join(tempDir.tmpDir, 'aa.tar.gz');
    const metadata = {
      name: 'Alpha',
      textProcessing: {
        partOfSpeech: {
          translatable: ['NOUN'],
          colors: {},
        },
      },
      settings: { fixed: {} },
      runtime: {
        python: {
          packagesByComponent: {
            core: ['alpha-core'],
            ocr: ['alpha-ocr'],
            voice: ['alpha-voice'],
          },
        },
      },
    };
    const metadataBytes = JSON.stringify(metadata);
    const manifestFiles = [
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
    fs.writeFileSync(path.join(archiveSourceDir, 'files', 'languages', 'aa.json'), metadataBytes, 'utf-8');
    await tar.c({ gzip: true, file: archivePath, cwd: archiveSourceDir }, ['manifest.json', 'files']);

    mockDownloadFileWithProgress.mockImplementation(async (_url: string, destPath: string) => {
      fs.copyFileSync(archivePath, destPath);
    });
    fs.writeFileSync(path.join(tempDir.tmpDir, 'settings.json'), JSON.stringify({
      languageCatalogUrl: 'https://pages.example.com/language-catalog.json',
      llmEnabled: false,
      ocrEnabled: true,
      voiceEnabled: true,
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

    expect(mockEnsureLanguagePythonRequirementsInstalled).toHaveBeenCalledWith(
      'aa',
      expect.objectContaining({
        aa: expect.objectContaining({
          runtime: metadata.runtime,
        }),
      }),
      {
        includeLLM: false,
        includeOCR: true,
        includeVoice: true,
      },
      expect.objectContaining({
        onStatus: expect.any(Function),
      }),
    );

    mockEnsureLanguagePythonRequirementsInstalled.mockClear();
    const explicitOptions = { includeLLM: false, includeOCR: true, includeVoice: false };
    const explicitEvent = makeEvent();
    for (const h of handlers) await h(explicitEvent, 'aa', undefined, explicitOptions);

    expect(mockEnsureLanguagePythonRequirementsInstalled).toHaveBeenCalledWith(
      'aa',
      expect.objectContaining({
        aa: expect.objectContaining({
          runtime: metadata.runtime,
        }),
      }),
      explicitOptions,
      expect.objectContaining({
        onStatus: expect.any(Function),
      }),
    );
  });

  it('does not silently substitute another dictionary pack when the requested target is unavailable', async () => {
    fs.writeFileSync(path.join(tempDir.tmpDir, 'settings.json'), JSON.stringify({
      languageCatalogUrl: 'https://pages.example.com/language-catalog.json',
      uiLanguage: 'en',
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
              sizeBytes: 1,
              sha256: 'unused',
            },
            files: [],
            dictionaryPacks: {
              fr: {
                targetLanguage: 'fr',
                name: 'French',
                bundle: {
                  href: './aa-fr.tar.gz',
                  sizeBytes: 1,
                  sha256: 'unused',
                },
                assets: [],
              },
            },
          },
        },
      }),
    }));

    mod.setupSettingsIPC();
    const handlers = mockIpcListeners.get('install-language-data') ?? [];
    const event = makeEvent();
    for (const h of handlers) await h(event, 'aa', 'en');

    expect(event.reply).toHaveBeenCalledWith('language-data-install-error', expect.objectContaining({
      language: 'aa',
      dictionaryTargetLanguage: 'en',
      error: 'No dictionary pack is available for aa->en. Available: fr',
    }));
    expect(event.reply).not.toHaveBeenCalledWith(
      'language-data-installed',
      expect.objectContaining({ language: 'aa' }),
    );
    expect(mockDownloadFileWithProgress).not.toHaveBeenCalled();
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
