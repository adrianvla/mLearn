use crate::{WritingMode, invalid};
use serde::{Deserialize, Serialize};
use std::io;
/// Hard native admission ceilings. Callers may lower, never raise these limits.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Limits {
    pub input_bytes: usize,
    pub entries: usize,
    pub entry_bytes: usize,
    pub expanded_bytes: usize,
    pub expansion_ratio: u64,
    pub xml_depth: usize,
    pub xml_events: usize,
    pub blocks: usize,
    pub block_bytes: usize,
    pub pdf_objects: usize,
    pub pdf_pages: usize,
    pub pdf_stream_bytes: usize,
}
impl Default for Limits {
    fn default() -> Self {
        Self {
            input_bytes: 8 * 1024 * 1024,
            entries: 128,
            entry_bytes: 512 * 1024,
            expanded_bytes: 2 * 1024 * 1024,
            expansion_ratio: 100,
            xml_depth: 32,
            xml_events: 20_000,
            blocks: 1024,
            block_bytes: 64 * 1024,
            pdf_objects: 8192,
            pdf_pages: 64,
            pdf_stream_bytes: 512 * 1024,
        }
    }
}
/// Format selected by the source import boundary.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Format {
    Text,
    Epub,
    Pdf,
}
/// Parser rejection preserves its cause and distinguishes a policy limit.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("limit exceeded: {0}")]
    Limit(&'static str),
    #[error("invalid document: {0}")]
    Invalid(String),
    #[error("unsupported document fidelity: {0}")]
    Unsupported(&'static str),
    #[error(transparent)]
    Io(#[from] io::Error),
    #[error(transparent)]
    Zip(#[from] zip::result::ZipError),
    #[error(transparent)]
    Xml(#[from] quick_xml::Error),
    #[error("PDF sandbox failed: {0}")]
    Sandbox(String),
    #[error("document parsing cancelled")]
    Cancelled,
    #[error(transparent)]
    Utf8(#[from] std::str::Utf8Error),
}
/// Half-open byte offsets into the exact canonical block, never UTF-16.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ByteOffset(pub usize);
/// Canonical source span. Text before/after it is not normalized.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Span {
    pub start: ByteOffset,
    pub end: ByteOffset,
}
/// Source-authored annotation; dictionary readings are not input to this parser.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Reading {
    pub start: ByteOffset,
    pub end: ByteOffset,
    pub text: String,
}
/// Stable within content revision; XML byte containers are not glyph coordinates.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Block {
    pub resource: String,
    pub id: String,
    pub kind: String,
    pub text: String,
    pub span: Span,
    pub original_container_bytes: Option<Span>,
    pub readings: Vec<Reading>,
    pub image: Option<String>,
    pub writing_mode: Option<WritingMode>,
}
/// Persistable location for the probe; not a shipped SourceLocator variant.
#[derive(Debug, Serialize, Deserialize)]
pub struct Anchor {
    pub content_revision: String,
    pub parser_revision: String,
    pub resource: String,
    pub block_id: String,
    pub span: Span,
}
/// Resolve a revision-bound selection without matching another identical quote.
///
/// # Errors
/// Rejects changed source/parser revisions, missing nodes and invalid UTF-8 spans.
pub fn resolve_anchor<'a>(document: &'a Document, anchor: &Anchor) -> Result<&'a str, Error> {
    if document.content_revision != anchor.content_revision
        || document.parser_revision != anchor.parser_revision
    {
        return Err(invalid("anchor revision changed"));
    }
    let block = document
        .blocks
        .iter()
        .find(|block| block.resource == anchor.resource && block.id == anchor.block_id)
        .ok_or_else(|| invalid("anchor source block missing"))?;
    block
        .text
        .get(anchor.span.start.0..anchor.span.end.0)
        .ok_or_else(|| invalid("anchor selection is not a valid UTF-8 span"))
}
/// Original spine item identity and its authored source attributes.
#[derive(Debug, Serialize)]
pub struct SpineItem {
    pub resource: String,
    pub manifest_id: String,
    pub properties: String,
    pub writing_mode: Option<WritingMode>,
}
/// Navigation target is a resource and optional authored fragment, not a page index.
#[derive(Debug, Serialize)]
pub struct Navigation {
    pub label: String,
    pub resource: String,
    pub fragment: Option<String>,
    pub block_id: String,
    pub offset: ByteOffset,
}
/// PDF source metadata without fabricated text rectangles.
#[derive(Debug, Serialize)]
pub struct Page {
    pub index: u32,
    pub object_id: (u32, u16),
    pub resource: String,
    pub media_box: Option<Vec<f32>>,
    pub crop_box: Option<Vec<f32>>,
    pub rotation: Option<i64>,
    pub text_available: bool,
}
/// Bounded projection. Caller owns persistence and viewport/window queries.
#[derive(Debug, Serialize)]
pub struct Document {
    pub content_revision: String,
    pub parser_revision: &'static str,
    pub format: Format,
    pub progression: Option<String>,
    pub spine: Vec<SpineItem>,
    pub navigation: Vec<Navigation>,
    pub blocks: Vec<Block>,
    pub pages: Vec<Page>,
    pub fidelity: Vec<&'static str>,
    pub images: Vec<ImageResource>,
}

/// Original immutable image bytes. Runtime persists these; React receives handles.
#[derive(Debug, Serialize)]
pub struct ImageResource {
    pub resource: String,
    pub media_type: String,
    pub bytes: Vec<u8>,
}
