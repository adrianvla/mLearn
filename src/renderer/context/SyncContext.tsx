/**
 * Sync Context
 * Provides sync status and control to the component tree.
 * Starts sync automatically when backendMode is 'tethered' or 'cloud'.
 */

import { createContext, useContext, ParentComponent, createSignal, onCleanup, createEffect, on } from 'solid-js';
import { useSettings } from './SettingsContext';
import { useFlashcards } from './FlashcardContext';
import {
  startSync,
  stopSync,
  triggerSync,
  queueSettingsPush,
  queueFlashcardsPush,
  getSyncStatus,
  type SyncStatus,
  type SyncCallbacks,
} from '../services/syncService';
import type { Settings, FlashcardStore } from '../../shared/types';

// ============================================================================
// Context
// ============================================================================

interface SyncContextValue {
  status: () => SyncStatus;
  sync: () => void;
}

const SyncContext = createContext<SyncContextValue>();

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) {
    // Fallback for non-mobile windows where SyncProvider isn't mounted
    return { status: () => 'offline' as SyncStatus, sync: () => {} };
  }
  return ctx;
}

// ============================================================================
// Provider
// ============================================================================

export const SyncProvider: ParentComponent = (props) => {
  const { settings, updateSettings } = useSettings();
  const flashcardCtx = useFlashcards();
  const [status, setStatus] = createSignal<SyncStatus>('offline');

  // Start/stop sync based on backend mode
  createEffect(() => {
    const mode = settings.backendMode;
    if (mode === 'tethered' || mode === 'cloud') {
      const cbs: SyncCallbacks = {
        onStatusChange: (s) => setStatus(s),
        onSettingsReceived: (remote: Partial<Settings>) => {
          updateSettings(remote);
        },
        onFlashcardsReceived: (merged: FlashcardStore) => {
          // Apply remote card changes individually
          if (merged.flashcards) {
            for (const [id, card] of Object.entries(merged.flashcards)) {
              const existing = flashcardCtx.store.flashcards[id];
              if (!existing) {
                // New card from remote — add via context
                void flashcardCtx.addFlashcard(card.content);
              } else if ((card.lastUpdated || 0) > (existing.lastUpdated || 0)) {
                flashcardCtx.updateFlashcard(id, card);
              }
            }
          }
        },
        getLocalSettings: () => ({ ...settings }),
        getLocalFlashcards: () => flashcardCtx.store,
      };

      startSync(cbs);

      onCleanup(() => stopSync());
    } else {
      stopSync();
      setStatus('offline');
    }
  });

  // Listen for app state changes (resume → sync)
  createEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && getSyncStatus() !== 'offline') {
        triggerSync();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    onCleanup(() => document.removeEventListener('visibilitychange', handleVisibility));
  });

  // Queue pushes when local settings change (skip initial run)
  createEffect(
    on(
      () => settings.lastModified,
      (ts, prev) => {
        if (prev !== undefined && ts && (settings.backendMode === 'tethered' || settings.backendMode === 'cloud')) {
          queueSettingsPush(settings);
        }
      },
    ),
  );

  // Queue pushes when local flashcards change (skip initial run)
  createEffect(
    on(
      () => Object.keys(flashcardCtx.store.flashcards).length,
      (_count, prev) => {
        if (prev !== undefined && (settings.backendMode === 'tethered' || settings.backendMode === 'cloud')) {
          queueFlashcardsPush(flashcardCtx.store);
        }
      },
    ),
  );

  const value: SyncContextValue = {
    status,
    sync: () => triggerSync(),
  };

  return (
    <SyncContext.Provider value={value}>
      {props.children}
    </SyncContext.Provider>
  );
};
