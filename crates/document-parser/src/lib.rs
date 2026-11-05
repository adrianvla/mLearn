//! Rust-owned bounded canonical source parsing. No learner, rendering or storage authority.
mod archive;
mod epub;
mod inline;
mod pdf;
mod structure;
mod types;
mod writing;
mod xml;
use epub::parse_epub;
pub use pdf::{ParsedPdfPage, PdfMetadata, PdfReader, PDF_GUEST};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    io::{Cursor, Read},
    path::Path,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
};
pub use types::*;
pub use writing::WritingMode;
pub const PARSER_REVISION: &str = "mlearn-document-1";

#[cfg(test)]
mod tests;

/// Cancellation identity supplied by the existing import job owner.
#[derive(Clone, Default)]
pub struct ParseControl {
    pub cancellation: Arc<AtomicU64>,
    pub epoch: u64,
}
impl ParseControl {
    fn check(&self) -> Result<(), Error> {
        if self.cancellation.load(Ordering::Acquire) == self.epoch {
            Ok(())
        } else {
            Err(Error::Cancelled)
        }
    }
}
impl Limits {
    fn validate(self) -> Result<(), Error> {
        let hard = Self::default();
        for (requested, maximum) in [
            (self.input_bytes, hard.input_bytes),
            (self.entries, hard.entries),
            (self.entry_bytes, hard.entry_bytes),
            (self.expanded_bytes, hard.expanded_bytes),
            (self.xml_depth, hard.xml_depth),
            (self.xml_events, hard.xml_events),
            (self.blocks, hard.blocks),
            (self.block_bytes, hard.block_bytes),
            (self.pdf_objects, hard.pdf_objects),
            (self.pdf_pages, hard.pdf_pages),
            (self.pdf_stream_bytes, hard.pdf_stream_bytes),
        ] {
            check(requested, maximum, "caller may only lower parser limits")?;
        }
        if self.expansion_ratio > hard.expansion_ratio {
            return Err(Error::Limit("expansion ratio ceiling"));
        }
        Ok(())
    }
}
fn invalid(message: impl Into<String>) -> Error {
    Error::Invalid(message.into())
}
fn check(value: usize, maximum: usize, label: &'static str) -> Result<(), Error> {
    if value > maximum {
        return Err(Error::Limit(label));
    }
    Ok(())
}
fn bounded_read(reader: impl Read, maximum: usize, label: &'static str) -> Result<Vec<u8>, Error> {
    let mut bytes = Vec::new();
    reader
        .take(
            u64::try_from(maximum)
                .map_err(|_| Error::Limit(label))?
                .saturating_add(1),
        )
        .read_to_end(&mut bytes)?;
    check(bytes.len(), maximum, label)?;
    Ok(bytes)
}
/// Read at most the input budget plus one byte, then parse.
///
/// # Errors
/// Rejects oversized files, malformed/unsupported documents and extraction limits.
pub fn parse_file(path: &Path, format: Format, limits: Limits) -> Result<Document, Error> {
    limits.validate()?;
    let bytes = bounded_read(
        std::fs::File::open(path)?,
        limits.input_bytes,
        "input bytes",
    )?;
    parse(&bytes, format, limits)
}
/// Parse admitted bytes into source-revision-bound canonical blocks.
///
/// # Errors
/// Rejects malformed structures, unsupported fidelity and resource-policy violations.
/// PDF library work executes only in the bounded internal Wasm guest.
pub fn parse(bytes: &[u8], format: Format, limits: Limits) -> Result<Document, Error> {
    parse_cancellable(bytes, format, limits, &ParseControl::default())
}

/// Parse with an existing job cancellation epoch; no source state is published on failure.
pub fn parse_cancellable(
    bytes: &[u8],
    format: Format,
    limits: Limits,
    control: &ParseControl,
) -> Result<Document, Error> {
    limits.validate()?;
    control.check()?;
    check(bytes.len(), limits.input_bytes, "input bytes")?;
    let mut document = Document {
        content_revision: format!("{:x}", Sha256::digest(bytes)),
        parser_revision: PARSER_REVISION,
        format,
        progression: None,
        spine: Vec::new(),
        navigation: Vec::new(),
        blocks: Vec::new(),
        pages: Vec::new(),
        fidelity: Vec::new(),
        images: Vec::new(),
    };
    match format {
        Format::Text => parse_text(bytes, limits, &mut document)?,
        Format::Epub => parse_epub(bytes, limits, &mut document)?,
        Format::Pdf => pdf::parse_pdf(bytes, limits, &mut document, control)?,
    }
    let total = document.blocks.iter().try_fold(0usize, |total, block| {
        check(
            block.text.len(),
            limits.block_bytes,
            "canonical block bytes",
        )?;
        total
            .checked_add(block.text.len())
            .ok_or(Error::Limit("canonical bytes"))
    })?;
    check(total, limits.expanded_bytes, "canonical bytes")?;
    let image_bytes = document.images.iter().try_fold(0usize, |total, image| {
        total
            .checked_add(image.bytes.len())
            .ok_or(Error::Limit("image resource bytes"))
    })?;
    check(image_bytes, limits.expanded_bytes, "image resource bytes")?;
    let mut identities = BTreeSet::new();
    for block in &document.blocks {
        if !identities.insert((&block.resource, &block.id)) {
            return Err(invalid("duplicate canonical block identity"));
        }
    }
    control.check()?;
    Ok(document)
}
fn block(
    resource: &str,
    id: String,
    kind: &str,
    text: String,
    original: Option<Span>,
    readings: Vec<Reading>,
) -> Block {
    Block {
        resource: resource.to_owned(),
        id,
        kind: kind.to_owned(),
        span: Span {
            start: ByteOffset(0),
            end: ByteOffset(text.len()),
        },
        text,
        original_container_bytes: original,
        readings,
        image: None,
        writing_mode: None,
    }
}
fn parse_text(bytes: &[u8], limits: Limits, document: &mut Document) -> Result<(), Error> {
    let text = std::str::from_utf8(bytes)?;
    let mut start = 0usize;
    for paragraph in text.split("\n\n") {
        check(
            document.blocks.len().saturating_add(1),
            limits.blocks,
            "blocks",
        )?;
        let content = paragraph.strip_suffix('\n').unwrap_or(paragraph);
        check(content.len(), limits.block_bytes, "canonical block bytes")?;
        document.blocks.push(block(
            "text",
            format!("byte:{start}"),
            "paragraph",
            content.to_owned(),
            Some(Span {
                start: ByteOffset(start),
                end: ByteOffset(start.saturating_add(content.len())),
            }),
            Vec::new(),
        ));
        start = start.saturating_add(paragraph.len()).saturating_add(2);
    }
    document.fidelity.push("UTF-8 only; LF blank-line paragraphs; source byte containers preserved; no Unicode normalization");
    Ok(())
}
