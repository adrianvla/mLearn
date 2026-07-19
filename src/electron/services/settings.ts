/**
 * Settings Service
 * Handles loading, saving, and IPC for application settings
 */

import fs from 'fs';
import path from 'path';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { Settings, DEFAULT_SETTINGS, InstallOptions, LanguageCatalogEntry, LanguageData, LanguageDataAsset, LanguageDataBundle, LanguageDataMap, LanguageDictionaryPack, LanguagePythonRequirementComponent } from '../../shared/types';
import { getUserDataPath } from '../utils/platform';
import { setUILanguage } from './localization';
import { ensureLanguageDataInstalled, getLanguageDataCatalogStatus, resolveDictionaryTargetLanguage } from './languageDataService';
import { ensureLanguagePythonRequirementsInstalled } from './pythonRuntimeRequirements';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger('electron.settings');
const LANGUAGE_CATALOG_FETCH_TIMEOUT_MS = 5000;

let settingsSaveQueue: Promise<void> = Promise.resolve();

type LoadedSettings = Partial<Settings>;

type FrequencyFilePayload = {
  freq?: unknown;
};

type SectionedFrequencyMigration = {
  freq: [string, string, number][];
  frequencyLevels: NonNullable<LanguageData['frequencyLevels']>;
};

/**
 * @deprecated Compatibility shape for language metadata generated before the
 * runtime language package schema. New packages should emit `LanguageData`
 * directly.
 */
type LegacyLanguageMetadata = Record<string, unknown> & {
  fixed_settings?: unknown;
  translatable?: unknown;
  colour_codes?: unknown;
  freq_level_names?: unknown;
  freq_level_boundaries?: unknown;
  grammar_level_names?: unknown;
  supportedScripts?: unknown;
};

/**
 * @deprecated Normalizes old section-marker frequency files in memory. New
 * language packages should write explicit row-level frequency data directly.
 */
function withExplicitFrequencyRowLevels(
  payload: FrequencyFilePayload,
  languageData: LanguageDataMap[string] | undefined,
): FrequencyFilePayload & Pick<LanguageData, 'frequencyLevels'> {
  const frequencyLevels = { ...languageData?.frequencyLevels };
  if (
    frequencyLevels.rowLevelIndex === undefined &&
    Array.isArray(payload.freq) &&
    payload.freq.some((row) => Array.isArray(row) && Number.isFinite(Number(row[2])))
  ) {
    frequencyLevels.rowLevelIndex = 2;
  }

  return {
    ...payload,
    frequencyLevels: Object.keys(frequencyLevels).length > 0 ? frequencyLevels : undefined,
  };
}

function getSettingsPath(): string {
  return path.join(getUserDataPath(), 'settings.json');
}

export function hasSettingsFile(): boolean {
  return fs.existsSync(getSettingsPath());
}

function getInstalledLanguageCodes(): string[] {
  const languagesDir = path.join(getUserDataPath(), 'language-data', 'languages');
  if (!fs.existsSync(languagesDir)) {
    return [];
  }

  try {
    return fs.readdirSync(languagesDir)
      .filter((file) => file.endsWith('.json') && !file.endsWith('.freq.json'))
      .map((file) => path.basename(file, '.json'))
      .sort();
  } catch (error) {
    log.warn('Failed to infer installed language from language-data:', error);
    return [];
  }
}

function inferSingleInstalledLanguage(): string | null {
  const languageCodes = getInstalledLanguageCodes();
  return languageCodes.length === 1 ? languageCodes[0] : null;
}

export function hasInstalledLanguageData(): boolean {
  return getInstalledLanguageCodes().length > 0;
}

export function hasExistingProfile(): boolean {
  return hasSettingsFile() || hasInstalledLanguageData();
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

function keepKnownSettingsKeys(settings: Record<string, unknown>): LoadedSettings {
  const known = new Set(Object.keys(DEFAULT_SETTINGS));
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (known.has(key)) kept[key] = value;
  }
  return kept as LoadedSettings;
}

function normalizeLoadedSettings(settings: Record<string, unknown>): Settings {
  return { ...DEFAULT_SETTINGS, ...keepKnownSettingsKeys(settings) };
}

function settingsWithRecoveredInstalledLanguage(): Settings {
  const installedLanguage = inferSingleInstalledLanguage();
  return normalizeLoadedSettings(installedLanguage ? { language: installedLanguage } : {});
}

export function loadSettings(): Settings {
  try {
    const settingsPath = getSettingsPath();
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf-8');
      const parsed: unknown = JSON.parse(data);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        log.warn('[settings] Loaded data is not a plain object — using defaults');
        return settingsWithRecoveredInstalledLanguage();
      }
      const migrated: LoadedSettings = parsed as LoadedSettings;
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
      if (!migrated.language) {
        const installedLanguage = inferSingleInstalledLanguage();
        if (installedLanguage) {
          migrated.language = installedLanguage;
        }
      }
      if (migrated.language && migrated.learningLanguageLevel !== undefined) {
        const levels = migrated.learningLanguageLevels
          && typeof migrated.learningLanguageLevels === 'object'
          && !Array.isArray(migrated.learningLanguageLevels)
          ? migrated.learningLanguageLevels
          : {};
        if (levels[migrated.language] === undefined) {
          migrated.learningLanguageLevels = {
            ...levels,
            [migrated.language]: migrated.learningLanguageLevel,
          };
        }
      }
      return normalizeLoadedSettings(migrated);
    }
  } catch (error) {
    log.error('Failed to load settings:', error);
  }

  return settingsWithRecoveredInstalledLanguage();
}

export async function saveSettings(settings: Settings): Promise<void> {
  const settingsPath = getSettingsPath();
  const serializedSettings = JSON.stringify(keepKnownSettingsKeys({ ...settings }), null, 2);

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
            const data = normalizeInstalledLanguageMetadata(filePath, JSON.parse(fs.readFileSync(filePath, 'utf-8')));
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
          const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          const payload: FrequencyFilePayload = Array.isArray(parsed)
            ? { freq: parsed }
            : isRecord(parsed)
              ? parsed
              : {};
          const data = migrateFrequencyFileIfNeeded(
            filePath,
            payload,
            langData[langCode],
          );
          if (Array.isArray(data.freq) && langData[langCode]) {
            langData[langCode] = {
              ...langData[langCode],
              freq: data.freq,
              frequencyLevels: data.frequencyLevels ?? langData[langCode].frequencyLevels,
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

function parseSectionMarkerLevel(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/(\d+)/);
  if (!match) return null;
  const level = Number(match[1]);
  return Number.isFinite(level) ? level : null;
}

function getSectionMarker(row: unknown): { label: string; level: number } | null {
  if (!Array.isArray(row) || row.length !== 2) return null;
  const [surface, reading] = row;
  if (typeof surface !== 'string' || typeof reading !== 'string') return null;
  const label = surface.trim();
  if (!label || label !== reading.trim()) return null;
  const level = parseSectionMarkerLevel(label);
  return level === null ? null : { label, level };
}

/**
 * @deprecated Converts old section-marker frequency files to explicit row-level
 * payloads. Keep only for already-installed development/user files.
 */
function migrateSectionedFrequencyPayload(payload: FrequencyFilePayload): SectionedFrequencyMigration | null {
  if (!Array.isArray(payload.freq)) return null;

  const markers = payload.freq
    .map((row) => getSectionMarker(row))
    .filter((marker): marker is { label: string; level: number } => marker !== null);
  const uniqueMarkerLevels = new Set(markers.map((marker) => marker.level));
  if (uniqueMarkerLevels.size < 2) return null;

  const names: Record<string, string> = {};
  for (const marker of markers) {
    names[String(marker.level)] = marker.label;
  }

  let currentLevel: number | null = null;
  const migratedRows: [string, string, number][] = [];
  for (const row of payload.freq) {
    const marker = getSectionMarker(row);
    if (marker) {
      currentLevel = marker.level;
      continue;
    }
    if (!Array.isArray(row) || row.length < 2) continue;
    const [surface, reading] = row;
    if (typeof surface !== 'string' || typeof reading !== 'string') continue;
    if (!surface.trim() && !reading.trim()) continue;
    if (currentLevel === null) continue;
    migratedRows.push([surface, reading, currentLevel]);
  }

  if (migratedRows.length === 0) return null;

  const markerLevels = Array.from(uniqueMarkerLevels);
  const firstLevel = markerLevels[0] ?? 0;
  const lastLevel = markerLevels[markerLevels.length - 1] ?? firstLevel;
  const descendingMarkers = firstLevel > lastLevel;

  return {
    freq: migratedRows,
    frequencyLevels: {
      names,
      difficulty: descendingMarkers ? 'lower-is-harder' : 'higher-is-harder',
      displayOrder: descendingMarkers ? 'descending' : 'ascending',
      rowLevelIndex: 2,
    },
  };
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : undefined;
}

function numberArray(value: unknown): number[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'number' && Number.isFinite(item))
    ? value
    : undefined;
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value);
  return entries.every(([, item]) => typeof item === 'string')
    ? Object.fromEntries(entries) as Record<string, string>
    : undefined;
}

/**
 * @deprecated Accepts older language metadata key names from already-installed
 * files. New language packages should publish the current `LanguageData` schema
 * and should not rely on this normalization.
 */
function normalizeInstalledLanguageMetadata(filePath: string, data: unknown): LanguageData {
  if (!isRecord(data)) {
    throw new Error(`Language metadata must be a JSON object: ${path.basename(filePath)}`);
  }
  const source = data as LegacyLanguageMetadata;
  const normalized = { ...source } as LanguageData & Record<string, unknown>;

  const legacyFixedSettings = isRecord(source.fixed_settings) ? source.fixed_settings : undefined;
  if (legacyFixedSettings) {
    normalized.settings = {
      ...(normalized.settings ?? {}),
      fixed: {
        ...legacyFixedSettings,
        ...normalized.settings?.fixed,
      },
    } as LanguageData['settings'];
  }

  const legacyTranslatable = stringArray(source.translatable);
  const legacyColors = isRecord(source.colour_codes) ? source.colour_codes : undefined;
  if (legacyTranslatable || legacyColors) {
    normalized.textProcessing = {
      ...(normalized.textProcessing ?? {}),
      partOfSpeech: {
        ...(legacyTranslatable ? { translatable: legacyTranslatable } : {}),
        ...(legacyColors ? { colors: legacyColors } : {}),
        ...normalized.textProcessing?.partOfSpeech,
      },
    } as LanguageData['textProcessing'];
  }

  const legacyFrequencyLevelNames = stringRecord(source.freq_level_names);
  const legacyFrequencyBoundaries = numberArray(source.freq_level_boundaries);
  if (legacyFrequencyLevelNames || legacyFrequencyBoundaries) {
    normalized.frequencyLevels = {
      ...(legacyFrequencyLevelNames ? { names: legacyFrequencyLevelNames } : {}),
      ...(legacyFrequencyBoundaries ? { boundaries: legacyFrequencyBoundaries } : {}),
      ...normalized.frequencyLevels,
      names: {
        ...legacyFrequencyLevelNames,
        ...normalized.frequencyLevels?.names,
      },
    } as LanguageData['frequencyLevels'];
  }

  const legacyGrammarLevelNames = stringRecord(source.grammar_level_names);
  if (legacyGrammarLevelNames) {
    normalized.grammarLevels = {
      ...normalized.grammarLevels,
      names: {
        ...legacyGrammarLevelNames,
        ...normalized.grammarLevels?.names,
      },
    };
  }

  const legacySupportedScripts = stringArray(source.supportedScripts);
  if (legacySupportedScripts) {
    normalized.textProcessing = {
      ...(normalized.textProcessing ?? {}),
      scriptProfile: {
        acceptedScripts: legacySupportedScripts,
        ...normalized.textProcessing?.scriptProfile,
      },
    } as LanguageData['textProcessing'];
  }

  for (const key of [
    'fixed_settings',
    'translatable',
    'colour_codes',
    'freq_level_names',
    'freq_level_boundaries',
    'grammar_level_names',
    'supportedScripts',
  ]) {
    if (key in normalized) {
      delete normalized[key];
    }
  }

  // Keep downloaded package files immutable. The catalog checksum describes the
  // bytes on disk, so contract normalization must happen in memory only.
  return normalized;
}

/**
 * @deprecated Wrapper for old frequency-file formats. New language packages
 * should include `frequencyLevels.rowLevelIndex` and explicit row levels.
 */
function migrateFrequencyFileIfNeeded(
  _filePath: string,
  payload: FrequencyFilePayload,
  languageData: LanguageDataMap[string] | undefined,
): FrequencyFilePayload & Pick<LanguageData, 'frequencyLevels'> {
  const migration = migrateSectionedFrequencyPayload(payload);
  if (!migration) return withExplicitFrequencyRowLevels(payload, languageData);

  const frequencyLevels: LanguageData['frequencyLevels'] = languageData
    ? {
        ...migration.frequencyLevels,
        ...languageData.frequencyLevels,
        names: {
          ...migration.frequencyLevels.names,
          ...languageData.frequencyLevels?.names,
        },
        rowLevelIndex: languageData.frequencyLevels?.rowLevelIndex ?? migration.frequencyLevels.rowLevelIndex,
      }
    : migration.frequencyLevels;

  return { ...payload, freq: migration.freq, frequencyLevels };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeCatalogAsset(value: unknown): LanguageDataAsset | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.path !== 'string') {
    return null;
  }
  const components = Array.isArray(value.components)
    ? value.components.filter((component): component is LanguagePythonRequirementComponent => typeof component === 'string' && component.length > 0)
    : undefined;
  return {
    id: value.id,
    path: value.path,
    components: components && components.length > 0 ? components : undefined,
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

function getEnabledLanguageDataComponents(settings: Settings): LanguagePythonRequirementComponent[] {
  const components: LanguagePythonRequirementComponent[] = ['core'];
  if (settings.ocrEnabled ?? DEFAULT_SETTINGS.ocrEnabled) components.push('ocr');
  if (settings.voiceEnabled ?? DEFAULT_SETTINGS.voiceEnabled) components.push('voice');
  if (settings.llmEnabled ?? DEFAULT_SETTINGS.llmEnabled) components.push('llm');
  return components;
}

function getInstallOptionsFromSettings(settings: Settings): InstallOptions {
  return {
    includeLLM: settings.llmEnabled ?? DEFAULT_SETTINGS.llmEnabled,
    includeOCR: settings.ocrEnabled ?? DEFAULT_SETTINGS.ocrEnabled,
    includeVoice: settings.voiceEnabled ?? DEFAULT_SETTINGS.voiceEnabled,
  };
}

function didLanguageRuntimeComponentSettingsChange(prevSettings: Settings, nextSettings: Settings): boolean {
  return (
    prevSettings.language !== nextSettings.language ||
    (prevSettings.ocrEnabled ?? DEFAULT_SETTINGS.ocrEnabled) !== (nextSettings.ocrEnabled ?? DEFAULT_SETTINGS.ocrEnabled) ||
    (prevSettings.voiceEnabled ?? DEFAULT_SETTINGS.voiceEnabled) !== (nextSettings.voiceEnabled ?? DEFAULT_SETTINGS.voiceEnabled) ||
    (prevSettings.llmEnabled ?? DEFAULT_SETTINGS.llmEnabled) !== (nextSettings.llmEnabled ?? DEFAULT_SETTINGS.llmEnabled)
  );
}

async function repairActiveLanguagePythonRequirements(settings: Settings): Promise<boolean> {
  if (!settings.language) return false;

  const installedLanguageData = loadLangData();
  if (!installedLanguageData[settings.language]) return false;

  await ensureLanguagePythonRequirementsInstalled(
    settings.language,
    installedLanguageData,
    getInstallOptionsFromSettings(settings),
  );
  return true;
}

function getLanguageDataComponentsFromInstallOptions(options: InstallOptions): LanguagePythonRequirementComponent[] {
  const components: LanguagePythonRequirementComponent[] = ['core'];
  if (options.includeOCR) components.push('ocr');
  if (options.includeVoice) components.push('voice');
  if (options.includeLLM) components.push('llm');
  return components;
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

    if (didLanguageRuntimeComponentSettingsChange(prevSettings, settings)) {
      try {
        if (await repairActiveLanguagePythonRequirements(settings)) {
          const { restartPythonBackend } = await import('./pythonBackend');
          restartPythonBackend();
        }
      } catch (error) {
        log.error('Failed to repair language runtime requirements after settings change:', error);
      }
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

  ipcMain.on(IPC_CHANNELS.INSTALL_LANGUAGE_DATA, async (event, language: string, dictionaryTargetLanguage?: string, installOptions?: InstallOptions) => {
    try {
      const settings = loadSettings();
      const langData = await loadLanguagePackageCatalog();
      const effectiveInstallOptions = installOptions ?? getInstallOptionsFromSettings(settings);
      const components = installOptions
        ? getLanguageDataComponentsFromInstallOptions(effectiveInstallOptions)
        : getEnabledLanguageDataComponents(settings);
      await ensureLanguageDataInstalled(language, langData, undefined, undefined, { components });
      await ensureLanguagePythonRequirementsInstalled(language, loadLangData(), effectiveInstallOptions, {
        onStatus: (message) => event.reply(IPC_CHANNELS.SERVER_STATUS_UPDATE, message),
      });
      const resolvedDictionaryTarget = dictionaryTargetLanguage
        ? resolveDictionaryTargetLanguage(language, langData, dictionaryTargetLanguage)
        : undefined;
      const dictionaryPacks = langData[language]?.languageData?.dictionaryPacks;
      const requestedDictionaryTarget = dictionaryTargetLanguage;
      if (requestedDictionaryTarget && dictionaryPacks && !resolvedDictionaryTarget) {
        const availableTargets = Object.keys(dictionaryPacks).sort();
        throw new Error(
          `No dictionary pack is available for ${language}->${requestedDictionaryTarget}. Available: ${availableTargets.join(', ') || 'none'}`,
        );
      }
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
        dictionaryTargetLanguage,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
