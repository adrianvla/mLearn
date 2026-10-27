//! Rebuildable package metadata, never an authority for learner state.
use crate::{ProfileStore, StorageError, material_validation::bounded};
use mlearn_core::{CollectionCatalogPage, CollectionDescription, CollectionTarget};
use rusqlite::{Connection, OptionalExtension, params};
use std::collections::BTreeSet;

pub(crate) fn migrate(db: &Connection) -> Result<(), StorageError> {
    db.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS collection_catalogs(
            package_id TEXT PRIMARY KEY,revision TEXT NOT NULL,description TEXT NOT NULL,
            total INTEGER NOT NULL,processed INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS collection_targets(
            package_id TEXT NOT NULL,target_id TEXT NOT NULL,ordinal INTEGER NOT NULL,
            document TEXT NOT NULL,search_text TEXT NOT NULL,sort_label TEXT NOT NULL,
            entity_kind TEXT NOT NULL,
            PRIMARY KEY(package_id,target_id),UNIQUE(package_id,ordinal),
            FOREIGN KEY(package_id) REFERENCES collection_catalogs(package_id) ON DELETE CASCADE);
        CREATE INDEX IF NOT EXISTS collection_targets_label ON collection_targets(package_id,sort_label,target_id);
        CREATE INDEX IF NOT EXISTS collection_targets_kind ON collection_targets(package_id,entity_kind,target_id);
        CREATE TABLE IF NOT EXISTS collection_capabilities(
            package_id TEXT NOT NULL,target_id TEXT NOT NULL,capability TEXT NOT NULL,
            PRIMARY KEY(package_id,target_id,capability),
            FOREIGN KEY(package_id,target_id) REFERENCES collection_targets(package_id,target_id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS collection_scopes(
            package_id TEXT NOT NULL,target_id TEXT NOT NULL,scope_id TEXT NOT NULL,
            PRIMARY KEY(package_id,target_id,scope_id),
            FOREIGN KEY(package_id,target_id) REFERENCES collection_targets(package_id,target_id) ON DELETE CASCADE);
        CREATE INDEX IF NOT EXISTS collection_scopes_membership ON collection_scopes(package_id,scope_id,target_id);
        CREATE TABLE IF NOT EXISTS collection_levels(
            package_id TEXT NOT NULL,target_id TEXT NOT NULL,scale_id TEXT NOT NULL,level TEXT NOT NULL,
            PRIMARY KEY(package_id,target_id,scale_id,level),
            FOREIGN KEY(package_id,target_id) REFERENCES collection_targets(package_id,target_id) ON DELETE CASCADE);
        CREATE INDEX IF NOT EXISTS collection_levels_membership ON collection_levels(package_id,scale_id,level,target_id);
        CREATE TABLE IF NOT EXISTS collection_revision(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL);
        INSERT OR IGNORE INTO collection_revision VALUES(1,0);
        CREATE TRIGGER IF NOT EXISTS collection_material_insert AFTER INSERT ON materials
            BEGIN UPDATE collection_revision SET revision=revision+1 WHERE id=1; END;
        CREATE TRIGGER IF NOT EXISTS collection_material_update AFTER UPDATE ON materials
            BEGIN UPDATE collection_revision SET revision=revision+1 WHERE id=1; END;
        CREATE TRIGGER IF NOT EXISTS collection_material_delete AFTER DELETE ON materials
            BEGIN UPDATE collection_revision SET revision=revision+1 WHERE id=1; END;
        CREATE TRIGGER IF NOT EXISTS collection_exclusion_insert AFTER INSERT ON capture_exclusions
            BEGIN UPDATE collection_revision SET revision=revision+1 WHERE id=1; END;
        CREATE TRIGGER IF NOT EXISTS collection_exclusion_update AFTER UPDATE ON capture_exclusions
            BEGIN UPDATE collection_revision SET revision=revision+1 WHERE id=1; END;
        CREATE TRIGGER IF NOT EXISTS collection_exclusion_delete AFTER DELETE ON capture_exclusions
            BEGIN UPDATE collection_revision SET revision=revision+1 WHERE id=1; END;
        CREATE TRIGGER IF NOT EXISTS collection_schedule_insert AFTER INSERT ON review_schedules
            BEGIN UPDATE collection_revision SET revision=revision+1 WHERE id=1; END;
        CREATE TRIGGER IF NOT EXISTS collection_schedule_update AFTER UPDATE ON review_schedules
            BEGIN UPDATE collection_revision SET revision=revision+1 WHERE id=1; END;
        CREATE TRIGGER IF NOT EXISTS collection_schedule_delete AFTER DELETE ON review_schedules
            BEGIN UPDATE collection_revision SET revision=revision+1 WHERE id=1; END;
        CREATE TRIGGER IF NOT EXISTS collection_catalog_insert AFTER INSERT ON collection_catalogs
            BEGIN UPDATE collection_revision SET revision=revision+1 WHERE id=1; END;
        CREATE TRIGGER IF NOT EXISTS collection_catalog_update AFTER UPDATE ON collection_catalogs
            BEGIN UPDATE collection_revision SET revision=revision+1 WHERE id=1; END;
        CREATE TRIGGER IF NOT EXISTS collection_catalog_delete AFTER DELETE ON collection_catalogs
            BEGIN UPDATE collection_revision SET revision=revision+1 WHERE id=1; END;
        PRAGMA user_version=12;
        ",
    )?;
    // This is a rebuildable text index, not authored content. Normalize legacy
    // rows in bounded windows with Rust's Unicode casing, not SQLite's ASCII
    // lower(). New writes use the same normalization in Material's owner.
    let mut after = String::new();
    loop {
        let rows = {
            let mut statement = db
                .prepare("SELECT id,search_text FROM materials WHERE id>?1 ORDER BY id LIMIT 32")?;
            statement
                .query_map([&after], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                })?
                .collect::<Result<Vec<_>, _>>()?
        };
        if rows.is_empty() {
            break;
        }
        for (id, text) in rows {
            let normalized = text.to_lowercase();
            if normalized != text {
                db.execute(
                    "UPDATE materials SET search_text=?2 WHERE id=?1",
                    params![id, normalized],
                )?;
            }
            after = id;
        }
    }
    Ok(())
}

fn namespaced(package: &str, id: &str) -> Result<(), StorageError> {
    bounded(id, 512)?;
    if !id.starts_with(&format!("{package}:")) {
        return Err(StorageError::Invalid(
            "Catalog metadata must use its package namespace".into(),
        ));
    }
    Ok(())
}

pub(crate) fn migrate_cursors(db: &Connection) -> Result<(), StorageError> {
    // Only the rebuildable metadata cache used the earlier numeric/display-only
    // contract. Learner state, authored Material and source data are untouched.
    let has_cursor: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info('collection_catalogs') WHERE name='package_cursor')",
        [], |row| row.get(0),
    )?;
    if !has_cursor {
        db.execute_batch("ALTER TABLE collection_catalogs ADD COLUMN package_cursor TEXT;")?;
    }
    db.execute_batch(
        "DELETE FROM collection_catalogs;
         PRAGMA user_version=13;",
    )?;
    Ok(())
}

fn target(
    package: &str,
    entry: &CollectionTarget,
    description: &CollectionDescription,
) -> Result<String, StorageError> {
    bounded(&entry.summary.target_id, 512)?;
    bounded(&entry.summary.headword, 2048)?;
    if entry.summary.summary.len() > 4096
        || entry.capabilities.is_empty()
        || entry.capabilities.len() > 32
        || entry.scopes.len() > 128
        || entry.levels.len() > 256
    {
        return Err(StorageError::Invalid(
            "Catalog target exceeds bounds".into(),
        ));
    }
    if let Some(reading) = &entry.summary.reading {
        bounded(reading, 2048)?;
    }
    if !description.kinds.iter().any(|kind| kind.id == entry.kind) {
        return Err(StorageError::Invalid(
            "Undeclared catalog target kind".into(),
        ));
    }
    let mut capabilities = BTreeSet::new();
    for id in &entry.capabilities {
        if !description.capabilities.iter().any(|value| &value.id == id) || !capabilities.insert(id)
        {
            return Err(StorageError::Invalid(
                "Invalid catalog target capability".into(),
            ));
        }
    }
    let mut scopes = BTreeSet::new();
    for id in &entry.scopes {
        if !description.scopes.iter().any(|value| &value.id == id) || !scopes.insert(id) {
            return Err(StorageError::Invalid("Invalid catalog target scope".into()));
        }
    }
    let mut memberships = BTreeSet::new();
    for level in &entry.levels {
        if !description
            .levels
            .iter()
            .any(|choice| choice.scale_id == level.scale_id && choice.level == level.level)
            || !memberships.insert((&level.scale_id, &level.level))
        {
            return Err(StorageError::Invalid(
                "Invalid catalog level membership".into(),
            ));
        }
    }
    if let Some(presentation) = &entry.summary.presentation
        && let Some(levels) = &presentation.levels
    {
        let mut keys = BTreeSet::new();
        for level in levels {
            if !description.levels.contains(level)
                || !memberships.contains(&(&level.scale_id, &level.level))
                || !keys.insert((&level.scale_id, &level.level))
            {
                return Err(StorageError::Invalid("Invalid catalog target level".into()));
            }
        }
    }
    for key in entry.extensions.keys() {
        bounded(key, 512)?;
        if !key.contains(':') {
            return Err(StorageError::Invalid(
                "Catalog extension keys must be namespaced".into(),
            ));
        }
    }
    namespaced(package, &entry.kind)?;
    let json = serde_json::to_string(entry)?;
    if json.len() > 16384 {
        return Err(StorageError::Invalid(
            "Catalog target exceeds byte budget".into(),
        ));
    }
    Ok(json)
}

impl ProfileStore {
    /// Starts or resumes an authenticated immutable package catalog projection.
    pub fn begin_collection_catalog(
        &mut self,
        package_id: &str,
        revision: &str,
        metadata: &CollectionDescription,
        total: u32,
    ) -> Result<(u32, Option<String>), StorageError> {
        bounded(package_id, 512)?;
        bounded(revision, 256)?;
        if total > 1_000_000 {
            return Err(StorageError::Invalid(
                "Catalog target count exceeds bounds".into(),
            ));
        }
        metadata
            .validate(package_id)
            .map_err(StorageError::Invalid)?;
        let json = serde_json::to_string(metadata)?;
        let tx = self.connection.transaction()?;
        let existing: Option<(String, String, u32, u32, Option<String>)> = tx.query_row(
            "SELECT revision,description,total,processed,package_cursor FROM collection_catalogs WHERE package_id=?1",
            [package_id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?)),
        ).optional()?;
        if let Some((old_revision, old_description, old_total, processed, cursor)) = existing
            && old_revision == revision
        {
            if old_description != json || old_total != total {
                return Err(StorageError::Invalid(
                    "Immutable catalog metadata changed".into(),
                ));
            }
            return Ok((processed, cursor));
        }
        tx.execute(
            "DELETE FROM collection_catalogs WHERE package_id=?1",
            [package_id],
        )?;
        tx.execute(
            "INSERT INTO collection_catalogs VALUES(?1,?2,?3,?4,0,NULL)",
            params![package_id, revision, json, total],
        )?;
        tx.commit()?;
        Ok((0, None))
    }

    /// Commits a bounded, contiguous page atomically, including its resume cursor.
    pub fn put_collection_catalog_page(
        &mut self,
        package_id: &str,
        revision: &str,
        offset: u32,
        after: Option<&str>,
        page: &CollectionCatalogPage,
    ) -> Result<(), StorageError> {
        if page.items.len() > 64 || serde_json::to_vec(page)?.len() > 262144 {
            return Err(StorageError::Invalid("Catalog page exceeds bounds".into()));
        }
        let count = u32::try_from(page.items.len())
            .map_err(|_| StorageError::Invalid("Catalog page exceeds bounds".into()))?;
        let next = offset
            .checked_add(count)
            .ok_or_else(|| StorageError::Invalid("Catalog offset exceeds bounds".into()))?;
        if next > page.total
            || (count == 0 && offset != page.total)
            || page.next.is_some() != (next < page.total)
            || page
                .next
                .as_deref()
                .is_some_and(|cursor| Some(cursor) == after)
        {
            return Err(StorageError::Invalid(
                "Invalid catalog page continuity".into(),
            ));
        }
        if let Some(cursor) = &page.next {
            bounded(cursor, 4096)?;
        }
        let tx = self.connection.transaction()?;
        let (stored_revision, json, total, processed, cursor): (String, String, u32, u32, Option<String>) =
            tx.query_row(
                "SELECT revision,description,total,processed,package_cursor FROM collection_catalogs WHERE package_id=?1",
                [package_id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?)),
            )?;
        if stored_revision != revision
            || total != page.total
            || processed != offset
            || cursor.as_deref() != after
        {
            return Err(StorageError::Conflict);
        }
        let metadata: CollectionDescription = serde_json::from_str(&json)?;
        for (index, entry) in page.items.iter().enumerate() {
            let json = target(package_id, entry, &metadata)?;
            let search = format!(
                "{}\n{}\n{}",
                entry.summary.headword,
                entry.summary.reading.as_deref().unwrap_or(""),
                entry.summary.summary
            )
            .to_lowercase();
            let ordinal = offset
                + u32::try_from(index)
                    .map_err(|_| StorageError::Invalid("Catalog offset exceeds bounds".into()))?;
            tx.execute(
                "INSERT INTO collection_targets VALUES(?1,?2,?3,?4,?5,?6,?7)",
                params![
                    package_id,
                    entry.summary.target_id,
                    ordinal,
                    json,
                    search,
                    entry.summary.headword.to_lowercase(),
                    entry.kind
                ],
            )?;
            for capability in &entry.capabilities {
                tx.execute(
                    "INSERT INTO collection_capabilities VALUES(?1,?2,?3)",
                    params![package_id, entry.summary.target_id, capability],
                )?;
            }
            for scope in &entry.scopes {
                tx.execute(
                    "INSERT INTO collection_scopes VALUES(?1,?2,?3)",
                    params![package_id, entry.summary.target_id, scope],
                )?;
            }
            for level in &entry.levels {
                tx.execute(
                    "INSERT INTO collection_levels VALUES(?1,?2,?3,?4)",
                    params![
                        package_id,
                        entry.summary.target_id,
                        level.scale_id,
                        level.level
                    ],
                )?;
            }
        }
        tx.execute(
            "UPDATE collection_catalogs SET processed=?2,package_cursor=?3 WHERE package_id=?1",
            params![package_id, next, page.next],
        )?;
        tx.commit()?;
        Ok(())
    }
}
