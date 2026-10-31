use crate::{
    ProfileStore, StorageError,
    material_identity::{digest, identity},
    material_media::{PreparedAuthoredMedia, prepared_content, register_media, replace_references},
    material_read::{eligibility, read_material},
    material_receipts::{Receipt, receipt},
    material_validation::{bounded, content, target},
};
use mlearn_core::{
    CaptureExclusion, MaterialCreate, MaterialEdit, MaterialEligibility, MaterialId,
    MaterialWriteResult,
};
use rusqlite::{Connection, params};
use sha2::{Digest, Sha256};

pub(crate) fn migrate(db: &Connection) -> Result<(), StorageError> {
    db.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS materials(
            id TEXT PRIMARY KEY,revision INTEGER NOT NULL,excluded INTEGER NOT NULL,
            content TEXT NOT NULL,package_id TEXT NOT NULL,target_id TEXT,source_id TEXT,
            exact_identity BLOB NOT NULL,capture_identity BLOB NOT NULL,search_text TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS materials_target ON materials(package_id,target_id,id);
        CREATE INDEX IF NOT EXISTS materials_exact ON materials(exact_identity,id);
        CREATE INDEX IF NOT EXISTS materials_capture ON materials(capture_identity,id);
        CREATE INDEX IF NOT EXISTS materials_source ON materials(source_id,id);
        CREATE TABLE IF NOT EXISTS authored_media(id TEXT PRIMARY KEY,document TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS material_assets(
            material_id TEXT NOT NULL REFERENCES materials(id),
            media_id TEXT NOT NULL REFERENCES authored_media(id),
            PRIMARY KEY(material_id,media_id));
        CREATE INDEX IF NOT EXISTS material_assets_media ON material_assets(media_id,material_id);
        CREATE TABLE IF NOT EXISTS capture_exclusions(
            package_id TEXT NOT NULL,target_id TEXT NOT NULL,excluded INTEGER NOT NULL,
            PRIMARY KEY(package_id,target_id));
        CREATE TABLE IF NOT EXISTS material_receipts(
            command_id TEXT PRIMARY KEY,digest BLOB NOT NULL,item_id TEXT,
            revision INTEGER,reused INTEGER NOT NULL,duplicate_ids TEXT NOT NULL);
        PRAGMA user_version=4;
    ",
    )?;
    Ok(())
}

impl ProfileStore {
    pub fn create_material(
        &mut self,
        command: &MaterialCreate,
    ) -> Result<MaterialWriteResult, StorageError> {
        self.create_material_prepared(command, &[])
    }

    pub fn create_material_prepared(
        &mut self,
        command: &MaterialCreate,
        media: &[PreparedAuthoredMedia],
    ) -> Result<MaterialWriteResult, StorageError> {
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let result = create_in_transaction(&tx, command, media)?;
        tx.commit()?;
        Ok(result)
    }
}

pub(crate) fn create_in_transaction(
    tx: &Connection,
    command: &MaterialCreate,
    media: &[PreparedAuthoredMedia],
) -> Result<MaterialWriteResult, StorageError> {
        bounded(&command.command_id, 128)?;
        let digest = digest("create", &serde_json::to_vec(command)?);
        if let Some(previous) = receipt(tx, &command.command_id, &digest)? {
            return previous.result(tx);
        }
        let value = prepared_content(&command.content, &command.media_imports, media)?;
        let encoded = content(&value)?;
        let identity = identity(&value)?;
        let mut previous = Receipt {
            digest,
            item_id: None,
            revision: None,
            reused: false,
            duplicate_ids: Vec::new(),
        };
        if !command.distinct {
            let mut statement =
                tx.prepare("SELECT id FROM materials WHERE exact_identity=?1 ORDER BY id LIMIT 1")?;
            let exact = statement
                .query_map([&identity.exact], |r| r.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            if let Some(id) = exact.first() {
                previous.item_id = Some(id.clone());
                previous.revision = Some(read_material(tx, &MaterialId(id.clone()))?.revision);
                previous.reused = true;
            } else {
                let mut statement = tx.prepare(
                    "SELECT id FROM materials WHERE capture_identity=?1 ORDER BY id LIMIT 3",
                )?;
                previous.duplicate_ids = statement
                    .query_map([&identity.capture], |r| r.get(0))?
                    .collect::<Result<Vec<_>, _>>()?;
            }
        }
        if previous.item_id.is_none()
            && let Some(target_id) = &command.content.target_id
        {
            let excluded: bool = tx.query_row(
                    "SELECT EXISTS(SELECT 1 FROM capture_exclusions WHERE package_id=?1 AND target_id=?2 AND excluded=1)",
                    params![command.content.package_id, target_id], |r| r.get(0))?;
            if excluded {
                return Err(StorageError::Invalid(
                    "Capture target is excluded; explicitly withdraw its exclusion first".into(),
                ));
            }
        }
        if previous.item_id.is_none() && previous.duplicate_ids.is_empty() {
            let id = format!(
                "material-{:x}",
                Sha256::digest(command.command_id.as_bytes())
            );
            for asset in media {
                register_media(tx, &asset.media)?;
            }
            tx.execute("INSERT INTO materials(id,revision,excluded,content,package_id,target_id,source_id,exact_identity,capture_identity,search_text) VALUES(?1,1,0,?2,?3,?4,?5,?6,?7,?8)",
                params![id, encoded, value.package_id, value.target_id, value.source.as_ref().map(|s| &s.source_id),
                    identity.exact, identity.capture, search_text(&value)])?;
            replace_references(tx, &id, &value)?;
            previous.item_id = Some(id);
            previous.revision = Some(1);
        }
        previous.write(tx, &command.command_id)?;
        previous.result(tx)
}

impl ProfileStore {
    pub fn update_material(
        &mut self,
        command: &MaterialEdit,
    ) -> Result<MaterialWriteResult, StorageError> {
        self.update_material_prepared(command, &[])
    }

    pub fn update_material_prepared(
        &mut self,
        command: &MaterialEdit,
        media: &[PreparedAuthoredMedia],
    ) -> Result<MaterialWriteResult, StorageError> {
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let result = update_in_transaction(&tx, command, media)?;
        tx.commit()?;
        Ok(result)
    }
}

pub(crate) fn update_in_transaction(
    tx: &Connection,
    command: &MaterialEdit,
    media: &[PreparedAuthoredMedia],
) -> Result<MaterialWriteResult, StorageError> {
        bounded(&command.command_id, 128)?;
        bounded(&command.id.0, 512)?;
        let digest = digest("update", &serde_json::to_vec(command)?);
        if let Some(previous) = receipt(tx, &command.command_id, &digest)? {
            return previous.result(tx);
        }
        let current = read_material(tx, &command.id)?;
        if current.revision != command.expected_revision {
            return Err(StorageError::Conflict);
        }
        let revision = current
            .revision
            .checked_add(1)
            .ok_or_else(|| StorageError::Invalid("Material revision exhausted".into()))?;
        let value = prepared_content(&command.content, &command.media_imports, media)?;
        let encoded = content(&value)?;
        let identity = identity(&value)?;
        for asset in media {
            register_media(tx, &asset.media)?;
        }
        tx.execute("UPDATE materials SET revision=?2,excluded=?3,content=?4,package_id=?5,target_id=?6,source_id=?7,exact_identity=?8,capture_identity=?9,search_text=?10 WHERE id=?1",
            params![command.id.0, revision, command.excluded, encoded, value.package_id, value.target_id,
                value.source.as_ref().map(|s| &s.source_id), identity.exact, identity.capture, search_text(&value)])?;
        replace_references(tx, &command.id.0, &value)?;
        let previous = Receipt {
            digest,
            item_id: Some(command.id.0.clone()),
            revision: Some(revision),
            reused: false,
            duplicate_ids: Vec::new(),
        };
        previous.write(tx, &command.command_id)?;
        previous.result(tx)
}

impl ProfileStore {
    pub fn set_capture_exclusion(
        &mut self,
        command: &CaptureExclusion,
    ) -> Result<MaterialEligibility, StorageError> {
        bounded(&command.command_id, 128)?;
        target(&command.target)?;
        let digest = digest("exclusion", &serde_json::to_vec(command)?);
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        if receipt(&tx, &command.command_id, &digest)?.is_none() {
            tx.execute("INSERT INTO capture_exclusions(package_id,target_id,excluded) VALUES(?1,?2,?3) ON CONFLICT(package_id,target_id) DO UPDATE SET excluded=excluded.excluded",
                params![command.target.package_id, command.target.target_id, command.excluded])?;
            Receipt {
                digest,
                item_id: None,
                revision: None,
                reused: false,
                duplicate_ids: Vec::new(),
            }
            .write(&tx, &command.command_id)?;
        }
        let result = eligibility(&tx, &command.target)?;
        tx.commit()?;
        Ok(result)
    }
}

fn search_text(content: &mlearn_core::MaterialContent) -> String {
    format!(
        "{}\n{}\n{}\n{}\n{}\n{}",
        content.phrase,
        content.reading,
        content.meaning,
        content.context,
        content.notes,
        content.examples.join("\n")
    )
    .to_lowercase()
}
