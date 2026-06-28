/**
 * Settings Service
 * Handles loading, saving, and IPC for application settings
 */

import fs from 'fs';
import path from 'path';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { Settings, DEFAULT_SETTINGS, LanguageCatalogEntry, LanguageCatalogManifest, LanguageData, LanguageDataAsset, LanguageDataBundle, LanguageDataMap } from '../../shared/types';
import { getUserDataPath, getAppPath, getResourcePath } from '../utils/platform';
import { setUILanguage } from './localization';
import { ensureLanguageDataInstalled, getLanguageDataCatalogStatus } from './languageDataService';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger('electron.settings');
const LANGUAGE_CATALOG_FETCH_TIMEOUT_MS = 5000;

let settingsSaveQueue: Promise<void> = Promise.resolve();

function getSettingsPath(): string {
  return path.join(getUserDataPath(), 'settings.json');
}

function didAnkiSettingsChange(prevSettings: Settings, nextSettings: Settings): boolean {
  return (
    prevSettings.use_anki !== nextSettings.use_anki ||
    prevSettings.ankiConnectUrl !== nextSettings.ankiConnectUrl ||
    prevSettings.anki_field_expression !== nextSettings.anki_field_expression ||
    prevSettings.anki_field_reading !== nextSettings.anki_field_reading ||
    prevSettings.anki_field_meaning !== nextSettings.anki_field_meaning ||
    prevSettings.language !== nextSettings.language
  );
}

export function loadSettings(): Settings {
  try {
    const settingsPath = getSettingsPath();
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf-8');
      const parsed: unknown = JSON.parse(data);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        log.warn('[settings] Loaded data is not a plain object — using defaults');
        return { ...DEFAULT_SETTINGS };
      }
      const loaded = parsed as Partial<Settings>;
      const migrated: Partial<Settings> = { ...loaded };
      if (!migrated.cloudAuthAccessToken && migrated.cloudAuthToken) {
        migrated.cloudAuthAccessToken = migrated.cloudAuthToken;
      }
      if (migrated.cloudAuthAccessToken && !migrated.cloudAuthStatus) {
        migrated.cloudAuthStatus = 'signed-in';
      }
      if (migrated.overrideCloudEndpointUrl && migrated.backendUrl && !migrated.cloudApiUrl) {
        migrated.cloudApiUrl = migrated.backendUrl;
        migrated.cloudLoginUrl = migrated.backendUrl;
      }
      return { ...DEFAULT_SETTINGS, ...migrated };
    }
  } catch (error) {
    log.error('Failed to load settings:', error);
  }
  return { ...DEFAULT_SETTINGS };
}

export async function saveSettings(settings: Settings): Promise<void> {
  const settingsPath = getSettingsPath();
  const serializedSettings = JSON.stringify(settings, null, 2);

  const queuedSave = settingsSaveQueue
    .catch(() => undefined)
    .then(async () => {
      const tmpPath = `${settingsPath}.tmp`;
      const dir = path.dirname(settingsPath);

      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(tmpPath, serializedSettings, 'utf-8');
      await fs.promises.rename(tmpPath, settingsPath);
    });

  settingsSaveQueue = queuedSave;

  try {
    await queuedSave;
  } catch (error) {
    log.error('Failed to save settings:', error);
  }
}

export function loadLangData(): LanguageDataMap {
  const langData: LanguageDataMap = {};
  const appPath = getAppPath();
  const resourcePath = getResourcePath();
  const candidateDirs = [
    path.join(appPath, 'root-of-app', 'languages'),
    path.join(resourcePath, 'root-of-app', 'languages'),
    path.join(appPath, 'languages'),
    path.join(resourcePath, 'languages'),
    path.join(getUserDataPath(), 'languages'),
    path.join(getUserDataPath(), 'language-data', 'languages'),
  ];
  const languagesDirs = candidateDirs.filter((dir, index, dirs) => fs.existsSync(dir) && dirs.indexOf(dir) === index);
  const frequencyDirs = [
    ...languagesDirs,
    path.join(getUserDataPath(), 'language-data', 'languages'),
  ].filter((dir, index, dirs) => fs.existsSync(dir) && dirs.indexOf(dir) === index);

  try {
    if (languagesDirs.length === 0) {
      log.warn('Languages directory not found:', candidateDirs.join(', '));
      return getDefaultLangData();
    }

    for (const languagesDir of languagesDirs) {
      const files = fs.readdirSync(languagesDir);

      for (const file of files) {
        if (file.endsWith('.json') && !file.endsWith('.freq.json')) {
          const langCode = path.basename(file, '.json');
          const filePath = path.join(languagesDir, file);
          try {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            langData[langCode] = data;
          } catch (e) {
            log.error(`Failed to load language file ${file}:`, e);
          }
        }
      }
    }

    for (const frequencyDir of frequencyDirs) {
      const files = fs.readdirSync(frequencyDir);

      for (const file of files) {
        if (!file.endsWith('.freq.json')) continue;
        const langCode = file.slice(0, -'.freq.json'.length);
        const filePath = path.join(frequencyDir, file);
        try {
          const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          if (Array.isArray(data.freq)) {
            langData[langCode] = {
              ...(langData[langCode] ?? getDefaultLangData()[langCode] ?? {}),
              freq: data.freq,
            } as LanguageDataMap[string];
          }
        } catch (e) {
          log.error(`Failed to load language frequency file ${file}:`, e);
        }
      }
    }
  } catch (error) {
    log.error('Failed to load language data:', error);
  }

  if (Object.keys(langData).length === 0) {
    return getDefaultLangData();
  }

  return langData;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeLanguageData(base: LanguageDataMap, overlay: LanguageDataMap): LanguageDataMap {
  const merged: LanguageDataMap = { ...base };
  for (const [language, metadata] of Object.entries(overlay)) {
    merged[language] = {
      ...(merged[language] ?? {}),
      ...metadata,
      languageData: metadata.languageData ?? merged[language]?.languageData,
      freq: metadata.freq ?? merged[language]?.freq,
      grammar: metadata.grammar ?? merged[language]?.grammar,
    } as LanguageData;
  }
  return merged;
}

function normalizeRemoteAsset(asset: LanguageDataAsset, catalogUrl: string): LanguageDataAsset {
  const assetUrl = asset.url ?? asset.href;
  if (!assetUrl) {
    return asset;
  }

  return {
    ...asset,
    url: new URL(assetUrl, catalogUrl).toString(),
  };
}

function normalizeRemoteBundle(bundle: LanguageDataBundle | undefined, catalogUrl: string): LanguageDataBundle | undefined {
  if (!bundle) {
    return undefined;
  }
  const bundleUrl = bundle.url ?? bundle.href;
  if (!bundleUrl) {
    return bundle;
  }
  return {
    ...bundle,
    url: new URL(bundleUrl, catalogUrl).toString(),
  };
}

function normalizeRemoteLanguageData(langData: LanguageDataMap, catalogUrl: string): LanguageDataMap {
  const normalized: LanguageDataMap = {};
  for (const [language, metadata] of Object.entries(langData)) {
    normalized[language] = {
      ...metadata,
      languageData: metadata.languageData
        ? {
          ...metadata.languageData,
          bundle: normalizeRemoteBundle(metadata.languageData.bundle, catalogUrl),
          assets: metadata.languageData.assets.map((asset) => normalizeRemoteAsset(asset, catalogUrl)),
        }
        : undefined,
    };
  }
  return normalized;
}

function parseLanguageCatalogManifest(value: unknown): LanguageCatalogManifest | null {
  if (!isRecord(value) || !isRecord(value.languages)) {
    return null;
  }

  const languages: LanguageCatalogManifest['languages'] = {};
  for (const [language, metadata] of Object.entries(value.languages)) {
    if (typeof metadata === 'string') {
      languages[language] = metadata;
      continue;
    }
    if (!isRecord(metadata)) {
      continue;
    }
    if (typeof metadata.name === 'string' || typeof metadata.url === 'string' || typeof metadata.href === 'string' || isRecord(metadata.bundle)) {
      languages[language] = metadata as unknown as LanguageData | LanguageCatalogEntry;
    }
  }

  return { languages };
}

function getLanguageManifestUrl(entry: LanguageCatalogEntry | string, catalogUrl: string): string | null {
  const manifestUrl = typeof entry === 'string' ? entry : entry.url ?? entry.href;
  if (!manifestUrl) {
    return null;
  }
  return new URL(manifestUrl, catalogUrl).toString();
}

function isLanguageData(value: unknown): value is LanguageData {
  return isRecord(value) && typeof value.name === 'string';
}

function isBundledCatalogEntry(value: unknown): value is LanguageCatalogEntry {
  return isRecord(value) && isRecord(value.bundle);
}

function languageDataFromCatalogEntry(
  language: string,
  entry: LanguageCatalogEntry,
  catalogUrl: string,
): LanguageData {
  const assets = Array.isArray(entry.files) ? entry.files.map((asset) => normalizeRemoteAsset(asset, catalogUrl)) : [];
  return {
    name: entry.name ?? language,
    name_translated: entry.nameTranslated,
    translatable: [],
    colour_codes: {},
    fixed_settings: {},
    languageData: {
      version: entry.version,
      bundle: normalizeRemoteBundle(entry.bundle, catalogUrl),
      assets,
    },
  };
}

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) {
    throw new Error(`Language catalog request failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function loadRemoteLanguageEntry(
  language: string,
  entry: LanguageCatalogManifest['languages'][string],
  catalogUrl: string,
  signal: AbortSignal,
): Promise<[string, LanguageData] | null> {
  if (isLanguageData(entry)) {
    if (isBundledCatalogEntry(entry) && !entry.languageData) {
      return [language, languageDataFromCatalogEntry(language, entry as LanguageCatalogEntry, catalogUrl)];
    }
    return [language, normalizeRemoteLanguageData({ [language]: entry }, catalogUrl)[language]];
  }

  if (typeof entry !== 'string' && !isRecord(entry)) {
    return null;
  }

  if (isBundledCatalogEntry(entry)) {
    return [language, languageDataFromCatalogEntry(language, entry as LanguageCatalogEntry, catalogUrl)];
  }

  const manifestUrl = getLanguageManifestUrl(entry as LanguageCatalogEntry | string, catalogUrl);
  if (!manifestUrl) {
    return null;
  }

  const manifest = await fetchJson(manifestUrl, signal);
  if (!isLanguageData(manifest)) {
    throw new Error(`Language manifest is invalid for ${language}`);
  }
  return [language, normalizeRemoteLanguageData({ [language]: manifest }, manifestUrl)[language]];
}

async function fetchRemoteLanguageCatalog(catalogUrl: string): Promise<LanguageDataMap> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LANGUAGE_CATALOG_FETCH_TIMEOUT_MS);
  try {
    const manifest = parseLanguageCatalogManifest(await fetchJson(catalogUrl, controller.signal));
    if (!manifest) {
      throw new Error('Language catalog manifest is invalid');
    }
    const entries = await Promise.all(
      Object.entries(manifest.languages).map(([language, entry]) => (
        loadRemoteLanguageEntry(language, entry, catalogUrl, controller.signal)
      )),
    );
    return Object.fromEntries(entries.filter((entry): entry is [string, LanguageData] => entry !== null));
  } finally {
    clearTimeout(timeout);
  }
}

export async function loadLanguageCatalogData(settings: Settings = loadSettings()): Promise<LanguageDataMap> {
  const localData = loadLangData();
  const catalogUrl = settings.languageCatalogUrl?.trim();
  if (!catalogUrl) {
    return localData;
  }

  try {
    const remoteData = await fetchRemoteLanguageCatalog(catalogUrl);
    return mergeLanguageData(localData, remoteData);
  } catch (error) {
    log.warn('Failed to load remote language catalog:', error);
    return localData;
  }
}

function getDefaultLangData(): LanguageDataMap {
  return {
    ja: {
      name: 'Japanese',
      name_translated: '日本語',
      translatable: ['名詞', '動詞', '形状詞', '副詞', '副詞節', '形容詞'],
      colour_codes: {
        '名詞': '#ebccfd',
        '動詞': '#d6cefd',
        '助詞': '#f5d7b8',
        '助動詞': '#ffefd1',
        '形状詞': '#def6ff',
        '副詞': '#b8cdf5',
        '接尾辞': '#aac8c4',
        '感動詞': '#eacbcb',
        '代名詞': '#f1ccfd',
        '補助記号': '#8fc99d',
        '連体詞': '#def6ff',
        '形容詞': '#def6ff',
        '形容動詞': '#def6ff',
        '記号': '#8fc99d',
      },
      fixed_settings: {},
      freq_level_names: {
        '5': 'N5',
        '4': 'N4',
        '3': 'N3',
        '2': 'N2',
        '1': 'N1',
      },
    },
    de: {
      name: 'German',
      name_translated: 'Deutsch',
      translatable: ['NOUN', 'VERB', 'ADJ', 'ADV'],
      colour_codes: {
        'NOUN': '#ebccfd',
        'PROPN': '#ebccfd',
        'PRON': '#fdccd3',
        'VERB': '#ffefd1',
        'SCONJ': '#f5d7b8',
        'PART': '#f5d7b8',
        'DET': '#cef5b8',
        'ADP': '#b8f5de',
        'AUX': '#ffefd1',
        'ADJ': '#def6ff',
        'ADV': '#b8cdf5',
        'PUNCT': '#8fc99d',
      },
      fixed_settings: {
        furigana: false,
        showPitchAccent: false,
      },
    },
  };
}

export function setupSettingsIPC(): void {
  ipcMain.on(IPC_CHANNELS.GET_SETTINGS, (event) => {
    const settings = loadSettings();
    event.reply(IPC_CHANNELS.SETTINGS, settings);
  });

  ipcMain.on(IPC_CHANNELS.SAVE_SETTINGS, async (event, settings: Settings) => {
    const prevSettings = loadSettings();
    await saveSettings(settings);
    event.reply(IPC_CHANNELS.SETTINGS_SAVED);

    if (settings.uiLanguage && settings.uiLanguage !== prevSettings.uiLanguage) {
      setUILanguage(settings.uiLanguage);
    }

    if (didAnkiSettingsChange(prevSettings, settings)) {
      const { refreshAnkiCards } = await import('./ankiService');
      await refreshAnkiCards(settings);
    }
  });

  ipcMain.on(IPC_CHANNELS.GET_LANG_DATA, async (event) => {
    const langData = await loadLanguageCatalogData();
    event.reply(IPC_CHANNELS.LANG_DATA, langData);
  });

  ipcMain.on(IPC_CHANNELS.GET_LANGUAGE_DATA_CATALOG, async (event) => {
    const langData = await loadLanguageCatalogData();
    event.reply(IPC_CHANNELS.LANGUAGE_DATA_CATALOG, getLanguageDataCatalogStatus(langData));
  });

  ipcMain.on(IPC_CHANNELS.INSTALL_LANGUAGE_DATA, async (event, language: string) => {
    try {
      const langData = await loadLanguageCatalogData();
      await ensureLanguageDataInstalled(language, langData);
      const catalog = getLanguageDataCatalogStatus(await loadLanguageCatalogData());
      const installedStatus = catalog.find((status) => status.language === language);
      event.reply(IPC_CHANNELS.LANGUAGE_DATA_INSTALLED, installedStatus);
      event.reply(IPC_CHANNELS.LANGUAGE_DATA_CATALOG, catalog);
    } catch (error) {
      event.reply(IPC_CHANNELS.LANGUAGE_DATA_INSTALL_ERROR, {
        language,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
