/**
 * Shared exports
 */

export * from './constants';
export * from './utils/textUtils';
export { 
  // Re-export types but not WindowType (already exported from constants)
  type ColorCodes,
  type Settings,
  DEFAULT_SETTINGS,
  type FrequencyLevelNames,
  type LanguageData,
  type LanguageDataMap,
  type Token,
  type TranslationEntry,
  type DictionaryEntry,
  type PitchInfo,
  type PitchData,
  type TranslationResponse,
  type FlashcardContent,
  type Flashcard,
  type FlashcardStore,
  type Subtitle,
  type WordKnowledge,
  type WordFrequencyEntry,
  type WordFrequencyMap,
  type PitchAccentInfo,
  type WindowSize,
  type OpenWindowPayload,
  type PromptOptions,
  type InstallOptions,
  type InstallerState,
  type PipRequirementsConfig,
  type LLMProvider,
  type LLMChatMessage,
  type LLMToolDefinition,
  type LLMToolCall,
  type LLMStreamChunk,
  type LLMModelStatus,
} from './types';

// Language abstraction exports
export * from './language-abstraction';
export { getLanguageRegistry } from './language-registry';
export * from './language-metadata-schema';
export * from './language-migration';
export * from './german-language-config';

// NLP backend abstraction exports
export * from './nlp-backend-abstraction';
export { DefaultNLPBackendRegistry, getNLPBackendRegistry, resetNLPBackendRegistry } from './nlp-backend-registry';
export { DefaultNLPBackendFactory, getNLPBackendFactory, resetNLPBackendFactory } from './nlp-backend-factory';
export { MeCabBackend } from './mecab-backend';
export { SpaCyBackend } from './spacy-backend';
