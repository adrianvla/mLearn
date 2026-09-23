import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { waitForMainWindowStartup } from './startupHandoff';
import { IPC_CHANNELS } from '../../shared/constants';

const ipc = vi.hoisted(() => {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    on: (channel: string, listener: (...args: unknown[]) => void) => {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel)!.add(listener);
    },
    removeListener: (channel: string, listener: (...args: unknown[]) => void) => {
      listeners.get(channel)?.delete(listener);
    },
    emit: (channel: string, ...args: unknown[]) => {
      listeners.get(channel)?.forEach((listener) => listener(...args));
    },
    listenerCount: (channel: string) => listeners.get(channel)?.size ?? 0,
  };
});
vi.mock('electron', () => ({ ipcMain: ipc }));

describe('startup window handoff', () => {
  it('ignores readiness from another window and resolves on the main window', async () => {
    const sender = {} as Electron.WebContents;
    const window = Object.assign(new EventEmitter(), { webContents: sender }) as Electron.BrowserWindow;
    const onState = vi.fn();
    const ready = waitForMainWindowStartup(window, onState);
    ipc.emit(IPC_CHANNELS.STARTUP_RENDERER_READY, { sender: {} }, 'ready');
    ipc.emit(IPC_CHANNELS.STARTUP_RENDERER_READY, { sender }, 'invalid');
    expect(onState).not.toHaveBeenCalled();
    ipc.emit(IPC_CHANNELS.STARTUP_RENDERER_READY, { sender }, 'language');
    ipc.emit(IPC_CHANNELS.STARTUP_RENDERER_READY, { sender }, 'ready');
    await expect(ready).resolves.toBeUndefined();
    expect(onState.mock.calls.map(([state]) => state)).toEqual(['language', 'ready']);
    expect(ipc.listenerCount(IPC_CHANNELS.STARTUP_RENDERER_READY)).toBe(0);
  });
});
