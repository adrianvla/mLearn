use crate::{StorageError, material_validation::bounded, review_read};
use mlearn_core::*;
use rusqlite::{Connection, OptionalExtension, params};
use sha2::{Digest, Sha256};

pub(crate) fn validate_admission(value: &ReviewAdmission) -> Result<(), StorageError> {
    for id in [
        &value.work_id.0,
        &value.material_id.0,
        &value.package_id,
        &value.package_version,
        &value.package_revision,
    ] {
        bounded(id, 512)?;
    }
    if !review_compatible(&value.probe)
        || value.scheduler_version != REVIEW_POLICY_VERSION
        || serde_json::to_vec(value)?.len() > 131072
        || value.probe.targets.iter().any(|t| {
            t.key
                .as_ref()
                .is_some_and(|k| k.package_id != value.package_id)
        })
    {
        return Err(StorageError::Invalid("Invalid Review admission".into()));
    }
    Ok(())
}

pub(crate) fn due(db: &Connection, value: &ReviewAdmission, now: i64) -> Result<(), StorageError> {
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
    let admission = match session.mode {
        ReviewMode::Finite { .. } => {
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
            assistance: vec![],
            delivery: if value.probe.required_media.is_some() {
                ReviewDelivery::Pending
            } else {
                ReviewDelivery::NotRequired
            },
        };
        let disclosed: bool = db.query_row(
            "SELECT EXISTS(SELECT 1 FROM review_encounters e JOIN review_work w ON w.session_id=e.session_id AND w.work_id=e.work_id WHERE (e.session_id=?1 OR NOT EXISTS(SELECT 1 FROM review_attempts a WHERE a.encounter_id=e.id AND a.active=1 AND EXISTS(SELECT 1 FROM json_each(a.response,'$.grades') g WHERE json_extract(g.value,'$.quality') IS NOT NULL))) AND json_extract(w.admission,'$.materialId')=?2 AND json_extract(e.projection,'$.conditions.revealed')=1)",
            params![session.id.0, value.material_id.0], |r| r.get(0),
        )?;
        if disclosed {
            conditions
                .assistance
                .push(ReviewAssistance::PriorDisclosure);
        }
        let encounter = ReviewEncounter {
            id: id.clone(),
            work_id: value.work_id.clone(),
            material_id: value.material_id.clone(),
            material_revision: value.material_revision,
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
        session.encounter = Some(encounter);
        session.state = ReviewSessionState::Active;
    } else {
        session.state = match session.mode {
            ReviewMode::Finite { .. } => ReviewSessionState::Complete,
            ReviewMode::Continuous => ReviewSessionState::Unavailable,
        };
        session.message = match session.mode {
            ReviewMode::Continuous => Some("No due Review work is available".into()),
            ReviewMode::Finite { .. } => None,
        };
    }
    Ok(())
}
