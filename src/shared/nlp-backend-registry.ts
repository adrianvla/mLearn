/**
 * NLP Backend Registry Implementation
 * 
 * Manages multiple NLP backends and provides language-aware backend selection.
 * Implements the NLPBackendRegistry interface with:
 * - Backend registration/unregistration
 * - Language-aware backend selection
 * - Priority-based backend ranking
 * - Initialization and lifecycle management
 */

import type { LanguageCode } from './language-abstraction';
import type { NLPBackend, NLPBackendRegistry } from './nlp-backend-abstraction';

// ============================================================================
// Backend Registry Implementation
// ============================================================================

/**
 * Default NLP Backend Registry
 * 
 * Manages a collection of NLP backends and provides methods to:
 * - Register/unregister backends
 * - Query backends by ID or language
 * - Select the best backend for a given language
 */
export class DefaultNLPBackendRegistry implements NLPBackendRegistry {
  private backends: Map<string, NLPBackend> = new Map();
  private languageBackendMap: Map<LanguageCode, NLPBackend[]> = new Map();
  private initialized = false;

  /**
   * Register a new backend
   * @param backend - NLP backend to register
   */
  register(backend: NLPBackend): void {
    if (this.backends.has(backend.id)) {
      console.warn(`[NLPBackendRegistry] Backend '${backend.id}' already registered, replacing`);
    }

    this.backends.set(backend.id, backend);

    // Update language-to-backend mapping
    for (const language of backend.supportedLanguages) {
      if (!this.languageBackendMap.has(language)) {
        this.languageBackendMap.set(language, []);
      }

      const backendList = this.languageBackendMap.get(language)!;
      
      // Remove if already exists (to avoid duplicates)
      const existingIndex = backendList.findIndex(b => b.id === backend.id);
      if (existingIndex >= 0) {
        backendList.splice(existingIndex, 1);
      }

      // Add backend and sort by priority (higher priority first)
      backendList.push(backend);
      backendList.sort((a, b) => {
        const priorityA = (a as any).priority || 0;
        const priorityB = (b as any).priority || 0;
        return priorityB - priorityA;
      });
    }

    console.log(`[NLPBackendRegistry] Registered backend '${backend.id}' for languages: ${backend.supportedLanguages.join(', ')}`);
  }

  /**
   * Unregister a backend
   * @param backendId - ID of backend to unregister
   */
  unregister(backendId: string): void {
    const backend = this.backends.get(backendId);
    if (!backend) {
      console.warn(`[NLPBackendRegistry] Backend '${backendId}' not found`);
      return;
    }

    this.backends.delete(backendId);

    // Remove from language-to-backend mapping
    for (const language of backend.supportedLanguages) {
      const backendList = this.languageBackendMap.get(language);
      if (backendList) {
        const index = backendList.findIndex(b => b.id === backendId);
        if (index >= 0) {
          backendList.splice(index, 1);
        }
      }
    }

    console.log(`[NLPBackendRegistry] Unregistered backend '${backendId}'`);
  }

  /**
   * Get a backend by ID
   * @param backendId - ID of backend to retrieve
   * @returns Backend or null if not found
   */
  getBackend(backendId: string): NLPBackend | null {
    return this.backends.get(backendId) || null;
  }

  /**
   * Get the best backend for a language
   * 
   * Returns the highest-priority available backend for the given language.
   * If no backend is available, returns null.
   * 
   * @param language - Language code
   * @returns Best backend for language or null if none available
   */
  getBestBackend(language: LanguageCode): NLPBackend | null {
    const backends = this.languageBackendMap.get(language);
    if (!backends || backends.length === 0) {
      return null;
    }

    // Return first backend (already sorted by priority)
    return backends[0];
  }

  /**
   * Get all available backends
   * @returns Array of all registered backends
   */
  getAllBackends(): NLPBackend[] {
    return Array.from(this.backends.values());
  }

  /**
   * Get all backends that support a language
   * @param language - Language code
   * @returns Array of backends supporting the language (sorted by priority)
   */
  getBackendsForLanguage(language: LanguageCode): NLPBackend[] {
    const backends = this.languageBackendMap.get(language);
    return backends ? [...backends] : [];
  }

  /**
   * Initialize all registered backends
   * 
   * Initializes all backends that have autoInitialize enabled.
   * Failures in individual backends are logged but don't prevent
   * other backends from initializing.
   */
  async initializeAll(): Promise<void> {
    if (this.initialized) {
      console.log('[NLPBackendRegistry] Already initialized');
      return;
    }

    console.log('[NLPBackendRegistry] Initializing all backends');

    const initPromises = Array.from(this.backends.values()).map(async (backend) => {
      try {
        await backend.initialize();
        console.log(`[NLPBackendRegistry] Backend '${backend.id}' initialized successfully`);
      } catch (error) {
        console.error(`[NLPBackendRegistry] Failed to initialize backend '${backend.id}':`, error);
      }
    });

    await Promise.all(initPromises);
    this.initialized = true;
    console.log('[NLPBackendRegistry] All backends initialized');
  }

  /**
   * Cleanup all backends
   * 
   * Calls cleanup on all registered backends.
   * Failures in individual backends are logged but don't prevent
   * other backends from cleaning up.
   */
  async cleanupAll(): Promise<void> {
    console.log('[NLPBackendRegistry] Cleaning up all backends');

    const cleanupPromises = Array.from(this.backends.values()).map(async (backend) => {
      try {
        await backend.cleanup();
        console.log(`[NLPBackendRegistry] Backend '${backend.id}' cleaned up successfully`);
      } catch (error) {
        console.error(`[NLPBackendRegistry] Failed to cleanup backend '${backend.id}':`, error);
      }
    });

    await Promise.all(cleanupPromises);
    this.initialized = false;
    console.log('[NLPBackendRegistry] All backends cleaned up');
  }

  /**
   * Check if registry is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get statistics about registered backends
   */
  getStats(): {
    totalBackends: number;
    supportedLanguages: LanguageCode[];
    backendsByLanguage: Record<LanguageCode, string[]>;
  } {
    const supportedLanguages = Array.from(this.languageBackendMap.keys());
    const backendsByLanguage: Record<LanguageCode, string[]> = {};

    for (const [language, backends] of this.languageBackendMap.entries()) {
      backendsByLanguage[language] = backends.map(b => b.id);
    }

    return {
      totalBackends: this.backends.size,
      supportedLanguages,
      backendsByLanguage,
    };
  }
}

// ============================================================================
// Global Registry Singleton
// ============================================================================

let globalRegistry: DefaultNLPBackendRegistry | null = null;

/**
 * Get the global NLP backend registry
 * 
 * Returns a singleton instance of the registry.
 * Creates the registry on first call.
 */
export function getNLPBackendRegistry(): DefaultNLPBackendRegistry {
  if (!globalRegistry) {
    globalRegistry = new DefaultNLPBackendRegistry();
  }
  return globalRegistry;
}

/**
 * Reset the global registry (for testing)
 */
export function resetNLPBackendRegistry(): void {
  globalRegistry = null;
}
