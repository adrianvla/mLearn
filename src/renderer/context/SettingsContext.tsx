/**
 * Settings Context
 * Manages application settings with cross-window synchronization
 */

import { createContext, useContext, ParentComponent, onMount, onCleanup, createSignal } from 'solid-js';
import { createStore, reconcile, produce } from 'solid-js/store';
import type { Settings } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/types';
import type { SubtitleTheme } from '../../shared/constants';

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
  
  let broadcastChannel: BroadcastChannel | null = null;

  // Load settings from main process
  const loadSettings = () => {
    if (typeof window !== 'undefined' && window.mLearnIPC) {
      window.mLearnIPC.getSettings();
      window.mLearnIPC.onSettings((loadedSettings) => {
        setSettings(reconcile(loadedSettings));
        setIsLoading(false);
        applySettingsToDOM(loadedSettings);
      });
    } else {
      // In tethered mode, load from API
      fetch('/api/settings')
        .then(res => res.json())
        .then(loadedSettings => {
          setSettings(reconcile(loadedSettings));
          setIsLoading(false);
          applySettingsToDOM(loadedSettings);
        })
        .catch(() => {
          setIsLoading(false);
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
    
    // Theme
    if (s.dark_mode) {
      document.body.classList.add('dark');
    } else {
      document.body.classList.remove('dark');
    }
  };

  // Update a single setting
  const updateSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings(produce((s) => {
      (s as any)[key] = value;
    }));
    applySettingsToDOM(settings);
    broadcastSettingsUpdate();
  };

  // Update multiple settings
  const updateSettings = (partial: Partial<Settings>) => {
    setSettings(produce((s) => {
      Object.assign(s, partial);
    }));
    applySettingsToDOM(settings);
    broadcastSettingsUpdate();
  };

  // Save settings to main process
  const saveSettings = () => {
    if (typeof window !== 'undefined' && window.mLearnIPC) {
      window.mLearnIPC.saveSettings(settings);
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
    isDark: () => settings.dark_mode,
    toggle: () => updateSetting('dark_mode', !settings.dark_mode),
    setDark: (dark: boolean) => updateSetting('dark_mode', dark),
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
