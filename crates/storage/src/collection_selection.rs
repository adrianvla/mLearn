use crate::{
    ProfileStore, StorageError,
    collection::{CollectionSql, compile_collection, read_collection},
    material_validation::bounded,
};
use mlearn_core::*;
use rusqlite::{Connection, OptionalExtension, params, params_from_iter, types::Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

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

pub(crate) fn selection(
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

fn item_ids(
    items: &[CollectionItemId],
    surface: CollectionSurface,
    maximum: usize,
) -> Result<BTreeSet<&str>, StorageError> {
    if items.len() > maximum {
        return Err(StorageError::Invalid(
            "Selection exceeds item bounds".into(),
        ));
    }
    let mut ids = BTreeSet::new();
    for item in items {
        let id = match (surface, item) {
            (CollectionSurface::Knowledge, CollectionItemId::Target { target_id }) => {
                target_id.as_str()
            }
            (CollectionSurface::Material, CollectionItemId::Material { id }) => id.0.as_str(),
            _ => {
                return Err(StorageError::Invalid(
                    "Selection item has the wrong kind".into(),
                ));
            }
        };
        bounded(id, 512)?;
        if !ids.insert(id) {
            return Err(StorageError::Invalid("Duplicate selection item".into()));
        }
    }
    Ok(ids)
}

fn compile_selection(
    db: &Connection,
    query: &CollectionQuery,
    explicit: Option<&BTreeSet<&str>>,
) -> Result<(CollectionSql, Option<String>), StorageError> {
    if query.after.is_some() {
        return Err(StorageError::Invalid(
            "Selection requires a complete query, not a page cursor".into(),
        ));
    }
    let revision = match read_collection(db, query)? {
        CollectionResult::Ready { page } => page.package_revision,
        CollectionResult::Preparing { .. } => {
            return Err(StorageError::Invalid(
                "Collection is still preparing".into(),
            ));
        }
        CollectionResult::Unavailable { message } => return Err(StorageError::Invalid(message)),
    };
    let metadata = match &query.package_id {
        Some(package_id) => db
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
    if let Some(ids) = explicit {
        let mut parameters = Vec::with_capacity(ids.len());
        for id in ids {
            compiled.values.push(Value::Text((*id).into()));
            parameters.push(format!("?{}", compiled.values.len()));
        }
        compiled.membership.push_str(&if parameters.is_empty() {
            " AND 0".into()
        } else {
            format!(" AND {} IN ({})", compiled.id, parameters.join(","))
        });
    }
    Ok((compiled, revision))
}

fn insert_entries(
    db: &Connection,
    compiled: &mut CollectionSql,
    id: &CollectionSelectionId,
    surface: CollectionSurface,
    limit: u32,
) -> Result<usize, StorageError> {
    let (revision, material_revision) = match surface {
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
    Ok(db.execute(
        &format!(
            "INSERT OR IGNORE INTO collection_selection_entries
             SELECT ?{selection_parameter},{},{},{revision},{material_revision}
             {} ORDER BY {} LIMIT {limit}",
            compiled.id, compiled.package, compiled.membership, compiled.id,
        ),
        params_from_iter(&compiled.values),
    )?)
}

fn amend(
    db: &Connection,
    command: &CollectionSelectionCreate,
    id: &CollectionSelectionId,
    digest: &[u8],
    available: u32,
) -> Result<CollectionSelection, StorageError> {
    let CollectionSelectionSource::Amend {
        selection_id,
        query,
        add,
        remove,
    } = &command.source
    else {
        return Err(StorageError::Invalid(
            "Expected an immutable selection amendment".into(),
        ));
    };
    if query.after.is_some() {
        return Err(StorageError::Invalid(
            "Selection requires a complete query, not a page cursor".into(),
        ));
    }
    if let Some(package_id) = &query.package_id {
        bounded(package_id, 512)?;
    }
    let base = selection(db, selection_id)?;
    if base.target_count > 0
        && (query.surface != CollectionSurface::Knowledge || base.package_id != query.package_id)
        || base.material_count > 0 && query.surface != CollectionSurface::Material
    {
        return Err(StorageError::Invalid(
            "Selection amendment changed its collection identity".into(),
        ));
    }
    let add_ids = item_ids(add, query.surface, 256)?;
    let remove_ids = item_ids(remove, query.surface, 256)?;
    if !add_ids.is_disjoint(&remove_ids) {
        return Err(StorageError::Invalid(
            "Selection amendment adds and removes the same item".into(),
        ));
    }
    db.execute(
        "INSERT INTO collection_selections(id,digest,document) VALUES(?1,?2,NULL)",
        params![id.0, digest],
    )?;
    let mut values = vec![
        Value::Text(id.0.clone()),
        Value::Text(selection_id.0.clone()),
    ];
    let mut parameters = Vec::with_capacity(remove_ids.len());
    for removed in remove_ids {
        values.push(Value::Text(removed.into()));
        parameters.push(format!("?{}", values.len()));
    }
    let excludes = if parameters.is_empty() {
        "1".into()
    } else {
        format!("item_id NOT IN ({})", parameters.join(","))
    };
    let copied = db.execute(
        &format!(
            "INSERT INTO collection_selection_entries
             SELECT ?1,item_id,package_id,package_revision,material_revision
             FROM collection_selection_entries WHERE selection_id=?2 AND {excludes} LIMIT {}",
            available + 1,
        ),
        params_from_iter(&values),
    )?;
    if copied > available as usize {
        return Err(StorageError::Invalid(
            "Selection exceeds retained item bounds".into(),
        ));
    }
    let mut package_id = base.package_id.clone();
    let mut package_revision = base.package_revision.clone();
    if !add_ids.is_empty() {
        let (mut compiled, revision) = compile_selection(db, query, Some(&add_ids))?;
        let matches: usize = db.query_row(
            &format!("SELECT COUNT(*) {}", compiled.membership),
            params_from_iter(&compiled.values),
            |row| row.get(0),
        )?;
        if matches != add_ids.len() {
            return Err(StorageError::Conflict);
        }
        insert_entries(db, &mut compiled, id, query.surface, available + 1)?;
        if base.target_count == 0 && base.material_count == 0 {
            package_id = query.package_id.clone();
            package_revision = revision;
        } else if package_id != query.package_id {
            package_id = None;
            package_revision = None;
        } else if package_revision != revision {
            package_revision = None;
        }
    }
    let count: u32 = db.query_row(
        "SELECT COUNT(*) FROM collection_selection_entries WHERE selection_id=?1",
        [&id.0],
        |row| row.get(0),
    )?;
    if count > available {
        return Err(StorageError::Invalid(
            "Selection exceeds retained item bounds".into(),
        ));
    }
    let selected = CollectionSelection {
        id: id.clone(),
        package_id,
        package_revision,
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
    db.execute(
        "UPDATE collection_selections SET document=?2 WHERE id=?1",
        params![id.0, serde_json::to_string(&selected)?],
    )?;
    Ok(selected)
}

impl ProfileStore {
    pub fn collection_selection_membership(
        &self,
        id: &CollectionSelectionId,
        package_id: Option<&str>,
        surface: CollectionSurface,
        items: &[CollectionItemId],
    ) -> Result<Vec<CollectionSelectionMembership>, StorageError> {
        if let Some(package_id) = package_id {
            bounded(package_id, 512)?;
        }
        if surface == CollectionSurface::Knowledge && package_id.is_none() {
            return Err(StorageError::Invalid(
                "Knowledge membership requires its explicit package".into(),
            ));
        }
        let ids = item_ids(items, surface, 64)?;
        let tx = self.connection.unchecked_transaction()?;
        selection(&tx, id)?;
        let mut values = vec![Value::Text(id.0.clone())];
        let mut parameters = Vec::with_capacity(ids.len());
        for item_id in ids {
            values.push(Value::Text(item_id.into()));
            parameters.push(format!("?{}", values.len()));
        }
        let selected = if parameters.is_empty() {
            BTreeMap::new()
        } else {
            let mut statement = tx.prepare(&format!(
                "SELECT item_id,package_id,material_revision IS NOT NULL
                 FROM collection_selection_entries WHERE selection_id=?1 AND item_id IN ({})",
                parameters.join(","),
            ))?;
            statement
                .query_map(params_from_iter(&values), |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        (row.get::<_, String>(1)?, row.get::<_, bool>(2)?),
                    ))
                })?
                .collect::<Result<BTreeMap<_, _>, _>>()?
        };
        let projection = items
            .iter()
            .map(|item| {
                let (key, material) = match item {
                    CollectionItemId::Target { target_id } => (target_id, false),
                    CollectionItemId::Material { id } => (&id.0, true),
                };
                CollectionSelectionMembership {
                    item: item.clone(),
                    selected: selected.get(key).is_some_and(|(package, kind)| {
                        *kind == material && (material || Some(package.as_str()) == package_id)
                    }),
                }
            })
            .collect();
        tx.commit()?;
        Ok(projection)
    }

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
        if retained >= MAX_SELECTIONS || entries > MAX_ENTRIES {
            return Err(StorageError::Invalid(
                "Release an existing selection before selecting more items".into(),
            ));
        }
        let (query, explicit) = match &command.source {
            CollectionSelectionSource::Matching { query } => (query, None),
            CollectionSelectionSource::Items { query, items } => {
                (query, Some(item_ids(items, query.surface, 256)?))
            }
            CollectionSelectionSource::Amend { .. } => {
                let selected = amend(&tx, command, &id, &digest, MAX_ENTRIES - entries)?;
                tx.commit()?;
                return Ok(selected);
            }
        };
        let (mut compiled, package_revision) = compile_selection(&tx, query, explicit.as_ref())?;
        tx.execute(
            "INSERT INTO collection_selections(id,digest,document) VALUES(?1,?2,NULL)",
            params![id.0, digest],
        )?;
        let count = insert_entries(
            &tx,
            &mut compiled,
            &id,
            query.surface,
            MAX_ENTRIES - entries + 1,
        )?;
        if count > (MAX_ENTRIES - entries) as usize {
            return Err(StorageError::Invalid(
                "Selection exceeds retained item bounds".into(),
            ));
        }
        if explicit.as_ref().is_some_and(|items| items.len() != count) {
            return Err(StorageError::Conflict);
        }
        let count = u32::try_from(count)
            .map_err(|_| StorageError::Invalid("Selection count exceeds bounds".into()))?;
        let selected = CollectionSelection {
            id,
            package_id: query.package_id.clone(),
            package_revision,
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
        let pinned: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM material_bulk_jobs WHERE selection_id=?1 AND retained=1)",
            [&id.0],
            |row| row.get(0),
        )?;
        if pinned {
            return Err(StorageError::Invalid(
                "Release the bulk results before their frozen selection".into(),
            ));
        }
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
