import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createTempDir } from '../../../test/helpers/tempDir';
import type { TempDir } from '../../../test/helpers/tempDir';
import { mediaUsageIdentity } from '../../shared/mediaUsage';
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
    handle: vi.fn((channel: string, handler: (event: MockIpcEvent, ...args: unknown[]) => void) => { if (channel === 'save-media-stats') mockIpcListeners.set(channel, [handler]); }),
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

function makeScopedStats(name: string): MediaStats {
  const sourceId = `fixture:${name}`;
  const hash = mediaUsageIdentity('video', sourceId, 'ja');
  return { ...makeStats(hash), mediaName: name, sourceId, usageSessions: {} };
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

describe('source-scoped acknowledged usage owner', () => {
  function contribution(id: string, sequence: number, count: number): MediaStats {
    const stats = makeScopedStats('Shared title');
    stats.usageSessions = { [id]: { id, sequence, finalized: false, date: '2026-10-09', duration: count * 100, wordsLearned: 0,
      wordsEncountered: { term: { word: 'term', ease: 2, timesSeen: count, timesHovered: 0 } }, grammarEncountered: {} } };
    return stats;
  }
  it('merges two callers and rejects stale snapshots across a real disk restart', async () => {
    const first = contribution('first', 1, 1);
    const ack = mod.saveMediaStats(first.mediaHash, first);
    expect(ack.sessionSequences.first).toBe(1);
    mod.saveMediaStats(first.mediaHash, contribution('first', 2, 3));
    mod.saveMediaStats(first.mediaHash, contribution('second', 1, 2));
    mod.saveMediaStats(first.mediaHash, first);
    vi.resetModules(); const restarted = await import('./mediaStatsStorage');
    const recovered = restarted.getMediaStats(first.mediaHash)!;
    expect(recovered.wordsEncountered.term.timesSeen).toBe(5);
    expect(recovered.storageRevision).toBe(4);
  });
  it.each(['write', 'rename'])('does not acknowledge a %s failure and keeps the previous readable file', phase => {
    const first = contribution('first', 1, 1); mod.saveMediaStats(first.mediaHash, first);
    const spy = phase === 'write' ? vi.spyOn(fs, 'writeFileSync') : vi.spyOn(fs, 'renameSync');
    spy.mockImplementationOnce(() => { throw new Error('disk failed'); });
    expect(() => mod.saveMediaStats(first.mediaHash, contribution('first', 2, 9))).toThrow('disk failed');
    spy.mockRestore();
    expect(mod.getMediaStats(first.mediaHash)?.wordsEncountered.term.timesSeen).toBe(1);
    expect(fs.readdirSync(path.join(tempDir.tmpDir, 'media-stats')).filter(file => file.endsWith('.tmp'))).toEqual([]);
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

  it('rejects corrupt JSON without advertising an absent media record', () => {
    const dir = path.join(tempDir.tmpDir, 'media-stats');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'corrupt.json'), '{ invalid', 'utf-8');
    expect(() => mod.getMediaStats('corrupt')).toThrow();
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

describe('pruneMediaStats', () => {
  it('does nothing when entry count is below the cap', () => {
    mod.saveMediaStats('a', makeStats('a'));
    mod.saveMediaStats('b', makeStats('b'));
    mod.pruneMediaStats(10);
    const dir = path.join(tempDir.tmpDir, 'media-stats');
    expect(fs.readdirSync(dir).length).toBe(2);
  });

  it('does nothing when the directory does not exist', () => {
    expect(() => mod.pruneMediaStats(5)).not.toThrow();
  });

  it('removes least-recently-accessed entries until at most maxEntries remain', () => {
    const oldest = makeScopedStats('old');
    oldest.lastAccessed = 1000;
    mod.saveMediaStats(oldest.mediaHash, oldest);

    const middle = makeScopedStats('mid');
    middle.lastAccessed = 5000;
    mod.saveMediaStats(middle.mediaHash, middle);

    const newest = makeScopedStats('new');
    newest.lastAccessed = 9000;
    mod.saveMediaStats(newest.mediaHash, newest);

    mod.pruneMediaStats(2);

    const dir = path.join(tempDir.tmpDir, 'media-stats');
    const remaining = fs.readdirSync(dir).sort();
    expect(remaining).toEqual([`${middle.mediaHash}.json`, `${newest.mediaHash}.json`].sort());
  });

  it('preserves unreadable historical records instead of guessing their usage identity', () => {
    const dir = path.join(tempDir.tmpDir, 'media-stats');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'corrupt.json'), '{ bad', 'utf-8');

    const recent = makeStats('recent');
    recent.lastAccessed = Date.now();
    mod.saveMediaStats('recent', recent);

    mod.pruneMediaStats(1);

    const remaining = fs.readdirSync(dir).sort();
    expect(remaining).toEqual(['corrupt.json', 'recent.json']);
  });

  it('saveMediaStats triggers prune when over the default cap', () => {
    const baseTime = 1_000_000;
    const identities: string[] = [];
    for (let i = 0; i < 502; i++) {
      const s = makeScopedStats(`h${i}`); identities.push(s.mediaHash);
      s.lastAccessed = baseTime + i;
      mod.saveMediaStats(s.mediaHash, s);
    }
    const dir = path.join(tempDir.tmpDir, 'media-stats');
    const files = fs.readdirSync(dir);
    expect(files.length).toBe(500);
    expect(files).toContain(`${identities[501]}.json`);
    expect(files).not.toContain(`${identities[0]}.json`);
    expect(files).not.toContain(`${identities[1]}.json`);
  });
});
