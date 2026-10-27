use crate::{
    ProfileStore, StorageError,
    document_validation::{
        LIST_BYTES, RECORD_BYTES, ROW_BYTES, WINDOW_BYTES, bounded, invalid, json, payload,
        position, position_keys,
    },
};
use mlearn_core::{
    DocumentBlock, DocumentContentsPage, DocumentPosition, DocumentRecord,
    DocumentResourceLocation, DocumentWindow,
};
use rusqlite::{Connection, OptionalExtension, params};

pub(crate) fn read_record(
    db: &Connection,
    id: &str,
) -> Result<Option<DocumentRecord>, StorageError> {
    let encoded = db
        .query_row("SELECT record FROM documents WHERE id=?1", [id], |row| {
            json(row, 0, RECORD_BYTES)
        })
        .optional()?;
    encoded
        .map(|value| Ok(serde_json::from_str(&value)?))
        .transpose()
}

pub(crate) fn read_resource(
    db: &Connection,
    id: &str,
    resource_id: &str,
) -> Result<Option<DocumentResourceLocation>, StorageError> {
    bounded(id, 512)?;
    bounded(resource_id, 512)?;
    let encoded = db
        .query_row(
            "SELECT location FROM document_resources WHERE source_id=?1 AND resource_id=?2",
            params![id, resource_id],
            |row| json(row, 0, RECORD_BYTES),
        )
        .optional()?;
    encoded
        .map(|value| Ok(serde_json::from_str(&value)?))
        .transpose()
}

fn decode_block(value: &str) -> Result<DocumentBlock, StorageError> {
    let block: DocumentBlock = serde_json::from_str(value)?;
    if block.readings.len() > 4096 || payload(&block) > WINDOW_BYTES {
        return Err(invalid("Stored document block exceeds payload bound"));
    }
    Ok(block)
}

pub(crate) fn required_record(db: &Connection, id: &str) -> Result<DocumentRecord, StorageError> {
    read_record(db, id)?.ok_or_else(|| invalid("Document is missing"))
}

pub(crate) fn read_block(
    db: &Connection,
    id: &str,
    resource: &str,
    block_id: &str,
) -> Result<Option<DocumentBlock>, StorageError> {
    let encoded = db
        .query_row(
            "SELECT block FROM document_blocks WHERE source_id=?1 AND resource=?2 AND block_id=?3",
            params![id, resource, block_id],
            |row| json(row, 0, ROW_BYTES),
        )
        .optional()?;
    encoded.map(|value| decode_block(&value)).transpose()
}

impl ProfileStore {
    pub fn document(&self, id: &str) -> Result<Option<DocumentRecord>, StorageError> {
        bounded(id, 512)?;
        read_record(&self.connection, id)
    }

    pub fn recent_documents(&self) -> Result<Vec<DocumentRecord>, StorageError> {
        let mut statement = self
            .connection
            .prepare("SELECT record FROM documents ORDER BY touched DESC,id LIMIT 16")?;
        let mut rows = statement.query([])?;
        let mut sources = Vec::new();
        let mut bytes = 0;
        while let Some(row) = rows.next()? {
            let encoded = json(row, 0, RECORD_BYTES)?;
            if bytes + encoded.len() > LIST_BYTES {
                break;
            }
            bytes += encoded.len();
            sources.push(serde_json::from_str(&encoded)?);
        }
        Ok(sources)
    }

    pub fn document_block(
        &self,
        id: &str,
        resource: &str,
        block_id: &str,
    ) -> Result<Option<DocumentBlock>, StorageError> {
        bounded(id, 512)?;
        bounded(resource, 512)?;
        bounded(block_id, 512)?;
        read_block(&self.connection, id, resource, block_id)
    }

    pub fn document_window(
        &self,
        id: &str,
        requested: Option<&DocumentPosition>,
    ) -> Result<DocumentWindow, StorageError> {
        bounded(id, 512)?;
        if let Some(value) = requested {
            position_keys(value)?;
        }
        // Keep record, anchor and neighbor reads on one SQLite snapshot.
        let tx = self.connection.unchecked_transaction()?;
        let source = required_record(&tx, id)?;
        let anchor = requested.or(source.position.as_ref());
        let start: u32 = if let Some(anchor) = anchor {
            let block = read_block(&tx, id, &anchor.resource, &anchor.block_id)?
                .ok_or_else(|| invalid("Document window anchor is missing"))?;
            position(&source, anchor, &block)?;
            tx.query_row(
                "SELECT ordinal FROM document_blocks WHERE source_id=?1 AND resource=?2 AND block_id=?3",
                params![id, anchor.resource, anchor.block_id], |row| row.get(0),
            )?
        } else {
            0
        };
        let mut statement = tx.prepare(
            "SELECT ordinal,payload_bytes,block,length(CAST(block AS BLOB)) FROM document_blocks
             WHERE source_id=?1 AND ordinal>=?2 ORDER BY ordinal LIMIT 8",
        )?;
        let mut rows = statement.query(params![id, start])?;
        let mut blocks = Vec::new();
        let mut bytes = 0;
        let mut encoded_bytes = 0;
        let mut next_ordinal = start;
        while let Some(row) = rows.next()? {
            let size: usize = row.get(1)?;
            let encoded_size: usize = row.get(3)?;
            if size > WINDOW_BYTES || encoded_size > ROW_BYTES {
                return Err(invalid("Stored document block exceeds window bound"));
            }
            if bytes + size > WINDOW_BYTES || encoded_bytes + encoded_size > ROW_BYTES {
                break;
            }
            let block = decode_block(&json(row, 2, ROW_BYTES)?)?;
            if payload(&block) != size {
                return Err(invalid("Stored document block payload length disagrees"));
            }
            blocks.push(block);
            bytes += size;
            encoded_bytes += encoded_size;
            next_ordinal = row.get::<_, u32>(0)? + 1;
        }
        drop(rows);
        drop(statement);
        let previous = start
            .checked_sub(1)
            .map(|ordinal| locator(&tx, &source, ordinal))
            .transpose()?
            .flatten();
        let next = locator(&tx, &source, next_ordinal)?;
        tx.commit()?;
        Ok(DocumentWindow {
            source,
            blocks,
            previous,
            next,
        })
    }

    pub fn document_contents(
        &self,
        id: &str,
        after: Option<u32>,
    ) -> Result<DocumentContentsPage, StorageError> {
        bounded(id, 512)?;
        let tx = self.connection.unchecked_transaction()?;
        let record = required_record(&tx, id)?;
        let mut statement = tx.prepare(
            "SELECT ordinal,navigation FROM document_navigation
             WHERE source_id=?1 AND (?2 IS NULL OR ordinal>?2) ORDER BY ordinal LIMIT 33",
        )?;
        let mut rows = statement.query(params![id, after])?;
        let mut items = Vec::new();
        let mut last = None;
        let mut next_offset = None;
        let mut bytes = 0;
        while let Some(row) = rows.next()? {
            let encoded = json(row, 1, RECORD_BYTES)?;
            if items.len() == 32 || bytes + encoded.len() > LIST_BYTES {
                next_offset = last;
                break;
            }
            last = Some(row.get::<_, u32>(0)?);
            bytes += encoded.len();
            items.push(serde_json::from_str(&encoded)?);
        }
        drop(rows);
        drop(statement);
        tx.commit()?;
        Ok(DocumentContentsPage {
            source_id: record.id,
            parser_revision: record.parser_revision,
            items,
            next_offset,
        })
    }

    pub fn document_resource(
        &self,
        id: &str,
        resource_id: &str,
    ) -> Result<Option<DocumentResourceLocation>, StorageError> {
        read_resource(&self.connection, id, resource_id)
    }
}

fn locator(
    db: &Connection,
    record: &DocumentRecord,
    ordinal: u32,
) -> Result<Option<DocumentPosition>, StorageError> {
    Ok(db
        .query_row(
            "SELECT resource,block_id FROM document_blocks WHERE source_id=?1 AND ordinal=?2",
            params![record.id, ordinal],
            |row| {
                Ok(DocumentPosition {
                    parser_revision: record.parser_revision.clone(),
                    resource: json(row, 0, 512)?,
                    block_id: json(row, 1, 512)?,
                    offset: 0,
                })
            },
        )
        .optional()?)
}
