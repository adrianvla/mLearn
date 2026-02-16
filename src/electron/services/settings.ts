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

// Setup IPC handlers for settings
export function setupSettingsIPC(): void {
  ipcMain.on(IPC_CHANNELS.GET_SETTINGS, (event) => {
    const settings = loadSettings();
    event.reply(IPC_CHANNELS.SETTINGS, settings);
  });

  ipcMain.on(IPC_CHANNELS.SAVE_SETTINGS, (event, settings: Settings) => {
    const prevSettings = loadSettings();
    saveSettings(settings);
    event.reply(IPC_CHANNELS.SETTINGS_SAVED);

    // If uiLanguage changed, update localization for all windows
    if (settings.uiLanguage && settings.uiLanguage !== prevSettings.uiLanguage) {
      setUILanguage(settings.uiLanguage);
    }
  });

  ipcMain.on(IPC_CHANNELS.GET_LANG_DATA, (event) => {
    const langData = loadLangData();
    event.reply(IPC_CHANNELS.LANG_DATA, langData);
  });
}
