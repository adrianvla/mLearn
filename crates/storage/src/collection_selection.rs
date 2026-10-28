use crate::{
    ProfileStore, StorageError,
    collection::{compile_collection, read_collection},
    material_validation::bounded,
};
use mlearn_core::*;
use rusqlite::{Connection, OptionalExtension, params, params_from_iter, types::Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

const MAX_SELECTIONS: u32 = 8;
const MAX_ENTRIES: u32 = 1_000_000;

pub(crate) fn migrate(db: &Connection) -> Result<(), StorageError> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS collection_selections(
            id TEXT PRIMARY KEY,digest BLOB NOT NULL,document TEXT);
        CREATE TABLE IF NOT EXISTS collection_selection_entries(
            selection_id TEXT NOT NULL REFERENCES collection_selections(id),
            item_id TEXT NOT NULL,package_id TEXT NOT NULL,package_revision TEXT,
            material_revision INTEGER,
            PRIMARY KEY(selection_id,item_id));
        PRAGMA user_version=14;",
    )?;
    Ok(())
}

fn selection(
    db: &Connection,
    id: &CollectionSelectionId,
) -> Result<CollectionSelection, StorageError> {
    bounded(&id.0, 128)?;
    let document: Option<String> = db
        .query_row(
            "SELECT document FROM collection_selections WHERE id=?1",
            [&id.0],
            |row| row.get(0),
        )
        .optional()?
        .flatten();
    let document =
        document.ok_or_else(|| StorageError::Invalid("Selection is missing or released".into()))?;
    Ok(serde_json::from_str(&document)?)
}

fn identity(
    command: &CollectionSelectionCreate,
) -> Result<(CollectionSelectionId, Vec<u8>), StorageError> {
    bounded(&command.command_id, 128)?;
    Ok((
        CollectionSelectionId(format!(
            "selection-{:x}",
            Sha256::digest(command.command_id.as_bytes())
        )),
        Sha256::digest(serde_json::to_vec(command)?).to_vec(),
    ))
}

fn receipt(
    db: &Connection,
    id: &CollectionSelectionId,
    digest: &[u8],
) -> Result<Option<CollectionSelection>, StorageError> {
    let previous: Option<Vec<u8>> = db
        .query_row(
            "SELECT digest FROM collection_selections WHERE id=?1",
            [&id.0],
            |row| row.get(0),
        )
        .optional()?;
    match previous {
        Some(previous) if previous != digest => {
            Err(StorageError::Invalid("Command identity was reused".into()))
        }
        Some(_) => Ok(Some(selection(db, id)?)),
        None => Ok(None),
    }
}

impl ProfileStore {
    pub fn collection_selections(&self) -> Result<Vec<CollectionSelection>, StorageError> {
        let mut statement = self.connection.prepare(
            "SELECT document FROM collection_selections WHERE document IS NOT NULL ORDER BY id LIMIT 8",
        )?;
        let documents = statement.query_map([], |row| row.get::<_, String>(0))?;
        documents
            .map(|document| Ok(serde_json::from_str(&document?)?))
            .collect()
    }

    pub fn collection_selection_receipt(
        &self,
        command: &CollectionSelectionCreate,
    ) -> Result<Option<CollectionSelection>, StorageError> {
        let (id, digest) = identity(command)?;
        receipt(&self.connection, &id, &digest)
    }

    pub fn create_collection_selection(
        &mut self,
        command: &CollectionSelectionCreate,
    ) -> Result<CollectionSelection, StorageError> {
        let (id, digest) = identity(command)?;
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        if let Some(previous) = receipt(&tx, &id, &digest)? {
            return Ok(previous);
        }
        let retained: u32 = tx.query_row(
            "SELECT COUNT(*) FROM collection_selections WHERE document IS NOT NULL",
            [],
            |row| row.get(0),
        )?;
        let entries: u32 = tx.query_row(
            "SELECT COUNT(*) FROM collection_selection_entries",
            [],
            |row| row.get(0),
        )?;
        if retained >= MAX_SELECTIONS || entries >= MAX_ENTRIES {
            return Err(StorageError::Invalid(
                "Release an existing selection before selecting more items".into(),
            ));
        }
        let (query, explicit) = match &command.source {
            CollectionSelectionSource::Matching { query } => (query, None),
            CollectionSelectionSource::Items { query, items } => {
                if items.len() > 256 {
                    return Err(StorageError::Invalid(
                        "Selection exceeds item bounds".into(),
                    ));
                }
                (query, Some(items))
            }
        };
        if query.after.is_some() {
            return Err(StorageError::Invalid(
                "Selection requires a complete query, not a page cursor".into(),
            ));
        }
        // Readiness, filter validation and membership share the collection owner
        // and this transaction; another process cannot change the set between them.
        let page = match read_collection(&tx, query)? {
            CollectionResult::Ready { page } => page,
            CollectionResult::Preparing { .. } => {
                return Err(StorageError::Invalid(
                    "Collection is still preparing".into(),
                ));
            }
            CollectionResult::Unavailable { message } => {
                return Err(StorageError::Invalid(message));
            }
        };
        let metadata = match &query.package_id {
            Some(package_id) => tx
                .query_row(
                    "SELECT description FROM collection_catalogs WHERE package_id=?1",
                    [package_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?
                .map(|json| serde_json::from_str(&json))
                .transpose()?,
            None => None,
        }
        .unwrap_or(CollectionDescription {
            capabilities: vec![],
            kinds: vec![],
            scopes: vec![],
            levels: vec![],
        });
        let mut compiled = compile_collection(query, &metadata)?;
        if let Some(items) = explicit {
            let mut seen = BTreeSet::new();
            let mut parameters = Vec::with_capacity(items.len());
            for item in items {
                let item_id = match (query.surface, item) {
                    (CollectionSurface::Knowledge, CollectionItemId::Target { target_id }) => {
                        target_id
                    }
                    (CollectionSurface::Material, CollectionItemId::Material { id }) => &id.0,
                    _ => {
                        return Err(StorageError::Invalid(
                            "Selection item has the wrong kind".into(),
                        ));
                    }
                };
                bounded(item_id, 512)?;
                if !seen.insert(item_id) {
                    return Err(StorageError::Invalid("Duplicate selection item".into()));
                }
                compiled.values.push(Value::Text(item_id.clone()));
                parameters.push(format!("?{}", compiled.values.len()));
            }
            compiled.membership.push_str(&if parameters.is_empty() {
                " AND 0".into()
            } else {
                format!(" AND {} IN ({})", compiled.id, parameters.join(","))
            });
        }
        tx.execute(
            "INSERT INTO collection_selections(id,digest,document) VALUES(?1,?2,NULL)",
            params![id.0, digest],
        )?;
        let (revision, material_revision) = match query.surface {
            CollectionSurface::Knowledge => (
                "(SELECT revision FROM collection_catalogs WHERE package_id=t.package_id)",
                "NULL",
            ),
            CollectionSurface::Material => {
                ("json_extract(m.content,'$.packageRevision')", "m.revision")
            }
        };
        compiled.values.push(Value::Text(id.0.clone()));
        let selection_parameter = compiled.values.len();
        let count = tx.execute(
            &format!(
                "INSERT INTO collection_selection_entries
                 SELECT ?{selection_parameter},{},{},{revision},{material_revision}
                 {} ORDER BY {} LIMIT {}",
                compiled.id,
                compiled.package,
                compiled.membership,
                compiled.id,
                MAX_ENTRIES - entries + 1,
            ),
            params_from_iter(&compiled.values),
        )?;
        if count > (MAX_ENTRIES - entries) as usize {
            return Err(StorageError::Invalid(
                "Selection exceeds retained item bounds".into(),
            ));
        }
        if explicit.is_some_and(|items| items.len() != count) {
            return Err(StorageError::Conflict);
        }
        let count = u32::try_from(count)
            .map_err(|_| StorageError::Invalid("Selection count exceeds bounds".into()))?;
        let selected = CollectionSelection {
            id,
            package_id: query.package_id.clone(),
            package_revision: page.package_revision,
            target_count: if query.surface == CollectionSurface::Knowledge {
                count
            } else {
                0
            },
            material_count: if query.surface == CollectionSurface::Material {
                count
            } else {
                0
            },
        };
        tx.execute(
            "UPDATE collection_selections SET document=?2 WHERE id=?1",
            params![selected.id.0, serde_json::to_string(&selected)?],
        )?;
        tx.commit()?;
        Ok(selected)
    }

    pub fn collection_selection(
        &self,
        id: &CollectionSelectionId,
    ) -> Result<CollectionSelection, StorageError> {
        selection(&self.connection, id)
    }

    pub fn collection_selection_page(
        &self,
        id: &CollectionSelectionId,
        after: Option<&str>,
    ) -> Result<CollectionSelectionPage, StorageError> {
        if let Some(after) = after {
            bounded(after, 512)?;
        }
        let tx = self.connection.unchecked_transaction()?;
        selection(&tx, id)?;
        let mut rows = {
            let mut statement = tx.prepare(
                "SELECT item_id,package_id,package_revision,material_revision
                 FROM collection_selection_entries
                 WHERE selection_id=?1 AND (?2 IS NULL OR item_id>?2)
                 ORDER BY item_id LIMIT 65",
            )?;
            statement
                .query_map(params![id.0, after], |row| {
                    let item_id: String = row.get(0)?;
                    let material_revision: Option<u32> = row.get(3)?;
                    Ok(CollectionSelectionEntry {
                        item: match material_revision {
                            Some(_) => CollectionItemId::Material {
                                id: MaterialId(item_id),
                            },
                            None => CollectionItemId::Target { target_id: item_id },
                        },
                        package_id: row.get(1)?,
                        package_revision: row.get(2)?,
                        material_revision,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?
        };
        let next = if rows.len() > 64 {
            rows.truncate(64);
            rows.last().map(|row| match &row.item {
                CollectionItemId::Material { id } => id.0.clone(),
                CollectionItemId::Target { target_id } => target_id.clone(),
            })
        } else {
            None
        };
        tx.commit()?;
        Ok(CollectionSelectionPage { items: rows, next })
    }

    pub fn release_collection_selection(
        &mut self,
        id: &CollectionSelectionId,
    ) -> Result<(), StorageError> {
        bounded(&id.0, 128)?;
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        tx.execute(
            "DELETE FROM collection_selection_entries WHERE selection_id=?1",
            [&id.0],
        )?;
        // Keep the command digest: retries must never reselect changed membership.
        tx.execute(
            "UPDATE collection_selections SET document=NULL WHERE id=?1",
            [&id.0],
        )?;
        tx.commit()?;
        Ok(())
    }
}
