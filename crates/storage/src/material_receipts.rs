use crate::{
    ProfileStore, StorageError, material_identity::digest, material_read::read_material,
    material_validation::bounded,
};
use mlearn_core::{MaterialCreate, MaterialEdit, MaterialId, MaterialWriteResult};
use rusqlite::{Connection, OptionalExtension, params};

impl ProfileStore {
    pub fn material_create_receipt(
        &self,
        command: &MaterialCreate,
    ) -> Result<Option<MaterialWriteResult>, StorageError> {
        bounded(&command.command_id, 128)?;
        let digest = digest("create", &serde_json::to_vec(command)?);
        receipt(&self.connection, &command.command_id, &digest)?
            .map(|previous| previous.result(&self.connection))
            .transpose()
    }

    pub fn material_edit_receipt(
        &self,
        command: &MaterialEdit,
    ) -> Result<Option<MaterialWriteResult>, StorageError> {
        bounded(&command.command_id, 128)?;
        let digest = digest("update", &serde_json::to_vec(command)?);
        receipt(&self.connection, &command.command_id, &digest)?
            .map(|previous| previous.result(&self.connection))
            .transpose()
    }
}

pub(crate) struct Receipt {
    pub digest: Vec<u8>,
    pub item_id: Option<String>,
    pub revision: Option<u32>,
    pub reused: bool,
    pub duplicate_ids: Vec<String>,
}

pub(crate) fn receipt(
    db: &Connection,
    command_id: &str,
    digest: &[u8],
) -> Result<Option<Receipt>, StorageError> {
    let row = db.query_row(
        "SELECT digest,item_id,revision,reused,duplicate_ids FROM material_receipts WHERE command_id=?1",
        [command_id],
        |r| Ok((r.get::<_, Vec<u8>>(0)?, r.get::<_, Option<String>>(1)?,
            r.get::<_, Option<u32>>(2)?, r.get::<_, bool>(3)?, r.get::<_, String>(4)?)),
    ).optional()?;
    row.map(|(old, item_id, revision, reused, ids)| {
        if old != digest {
            return Err(StorageError::Invalid(
                "Command identity reused for different Material action or payload".into(),
            ));
        }
        Ok(Receipt {
            digest: old,
            item_id,
            revision,
            reused,
            duplicate_ids: serde_json::from_str(&ids)?,
        })
    })
    .transpose()
}

impl Receipt {
    pub fn write(&self, db: &Connection, command_id: &str) -> Result<(), StorageError> {
        db.execute(
            "INSERT INTO material_receipts(command_id,digest,item_id,revision,reused,duplicate_ids) VALUES(?1,?2,?3,?4,?5,?6)",
            params![command_id, self.digest, self.item_id, self.revision, self.reused,
                serde_json::to_string(&self.duplicate_ids)?],
        )?;
        Ok(())
    }

    pub fn result(&self, db: &Connection) -> Result<MaterialWriteResult, StorageError> {
        match (&self.item_id, self.revision) {
            (Some(id), Some(committed_revision)) => Ok(MaterialWriteResult::Saved {
                material: Box::new(read_material(db, &MaterialId(id.clone()))?),
                reused: self.reused,
                committed_revision,
            }),
            (None, None) => Ok(MaterialWriteResult::Duplicate {
                items: self
                    .duplicate_ids
                    .iter()
                    .map(|id| read_material(db, &MaterialId(id.clone())))
                    .collect::<Result<_, _>>()?,
            }),
            (Some(_), None) | (None, Some(_)) => {
                Err(StorageError::Invalid("Invalid Material receipt".into()))
            }
        }
    }
}
