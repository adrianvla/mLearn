/**
 * Window Wrapper Component
 * Provides nested context providers for all windows (Russian Doll pattern)
 */

import { ParentComponent, Component, Show, createSignal, createEffect, onMount, onCleanup } from 'solid-js';
import { SettingsProvider, useSettings } from './SettingsContext';
import './WindowWrapper.css';
import { LanguageProvider } from './LanguageContext';
import { FlashcardProvider } from './FlashcardContext';
import { ServerProvider } from './ServerContext';
import { LocalizationProvider } from './LocalizationContext';
import { ToastContainer, showToast } from '../components/common/Feedback/Toast';
import { WindowDragRegion } from '../components/utils/WindowDragRegion';
import { getLocalStorageMigrationInfo, resetLocalStorageMigrationInfo } from '../services/statsService';
import { setMigrationListenerReady } from './migrationSignals';

/**
 * MigrationHandler - Handles showing notifications for v1 data migration
 * Must be placed OUTSIDE FlashcardProvider so listener is ready before flashcards load
 * 
 * Note: Word statuses are loaded automatically at statsService module init time.
 * This handler only shows the migration toast notification.
 */
const MigrationHandler: ParentComponent = (props) => {
  onMount(() => {
    // Check if localStorage migration occurred (word statuses already loaded by statsService)
    const lsInfo = getLocalStorageMigrationInfo();
    if (lsInfo.occurred) {
      showToast({
        variant: 'info',
        title: 'Data Migration Complete',
        message: `Migrated ${lsInfo.migratedWordCount} word statuses from v1. A backup has been created.`,
        duration: 8000,
      });
      resetLocalStorageMigrationInfo();
    }
    
    // Listen for flashcard migration events from electron
    const handleFlashcardMigration = (e: Event) => {
      const info = (e as CustomEvent).detail;
      console.log('[MigrationHandler] Received flashcard migration event:', info);
      if (info?.occurred) {
        showToast({
          variant: 'success',
          title: 'Flashcard Migration Complete',
          message: info.backupPath 
            ? `Your flashcards have been migrated from v${info.fromVersion}. A backup was created.`
            : `Your flashcards have been migrated from v${info.fromVersion}.`,
          duration: 10000,
        });
      }
    };
    
    window.addEventListener('mlearn-flashcard-migration', handleFlashcardMigration);
    
    // Signal that listener is ready
    setMigrationListenerReady(true);
    console.log('[MigrationHandler] Migration listener registered');
    
    onCleanup(() => {
      window.removeEventListener('mlearn-flashcard-migration', handleFlashcardMigration);
    });
  });
  
  return props.children;
};

/**
 * Loading screen shown during initial window load.
 * Prevents light theme flash before settings/theme are applied.
 * Uses pure CSS spinner to avoid component dependencies.
 */
const WindowLoadingScreen: Component = () => {
  const { isLoading } = useSettings();
  const [visible, setVisible] = createSignal(true);
  const [fadeOut, setFadeOut] = createSignal(false);

  createEffect(() => {
    if (!isLoading()) {
      setFadeOut(true);
      const timer = setTimeout(() => setVisible(false), 300);
      onCleanup(() => clearTimeout(timer));
    }
  });

  return (
    <Show when={visible()}>
      <div class={`window-loading-overlay ${fadeOut() ? 'fade-out' : ''}`}>
        <div class="window-loading-spinner" />
      </div>
    </Show>
  );
};

/**
 * WindowWrapper wraps all window entry points with necessary providers
 * This ensures consistent context availability across all windows
 * 
 * IMPORTANT: MigrationHandler is placed BEFORE FlashcardProvider so that
 * the migration event listener is registered before flashcards are loaded
 */
export const WindowWrapper: ParentComponent<{ showDragRegion?: boolean }> = (props) => {
  return (
    <ServerProvider>
      <LocalizationProvider>
        <SettingsProvider>
          <WindowLoadingScreen />
          <LanguageProvider>
            <MigrationHandler>
              <FlashcardProvider>
                <Show when={props.showDragRegion !== false}>
                  <WindowDragRegion />
                </Show>
                {props.children}
              </FlashcardProvider>
              <ToastContainer />
            </MigrationHandler>
          </LanguageProvider>
        </SettingsProvider>
      </LocalizationProvider>
    </ServerProvider>
  );
};

export default WindowWrapper;
