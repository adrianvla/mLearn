use crate::StorageError;
use mlearn_core::*;
use rusqlite::{Connection, params};

pub(crate) fn validate(
    response: &ReviewResponse,
    encounter: &ReviewEncounter,
) -> Result<(), StorageError> {
    if response.encounter_id != encounter.id
        || !encounter.conditions.revealed
        || response.grades.len() != encounter.targets.len()
    {
        return Err(StorageError::Invalid(
            "Reveal and rate each Review target exactly once".into(),
        ));
    }
    let mut ids = std::collections::HashSet::new();
    for grade in &response.grades {
        if !ids.insert(&grade.target_id)
            || !encounter
                .targets
                .iter()
                .any(|target| target.id == grade.target_id)
            || (grade.easy && grade.quality != Some(AttemptQuality::Fluent))
        {
            return Err(StorageError::Invalid(
                "Invalid Review response target or Easy grade".into(),
            ));
        }
    }
    Ok(())
}

pub(crate) fn quality(response: &ReviewResponse) -> Option<(AttemptQuality, bool)> {
    let tested = response
        .grades
        .iter()
        .filter_map(|g| g.quality.map(|q| (q, g.easy)));
    tested.min_by_key(|(q, easy)| match q {
        AttemptQuality::Missed => 0,
        AttemptQuality::Struggled => 1,
        AttemptQuality::Fluent => {
            if *easy {
                3
            } else {
                2
            }
        }
    })
}

pub(crate) fn observe(
    db: &Connection,
    attempt: &ReviewAttemptId,
    encounter: &ReviewEncounter,
    response: &ReviewResponse,
) -> Result<(), StorageError> {
    // Normal Reveal is retrospective self-report, not assistance. Conditions
    // before that reveal still determine whether an observation qualifies.
    let independent = encounter.conditions.assistance.is_empty()
        && encounter.conditions.exposure_count == 1
        && matches!(
            encounter.conditions.delivery,
            ReviewDelivery::NotRequired | ReviewDelivery::Completed
        );
    for target in &encounter.targets {
        let grade = response
            .grades
            .iter()
            .find(|g| g.target_id == target.id)
            .ok_or_else(|| StorageError::Invalid("Missing Review target grade".into()))?;
        if let (Some(key), Some(quality)) = (&target.key, grade.quality) {
            let assessed = if independent && grade.method == ResponseMethod::Remembered {
                Some(quality == AttemptQuality::Fluent)
            } else {
                None
            };
            db.execute(
                "INSERT INTO review_observations VALUES(?1,?2,?3,?4,?5,?6,?7)",
                params![
                    attempt.0,
                    target.id,
                    key.package_id,
                    key.target_id,
                    key.capability,
                    serde_json::to_string(grade)?,
                    assessed
                ],
            )?;
        }
    }
    db.execute(
        "UPDATE knowledge_revision SET revision=revision+1 WHERE id=1",
        [],
    )?;
    Ok(())
}

pub(crate) fn write_schedule(
    db: &Connection,
    admission: &ReviewAdmission,
    value: Option<&ReviewSchedule>,
) -> Result<(), StorageError> {
    match value {
        Some(schedule) => {
            db.execute("INSERT INTO review_schedules VALUES(?1,?2,?3) ON CONFLICT(material_id,probe_id) DO UPDATE SET document=excluded.document",
                params![admission.material_id.0, admission.probe.id, serde_json::to_string(schedule)?])?;
        }
        None => {
            db.execute(
                "DELETE FROM review_schedules WHERE material_id=?1 AND probe_id=?2",
                params![admission.material_id.0, admission.probe.id],
            )?;
        }
    }
    Ok(())
}
