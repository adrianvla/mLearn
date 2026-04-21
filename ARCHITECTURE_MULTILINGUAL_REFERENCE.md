# Multilingual Language-Learning Architecture Reference Brief

**Date**: April 2026  
**Status**: Research Complete - Ready for Implementation  
**Scope**: Japanese-to-German Parity via Language-Agnostic Design

---

## Executive Summary

This brief synthesizes architectural patterns from established Japanese-learning OSS tools (Anki, MeCrab, Jiten, Jisho API) and emerging German-learning projects to inform a language-agnostic, extensible design. 

**Core Principle**: Separate language-specific data models from core study logic via metadata-driven configuration and pluggable NLP backends.

**Key Finding**: Successful multilingual learning apps achieve parity not by duplicating code, but by abstracting language-specific concerns into trait-based backends and configuration-driven metadata.

---

## I. Japanese-Specific Features & Their Architectural Abstraction

### A. Feature Mapping Table

| **Japanese Feature** | **Implementation Pattern** | **German Equivalent** | **Abstraction Layer** | **Status** |
|---|---|---|---|---|
| **Furigana (readings)** | Parallel text field + rendering logic | Phonetic transcription (IPA) | `LanguageMetadata.phonetic_system` | ⚠️ Hardcoded |
| **Pitch Accent** | Metadata tag + TTS parameter | Stress/intonation markers | `LanguageMetadata.prosody_support` | ⚠️ Hardcoded |
| **Kanji (character decomposition)** | Radical system + stroke order | Compound word analysis + etymology | `LanguageMetadata.morphology_type` | ⚠️ Hardcoded |
| **JLPT Proficiency Framework** | Vocabulary/kanji level tags (N1-N5) | CEFR (A1-C2) or Goethe levels | `ProficiencyFramework` enum | ⚠️ Hardcoded |
| **Tokenization/Morphology** | MeCab/Janome (no spaces) | Spacy/STANZA (space-delimited) | `MorphAnalyzer` trait | ⚠️ Hardcoded |
| **Sentence Parsing** | Dependency parsing + particles | Dependency parsing + cases | `SyntaxAnalyzer` trait | ⚠️ Hardcoded |
| **Dictionary Linkage** | JMDict/Kanjidic with sense tags | Wiktionary/DWDS with POS tags | `DictionaryBackend` trait | ⚠️ Hardcoded |
| **TTS/Audio** | Pitch accent-aware synthesis | Standard phoneme-based synthesis | `AudioGenerator` trait | ⚠️ Hardcoded |
| **Card Templates** | Language-agnostic (HTML/CSS) | Language-agnostic (HTML/CSS) | ✅ Already abstracted | ✅ Ready |
| **Spaced Repetition** | Language-agnostic scheduling | Language-agnostic scheduling | ✅ Already abstracted | ✅ Ready |

### B. Concrete Example: Jiten's Language-Aware Sense Model

**Evidence** ([jiten/jmdict.py](https://github.com/obfusk/jiten/blob/master/jiten/jmdict.py)):

```python
Sense = namedtuple("Sense", """pos lang gloss info xref""".split())

def gloss_pos_info(e, langs):
    gloss, pos, info = { l: [] for l in langs }, [], []
    for l in langs:
        for s in e.sense:
            if s.lang != l: continue
            pos.extend(s.pos)
            info.extend(s.info)
            gloss[l].append(s.gloss)
    return gloss, tuple(M.uniq(pos + info))
```

**Pattern**: Each sense (definition) carries a `lang` tag. The search function filters by language list. This is **language-agnostic at the data model level**—German would use the same structure with `lang="deu"` instead of `lang="eng"`.

---

## II. Architectural Patterns for Language Extensibility

### Pattern 1: Language-Agnostic Card Model (Anki)

**Source**: [Anki Protobuf: notetypes.proto](https://github.com/ankitects/anki/blob/main/proto/anki/notetypes.proto#L47-L131)

**Key Insight**: Anki's `Notetype` (card template) is **completely language-neutral**:

```protobuf
message Notetype {
  message Field {
    string name = 2;
    Config config = 5;  // sticky, rtl, font, description, plain_text, etc.
  }
  repeated Field fields = 8;
  repeated Template templates = 9;  // HTML + CSS, no language assumptions
}
```

**Why This Works**:
- Fields are named strings (e.g., "Front", "Back", "Kanji", "Meaning")
- Templates are pure HTML/CSS—no hardcoded language logic
- RTL support is a **field-level config**, not a language-level assumption
- Users define what goes in each field

**German Parity Application**:
```
Notetype: "German Vocabulary"
  Field 1: "German" (config: rtl=false, font="Arial")
  Field 2: "English" (config: rtl=false)
  Field 3: "IPA" (config: rtl=false, description="Phonetic transcription")
  Field 4: "CEFR Level" (config: plain_text=true)
  Template: "Front" → {{German}} + {{IPA}}
           "Back" → {{English}} + {{CEFR Level}}
```

**Actionable Refactor**:
- ✅ Store language metadata in field `config` (not hardcoded)
- ✅ Use feature flags for language-specific rendering (e.g., `show_furigana`, `show_ipa`)
- ✅ Separate template logic from language assumptions

---

### Pattern 2: Pluggable Morphological Analysis (MeCrab)

**Source**: [MeCrab Architecture](https://github.com/cool-japan/mecrab/blob/master/README.md#workspace-structure)

**Key Insight**: MeCrab separates **runtime analysis** from **dictionary data**:

```
mecrab/
├── mecrab/          # Core library (language-agnostic Viterbi + lattice)
├── mecrab-builder/  # Data pipeline (Wikidata/Wikipedia processing)
├── mecrab-word2vec/ # Word embeddings (language-agnostic)
└── kizame/          # CLI tool (pluggable backends)
```

**Why This Works**:
- Core `MeCrab` struct uses **IPADIC dictionary format** (pluggable)
- Viterbi algorithm is **language-independent** (works for any tokenization problem)
- Dictionary loading is **abstracted** via `Dictionary` trait
- Semantic enrichment (Wikidata URIs) is **optional, language-agnostic**

**German Parity Application**:
```rust
// Language-agnostic trait
pub trait MorphAnalyzer {
    fn parse(&self, text: &str) -> Result<Vec<Morpheme>>;
    fn add_word(&mut self, surface: &str, lemma: &str, pos: &str, cost: i32);
}

// Japanese implementation
pub struct JapaneseMorphAnalyzer { /* MeCrab wrapper */ }
impl MorphAnalyzer for JapaneseMorphAnalyzer { /* ... */ }

// German implementation (future)
pub struct GermanMorphAnalyzer { /* Spacy/STANZA wrapper */ }
impl MorphAnalyzer for GermanMorphAnalyzer { /* ... */ }

// Core study logic (language-agnostic)
pub fn tokenize_for_study(text: &str, analyzer: &dyn MorphAnalyzer) -> Vec<Token> {
    analyzer.parse(text).map(|m| Token {
        surface: m.surface,
        lemma: m.lemma,
        pos: m.pos,
        // Language-specific fields optional
        furigana: m.extra.get("furigana"),
        ipa: m.extra.get("ipa"),
    })
}
```

**Actionable Refactor**:
- ✅ Define `MorphAnalyzer` trait with language-agnostic interface
- ✅ Move Japanese-specific logic (furigana extraction, pitch accent) to `extra` field
- ✅ Implement German analyzer using existing libraries (Spacy, STANZA)
- ✅ Use feature flags to compile only needed analyzers

---

### Pattern 3: Language Metadata Configuration (Kanji-Data + Jiten)

**Source**: [kanji-data/kanji.json](https://github.com/davidluzgouveia/kanji-data/blob/master/README.md#example)

**Key Insight**: Store **language-specific metadata as nullable fields**:

```json
{
  "勝": {
    "strokes": 12,
    "grade": 3,
    "freq": 185,
    "jlpt_old": 2,
    "jlpt_new": 3,
    "meanings": ["Victory", "Win"],
    "readings_on": ["しょう"],
    "readings_kun": ["か.つ"],
    "wk_level": 9,
    "wk_meanings": ["Win"],
    "wk_radicals": ["Moon", "Gladiator"]
  }
}
```

**Why This Works**:
- Fields like `wk_level`, `wk_meanings` are **optional** (null if not in WaniKani)
- `jlpt_old` vs `jlpt_new` shows **versioning awareness**
- Structure is **extensible**: add `cefr_level`, `goethe_level` for German

**German Parity Application**:

```json
{
  "Schmetterling": {
    "length": 12,
    "frequency_rank": 4521,
    "cefr_level": "A1",
    "goethe_level": "A1",
    "meanings": ["butterfly"],
    "etymology": "Old High German: Schmetter (butter) + -ling",
    "compound_parts": ["Schmet", "ter", "ling"],
    "gender": "feminine",
    "plural": "Schmetterlinge",
    "article": "die",
    "stress_pattern": "SCHMET-ter-ling"
  }
}
```

**Actionable Refactor**:
- ✅ Create `LanguageMetadata` schema with nullable language-specific fields
- ✅ Use enums for proficiency frameworks: `ProficiencyFramework::JLPT | CEFR | Goethe`
- ✅ Store metadata in database with `language_code` + `metadata_type` keys
- ✅ Implement versioning for proficiency levels (e.g., `jlpt_old` vs `jlpt_new`)

---

### Pattern 4: Dictionary Entry Abstraction (Jisho API)

**Source**: [Jisho API Documentation](https://mistval.github.io/unofficial-jisho-api/API.html)

**Key Insight**: Dictionary entries are **language-agnostic containers** with language-specific fields:

```typescript
interface DictionaryEntry {
  id: string;
  headword: string;
  language: LanguageCode;
  senses: Sense[];
  metadata: {
    frequency?: number;
    proficiency_level?: string;
    tags?: string[];
  };
}

interface Sense {
  pos: string[];  // Part of speech
  gloss: string[];  // Definitions
  language: LanguageCode;  // Language of gloss
  info?: string[];  // Usage info
  xref?: string[];  // Cross-references
}
```

**Why This Works**:
- `Sense` carries its own `language` tag (supports multilingual glosses)
- `metadata` is extensible (add `pitch_accent`, `ipa`, `gender`, etc.)
- `pos` is language-agnostic (both Japanese and German use POS tags)

**German Parity Application**:

```typescript
// Japanese entry
{
  headword: "猫",
  language: "ja",
  senses: [
    {
      pos: ["noun"],
      gloss: ["cat"],
      language: "en",
      info: ["usually written in kana"]
    }
  ],
  metadata: {
    frequency: 301,
    proficiency_level: "N5",
    pitch_accent: "ねꜜこ"
  }
}

// German entry
{
  headword: "Katze",
  language: "de",
  senses: [
    {
      pos: ["noun", "feminine"],
      gloss: ["cat"],
      language: "en",
      info: ["plural: Katzen"]
    }
  ],
  metadata: {
    frequency: 1234,
    proficiency_level: "A1",
    gender: "feminine",
    article: "die",
    stress_pattern: "KAT-ze"
  }
}
```

**Actionable Refactor**:
- ✅ Define `DictionaryEntry` interface with language-agnostic core
- ✅ Move language-specific fields to `metadata` object
- ✅ Use `LanguageCode` enum for all language references
- ✅ Support multilingual glosses via `Sense.language` tag

---

## III. Feature-Capability Matrix

| **Feature** | **Japanese** | **German** | **Abstraction** | **Implementation Status** |
|---|---|---|---|---|
| **Morphological Analysis** | MeCab/Janome (no spaces) | Spacy/STANZA (space-delimited) | `MorphAnalyzer` trait | ⚠️ Trait defined, need German impl |
| **Phonetic Representation** | Furigana (kana) + Pitch accent | IPA + Stress markers | `PhoneticSystem` enum | ⚠️ Furigana hardcoded, need abstraction |
| **Proficiency Framework** | JLPT (N1-N5) | CEFR (A1-C2) / Goethe | `ProficiencyFramework` enum | ⚠️ JLPT hardcoded, need config |
| **Character/Word Decomposition** | Kanji radicals + stroke order | Compound analysis + etymology | `DecompositionStrategy` trait | ⚠️ Kanji-specific, need abstraction |
| **Grammar Tagging** | Particles + verb conjugation | Cases + gender + verb tense | `GrammarTag` schema | ⚠️ Particle-specific, need abstraction |
| **Dictionary Linkage** | JMDict/Kanjidic | Wiktionary/DWDS | `DictionaryBackend` trait | ⚠️ JMDict hardcoded, need abstraction |
| **TTS/Audio** | Pitch accent-aware | Standard phoneme-based | `AudioGenerator` trait | ⚠️ Pitch accent-specific, need abstraction |
| **Sentence Parsing** | Dependency parsing + particles | Dependency parsing + cases | `SyntaxAnalyzer` trait | ⚠️ Particle-specific, need abstraction |
| **Card Templates** | Language-agnostic (HTML/CSS) | Language-agnostic (HTML/CSS) | ✅ Already abstracted | ✅ Ready for German |
| **Spaced Repetition** | Language-agnostic | Language-agnostic | ✅ Already abstracted | ✅ Ready for German |

---

## IV. Concrete Refactoring Roadmap

### Phase 1: Data Model Abstraction (Weeks 1-2)

**Goal**: Separate language-specific data from core study logic

```rust
// BEFORE (Japanese-centric)
pub struct VocabularyEntry {
    kanji: String,
    furigana: String,
    meaning: String,
    jlpt_level: u8,
    pitch_accent: String,
}

// AFTER (Language-agnostic)
pub struct VocabularyEntry {
    headword: String,
    language: LanguageCode,
    meanings: Vec<Meaning>,
    proficiency_level: Option<ProficiencyLevel>,
    metadata: LanguageMetadata,
}

pub struct LanguageMetadata {
    phonetic: Option<PhoneticInfo>,
    morphology: Option<MorphologyInfo>,
    grammar: Option<GrammarInfo>,
    custom: HashMap<String, serde_json::Value>,
}

pub enum LanguageCode {
    Japanese,
    German,
    // ...
}

pub enum ProficiencyLevel {
    JLPT(u8),
    CEFR(CefrLevel),
    Goethe(GoetheLevelLevel),
}
```

**Deliverables**:
- [ ] Define `LanguageCode`, `ProficiencyLevel`, `LanguageMetadata` types
- [ ] Migrate existing Japanese data to new schema
- [ ] Add database migration for new fields
- [ ] Write tests for schema conversion

---

### Phase 2: Trait-Based NLP Backends (Weeks 3-4)

**Goal**: Make morphological analysis pluggable

```rust
pub trait MorphAnalyzer: Send + Sync {
    fn parse(&self, text: &str) -> Result<Vec<Morpheme>>;
    fn add_word(&mut self, surface: &str, lemma: &str, pos: &str, cost: i32) -> Result<()>;
    fn language(&self) -> LanguageCode;
}

pub struct Morpheme {
    pub surface: String,
    pub lemma: String,
    pub pos: String,
    pub extra: HashMap<String, String>,  // furigana, ipa, gender, etc.
}

// Japanese implementation
pub struct JapaneseMorphAnalyzer {
    mecrab: MeCrab,
}

impl MorphAnalyzer for JapaneseMorphAnalyzer {
    fn parse(&self, text: &str) -> Result<Vec<Morpheme>> {
        let result = self.mecrab.parse(text)?;
        Ok(result.nodes.iter().map(|node| Morpheme {
            surface: node.surface.clone(),
            lemma: node.feature.base_form().to_string(),
            pos: node.feature.pos().to_string(),
            extra: {
                let mut m = HashMap::new();
                m.insert("furigana".to_string(), node.feature.reading().to_string());
                m.insert("pitch_accent".to_string(), node.feature.pitch().to_string());
                m
            },
        }).collect())
    }
    
    fn language(&self) -> LanguageCode { LanguageCode::Japanese }
}

// German implementation (future)
pub struct GermanMorphAnalyzer {
    spacy: SpacyModel,
}

impl MorphAnalyzer for GermanMorphAnalyzer {
    fn parse(&self, text: &str) -> Result<Vec<Morpheme>> {
        let doc = self.spacy.process(text)?;
        Ok(doc.tokens.iter().map(|token| Morpheme {
            surface: token.text.clone(),
            lemma: token.lemma.clone(),
            pos: token.pos.clone(),
            extra: {
                let mut m = HashMap::new();
                m.insert("gender".to_string(), token.morph.get("Gender").unwrap_or("").to_string());
                m.insert("case".to_string(), token.morph.get("Case").unwrap_or("").to_string());
                m
            },
        }).collect())
    }
    
    fn language(&self) -> LanguageCode { LanguageCode::German }
}
```

**Deliverables**:
- [ ] Define `MorphAnalyzer` trait
- [ ] Implement `JapaneseMorphAnalyzer` wrapper around MeCrab
- [ ] Create `MorphAnalyzerRegistry` for runtime selection
- [ ] Add configuration for selecting analyzer per language
- [ ] Write integration tests

---

### Phase 3: Dictionary Backend Abstraction (Weeks 5-6)

**Goal**: Support multiple dictionary sources

```rust
pub trait DictionaryBackend: Send + Sync {
    fn lookup(&self, headword: &str) -> Result<Vec<DictionaryEntry>>;
    fn language(&self) -> LanguageCode;
}

pub struct DictionaryEntry {
    pub id: String,
    pub headword: String,
    pub language: LanguageCode,
    pub senses: Vec<Sense>,
    pub metadata: LanguageMetadata,
}

pub struct Sense {
    pub pos: Vec<String>,
    pub gloss: Vec<String>,
    pub language: LanguageCode,
    pub info: Vec<String>,
    pub xref: Vec<String>,
}

// Japanese implementation (JMDict)
pub struct JmDictBackend {
    db: sqlite::Connection,
}

impl DictionaryBackend for JmDictBackend {
    fn lookup(&self, headword: &str) -> Result<Vec<DictionaryEntry>> {
        // Query JMDict database
        // Parse results into DictionaryEntry
    }
    
    fn language(&self) -> LanguageCode { LanguageCode::Japanese }
}

// German implementation (Wiktionary/DWDS)
pub struct DwdsBackend {
    api_client: HttpClient,
}

impl DictionaryBackend for DwdsBackend {
    fn lookup(&self, headword: &str) -> Result<Vec<DictionaryEntry>> {
        // Query DWDS API
        // Parse results into DictionaryEntry
    }
    
    fn language(&self) -> LanguageCode { LanguageCode::German }
}
```

**Deliverables**:
- [ ] Define `DictionaryBackend` trait
- [ ] Refactor existing JMDict code to implement trait
- [ ] Create `DictionaryRegistry` for runtime selection
- [ ] Stub German backend (DWDS API integration)
- [ ] Write tests for dictionary lookup

---

### Phase 4: Proficiency Framework Configuration (Weeks 7-8)

**Goal**: Support multiple proficiency systems

```rust
pub enum ProficiencyFramework {
    JLPT,
    CEFR,
    Goethe,
}

pub struct ProficiencyConfig {
    pub framework: ProficiencyFramework,
    pub levels: Vec<ProficiencyLevel>,
    pub metadata: HashMap<String, serde_json::Value>,
}

// Configuration file (YAML)
proficiency_frameworks:
  japanese:
    framework: JLPT
    levels:
      - id: "N5"
        name: "JLPT N5"
        order: 5
      - id: "N4"
        name: "JLPT N4"
        order: 4
      # ...
  german:
    framework: CEFR
    levels:
      - id: "A1"
        name: "CEFR A1"
        order: 1
      - id: "A2"
        name: "CEFR A2"
        order: 2
      # ...

// Code
pub fn get_proficiency_config(language: LanguageCode) -> Result<ProficiencyConfig> {
    match language {
        LanguageCode::Japanese => Ok(ProficiencyConfig {
            framework: ProficiencyFramework::JLPT,
            levels: vec![
                ProficiencyLevel { id: "N5", name: "JLPT N5", order: 5 },
                // ...
            ],
            metadata: HashMap::new(),
        }),
        LanguageCode::German => Ok(ProficiencyConfig {
            framework: ProficiencyFramework::CEFR,
            levels: vec![
                ProficiencyLevel { id: "A1", name: "CEFR A1", order: 1 },
                // ...
            ],
            metadata: HashMap::new(),
        }),
    }
}
```

**Deliverables**:
- [ ] Define `ProficiencyFramework` enum and config schema
- [ ] Create configuration file for proficiency levels
- [ ] Implement `get_proficiency_config()` function
- [ ] Update UI to use framework-agnostic level names
- [ ] Write tests for proficiency level filtering

---

### Phase 5: German Language Support (Weeks 9-12)

**Goal**: Implement German-specific features

```rust
// German morphological analyzer
pub struct GermanMorphAnalyzer {
    spacy: SpacyModel,
}

impl MorphAnalyzer for GermanMorphAnalyzer {
    fn parse(&self, text: &str) -> Result<Vec<Morpheme>> {
        // Tokenize using Spacy
        // Extract: gender, case, tense, mood
        // Return Morpheme with extra fields
    }
}

// German dictionary backend
pub struct DwdsBackend {
    api_client: HttpClient,
}

impl DictionaryBackend for DwdsBackend {
    fn lookup(&self, headword: &str) -> Result<Vec<DictionaryEntry>> {
        // Query DWDS API
        // Parse: gender, article, plural, etymology
        // Return DictionaryEntry
    }
}

// German-specific metadata
pub struct GermanMetadata {
    pub gender: Option<String>,  // masculine, feminine, neuter
    pub article: Option<String>,  // der, die, das
    pub plural: Option<String>,
    pub stress_pattern: Option<String>,
    pub etymology: Option<String>,
}
```

**Deliverables**:
- [ ] Implement `GermanMorphAnalyzer` using Spacy
- [ ] Implement `DwdsBackend` for dictionary lookup
- [ ] Add German-specific metadata fields
- [ ] Create German vocabulary dataset
- [ ] Implement German card templates
- [ ] Write end-to-end tests

---

## V. Implementation Checklist

### Data Model
- [ ] Define `LanguageCode` enum
- [ ] Define `ProficiencyLevel` enum with variants
- [ ] Create `LanguageMetadata` struct with optional fields
- [ ] Create `DictionaryEntry` schema
- [ ] Create `Sense` schema with language tag
- [ ] Database migration for new fields

### NLP Backends
- [ ] Define `MorphAnalyzer` trait
- [ ] Implement `JapaneseMorphAnalyzer`
- [ ] Create `MorphAnalyzerRegistry`
- [ ] Stub `GermanMorphAnalyzer`
- [ ] Add configuration for analyzer selection

### Dictionary Backends
- [ ] Define `DictionaryBackend` trait
- [ ] Refactor JMDict to implement trait
- [ ] Create `DictionaryRegistry`
- [ ] Stub DWDS backend
- [ ] Add configuration for dictionary selection

### Proficiency Frameworks
- [ ] Define `ProficiencyFramework` enum
- [ ] Create configuration schema
- [ ] Implement `get_proficiency_config()`
- [ ] Update UI to use framework-agnostic names
- [ ] Add proficiency level filtering

### German Support
- [ ] Implement `GermanMorphAnalyzer`
- [ ] Implement DWDS backend
- [ ] Create German vocabulary dataset
- [ ] Create German card templates
- [ ] Add German-specific metadata
- [ ] End-to-end testing

---

## VI. References & Evidence

### Official Documentation
- **Anki Architecture**: https://github.com/ankitects/anki/blob/main/docs/architecture.md
- **Anki Card Templates**: https://docs.ankiweb.net/templates/intro.html
- **MeCrab README**: https://github.com/cool-japan/mecrab/blob/master/README.md
- **Jisho API**: https://mistval.github.io/unofficial-jisho-api/API.html

### OSS Projects Analyzed
- **Anki** (27.6k ⭐): Language-agnostic card model via Protobuf
- **MeCrab** (2026): Pluggable morphological analysis with semantic enrichment
- **Jiten** (130 ⭐): Multilingual dictionary with language-tagged senses
- **Kanji-Data** (GitHub): Extensible metadata schema with nullable fields
- **Auf Deutsch** (5 ⭐): German learning app (reference for German-specific needs)
- **RsMorphy** (32 ⭐): Morphological analyzer for Russian/Ukrainian (reference for non-Japanese morphology)

### Key Architectural Insights
1. **Anki's Protobuf approach** separates data model from language logic
2. **MeCrab's trait-based design** enables pluggable NLP backends
3. **Jiten's language-tagged senses** support multilingual glosses
4. **Kanji-Data's nullable fields** allow extensibility without breaking changes
5. **RsMorphy's language-agnostic Viterbi** shows morphology can be abstracted

---

## VII. Risk Mitigation

| **Risk** | **Mitigation** |
|---|---|
| **Breaking changes to existing Japanese data** | Implement database migration with backward compatibility layer |
| **Performance regression from abstraction** | Benchmark trait dispatch; use `dyn` only where necessary |
| **Incomplete German NLP support** | Start with Spacy (mature, well-tested); plan for future improvements |
| **Configuration complexity** | Provide sensible defaults; document configuration schema |
| **Testing burden** | Use property-based testing for language-agnostic logic; mock backends for unit tests |

---

## VIII. Success Criteria

- ✅ Japanese features work identically after refactoring
- ✅ German vocabulary can be added without modifying core code
- ✅ New language can be added by implementing 2 traits: `MorphAnalyzer` + `DictionaryBackend`
- ✅ Proficiency frameworks are configurable (not hardcoded)
- ✅ Card templates work for both Japanese and German
- ✅ All existing tests pass; new tests for German support added

---

## IX. Next Steps

1. **Review & Approval**: Present this brief to team for feedback
2. **Phase 1 Implementation**: Begin data model abstraction (Week 1)
3. **Continuous Integration**: Ensure all tests pass after each phase
4. **Documentation**: Update architecture docs as patterns are implemented
5. **German Onboarding**: Recruit German language expert for Phase 5

---

**This brief provides a concrete, evidence-based roadmap for achieving German parity while preserving Japanese support through language-agnostic architecture.**

**Research Completed**: April 21, 2026  
**Evidence Sources**: 6 major OSS projects analyzed, 4 architectural patterns identified, 5-phase implementation roadmap defined.
