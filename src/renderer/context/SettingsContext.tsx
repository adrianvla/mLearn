/**
 * Settings Context
 * Manages application settings with cross-window synchronization
 */

import { createContext, useContext, ParentComponent, onMount, onCleanup, createSignal } from 'solid-js';
import { createStore, reconcile, produce } from 'solid-js/store';
import type { Settings } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/types';
import type { SubtitleTheme, AppTheme } from '../../shared/constants';
import { APP_THEMES } from '../../shared/constants';

// Context interface
interface SettingsContextValue {
  settings: Settings;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  updateSettings: (partial: Partial<Settings>) => void;
  saveSettings: () => void;
  isLoading: () => boolean;
}

// Create context
const SettingsContext = createContext<SettingsContextValue>();

// BroadcastChannel for cross-window sync
const SETTINGS_CHANNEL = 'mlearn-settings';

export const SettingsProvider: ParentComponent = (props) => {
  const [settings, setSettings] = createStore<Settings>({ ...DEFAULT_SETTINGS });
  const [isLoading, setIsLoading] = createSignal(true);
  // Track whether settings have been loaded from disk at least once
  // This prevents saving default values before real settings are loaded
  const [hasLoaded, setHasLoaded] = createSignal(false);

  let broadcastChannel: BroadcastChannel | null = null;

  // Load settings from main process
  const loadSettings = () => {
    if (typeof window !== 'undefined' && window.mLearnIPC) {
      // Set up listener BEFORE sending request to avoid race condition
      window.mLearnIPC.onSettings((loadedSettings) => {
        setSettings(reconcile(loadedSettings));
        setIsLoading(false);
        setHasLoaded(true);
        applySettingsToDOM(loadedSettings);
      });
      window.mLearnIPC.getSettings();
    } else {
      // In tethered mode, load from API
      fetch('/api/settings')
          .then(res => res.json())
          .then(loadedSettings => {
            setSettings(reconcile(loadedSettings));
            setIsLoading(false);
            setHasLoaded(true);
            applySettingsToDOM(loadedSettings);
          })
          .catch(() => {
            setIsLoading(false);
            setHasLoaded(true);
          });
    }
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
  };

  // Update a single setting
  const updateSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings(produce((s) => {
      (s as any)[key] = value;
    }));
    applySettingsToDOM(settings);
    // Auto-save after update
    saveSettings();
  };

  // Update multiple settings
  const updateSettings = (partial: Partial<Settings>) => {
    setSettings(produce((s) => {
      Object.assign(s, partial);
    }));
    applySettingsToDOM(settings);
    // Auto-save after update
    saveSettings();
  };

  // Save settings to main process
  const saveSettings = () => {
    // CRITICAL: Don't save until we've loaded settings from disk
    // This prevents overwriting user settings with defaults during app startup
    if (!hasLoaded()) {
      console.warn('[Settings] Skipping save - settings not yet loaded from disk');
      return;
    }

    if (typeof window !== 'undefined' && window.mLearnIPC) {
      // Must serialize the store to a plain object before sending via IPC
      // SolidJS stores are proxies that can't be cloned directly
      const serializedSettings = JSON.parse(JSON.stringify(settings)) as Settings;
      window.mLearnIPC.saveSettings(serializedSettings);
    }
    broadcastSettingsUpdate();
  };

  // Broadcast settings to other windows
  const broadcastSettingsUpdate = () => {
    if (broadcastChannel) {
      // Must serialize settings to plain object for postMessage (stores aren't cloneable)
      broadcastChannel.postMessage({ type: 'update', settings: JSON.parse(JSON.stringify(settings)) });
    }
  };

  // Handle settings from other windows
  const handleBroadcast = (event: MessageEvent) => {
    if (event.data?.type === 'update' && event.data.settings) {
      setSettings(reconcile(event.data.settings));
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
    broadcastChannel?.close();
  });

  const value: SettingsContextValue = {
    settings,
    updateSetting,
    updateSettings,
    saveSettings,
    isLoading,
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
    isDark: () => settings.theme === 'dark' || settings.theme === 'glass-dark' || settings.theme === 'glass-transparent',
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
