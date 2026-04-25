/**
 * Global Language Registry
 * 
 * Singleton instance of the language registry that provides access to
 * language metadata throughout the application.
 */

import {
  createDefaultLanguageRegistry,
  type LanguageRegistry,
  type LanguageMetadata,
  type LanguageCode,
  getLanguageMetadata,
  supportsFeature,
  getDefaultProficiencyLevel,
  getProficiencyLevels,
} from './language-abstraction';

// Global registry instance
let globalRegistry: LanguageRegistry | null = null;

/**
 * Initialize the global language registry
 * Should be called once at application startup
 */
export function initializeLanguageRegistry(): LanguageRegistry {
  if (!globalRegistry) {
    globalRegistry = createDefaultLanguageRegistry();
  }
  return globalRegistry;
}

/**
 * Get the global language registry
 * Initializes if not already done
 */
export function getLanguageRegistry(): LanguageRegistry {
  if (!globalRegistry) {
    initializeLanguageRegistry();
  }
  return globalRegistry!;
}

/**
 * Get metadata for a language using the global registry
 */
export function getLanguage(code: LanguageCode): LanguageMetadata | null {
  return getLanguageMetadata(code, getLanguageRegistry());
}

/**
 * Check if a language is supported
 */
export function isLanguageSupported(code: LanguageCode): boolean {
  return getLanguage(code) !== null;
}

/**
 * Get all supported language codes
 */
export function getSupportedLanguageCodes(): LanguageCode[] {
  return Object.keys(getLanguageRegistry()) as LanguageCode[];
}

/**
 * Get all supported languages with their metadata
 */
export function getAllSupportedLanguages(): LanguageMetadata[] {
  return Object.values(getLanguageRegistry());
}

/**
 * Check if a language supports a specific feature
 */
export function languageSupportsFeature(
  code: LanguageCode,
  feature: keyof LanguageMetadata['features']
): boolean {
  return supportsFeature(code, feature, getLanguageRegistry());
}

/**
 * Get the default proficiency level for a language
 */
export function getLanguageDefaultProficiencyLevel(code: LanguageCode) {
  return getDefaultProficiencyLevel(code, getLanguageRegistry());
}

/**
 * Get all proficiency levels for a language
 */
export function getLanguageProficiencyLevels(code: LanguageCode) {
  return getProficiencyLevels(code, getLanguageRegistry());
}

/**
 * Register a new language or update an existing one
 * Useful for adding custom languages at runtime
 */
export function registerLanguage(metadata: LanguageMetadata): void {
  const registry = getLanguageRegistry();
  registry[metadata.code] = metadata;
}

/**
 * Unregister a language
 */
export function unregisterLanguage(code: LanguageCode): void {
  const registry = getLanguageRegistry();
  delete registry[code];
}
