/**
 * Settings Context
 * Manages application settings with cross-window synchronization
 */

import { createContext, useContext, ParentComponent, onMount, onCleanup, createSignal } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import type { Settings } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/types';
import type { SubtitleTheme, AppTheme } from '../../shared/constants';
import { APP_THEMES } from '../../shared/constants';
import { getBridge } from '../../shared/bridges';
import { getBackend, resetBackend } from '../../shared/backends';
import { isCapacitor } from '../../shared/platform';
import { validateAndRefreshCloudSession } from '../services/cloudAuthService';

// Context interface
interface SettingsContextValue {
  settings: Settings;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  updateSettings: (partial: Partial<Settings>) => void;
  saveSettings: () => void;
  isLoading: () => boolean;
  isCloudReLoginModalOpen: () => boolean;
  openCloudReLoginModal: () => void;
  closeCloudReLoginModal: () => void;
}

// Create context
const SettingsContext = createContext<SettingsContextValue>();

// BroadcastChannel for cross-window sync
const SETTINGS_CHANNEL = 'mlearn-settings';

export const SettingsProvider: ParentComponent = (props) => {
  const [settings, setSettings] = createStore<Settings>({ ...DEFAULT_SETTINGS });
  const [isLoading, setIsLoading] = createSignal(true);
  const [isCloudReLoginModalOpen, setIsCloudReLoginModalOpen] = createSignal(false);
  // Track whether settings have been loaded from disk at least once
  // This prevents saving default values before real settings are loaded
  const [hasLoaded, setHasLoaded] = createSignal(false);

  let broadcastChannel: BroadcastChannel | null = null;
  const ipcCleanups: Array<() => void> = [];
  let pendingSettingsSnapshot: Settings | null = null;

  const openCloudReLoginModal = () => setIsCloudReLoginModalOpen(true);
  const closeCloudReLoginModal = () => setIsCloudReLoginModalOpen(false);
  const syncCloudReLoginModal = (nextSettings: Settings) => {
    if (nextSettings.cloudAuthStatus === 'signed-in') {
      closeCloudReLoginModal();
    }
  };

  const serializeSettings = (value: Settings): Settings => JSON.parse(JSON.stringify(value)) as Settings;
  const resolveBackendUrl = (nextSettings: Settings): string => {
    return nextSettings.backendUrl;
  };

  const resolveCloudAccessToken = (nextSettings: Settings): string => (
    nextSettings.cloudAuthAccessToken || nextSettings.cloudAuthToken
  );

  // Load settings from main process or platform bridge
  const loadSettings = () => {
    const bridge = getBridge();
    console.log('[SettingsContext] Loading settings...');
    // Set up listener BEFORE sending request to avoid race condition
    ipcCleanups.push(bridge.settings.onSettings((loadedSettings) => {
      console.log('[SettingsContext] Settings received');
      const mergedSettings = pendingSettingsSnapshot
        ? { ...loadedSettings, ...pendingSettingsSnapshot }
        : loadedSettings;

      setSettings(reconcile(mergedSettings));
      syncCloudReLoginModal(mergedSettings);
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

      if (pendingSettingsSnapshot) {
        bridge.settings.saveSettings(pendingSettingsSnapshot);
        pendingSettingsSnapshot = null;
      }

      // Validate cloud session in background if user appears signed-in
      if (mergedSettings.cloudAuthStatus === 'signed-in' && (mergedSettings.cloudAuthAccessToken || mergedSettings.cloudAuthToken)) {
        const clearExpiredSession = () => {
          updateSettings({
            cloudAuthAccessToken: '',
            cloudAuthToken: '',
            cloudAuthRefreshToken: '',
            cloudAuthUserId: '',
            cloudAuthUserEmail: '',
            cloudAuthExpiresAt: 0,
            cloudAuthStatus: 'signed-out',
          });
          const usesCloud = mergedSettings.ocrProvider === 'cloud'
            || mergedSettings.llmProvider === 'cloud'
            || mergedSettings.ttsProvider === 'cloud'
            || mergedSettings.flashcardTtsProvider === 'cloud';
          if (usesCloud) {
            openCloudReLoginModal();
          }
        };

        validateAndRefreshCloudSession(mergedSettings).then((result) => {
          if (result.status === 'refreshed' && result.accessToken && result.refreshToken) {
            // Token was refreshed — persist the new tokens
            updateSettings({
              cloudAuthAccessToken: result.accessToken,
              cloudAuthRefreshToken: result.refreshToken,
              ...(result.expiresAt ? { cloudAuthExpiresAt: result.expiresAt } : {}),
            });
          } else if (result.status === 'expired') {
            clearExpiredSession();
          }
        }).catch(() => {
          // Network error — check expiresAt timestamp to decide locally
          if (mergedSettings.cloudAuthExpiresAt && mergedSettings.cloudAuthExpiresAt < Date.now()) {
            clearExpiredSession();
          }
        });
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

  // Update a single setting
  const updateSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    const nextSettings = {
      ...serializeSettings(settings as Settings),
      [key]: value,
    } as Settings;

    setSettings(reconcile(nextSettings));
    syncCloudReLoginModal(nextSettings);
    applySettingsToDOM(nextSettings);
    maybeReconfigureBackend(nextSettings, new Set([key]));
    saveSettings(nextSettings);
  };

  // Update multiple settings
  const updateSettings = (partial: Partial<Settings>) => {
    const nextSettings = {
      ...serializeSettings(settings as Settings),
      ...partial,
    } as Settings;

    setSettings(reconcile(nextSettings));
    syncCloudReLoginModal(nextSettings);
    applySettingsToDOM(nextSettings);
    maybeReconfigureBackend(nextSettings, new Set(Object.keys(partial) as (keyof Settings)[]));
    saveSettings(nextSettings);
  };

  // Save settings to main process
  const saveSettings = (settingsSnapshot?: Settings) => {
    const snapshot = settingsSnapshot ?? serializeSettings(settings as Settings);

    // CRITICAL: Don't save until we've loaded settings from disk
    // This prevents overwriting user settings with defaults during app startup
    if (!hasLoaded()) {
      pendingSettingsSnapshot = snapshot;
      return;
    }

    getBridge().settings.saveSettings(snapshot);
    broadcastSettingsUpdate(snapshot);
  };

  // Broadcast settings to other windows
  const broadcastSettingsUpdate = (settingsSnapshot: Settings) => {
    if (broadcastChannel) {
      broadcastChannel.postMessage({ type: 'update', settings: settingsSnapshot });
    }
  };

  // Handle settings from other windows
  const handleBroadcast = (event: MessageEvent) => {
    if (event.data?.type === 'update' && event.data.settings) {
      setSettings(reconcile(event.data.settings));
      syncCloudReLoginModal(event.data.settings);
      applySettingsToDOM(event.data.settings);
    }
  };

  onMount(() => {
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
  });

  const value: SettingsContextValue = {
    settings,
    updateSetting,
    updateSettings,
    saveSettings,
    isLoading,
    isCloudReLoginModalOpen,
    openCloudReLoginModal,
    closeCloudReLoginModal,
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
  const { settings, updateSetting } = useSettings();

  return {
    fontSize: () => settings.subtitle_font_size,
    fontWeight: () => settings.subtitle_font_weight,
    theme: () => settings.subtitleTheme,
    offset: () => settings.subsOffsetTime,
    showFurigana: () => settings.furigana,
    showPitchAccent: () => settings.showPitchAccent,
    setFontSize: (size: number) => updateSetting('subtitle_font_size', size),
    setFontWeight: (weight: number) => updateSetting('subtitle_font_weight', weight),
    setTheme: (theme: SubtitleTheme) => updateSetting('subtitleTheme', theme),
    setOffset: (offset: number) => updateSetting('subsOffsetTime', offset),
    setFurigana: (show: boolean) => updateSetting('furigana', show),
    setPitchAccent: (show: boolean) => updateSetting('showPitchAccent', show),
  };
}

export function useLanguageSettings() {
  const { settings, updateSetting } = useSettings();

  return {
    language: () => settings.language,
    setLanguage: (lang: string) => updateSetting('language', lang),
  };
}
