use crate::{ProfileStore, StorageError};
use mlearn_core::{ClaimChange, KnowledgeKey, KnowledgeProjection};
use rusqlite::{OptionalExtension, params};
use sha2::{Digest, Sha256};

impl ProfileStore {
    pub fn knowledge(
        &self,
        keys: &[KnowledgeKey],
    ) -> Result<Vec<KnowledgeProjection>, StorageError> {
        if keys.len() > 256 {
            return Err(StorageError::Invalid(
                "Knowledge batch exceeds 256 targets".into(),
            ));
        }
        keys.iter()
            .map(|key| crate::review_read::projection(&self.connection, key))
            .collect()
    }
    pub fn change_claim(
        &mut self,
        change: &ClaimChange,
    ) -> Result<KnowledgeProjection, StorageError> {
        if change.command_id.is_empty()
            || change.command_id.len() > 128
            || [
                &change.key.package_id,
                &change.key.target_id,
                &change.key.capability,
            ]
            .iter()
            .any(|v| v.is_empty() || v.len() > 512)
        {
            return Err(StorageError::Invalid("Invalid claim identity".into()));
        }
        let digest = Sha256::digest(serde_json::to_vec(change)?).to_vec();
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let previous: Option<(Vec<u8>, String)> = tx
            .query_row(
                "SELECT digest,projection FROM claim_receipts WHERE command_id=?1",
                [&change.command_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some((old, result)) = previous {
            if old != digest {
                return Err(StorageError::Invalid(
                    "Command identity reused for different claim".into(),
                ));
            }
            return Ok(serde_json::from_str(&result)?);
        }
        tx.execute(
            "UPDATE knowledge_revision SET revision=revision+1 WHERE id=1",
            [],
        )?;
        let revision: u32 = tx.query_row(
            "SELECT revision FROM knowledge_revision WHERE id=1",
            [],
            |r| r.get(0),
        )?;
        tx.execute("INSERT INTO claims(package_id,target_id,capability,claim,revision) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(package_id,target_id,capability) DO UPDATE SET claim=excluded.claim,revision=excluded.revision",params![change.key.package_id,change.key.target_id,change.key.capability,change.claim,revision])?;
        let projection = crate::review_read::projection(&tx, &change.key)?;
        tx.execute(
            "INSERT INTO claim_receipts(command_id,digest,projection) VALUES(?1,?2,?3)",
            params![
                change.command_id,
                digest,
                serde_json::to_string(&projection)?
            ],
        )?;
        // Receipts live with durable commands: retry identity must survive restart.
        tx.commit()?;
        Ok(projection)
    }
}
