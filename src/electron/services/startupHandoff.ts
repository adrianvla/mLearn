import { BrowserWindow, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';

export type StartupWindowState = 'language' | 'library' | 'backend' | 'ready';

/** Accept readiness only from the window being revealed. */
export function waitForMainWindowStartup(
  window: BrowserWindow,
  onState: (state: StartupWindowState) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onClosed = (): void => {
      ipcMain.removeListener(IPC_CHANNELS.STARTUP_RENDERER_READY, onReady);
      reject(new Error('Main window closed during startup'));
    };
    const onReady = (event: Electron.IpcMainEvent, state: unknown): void => {
      if (event.sender !== window.webContents) return;
      if (state !== 'language' && state !== 'library' && state !== 'backend' && state !== 'ready') return;
      onState(state);
      if (state === 'ready') {
        ipcMain.removeListener(IPC_CHANNELS.STARTUP_RENDERER_READY, onReady);
        window.removeListener('closed', onClosed);
        resolve();
      }
    };
    ipcMain.on(IPC_CHANNELS.STARTUP_RENDERER_READY, onReady);
    window.once('closed', onClosed);
  });
}
