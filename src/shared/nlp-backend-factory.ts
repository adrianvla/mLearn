/**
 * NLP Backend Factory Implementation
 * 
 * Factory for creating and managing NLP backend instances.
 * Provides:
 * - Backend instantiation by type
 * - Configuration management
 * - Lifecycle management (initialization, cleanup)
 * - Error handling and logging
 */

import type { NLPBackend, NLPBackendConfig, NLPBackendFactory } from './nlp-backend-abstraction';
import { NLPBackendError } from './nlp-backend-abstraction';
import { MeCabBackend } from './mecab-backend';
import { SpaCyBackend } from './spacy-backend';
import { getNLPBackendRegistry } from './nlp-backend-registry';

// ============================================================================
// Backend Factory Implementation
// ============================================================================

/**
 * Default NLP Backend Factory
 * 
 * Creates NLP backend instances based on type and configuration.
 * Supports:
 * - MeCab (Japanese morphological analysis)
 * - spaCy (German and other languages)
 * - Extensible for additional backends
 */
export class DefaultNLPBackendFactory implements NLPBackendFactory {
  private backendCreators: Map<string, (config?: NLPBackendConfig) => Promise<NLPBackend>> = new Map();

  constructor() {
    this.registerDefaultBackends();
  }

  /**
   * Register default backend creators
   */
  private registerDefaultBackends(): void {
    // MeCab backend for Japanese
    this.registerBackendCreator('mecab', async (config?: NLPBackendConfig) => {
      return new MeCabBackend(config);
    });

    // spaCy backend for German and other languages
    this.registerBackendCreator('spacy', async (config?: NLPBackendConfig) => {
      return new SpaCyBackend('de', config);
    });
  }

  /**
   * Register a custom backend creator
   * 
   * Allows registration of custom backend implementations.
   * 
   * @param backendType - Type identifier for the backend
   * @param creator - Async function that creates the backend instance
   */
  registerBackendCreator(
    backendType: string,
    creator: (config?: NLPBackendConfig) => Promise<NLPBackend>
  ): void {
    if (this.backendCreators.has(backendType)) {
      console.warn(`[NLPBackendFactory] Backend creator for '${backendType}' already registered, replacing`);
    }

    this.backendCreators.set(backendType, creator);
    console.log(`[NLPBackendFactory] Registered backend creator for '${backendType}'`);
  }

  /**
   * Create a backend instance
   * 
   * Creates and optionally initializes a backend instance.
   * If config.autoInitialize is true, the backend is initialized before returning.
   * 
   * @param backendType - Type of backend (e.g., 'mecab', 'spacy')
   * @param config - Backend-specific configuration
   * @returns Initialized backend instance
   * @throws NLPBackendError if backend type is not supported or initialization fails
   */
  async createBackend(
    backendType: string,
    config?: NLPBackendConfig
  ): Promise<NLPBackend> {
    const creator = this.backendCreators.get(backendType);
    if (!creator) {
      throw new NLPBackendError(
        backendType,
        'ja',
        `Unsupported backend type: ${backendType}. Supported types: ${Array.from(this.backendCreators.keys()).join(', ')}`
      );
    }

    try {
      console.log(`[NLPBackendFactory] Creating backend instance: ${backendType}`);

      const backend = await creator(config);

      // Auto-initialize if configured
      if (config?.autoInitialize !== false) {
        console.log(`[NLPBackendFactory] Auto-initializing backend: ${backendType}`);
        await backend.initialize();
      }

      console.log(`[NLPBackendFactory] Backend created successfully: ${backendType}`);
      return backend;
    } catch (error) {
      throw new NLPBackendError(
        backendType,
        'ja',
        `Failed to create backend: ${backendType}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Create and register a backend
   * 
   * Creates a backend and automatically registers it with the global registry.
   * 
   * @param backendType - Type of backend
   * @param config - Backend configuration
   * @returns Created and registered backend
   */
  async createAndRegisterBackend(
    backendType: string,
    config?: NLPBackendConfig
  ): Promise<NLPBackend> {
    const backend = await this.createBackend(backendType, config);
    const registry = getNLPBackendRegistry();
    registry.register(backend);
    return backend;
  }

  /**
   * Create multiple backends from configuration
   * 
   * Creates multiple backends from an array of configurations.
   * Failures in individual backends are logged but don't prevent
   * other backends from being created.
   * 
   * @param configs - Array of backend configurations
   * @returns Array of created backends
   */
  async createMultipleBackends(configs: NLPBackendConfig[]): Promise<NLPBackend[]> {
    const backends: NLPBackend[] = [];

    for (const config of configs) {
      try {
        const backend = await this.createBackend(config.type, config);
        backends.push(backend);
      } catch (error) {
        console.error(`[NLPBackendFactory] Failed to create backend '${config.type}':`, error);
      }
    }

    return backends;
  }

  /**
   * Create and register multiple backends
   * 
   * Creates multiple backends and registers them with the global registry.
   * 
   * @param configs - Array of backend configurations
   * @returns Array of created and registered backends
   */
  async createAndRegisterMultipleBackends(configs: NLPBackendConfig[]): Promise<NLPBackend[]> {
    const backends = await this.createMultipleBackends(configs);
    const registry = getNLPBackendRegistry();

    for (const backend of backends) {
      registry.register(backend);
    }

    return backends;
  }

  /**
   * Get list of supported backend types
   */
  getSupportedBackendTypes(): string[] {
    return Array.from(this.backendCreators.keys());
  }
}

// ============================================================================
// Global Factory Singleton
// ============================================================================

let globalFactory: DefaultNLPBackendFactory | null = null;

/**
 * Get the global NLP backend factory
 * 
 * Returns a singleton instance of the factory.
 * Creates the factory on first call.
 */
export function getNLPBackendFactory(): DefaultNLPBackendFactory {
  if (!globalFactory) {
    globalFactory = new DefaultNLPBackendFactory();
  }
  return globalFactory;
}

/**
 * Reset the global factory (for testing)
 */
export function resetNLPBackendFactory(): void {
  globalFactory = null;
}
