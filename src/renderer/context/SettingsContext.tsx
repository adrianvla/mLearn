/**
 * Settings Context
 * Manages application settings with cross-window synchronization
 */

import { createContext, useContext, ParentComponent, onMount, onCleanup, createSignal } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import type { Settings } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/types';
import type { SubtitleTheme, AppTheme } from '../../shared/constants';
import { APP_THEMES, KNOWLEDGE_SOURCES } from '../../shared/constants';
import { getBridge } from '../../shared/bridges';
import { getBackend, resetBackend } from '../../shared/backends';
import { isCapacitor } from '../../shared/platform';
import { readingAnnotationsEnabled } from '../../shared/readingAnnotationSettings';
import { prosodyVisible } from '../../shared/prosodySettings';
import {
  ensureCloudAccessToken,
  hasSignedInCloudSession,
  registerCloudSessionController,
  syncCloudSessionState,
} from '../services/cloudSessionManager';
import { clearAnkiWordsCache } from '../services/ankiWordsCache';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger("renderer.context.settings");

// Context interface
interface SettingsContextValue {
  settings: Settings;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  updateSettings: (partial: Partial<Settings>) => void;
  saveSettings: () => void;
  isLoading: () => boolean;
  isRuntimeRestartRequired: () => boolean;
  clearRuntimeRestartRequired: () => void;
  restartAppForRuntimeSettings: () => void;
  isCloudReLoginModalOpen: () => boolean;
  openCloudReLoginModal: () => void;
  closeCloudReLoginModal: () => void;
  /** Generic prosody/accent visibility toggle. */
  showProsody: () => boolean;
  /** Generic prosody/accent visibility setter. */
  setProsodyVisible: (show: boolean) => void;
}

// Create context
const SettingsContext = createContext<SettingsContextValue>();

// BroadcastChannel for cross-window sync
const SETTINGS_CHANNEL = 'mlearn-settings';

const LANGUAGE_RUNTIME_KEYS = new Set<keyof Settings>([
  'language',
  'uiLanguage',
  'dictionaryTargetLanguages',
  'llmEnabled',
  'ocrEnabled',
  'voiceEnabled',
]);

export const SettingsProvider: ParentComponent = (props) => {
  const [settings, setSettings] = createStore<Settings>({ ...DEFAULT_SETTINGS });
  const [isLoading, setIsLoading] = createSignal(true);
  const [isCloudReLoginModalOpen, setIsCloudReLoginModalOpen] = createSignal(false);
  const [isRuntimeRestartRequired, setIsRuntimeRestartRequired] = createSignal(false);
  // Track whether settings have been loaded from disk at least once
  // This prevents saving default values before real settings are loaded
  const [hasLoaded, setHasLoaded] = createSignal(false);

  let broadcastChannel: BroadcastChannel | null = null;
  const ipcCleanups: Array<() => void> = [];
  let pendingSettingsSnapshot: Partial<Settings> | null = null;
  let unregisterCloudSessionController: (() => void) | null = null;

  const openCloudReLoginModal = () => setIsCloudReLoginModalOpen(true);
  const closeCloudReLoginModal = () => setIsCloudReLoginModalOpen(false);
  const clearRuntimeRestartRequired = () => setIsRuntimeRestartRequired(false);
  const restartAppForRuntimeSettings = () => {
    getBridge().server.forceRestartApp();
  };
  const syncCloudState = (nextSettings: Settings) => {
    if (nextSettings.cloudAuthStatus === 'signed-in') {
      closeCloudReLoginModal();
    }

    syncCloudSessionState(nextSettings);
  };

  const serializeSettings = (value: Settings): Settings => JSON.parse(JSON.stringify(value)) as Settings;
  const settingsValuesEqual = (left: unknown, right: unknown): boolean => {
    if (Object.is(left, right)) return true;
    if (left && right && typeof left === 'object' && typeof right === 'object') {
      return JSON.stringify(left) === JSON.stringify(right);
    }
    return false;
  };

  const getChangedKeys = (currentSettings: Settings, nextSettings: Settings, keys: Iterable<keyof Settings>): Set<keyof Settings> => {
    const changedKeys = new Set<keyof Settings>();
    for (const key of keys) {
      if (!settingsValuesEqual(currentSettings[key], nextSettings[key])) {
        changedKeys.add(key);
      }
    }
    return changedKeys;
  };

  const resolveBackendUrl = (nextSettings: Settings): string => {
    return nextSettings.backendUrl;
  };

  const resolveCloudAccessToken = (nextSettings: Settings): string => (
    nextSettings.cloudAuthAccessToken || nextSettings.cloudAuthToken
  );

  // Load settings from main process or platform bridge
  const loadSettings = () => {
    const bridge = getBridge();
    log.info('[SettingsContext] Loading settings...');
    // Set up listener BEFORE sending request to avoid race condition
    ipcCleanups.push(bridge.settings.onSettings((loadedSettings) => {
      log.info('[SettingsContext] Settings received');
      const mergedSettings = pendingSettingsSnapshot
        ? { ...loadedSettings, ...pendingSettingsSnapshot }
        : loadedSettings;
      let migratedSettings = false;

      if (mergedSettings.knowledgeSourceOrder) {
        const validSources = new Set(KNOWLEDGE_SOURCES);
        const currentSources = new Set(mergedSettings.knowledgeSourceOrder as string[]);
        const hasInvalid = (mergedSettings.knowledgeSourceOrder as string[]).some((src) => !validSources.has(src as typeof KNOWLEDGE_SOURCES[number]));
        const hasMissing = KNOWLEDGE_SOURCES.some((src) => !currentSources.has(src));
        // DEPRECATED (v2.0 migration): reset legacy/incomplete source orders to the new default.
        // Remove after all active users have migrated (safe to remove ~2026-12).
        if (hasInvalid || hasMissing) {
          mergedSettings.knowledgeSourceOrder = [...KNOWLEDGE_SOURCES];
          log.info('[SettingsContext] Migrated knowledgeSourceOrder to new default');
          migratedSettings = true;
        }
      }

      // DEPRECATED (v2.4 migration): move the old voice endpointing default to the faster default.
      // Remove after all active users have migrated (safe to remove ~2027-01).
      if (mergedSettings.voiceSilenceThreshold === 1.2) {
        mergedSettings.voiceSilenceThreshold = DEFAULT_SETTINGS.voiceSilenceThreshold;
        log.info('[SettingsContext] Migrated voiceSilenceThreshold to new default');
        migratedSettings = true;
      }

      setSettings(reconcile(mergedSettings));
      syncCloudState(mergedSettings);
      setIsLoading(false);
      setHasLoaded(true);

      // In dev builds, always force devMode on
      if (import.meta.env.DEV) {
        setSettings('devMode', true);
      }

      // Initialize the backend adapter with the loaded settings
      getBackend({
        mode: mergedSettings.backendMode,
        url: resolveBackendUrl(mergedSettings),
        authToken: resolveCloudAccessToken(mergedSettings),
      });

      applySettingsToDOM(mergedSettings);

      if (pendingSettingsSnapshot || migratedSettings) {
        bridge.settings.saveSettings(mergedSettings);
        pendingSettingsSnapshot = null;
      }

      if (hasSignedInCloudSession(mergedSettings)) {
        void ensureCloudAccessToken();
      }
    }));
    bridge.settings.getSettings();
  };

  // Apply settings to DOM (CSS variables, classes)
  const applySettingsToDOM = (s: Settings) => {
    const root = document.documentElement;

    // Subtitle settings
    root.style.setProperty('--subtitle-font-size', `${s.subtitle_font_size}px`);
    root.style.setProperty('--subtitle-font-weight', `${s.subtitle_font_weight}`);
    root.style.setProperty('--word-blur-amount', `${s.blur_amount}px`);

    // Theme - remove all theme classes first, then apply the current one
    APP_THEMES.forEach(theme => {
      document.body.classList.remove(`theme-${theme}`);
    });

    // Apply current theme class (light is default, no class needed)
    if (s.theme !== 'light') {
      document.body.classList.add(`theme-${s.theme}`);
    }

    // Custom theme: inject user-edited CSS into a dedicated <style> element
    const CUSTOM_STYLE_ID = 'mlearn-custom-theme-css';
    const existingCustomStyle = document.getElementById(CUSTOM_STYLE_ID);
    if (s.theme === 'custom' && s.customThemeCSS) {
      let styleEl = existingCustomStyle as HTMLStyleElement | null;
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = CUSTOM_STYLE_ID;
        document.head.appendChild(styleEl);
      }
      styleEl.textContent = s.customThemeCSS;
    } else if (existingCustomStyle) {
      existingCustomStyle.remove();
    }

    // Update status bar text color on Capacitor (light text for dark themes, dark text for light themes)
    if (isCapacitor()) {
      const isDark = s.theme === 'dark' || s.theme === 'glass-dark' || s.theme === 'dark-high-contrast' || s.theme === 'darker';
      import('@capacitor/status-bar').then(({ StatusBar, Style }) => {
        StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light });
      }).catch(() => { /* StatusBar plugin unavailable */ });
    }

    // Apply custom color overrides (these override theme colors)
    const customColors = s.customColors || {};
    const cssVars = ['bg-opaque', 'text-primary', 'text-secondary', 'text-tertiary', 'bg', 'bg-intense', 'border-color', 'border-color-intense'] as const;
    
    for (const varName of cssVars) {
      const customValue = customColors[varName];
      if (customValue) {
        root.style.setProperty(`--${varName}`, customValue);
      } else {
        // Remove custom override to let theme default apply
        root.style.removeProperty(`--${varName}`);
      }
    }
  };

  // Keys that require backend adapter reconfiguration
  const BACKEND_KEYS = new Set<keyof Settings>([
    'backendMode',
    'backendUrl',
    'cloudAuthToken',
    'cloudAuthAccessToken',
    'overrideCloudEndpointUrl',
  ]);

  const ANKI_BACKEND_KEYS = new Set<keyof Settings>([
    'use_anki',
    'ankiConnectUrl',
    'anki_field_expression',
    'anki_field_reading',
    'anki_field_meaning',
    'language',
  ]);

  // Reconfigure backend adapter if needed
  const maybeReconfigureBackend = (nextSettings: Settings, changedKeys?: Set<keyof Settings>) => {
    if (!changedKeys || [...changedKeys].some(k => BACKEND_KEYS.has(k))) {
      resetBackend();
      getBackend({
        mode: nextSettings.backendMode,
        url: resolveBackendUrl(nextSettings),
        authToken: resolveCloudAccessToken(nextSettings),
      });
    }
  };

  const maybeClearAnkiCache = (changedKeys?: Set<keyof Settings>) => {
    if (!changedKeys || [...changedKeys].some(k => ANKI_BACKEND_KEYS.has(k))) {
      clearAnkiWordsCache();
    }
  };

  const needsLanguageRuntimeRestart = (changedKeys?: Set<keyof Settings>): boolean => (
    Boolean(changedKeys && [...changedKeys].some(k => LANGUAGE_RUNTIME_KEYS.has(k)))
  );

  const saveSettingsSnapshot = (snapshot: Settings, restartLanguageRuntime: boolean) => {
    if (!hasLoaded()) {
      return;
    }

    const bridge = getBridge();
    if (restartLanguageRuntime) {
      const cleanup = bridge.settings.onSettingsSaved(() => {
        cleanup();
        setIsRuntimeRestartRequired(true);
      });
    }

    bridge.settings.saveSettings(snapshot);
    broadcastSettingsUpdate(snapshot);
  };

  // Update a single setting
  const updateSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    const currentSettings = serializeSettings(settings as Settings);
    const nextSettings = {
      ...currentSettings,
      [key]: value,
    } as Settings;
    const changedKeys = getChangedKeys(currentSettings, nextSettings, [key]);

    setSettings(reconcile(nextSettings));
    syncCloudState(nextSettings);
    applySettingsToDOM(nextSettings);
    maybeReconfigureBackend(nextSettings, changedKeys);
    maybeClearAnkiCache(changedKeys);

    if (!hasLoaded()) {
      pendingSettingsSnapshot = { ...pendingSettingsSnapshot, [key]: value };
      return;
    }

    saveSettingsSnapshot(nextSettings, needsLanguageRuntimeRestart(changedKeys));
  };

  // Update multiple settings
  const updateSettings = (partial: Partial<Settings>) => {
    const currentSettings = serializeSettings(settings as Settings);
    const nextSettings = {
      ...currentSettings,
      ...partial,
    } as Settings;
    const changedKeys = getChangedKeys(currentSettings, nextSettings, Object.keys(partial) as (keyof Settings)[]);

    setSettings(reconcile(nextSettings));
    syncCloudState(nextSettings);
    applySettingsToDOM(nextSettings);
    maybeReconfigureBackend(nextSettings, changedKeys);
    maybeClearAnkiCache(changedKeys);

    if (!hasLoaded()) {
      pendingSettingsSnapshot = { ...pendingSettingsSnapshot, ...partial };
      return;
    }

    saveSettingsSnapshot(nextSettings, needsLanguageRuntimeRestart(changedKeys));
  };

  // Save settings to main process
  const saveSettings = () => {
    const snapshot = serializeSettings(settings as Settings);

    // CRITICAL: Don't save until we've loaded settings from disk
    // This prevents overwriting user settings with defaults during app startup
    if (!hasLoaded()) {
      return;
    }

    saveSettingsSnapshot(snapshot, false);
  };

  const showProsody = () => prosodyVisible(settings);
  const setProsodyVisible = (show: boolean) => updateSetting('showProsody', show);

  // Broadcast settings to other windows
  const broadcastSettingsUpdate = (settingsSnapshot: Settings) => {
    if (broadcastChannel) {
      broadcastChannel.postMessage({ type: 'update', settings: settingsSnapshot });
    }
  };

  // Handle settings from other windows
  const handleBroadcast = (event: MessageEvent) => {
    if (event.data?.type === 'update' && event.data.settings) {
      const nextSettings = event.data.settings as Settings;
      const changedKeys = getChangedKeys(serializeSettings(settings as Settings), nextSettings, LANGUAGE_RUNTIME_KEYS);
      if (needsLanguageRuntimeRestart(changedKeys)) {
        setIsRuntimeRestartRequired(true);
      }
      setSettings(reconcile(nextSettings));
      syncCloudState(nextSettings);
      applySettingsToDOM(nextSettings);
    }
  };

  onMount(() => {
    unregisterCloudSessionController = registerCloudSessionController({
      getSettings: () => serializeSettings(settings as Settings),
      updateSettings,
      openCloudReLoginModal,
    });

    // Setup broadcast channel
    if (typeof BroadcastChannel !== 'undefined') {
      broadcastChannel = new BroadcastChannel(SETTINGS_CHANNEL);
      broadcastChannel.onmessage = handleBroadcast;
    }

    // Load initial settings
    loadSettings();
  });

  onCleanup(() => {
    for (const cleanup of ipcCleanups) cleanup();
    ipcCleanups.length = 0;
    broadcastChannel?.close();
    unregisterCloudSessionController?.();
    unregisterCloudSessionController = null;
  });

  const value: SettingsContextValue = {
    settings,
    updateSetting,
    updateSettings,
    saveSettings,
    isLoading,
    isRuntimeRestartRequired,
    clearRuntimeRestartRequired,
    restartAppForRuntimeSettings,
    isCloudReLoginModalOpen,
    openCloudReLoginModal,
    closeCloudReLoginModal,
    showProsody,
    setProsodyVisible,
  };

  return (
      <SettingsContext.Provider value={value}>
        {props.children}
      </SettingsContext.Provider>
  );
};

// Hook to use settings
export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return ctx;
}

// Specialized hooks for common operations
export function useTheme() {
  const { settings, updateSetting } = useSettings();

  return {
    theme: () => settings.theme,
    setTheme: (theme: AppTheme) => updateSetting('theme', theme),
  };
}

export function useSubtitleSettings() {
  const { settings, updateSetting, updateSettings } = useSettings();
  const showProsody = () => prosodyVisible(settings);
  const setProsodyVisible = (show: boolean) => updateSetting('showProsody', show);

  return {
    fontSize: () => settings.subtitle_font_size,
    fontWeight: () => settings.subtitle_font_weight,
    theme: () => settings.subtitleTheme,
    offset: () => settings.subsOffsetTime,
    showReadingAnnotations: () => readingAnnotationsEnabled(settings),
    showProsody,
    setFontSize: (size: number) => updateSetting('subtitle_font_size', size),
    setFontWeight: (weight: number) => updateSetting('subtitle_font_weight', weight),
    setTheme: (theme: SubtitleTheme) => updateSetting('subtitleTheme', theme),
    setOffset: (offset: number) => updateSetting('subsOffsetTime', offset),
    setReadingAnnotations: (show: boolean) => updateSettings({
      showReadingAnnotations: show,
    }),
    setProsodyVisible,
  };
}

export function useLanguageSettings() {
  const { settings, updateSetting } = useSettings();

  return {
    language: () => settings.language,
    setLanguage: (lang: string) => updateSetting('language', lang),
  };
}
