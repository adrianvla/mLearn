import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTempDir } from '../../../test/helpers/tempDir';
import type { TempDir } from '../../../test/helpers/tempDir';

const mockIpcHandlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
const mockAppListeners = new Map<string, ((...args: unknown[]) => void)[]>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
      mockIpcHandlers.set(channel, handler);
    }),
    on: vi.fn(),
    removeHandler: vi.fn(),
  },
  app: {
    getPath: vi.fn(() => '/tmp/test'),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const existing = mockAppListeners.get(event) ?? [];
      existing.push(handler);
      mockAppListeners.set(event, existing);
    }),
    isPackaged: false,
  },
}));

let tempDir: TempDir;

vi.mock('../utils/platform', () => ({
  getUserDataPath: vi.fn(() => tempDir?.tmpDir ?? '/tmp/test'),
  getAppPath: vi.fn(() => tempDir?.tmpDir ?? '/tmp/test'),
  getResourcePath: vi.fn(() => tempDir?.tmpDir ?? '/tmp/test'),
}));

let mod: typeof import('./kvStore');

beforeEach(async () => {
  tempDir = createTempDir();
  vi.resetModules();
  mockIpcHandlers.clear();
  mockAppListeners.clear();
  mod = await import('./kvStore');
});

afterEach(() => {
  tempDir.cleanup();
});

describe('setupKVStoreIPC', () => {
  it('registers handler for KV_GET channel', () => {
    mod.setupKVStoreIPC();
    expect(mockIpcHandlers.has('kv-get')).toBe(true);
  });

  it('registers handler for KV_SET channel', () => {
    mod.setupKVStoreIPC();
    expect(mockIpcHandlers.has('kv-set')).toBe(true);
  });

  it('registers handler for KV_REMOVE channel', () => {
    mod.setupKVStoreIPC();
    expect(mockIpcHandlers.has('kv-remove')).toBe(true);
  });

  it('registers handler for KV_GET_ALL channel', () => {
    mod.setupKVStoreIPC();
    expect(mockIpcHandlers.has('kv-get-all')).toBe(true);
  });

  it('registers handler for KV_SET_BATCH channel', () => {
    mod.setupKVStoreIPC();
    expect(mockIpcHandlers.has('kv-set-batch')).toBe(true);
  });

  it('registers before-quit listener on app', () => {
    mod.setupKVStoreIPC();
    expect(mockAppListeners.has('before-quit')).toBe(true);
  });
});

describe('KV_GET handler', () => {
  beforeEach(() => {
    mod.setupKVStoreIPC();
  });

  it('returns null for a key that does not exist', async () => {
    const handler = mockIpcHandlers.get('kv-get');
    const result = await handler!(null, 'missing-key');
    expect(result).toBeNull();
  });

  it('returns the value after it has been set', async () => {
    const setHandler = mockIpcHandlers.get('kv-set');
    const getHandler = mockIpcHandlers.get('kv-get');
    await setHandler!(null, 'myKey', 'myValue');
    const result = await getHandler!(null, 'myKey');
    expect(result).toBe('myValue');
  });

  it('returns null for a key that has been removed', async () => {
    const setHandler = mockIpcHandlers.get('kv-set');
    const removeHandler = mockIpcHandlers.get('kv-remove');
    const getHandler = mockIpcHandlers.get('kv-get');
    await setHandler!(null, 'tempKey', 'tempValue');
    await removeHandler!(null, 'tempKey');
    const result = await getHandler!(null, 'tempKey');
    expect(result).toBeNull();
  });
});

describe('KV_SET handler', () => {
  beforeEach(() => {
    mod.setupKVStoreIPC();
  });

  it('stores a value that persists across get calls', async () => {
    const setHandler = mockIpcHandlers.get('kv-set');
    const getHandler = mockIpcHandlers.get('kv-get');
    await setHandler!(null, 'testKey', 'testValue');
    const result = await getHandler!(null, 'testKey');
    expect(result).toBe('testValue');
  });

  it('overwrites an existing value', async () => {
    const setHandler = mockIpcHandlers.get('kv-set');
    const getHandler = mockIpcHandlers.get('kv-get');
    await setHandler!(null, 'k', 'first');
    await setHandler!(null, 'k', 'second');
    const result = await getHandler!(null, 'k');
    expect(result).toBe('second');
  });

  it('stores multiple distinct keys independently', async () => {
    const setHandler = mockIpcHandlers.get('kv-set');
    const getHandler = mockIpcHandlers.get('kv-get');
    await setHandler!(null, 'a', 'alpha');
    await setHandler!(null, 'b', 'beta');
    expect(await getHandler!(null, 'a')).toBe('alpha');
    expect(await getHandler!(null, 'b')).toBe('beta');
  });
});

describe('KV_REMOVE handler', () => {
  beforeEach(() => {
    mod.setupKVStoreIPC();
  });

  it('removes an existing key', async () => {
    const setHandler = mockIpcHandlers.get('kv-set');
    const removeHandler = mockIpcHandlers.get('kv-remove');
    const getHandler = mockIpcHandlers.get('kv-get');
    await setHandler!(null, 'key', 'val');
    await removeHandler!(null, 'key');
    expect(await getHandler!(null, 'key')).toBeNull();
  });

  it('does not throw when removing a key that does not exist', async () => {
    const removeHandler = mockIpcHandlers.get('kv-remove');
    await expect(removeHandler!(null, 'nonexistent')).resolves.not.toThrow();
  });

  it('removes only the targeted key', async () => {
    const setHandler = mockIpcHandlers.get('kv-set');
    const removeHandler = mockIpcHandlers.get('kv-remove');
    const getHandler = mockIpcHandlers.get('kv-get');
    await setHandler!(null, 'keep', 'value');
    await setHandler!(null, 'drop', 'value');
    await removeHandler!(null, 'drop');
    expect(await getHandler!(null, 'keep')).toBe('value');
    expect(await getHandler!(null, 'drop')).toBeNull();
  });
});

describe('KV_GET_ALL handler', () => {
  beforeEach(() => {
    mod.setupKVStoreIPC();
  });

  it('returns empty object when store has no entries', async () => {
    const getAllHandler = mockIpcHandlers.get('kv-get-all');
    const result = await getAllHandler!(null);
    expect(result).toEqual({});
  });

  it('returns all stored key-value pairs', async () => {
    const setHandler = mockIpcHandlers.get('kv-set');
    const getAllHandler = mockIpcHandlers.get('kv-get-all');
    await setHandler!(null, 'x', '1');
    await setHandler!(null, 'y', '2');
    const result = await getAllHandler!(null);
    expect(result).toEqual({ x: '1', y: '2' });
  });

  it('returns a copy — mutations do not affect internal store', async () => {
    const setHandler = mockIpcHandlers.get('kv-set');
    const getAllHandler = mockIpcHandlers.get('kv-get-all');
    await setHandler!(null, 'a', '1');
    const snapshot = await getAllHandler!(null) as Record<string, string>;
    snapshot['injected'] = 'evil';
    const snapshot2 = await getAllHandler!(null) as Record<string, string>;
    expect(snapshot2['injected']).toBeUndefined();
  });
});

describe('KV_SET_BATCH handler', () => {
  beforeEach(() => {
    mod.setupKVStoreIPC();
  });

  it('sets multiple keys in a single call', async () => {
    const batchHandler = mockIpcHandlers.get('kv-set-batch');
    const getHandler = mockIpcHandlers.get('kv-get');
    await batchHandler!(null, { p: '1', q: '2', r: '3' });
    expect(await getHandler!(null, 'p')).toBe('1');
    expect(await getHandler!(null, 'q')).toBe('2');
    expect(await getHandler!(null, 'r')).toBe('3');
  });

  it('merges batch entries with existing keys', async () => {
    const setHandler = mockIpcHandlers.get('kv-set');
    const batchHandler = mockIpcHandlers.get('kv-set-batch');
    const getHandler = mockIpcHandlers.get('kv-get');
    await setHandler!(null, 'existing', 'old');
    await batchHandler!(null, { existing: 'new', fresh: 'value' });
    expect(await getHandler!(null, 'existing')).toBe('new');
    expect(await getHandler!(null, 'fresh')).toBe('value');
  });

  it('handles empty batch without error', async () => {
    const batchHandler = mockIpcHandlers.get('kv-set-batch');
    const getAllHandler = mockIpcHandlers.get('kv-get-all');
    await expect(batchHandler!(null, {})).resolves.not.toThrow();
    expect(await getAllHandler!(null)).toEqual({});
  });
});

describe('file persistence', () => {
  it('persists data to disk after flushing', async () => {
    mod.setupKVStoreIPC();
    const setHandler = mockIpcHandlers.get('kv-set');
    await setHandler!(null, 'persistent', 'yes');

    const listeners = mockAppListeners.get('before-quit') ?? [];
    for (const listener of listeners) {
      listener();
    }

    await new Promise(r => setTimeout(r, 50));

    const fs = await import('fs');
    const path = await import('path');
    const storePath = path.join(tempDir.tmpDir, 'kv-store.json');
    expect(fs.existsSync(storePath)).toBe(true);
    const contents = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
    expect(contents).toEqual({ persistent: 'yes' });
  });

  it('loads existing data from disk on first access', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const storePath = path.join(tempDir.tmpDir, 'kv-store.json');
    fs.writeFileSync(storePath, JSON.stringify({ preloaded: 'data' }), 'utf-8');

    vi.resetModules();
    mod = await import('./kvStore');
    mod.setupKVStoreIPC();

    const getHandler = mockIpcHandlers.get('kv-get');
    const result = await getHandler!(null, 'preloaded');
    expect(result).toBe('data');
  });

  it('falls back to empty store when file contains corrupt JSON', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const storePath = path.join(tempDir.tmpDir, 'kv-store.json');
    fs.writeFileSync(storePath, '{ this is not valid json', 'utf-8');

    vi.resetModules();
    mod = await import('./kvStore');
    mod.setupKVStoreIPC();

    const getHandler = mockIpcHandlers.get('kv-get');
    const result = await getHandler!(null, 'anything');
    expect(result).toBeNull();
  });

  it('falls back to empty store when file contains a JSON array', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const storePath = path.join(tempDir.tmpDir, 'kv-store.json');
    fs.writeFileSync(storePath, JSON.stringify([1, 2, 3]), 'utf-8');

    vi.resetModules();
    mod = await import('./kvStore');
    mod.setupKVStoreIPC();

    const getAllHandler = mockIpcHandlers.get('kv-get-all');
    const result = await getAllHandler!(null);
    expect(result).toEqual({});
  });
});

describe('before-quit flush', () => {
  it('calls flushPending via before-quit app event', async () => {
    mod.setupKVStoreIPC();
    const setHandler = mockIpcHandlers.get('kv-set');
    await setHandler!(null, 'flush-test', 'value');

    const listeners = mockAppListeners.get('before-quit') ?? [];
    expect(listeners.length).toBeGreaterThan(0);

    expect(() => {
      for (const listener of listeners) {
        listener();
      }
    }).not.toThrow();
  });
});
