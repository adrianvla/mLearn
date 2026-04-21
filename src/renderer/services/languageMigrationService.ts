/**
 * Language Migration Service
 * 
 * Handles integration of language metadata migration into the app's
 * initialization flow. This service is called when settings and flashcards
 * are loaded to ensure they have language metadata.
 */

import type { Settings, FlashcardStore } from '@shared/types';
import type { LanguageCode } from '@shared/language-abstraction';
import {
  performLanguageMetadataMigration,
  hasSettingsBeenMigrated,
  hasFlashcardStoreBeenMigrated,
} from '@shared/language-migration';
import { initializeLanguageRegistry } from '@shared/language-registry';

// ============================================================================
// Migration State
// ============================================================================

let migrationInProgress = false;
let migrationCompleted = false;

/**
 * Check if migration has been completed
 */
export function isMigrationCompleted(): boolean {
  return migrationCompleted;
}

/**
 * Check if migration is currently in progress
 */
export function isMigrationInProgress(): boolean {
  return migrationInProgress;
}

// ============================================================================
// Migration Execution
// ============================================================================

/**
 * Perform language metadata migration on settings
 * Called when settings are loaded from storage
 */
export function migrateSettingsIfNeeded(settings: Settings): Settings {
  // Initialize language registry if not already done
  initializeLanguageRegistry();
  
  // Check if already migrated
  if (hasSettingsBeenMigrated(settings)) {
    console.log('[LanguageMigration] Settings already migrated');
    return settings;
  }
  
  console.log('[LanguageMigration] Migrating settings to include language metadata');
  
  try {
    const { settings: migratedSettings } = performLanguageMetadataMigration(
      settings,
      { flashcards: {} } as FlashcardStore, // Dummy store for settings-only migration
      (settings.language || 'ja') as LanguageCode
    );
    
    console.log('[LanguageMigration] Settings migration completed successfully');
    return migratedSettings;
  } catch (error) {
    console.error('[LanguageMigration] Settings migration failed:', error);
    // Return original settings if migration fails
    return settings;
  }
}

/**
 * Perform language metadata migration on flashcard store
 * Called when flashcards are loaded from storage
 */
export function migrateFlashcardStoreIfNeeded(
  store: FlashcardStore,
  language: LanguageCode = 'ja'
): FlashcardStore {
  // Initialize language registry if not already done
  initializeLanguageRegistry();
  
  // Check if already migrated
  if (hasFlashcardStoreBeenMigrated(store)) {
    console.log('[LanguageMigration] Flashcard store already migrated');
    return store;
  }
  
  console.log('[LanguageMigration] Migrating flashcard store to include language metadata');
  
  try {
    const { store: migratedStore } = performLanguageMetadataMigration(
      { language } as Settings, // Dummy settings for store-only migration
      store,
      language
    );
    
    console.log('[LanguageMigration] Flashcard store migration completed successfully');
    return migratedStore;
  } catch (error) {
    console.error('[LanguageMigration] Flashcard store migration failed:', error);
    // Return original store if migration fails
    return store;
  }
}

/**
 * Perform full language metadata migration
 * Called during app initialization to migrate both settings and flashcards
 */
export async function performFullLanguageMigration(
  settings: Settings,
  store: FlashcardStore,
  language: LanguageCode = 'ja'
): Promise<{ settings: Settings; store: FlashcardStore }> {
  if (migrationInProgress) {
    console.warn('[LanguageMigration] Migration already in progress');
    return { settings, store };
  }
  
  migrationInProgress = true;
  
  try {
    // Initialize language registry
    initializeLanguageRegistry();
    
    console.log('[LanguageMigration] Starting full language metadata migration');
    
    // Check if both are already migrated
    if (hasSettingsBeenMigrated(settings) && hasFlashcardStoreBeenMigrated(store)) {
      console.log('[LanguageMigration] Both settings and store already migrated');
      migrationCompleted = true;
      return { settings, store };
    }
    
    // Perform migration
    const { settings: migratedSettings, store: migratedStore } = performLanguageMetadataMigration(
      settings,
      store,
      language
    );
    
    console.log('[LanguageMigration] Full migration completed successfully');
    migrationCompleted = true;
    
    return { settings: migratedSettings, store: migratedStore };
  } catch (error) {
    console.error('[LanguageMigration] Full migration failed:', error);
    migrationCompleted = false;
    return { settings, store };
  } finally {
    migrationInProgress = false;
  }
}

// ============================================================================
// Migration Logging
// ============================================================================

/**
 * Log migration status for debugging
 */
export function logMigrationStatus(settings: Settings, store: FlashcardStore): void {
  console.log('[LanguageMigration] Status Report:');
  console.log(`  - Settings migrated: ${hasSettingsBeenMigrated(settings)}`);
  console.log(`  - Store migrated: ${hasFlashcardStoreBeenMigrated(store)}`);
  console.log(`  - Migration completed: ${migrationCompleted}`);
  console.log(`  - Migration in progress: ${migrationInProgress}`);
  console.log(`  - Current language: ${settings.language || 'ja'}`);
  console.log(`  - Flashcard count: ${Object.keys(store.flashcards).length}`);
}
