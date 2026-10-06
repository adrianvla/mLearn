import { BrowserWindow, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';

export type StartupWindowState = 'theme-ready' | 'language' | 'library' | 'library-error' | 'backend' | 'ready';

/** Accept readiness only from the window being revealed. */
export function waitForMainWindowStartup(
  window: BrowserWindow,
  onState: (state: StartupWindowState) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      ipcMain.removeListener(IPC_CHANNELS.STARTUP_RENDERER_READY, onReady);
      window.removeListener('closed', onClosed);
    };
    const onClosed = (): void => {
      cleanup();
      if (!settled) reject(new Error('Main window closed during startup'));
    };
    const onReady = (event: Electron.IpcMainEvent, state: unknown): void => {
      if (event.sender !== window.webContents) return;
      if (state !== 'theme-ready' && state !== 'language' && state !== 'library' && state !== 'library-error' && state !== 'backend' && state !== 'ready') return;
      onState(state);
      if (state === 'theme-ready' && !settled) {
        settled = true;
        resolve();
      }
      if (state === 'ready' || state === 'library-error') {
        cleanup();
        if (!settled) {
          settled = true;
          resolve();
        }
      }
    };
    ipcMain.on(IPC_CHANNELS.STARTUP_RENDERER_READY, onReady);
    window.once('closed', onClosed);
  });
}
