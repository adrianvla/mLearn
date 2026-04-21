# Multilingual Architecture Research - Summary

**Research Period**: April 21, 2026  
**Objective**: Analyze how established Japanese-learning apps model language-specific features while maintaining extensibility for other languages (German parity focus)

## Research Scope

### Projects Analyzed
1. **Anki** (27.6k ⭐) - Spaced repetition with language-agnostic card model
2. **MeCrab** (2026) - Pure Rust morphological analyzer with pluggable backends
3. **Jiten** (130 ⭐) - Multilingual dictionary with language-tagged senses
4. **Kanji-Data** - Extensible metadata schema for character/word data
5. **Auf Deutsch** (5 ⭐) - German learning app (reference for German-specific needs)
6. **RsMorphy** (32 ⭐) - Morphological analyzer for Russian/Ukrainian

### Key Findings

#### 1. Language-Agnostic Data Models (Anki Pattern)
- **Insight**: Anki's Protobuf-based card model is completely language-neutral
- **Implementation**: Fields are named strings; templates are pure HTML/CSS
- **Benefit**: RTL support, custom fields, and language-specific rendering are all field-level configs
- **Evidence**: [Anki notetypes.proto](https://github.com/ankitects/anki/blob/main/proto/anki/notetypes.proto)

#### 2. Pluggable NLP Backends (MeCrab Pattern)
- **Insight**: Separate runtime analysis from dictionary data via trait-based design
- **Implementation**: Core Viterbi algorithm is language-independent; dictionary loading is abstracted
- **Benefit**: Same core logic works for Japanese (no spaces) and German (space-delimited)
- **Evidence**: [MeCrab workspace structure](https://github.com/cool-japan/mecrab/blob/master/README.md)

#### 3. Language-Tagged Metadata (Jiten Pattern)
- **Insight**: Each sense/definition carries a language tag; filtering is language-aware
- **Implementation**: `Sense = namedtuple("Sense", """pos lang gloss info xref""".split())`
- **Benefit**: Multilingual glosses, extensible to new languages without code changes
- **Evidence**: [Jiten jmdict.py](https://github.com/obfusk/jiten/blob/master/jiten/jmdict.py)

#### 4. Extensible Metadata Schemas (Kanji-Data Pattern)
- **Insight**: Store language-specific metadata as nullable fields in JSON
- **Implementation**: `jlpt_old`, `jlpt_new`, `wk_level` are optional; add `cefr_level`, `goethe_level` for German
- **Benefit**: No breaking changes; versioning awareness; extensibility without schema migration
- **Evidence**: [kanji-data/kanji.json](https://github.com/davidluzgouveia/kanji-data/blob/master/README.md)

#### 5. Dictionary Entry Abstraction (Jisho API Pattern)
- **Insight**: Dictionary entries are language-agnostic containers with language-specific fields
- **Implementation**: `DictionaryEntry` has `language` tag; `Sense` has `language` tag for gloss language
- **Benefit**: Supports multilingual glosses; extensible metadata per language
- **Evidence**: [Jisho API Documentation](https://mistval.github.io/unofficial-jisho-api/API.html)

## Architectural Patterns Identified

### Pattern 1: Language-Agnostic Card Model
**Applies to**: Study logic, templates, scheduling  
**Status**: ✅ Already implemented in codebase  
**Action**: No changes needed; ready for German

### Pattern 2: Pluggable Morphological Analysis
**Applies to**: Tokenization, POS tagging, morphology  
**Status**: ⚠️ Japanese-specific (MeCab hardcoded)  
**Action**: Define `MorphAnalyzer` trait; implement German backend using Spacy/STANZA

### Pattern 3: Language-Tagged Metadata
**Applies to**: Dictionary entries, senses, definitions  
**Status**: ⚠️ Japanese-specific (JMDict hardcoded)  
**Action**: Add `language` tag to all metadata; support multilingual glosses

### Pattern 4: Extensible Metadata Schemas
**Applies to**: Vocabulary entries, proficiency levels, grammar tags  
**Status**: ⚠️ JLPT hardcoded; no German support  
**Action**: Create `LanguageMetadata` struct with nullable fields; support CEFR/Goethe levels

### Pattern 5: Dictionary Backend Abstraction
**Applies to**: Dictionary lookup, entry parsing, sense filtering  
**Status**: ⚠️ JMDict hardcoded  
**Action**: Define `DictionaryBackend` trait; implement German backend (DWDS/Wiktionary)

## Feature-Capability Matrix

| **Feature** | **Japanese** | **German** | **Abstraction** | **Status** |
|---|---|---|---|---|
| Morphological Analysis | MeCab/Janome | Spacy/STANZA | `MorphAnalyzer` trait | ⚠️ Hardcoded |
| Phonetic Representation | Furigana + Pitch | IPA + Stress | `PhoneticSystem` enum | ⚠️ Hardcoded |
| Proficiency Framework | JLPT (N1-N5) | CEFR (A1-C2) | `ProficiencyFramework` enum | ⚠️ Hardcoded |
| Character Decomposition | Kanji radicals | Compound analysis | `DecompositionStrategy` trait | ⚠️ Hardcoded |
| Grammar Tagging | Particles | Cases/Gender | `GrammarTag` schema | ⚠️ Hardcoded |
| Dictionary Linkage | JMDict/Kanjidic | Wiktionary/DWDS | `DictionaryBackend` trait | ⚠️ Hardcoded |
| TTS/Audio | Pitch accent-aware | Standard phoneme | `AudioGenerator` trait | ⚠️ Hardcoded |
| Sentence Parsing | Particles + deps | Cases + deps | `SyntaxAnalyzer` trait | ⚠️ Hardcoded |
| Card Templates | HTML/CSS | HTML/CSS | ✅ Already abstracted | ✅ Ready |
| Spaced Repetition | Language-agnostic | Language-agnostic | ✅ Already abstracted | ✅ Ready |

## Refactoring Roadmap

### Phase 1: Data Model Abstraction (Weeks 1-2)
- Define `LanguageCode`, `ProficiencyLevel`, `LanguageMetadata` types
- Migrate existing Japanese data to new schema
- Add database migration for new fields

### Phase 2: Trait-Based NLP Backends (Weeks 3-4)
- Define `MorphAnalyzer` trait
- Implement `JapaneseMorphAnalyzer` wrapper
- Create `MorphAnalyzerRegistry` for runtime selection

### Phase 3: Dictionary Backend Abstraction (Weeks 5-6)
- Define `DictionaryBackend` trait
- Refactor JMDict to implement trait
- Create `DictionaryRegistry` for runtime selection

### Phase 4: Proficiency Framework Configuration (Weeks 7-8)
- Define `ProficiencyFramework` enum
- Create configuration schema (YAML)
- Implement `get_proficiency_config()` function

### Phase 5: German Language Support (Weeks 9-12)
- Implement `GermanMorphAnalyzer` using Spacy
- Implement DWDS backend for dictionary lookup
- Create German vocabulary dataset
- Implement German card templates

## Concrete Code Examples

### Language-Agnostic Trait Pattern
```rust
pub trait MorphAnalyzer: Send + Sync {
    fn parse(&self, text: &str) -> Result<Vec<Morpheme>>;
    fn language(&self) -> LanguageCode;
}

pub struct Morpheme {
    pub surface: String,
    pub lemma: String,
    pub pos: String,
    pub extra: HashMap<String, String>,  // furigana, ipa, gender, etc.
}
```

### Language-Tagged Dictionary Entry
```typescript
interface DictionaryEntry {
    id: string;
    headword: string;
    language: LanguageCode;
    senses: Sense[];
    metadata: LanguageMetadata;
}

interface Sense {
    pos: string[];
    gloss: string[];
    language: LanguageCode;  // Language of gloss
    info?: string[];
}
```

### Extensible Metadata Schema
```json
{
    "headword": "Schmetterling",
    "language": "de",
    "metadata": {
        "frequency": 4521,
        "proficiency_level": "A1",
        "gender": "feminine",
        "article": "die",
        "plural": "Schmetterlinge",
        "stress_pattern": "SCHMET-ter-ling",
        "etymology": "Old High German: Schmetter (butter) + -ling"
    }
}
```

## Success Criteria

- ✅ Japanese features work identically after refactoring
- ✅ German vocabulary can be added without modifying core code
- ✅ New language can be added by implementing 2 traits: `MorphAnalyzer` + `DictionaryBackend`
- ✅ Proficiency frameworks are configurable (not hardcoded)
- ✅ Card templates work for both Japanese and German
- ✅ All existing tests pass; new tests for German support added

## Deliverables

1. **ARCHITECTURE_MULTILINGUAL_REFERENCE.md** - Comprehensive reference brief with:
   - Feature mapping table (Japanese → German)
   - 5 architectural patterns with evidence
   - Feature-capability matrix
   - 5-phase refactoring roadmap
   - Concrete code examples
   - Risk mitigation strategies
   - Success criteria

2. **RESEARCH_SUMMARY.md** (this document) - Executive summary of findings

## Next Steps

1. **Review & Approval**: Present findings to team
2. **Phase 1 Implementation**: Begin data model abstraction
3. **Continuous Integration**: Ensure tests pass after each phase
4. **Documentation**: Update architecture docs as patterns are implemented
5. **German Onboarding**: Recruit German language expert for Phase 5

---

**Research Completed**: April 21, 2026  
**Evidence Sources**: 6 major OSS projects, 4 architectural patterns, 5-phase implementation roadmap  
**Status**: Ready for implementation
