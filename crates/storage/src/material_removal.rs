use crate::{
    material_identity::digest,
    material_read::read_material,
    material_receipts::{receipt, Receipt},
    material_validation::bounded,
    ProfileStore, StorageError,
};
use mlearn_core::{MaterialRemoval, MaterialRemove};
use rusqlite::{params, Connection};

pub(crate) fn migrate(db: &Connection) -> Result<(), StorageError> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS material_removals(id TEXT PRIMARY KEY,revision INTEGER NOT NULL);
         CREATE INDEX IF NOT EXISTS review_work_media ON review_work(json_extract(admission,'$.probe.requiredMedia'));
         PRAGMA user_version=15;",
    )?;
    Ok(())
}

impl ProfileStore {
    pub fn remove_material(
        &mut self,
        command: &MaterialRemove,
    ) -> Result<MaterialRemoval, StorageError> {
        bounded(&command.command_id, 128)?;
        bounded(&command.id.0, 512)?;
        let digest = digest("remove", &serde_json::to_vec(command)?);
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        if let Some(previous) = receipt(&tx, &command.command_id, &digest)? {
            return match (previous.item_id, previous.revision) {
                (Some(id), Some(revision)) if id == command.id.0 => Ok(MaterialRemoval {
                    id: command.id.clone(),
                    committed_revision: revision,
                }),
                _ => Err(StorageError::Invalid(
                    "Invalid Material removal receipt".into(),
                )),
            };
        }
        let current = read_material(&tx, &command.id)?;
        if current.revision != command.expected_revision {
            return Err(StorageError::Conflict);
        }
        let revision = current
            .revision
            .checked_add(1)
            .ok_or_else(|| StorageError::Invalid("Material revision exhausted".into()))?;
        // Review admissions, schedules, claims and observations have their own
        // lifetimes. Removing authored Material cannot erase those owners.
        tx.execute(
            "DELETE FROM material_assets WHERE material_id=?1",
            [&command.id.0],
        )?;
        tx.execute("DELETE FROM materials WHERE id=?1", [&command.id.0])?;
        tx.execute(
            "INSERT INTO material_removals(id,revision) VALUES(?1,?2)",
            params![command.id.0, revision],
        )?;
        Receipt {
            digest,
            item_id: Some(command.id.0.clone()),
            revision: Some(revision),
            reused: false,
            duplicate_ids: vec![],
        }
        .write(&tx, &command.command_id)?;
        tx.commit()?;
        Ok(MaterialRemoval {
            id: command.id.clone(),
            committed_revision: revision,
        })
    }
}
