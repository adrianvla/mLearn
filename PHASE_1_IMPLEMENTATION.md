# Phase 1: Language Abstraction Layer Implementation

## Overview

Phase 1 implements a language-agnostic type system that separates language-specific capabilities from core study logic. This enables robust support for multiple languages (Japanese, German, and future languages) while preserving advanced features for each language.

## Completed Tasks (Phase 1.1)

### 1. Language Abstraction Types (`src/shared/language-abstraction.ts`)

**Purpose**: Define a comprehensive type system for language metadata and capabilities.

**Key Components**:

#### Language Code
```typescript
type LanguageCode = 'ja' | 'de' | string;
```
- ISO 639-1 format with optional region codes
- Extensible for future languages
- Validation function: `isValidLanguageCode()`

#### Proficiency Framework Abstraction
```typescript
interface ProficiencyLevel {
  framework: ProficiencyFramework;
  numeric: number;
  name: string;
  label: string;
  estimatedVocabularySize?: number;
}
```
- Supports JLPT (Japanese), CEFR (German), and custom frameworks
- Numeric levels (0-5) for consistent comparison across languages
- Named levels (N1, A1, etc.) for user display
- Vocabulary size estimates for curriculum planning

#### Language Metadata
```typescript
interface LanguageMetadata {
  code: LanguageCode;
  name: string;
  nativeName?: string;
  
  // Writing system
  usesLatinScript: boolean;
  supportedScripts: string[];
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
  
  // Dictionary, OCR, TTS, STT support
  hasDictionarySupport: boolean;
  hasOCRSupport: boolean;
  hasTTSSupport: boolean;
  hasSTTSupport: boolean;
  
  // Feature flags
  features: {
    showReadings: boolean;
    showPitchAccent: boolean;
    showGrammar: boolean;
    showDecomposition: boolean;
    supportsBlurring: boolean;
    supportsVerticalDisplay: boolean;
  };
}
```

**Architectural Benefits**:
- **Language-agnostic core**: Study logic doesn't know about specific languages
- **Metadata-driven**: Features are configured via metadata, not hardcoded
- **Extensible**: New languages can be added by creating new metadata entries
- **Type-safe**: TypeScript ensures all required fields are present

### 2. Language Registry (`src/shared/language-registry.ts`)

**Purpose**: Provide a singleton registry for accessing language metadata throughout the application.

**Key Functions**:
- `initializeLanguageRegistry()`: Initialize the global registry
- `getLanguageRegistry()`: Get the global registry instance
- `getLanguage(code)`: Get metadata for a specific language
- `isLanguageSupported(code)`: Check if a language is supported
- `getSupportedLanguageCodes()`: Get all supported language codes
- `languageSupportsFeature(code, feature)`: Check if a language supports a feature
- `registerLanguage(metadata)`: Register a new language at runtime
- `unregisterLanguage(code)`: Unregister a language

**Usage Pattern**:
```typescript
import { getLanguage, languageSupportsFeature } from '@shared/language-registry';

// Get language metadata
const jaMetadata = getLanguage('ja');

// Check if language supports a feature
if (languageSupportsFeature('ja', 'showPitchAccent')) {
  // Show pitch accent UI
}

// Get proficiency levels
const levels = getLanguageProficiencyLevels('de');
```

### 3. Metadata Implementations

#### Japanese Metadata (`createJapaneseMetadata()`)
- **Phonetic System**: Furigana + Pitch accent
- **Morphological Analysis**: MeCab (no space delimiters)
- **Decomposition**: Kanji radicals
- **Proficiency**: JLPT (N5-N1)
- **Features**: Vertical text, character names, OCR RAM saver
- **Dictionary**: JMDict, Jitendex
- **TTS**: Kokoro, Qwen3-TTS

#### German Metadata (`createGermanMetadata()`)
- **Phonetic System**: IPA
- **Morphological Analysis**: spaCy (space-delimited)
- **Decomposition**: Compound analysis
- **Proficiency**: CEFR (A1-C2)
- **Features**: Grammar tagging, compound analysis
- **Dictionary**: Wiktionary, DWDS
- **TTS**: Kokoro, eSpeak

## Next Steps (Phase 1.2-1.4)

### Phase 1.2: Database Migration
- Create migration to add `language_metadata` table
- Store language-specific settings per language
- Add `language_code` foreign key to flashcards

### Phase 1.3: Settings Integration
- Update `Settings` interface to use language metadata
- Migrate existing Japanese settings to new schema
- Add language-specific settings overrides

### Phase 1.4: German Support
- Add German language configuration to registry
- Implement German morphological analysis backend
- Add German dictionary support

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Application Layer                         │
│  (Video Player, Flashcards, Settings, etc.)                 │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│              Language Registry (Singleton)                   │
│  - getLanguage(code)                                         │
│  - languageSupportsFeature(code, feature)                    │
│  - getLanguageProficiencyLevels(code)                        │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│           Language Metadata (Type System)                    │
│  - LanguageMetadata interface                               │
│  - ProficiencyLevel interface                               │
│  - MorphAnalysisStrategy interface                          │
│  - DecompositionStrategy interface                          │
│  - GrammarTaggingSystem interface                           │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│        Language-Specific Implementations                     │
│  - Japanese: MeCab, Furigana, JLPT, Kanji radicals         │
│  - German: spaCy, IPA, CEFR, Compound analysis             │
│  - Future: Spanish, French, Chinese, etc.                   │
└─────────────────────────────────────────────────────────────┘
```

## Integration Points

### 1. Renderer Components
Components should use the language registry to determine what UI to show:

```typescript
import { languageSupportsFeature } from '@shared/language-registry';

export function WordDisplay(props: { word: string; language: LanguageCode }) {
  return (
    <div>
      <span>{props.word}</span>
      {languageSupportsFeature(props.language, 'showReadings') && (
        <ruby>{props.reading}</ruby>
      )}
      {languageSupportsFeature(props.language, 'showPitchAccent') && (
        <PitchAccent pitch={props.pitch} />
      )}
    </div>
  );
}
```

### 2. Backend Services
Services should query the registry to determine which NLP backends to use:

```typescript
import { getLanguage } from '@shared/language-registry';

export async function tokenizeText(text: string, language: LanguageCode) {
  const metadata = getLanguage(language);
  const analyzer = selectMorphAnalyzer(metadata.morphAnalysis.type);
  return analyzer.tokenize(text);
}
```

### 3. Settings Management
Settings should respect language-specific defaults:

```typescript
import { getLanguage } from '@shared/language-registry';

export function getDefaultSettings(language: LanguageCode): Settings {
  const metadata = getLanguage(language);
  return {
    ...DEFAULT_SETTINGS,
    ...metadata.features,
  };
}
```

## Testing Strategy

### Unit Tests
- `language-abstraction.ts`: Test metadata creation and validation
- `language-registry.ts`: Test registry operations (get, register, unregister)

### Integration Tests
- Verify all supported languages have complete metadata
- Verify feature flags match actual implementation
- Verify proficiency levels are correctly ordered

### End-to-End Tests
- Load Japanese content with Japanese metadata
- Load German content with German metadata
- Switch between languages and verify UI updates

## Backward Compatibility

The implementation maintains backward compatibility:
- Existing Japanese settings continue to work
- New language metadata is additive (no breaking changes)
- Settings migration is handled in Phase 1.2

## Performance Considerations

- Language registry is a singleton (initialized once)
- Metadata lookups are O(1) hash table access
- Feature checks are simple boolean lookups
- No runtime overhead compared to hardcoded approach

## Future Extensions

### Phase 2: NLP Backend Abstraction
- Define `MorphAnalyzer` trait
- Implement MeCab backend for Japanese
- Implement spaCy backend for German

### Phase 3: Dictionary Backend Abstraction
- Define `DictionaryBackend` trait
- Implement JMDict backend for Japanese
- Implement Wiktionary backend for German

### Phase 4: Proficiency Configuration
- Allow users to select proficiency framework
- Support custom proficiency levels
- Integrate with curriculum planning

### Phase 5: German Language Support
- Implement German morphological analysis
- Add German dictionary support
- Add German proficiency tracking

## References

- **Anki Architecture**: Language-agnostic card model via Protobuf
- **MeCrab**: Pluggable morphological analysis with trait-based design
- **Jiten**: Language-tagged metadata for multilingual support
- **Kanji-Data**: Extensible metadata schemas with nullable fields
- **ARCHITECTURE_MULTILINGUAL_REFERENCE.md**: Full research documentation
