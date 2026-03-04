/**
 * Server Status Context
 * Manages connection to Python backend and server status
 */

import { createContext, useContext, ParentComponent, onMount, onCleanup, createSignal } from 'solid-js';
import { getBridge } from '../../shared/bridges';
import { isElectron } from '../../shared/platform';

// Server status types
type ServerStatus = 'loading' | 'connected' | 'error' | 'installing';

interface ServerContextValue {
  status: () => ServerStatus;
  statusMessage: () => string;
  isLoaded: () => boolean;
  isConnected: () => boolean;  // Alias for isLoaded
  error: () => string | null;
  restart: () => void;
  forceRestart: () => void;
  restartBackend: () => void;
  resetToLoading: () => void;
}

const ServerContext = createContext<ServerContextValue>();

export const ServerProvider: ParentComponent = (props) => {
  const [status, setStatus] = createSignal<ServerStatus>('loading');
  const [statusMessage, setStatusMessage] = createSignal('Initializing...');
  const [error, setError] = createSignal<string | null>(null);
  const ipcCleanups: Array<() => void> = [];

  // Check if we're in Electron or tethered mode
  const isElectronApp = isElectron();

  // Send localStorage snapshot to main process so the web server
  // can serve it to tethered clients via /settings.js
  const sendLocalStorageToMain = () => {
    if (!isElectronApp) return;
    const data: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) data[key] = localStorage.getItem(key) ?? '';
    }
    getBridge().generic.sendLS(data);
  };

  const setupListeners = () => {
    if (!isElectronApp) {
      // On mobile/web, there is no local Python server
      console.log('[ServerContext] Non-Electron mode, marking server as connected');
      setStatus('connected');
      setStatusMessage('Connected (Tethered Mode)');
      return;
    }

    const bridge = getBridge();

    // Send localStorage data to main process for tethered clients
    sendLocalStorageToMain();

    // Request initial status
    bridge.server.isLoaded();

    // Listen for server load
    ipcCleanups.push(bridge.server.onServerLoad((message) => {
      setStatus('connected');
      setStatusMessage(message);
      setError(null);
    }));

    // Listen for status updates
    ipcCleanups.push(bridge.server.onServerStatusUpdate((message) => {
      setStatusMessage(message);
      if (message.toLowerCase().includes('error')) {
        setError(message);
      }
    }));

    // Listen for critical errors
    ipcCleanups.push(bridge.server.onServerCriticalError((message) => {
      setStatus('error');
      setError(message);
    }));

    // Listen for installation events
    ipcCleanups.push(bridge.installer.onInstallStarted(() => {
      setStatus('installing');
      setStatusMessage('Installing components...');
    }));

    ipcCleanups.push(bridge.installer.onPythonSuccess((success) => {
      if (success) {
        setStatus('connected');
        setStatusMessage('Installation complete');
      }
    }));
  };

  const restart = () => {
    getBridge().server.restartApp();
  };

  const forceRestart = () => {
    getBridge().server.forceRestartApp();
  };

  const restartBackend = () => {
    setStatus('loading');
    setStatusMessage('Restarting backend...');
    setError(null);
    getBridge().server.restartBackend();
  };

  const resetToLoading = () => {
    setStatus('loading');
    setStatusMessage('Restarting backend...');
    setError(null);
  };

  onMount(() => {
    setupListeners();
  });

  onCleanup(() => {
    for (const cleanup of ipcCleanups) cleanup();
    ipcCleanups.length = 0;
  });

  const value: ServerContextValue = {
    status,
    statusMessage,
    isLoaded: () => status() === 'connected',
    isConnected: () => status() === 'connected',
    error,
    restart,
    forceRestart,
    restartBackend,
    resetToLoading,
  };

  return (
    <ServerContext.Provider value={value}>
      {props.children}
    </ServerContext.Provider>
  );
};

export function useServer(): ServerContextValue {
  const ctx = useContext(ServerContext);
  if (!ctx) {
    throw new Error('useServer must be used within a ServerProvider');
  }
  return ctx;
}
