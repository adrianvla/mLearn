/**
 * Window Wrapper Component
 * Provides nested context providers for all windows (Russian Doll pattern)
 */

import { ParentComponent, onMount, onCleanup } from 'solid-js';
import { SettingsProvider } from './SettingsContext';
import { LanguageProvider } from './LanguageContext';
import { FlashcardProvider } from './FlashcardContext';
import { ServerProvider } from './ServerContext';
import { LocalizationProvider } from './LocalizationContext';
import { ToastContainer, showToast } from '../components/common/Feedback/Toast';
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
 * WindowWrapper wraps all window entry points with necessary providers
 * This ensures consistent context availability across all windows
 * 
 * IMPORTANT: MigrationHandler is placed BEFORE FlashcardProvider so that
 * the migration event listener is registered before flashcards are loaded
 */
export const WindowWrapper: ParentComponent = (props) => {
  return (
    <ServerProvider>
      <LocalizationProvider>
        <SettingsProvider>
          <LanguageProvider>
            <MigrationHandler>
              <FlashcardProvider>
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
