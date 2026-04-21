/**
 * Language Abstraction Layer
 * 
 * This module provides a language-agnostic type system for supporting multiple languages
 * while preserving advanced language-specific features. It separates language capabilities
 * from core study logic via metadata-driven configuration and pluggable backends.
 * 
 * Based on architectural patterns from:
 * - Anki (language-agnostic card model via Protobuf)
 * - MeCrab (pluggable morphological analysis)
 * - Jiten (language-tagged metadata)
 * - Kanji-Data (extensible metadata schemas)
 */

// ============================================================================
// Language Code & Identification
// ============================================================================

/**
 * ISO 639-1 language codes supported by mLearn
 * Extensible for future language support
 */
export type LanguageCode = 'ja' | 'de' | string;

/**
 * Validates if a language code is recognized
 */
export function isValidLanguageCode(code: unknown): code is LanguageCode {
  if (typeof code !== 'string') return false;
  // ISO 639-1 format: 2-3 lowercase letters, optionally with region (e.g., 'en-US')
  return /^[a-z]{2,3}(-[A-Z]{2})?$/.test(code);
}

// ============================================================================
// Proficiency Framework Abstraction
// ============================================================================

/**
 * Proficiency level types supported by different languages
 * - JLPT: Japanese Language Proficiency Test (N5-N1)
 * - CEFR: Common European Framework of Reference (A1-C2)
 * - Custom: Language-specific frameworks
 */
export type ProficiencyFramework = 'jlpt' | 'cefr' | 'custom';

/**
 * Proficiency level definition
 * Supports both numeric (0-5) and named (N1, A1, etc.) representations
 */
export interface ProficiencyLevel {
  /** Framework this level belongs to (e.g., 'jlpt', 'cefr') */
  framework: ProficiencyFramework;
  /** Numeric level (0 = beginner, 5 = advanced) */
  numeric: number;
  /** Named level (e.g., 'N5', 'A1', 'B2') */
  name: string;
  /** Human-readable description */
  label: string;
  /** Estimated vocabulary size at this level */
  estimatedVocabularySize?: number;
}

/**
 * Proficiency framework configuration
 * Defines all levels and their properties for a language
 */
export interface ProficiencyFrameworkConfig {
  framework: ProficiencyFramework;
  /** Levels in ascending order of difficulty */
  levels: ProficiencyLevel[];
  /** Default level for new learners */
  defaultLevel: number;
  /** Whether this framework is actively supported for the language */
  isSupported: boolean;
}

// ============================================================================
// Language Metadata
// ============================================================================

/**
 * Phonetic system used by a language
 * - furigana: Japanese hiragana/katakana readings
 * - ipa: International Phonetic Alphabet
 * - pinyin: Mandarin romanization
 * - custom: Language-specific system
 */
export type PhoneticSystem = 'furigana' | 'ipa' | 'pinyin' | 'custom' | 'none';

/**
 * Morphological analysis strategy
 * Defines how words are tokenized and analyzed
 */
export interface MorphAnalysisStrategy {
  /** Type of analysis (e.g., 'mecab', 'spacy', 'stanza', 'custom') */
  type: 'mecab' | 'spacy' | 'stanza' | 'custom' | 'none';
  /** Whether the language uses spaces to delimit words */
  usesSpaceDelimitation: boolean;
  /** Whether the language requires morphological analysis for tokenization */
  requiresMorphAnalysis: boolean;
  /** Supported parts of speech for this language */
  supportedPOS: string[];
}

/**
 * Character/word decomposition strategy
 * Defines how words are broken down for learning
 */
export interface DecompositionStrategy {
  /** Type of decomposition (e.g., 'kanji-radicals', 'compound-analysis', 'etymology', 'none') */
  type: 'kanji-radicals' | 'compound-analysis' | 'etymology' | 'none';
  /** Whether this language supports character-level decomposition */
  supportsCharacterDecomposition: boolean;
  /** Whether this language supports word-level decomposition */
  supportsWordDecomposition: boolean;
}

/**
 * Grammar tagging system for a language
 */
export interface GrammarTaggingSystem {
  /** Whether grammar tagging is supported */
  isSupported: boolean;
  /** Grammar tag categories (e.g., 'particle', 'case', 'tense', 'mood') */
  categories: string[];
  /** Whether grammar points are available for study */
  hasGrammarPoints: boolean;
}

/**
 * Comprehensive language metadata
 * Defines all language-specific capabilities and configurations
 */
export interface LanguageMetadata {
  // Basic identification
  code: LanguageCode;
  name: string;
  nativeName?: string;
  
  // Script and writing system
  usesLatinScript: boolean;
  supportedScripts: string[]; // Unicode script tags (e.g., ['Latn'], ['Hira', 'Kana', 'Han'])
  supportsVerticalText: boolean;
  supportsRTL: boolean;
  
  // Phonetic representation
  phoneticSystem: PhoneticSystem;
  hasPitchAccent: boolean;
  hasFurigana: boolean;
  
  // Morphological analysis
  morphAnalysis: MorphAnalysisStrategy;
  
  // Character/word decomposition
  decomposition: DecompositionStrategy;
  
  // Grammar system
  grammar: GrammarTaggingSystem;
  
  // Proficiency frameworks
  proficiencyFrameworks: ProficiencyFrameworkConfig[];
  defaultProficiencyFramework: ProficiencyFramework;
  
  // Dictionary support
  hasDictionarySupport: boolean;
  dictionaryBackends: string[]; // e.g., ['jmdict', 'wiktionary', 'dwds']
  
  // OCR support
  hasOCRSupport: boolean;
  hasOCRRamSaver?: boolean;
  
  // TTS support
  hasTTSSupport: boolean;
  ttsSystems?: string[]; // e.g., ['kokoro', 'qwen3-tts', 'espeak']
  
  // STT support
  hasSTTSupport: boolean;
  
  // Character name detection (for subtitles)
  hasCharacterNameDetection: boolean;
  
  // Feature flags
  features: {
    /** Whether to show readings alongside text */
    showReadings: boolean;
    /** Whether to show pitch accent information */
    showPitchAccent: boolean;
    /** Whether to show grammar information */
    showGrammar: boolean;
    /** Whether to show character decomposition */
    showDecomposition: boolean;
    /** Whether to blur known words */
    supportsBlurring: boolean;
    /** Whether to support vertical text display */
    supportsVerticalDisplay: boolean;
  };
}

// ============================================================================
// Language Configuration Registry
// ============================================================================

/**
 * Registry of all supported languages and their metadata
 * This is the single source of truth for language capabilities
 */
export interface LanguageRegistry {
  [langCode: string]: LanguageMetadata;
}

/**
 * Create a language metadata entry for Japanese
 */
export function createJapaneseMetadata(): LanguageMetadata {
  return {
    code: 'ja',
    name: 'Japanese',
    nativeName: '日本語',
    usesLatinScript: false,
    supportedScripts: ['Hira', 'Kana', 'Han'],
    supportsVerticalText: true,
    supportsRTL: false,
    phoneticSystem: 'furigana',
    hasPitchAccent: true,
    hasFurigana: true,
    morphAnalysis: {
      type: 'mecab',
      usesSpaceDelimitation: false,
      requiresMorphAnalysis: true,
      supportedPOS: ['名詞', '動詞', '形容詞', '副詞', '助詞', '助動詞', '形状詞', '接尾辞', '感動詞', '代名詞', '連体詞', '形容動詞'],
    },
    decomposition: {
      type: 'kanji-radicals',
      supportsCharacterDecomposition: true,
      supportsWordDecomposition: false,
    },
    grammar: {
      isSupported: true,
      categories: ['particle', 'verb-form', 'tense', 'mood', 'aspect'],
      hasGrammarPoints: true,
    },
    proficiencyFrameworks: [
      {
        framework: 'jlpt',
        levels: [
          { framework: 'jlpt', numeric: 5, name: 'N5', label: 'JLPT N5 (Beginner)', estimatedVocabularySize: 800 },
          { framework: 'jlpt', numeric: 4, name: 'N4', label: 'JLPT N4 (Elementary)', estimatedVocabularySize: 1500 },
          { framework: 'jlpt', numeric: 3, name: 'N3', label: 'JLPT N3 (Intermediate)', estimatedVocabularySize: 3000 },
          { framework: 'jlpt', numeric: 2, name: 'N2', label: 'JLPT N2 (Upper-Intermediate)', estimatedVocabularySize: 6000 },
          { framework: 'jlpt', numeric: 1, name: 'N1', label: 'JLPT N1 (Advanced)', estimatedVocabularySize: 10000 },
        ],
        defaultLevel: 5,
        isSupported: true,
      },
    ],
    defaultProficiencyFramework: 'jlpt',
    hasDictionarySupport: true,
    dictionaryBackends: ['jmdict', 'jitendex'],
    hasOCRSupport: true,
    hasOCRRamSaver: true,
    hasTTSSupport: true,
    ttsSystems: ['kokoro', 'qwen3-tts'],
    hasSTTSupport: true,
    hasCharacterNameDetection: true,
    features: {
      showReadings: true,
      showPitchAccent: true,
      showGrammar: true,
      showDecomposition: true,
      supportsBlurring: true,
      supportsVerticalDisplay: true,
    },
  };
}

/**
 * Create a language metadata entry for German
 */
export function createGermanMetadata(): LanguageMetadata {
  return {
    code: 'de',
    name: 'German',
    nativeName: 'Deutsch',
    usesLatinScript: true,
    supportedScripts: ['Latn'],
    supportsVerticalText: false,
    supportsRTL: false,
    phoneticSystem: 'ipa',
    hasPitchAccent: false,
    hasFurigana: false,
    morphAnalysis: {
      type: 'spacy',
      usesSpaceDelimitation: true,
      requiresMorphAnalysis: true,
      supportedPOS: ['NOUN', 'VERB', 'ADJ', 'ADV', 'ADP', 'CCONJ', 'SCONJ', 'DET', 'PRON', 'AUX', 'PART', 'PROPN'],
    },
    decomposition: {
      type: 'compound-analysis',
      supportsCharacterDecomposition: false,
      supportsWordDecomposition: true,
    },
    grammar: {
      isSupported: true,
      categories: ['case', 'gender', 'number', 'tense', 'mood', 'aspect', 'person'],
      hasGrammarPoints: true,
    },
    proficiencyFrameworks: [
      {
        framework: 'cefr',
        levels: [
          { framework: 'cefr', numeric: 1, name: 'A1', label: 'CEFR A1 (Beginner)', estimatedVocabularySize: 500 },
          { framework: 'cefr', numeric: 2, name: 'A2', label: 'CEFR A2 (Elementary)', estimatedVocabularySize: 1000 },
          { framework: 'cefr', numeric: 3, name: 'B1', label: 'CEFR B1 (Intermediate)', estimatedVocabularySize: 2000 },
          { framework: 'cefr', numeric: 4, name: 'B2', label: 'CEFR B2 (Upper-Intermediate)', estimatedVocabularySize: 4000 },
          { framework: 'cefr', numeric: 5, name: 'C1', label: 'CEFR C1 (Advanced)', estimatedVocabularySize: 8000 },
          { framework: 'cefr', numeric: 6, name: 'C2', label: 'CEFR C2 (Mastery)', estimatedVocabularySize: 12000 },
        ],
        defaultLevel: 1,
        isSupported: true,
      },
    ],
    defaultProficiencyFramework: 'cefr',
    hasDictionarySupport: true,
    dictionaryBackends: ['wiktionary', 'dwds'],
    hasOCRSupport: true,
    hasOCRRamSaver: false,
    hasTTSSupport: true,
    ttsSystems: ['kokoro', 'espeak'],
    hasSTTSupport: true,
    hasCharacterNameDetection: false,
    features: {
      showReadings: false,
      showPitchAccent: false,
      showGrammar: true,
      showDecomposition: true,
      supportsBlurring: true,
      supportsVerticalDisplay: false,
    },
  };
}

/**
 * Create the default language registry with all supported languages
 */
export function createDefaultLanguageRegistry(): LanguageRegistry {
  return {
    ja: createJapaneseMetadata(),
    de: createGermanMetadata(),
  };
}

/**
 * Get metadata for a specific language
 */
export function getLanguageMetadata(code: LanguageCode, registry: LanguageRegistry): LanguageMetadata | null {
  return registry[code] || null;
}

/**
 * Check if a language supports a specific feature
 */
export function supportsFeature(
  code: LanguageCode,
  feature: keyof LanguageMetadata['features'],
  registry: LanguageRegistry
): boolean {
  const metadata = getLanguageMetadata(code, registry);
  return metadata?.features[feature] ?? false;
}

/**
 * Get the default proficiency level for a language
 */
export function getDefaultProficiencyLevel(
  code: LanguageCode,
  registry: LanguageRegistry
): ProficiencyLevel | null {
  const metadata = getLanguageMetadata(code, registry);
  if (!metadata) return null;
  
  const framework = metadata.proficiencyFrameworks.find(
    f => f.framework === metadata.defaultProficiencyFramework
  );
  if (!framework) return null;
  
  return framework.levels[framework.defaultLevel] || null;
}

/**
 * Get all proficiency levels for a language
 */
export function getProficiencyLevels(
  code: LanguageCode,
  registry: LanguageRegistry
): ProficiencyLevel[] {
  const metadata = getLanguageMetadata(code, registry);
  if (!metadata) return [];
  
  const framework = metadata.proficiencyFrameworks.find(
    f => f.framework === metadata.defaultProficiencyFramework
  );
  return framework?.levels || [];
}
