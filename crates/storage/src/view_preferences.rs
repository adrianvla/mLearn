use crate::{ProfileStore, StorageError};
use mlearn_core::{StarCollapse, ViewPreferences};
use rusqlite::{OptionalExtension, params};
use sha2::{Digest, Sha256};

pub(super) fn migrate(tx: &rusqlite::Transaction<'_>) -> Result<(), StorageError> {
    tx.execute_batch(
        "CREATE TABLE view_preferences(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, inline_level_scale TEXT);
         INSERT INTO view_preferences VALUES(1,0,NULL);
         CREATE TABLE view_preference_receipts(sequence INTEGER PRIMARY KEY AUTOINCREMENT, command_id TEXT NOT NULL UNIQUE, digest BLOB NOT NULL, revision INTEGER NOT NULL);
         PRAGMA user_version=10;",
    )?;
    Ok(())
}

pub(super) fn migrate_collapse(tx: &rusqlite::Transaction<'_>) -> Result<(), StorageError> {
    tx.execute_batch("ALTER TABLE view_preferences ADD COLUMN star_collapse TEXT NOT NULL DEFAULT 'auto' CHECK(star_collapse IN ('auto','always','never'));")?;
    tx.pragma_update(None, "user_version", 11)?;
    Ok(())
}

fn validate_scale(scale: Option<&str>) -> Result<(), StorageError> {
    if scale.is_some_and(|id| {
        id.len() > 512
            || !id.contains(':')
            || id.chars().any(char::is_control)
            || id.split(':').any(str::is_empty)
    }) {
        return Err(StorageError::Invalid(
            "Invalid inline level scale identity".into(),
        ));
    }
    Ok(())
}

impl ProfileStore {
    pub fn view_preferences(&self) -> Result<ViewPreferences, StorageError> {
        let (revision, inline_level_scale, collapse): (u32, Option<String>, String) =
            self.connection.query_row(
                "SELECT revision,inline_level_scale,star_collapse FROM view_preferences WHERE id=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )?;
        let value = ViewPreferences {
            revision,
            inline_level_scale,
            star_collapse: serde_json::from_value(serde_json::Value::String(collapse))?,
        };
        validate_scale(value.inline_level_scale.as_deref())?;
        Ok(value)
    }

    /// No language execution, Knowledge mutation or scheduler admission occurs here.
    pub fn save_inline_level_scale(
        &mut self,
        scale: Option<&str>,
        expected: u32,
        command_id: &str,
    ) -> Result<u32, StorageError> {
        validate_scale(scale)?;
        let digest = Sha256::digest(serde_json::to_vec(&(expected, scale))?).to_vec();
        self.commit_view_preference(expected, command_id, digest, |tx, next| {
            tx.execute(
                "UPDATE view_preferences SET revision=?1,inline_level_scale=?2 WHERE id=1",
                params![next, scale],
            )
        })
    }

    pub fn save_star_collapse(
        &mut self,
        collapse: StarCollapse,
        expected: u32,
        command_id: &str,
    ) -> Result<u32, StorageError> {
        let value = match collapse {
            StarCollapse::Auto => "auto",
            StarCollapse::Always => "always",
            StarCollapse::Never => "never",
        };
        let digest =
            Sha256::digest(serde_json::to_vec(&("star_collapse", expected, collapse))?).to_vec();
        self.commit_view_preference(expected, command_id, digest, |tx, next| {
            tx.execute(
                "UPDATE view_preferences SET revision=?1,star_collapse=?2 WHERE id=1",
                params![next, value],
            )
        })
    }

    fn commit_view_preference(
        &mut self,
        expected: u32,
        command_id: &str,
        digest: Vec<u8>,
        update: impl FnOnce(&rusqlite::Transaction<'_>, u32) -> rusqlite::Result<usize>,
    ) -> Result<u32, StorageError> {
        if command_id.is_empty() || command_id.len() > 128 {
            return Err(StorageError::Invalid("Invalid command identity".into()));
        }
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let previous: Option<(Vec<u8>, u32)> = tx
            .query_row(
                "SELECT digest,revision FROM view_preference_receipts WHERE command_id=?1",
                [command_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        if let Some((old, revision)) = previous {
            if old != digest {
                return Err(StorageError::Invalid(
                    "Command identity reused for different contents".into(),
                ));
            }
            return Ok(revision);
        }
        let revision: u32 = tx.query_row(
            "SELECT revision FROM view_preferences WHERE id=1",
            [],
            |row| row.get(0),
        )?;
        if revision != expected {
            return Err(StorageError::Conflict);
        }
        let next = revision
            .checked_add(1)
            .ok_or_else(|| StorageError::Invalid("Settings revision exhausted".into()))?;
        update(&tx, next)?;
        tx.execute(
            "INSERT INTO view_preference_receipts(command_id,digest,revision) VALUES(?1,?2,?3)",
            params![command_id, digest, next],
        )?;
        tx.execute("DELETE FROM view_preference_receipts WHERE sequence <= (SELECT COALESCE(MAX(sequence),0)-256 FROM view_preference_receipts)", [])?;
        tx.commit()?;
        Ok(next)
    }
}
