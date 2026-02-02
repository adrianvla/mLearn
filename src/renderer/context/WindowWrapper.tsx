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
import { loadWordsFromStorage, getLocalStorageMigrationInfo, resetLocalStorageMigrationInfo } from '../services/statsService';

/**
 * MigrationHandler - Handles showing notifications for v1 data migration
 */
const MigrationHandler: ParentComponent = (props) => {
  onMount(() => {
    // Load word statuses from localStorage (will migrate v1 data if present)
    loadWordsFromStorage().then(() => {
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
    });
    
    // Listen for flashcard migration events from electron
    const handleFlashcardMigration = (e: Event) => {
      const info = (e as CustomEvent).detail;
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
    
    onCleanup(() => {
      window.removeEventListener('mlearn-flashcard-migration', handleFlashcardMigration);
    });
  });
  
  return props.children;
};

/**
 * WindowWrapper wraps all window entry points with necessary providers
 * This ensures consistent context availability across all windows
 */
export const WindowWrapper: ParentComponent = (props) => {
  return (
    <ServerProvider>
      <LocalizationProvider>
        <SettingsProvider>
          <LanguageProvider>
            <FlashcardProvider>
              <MigrationHandler>
                {props.children}
                <ToastContainer />
              </MigrationHandler>
            </FlashcardProvider>
          </LanguageProvider>
        </SettingsProvider>
      </LocalizationProvider>
    </ServerProvider>
  );
};

export default WindowWrapper;
