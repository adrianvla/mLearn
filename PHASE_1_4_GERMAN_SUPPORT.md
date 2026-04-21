# Phase 1.4: German Language Support - Configuration Guide

## Overview

Phase 1.4 adds comprehensive German language support to the metadata configuration system. This includes CEFR proficiency levels, German-specific grammar tags, compound word analysis, and dictionary/TTS provider configuration.

## German Language Metadata

### File: `src/shared/german-language-config.ts`

**Key Components**:

#### 1. CEFR Proficiency Levels
```typescript
GERMAN_CEFR_LEVELS: ProficiencyLevel[] = [
  { numeric: 1, name: 'A1', label: 'CEFR A1 (Beginner)', estimatedVocabularySize: 500 },
  { numeric: 2, name: 'A2', label: 'CEFR A2 (Elementary)', estimatedVocabularySize: 1000 },
  { numeric: 3, name: 'B1', label: 'CEFR B1 (Intermediate)', estimatedVocabularySize: 2000 },
  { numeric: 4, name: 'B2', label: 'CEFR B2 (Upper-Intermediate)', estimatedVocabularySize: 4000 },
  { numeric: 5, name: 'C1', label: 'CEFR C1 (Advanced)', estimatedVocabularySize: 8000 },
  { numeric: 6, name: 'C2', label: 'CEFR C2 (Mastery)', estimatedVocabularySize: 12000 },
]
```

#### 2. German Grammar Tags
```typescript
GERMAN_GRAMMAR_TAGS = [
  // Case (Kasus)
  'nominative', 'accusative', 'dative', 'genitive',
  
  // Gender (Genus)
  'masculine', 'feminine', 'neuter',
  
  // Number (Numerus)
  'singular', 'plural',
  
  // Tense (Tempus)
  'present', 'past', 'perfect', 'pluperfect', 'future', 'future-perfect',
  
  // Mood (Modus)
  'indicative', 'subjunctive', 'conditional', 'imperative',
  
  // Verb types
  'strong-verb', 'weak-verb', 'modal-verb', 'reflexive-verb',
  'separable-verb', 'inseparable-verb',
  
  // ... and more
]
```

#### 3. Compound Word Analysis
```typescript
GERMAN_COMPOUND_PATTERNS = [
  { pattern: /^(\w+)(mann|frau|person)$/i, type: 'agent-noun' },
  { pattern: /^(\w+)(haus|raum|platz|straße)$/i, type: 'location-noun' },
  { pattern: /^(\w+)(zeit|tag|jahr|stunde)$/i, type: 'time-noun' },
  // ... more patterns
]
```

#### 4. Dictionary Backends
```typescript
GERMAN_DICTIONARY_BACKENDS = [
  { name: 'wiktionary', label: 'Wiktionary', priority: 1 },
  { name: 'dwds', label: 'DWDS', priority: 2 },
  { name: 'duden', label: 'Duden', priority: 3 },
]
```

#### 5. TTS Providers
```typescript
GERMAN_TTS_PROVIDERS = [
  { name: 'kokoro', label: 'Kokoro (Local)', offline: true, priority: 1 },
  { name: 'espeak', label: 'eSpeak (System)', offline: true, priority: 2 },
  { name: 'google-tts', label: 'Google TTS', offline: false, priority: 3 },
]
```

## German Language Metadata Structure

```typescript
GERMAN_LANGUAGE_METADATA: LanguageMetadata = {
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
    supportedPOS: ['NOUN', 'VERB', 'ADJ', 'ADV', ...],
  },
  
  // Decomposition
  decomposition: {
    type: 'compound-analysis',
    supportsCharacterDecomposition: false,
    supportsWordDecomposition: true,
  },
  
  // Grammar
  grammar: {
    isSupported: true,
    categories: ['case', 'gender', 'number', 'tense', 'mood', ...],
    hasGrammarPoints: true,
  },
  
  // Proficiency
  proficiencyFrameworks: [{
    framework: 'cefr',
    levels: GERMAN_CEFR_LEVELS,
    defaultLevel: 1,
    isSupported: true,
  }],
  defaultProficiencyFramework: 'cefr',
  
  // Dictionary, OCR, TTS, STT support
  hasDictionarySupport: true,
  dictionaryBackends: ['wiktionary', 'dwds', 'duden'],
  hasOCRSupport: true,
  hasTTSSupport: true,
  hasSTTSupport: true,
  
  // Features
  features: {
    showReadings: false,
    showPitchAccent: false,
    showGrammar: true,
    showDecomposition: true,
    supportsBlurring: true,
    supportsVerticalDisplay: false,
  },
}
```

## Integration Points

### 1. Language Registry

The German metadata is automatically registered in the language registry:

```typescript
import { getLanguage } from '@shared/language-registry';

const germanMetadata = getLanguage('de');
console.log(germanMetadata.name); // "German"
console.log(germanMetadata.defaultProficiencyFramework); // "cefr"
```

### 2. Feature Checking

Check if German supports specific features:

```typescript
import { languageSupportsFeature } from '@shared/language-registry';

if (languageSupportsFeature('de', 'showGrammar')) {
  // Show grammar information for German
}

if (!languageSupportsFeature('de', 'showPitchAccent')) {
  // Don't show pitch accent for German
}
```

### 3. Proficiency Levels

Get German proficiency levels:

```typescript
import { getLanguageProficiencyLevels } from '@shared/language-registry';

const levels = getLanguageProficiencyLevels('de');
// Returns: [A1, A2, B1, B2, C1, C2]

const defaultLevel = getLanguageDefaultProficiencyLevel('de');
// Returns: { numeric: 1, name: 'A1', label: 'CEFR A1 (Beginner)', ... }
```

### 4. Grammar Tags

Access German grammar tags:

```typescript
import { getGermanLanguageConfig } from '@shared/german-language-config';

const config = getGermanLanguageConfig();
const grammarTags = config.grammarTags;
// Returns: ['nominative', 'accusative', 'dative', ...]
```

### 5. Compound Analysis

Use German compound patterns:

```typescript
import { getGermanLanguageConfig } from '@shared/german-language-config';

const config = getGermanLanguageConfig();
const patterns = config.compoundPatterns;

// Example: "Schulhaus" (school building)
// Pattern matches: /^(\w+)(haus|raum|platz|straße)$/i
// Type: 'location-noun'
```

## German-Specific Features

### 1. Case System (Kasus)
German has 4 cases: nominative, accusative, dative, genitive
- Tracked via grammar tags
- Used for grammar-aware learning
- Helps learners understand word relationships

### 2. Gender (Genus)
German has 3 genders: masculine, feminine, neuter
- Tracked via grammar tags
- Important for article and adjective agreement
- Helps learners memorize nouns with correct articles

### 3. Compound Words
German frequently uses compound words (e.g., "Schulhaus" = "Schule" + "Haus")
- Decomposition strategy: 'compound-analysis'
- Helps learners understand word formation
- Enables breaking down complex words

### 4. Verb Types
German has multiple verb types:
- Strong verbs (irregular)
- Weak verbs (regular)
- Modal verbs
- Reflexive verbs
- Separable verbs
- Inseparable verbs

### 5. CEFR Framework
German uses CEFR (Common European Framework of Reference)
- 6 levels: A1, A2, B1, B2, C1, C2
- Vocabulary size estimates for each level
- Aligns with international standards

## Comparison: Japanese vs German

| Feature | Japanese | German |
|---------|----------|--------|
| Proficiency Framework | JLPT (N5-N1) | CEFR (A1-C2) |
| Phonetic System | Furigana + Pitch | IPA |
| Morphological Analysis | MeCab (no spaces) | spaCy (space-delimited) |
| Decomposition | Kanji radicals | Compound analysis |
| Grammar Tags | Particles, verb forms | Case, gender, tense |
| Dictionary Backends | JMDict, Jitendex | Wiktionary, DWDS, Duden |
| TTS Providers | Kokoro, Qwen3-TTS | Kokoro, eSpeak, Google |
| Character Names | Yes | No |
| Vertical Text | Yes | No |

## Testing German Support

### Unit Tests

```typescript
import { getLanguage, languageSupportsFeature } from '@shared/language-registry';
import { getGermanLanguageConfig } from '@shared/german-language-config';

describe('German Language Support', () => {
  it('should have German metadata', () => {
    const german = getLanguage('de');
    expect(german).toBeDefined();
    expect(german?.name).toBe('German');
    expect(german?.code).toBe('de');
  });

  it('should support CEFR proficiency framework', () => {
    const german = getLanguage('de');
    expect(german?.defaultProficiencyFramework).toBe('cefr');
    expect(german?.proficiencyFrameworks[0].levels).toHaveLength(6);
  });

  it('should support grammar features', () => {
    expect(languageSupportsFeature('de', 'showGrammar')).toBe(true);
  });

  it('should not support pitch accent', () => {
    expect(languageSupportsFeature('de', 'showPitchAccent')).toBe(false);
  });

  it('should have German grammar tags', () => {
    const config = getGermanLanguageConfig();
    expect(config.grammarTags).toContain('nominative');
    expect(config.grammarTags).toContain('accusative');
    expect(config.grammarTags).toContain('dative');
    expect(config.grammarTags).toContain('genitive');
  });

  it('should have German dictionary backends', () => {
    const config = getGermanLanguageConfig();
    expect(config.dictionaryBackends).toContainEqual(
      expect.objectContaining({ name: 'wiktionary' })
    );
  });
});
```

### Integration Tests

1. **Load German Content**:
   - Create flashcard with German word
   - Verify language is set to 'de'
   - Verify CEFR proficiency level is used

2. **Grammar Features**:
   - Display German word with grammar tags
   - Verify case, gender, number are shown
   - Verify pitch accent is NOT shown

3. **Compound Analysis**:
   - Load German compound word
   - Verify decomposition is available
   - Verify components are identified

4. **Dictionary Lookup**:
   - Look up German word
   - Verify Wiktionary backend is used
   - Verify definitions are displayed

## Verification Checklist

- [ ] German language configuration created (`src/shared/german-language-config.ts`)
- [ ] CEFR proficiency levels defined (6 levels: A1-C2)
- [ ] German grammar tags defined (20+ tags)
- [ ] Compound word patterns defined
- [ ] Dictionary backends configured (Wiktionary, DWDS, Duden)
- [ ] TTS providers configured (Kokoro, eSpeak, Google)
- [ ] German metadata added to language registry
- [ ] Language helpers updated (`getSupportedLanguageCodes`, `isSupportedLanguage`)
- [ ] TypeScript compilation passes
- [ ] German metadata matches language-abstraction interface
- [ ] All features correctly set (showGrammar: true, showPitchAccent: false, etc.)

## Next Steps

After Phase 1.4 is complete:
1. Phase 2: Implement trait-based NLP backend abstraction
2. Phase 3: Implement dictionary backend abstraction
3. Phase 4: Implement proficiency framework configuration
4. Phase 5: Implement German language support (morphology, proficiency, metadata)

## References

- `src/shared/german-language-config.ts` - German language configuration
- `src/shared/language-abstraction.ts` - Language abstraction types
- `src/shared/language-registry.ts` - Language registry
- CEFR Framework: https://www.coe.int/en/web/common-european-framework-reference-levels
- German Grammar: https://www.dwds.de/
