import fs from 'fs';
import path from 'path';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { getUserDataPath } from '../utils/platform';
import { getOverlayBounds, setOverlayBounds } from './windowManager';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger('electron.overlaySiteState');

const GC_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface SiteOverlayState {
  url: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  subsOffsetTime?: number;
  subtitleContent?: string;
  overlayTextMode?: boolean;
  lastAccessed: number;
}

let cache: Map<string, SiteOverlayState> | null = null;
let gcTimer: ReturnType<typeof setInterval> | null = null;

function getStorePath(): string {
  return path.join(getUserDataPath(), 'overlay-site-states.json');
}

function stripProtocol(url: string): string {
  return url.replace(/^https?:\/\//i, '');
}

function siteKey(url: string): string {
  return stripProtocol(url).toLowerCase();
}

async function loadCache(): Promise<Map<string, SiteOverlayState>> {
  if (cache) return cache;
  cache = new Map();
  try {
    const storePath = getStorePath();
    try { await fs.promises.access(storePath); } catch { return cache; }
    const data = await fs.promises.readFile(storePath, 'utf-8');
    const parsed: unknown = JSON.parse(data);
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        if (entry && typeof entry.url === 'string') {
          cache.set(siteKey(entry.url), entry as SiteOverlayState);
        }
      }
    }
  } catch (error) {
    log.error('Failed to load overlay site states:', error);
  }
  return cache;
}

async function persistCache(): Promise<void> {
  if (!cache) return;
  try {
    const storePath = getStorePath();
    const tmpPath = `${storePath}.tmp`;
    const dir = path.dirname(storePath);
    try { await fs.promises.access(dir); } catch { await fs.promises.mkdir(dir, { recursive: true }); }
    const entries = Array.from(cache.values());
    await fs.promises.writeFile(tmpPath, JSON.stringify(entries, null, 2));
    await fs.promises.rename(tmpPath, storePath);
  } catch (error) {
    log.error('Failed to persist overlay site states:', error);
  }
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => { persistCache(); }, 2000);
}

function runGC(): void {
  if (!cache) return;
  const now = Date.now();
  let removed = 0;
  for (const [key, state] of cache) {
    if (now - state.lastAccessed > TTL_MS) {
      cache.delete(key);
      removed++;
    }
  }
  if (removed > 0) {
    log.info(`GC removed ${removed} expired overlay site states`);
    schedulePersist();
  }
}

export async function initOverlaySiteState(): Promise<void> {
  await loadCache();
  runGC();
  if (gcTimer) clearInterval(gcTimer);
  gcTimer = setInterval(runGC, GC_INTERVAL_MS);
}

export function shutdownOverlaySiteState(): void {
  if (gcTimer) { clearInterval(gcTimer); gcTimer = null; }
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
}

export async function saveSiteOverlayState(
  url: string,
  state: Partial<Omit<SiteOverlayState, 'url' | 'lastAccessed'>>
): Promise<void> {
  if (!url) return;
  await loadCache();
  const key = siteKey(url);
  const existing = cache!.get(key);
  const now = Date.now();
  const bounds = getOverlayBounds();
  cache!.set(key, {
    url,
    position: state.position ?? existing?.position ?? bounds ?? { x: 0, y: 0 },
    size: state.size ?? existing?.size ?? bounds ?? { width: 800, height: 600 },
    subsOffsetTime: state.subsOffsetTime ?? existing?.subsOffsetTime,
    subtitleContent: state.subtitleContent ?? existing?.subtitleContent,
    overlayTextMode: state.overlayTextMode ?? existing?.overlayTextMode,
    lastAccessed: now,
  });
  schedulePersist();
}

export async function loadSiteOverlayState(url: string): Promise<SiteOverlayState | null> {
  if (!url) return null;
  await loadCache();
  const key = siteKey(url);
  const state = cache!.get(key);
  if (!state) return null;
  state.lastAccessed = Date.now();
  schedulePersist();
  return { ...state };
}

export async function clearSiteOverlayState(url: string): Promise<void> {
  if (!url) return;
  await loadCache();
  const key = siteKey(url);
  cache!.delete(key);
  schedulePersist();
}

export function registerOverlaySiteStateIPC(): void {
  ipcMain.on(IPC_CHANNELS.OVERLAY_SAVE_SITE_STATE, (_event, payload: { url: string; state: Record<string, unknown> }) => {
    if (payload && payload.url) {
      saveSiteOverlayState(payload.url, payload.state);
    }
  });

  ipcMain.handle(IPC_CHANNELS.OVERLAY_LOAD_SITE_STATE, (_event, url: string) => {
    return loadSiteOverlayState(url);
  });

  ipcMain.on(IPC_CHANNELS.OVERLAY_CLEAR_SITE_STATE, (_event, url: string) => {
    if (url) clearSiteOverlayState(url);
  });

  ipcMain.handle(IPC_CHANNELS.OVERLAY_SET_BOUNDS, (_event, bounds: { x: number; y: number; width: number; height: number }) => {
    setOverlayBounds(bounds);
  });
}
