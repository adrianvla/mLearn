use crate::{
    ProfileStore, StorageError, collection_selection,
    material::{create_in_transaction, update_in_transaction},
    material_read::read_material,
    material_removal::remove_in_transaction,
    material_validation::bounded,
};
use mlearn_core::*;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReleasedSummary {
    phase: MaterialBulkPhase,
    total: u32,
    processed: u32,
    succeeded: u32,
    duplicates: u32,
    failed: u32,
    message: Option<String>,
}

impl From<MaterialBulkStatus> for ReleasedSummary {
    fn from(status: MaterialBulkStatus) -> Self {
        Self {
            phase: status.phase,
            total: status.total,
            processed: status.processed,
            succeeded: status.succeeded,
            duplicates: status.duplicates,
            failed: status.failed,
            message: status.message,
        }
    }
}

impl ReleasedSummary {
    fn receipt(self, command: MaterialBulkStart) -> MaterialBulkStatus {
        MaterialBulkStatus {
            command,
            phase: self.phase,
            total: self.total,
            processed: self.processed,
            succeeded: self.succeeded,
            duplicates: self.duplicates,
            failed: self.failed,
            message: self.message,
            results_available: false,
        }
    }
}

pub(crate) fn migrate(db: &Connection) -> Result<(), StorageError> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS material_bulk_jobs(
            command_id TEXT PRIMARY KEY,digest BLOB NOT NULL,
            selection_id TEXT NOT NULL REFERENCES collection_selections(id),
            retained INTEGER NOT NULL,document TEXT NOT NULL);
         CREATE INDEX IF NOT EXISTS material_bulk_selection ON material_bulk_jobs(selection_id,retained);
         CREATE TABLE IF NOT EXISTS material_bulk_pending(
            command_id TEXT NOT NULL REFERENCES material_bulk_jobs(command_id),
            item_id TEXT NOT NULL,PRIMARY KEY(command_id,item_id));
         CREATE TABLE IF NOT EXISTS material_bulk_results(
            command_id TEXT NOT NULL REFERENCES material_bulk_jobs(command_id),
            item_id TEXT NOT NULL,state TEXT NOT NULL,outcome TEXT NOT NULL,
            PRIMARY KEY(command_id,item_id));
         PRAGMA user_version=16;",
    )?;
    Ok(())
}

pub(crate) fn migrate_projection(db: &Connection) -> Result<(), StorageError> {
    let has_label: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info('material_bulk_results') WHERE name='label')",
        [], |row| row.get(0),
    )?;
    if !has_label {
        db.execute_batch("ALTER TABLE material_bulk_results ADD COLUMN label TEXT;")?;
    }
    // Released receipts retain replay identity/progress, not discarded edit text.
    // Decode in bounded windows; older full documents are a compatible superset.
    let mut after = String::new();
    loop {
        let rows = {
            let mut statement = db.prepare(
                "SELECT command_id,document FROM material_bulk_jobs WHERE retained=0 AND command_id>?1 ORDER BY command_id LIMIT 32",
            )?;
            statement
                .query_map([&after], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })?
                .collect::<Result<Vec<_>, _>>()?
        };
        if rows.is_empty() {
            break;
        }
        for (id, document) in rows {
            let summary: ReleasedSummary = serde_json::from_str(&document)?;
            db.execute(
                "UPDATE material_bulk_jobs SET document=?2 WHERE command_id=?1",
                params![id, serde_json::to_string(&summary)?],
            )?;
            after = id;
        }
    }
    db.pragma_update(None, "user_version", 17)?;
    Ok(())
}

fn status(db: &Connection, command_id: &str) -> Result<MaterialBulkStatus, StorageError> {
    bounded(command_id, 128)?;
    let (retained, document): (bool, String) = db.query_row(
        "SELECT retained,document FROM material_bulk_jobs WHERE command_id=?1",
        [command_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    if !retained {
        return Err(StorageError::Invalid(
            "Bulk results have been released; the command will not be repeated".into(),
        ));
    }
    Ok(serde_json::from_str(&document)?)
}

fn write_status(db: &Connection, status: &MaterialBulkStatus) -> Result<(), StorageError> {
    db.execute(
        "UPDATE material_bulk_jobs SET document=?2,retained=?3 WHERE command_id=?1",
        params![
            status.command.command_id,
            serde_json::to_string(status)?,
            status.results_available
        ],
    )?;
    Ok(())
}

fn retained(status: &MaterialBulkStatus) -> Result<(), StorageError> {
    if !status.results_available {
        return Err(StorageError::Invalid(
            "Bulk results have been released".into(),
        ));
    }
    Ok(())
}

fn running(status: &MaterialBulkStatus) -> Result<(), StorageError> {
    retained(status)?;
    if status.phase != MaterialBulkPhase::Running {
        return Err(StorageError::Conflict);
    }
    Ok(())
}

fn entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<CollectionSelectionEntry> {
    let id: String = row.get(0)?;
    let material_revision: Option<u32> = row.get(3)?;
    Ok(CollectionSelectionEntry {
        item: match material_revision {
            Some(_) => CollectionItemId::Material { id: MaterialId(id) },
            None => CollectionItemId::Target { target_id: id },
        },
        package_id: row.get(1)?,
        package_revision: row.get(2)?,
        material_revision,
    })
}

fn result(
    db: &Connection,
    command_id: &str,
    item_id: &str,
) -> Result<Option<MaterialBulkOutcome>, StorageError> {
    db.query_row(
        "SELECT outcome FROM material_bulk_results WHERE command_id=?1 AND item_id=?2",
        params![command_id, item_id],
        |row| row.get::<_, String>(0),
    )
    .optional()?
    .map(|json| Ok(serde_json::from_str(&json)?))
    .transpose()
}

fn result_label(
    db: &Connection,
    selection_id: &CollectionSelectionId,
    item_id: &str,
) -> Result<String, StorageError> {
    let (phrase,media,headword): (Option<String>,Option<String>,Option<String>) = db.query_row(
        "SELECT json_extract(m.content,'$.phrase'),
         (SELECT json_extract(a.document,'$.name') FROM material_assets r
          JOIN authored_media a ON a.id=r.media_id WHERE r.material_id=m.id ORDER BY r.media_id LIMIT 1),
         json_extract(t.document,'$.summary.headword')
         FROM collection_selection_entries e
         LEFT JOIN materials m ON e.material_revision IS NOT NULL AND m.id=e.item_id
         LEFT JOIN collection_targets t ON e.material_revision IS NULL AND t.package_id=e.package_id AND t.target_id=e.item_id
         WHERE e.selection_id=?1 AND e.item_id=?2",
        params![selection_id.0,item_id], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?)),
    )?;
    Ok([phrase, media, headword]
        .into_iter()
        .flatten()
        .find(|label| !label.trim().is_empty())
        .unwrap_or_else(|| item_id.into()))
}

fn commit_result(
    db: &Connection,
    current: &mut MaterialBulkStatus,
    item_id: &str,
    label: &str,
    outcome: &MaterialBulkOutcome,
) -> Result<(), StorageError> {
    bounded(label, 2048)?;
    if current.processed >= current.total {
        return Err(StorageError::Invalid(
            "Bulk progress exceeds its frozen selection".into(),
        ));
    }
    let state = match outcome {
        MaterialBulkOutcome::Saved { .. } | MaterialBulkOutcome::Removed { .. } => {
            current.succeeded += 1;
            "succeeded"
        }
        MaterialBulkOutcome::Duplicate { .. } => {
            current.duplicates += 1;
            "duplicate"
        }
        MaterialBulkOutcome::Failed { .. } => {
            current.failed += 1;
            "failed"
        }
    };
    db.execute(
        "INSERT INTO material_bulk_results(command_id,item_id,state,outcome,label) VALUES(?1,?2,?3,?4,?5)",
        params![
            current.command.command_id,
            item_id,
            state,
            serde_json::to_string(outcome)?,
            label
        ],
    )?;
    if db.execute(
        "DELETE FROM material_bulk_pending WHERE command_id=?1 AND item_id=?2",
        params![current.command.command_id, item_id],
    )? != 1
    {
        return Err(StorageError::Conflict);
    }
    current.processed += 1;
    write_status(db, current)
}

fn validate_patch(patch: &MaterialBulkPatch) -> Result<(), StorageError> {
    if patch.phrase.is_none()
        && patch.reading.is_none()
        && patch.meaning.is_none()
        && patch.context.is_none()
        && patch.notes.is_none()
        && patch.examples.is_none()
        || [&patch.phrase, &patch.reading]
            .iter()
            .any(|value| value.as_ref().is_some_and(|s| s.len() > 2048))
        || [&patch.meaning, &patch.context, &patch.notes]
            .iter()
            .any(|value| value.as_ref().is_some_and(|s| s.len() > 32768))
        || patch
            .examples
            .as_ref()
            .is_some_and(|values| values.len() > 16 || values.iter().any(|s| s.len() > 4096))
        || serde_json::to_vec(patch)?.len() > 65536
    {
        return Err(StorageError::Invalid(
            "Bulk edit is empty or exceeds Material bounds".into(),
        ));
    }
    Ok(())
}

impl ProfileStore {
    /// The selection remains pinned until its bulk results are explicitly released.
    pub fn begin_material_bulk(
        &mut self,
        command: &MaterialBulkStart,
    ) -> Result<(MaterialBulkStatus, bool), StorageError> {
        bounded(&command.command_id, 128)?;
        let digest = Sha256::digest(serde_json::to_vec(command)?).to_vec();
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let previous: Option<(Vec<u8>, bool, String)> = tx
            .query_row(
                "SELECT digest,retained,document FROM material_bulk_jobs WHERE command_id=?1",
                [&command.command_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;
        if let Some((previous, retained, document)) = previous {
            if previous != digest {
                return Err(StorageError::Invalid(
                    "Bulk command identity was reused".into(),
                ));
            }
            let status = if retained {
                serde_json::from_str(&document)?
            } else {
                serde_json::from_str::<ReleasedSummary>(&document)?.receipt(command.clone())
            };
            return Ok((status, false));
        }
        let selected = collection_selection::selection(&tx, &command.selection_id)?;
        let total = match &command.action {
            MaterialBulkAction::Add { .. } if selected.material_count == 0 => selected.target_count,
            MaterialBulkAction::Edit { patch } if selected.target_count == 0 => {
                validate_patch(patch)?;
                selected.material_count
            }
            MaterialBulkAction::Exclude { .. } | MaterialBulkAction::Remove
                if selected.target_count == 0 =>
            {
                selected.material_count
            }
            _ => {
                return Err(StorageError::Invalid(
                    "Bulk action does not match the selected item kind".into(),
                ));
            }
        };
        let (jobs, retained_items, active): (u32, u32, u32) = tx.query_row(
            "SELECT COUNT(*),COALESCE(SUM(json_extract(document,'$.total')),0),
             COALESCE(SUM(json_extract(document,'$.phase')='running'),0)
             FROM material_bulk_jobs WHERE retained=1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;
        if total == 0
            || total > 1_000_000
            || jobs >= 8
            || retained_items > 1_000_000 - total
            || active != 0
        {
            return Err(StorageError::Invalid(
                "Bulk work requires a nonempty selection, available result capacity and no active operation".into(),
            ));
        }
        let current = MaterialBulkStatus {
            command: command.clone(),
            phase: MaterialBulkPhase::Running,
            total,
            processed: 0,
            succeeded: 0,
            duplicates: 0,
            failed: 0,
            results_available: true,
            message: None,
        };
        let document = serde_json::to_string(&current)?;
        let retained_bytes: u64 = tx.query_row(
            "SELECT COALESCE(SUM(length(CAST(document AS BLOB))),0) FROM material_bulk_jobs WHERE retained=1",
            [], |row| row.get(0),
        )?;
        // Recovery lists all eight handles. Reserve wire headroom for their
        // bounded failure messages instead of admitting an unreadable payload.
        if retained_bytes + document.len() as u64 > 262144 {
            return Err(StorageError::Invalid(
                "Release existing bulk results before retaining more edit content".into(),
            ));
        }
        tx.execute(
            "INSERT INTO material_bulk_jobs(command_id,digest,selection_id,retained,document) VALUES(?1,?2,?3,1,?4)",
            params![command.command_id, digest, command.selection_id.0, document],
        )?;
        let admitted = tx.execute(
            "INSERT INTO material_bulk_pending SELECT ?1,item_id FROM collection_selection_entries WHERE selection_id=?2",
            params![command.command_id,command.selection_id.0],
        )?;
        if admitted != total as usize {
            return Err(StorageError::Conflict);
        }
        tx.commit()?;
        Ok((current, true))
    }

    pub fn material_bulk_status(
        &self,
        command_id: &str,
    ) -> Result<MaterialBulkStatus, StorageError> {
        status(&self.connection, command_id)
    }

    pub fn material_bulk_jobs(&self) -> Result<Vec<MaterialBulkStatus>, StorageError> {
        let mut statement = self.connection.prepare(
            "SELECT document FROM material_bulk_jobs WHERE retained=1 ORDER BY command_id LIMIT 8",
        )?;
        let documents = statement.query_map([], |row| row.get::<_, String>(0))?;
        documents
            .map(|document| Ok(serde_json::from_str(&document?)?))
            .collect()
    }

    pub fn next_material_bulk_item(
        &self,
        command_id: &str,
    ) -> Result<Option<CollectionSelectionEntry>, StorageError> {
        let tx = self.connection.unchecked_transaction()?;
        let current = status(&tx, command_id)?;
        running(&current)?;
        let next = tx
            .query_row(
                "SELECT e.item_id,e.package_id,e.package_revision,e.material_revision
             FROM material_bulk_pending p JOIN collection_selection_entries e
             ON e.selection_id=?1 AND e.item_id=p.item_id
             WHERE p.command_id=?2 ORDER BY p.item_id LIMIT 1",
                params![current.command.selection_id.0, command_id],
                entry,
            )
            .optional()?;
        tx.commit()?;
        Ok(next)
    }

    /// Mutation and progress are one commit. A crash cannot turn a successful
    /// frozen edit into an apparently pending item with stale preconditions.
    pub fn apply_material_bulk_item(
        &mut self,
        command_id: &str,
        item_id: &str,
        add_content: Option<&MaterialContent>,
    ) -> Result<MaterialBulkOutcome, StorageError> {
        bounded(item_id, 512)?;
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let mut current = status(&tx, command_id)?;
        retained(&current)?;
        if let Some(outcome) = result(&tx, command_id, item_id)? {
            return Ok(outcome);
        }
        running(&current)?;
        let selected = tx.query_row(
            "SELECT item_id,package_id,package_revision,material_revision
             FROM collection_selection_entries WHERE selection_id=?1 AND item_id=?2",
            params![current.command.selection_id.0, item_id],
            entry,
        )?;
        let label = match (&current.command.action, add_content) {
            (MaterialBulkAction::Add { .. }, Some(content))
                if !content.phrase.trim().is_empty() =>
            {
                content.phrase.clone()
            }
            _ => result_label(&tx, &current.command.selection_id, item_id)?,
        };
        let item_command = format!(
            "bulk-{:x}",
            Sha256::digest(serde_json::to_vec(&(command_id, item_id))?)
        );
        let outcome = match &current.command.action {
            MaterialBulkAction::Add { distinct } => {
                let content = add_content.ok_or_else(|| {
                    StorageError::Invalid("Package-produced Material is required".into())
                })?;
                let CollectionItemId::Target { target_id } = &selected.item else {
                    return Err(StorageError::Invalid(
                        "Bulk add requires a selected target".into(),
                    ));
                };
                if content.package_id != selected.package_id
                    || content.target_id.as_ref() != Some(target_id)
                    || content.package_revision != selected.package_revision
                    || content.source.is_some()
                    || !content.attachments.is_empty()
                {
                    return Err(StorageError::Invalid(
                        "Bulk add changed its frozen package identity or provenance".into(),
                    ));
                }
                create_in_transaction(
                    &tx,
                    &MaterialCreate {
                        command_id: item_command,
                        content: content.clone(),
                        distinct: *distinct,
                        media_imports: vec![],
                    },
                    &[],
                )?
            }
            MaterialBulkAction::Edit { .. } | MaterialBulkAction::Exclude { .. } => {
                let CollectionItemId::Material { id } = &selected.item else {
                    return Err(StorageError::Invalid(
                        "Bulk edit requires a selected Material".into(),
                    ));
                };
                let material = read_material(&tx, id)?;
                let revision = selected.material_revision.ok_or_else(|| {
                    StorageError::Invalid("Missing frozen Material revision".into())
                })?;
                if material.revision != revision {
                    return Err(StorageError::Conflict);
                }
                let mut content = material.content;
                let excluded = match &current.command.action {
                    MaterialBulkAction::Edit { patch } => {
                        if let Some(value) = &patch.phrase {
                            content.phrase.clone_from(value);
                        }
                        if let Some(value) = &patch.reading {
                            content.reading.clone_from(value);
                        }
                        if let Some(value) = &patch.meaning {
                            content.meaning.clone_from(value);
                        }
                        if let Some(value) = &patch.context {
                            content.context.clone_from(value);
                        }
                        if let Some(value) = &patch.notes {
                            content.notes.clone_from(value);
                        }
                        if let Some(value) = &patch.examples {
                            content.examples.clone_from(value);
                        }
                        material.excluded
                    }
                    MaterialBulkAction::Exclude { excluded } => *excluded,
                    _ => return Err(StorageError::Invalid("Unexpected bulk edit action".into())),
                };
                update_in_transaction(
                    &tx,
                    &MaterialEdit {
                        command_id: item_command,
                        id: id.clone(),
                        expected_revision: revision,
                        content,
                        excluded,
                        media_imports: vec![],
                    },
                    &[],
                )?
            }
            MaterialBulkAction::Remove => {
                let CollectionItemId::Material { id } = &selected.item else {
                    return Err(StorageError::Invalid(
                        "Bulk removal requires a selected Material".into(),
                    ));
                };
                let revision = selected.material_revision.ok_or_else(|| {
                    StorageError::Invalid("Missing frozen Material revision".into())
                })?;
                let removed = remove_in_transaction(
                    &tx,
                    &MaterialRemove {
                        command_id: item_command,
                        id: id.clone(),
                        expected_revision: revision,
                    },
                )?;
                let outcome = MaterialBulkOutcome::Removed {
                    material_id: removed.id,
                    committed_revision: removed.committed_revision,
                };
                commit_result(&tx, &mut current, item_id, &label, &outcome)?;
                tx.commit()?;
                return Ok(outcome);
            }
        };
        let outcome = match outcome {
            MaterialWriteResult::Saved {
                material,
                reused,
                committed_revision,
            } => MaterialBulkOutcome::Saved {
                material_id: material.id,
                committed_revision,
                reused,
            },
            MaterialWriteResult::Duplicate { items } => MaterialBulkOutcome::Duplicate {
                material_ids: items.into_iter().map(|item| item.id).collect(),
            },
        };
        commit_result(&tx, &mut current, item_id, &label, &outcome)?;
        tx.commit()?;
        Ok(outcome)
    }

    pub fn fail_material_bulk_item(
        &mut self,
        command_id: &str,
        item_id: &str,
        message: &str,
    ) -> Result<MaterialBulkOutcome, StorageError> {
        bounded(item_id, 512)?;
        bounded(message, 2048)?;
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let mut current = status(&tx, command_id)?;
        retained(&current)?;
        if let Some(outcome) = result(&tx, command_id, item_id)? {
            return Ok(outcome);
        }
        running(&current)?;
        let exists: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM collection_selection_entries WHERE selection_id=?1 AND item_id=?2)",
            params![current.command.selection_id.0,item_id], |row| row.get(0),
        )?;
        if !exists {
            return Err(StorageError::Invalid(
                "Item is outside the frozen selection".into(),
            ));
        }
        let outcome = MaterialBulkOutcome::Failed {
            message: message.into(),
        };
        let label = result_label(&tx, &current.command.selection_id, item_id)?;
        commit_result(&tx, &mut current, item_id, &label, &outcome)?;
        tx.commit()?;
        Ok(outcome)
    }

    pub fn material_bulk_page(
        &self,
        command_id: &str,
        after: Option<&str>,
    ) -> Result<MaterialBulkPage, StorageError> {
        if let Some(after) = after {
            bounded(after, 512)?;
        }
        let tx = self.connection.unchecked_transaction()?;
        let current = status(&tx, command_id)?;
        retained(&current)?;
        let rows = {
            let mut statement = tx.prepare(
                "SELECT e.item_id,e.package_id,e.package_revision,e.material_revision,r.outcome,r.label
                 FROM collection_selection_entries e LEFT JOIN material_bulk_results r
                 ON r.command_id=?1 AND r.item_id=e.item_id
                 WHERE e.selection_id=?2 AND (?3 IS NULL OR e.item_id>?3)
                 ORDER BY e.item_id LIMIT 25",
            )?;
            statement
                .query_map(
                    params![command_id, current.command.selection_id.0, after],
                    |row| {
                        Ok((
                            entry(row)?,
                            row.get::<_, Option<String>>(4)?,
                            row.get::<_, Option<String>>(5)?,
                        ))
                    },
                )?
                .collect::<Result<Vec<_>, _>>()?
        };
        let mut page = MaterialBulkPage {
            items: vec![],
            next: None,
        };
        for (index, (entry, outcome, label)) in rows.iter().take(24).enumerate() {
            let previous = page.next.clone();
            let label = match label {
                Some(label) => label.clone(),
                None => result_label(
                    &tx,
                    &current.command.selection_id,
                    match &entry.item {
                        CollectionItemId::Target { target_id } => target_id,
                        CollectionItemId::Material { id } => &id.0,
                    },
                )?,
            };
            page.items.push(MaterialBulkItem {
                entry: entry.clone(),
                label,
                outcome: outcome
                    .as_ref()
                    .map(|json| serde_json::from_str(json))
                    .transpose()?,
            });
            page.next = if index + 1 < rows.len() {
                Some(match &entry.item {
                    CollectionItemId::Target { target_id } => target_id.clone(),
                    CollectionItemId::Material { id } => id.0.clone(),
                })
            } else {
                None
            };
            if serde_json::to_vec(&page)?.len() > 262144 {
                page.items.pop();
                page.next = previous;
                if page.items.is_empty() {
                    return Err(StorageError::Invalid(
                        "Bulk result exceeds page bounds".into(),
                    ));
                }
                break;
            }
        }
        tx.commit()?;
        Ok(page)
    }

    pub fn cancel_material_bulk(
        &mut self,
        command_id: &str,
    ) -> Result<MaterialBulkStatus, StorageError> {
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let mut current = status(&tx, command_id)?;
        retained(&current)?;
        if current.phase == MaterialBulkPhase::Running {
            current.phase = MaterialBulkPhase::Cancelled;
            write_status(&tx, &current)?;
        }
        tx.commit()?;
        Ok(current)
    }

    pub fn retry_material_bulk(
        &mut self,
        command_id: &str,
    ) -> Result<MaterialBulkStatus, StorageError> {
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let mut current = status(&tx, command_id)?;
        retained(&current)?;
        match current.phase {
            MaterialBulkPhase::Running => return Err(StorageError::Conflict),
            MaterialBulkPhase::Completed => return Ok(current),
            MaterialBulkPhase::Failed
            | MaterialBulkPhase::Cancelled
            | MaterialBulkPhase::Interrupted => {}
        }
        let active: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM material_bulk_jobs WHERE retained=1 AND json_extract(document,'$.phase')='running')",
            [], |row| row.get(0),
        )?;
        if active {
            return Err(StorageError::Conflict);
        }
        tx.execute(
            "INSERT INTO material_bulk_pending SELECT command_id,item_id FROM material_bulk_results WHERE command_id=?1 AND state='failed'",
            [command_id],
        )?;
        tx.execute(
            "DELETE FROM material_bulk_results WHERE command_id=?1 AND state='failed'",
            [command_id],
        )?;
        current.processed -= current.failed;
        current.failed = 0;
        current.phase = MaterialBulkPhase::Running;
        current.message = None;
        write_status(&tx, &current)?;
        tx.commit()?;
        Ok(current)
    }

    pub fn finish_material_bulk(
        &mut self,
        command_id: &str,
        error: Option<&str>,
    ) -> Result<MaterialBulkStatus, StorageError> {
        if let Some(error) = error {
            bounded(error, 2048)?;
        }
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let mut current = status(&tx, command_id)?;
        retained(&current)?;
        if current.phase == MaterialBulkPhase::Running {
            current.phase = if error.is_some() || current.failed != 0 {
                MaterialBulkPhase::Failed
            } else if current.processed == current.total {
                MaterialBulkPhase::Completed
            } else {
                MaterialBulkPhase::Interrupted
            };
            current.message = error.map(String::from);
            write_status(&tx, &current)?;
        }
        tx.commit()?;
        Ok(current)
    }

    pub fn interrupt_material_bulk(&mut self) -> Result<(), StorageError> {
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let jobs = {
            let mut statement = tx.prepare(
                "SELECT document FROM material_bulk_jobs WHERE retained=1 AND json_extract(document,'$.phase')='running' LIMIT 8",
            )?;
            statement
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?
        };
        for document in jobs {
            let mut current: MaterialBulkStatus = serde_json::from_str(&document)?;
            current.phase = MaterialBulkPhase::Interrupted;
            write_status(&tx, &current)?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn release_material_bulk(&mut self, command_id: &str) -> Result<(), StorageError> {
        bounded(command_id, 128)?;
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let is_retained: bool = tx.query_row(
            "SELECT retained FROM material_bulk_jobs WHERE command_id=?1",
            [command_id],
            |row| row.get(0),
        )?;
        if !is_retained {
            return Ok(());
        }
        let current = status(&tx, command_id)?;
        if current.phase == MaterialBulkPhase::Running {
            return Err(StorageError::Conflict);
        }
        tx.execute(
            "DELETE FROM material_bulk_pending WHERE command_id=?1",
            [command_id],
        )?;
        tx.execute(
            "DELETE FROM material_bulk_results WHERE command_id=?1",
            [command_id],
        )?;
        tx.execute(
            "UPDATE material_bulk_jobs SET retained=0,document=?2 WHERE command_id=?1",
            params![
                command_id,
                serde_json::to_string(&ReleasedSummary::from(current))?
            ],
        )?;
        tx.commit()?;
        Ok(())
    }
}
