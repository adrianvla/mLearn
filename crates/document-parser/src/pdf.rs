use super::*;
use mlearn_document_pdf_guest::wire::{self, Operation, Reply, Request};
use mlearn_language_host::{AssetMap, CompiledPlugin};

/// Host-owned code, never supplied by imported content or a language catalog.
pub const PDF_GUEST: &[u8] = include_bytes!("../artifacts/document_pdf_guest.wasm");

#[derive(Debug, serde::Serialize)]
pub struct PdfMetadata {
    pub content_revision: String,
    pub parser_revision: &'static str,
    pub page_count: usize,
}
#[derive(Debug, serde::Serialize)]
pub struct ParsedPdfPage {
    pub page: Page,
    pub block: Block,
}

/// One import owns immutable bytes and at most 65 bounded execution attempts.
/// Dropping this owner releases its assets and the existing global executor slot.
pub struct PdfReader {
    executor: CompiledPlugin,
    metadata: PdfMetadata,
    limits: Limits,
    control: ParseControl,
    attempts: usize,
    decoded_total: usize,
    text_total: usize,
}
impl PdfReader {
    /// Compile trusted code and extract only bounded original-page metadata.
    ///
    /// # Errors
    /// Rejects oversized, malformed, encrypted, cancelled or over-budget PDFs.
    pub fn open(bytes: &[u8], limits: Limits, control: ParseControl) -> Result<Self, Error> {
        limits.validate()?;
        control.check()?;
        check(bytes.len(), limits.input_bytes, "input bytes")?;
        if !bytes.starts_with(b"%PDF-") {
            return Err(invalid("PDF signature"));
        }
        let assets = AssetMap::from([(wire::ASSET.into(), Arc::from(bytes))]);
        // Mechanical reuse, not a language analyzer: same validated engine,
        // global admission owner, Fresh memory/fuel limits and cancellation.
        let executor = CompiledPlugin::new(PDF_GUEST, assets).map_err(Error::Sandbox)?;
        let mut reader = Self {
            executor,
            limits,
            control,
            attempts: 0,
            decoded_total: 0,
            text_total: 0,
            metadata: PdfMetadata {
                content_revision: format!("{:x}", Sha256::digest(bytes)),
                parser_revision: PARSER_REVISION,
                page_count: 0,
            },
        };
        reader.metadata.page_count = match reader.invoke(Operation::Metadata)? {
            Reply::Metadata { page_count } => page_count,
            Reply::Page(_) => return Err(invalid("PDF metadata response")),
        };
        check(reader.metadata.page_count, limits.pdf_pages, "PDF pages")?;
        check(reader.metadata.page_count, limits.blocks, "blocks")?;
        Ok(reader)
    }
    pub fn metadata(&self) -> &PdfMetadata {
        &self.metadata
    }
    fn invoke(&mut self, operation: Operation) -> Result<Reply, Error> {
        self.control.check()?;
        self.attempts = self.attempts.saturating_add(1);
        check(
            self.attempts,
            self.limits.pdf_pages.saturating_add(1),
            "PDF execution attempts",
        )?;
        let request = Request {
            operation,
            pages: self.limits.pdf_pages.min(wire::MAX_PAGES),
            objects: self.limits.pdf_objects,
            stream_bytes: self.limits.pdf_stream_bytes,
            text_bytes: self.limits.block_bytes.min(wire::MAX_TEXT_BYTES),
        };
        let input = serde_json::to_value(request).map_err(|e| invalid(e.to_string()))?;
        let result = self.executor.invoke_cancellable(
            wire::CAPABILITY,
            input,
            self.control.cancellation.clone(),
            self.control.epoch,
        );
        self.control.check()?;
        serde_json::from_value(result.map_err(Error::Sandbox)?).map_err(|e| invalid(e.to_string()))
    }
    /// Read one original zero-based page. Failed/repeated attempts consume budget.
    ///
    /// # Errors
    /// Rejects invalid pages, stale jobs, traps and aggregate work/output overflow.
    pub fn read_page(&mut self, index: usize) -> Result<ParsedPdfPage, Error> {
        if index >= self.metadata.page_count {
            return Err(invalid("PDF page missing"));
        }
        let extracted = match self.invoke(Operation::Page { index })? {
            Reply::Page(page) => page,
            Reply::Metadata { .. } => return Err(invalid("PDF page response")),
        };
        if extracted.index != index {
            return Err(invalid("PDF original page identity"));
        }
        check(
            extracted.text.len(),
            self.limits.block_bytes.min(wire::MAX_TEXT_BYTES),
            "PDF page text",
        )?;
        check(
            extracted.decoded_bytes,
            self.limits.pdf_stream_bytes,
            "PDF page content",
        )?;
        self.decoded_total = self.decoded_total.saturating_add(extracted.decoded_bytes);
        self.text_total = self.text_total.saturating_add(extracted.text.len());
        check(
            self.decoded_total,
            self.limits.expanded_bytes,
            "PDF total page content",
        )?;
        check(
            self.text_total,
            self.limits.expanded_bytes,
            "canonical bytes",
        )?;
        let resource = format!("page:{index}");
        Ok(ParsedPdfPage {
            page: Page {
                index: u32::try_from(index).map_err(|_| Error::Limit("PDF page number"))?,
                object_id: extracted.object_id,
                resource: resource.clone(),
                media_box: extracted.media_box.map(Vec::from),
                crop_box: extracted.crop_box.map(Vec::from),
                rotation: extracted.rotation,
                text_available: !extracted.text.trim().is_empty(),
            },
            block: block(
                &resource,
                format!("pdf-page:{index}"),
                "pdf_extracted_text",
                extracted.text,
                None,
                Vec::new(),
            ),
        })
    }
}

pub(super) fn parse_pdf(
    bytes: &[u8],
    limits: Limits,
    document: &mut Document,
    control: &ParseControl,
) -> Result<(), Error> {
    let mut reader = PdfReader::open(bytes, limits, control.clone())?;
    for index in 0..reader.metadata().page_count {
        let page = reader.read_page(index)?;
        document.pages.push(page.page);
        document.blocks.push(page.block);
    }
    document.fidelity.push("PDF text in content-operation order; visual reading order, images, glyph geometry, selection and rendering unavailable; empty pages are explicitly text-unavailable");
    document.fidelity.push("PDF eager loading and font expansion isolated in Fresh 64 MiB / 32M-fuel calls; 65 attempts maximum; 32 KiB page text; 256 KiB ABI envelope");
    Ok(())
}
