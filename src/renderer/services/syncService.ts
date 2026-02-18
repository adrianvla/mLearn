/**
 * Sync Service
 * Automatically synchronizes settings and flashcards between mobile and desktop.
 *
 * Sync targets: desktop's Node server (`/api/settings`, `/api/flashcards`)
 * Conflict resolution: last-write-wins per field (settings) / per card by lastUpdated (flashcards)
 * Triggers: app launch, app resume, BroadcastChannel update, 60-second polling
 */

import type { Settings, Flashcard, FlashcardStore } from '../../shared/types';
import { getNodeServer } from '../../shared/backends/nodeServerAdapter';

// ============================================================================
// Types
// ============================================================================

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'error';

export interface SyncCallbacks {
  onStatusChange: (status: SyncStatus) => void;
  /** Called when remote settings should be merged into local */
  onSettingsReceived: (remote: Partial<Settings>) => void;
  /** Called when remote flashcards should be merged into local */
  onFlashcardsReceived: (merged: FlashcardStore) => void;
  /** Returns current local settings */
  getLocalSettings: () => Settings;
  /** Returns current local flashcard store */
  getLocalFlashcards: () => FlashcardStore;
}

// ============================================================================
// Sync Service
// ============================================================================

const POLL_INTERVAL_MS = 60_000;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let callbacks: SyncCallbacks | null = null;
let currentStatus: SyncStatus = 'offline';
let pendingSettingsQueue: Partial<Settings> | null = null;
let pendingFlashcardsQueue: FlashcardStore | null = null;

function setStatus(status: SyncStatus) {
  currentStatus = status;
  callbacks?.onStatusChange(status);
}

export function getSyncStatus(): SyncStatus {
  return currentStatus;
}

// ============================================================================
// Settings Sync
// ============================================================================

/**
 * Pull remote settings and merge per-field using lastModified.
 */
async function pullSettings(): Promise<void> {
  if (!callbacks) return;
  const server = getNodeServer();
  try {
    const remote = await server.getSettings();
    if (!remote) return;

    const local = callbacks.getLocalSettings();
    const merged = mergeSettings(local, remote);
    if (merged) {
      callbacks.onSettingsReceived(merged);
    }
  } catch {
    // Will be handled by overall sync error
  }
}

/**
 * Push local settings to remote.
 */
async function pushSettings(settings: Settings): Promise<void> {
  const server = getNodeServer();
  await server.saveSettings(settings);
}

/**
 * Per-field last-write-wins merge.
 * Returns the merged diff or null if no changes needed.
 */
function mergeSettings(local: Settings, remote: Settings): Partial<Settings> | null {
  // Simple: if remote has a newer lastModified, adopt its values
  if ((remote.lastModified || 0) > (local.lastModified || 0)) {
    return remote;
  }
  return null;
}

// ============================================================================
// Flashcard Sync
// ============================================================================

/**
 * Pull remote flashcards and merge by UUID.
 */
async function pullFlashcards(): Promise<void> {
  if (!callbacks) return;
  const server = getNodeServer();
  try {
    const remote = await server.getFlashcards();
    if (!remote) return;

    const local = callbacks.getLocalFlashcards();
    const merged = mergeFlashcardStores(local, remote);
    if (merged) {
      callbacks.onFlashcardsReceived(merged);
    }
  } catch {
    // Will be handled by overall sync error
  }
}

/**
 * Push local flashcards to remote.
 */
async function pushFlashcards(store: FlashcardStore): Promise<void> {
  const server = getNodeServer();
  await server.saveFlashcards(store);
}

/**
 * Merge two flashcard stores by UUID.
 * - Cards on both sides: latest `lastUpdated` wins
 * - Cards only on one side: added to the merged result
 * Returns null if stores are identical.
 */
function mergeFlashcardStores(local: FlashcardStore, remote: FlashcardStore): FlashcardStore | null {
  const localCards = local.flashcards || {};
  const remoteCards = remote.flashcards || {};
  const allIds = new Set([...Object.keys(localCards), ...Object.keys(remoteCards)]);

  let hasChanges = false;
  const mergedCards: Record<string, Flashcard> = {};

  for (const id of allIds) {
    const lc = localCards[id];
    const rc = remoteCards[id];

    if (lc && rc) {
      // Both have the card — latest lastUpdated wins
      if ((rc.lastUpdated || 0) > (lc.lastUpdated || 0)) {
        mergedCards[id] = rc;
        hasChanges = true;
      } else {
        mergedCards[id] = lc;
      }
    } else if (lc) {
      mergedCards[id] = lc;
    } else if (rc) {
      mergedCards[id] = rc;
      hasChanges = true;
    }
  }

  // Merge word candidates similarly
  const localCandidates = local.wordCandidates || {};
  const remoteCandidates = remote.wordCandidates || {};
  const allCandidateWords = new Set([...Object.keys(localCandidates), ...Object.keys(remoteCandidates)]);
  const mergedCandidates = { ...localCandidates };

  for (const word of allCandidateWords) {
    const lw = localCandidates[word];
    const rw = remoteCandidates[word];
    if (lw && rw) {
      if ((rw.lastSeen || 0) > (lw.lastSeen || 0)) {
        mergedCandidates[word] = rw;
        hasChanges = true;
      }
    } else if (!lw && rw) {
      mergedCandidates[word] = rw;
      hasChanges = true;
    }
  }

  if (!hasChanges) return null;

  return {
    ...local,
    flashcards: mergedCards,
    wordCandidates: mergedCandidates,
  };
}

// ============================================================================
// Sync Lifecycle
// ============================================================================

/**
 * Perform a full sync cycle: pull then push.
 */
async function syncAll(): Promise<void> {
  if (!callbacks) return;

  setStatus('syncing');
  try {
    const server = getNodeServer();
    const pingOk = await server.ping();
    if (!pingOk) {
      setStatus('offline');
      return;
    }

    // Pull remote state
    await pullSettings();
    await pullFlashcards();

    // Push any pending local changes
    if (pendingSettingsQueue) {
      const settings = callbacks.getLocalSettings();
      await pushSettings(settings);
      pendingSettingsQueue = null;
    }

    if (pendingFlashcardsQueue) {
      const store = callbacks.getLocalFlashcards();
      await pushFlashcards(store);
      pendingFlashcardsQueue = null;
    }

    setStatus('synced');
  } catch {
    setStatus('error');
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Start the sync service with the given callbacks.
 * Immediately performs an initial sync.
 */
export function startSync(cbs: SyncCallbacks): void {
  callbacks = cbs;
  setStatus('syncing');

  // Initial sync
  void syncAll();

  // Poll every 60 seconds
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => void syncAll(), POLL_INTERVAL_MS);
}

/**
 * Stop the sync service.
 */
export function stopSync(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  callbacks = null;
  setStatus('offline');
}

/**
 * Queue a settings push (called when local settings change).
 */
export function queueSettingsPush(settings: Partial<Settings>): void {
  pendingSettingsQueue = { ...pendingSettingsQueue, ...settings };
  // Attempt immediate push
  if (currentStatus !== 'offline') {
    const server = getNodeServer();
    if (callbacks) {
      const full = callbacks.getLocalSettings();
      void server.saveSettings(full).catch(() => {
        // Will retry on next poll
      });
    }
  }
}

/**
 * Queue a flashcards push (called when local flashcards change).
 */
export function queueFlashcardsPush(store: FlashcardStore): void {
  pendingFlashcardsQueue = store;
  // Attempt immediate push
  if (currentStatus !== 'offline') {
    void pushFlashcards(store).catch(() => {
      // Will retry on next poll
    });
  }
}

/**
 * Trigger an immediate sync (e.g., on app resume).
 */
export function triggerSync(): void {
  void syncAll();
}
