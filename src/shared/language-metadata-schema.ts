/**
 * Language Metadata Schema
 * 
 * Defines the structure for storing language-specific metadata in the flashcard store
 * and settings. This enables per-language configuration while maintaining backward
 * compatibility with existing data.
 */

import type { LanguageCode, ProficiencyFramework, LanguageMetadata } from './language-abstraction';

// ============================================================================
// Language-Specific Settings
// ============================================================================

/**
 * Language-specific settings overrides
 * Allows each language to have different default settings
 */
export interface LanguageSpecificSettings {
  /** Language code this settings apply to */
  language: LanguageCode;
  
  // Display settings
  furigana?: boolean;
  showPitchAccent?: boolean;
  showGrammar?: boolean;
  showDecomposition?: boolean;
  
  // Dictionary settings
  dictionaryBackend?: string;
  
  // Proficiency settings
  proficiencyFramework?: ProficiencyFramework;
  targetProficiencyLevel?: number;
  
  // TTS settings
  ttsProvider?: string;
  ttsVoice?: string;
  
  // OCR settings
  useOCRRamSaver?: boolean;
  
  // Custom settings (extensible)
  custom?: Record<string, unknown>;
}

/**
 * Language metadata registry stored in settings
 * Maps language codes to their metadata and settings
 */
export interface LanguageMetadataRegistry {
  /** Timestamp when registry was last updated */
  lastUpdated: number;
  
  /** Language-specific settings overrides */
  languageSettings: Record<LanguageCode, LanguageSpecificSettings>;
  
  /** Cached language metadata (for offline access) */
  cachedMetadata: Record<LanguageCode, LanguageMetadata>;
  
  /** Version of the metadata schema */
  schemaVersion: number;
}

/**
 * Create default language metadata registry
 */
export function createDefaultLanguageMetadataRegistry(): LanguageMetadataRegistry {
  return {
    lastUpdated: Date.now(),
    languageSettings: {},
    cachedMetadata: {},
    schemaVersion: 1,
  };
}

// ============================================================================
// Flashcard Language Metadata
// ============================================================================

/**
 * Language-specific metadata for a flashcard
 * Stored in the flashcard's extra field
 */
export interface FlashcardLanguageMetadata {
  /** Language this card belongs to (e.g., 'ja', 'de') */
  language: LanguageCode;
  
  /** Proficiency framework used for this card */
  proficiencyFramework?: ProficiencyFramework;
  
  /** Proficiency level when card was created */
  proficiencyLevelAtCreation?: number;
  
  /** Grammar tags for this card (language-specific) */
  grammarTags?: string[];
  
  /** Decomposition data (language-specific) */
  decomposition?: {
    type: string;
    components: string[];
  };
  
  /** Phonetic data (language-specific) */
  phonetic?: {
    system: string;
    data: Record<string, unknown>;
  };
}

/**
 * Extract language metadata from flashcard
 */
export function getFlashcardLanguageMetadata(
  extra?: Record<string, unknown>
): FlashcardLanguageMetadata | null {
  if (!extra || !extra.languageMetadata) {
    return null;
  }
  return extra.languageMetadata as FlashcardLanguageMetadata;
}

/**
 * Set language metadata on flashcard
 */
export function setFlashcardLanguageMetadata(
  extra: Record<string, unknown> | undefined,
  metadata: FlashcardLanguageMetadata
): Record<string, unknown> {
  const updated = extra || {};
  updated.languageMetadata = metadata;
  return updated;
}

// ============================================================================
// Migration Utilities
// ============================================================================

/**
 * Migrate existing flashcard data to include language metadata
 * This is called during app startup to ensure all cards have language info
 */
export function migrateFlashcardToLanguageMetadata(
  flashcardExtra: Record<string, unknown> | undefined,
  language: LanguageCode
): Record<string, unknown> {
  const updated = flashcardExtra || {};
  
  // If already has language metadata, don't overwrite
  if (updated.languageMetadata) {
    return updated;
  }
  
  // Create new language metadata
  const metadata: FlashcardLanguageMetadata = {
    language,
  };
  
  updated.languageMetadata = metadata;
  return updated;
}
