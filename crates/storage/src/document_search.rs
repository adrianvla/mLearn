use crate::{
    ProfileStore, StorageError,
    document_read::{decode_block, required_record},
    document_validation::{ROW_BYTES, bounded, invalid, json},
};
use mlearn_core::*;
use rusqlite::params;
use sha2::{Digest, Sha256};

const HIT_LIMIT: usize = 16;
const HIT_BYTES: usize = 128 * 1024;
const SCAN_RECORDS: usize = 64;
const SCAN_BYTES: usize = 1024 * 1024;

fn coordinate(value: usize) -> Result<u32, StorageError> {
    u32::try_from(value).map_err(|_| invalid("Search coordinate exceeds the source range"))
}

/// Byte offsets always refer to untouched source text, including around Unicode.
fn matches(
    original: &SourceAnchor,
    position: &DocumentPosition,
    query: &str,
    offset: u32,
    hits: &mut Vec<DocumentSearchHit>,
    bytes: &mut usize,
) -> Result<Option<u32>, StorageError> {
    let mut offset =
        usize::try_from(offset).map_err(|_| invalid("Search offset exceeds the native range"))?;
    loop {
        let remaining = original
            .text
            .get(offset..)
            .ok_or_else(|| invalid("Search cursor splits source text"))?;
        let Some(found) = remaining.find(query) else {
            return Ok(None);
        };
        let start = offset + found;
        let end = start + query.len();
        if hits.len() == HIT_LIMIT {
            return Ok(Some(coordinate(start)?));
        }
        let mut context = start.saturating_sub(256);
        while !original.text.is_char_boundary(context) {
            context += 1;
        }
        let mut context_end = end.saturating_add(256).min(original.text.len());
        while !original.text.is_char_boundary(context_end) {
            context_end -= 1;
        }
        let mut locator = original.locator.clone();
        let mut point = position.clone();
        match &mut locator {
            SourceLocator::Document {
                context_start,
                selection_start,
                selection_end,
                ..
            } => {
                *context_start = coordinate(context)?;
                *selection_start = coordinate(start - context)?;
                *selection_end = coordinate(end - context)?;
                point.offset = coordinate(start)?;
            }
            SourceLocator::Image {
                context_start,
                selection_start,
                selection_end,
                ..
            } => {
                *context_start = coordinate(context)?;
                *selection_start = coordinate(start - context)?;
                *selection_end = coordinate(end - context)?;
            }
            SourceLocator::Message { .. } | SourceLocator::Video { .. } => {
                return Err(invalid(
                    "Document search requires a document or image anchor",
                ));
            }
        }
        let hit = DocumentSearchHit {
            position: point,
            anchor: SourceAnchor {
                source_id: original.source_id.clone(),
                content_revision: original.content_revision.clone(),
                package_id: original.package_id.clone(),
                package_version: original.package_version.clone(),
                text: original.text[context..context_end].into(),
                locator,
            },
        };
        let size = serde_json::to_vec(&hit)?.len();
        if *bytes + size > HIT_BYTES {
            if hits.is_empty() {
                return Err(invalid("A search hit exceeds the native response bound"));
            }
            return Ok(Some(coordinate(start)?));
        }
        *bytes += size;
        hits.push(hit);
        offset = end;
    }
}

impl ProfileStore {
    /// No search index or whole-source copy: scan bounded authoritative rows.
    /// Dropping the continuation stops work; each call holds one read snapshot.
    pub fn search_document(
        &self,
        query: &DocumentSearchQuery,
    ) -> Result<DocumentSearchPage, StorageError> {
        bounded(&query.source_id, 512)?;
        bounded(&query.content_revision, 512)?;
        bounded(&query.parser_revision, 512)?;
        bounded(&query.text, 1024)?;
        let tx = self.connection.unchecked_transaction()?;
        let source = required_record(&tx, &query.source_id)?;
        if source.content_revision != query.content_revision
            || source.parser_revision != query.parser_revision
        {
            return Err(invalid(
                "Document search source changed; restart the search",
            ));
        }
        let total = match query.scope {
            DocumentSearchScope::Text => source.total_blocks,
            DocumentSearchScope::RecognizedPages => {
                if !matches!(source.format, DocumentFormat::Images | DocumentFormat::Pdf) {
                    return Err(invalid("This source has no original image pages to search"));
                }
                source.total_pages
            }
        };
        let recognition: i64 = if query.scope == DocumentSearchScope::RecognizedPages {
            tx.query_row(
                "SELECT COALESCE(MAX(rowid),0) FROM ocr_pages WHERE source_id=?1",
                [&source.id],
                |row| row.get(0),
            )?
        } else {
            0
        };
        let identity = format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&(
                &source.id,
                &source.content_revision,
                &source.parser_revision,
                &source.package_id,
                &source.package_version,
                query.scope,
                &query.text,
                recognition,
            ))?)
        );
        let mut cursor = query.after.clone().unwrap_or_else(|| DocumentSearchCursor {
            identity: identity.clone(),
            index: 0,
            region: 0,
            offset: 0,
            unavailable: 0,
        });
        if cursor.identity != identity
            || cursor.index > total
            || cursor.unavailable > cursor.index
            || cursor.index == total && (cursor.region != 0 || cursor.offset != 0)
            || query.scope == DocumentSearchScope::Text && cursor.region != 0
        {
            return Err(invalid(
                "Document search cursor changed; restart the search",
            ));
        }
        let mut hits = Vec::new();
        let mut bytes = 0;
        let mut work = 0;
        for _ in 0..SCAN_RECORDS {
            if cursor.index >= total || work >= SCAN_BYTES || hits.len() == HIT_LIMIT {
                break;
            }
            match query.scope {
                DocumentSearchScope::Text => {
                    let encoded = tx.query_row(
                        "SELECT block FROM document_blocks WHERE source_id=?1 AND ordinal=?2",
                        params![source.id, cursor.index],
                        |row| json(row, 0, ROW_BYTES),
                    )?;
                    work += encoded.len();
                    let block = decode_block(&encoded)?;
                    let position = DocumentPosition {
                        parser_revision: source.parser_revision.clone(),
                        resource: block.resource.clone(),
                        block_id: block.id.clone(),
                        offset: 0,
                    };
                    let original = SourceAnchor {
                        source_id: source.id.clone(),
                        content_revision: source.content_revision.clone(),
                        package_id: source.package_id.clone(),
                        package_version: source.package_version.clone(),
                        text: block.text,
                        locator: SourceLocator::Document {
                            parser_revision: source.parser_revision.clone(),
                            resource: block.resource,
                            block_id: block.id,
                            context_start: 0,
                            selection_start: 0,
                            selection_end: 0,
                        },
                    };
                    if original.text.is_empty() && block.image.is_some() {
                        cursor.unavailable += 1;
                    }
                    if let Some(offset) = matches(
                        &original,
                        &position,
                        &query.text,
                        cursor.offset,
                        &mut hits,
                        &mut bytes,
                    )? {
                        cursor.offset = offset;
                        break;
                    }
                }
                DocumentSearchScope::RecognizedPages => {
                    let descriptor = self.image_page(&source.id, cursor.index)?;
                    let page = self.ocr_page(&source.id, &descriptor.resource_id, None)?;
                    let page = page.filter(|page| {
                        page.content_revision == source.content_revision
                            && page.provider.availability == OcrAvailability::Ready
                    });
                    if let Some(page) = page {
                        work += serde_json::to_vec(&page)?.len();
                        let region_start = usize::try_from(cursor.region)
                            .map_err(|_| invalid("Search region exceeds the native range"))?;
                        if region_start > page.regions.len() {
                            return Err(invalid("Search region no longer exists"));
                        }
                        for (index, region) in page.regions.iter().enumerate().skip(region_start) {
                            let original = SourceAnchor {
                                source_id: source.id.clone(),
                                content_revision: source.content_revision.clone(),
                                package_id: source.package_id.clone(),
                                package_version: source.package_version.clone(),
                                text: region.text.clone(),
                                locator: SourceLocator::Image {
                                    resource_id: descriptor.resource_id.clone(),
                                    page_index: Some(descriptor.page_index),
                                    ocr_revision: page.ocr_revision,
                                    region_id: region.id.clone(),
                                    context_start: 0,
                                    selection_start: 0,
                                    selection_end: 0,
                                },
                            };
                            if let Some(offset) = matches(
                                &original,
                                &descriptor.position,
                                &query.text,
                                cursor.offset,
                                &mut hits,
                                &mut bytes,
                            )? {
                                cursor.region = coordinate(index)?;
                                cursor.offset = offset;
                                break;
                            }
                            cursor.region = coordinate(index + 1)?;
                            cursor.offset = 0;
                        }
                        if usize::try_from(cursor.region)
                            .map_err(|_| invalid("Search region exceeds the native range"))?
                            < page.regions.len()
                        {
                            break;
                        }
                    } else {
                        if cursor.region != 0 || cursor.offset != 0 {
                            return Err(invalid("The searched recognition page is unavailable"));
                        }
                        cursor.unavailable += 1;
                    }
                }
            }
            cursor.index += 1;
            cursor.region = 0;
            cursor.offset = 0;
        }
        let scanned = cursor.index;
        let unavailable = cursor.unavailable;
        let next = (cursor.index < total).then_some(cursor);
        tx.commit()?;
        Ok(DocumentSearchPage {
            source_id: source.id,
            content_revision: source.content_revision,
            parser_revision: source.parser_revision,
            scope: query.scope,
            text: query.text.clone(),
            hits,
            next,
            scanned,
            total,
            unavailable,
        })
    }
}
