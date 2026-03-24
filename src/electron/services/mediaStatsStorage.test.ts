import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createTempDir } from '../../../test/helpers/tempDir';
import type { TempDir } from '../../../test/helpers/tempDir';
import type { MediaStats } from '../../shared/types';

const mockIpcListeners = new Map<string, ((event: MockIpcEvent, ...args: unknown[]) => void)[]>();

interface MockIpcEvent {
  reply: ReturnType<typeof vi.fn>;
}

vi.mock('electron', () => ({
  ipcMain: {
    on: vi.fn((channel: string, handler: (event: MockIpcEvent, ...args: unknown[]) => void) => {
      const existing = mockIpcListeners.get(channel) ?? [];
      existing.push(handler);
      mockIpcListeners.set(channel, existing);
    }),
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
  app: {
    getPath: vi.fn(() => '/tmp/test'),
    on: vi.fn(),
    isPackaged: false,
  },
}));

let tempDir: TempDir;

vi.mock('../utils/platform', () => ({
  getUserDataPath: vi.fn(() => tempDir?.tmpDir ?? '/tmp/test'),
  getAppPath: vi.fn(() => tempDir?.tmpDir ?? '/tmp/test'),
  getResourcePath: vi.fn(() => tempDir?.tmpDir ?? '/tmp/test'),
}));

let mod: typeof import('./mediaStatsStorage');

beforeEach(async () => {
  tempDir = createTempDir();
  vi.resetModules();
  mockIpcListeners.clear();
  mod = await import('./mediaStatsStorage');
});

afterEach(() => {
  tempDir.cleanup();
});

function makeEvent(): MockIpcEvent {
  return { reply: vi.fn() };
}

function makeStats(hash: string): MediaStats {
  return {
    mediaHash: hash,
    mediaName: `Media ${hash}`,
    mediaType: 'video',
    language: 'ja',
    wordsEncountered: {},
    grammarEncountered: {},
    assessedLevel: null,
    sessions: [],
    totalTimeSpent: 0,
    lastAccessed: Date.now(),
  };
}

describe('saveMediaStats', () => {
  it('creates the media-stats directory if it does not exist', () => {
    mod.saveMediaStats('hash1', makeStats('hash1'));
    const dir = path.join(tempDir.tmpDir, 'media-stats');
    expect(fs.existsSync(dir)).toBe(true);
  });

  it('writes a JSON file named {hash}.json', () => {
    mod.saveMediaStats('abc123', makeStats('abc123'));
    const file = path.join(tempDir.tmpDir, 'media-stats', 'abc123.json');
    expect(fs.existsSync(file)).toBe(true);
  });

  it('serializes the stats object to disk', () => {
    const stats = makeStats('s1');
    stats.totalTimeSpent = 500;
    mod.saveMediaStats('s1', stats);
    const file = path.join(tempDir.tmpDir, 'media-stats', 's1.json');
    const loaded = JSON.parse(fs.readFileSync(file, 'utf-8')) as MediaStats;
    expect(loaded.totalTimeSpent).toBe(500);
    expect(loaded.mediaHash).toBe('s1');
  });

  it('overwrites an existing file for the same hash', () => {
    const first = makeStats('dup');
    first.totalTimeSpent = 10;
    mod.saveMediaStats('dup', first);
    const second = makeStats('dup');
    second.totalTimeSpent = 99;
    mod.saveMediaStats('dup', second);
    const file = path.join(tempDir.tmpDir, 'media-stats', 'dup.json');
    const loaded = JSON.parse(fs.readFileSync(file, 'utf-8')) as MediaStats;
    expect(loaded.totalTimeSpent).toBe(99);
  });

  it('stores multiple hashes as separate files', () => {
    mod.saveMediaStats('m1', makeStats('m1'));
    mod.saveMediaStats('m2', makeStats('m2'));
    const dir = path.join(tempDir.tmpDir, 'media-stats');
    const files = fs.readdirSync(dir);
    expect(files).toContain('m1.json');
    expect(files).toContain('m2.json');
  });
});

describe('getMediaStats', () => {
  it('returns null when no file exists for the given hash', () => {
    const result = mod.getMediaStats('nonexistent');
    expect(result).toBeNull();
  });

  it('returns the stats object for an existing hash', () => {
    const stats = makeStats('get1');
    mod.saveMediaStats('get1', stats);
    const result = mod.getMediaStats('get1');
    expect(result).toBeDefined();
    expect(result?.mediaHash).toBe('get1');
  });

  it('returns the full stats object with all fields', () => {
    const stats = makeStats('full');
    stats.totalTimeSpent = 123;
    stats.language = 'de';
    mod.saveMediaStats('full', stats);
    const result = mod.getMediaStats('full');
    expect(result?.totalTimeSpent).toBe(123);
    expect(result?.language).toBe('de');
  });

  it('returns null when the file contains corrupt JSON', () => {
    const dir = path.join(tempDir.tmpDir, 'media-stats');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'corrupt.json'), '{ invalid', 'utf-8');
    const result = mod.getMediaStats('corrupt');
    expect(result).toBeNull();
  });
});

describe('listMediaStats', () => {
  it('returns empty array when no stats files exist', () => {
    const result = mod.listMediaStats();
    expect(result).toEqual([]);
  });

  it('returns all saved stats', () => {
    mod.saveMediaStats('a', makeStats('a'));
    mod.saveMediaStats('b', makeStats('b'));
    mod.saveMediaStats('c', makeStats('c'));
    const result = mod.listMediaStats();
    expect(result).toHaveLength(3);
  });

  it('returns stats with correct mediaHash values', () => {
    mod.saveMediaStats('x1', makeStats('x1'));
    mod.saveMediaStats('x2', makeStats('x2'));
    const result = mod.listMediaStats();
    const hashes = result.map(s => s.mediaHash).sort();
    expect(hashes).toEqual(['x1', 'x2']);
  });

  it('skips corrupt JSON files and returns valid ones', () => {
    mod.saveMediaStats('valid', makeStats('valid'));
    const dir = path.join(tempDir.tmpDir, 'media-stats');
    fs.writeFileSync(path.join(dir, 'bad.json'), '{ bad json', 'utf-8');
    const result = mod.listMediaStats();
    expect(result).toHaveLength(1);
    expect(result[0].mediaHash).toBe('valid');
  });

  it('creates the media-stats directory when it does not exist', () => {
    const result = mod.listMediaStats();
    const dir = path.join(tempDir.tmpDir, 'media-stats');
    expect(fs.existsSync(dir)).toBe(true);
    expect(result).toEqual([]);
  });

  it('ignores non-JSON files in the media-stats directory', () => {
    const dir = path.join(tempDir.tmpDir, 'media-stats');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignore', 'utf-8');
    mod.saveMediaStats('good', makeStats('good'));
    const result = mod.listMediaStats();
    expect(result).toHaveLength(1);
  });
});

describe('setupMediaStatsIPC', () => {
  it('registers listener for SAVE_MEDIA_STATS channel', () => {
    mod.setupMediaStatsIPC();
    expect(mockIpcListeners.has('save-media-stats')).toBe(true);
  });

  it('registers listener for GET_MEDIA_STATS channel', () => {
    mod.setupMediaStatsIPC();
    expect(mockIpcListeners.has('get-media-stats')).toBe(true);
  });

  it('registers listener for LIST_MEDIA_STATS channel', () => {
    mod.setupMediaStatsIPC();
    expect(mockIpcListeners.has('list-media-stats')).toBe(true);
  });
});

describe('SAVE_MEDIA_STATS IPC handler', () => {
  it('saves stats to disk when invoked', () => {
    mod.setupMediaStatsIPC();
    const handlers = mockIpcListeners.get('save-media-stats') ?? [];
    const event = makeEvent();
    const stats = makeStats('ipc-save');
    for (const h of handlers) h(event, 'ipc-save', stats);
    const file = path.join(tempDir.tmpDir, 'media-stats', 'ipc-save.json');
    expect(fs.existsSync(file)).toBe(true);
  });

  it('does not send a reply after saving', () => {
    mod.setupMediaStatsIPC();
    const handlers = mockIpcListeners.get('save-media-stats') ?? [];
    const event = makeEvent();
    for (const h of handlers) h(event, 'no-reply', makeStats('no-reply'));
    expect(event.reply).not.toHaveBeenCalled();
  });
});

describe('GET_MEDIA_STATS IPC handler', () => {
  it('replies with null when stats file does not exist', () => {
    mod.setupMediaStatsIPC();
    const handlers = mockIpcListeners.get('get-media-stats') ?? [];
    const event = makeEvent();
    for (const h of handlers) h(event, 'missing');
    expect(event.reply).toHaveBeenCalledWith('get-media-stats', null);
  });

  it('replies with the stats object when file exists', () => {
    mod.saveMediaStats('ipc-get', makeStats('ipc-get'));
    mod.setupMediaStatsIPC();
    const handlers = mockIpcListeners.get('get-media-stats') ?? [];
    const event = makeEvent();
    for (const h of handlers) h(event, 'ipc-get');
    expect(event.reply).toHaveBeenCalledWith('get-media-stats', expect.objectContaining({ mediaHash: 'ipc-get' }));
  });
});

describe('LIST_MEDIA_STATS IPC handler', () => {
  it('replies with empty array when no stats exist', () => {
    mod.setupMediaStatsIPC();
    const handlers = mockIpcListeners.get('list-media-stats') ?? [];
    const event = makeEvent();
    for (const h of handlers) h(event);
    expect(event.reply).toHaveBeenCalledWith('list-media-stats', []);
  });

  it('replies with all saved stats', () => {
    mod.saveMediaStats('l1', makeStats('l1'));
    mod.saveMediaStats('l2', makeStats('l2'));
    mod.setupMediaStatsIPC();
    const handlers = mockIpcListeners.get('list-media-stats') ?? [];
    const event = makeEvent();
    for (const h of handlers) h(event);
    const [, result] = event.reply.mock.calls[0] as [string, MediaStats[]];
    expect(result).toHaveLength(2);
  });
});
