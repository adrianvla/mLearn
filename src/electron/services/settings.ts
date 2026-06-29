/**
 * Settings Service
 * Handles loading, saving, and IPC for application settings
 */

import fs from 'fs';
import path from 'path';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { Settings, DEFAULT_SETTINGS, LanguageCatalogEntry, LanguageData, LanguageDataAsset, LanguageDataBundle, LanguageDataMap, LanguageDictionaryPack } from '../../shared/types';
import { getUserDataPath } from '../utils/platform';
import { setUILanguage } from './localization';
import { ensureLanguageDataInstalled, getLanguageDataCatalogStatus, resolveDictionaryTargetLanguage } from './languageDataService';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger('electron.settings');
const LANGUAGE_CATALOG_FETCH_TIMEOUT_MS = 5000;

let settingsSaveQueue: Promise<void> = Promise.resolve();

function getSettingsPath(): string {
  return path.join(getUserDataPath(), 'settings.json');
}

export function hasSettingsFile(): boolean {
  return fs.existsSync(getSettingsPath());
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
  const candidateDirs = [
    path.join(getUserDataPath(), 'language-data', 'languages'),
  ];
  const languagesDirs = candidateDirs.filter((dir, index, dirs) => fs.existsSync(dir) && dirs.indexOf(dir) === index);

  try {
    if (languagesDirs.length === 0) {
      log.info('No installed language data found:', candidateDirs.join(', '));
      return {};
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

    for (const frequencyDir of languagesDirs) {
      const files = fs.readdirSync(frequencyDir);

      for (const file of files) {
        if (!file.endsWith('.freq.json')) continue;
        const langCode = file.slice(0, -'.freq.json'.length);
        const filePath = path.join(frequencyDir, file);
        try {
          const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          if (Array.isArray(data.freq) && langData[langCode]) {
            langData[langCode] = {
              ...langData[langCode],
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

  return langData;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeCatalogAsset(value: unknown): LanguageDataAsset | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.path !== 'string') {
    return null;
  }
  return {
    id: value.id,
    path: value.path,
    bundledPath: typeof value.bundledPath === 'string' ? value.bundledPath : undefined,
    url: typeof value.url === 'string' ? value.url : undefined,
    href: typeof value.href === 'string' ? value.href : undefined,
    sizeBytes: typeof value.sizeBytes === 'number' ? value.sizeBytes : undefined,
    sha256: typeof value.sha256 === 'string' ? value.sha256 : undefined,
    required: typeof value.required === 'boolean' ? value.required : undefined,
  };
}

function normalizeCatalogBundle(value: unknown, catalogUrl: string): LanguageDataBundle | null {
  if (!isRecord(value)) {
    return null;
  }
  const bundle: LanguageDataBundle = {
    sizeBytes: typeof value.sizeBytes === 'number' ? value.sizeBytes : undefined,
    sha256: typeof value.sha256 === 'string' ? value.sha256 : undefined,
  };
  if (typeof value.href === 'string') {
    bundle.href = value.href;
  }
  if (typeof value.url === 'string') {
    bundle.url = new URL(value.url, catalogUrl).toString();
  } else if (typeof value.href === 'string') {
    bundle.url = new URL(value.href, catalogUrl).toString();
  }
  return bundle;
}

function normalizeDictionaryPacks(value: unknown, catalogUrl: string): Record<string, LanguageDictionaryPack> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const packs: Record<string, LanguageDictionaryPack> = {};
  for (const [targetLanguage, packValue] of Object.entries(value)) {
    if (!isRecord(packValue) || !Array.isArray(packValue.assets)) {
      continue;
    }
    const bundle = normalizeCatalogBundle(packValue.bundle, catalogUrl);
    if (!bundle) {
      continue;
    }
    const assets = packValue.assets
      .map((asset) => normalizeCatalogAsset(asset))
      .filter((asset): asset is LanguageDataAsset => asset !== null);
    packs[targetLanguage] = {
      targetLanguage: typeof packValue.targetLanguage === 'string' ? packValue.targetLanguage : targetLanguage,
      name: typeof packValue.name === 'string' ? packValue.name : targetLanguage.toUpperCase(),
      version: typeof packValue.version === 'string' ? packValue.version : undefined,
      bundle,
      assets,
    };
  }

  return Object.keys(packs).length > 0 ? packs : undefined;
}

function normalizeCatalogEntry(language: string, value: unknown, catalogUrl: string): LanguageCatalogEntry | null {
  if (!isRecord(value) || !isRecord(value.bundle) || !Array.isArray(value.files)) {
    return null;
  }
  const bundle = normalizeCatalogBundle(value.bundle, catalogUrl);
  if (!bundle) {
    return null;
  }
  const files = value.files
    .map((asset) => normalizeCatalogAsset(asset))
    .filter((asset): asset is LanguageDataAsset => asset !== null);
  return {
    name: typeof value.name === 'string' ? value.name : language,
    nameTranslated: typeof value.nameTranslated === 'string' ? value.nameTranslated : undefined,
    version: typeof value.version === 'string' ? value.version : `${language}-v1`,
    bundle,
    files,
    dictionaryPacks: normalizeDictionaryPacks(value.dictionaryPacks, catalogUrl),
  };
}

function languageDataFromCatalogEntry(entry: LanguageCatalogEntry): LanguageData {
  return {
    name: entry.name,
    name_translated: entry.nameTranslated,
    translatable: [],
    colour_codes: {},
    fixed_settings: {},
    languageData: {
      version: entry.version,
      bundle: entry.bundle,
      assets: entry.files,
      dictionaryPacks: entry.dictionaryPacks,
    },
  };
}

function parseLanguageCatalogManifest(value: unknown, catalogUrl: string): LanguageDataMap | null {
  if (!isRecord(value) || !isRecord(value.languages)) {
    return null;
  }

  const languages: LanguageDataMap = {};
  for (const [language, metadata] of Object.entries(value.languages)) {
    const entry = normalizeCatalogEntry(language, metadata, catalogUrl);
    if (entry) {
      languages[language] = languageDataFromCatalogEntry(entry);
    }
  }

  return languages;
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

async function fetchRemoteLanguageCatalog(catalogUrl: string): Promise<LanguageDataMap> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LANGUAGE_CATALOG_FETCH_TIMEOUT_MS);
  try {
    const manifest = parseLanguageCatalogManifest(await fetchJson(catalogUrl, controller.signal), catalogUrl);
    if (!manifest) {
      throw new Error('Language catalog manifest is invalid');
    }
    return manifest;
  } finally {
    clearTimeout(timeout);
  }
}

export async function loadLanguagePackageCatalog(settings: Settings = loadSettings()): Promise<LanguageDataMap> {
  const catalogUrl = settings.languageCatalogUrl?.trim();
  if (!catalogUrl) {
    return {};
  }

  try {
    return await fetchRemoteLanguageCatalog(catalogUrl);
  } catch (error) {
    log.warn('Failed to load remote language catalog:', error);
    return {};
  }
}

export async function loadLanguageCatalogData(_settings: Settings = loadSettings()): Promise<LanguageDataMap> {
  return loadLangData();
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
    const langData = loadLangData();
    event.reply(IPC_CHANNELS.LANG_DATA, langData);
  });

  ipcMain.on(IPC_CHANNELS.GET_LANGUAGE_DATA_CATALOG, async (event) => {
    const langData = await loadLanguagePackageCatalog();
    event.reply(IPC_CHANNELS.LANGUAGE_DATA_CATALOG, getLanguageDataCatalogStatus(langData));
  });

  ipcMain.on(IPC_CHANNELS.INSTALL_LANGUAGE_DATA, async (event, language: string, dictionaryTargetLanguage?: string) => {
    try {
      const langData = await loadLanguagePackageCatalog();
      await ensureLanguageDataInstalled(language, langData);
      const resolvedDictionaryTarget = resolveDictionaryTargetLanguage(language, langData, dictionaryTargetLanguage);
      if (resolvedDictionaryTarget) {
        await ensureLanguageDataInstalled(language, langData, undefined, resolvedDictionaryTarget);
      }
      const catalog = getLanguageDataCatalogStatus(await loadLanguagePackageCatalog());
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
