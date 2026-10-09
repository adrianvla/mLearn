/**
 * Media Stats Storage Service
 * Persists per-media analytics as individual JSON files in userData/media-stats/
 */

import fs from 'fs';
import path from 'path';
import { ipcMain, IpcMainEvent } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { mergeMediaUsage } from '../../shared/mediaUsage';
import crypto from 'crypto';
import type { MediaStats, MediaStatsSaveAck } from '../../shared/types';
import { getUserDataPath } from '../utils/platform';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger('electron.mediaStatsStorage');

function getMediaStatsDir(): string {
  return path.join(getUserDataPath(), 'media-stats');
}

function ensureDir(): void {
  const dir = getMediaStatsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getStatsFilePath(mediaHash: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(mediaHash)) throw new Error('Invalid media usage identity');
  return path.join(getMediaStatsDir(), `${mediaHash}.json`);
}

/** Maximum number of media-stats entries kept on disk. Prunes LRU by `lastAccessed`. */
const MAX_MEDIA_STATS_ENTRIES = 500;

/**
 * Remove the least-recently-accessed media-stats files until at most `maxEntries` remain.
 * Files without a parseable `lastAccessed` field are treated as oldest (epoch 0).
 */
export function pruneMediaStats(maxEntries: number = MAX_MEDIA_STATS_ENTRIES): void {
  if (maxEntries < 0) return;
  const dir = getMediaStatsDir();
  if (!fs.existsSync(dir)) return;

  let files: string[];
  try {
    files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  } catch (e) {
    log.error("error", e);
    return;
  }
  if (files.length <= maxEntries) return;

  const entries: Array<{ file: string; lastAccessed: number }> = [];
  for (const file of files) {
    const fullPath = path.join(dir, file);
    let lastAccessed = 0;
    try {
      const raw = fs.readFileSync(fullPath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<MediaStats>;
      if (!parsed.sourceId || !parsed.usageSessions) continue;
      if (typeof parsed.lastAccessed === 'number' && Number.isFinite(parsed.lastAccessed)) {
        lastAccessed = parsed.lastAccessed;
      }
    } catch (e) {
      log.error("error", e);
      continue; // preserve unreadable or unattributable history for explicit repair
    }
    entries.push({ file, lastAccessed });
  }

  entries.sort((a, b) => a.lastAccessed - b.lastAccessed);
  const toDelete = entries.slice(0, Math.max(0, entries.length - maxEntries));
  for (const { file } of toDelete) {
    try {
      fs.unlinkSync(path.join(dir, file));
    } catch (e) {
      log.error("error", e);
    }
  }
}

/** Main-process synchronous transaction serializes all callers and acknowledges durable rename. */
export function saveMediaStats(mediaHash: string, stats: MediaStats): MediaStatsSaveAck {
  ensureDir();
  if (stats.mediaHash !== mediaHash) throw new Error('Media usage identity mismatch');
  const previous = getMediaStats(mediaHash);
  const merged = mergeMediaUsage(previous, stats);
  merged.storageRevision = (previous?.storageRevision ?? 0) + 1;
  const filePath = getStatsFilePath(mediaHash);
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temporary, 'wx');
    try { fs.writeFileSync(fd, JSON.stringify(merged, null, 2), 'utf8'); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temporary, filePath);
    if (process.platform !== 'win32') {
      const directory = fs.openSync(getMediaStatsDir(), 'r');
      try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    }
  } finally { fs.rmSync(temporary, { force: true }); }
  pruneMediaStats();
  return { mediaHash, revision: merged.storageRevision, sessionSequences: Object.fromEntries(Object.entries(merged.usageSessions ?? {}).map(([id, session]) => [id, session.sequence])) };
}

export function getMediaStats(mediaHash: string): MediaStats | null {
  try {
    const filePath = getStatsFilePath(mediaHash);
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(data) as MediaStats;
    }
  } catch (error) {
    log.error('Failed to load media stats:', error);
    throw error;
  }
  return null;
}

export function listMediaStats(): MediaStats[] {
  try {
    ensureDir();
    const dir = getMediaStatsDir();
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    const results: MediaStats[] = [];

    for (const file of files) {
      try {
        const data = fs.readFileSync(path.join(dir, file), 'utf-8');
        results.push(JSON.parse(data) as MediaStats);
      } catch (e) {
        log.error("error", e);
        // Skip corrupt files
      }
    }

    return results;
  } catch (error) {
    log.error('Failed to list media stats:', error);
    return [];
  }
}

export function setupMediaStatsIPC(): void {
  ipcMain.handle(IPC_CHANNELS.SAVE_MEDIA_STATS, (_event, mediaHash: string, stats: MediaStats) => saveMediaStats(mediaHash, stats));
  ipcMain.handle(IPC_CHANNELS.GET_MEDIA_STATS, (_event, mediaHash: string) => getMediaStats(mediaHash));

  ipcMain.on(IPC_CHANNELS.GET_MEDIA_STATS, (event: IpcMainEvent, mediaHash: string) => {
    // Retained legacy event clients receive no false empty record on read failure.
    try { event.reply(IPC_CHANNELS.GET_MEDIA_STATS, getMediaStats(mediaHash)); }
    catch (error) { log.error('Legacy media stats read failed; invoke clients receive the rejection:', error); }
  });

  ipcMain.on(IPC_CHANNELS.LIST_MEDIA_STATS, (event: IpcMainEvent) => {
    const stats = listMediaStats();
    event.reply(IPC_CHANNELS.LIST_MEDIA_STATS, stats);
  });
}
