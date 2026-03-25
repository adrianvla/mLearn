/**
 * Media Stats Storage Service
 * Persists per-media analytics as individual JSON files in userData/media-stats/
 */

import fs from 'fs';
import path from 'path';
import { ipcMain, IpcMainEvent } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { MediaStats } from '../../shared/types';
import { getUserDataPath } from '../utils/platform';

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
  return path.join(getMediaStatsDir(), `${mediaHash}.json`);
}

export function saveMediaStats(mediaHash: string, stats: MediaStats): void {
  try {
    ensureDir();
    const filePath = getStatsFilePath(mediaHash);
    fs.writeFileSync(filePath, JSON.stringify(stats, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to save media stats:', error);
  }
}

export function getMediaStats(mediaHash: string): MediaStats | null {
  try {
    const filePath = getStatsFilePath(mediaHash);
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(data) as MediaStats;
    }
  } catch (error) {
    console.error('Failed to load media stats:', error);
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
        console.error(e);
        // Skip corrupt files
      }
    }

    return results;
  } catch (error) {
    console.error('Failed to list media stats:', error);
    return [];
  }
}

export function setupMediaStatsIPC(): void {
  ipcMain.on(IPC_CHANNELS.SAVE_MEDIA_STATS, (_event: IpcMainEvent, mediaHash: string, stats: MediaStats) => {
    saveMediaStats(mediaHash, stats);
  });

  ipcMain.on(IPC_CHANNELS.GET_MEDIA_STATS, (event: IpcMainEvent, mediaHash: string) => {
    const stats = getMediaStats(mediaHash);
    event.reply(IPC_CHANNELS.GET_MEDIA_STATS, stats);
  });

  ipcMain.on(IPC_CHANNELS.LIST_MEDIA_STATS, (event: IpcMainEvent) => {
    const stats = listMediaStats();
    event.reply(IPC_CHANNELS.LIST_MEDIA_STATS, stats);
  });
}
