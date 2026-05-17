import type { HeadlessMode } from '../types.js';

const HEADLESS_STORAGE_KEY = 'mlearn-headless-mode';

let currentHeadlessMode: HeadlessMode = 'disabled';

export async function loadHeadlessMode(): Promise<HeadlessMode> {
  try {
    const result = await chrome.storage.local.get(HEADLESS_STORAGE_KEY);
    const stored = result[HEADLESS_STORAGE_KEY];
    if (stored === 'enabled' || stored === 'disabled') {
      currentHeadlessMode = stored;
    } else {
      currentHeadlessMode = 'disabled';
    }
  } catch {
    currentHeadlessMode = 'disabled';
  }
  return currentHeadlessMode;
}

export async function setHeadlessMode(mode: HeadlessMode): Promise<void> {
  currentHeadlessMode = mode;
  try {
    await chrome.storage.local.set({ [HEADLESS_STORAGE_KEY]: mode });
  } catch {
  }
}

export function getHeadlessMode(): HeadlessMode {
  return currentHeadlessMode;
}

export function isHeadlessEnabled(): boolean {
  return currentHeadlessMode === 'enabled';
}

export async function toggleHeadlessMode(): Promise<HeadlessMode> {
  const next = currentHeadlessMode === 'enabled' ? 'disabled' : 'enabled';
  await setHeadlessMode(next);
  return next;
}