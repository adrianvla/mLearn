/**
 * Language Metadata Migration Service
 * 
 * Handles migration of existing flashcard and settings data to include
 * language metadata. This ensures backward compatibility while enabling
 * the new language abstraction layer.
 */

import type { Settings, FlashcardStore, Flashcard } from './types';
import type { LanguageCode } from './language-abstraction';
import {
  migrateFlashcardToLanguageMetadata,
  createDefaultLanguageMetadataRegistry,
} from './language-metadata-schema';

// ============================================================================
// Migration Utilities
// ============================================================================

/**
 * Migrate settings to include language metadata registry
 * Adds language metadata registry if not present
 */
export function migrateSettingsToLanguageMetadata(settings: Settings): Settings {
  // If already has language metadata registry, don't overwrite
  if ((settings as any).languageMetadataRegistry) {
    return settings;
  }
  
  // Create new registry
  const registry = createDefaultLanguageMetadataRegistry();
  
  // Infer current language from settings
  const currentLanguage = (settings.language || 'ja') as LanguageCode;
  
  // Add current language settings to registry
  registry.languageSettings[currentLanguage] = {
    language: currentLanguage,
    furigana: settings.furigana,
    showPitchAccent: settings.showPitchAccent,
    showGrammar: (settings as any).showGrammar,
    showDecomposition: (settings as any).showDecomposition,
    dictionaryBackend: (settings as any).dictionaryBackend,
    ttsProvider: (settings as any).ttsProvider,
  };
  
  // Add registry to settings
  (settings as any).languageMetadataRegistry = registry;
  
  return settings;
}

/**
 * Migrate flashcard store to include language metadata
 * Adds language metadata to all flashcards
 */
export function migrateFlashcardStoreToLanguageMetadata(
  store: FlashcardStore,
  language: LanguageCode = 'ja'
): FlashcardStore {
  const migrated = { ...store };

  // Migrate all flashcards
  const migratedFlashcards: Record<string, Flashcard> = {};
  for (const [id, card] of Object.entries(store.flashcards ?? {})) {
    const migratedCard = { ...card };
    migratedCard.content = { ...card.content };
    migratedCard.content.extra = migrateFlashcardToLanguageMetadata(
      card.content.extra,
      language
    );
    migratedFlashcards[id] = migratedCard;
  }
  migrated.flashcards = migratedFlashcards;

  // Update store metadata to indicate migration
  migrated.meta = { ...(store.meta ?? {}) } as FlashcardStore['meta'];
  (migrated.meta as any).languageMigrationVersion = 1;
  (migrated.meta as any).lastLanguageMigration = Date.now();

  return migrated;
}

/**
 * Check if settings have been migrated to language metadata
 */
export function hasSettingsBeenMigrated(settings: Settings): boolean {
  return !!(settings as any).languageMetadataRegistry;
}

/**
 * Check if flashcard store has been migrated to language metadata
 */
export function hasFlashcardStoreBeenMigrated(store: FlashcardStore): boolean {
  return !!(store.meta as any)?.languageMigrationVersion;
}

/**
 * Perform full migration of both settings and flashcard store
 * Should be called once at application startup
 */
export function performLanguageMetadataMigration(
  settings: Settings,
  store: FlashcardStore,
  language: LanguageCode = 'ja'
): { settings: Settings; store: FlashcardStore } {
  let migratedSettings = settings;
  let migratedStore = store;
  
  // Migrate settings if needed
  if (!hasSettingsBeenMigrated(settings)) {
    migratedSettings = migrateSettingsToLanguageMetadata(settings);
  }
  
  // Migrate flashcard store if needed
  if (!hasFlashcardStoreBeenMigrated(store)) {
    migratedStore = migrateFlashcardStoreToLanguageMetadata(store, language);
  }
  
  return { settings: migratedSettings, store: migratedStore };
}

// ============================================================================
// Rollback Utilities (for testing/debugging)
// ============================================================================

/**
 * Remove language metadata from settings (for testing)
 */
export function rollbackSettingsLanguageMetadata(settings: Settings): Settings {
  const rolled = { ...settings };
  delete (rolled as any).languageMetadataRegistry;
  return rolled;
}

/**
 * Remove language metadata from flashcard store (for testing)
 */
export function rollbackFlashcardStoreLanguageMetadata(store: FlashcardStore): FlashcardStore {
  const rolled = { ...store };
  
  // Remove language metadata from flashcards
  const rolledFlashcards: Record<string, Flashcard> = {};
  for (const [id, card] of Object.entries(store.flashcards)) {
    const rolledCard = { ...card };
    rolledCard.content = { ...card.content };
    if (rolledCard.content.extra) {
      const extra = { ...rolledCard.content.extra };
      delete extra.languageMetadata;
      rolledCard.content.extra = extra;
    }
    rolledFlashcards[id] = rolledCard;
  }
  rolled.flashcards = rolledFlashcards;
  
  // Remove migration metadata
  rolled.meta = { ...store.meta };
  delete (rolled.meta as any).languageMigrationVersion;
  delete (rolled.meta as any).lastLanguageMigration;
  
  return rolled;
}
