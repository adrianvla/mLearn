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

// Settings file path
function getSettingsPath(): string {
  return path.join(getUserDataPath(), 'settings.json');
}

// Load settings from disk
export function loadSettings(): Settings {
  try {
    const settingsPath = getSettingsPath();
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf-8');
      const loaded = JSON.parse(data) as Partial<Settings>;
      // Merge with defaults to ensure all keys exist
      return { ...DEFAULT_SETTINGS, ...loaded };
    }
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
  return { ...DEFAULT_SETTINGS };
}

// Save settings to disk
export function saveSettings(settings: Settings): void {
  try {
    const settingsPath = getSettingsPath();
    const dir = path.dirname(settingsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  } catch (error) {
    console.error('Failed to save settings:', error);
  }
}

// Load language data from bundled files
export function loadLangData(): LanguageDataMap {
  const langData: LanguageDataMap = {};
  const appPath = getAppPath();
  const resourcePath = getResourcePath();
  const candidateDirs = [
    path.join(appPath, 'languages'),
    path.join(resourcePath, 'languages'),
    path.join(appPath, 'root-of-app', 'languages'),
    path.join(resourcePath, 'root-of-app', 'languages'),
  ];
  const languagesDir = candidateDirs.find((dir) => fs.existsSync(dir));

  try {
    // Check if languages directory exists
    if (!languagesDir) {
      console.warn('Languages directory not found:', candidateDirs.join(', '));
      return getDefaultLangData();
    }

    const files = fs.readdirSync(languagesDir);
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        const langCode = path.basename(file, '.json');
        const filePath = path.join(languagesDir, file);
        try {
          const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          langData[langCode] = data;
        } catch (e) {
          console.error(`Failed to load language file ${file}:`, e);
        }
      }
    }
  } catch (error) {
    console.error('Failed to load language data:', error);
  }

  // Return default if nothing loaded
  if (Object.keys(langData).length === 0) {
    return getDefaultLangData();
  }

  return langData;
}

// Default language data for Japanese
function getDefaultLangData(): LanguageDataMap {
  return {
    ja: {
      name: 'Japanese',
      translatable: true,
      colour_codes: {
        '名詞': '#4a90d9',
        '動詞': '#e74c3c',
        '形容詞': '#2ecc71',
        '副詞': '#9b59b6',
        '助詞': '#95a5a6',
        '助動詞': '#e67e22',
        '接続詞': '#1abc9c',
        '感動詞': '#f1c40f',
        '連体詞': '#3498db',
        '接頭詞': '#e91e63',
        '接尾辞': '#00bcd4',
        '記号': '#607d8b',
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
      translatable: true,
      colour_codes: {
        'NOUN': '#4a90d9',
        'VERB': '#e74c3c',
        'ADJ': '#2ecc71',
        'ADV': '#9b59b6',
        'ADP': '#95a5a6',
        'CONJ': '#1abc9c',
        'DET': '#e67e22',
        'PRON': '#f1c40f',
      },
      fixed_settings: {
        furigana: false,
        showPitchAccent: false,
      },
    },
  };
}

// Setup IPC handlers for settings
export function setupSettingsIPC(): void {
  ipcMain.on(IPC_CHANNELS.GET_SETTINGS, (event) => {
    const settings = loadSettings();
    event.reply(IPC_CHANNELS.SETTINGS, settings);
  });

  ipcMain.on(IPC_CHANNELS.SAVE_SETTINGS, (event, settings: Settings) => {
    saveSettings(settings);
    event.reply(IPC_CHANNELS.SETTINGS_SAVED);
  });

  ipcMain.on(IPC_CHANNELS.GET_LANG_DATA, (event) => {
    const langData = loadLangData();
    event.reply(IPC_CHANNELS.LANG_DATA, langData);
  });
}
