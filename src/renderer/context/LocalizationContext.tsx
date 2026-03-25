/**
 * Localization Context
 * Manages UI localization with cross-window synchronization
 */

import { createContext, useContext, ParentComponent, onMount, onCleanup, createSignal } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { getBridge } from '../../shared/bridges';

// Type for nested locale strings
export type LocaleStrings = Record<string, unknown>;

// Context interface
interface LocalizationContextValue {
  /** Current locale code (e.g., 'en', 'ja') */
  locale: () => string;
  /** Get a localized string by path (e.g., 'mlearn.Home.UI.Title') */
  t: (path: string, params?: Record<string, string | number>) => string;
  /** Change the UI language */
  changeLanguage: (langCode: string) => void;
  /** Check if localization is loaded */
  isLoaded: () => boolean;
}

// Create context
const LocalizationContext = createContext<LocalizationContextValue>();

// BroadcastChannel for cross-window sync
const LOCALIZATION_CHANNEL = 'mlearn-localization';

/**
 * Get a value from a nested object using a dot-separated path
 */
function getNestedValue(obj: Record<string, unknown>, path: string): string | null {
  const keys = path.split('.');
  let current: unknown = obj;
  
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }
  
  return typeof current === 'string' ? current : null;
}

/**
 * Replace template parameters in a string
 * e.g., "Hello {name}" with { name: "World" } => "Hello World"
 */
function interpolate(str: string, params?: Record<string, string | number>): string {
  if (!params) return str;
  
  return str.replace(/\{(\w+)\}/g, (match, key) => {
    return params[key] !== undefined ? String(params[key]) : match;
  });
}

export const LocalizationProvider: ParentComponent = (props) => {
  const [locale, setLocale] = createSignal('en');
  const [strings, setStrings] = createStore<LocaleStrings>({});
  const [isLoaded, setIsLoaded] = createSignal(false);
  
  let broadcastChannel: BroadcastChannel | null = null;
  const ipcCleanups: Array<() => void> = [];

  // Load localization from platform bridge
  const loadLocalization = () => {
    const bridge = getBridge();
    console.log('[LocalizationContext] Loading localization...');
    // Set up listener BEFORE sending request to avoid race condition
    ipcCleanups.push(bridge.localization.onLocalization((data) => {
      console.log('[LocalizationContext] Localization received, locale:', data.locale);
      setLocale(data.locale);
      setStrings(reconcile(data.strings as LocaleStrings));
      setIsLoaded(true);
    }));
    bridge.localization.getLocalization();
  };

  // Get a localized string by path
  const t = (path: string, params?: Record<string, string | number>): string => {
    const value = getNestedValue(strings as Record<string, unknown>, path);
    
    if (value === null) {
      // Only log warning if strings are loaded but the key is missing
      // Don't warn during initial load when strings haven't been fetched yet
      if (process.env.NODE_ENV !== 'production' && isLoaded() && Object.keys(strings).length > 0) {
        console.warn(`[Localization] String not found: ${path}`);
      }
      // Return the last part of the path as fallback for better UX
      // const fallback = path.split('.').pop() || path;
      const fallback = path; //return the whole path
      return fallback;
    }
    
    return interpolate(value, params);
  };

  // Change the UI language
  const changeLanguage = (langCode: string) => {
    getBridge().localization.changeUILanguage(langCode);
    broadcastLanguageChange(langCode);
  };

  // Broadcast language change to other windows
  const broadcastLanguageChange = (langCode: string) => {
    try {
      broadcastChannel?.postMessage({ type: 'language-change', locale: langCode });
    } catch (e) {
      console.error(e);
      // Ignore broadcast errors
    }
  };

  // Handle broadcast messages from other windows
  const handleBroadcast = (event: MessageEvent) => {
    if (event.data?.type === 'localization-update') {
      setLocale(event.data.locale);
      setStrings(reconcile(event.data.strings));
    } else if (event.data?.type === 'language-change') {
      // Re-request localization after language change
      getBridge().localization.getLocalization();
    }
  };

  onMount(() => {
    // Initialize BroadcastChannel for cross-window sync
    try {
      broadcastChannel = new BroadcastChannel(LOCALIZATION_CHANNEL);
      broadcastChannel.onmessage = handleBroadcast;
    } catch (e) {
      console.error(e);
      // BroadcastChannel not available
    }

    // Load localization
    loadLocalization();
  });

  onCleanup(() => {
    for (const cleanup of ipcCleanups) cleanup();
    ipcCleanups.length = 0;
    broadcastChannel?.close();
  });

  const value: LocalizationContextValue = {
    locale,
    t,
    changeLanguage,
    isLoaded,
  };

  return (
    <LocalizationContext.Provider value={value}>
      {props.children}
    </LocalizationContext.Provider>
  );
};

// Hook to use localization
export function useLocalization(): LocalizationContextValue {
  const context = useContext(LocalizationContext);
  if (!context) {
    throw new Error('useLocalization must be used within a LocalizationProvider');
  }
  return context;
}

// Shorthand hook for just the t function
export function useT(): (path: string, params?: Record<string, string | number>) => string {
  const { t } = useLocalization();
  return t;
}

export default LocalizationContext;
