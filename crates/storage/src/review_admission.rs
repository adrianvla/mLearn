use crate::StorageError;
use crate::{material_validation::bounded, review_read};
use mlearn_core::*;
use rusqlite::params;
use rusqlite::{Connection, OptionalExtension};
use sha2::{Digest, Sha256};

pub(crate) fn validate_admission(value: &ReviewAdmission) -> Result<(), StorageError> {
    if let Some(task) = &value.task {
        task.validate()
            .map_err(|error| StorageError::Invalid(error.to_string()))?;
        if task
            .answer_supplied
            .iter()
            .any(|key| key.package_id != value.package_id)
        {
            return Err(StorageError::Invalid(
                "Task answer disclosure belongs to another package".into(),
            ));
        }
    }
    for id in [
        &value.work_id.0,
        &value.package_id,
        &value.package_version,
        &value.package_revision,
    ] {
        bounded(id, 512)?;
    }
    match &value.subject {
        ReviewSubject::Material {
            material_id,
            material_revision,
        } => {
            bounded(&material_id.0, 512)?;
            if *material_revision == 0 {
                return Err(StorageError::Invalid("Invalid Material revision".into()));
            }
        }
        ReviewSubject::Target { target_id } => {
            bounded(target_id, 512)?;
            if value.task.is_none()
                || value.probe.targets.iter().any(|row| {
                    row.key
                        .as_ref()
                        .is_none_or(|key| key.target_id != *target_id)
                })
            {
                return Err(StorageError::Invalid(
                    "Invalid canonical Review subject".into(),
                ));
            }
        }
    }
    if !review_compatible(&value.probe)
        || value.scheduler_version != REVIEW_POLICY_VERSION
        || serde_json::to_vec(value)?.len() > 131072
        || value.probe.targets.iter().any(|t| {
            t.key
                .as_ref()
                .is_some_and(|k| k.package_id != value.package_id)
        })
        || value
            .probe
            .supplied
            .iter()
            .any(|key| key.package_id != value.package_id)
    {
        return Err(StorageError::Invalid("Invalid Review admission".into()));
    }
    Ok(())
}

pub(crate) fn practice_items(items: &[PracticeItem]) -> Result<(), StorageError> {
    let mut ids = std::collections::BTreeSet::new();
    if !(1..=128).contains(&items.len())
        || items.iter().any(|item| {
            item.material_id.0.is_empty()
                || item.material_id.0.len() > 512
                || !ids.insert(&item.material_id.0)
        })
    {
        return Err(StorageError::Invalid(
            "Word Practice requires 1..128 unique saved Materials".into(),
        ));
    }
    Ok(())
}

pub(crate) fn practice_material(
    db: &Connection,
    id: &MaterialId,
) -> Result<Material, StorageError> {
    let material = crate::material_read::read_material(db, id).map_err(|error| match error {
        StorageError::Sql(rusqlite::Error::QueryReturnedNoRows) => {
            StorageError::Invalid("Selected Word Practice Material is unavailable".into())
        }
        error => error,
    })?;
    let excluded = match &material.content.target_id {
        Some(target_id) => matches!(
            crate::material_read::eligibility(
                db,
                &MaterialTarget {
                    package_id: material.content.package_id.clone(),
                    target_id: target_id.clone(),
                },
            )?
            .availability,
            CaptureAvailability::Excluded | CaptureAvailability::Existing { excluded: true, .. }
        ),
        None => false,
    };
    if material.excluded || excluded {
        return Err(StorageError::Invalid(
            "Selected Word Practice Material is excluded".into(),
        ));
    }
    Ok(material)
}

pub(crate) fn due(db: &Connection, value: &ReviewAdmission, now: i64) -> Result<(), StorageError> {
    if matches!(value.subject, ReviewSubject::Target { .. }) {
        return Err(StorageError::Invalid(
            "Canonical tasks cannot enter scheduled Material Review".into(),
        ));
    }
    if review_read::schedule(db, value)?.is_some_and(|schedule| schedule.due_at > now) {
        return Err(StorageError::Conflict);
    }
    Ok(())
}

pub(crate) fn next(
    db: &Connection,
    session: &mut ReviewSession,
    candidate: Option<&ReviewAdmission>,
) -> Result<(), StorageError> {
    if session.encounter.is_some() {
        return Err(StorageError::Invalid(
            "Finish the admitted encounter before advancing".into(),
        ));
    }
    let admission = match &session.mode {
        ReviewMode::Finite { .. }
        | ReviewMode::Practice { .. }
        | ReviewMode::TargetPractice { .. } => {
            let json: Option<String> = db.query_row(
                "SELECT admission FROM review_work WHERE session_id=?1 AND admitted=0 ORDER BY position LIMIT 1",
                [&session.id.0], |r| r.get(0),
            ).optional()?;
            json.map(|v| serde_json::from_str::<ReviewAdmission>(&v))
                .transpose()?
        }
        ReviewMode::Continuous => match candidate {
            Some(value) => {
                validate_admission(value)?;
                let position: u32 = db.query_row(
                    "SELECT COALESCE(MAX(position)+1,0) FROM review_work WHERE session_id=?1",
                    [&session.id.0],
                    |r| r.get(0),
                )?;
                db.execute("INSERT OR IGNORE INTO review_work(session_id,work_id,position,admission) VALUES(?1,?2,?3,?4)",
                        params![session.id.0, value.work_id.0, position, serde_json::to_string(value)?])?;
                Some(value.clone())
            }
            None => {
                let json: Option<String> = db.query_row(
                        "SELECT admission FROM review_work WHERE session_id=?1 AND admitted=0 ORDER BY position LIMIT 1",
                        [&session.id.0], |r| r.get(0),
                    ).optional()?;
                json.map(|v| serde_json::from_str::<ReviewAdmission>(&v))
                    .transpose()?
            }
        },
    };
    session.message = None;
    if let Some(value) = admission {
        let id = ReviewEncounterId(format!(
            "encounter-{:x}",
            Sha256::digest(serde_json::to_vec(&(
                &session.id,
                session.revision,
                &value.work_id
            ))?,)
        ));
        let mut conditions = ReviewConditions {
            revealed: false,
            exposure_count: 1,
            assistance: match &session.mode {
                ReviewMode::TargetPractice { assistance, .. } => {
                    assistance.clone().unwrap_or_default()
                }
                ReviewMode::Continuous
                | ReviewMode::Finite { .. }
                | ReviewMode::Practice { .. } => vec![],
            },
            delivery: if value.probe.required_media.is_some() {
                ReviewDelivery::Pending
            } else {
                ReviewDelivery::NotRequired
            },
        };
        let disclosed: bool = match value.subject.material() {
            Some((material_id, _)) => db.query_row(
            "SELECT EXISTS(SELECT 1 FROM review_encounters e JOIN review_work w ON w.session_id=e.session_id AND w.work_id=e.work_id WHERE (e.session_id=?1 OR NOT EXISTS(SELECT 1 FROM review_attempts a WHERE a.encounter_id=e.id AND a.active=1 AND (json_extract(a.response,'$.captureId') IS NOT NULL OR EXISTS(SELECT 1 FROM json_each(a.response,'$.grades') g WHERE json_extract(g.value,'$.quality') IS NOT NULL)))) AND json_extract(w.admission,'$.materialId')=?2 AND json_extract(e.projection,'$.conditions.revealed')=1)",
                params![session.id.0, material_id.0], |r| r.get(0),
            )?,
            None => false,
        };
        let tested: Vec<_> = value
            .probe
            .targets
            .iter()
            .filter_map(|row| row.key.as_ref())
            .collect();
        let key_disclosed: bool = db.query_row(
            "SELECT EXISTS(
                SELECT 1 FROM review_disclosures d
                JOIN review_encounters e ON e.id=d.encounter_id
                JOIN json_each(?2) k
                    ON d.package_id=json_extract(k.value,'$.packageId')
                    AND d.target_id=json_extract(k.value,'$.targetId')
                    AND d.capability=json_extract(k.value,'$.capability')
                WHERE e.session_id=?1 OR NOT EXISTS(
                    SELECT 1 FROM review_attempts a WHERE a.encounter_id=e.id AND a.active=1
                    AND (json_extract(a.response,'$.captureId') IS NOT NULL OR EXISTS(
                        SELECT 1 FROM json_each(a.response,'$.grades') g
                        WHERE json_extract(g.value,'$.quality') IS NOT NULL))))",
            params![session.id.0, serde_json::to_string(&tested)?],
            |row| row.get(0),
        )?;
        if disclosed || key_disclosed {
            conditions
                .assistance
                .push(ReviewAssistance::PriorDisclosure);
        }
        let encounter = ReviewEncounter {
            id: id.clone(),
            work_id: value.work_id.clone(),
            subject: value.subject.clone(),
            package_id: value.package_id.clone(),
            package_version: value.package_version.clone(),
            package_revision: value.package_revision.clone(),
            probe_id: value.probe.id.clone(),
            probe_contract_version: value.probe.contract_version,
            direction: value.probe.direction,
            cue: value.probe.cue.clone(),
            answer: None,
            targets: value.probe.targets.clone(),
            supplied: value.probe.supplied.clone(),
            required_media: value.probe.required_media.clone(),
            source: value.source.clone(),
            conditions,
            correction: false,
            task: value.task.as_ref().map(|task| ReviewTask {
                revision: task.revision,
                response_spec: task.response_spec.clone(),
                attribution: task.attribution.clone(),
                limitations: task.limitations.clone(),
            }),
            capture: None,
        };
        db.execute(
            "INSERT INTO review_encounters VALUES(?1,?2,?3,?4)",
            params![
                id.0,
                session.id.0,
                value.work_id.0,
                serde_json::to_string(&encounter)?
            ],
        )?;
        db.execute(
            "UPDATE review_work SET admitted=1 WHERE session_id=?1 AND work_id=?2",
            params![session.id.0, value.work_id.0],
        )?;
        crate::review_capture::disclose(db, &id, &value.probe.supplied, "cue")?;
        session.encounter = Some(encounter);
        session.state = ReviewSessionState::Active;
    } else {
        session.state = match &session.mode {
            ReviewMode::Finite { .. }
            | ReviewMode::Practice { .. }
            | ReviewMode::TargetPractice { .. } => ReviewSessionState::Complete,
            ReviewMode::Continuous => ReviewSessionState::Unavailable,
        };
        session.message = match &session.mode {
            ReviewMode::Continuous => Some("No due Review work is available".into()),
            ReviewMode::Finite { .. }
            | ReviewMode::Practice { .. }
            | ReviewMode::TargetPractice { .. } => None,
        };
    }
    Ok(())
}
