use crate::{
    ProfileStore, StorageError,
    document_read::{read_block, read_record, required_record},
    document_validation::{
        RECORD_BYTES, bounded, invalid, payload, position, position_keys, projection,
    },
};
use mlearn_core::{
    DocumentBlock, DocumentCheckpoint, DocumentNavigation, DocumentRecord, DocumentResourceLocation,
};
use rusqlite::{Connection, params};
use sha2::{Digest, Sha256};

pub(crate) fn migrate(db: &Connection) -> Result<(), StorageError> {
    db.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS documents(
            id TEXT PRIMARY KEY,record TEXT NOT NULL,digest BLOB NOT NULL,touched REAL NOT NULL);
        CREATE INDEX IF NOT EXISTS documents_recent ON documents(touched DESC,id);
        CREATE TABLE IF NOT EXISTS document_resources(
            source_id TEXT NOT NULL REFERENCES documents(id),resource_id TEXT NOT NULL,
            location TEXT NOT NULL,PRIMARY KEY(source_id,resource_id));
        CREATE TABLE IF NOT EXISTS document_blocks(
            source_id TEXT NOT NULL,resource TEXT NOT NULL,block_id TEXT NOT NULL,
            ordinal INTEGER NOT NULL,payload_bytes INTEGER NOT NULL,block TEXT NOT NULL,
            PRIMARY KEY(source_id,resource,block_id),UNIQUE(source_id,ordinal),
            FOREIGN KEY(source_id,resource) REFERENCES document_resources(source_id,resource_id));
        CREATE TABLE IF NOT EXISTS document_navigation(
            source_id TEXT NOT NULL REFERENCES documents(id),ordinal INTEGER NOT NULL,
            resource TEXT NOT NULL,block_id TEXT NOT NULL,navigation TEXT NOT NULL,
            PRIMARY KEY(source_id,ordinal),
            FOREIGN KEY(source_id,resource,block_id)
                REFERENCES document_blocks(source_id,resource,block_id));
        PRAGMA user_version=6;
        ",
    )?;
    Ok(())
}

impl ProfileStore {
    pub fn import_document(
        &mut self,
        record: &DocumentRecord,
        blocks: &[DocumentBlock],
        contents: &[DocumentNavigation],
        resources: &[DocumentResourceLocation],
    ) -> Result<DocumentRecord, StorageError> {
        projection(record, blocks, contents, resources)?;
        let encoded = encode_record(record)?;
        // Hash bounded rows incrementally, not a second whole-corpus allocation.
        // Mutable location/appearance/language are deliberately not projection identity.
        let mut digest = Sha256::new();
        digest.update(serde_json::to_vec(&(
            &record.content_revision,
            &record.parser_revision,
            record.format,
            record.total_blocks,
            record.total_pages,
            &record.progression,
            &record.fidelity,
        ))?);
        for block in blocks {
            digest.update(serde_json::to_vec(block)?);
        }
        for entry in contents {
            digest.update(serde_json::to_vec(entry)?);
        }
        let mut ordered_resources: Vec<_> = resources.iter().collect();
        ordered_resources.sort_by(|left, right| left.resource_id.cmp(&right.resource_id));
        for resource in ordered_resources {
            digest.update(serde_json::to_vec(&(
                &resource.resource_id,
                &resource.mime_type,
                resource.byte_length,
            ))?);
        }
        let digest = digest.finalize().to_vec();
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        if let Some(existing) = read_record(&tx, &record.id)? {
            let matches: bool = tx.query_row(
                "SELECT digest FROM documents WHERE id=?1",
                [&record.id],
                |row| Ok(row.get_ref(0)?.as_blob()? == digest),
            )?;
            if !matches {
                return Err(invalid(
                    "Document identity reused for changed content or parser projection",
                ));
            }
            tx.execute(
                "UPDATE documents SET touched=unixepoch('subsec') WHERE id=?1",
                [&record.id],
            )?;
            tx.commit()?;
            return Ok(existing);
        }
        tx.execute(
            "INSERT INTO documents VALUES(?1,?2,?3,unixepoch('subsec'))",
            params![record.id, encoded, digest],
        )?;
        for resource in resources {
            tx.execute(
                "INSERT INTO document_resources VALUES(?1,?2,?3)",
                params![
                    record.id,
                    resource.resource_id,
                    serde_json::to_string(resource)?
                ],
            )?;
        }
        for (ordinal, block) in blocks.iter().enumerate() {
            tx.execute(
                "INSERT INTO document_blocks VALUES(?1,?2,?3,?4,?5,?6)",
                params![
                    record.id,
                    block.resource,
                    block.id,
                    ordinal,
                    payload(block),
                    serde_json::to_string(block)?
                ],
            )?;
        }
        for (ordinal, entry) in contents.iter().enumerate() {
            tx.execute(
                "INSERT INTO document_navigation VALUES(?1,?2,?3,?4,?5)",
                params![
                    record.id,
                    ordinal,
                    entry.position.resource,
                    entry.position.block_id,
                    serde_json::to_string(entry)?
                ],
            )?;
        }
        tx.commit()?;
        Ok(record.clone())
    }

    pub fn checkpoint_document(
        &mut self,
        checkpoint: &DocumentCheckpoint,
    ) -> Result<DocumentRecord, StorageError> {
        bounded(&checkpoint.source_id, 512)?;
        bounded(&checkpoint.content_revision, 512)?;
        position_keys(&checkpoint.position)?;
        checkpoint
            .appearance
            .validate()
            .map_err(StorageError::Invalid)?;
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let mut record = required_record(&tx, &checkpoint.source_id)?;
        if record.content_revision != checkpoint.content_revision {
            return Err(invalid("Document content revision changed"));
        }
        let block = read_block(
            &tx,
            &record.id,
            &checkpoint.position.resource,
            &checkpoint.position.block_id,
        )?
        .ok_or_else(|| invalid("Document checkpoint block is missing"))?;
        position(&record, &checkpoint.position, &block)?;
        record.position = Some(checkpoint.position.clone());
        record.appearance = checkpoint.appearance.clone();
        tx.execute(
            "UPDATE documents SET record=?2,touched=unixepoch('subsec') WHERE id=?1",
            params![record.id, encode_record(&record)?],
        )?;
        tx.commit()?;
        Ok(record)
    }

    pub fn set_document_language(
        &mut self,
        id: &str,
        package_id: &str,
        package_version: &str,
    ) -> Result<DocumentRecord, StorageError> {
        bounded(id, 512)?;
        bounded(package_id, 512)?;
        bounded(package_version, 512)?;
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let mut record = required_record(&tx, id)?;
        record.package_id = package_id.into();
        record.package_version = package_version.into();
        tx.execute(
            "UPDATE documents SET record=?2 WHERE id=?1",
            params![id, encode_record(&record)?],
        )?;
        tx.commit()?;
        Ok(record)
    }
}

fn encode_record(record: &DocumentRecord) -> Result<String, StorageError> {
    let encoded = serde_json::to_string(record)?;
    if encoded.len() > RECORD_BYTES {
        return Err(invalid("Document record exceeds bounded metadata payload"));
    }
    Ok(encoded)
}
