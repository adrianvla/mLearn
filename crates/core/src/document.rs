//! Revision-bound document projections. Display pages never identify source text.
use crate::{AnalyzedToken, KnowledgeProjection};
use serde::{Deserialize, Serialize};

macro_rules! model {
    ($name:ident { $($field:ident : $ty:ty),* $(,)? }) => {
        #[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
        #[serde(rename_all = "camelCase")]
        #[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
        pub struct $name { $(pub $field: $ty),* }
    };
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum DocumentFormat {
    Text,
    Epub,
    Pdf,
    Images,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum DocumentWritingMode {
    #[default]
    Auto,
    Horizontal,
    Vertical,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum DocumentFlow {
    HorizontalTb,
    VerticalRl,
    VerticalLr,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum DocumentFont {
    #[default]
    Source,
    Serif,
    Sans,
}

model!(DocumentAppearance {
    writing_mode: DocumentWritingMode,
    font: DocumentFont,
    font_size: u32,
    line_height: f64,
    letter_spacing: f64,
});
impl Default for DocumentAppearance {
    fn default() -> Self {
        Self {
            writing_mode: DocumentWritingMode::Auto,
            font: DocumentFont::Source,
            font_size: 24,
            line_height: 1.6,
            letter_spacing: 0.0,
        }
    }
}
impl DocumentAppearance {
    pub fn validate(&self) -> Result<(), String> {
        if !(12..=48).contains(&self.font_size)
            || !self.line_height.is_finite()
            || !(1.0..=2.5).contains(&self.line_height)
            || !self.letter_spacing.is_finite()
            || !(-1.0..=4.0).contains(&self.letter_spacing)
        {
            return Err("Reader appearance is outside the supported range".into());
        }
        Ok(())
    }
}

model!(DocumentPosition {
    parser_revision: String,
    resource: String,
    block_id: String,
    offset: u32,
});
model!(SourceReading {
    start: u32,
    end: u32,
    text: String,
});
model!(DocumentImage {
    resource_id: String,
    alt: String,
});
model!(DocumentBlock {
    resource: String,
    id: String,
    kind: String,
    text: String,
    readings: Vec<SourceReading>,
    image: Option<DocumentImage>,
    page: Option<u32>,
    writing_mode: Option<DocumentFlow>,
});
model!(DocumentRecord {
    id: String,
    title: String,
    document_path: String,
    content_revision: String,
    parser_revision: String,
    format: DocumentFormat,
    package_id: String,
    package_version: String,
    position: Option<DocumentPosition>,
    appearance: DocumentAppearance,
    progression: Option<String>,
    total_blocks: u32,
    total_pages: u32,
    fidelity: Vec<String>,
});
model!(DocumentNavigation {
    label: String,
    position: DocumentPosition,
});
model!(DocumentWindow {
    source: DocumentRecord,
    blocks: Vec<DocumentBlock>,
    previous: Option<DocumentPosition>,
    next: Option<DocumentPosition>,
});
model!(DocumentContentsPage {
    source_id: String,
    parser_revision: String,
    items: Vec<DocumentNavigation>,
    next_offset: Option<u32>,
});
/// Search does not recognize images or replace a package's source interpretation.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum DocumentSearchScope {
    Text,
    RecognizedPages,
}
model!(DocumentSearchCursor {
    identity: String,
    index: u32,
    region: u32,
    offset: u32,
    unavailable: u32,
});
model!(DocumentSearchQuery {
    source_id: String,
    content_revision: String,
    parser_revision: String,
    scope: DocumentSearchScope,
    text: String,
    after: Option<DocumentSearchCursor>,
});
model!(DocumentSearchHit {
    position: DocumentPosition,
    anchor: crate::SourceAnchor,
});
// A bounded scan quantum, not an assertion that a partial index is complete.
model!(DocumentSearchPage {
    source_id: String,
    content_revision: String,
    parser_revision: String,
    scope: DocumentSearchScope,
    text: String,
    hits: Vec<DocumentSearchHit>,
    next: Option<DocumentSearchCursor>,
    scanned: u32,
    total: u32,
    unavailable: u32,
});
model!(DocumentCheckpoint {
    source_id: String,
    content_revision: String,
    position: DocumentPosition,
    appearance: DocumentAppearance,
});
model!(DocumentResourceLocation {
    source_id: String,
    resource_id: String,
    path: String,
    mime_type: String,
    byte_length: u32,
});
model!(DocumentAnalyzedBlock {
    resource: String,
    block_id: String,
    start: u32,
    text: String,
    tokens: Vec<AnalyzedToken>,
});
model!(DocumentOccurrenceKnowledge {
    resource: String,
    block_id: String,
    token_start: u32,
    status: String,
});
model!(DocumentAnalysisBatch {
    source_id: String,
    content_revision: String,
    parser_revision: String,
    package_id: String,
    package_version: String,
    package_revision: String,
    blocks: Vec<DocumentAnalyzedBlock>,
    knowledge: Vec<KnowledgeProjection>,
    annotations: Vec<DocumentOccurrenceKnowledge>,
});
