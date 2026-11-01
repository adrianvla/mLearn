//! Lazy canonical Practice over immutable Knowledge selection membership.
//! Writes participate in the caller's Review transaction and receipt.
use crate::{
    collection_selection, material_validation::bounded, review_admission, review_read,
    review_target_practice, ProfileStore, StorageError,
};
use mlearn_core::*;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::BTreeSet;

pub(crate) fn migrate(db: &Connection) -> Result<(), StorageError> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS review_collection_scopes(
            session_id TEXT PRIMARY KEY REFERENCES review_sessions(id),
            selection_id TEXT NOT NULL,after_id TEXT NOT NULL,exhausted INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS review_collection_selection
            ON review_collection_scopes(selection_id);
        PRAGMA user_version=21;",
    )?;
    Ok(())
}

fn mode(mode: &ReviewMode) -> Result<(&CollectionSelectionId, &[String]), StorageError> {
    match mode {
        ReviewMode::CollectionPractice {
            selection_id,
            capabilities,
        } => Ok((selection_id, capabilities)),
        ReviewMode::Continuous
        | ReviewMode::Finite { .. }
        | ReviewMode::Practice { .. }
        | ReviewMode::TargetPractice { .. } => {
            Err(StorageError::Invalid("Expected collection Practice".into()))
        }
    }
}

fn selection(
    db: &Connection,
    id: &CollectionSelectionId,
) -> Result<CollectionSelection, StorageError> {
    let selected = collection_selection::selection(db, id)?;
    if selected.id != *id
        || selected.target_count == 0
        || selected.material_count != 0
        || selected.package_id.is_none()
        || selected.package_revision.is_none()
    {
        return Err(StorageError::Invalid(
            "Collection Practice requires a nonempty frozen Knowledge selection".into(),
        ));
    }
    Ok(selected)
}

fn read_target(
    db: &Connection,
    selected: &CollectionSelection,
    after: Option<&str>,
    capabilities: &[String],
) -> Result<TargetPracticeItem, StorageError> {
    // Bound the copy before canonical validation owns capability uniqueness
    // and target eligibility.
    if !(1..=32).contains(&capabilities.len()) {
        return Err(StorageError::Invalid(
            "Collection Practice requires 1..32 capabilities".into(),
        ));
    }
    for capability in capabilities {
        bounded(capability, 512)?;
    }
    // Keep continuation an indexed seek, rather than scanning the admitted
    // prefix through a nullable-cursor OR on every operation.
    let sql = match after {
        Some(_) => {
            "SELECT item_id,package_id,package_revision,material_revision
             FROM collection_selection_entries
             WHERE selection_id=?1 AND item_id>?2 ORDER BY item_id LIMIT 1"
        }
        None => {
            "SELECT item_id,package_id,package_revision,material_revision
             FROM collection_selection_entries
             WHERE selection_id=?1 AND ?2 IS NULL ORDER BY item_id LIMIT 1"
        }
    };
    let row: Option<(String, String, Option<String>, Option<u32>)> = db
        .query_row(sql, params![selected.id.0, after], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .optional()?;
    let (target_id, package_id, package_revision, material_revision) = row.ok_or_else(|| {
        StorageError::Invalid("Frozen collection Practice target is missing".into())
    })?;
    if material_revision.is_some()
        || Some(&package_id) != selected.package_id.as_ref()
        || package_revision != selected.package_revision
    {
        return Err(StorageError::Invalid(
            "Frozen collection Practice target changed its identity".into(),
        ));
    }
    let item = TargetPracticeItem {
        package_id,
        package_revision: package_revision.ok_or_else(|| {
            StorageError::Invalid("Frozen collection Practice revision is missing".into())
        })?,
        target_id,
        capabilities: capabilities.to_vec(),
        // A list is answer-disclosing, but is not an arbitrary saved source anchor.
        source: None,
    };
    review_target_practice::validate(db, std::slice::from_ref(&item), &[ReviewAssistance::Source])?;
    Ok(item)
}

pub(crate) fn first(
    db: &Connection,
    selection_id: &CollectionSelectionId,
    capabilities: &[String],
) -> Result<TargetPracticeItem, StorageError> {
    let selected = selection(db, selection_id)?;
    read_target(db, &selected, None, capabilities)
}

fn scope(db: &Connection, session: &ReviewSession) -> Result<(String, bool), StorageError> {
    let (selection_id, _) = mode(&session.mode)?;
    let row: Option<(String, String, bool)> = db
        .query_row(
            "SELECT selection_id,after_id,exhausted
             FROM review_collection_scopes WHERE session_id=?1",
            [&session.id.0],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    let (stored, after, exhausted) =
        row.ok_or_else(|| StorageError::Invalid("Collection Practice cursor is missing".into()))?;
    if stored != selection_id.0 {
        return Err(StorageError::Invalid(
            "Collection Practice cursor belongs to another selection".into(),
        ));
    }
    bounded(&after, 512)?;
    Ok((after, exhausted))
}

pub(crate) fn candidate(
    db: &Connection,
    session: &ReviewSession,
) -> Result<Option<TargetPracticeItem>, StorageError> {
    let (selection_id, capabilities) = mode(&session.mode)?;
    let (after, exhausted) = scope(db, session)?;
    if exhausted {
        // Fully queued work owns its content; the selection may already be released.
        return Ok(None);
    }
    let selected = selection(db, selection_id)?;
    let cursor_exists: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM collection_selection_entries
         WHERE selection_id=?1 AND item_id=?2 AND package_id=?3
         AND package_revision=?4 AND material_revision IS NULL)",
        params![
            selection_id.0,
            after,
            selected.package_id,
            selected.package_revision
        ],
        |row| row.get(0),
    )?;
    if !cursor_exists {
        return Err(StorageError::Invalid(
            "Frozen collection Practice cursor target is missing or changed".into(),
        ));
    }
    read_target(db, &selected, Some(&after), capabilities).map(Some)
}

pub(crate) fn admit_start(
    db: &Connection,
    mode_value: &ReviewMode,
    admissions: &[ReviewAdmission],
) -> Result<u32, StorageError> {
    let (selection_id, capabilities) = mode(mode_value)?;
    let item = first(db, selection_id, capabilities)?;
    review_target_practice::admit(
        db,
        std::slice::from_ref(&item),
        &[ReviewAssistance::Source],
        admissions,
    )
}

fn has_later(
    db: &Connection,
    selection_id: &CollectionSelectionId,
    after: &str,
) -> Result<bool, StorageError> {
    Ok(db.query_row(
        "SELECT EXISTS(SELECT 1 FROM collection_selection_entries
         WHERE selection_id=?1 AND item_id>?2)",
        params![selection_id.0, after],
        |row| row.get(0),
    )?)
}

pub(crate) fn start(db: &Connection, session: &ReviewSession) -> Result<(), StorageError> {
    let (selection_id, capabilities) = mode(&session.mode)?;
    let item = first(db, selection_id, capabilities)?;
    let exhausted = !has_later(db, selection_id, &item.target_id)?;
    db.execute(
        "INSERT INTO review_collection_scopes(session_id,selection_id,after_id,exhausted)
         VALUES(?1,?2,?3,?4)",
        params![session.id.0, selection_id.0, item.target_id, exhausted],
    )?;
    Ok(())
}

pub(crate) fn pending(db: &Connection, id: &ReviewSessionId) -> Result<bool, StorageError> {
    Ok(db.query_row(
        "SELECT EXISTS(SELECT 1 FROM review_work WHERE session_id=?1 AND admitted=0)",
        [&id.0],
        |row| row.get(0),
    )?)
}

pub(crate) fn append(
    db: &Connection,
    session: &ReviewSession,
    admissions: &[ReviewAdmission],
) -> Result<(), StorageError> {
    let (selection_id, _) = mode(&session.mode)?;
    let (_, exhausted) = scope(db, session)?;
    if pending(db, &session.id)? || exhausted {
        if !admissions.is_empty() {
            return Err(StorageError::Invalid(
                "Collection Practice cannot append while queued or exhausted".into(),
            ));
        }
        return Ok(());
    }
    let item = candidate(db, session)?
        .ok_or_else(|| StorageError::Invalid("Collection Practice candidate is missing".into()))?;
    review_target_practice::admit(
        db,
        std::slice::from_ref(&item),
        &[ReviewAssistance::Source],
        admissions,
    )?;
    let mut work_ids = BTreeSet::new();
    for admission in admissions {
        review_admission::validate_admission(admission)?;
        let exists: bool = db.query_row(
            "SELECT EXISTS(SELECT 1 FROM review_work WHERE session_id=?1 AND work_id=?2)",
            params![session.id.0, admission.work_id.0],
            |row| row.get(0),
        )?;
        if exists || !work_ids.insert(&admission.work_id.0) {
            return Err(StorageError::Invalid(
                "Duplicate collection Practice work".into(),
            ));
        }
    }
    let mut position: i64 = db.query_row(
        "SELECT COALESCE(MAX(position),-1) FROM review_work WHERE session_id=?1",
        [&session.id.0],
        |row| row.get(0),
    )?;
    for admission in admissions {
        position = position.checked_add(1).ok_or_else(|| {
            StorageError::Invalid("Collection Practice position exhausted".into())
        })?;
        db.execute(
            "INSERT INTO review_work(session_id,work_id,position,admission) VALUES(?1,?2,?3,?4)",
            params![
                session.id.0,
                admission.work_id.0,
                position,
                serde_json::to_string(admission)?
            ],
        )?;
    }
    let exhausted = !has_later(db, selection_id, &item.target_id)?;
    db.execute(
        "UPDATE review_collection_scopes SET after_id=?2,exhausted=?3 WHERE session_id=?1",
        params![session.id.0, item.target_id, exhausted],
    )?;
    Ok(())
}

pub(crate) fn exhausted(db: &Connection, id: &ReviewSessionId) -> Result<bool, StorageError> {
    let value: Option<bool> = db
        .query_row(
            "SELECT exhausted FROM review_collection_scopes WHERE session_id=?1",
            [&id.0],
            |row| row.get(0),
        )
        .optional()?;
    value.ok_or_else(|| StorageError::Invalid("Collection Practice cursor is missing".into()))
}

pub(crate) fn selection_pinned(
    db: &Connection,
    id: &CollectionSelectionId,
) -> Result<bool, StorageError> {
    bounded(&id.0, 128)?;
    Ok(db.query_row(
        "SELECT EXISTS(SELECT 1 FROM review_collection_scopes c
         JOIN review_sessions s ON s.id=c.session_id
         WHERE c.selection_id=?1 AND c.exhausted=0
         AND json_extract(s.projection,'$.state') != 'stopped')",
        [&id.0],
        |row| row.get(0),
    )?)
}

impl ProfileStore {
    pub fn review_collection_first(
        &self,
        selection_id: &CollectionSelectionId,
        capabilities: &[String],
    ) -> Result<TargetPracticeItem, StorageError> {
        let tx = self.connection.unchecked_transaction()?;
        let item = first(&tx, selection_id, capabilities)?;
        tx.commit()?;
        Ok(item)
    }

    pub fn review_collection_candidate(
        &self,
        session_id: &ReviewSessionId,
    ) -> Result<Option<TargetPracticeItem>, StorageError> {
        let tx = self.connection.unchecked_transaction()?;
        let session = review_read::session(&tx, session_id)?;
        let item = candidate(&tx, &session)?;
        tx.commit()?;
        Ok(item)
    }

    pub fn review_collection_pending(
        &self,
        session_id: &ReviewSessionId,
    ) -> Result<bool, StorageError> {
        pending(&self.connection, session_id)
    }
}
