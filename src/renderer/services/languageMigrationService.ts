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
  migrateSettingsToLanguageMetadata,
  migrateFlashcardStoreToLanguageMetadata,
  hasSettingsBeenMigrated,
  hasFlashcardStoreBeenMigrated,
} from '@shared/language-migration';
import { initializeLanguageRegistry } from '@shared/language-registry';
import { getLogger } from '@shared/utils/logger';

const log = getLogger("renderer.services.languageMigration");

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
    log.info('[LanguageMigration] Settings already migrated');
    return settings;
  }
  
  log.info('[LanguageMigration] Migrating settings to include language metadata');
  
  try {
    const migratedSettings = migrateSettingsToLanguageMetadata(settings);

    log.info('[LanguageMigration] Settings migration completed successfully');
    return migratedSettings;
  } catch (error) {
    log.error('[LanguageMigration] Settings migration failed:', error);
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
    log.info('[LanguageMigration] Flashcard store already migrated');
    return store;
  }
  
  log.info('[LanguageMigration] Migrating flashcard store to include language metadata');
  
  try {
    const migratedStore = migrateFlashcardStoreToLanguageMetadata(store, language);

    log.info('[LanguageMigration] Flashcard store migration completed successfully');
    return migratedStore;
  } catch (error) {
    log.error('[LanguageMigration] Flashcard store migration failed:', error);
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
    log.warn('[LanguageMigration] Migration already in progress');
    return { settings, store };
  }
  
  migrationInProgress = true;
  
  try {
    // Initialize language registry
    initializeLanguageRegistry();
    
    log.info('[LanguageMigration] Starting full language metadata migration');
    
    // Check if both are already migrated
    if (hasSettingsBeenMigrated(settings) && hasFlashcardStoreBeenMigrated(store)) {
      log.info('[LanguageMigration] Both settings and store already migrated');
      migrationCompleted = true;
      return { settings, store };
    }
    
    // Perform migration
    const { settings: migratedSettings, store: migratedStore } = performLanguageMetadataMigration(
      settings,
      store,
      language
    );
    
    log.info('[LanguageMigration] Full migration completed successfully');
    migrationCompleted = true;
    
    return { settings: migratedSettings, store: migratedStore };
  } catch (error) {
    log.error('[LanguageMigration] Full migration failed:', error);
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
  log.info('[LanguageMigration] Status Report:');
  log.info(`  - Settings migrated: ${hasSettingsBeenMigrated(settings)}`);
  log.info(`  - Store migrated: ${hasFlashcardStoreBeenMigrated(store)}`);
  log.info(`  - Migration completed: ${migrationCompleted}`);
  log.info(`  - Migration in progress: ${migrationInProgress}`);
  log.info(`  - Current language: ${settings.language || 'ja'}`);
  log.info(`  - Flashcard count: ${Object.keys(store.flashcards).length}`);
}
