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
import { guardianForWrites } from './guardian';

const log = getLogger('electron.kvStore');

let store: Record<string, string> | null = null;

// Write queue for serialising concurrent async writes
let writeQueue: Promise<void> = Promise.resolve();
let queuedWrites = 0;
function enqueueWrite(fn: () => Promise<void>): Promise<void> {
  queuedWrites += 1;
  writeQueue = writeQueue.then(fn, fn).finally(() => {
    queuedWrites -= 1;
  });
  return writeQueue;
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingWrite = false;
let activeMutations = 0;
let activeMutationsIdle: Promise<void> = Promise.resolve();
let resolveActiveMutationsIdle: (() => void) | null = null;

async function withStoreMutation(operation: () => Promise<void>): Promise<void> {
  if (activeMutations === 0) {
    activeMutationsIdle = new Promise<void>((resolve) => {
      resolveActiveMutationsIdle = resolve;
    });
  }
  activeMutations += 1;

  try {
    await operation();
  } finally {
    activeMutations -= 1;
    if (activeMutations === 0) {
      resolveActiveMutationsIdle?.();
      resolveActiveMutationsIdle = null;
    }
  }
}

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
    const guardian = guardianForWrites();
    guardian?.checkKvWrite(store);
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
    guardian?.recordKvWrite(store);
  } catch (error) {
    log.error('[kvStore] Failed to persist store:', error);
    throw error;
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

function hasPendingWrites(): boolean {
  return activeMutations > 0 || pendingWrite || debounceTimer !== null || queuedWrites > 0;
}

/** Flushes pending writes and waits until the write queue is idle. */
export async function flushKVStore(): Promise<void> {
  while (true) {
    if (activeMutations > 0) {
      await activeMutationsIdle;
      continue;
    }
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (pendingWrite) {
      pendingWrite = false;
      enqueueWrite(() => persistStore());
    }

    const queueAtStart = writeQueue;
    await queueAtStart;
    if (activeMutations === 0 && !pendingWrite && debounceTimer === null && queuedWrites === 0 && queueAtStart === writeQueue) {
      return;
    }
  }
}

export function setupKVStoreIPC(): void {
  let quitAfterFlush = false;
  let flushInProgress = false;
  app.on('before-quit', (event) => {
    if (quitAfterFlush || !hasPendingWrites()) return;

    event.preventDefault();
    if (flushInProgress) return;

    flushInProgress = true;
    void flushKVStore().then(() => {
      quitAfterFlush = true;
      app.quit();
    }).catch((error: unknown) => {
      flushInProgress = false;
      log.error('[kvStore] Failed to flush store before quit:', error);
    });
  });

  ipcMain.handle(IPC_CHANNELS.KV_GET, async (_event, key: string): Promise<string | null> => {
    const s = await loadStore();
    return s[key] ?? null;
  });

  ipcMain.handle(IPC_CHANNELS.KV_SET, async (_event, key: string, value: string): Promise<void> => {
    await withStoreMutation(async () => {
      const s = await loadStore();
      s[key] = value;
      schedulePersist();
    });
  });

  ipcMain.handle(IPC_CHANNELS.KV_REMOVE, async (_event, key: string): Promise<void> => {
    await withStoreMutation(async () => {
      const s = await loadStore();
      delete s[key];
      schedulePersist();
    });
  });

  ipcMain.handle(IPC_CHANNELS.KV_GET_ALL, async (): Promise<Record<string, string>> => {
    return { ...(await loadStore()) };
  });

  ipcMain.handle(IPC_CHANNELS.KV_SET_BATCH, async (_event, entries: Record<string, string>): Promise<void> => {
    await withStoreMutation(async () => {
      const s = await loadStore();
      for (const [key, value] of Object.entries(entries)) {
        s[key] = value;
      }
      schedulePersist();
    });
  });
}
