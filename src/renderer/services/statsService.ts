/**
 * Stats Service
 * Time tracking and legacy word status store.
 */

import { createSignal } from 'solid-js';
import type { Settings } from '../../shared/types';
import { WORD_STATUS } from '../../shared/constants';
import { getBridge } from '../../shared/bridges';
import { isElectron } from '../../shared/platform';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger("renderer.services.stats");

// Word tracking status lookup
const LOOKUP_STATUS: Record<number, string> = {
  [WORD_STATUS.UNKNOWN]: 'Unknown',
  [WORD_STATUS.LEARNING]: 'Learning',
  [WORD_STATUS.KNOWN]: 'Learned',
};

// Migration tracking
interface LocalStorageMigrationInfo {
  occurred: boolean;
  backupData: Record<string, unknown> | null;
  migratedWordCount: number;
}

const WORD_STATUS_STORE_KEY = 'mlearn_words_learned';
const WORD_STATUS_MIGRATION_MARKER_KEY = 'mlearn_words_learned_v1_migration_done';

let localStorageMigrationInfo: LocalStorageMigrationInfo = {
  occurred: false,
  backupData: null,
  migratedWordCount: 0,
};

/**
 * Get migration info for notifications
 */
export function getLocalStorageMigrationInfo(): LocalStorageMigrationInfo {
  return localStorageMigrationInfo;
}

/**
 * Reset migration info after notification
 */
export function resetLocalStorageMigrationInfo(): void {
  localStorageMigrationInfo = { occurred: false, backupData: null, migratedWordCount: 0 };
}

// Stats signals
const [timeWatchedSeconds, setTimeWatchedSeconds] = createSignal<number>(0);
const [wordsLearnedInApp, setWordsLearnedInApp] = createSignal<Record<string, number>>({});
const [isTrackingTime, setIsTrackingTime] = createSignal(false);

let trackingInterval: ReturnType<typeof setInterval> | null = null;

// Flag to track if we've already loaded word statuses
let wordStatusesLoaded = false;

/**
 * Initialize time watched from settings
 */
export function initTimeWatched(settings: Settings): void {
  setTimeWatchedSeconds(settings.timeWatched || 0);
}

/**
 * Start tracking time watched
 */
export function startTimeTracking(): void {
  if (isTrackingTime()) return;
  
  setIsTrackingTime(true);
  trackingInterval = setInterval(() => {
    setTimeWatchedSeconds((prev) => prev + 1);
  }, 1000);
}

/**
 * Stop tracking time watched
 */
export function stopTimeTracking(): void {
  if (!isTrackingTime()) return;
  
  setIsTrackingTime(false);
  if (trackingInterval) {
    clearInterval(trackingInterval);
    trackingInterval = null;
  }
}

/**
 * Get time watched in seconds
 */
export function getTimeWatchedSeconds(): number {
  return timeWatchedSeconds();
}

/**
 * Get formatted time watched string, localized via the provided translation function.
 */
export function getTimeWatchedFormatted(t: (key: string, params?: Record<string, string | number>) => string): string {
  const seconds = timeWatchedSeconds();
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return t('mlearn.Global.Time.HoursMinutes', { hours, minutes });
  }
  return t('mlearn.Global.Time.ShortMinute', { value: minutes });
}

/**
 * Update time watched (for syncing with settings)
 */
export function updateTimeWatched(seconds: number): void {
  setTimeWatchedSeconds(seconds);
}

export function getWordsLearnedInApp(): Record<string, number> {
  return wordsLearnedInApp();
}

/**
 * Set a word's learning status
 * Stores under the preferred word form and can remove legacy aliases.
 */
export function setWordStatus(word: string, status: number, aliases: readonly string[] = []): void {
  setWordsLearnedInApp((prev) => {
    const next = {
      ...prev,
      [word]: status,
    };

    for (const alias of aliases) {
      if (alias && alias !== word && Object.prototype.hasOwnProperty.call(next, alias)) {
        delete next[alias];
      }
    }

    return next;
  });
  // Auto-save after status change (like old app's changeKnownStatus)
  saveWordsToStorage();
  log.info(`Set and saved known status for word: ${word} to ${status}`);
}

/**
 * Change known status by word (legacy compatible)
 */
export function changeKnownStatus(word: string, status: number, aliases: readonly string[] = []): void {
  setWordStatus(word, status, aliases);
}

/**
 * Get a word's learning status
 * Checks the preferred word form first, then any aliases.
 */
export function getWordStatus(word: string, aliases: readonly string[] = []): number {
  const trackedWords = wordsLearnedInApp();

  if (Object.prototype.hasOwnProperty.call(trackedWords, word)) {
    return trackedWords[word] ?? WORD_STATUS.UNKNOWN;
  }

  for (const alias of aliases) {
    if (alias && Object.prototype.hasOwnProperty.call(trackedWords, alias)) {
      return trackedWords[alias] ?? WORD_STATUS.UNKNOWN;
    }
  }

  return WORD_STATUS.UNKNOWN;
}

/**
 * Get known status with SRS query (like old app's getKnownStatus)
 * Combines local adjustments with SRS status
 */
export async function getKnownStatus(word: string, srsCheck?: (word: string) => Promise<number>): Promise<number> {
  let status = wordsLearnedInApp()[word] ?? WORD_STATUS.UNKNOWN;
  if (srsCheck) {
    const srsStatus = await srsCheck(word);
    status = Math.max(status, srsStatus);
  }
  return status;
}

/**
 * Load words from storage via KV store bridge
 * Safe to call multiple times - will only load once
 */
export async function loadWordsFromStorage(): Promise<void> {
  if (wordStatusesLoaded) return;
  wordStatusesLoaded = true;
  
  try {
    const bridge = getBridge();

    // Check for existing v2 data in KV store
    const stored = await bridge.kvStore.kvGet(WORD_STATUS_STORE_KEY);
    if (stored) {
      setWordsLearnedInApp(JSON.parse(stored));
      log.info('[statsService] Loaded word statuses from KV store');
      return;
    }

    const migrationAlreadyImported = await bridge.kvStore.kvGet(WORD_STATUS_MIGRATION_MARKER_KEY);
    if (migrationAlreadyImported) {
      log.info('[statsService] Skipping v1 word status migration because it has already been imported');
      return;
    }
    
    // No local data found - check for data migrated by main process
    // This handles the case where old app used file:// and new app uses localhost
    log.info('[statsService] No local data found, will check main process migration data');
    await loadFromMainProcessMigration();
  } catch (e) {
    log.error('[statsService] Failed to load words from storage:', e);
  }
}

/**
 * Migrate from v1 knownAdjustment data
 */
async function migrateFromV1Data(knownAdjustment: Record<string, number>): Promise<void> {
  try {
    const migratedWordCount = Object.keys(knownAdjustment).length;
    setWordsLearnedInApp(knownAdjustment);

    // Save in new format via KV store
    await getBridge().kvStore.kvSetBatch({
      [WORD_STATUS_STORE_KEY]: JSON.stringify(knownAdjustment),
      [WORD_STATUS_MIGRATION_MARKER_KEY]: '1',
    });

    // Track migration
    localStorageMigrationInfo = migratedWordCount > 0
      ? {
          occurred: true,
          backupData: { knownAdjustment },
          migratedWordCount,
        }
      : { occurred: false, backupData: null, migratedWordCount: 0 };

    log.info(`[statsService] Migrated ${migratedWordCount} word statuses from v1 to v2`);
  } catch (e) {
    log.error('[statsService] Failed to migrate v1 knownAdjustment:', e);
  }
}

/**
 * Load data from main process migration (async, called after sync attempt)
 */
async function loadFromMainProcessMigration(): Promise<void> {
  // Check if we're in Electron environment
  if (isElectron()) {
    try {
      const knownAdjustment = await getBridge().migration.getMigratedItem('knownAdjustment');
      if (knownAdjustment && typeof knownAdjustment === 'object') {
        log.info('[statsService] Found knownAdjustment in main process migration data');
        await migrateFromV1Data(knownAdjustment as Record<string, number>);
      }
    } catch (e) {
      log.warn('[statsService] Failed to get migrated data from main process:', e);
    }
  }
}

/**
 * Save words to storage
 */
export async function saveWordsToStorage(): Promise<void> {
  try {
    await getBridge().kvStore.kvSet('mlearn_words_learned', JSON.stringify(wordsLearnedInApp()));
  } catch (e) {
    log.error('Failed to save words to storage:', e);
  }
}

/**
 * Generate unique identifier for a word (base64 hash)
 */
export async function toUniqueIdentifier(word: string): Promise<string> {
  // Simple hash function for browser compatibility
  const encoded = new TextEncoder().encode(word);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex.substring(0, 16); // Use first 16 chars as ID
}

/**
 * Setup video tracking (play/pause events)
 */
export function setupVideoTracking(video: HTMLVideoElement): () => void {
  const handlePlay = () => startTimeTracking();
  const handlePause = () => stopTimeTracking();
  const handleEnded = () => stopTimeTracking();

  video.addEventListener('play', handlePlay);
  video.addEventListener('pause', handlePause);
  video.addEventListener('ended', handleEnded);

  return () => {
    video.removeEventListener('play', handlePlay);
    video.removeEventListener('pause', handlePause);
    video.removeEventListener('ended', handleEnded);
    stopTimeTracking();
  };
}

// Export signals for reactive access
export {
  timeWatchedSeconds,
  wordsLearnedInApp,
  isTrackingTime,
  LOOKUP_STATUS,
  localStorageMigrationInfo,
};

// Auto-load word statuses when module initializes
// This ensures data is available before any component tries to access it
if (typeof window !== 'undefined') {
  loadWordsFromStorage().then(() => {
    log.info('[statsService] Auto-initialized word statuses on module load');
  });
}
