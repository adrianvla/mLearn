/**
 * Install Progress Context
 * Tracks active installations (Python runtime, component packages, reconciliation)
 * and exposes a simple state machine for the GlobalInstallProgressModal.
 * Deliberately lightweight: no log accumulation, just the current message + percent.
 */

import { createContext, useContext, ParentComponent, onMount, onCleanup, createSignal } from 'solid-js';
import { getBridge } from '../../shared/bridges';
import { isElectron } from '../../shared/platform';

interface InstallProgressContextValue {
  isInstalling: () => boolean;
  installMessage: () => string;
  installProgress: () => number; // 0–100, or -1 for indeterminate
  installError: () => string | null;
}

const InstallProgressContext = createContext<InstallProgressContextValue>();

const DEFAULT_MESSAGE = 'Preparing…';

export const InstallProgressProvider: ParentComponent = (props) => {
  const [isInstalling, setIsInstalling] = createSignal(false);
  const [installMessage, setInstallMessage] = createSignal(DEFAULT_MESSAGE);
  const [installProgress, setInstallProgress] = createSignal(-1);
  const [installError, setInstallError] = createSignal<string | null>(null);
  const ipcCleanups: Array<() => void> = [];

  const isElectronApp = isElectron();

  onMount(() => {
    if (!isElectronApp) return;

    const bridge = getBridge();

    ipcCleanups.push(bridge.installer.onInstallStarted(() => {
      setIsInstalling(true);
      setInstallError(null);
      setInstallProgress(-1);
      setInstallMessage(DEFAULT_MESSAGE);
    }));

    ipcCleanups.push(bridge.server.onServerStatusUpdate((message: string) => {
      // Only capture status while installing — once the backend is loaded,
      // status updates are regular runtime logs, not install progress.
      if (!isInstalling()) return;
      setInstallMessage(message);

      // Map common milestone substrings to progress percentages
      const lower = message.toLowerCase();
      if (lower.includes('downloading python')) {
        const pctMatch = message.match(/(\d+)%/);
        setInstallProgress(pctMatch ? Math.min(30, 5 + Math.round(parseInt(pctMatch[1]) * 0.25)) : 5);
      } else if (lower.includes('download complete') || lower.includes('extracting')) {
        setInstallProgress(35);
      } else if (lower.includes('extraction complete') || lower.includes('installing') && lower.includes('component')) {
        setInstallProgress(45);
      } else if (lower.includes('starting python backend')) {
        setInstallProgress(-1);
      } else if (lower.includes('installation complete')) {
        setInstallProgress(100);
      }
    }));

    ipcCleanups.push(bridge.installer.onPipProgress((progress) => {
      if (progress.action === 'complete') {
        setInstallProgress(95);
      } else if (progress.action === 'installing') {
        setInstallProgress(90);
      } else {
        // Asymptotic curve toward 89% as more packages complete
        const current = installProgress();
        const next = 45 + 45 * (1 - 1 / (1 + (current - 44) / 10));
        setInstallProgress(Math.min(89, Math.max(current, Math.round(next))));
      }
      if (progress.packageName) {
        setInstallMessage(`Installing ${progress.packageName}…`);
      }
    }));

    ipcCleanups.push(bridge.installer.onPythonSuccess(() => {
      setIsInstalling(false);
      setInstallProgress(-1);
      setInstallMessage(DEFAULT_MESSAGE);
    }));

    ipcCleanups.push(bridge.installer.onInstallerAwaitingChoice(() => {
      setIsInstalling(false);
    }));

    ipcCleanups.push(bridge.installer.onInstallerNetworkError((payload: { message: string; detail?: string | null }) => {
      setInstallError(payload.detail ? `${payload.message}: ${payload.detail}` : payload.message);
    }));
  });

  onCleanup(() => {
    ipcCleanups.forEach((cleanup) => cleanup());
  });

  return (
    <InstallProgressContext.Provider value={{ isInstalling, installMessage, installProgress, installError }}>
      {props.children}
    </InstallProgressContext.Provider>
  );
};

export function useInstallProgress(): InstallProgressContextValue {
  const ctx = useContext(InstallProgressContext);
  if (!ctx) {
    throw new Error('useInstallProgress must be used within an InstallProgressProvider');
  }
  return ctx;
}
