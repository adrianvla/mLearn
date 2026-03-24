/**
 * IPC Hook
 * Type-safe wrapper around Electron IPC communication
 */

import { createSignal, createEffect, onCleanup } from 'solid-js';
import type { Settings, Flashcard, WindowType } from '../../shared/types';

// Type definitions for the IPC API exposed through preload
interface MLearnAPI {
  // Settings
  getSettings: () => Promise<Settings>;
  saveSettings: (settings: Settings) => Promise<void>;
  
  // Flashcards
  getFlashcards: () => Promise<Flashcard[]>;
  saveFlashcard: (flashcard: Flashcard) => Promise<void>;
  deleteFlashcard: (id: string) => Promise<void>;
  
  // Windows
  openWindow: (type: WindowType, options?: Record<string, unknown>) => void;
  closeWindow: () => void;
  minimize: () => void;
  maximize: () => void;
  setAlwaysOnTop: (value: boolean) => void;
  togglePiP: (width?: number, height?: number) => void;
  
  // Backend
  getBackendStatus: () => Promise<boolean>;
  startBackend: () => Promise<void>;
  stopBackend: () => Promise<void>;
  
  // File operations
  selectFile: (options?: { filters?: Array<{ name: string; extensions: string[] }> }) => Promise<string | null>;
  selectFolder: () => Promise<string | null>;
  readFile: (path: string) => Promise<string>;
  
  // System
  getAppPath: () => Promise<string>;
  getPlatform: () => string;
  getVersion: () => string;
  openExternal: (url: string) => Promise<void>;
  
  // Tethered mode
  isTethered: boolean;
  
  // Event listeners
  on: (channel: string, callback: (...args: unknown[]) => void) => void;
  off: (channel: string, callback: (...args: unknown[]) => void) => void;
}

// Get the API from window object
function getAPI(): MLearnAPI | null {
  const win = window as unknown as { mlearn?: MLearnAPI };
  return win.mlearn || null;
}

// Check if running in Electron
export function useIsElectron(): boolean {
  return getAPI() !== null;
}

// Check if running in tethered mode
export function useIsTethered(): boolean {
  const api = getAPI();
  return api?.isTethered ?? true;
}

// Generic IPC hook for calling API methods
export function useIPC() {
  const api = getAPI();
  const isElectron = api !== null;
  const isTethered = api?.isTethered ?? true;

  // Settings
  const getSettings = async (): Promise<Settings | null> => {
    if (!api) return null;
    return api.getSettings();
  };

  const saveSettings = async (settings: Settings): Promise<void> => {
    if (!api) return;
    await api.saveSettings(settings);
  };

  // Flashcards
  const getFlashcards = async (): Promise<Flashcard[]> => {
    if (!api) return [];
    return api.getFlashcards();
  };

  const saveFlashcard = async (flashcard: Flashcard): Promise<void> => {
    if (!api) return;
    await api.saveFlashcard(flashcard);
  };

  const deleteFlashcard = async (id: string): Promise<void> => {
    if (!api) return;
    await api.deleteFlashcard(id);
  };

  // Windows
  const openWindow = (type: WindowType, options?: Record<string, unknown>) => {
    if (!api) {
      // In tethered mode, open in new tab
      window.open(`/${type}.html`, '_blank');
      return;
    }
    api.openWindow(type, options);
  };

  const closeWindow = () => {
    if (!api) {
      window.close();
      return;
    }
    api.closeWindow();
  };

  const minimize = () => {
    api?.minimize();
  };

  const maximize = () => {
    api?.maximize();
  };

  const setAlwaysOnTop = (value: boolean) => {
    api?.setAlwaysOnTop(value);
  };

  const togglePiP = (width?: number, height?: number) => {
    api?.togglePiP(width, height);
  };

  // Backend
  const getBackendStatus = async (): Promise<boolean> => {
    if (!api) {
      // In tethered mode, check via HTTP
      try {
        const response = await fetch('/api/status');
        return response.ok;
      } catch {
        return false;
      }
    }
    return api.getBackendStatus();
  };

  const startBackend = async () => {
    if (!api) return;
    await api.startBackend();
  };

  const stopBackend = async () => {
    if (!api) return;
    await api.stopBackend();
  };

  // File operations
  const selectFile = async (options?: {
    filters?: Array<{ name: string; extensions: string[] }>;
  }): Promise<string | null> => {
    if (!api) {
      // In tethered mode, use input element
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        if (options?.filters) {
          input.accept = options.filters
            .flatMap(f => f.extensions.map(e => `.${e}`))
            .join(',');
        }
        input.onchange = () => {
          resolve(input.files?.[0]?.name || null);
        };
        input.click();
      });
    }
    return api.selectFile(options);
  };

  const selectFolder = async (): Promise<string | null> => {
    if (!api) return null;
    return api.selectFolder();
  };

  const readFile = async (path: string): Promise<string> => {
    if (!api) {
      throw new Error('readFile not available in tethered mode');
    }
    return api.readFile(path);
  };

  // System
  const getAppPath = async (): Promise<string> => {
    if (!api) return '';
    return api.getAppPath();
  };

  const getPlatform = (): string => {
    if (!api) {
      // Detect from user agent
      const ua = navigator.userAgent.toLowerCase();
      if (ua.includes('mac')) return 'darwin';
      if (ua.includes('win')) return 'win32';
      if (ua.includes('linux')) return 'linux';
      return 'unknown';
    }
    return api.getPlatform();
  };

  const getVersion = (): string => {
    return api?.getVersion() ?? '0.0.0';
  };

  const openExternal = async (url: string) => {
    if (!api) {
      window.open(url, '_blank');
      return;
    }
    await api.openExternal(url);
  };

  return {
    isElectron,
    isTethered,
    
    // Settings
    getSettings,
    saveSettings,
    
    // Flashcards
    getFlashcards,
    saveFlashcard,
    deleteFlashcard,
    
    // Windows
    openWindow,
    closeWindow,
    minimize,
    maximize,
    setAlwaysOnTop,
    togglePiP,
    
    // Backend
    getBackendStatus,
    startBackend,
    stopBackend,
    
    // File operations
    selectFile,
    selectFolder,
    readFile,
    
    // System
    getAppPath,
    getPlatform,
    getVersion,
    openExternal,
  };
}

// Hook for subscribing to IPC events
export function useIPCEvent<T>(
  channel: string,
  handler: (data: T) => void
) {
  const api = getAPI();

  createEffect(() => {
    if (!api) return;

    const callback = (_event: unknown, data: T) => handler(data);
    api.on(channel, callback as (...args: unknown[]) => void);

    onCleanup(() => {
      api.off(channel, callback as (...args: unknown[]) => void);
    });
  });
}

// Hook for backend status with auto-refresh
export function useBackendStatus() {
  const { getBackendStatus, isTethered } = useIPC();
  const [isConnected, setIsConnected] = createSignal(false);
  const [isChecking, setIsChecking] = createSignal(true);

  const checkStatus = async () => {
    setIsChecking(true);
    try {
      const status = await getBackendStatus();
      setIsConnected(status);
    } catch {
      setIsConnected(false);
    } finally {
      setIsChecking(false);
    }
  };

  // Initial check
  createEffect(() => {
    checkStatus();
  });

  // Subscribe to backend status changes
  useIPCEvent<boolean>('backend:status', setIsConnected);

  return {
    isConnected,
    isChecking,
    isTethered,
    refresh: checkStatus,
  };
}

// Hook for draggable window title bar
export function useDraggableRegion() {
  return {
    style: {
      '-webkit-app-region': 'drag',
      'app-region': 'drag',
    } as const,
    noDrag: {
      '-webkit-app-region': 'no-drag',
      'app-region': 'no-drag',
    } as const,
  };
}
