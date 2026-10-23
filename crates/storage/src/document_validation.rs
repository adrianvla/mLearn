use crate::StorageError;
use mlearn_core::{
    DocumentBlock, DocumentFormat, DocumentNavigation, DocumentPosition, DocumentRecord,
    DocumentResourceLocation,
};
use std::collections::{HashMap, HashSet};

pub(crate) const WINDOW_BYTES: usize = 64 * 1024;
// Leave room for the source record and locators in the existing 512 KiB IPC limit.
pub(crate) const ROW_BYTES: usize = 384 * 1024;
pub(crate) const LIST_BYTES: usize = 256 * 1024;
pub(crate) const RECORD_BYTES: usize = 64 * 1024;

pub(crate) fn invalid(message: &str) -> StorageError {
    StorageError::Invalid(message.into())
}

pub(crate) fn bounded(value: &str, max: usize) -> Result<(), StorageError> {
    if value.is_empty() || value.len() > max || value.contains('\0') {
        return Err(invalid("Invalid document field length or identity"));
    }
    Ok(())
}

pub(crate) fn position_keys(position: &DocumentPosition) -> Result<(), StorageError> {
    bounded(&position.parser_revision, 512)?;
    bounded(&position.resource, 512)?;
    bounded(&position.block_id, 512)
}

pub(crate) fn position(
    record: &DocumentRecord,
    position: &DocumentPosition,
    block: &DocumentBlock,
) -> Result<(), StorageError> {
    position_keys(position)?;
    if position.parser_revision != record.parser_revision
        || position.resource != block.resource
        || position.block_id != block.id
        || !block.text.is_char_boundary(byte_offset(position.offset)?)
    {
        return Err(invalid(
            "Document position is missing, stale or splits a UTF-8 scalar",
        ));
    }
    Ok(())
}

pub(crate) fn payload(block: &DocumentBlock) -> usize {
    block.text.len() + block.readings.iter().map(|r| r.text.len()).sum::<usize>()
}

fn byte_offset(value: u32) -> Result<usize, StorageError> {
    usize::try_from(value).map_err(|_| invalid("Document byte offset exceeds native range"))
}

pub(crate) fn projection(
    record: &DocumentRecord,
    blocks: &[DocumentBlock],
    contents: &[DocumentNavigation],
    resources: &[DocumentResourceLocation],
) -> Result<(), StorageError> {
    bounded(&record.id, 512)?;
    bounded(&record.title, 4096)?;
    bounded(&record.document_path, 4096)?;
    bounded(&record.content_revision, 512)?;
    bounded(&record.parser_revision, 512)?;
    bounded(&record.package_id, 512)?;
    bounded(&record.package_version, 512)?;
    record
        .appearance
        .validate()
        .map_err(StorageError::Invalid)?;
    if let Some(progression) = &record.progression {
        bounded(progression, 512)?;
    }
    if record.fidelity.len() > 64 {
        return Err(invalid("Too many document fidelity entries"));
    }
    for entry in &record.fidelity {
        bounded(entry, 512)?;
    }
    if blocks.len() > 1024
        || blocks.len() != byte_offset(record.total_blocks)?
        || contents.len() > 1024
        || resources.len() > 128
        || record.total_pages > 1024
    {
        return Err(invalid(
            "Document projection exceeds admission bounds or totals",
        ));
    }
    match record.format {
        DocumentFormat::Text | DocumentFormat::Epub if record.total_pages != 0 => {
            return Err(invalid("Reflowable document cannot have source pages"));
        }
        DocumentFormat::Pdf | DocumentFormat::Images if record.total_pages == 0 => {
            return Err(invalid("PDF source page count is missing"));
        }
        DocumentFormat::Text
        | DocumentFormat::Epub
        | DocumentFormat::Pdf
        | DocumentFormat::Images => {}
    }
    let mut resource_ids = HashSet::new();
    for resource in resources {
        bounded(&resource.resource_id, 512)?;
        bounded(&resource.path, 4096)?;
        bounded(&resource.mime_type, 128)?;
        if resource.source_id != record.id || !resource_ids.insert(resource.resource_id.as_str()) {
            return Err(invalid(
                "Document resource identity is duplicate or belongs to another source",
            ));
        }
        // Several stable resources may reference the same original PDF file.
        // These are locations, not newly allocated copies of its binary payload.
        if resource.byte_length > 8 * 1024 * 1024 {
            return Err(invalid("Document resource exceeds input bound"));
        }
    }
    let mut identities = HashMap::new();
    let mut aggregate = 0;
    let mut previous_page = None;
    for block in blocks {
        bounded(&block.resource, 512)?;
        bounded(&block.id, 512)?;
        bounded(&block.kind, 128)?;
        if !resource_ids.contains(block.resource.as_str())
            || identities
                .insert((block.resource.as_str(), block.id.as_str()), block)
                .is_some()
        {
            return Err(invalid(
                "Document block has unknown resource or duplicate stable identity",
            ));
        }
        if block.readings.len() > 4096 {
            return Err(invalid("Too many authored readings in document block"));
        }
        let bytes = payload(block);
        if bytes > WINDOW_BYTES {
            return Err(invalid("Document block text and readings exceed 64 KiB"));
        }
        if serde_json::to_vec(block)?.len() > ROW_BYTES {
            return Err(invalid("Document block exceeds native transport bounds"));
        }
        aggregate += bytes;
        for reading in &block.readings {
            if reading.start >= reading.end
                || !block.text.is_char_boundary(byte_offset(reading.start)?)
                || !block.text.is_char_boundary(byte_offset(reading.end)?)
            {
                return Err(invalid(
                    "Authored reading splits or exceeds source UTF-8 span",
                ));
            }
        }
        match record.format {
            DocumentFormat::Pdf | DocumentFormat::Images => {
                let page = block
                    .page
                    .ok_or_else(|| invalid("PDF block lacks source page"))?;
                // Source page indexes are zero-based, independent of UI pagination.
                if page >= record.total_pages
                    || previous_page.is_some_and(|previous| page < previous)
                {
                    return Err(invalid("PDF block page disagrees with source metadata"));
                }
                previous_page = Some(page);
            }
            DocumentFormat::Text | DocumentFormat::Epub => {
                if block.page.is_some() {
                    return Err(invalid("Reflowable block cannot have a source page"));
                }
            }
        }
        if let Some(image) = &block.image {
            bounded(&image.resource_id, 512)?;
            if image.alt.len() > 4096 || !resource_ids.contains(image.resource_id.as_str()) {
                return Err(invalid(
                    "Document image has unknown resource or oversized alt text",
                ));
            }
        }
    }
    if aggregate > 2 * 1024 * 1024 {
        return Err(invalid("Document text and readings exceed aggregate bound"));
    }
    let validate_position = |value: &DocumentPosition| {
        position_keys(value)?;
        let block = identities
            .get(&(value.resource.as_str(), value.block_id.as_str()))
            .ok_or_else(|| invalid("Document position does not identify an original block"))?;
        position(record, value, block)
    };
    if let Some(value) = &record.position {
        validate_position(value)?;
    }
    for entry in contents {
        bounded(&entry.label, 4096)?;
        validate_position(&entry.position)?;
    }
    Ok(())
}

/// Check SQLite's borrowed bytes before allocating the bounded canonical row.
pub(crate) fn json(row: &rusqlite::Row<'_>, column: usize, max: usize) -> rusqlite::Result<String> {
    if row.get_ref(column)?.as_str()?.len() > max {
        return Err(rusqlite::Error::InvalidQuery);
    }
    row.get(column)
}
