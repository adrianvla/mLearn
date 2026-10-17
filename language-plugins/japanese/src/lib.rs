//! Japanese morphology owned by the language package, not by the runtime.
//!
//! The host supplies authenticated dictionary bytes once. This owner retains
//! the buffer and reuses Sudachi's tokenizer and result buffers between calls.
//! Offsets always address the original UTF-8 input, before normalization.

use std::rc::Rc;
#[cfg(any(target_arch = "wasm32", test))]
mod plugin;

use serde::Serialize;
use sha2::{Digest, Sha256};
use sudachi::analysis::stateful_tokenizer::StatefulTokenizer;
use sudachi::config::ConfigBuilder;
use sudachi::dic::dictionary::JapaneseDictionary;
use sudachi::dic::storage::{Storage, SudachiDicData};
use sudachi::prelude::{Mode, MorphemeList, SudachiError};
use thiserror::Error;

pub const ENGINE_REVISION: &str = "90fd6068c80c2fc3b63e0dbab0e341475bad4d8f";
pub const DICTIONARY_BYTES: usize = 122_948_155;
pub const DICTIONARY_SHA256: [u8; 32] = [
    0x34, 0xbd, 0xc3, 0xd2, 0x79, 0x53, 0x05, 0x67, 0x39, 0x98, 0x74, 0xe6, 0x2d, 0x7f, 0x98, 0xea,
    0x32, 0x7c, 0x53, 0x6d, 0xd7, 0x02, 0x9a, 0x3d, 0xfd, 0xf5, 0xc6, 0x94, 0xdb, 0x19, 0x42, 0xc7,
];

#[derive(Debug, Error)]
pub enum EngineError {
    #[error("Small 20260116 dictionary has {actual} bytes; expected {DICTIONARY_BYTES}")]
    DictionarySize { actual: usize },
    #[error("Small 20260116 dictionary SHA-256 mismatch")]
    DictionaryDigest,
    #[error(transparent)]
    Sudachi(Box<SudachiError>),
    #[error(transparent)]
    Configuration(#[from] sudachi::config::ConfigError),
}

impl From<SudachiError> for EngineError {
    fn from(error: SudachiError) -> Self {
        Self::Sudachi(Box::new(error))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Token {
    /// Half-open byte range in the original input, not normalized text.
    pub start: usize,
    pub end: usize,
    pub surface: String,
    pub lemma: String,
    pub normalized: String,
    pub reading: String,
    /// Sudachi's six POS components, without a core-owned taxonomy.
    pub pos: Vec<String>,
    pub oov: bool,
}

/// One thread-local owner. Dropping it releases the dictionary and analysis
/// buffers. No filesystem, mmap, dynamic plugin, SDK or host API is needed.
pub struct JapaneseEngine {
    tokenizer: StatefulTokenizer<Rc<JapaneseDictionary>>,
    result: MorphemeList<Rc<JapaneseDictionary>>,
}

impl JapaneseEngine {
    /// Consume the complete, pinned V0 dictionary without cloning its buffer.
    /// Digest checking precedes upstream's trusted binary parser.
    pub fn from_dictionary_bytes(bytes: Vec<u8>) -> Result<Self, EngineError> {
        if bytes.len() != DICTIONARY_BYTES {
            return Err(EngineError::DictionarySize {
                actual: bytes.len(),
            });
        }
        if Sha256::digest(&bytes).as_slice() != DICTIONARY_SHA256 {
            return Err(EngineError::DictionaryDigest);
        }
        Self::from_verified_dictionary_bytes(bytes)
    }

    // The SDK initialization path already checks the exact pinned size/digest
    // against the host's immutable, streaming-verified resource snapshot. Repeating
    // SHA-256 inside the interpreter made a debug native open take minutes.
    // Untrusted native callers still use from_dictionary_bytes above.
    fn from_verified_dictionary_bytes(bytes: Vec<u8>) -> Result<Self, EngineError> {
        let config =
            ConfigBuilder::from_bytes(include_bytes!("../vendor/resources/sudachi.json"))?.build();
        let dictionary = Rc::new(JapaneseDictionary::from_cfg_storage_with_embedded_chardef(
            &config,
            SudachiDicData::new(Storage::Owned(bytes)),
        )?);
        Ok(Self {
            tokenizer: StatefulTokenizer::new(Rc::clone(&dictionary), Mode::C),
            result: MorphemeList::empty(dictionary),
        })
    }

    pub fn analyze(&mut self, text: &str) -> Result<Vec<Token>, EngineError> {
        self.tokenizer.reset().push_str(text);
        self.tokenizer.do_tokenize()?;
        self.result.collect_results(&mut self.tokenizer)?;
        Ok(self
            .result
            .iter()
            .map(|m| Token {
                start: m.begin(),
                end: m.end(),
                surface: m.surface().to_string(),
                lemma: m.dictionary_form().to_owned(),
                normalized: m.normalized_form().to_owned(),
                reading: m.reading_form().to_owned(),
                pos: m.part_of_speech().to_vec(),
                oov: m.is_oov(),
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_wrong_dictionary_before_parsing() {
        // Given a buffer which is not the pinned dictionary.
        let bytes = vec![0; 8];
        // When constructing the engine.
        let result = JapaneseEngine::from_dictionary_bytes(bytes);
        // Then it is rejected before upstream binary parsing.
        assert!(matches!(
            result,
            Err(EngineError::DictionarySize { actual: 8 })
        ));
    }
}
