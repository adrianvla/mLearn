/**
 * Localization Service
 * Handles loading and IPC for UI localization strings
 */

import fs from 'fs';
import path from 'path';
import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { getAppPath, getResourcePath } from '../utils/platform';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger('electron.localization');

export type LocaleStrings = Record<string, unknown>;

// Currently loaded locale
let currentLocale = 'en';
let localeData: LocaleStrings = {};

/**
 * Find the locales directory
 */
function getLocalesDir(): string | null {
  const appPath = getAppPath();
  const resourcePath = getResourcePath();
  
  const candidateDirs = [
    path.join(appPath, 'locales'),
    path.join(resourcePath, 'locales'),
    path.join(appPath, 'root-of-app', 'locales'),
    path.join(resourcePath, 'root-of-app', 'locales'),
    path.join(appPath, 'src', 'root-of-app', 'locales'),
    path.join(resourcePath, 'src', 'root-of-app', 'locales'),
    path.join(appPath, '..', 'src', 'root-of-app', 'locales'),
    path.join(resourcePath, '..', 'src', 'root-of-app', 'locales'),
  ];
  
  return candidateDirs.find((dir) => fs.existsSync(dir)) ?? null;
}

/**
 * Load localization data for a specific language
 */
export function loadLocalization(langCode: string): LocaleStrings {
  const localesDir = getLocalesDir();
  
  if (!localesDir) {
    log.warn('Locales directory not found');
    return {};
  }
  
  const filePath = path.join(localesDir, `lang.${langCode}.json`);
  
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(data);
    } else {
      log.warn(`Locale file not found: ${filePath}`);
      // Fall back to English if requested locale doesn't exist
      if (langCode !== 'en') {
        return loadLocalization('en');
      }
    }
  } catch (error) {
    log.error(`Failed to load localization for ${langCode}:`, error);
  }
  
  return {};
}

/**
 * Get the current locale data
 */
export function getCurrentLocaleData(): { locale: string; strings: LocaleStrings } {
  return {
    locale: currentLocale,
    strings: localeData,
  };
}

/**
 * Set the UI language and broadcast to all windows
 */
export function setUILanguage(langCode: string): void {
  currentLocale = langCode;
  localeData = loadLocalization(langCode);
  
  // Broadcast to all windows
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    win.webContents.send(IPC_CHANNELS.LOCALIZATION, getCurrentLocaleData());
  }
}

/**
 * Initialize localization with the saved UI language from settings
 */
export function initializeLocalization(): void {
  // Try to read the saved uiLanguage from settings
  let savedLang = 'en';
  try {
    const { loadSettings } = require('./settings');
    const settings = loadSettings();
    if (settings.uiLanguage) {
      savedLang = settings.uiLanguage;
    }
  } catch (e) {
    log.error('Failed to read uiLanguage from settings', e);
    // Settings not available yet, use English
  }
  currentLocale = savedLang;
  localeData = loadLocalization(savedLang);
}

/**
 * Setup IPC handlers for localization
 */
export function setupLocalizationIPC(): void {
  // Initialize on setup
  initializeLocalization();
  
  // Handle requests for localization data
  ipcMain.on(IPC_CHANNELS.GET_LOCALIZATION, (event) => {
    event.reply(IPC_CHANNELS.LOCALIZATION, getCurrentLocaleData());
  });
  
  // Handle language change requests
  ipcMain.on(IPC_CHANNELS.CHANGE_UI_LANGUAGE, (_event, langCode: string) => {
    setUILanguage(langCode);
  });
}
