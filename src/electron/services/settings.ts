/**
 * Settings Service
 * Handles loading, saving, and IPC for application settings
 */

import fs from 'fs';
import path from 'path';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { Settings, DEFAULT_SETTINGS, LanguageDataMap } from '../../shared/types';
import { getUserDataPath, getAppPath, getResourcePath } from '../utils/platform';
import { setUILanguage } from './localization';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger('electron.settings');

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

  ipcMain.on(IPC_CHANNELS.GET_LANG_DATA, (event) => {
    const langData = loadLangData();
    event.reply(IPC_CHANNELS.LANG_DATA, langData);
  });
}
