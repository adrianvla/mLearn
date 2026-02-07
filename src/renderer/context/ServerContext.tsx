/**
 * Server Status Context
 * Manages connection to Python backend and server status
 */

import { createContext, useContext, ParentComponent, onMount, onCleanup, createSignal } from 'solid-js';

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
}

const ServerContext = createContext<ServerContextValue>();

export const ServerProvider: ParentComponent = (props) => {
  const [status, setStatus] = createSignal<ServerStatus>('loading');
  const [statusMessage, setStatusMessage] = createSignal('Initializing...');
  const [error, setError] = createSignal<string | null>(null);
  const ipcCleanups: Array<() => void> = [];

  // Check if we're in Electron or tethered mode
  const isElectron = typeof window !== 'undefined' && window.mLearnIPC;

  const setupListeners = () => {
    if (!isElectron) {
      // In tethered mode, assume server is connected
      setStatus('connected');
      setStatusMessage('Connected (Tethered Mode)');
      return;
    }

    // Request initial status
    window.mLearnIPC!.isLoaded();

    // Listen for server load
    ipcCleanups.push(window.mLearnIPC!.onServerLoad((message) => {
      setStatus('connected');
      setStatusMessage(message);
      setError(null);
    }));

    // Listen for status updates
    ipcCleanups.push(window.mLearnIPC!.onServerStatusUpdate((message) => {
      setStatusMessage(message);
      if (message.toLowerCase().includes('error')) {
        setError(message);
      }
    }));

    // Listen for critical errors
    ipcCleanups.push(window.mLearnIPC!.onServerCriticalError((message) => {
      setStatus('error');
      setError(message);
    }));

    // Listen for installation events
    ipcCleanups.push(window.mLearnIPC!.onInstallStarted(() => {
      setStatus('installing');
      setStatusMessage('Installing components...');
    }));

    ipcCleanups.push(window.mLearnIPC!.onPythonSuccess((success) => {
      if (success) {
        setStatus('connected');
        setStatusMessage('Installation complete');
      }
    }));
  };

  const restart = () => {
    if (isElectron) {
      window.mLearnIPC!.restartApp();
    }
  };

  const forceRestart = () => {
    if (isElectron) {
      window.mLearnIPC!.forceRestartApp();
    }
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
