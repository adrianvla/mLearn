/**
 * Key-Value Store Service
 * File-based key-value storage to replace renderer localStorage usage.
 * Stores data in {userData}/kv-store.json as a flat JSON object.
 */

import fs from 'fs';
import path from 'path';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { getUserDataPath } from '../utils/platform';

let store: Record<string, string> | null = null;

function getStorePath(): string {
  return path.join(getUserDataPath(), 'kv-store.json');
}

function loadStore(): Record<string, string> {
  if (store) return store;
  try {
    const storePath = getStorePath();
    if (fs.existsSync(storePath)) {
      const data = fs.readFileSync(storePath, 'utf-8');
      store = JSON.parse(data);
      return store!;
    }
  } catch (error) {
    console.error('[kvStore] Failed to load store:', error);
  }
  store = {};
  return store;
}

function persistStore(): void {
  try {
    const storePath = getStorePath();
    const dir = path.dirname(storePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
  } catch (error) {
    console.error('[kvStore] Failed to persist store:', error);
  }
}

export function setupKVStoreIPC(): void {
  ipcMain.handle(IPC_CHANNELS.KV_GET, (_event, key: string): string | null => {
    const s = loadStore();
    return s[key] ?? null;
  });

  ipcMain.handle(IPC_CHANNELS.KV_SET, (_event, key: string, value: string): void => {
    const s = loadStore();
    s[key] = value;
    persistStore();
  });

  ipcMain.handle(IPC_CHANNELS.KV_REMOVE, (_event, key: string): void => {
    const s = loadStore();
    delete s[key];
    persistStore();
  });

  ipcMain.handle(IPC_CHANNELS.KV_GET_ALL, (): Record<string, string> => {
    return { ...loadStore() };
  });

  ipcMain.handle(IPC_CHANNELS.KV_SET_BATCH, (_event, entries: Record<string, string>): void => {
    const s = loadStore();
    for (const [key, value] of Object.entries(entries)) {
      s[key] = value;
    }
    persistStore();
  });
}
