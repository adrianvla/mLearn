/**
 * German Language Configuration
 * 
 * Comprehensive configuration for German language support in mLearn.
 * Includes proficiency levels, grammar tags, and language-specific features.
 */

import type { LanguageMetadata, ProficiencyLevel } from './language-abstraction';

// ============================================================================
// CEFR Proficiency Levels
// ============================================================================

/**
 * CEFR (Common European Framework of Reference) levels for German
 * Used for proficiency tracking and curriculum planning
 */
export const GERMAN_CEFR_LEVELS: ProficiencyLevel[] = [
  {
    framework: 'cefr',
    numeric: 1,
    name: 'A1',
    label: 'CEFR A1 (Beginner)',
    estimatedVocabularySize: 500,
  },
  {
    framework: 'cefr',
    numeric: 2,
    name: 'A2',
    label: 'CEFR A2 (Elementary)',
    estimatedVocabularySize: 1000,
  },
  {
    framework: 'cefr',
    numeric: 3,
    name: 'B1',
    label: 'CEFR B1 (Intermediate)',
    estimatedVocabularySize: 2000,
  },
  {
    framework: 'cefr',
    numeric: 4,
    name: 'B2',
    label: 'CEFR B2 (Upper-Intermediate)',
    estimatedVocabularySize: 4000,
  },
  {
    framework: 'cefr',
    numeric: 5,
    name: 'C1',
    label: 'CEFR C1 (Advanced)',
    estimatedVocabularySize: 8000,
  },
  {
    framework: 'cefr',
    numeric: 6,
    name: 'C2',
    label: 'CEFR C2 (Mastery)',
    estimatedVocabularySize: 12000,
  },
];

// ============================================================================
// German Grammar Tags
// ============================================================================

/**
 * German-specific grammar tags for word classification
 * Used for grammar-aware learning and filtering
 */
export const GERMAN_GRAMMAR_TAGS = [
  // Case (Kasus)
  'nominative',
  'accusative',
  'dative',
  'genitive',
  
  // Gender (Genus)
  'masculine',
  'feminine',
  'neuter',
  
  // Number (Numerus)
  'singular',
  'plural',
  
  // Tense (Tempus)
  'present',
  'past',
  'perfect',
  'pluperfect',
  'future',
  'future-perfect',
  
  // Mood (Modus)
  'indicative',
  'subjunctive',
  'conditional',
  'imperative',
  
  // Aspect
  'perfective',
  'imperfective',
  
  // Person
  'first-person',
  'second-person',
  'third-person',
  
  // Verb type
  'strong-verb',
  'weak-verb',
  'modal-verb',
  'reflexive-verb',
  'separable-verb',
  'inseparable-verb',
  
  // Adjective type
  'attributive',
  'predicative',
  'adverbial',
  
  // Noun type
  'countable',
  'uncountable',
  'proper-noun',
  'compound-noun',
  
  // Particle type
  'preposition',
  'conjunction',
  'adverb',
  'interjection',
];

// ============================================================================
// German Compound Analysis
// ============================================================================

/**
 * German compound word decomposition patterns
 * Used for breaking down complex German words
 */
export const GERMAN_COMPOUND_PATTERNS = [
  // Noun + Noun compounds
  { pattern: /^(\w+)(mann|frau|person)$/i, type: 'agent-noun' },
  { pattern: /^(\w+)(haus|raum|platz|straße)$/i, type: 'location-noun' },
  { pattern: /^(\w+)(zeit|tag|jahr|stunde)$/i, type: 'time-noun' },
  
  // Adjective + Noun compounds
  { pattern: /^(groß|klein|alt|neu|rot|blau)(\w+)$/i, type: 'adjective-noun' },
  
  // Verb + Noun compounds
  { pattern: /^(\w+)(arbeit|kraft|stoff)$/i, type: 'verb-noun' },
];

// ============================================================================
// German Dictionary Backends
// ============================================================================

/**
 * Supported dictionary backends for German
 *
 * Primary backend is the bundled FreeDict SQLite database shipped with the
 * Python backend (src/root-of-app/dictionaries/freedict-deu-eng/), mirroring
 * the Japanese Jitendex pipeline. Online backends are kept for optional
 * external lookup links in the UI.
 */
export const GERMAN_DICTIONARY_BACKENDS = [
  {
    name: 'freedict',
    label: 'FreeDict (Offline)',
    url: '',
    offline: true,
    priority: 1,
  },
  {
    name: 'wiktionary',
    label: 'Wiktionary',
    url: 'https://en.wiktionary.org/wiki/',
    offline: false,
    priority: 2,
  },
  {
    name: 'duden',
    label: 'Duden',
    url: 'https://www.duden.de/suchen/dudenonline/',
    offline: false,
    priority: 3,
  },
];

// ============================================================================
// German TTS Providers
// ============================================================================

/**
 * Supported TTS providers for German
 */
export const GERMAN_TTS_PROVIDERS = [
  {
    name: 'kokoro',
    label: 'Kokoro (Local)',
    offline: true,
    priority: 1,
  },
  {
    name: 'espeak',
    label: 'eSpeak (System)',
    offline: true,
    priority: 2,
  },
  {
    name: 'google-tts',
    label: 'Google Text-to-Speech',
    offline: false,
    priority: 3,
  },
];

// ============================================================================
// German Language Metadata
// ============================================================================

/**
 * Complete German language metadata
 * Includes all language-specific features and configurations
 */
export const GERMAN_LANGUAGE_METADATA: LanguageMetadata = {
  code: 'de',
  name: 'German',
  nativeName: 'Deutsch',
  
  // Writing system
  usesLatinScript: true,
  supportedScripts: ['Latn'],
  supportsVerticalText: false,
  supportsRTL: false,
  
  // Phonetic representation
  phoneticSystem: 'ipa',
  hasPitchAccent: false,
  hasFurigana: false,
  
  // Morphological analysis
  morphAnalysis: {
    type: 'spacy',
    usesSpaceDelimitation: true,
    requiresMorphAnalysis: true,
    supportedPOS: [
      'NOUN',
      'VERB',
      'ADJ',
      'ADV',
      'ADP',
      'CCONJ',
      'SCONJ',
      'DET',
      'PRON',
      'AUX',
      'PART',
      'PROPN',
      'NUM',
      'INTJ',
      'PUNCT',
      'SYM',
      'X',
    ],
  },
  
  // Character/word decomposition
  decomposition: {
    type: 'compound-analysis',
    supportsCharacterDecomposition: false,
    supportsWordDecomposition: true,
  },
  
  // Grammar system
  grammar: {
    isSupported: true,
    categories: [
      'case',
      'gender',
      'number',
      'tense',
      'mood',
      'aspect',
      'person',
      'verb-type',
      'adjective-type',
      'noun-type',
    ],
    hasGrammarPoints: true,
  },
  
  // Proficiency frameworks
  proficiencyFrameworks: [
    {
      framework: 'cefr',
      levels: GERMAN_CEFR_LEVELS,
      defaultLevel: 1, // A1 (Beginner)
      isSupported: true,
    },
  ],
  defaultProficiencyFramework: 'cefr',
  
  // Dictionary support
  hasDictionarySupport: true,
  dictionaryBackends: ['freedict', 'wiktionary', 'duden'],
  
  // OCR support
  hasOCRSupport: true,
  hasOCRRamSaver: false,
  
  // TTS support
  hasTTSSupport: true,
  ttsSystems: ['kokoro', 'espeak', 'google-tts'],
  
  // STT support
  hasSTTSupport: true,
  
  // Character name detection
  hasCharacterNameDetection: false,
  
  // Feature flags
  features: {
    showReadings: false,
    showPitchAccent: false,
    showGrammar: true,
    showDecomposition: true,
    supportsBlurring: true,
    supportsVerticalDisplay: false,
  },
};

// ============================================================================
// German Language Configuration Export
// ============================================================================

/**
 * Export German language configuration for use in the app
 */
export function getGermanLanguageConfig() {
  return {
    metadata: GERMAN_LANGUAGE_METADATA,
    cefrLevels: GERMAN_CEFR_LEVELS,
    grammarTags: GERMAN_GRAMMAR_TAGS,
    compoundPatterns: GERMAN_COMPOUND_PATTERNS,
    dictionaryBackends: GERMAN_DICTIONARY_BACKENDS,
    ttsProviders: GERMAN_TTS_PROVIDERS,
  };
}
