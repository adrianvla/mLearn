/**
 * Key-Value Store Service
 * File-based key-value storage to replace renderer localStorage usage.
 * Stores data in {userData}/kv-store.json as a flat JSON object.
 */

import fs from 'fs';
import path from 'path';
import { app, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { getUserDataPath } from '../utils/platform';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger('electron.kvStore');

let store: Record<string, string> | null = null;

// Write queue for serialising concurrent async writes
let writeQueue: Promise<void> = Promise.resolve();
function enqueueWrite(fn: () => Promise<void>): Promise<void> {
  writeQueue = writeQueue.then(fn, fn);
  return writeQueue;
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingWrite = false;

function getStorePath(): string {
  return path.join(getUserDataPath(), 'kv-store.json');
}

async function loadStore(): Promise<Record<string, string>> {
  if (store) return store;
  try {
    const storePath = getStorePath();
    try {
      await fs.promises.access(storePath);
    } catch (e) {
      log.error("error", e);
      store = {};
      return store;
    }
    const data = await fs.promises.readFile(storePath, 'utf-8');
    const parsed: unknown = JSON.parse(data);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      store = parsed as Record<string, string>;
    } else {
      log.warn('[kvStore] Loaded data is not a plain object — using empty store');
      store = {};
    }
    return store;
  } catch (error) {
    log.error('[kvStore] Failed to load store:', error);
    store = {};
    return store;
  }
}

async function persistStore(): Promise<void> {
  try {
    const storePath = getStorePath();
    const tmpPath = `${storePath}.tmp`;
    const dir = path.dirname(storePath);
    try {
      await fs.promises.access(dir);
    } catch (e) {
      log.error("error", e);
      await fs.promises.mkdir(dir, { recursive: true });
    }
    await fs.promises.writeFile(tmpPath, JSON.stringify(store, null, 2));
    await fs.promises.rename(tmpPath, storePath);
  } catch (error) {
    log.error('[kvStore] Failed to persist store:', error);
  }
}

function schedulePersist(): void {
  pendingWrite = true;
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    if (pendingWrite) {
      pendingWrite = false;
      enqueueWrite(() => persistStore());
    }
  }, 100);
}

function flushPending(): void {
  if (pendingWrite && debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
    pendingWrite = false;
    enqueueWrite(() => persistStore());
  }
}

export function setupKVStoreIPC(): void {
  app.on('before-quit', () => flushPending());

  ipcMain.handle(IPC_CHANNELS.KV_GET, async (_event, key: string): Promise<string | null> => {
    const s = await loadStore();
    return s[key] ?? null;
  });

  ipcMain.handle(IPC_CHANNELS.KV_SET, async (_event, key: string, value: string): Promise<void> => {
    const s = await loadStore();
    s[key] = value;
    schedulePersist();
  });

  ipcMain.handle(IPC_CHANNELS.KV_REMOVE, async (_event, key: string): Promise<void> => {
    const s = await loadStore();
    delete s[key];
    schedulePersist();
  });

  ipcMain.handle(IPC_CHANNELS.KV_GET_ALL, async (): Promise<Record<string, string>> => {
    return { ...(await loadStore()) };
  });

  ipcMain.handle(IPC_CHANNELS.KV_SET_BATCH, async (_event, entries: Record<string, string>): Promise<void> => {
    const s = await loadStore();
    for (const [key, value] of Object.entries(entries)) {
      s[key] = value;
    }
    schedulePersist();
  });
}
