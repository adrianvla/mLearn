//! Bounded unmeasured keys, independent of claims and scheduled retention work.
use crate::{
    ProfileStore, StorageError, collection::compile_collection, knowledge,
    material_validation::bounded, review_target_practice,
};
use mlearn_core::*;
use rusqlite::{Connection, OptionalExtension, params_from_iter, types::Value};

pub(crate) fn candidates(
    db: &Connection,
    query: &CalibrationQuery,
) -> Result<Vec<TargetPracticeItem>, StorageError> {
    bounded(&query.package_id, 512)?;
    bounded(&query.capability, 512)?;
    if !(1..=32).contains(&query.limit) {
        return Err(StorageError::Invalid(
            "Word Sync requires a bound of 1..32 targets".into(),
        ));
    }
    let catalog: Option<(String, String, u32, u32)> = db.query_row(
        "SELECT revision,description,processed,total FROM collection_catalogs WHERE package_id=?1",
        [&query.package_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    ).optional()?;
    let (revision, description, processed, total) = catalog.ok_or_else(|| {
        StorageError::Invalid("Prepare this package's Knowledge catalog before Word Sync".into())
    })?;
    if processed != total {
        return Err(StorageError::Invalid(
            "Knowledge catalog preparation is incomplete".into(),
        ));
    }
    let description: CollectionDescription = serde_json::from_str(&description)?;
    if !description
        .calibration_capabilities
        .as_ref()
        .is_some_and(|capabilities| capabilities.contains(&query.capability))
    {
        return Err(StorageError::Invalid(
            "Calibration capability is unavailable".into(),
        ));
    }
    let mut compiled = compile_collection(
        &CollectionQuery {
            package_id: Some(query.package_id.clone()),
            surface: CollectionSurface::Knowledge,
            filter: query.filter.clone(),
            sort: CollectionSort::Default,
            after: None,
        },
        &description,
    )?;
    compiled.values.push(Value::Text(query.capability.clone()));
    let capability = format!("?{}", compiled.values.len());
    // A claim is not an assessment. Both claimed-known and claimed-unknown keys
    // remain eligible until an active independent observation measures this key.
    let assessed = knowledge::assessed_sql("t.package_id", "t.target_id", &capability);
    let mut statement = db.prepare(&format!(
        "SELECT t.target_id {} AND ({assessed}) IS NULL
         AND EXISTS(SELECT 1 FROM json_each(t.document,'$.calibrationCapabilities') f
             WHERE f.value={capability})
         AND NOT EXISTS(SELECT 1 FROM capture_exclusions e WHERE e.package_id=t.package_id
             AND e.target_id=t.target_id AND e.excluded=1)
         ORDER BY t.target_id LIMIT {}",
        compiled.membership, query.limit,
    ))?;
    statement
        .query_map(params_from_iter(&compiled.values), |row| {
            row.get::<_, String>(0)
        })?
        .map(|target_id| {
            Ok(TargetPracticeItem {
                package_id: query.package_id.clone(),
                package_revision: revision.clone(),
                target_id: target_id?,
                capabilities: vec![query.capability.clone()],
                source: None,
            })
        })
        .collect()
}

pub(crate) fn validate(
    db: &Connection,
    query: &CalibrationQuery,
    items: &[TargetPracticeItem],
) -> Result<(), StorageError> {
    if items.is_empty() || items != candidates(db, query)? {
        return Err(StorageError::Invalid(
            "Unmeasured Word Sync scope changed; prepare it again".into(),
        ));
    }
    review_target_practice::validate(db, items, &[])
}

pub(crate) fn admit(
    db: &Connection,
    query: &CalibrationQuery,
    items: &[TargetPracticeItem],
    admissions: &[ReviewAdmission],
) -> Result<u32, StorageError> {
    validate(db, query, items)?;
    review_target_practice::admit(db, items, &[], admissions)
}

impl ProfileStore {
    pub fn calibration_candidates(
        &self,
        query: &CalibrationQuery,
    ) -> Result<Vec<TargetPracticeItem>, StorageError> {
        let tx = self.connection.unchecked_transaction()?;
        let items = candidates(&tx, query)?;
        tx.commit()?;
        Ok(items)
    }

    pub fn validate_calibration(
        &self,
        query: &CalibrationQuery,
        items: &[TargetPracticeItem],
    ) -> Result<(), StorageError> {
        let tx = self.connection.unchecked_transaction()?;
        validate(&tx, query, items)?;
        tx.commit()?;
        Ok(())
    }
}
